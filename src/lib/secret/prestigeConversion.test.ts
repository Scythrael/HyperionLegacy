// prestigeConversion.test.ts: 0.14.0 prestige redesign Slice 6 (plan docs/plans/2026-10-27-minigame-prestige-
// redesign-plan.md; design section 6). A 0.13.11.2 save is converted once on load: Skill Points recomputed from
// its lifetime Fleets on the new schedule, Head Start / Ten Bonus / Overdrive as the levels that give today's
// effect (their cost spent), automations owned kept with their switches and the others granted by the milestones
// already recorded, Auto Prestigeception bought as a skill hidden until the save's own first Prestigeception and
// then on (user 2026-10-29 "Back ON for buyers"). New games start marked; the Captain Points marker is untouched.
import { describe, it, expect, afterEach } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshSecretState,
  newSecretGame,
  cloneSecret,
  serializeSecret,
  deserializeSecret,
  inspectSecretSave,
  SECRET_SAVE_KEY,
  SECRET_SAVE_VERSION,
  SECRET_CP_SCALE_KEY,
  type SecretState,
} from "./state";
import { convertPrestigeV1, scheduledSkillPoints } from "./prestigeConversion";
import {
  skillLevel,
  skillStrength,
  totalSkillCost,
  skillCostToMax,
  skillPointsRemaining,
  nextSkillPointPay,
  allSkillsMaxed,
  automationUnlocked,
  automationRevealed,
  autoActive,
  hasSkill,
  tenBonusFactor,
  overdrivePower,
  captainGain,
  doFleet,
  doPrestigeception,
  buySkillLevel,
  skillOffers,
  checkMilestonesMut,
  pow10,
} from "./engine";
import { LEVELED_SKILLS, SKILL_POINT_SCHEDULE, AUTOMATION_IDS, TEN_BONUS_SKILL, OVERDRIVE_POWER, HEAD_START_LOG10, FLEET_AT, CP_POW, CP_POW_BEFORE_CURVE_ROUND, type AutomationId } from "./config";
import { installMemoryStorage, restoreStorage } from "./testStorage";

const T0 = 1_761_800_000_000;

// A mid-game save exactly as 0.13.11.2 writes it (its keys in its order, nothing from 0.14.0), the
// state.test.ts Slice 1 shape: every old skill owned, two spare points, 47 lifetime Fleets, six Prestigeceptions.
const BASE_0_13_11_2: Record<string, unknown> = {
  v: 0,
  ore: "4.2e+5123",
  bought: [412, 380, 351, 330, 290, 251, 200, 41],
  owned: ["3e+5100", "2e+5050", "1e+4990", "7e+4900", "5e+4800", "2e+4700", "9e+4500", "41"],
  overclock: 23456,
  lastIncome: "1.5e+5121",
  runPeak: "4.2e+5123",
  fleetPeak: "4.2e+5123",
  pcPeak: "4.2e+5123",
  bestOre: "1e+801234",
  runSeconds: 5400.5,
  captainPoints: "3.3e+44",
  augmentPoints: "81000000000000000000",
  dreamPoints: "120345",
  captainCount: 191,
  fleetCount: 13,
  fleetTotal: 47,
  pcCount: 6,
  tiersUnlocked: 8,
  skillPoints: 2,
  skills: { autoOverclock: true, autoBuyLow: true, autoCaptain: true, autoFleet: true, autoPc: true, headStart: true, tenBonus: true, autoBuyHigh: true, overdrive: true },
  autoOn: { autoCaptain: false, autoPc: true },
  autoTarget: { captain: 100, fleet: 200, pc: 100 },
  milestones: { firstCaptain: 1761156000000, googol: 1761167700000, firstFleet: 1761168240000, e1000: 1761175386000, firstPc: 1761242400000, finale: 1761578000000 },
  finaleSeen: true,
  longSeen: false,
  lastTickAt: T0,
  upgrades: { ocOverclocker: 0, tenfoldTuner: 0, captainsCompound: 0, lucidDreaming: 0, turboEncabulator: 0, overdriveOverdrive: 0, singularitySharpener: 0 },
  found: true,
  foundAt: 1761155000000,
  peakOwned: ["3e+5100", "2e+5050", "1e+4990", "7e+4900", "5e+4800", "2e+4700", "9e+4500", "41"],
  peakOverclock: 23456,
  upgradesNoteSeen: false,
  captainScale: 2,
};

function oldSave(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...BASE_0_13_11_2, ...over });
}

// An early 0.13.11.2 save: a few Fleets, no Prestigeception yet, the Ore down at e20,000 in one climb.
function earlySave(over: Record<string, unknown> = {}): string {
  const ore = "1e+20000";
  return oldSave({
    ore, runPeak: ore, fleetPeak: ore, pcPeak: ore, bestOre: ore,
    owned: ["1e+19990", "1e+19900", "1e+19800", "1e+19700", "0", "0", "0", "0"],
    peakOwned: ["1e+19990", "1e+19900", "1e+19800", "1e+19700", "0", "0", "0", "0"],
    captainPoints: "0", augmentPoints: "0", dreamPoints: "0",
    fleetCount: 3, fleetTotal: 3, pcCount: 0, tiersUnlocked: 4, skillPoints: 0,
    skills: {}, autoOn: {},
    milestones: { firstCaptain: 1761156000000, googol: 1761167700000, firstFleet: 1761168240000, e1000: 1761175386000 },
    finaleSeen: false,
    ...over,
  });
}

const load = (raw: string): SecretState => deserializeSecret(raw, T0)!;
const spentOn = (s: SecretState) => totalSkillCost() - skillCostToMax(s);
const replaced = LEVELED_SKILLS.filter((d) => d.replaces !== undefined);

// One Fleet Prestige taken well above the bar (Augment Points emptied first so the bar stays low).
function fleetOnce(s: SecretState): SecretState {
  const x = cloneSecret(s);
  x.ore = pow10(FLEET_AT * 3);
  x.runPeak = x.ore;
  x.fleetPeak = x.ore;
  x.augmentPoints = new Decimal(0);
  const t = doFleet(x, x.lastTickAt);
  expect(t.fleetTotal).toBe(s.fleetTotal + 1);
  return t;
}

// Spends every point it can, cheapest first (gates opened by hand: the gates are Slice 4's subject).
function spendAll(s: SecretState): SecretState {
  let t = cloneSecret(s);
  for (const id of ["firstFleet", "secondFleet", "e1000", "e10k", "firstPc", "pcRegular"] as const) t.milestones[id] ??= T0;
  t.pcCount = Math.max(t.pcCount, 10);
  t.fleetCount = Math.max(t.fleetCount, 10);
  for (;;) {
    const offer = skillOffers(t).filter((o) => o.cost <= t.skillPoints).sort((a, b) => a.cost - b.cost)[0];
    if (offer === undefined) return t;
    t = buySkillLevel(t, offer.id, T0);
  }
}

afterEach(() => restoreStorage());

describe("1. the marker: one conversion, on load, for unmarked saves only", () => {
  it("a 0.13.11.2 save is converted on load and saves with the marker", () => {
    const s = load(oldSave());
    expect(s.prestigeV).toBe(1);
    expect(JSON.parse(serializeSecret(s)).prestigeV).toBe(1);
  });

  it("convertPrestigeV1 is pure, and a marked state comes back untouched (the same object)", () => {
    const before = load(oldSave({ prestigeV: 1 }));
    expect(before.prestigeV).toBe(1);
    expect(convertPrestigeV1(before)).toBe(before);
    const unmarked = cloneSecret(before);
    delete unmarked.prestigeV;
    const snapshot = serializeSecret(unmarked);
    const after = convertPrestigeV1(unmarked);
    expect(serializeSecret(unmarked)).toBe(snapshot);
    expect(after).not.toBe(unmarked);
    expect(convertPrestigeV1(after)).toBe(after);
  });

  it("a second load changes nothing (8: byte-identical from the first save on)", () => {
    for (const raw of [oldSave(), earlySave(), earlySave({ skills: { tenBonus: true, overdrive: true } })]) {
      const once = serializeSecret(load(raw));
      const twice = serializeSecret(load(once));
      expect(twice).toBe(once);
      expect(serializeSecret(load(twice))).toBe(once);
    }
  });

  it("a save with a marker this build does not know is treated as unmarked (only prestigeV: 1 marks)", () => {
    expect(load(oldSave({ prestigeV: 2 })).prestigeV).toBe(1);
    expect(load(oldSave({ prestigeV: 2 })).skillPointsEarned).toBe(load(oldSave()).skillPointsEarned);
  });

  it("new games start marked (nothing to convert); freshSecretState stays the unmarked base", () => {
    expect(newSecretGame(T0).prestigeV).toBe(1);
    expect(freshSecretState(T0).prestigeV).toBeUndefined();
    const raw = serializeSecret(newSecretGame(T0));
    expect(JSON.parse(raw).prestigeV).toBe(1);
    expect(serializeSecret(load(raw))).toBe(raw);
    // the load paths that start a new game: no save, an unreadable save
    installMemoryStorage();
    expect(inspectSecretSave(T0).state.prestigeV).toBe(1);
    localStorage.setItem(SECRET_SAVE_KEY, "{not json");
    expect(inspectSecretSave(T0).state.prestigeV).toBe(1);
  });

  it("an engine-made 0.14.0 state that lost its marker converts to itself (no double pay either way)", () => {
    let s = freshSecretState(T0);
    for (let i = 0; i < 9; i++) s = spendAll(fleetOnce(s));
    s = fleetOnce(s); // some points held
    checkMilestonesMut(s, T0);
    const c = convertPrestigeV1(s);
    expect(c.skillPoints).toBe(s.skillPoints);
    expect(c.skillPointsEarned).toBe(s.skillPointsEarned);
    expect(c.skillLevels).toEqual(s.skillLevels);
    expect(c.automations).toEqual(s.automations);
    expect(c.autoOn).toEqual(s.autoOn);
  });

  it("no save version bump: the secret save is still version 0", () => {
    expect(SECRET_SAVE_VERSION).toBe(0);
    expect(JSON.parse(serializeSecret(load(oldSave()))).v).toBe(0);
  });
});

describe("2. Skill Points recomputed from lifetime Fleets on the new schedule", () => {
  it("scheduledSkillPoints is the front-loaded schedule's running total, stopping at the cost of maxing every skill", () => {
    let sum = 0;
    for (let n = 0; n <= 80; n++) {
      expect(scheduledSkillPoints(n), `${n} Fleets`).toBe(Math.min(totalSkillCost(), sum));
      sum += SKILL_POINT_SCHEDULE[Math.min(n, SKILL_POINT_SCHEDULE.length - 1)];
    }
    expect(scheduledSkillPoints(4)).toBe(3 + 3 + 2 + 2);
    expect(scheduledSkillPoints(1e9)).toBe(totalSkillCost());
  });

  it("a save with no stat skill gets exactly its history's points; its 0.13.11.2 points are replaced, not added", () => {
    for (const fleets of [0, 1, 2, 3, 4, 5, 6, 20, 39, 47, 300]) {
      const s = load(earlySave({ fleetTotal: fleets, fleetCount: Math.min(fleets, 3), skillPoints: 5 }));
      expect(s.skillPointsEarned, `${fleets} Fleets`).toBe(scheduledSkillPoints(fleets));
      expect(s.skillPoints, `${fleets} Fleets`).toBe(scheduledSkillPoints(fleets));
      expect(skillPointsRemaining(s)).toBe(totalSkillCost() - scheduledSkillPoints(fleets));
    }
  });

  it("the levels from owned skills count as spent: held = recomputed total minus their cost", () => {
    const s = load(oldSave({ fleetTotal: 20 }));
    const spent = replaced.reduce((n, d) => n + Array.from({ length: d.replaces!.level }, (_, i) => d.costBase + d.costStep * i).reduce((a, b) => a + b, 0), 0);
    expect(spentOn(s)).toBe(spent);
    expect(s.skillPointsEarned).toBe(scheduledSkillPoints(20));
    expect(s.skillPoints).toBe(scheduledSkillPoints(20) - spent);
    // the fixed skillPointsRemaining: what later Fleets still pay, exactly the schedule's rest
    expect(skillPointsRemaining(s)).toBe(totalSkillCost() - scheduledSkillPoints(20));
    expect(skillPointsRemaining(s)).toBe(skillCostToMax(s) - s.skillPoints);
  });

  it("later Fleets pay the schedule on from the save's lifetime count, and earning stops exactly at max", () => {
    let s = load(oldSave({ fleetTotal: 20 }));
    expect(nextSkillPointPay(s)).toBe(SKILL_POINT_SCHEDULE[SKILL_POINT_SCHEDULE.length - 1]);
    for (let i = 0; i < 200 && !allSkillsMaxed(s); i++) {
      s = spendAll(fleetOnce(s));
      // the earned count follows the schedule from the save's own lifetime Fleets, never paid twice
      expect(s.skillPointsEarned).toBe(scheduledSkillPoints(s.fleetTotal));
      expect(s.skillPoints).toBeLessThanOrEqual(skillCostToMax(s));
    }
    expect(allSkillsMaxed(s)).toBe(true);
    expect(s.skillPoints).toBe(0);
    expect(s.skillPointsEarned).toBe(totalSkillCost());
    expect(skillPointsRemaining(s)).toBe(0);
  });
});

describe("3. automations: owned ones kept with their switches, the rest granted by recorded milestones", () => {
  it("every automation owned as a skill stays owned and switched exactly as it was", () => {
    const raw = oldSave();
    const s = load(raw);
    const old = JSON.parse(raw) as { skills: Record<string, true>; autoOn: Record<string, boolean> };
    for (const id of AUTOMATION_IDS) {
      if (old.skills[id] !== true) continue;
      expect(s.automations[id], id).toBe(true);
      expect(s.skills[id as keyof typeof s.skills], id).toBe(true); // the 0.13.11.2 record stays (a rollback keeps it)
      expect(s.autoOn[id], id).toBe(old.autoOn[id]);
    }
    expect(autoActive(s, "autoCaptain")).toBe(false); // switched off before, still off
    expect(autoActive(s, "autoFleet")).toBe(true);
  });

  it("an owned automation whose milestone was never reached stays usable (Review Focus 3)", () => {
    const s = load(earlySave({ skills: { autoFleet: true, autoBuyHigh: true }, autoOn: { autoBuyHigh: false } }));
    expect(s.milestones.e10k).toBeUndefined();
    expect(s.milestones.singularity).toBeUndefined();
    expect(automationUnlocked(s, "autoFleet")).toBe(true);
    expect(autoActive(s, "autoFleet")).toBe(true);
    expect(automationUnlocked(s, "autoBuyHigh")).toBe(true);
    expect(autoActive(s, "autoBuyHigh")).toBe(false);
    expect(s.autoOn.autoBuyHigh).toBe(false);
  });

  it("a save that never bought them gets each automation whose milestone is recorded, and no other", () => {
    const s = load(earlySave());
    const expected: AutomationId[] = ["autoOverclock", "autoBuyLow", "autoPc"]; // firstFleet, e1000, googol
    for (const id of AUTOMATION_IDS) expect(s.automations[id] === true, id).toBe(expected.includes(id));
    expect(autoActive(s, "autoOverclock")).toBe(true);
    expect(autoActive(s, "autoBuyLow")).toBe(true);
    // the two automations that were never skills, from milestones a 0.13.11.2 save may have recorded
    const late = load(oldSave({ skills: {}, autoOn: {}, milestones: { ...(BASE_0_13_11_2.milestones as object), pcRegular: T0 - 1, e2m: T0 } }));
    expect(late.automations.autoSkills).toBe(true);
    expect(late.automations.autoUpgrades).toBe(true);
  });
});

describe("4. Head Start, Ten Bonus and Overdrive become levels: nobody loses strength on load", () => {
  it("each owned one is the level that gives today's effect", () => {
    const s = load(oldSave());
    for (const d of replaced) expect(s.skillLevels[d.id], d.id).toBe(d.replaces!.level);
    expect(hasSkill(s, "headStart") && hasSkill(s, "tenBonus") && hasSkill(s, "overdrive")).toBe(true);
    // today's effects at a count of 0 (the scale factor only grows from there)
    const zero = load(earlySave({ skills: { headStart: true, tenBonus: true, overdrive: true }, fleetTotal: 0, fleetCount: 0 }));
    const atZero = cloneSecret(zero);
    atZero.captainSinceFleet = 0;
    atZero.pcCount = 0;
    expect(skillStrength(atZero, "headStart")).toBe(HEAD_START_LOG10);
    expect(tenBonusFactor(atZero)).toBeCloseTo(TEN_BONUS_SKILL, 12);
    expect(overdrivePower(atZero)).toBeCloseTo(OVERDRIVE_POWER, 12);
  });

  it("every readout equals what the engine gave the 0.13.11.2 skills before the conversion", () => {
    for (const raw of [oldSave(), earlySave({ skills: { headStart: true, tenBonus: true, overdrive: true } })]) {
      const s = load(raw);
      const before = cloneSecret(s);
      before.skillLevels = {}; // the engine reads the owned 0.13.11.2 skills as their levels
      for (const d of replaced) expect(skillLevel(s, d.id), d.id).toBe(skillLevel(before, d.id));
      expect(tenBonusFactor(s)).toBe(tenBonusFactor(before));
      expect(overdrivePower(s)).toBe(overdrivePower(before));
      expect(skillStrength(s, "headStart")).toBe(skillStrength(before, "headStart"));
      expect(captainGain(s).toString()).toBe(captainGain(before).toString());
    }
  });

  it("a save that hit the 0.13.11.2 'all learned' cutoff earns again under the deeper caps", () => {
    const s = load(oldSave({ fleetTotal: 20, skillPoints: 0, milestones: { ...(BASE_0_13_11_2.milestones as object), allSkills: T0 - 5 } }));
    expect(allSkillsMaxed(s)).toBe(false);
    expect(nextSkillPointPay(s)).toBeGreaterThan(0);
    expect(fleetOnce(s).skillPoints).toBeGreaterThan(s.skillPoints);
    expect(s.milestones.allSkills).toBe(T0 - 5); // a recorded milestone is never taken back
  });

  it("[PROPOSAL] levels costing more than the history pays are all kept, with 0 points held and nothing owed", () => {
    // 3 Fleets pay 8 on the new schedule; Ten Bonus and Overdrive as levels 4 cost 10 each
    const s = load(earlySave({ skills: { tenBonus: true, overdrive: true }, skillPoints: 4 }));
    expect(scheduledSkillPoints(3)).toBe(8);
    expect(spentOn(s)).toBe(20);
    expect(skillLevel(s, "tenfoldTraining")).toBe(4);
    expect(skillLevel(s, "overdrive")).toBe(4);
    expect(s.skillPoints).toBe(0);
    // the earned count stands at the levels' cost, so later Fleets pay only what the rest needs
    expect(s.skillPointsEarned).toBe(20);
    expect(skillPointsRemaining(s)).toBe(totalSkillCost() - 20);
    let x = s;
    for (let i = 0; i < 200 && !allSkillsMaxed(x); i++) x = spendAll(fleetOnce(x));
    expect(allSkillsMaxed(x)).toBe(true);
    expect(x.skillPoints).toBe(0);
    expect(x.skillPointsEarned).toBe(totalSkillCost());
  });
});

describe("5. Auto Prestigeception (user 2026-10-29 'Back ON for buyers')", () => {
  // One climb past the first Prestigeception's bar (e10,000), as the early save stands.
  const firstPc = (s: SecretState): SecretState => {
    const t = doPrestigeception(s, T0 + 1000);
    expect(t.pcCount).toBe(1);
    return t;
  };

  it("bought as a skill: hidden until the save's own first Prestigeception, then revealed ON", () => {
    const s = load(earlySave({ skills: { autoPc: true } }));
    expect(automationUnlocked(s, "autoPc")).toBe(true);
    expect(s.automations.autoPc).toBe(true);
    expect(s.autoOn.autoPc).toBeUndefined();
    expect(automationRevealed(s, "autoPc")).toBe(false);
    expect(autoActive(s, "autoPc")).toBe(false);
    const after = firstPc(load(serializeSecret(s)));
    expect(automationRevealed(after, "autoPc")).toBe(true);
    expect(autoActive(after, "autoPc")).toBe(true);
  });

  it("not bought: granted OFF at its milestone and hidden, then revealed still OFF", () => {
    const s = load(earlySave());
    expect(s.automations.autoPc).toBe(true);
    expect(s.autoOn.autoPc).toBe(false);
    expect(autoActive(s, "autoPc")).toBe(false);
    const after = firstPc(s);
    expect(automationRevealed(after, "autoPc")).toBe(true);
    expect(autoActive(after, "autoPc")).toBe(false);
  });

  it("bought by a save past its first Prestigeception: shown and on at once, as it was", () => {
    const s = load(oldSave());
    expect(automationRevealed(s, "autoPc")).toBe(true);
    expect(autoActive(s, "autoPc")).toBe(true);
  });
});

describe("6. the 0.13.11.1 Captain Points conversion is never touched", () => {
  it("a save on the 0.4875 scale keeps captainScale 2 and every Captain Point", () => {
    const s = load(oldSave());
    expect(s.captainScale).toBe(2);
    expect(s.captainPoints.toString()).toBe(new Decimal("3.3e+44").toString());
    expect(JSON.parse(serializeSecret(s)).captainScale).toBe(2);
  });

  it("a 0.13.11 save converts its Captain Points exactly once, then the prestige conversion leaves them alone", () => {
    const old = JSON.parse(oldSave()) as Record<string, unknown>;
    delete old.captainScale;
    const s = load(JSON.stringify(old));
    const expected = new Decimal("3.3e+44").add(1).pow(CP_POW_BEFORE_CURVE_ROUND / CP_POW).sub(1);
    expect(s.captainPoints.toString()).toBe(expected.toString());
    expect(s.captainScale).toBe(2);
    const again = load(serializeSecret(s));
    expect(again.captainPoints.toString()).toBe(expected.toString());
    // a device that converted before never converts again, prestige conversion or not
    const device = deserializeSecret(JSON.stringify(old), T0, { cpConverted: true })!;
    expect(device.captainPoints.toString()).toBe(new Decimal("3.3e+44").toString());
    expect(device.prestigeV).toBe(1);
  });

  it("loading through the runtime path keeps the device's Captain Points marker", () => {
    const data = installMemoryStorage();
    data.set(SECRET_SAVE_KEY, oldSave());
    data.set(SECRET_CP_SCALE_KEY, "2");
    const { state, status } = inspectSecretSave(T0);
    expect(status).toBe("ok");
    expect(state.prestigeV).toBe(1);
    expect(state.captainScale).toBe(2);
    expect(data.get(SECRET_CP_SCALE_KEY)).toBe("2");
  });
});

describe("7. the old save's other fields are untouched", () => {
  it("every 0.13.11.2 key keeps its place and value except the recomputed skillPoints; the redesign fields follow", () => {
    const raw = oldSave();
    const out = JSON.parse(serializeSecret(load(raw))) as Record<string, unknown>;
    const old = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(out).slice(0, Object.keys(old).length)).toEqual(Object.keys(old));
    for (const k of Object.keys(old)) if (k !== "skillPoints") expect(out[k], k).toEqual(old[k]);
    expect(Object.keys(out).slice(Object.keys(old).length)).toEqual(["skillPointsEarned", "skillLevels", "automations", "prestigeV"]);
  });
});
