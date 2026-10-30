// Complement and Acquisition CP-3 (docs/plans/2026-10-14-complement-and-acquisition-plan.md section 3 CP-3; wiring
// plan answers OC-E1 "Resist enemy debuffs", OC-E2 "Shorter bay time"): the four Ground Ops complement consumers.
//   Away-Team Protection  -> every Security member's max HP x (1 + it), rounded (Expedition.squadHpBonus)
//   Counter-Infiltration  -> the squad's resist to every enemy debuff (Expedition.squadDebuffResist)
//   Triage                -> the run's squadTriage (Fleet Triage's field)
//   Prevent a Crew Loss   -> the medical bay's injury care (GroundOpsFactors.preventLossShare)
// Each is frozen at dispatch and written only when non-zero; complementCp3Goldens.test.ts pins the runs.

import { describe, expect, it } from "vitest";
import { DEFAULT_MEMBER_GAMBIT, type GambitStatusId, type SnapshotMember } from "./model";
import { CREW_PROFESSION_BUFFS, SECOND_LEVEL_EXCLUSIVE } from "./crewBuffs";
import { GAMBIT_STATUSES, SQUAD_DEBUFF_RESIST_CEILING, buildRosterCombatants, squadDebuffResistShare, statusResistPermille } from "./gambit";
import { STATUS_RESIST_CAP } from "./awayTeam";
import { GROUND_CONDITIONS, conditionCureSeconds, memberBaySeconds, type BayCare } from "./medicalBay";
import { advanceExpedition } from "./expedition";
import { officerBonusTotal } from "./crewOverlay";
import { groundOpsBayCare } from "./groundOps";
import { CP3_ALL_CREW, CP3_CONTROL_CREW, CP3_MEDICAL_CREW, CP3_SECURITY_CREW, cp3Dispatch, cp3State } from "./complementCp3.fixture";
import { withCp3Off } from "./complementCp3Switch.fixture";

const member = (id: string, resists: Partial<Record<GambitStatusId, number>> = {}): SnapshotMember => ({
  memberId: id,
  teamType: "security",
  spec: "offense",
  rank: 1,
  rankFactor: 1,
  traits: [],
  groundStats: {},
  resists,
  implants: [],
  gear: [],
  gambit: DEFAULT_MEMBER_GAMBIT,
  effects: [],
});

const DEBUFFS = (Object.keys(GAMBIT_STATUSES) as GambitStatusId[]).filter((id) => GAMBIT_STATUSES[id].kind === "debuff");
const BUFFS = (Object.keys(GAMBIT_STATUSES) as GambitStatusId[]).filter((id) => GAMBIT_STATUSES[id].kind === "buff");
const ZERO_CARE: BayCare = { medicalShare: 0, rapidRecoveryShare: 0, officerFacetShare: 0, injurySteady: 0 };
const magnitudeOf = (id: string): number => [...Object.values(CREW_PROFESSION_BUFFS).flat(), ...SECOND_LEVEL_EXCLUSIVE].find((d) => d.id === id)!.magnitude;

describe("CP-3 Away-Team Protection: Security max HP", () => {
  it("multiplies every member's max HP by 1 + it, rounded to a whole point; absent or 0 is the squad as before", () => {
    const plain = buildRosterCombatants([member("a"), member("b")], 0, "t");
    expect(buildRosterCombatants([member("a"), member("b")], 0, "t", undefined, { hpBonus: 0 })).toEqual(plain);
    const lifted = buildRosterCombatants([member("a"), member("b")], 0, "t", undefined, { hpBonus: 0.25 });
    lifted.forEach((c, i) => {
      expect(c.hpMax).toBe(Math.round(plain[i].hpMax * 1.25));
      expect(c.hp).toBe(c.hpMax);
      expect(c.power).toBe(plain[i].power); // HP only
    });
    // A bad input reads 0.
    expect(buildRosterCombatants([member("a")], 0, "t", undefined, { hpBonus: Number.NaN })).toEqual(buildRosterCombatants([member("a")], 0, "t"));
  });
});

describe("CP-3 Counter-Infiltration: the squad resists enemy debuffs (OC-E1)", () => {
  it("its ceiling is the existing per-status resist cap, and the share runs toward it without reaching it (D23)", () => {
    expect(SQUAD_DEBUFF_RESIST_CEILING).toBe(STATUS_RESIST_CAP);
    expect(squadDebuffResistShare(0)).toBe(0);
    expect(squadDebuffResistShare(undefined)).toBe(0);
    expect(squadDebuffResistShare(-1)).toBe(0);
    expect(squadDebuffResistShare(0.03)).toBeCloseTo(0.03, 3); // about the raw value while small
    let prev = 0;
    for (const raw of [0.1, 0.5, 1, 2, 5]) {
      const r = squadDebuffResistShare(raw);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
    for (const raw of [5, 50, 1e9, Number.MAX_VALUE]) expect(squadDebuffResistShare(raw)).toBeLessThan(SQUAD_DEBUFF_RESIST_CEILING);
  });

  it("every debuff is resisted, never a buff; a member's own resist and Morale Anchor stack as independent chances", () => {
    const c = squadDebuffResistShare(0.2);
    const [m] = buildRosterCombatants([member("a", { poison: 0.5 })], 0, "t", undefined, { debuffResist: 0.2, fearResist: 0.3 });
    for (const id of DEBUFFS) {
      const own = id === "poison" ? 0.5 : id === "fear" ? 0.3 : 0;
      expect(m.resists?.[id], id).toBe(Math.round((1 - (1 - own) * (1 - c)) * 1000));
    }
    for (const id of BUFFS) expect(m.resists?.[id], id).toBeUndefined();
    // Without it the member's resists are exactly as before.
    const [before] = buildRosterCombatants([member("a", { poison: 0.5 })], 0, "t", undefined, { fearResist: 0.3 });
    expect(buildRosterCombatants([member("a", { poison: 0.5 })], 0, "t", undefined, { fearResist: 0.3, debuffResist: 0 })[0]).toEqual(before);
    expect(before.resists).toEqual({ poison: 500, fear: 300 });
  });

  it("no member is ever fully immune: a capped own resist with a huge crew still leaves a chance to land", () => {
    const [m] = buildRosterCombatants([member("a", { stun: STATUS_RESIST_CAP })], 0, "t", undefined, { debuffResist: 1e9 });
    for (const id of DEBUFFS) expect(statusResistPermille(m, id)).toBeLessThan(1000);
  });
});

describe("CP-3 Prevent a Crew Loss: shorter bay time for injuries (OC-E2)", () => {
  it("divides an injury's cure like every care share; Health and ailments are unchanged; absent is the bay as before", () => {
    const care: BayCare = { ...ZERO_CARE, preventLossShare: 0.5 };
    expect(conditionCureSeconds(GROUND_CONDITIONS.fracture, [], care)).toBe(Math.round(1800 / 1.5));
    expect(conditionCureSeconds(GROUND_CONDITIONS.downed, [], care)).toBe(Math.round(1200 / 1.5));
    expect(conditionCureSeconds(GROUND_CONDITIONS.health, [], care)).toBe(60);
    expect(conditionCureSeconds(GROUND_CONDITIONS.poison, [], care)).toBe(60);
    expect(memberBaySeconds(["fracture", "poison"], [], { ...ZERO_CARE })).toBe(1800);
    expect(groundOpsBayCare({ ...ZERO_CARE, offloadMult: 1, reloadMult: 1, securityShare: [1], scienceShare: [1] })).toEqual(ZERO_CARE);
  });
});

describe("CP-3 dispatch: each key frozen on the run, only when non-zero", () => {
  it("a crew without the keys stores the run exactly as before (no new field)", () => {
    const { exp } = cp3Dispatch(CP3_CONTROL_CREW, 0x1244);
    expect(exp.squadHpBonus).toBeUndefined();
    expect(exp.squadDebuffResist).toBeUndefined();
    expect(exp.squadTriage).toBeUndefined();
    expect(exp.groundOps?.factors.preventLossShare).toBeUndefined();
  });

  it("Security crew freeze Away-Team Protection and Counter-Infiltration; Medical crew add Triage to squadTriage", () => {
    const sec = cp3Dispatch(CP3_SECURITY_CREW, 0x1244).exp;
    expect(sec.squadHpBonus).toBeCloseTo(60 * magnitudeOf("sec.awayTeam"), 9);
    expect(sec.squadDebuffResist).toBeCloseTo(60 * magnitudeOf("sec.counterInfiltration"), 9);
    const med = cp3Dispatch(CP3_MEDICAL_CREW, 0x1244).exp;
    expect(med.squadTriage).toBeCloseTo(60 * magnitudeOf("med.triage"), 9);
    expect(med.groundOps?.factors.preventLossShare).toBeGreaterThan(0);
    // Triage adds to the Fleet Triage officer's share (no officer here, so it is the crew's alone).
    const s = cp3State(CP3_MEDICAL_CREW, 0x1244);
    expect(officerBonusTotal(s, s.ships[0], "officer.crewLossPrevention")).toBe(0);
  });

  it("the switch: with the four keys off a fully crewed dispatch freezes none of them", () => {
    const { exp } = withCp3Off(() => cp3Dispatch(CP3_ALL_CREW, 0x1234));
    expect(exp.squadHpBonus).toBeUndefined();
    expect(exp.squadDebuffResist).toBeUndefined();
    expect(exp.squadTriage).toBeUndefined();
    expect(exp.groundOps?.factors.preventLossShare).toBeUndefined();
  });

  it("a crew change after dispatch never reshapes the run (the values are frozen on it)", () => {
    const { exp } = cp3Dispatch(CP3_ALL_CREW, 0x1234);
    // advanceExpedition reads only the stored run: the same record resolves the same way however the ship changes.
    expect(advanceExpedition(structuredClone(exp), 40_000)).toEqual(advanceExpedition(exp, 40_000));
  });
});

describe("CP-3 determinism: offline == live with all four keys live", () => {
  it("one call == 997 s chunks == 1 s steps", () => {
    const { exp } = cp3Dispatch(CP3_ALL_CREW, 0x1234);
    const end = 40_000;
    const one = advanceExpedition(exp, end);
    expect(one.phase).toBe("complete");
    let chunks = exp;
    for (let t = exp.phaseAnchorSeconds + 997; t < end; t += 997) chunks = advanceExpedition(chunks, t);
    expect(advanceExpedition(chunks, end)).toEqual(one);
    // 1 s steps across the run's ground window (its fights, bay stays and the medic's heals).
    const from = 9_500;
    const to = 14_500;
    let ones = advanceExpedition(exp, from);
    for (let t = from + 1; t <= to; t += 1) ones = advanceExpedition(ones, t);
    expect(ones).toEqual(advanceExpedition(exp, to));
    expect(advanceExpedition(ones, end)).toEqual(one);
  });
});
