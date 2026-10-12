// E-CREW 0.14.0 (Task 21): OFFICER STAT FACETS (design D13, section 7; mockup 7b).
//
// NEUTRALITY first: a fully seated bridge whose officers all carry the neutral 10/10/10/10 line resolves
// byte-identically to the code BEFORE Task 21 (golden hashes captured before the change).

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  effectiveMissionDef,
  missionCycleTiming,
  missionPhaseTicks,
  MISSIONS,
  PATROLS,
  requiredTicksForPhase,
  SHIP_TYPES,
  type Expedition,
  type MissionDef,
  type AwayMember,
  type AwayTeamType,
  type CrewBucket,
  type GameState,
  type MissionKey,
  type OfficerStats,
  type PatrolMissionState,
  type SeniorStaffOfficer,
  type SeniorStaffSeat,
  type ShipTypeKey,
} from "./model";
import {
  dispatchCaptainOnMission,
  dispatchCaptainOnPatrol,
  economyTick,
  installMissingCombatBaselines,
  patrolReturnCutTicks,
  shipRangeLightYears,
  shipReachesRoundTrip,
  shipTripRangeLightYears,
  processShipRepairs,
  shipRepairDurationTicks,
  tickCaptainMission,
  tickCaptainPatrol,
} from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { combatHullTypeOf, shipToCombatant } from "./combat/bridge";
import { fireWeapon, resolveBattle } from "./combat/resolveBattle";
import { makeRng } from "./combat/rng";
import {
  SHAKEDOWN_TRANSIT_SECONDS,
  advanceExpedition,
  claimExpedition,
  expeditionCandidates,
  rampedEncounterEvasion,
  returnDurationSeconds,
  scanRatePerSecond,
  startExpedition,
  TRANSIT_SECONDS,
} from "./expedition";
import {
  effectiveShipStats,
  officerCombatMods,
  officerCombatModsFromProfile,
  officerCombatProfile,
  officerRepairSpeedBonus,
  shipCrewContribution,
} from "./crewOverlay";
import { getSeniorStaffBonusById } from "./seniorStaffBonuses";
import { CREW_STAT_KEYS } from "./crewBuffs";
import { LY_PER_TICK } from "./fuel";
import { equippedFor } from "./equipment";
import { itemTotal } from "./inventory";
// Ground Ops GO-1: whole-state goldens hash without the new, inert ground-team slots (captured before them).
import { asLegacyDispatch, withSlottedAwayTeams, withoutGroundTeams } from "./awayTeamTestFixtures";
import { activityRelicFindBonus, generateEncounter, softenAmbush } from "./gambit";
import { applyExpeditionInjuries, injuryRecoverySeconds } from "./injuries";
import {
  CONSTITUTION_RAMP_KNEE_HOURS,
  CUNNING_AMBUSH_SOFTEN,
  CUNNING_FREE_REPAIR_TICKS,
  CUNNING_PENDING_SEATS,
  CUNNING_QUICK_RECOVERY,
  CUNNING_SALT,
  DEPARTMENT_OF_SEAT,
  OFFICER_DEPARTMENTS,
  captainCycleMissionSeed,
  constitutionRamp,
  cunningProc,
  cunningRollSeed,
  departmentFacet,
  officerStatFacet,
  officerStatTooltip,
  seatFacet,
  seatOfDepartment,
} from "./officerStats";

// Ground Ops (GO-7b): this file pins LEGACY expedition runs (goldens captured before Ground Ops): every dispatch
// slots the members in hire order (dispatch reads the slotted ground teams) and resolves without the groundOps
// flag (asLegacyDispatch), exactly the record the pre-switch dispatch produced.
const legacyStart: typeof startExpedition = (state, ...rest) => asLegacyDispatch(startExpedition(withSlottedAwayTeams(state), ...rest));

// ===== fixtures =====

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const NEUTRAL: OfficerStats = { strength: 10, integrity: 10, cunning: 10, constitution: 10 };

// The two bonuses each seat carries in the full-bridge fixture (every live consumer is exercised).
const SEAT_BONUSES: Record<SeniorStaffSeat, [string, string]> = {
  executive: ["xo.commandOutput", "any.inspiringLeader"],
  pilot: ["pilot.evasion", "pilot.transitCut"],
  operations: ["ops.cargoExpand", "ops.unloadSurge"],
  science: ["sci.discovery", "sci.yieldSurge"],
  tactical: ["tac.weaponCommand", "tac.shieldCommand"],
  medical: ["med.recovery", "med.fleetTriage"],
  engineering: ["eng.rangeMaster", "any.veteranInstincts"],
};
const SEATS = Object.keys(SEAT_BONUSES) as SeniorStaffSeat[];

// One officer per seat, seated on ship-1, carrying the seat's two bonuses at catalog magnitude and the
// given stat line (`undefined` = an officer without stats, which reads as neutral).
function bridge(statsFor: (seat: SeniorStaffSeat) => OfficerStats | undefined, shipId = "ship-1"): SeniorStaffOfficer[] {
  return SEATS.map((seat, i) => {
    const stats = statsFor(seat);
    return {
      id: `officer-${i + 1}`,
      seat,
      name: `Officer ${seat}`,
      race: "earthBorn",
      gender: "nonbinary",
      rank: "ensign",
      bonuses: SEAT_BONUSES[seat].map((id) => ({ id, magnitude: getSeniorStaffBonusById(id)!.magnitude })) as [
        { id: string; magnitude: number },
        { id: string; magnitude: number },
      ],
      missionsCompleted: 0,
      assignedShipId: shipId,
      ...(stats ? { stats: { ...stats } } : {}),
    };
  });
}

// A complement with one bucket per profession, each carrying a buff with a live consumer where one exists.
const COMPLEMENT: CrewBucket[] = [
  { profession: "operations", rarity: "stellar", rank: 4, race: "belter", buff1Id: "ops.effectiveCargo", buff2Id: "ops.unloadSpeed", count: 20 },
  { profession: "flightDeck", rarity: "augmented", rank: 3, race: "spacer", buff1Id: "flight.transitOut", buff2Id: null, count: 15 },
  { profession: "engineering", rarity: "stellar", rank: 4, race: "martian", buff1Id: "eng.range", buff2Id: "eng.hullRepair", count: 18 },
  { profession: "science", rarity: "radiant", rank: 5, race: "vael", buff1Id: "sci.extraction", buff2Id: "sci.rareFind", count: 12 },
  { profession: "medical", rarity: "augmented", rank: 3, race: "earthBorn", buff1Id: "med.reducedLosses", buff2Id: null, count: 10 },
  { profession: "security", rarity: "stellar", rank: 4, race: "ossir", buff1Id: "sec.awayTeam", buff2Id: null, count: 14 },
];

function withCrew(s: GameState, officers: SeniorStaffOfficer[], shipId = "ship-1"): GameState {
  return {
    ...s,
    officers,
    ships: s.ships.map((sh) => (sh.id === shipId ? { ...sh, complement: { mode: "active", buckets: COMPLEMENT.map((b) => ({ ...b })) } } : sh)),
  } as GameState;
}

function member(id: string, teamType: AwayTeamType, over: Partial<AwayMember> = {}): AwayMember {
  return {
    id,
    teamType,
    spec: teamType === "science" ? "geology" : "offense",
    name: `Member ${id}`,
    race: "earthBorn",
    gender: "female",
    rank: 1,
    traits: [],
    assignedShipId: "ship-1",
    ...over,
  };
}

const ROSTER: AwayMember[] = [
  member("member-1", "security", { spec: "offense", rank: 3, traits: ["quickDraw"] }),
  member("member-2", "security", { spec: "defense", rank: 2, traits: ["bulwark"] }),
  member("member-3", "security", { spec: "debuff", rank: 4, traits: ["fieldMedic"] }),
  member("member-4", "science"),
];

function patrolState(typeKey: ShipTypeKey, officers: SeniorStaffOfficer[]): GameState {
  const base = freshState();
  return installMissingCombatBaselines(
    withCrew(
      {
        ...base,
        fuel: new Decimal(100000),
        credits: new Decimal(100000),
        ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey } : sh)),
      },
      officers,
    ),
  );
}

function missionState(key: MissionKey, officers: SeniorStaffOfficer[]): GameState {
  const s = withCrew(freshState(), officers);
  s.captains[0].mission = {
    kind: "extraction",
    missionKey: key,
    phase: "ordersReceived",
    phaseProgressTicks: 0,
    cargo: { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) },
    recalled: false,
  };
  s.fuel = new Decimal(1_000_000_000);
  s.credits = new Decimal(1_000_000);
  return s;
}

function runTicks(s: GameState, n: number, rng: () => number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, rng);
  return out;
}

// Every golden scenario's hashes for one bridge stat assignment.
function scenarioHashes(statsFor: (seat: SeniorStaffSeat) => OfficerStats | undefined): Record<string, string | string[]> {
  const officers = () => bridge(statsFor);
  const out: Record<string, string | string[]> = {};
  const sheet = withCrew(freshState(), officers());
  out.sheet = fnv(JSON.stringify([effectiveShipStats(sheet, sheet.ships[0]), shipCrewContribution(sheet, sheet.ships[0])]));
  for (const key of ["shortOreRun", "surveyMineralAnomaly", "frontierSupplyRun"] as MissionKey[]) {
    out[`mission:${key}`] = fnv(JSON.stringify(withoutGroundTeams(runTicks(missionState(key, officers()), 700, lcg(0xbeef)))));
  }
  for (const typeKey of ["destroyer", "carrier", "battleship"] as ShipTypeKey[]) {
    const r = dispatchCaptainOnPatrol(patrolState(typeKey, officers()), 1, "crimsonReaverSweep", "balanced", true);
    expect(r.success).toBe(true);
    let s = r.next;
    out[`patrol:${typeKey}:dispatch`] = fnv(JSON.stringify(s.captains[0].mission));
    const replays: string[] = [];
    for (let i = 0; i < 1200; i++) {
      s = economyTick(s, 1, () => 0.5);
      if (i % 150 === 0) replays.push(fnv(JSON.stringify(replayPatrol(s, s.captains[0]))));
    }
    out[`patrol:${typeKey}:state`] = fnv(JSON.stringify(withoutGroundTeams(s)));
    out[`patrol:${typeKey}:replays`] = replays;
  }
  const base = installMissingCombatBaselines(withCrew(freshState(), officers()));
  const damaged = {
    ...base,
    ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey: "destroyer" as ShipTypeKey, damaged: true, repairDamage: 437 } : sh)),
  };
  out.repair = fnv(JSON.stringify(processShipRepairs(installMissingCombatBaselines(damaged)).activeProcesses));
  const s0: GameState = { ...withCrew(freshState(), officers()), awayMembers: ROSTER, nextAwayMemberId: 100 };
  const runs: string[] = [];
  for (let i = 0; i < 8; i++) {
    const s = { ...s0, expeditionSeed: (0x2468ace + i * 7919) >>> 0 };
    const res = legacyStart(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
    expect(res.success).toBe(true);
    const done = advanceExpedition(res.expedition!, 1_000_000);
    const claimed = claimExpedition({ ...res.next, expeditions: [done] }, done.id);
    runs.push(fnv(JSON.stringify(res.expedition)) + "/" + fnv(JSON.stringify(done)) + "/" + fnv(JSON.stringify(claimed.next.awayMembers)));
  }
  out.expedition = runs;
  return out;
}

// ============================================================================
// NEUTRALITY: golden hashes captured from the code BEFORE Task 21 (a full bridge at 10/10/10/10).
// ============================================================================
const GOLDEN_NEUTRAL: Record<string, string | string[]> = {
  sheet: "2f50663a",
  "mission:shortOreRun": "67eb5bdf",
  "mission:surveyMineralAnomaly": "f3533b8b",
  "mission:frontierSupplyRun": "6f6c32b9",
  "patrol:destroyer:dispatch": "bf27b495",
  "patrol:destroyer:state": "d4c4f918",
  "patrol:destroyer:replays": [
    "f8c34706",
    "30e7fd71",
    "afaaa725",
    "8ee3e158",
    "b93939b7",
    "b7d9862e",
    "84fe852e",
    "dbf70c8b",
  ],
  "patrol:carrier:dispatch": "dc08627e",
  "patrol:carrier:state": "930d916c",
  "patrol:carrier:replays": [
    "333fbcb7",
    "f2f1a3d6",
    "4cd60d17",
    "695d2e97",
    "b2ca383",
    "a2de880e",
    "26e59314",
    "ca496084",
  ],
  "patrol:battleship:dispatch": "954429cf",
  "patrol:battleship:state": "df66ca49",
  "patrol:battleship:replays": [
    "9cc40b4b",
    "b21a87f0",
    "672dbc6f",
    "b9a88f8b",
    "97cc7abd",
    "47ac3125",
    "13dbc672",
    "bf178d9b",
  ],
  repair: "9e0af219",
  expedition: [
    "2aeb94e9/4d9b3ae6/a1bc9cbc",
    "9799f10e/78bb63b2/60286a58",
    "6b11a5/738c263f/a1bc9cbc",
    "e62a1e30/6cbae86a/a1bc9cbc",
    "e7b4bd1b/a328ddc5/99a22880",
    "eff9b67b/e95b09e7/a1bc9cbc",
    "69eeabea/e28a5013/a1bc9cbc",
    "35a87b36/f3fb14ee/a1bc9cbc",
  ],
};

// The same bridge with officers that carry NO stats (absent = neutral); the hashes whose JSON includes the
// officer records differ from GOLDEN_NEUTRAL.
const GOLDEN_STATLESS: Record<string, string | string[]> = {
  sheet: "2f50663a",
  "mission:shortOreRun": "8644dc25",
  "mission:surveyMineralAnomaly": "5f39359d",
  "mission:frontierSupplyRun": "6d1fd873",
  "patrol:destroyer:dispatch": "bf27b495",
  "patrol:destroyer:state": "2f7bd9fa",
  "patrol:destroyer:replays": [
    "f8c34706",
    "30e7fd71",
    "afaaa725",
    "8ee3e158",
    "b93939b7",
    "b7d9862e",
    "84fe852e",
    "dbf70c8b",
  ],
  "patrol:carrier:dispatch": "dc08627e",
  "patrol:carrier:state": "3246b5ae",
  "patrol:carrier:replays": [
    "333fbcb7",
    "f2f1a3d6",
    "4cd60d17",
    "695d2e97",
    "b2ca383",
    "a2de880e",
    "26e59314",
    "ca496084",
  ],
  "patrol:battleship:dispatch": "954429cf",
  "patrol:battleship:state": "ce6bdd03",
  "patrol:battleship:replays": [
    "9cc40b4b",
    "b21a87f0",
    "672dbc6f",
    "b9a88f8b",
    "97cc7abd",
    "47ac3125",
    "13dbc672",
    "bf178d9b",
  ],
  repair: "9e0af219",
  expedition: [
    "2aeb94e9/4d9b3ae6/a1bc9cbc",
    "9799f10e/78bb63b2/60286a58",
    "6b11a5/738c263f/a1bc9cbc",
    "e62a1e30/6cbae86a/a1bc9cbc",
    "e7b4bd1b/a328ddc5/99a22880",
    "eff9b67b/e95b09e7/a1bc9cbc",
    "69eeabea/e28a5013/a1bc9cbc",
    "35a87b36/f3fb14ee/a1bc9cbc",
  ],
};

describe("neutrality: an all-10 bridge = byte-identical to before Task 21 (golden)", () => {
  it("a full bridge at 10/10/10/10 (sheet, missions, patrols + replays, repair, expeditions)", { timeout: 120_000 }, () => {
    expect(scenarioHashes(() => NEUTRAL)).toEqual(GOLDEN_NEUTRAL);
  });

  it("the same bridge with stat-less officers (absent = neutral)", { timeout: 120_000 }, () => {
    expect(scenarioHashes(() => undefined)).toEqual(GOLDEN_STATLESS);
  });
});

// ============================================================================
// Shared fixtures for the facet tests
// ============================================================================

// A full bridge at the neutral line, with `over` raising chosen stats on chosen seats.
function bridgeWith(over: Partial<Record<SeniorStaffSeat, Partial<OfficerStats>>>): SeniorStaffOfficer[] {
  return bridge((seat) => ({ ...NEUTRAL, ...(over[seat] ?? {}) }));
}

// Strip the officers (their stat lines differ by construction) so two runs can be compared on OUTCOMES.
function outcomeJson(s: GameState): string {
  return JSON.stringify({ ...s, officers: [] });
}

function officer(seat: SeniorStaffSeat, bonusIds: [string, string], stats: Partial<OfficerStats>, id: string): SeniorStaffOfficer {
  return {
    id,
    seat,
    name: `Officer ${id}`,
    race: "earthBorn",
    gender: "nonbinary",
    rank: "ensign",
    bonuses: bonusIds.map((b) => ({ id: b, magnitude: getSeniorStaffBonusById(b)?.magnitude ?? 0 })) as [
      { id: string; magnitude: number },
      { id: string; magnitude: number },
    ],
    missionsCompleted: 0,
    assignedShipId: "ship-1",
    stats: { ...NEUTRAL, ...stats },
  };
}

// ============================================================================
// The facet value + departments
// ============================================================================
describe("facet value and departments", () => {
  it("1% per point ABOVE 10; 10 or below is exactly 0 (never a penalty)", () => {
    expect(officerStatFacet(10)).toBe(0);
    expect(officerStatFacet(1)).toBe(0);
    expect(officerStatFacet(20)).toBeCloseTo(0.1, 12);
    expect(officerStatFacet(28)).toBeCloseTo(0.18, 12);
  });

  it("DEPARTMENT_OF_SEAT: each seat heads its department, the XO touches all", () => {
    expect(DEPARTMENT_OF_SEAT).toEqual({
      tactical: "security",
      science: "science",
      medical: "medical",
      engineering: "engineering",
      operations: "operations",
      pilot: "flightDeck",
      executive: "all",
    });
    for (const dept of OFFICER_DEPARTMENTS) expect(DEPARTMENT_OF_SEAT[seatOfDepartment(dept)]).toBe(dept);
  });

  it("a department's facet = its head's + 40% of the XO's; the XO's own bonuses get the XO's in full", () => {
    const s = withCrew(freshState(), bridgeWith({ operations: { strength: 20 }, executive: { strength: 15 } }));
    const ship = s.ships[0];
    expect(departmentFacet(s, ship, "operations", "strength")).toBeCloseTo(0.1 + 0.4 * 0.05, 12);
    expect(departmentFacet(s, ship, "science", "strength")).toBeCloseTo(0.4 * 0.05, 12);
    expect(seatFacet(s, ship, "executive", "strength")).toBeCloseTo(0.05, 12);
    expect(seatFacet(s, ship, "operations", "strength")).toBeCloseTo(0.12, 12);
    // An unseated officer counts for nothing.
    const away = { ...s, officers: s.officers.map((o) => (o.seat === "operations" ? { ...o, assignedShipId: null } : o)) };
    expect(departmentFacet(away, ship, "operations", "strength")).toBeCloseTo(0.4 * 0.05, 12);
  });

  it("a bridge whose stats are all at or below 10 resolves exactly like the all-10 bridge", () => {
    const low = bridge((seat) => ({ strength: 3, integrity: 10, cunning: 7, constitution: seat === "pilot" ? 1 : 9 }));
    const neutral = bridge(() => NEUTRAL);
    for (const key of ["shortOreRun", "surveyMineralAnomaly", "frontierSupplyRun"] as MissionKey[]) {
      expect(outcomeJson(runTicks(missionState(key, low), 400, lcg(11)))).toBe(outcomeJson(runTicks(missionState(key, neutral), 400, lcg(11))));
    }
    let a = dispatchCaptainOnPatrol(patrolState("destroyer", low), 1, "crimsonReaverSweep", "balanced", true).next;
    let b = dispatchCaptainOnPatrol(patrolState("destroyer", neutral), 1, "crimsonReaverSweep", "balanced", true).next;
    for (let i = 0; i < 400; i++) {
      a = economyTick(a, 1, () => 0.5);
      b = economyTick(b, 1, () => 0.5);
    }
    expect(outcomeJson(a)).toBe(outcomeJson(b));
    const ea = { ...withCrew(freshState(), low), awayMembers: ROSTER };
    const eb = { ...withCrew(freshState(), neutral), awayMembers: ROSTER };
    const ra = legacyStart(ea, "ship-1", 1, expeditionCandidates(ea, "ship-1")[0].id);
    const rb = legacyStart(eb, "ship-1", 1, expeditionCandidates(eb, "ship-1")[0].id);
    expect(JSON.stringify(advanceExpedition(ra.expedition!, 1_000_000))).toBe(JSON.stringify(advanceExpedition(rb.expedition!, 1_000_000)));
  });
});

// ============================================================================
// STRENGTH: x (1 + facet) on the department's complement buffs
// ============================================================================
describe("Strength scales the department's complement buffs", () => {
  const map = (over: Partial<Record<SeniorStaffSeat, Partial<OfficerStats>>>) => {
    const s = withCrew(freshState(), bridgeWith(over));
    return shipCrewContribution(s, s.ships[0]);
  };
  const complementOnly = () => {
    const s = withCrew(freshState(), []);
    return shipCrewContribution(s, s.ships[0]);
  };

  it("the Operations head's Strength multiplies Operations' buffs and nothing else", () => {
    const base = map({});
    const strong = map({ operations: { strength: 20 } });
    // The Operations bucket carries Stowage Discipline + Efficient Unloading: the complement part scales
    // x1.1, while the officers' own seat bonuses (Cargo Optimization, Logistics Mastery) do not.
    const cargo = CREW_STAT_KEYS.effectiveCargo;
    expect(strong[cargo] - base[cargo]).toBeCloseTo(complementOnly()[cargo] * 0.1, 12);
    expect(strong[CREW_STAT_KEYS.transitOutSpeed]).toBe(base[CREW_STAT_KEYS.transitOutSpeed]);
    expect(strong[CREW_STAT_KEYS.extractionYield]).toBe(base[CREW_STAT_KEYS.extractionYield]);
  });

  it("the XO's Strength lifts every department at 40%", () => {
    const base = map({});
    const xo = map({ executive: { strength: 20 } });
    const crew = complementOnly();
    for (const key of [CREW_STAT_KEYS.effectiveCargo, CREW_STAT_KEYS.transitOutSpeed, CREW_STAT_KEYS.rangeEfficiency, CREW_STAT_KEYS.reducedCrewLosses]) {
      expect(xo[key] - base[key], key).toBeCloseTo(crew[key] * 0.04, 12);
    }
  });

  it("lifts a live consumer (cargo capacity) and is wired for pools that go live later (Task 23 inherits it)", () => {
    const a = withCrew(freshState(), bridgeWith({}));
    const b = withCrew(freshState(), bridgeWith({ operations: { strength: 28 }, tactical: { strength: 28 } }));
    expect(effectiveShipStats(b, b.ships[0]).cargoCapacity).toBeGreaterThan(effectiveShipStats(a, a.ships[0]).cargoCapacity);
    // Away-Team Protection has no consumer yet (a Task 23 division pool), but it already rides the scaled map.
    const key = CREW_STAT_KEYS.awayTeamProtection;
    expect(shipCrewContribution(b, b.ships[0])[key]).toBeCloseTo(shipCrewContribution(a, a.ships[0])[key] * 1.18, 12);
  });

  it("does nothing without a complement (the officers' own bonuses are never scaled)", () => {
    const s = { ...freshState(), officers: bridgeWith({ operations: { strength: 28 } }) };
    const n = { ...freshState(), officers: bridgeWith({}) };
    expect(shipCrewContribution(s, s.ships[0])).toEqual(shipCrewContribution(n, n.ships[0]));
  });
});

// ============================================================================
// INTEGRITY: steady under fire (below half hull in a ship battle)
// ============================================================================
describe("Integrity: the department's battle buffs gain the facet below half hull", () => {
  it("folds per department into OfficerCombatMods.underFire (absent at 10)", () => {
    const tac = (integrity: number) => {
      const s = patrolState("destroyer", [officer("tactical", ["tac.weaponCommand", "tac.shieldCommand"], { integrity }, "o1")]);
      return officerCombatMods(s, s.ships[0])!;
    };
    expect(tac(10).underFire).toBeUndefined();
    const m = tac(20);
    expect(m.weaponDamage).toBeCloseTo(0.1, 12);
    expect(m.underFire!.weaponDamage).toBeCloseTo(1.11 / 1.1 - 1, 12);
    expect(m.underFire!.shield).toBeCloseTo(1.11 / 1.1 - 1, 12);
    expect(m.underFire!.evasion).toBe(0);
    // The Pilot's Evasive Command gains the Flight Deck's facet, in whole evasion points on the combatant.
    const s = patrolState("destroyer", [officer("pilot", ["pilot.evasion", "pilot.transitCut"], { integrity: 28 }, "o2")]);
    const mods = officerCombatMods(s, s.ships[0])!;
    expect(mods.underFire!.evasion).toBeCloseTo(0.1 * 0.18, 12);
    const c = shipToCombatant({ id: "ship-1", team: "player", stats: SHIP_TYPES.destroyer, hullType: combatHullTypeOf("destroyer")!, officerCombat: mods });
    expect(c.evasion).toBe(10);
    expect(c.underFire).toEqual({ weaponDamage: 0, shieldRecharge: 0, evasion: 2 });
  });

  it("an officer's Integrity lifts only the battle bonuses its department carries (none = nothing)", () => {
    const s = patrolState("destroyer", [officer("science", ["sci.discovery", "sci.yieldSurge"], { integrity: 28 }, "o1")]);
    expect(officerCombatMods(s, s.ships[0])).toBeUndefined();
  });

  it("the battle reads it live: more damage below half hull, identical above half", () => {
    const hullType = combatHullTypeOf("destroyer")!;
    const mk = (underFire?: { weaponDamage: number; shieldRecharge: number; evasion: number }) => {
      const c = shipToCombatant({ id: "a", team: "player", stats: SHIP_TYPES.destroyer, hullType });
      if (underFire) c.underFire = underFire;
      return c;
    };
    const target = () => shipToCombatant({ id: "t", team: "enemy", stats: SHIP_TYPES.battleship, hullType: combatHullTypeOf("battleship")! });
    const steady = { weaponDamage: 0.5, shieldRecharge: 0, evasion: 0 };
    let above = 0;
    let aboveSteady = 0;
    let below = 0;
    let belowSteady = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const plain = mk();
      const lifted = mk(steady);
      above += fireWeapon(plain, target(), plain.weapons[0], makeRng(seed)).damage;
      aboveSteady += fireWeapon(lifted, target(), lifted.weapons[0], makeRng(seed)).damage;
      const hurt = mk();
      hurt.hull = Math.floor(hurt.hullMax / 2) - 1;
      const hurtSteady = mk(steady);
      hurtSteady.hull = hurt.hull;
      below += fireWeapon(hurt, target(), hurt.weapons[0], makeRng(seed)).damage;
      belowSteady += fireWeapon(hurtSteady, target(), hurtSteady.weapons[0], makeRng(seed)).damage;
    }
    expect(above).toBeGreaterThan(0);
    expect(aboveSteady).toBe(above);
    expect(belowSteady).toBeGreaterThan(below);
  });

  it("extra evasion below half hull makes the ship harder to hit", () => {
    const hullType = combatHullTypeOf("destroyer")!;
    const shooter = shipToCombatant({ id: "s", team: "enemy", stats: SHIP_TYPES.destroyer, hullType });
    const victim = (evasion: number) => {
      const c = shipToCombatant({ id: "v", team: "player", stats: SHIP_TYPES.destroyer, hullType });
      c.underFire = { weaponDamage: 0, shieldRecharge: 0, evasion };
      c.hull = 1;
      return c;
    };
    expect(fireWeapon(shooter, victim(1000), shooter.weapons[0], makeRng(3)).projectilesHit).toBe(0);
    let hits = 0;
    for (let seed = 1; seed <= 20; seed++) hits += fireWeapon(shooter, victim(0), shooter.weapons[0], makeRng(seed)).projectilesHit;
    expect(hits).toBeGreaterThan(0);
  });

  it("a whole battle changes when the ship fights below half hull (the shield recharge lifts too)", () => {
    const hullType = combatHullTypeOf("destroyer")!;
    const fight = (underFire?: { weaponDamage: number; shieldRecharge: number; evasion: number }) => {
      const p = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, hullType });
      p.hull = Math.floor(p.hullMax * 0.4);
      p.shield = 0;
      if (underFire) p.underFire = underFire;
      const e = shipToCombatant({ id: "e", team: "enemy", stats: SHIP_TYPES.destroyer, hullType });
      return JSON.stringify(resolveBattle({ combatants: [p, e] }, 12345, { generateLog: true }).log);
    };
    expect(fight({ weaponDamage: 0, shieldRecharge: 0, evasion: 0 })).toBe(fight());
    expect(fight({ weaponDamage: 0, shieldRecharge: 1, evasion: 0 })).not.toBe(fight());
    expect(fight({ weaponDamage: 0.3, shieldRecharge: 0, evasion: 0 })).not.toBe(fight());
  });

  it("a patrol freezes it with the cycle: it changes a hard fight, and the live loop and the replay agree", { timeout: 60_000 }, () => {
    const officers = [
      officer("tactical", ["tac.weaponCommand", "tac.shieldCommand"], { integrity: 28 }, "o1"),
      officer("pilot", ["pilot.evasion", "pilot.transitCut"], { integrity: 28 }, "o2"),
    ];
    const fought = (m: PatrolMissionState) => m.wavesWon + m.wavesLost;
    let checked = 0;
    for (let seed = 1; seed <= 60 && checked === 0; seed++) {
      let s = dispatchCaptainOnPatrol({ ...patrolState("destroyer", officers), nextPatrolSeed: seed }, 1, "crimsonReaverWarband", "balanced", false).next;
      const frozen = (s.captains[0].mission as PatrolMissionState).officerCombat!;
      expect(frozen.underFire).toBeDefined();
      const total = (s.captains[0].mission as PatrolMissionState).waveTicks.length;
      for (let i = 0; i < 2000; i++) {
        const m = s.captains[0].mission as PatrolMissionState;
        if (fought(m) >= total || m.phase === "limpingHome") break;
        s = economyTick(s, 1, () => 0.5);
      }
      const live = s.captains[0].mission as PatrolMissionState;
      const replay = replayPatrol(s, s.captains[0]);
      // The same cycle without the Integrity extras: only a fight that dipped below half hull differs.
      const { underFire: _drop, ...plainMods } = frozen;
      const plain = { ...s, captains: [{ ...s.captains[0], mission: { ...live, officerCombat: plainMods } }, ...s.captains.slice(1)] };
      const without = replayPatrol(plain, plain.captains[0]);
      if (JSON.stringify(without.waves.map((w) => w.log)) === JSON.stringify(replay.waves.map((w) => w.log))) continue;
      checked++;
      expect(replay.waves.length).toBe(fought(live));
      expect(replay.defeated).toBe(live.phase === "limpingHome");
      if (!replay.defeated) expect(replay.finalPlayerHull).toBe(live.playerHull);
      expect(replay.waves.some((w) => w.log.some((e) => e.hullAfter !== undefined && e.targetId === "ship-1" && e.hullAfter * 2 < w.playerStart.hullMax))).toBe(true);
    }
    expect(checked).toBe(1);
  });
});

// ============================================================================
// CUNNING: a per-mission over-delivery on a private keyed stream
// ============================================================================
describe("Cunning: per-mission over-delivery", () => {
  it("rolls on its own keyed stream (mission seed ^ CUNNING_SALT ^ seat index)", () => {
    expect(CUNNING_SALT % 2).toBe(1);
    expect(cunningRollSeed(1234, "science")).toBe((1234 ^ CUNNING_SALT ^ 3) >>> 0);
    expect(cunningProc(99, "operations", 0)).toBe(false);
    expect(cunningProc(99, "operations", 1)).toBe(true);
    // Deterministic, and the seats roll independently.
    const hits = (seat: SeniorStaffSeat) => Array.from({ length: 200 }, (_, i) => cunningProc(i, seat, 0.5));
    expect(hits("operations")).toEqual(hits("operations"));
    expect(hits("operations")).not.toEqual(hits("science"));
    expect(captainCycleMissionSeed(1, 0)).not.toBe(captainCycleMissionSeed(1, 1));
  });

  it("Operations: bonus cargo on delivered hauls, in whole units", () => {
    const N = 2500;
    const plain = runTicks(missionState("shortOreRun", bridgeWith({})), N, lcg(7));
    const cunning = runTicks(missionState("shortOreRun", bridgeWith({ operations: { cunning: 28 }, executive: { cunning: 28 } })), N, lcg(7));
    let grew = false;
    for (const key of Object.keys(plain.inventory)) {
      const a = itemTotal(plain.inventory, key);
      const b = itemTotal(cunning.inventory, key);
      expect(b.gte(a), key).toBe(true);
      if (b.gt(a)) grew = true;
    }
    expect(grew).toBe(true);
    expect(cunning.captains[0].cunningCycles).toBeGreaterThan(0);
    expect("cunningCycles" in plain.captains[0]).toBe(false);
  });

  it("Operations: bonus margin on a transport; Science never rolls on a transport", () => {
    const N = 2500;
    const plain = runTicks(missionState("frontierSupplyRun", bridgeWith({})), N, lcg(9));
    const ops = runTicks(missionState("frontierSupplyRun", bridgeWith({ operations: { cunning: 28 } })), N, lcg(9));
    const sci = runTicks(missionState("frontierSupplyRun", bridgeWith({ science: { cunning: 28 } })), N, lcg(9));
    expect(ops.credits.gt(plain.credits)).toBe(true);
    expect(sci.credits.toNumber()).toBe(plain.credits.toNumber());
  });

  it("Science: a bonus rare-find roll on delivered hauls (never through the shared rng)", () => {
    const captain = missionState("surveyMineralAnomaly", []).captains[0];
    const stats = effectiveShipStats(freshState(), freshState().ships[0]);
    // A constant 0.99 shared roll never lands a rare tick on its own.
    // ~200 delivered cycles at the survey's 3% rare odds: several bonus rolls land.
    const plain = tickCaptainMission(60000, captain, () => 0.99, {}, stats);
    const sci = tickCaptainMission(60000, captain, () => 0.99, { cunningScienceChance: 1 }, stats);
    const rare = (d: Record<string, Decimal>) => (d.osmiumOre ?? new Decimal(0)).toNumber();
    expect(rare(plain.homePlanetDelta)).toBe(0);
    expect(rare(sci.homePlanetDelta)).toBeGreaterThan(0);
  });

  it("never replays a captain's rolls on a new dispatch (a LIFETIME cycle counter keys them, not the run)", () => {
    const stats = effectiveShipStats(freshState(), freshState().ships[0]);
    const bonuses = { cunningOperationsChance: 0.5, cunningScienceChance: 0.5 };
    const fresh = missionState("surveyMineralAnomaly", []).captains[0];
    const first = tickCaptainMission(3000, fresh, lcg(3), bonuses, stats);
    const cycles = first.lifetimeStatsDelta.missionsCompleted.surveyMineralAnomaly.toNumber();
    expect(cycles).toBeGreaterThan(5);
    expect(first.captain.cunningCycles).toBe(cycles);
    // Recall + redispatch: the run restarts from scratch, the captain keeps its history, so the same shared
    // rng no longer replays the same over-deliveries.
    const again = tickCaptainMission(3000, { ...first.captain, mission: fresh.mission }, lcg(3), bonuses, stats);
    expect(JSON.stringify(again.homePlanetDelta)).not.toBe(JSON.stringify(first.homePlanetDelta));
    expect(again.captain.cunningCycles).toBe(2 * cycles);
    // A real dispatch keeps the counter on the captain; a captain that never rolled never writes it.
    const s = missionState("shortOreRun", []);
    s.captains[0] = { ...s.captains[0], mission: null, cunningCycles: 7 };
    const d = dispatchCaptainOnMission(s, s.captains[0].id, "shortOreRun");
    expect(d.success).toBe(true);
    expect(d.next.captains[0].cunningCycles).toBe(7);
    const plain = tickCaptainMission(3000, fresh, lcg(3), {}, stats);
    expect("cunningCycles" in plain.captain).toBe(false);
  });

  it("the patrol and expedition rolls already differ per dispatch (fresh masterSeed / expedition seed)", () => {
    // Patrols: every dispatch takes a new masterSeed from the never-reused counter, and each relaunch derives
    // its own, so consecutive dispatches of one captain roll on different keys.
    let s: GameState = patrolState("destroyer", bridgeWith({ engineering: { cunning: 28 } }));
    const chance = departmentFacet(s, s.ships[0], "engineering", "cunning");
    const seeds: number[] = [];
    const rolls: boolean[] = [];
    for (let i = 0; i < 40; i++) {
      const next = dispatchCaptainOnPatrol(s, 1, "crimsonReaverSweep", "balanced", false).next;
      const m = next.captains[0].mission as PatrolMissionState;
      seeds.push(m.masterSeed);
      rolls.push(m.freeRepairTicks === CUNNING_FREE_REPAIR_TICKS);
      expect(rolls[i]).toBe(cunningProc(m.masterSeed, "engineering", chance));
      s = { ...next, captains: next.captains.map((c, k) => (k === 0 ? { ...c, mission: null } : c)) };
    }
    expect(new Set(seeds).size).toBe(40);
    expect(rolls.some((r) => r) && rolls.some((r) => !r)).toBe(true);
    // Expeditions: a dispatch commits the candidate's seed and advances expeditionSeed, so the next run of
    // the same ship rolls Security / Medical on a different seed.
    let e: GameState = { ...withCrew(freshState(), bridgeWith({ tactical: { cunning: 28 }, medical: { cunning: 28 } })), awayMembers: ROSTER };
    const expSeeds: number[] = [];
    for (let i = 0; i < 20; i++) {
      const res = legacyStart(e, "ship-1", 1, expeditionCandidates(e, "ship-1")[0].id);
      expect(res.success).toBe(true);
      expSeeds.push(res.expedition!.seed);
      e = { ...res.next, expeditions: [] };
    }
    expect(new Set(expSeeds).size).toBe(20);
  });

  it("closed form: one big mission advance equals many small ones with both rolls live", () => {
    const captain = missionState("shortOreRun", []).captains[0];
    const stats = effectiveShipStats(freshState(), freshState().ships[0]);
    const bonuses = { cunningOperationsChance: 0.4, cunningScienceChance: 0.6, missionOutputMult: 0.06 };
    const big = tickCaptainMission(1500, captain, lcg(3), bonuses, stats);
    let c = captain;
    const rng = lcg(3);
    let credits = 0;
    const loot: Record<string, Decimal> = {};
    for (let i = 0; i < 1500; i++) {
      const step = tickCaptainMission(1, c, rng, bonuses, stats);
      c = step.captain;
      credits += step.creditsDelta;
      for (const [k, v] of Object.entries(step.homePlanetDelta)) loot[k] = (loot[k] ?? new Decimal(0)).plus(v);
    }
    expect(big.creditsDelta).toBeGreaterThan(0);
    expect(credits).toBe(big.creditsDelta);
    for (const [k, v] of Object.entries(big.homePlanetDelta)) expect((loot[k] ?? new Decimal(0)).toNumber(), k).toBe(v.toNumber());
    expect(JSON.stringify(c.mission)).toBe(JSON.stringify(big.captain.mission));
    expect(c.cunningCycles).toBe(big.captain.cunningCycles);
  });

  it("Engineering: a free repair tick when a patrol cycle ends in defeat", () => {
    // Dispatch rolls the first cycle on its masterSeed: stored only when the roll succeeds.
    let seen = { hit: false, miss: false };
    for (let seed = 1; seed < 200 && !(seen.hit && seen.miss); seed++) {
      const s = { ...patrolState("destroyer", bridgeWith({ engineering: { cunning: 28 } })), nextPatrolSeed: seed };
      const m = dispatchCaptainOnPatrol(s, 1, "crimsonReaverSweep", "balanced", false).next.captains[0].mission as PatrolMissionState;
      const proc = cunningProc(seed, "engineering", departmentFacet(s, s.ships[0], "engineering", "cunning"));
      expect(m.freeRepairTicks).toBe(proc ? CUNNING_FREE_REPAIR_TICKS : undefined);
      seen = { hit: seen.hit || proc, miss: seen.miss || !proc };
    }
    expect(seen).toEqual({ hit: true, miss: true });
    // A limping cycle carrying the tick reports it, economyTick stamps it, and the repair runs one tick shorter.
    const r = dispatchCaptainOnPatrol(patrolState("destroyer", []), 1, "crimsonReaverSweep", "balanced", false).next;
    const limping: PatrolMissionState = {
      ...(r.captains[0].mission as PatrolMissionState),
      phase: "limpingHome",
      limpTicksRemaining: 1,
      limpDamage: 437,
      freeRepairTicks: 1,
    };
    const after = economyTick({ ...r, captains: [{ ...r.captains[0], mission: limping }, ...r.captains.slice(1)] }, 1, () => 0.5);
    const ship = after.ships.find((sh) => sh.id === "ship-1")!;
    expect(ship.damaged).toBe(true);
    expect(ship.freeRepairTicks).toBe(1);
    expect(shipRepairDurationTicks(ship)).toBe(shipRepairDurationTicks({ ...ship, freeRepairTicks: undefined }) - 1);
    // The tick is spent with the repair.
    let t = after;
    for (let i = 0; i < 5000 && t.ships.find((sh) => sh.id === "ship-1")!.damaged; i++) t = economyTick(t, 1, () => 0.5);
    expect(t.ships.find((sh) => sh.id === "ship-1")!.damaged).toBeFalsy();
    expect(t.ships.find((sh) => sh.id === "ship-1")!.freeRepairTicks).toBeUndefined();
    // A relaunch rolls the new cycle on its own masterSeed.
    const rr = dispatchCaptainOnPatrol(patrolState("destroyer", []), 1, "crimsonReaverSweep", "balanced", true).next;
    let c = rr.captains[0];
    const firstSeed = (c.mission as PatrolMissionState).masterSeed;
    const gear = equippedFor(rr, "ship-1");
    for (let i = 0; i < 400 && (c.mission as PatrolMissionState).masterSeed === firstSeed; i++) {
      c = tickCaptainPatrol(1, c, rr.ships[0], 1e9, 0, 1e9, 1, gear, 1, { freeRepairChance: 1 }).captain;
    }
    expect((c.mission as PatrolMissionState).masterSeed).not.toBe(firstSeed);
    expect((c.mission as PatrolMissionState).freeRepairTicks).toBe(CUNNING_FREE_REPAIR_TICKS);
  });

  it("Security softens the run's ambushes; Medical brings the injured home sooner (both rolled at dispatch)", () => {
    const s0 = { ...withCrew(freshState(), bridgeWith({ tactical: { cunning: 28 }, medical: { cunning: 28 } })), awayMembers: ROSTER };
    let seen = { soft: false, notSoft: false, quick: false };
    for (let i = 0; i < 120 && !(seen.soft && seen.notSoft && seen.quick); i++) {
      const s = { ...s0, expeditionSeed: (0x13579 + i * 7919) >>> 0 };
      const exp = legacyStart(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id).expedition!;
      const soft = cunningProc(exp.seed, "tactical", departmentFacet(s, s.ships[0], "security", "cunning"));
      const quick = cunningProc(exp.seed, "medical", departmentFacet(s, s.ships[0], "medical", "cunning"));
      expect(exp.ambushSoften).toBe(soft ? CUNNING_AMBUSH_SOFTEN : undefined);
      expect(exp.quickRecovery).toBe(quick ? CUNNING_QUICK_RECOVERY : undefined);
      seen = { soft: seen.soft || soft, notSoft: seen.notSoft || !soft, quick: seen.quick || quick };
    }
    expect(seen).toEqual({ soft: true, notSoft: true, quick: true });
    const enemies = generateEncounter(77, 0.5, "crashedShip");
    expect(softenAmbush(enemies, 0)).toBe(enemies);
    const softened = softenAmbush(enemies, CUNNING_AMBUSH_SOFTEN);
    softened.forEach((e, i) => {
      expect(e.hp).toBe(Math.max(1, Math.round(enemies[i].hp * 0.75)));
      expect(e.hpMax).toBe(e.hp);
      expect(e.power).toBeCloseTo(enemies[i].power * 0.75, 12);
    });
    const base = { medicalShare: 0.1, rapidRecoveryShare: 0 };
    expect(injuryRecoverySeconds({ ...base, officerFacetShare: CUNNING_QUICK_RECOVERY })).toBeLessThan(injuryRecoverySeconds(base));
  });

  it("the Pilot and the XO have no over-delivery of their own yet (pending the user's call)", () => {
    expect([...CUNNING_PENDING_SEATS].sort()).toEqual(["executive", "pilot"]);
    const neutral = bridgeWith({});
    const pilot = bridgeWith({ pilot: { cunning: 28 } });
    for (const key of ["shortOreRun", "frontierSupplyRun"] as MissionKey[]) {
      expect(outcomeJson(runTicks(missionState(key, pilot), 400, lcg(5)))).toBe(outcomeJson(runTicks(missionState(key, neutral), 400, lcg(5))));
    }
    const a = { ...withCrew(freshState(), pilot), awayMembers: ROSTER };
    const b = { ...withCrew(freshState(), neutral), awayMembers: ROSTER };
    expect(JSON.stringify(legacyStart(a, "ship-1", 1, expeditionCandidates(a, "ship-1")[0].id).expedition)).toBe(
      JSON.stringify(legacyStart(b, "ship-1", 1, expeditionCandidates(b, "ship-1")[0].id).expedition),
    );
  });
});

// ============================================================================
// CONSTITUTION: the long-haul ramp (D23 knee, no cap) + a shorter turnaround
// ============================================================================
describe("Constitution: long-haul ramp and shorter turnaround", () => {
  it("the ramp is facet * diminishing(hours, 5): 0 at the start, unbounded, each hour worth less", () => {
    expect(CONSTITUTION_RAMP_KNEE_HOURS).toBe(5);
    expect(constitutionRamp(0.1, 0)).toBe(0);
    expect(constitutionRamp(0, 10)).toBe(0);
    expect(constitutionRamp(0.1, 5)).toBeCloseTo(0.1 * 5 * (Math.sqrt(3) - 1), 12);
    expect(constitutionRamp(0.1, 50)).toBeGreaterThan(constitutionRamp(0.1, 5));
    expect(constitutionRamp(0.1, 500)).toBeGreaterThan(constitutionRamp(0.1, 50)); // no cap
    expect(constitutionRamp(0.1, 2) - constitutionRamp(0.1, 1)).toBeGreaterThan(constitutionRamp(0.1, 11) - constitutionRamp(0.1, 10));
  });

  it("a patrol's battle buffs grow cycle by cycle with the hours the run has flown", () => {
    const s = patrolState("destroyer", [officer("tactical", ["tac.weaponCommand", "tac.shieldCommand"], { constitution: 28 }, "o1")]);
    const ship = s.ships[0];
    const profile = officerCombatProfile(s, ship);
    expect(officerCombatModsFromProfile(profile, 0)).toEqual(officerCombatMods(s, ship));
    const r = dispatchCaptainOnPatrol(s, 1, "crimsonReaverSweep", "balanced", true);
    expect((r.next.captains[0].mission as PatrolMissionState).officerCombat).toEqual({ weaponDamage: 0.1, shield: 0.1, hull: 0, evasion: 0 });
    // 3600 seconds per tick: one route is many hours, so the relaunches climb the ramp fast.
    const effects = { relaunchCombatProfile: profile, secondsPerTick: 3600 };
    const gear = equippedFor(r.next, "ship-1");
    let c = r.next.captains[0];
    const seen: number[] = [];
    for (let i = 0; i < 400 && seen.length < 3; i++) {
      const before = (c.mission as PatrolMissionState).masterSeed;
      c = tickCaptainPatrol(1, c, ship, 1e9, 0, 1e9, 1, gear, 1, effects).captain;
      const m = c.mission as PatrolMissionState | null;
      if (!m) break;
      if (m.masterSeed !== before) seen.push(m.officerCombat!.weaponDamage);
    }
    expect(seen.length).toBe(3);
    expect(seen[0]).toBeGreaterThan(0.1);
    expect(seen[1]).toBeGreaterThan(seen[0]);
    expect(seen[2]).toBeGreaterThan(seen[1]);
  });

  it("closed form: one big patrol advance equals many small ones with the ramp, Integrity and a repair roll live", () => {
    const officers = [
      officer("tactical", ["tac.weaponCommand", "tac.shieldCommand"], { integrity: 25, constitution: 28 }, "o1"),
      officer("engineering", ["eng.rangeMaster", "any.inspiringLeader"], { cunning: 28, constitution: 20, integrity: 20 }, "o2"),
    ];
    const r = dispatchCaptainOnPatrol(patrolState("destroyer", officers), 1, "crimsonReaverSweep", "balanced", true);
    const ship = r.next.ships[0];
    const gear = equippedFor(r.next, "ship-1");
    const effects = { relaunchCombatProfile: officerCombatProfile(r.next, ship), secondsPerTick: 60, freeRepairChance: 0.5 };
    const captain = r.next.captains[0];
    const big = tickCaptainPatrol(900, captain, ship, 1e9, 0, 1e9, 1, gear, 1, effects);
    let c = captain;
    for (let i = 0; i < 900; i++) c = tickCaptainPatrol(1, c, ship, 1e9, 0, 1e9, 1, gear, 1, effects).captain;
    expect(JSON.stringify(c.mission)).toBe(JSON.stringify(big.captain.mission));
  });

  it("an expedition ramps Evasive Command and the Science crew's relic chance by the hours since dispatch", () => {
    const s = {
      ...withCrew(freshState(), bridgeWith({ pilot: { constitution: 28 }, science: { constitution: 28 } })),
      awayMembers: ROSTER,
    };
    const exp = legacyStart(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id).expedition!;
    expect(exp.rampFlightDeck).toBeCloseTo(0.18, 12);
    expect(exp.rampScience).toBeCloseTo(0.18, 12);
    expect(rampedEncounterEvasion(exp, 0)).toBe(exp.encounterEvasion);
    expect(rampedEncounterEvasion(exp, 6)).toBeCloseTo(exp.encounterEvasion! * (1 + constitutionRamp(0.18, 6)), 12);
    const fw = { relicFind: 0 };
    expect(activityRelicFindBonus(exp, fw, 0)).toBeCloseTo((exp.relicFindBonus ?? 0) + exp.crewRareFind!, 12);
    expect(activityRelicFindBonus(exp, fw, 8)).toBeGreaterThan(activityRelicFindBonus(exp, fw, 0));
    // A run without the buff stores no ramp (no Science crew rare find to ramp, say).
    const bare = { ...freshState(), officers: bridgeWith({ science: { constitution: 28 } }), awayMembers: ROSTER };
    const plainBridge = bare.officers.map((o) => (o.seat === "science" ? { ...o, bonuses: [{ id: "sci.yieldSurge", magnitude: 0.1 }, { id: "test.none", magnitude: 0 }] as SeniorStaffOfficer["bonuses"] } : o));
    const noBuffState = { ...bare, officers: plainBridge };
    const noBuff = legacyStart(noBuffState, "ship-1", 1, expeditionCandidates(noBuffState, "ship-1")[0].id).expedition!;
    expect("rampScience" in noBuff).toBe(false);
  });

  it("shorter turnaround: Operations unloads faster, Engineering repairs faster, Medical heals sooner", () => {
    const a = withCrew(freshState(), bridgeWith({}));
    const b = withCrew(freshState(), bridgeWith({ operations: { constitution: 20 }, engineering: { constitution: 20 }, medical: { constitution: 20 } }));
    expect(effectiveShipStats(b, b.ships[0]).unloadSpeedMult!).toBeGreaterThan(effectiveShipStats(a, a.ships[0]).unloadSpeedMult!);
    expect(officerRepairSpeedBonus(b, b.ships[0]) - officerRepairSpeedBonus(a, a.ships[0])).toBeCloseTo(0.1, 12);
    const bs = { ...b, awayMembers: ROSTER };
    const e = legacyStart(bs, "ship-1", 1, expeditionCandidates(bs, "ship-1")[0].id).expedition!;
    expect(e.recoveryTurnaround).toBeCloseTo(0.1, 12);
    expect(injuryRecoverySeconds({ medicalShare: 0, rapidRecoveryShare: 0, officerFacetShare: 0.1 })).toBeLessThan(
      injuryRecoverySeconds({ medicalShare: 0, rapidRecoveryShare: 0 }),
    );
  });
});

// ============================================================================
// OFFLINE == LIVE with every facet live
// ============================================================================
describe("parity: every facet live, one big advance == many small advances", () => {
  const ALL_HIGH: OfficerStats = { strength: 24, integrity: 26, cunning: 28, constitution: 27 };

  it("expeditions: the dispatch record resolves identically however the time is chunked", { timeout: 60_000 }, () => {
    const s0 = { ...withCrew(freshState(), bridge(() => ALL_HIGH)), awayMembers: ROSTER, nextAwayMemberId: 100 };
    let ramped = 0;
    for (let i = 0; i < 6; i++) {
      const s = { ...s0, expeditionSeed: (0x2468ace + i * 7919) >>> 0 };
      const start = legacyStart(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id).expedition!;
      if (start.rampFlightDeck && start.rampScience) ramped++;
      const big = advanceExpedition(start, 1_000_000);
      let small = start;
      for (let t = 0; t <= 1_000_000; t += 997) small = advanceExpedition(small, t);
      small = advanceExpedition(small, 1_000_000);
      expect(small).toEqual(big);
    }
    expect(ramped).toBe(6);
  });

  it("missions through economyTick: the same run twice lands identically (keyed streams, no shared draws)", () => {
    const run = () => runTicks(missionState("surveyMineralAnomaly", bridge(() => ALL_HIGH)), 700, lcg(21));
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});

// ============================================================================
// Tooltips (the Senior Staff panel reads officerStatTooltip)
// ============================================================================
describe("stat tooltips match the mechanics", () => {
  it("the XO's 'own bonuses in full' appears only where it is true (Integrity, Constitution)", () => {
    expect(officerStatTooltip("integrity", "executive")).toContain("own bonuses in full");
    expect(officerStatTooltip("constitution", "executive")).toContain("own bonuses in full");
    expect(officerStatTooltip("strength", "executive")).not.toContain("own bonuses");
    expect(officerStatTooltip("cunning", "executive")).not.toContain("own bonuses");
  });

  it("Constitution promises a shorter turnaround only to the departments that have one", () => {
    for (const seat of ["operations", "engineering", "medical"] as SeniorStaffSeat[]) {
      expect(officerStatTooltip("constitution", seat), seat).toMatch(/turnaround/i);
    }
    for (const seat of ["tactical", "science", "pilot"] as SeniorStaffSeat[]) {
      expect(officerStatTooltip("constitution", seat), seat).not.toMatch(/turnaround/i);
    }
    expect(officerStatTooltip("constitution", "executive")).toMatch(/Operations, Engineering and Medical/);
  });

  it("Integrity names shield RECHARGE (the pool is not lifted below half hull)", () => {
    const tip = officerStatTooltip("integrity", "tactical");
    expect(tip).toContain("shield recharge");
    expect(tip).not.toMatch(/Shield Command\) 1% stronger|Shield and Evasive Command/);
  });

  it("every tooltip is plain US English text with no em dash or double hyphen", () => {
    for (const seat of SEATS) {
      for (const key of ["strength", "integrity", "cunning", "constitution"] as const) {
        expect(officerStatTooltip(key, seat)).not.toMatch(/\u2014|-{2}/);
      }
    }
  });
});

// ============================================================================
// The per-seat Integrity / Constitution rows (user-approved table, 2026-10-09)
// ============================================================================
describe("per-seat Integrity and Constitution rows", () => {
  const longDef: MissionDef = { ...MISSIONS.shortOreRun, transitOutTicks: 7200, transitBackTicks: 7200 };

  it("Flight Deck Constitution: a mission's return leg is faster the longer the voyage ran (readouts agree)", () => {
    const n = { ...freshState(), officers: bridgeWith({}) };
    const plain = effectiveShipStats(n, n.ships[0]);
    const s = { ...freshState(), officers: bridgeWith({ pilot: { constitution: 28 } }) };
    const stats = effectiveShipStats(s, s.ships[0]);
    expect(stats.returnLegConstitution).toBeCloseTo(0.18, 12);
    expect("returnLegConstitution" in effectiveShipStats({ ...freshState(), officers: bridgeWith({}) }, freshState().ships[0])).toBe(false);
    const a = effectiveMissionDef(longDef, plain);
    const b = effectiveMissionDef(longDef, stats);
    expect(b.transitOutTicks).toBe(a.transitOutTicks);
    expect(b.transitBackTicks).toBeLessThan(a.transitBackTicks);
    const outboundHours = (1 + b.transitOutTicks + requiredTicksForPhase("extracting", b)) / 3600;
    expect(b.transitBackTicks).toBe(Math.ceil(longDef.transitBackTicks / (plain.transitSpeedMult * (1 + constitutionRamp(0.18, outboundHours)))));
  });

  it("Flight Deck Constitution: an expedition's return and a patrol's return leg shorten with the hours out", () => {
    const s = { ...withCrew(freshState(), bridgeWith({ pilot: { constitution: 28 } })), awayMembers: ROSTER };
    const exp = legacyStart(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id).expedition!;
    expect(exp.rampReturn).toBeCloseTo(0.18, 12);
    const { rampReturn: _r, ...plainExp } = exp;
    expect(returnDurationSeconds(exp)).toBeLessThan(returnDurationSeconds(plainExp as Expedition));
    expect([TRANSIT_SECONDS, SHAKEDOWN_TRANSIT_SECONDS]).toContain(returnDurationSeconds(plainExp as Expedition));
    // Patrols: the cut grows with the run's hours and ends the route early.
    const def = PATROLS.crimsonReaverSweep;
    expect(patrolReturnCutTicks(def, 0, 100)).toBe(0);
    expect(patrolReturnCutTicks(def, 0.18, 0)).toBe(0);
    expect(patrolReturnCutTicks(def, 0.18, 100)).toBeGreaterThan(0);
    const r = dispatchCaptainOnPatrol(patrolState("destroyer", []), 1, "crimsonReaverSweep", "balanced", true);
    const gear = equippedFor(r.next, "ship-1");
    const effects = { secondsPerTick: 36000, returnConstitution: 0.18 };
    let c = r.next.captains[0];
    let cut = 0;
    for (let i = 0; i < 400 && cut === 0; i++) {
      c = tickCaptainPatrol(1, c, r.next.ships[0], 1e9, 0, 1e9, 1, gear, 1, effects).captain;
      cut = (c.mission as PatrolMissionState | null)?.returnCutTicks ?? 0;
    }
    expect(cut).toBeGreaterThan(0);
    // The cut cycle completes its route `cut` ticks early: count its length.
    const startSeed = (c.mission as PatrolMissionState).masterSeed;
    let ticks = 0;
    while ((c.mission as PatrolMissionState).masterSeed === startSeed && ticks < 400) {
      c = tickCaptainPatrol(1, c, r.next.ships[0], 1e9, 0, 1e9, 1, gear, 1, effects).captain;
      ticks++;
    }
    expect(ticks).toBe(def.transitOutTicks + def.rollWindowTicks + def.transitBackTicks - cut);
  });

  it("Engineering Integrity: faster shield recharge below half hull, even with no combat bonus aboard", () => {
    const eng = patrolState("destroyer", [officer("engineering", ["eng.rangeMaster", "eng.overdrive"], { integrity: 20 }, "o1")]);
    expect(officerCombatMods(eng, eng.ships[0])).toEqual({
      weaponDamage: 0,
      shield: 0,
      hull: 0,
      evasion: 0,
      underFire: { weaponDamage: 0, shield: expect.closeTo(0.1, 12), evasion: 0 },
    });
    // With a Tactical Shield Command lifted by its own Integrity, the two compound on the recharge.
    const both = patrolState("destroyer", [
      officer("tactical", ["tac.shieldCommand", "tac.weaponCommand"], { integrity: 20 }, "o1"),
      officer("engineering", ["eng.rangeMaster", "eng.overdrive"], { integrity: 20 }, "o2"),
    ]);
    expect(officerCombatMods(both, both.ships[0])!.underFire!.shield).toBeCloseTo((1.11 / 1.1) * 1.1 - 1, 12);
    const c = shipToCombatant({ id: "ship-1", team: "player", stats: SHIP_TYPES.destroyer, hullType: combatHullTypeOf("destroyer")!, officerCombat: officerCombatMods(eng, eng.ships[0]) });
    expect(c.underFire!.shieldRecharge).toBeCloseTo(0.1, 12);
    expect(dispatchCaptainOnPatrol(eng, 1, "crimsonReaverSweep", "balanced", false).next.captains[0].mission).toHaveProperty("officerCombat.underFire");
  });

  it("Engineering Constitution: better fuel efficiency on a long voyage lets the ship reach further on it", () => {
    const plain = patrolState("destroyer", bridgeWith({}));
    const eng = patrolState("destroyer", bridgeWith({ engineering: { constitution: 28 } }));
    const ship = plain.ships[0];
    // The longest symmetric round trip the plain ship reaches, then one tick further.
    let legs = 1;
    while (shipReachesRoundTrip(plain, ship, legs + 1, legs + 1)) legs++;
    expect(shipReachesRoundTrip(plain, ship, legs + 1, legs + 1)).toBe(false);
    expect(shipReachesRoundTrip(eng, eng.ships[0], legs + 1, legs + 1)).toBe(true);
    // Short trips are unchanged, and the lightyear readout stays the voyage-free range.
    expect(shipReachesRoundTrip(eng, eng.ships[0], 1, 1)).toBe(true);
    expect(shipRangeLightYears(eng, eng.ships[0])).toBe(shipRangeLightYears(plain, ship));
    // The per-trip readout is the figure the gate uses: it covers the trip exactly when the gate passes.
    for (const l of [legs, legs + 1, legs + 2, legs * 2]) {
      const distance = 2 * l * LY_PER_TICK;
      expect(shipTripRangeLightYears(eng, eng.ships[0], 2 * l) >= distance, String(l)).toBe(shipReachesRoundTrip(eng, eng.ships[0], l, l));
      expect(shipTripRangeLightYears(plain, ship, 2 * l) >= distance, String(l)).toBe(shipReachesRoundTrip(plain, ship, l, l));
    }
    expect(shipTripRangeLightYears(plain, ship, 2 * legs)).toBe(shipRangeLightYears(plain, ship));
  });

  it("Science Integrity: a hazardous world slows the scan less; a calm one is unchanged", () => {
    const s = { ...withCrew(freshState(), bridgeWith({ science: { integrity: 28 } })), awayMembers: ROSTER };
    const exp = legacyStart(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id).expedition!;
    expect(exp.hazardSteady).toBeCloseTo(0.18, 12);
    const { hazardSteady: _h, ...plain } = exp;
    const hot = { ...exp.bodies[0], hazard: 0.8 };
    const calm = { ...exp.bodies[0], hazard: 0 };
    expect(scanRatePerSecond(exp, hot)).toBeGreaterThan(scanRatePerSecond(plain as Expedition, hot));
    expect(scanRatePerSecond(exp, calm)).toBe(scanRatePerSecond(plain as Expedition, calm));
  });

  it("Science Constitution: a survey's sensor yield grows with the voyage's hours", () => {
    const captain = missionState("surveyMineralAnomaly", []).captains[0];
    const stats = { ...effectiveShipStats(freshState(), freshState().ships[0]), sensors: 20 };
    const plain = tickCaptainMission(2000, captain, lcg(4), {}, stats);
    const sci = tickCaptainMission(2000, captain, lcg(4), { surveyYieldConstitution: 0.18 }, stats);
    expect(sci.homePlanetDelta.commonOre.gt(plain.homePlanetDelta.commonOre)).toBe(true);
    // A non-survey run ignores it.
    const ore = missionState("shortOreRun", []).captains[0];
    expect(JSON.stringify(tickCaptainMission(2000, ore, lcg(4), { surveyYieldConstitution: 0.18 }, stats).homePlanetDelta)).toBe(
      JSON.stringify(tickCaptainMission(2000, ore, lcg(4), {}, stats).homePlanetDelta),
    );
  });

  it("Medical Integrity: members who come home injured recover sooner (frozen at dispatch)", () => {
    const s = { ...withCrew(freshState(), bridgeWith({ medical: { integrity: 28 } })), awayMembers: ROSTER };
    const exp = legacyStart(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id).expedition!;
    expect(exp.injurySteady).toBeCloseTo(0.18, 12);
    const downed: Expedition = { ...exp, phase: "complete", scanEvents: [{ bodyIndex: 0, step: 1, kind: "encounter", outcome: "loss", downedMemberIds: ["member-1"] }] };
    const { injurySteady: _i, ...plainExp } = downed;
    const with_ = applyExpeditionInjuries(s, downed).injuries[0].recoverySeconds;
    const without = applyExpeditionInjuries(s, plainExp as Expedition).injuries[0].recoverySeconds;
    expect(with_).toBeLessThan(without);
  });

  it("Operations Integrity: a hold at least 90% full unloads faster (engine and readouts share missionPhaseTicks)", () => {
    const base = effectiveShipStats(freshState(), freshState().ships[0]);
    const def = effectiveMissionDef(MISSIONS.shortOreRun, { ...base, fullHoldUnloadIntegrity: 1 });
    expect(def.fullHoldUnloadTicks).toBe(Math.max(1, Math.ceil(def.unloadTicks / 2)));
    const full = { commonOre: new Decimal(def.cargoCapacity), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) };
    const partial = { commonOre: new Decimal(def.cargoCapacity * 0.5), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) };
    expect(missionPhaseTicks("unloading", def, full)).toBe(def.fullHoldUnloadTicks);
    expect(missionPhaseTicks("unloading", def, partial)).toBe(def.unloadTicks);
    expect(missionPhaseTicks("transitBack", def, full)).toBe(def.transitBackTicks);
    expect(missionCycleTiming(def).unloading).toBe(def.fullHoldUnloadTicks);
    // The engine flies more cycles in the same time; the stats carry the facet from the Operations head.
    const s = { ...freshState(), officers: bridgeWith({ operations: { integrity: 28 } }) };
    expect(effectiveShipStats(s, s.ships[0]).fullHoldUnloadIntegrity).toBeCloseTo(0.18, 12);
    const captain = missionState("shortOreRun", []).captains[0];
    const fast = tickCaptainMission(5000, captain, lcg(8), {}, { ...base, fullHoldUnloadIntegrity: 1 });
    const slow = tickCaptainMission(5000, captain, lcg(8), {}, base);
    expect(fast.lifetimeStatsDelta.missionsCompleted.shortOreRun.toNumber()).toBeGreaterThan(slow.lifetimeStatsDelta.missionsCompleted.shortOreRun.toNumber());
  });

  it("closed form with the new rows live: missions and patrols, one big advance == many small ones", () => {
    const captain = missionState("surveyMineralAnomaly", []).captains[0];
    const stats = { ...effectiveShipStats(freshState(), freshState().ships[0]), sensors: 20, fullHoldUnloadIntegrity: 0.4, returnLegConstitution: 0.2 };
    const bonuses = { surveyYieldConstitution: 0.18, cunningOperationsChance: 0.3 };
    const big = tickCaptainMission(3000, captain, lcg(6), bonuses, stats);
    let c = captain;
    const rng = lcg(6);
    const loot: Record<string, Decimal> = {};
    for (let i = 0; i < 3000; i++) {
      const step = tickCaptainMission(1, c, rng, bonuses, stats);
      c = step.captain;
      for (const [k, v] of Object.entries(step.homePlanetDelta)) loot[k] = (loot[k] ?? new Decimal(0)).plus(v);
    }
    for (const [k, v] of Object.entries(big.homePlanetDelta)) expect((loot[k] ?? new Decimal(0)).toNumber(), k).toBeCloseTo(v.toNumber(), 9);
    expect(JSON.stringify(c.mission)).toBe(JSON.stringify(big.captain.mission));
    const r = dispatchCaptainOnPatrol(patrolState("destroyer", bridgeWith({ engineering: { integrity: 25, constitution: 25 }, pilot: { constitution: 25 } })), 1, "crimsonReaverSweep", "balanced", true);
    const ship = r.next.ships[0];
    const gear = equippedFor(r.next, "ship-1");
    const effects = {
      relaunchCombatProfile: officerCombatProfile(r.next, ship),
      secondsPerTick: 600,
      returnConstitution: 0.15,
    };
    const pBig = tickCaptainPatrol(900, r.next.captains[0], ship, 1e9, 10, 1e9, 1, gear, 1, effects);
    let pc = r.next.captains[0];
    let fuel = 0;
    for (let i = 0; i < 900; i++) {
      const step = tickCaptainPatrol(1, pc, ship, 1e9, 10, 1e9, 1, gear, 1, effects);
      pc = step.captain;
      fuel += step.fuelSpent;
    }
    expect(JSON.stringify(pc.mission)).toBe(JSON.stringify(pBig.captain.mission));
    expect(fuel).toBeCloseTo(pBig.fuelSpent, 9);
  });

  it("every seat's Integrity and Constitution tooltip names its real effect", () => {
    const want: Record<SeniorStaffSeat, [RegExp, RegExp]> = {
      tactical: [/weapon damage.*shield recharge/, /Weapons Command and Shield Command/],
      pilot: [/Evasive Command/, /return trip/],
      engineering: [/shields recharge faster/, /fuel efficiency.*Shipyard repairs/],
      science: [/hazardous world/, /relic chance.*survey/],
      medical: [/come home injured/, /recover sooner/],
      operations: [/90% full/, /unloading at home/],
      executive: [/every department's trigger/, /every department's ramp/],
    };
    for (const seat of SEATS) {
      expect(officerStatTooltip("integrity", seat), seat).toMatch(want[seat][0]);
      expect(officerStatTooltip("constitution", seat), seat).toMatch(want[seat][1]);
    }
  });
});
