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
//   gear:<team>:<groundKey> every member gear stat key (model.ts MEMBER_GROUND_STAT_KEYS) on each squad whose
//                          gear can roll it. With = a piece of a variety that can roll the key, carrying ONLY
//                          that line; baseline = the same piece with no lines. Live when ANY such variety moves
//                          a value (a Security key needs a Security consumer: Science never fights, D2).
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
// Outcomes are compared with the INPUTS stripped (officers, member gear, complements, the roster snapshot and
// the frozen per-cycle records), so only consequences count.
//
// THE ALLOW-LIST: PENDING_IN_RELEASE names every effect that is dead TODAY, with the phase that brings it live
// (or "UNPLANNED: raised with user" when no plan owns it). The test FAILS when an unlisted effect is dead (wire a
// consumer or list it) AND when a listed effect turns out to be live (remove it: the list cannot rot). Reactor
// Overdrive's entry comes from crewOverlay.ts OFFICER_BONUSES_PENDING_IN_RELEASE; the Pilot's own Cunning from
// officerStats.ts CUNNING_PENDING_SEATS. (The XO is in CUNNING_PENDING_SEATS too, but its Cunning is LIVE through
// its 0.4 share of every department's over-delivery; only its OWN edge is pending, and that has no stat of its own
// to test.)
//
// A gear line's points also strengthen its piece's ground effect (heal, inflict, group hit: gambit.ts scales an
// effect with the piece's total points), so a line on an effect piece is live through that effect as well.
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
  phase: string; // the phase that brings it live, or "UNPLANNED"
  reason: string;
  note?: string;
}

const UNPLANNED = "UNPLANNED: raised with user";
const TASK_23 = "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)";
const E_MOD = "E-MOD power budget";

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
    phase: "UNPLANNED",
    reason: UNPLANNED,
    note:
      "Morale Anchor: wired as the squad's Fear resist (Task 20), but nothing in the game inflicts Fear (enemy casters " +
      "apply weakened or poison; no gear, trait or action applies fear), so the resist never rolls.",
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
  "crew:crew.loadSpeed": {
    phase: "UNPLANNED",
    reason: UNPLANNED,
    note: "Rapid Loadout (Operations): there is no loading phase today (Task 21 note) and design 6.2 names no consumer.",
  },
  "crew:crew.boardingDefense": {
    phase: "UNPLANNED",
    reason: UNPLANNED,
    note: "Boarding Defense (Security): deferred hook S4-C21 / boarding party S4-C07 (blocked on user); no 0.14.0 consumer in design 6.2.",
  },
  "crew:crew.crewEffectiveness": {
    phase: "UNPLANNED",
    reason: UNPLANNED,
    note: "Crew Effectiveness (Medical): design 6.2 gives Medical only squad healing + injury length; no consumer planned.",
  },

  // Racial bonuses (every race's racial targets a crew.* key; the same consumers decide)
  "racial:martian": { phase: E_MOD, reason: "racial crew.powerEfficiency waits for the power budget" },
  "racial:belter": { phase: TASK_23, reason: "racial crew.droneHandling (Flight Deck pool key)" },
  "racial:outerColony": { phase: TASK_23, reason: "racial crew.surveyAptitude (Science pool key)" },
  "racial:vael": { phase: TASK_23, reason: "racial crew.surveyAptitude (Science pool key)" },
  "racial:stheni": { phase: TASK_23, reason: "racial crew.hullRepairRate (Engineering pool key)" },
  "racial:earthBorn": { phase: "UNPLANNED", reason: UNPLANNED, note: "racial crew.crewEffectiveness has no planned consumer (see crew:crew.crewEffectiveness)." },
  "racial:ossir": { phase: "UNPLANNED", reason: UNPLANNED, note: "racial crew.boardingDefense has no 0.14.0 consumer (see crew:crew.boardingDefense)." },
  "racial:spacer": { phase: "UNPLANNED", reason: UNPLANNED, note: "racial crew.endurance (a racial-only key) has no consumer anywhere." },

  // Member gear lines that no consumer reads for that squad
  "gear:security:groundHazardResist": {
    phase: "UNPLANNED",
    reason: UNPLANNED,
    note: "Assault Hardsuit's hazard line: only the Science party's hazard resist is read (Task 15 carry: inert on Security).",
  },
  "gear:science:groundPower": { phase: "UNPLANNED", reason: UNPLANNED, note: "Sidearm power: Science never fights (D2, Task 13)." },
  "gear:science:groundAccuracy": { phase: "UNPLANNED", reason: UNPLANNED, note: "Sidearm accuracy: Science never fights (D2, Task 13)." },
  "gear:science:groundStatusChance": { phase: "UNPLANNED", reason: UNPLANNED, note: "Sidearm status chance: Science never fights (D2, Task 13)." },
  "gear:science:groundArmor": { phase: "UNPLANNED", reason: UNPLANNED, note: "Field Suit / Hazard Suit armor: Science never fights (D2, Task 13)." },
  "gear:science:groundHp": { phase: "UNPLANNED", reason: UNPLANNED, note: "Field Suit / Hazard Suit HP: Science never fights (D2, Task 13)." },

  // Officer stat facets
  "facet:pilot:cunning": {
    phase: "pending user decision (officerStats.ts CUNNING_PENDING_SEATS)",
    reason: "the Flight Deck has no over-delivery of its own yet (design section 7 names none)",
  },
  "facet:tactical:strength": {
    phase: TASK_23,
    reason:
      "Strength scales the Security division's complement buffs: Away-Team Protection and Counter-Infiltration go live in " +
      "Task 23 (Boarding Defense has no plan, see crew:crew.boardingDefense)",
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
const WEARER: Record<AwayTeamType, string> = { security: "member-3", science: "member-4", prospecting: "member-4" };

// ============================================================================
// The probes (scaffold -> apply the transform -> run a real consumer -> a fingerprint)
// ============================================================================

// Strip the INPUTS from a state so only consequences are compared: officers (their bonuses / stats are the
// effect under test), member gear (its lines are), ship complements (their buffs are), the bookkeeping counters
// a live bonus stamps whether or not it pays out, and the frozen per-cycle records (officerCombat and the
// other frozen fields are read by the consumers, whose results stay in the fingerprint).
function outcome(s: GameState): string {
  return JSON.stringify({
    ...s,
    officers: [],
    awayMembers: s.awayMembers.map((m) => ({ id: m.id, injuredUntilSeconds: m.injuredUntilSeconds, injuredAtSeconds: m.injuredAtSeconds })),
    equipment: s.equipment.filter((e) => !e.fittedToMemberId && !isMemberSlotType(e.slotType)),
    ships: s.ships.map(({ complement: _c, ...rest }) => rest),
    captains: s.captains.map(({ cunningCycles: _cc, ...c }) => {
      const m = c.mission as Record<string, unknown> | null;
      if (!m) return c;
      const { officerCombat: _o, freeRepairTicks: _f, returnCutTicks: _r, outputRoundCursor: _p, ...mission } = m;
      return { ...c, mission };
    }),
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
  return JSON.stringify(effectiveShipStats(s, shipOf(s)));
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
  return JSON.stringify({ maxLegs: lo, range: shipRangeLightYears(s, ship), trips });
}

function probeRepair(t: Transform): string {
  const s = installMissingCombatBaselines(t(editShip(shipScaffold("destroyer"), { damaged: true, repairDamage: 437 })));
  return JSON.stringify(processShipRepairs(s).activeProcesses);
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
  return JSON.stringify(logs);
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
  return JSON.stringify(
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
  return JSON.stringify(
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
  return JSON.stringify(
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
  return JSON.stringify(
    dispatches(t).map(({ state, exp }) => {
      const done = advanceExpedition(exp, 1_000_000);
      const claimed = claimExpedition({ ...state, expeditions: [done] }, done.id);
      return [expeditionOutcome(done), outcome(claimed.next)];
    }),
  );
}

// captain missions + patrols through economyTick

function probeMissions(t: Transform): string {
  return JSON.stringify(
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
  return JSON.stringify(out);
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

// member gear: every (squad, ground key) a wearable variety can roll
function rollableKeys(slotType: MemberSlotType, variety: { implicitStats?: string[]; affixPool?: { stat: string }[] }): Set<string> {
  const slot = EQUIPMENT_SLOTS[slotType];
  return new Set([...(variety.implicitStats ?? slot.implicitStats), ...(variety.affixPool ?? slot.affixPool).map((a) => a.stat)]);
}

function gearPiece(slotType: MemberSlotType, varietyKey: string, wearer: string, lines: Record<string, number>): EquipmentInstance {
  return {
    id: "equip-90001",
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

function gearEntries(): StatEntry[] {
  const out: StatEntry[] = [];
  for (const team of ["security", "science"] as AwayTeamType[]) {
    for (const key of MEMBER_GROUND_STAT_KEYS) {
      const variants: Variant[] = [];
      for (const slotType of MEMBER_SLOT_TYPES) {
        for (const v of EQUIPMENT_SLOTS[slotType].varieties) {
          if (!v.member?.teamTypes.includes(team) || !rollableKeys(slotType, v).has(key)) continue;
          const wear = (lines: Record<string, number>): Transform => (s) => ({ ...s, equipment: [...s.equipment, gearPiece(slotType, v.key, WEARER[team], lines)] });
          variants.push({ label: `${slotType}/${v.key}`, baseKey: `bare-${team}-${slotType}-${v.key}`, base: wear({}), with: wear({ [key]: GEAR_POINTS }) });
        }
      }
      if (variants.length > 0) out.push({ id: `gear:${team}:${key}`, category: "gear", label: `${team} ${key} (${variants.map((x) => x.label).join(", ")})`, variants });
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
  it("covers every rollable officer bonus, complement buff, racial, member gear key and seat facet", () => {
    const ids = new Set(ENTRIES.map((e) => e.id));
    expect(ids.size).toBe(ENTRIES.length);
    for (const def of SENIOR_STAFF_BONUSES) expect(ids.has(`officer:${def.statKey}`), def.id).toBe(true);
    for (const def of [...Object.values(CREW_PROFESSION_BUFFS).flat(), ...ROLLABLE_EXCLUSIVE]) expect(ids.has(`crew:${def.statKey}`), def.id).toBe(true);
    for (const race of Object.keys(CREW_RACES)) expect(ids.has(`racial:${race}`), race).toBe(true);
    for (const key of MEMBER_GROUND_STAT_KEYS as readonly MemberGroundStatKey[]) {
      expect(ids.has(`gear:security:${key}`) || ids.has(`gear:science:${key}`), key).toBe(true);
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
    }).toEqual({ officer: 16, crew: 21, racial: 10, gear: 17, facet: 28 });
  });

  it("Craft Duplicate is held (D14) and is the only buff left out", () => {
    expect(SECOND_LEVEL_EXCLUSIVE.length - ROLLABLE_EXCLUSIVE.length).toBe(1);
    expect(ENTRIES.some((e) => e.id === `crew:${CREW_STAT_KEYS.craftDuplicateChance}`)).toBe(false);
  });

  it("every allow-list entry names a real entry and carries a phase and a reason", () => {
    const ids = new Set(ENTRIES.map((e) => e.id));
    for (const [id, p] of Object.entries(PENDING_IN_RELEASE)) {
      expect(ids.has(id), `stale allow-list entry ${id}`).toBe(true);
      expect(p.phase.length > 0 && p.reason.length > 0, id).toBe(true);
      if (p.phase === "UNPLANNED") expect(p.reason).toBe(UNPLANNED);
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
});
