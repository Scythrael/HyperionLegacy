// upgrades.test.ts: the four e1,000,000 upgrades, the e10,000,000 milestone, hidden milestones,
// the Stats peaks and the found flag (0.13.11.1).
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshSecretState, cloneSecret, type SecretState } from "./state";
import {
  overclockMultiplier,
  tenBonusFactor,
  prestigeMultiplier,
  gainMultiplier,
  upgradesUnlocked,
  upgradePrice,
  upgradePriceExponent,
  canBuyUpgrade,
  buyUpgrade,
  buyOverclock,
  unsoftenExponent,
  softenExponent,
  effectiveExponent,
  milestoneVisible,
  markFound,
  checkMilestonesMut,
  doCaptain,
  stepMut,
  pow10,
} from "./engine";
import { UPGRADES, UPGRADES_AT, STARFALL_EXPONENT, MILESTONES, milestoneAchievement, type UpgradeId } from "./config";

// A state whose best and current Ore sit at effective exponent e.
function atEffective(e: number): SecretState {
  const s = freshSecretState(0);
  s.ore = pow10(unsoftenExponent(e));
  s.bestOre = s.ore;
  s.runPeak = s.ore;
  s.fleetPeak = s.ore;
  s.pcPeak = s.ore;
  s.overclock = 5000;
  s.captainPoints = new Decimal(1e6);
  s.augmentPoints = new Decimal(1e5);
  s.dreamPoints = new Decimal(1e6);
  s.skills.tenBonus = true;
  return s;
}

const withLevel = (s: SecretState, id: UpgradeId, n: number): SecretState => {
  const x = cloneSecret(s);
  x.upgrades[id] = n;
  return x;
};

describe("the effective scale's inverse", () => {
  it("unsoftenExponent undoes softenExponent", () => {
    for (const e of [10, 777777, 800000, 1e6, 3.3e6, 1e7]) expect(softenExponent(unsoftenExponent(e))).toBeCloseTo(e, 3);
  });
});

describe("every upgrade is exactly 1 at level 0", () => {
  it("level 0 and a save with no upgrades at all give identical multipliers", () => {
    const s = atEffective(1.5e6);
    const bare = { ...cloneSecret(s), upgrades: undefined } as unknown as SecretState;
    expect(overclockMultiplier(s).eq(overclockMultiplier(bare))).toBe(true);
    expect(overclockMultiplier(s).eq(Decimal.pow(1.125, 5000))).toBe(true);
    expect(tenBonusFactor(s)).toBe(tenBonusFactor(bare));
    expect(tenBonusFactor(s)).toBe(2.2);
    expect(prestigeMultiplier(s).eq(prestigeMultiplier(bare))).toBe(true);
    expect(gainMultiplier(s).eq(gainMultiplier(bare))).toBe(true);
  });
});

describe("each upgrade measurably acts (everything wired)", () => {
  const s = atEffective(1.5e6);
  it("Overclock Overclocker: each Overclock level counts more", () => {
    const one = withLevel(s, "ocOverclocker", 1);
    const step = UPGRADES.find((u) => u.id === "ocOverclocker")!.step;
    expect(overclockMultiplier(one).log10()).toBeCloseTo(5000 * (1 + step) * Math.log10(1.125), 6);
    expect(overclockMultiplier(withLevel(s, "ocOverclocker", 2)).gt(overclockMultiplier(one))).toBe(true);
  });
  it("Tenfold Tuner: the ten bonus factor rises", () => {
    expect(tenBonusFactor(withLevel(s, "tenfoldTuner", 1))).toBeGreaterThan(2.2);
    expect(tenBonusFactor(withLevel(s, "tenfoldTuner", 4))).toBeGreaterThan(tenBonusFactor(withLevel(s, "tenfoldTuner", 1)));
  });
  it("Captain's Compound: the Captain and Augment multiplier rises, prestige gains do not", () => {
    const c = withLevel(s, "captainsCompound", 3);
    expect(prestigeMultiplier(c).gt(prestigeMultiplier(s))).toBe(true);
    expect(gainMultiplier(c).eq(gainMultiplier(s))).toBe(true);
  });
  it("Lucid Dreaming: Dream Points speed the stack, prestige gains do not move", () => {
    const l = withLevel(s, "lucidDreaming", 3);
    expect(prestigeMultiplier(l).gt(prestigeMultiplier(s))).toBe(true);
    expect(gainMultiplier(l).eq(gainMultiplier(s))).toBe(true);
    // with no Dream Points it does nothing, so it never surprises a player who has none
    const none = withLevel({ ...cloneSecret(s), dreamPoints: new Decimal(0) }, "lucidDreaming", 3);
    expect(prestigeMultiplier(none).eq(prestigeMultiplier({ ...cloneSecret(none), upgrades: { ...none.upgrades, lucidDreaming: 0 } }))).toBe(true);
  });
});

describe("unlock, prices and caps", () => {
  it("locked until the best Ore reaches e1,000,000", () => {
    const below = atEffective(UPGRADES_AT - 1);
    expect(upgradesUnlocked(below)).toBe(false);
    for (const u of UPGRADES) expect(canBuyUpgrade(below, u.id)).toBe(false);
    expect(buyUpgrade(below, "ocOverclocker", "max")).toBe(below);
    expect(upgradesUnlocked(atEffective(UPGRADES_AT))).toBe(true);
  });

  it("each level costs more than the last, and the cap stops it", () => {
    for (const u of UPGRADES) {
      let s = atEffective(2e7);
      let last = 0;
      for (let n = 0; n < u.cap; n++) {
        const e = upgradePriceExponent(s, u.id)!;
        expect(e).toBeGreaterThan(last);
        last = e;
        s = buyUpgrade(s, u.id, "one");
        s.ore = pow10(unsoftenExponent(2e7)); // keep buying power for the next level
        expect(s.upgrades[u.id]).toBe(n + 1);
      }
      expect(upgradePrice(s, u.id)).toBeNull();
      expect(canBuyUpgrade(s, u.id)).toBe(false);
      expect(buyUpgrade(s, u.id, "one")).toBe(s);
      expect(last).toBeLessThan(STARFALL_EXPONENT); // every level opens before the final stop
    }
  });

  it("Buy 1, Buy 10 and Max, paid in Ore", () => {
    const s = atEffective(1.3e6);
    const tight = cloneSecret(s);
    tight.ore = upgradePrice(s, "ocOverclocker")!.mul(1.5);
    const one = buyUpgrade(tight, "ocOverclocker", "one");
    expect(one.upgrades.ocOverclocker).toBe(1);
    expect(one.ore.div(upgradePrice(s, "ocOverclocker")!).toNumber()).toBeCloseTo(0.5, 6);
    const max = buyUpgrade(s, "ocOverclocker", "max");
    expect(max.upgrades.ocOverclocker).toBeGreaterThan(1);
    expect(upgradePriceExponent(max, "ocOverclocker")!).toBeGreaterThan(effectiveExponent(max.ore));
    const rich = atEffective(2e7);
    expect(buyUpgrade(rich, "ocOverclocker", "ten").upgrades.ocOverclocker).toBe(10);
  });
});

describe("Overclock Buy 10", () => {
  it("buys at most ten levels", () => {
    const s = freshSecretState(0);
    s.owned[0] = new Decimal(100);
    s.bought[0] = 100;
    s.lastIncome = new Decimal(1e6);
    s.ore = new Decimal(1e30);
    const t = buyOverclock(s, "ten");
    expect(t.overclock).toBe(10);
    expect(t.peakOverclock).toBe(10);
  });
});

describe("the e10,000,000 milestone", () => {
  it("is recorded at e10,000,000 Ore and pays the Starfall theme", () => {
    const s = atEffective(STARFALL_EXPONENT - 1);
    checkMilestonesMut(s, 5);
    expect(s.milestones.starfall).toBeUndefined();
    const t = atEffective(STARFALL_EXPONENT);
    checkMilestonesMut(t, 7);
    expect(t.milestones.starfall).toBe(7);
    expect(milestoneAchievement("starfall").reward).toContain("Starfall");
    expect(milestoneAchievement("googol").reward).toBe("Reward: recorded for a future update");
    expect(MILESTONES.find((m) => m.id === "starfall")!.achievement).toBe(true);
  });
});

describe("hidden milestones", () => {
  it("Ore goals appear one at a time", () => {
    const s = freshSecretState(0);
    expect(milestoneVisible(s, "googol")).toBe(true);
    expect(milestoneVisible(s, "e1000")).toBe(false);
    s.milestones.googol = 1;
    expect(milestoneVisible(s, "e1000")).toBe(true);
    expect(milestoneVisible(s, "e100k")).toBe(false);
    s.milestones.e1000 = 2;
    s.milestones.e100k = 3;
    expect(milestoneVisible(s, "finale")).toBe(true);
    expect(milestoneVisible(s, "long")).toBe(false);
    expect(milestoneVisible(s, "starfall")).toBe(false);
    s.milestones.finale = 4;
    s.milestones.long = 5;
    expect(milestoneVisible(s, "starfall")).toBe(true);
  });

  it("the rest appear once their system is in view; reached ones always show", () => {
    const s = freshSecretState(0);
    expect(milestoneVisible(s, "firstCaptain")).toBe(true);
    expect(milestoneVisible(s, "turbo")).toBe(true);
    expect(milestoneVisible(s, "firstFleet")).toBe(false);
    expect(milestoneVisible(s, "firstPc")).toBe(false);
    expect(milestoneVisible(s, "allSkills")).toBe(false);
    expect(milestoneVisible(s, "singularity")).toBe(false);
    s.captainCount = 1;
    expect(milestoneVisible(s, "firstFleet")).toBe(true);
    s.fleetTotal = 1;
    expect(milestoneVisible(s, "firstPc")).toBe(true);
    expect(milestoneVisible(s, "allSkills")).toBe(true);
    s.tiersUnlocked = 8;
    expect(milestoneVisible(s, "singularity")).toBe(true);
    const r = freshSecretState(0);
    r.milestones.firstPc = 9;
    expect(milestoneVisible(r, "firstPc")).toBe(true);
  });
});

describe("the Stats peaks and the found flag", () => {
  it("peaks never fall through a prestige", () => {
    const s = atEffective(120);
    s.owned[0] = new Decimal("1e50");
    s.bought[0] = 30;
    stepMut(s, 1, 1000);
    const peak = s.peakOwned[0];
    expect(peak.gte(new Decimal("1e50"))).toBe(true);
    const t = doCaptain(s, 2000);
    expect(t.owned[0].eq(0)).toBe(true);
    expect(t.peakOwned[0].eq(peak)).toBe(true);
    expect(t.peakOverclock).toBe(s.peakOverclock);
  });

  it("markFound sets the flag once and keeps the first date", () => {
    const s = freshSecretState(0);
    const a = markFound(s, 100);
    expect(a.found).toBe(true);
    expect(a.foundAt).toBe(100);
    expect(markFound(a, 200)).toBe(a);
  });
});
