import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshSecretState, type SecretState } from "./state";
import {
  captainGain,
  fleetGain,
  fleetThresholdExponent,
  fleetThresholdOre,
  gainExponent,
  prestigeceptionGain,
  doCaptain,
  doFleet,
  doPrestigeception,
  buySkill,
  canBuySkill,
  setAuto,
  setAutoTarget,
  step,
  produceMut,
  gainMultiplier,
  tenMultiplier,
  checkMilestonesMut,
} from "./engine";
import { cloneSecret } from "./state";
import { formatSecret } from "./format";
import {
  CP_SCALE,
  AP_SCALE,
  DP_SCALE,
  FLEET_AT,
  FINALE_EXPONENT,
  CP_K,
  AP_K,
  DP_K,
  MILESTONES,
  SKILLS,
  TEN_BONUS_SKILL,
  OVERDRIVE_POWER,
} from "./config";

const pow10 = (e: number) => Decimal.pow(10, e);

function withRun(e: number): SecretState {
  const s = freshSecretState(0);
  s.ore = pow10(e);
  s.runPeak = s.ore;
  s.fleetPeak = s.ore;
  s.pcPeak = s.ore;
  s.bestOre = s.ore;
  s.bought[0] = 25;
  s.owned[0] = new Decimal(25);
  s.overclock = 40;
  return s;
}

describe("Captain Prestige", () => {
  it("needs 1e60 Ore and pays CP_SCALE x gainMultiplier x (exponent / 60)^CP_K before the finale", () => {
    expect(captainGain(withRun(59.9)).eq(0)).toBe(true);
    expect(doCaptain(withRun(59.9), 5).captainCount).toBe(0);
    const s = withRun(120);
    expect(captainGain(s).eq(Math.floor(CP_SCALE * Math.pow(2, CP_K)))).toBe(true);
  });

  it("resets Ore, generators and Overclock, keeps Captain Points", () => {
    const t = doCaptain(withRun(120), 5);
    expect(t.captainPoints.eq(Math.floor(CP_SCALE * Math.pow(2, CP_K)))).toBe(true);
    expect(t.ore.eq(10)).toBe(true);
    expect(t.bought[0]).toBe(0);
    expect(t.owned[0].eq(0)).toBe(true);
    expect(t.overclock).toBe(0);
    expect(t.captainCount).toBe(1);
    expect(t.milestones.firstCaptain).toBe(5);
  });
});

describe("Fleet Prestige", () => {
  it("needs 1.8e308 this fleet and pays Augment Points and one Skill Point, resetting Captain Points", () => {
    expect(fleetGain(withRun(308)).eq(0)).toBe(true);
    const s = withRun(FLEET_AT * 2);
    s.captainPoints = new Decimal(5000);
    expect(fleetGain(s).eq(Math.floor(AP_SCALE * Math.pow(2, AP_K)))).toBe(true);
    const t = doFleet(s, 9);
    expect(t.augmentPoints.eq(Math.floor(AP_SCALE * Math.pow(2, AP_K)))).toBe(true);
    expect(t.skillPoints).toBe(1);
    expect(t.captainPoints.eq(0)).toBe(true);
    expect(t.fleetCount).toBe(1);
    expect(t.fleetTotal).toBe(1);
    expect(t.milestones.firstFleet).toBe(9);
  });

  it("unlocks V at 1, VI at 2, VII at 3 and VIII at 6 lifetime Fleets", () => {
    let s = withRun(400);
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      s = doFleet(s, i);
      seen.push(s.tiersUnlocked);
      s.fleetPeak = pow10(400);
      s.augmentPoints = new Decimal(0); // tiers only: keep each Fleet over the doubling bar (0.13.11.1)
    }
    expect(seen).toEqual([5, 6, 7, 7, 7, 8]);
  });
});

describe("0.13.11.1: the Fleet bar doubles (user, \"Yes, double it\")", () => {
  it("1.8e308 first; after that a Fleet must at least double your Augment Points", () => {
    const s = withRun(FLEET_AT * 2);
    expect(fleetThresholdExponent(s)).toBe(FLEET_AT);
    expect(formatSecret(fleetThresholdOre(s))).toBe("1.80e308");
    const g = fleetGain(s);
    expect(g.gt(0)).toBe(true);
    // Holding exactly what this Fleet pays: it doubles them, so it pays. One more point held: it does not.
    s.augmentPoints = g;
    expect(fleetGain(s).eq(g)).toBe(true);
    s.augmentPoints = g.add(1);
    expect(fleetGain(s).eq(0)).toBe(true);
    const t = doFleet(s, 1);
    expect(t.fleetCount).toBe(s.fleetCount);
    expect(t.skillPoints).toBe(s.skillPoints);
    // The bar shown is the exponent where the gain reaches the points held.
    s.augmentPoints = new Decimal(AP_SCALE * Math.pow(2, AP_K));
    expect(fleetThresholdExponent(s)).toBeCloseTo(FLEET_AT * 2, 6);
  });

  it("when every Fleet lands on its bar the bars are e308 x 2^(Fleets since the last Prestigeception, minus 1)", () => {
    // Past the finale (gains linear, the 0.13.11 formula): Fleets at 1.8e308, 1.8e308, e616.5, e1,233 ...
    let s = withRun(FLEET_AT);
    s.bestOre = pow10(FINALE_EXPONENT);
    const bars: number[] = [];
    for (let i = 0; i < 4; i++) {
      const bar = fleetThresholdExponent(s);
      bars.push(bar);
      s.fleetPeak = pow10(bar + 1e-9);
      s = doFleet(s, i);
      expect(s.fleetCount).toBe(i + 1);
    }
    for (const [i, bar] of bars.entries()) expect(bar).toBeCloseTo(FLEET_AT * Math.pow(2, Math.max(0, i - 1)), 3);
  });

  it("Fleet spam cannot farm Skill Points: a run past 1.8e308 but under the bar pays nothing", () => {
    const s = withRun(400);
    s.augmentPoints = new Decimal(1e6);
    s.skillPoints = 3;
    expect(fleetGain(s).eq(0)).toBe(true);
    expect(doFleet(s, 1).skillPoints).toBe(3);
    expect(fleetThresholdExponent(s)).toBeGreaterThan(400);
  });

  it("a Prestigeception puts the bar back at 1.8e308", () => {
    const s = withRun(20000);
    s.fleetCount = 6;
    s.augmentPoints = new Decimal(1e9);
    expect(fleetThresholdExponent(s)).toBeGreaterThan(FLEET_AT);
    const t = doPrestigeception(s, 1);
    expect(fleetThresholdExponent(t)).toBe(FLEET_AT);
  });
});

describe("0.13.11.1: gains bend before the finale; Captain and Fleet return to the 0.13.11 formula after it", () => {
  it("below the finale (exponent / threshold)^k; with the best Ore at the finale, Captain and Fleet are linear as in 0.13.11", () => {
    const s = withRun(120);
    expect(gainExponent(s, CP_K)).toBe(CP_K);
    expect(captainGain(s).eq(Math.floor(CP_SCALE * Math.pow(2, CP_K)))).toBe(true);
    s.bestOre = pow10(FINALE_EXPONENT);
    expect(gainExponent(s, CP_K)).toBe(1);
    expect(captainGain(s).eq(Math.floor(CP_SCALE * 2))).toBe(true);
    // Dream Points keep their bend past the finale (they are never reset).
    const p = withRun(20000);
    p.bestOre = pow10(FINALE_EXPONENT + 1);
    expect(prestigeceptionGain(p).eq(Math.floor(DP_SCALE * Math.pow(2, DP_K)))).toBe(true);
    const f = withRun(FLEET_AT * 2);
    f.bestOre = pow10(FINALE_EXPONENT);
    expect(fleetGain(f).eq(Math.floor(AP_SCALE * 2))).toBe(true);
  });

  it("every k is under 1, so a bigger prestige pays less per exponent", () => {
    for (const k of [CP_K, AP_K, DP_K]) {
      expect(k).toBeGreaterThan(0);
      expect(k).toBeLessThan(1);
    }
  });
});

describe("Prestigeception", () => {
  it("needs e10,000 since the last one and pays Dream Points", () => {
    expect(prestigeceptionGain(withRun(9999)).eq(0)).toBe(true);
    expect(prestigeceptionGain(withRun(20000)).eq(Math.floor(DP_SCALE * Math.pow(2, DP_K)))).toBe(true);
  });

  it("resets Captain and Augment Points and the Fleet count, keeps skills, Skill Points and tiers", () => {
    const s = withRun(20000);
    s.captainPoints = new Decimal(1e9);
    s.augmentPoints = new Decimal(1e6);
    s.fleetCount = 4;
    s.fleetTotal = 4;
    s.tiersUnlocked = 7;
    s.skillPoints = 2;
    s.skills.headStart = true;
    const t = doPrestigeception(s, 3);
    expect(t.dreamPoints.gt(0)).toBe(true);
    expect(t.captainPoints.eq(0)).toBe(true);
    expect(t.augmentPoints.eq(0)).toBe(true);
    expect(t.fleetCount).toBe(0);
    expect(t.fleetTotal).toBe(4);
    expect(t.tiersUnlocked).toBe(7);
    expect(t.skillPoints).toBe(2);
    expect(t.skills.headStart).toBe(true);
    expect(t.ore.eq(1e10)).toBe(true); // Head Start
    expect(t.pcCount).toBe(1);
    expect(t.milestones.firstPc).toBe(3);
  });

  it("Dream Points multiply Captain and Augment Point gains", () => {
    const s = withRun(FLEET_AT * 2);
    const plainCp = captainGain(s);
    const plainAp = fleetGain(s);
    s.dreamPoints = new Decimal(1e6);
    const m = gainMultiplier(s);
    expect(m.gt(1)).toBe(true);
    // (the plain gains are whole numbers, so compare against the unrounded products)
    expect(plainCp.gt(0) && plainAp.gt(0)).toBe(true);
    expect(captainGain(s).eq(m.mul(CP_SCALE * Math.pow((FLEET_AT * 2) / 60, CP_K)).floor())).toBe(true);
    expect(fleetGain(s).eq(m.mul(AP_SCALE * Math.pow(2, AP_K)).floor())).toBe(true);
  });
});

describe("skills", () => {
  it("cost Skill Points, cannot be bought twice, and Auto-buy V to VIII needs Auto-buy I to IV", () => {
    let s = freshSecretState(0);
    s.skillPoints = 3;
    expect(canBuySkill(s, "autoBuyHigh")).toBe(false);
    s = buySkill(s, "autoBuyLow", 1);
    expect(s.skillPoints).toBe(2);
    expect(canBuySkill(s, "autoBuyLow")).toBe(false);
    expect(canBuySkill(s, "autoBuyHigh")).toBe(true);
    s = buySkill(s, "autoBuyHigh", 1);
    expect(s.skillPoints).toBe(0);
    expect(buySkill(s, "overdrive", 1)).toBe(s);
  });

  it("Head Start begins resets with 1e10 Ore", () => {
    const s = withRun(120);
    s.skills.headStart = true;
    expect(doCaptain(s, 0).ore.eq(1e10)).toBe(true);
  });

  it("Ten Bonus ×2.2 raises the per-ten factor", () => {
    const s = freshSecretState(0);
    s.bought[0] = 30;
    expect(tenMultiplier(s, 0).eq(8)).toBe(true);
    s.skills.tenBonus = true;
    expect(tenMultiplier(s, 0).sub(Math.pow(TEN_BONUS_SKILL, 3)).abs().lt(1e-9)).toBe(true);
  });

  it("Overdrive raises Ore income to the power 1.05", () => {
    const s = freshSecretState(0);
    s.ore = new Decimal(0);
    s.owned[0] = new Decimal(1e6);
    const a = cloneSecret(s);
    produceMut(a, 1);
    const b = cloneSecret(s);
    b.skills.overdrive = true;
    produceMut(b, 1);
    expect(b.lastIncome.log10()).toBeCloseTo(a.lastIncome.log10() * OVERDRIVE_POWER, 9);
  });
});

describe("autos", () => {
  it("auto Captain fires only when the gain reaches the target percent, and never when switched off", () => {
    const s = withRun(120);
    s.skills.autoCaptain = true;
    s.captainPoints = new Decimal(1000); // gain 372 is 37% of 1000
    s.autoTarget.captain = 50;
    expect(step(s, 1, 0).captainCount).toBe(0);
    const low = setAutoTarget(s, "captain", 25);
    expect(step(low, 1, 0).captainCount).toBe(1);
    const off = setAuto(low, "autoCaptain", false);
    expect(step(off, 1, 0).captainCount).toBe(0);
  });

  it("auto Fleet and auto Prestigeception follow their own targets", () => {
    const s = withRun(20000);
    s.skills.autoFleet = true;
    s.augmentPoints = new Decimal(1e12);
    expect(step(s, 1, 0).fleetTotal).toBe(0);
    s.augmentPoints = new Decimal(1);
    expect(step(s, 1, 0).fleetTotal).toBe(1);
    const p = withRun(20000);
    p.skills.autoPc = true;
    expect(step(p, 1, 0).pcCount).toBe(1);
  });

  it("autos get a freshly reset stack going on their own (Auto Overclock never starves the generators)", () => {
    let s = freshSecretState(0);
    for (const d of SKILLS) if (d.id !== "headStart") s.skills[d.id] = true;
    for (let i = 0; i < 900; i++) s = step(s, 1, i * 1000);
    expect(s.bestOre.log10()).toBeGreaterThan(20);
    expect(s.overclock + s.captainCount).toBeGreaterThan(0);
  });

  it("auto-buyers buy Overclock and generators each step", () => {
    const s = withRun(50);
    s.lastIncome = pow10(45);
    s.skills.autoOverclock = true;
    s.skills.autoBuyLow = true;
    const t = step(s, 1, 0);
    expect(t.overclock).toBeGreaterThan(40);
    expect(t.bought[3]).toBeGreaterThan(0);
  });
});

describe("milestones", () => {
  it("record the date once and never move it", () => {
    const s = freshSecretState(0);
    s.bestOre = pow10(100);
    checkMilestonesMut(s, 111);
    expect(s.milestones.googol).toBe(111);
    s.bestOre = pow10(1000);
    checkMilestonesMut(s, 222);
    expect(s.milestones.googol).toBe(111);
    expect(s.milestones.e1000).toBe(222);
  });

  it("cover the required goals and flag the named achievements (0.13.11.1 adds e10,000,000)", () => {
    const ids = MILESTONES.map((m) => m.id);
    for (const id of ["firstCaptain", "googol", "firstFleet", "firstPc", "singularity", "finale", "long", "starfall"]) expect(ids).toContain(id);
    expect(MILESTONES.length).toBeGreaterThanOrEqual(10);
    expect(MILESTONES.length).toBeLessThanOrEqual(12);
    expect(MILESTONES.filter((m) => m.achievement).map((m) => m.id).sort()).toEqual(["finale", "long", "starfall"]);
  });

  it("a Singularity Engine, the finale, the long goal and every skill each record", () => {
    const s = freshSecretState(0);
    s.tiersUnlocked = 8;
    s.owned[7] = new Decimal(1);
    s.bestOre = pow10(1e9);
    for (const d of SKILLS) s.skills[d.id] = true;
    checkMilestonesMut(s, 7);
    expect(s.milestones.singularity).toBe(7);
    expect(s.milestones.finale).toBe(7);
    expect(s.milestones.long).toBe(7);
    expect(s.milestones.allSkills).toBe(7);
  });
});
