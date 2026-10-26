// upgrades.test.ts: the late upgrades (staggered from e1,000,000), the e10,000,000 milestone, hidden milestones,
// the Stats peaks and the found flag (0.13.11.1).
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { readFileSync } from "node:fs";
import { freshSecretState, cloneSecret, type SecretState } from "./state";
import {
  overclockMultiplier,
  tenBonusFactor,
  prestigeMultiplier,
  captainMultiplier,
  augmentMultiplier,
  dreamSpeedMultiplier,
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
  upgradeUnlocked,
  encabulatorFactor,
  tierMultiplier,
  overdrivePower,
  sharpenFactor,
  produceMut,
  upgradeBlocked,
} from "./engine";
import { UPGRADES, UPGRADES_AT, STARFALL_EXPONENT, MILESTONES, OVERDRIVE_POWER, COPY, milestoneAchievement, type UpgradeId } from "./config";

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
  s.skills.overdrive = true; // late game: Overdrive Overdrive needs it
  return s;
}

const withLevel = (s: SecretState, id: UpgradeId, n: number): SecretState => {
  const x = cloneSecret(s);
  x.upgrades[id] = n;
  return x;
};

describe("the effective scale's inverse", () => {
  it("unsoftenExponent undoes softenExponent", () => {
    for (const e of [10, 777777, 800000, 1e6, 3.3e6, 1e7, 1.02e7, 1.3e7, 3e7]) expect(softenExponent(unsoftenExponent(e)) / e).toBeCloseTo(1, 9);
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

describe("the Prestige tab shows the engine's own multipliers", () => {
  it("Captain x Augment x Dream speed is exactly the prestige multiplier, at any levels", () => {
    for (const [cc, ld] of [[0, 0], [3, 0], [0, 4], [10, 10]]) {
      const s = withLevel(withLevel(atEffective(1.5e6), "captainsCompound", cc), "lucidDreaming", ld);
      const shown = captainMultiplier(s).mul(augmentMultiplier(s)).mul(dreamSpeedMultiplier(s));
      expect(shown.log10()).toBeCloseTo(prestigeMultiplier(s).log10(), 9);
    }
    const plain = atEffective(1.5e6);
    expect(dreamSpeedMultiplier(plain).eq(1)).toBe(true);
    expect(captainMultiplier(withLevel(plain, "captainsCompound", 2)).gt(captainMultiplier(plain))).toBe(true);
  });

  it("the overlay reads them from the engine, and shows the Lucid Dreaming speed line", () => {
    const src = readFileSync("src/lib/SecretGameOverlay.svelte", "utf-8");
    expect(src).not.toMatch(/\.pow\((CP|AP)_POW\)/);
    for (const fn of ["captainMultiplier(s)", "augmentMultiplier(s)", "dreamSpeedMultiplier(s)"]) expect(src).toContain(fn);
    expect(src).toContain("Dream Points speed the stack");
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
    // 0.13.11.1 content pacing: the beats on the way to e10,000,000, one at a time too
    expect(milestoneVisible(s, "e2m")).toBe(true);
    expect(milestoneVisible(s, "e3m")).toBe(false);
    expect(milestoneVisible(s, "starfall")).toBe(false);
    s.milestones.e2m = 6;
    s.milestones.e3m = 7;
    s.milestones.e5m = 8;
    expect(milestoneVisible(s, "e7m")).toBe(true);
    expect(milestoneVisible(s, "starfall")).toBe(false);
    s.milestones.e7m = 9;
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

describe("0.13.11.1: past e10,000,000 a second bend (user: \"Slow it after e10M\")", () => {
  it("leaves everything up to e10,000,000 exactly as it was and only slows above it, never stopping", () => {
    const at10M = unsoftenExponent(1e7);
    expect(softenExponent(at10M)).toBeCloseTo(1e7, 3);
    // a raw step past e10,000,000 moves the effective exponent less than it used to, but always forward
    let last = softenExponent(at10M);
    for (const raw of [at10M * 1.5, at10M * 3, at10M * 10, at10M * 100]) {
      const e = softenExponent(raw);
      expect(e).toBeGreaterThan(last);
      last = e;
    }
    expect(softenExponent(at10M * 10)).toBeLessThan(2e7);
  });
});

describe("0.13.11.1 content pacing: staggered and new upgrades, new milestones", () => {
  it("each upgrade wakes at its own best Ore, in order, the first at e1,000,000", () => {
    const sorted = [...UPGRADES].sort((a, b) => a.unlockAt - b.unlockAt);
    expect(sorted[0].unlockAt).toBe(UPGRADES_AT);
    for (const u of UPGRADES) {
      const below = atEffective(u.unlockAt - 1);
      below.ore = pow10(unsoftenExponent(u.unlockAt + 5e6));
      expect(upgradeUnlocked(below, u.id), u.id).toBe(false);
      expect(canBuyUpgrade(below, u.id), u.id).toBe(false);
      const at = atEffective(u.unlockAt);
      expect(upgradeUnlocked(at, u.id), u.id).toBe(true);
      expect(canBuyUpgrade(at, u.id), u.id).toBe(true); // the first level costs the unlock itself
      expect(u.priceBase).toBe(u.unlockAt);
    }
    expect(new Set(UPGRADES.map((u) => u.unlockAt)).size).toBe(UPGRADES.length);
  });

  it("the three late upgrades measurably act and are exactly 1 at level 0", () => {
    const s = atEffective(4e6);
    s.skills.overdrive = true;
    s.tiersUnlocked = 8;
    const lv = (id: UpgradeId, n: number) => ({ ...cloneSecret(s), upgrades: { ...s.upgrades, [id]: n } });
    expect(encabulatorFactor(s)).toBe(1);
    expect(encabulatorFactor(lv("turboEncabulator", 3))).toBeGreaterThan(1);
    expect(tierMultiplier(lv("turboEncabulator", 3), 0).gt(tierMultiplier(s, 0))).toBe(true);
    expect(overdrivePower(s)).toBe(OVERDRIVE_POWER);
    expect(overdrivePower(lv("overdriveOverdrive", 4))).toBeGreaterThan(OVERDRIVE_POWER);
    expect(sharpenFactor(s, 7)).toBe(1);
    expect(sharpenFactor(lv("singularitySharpener", 2), 7)).toBeGreaterThan(1);
    expect(sharpenFactor(lv("singularitySharpener", 2), 6)).toBe(1); // only the top generator
    // and each one makes the stack produce more over a second
    // (on a small stack, where a second's Ore shows against what is held)
    for (const [id, n] of [["turboEncabulator", 3], ["overdriveOverdrive", 4], ["singularitySharpener", 5]] as const) {
      const a = freshSecretState(0);
      a.skills.overdrive = true;
      a.tiersUnlocked = 8;
      a.owned = a.owned.map(() => new Decimal(1e6));
      a.bought = a.bought.map(() => 100);
      const b = cloneSecret(a);
      b.upgrades = { ...b.upgrades, [id]: n };
      produceMut(a, 1);
      produceMut(b, 1);
      expect(b.ore.gt(a.ore), id).toBe(true);
    }
  });

  it("four new Ore milestones between e1,000,000 and e10,000,000, each with a popup", () => {
    for (const [id, e] of [["e2m", 2e6], ["e3m", 3e6], ["e5m", 5e6], ["e7m", 7777777]] as const) {
      const s = atEffective(e - 1);
      checkMilestonesMut(s, 1);
      expect(s.milestones[id], id).toBeUndefined();
      const t = atEffective(e);
      checkMilestonesMut(t, 2);
      expect(t.milestones[id], id).toBe(2);
      const pop = milestoneAchievement(id);
      expect(pop.title.length).toBeGreaterThan(3);
      expect(pop.flavor).toBeTruthy();
      expect(pop.reward).toBe("Reward: recorded for a future update");
    }
  });
});

describe("final re-check: upgrade rows", () => {
  it("Overdrive Overdrive needs the Overdrive skill to be bought, and says so", () => {
    const s = atEffective(3e6);
    s.ore = pow10(unsoftenExponent(9e6));
    delete s.skills.overdrive;
    expect(upgradeUnlocked(s, "overdriveOverdrive")).toBe(true);
    expect(upgradeBlocked(s, "overdriveOverdrive")).toEqual({ kind: "needsOverdrive" });
    expect(canBuyUpgrade(s, "overdriveOverdrive")).toBe(false);
    s.skills.overdrive = true;
    expect(upgradeBlocked(s, "overdriveOverdrive")).toBeNull();
    expect(canBuyUpgrade(s, "overdriveOverdrive")).toBe(true);
    expect(UPGRADES.find((u) => u.id === "overdriveOverdrive")!.effect).toContain("Overdrive skill");
  });

  it("a save owning levels in an upgrade that now wakes later keeps them, sees the row, and waits to buy more", () => {
    const s = atEffective(1.1e6); // Tenfold Tuner wakes at e1.35M now
    s.ore = pow10(unsoftenExponent(9e6));
    s.upgrades.tenfoldTuner = 3;
    expect(upgradeBlocked(s, "tenfoldTuner")).toEqual({ kind: "asleep", unlockAt: UPGRADES.find((u) => u.id === "tenfoldTuner")!.unlockAt });
    expect(canBuyUpgrade(s, "tenfoldTuner")).toBe(false);
    expect(tenBonusFactor(s)).toBeGreaterThan(tenBonusFactor({ ...cloneSecret(s), upgrades: { ...s.upgrades, tenfoldTuner: 0 } }));
    const ov = readFileSync("src/lib/SecretGameOverlay.svelte", "utf-8");
    expect(ov).toContain("{#if upgradeUnlocked(s, u.id) || upgradeLevel(s, u.id) > 0}");
    expect(ov).toContain("`Wakes at ${formatExponent(block.unlockAt)} Ore`");
    expect(ov).toContain("COPY.needsOverdrive");
  });

  it("a capped upgrade reads Maxed, never Buy 0; the Fleet card drops the Skill Point once every skill is learned", () => {
    const ov = readFileSync("src/lib/SecretGameOverlay.svelte", "utf-8");
    expect(ov).toContain('if (q.limitedBy === "cap" && q.count === 0) return COPY.maxed;');
    expect(ov).toContain("level >= u.cap ? COPY.maxed : levelsLabel(qMax.count)");
    expect(ov).toContain("allSkillsLearned(s) ? COPY.fleetBlurbAllSkills : COPY.fleetBlurb");
    expect(COPY.fleetBlurbAllSkills).not.toMatch(/Skill Point/);
    expect(COPY.fleetBlurb).toMatch(/Skill Point/);
  });
});
