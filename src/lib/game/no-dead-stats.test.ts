// E-CREW 0.14.0 (Task 22): the "NO DEAD STATS" STANDING TEST (design section 11, D12, D13; plan Task 22).
//
// THE RULE IT GUARDS: nothing a player can see on a crew card, an officer card or a piece of member gear may
// do nothing. For EVERY effect a player can roll or install, this file builds a pair of states that differ by
// THAT effect alone (the "with" state and its baseline) and asks a battery of real consumers whether any
// derived value moved. An effect is LIVE when at least one probe differs, DEAD when none does.
//
// THE CATEGORIES (each entry id is "<category>:<key>"):
//   officer:<statKey>      every rollable Senior Staff bonus statKey (seniorStaffBonuses.ts). With = one officer
//                          seated at the bonus's seat carrying it; baseline = the same officer carrying nothing.
//   crew:<statKey>         every complement buff of the six profession pools plus the second-level EXCLUSIVE
//                          pool (crewBuffs.ts), minus Craft Duplicate (D14: held, it stops rolling on ship
//                          crew; Task 23 removes it from the rollable set). With = one big bucket carrying the
//                          buff; baseline = the same bucket carrying none.
//   racial:<race>          every crew race's racial bonus (crewRaces.ts), as an officer of that race carrying no
//                          bonus vs no officer (every officer and every crewmember shows a racial).
//   gear:<team>:<variety>:<groundKey>  every wearable member gear VARIETY's every rollable line (model.ts
//                          MEMBER_GROUND_STAT_KEYS), on its own, for every squad the variety's teamTypes list.
//                          With = the piece carrying ONLY that line; baseline = the same piece with no lines, or,
//                          for a piece whose ground effect scales with its points (heal, inflict, group hit,
//                          revive), the same points on an inert FILLER line, so the effect cancels and only the
//                          line's own consumer counts.
//   facet:<seat>:<stat>    every officer stat facet per seat (Strength / Integrity / Cunning / Constitution x
//                          the seven seats; design section 7 and the user-approved per-seat table). The context
//                          is a full bridge (every seat carrying bonuses with live consumers) plus a complement
//                          carrying every profession buff; with = ONE seat's ONE stat raised above 10.
//
// THE PROBES (real consumers only, never an intermediate map, so a key that merely lands in shipCrewContribution
// or in a frozen snapshot field nobody reads stays DEAD): the ship stat sheet, reach (round-trip gate and
// readouts), the Shipyard repair duration, a ship battle at full and below-half hull, the expedition's readers
// (scan rate, task length, encounter chance, fieldwork, relic odds, return leg), its battles (scan encounters +
// every PoI's task), injury recovery at claim, a whole expedition run + claim, captain mission cycles through
// economyTick (extraction, survey, transport), a Repeat patrol through economyTick, and a patrol defeat's repair.
// Outcomes are compared through explicit ALLOW-LISTS of consequence fields (state, captains, missions, patrols,
// ships, expeditions), never the inputs (officers, member gear, complements, the roster snapshot, the frozen
// per-cycle records), so only consequences count. A NaN or Infinity in any fingerprint throws.
//
// THE ALLOW-LIST: PENDING_IN_RELEASE names every effect that is dead TODAY, with the phase that brings it live
// (D26 gave every first-run unowned entry an owner; none may read UNPLANNED). The test FAILS when an unlisted effect is dead (wire a
// consumer or list it) AND when a listed effect turns out to be live (remove it: the list cannot rot). Reactor
// Overdrive's entry comes from crewOverlay.ts OFFICER_BONUSES_PENDING_IN_RELEASE; the Pilot's own Cunning from
// officerStats.ts CUNNING_PENDING_SEATS. (The XO is in CUNNING_PENDING_SEATS too, but its Cunning is LIVE through
// its 0.4 share of every department's over-delivery; only its OWN edge is pending, and that has no stat of its own
// to test.)
//
// THE RELEASE GATE: with RELEASE_GATE set (plan Task 35), a further block fails while the allow-list holds any
// entry not owned by a phase the user explicitly deferred past 0.14.0 (DEFERRED_PAST_0140, empty today).
//
// Magnitudes are deliberately exaggerated (bonus x5, stats at 70, 60-point gear lines, 400-head buckets): this
// test is about WIRING, not balance, and an exaggerated effect cannot hide behind a rounding step. Every probe is
// deterministic (seeded streams, a fixed lcg for the economy rng).

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  EQUIPMENT_SLOTS,
  MEMBER_GROUND_STAT_KEYS,
  MEMBER_SLOT_TYPES,
  SHIP_TYPES,
  isMemberSlotType,
  type AwayMember,
  type AwayTeamType,
  type CaptainMissionState,
  type CaptainState,
  type CrewBucket,
  type CrewProfession,
  type CrewRace,
  type EquipmentInstance,
  type Expedition,
  type ExpeditionActivity,
  type ExpeditionBody,
  type ExpeditionPlanetType,
  type GameState,
  type MemberGroundStatKey,
  type MemberSlotType,
  type MissionKey,
  type OfficerStats,
  type PatrolMissionState,
  type SeniorStaffOfficer,
  type SeniorStaffSeat,
  type ShipInstance,
  type ShipTypeKey,
} from "./model";
import {
  dispatchCaptainOnPatrol,
  economyTick,
  installMissingCombatBaselines,
  processShipRepairs,
  shipRangeLightYears,
  shipReachesRoundTrip,
  shipTripRangeLightYears,
} from "./tick";
import { combatHullTypeOf, shipToCombatant } from "./combat/bridge";
import { resolveBattle } from "./combat/resolveBattle";
import {
  activityDurationSeconds,
  advanceExpedition,
  claimExpedition,
  expeditionCandidates,
  returnDurationSeconds,
  scanEncounterChance,
  scanRatePerSecond,
  startExpedition,
} from "./expedition";
import { activityRelicFindBonus, resolveExpeditionActivity, resolveScanEncounter, type GambitLogEvent } from "./gambit";
import { fieldworkEffect } from "./fieldwork";
import { applyExpeditionInjuries } from "./injuries";
import { OFFICER_BONUSES_PENDING_IN_RELEASE, effectiveShipStats, officerCombatMods } from "./crewOverlay";
import { CREW_PROFESSION_BUFFS, CREW_STAT_KEYS, SECOND_LEVEL_EXCLUSIVE, type CrewBuffDef } from "./crewBuffs";
import { CREW_RACES } from "./crewRaces";
import { SENIOR_STAFF_BONUSES, getSeniorStaffBonusById, type SeniorStaffBonusDef } from "./seniorStaffBonuses";
import { OFFICER_STAT_KEYS } from "./seniorStaff";
import { CUNNING_PENDING_SEATS, DEPARTMENT_OF_SEAT } from "./officerStats";
import { POI_CATALOG, PLANET_TYPES } from "./expeditionContent";

// ============================================================================
// The allow-list
// ============================================================================

interface PendingEntry {
  phase: string; // the phase that brings it live (D26 owns every former UNPLANNED entry)
  reason: string;
  note?: string;
}

const TASK_23 = "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)";
const E_MOD = "E-MOD power budget";
// D26 (user, 2026-10-09): the owners of what the first run of this test found unowned.
const FIELD_KITS_FEAR = "Field Kits 16b: enemies inflict Fear (D26)";
const SCIENCE_LINE_SWAP = "Science gear line swap (D26): Science gear rolls fieldwork/hazard/find lines instead";
const TASK_23_ALL_BUFFS = "Task 23: small boost to all complement buffs (D26)";
const TASK_23_LONG_HAUL = "Task 23: complement long-haul ramp (D26)";
const GROUND_OPS_HAZARD = "Ground Operations: less planet-hazard slowdown on task work (D26)";
const GROUND_OPS_RELOAD = "Ground Operations: reload step of the return trip (D26)";
const GROUND_OPS_BOARDING = "Ground Operations scan events: boarding attempts (D26)";
const CORTEX_RESIST = "Field Kits 16b: Fear (D26) + stun resist covers Concussion [proposal, pending user]";

// The phases the user has EXPLICITLY deferred past 0.14.0. The release gate (below) fails while the allow-list
// holds an entry owned by any other phase. Today: none (E-MOD is 0.14.0 scope, design G8).
const DEFERRED_PAST_0140: readonly string[] = [];

// Reactor Overdrive (and anything else crewOverlay.ts lists): the officer bonuses whose system lands later in
// this release. Imported so the two lists can never disagree.
const OFFICER_PENDING: Record<string, PendingEntry> = Object.fromEntries(
  Object.entries(OFFICER_BONUSES_PENDING_IN_RELEASE).map(([statKey, phase]) => [
    `officer:${statKey}`,
    { phase, reason: "dormant by design until its system lands (crewOverlay.ts OFFICER_BONUSES_PENDING_IN_RELEASE)" },
  ]),
);

const PENDING_IN_RELEASE: Readonly<Record<string, PendingEntry>> = {
  ...OFFICER_PENDING,

  // Officer bonuses with no source to act on
  "officer:officer.crewRetention": {
    phase: FIELD_KITS_FEAR,
    reason:
      "Morale Anchor: wired as the squad's Fear resist (Task 20), but nothing inflicts Fear yet (enemy casters apply " +
      "weakened or poison), so the resist never rolls. The Iron Will trait and Cortex Shield's fear half wait the same way.",
  },

  // Complement buffs (design 6.2; Task 23 wires the division pools + exclusive pool)
  "crew:crew.powerEfficiency": { phase: E_MOD, reason: "Power Discipline: power efficiency waits for the power budget (design 6.2)" },
  "crew:crew.droneHandling": { phase: TASK_23, reason: "Deck Handling: carrier drone handling (Flight Deck pool)" },
  "crew:crew.hullRepairRate": { phase: TASK_23, reason: "Damage Control: Shipyard repair rate (Engineering pool)" },
  "crew:crew.counterInfiltration": { phase: TASK_23, reason: "Counter-Infiltration: resists enemy debuffs (Security pool)" },
  "crew:crew.awayTeamProtection": { phase: TASK_23, reason: "Away-Team Protection: squad HP (Security pool)" },
  "crew:crew.surveyAptitude": { phase: TASK_23, reason: "Survey Aptitude: scan speed (Science pool)" },
  "crew:crew.triage": { phase: TASK_23, reason: "Triage: squad healing (Medical pool)" },
  "crew:crew.crewOutputMult": { phase: TASK_23, reason: "Crew Output Multiplier: output mult (exclusive pool)" },
  "crew:crew.missionTurnaround": { phase: TASK_23, reason: "Mission Turnaround: turnaround cut (exclusive pool)" },
  "crew:crew.preventCrewLoss": { phase: TASK_23, reason: "Prevent a Crew Loss: shorter injuries (exclusive pool)" },
  "crew:crew.crewEffectiveness": { phase: TASK_23_ALL_BUFFS, reason: "Crew Effectiveness (Medical): healthy crew work better" },
  "crew:crew.loadSpeed": {
    phase: GROUND_OPS_RELOAD,
    reason: "Rapid Loadout (Operations): there is no loading phase today",
    note: "The FA talent logistics4 Efficient Stowage (statMult loadSpeed) targets the same stat.",
  },
  "crew:crew.boardingDefense": {
    phase: GROUND_OPS_BOARDING,
    reason: "Boarding Defense (Security): a ship-side scan event can attempt to board; this buff decides it",
  },

  // Racial bonuses (every race's racial targets a crew.* key; the same consumers decide)
  "racial:martian": { phase: E_MOD, reason: "racial crew.powerEfficiency waits for the power budget" },
  "racial:belter": { phase: TASK_23, reason: "racial crew.droneHandling (Flight Deck pool key)" },
  "racial:outerColony": { phase: TASK_23, reason: "racial crew.surveyAptitude (Science pool key)" },
  "racial:vael": { phase: TASK_23, reason: "racial crew.surveyAptitude (Science pool key)" },
  "racial:stheni": { phase: TASK_23, reason: "racial crew.hullRepairRate (Engineering pool key)" },
  "racial:earthBorn": { phase: TASK_23_ALL_BUFFS, reason: "racial crew.crewEffectiveness (see crew:crew.crewEffectiveness)" },
  "racial:spacer": { phase: TASK_23_LONG_HAUL, reason: "racial crew.endurance: a complement build-up like Constitution (D23 curve)" },
  "racial:ossir": { phase: GROUND_OPS_BOARDING, reason: "racial crew.boardingDefense (see crew:crew.boardingDefense)" },

  // Member gear lines, per variety
  "gear:security:assaultHardsuit:groundHazardResist": {
    phase: GROUND_OPS_HAZARD,
    reason: "only the Science party's hazard resist is read today (Task 15 carry: inert on Security)",
  },
  "gear:science:sidearm:groundPower": { phase: SCIENCE_LINE_SWAP, reason: "Science never fights (D2); the Sidearm becomes a tool" },
  "gear:science:sidearm:groundAccuracy": { phase: SCIENCE_LINE_SWAP, reason: "Science never fights (D2); the Sidearm becomes a tool" },
  "gear:science:sidearm:groundStatusChance": { phase: SCIENCE_LINE_SWAP, reason: "Science never fights (D2); the Sidearm becomes a tool" },
  "gear:science:fieldSuit:groundArmor": { phase: SCIENCE_LINE_SWAP, reason: "Science never fights (D2)" },
  "gear:science:fieldSuit:groundHp": { phase: SCIENCE_LINE_SWAP, reason: "Science never fights (D2)" },
  "gear:science:hazardSuit:groundArmor": { phase: SCIENCE_LINE_SWAP, reason: "Science never fights (D2)" },
  "gear:science:hazardSuit:groundHp": { phase: SCIENCE_LINE_SWAP, reason: "Science never fights (D2)" },
  "gear:security:cortexShield:groundStatusResist": {
    phase: CORTEX_RESIST,
    reason: "its resist covers stun and fear, and no enemy inflicts either on the squad today",
  },

  // Officer stat facets
  "facet:pilot:cunning": {
    phase: "pending user decision (officerStats.ts CUNNING_PENDING_SEATS)",
    reason: "the Flight Deck has no over-delivery of its own yet (design section 7 names none)",
  },
  "facet:tactical:strength": {
    phase: TASK_23,
    reason:
      "Strength scales the Security division's complement buffs: Away-Team Protection and Counter-Infiltration go live in " +
      "Task 23, Boarding Defense with the boarding scan events (D26)",
  },
};

// ============================================================================
// Fixtures
// ============================================================================

const SHIP_ID = "ship-1";
const BONUS_SCALE = 5; // every bonus at 5x its catalog magnitude (wiring, not balance)
const HIGH_STAT = 70; // a facet of 0.6
const GEAR_POINTS = 60;
const BUCKET_COUNT = 400;
const NO_BONUS = { id: "test.none", magnitude: 0 };

type Transform = (s: GameState) => GameState;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shipOf(s: GameState): ShipInstance {
  return s.ships.find((sh) => sh.id === SHIP_ID)!;
}

function editShip(s: GameState, over: Partial<ShipInstance>): GameState {
  return { ...s, ships: s.ships.map((sh) => (sh.id === SHIP_ID ? { ...sh, ...over } : sh)) };
}

function bonus(id: string): { id: string; magnitude: number } {
  return { id, magnitude: getSeniorStaffBonusById(id)!.magnitude * BONUS_SCALE };
}

function officer(
  id: string,
  seat: SeniorStaffSeat,
  bonuses: { id: string; magnitude: number }[],
  race: CrewRace = "earthBorn",
  stats?: OfficerStats,
): SeniorStaffOfficer {
  return {
    id,
    seat,
    name: `Officer ${id}`,
    race,
    gender: "nonbinary",
    rank: "ensign",
    bonuses: [bonuses[0] ?? NO_BONUS, bonuses[1] ?? NO_BONUS],
    missionsCompleted: 0,
    assignedShipId: SHIP_ID,
    ...(stats ? { stats: { ...stats } } : {}),
  };
}

function bucket(profession: CrewProfession, race: CrewRace, buff1Id: string, buff2Id: string | null): CrewBucket {
  return { profession, rarity: "radiant", rank: 5, race, buff1Id, buff2Id, count: BUCKET_COUNT };
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
    assignedShipId: SHIP_ID,
    ...over,
  };
}

// The expedition scaffold's away team: three Security members (one with Medical Training, who wears the
// Security test gear so a Med Kit's heal counts) and one Science member (who wears the Science test gear).
const ROSTER: AwayMember[] = [
  member("member-1", "security", { spec: "offense", rank: 3, traits: ["quickDraw"] }),
  member("member-2", "security", { spec: "defense", rank: 2, traits: ["bulwark"] }),
  member("member-3", "security", { spec: "debuff", rank: 4, traits: ["fieldMedic"] }),
  member("member-4", "science", { rank: 3 }),
];
const WEARER: Partial<Record<AwayTeamType, string>> = { security: "member-3", science: "member-4" };

// ============================================================================
// The probes (scaffold -> apply the transform -> run a real consumer -> a fingerprint)
// ============================================================================

// Every fingerprint goes through this: plain JSON, except that a NaN or an Infinity THROWS (JSON.stringify would
// write both as null, so a consumer that broke into NaN would compare equal to one that returned null).
function fp(value: unknown): string {
  return JSON.stringify(value, (key, v) => {
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error(`non-finite number at "${key}": ${v}`);
    return v;
  });
}

// The listed fields of `obj` only (an absent field stays absent).
function pick<T extends object>(obj: T, keys: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

// A state's OUTCOME, as an explicit ALLOW-LIST of consequence fields (like expeditionOutcome below), so a new
// input or frozen record can never leak in and make a dead key look live: what the fleet holds and has earned,
// what its captains and ships are doing, the Shipyard's processes, the Museum, and each away member's injury.
// Officers, complements, member gear, the frozen per-cycle records (officerCombat, freeRepairTicks,
// returnCutTicks) and the bookkeeping counters a live bonus stamps (cunningCycles, outputRoundCursor) are left
// out by construction: their CONSUMERS' results are what this keeps.
const STATE_OUTCOME_KEYS: readonly (keyof GameState)[] = [
  "gameTimeSeconds",
  "inventory",
  "discovered",
  "blanks",
  "fleetAdminXp",
  "fleetAdminLevel",
  "credits",
  "fuel",
  "lifetimeStats",
  "activeProcesses",
  "archive",
  "relicVault",
  "relicMuseum",
  "relicDiscovered",
  "crewPool",
];
const CAPTAIN_OUTCOME_KEYS: readonly (keyof CaptainState)[] = ["id", "xp", "level", "lastStopReason"];
const MISSION_OUTCOME_KEYS: readonly (keyof CaptainMissionState)[] = ["missionKey", "phase", "phaseProgressTicks", "cargo", "recalled", "refuelDelayTicks"];
const PATROL_OUTCOME_KEYS: readonly (keyof PatrolMissionState)[] = [
  "patrolKey",
  "masterSeed",
  "phase",
  "progressTicks",
  "nextWaveIndex",
  "wavesWon",
  "wavesLost",
  "playerHull",
  "playerShield",
  "playerDrones",
  "playerSystemDurability",
  "recalled",
  "limpTicksRemaining",
  "limpDamage",
  "routesCompletedThisRun",
];
const SHIP_OUTCOME_KEYS: readonly (keyof ShipInstance)[] = ["id", "typeKey", "damaged", "repairDamage"];

function outcome(s: GameState): string {
  return fp({
    state: pick(s, STATE_OUTCOME_KEYS),
    captains: s.captains.map((c) => ({
      ...pick(c, CAPTAIN_OUTCOME_KEYS),
      mission: c.mission === null ? null : c.mission.kind === "patrol" ? pick(c.mission, PATROL_OUTCOME_KEYS) : pick(c.mission, MISSION_OUTCOME_KEYS),
    })),
    ships: s.ships.map((sh) => pick(sh, SHIP_OUTCOME_KEYS)),
    shipGear: s.equipment.filter((e) => !e.fittedToMemberId && !isMemberSlotType(e.slotType)).map((e) => [e.id, e.fittedToShipId, e.durability]),
    injuries: s.awayMembers.map((m) => [m.id, m.injuredUntilSeconds, m.injuredAtSeconds]),
    expeditions: s.expeditions.map(expeditionOutcome),
  });
}

// An expedition's OUTCOME fields only (a whitelist, so a new frozen input never leaks in): when it ended, what
// each body scanned and found, the tasks' results, the scan events and the findings.
function expeditionOutcome(e: Expedition): unknown {
  return {
    phase: e.phase,
    phaseAnchorSeconds: e.phaseAnchorSeconds,
    anomalyCharted: e.anomalyCharted,
    bodies: e.bodies.map((b) => ({ scanProgress: b.scanProgress, scanned: b.scanned, discoveries: b.discoveries, activities: b.activities })),
    scanEvents: e.scanEvents,
    findings: e.findings,
  };
}

function shipScaffold(typeKey?: ShipTypeKey): GameState {
  const base = freshState();
  const s = { ...base, fuel: new Decimal(1_000_000_000), credits: new Decimal(1_000_000) };
  return typeKey ? editShip(s, { typeKey }) : s;
}

// ship side

function probeSheet(t: Transform): string {
  const s = t(shipScaffold());
  return fp(effectiveShipStats(s, shipOf(s)));
}

function probeReach(t: Transform): string {
  const s = t(shipScaffold());
  const ship = shipOf(s);
  // The longest symmetric round trip the gate passes (exponential then binary search).
  let hi = 1;
  while (hi < 1 << 24 && shipReachesRoundTrip(s, ship, hi, hi)) hi *= 2;
  let lo = hi / 2;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (shipReachesRoundTrip(s, ship, mid, mid)) lo = mid;
    else hi = mid;
  }
  const trips = [60, 3600, 36_000, 360_000].map((ticks) => shipTripRangeLightYears(s, ship, ticks));
  return fp({ maxLegs: lo, range: shipRangeLightYears(s, ship), trips });
}

function probeRepair(t: Transform): string {
  const s = installMissingCombatBaselines(t(editShip(shipScaffold("destroyer"), { damaged: true, repairDamage: 437 })));
  return fp(processShipRepairs(s).activeProcesses);
}

function probeShipBattle(t: Transform): string {
  const s = installMissingCombatBaselines(t(shipScaffold("destroyer")));
  const officerCombat = officerCombatMods(s, shipOf(s));
  const hullType = combatHullTypeOf("destroyer")!;
  const logs: unknown[] = [];
  for (const hullShare of [1, 0.4]) {
    for (const seed of [11, 12345, 777]) {
      const p = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, hullType, officerCombat });
      p.hull = Math.floor(p.hullMax * hullShare);
      if (hullShare < 1) p.shield = 0;
      const e = shipToCombatant({ id: "e", team: "enemy", stats: SHIP_TYPES.destroyer, hullType });
      const r = resolveBattle({ combatants: [p, e] }, seed, { generateLog: true });
      logs.push([r.outcome, r.log]);
    }
  }
  return fp(logs);
}

// expeditions

const EXPEDITION_SEEDS = [0x2468ace, 0x13579bd, 0x0badf00, 0x5eed123];
const PLANET_IDS = PLANET_TYPES.map((p) => p.id as ExpeditionPlanetType);
const POI_IDS = POI_CATALOG.map((p) => p.id);

function syntheticBody(planetType: ExpeditionPlanetType, hazard: number): ExpeditionBody {
  return { id: `probe-${planetType}-${hazard}`, planetType, scanTotal: 120, scanProgress: 0, hazard, scanned: false, discoveries: [], activities: [] };
}

// Dispatch the expedition scaffold (the roster above + the transform) once per seed.
function dispatches(t: Transform): { state: GameState; exp: Expedition }[] {
  const scaffold = t({ ...shipScaffold(), awayMembers: ROSTER.map((m) => ({ ...m })), nextAwayMemberId: 100 });
  return EXPEDITION_SEEDS.map((seed) => {
    const s = { ...scaffold, expeditionSeed: seed };
    const res = startExpedition(s, SHIP_ID, 1, expeditionCandidates(s, SHIP_ID)[0].id);
    if (!res.success || !res.expedition) throw new Error(`expedition dispatch refused: ${res.reason}`);
    return { state: res.next, exp: res.expedition };
  });
}

function probeExpeditionReaders(t: Transform): string {
  return fp(
    dispatches(t).map(({ exp }) => {
      const perBody = PLANET_IDS.flatMap((pt) =>
        [0, 0.9].map((hz) => {
          const body = syntheticBody(pt, hz);
          return {
            scanRate: scanRatePerSecond(exp, body),
            taskSeconds: activityDurationSeconds(exp, body),
            encounter: [scanEncounterChance(exp, body, undefined, 0), scanEncounterChance(exp, body, undefined, 12)],
          };
        }),
      );
      const fieldwork = PLANET_IDS.flatMap((pt) =>
        POI_IDS.map((poi) => {
          const fw = fieldworkEffect(exp, pt, poi);
          return [fw, activityRelicFindBonus(exp, fw, 0), activityRelicFindBonus(exp, fw, 12)];
        }),
      );
      return { perBody, fieldwork, returnSeconds: returnDurationSeconds(exp) };
    }),
  );
}

function probeExpeditionBattles(t: Transform): string {
  return fp(
    dispatches(t).map(({ exp }) => {
      const hot = syntheticBody("volcanic", 0.9);
      const scans = [1, 2, 3, 4, 5, 6].map((step) => {
        const log: GambitLogEvent[] = [];
        return [resolveScanEncounter(exp, hot, 0, step, log), log];
      });
      const tasks = POI_IDS.flatMap((poiId, i) => {
        const body = syntheticBody("terrestrial", 0.4);
        const activity: ExpeditionActivity = { id: `probe-act-${poiId}`, bodyId: body.id, poiId, done: false };
        return [0, 12].map((hours) => {
          const log: GambitLogEvent[] = [];
          return [resolveExpeditionActivity(exp, body, activity, i, log, hours), log];
        });
      });
      return { scans, tasks };
    }),
  );
}

function probeInjuries(t: Transform): string {
  return fp(
    dispatches(t).map(({ state, exp }) => {
      const downed: Expedition = {
        ...exp,
        phase: "complete",
        scanEvents: [{ bodyIndex: 0, step: 1, kind: "encounter", outcome: "loss", downedMemberIds: (exp.roster?.security ?? []).map((m) => m.memberId) }],
      };
      return applyExpeditionInjuries(state, downed).injuries;
    }),
  );
}

function probeExpeditionRun(t: Transform): string {
  return fp(
    dispatches(t).map(({ state, exp }) => {
      const done = advanceExpedition(exp, 1_000_000);
      const claimed = claimExpedition({ ...state, expeditions: [done] }, done.id);
      return [expeditionOutcome(done), outcome(claimed.next)];
    }),
  );
}

// captain missions + patrols through economyTick

function probeMissions(t: Transform): string {
  return fp(
    (["shortOreRun", "surveyMineralAnomaly", "frontierSupplyRun"] as MissionKey[]).map((missionKey) => {
      let s = t(shipScaffold());
      s = {
        ...s,
        captains: s.captains.map((c, i) =>
          i === 0
            ? {
                ...c,
                mission: {
                  kind: "extraction",
                  missionKey,
                  phase: "ordersReceived",
                  phaseProgressTicks: 0,
                  cargo: { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) },
                  recalled: false,
                },
              }
            : c,
        ),
      } as GameState;
      const rng = lcg(0xbeef);
      for (let i = 0; i < 2500; i++) s = economyTick(s, 1, rng);
      return outcome(s);
    }),
  );
}

// A Repeat patrol on long ticks (600 s), so the Constitution ramps climb across relaunches.
function probePatrol(t: Transform): string {
  const s0 = installMissingCombatBaselines(t({ ...shipScaffold("destroyer"), tickDurationSeconds: 600 }));
  const r = dispatchCaptainOnPatrol(s0, 1, "crimsonReaverSweep", "balanced", true);
  if (!r.success) throw new Error(`patrol dispatch refused: ${r.reason}`);
  let s = r.next;
  for (let i = 0; i < 600; i++) s = economyTick(s, 1, () => 0.5);
  return outcome(s);
}

// A patrol cycle that ends in DEFEAT: the ship limps home and the Shipyard repairs it (Engineering's Cunning
// free repair tick is decided at dispatch and spent here).
function probePatrolDefeatRepair(t: Transform): string {
  const out: unknown[] = [];
  for (let seed = 1; seed <= 6; seed++) {
    const s0 = installMissingCombatBaselines(t({ ...shipScaffold("destroyer"), nextPatrolSeed: seed }));
    const r = dispatchCaptainOnPatrol(s0, 1, "crimsonReaverSweep", "balanced", false);
    if (!r.success) throw new Error(`patrol dispatch refused: ${r.reason}`);
    const m = r.next.captains[0].mission as PatrolMissionState;
    const limping: PatrolMissionState = { ...m, phase: "limpingHome", limpTicksRemaining: 1, limpDamage: 437 };
    const after = economyTick({ ...r.next, captains: [{ ...r.next.captains[0], mission: limping }, ...r.next.captains.slice(1)] }, 1, () => 0.5);
    out.push(processShipRepairs(after).activeProcesses);
  }
  return fp(out);
}

interface Probe {
  name: string;
  run: (t: Transform) => string;
}

// Cheapest first: a live effect stops at its first moving probe; a dead one runs them all.
const PROBES: readonly Probe[] = [
  { name: "ship stats", run: probeSheet },
  { name: "reach", run: probeReach },
  { name: "repair time", run: probeRepair },
  { name: "ship battle", run: probeShipBattle },
  { name: "expedition readers", run: probeExpeditionReaders },
  { name: "injury recovery", run: probeInjuries },
  { name: "expedition battles", run: probeExpeditionBattles },
  { name: "expedition run + claim", run: probeExpeditionRun },
  { name: "mission cycles", run: probeMissions },
  { name: "patrol run", run: probePatrol },
  { name: "patrol defeat repair", run: probePatrolDefeatRepair },
];

// ============================================================================
// The entries
// ============================================================================

type Category = "officer" | "crew" | "racial" | "gear" | "facet";

interface Variant {
  label: string;
  baseKey: string; // baselines with the same key share one cached fingerprint per probe
  base: Transform;
  with: Transform;
}

interface StatEntry {
  id: string;
  category: Category;
  label: string;
  variants: Variant[];
}

const SEATS = Object.keys(DEPARTMENT_OF_SEAT) as SeniorStaffSeat[];

// officer bonuses: every rollable statKey (one officer at its seat; "any" sits in the XO chair)
function officerEntry(def: SeniorStaffBonusDef): StatEntry {
  const seat: SeniorStaffSeat = def.seat === "any" ? "executive" : def.seat;
  const withOfficers = (bonuses: { id: string; magnitude: number }[]): Transform => (s) => ({ ...s, officers: [officer("officer-1", seat, bonuses)] });
  return {
    id: `officer:${def.statKey}`,
    category: "officer",
    label: `${def.label} (${def.id})`,
    variants: [{ label: seat, baseKey: `officer-none@${seat}`, base: withOfficers([]), with: withOfficers([bonus(def.id)]) }],
  };
}

// complement buffs: one big bucket carrying the buff vs the same bucket carrying none
function crewEntry(def: CrewBuffDef, profession: CrewProfession): StatEntry {
  const withBucket = (buffId: string): Transform => (s) => editShip(s, { complement: { mode: "active", buckets: [bucket(profession, "earthBorn", buffId, null)] } });
  return {
    id: `crew:${def.statKey}`,
    category: "crew",
    label: `${def.label} (${def.id})`,
    variants: [{ label: profession, baseKey: `bucket-none@${profession}`, base: withBucket(NO_BONUS.id), with: withBucket(def.id) }],
  };
}

// racial bonuses: an officer of the race carrying no bonus vs no officer
function racialEntry(race: CrewRace): StatEntry {
  return {
    id: `racial:${race}`,
    category: "racial",
    label: `${CREW_RACES[race].label} racial (${CREW_RACES[race].racialBonus.statKey})`,
    variants: [{ label: race, baseKey: "no-officer", base: (s) => s, with: (s) => ({ ...s, officers: [officer("officer-1", "executive", [], race)] }) }],
  };
}

// member gear: every wearable VARIETY's every rollable line, on its own, for every squad its teamTypes list
function rollableKeys(slotType: MemberSlotType, variety: { implicitStats?: string[]; affixPool?: { stat: string }[] }): Set<string> {
  const slot = EQUIPMENT_SLOTS[slotType];
  return new Set([...(variety.implicitStats ?? slot.implicitStats), ...(variety.affixPool ?? slot.affixPool).map((a) => a.stat)]);
}

function gearPiece(slotType: MemberSlotType, varietyKey: string, wearer: string, lines: Record<string, number>, id = "equip-90001"): EquipmentInstance {
  return {
    id,
    slotType,
    moduleVariant: varietyKey,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: "bp-test",
    implicitStats: lines,
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    durability: 100,
    fittedToShipId: null,
    fittedToMemberId: wearer,
  };
}

// A piece with a ground EFFECT (heal, inflict, group hit, revive) scales that effect with its TOTAL line points
// (awayTeam.ts snapshotMember), so a line under test would also look live through the effect. Such a piece's
// baseline therefore carries the SAME points on a FILLER line no consumer reads for the wearer, and the two
// effects cancel: what is left is the tested line's own consumer. On a Security wearer the filler is a fieldwork
// YIELD line (only the Science party's fieldwork is read, D2; "the filler is inert" below proves it). No other
// squad wears an effect piece today: one that does fails loudly here until it gets its own filler.
function effectFiller(team: AwayTeamType, key: MemberGroundStatKey): MemberGroundStatKey {
  if (team !== "security") throw new Error(`no inert filler line for an effect piece worn by ${team}: extend no-dead-stats`);
  return key === "groundOrganicsYield" ? "groundVaultYield" : "groundOrganicsYield";
}

// The wearer for a squad: the scaffold's Security medic or Science member; any other squad (prospecting is wired
// only, D2) gets a member of its own added by the same transform, so base and with still differ by the line alone.
function wearOn(team: AwayTeamType, slotType: MemberSlotType, varietyKey: string, lines: Record<string, number>): Transform {
  const wearer = WEARER[team];
  return (s) => ({
    ...s,
    awayMembers: wearer ? s.awayMembers : [...s.awayMembers, member("member-90", team)],
    equipment: [...s.equipment, gearPiece(slotType, varietyKey, wearer ?? "member-90", lines)],
  });
}

// MEMBER-WIDE lines that only pay out through ANOTHER piece the member wears (awayTeam.ts: the summed lines convert
// once per member). groundStatusChance is the chance every INFLICT piece the member wears lands its status, so a
// status-chance line on a piece that inflicts nothing (Pulse Rifle, Scattergun, Targeting Optic) is live in the
// real pairing with an inflict tool. Each such entry gets a second variant in which BOTH states also wear the bare
// paired piece (no lines, so it adds nothing of its own). Skipped when the tested piece sits in the paired piece's
// slot. groundStatusResist is deliberately NOT paired here: Cortex Shield's line stays owned by Field Kits 16b.
const MEMBER_WIDE_PAIRING: Partial<Record<MemberGroundStatKey, { slotType: MemberSlotType; varietyKey: string; team: AwayTeamType }>> = {
  groundStatusChance: { slotType: "memberTool", varietyKey: "stunGrenade", team: "security" },
};

function gearEntries(): StatEntry[] {
  const out: StatEntry[] = [];
  for (const slotType of MEMBER_SLOT_TYPES) {
    for (const v of EQUIPMENT_SLOTS[slotType].varieties) {
      if (!v.member) continue;
      const rollable = rollableKeys(slotType, v);
      for (const team of v.member.teamTypes) {
        for (const key of MEMBER_GROUND_STAT_KEYS) {
          if (!rollable.has(key)) continue;
          const effect = v.member.groundEffect;
          const scaled = effect !== undefined && effect.kind !== "resistStatus";
          const baseLines = scaled ? { [effectFiller(team, key)]: GEAR_POINTS } : {};
          const variants: Variant[] = [
            {
              label: `${slotType}/${v.key}`,
              baseKey: `gear-${team}-${slotType}-${v.key}-${fp(baseLines)}`,
              base: wearOn(team, slotType, v.key, baseLines),
              with: wearOn(team, slotType, v.key, { [key]: GEAR_POINTS }),
            },
          ];
          const pair = MEMBER_WIDE_PAIRING[key];
          if (pair && pair.team === team && pair.slotType !== slotType) {
            const withPair = (t: Transform): Transform => (s0) => {
              const s = t(s0);
              return { ...s, equipment: [...s.equipment, gearPiece(pair.slotType, pair.varietyKey, WEARER[team]!, {}, "equip-90002")] };
            };
            variants.push({
              label: `${slotType}/${v.key} + bare ${pair.varietyKey}`,
              baseKey: `gear-${team}-${slotType}-${v.key}-${fp(baseLines)}+${pair.varietyKey}`,
              base: withPair(wearOn(team, slotType, v.key, baseLines)),
              with: withPair(wearOn(team, slotType, v.key, { [key]: GEAR_POINTS })),
            });
          }
          out.push({
            id: `gear:${team}:${v.key}:${key}`,
            category: "gear",
            label: `${v.label} (${slotType}) ${key} on ${team}${scaled ? `, ${effect.kind} effect balanced` : ""}`,
            variants,
          });
        }
      }
    }
  }
  return out;
}

// officer stat facets: a full bridge + a full complement, one seat's one stat raised
// The two bonuses each seat carries (every live officer consumer is exercised), at 5x magnitude.
const FACET_SEAT_BONUSES: Record<SeniorStaffSeat, [string, string]> = {
  executive: ["xo.commandOutput", "any.inspiringLeader"],
  pilot: ["pilot.evasion", "pilot.transitCut"],
  operations: ["ops.cargoExpand", "ops.unloadSurge"],
  science: ["sci.discovery", "sci.yieldSurge"],
  tactical: ["tac.weaponCommand", "tac.shieldCommand"],
  medical: ["med.recovery", "med.fleetTriage"],
  engineering: ["eng.rangeMaster", "any.veteranInstincts"],
};

// Each division's buckets carry all three of its pool buffs, crewed by a race whose racial targets the same
// division, so a department's Strength reaches exactly that division's keys.
const FACET_RACE: Record<CrewProfession, CrewRace> = {
  operations: "stationBorn",
  flightDeck: "belter",
  engineering: "stheni",
  security: "ossir",
  science: "vael",
  medical: "earthBorn",
};

const NEUTRAL: OfficerStats = { strength: 10, integrity: 10, cunning: 10, constitution: 10 };

function facetContext(raise?: { seat: SeniorStaffSeat; stat: keyof OfficerStats }): Transform {
  return (s) => {
    const officers = SEATS.map((seat, i) =>
      officer(`officer-${i + 1}`, seat, FACET_SEAT_BONUSES[seat].map(bonus), "earthBorn", raise && raise.seat === seat ? { ...NEUTRAL, [raise.stat]: HIGH_STAT } : NEUTRAL),
    );
    const buckets = (Object.keys(CREW_PROFESSION_BUFFS) as CrewProfession[]).flatMap((p) => {
      const [a, b, c] = CREW_PROFESSION_BUFFS[p].map((d) => d.id);
      return [bucket(p, FACET_RACE[p], a, b), bucket(p, FACET_RACE[p], c, null)];
    });
    // A deep Keen Analysis bench, so a survey's rare odds are high enough for Science's Cunning (one bonus
    // rare-find roll per delivered cycle) to land within the mission probe's cycles.
    buckets.push({ ...bucket("science", FACET_RACE.science, "sci.rareFind", null), count: BUCKET_COUNT * 10 });
    return editShip({ ...s, officers }, { complement: { mode: "active", buckets } });
  };
}

function facetEntries(): StatEntry[] {
  const base = facetContext();
  return SEATS.flatMap((seat) =>
    OFFICER_STAT_KEYS.map((stat) => ({
      id: `facet:${seat}:${stat}`,
      category: "facet" as const,
      label: `${seat} ${stat} (department: ${DEPARTMENT_OF_SEAT[seat]})`,
      variants: [{ label: `${seat} ${stat} ${HIGH_STAT}`, baseKey: "facet-bridge", base, with: facetContext({ seat, stat }) }],
    })),
  );
}

const PROFESSION_OF_BUFF = new Map<string, CrewProfession>(
  (Object.entries(CREW_PROFESSION_BUFFS) as [CrewProfession, CrewBuffDef[]][]).flatMap(([p, defs]) => defs.map((d) => [d.id, p] as const)),
);

// D14: Craft Duplicate is HELD (future FA talent or homeworld staffing) and stops rolling on ship crew, so it
// is not a "rollable" effect this test can demand a consumer for.
const ROLLABLE_EXCLUSIVE = SECOND_LEVEL_EXCLUSIVE.filter((d) => d.statKey !== CREW_STAT_KEYS.craftDuplicateChance);

const ENTRIES: readonly StatEntry[] = [
  ...SENIOR_STAFF_BONUSES.map(officerEntry),
  ...Object.values(CREW_PROFESSION_BUFFS)
    .flat()
    .map((d) => crewEntry(d, PROFESSION_OF_BUFF.get(d.id)!)),
  ...ROLLABLE_EXCLUSIVE.map((d) => crewEntry(d, "operations")),
  ...(Object.keys(CREW_RACES) as CrewRace[]).map(racialEntry),
  ...gearEntries(),
  ...facetEntries(),
];

// ============================================================================
// Liveness
// ============================================================================

const baselineCache = new Map<string, string>();

function fingerprint(probe: Probe, key: string, t: Transform): string {
  const cacheKey = `${key}|${probe.name}`;
  let hit = baselineCache.get(cacheKey);
  if (hit === undefined) {
    hit = probe.run(t);
    baselineCache.set(cacheKey, hit);
  }
  return hit;
}

// The first "<variant> / <probe>" whose fingerprint moved, or null when every probe of every variant matched.
function liveVia(entry: StatEntry): string | null {
  for (const variant of entry.variants) {
    for (const probe of PROBES) {
      if (probe.run(variant.with) !== fingerprint(probe, variant.baseKey, variant.base)) return `${variant.label} / ${probe.name}`;
    }
  }
  return null;
}

// The entry counts by category (the coverage test pins them; a new catalog entry changes one).
const EXPECTED_COUNTS = { officer: 16, crew: 21, racial: 10, gear: 74, facet: 28 };

// ============================================================================
// The standing test
// ============================================================================

describe("no dead stats: every rollable or installable effect moves a derived value", () => {
  for (const category of ["officer", "crew", "racial", "gear", "facet"] as Category[]) {
    describe(category, () => {
      for (const entry of ENTRIES.filter((e) => e.category === category)) {
        it(entry.id, { timeout: 120_000 }, () => {
          const live = liveVia(entry);
          const pending = PENDING_IN_RELEASE[entry.id];
          if (pending) {
            expect(
              live,
              `${entry.id} [${entry.label}] is listed in PENDING_IN_RELEASE (${pending.phase}) but is now LIVE via ${live}: remove the entry`,
            ).toBeNull();
          } else {
            expect(
              live,
              `${entry.id} [${entry.label}] moves no derived value: give it a consumer, or list it in PENDING_IN_RELEASE with its owning phase`,
            ).not.toBeNull();
          }
        });
      }
    });
  }
});

describe("the entry list and the allow-list stay honest", () => {
  it("covers every rollable officer bonus, complement buff, racial, member gear line and seat facet", () => {
    const ids = new Set(ENTRIES.map((e) => e.id));
    expect(ids.size).toBe(ENTRIES.length);
    for (const def of SENIOR_STAFF_BONUSES) expect(ids.has(`officer:${def.statKey}`), def.id).toBe(true);
    for (const def of [...Object.values(CREW_PROFESSION_BUFFS).flat(), ...ROLLABLE_EXCLUSIVE]) expect(ids.has(`crew:${def.statKey}`), def.id).toBe(true);
    for (const race of Object.keys(CREW_RACES)) expect(ids.has(`racial:${race}`), race).toBe(true);
    // Every wearable variety, for every squad its teamTypes list, for every line it can roll.
    for (const slotType of MEMBER_SLOT_TYPES) {
      for (const v of EQUIPMENT_SLOTS[slotType].varieties) {
        if (!v.member) continue;
        for (const team of v.member.teamTypes) {
          for (const key of rollableKeys(slotType, v)) expect(ids.has(`gear:${team}:${v.key}:${key}`), `${v.key} ${team} ${key}`).toBe(true);
        }
      }
    }
    for (const key of MEMBER_GROUND_STAT_KEYS as readonly MemberGroundStatKey[]) {
      expect(ENTRIES.some((e) => e.category === "gear" && e.id.endsWith(`:${key}`)), key).toBe(true);
    }
    for (const seat of SEATS) for (const stat of OFFICER_STAT_KEYS) expect(ids.has(`facet:${seat}:${stat}`), `${seat} ${stat}`).toBe(true);
    // The counts by category (a new catalog entry grows these; update them with the new key's verdict).
    const count = (c: Category) => ENTRIES.filter((e) => e.category === c).length;
    expect({
      officer: count("officer"),
      crew: count("crew"),
      racial: count("racial"),
      gear: count("gear"),
      facet: count("facet"),
    }).toEqual(EXPECTED_COUNTS);
  });

  it("Craft Duplicate is held (D14) and is the only buff left out", () => {
    expect(SECOND_LEVEL_EXCLUSIVE.length - ROLLABLE_EXCLUSIVE.length).toBe(1);
    expect(ENTRIES.some((e) => e.id === `crew:${CREW_STAT_KEYS.craftDuplicateChance}`)).toBe(false);
  });

  it("every allow-list entry names a real entry, carries a phase and a reason, and none is left UNPLANNED (D26)", () => {
    const ids = new Set(ENTRIES.map((e) => e.id));
    for (const [id, p] of Object.entries(PENDING_IN_RELEASE)) {
      expect(ids.has(id), `stale allow-list entry ${id}`).toBe(true);
      expect(p.phase.length > 0 && p.reason.length > 0, id).toBe(true);
      expect(/UNPLANNED/.test(p.phase) || /UNPLANNED/.test(p.reason), id).toBe(false);
    }
  });

  it("Reactor Overdrive comes from crewOverlay.ts and the Pilot's Cunning from CUNNING_PENDING_SEATS", () => {
    for (const statKey of Object.keys(OFFICER_BONUSES_PENDING_IN_RELEASE)) expect(PENDING_IN_RELEASE[`officer:${statKey}`]).toBeDefined();
    // Every seat with no over-delivery of its own: its Cunning is dead unless the XO's 0.4 share reaches the
    // other departments' over-deliveries (the XO's Cunning is live that way; its OWN edge is the pending part).
    for (const seat of CUNNING_PENDING_SEATS) {
      if (DEPARTMENT_OF_SEAT[seat] === "all") expect(PENDING_IN_RELEASE[`facet:${seat}:cunning`], seat).toBeUndefined();
      else expect(PENDING_IN_RELEASE[`facet:${seat}:cunning`], seat).toBeDefined();
    }
  });

  it("the effect-piece filler lines are inert on a Security wearer (so balancing an effect hides nothing)", { timeout: 120_000 }, () => {
    // A Security piece WITHOUT an effect, carrying only a filler line, must move nothing at all.
    for (const filler of ["groundOrganicsYield", "groundVaultYield"]) {
      const entry: StatEntry = {
        id: `filler:${filler}`,
        category: "gear",
        label: filler,
        variants: [
          {
            label: `memberArmor/ballisticWeave + ${filler}`,
            baseKey: "filler-bare",
            base: wearOn("security", "memberArmor", "ballisticWeave", {}),
            with: wearOn("security", "memberArmor", "ballisticWeave", { [filler]: GEAR_POINTS }),
          },
        ],
      };
      expect(liveVia(entry), filler).toBeNull();
    }
  });

  it("a NaN or an Infinity in a fingerprint throws instead of reading as null", () => {
    expect(() => fp({ a: Number.NaN })).toThrow(/non-finite/);
    expect(() => fp([1, Number.POSITIVE_INFINITY])).toThrow(/non-finite/);
    expect(fp({ a: 1 })).toBe('{"a":1}');
  });
});

// The 0.14.0 CLOSE-OUT gate (plan Task 35): `RELEASE_GATE=1 npx vitest run src/lib/game/no-dead-stats.test.ts`.
// The release may ship only when every allow-list entry is owned by a phase the user EXPLICITLY deferred past
// 0.14.0 (DEFERRED_PAST_0140); anything else is a stat on screen that does nothing in the shipped build.
const RELEASE_GATE = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.RELEASE_GATE;

describe.runIf(Boolean(RELEASE_GATE))("release gate: 0.14.0 ships with no dead stats", () => {
  it("PENDING_IN_RELEASE holds only entries owned by a phase deferred past 0.14.0", () => {
    const blocking = Object.entries(PENDING_IN_RELEASE)
      .filter(([, p]) => !DEFERRED_PAST_0140.includes(p.phase))
      .map(([id, p]) => `${id} (${p.phase})`);
    expect(blocking, "dead stats still listed for 0.14.0: wire them or get the user to defer their phase").toEqual([]);
  });
});
