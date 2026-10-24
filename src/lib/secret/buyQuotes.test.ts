// buyQuotes.test.ts: Buy 1, Buy 10 and Max on the Upgrades tab (0.13.11.1, staging: "buy 10 for the
// new overclock upgrade seems to act like the max button, and shows no cost"). Buy 10 buys at most
// ten levels (fewer only when Ore or the cap runs out, and the tab says so), every button shows what
// it costs, and Max shows how many levels it buys.
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { readFileSync } from "node:fs";
import { freshSecretState, type SecretState } from "./state";
import { buyOverclock, buyUpgrade, overclockPrice, overclockQuote, upgradeQuote, upgradePrice, upgradeLevel, unsoftenExponent } from "./engine";
import { UPGRADES } from "./config";

function producing(oreLog10: number, incomeLog10: number): SecretState {
  const s = freshSecretState(0);
  s.owned[0] = new Decimal(1000);
  s.bought[0] = 100;
  s.lastIncome = Decimal.pow(10, incomeLog10);
  s.ore = Decimal.pow(10, oreLog10);
  return s;
}

describe("Overclock: Buy 1, Buy 10 and Max", () => {
  it("Buy 10 buys exactly ten levels when Ore allows more, and Max buys more than ten", () => {
    for (const [oreLog, incomeLog] of [[400, 380], [5000, 4990], [60, 2]]) {
      const s = producing(oreLog, incomeLog);
      const ten = buyOverclock(s, "ten");
      expect(ten.overclock - s.overclock, `ore e${oreLog}`).toBe(10);
      expect(buyOverclock(s, "max").overclock - s.overclock).toBeGreaterThan(10);
      expect(buyOverclock(s, "one").overclock - s.overclock).toBe(1);
    }
  });

  it("the quote matches what the button does, and its price is what is spent", () => {
    const s = producing(400, 380);
    for (const [n, mode] of [[1, "one"], [10, "ten"], [Infinity, "max"]] as const) {
      const q = overclockQuote(s, n);
      const after = buyOverclock(s, mode);
      expect(q.count).toBe(after.overclock - s.overclock);
      // (the price is summed level by level: e380 taken from e400 Ore does not show in the Ore)
      if (n === 1) expect(q.cost.eq(overclockPrice(s))).toBe(true);
      expect(q.cost.gt(0)).toBe(true);
    }
    // Buy 1's price is the next level's price (priced from income)
    expect(overclockQuote(s, 1).cost.eq(overclockPrice(s))).toBe(true);
    expect(overclockQuote(s, 10).limitedBy).toBe(null);
  });

  it("with Ore for only a few levels, Buy 10 buys those and says Ore ran out; the full price of ten is still shown", () => {
    const s = producing(0, 0);
    s.lastIncome = new Decimal(1e6); // income-priced levels
    const one = overclockPrice(s);
    s.ore = one.mul(3.5);
    const q = overclockQuote(s, 10);
    expect(q.count).toBe(3);
    expect(q.limitedBy).toBe("ore");
    expect(buyOverclock(s, "ten").overclock - s.overclock).toBe(3);
    expect(q.fullCost.gt(q.cost)).toBe(true);
    expect(q.fullCost.gte(one.mul(10 * (1 - 1e-12)))).toBe(true);
  });
});

describe("the four e1,000,000 upgrades: Buy 1, Buy 10 and Max", () => {
  function unlocked(oreEff: number): SecretState {
    const s = producing(0, 10);
    s.bestOre = Decimal.pow(10, unsoftenExponent(1e6));
    s.ore = Decimal.pow(10, unsoftenExponent(oreEff));
    return s;
  }

  it("Buy 10 stops at ten levels, or at the cap (saying so); Max stops at the cap", () => {
    const s = unlocked(9e6); // enough for every level of every upgrade
    for (const u of UPGRADES) {
      const ten = upgradeQuote(s, u.id, 10);
      expect(ten.count, u.id).toBe(Math.min(10, u.cap));
      expect(ten.limitedBy, u.id).toBe(u.cap < 10 ? "cap" : null);
      expect(upgradeLevel(buyUpgrade(s, u.id, "ten"), u.id)).toBe(Math.min(10, u.cap));
      const max = upgradeQuote(s, u.id, Infinity);
      expect(max.count, u.id).toBe(u.cap);
      expect(max.limitedBy, u.id).toBe("cap"); // Max says it stops at the cap
      expect(upgradeLevel(buyUpgrade(s, u.id, "max"), u.id)).toBe(u.cap);
    }
  });

  it("every quote's price is the sum of the levels' own prices, Buy 1 first", () => {
    const s = unlocked(9e6);
    for (const u of UPGRADES) {
      const one = upgradeQuote(s, u.id, 1);
      expect(one.cost.eq(upgradePrice(s, u.id)!)).toBe(true);
      const ten = upgradeQuote(s, u.id, 10);
      expect(ten.cost.gte(one.cost)).toBe(true);
    }
  });

  it("with Ore for only some levels, Buy 10 buys those and says Ore ran out", () => {
    const u = UPGRADES.find((x) => x.id === "ocOverclocker")!;
    const third = u.priceBase * Math.pow(u.priceRatio, 2);
    const s = unlocked(third + 1); // levels 1 to 3 are affordable, the 4th is not
    const q = upgradeQuote(s, u.id, 10);
    expect(q.count).toBe(3);
    expect(q.limitedBy).toBe("ore");
    expect(upgradeLevel(buyUpgrade(s, u.id, "ten"), u.id)).toBe(3);
  });
});

describe("the Upgrades tab shows it", () => {
  it("Buy 10 shows a price and says when Ore or the cap cuts it short; Max shows its level count", () => {
    const ov = readFileSync("src/lib/SecretGameOverlay.svelte", "utf-8");
    expect(ov).toMatch(/buyOverclock\(x, "ten"\)\)\}>\{tenLabel\(oc10\)\}<span class="num">/);
    expect(ov).toMatch(/buyOverclock\(x, "max"\)\)\}>Max<span class="num">\{levelsLabel\(ocMax\.count\)\}/);
    expect(ov).toMatch(/buyUpgrade\(x, u\.id, "ten"\)\)\}>\{tenLabel\(q10\)\}<span class="num">/);
    expect(ov).toMatch(/buyUpgrade\(x, u\.id, "max"\)\)\}>Max<span class="num">\{levelsLabel\(qMax\.count\)\}/);
    expect(ov).toContain("Ore runs out after");
    expect(ov).toContain("(to the cap)");
  });
});
