// leveledSkills.test.ts: 0.14.0 prestige redesign Slice 4 (plan docs/plans/2026-10-27-minigame-prestige-
// redesign-plan.md, with the plan update of 2026-10-28; design 3.3 and 3.4). Skill Points buy leveled
// skills by hand; each skill opens at its gate (a milestone or a prestige count) and, from
// SKILL_GATE_LIFT_PC Prestigeceptions on, every skill opened before is open from the start of each climb;
// a skill's strength scales off a prestige count (exactly 1 at 0, concave, growing); Fleet Prestige pays
// a front-loaded schedule whose lifetime total is the cost of maxing everything, and earning stops
// exactly there (Review Focus 4, a save that hit the 0.13.11.2 cutoff included).
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshSecretState, cloneSecret, serializeSecret, deserializeSecret, type SecretState } from "./state";
import {
  skillLevel,
  skillLevelCost,
  buySkillLevel,
  canBuySkillLevel,
  skillScaleFactor,
  skillStrength,
  skillAvailable,
  skillGateOpen,
  totalSkillCost,
  skillCostToMax,
  skillPointsRemaining,
  nextSkillPointPay,
  skillPointScheduleEntry,
  allSkillsMaxed,
  skillOffers,
  pickSkillOffer,
  doFleet,
  doCaptain,
  doPrestigeception,
  checkMilestonesMut,
  captainGain,
  fleetGain,
  prestigeceptionGain,
  fleetBarExponent,
  pcBarExponent,
  tenBonusFactor,
  overdrivePower,
  hasSkill,
  pow10,
} from "./engine";
import {
  LEVELED_SKILLS,
  SKILL_POINT_SCHEDULE,
  SKILL_GATE_LIFT_PC,
  HEAD_START_LOG10,
  TEN_BONUS_SKILL,
  OVERDRIVE_POWER,
  FLEET_AT,
  type LeveledSkillId,
} from "./config";

const T0 = 1_000_000;

// Every peak at raw exponent e, so each layer can fire from it.
function atPeak(s: SecretState, e: number): SecretState {
  s.ore = pow10(e);
  s.runPeak = s.ore;
  s.fleetPeak = s.ore;
  s.pcPeak = s.ore;
  s.bestOre = Decimal.max(s.bestOre, s.ore);
  return s;
}

// One Fleet Prestige taken well above the bar (Augment Points emptied first so the bar stays low).
function fleetOnce(s: SecretState): SecretState {
  const x = atPeak(cloneSecret(s), FLEET_AT * 3);
  x.augmentPoints = new Decimal(0);
  const t = doFleet(x, x.lastTickAt);
  expect(t.fleetTotal).toBe(s.fleetTotal + 1);
  return t;
}

// Every gate open (all milestones recorded and the prestige counts reached), the way a late game has it.
function allOpen(s: SecretState): SecretState {
  for (const id of ["firstFleet", "secondFleet", "e1000", "e10k", "firstPc", "pcRegular"] as const) s.milestones[id] = T0;
  s.pcCount = Math.max(s.pcCount, 10);
  s.fleetCount = Math.max(s.fleetCount, 10);
  s.captainSinceFleet = Math.max(s.captainSinceFleet, 10);
  return s;
}

const spendAll = (s: SecretState): SecretState => {
  for (let o = pickSkillOffer(skillOffers(s)); o !== null; o = pickSkillOffer(skillOffers(s))) s = buySkillLevel(s, o.id, T0);
  return s;
};

describe("the Skill Point schedule", () => {
  it("is front-loaded and its lifetime total is exactly the cost of maxing every skill", () => {
    let manual = 0;
    for (const d of LEVELED_SKILLS) for (let n = 0; n < d.cap; n++) manual += d.costBase + d.costStep * n;
    expect(totalSkillCost()).toBe(manual);
    expect(skillPointScheduleEntry(0)).toBe(SKILL_POINT_SCHEDULE[0]);
    expect(skillPointScheduleEntry(1000)).toBe(SKILL_POINT_SCHEDULE.at(-1));
    // a player who never spends: the Fleets pay exactly the total, then nothing
    let s = freshSecretState(T0);
    let fleets = 0;
    while (nextSkillPointPay(s) > 0) {
      s = fleetOnce(s);
      fleets += 1;
      expect(fleets).toBeLessThan(500);
    }
    expect(s.skillPoints).toBe(totalSkillCost());
    expect(s.skillPointsEarned).toBe(totalSkillCost());
    expect(skillPointsRemaining(s)).toBe(0);
    expect(fleetOnce(s).skillPoints).toBe(totalSkillCost());
    // the first Fleets pay the front-loaded entries
    let t = freshSecretState(T0);
    for (let i = 0; i < SKILL_POINT_SCHEDULE.length; i++) {
      const before = t.skillPoints;
      t = fleetOnce(t);
      expect(t.skillPoints - before, `Fleet ${i + 1}`).toBe(SKILL_POINT_SCHEDULE[i]);
    }
  });

  it("Review Focus 4: earning stops exactly when every skill is maxed, never a stranded point", () => {
    let s = allOpen(freshSecretState(T0));
    for (let i = 0; i < 500 && !allSkillsMaxed(s); i++) {
      s = spendAll(fleetOnce(s));
      // never more points in hand than the levels left can use
      expect(s.skillPoints).toBeLessThanOrEqual(skillCostToMax(s));
    }
    expect(allSkillsMaxed(s)).toBe(true);
    expect(s.skillPoints).toBe(0);
    expect(s.skillPointsEarned).toBe(totalSkillCost());
    expect(nextSkillPointPay(s)).toBe(0);
    const after = fleetOnce(s);
    expect(after.skillPoints).toBe(0);
    expect(after.skillPointsEarned).toBe(totalSkillCost());
    expect(after.milestones.allSkills).toBeDefined();
  });

  it("Review Focus 4: a 0.13.11.2 save that hit the 'all learned' cutoff earns again, and stops exactly at max", () => {
    // the 0.13.11.2 shape: every old skill owned, two spare points, 40 lifetime Fleets, no 0.14.0 fields
    let s = allOpen(freshSecretState(T0));
    for (const id of ["autoOverclock", "autoBuyLow", "autoCaptain", "autoFleet", "autoPc", "headStart", "tenBonus", "autoBuyHigh", "overdrive"] as const) s.skills[id] = true;
    s.skillPoints = 2;
    s.fleetTotal = 40;
    s = deserializeSecret(serializeSecret(s), T0)!;
    // the old skills keep today's effect as levels (nobody loses strength on load)
    for (const d of LEVELED_SKILLS) if (d.replaces) expect(skillLevel(s, d.id), d.id).toBe(d.replaces.level);
    expect(hasSkill(s, "headStart") && hasSkill(s, "tenBonus") && hasSkill(s, "overdrive")).toBe(true);
    expect(allSkillsMaxed(s)).toBe(false);
    expect(nextSkillPointPay(s)).toBeGreaterThan(0);
    const t = fleetOnce(s);
    expect(t.skillPoints).toBeGreaterThan(2);
    let x = t;
    for (let i = 0; i < 500 && !allSkillsMaxed(x); i++) {
      x = spendAll(x);
      if (!allSkillsMaxed(x)) x = fleetOnce(x);
      expect(x.skillPoints).toBeLessThanOrEqual(skillCostToMax(x));
    }
    x = spendAll(x);
    expect(allSkillsMaxed(x)).toBe(true);
    expect(x.skillPoints).toBe(0);
    expect(fleetOnce(x).skillPoints).toBe(0);
  });
});

describe("buying levels by hand", () => {
  it("one level at a time at the rising cost, up to the cap shown as X / Y", () => {
    for (const d of LEVELED_SKILLS) {
      let s = allOpen(freshSecretState(T0));
      s.skillPoints = 10000;
      for (let n = 0; n < d.cap; n++) {
        expect(skillLevelCost(s, d.id)).toBe(d.costBase + d.costStep * n);
        const t = buySkillLevel(s, d.id, T0);
        expect(skillLevel(t, d.id), d.id).toBe(n + 1);
        expect(s.skillPoints - t.skillPoints).toBe(d.costBase + d.costStep * n);
        s = t;
      }
      expect(skillLevelCost(s, d.id)).toBeNull();
      expect(canBuySkillLevel(s, d.id)).toBe(false);
      expect(buySkillLevel(s, d.id, T0)).toBe(s);
    }
  });

  it("not without the points", () => {
    const s = allOpen(freshSecretState(T0));
    s.skillPoints = 0;
    for (const d of LEVELED_SKILLS) expect(buySkillLevel(s, d.id, T0)).toBe(s);
  });

  it("levels round-trip through the save, with the gates each skill has opened", () => {
    let s = allOpen(freshSecretState(T0));
    checkMilestonesMut(s, T0);
    s.skillPoints = 50;
    s = buySkillLevel(buySkillLevel(s, "captainsAcademy", T0), "headStart", T0);
    const back = deserializeSecret(serializeSecret(s), T0)!;
    expect(back.skillLevels).toEqual(s.skillLevels);
    expect(back.skillsOpened).toEqual(s.skillsOpened);
    expect(Object.keys(back.skillsOpened).sort()).toEqual(LEVELED_SKILLS.map((d) => d.id).sort());
  });
});

describe("the gates (user 2026-10-28) and the gate lift", () => {
  const gateOf = (id: LeveledSkillId) => LEVELED_SKILLS.find((d) => d.id === id)!.availableAt;

  it("every skill is closed in a fresh game and opens at its milestone or prestige count", () => {
    const s = freshSecretState(T0);
    s.skillPoints = 99;
    for (const d of LEVELED_SKILLS) {
      expect(skillAvailable(s, d.id), d.id).toBe(false);
      expect(buySkillLevel(s, d.id, T0)).toBe(s);
      const x = cloneSecret(s);
      const gate = d.availableAt;
      if ("milestone" in gate) (x.milestones as Record<string, number>)[gate.milestone] = T0;
      else {
        const { layer, count, scope } = gate.prestiges;
        if (layer === "captain") scope === "current" ? (x.captainSinceFleet = count) : (x.captainCount = count);
        else if (layer === "fleet") scope === "current" ? (x.fleetCount = count) : (x.fleetTotal = count);
        else x.pcCount = count;
        const short = cloneSecret(x);
        if (layer === "captain") scope === "current" ? (short.captainSinceFleet -= 1) : (short.captainCount -= 1);
        else if (layer === "fleet") scope === "current" ? (short.fleetCount -= 1) : (short.fleetTotal -= 1);
        else short.pcCount -= 1;
        expect(skillAvailable(short, d.id), `${d.id} one short`).toBe(false);
      }
      expect(skillAvailable(x, d.id), d.id).toBe(true);
      expect(skillLevel(buySkillLevel(x, d.id, T0), d.id)).toBe(1);
    }
  });

  it("a gate on a current count closes again after the reset that clears it; levels already bought stay", () => {
    const current = LEVELED_SKILLS.find((d) => "prestiges" in d.availableAt && d.availableAt.prestiges.scope === "current" && d.availableAt.prestiges.layer === "fleet")!;
    const gate = gateOf(current.id) as { prestiges: { count: number } };
    let s = atPeak(freshSecretState(T0), 20000);
    s.fleetCount = gate.prestiges.count;
    s.fleetTotal = gate.prestiges.count;
    s.skillPoints = 20;
    checkMilestonesMut(s, T0);
    expect(s.skillsOpened[current.id]).toBe(true);
    s = buySkillLevel(s, current.id, T0);
    expect(skillLevel(s, current.id)).toBe(1);
    const after = doPrestigeception(s, T0);
    expect(after.pcCount).toBe(1);
    expect(skillGateOpen(after, current.id)).toBe(false);
    expect(skillAvailable(after, current.id)).toBe(false);
    expect(skillLevel(after, current.id)).toBe(1);
    // from SKILL_GATE_LIFT_PC Prestigeceptions on, a skill opened before is open from the start of each climb
    const lifted = cloneSecret(after);
    lifted.pcCount = SKILL_GATE_LIFT_PC;
    expect(skillGateOpen(lifted, current.id)).toBe(false);
    expect(skillAvailable(lifted, current.id)).toBe(true);
    // but never one that has not opened yet
    const never = cloneSecret(lifted);
    never.skillsOpened = {};
    expect(skillAvailable(never, current.id)).toBe(false);
    const before = cloneSecret(after);
    before.pcCount = SKILL_GATE_LIFT_PC - 1;
    expect(skillAvailable(before, current.id)).toBe(false);
  });
});

describe("the scale factor (design 3.3)", () => {
  it("is exactly 1 at a count of 0, grows with the named count, concave", () => {
    for (const d of LEVELED_SKILLS) {
      const s = freshSecretState(T0);
      expect(skillScaleFactor(s, d.id), d.id).toBe(1);
      const at = (n: number) => {
        const x = freshSecretState(T0);
        if (d.scalesOff === "lifetimeFleets") x.fleetTotal = n;
        else if (d.scalesOff === "captainSinceFleet") x.captainSinceFleet = n;
        else if (d.scalesOff === "lifetimePcs") x.pcCount = n;
        else x.fleetCount = n;
        return skillScaleFactor(x, d.id);
      };
      let last = 1;
      let lastStep = Infinity;
      for (let n = 1; n <= 200; n++) {
        const f = at(n);
        expect(f, `${d.id} at ${n}`).toBeGreaterThan(last);
        expect(f - last, `${d.id} concave at ${n}`).toBeLessThan(lastStep);
        lastStep = f - last;
        last = f;
      }
      // the other counts do not move it
      const other = freshSecretState(T0);
      other.captainCount = 50;
      expect(skillScaleFactor(other, d.id)).toBe(1);
    }
  });

  it("multiplies the level's effect, so a converted save never loses strength after a reset", () => {
    const s = freshSecretState(T0);
    s.skillLevels.headStart = 1;
    const base = skillStrength(s, "headStart");
    s.fleetTotal = 6;
    expect(skillStrength(s, "headStart")).toBeCloseTo(base * skillScaleFactor(s, "headStart"), 12);
    expect(skillStrength(s, "headStart")).toBeGreaterThan(base);
  });
});

describe("the reworked skills reach today's effect at their named level", () => {
  const def = (id: LeveledSkillId) => LEVELED_SKILLS.find((d) => d.id === id)!;

  it("Head Start: resets begin with 1e10 Ore at its level, more with lifetime Fleets", () => {
    const s = atPeak(freshSecretState(T0), 120);
    s.skillLevels.headStart = def("headStart").replaces!.level;
    expect(doCaptain(s, T0).ore.eq(pow10(HEAD_START_LOG10))).toBe(true);
    s.fleetTotal = 6;
    expect(doCaptain(s, T0).ore.gt(pow10(HEAD_START_LOG10))).toBe(true);
    // and a 0.13.11.2 Head Start owner keeps exactly 1e10 in a fresh climb
    const old = atPeak(freshSecretState(T0), 120);
    old.skills.headStart = true;
    expect(doCaptain(old, T0).ore.eq(pow10(HEAD_START_LOG10))).toBe(true);
  });

  it("Tenfold Training: today's ×2.2 ten bonus at its level, stronger with Captain Prestiges this Fleet", () => {
    const s = freshSecretState(T0);
    s.skillLevels.tenfoldTraining = def("tenfoldTraining").replaces!.level;
    expect(tenBonusFactor(s)).toBeCloseTo(TEN_BONUS_SKILL, 12);
    s.captainSinceFleet = 4;
    expect(tenBonusFactor(s)).toBeGreaterThan(TEN_BONUS_SKILL);
  });

  it("Overdrive: today's ^1.05 at its level, higher with lifetime Prestigeceptions", () => {
    const s = freshSecretState(T0);
    s.skillLevels.overdrive = def("overdrive").replaces!.level;
    expect(overdrivePower(s)).toBeCloseTo(OVERDRIVE_POWER, 12);
    s.pcCount = 3;
    expect(overdrivePower(s)).toBeGreaterThan(OVERDRIVE_POWER);
  });
});

describe("the three new skills measurably move their gains", () => {
  it("Captain's Academy: more Captain Points per Captain Prestige", () => {
    const s = atPeak(freshSecretState(T0), 400);
    s.dreamPoints = new Decimal(1e12); // a big payout, so the floor never hides the level
    const t = cloneSecret(s);
    t.skillLevels.captainsAcademy = 1;
    expect(captainGain(t).gt(captainGain(s))).toBe(true);
    const capped = cloneSecret(s);
    capped.skillLevels.captainsAcademy = LEVELED_SKILLS.find((d) => d.id === "captainsAcademy")!.cap;
    expect(captainGain(capped).gt(captainGain(t))).toBe(true);
  });

  it("Fleet Requisitions: more Augment Points per Fleet Prestige, and the Fleet bar sits on the bigger payout", () => {
    const s = atPeak(freshSecretState(T0), 50000);
    s.augmentPoints = new Decimal(300);
    expect(fleetGain(s).gt(0)).toBe(true);
    const t = cloneSecret(s);
    t.skillLevels.fleetLogistics = 2;
    expect(fleetGain(t).gt(fleetGain(s))).toBe(true);
    expect(fleetBarExponent(t)).toBeLessThan(fleetBarExponent(s));
  });

  it("Lucid Planning: more Dream Points per Prestigeception, and the Prestigeception bar sits on the bigger payout", () => {
    const s = atPeak(freshSecretState(T0), 300000);
    s.dreamPoints = new Decimal(20000);
    expect(prestigeceptionGain(s).gt(0)).toBe(true);
    const t = cloneSecret(s);
    t.skillLevels.lucidPlanning = 2;
    expect(prestigeceptionGain(t).gt(prestigeceptionGain(s))).toBe(true);
    expect(pcBarExponent(t)).toBeLessThan(pcBarExponent(s));
  });
});
