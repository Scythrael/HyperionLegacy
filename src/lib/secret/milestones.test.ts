import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshSecretState, type SecretState } from "./state";
import {
  captainGain,
  fleetGain,
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
  captainMultiplier,
  stepMut,
  gamePace,
  displayIncome,
  allSkillsLearned,
} from "./engine";
import { cloneSecret } from "./state";
import { readFileSync } from "node:fs";
import {
  CP_SCALE,
  AP_SCALE,
  DP_SCALE,
  FLEET_AT,
  FINALE_EXPONENT,
  CP_K,
  CP_K_AFTER_FINALE,
  CAPTAIN_BEND,
  CP_POW,
  GAME_PACE_AFTER_FIRST_PC,
  AP_K,
  DP_K,
  MILESTONES,
  COPY,
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
    }
    expect(seen).toEqual([5, 6, 7, 7, 7, 8]);
  });
});

describe("0.13.11.1: gains bend before the finale; Captain and Fleet return to the 0.13.11 formula after it", () => {
  it("below the finale (exponent / threshold)^k; with the best Ore at the finale, Captain and Fleet are linear as in 0.13.11", () => {
    const s = withRun(120);
    expect(gainExponent(s, CP_K)).toBe(CP_K);
    expect(captainGain(s).eq(Math.floor(CP_SCALE * Math.pow(2, CP_K)))).toBe(true);
    s.bestOre = pow10(FINALE_EXPONENT);
    expect(gainExponent(s, CP_K)).toBe(1);
    // Captain: the 0.13.11 k = 1 bent by the curve round's CAPTAIN_BEND
    expect(captainGain(s).eq(Math.floor(CP_SCALE * Math.pow(2, CP_K_AFTER_FINALE)))).toBe(true);
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
    // (Captain gains take the Dream Point boost bent by CAPTAIN_BEND: the curve round)
    expect(captainGain(s).eq(m.pow(CAPTAIN_BEND).mul(CP_SCALE * Math.pow((FLEET_AT * 2) / 60, CP_K)).floor())).toBe(true);
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
    s.captainPoints = new Decimal(10); // the gain (4) is 40% of 10
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
    expect(MILESTONES.length).toBeLessThanOrEqual(16); // 0.13.11.1 content pacing adds four
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

describe("0.13.11.1: one climb pays one layer (staging: Fleet then Prestigeception from the same climb)", () => {
  it("a Fleet Prestige uses up the climb: Prestigeception needs a fresh one", () => {
    const s = withRun(20000); // one climb past both e308 and e10,000
    expect(fleetGain(s).gt(0)).toBe(true);
    expect(prestigeceptionGain(s).gt(0)).toBe(true);
    const t = doFleet(s, 1);
    expect(t.fleetTotal).toBe(1);
    expect(prestigeceptionGain(t).eq(0)).toBe(true);
    expect(doPrestigeception(t, 2).pcCount).toBe(0);
    // a fresh climb past e10,000 pays it again
    const climbed = cloneSecret(t);
    climbed.ore = pow10(12000);
    stepMut(climbed, 1, 3);
    expect(prestigeceptionGain(climbed).gt(0)).toBe(true);
  });

  it("with both automatic prestiges due, the higher layer goes first and the Fleet does not follow from the same climb", () => {
    const s = withRun(20000);
    s.skills.autoFleet = true;
    s.skills.autoPc = true;
    const t = step(s, 1, 0);
    expect(t.pcCount).toBe(1);
    expect(t.fleetTotal).toBe(0);
    expect(fleetGain(t).eq(0)).toBe(true);
  });

  it("Captain then Fleet from one climb gains nothing extra: the Fleet resets Captain Points", () => {
    const s = withRun(FLEET_AT * 2);
    const afterBoth = doFleet(doCaptain(s, 1), 2);
    const fleetOnly = doFleet(s, 2);
    expect(afterBoth.captainPoints.eq(0)).toBe(true);
    expect(afterBoth.augmentPoints.eq(fleetOnly.augmentPoints)).toBe(true);
    expect(afterBoth.skillPoints).toBe(fleetOnly.skillPoints);
  });
});

describe("0.13.11.1 curve round: the Captain bonus and the game clock (user picked Q3 + PC 0.5)", () => {
  it("doubling Captain Points gives x1.40 (it was x1.145)", () => {
    const s = freshSecretState(0);
    s.captainPoints = new Decimal(1e6);
    const a = captainMultiplier(s);
    s.captainPoints = new Decimal(2e6);
    const ratio = captainMultiplier(s).div(a).toNumber();
    expect(ratio).toBeCloseTo(Math.pow(2, CP_POW), 3);
    expect(ratio).toBeGreaterThan(1.39);
  });

  it("the game clock runs at 1 / 1.15 after the first Prestigeception, live and offline alike (one stepMut)", () => {
    const before = withRun(100);
    expect(gamePace(before)).toBe(1);
    const after = withRun(100);
    after.pcCount = 1;
    after.milestones.firstPc = 1;
    expect(gamePace(after)).toBe(GAME_PACE_AFTER_FIRST_PC);
    const a = cloneSecret(before);
    const b = cloneSecret(after);
    stepMut(a, 1, 1000);
    stepMut(b, 1, 1000);
    expect(a.runSeconds).toBeCloseTo(1, 9);
    expect(b.runSeconds).toBeCloseTo(1 / 1.15, 9);
    // Ore per second on screen is per real second
    expect(displayIncome(b).div(b.lastIncome).toNumber()).toBeCloseTo(1 / 1.15, 9);
  });
});

describe("0.13.11.1: no Skill Points once every skill is learned (user: they shouldn't be awarded afterward)", () => {
  it("a Fleet with every skill owned pays Augment Points but no Skill Point; spare points are kept", () => {
    const s = withRun(FLEET_AT * 2);
    for (const d of SKILLS) s.skills[d.id] = true;
    s.skillPoints = 3; // spare, earned before
    const t = doFleet(s, 1);
    expect(t.fleetTotal).toBe(1);
    expect(t.augmentPoints.gt(0)).toBe(true);
    expect(t.skillPoints).toBe(3);
    expect(allSkillsLearned(t)).toBe(true);
  });

  it("with any skill still to learn, a Fleet still pays one", () => {
    const s = withRun(FLEET_AT * 2);
    for (const d of SKILLS.slice(1)) s.skills[d.id] = true;
    expect(allSkillsLearned(s)).toBe(false);
    expect(doFleet(s, 1).skillPoints).toBe(s.skillPoints + 1);
  });

  it("the Prestige tab says so on the Fleet card and its payout line", () => {
    const ov = readFileSync("src/lib/SecretGameOverlay.svelte", "utf-8");
    expect(ov).toContain("allSkillsLearned(s) ? COPY.allSkillsLearned");
    expect(ov).toContain('points{allSkillsLearned(s) ? "" : " and a Skill Point"}');
    expect(COPY.allSkillsLearned).toBe("All skills learned: no more Skill Points");
  });
});
