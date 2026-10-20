// WR-1 (0.14.0 wiring registry, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 3.6): the
// LIVENESS level of the wiring registry. These are the no-dead-stats probes, fingerprint and entry builders, MOVED
// here unchanged from no-dead-stats.test.ts (E-CREW Task 22) so the registry tests and the no-dead-stats runner share
// one copy. Test-only: nothing in the app imports this file, so it is tree-shaken from the bundle.
//
// THE RULE IT GUARDS (unchanged): nothing a player can see on a crew card, an officer card or a piece of member gear
// may do nothing. For EVERY such effect it builds a pair of states that differ by THAT effect alone (the "with" state
// and its baseline) and asks a battery of real consumers whether any derived value moved. An effect is LIVE when at
// least one probe differs, DEAD when none does. Whether an entry is EXPECTED to be live is the registry's status
// (wiring/registry.ts), which replaced the PENDING_IN_RELEASE allow-list with the same ids and owners.
//
// THE CATEGORIES (each entry id is "<category>:<key>"):
//   officer:<statKey>      every rollable Senior Staff bonus statKey (seniorStaffBonuses.ts). With = one officer
//                          seated at the bonus's seat carrying it; baseline = the same officer carrying nothing.
//   crew:<statKey>         every complement buff of the six profession pools plus the ROLLABLE second-level
//                          EXCLUSIVE pool (crewBuffs.ts; Craft Duplicate is held, D14). With = one big bucket
//                          carrying the buff; baseline = the same bucket carrying none.
//   racial:<race>          every crew race's racial bonus (crewRaces.ts), as an officer of that race carrying no
//                          bonus vs no officer.
//   gear:<team>:<variety>:<groundKey>  every wearable member gear VARIETY's every rollable line, on its own, for
//                          every squad the variety's teamTypes list (effect pieces balanced by an inert filler line).
//   facet:<seat>:<stat>    every officer stat facet per seat, in a full bridge + complement context.
//
// THE PROBES are real consumers only (the ship stat sheet, reach, Shipyard repair, ship battles, the expedition's
// readers, battles, a Field Kits run's objective fights (FKR-4, flag 2 stamped by hand), injuries and whole run +
// claim on both engines, mission cycles and a Repeat patrol through
// economyTick, a patrol defeat repair, the ship scan events), compared through ALLOW-LISTS of consequence fields.
// A NaN or Infinity in any fingerprint throws. Magnitudes are deliberately exaggerated (bonus x5, stats at 70,
// 60-point gear lines, 400-head buckets): this level is about WIRING; the registry's sensitivity level
// (wiring.sensitivity.test.ts) checks direction and magnitude at real values.

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
} from "../model";
import {
  dispatchCaptainOnPatrol,
  economyTick,
  installMissingCombatBaselines,
  processShipRepairs,
  shipRangeLightYears,
  shipReachesRoundTrip,
  shipTripRangeLightYears,
} from "../tick";
import { combatHullTypeOf, shipToCombatant } from "../combat/bridge";
import { resolveBattle } from "../combat/resolveBattle";
import {
  activityDurationSeconds,
  advanceExpedition,
  claimExpedition,
  expeditionCandidates,
  returnDurationSeconds,
  scanEncounterChance,
  scanRatePerSecond,
  startExpedition,
} from "../expedition";
import { activityRelicFindBonus, resolveExpeditionActivity, resolveScanEncounter, type GambitLogEvent } from "../gambit";
import { fieldworkEffect } from "../fieldwork";
import { applyExpeditionInjuries, applyGroundOpsInjuries } from "../injuries";
import { groundTeamBaySeconds } from "../groundOps";
import { resolveTaskFight, taskFightTeam } from "../groundFight";
import { FIELD_KITS_CATALOG_VERSION } from "../fieldKits";
import { SHIP_EVENT_DRAW_UNITS, SHIP_EVENT_WEIGHTS, boardingRepelChance, resolveShipScanEventFromDraws, shipEventDraws } from "../shipScanEvents";
import { withSlottedAwayTeams, withoutGroundOps } from "../awayTeamTestFixtures";
import { effectiveShipStats, officerCombatMods } from "../crewOverlay";
import { CREW_PROFESSION_BUFFS, ROLLABLE_SECOND_LEVEL_EXCLUSIVE, type CrewBuffDef } from "../crewBuffs";
import { CREW_RACES } from "../crewRaces";
import { SENIOR_STAFF_BONUSES, getSeniorStaffBonusById, type SeniorStaffBonusDef } from "../seniorStaffBonuses";
import { OFFICER_STAT_KEYS } from "../seniorStaff";
import { DEPARTMENT_OF_SEAT } from "../officerStats";
import { POI_CATALOG, PLANET_TYPES } from "../expeditionContent";


// ============================================================================
// Fixtures
// ============================================================================

export const SHIP_ID = "ship-1";
const BONUS_SCALE = 5; // every bonus at 5x its catalog magnitude (wiring, not balance)
const HIGH_STAT = 70; // a facet of 0.6
export const GEAR_POINTS = 60;
const BUCKET_COUNT = 400;
export const NO_BONUS = { id: "test.none", magnitude: 0 };

export type Transform = (s: GameState) => GameState;

export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function shipOf(s: GameState): ShipInstance {
  return s.ships.find((sh) => sh.id === SHIP_ID)!;
}

export function editShip(s: GameState, over: Partial<ShipInstance>): GameState {
  return { ...s, ships: s.ships.map((sh) => (sh.id === SHIP_ID ? { ...sh, ...over } : sh)) };
}

function bonus(id: string): { id: string; magnitude: number } {
  return { id, magnitude: getSeniorStaffBonusById(id)!.magnitude * BONUS_SCALE };
}

export function officer(
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

export function bucket(profession: CrewProfession, race: CrewRace, buff1Id: string, buff2Id: string | null): CrewBucket {
  return { profession, rarity: "radiant", rank: 5, race, buff1Id, buff2Id, count: BUCKET_COUNT };
}

export function member(id: string, teamType: AwayTeamType, over: Partial<AwayMember> = {}): AwayMember {
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
export const ROSTER: AwayMember[] = [
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
export function fp(value: unknown): string {
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

export function outcome(s: GameState): string {
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
export function expeditionOutcome(e: Expedition): unknown {
  return {
    phase: e.phase,
    phaseAnchorSeconds: e.phaseAnchorSeconds,
    anomalyCharted: e.anomalyCharted,
    bodies: e.bodies.map((b) => ({ scanProgress: b.scanProgress, scanned: b.scanned, discoveries: b.discoveries, activities: b.activities })),
    scanEvents: e.scanEvents,
    findings: e.findings,
    // Ground Ops (GO-7b): when the operations window closed, the recovery legs, and each team's bay ends (the
    // timeline's consequences; the frozen factors are inputs and stay out).
    groundOps: e.groundOps
      ? { endedAt: e.groundOps.endedAt, shipLegs: e.groundOps.shipLegs, bayEnds: e.groundOps.teams.map((t) => t.bayEnds) }
      : null,
  };
}

export function shipScaffold(typeKey?: ShipTypeKey): GameState {
  const base = freshState();
  const s = { ...base, credits: new Decimal(1_000_000) };
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

export function syntheticBody(planetType: ExpeditionPlanetType, hazard: number): ExpeditionBody {
  return { id: `probe-${planetType}-${hazard}`, planetType, scanTotal: 120, scanProgress: 0, hazard, scanned: false, discoveries: [], activities: [] };
}

// Dispatch the expedition scaffold (the roster above + the transform) once per seed.
export function dispatches(t: Transform): { state: GameState; exp: Expedition }[] {
  // Ground Ops (GO-7b): dispatch reads the slotted ground teams, so the roster is slotted in hire order after
  // the transform (which may add members, gear or crew).
  const scaffold = withSlottedAwayTeams(t({ ...shipScaffold(), awayMembers: ROSTER.map((m) => ({ ...m })), nextAwayMemberId: 100 }));
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

// Field Kits FKR-4: a FIELD KITS run's objective fights (flag 2 stamped by hand on the dispatched run: FKR-7 stamps it at
// dispatch), where the enemy inflictors (Fear from Swarm and hostile garrisons, a Bruiser's heavy-hit Fracture and
// Concussion, a Striker's Hemorrhage and flash grenade, a Caster's Neurotoxin from Challenging) roll against the squad's
// resists: each fight's record and battle log on a swarm cave, a hostile fortification and a derelict outpost, at two
// fight numbers and two grades.
const FIELD_KITS_PROBE_SITES = ["caveNetwork", "enemyFortification", "derelictOutpost"];
function probeFieldKitsFights(t: Transform): string {
  return fp(
    dispatches(t).map(({ exp }) => {
      const run: Expedition = { ...exp, fieldKits: { catalog: FIELD_KITS_CATALOG_VERSION } };
      const ops = run.groundOps!;
      const teams = ops.teams.map((team, i) => ({ securityIds: team.securityIds, downedThisTask: [], securityShare: ops.factors.securityShare[i] ?? 0 }));
      const body = syntheticBody("terrestrial", 0.4);
      const fights = FIELD_KITS_PROBE_SITES.flatMap((poiId, i) =>
        [0, 1].flatMap((fightCount) =>
          [2, 4].map((difficulty) => {
            const log: GambitLogEvent[] = [];
            const task = { id: `probe-fk-${poiId}`, poiId, fightCount, pointsCleared: 0, difficulty, fightPoints: [0.5] };
            return [resolveTaskFight(run, teams, body, task, i, undefined, log), log];
          }),
        ),
      );
      // Field Kits FKR-5: the squad as such a fight arms it (each worn grenade's throw and its charges per objective).
      const armed = taskFightTeam(run, teams, { id: "probe-fk-armed", fightCount: 0 }).map((c) => [c.memberId, c.grenade]);
      return { fights, armed };
    }),
  );
}

// Injury recovery, both engines: a LEGACY run's claim injuries (every Security member downed in a scan battle,
// timed by the ship's care at claim), and a GROUND OPS run's medical bay (every member carrying a full set of
// conditions, timed by the run's frozen care: groundTeamBaySeconds) and its claim (each member still in the bay
// comes home with the time left).
const BAY_PROBE_CONDITIONS = ["health", "poison", "bleed", "downed", "fracture"];
function probeInjuries(t: Transform): string {
  return fp(
    dispatches(t).map(({ state, exp }) => {
      const legacy = withoutGroundOps(exp);
      const downed: Expedition = {
        ...legacy,
        phase: "complete",
        scanEvents: [{ bodyIndex: 0, step: 1, kind: "encounter", outcome: "loss", downedMemberIds: (exp.roster?.security ?? []).map((m) => m.memberId) }],
      };
      const ops = exp.groundOps!;
      const hurt = ops.teams.map((team) => ({
        ...team,
        conditions: Object.fromEntries([...team.securityIds, ...team.scienceIds].map((id) => [id, BAY_PROBE_CONDITIONS])),
      }));
      const bay = hurt.map((team) => groundTeamBaySeconds(exp, team));
      const inBay: Expedition = {
        ...exp,
        phase: "complete",
        groundOps: {
          ...ops,
          teams: hurt.map((team, i) => ({
            ...team,
            bayStart: state.gameTimeSeconds,
            bayEnds: Object.fromEntries(Object.entries(bay[i]).map(([id, secs]) => [id, state.gameTimeSeconds + secs])),
          })),
        },
      };
      return [applyExpeditionInjuries(state, downed).injuries, bay, applyGroundOpsInjuries({ ...state, gameTimeSeconds: state.gameTimeSeconds + 60 }, inBay).injuries];
    }),
  );
}

// A whole run + claim on BOTH engines: the dispatched Ground Ops run (the timeline: task work with the
// Security suits' hazard resist, fights, the bay on the frozen care, offload and reload, the window's end) and
// its legacy twin (no groundOps flag: the activities phase's battles and Task 16 injuries). A Ground Ops run
// that holds a task it cannot win is fingerprinted where it stands at the horizon (user Q4: it never gives up).
const RUN_PROBE_HORIZON = 200_000;
function probeExpeditionRun(t: Transform): string {
  return fp(
    dispatches(t).map(({ state, exp }) =>
      [exp, withoutGroundOps(exp)].map((start) => {
        const done = advanceExpedition(start, RUN_PROBE_HORIZON);
        const claimed = claimExpedition({ ...state, expeditions: [done] }, done.id);
        return [expeditionOutcome(done), claimed.success ? outcome(claimed.next) : null];
      }),
    ),
  );
}

// Ground Ops GO-9: the ship-side scan events' BOARDING (D26): per dispatch, the repel decision on the run's frozen
// profile (shipScanEvents.ts boardingRepelChance, the chance draw 5 is compared against) and one forced boarding
// event (a hostile probe, an attempt, the repel draw at one half), so a defense that moves the odds, or flips the
// event, reads live.
function probeShipScanEvents(t: Transform): string {
  return fp(
    dispatches(t).map(({ exp }) => {
      const body = syntheticBody("terrestrial", 0.4);
      const draws = { ...shipEventDraws(exp, 0, 1), kind: SHIP_EVENT_WEIGHTS.debris, boardingAttempt: 0, boardingRepel: SHIP_EVENT_DRAW_UNITS / 2 };
      return [boardingRepelChance(exp.groundOps!.shipEventProfile.boardingDefense), resolveShipScanEventFromDraws(exp, body, 0, 1, 0, draws).event];
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

export interface Probe {
  name: string;
  run: (t: Transform) => string;
}

// Cheapest first: a live effect stops at its first moving probe; a dead one runs them all.
export const PROBES: readonly Probe[] = [
  { name: "ship stats", run: probeSheet },
  { name: "reach", run: probeReach },
  { name: "repair time", run: probeRepair },
  { name: "ship battle", run: probeShipBattle },
  { name: "expedition readers", run: probeExpeditionReaders },
  { name: "injury recovery", run: probeInjuries },
  { name: "expedition battles", run: probeExpeditionBattles },
  { name: "field kits fights", run: probeFieldKitsFights },
  { name: "expedition run + claim", run: probeExpeditionRun },
  { name: "mission cycles", run: probeMissions },
  { name: "patrol run", run: probePatrol },
  { name: "patrol defeat repair", run: probePatrolDefeatRepair },
  { name: "ship scan events", run: probeShipScanEvents },
];

// ============================================================================
// The entries
// ============================================================================

export type Category = "officer" | "crew" | "racial" | "gear" | "facet";

export interface Variant {
  label: string;
  baseKey: string; // baselines with the same key share one cached fingerprint per probe
  base: Transform;
  with: Transform;
}

export interface StatEntry {
  id: string;
  category: Category;
  label: string;
  variants: Variant[];
}

export const SEATS = Object.keys(DEPARTMENT_OF_SEAT) as SeniorStaffSeat[];

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
    variants: [
      { label: profession, baseKey: `bucket-none@${profession}`, base: withBucket(NO_BONUS.id), with: withBucket(def.id) },
      // CP-2: a buff that LIFTS other buffs (Crew Effectiveness) shows only beside one, so every buff also gets a
      // variant whose two states both carry the lifted bucket (it adds the same thing to both).
      { label: `${profession} + ${LIFTED.buff1Id}`, baseKey: `bucket-none@${profession}+lifted`, base: withLifted(withBucket(NO_BONUS.id)), with: withLifted(withBucket(def.id)) },
    ],
  };
}

// CP-2: the bucket a lifting buff or racial is read beside (Efficient Unloading, a Spacer crew: its race lifts nothing).
const LIFTED: CrewBucket = { ...bucket("operations", "spacer", "ops.unloadSpeed", null) };
function withLifted(t: Transform): Transform {
  return (s0) => {
    const s = t(s0);
    const ship = shipOf(s);
    return editShip(s, { complement: { mode: "active", buckets: [...(ship.complement?.buckets ?? []), LIFTED] } });
  };
}

// racial bonuses: an officer of the race carrying no bonus vs no officer (and the same beside a lifted bucket, CP-2)
function racialEntry(race: CrewRace): StatEntry {
  const withOfficer: Transform = (s) => ({ ...s, officers: [officer("officer-1", "executive", [], race)] });
  return {
    id: `racial:${race}`,
    category: "racial",
    label: `${CREW_RACES[race].label} racial (${CREW_RACES[race].racialBonus.statKey})`,
    variants: [
      { label: race, baseKey: "no-officer", base: (s) => s, with: withOfficer },
      { label: `${race} + ${LIFTED.buff1Id}`, baseKey: "no-officer+lifted", base: withLifted((s) => s), with: withLifted(withOfficer) },
    ],
  };
}

// member gear: every wearable VARIETY's every rollable line, on its own, for every squad its teamTypes list
export function rollableKeys(slotType: MemberSlotType, variety: { implicitStats?: string[]; affixPool?: { stat: string }[] }): Set<string> {
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
export function wearOn(team: AwayTeamType, slotType: MemberSlotType, varietyKey: string, lines: Record<string, number>): Transform {
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
export const ROLLABLE_EXCLUSIVE = ROLLABLE_SECOND_LEVEL_EXCLUSIVE;

export const ENTRIES: readonly StatEntry[] = [
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
export function liveVia(entry: StatEntry): string | null {
  for (const variant of entry.variants) {
    for (const probe of PROBES) {
      if (probe.run(variant.with) !== fingerprint(probe, variant.baseKey, variant.base)) return `${variant.label} / ${probe.name}`;
    }
  }
  return null;
}

// The entry counts by category (the coverage test pins them; a new catalog entry changes one).
// Prospecting squads (hidden): gear 74 -> 99, the 25 Prospecting lines (eight Prospecting-only varieties plus the
// shared Hazard Suit and Environmental Adaptation worn by Prospecting), every one deferred to the quests patch.
// Field Kits FKR-5: gear 99 -> 104, the Impact Grenade's power and accuracy lines and the carry capacity line on all
// three grenades, every one live.
export const EXPECTED_COUNTS = { officer: 16, crew: 21, racial: 10, gear: 104, facet: 28 };

