import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshSecretState, serializeSecret, type SecretState } from "./state";
import {
  effectiveExponent,
  displayOre,
  unitPrice,
  buyTier,
  overclockPrice,
  buyOverclock,
  step,
  prestigeMultiplier,
} from "./engine";
import { TIERS, OC_SECONDS, OC_FLOOR_BASE, OC_FLOOR_STEP, FINALE_EXPONENT } from "./config";

const near = (a: Decimal, b: Decimal, rel = 1e-9) => {
  if (b.eq(0)) return a.eq(0);
  return a.sub(b).abs().div(b).lte(rel);
};

function richState(oreLog10: number): SecretState {
  const s = freshSecretState(0);
  s.ore = Decimal.pow(10, oreLog10);
  return s;
}

describe("generator prices and purchases", () => {
  it("Mining Laser costs 10 and the first purchase spends all 10 starting Ore", () => {
    const s = freshSecretState(0);
    expect(unitPrice(s, 0).eq(10)).toBe(true);
    const t = buyTier(s, 0, "one");
    expect(t.bought[0]).toBe(1);
    expect(t.owned[0].eq(1)).toBe(true);
    expect(t.ore.eq(0)).toBe(true);
    // pure: the input is untouched
    expect(s.bought[0]).toBe(0);
  });

  it("price is flat within a ten and rises by the tier factor at each ten", () => {
    const s = freshSecretState(0);
    s.bought[0] = 9;
    const p9 = unitPrice(s, 0);
    s.bought[0] = 10;
    const p10 = unitPrice(s, 0);
    expect(near(p10.div(p9), Decimal.pow(10, TIERS[0].costStepLog10))).toBe(true);
    s.bought[0] = 15;
    expect(unitPrice(s, 0).eq(p10)).toBe(true);
  });

  it("Buy 10 buys to the next ten, Max buys exactly what a loop of single buys affords", () => {
    const s = richState(40);
    s.bought[1] = 3;
    const ten = buyTier(s, 1, "ten");
    expect(ten.bought[1]).toBe(10);
    const max = buyTier(s, 1, "max");
    let loop = s;
    for (;;) {
      const next = buyTier(loop, 1, "one");
      if (next.bought[1] === loop.bought[1]) break;
      loop = next;
    }
    expect(max.bought[1]).toBe(loop.bought[1]);
    expect(near(max.ore, loop.ore, 1e-6) || max.ore.lt(unitPrice(max, 1))).toBe(true);
  });

  it("Max handles enormous budgets in closed form", () => {
    const s = richState(500000);
    const t = buyTier(s, 0, "max");
    expect(t.bought[0]).toBeGreaterThan(1_000_000);
    expect(t.ore.gte(0)).toBe(true);
    expect(t.ore.lt(unitPrice(t, 0))).toBe(true);
  });

  it("locked tiers cannot be bought", () => {
    const s = richState(100);
    expect(buyTier(s, 4, "max").bought[4]).toBe(0);
    s.tiersUnlocked = 5;
    expect(buyTier(s, 4, "max").bought[4]).toBeGreaterThan(0);
  });
});

describe("the cascade", () => {
  it("tier II makes Mining Lasers, Mining Lasers make Ore (exact polynomial over a step)", () => {
    const s = freshSecretState(0);
    s.ore = new Decimal(0);
    s.owned[0] = new Decimal(5);
    s.owned[1] = new Decimal(2);
    const t = step(s, 3, 0);
    // owned[0](t) = 5 + 2*0.4*t ; Ore = 5*1*t + 2*0.4*1*t^2/2
    expect(near(t.owned[0], new Decimal(5 + 2 * 0.4 * 3))).toBe(true);
    expect(near(t.ore, new Decimal(5 * 3 + (2 * 0.4 * 9) / 2))).toBe(true);
  });

  it("one 10 s step equals ten 1 s steps when nothing is bought", () => {
    const s = freshSecretState(0);
    s.ore = new Decimal(0);
    s.owned = [3, 2, 1, 1, 0, 0, 0, 0].map((n) => new Decimal(n));
    s.bought = [3, 2, 1, 1, 0, 0, 0, 0];
    let a = s;
    for (let i = 0; i < 10; i++) a = step(a, 1, 0);
    const b = step(s, 10, 0);
    for (let k = 0; k < 4; k++) expect(near(a.owned[k], b.owned[k])).toBe(true);
    expect(near(a.ore, b.ore)).toBe(true);
  });

  it("step is pure and deterministic", () => {
    const s = richState(20);
    const a = step(buyTier(s, 0, "max"), 1, 5);
    const b = step(buyTier(s, 0, "max"), 1, 5);
    expect(serializeSecret(a)).toBe(serializeSecret(b));
    expect(s.bought[0]).toBe(0);
  });

  it("the prestige multiplier is 1 with no points", () => {
    expect(prestigeMultiplier(freshSecretState(0)).eq(1)).toBe(true);
  });
});

describe("Overclock", () => {
  it("costs OC_SECONDS of income divided by the prestige multiplier, never below the floor", () => {
    const s = freshSecretState(0);
    s.lastIncome = new Decimal("1e50");
    s.captainPoints = new Decimal(1000);
    const expected = s.lastIncome.mul(OC_SECONDS).div(prestigeMultiplier(s));
    expect(near(overclockPrice(s), expected)).toBe(true);
    s.lastIncome = new Decimal(0);
    s.overclock = 7;
    expect(near(overclockPrice(s), new Decimal(OC_FLOOR_BASE).mul(Decimal.pow(OC_FLOOR_STEP, 7)))).toBe(true);
  });

  it("each level multiplies production by 1.125", () => {
    const s = freshSecretState(0);
    s.ore = new Decimal(0);
    s.owned[0] = new Decimal(10);
    const base = step(s, 1, 0).ore;
    s.overclock = 2;
    expect(near(step(s, 1, 0).ore, base.mul(1.125 * 1.125))).toBe(true);
  });

  it("Max buys at a flat price within one purchase", () => {
    const s = richState(42);
    s.lastIncome = new Decimal("1e40");
    s.owned[0] = new Decimal(1);
    const price = overclockPrice(s);
    const t = buyOverclock(s, "max");
    expect(t.overclock).toBe(Math.floor(s.ore.div(price).toNumber()));
  });

  it("a fresh game cannot spend its starting Ore on Overclock (no soft-lock)", () => {
    const s = freshSecretState(0);
    expect(buyOverclock(s, "one").overclock).toBe(0);
    expect(buyOverclock(s, "max").ore.eq(10)).toBe(true);
    // with a generator owned but no income yet, still refused
    const t = buyTier(s, 0, "one");
    t.ore = new Decimal(100);
    expect(buyOverclock(t, "max").overclock).toBe(0);
  });

  it("a stack with nothing owned and too little Ore is topped back up to the starting Ore", () => {
    const s = freshSecretState(0);
    s.ore = new Decimal(3);
    const t = step(s, 1, 0);
    expect(t.ore.eq(10)).toBe(true);
    // and the player can always buy a Mining Laser again
    expect(buyTier(t, 0, "one").bought[0]).toBe(1);
  });

  it("buying Overclock right after a reset is bounded by the floor", () => {
    const s = richState(10);
    s.owned[0] = new Decimal(1);
    s.bought[0] = 1;
    s.lastIncome = new Decimal(1);
    const t = buyOverclock(s, "max");
    const bound = Math.log(1e10 / OC_FLOOR_BASE) / Math.log(OC_FLOOR_STEP);
    expect(t.overclock).toBeGreaterThan(0);
    expect(t.overclock).toBeLessThanOrEqual(Math.ceil(bound));
  });

  it("one buys a single level", () => {
    const s = richState(60);
    s.lastIncome = new Decimal("1e40");
    s.owned[0] = new Decimal(1);
    expect(buyOverclock(s, "one").overclock).toBe(1);
  });
});

describe("the effective exponent", () => {
  it("is the identity up to e777,777 and concave, still rising, above", () => {
    expect(effectiveExponent(new Decimal(1))).toBe(0);
    expect(effectiveExponent(Decimal.pow(10, 500))).toBeCloseTo(500, 9);
    expect(effectiveExponent(Decimal.pow(10, FINALE_EXPONENT))).toBeCloseTo(FINALE_EXPONENT, 6);
    const a = effectiveExponent(Decimal.pow(10, 800000));
    const b = effectiveExponent(Decimal.pow(10, 1e7));
    const c = effectiveExponent(Decimal.pow(10, 2e7));
    expect(a).toBeLessThan(800000);
    expect(a).toBeGreaterThan(FINALE_EXPONENT);
    expect(c).toBeGreaterThan(b);
    expect(c - b).toBeLessThan(b - a);
  });

  it("display Ore equals raw Ore up to the finale", () => {
    const d = new Decimal("3.3e1234");
    expect(displayOre(d).eq(d)).toBe(true);
    expect(displayOre(Decimal.pow(10, 2e7)).log10()).toBeCloseTo(effectiveExponent(Decimal.pow(10, 2e7)), 6);
  });
});
