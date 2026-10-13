// Ground Operations 0.14.0 (D25): the run-side engine of a Ground Ops expedition.
//
// GO-7a: the DISPATCH SNAPSHOT (below). GO-7b: startExpedition stores it as Expedition.groundOps (the flag) and
// the TIMELINE ENGINE further down resolves the run (see "GO-7b: THE TIMELINE ENGINE"). GO-7c: several teams,
// the default plan, helpers and joint tasks (see "SEVERAL TEAMS" there).
//
//   snapshotGroundOps(state, ship, run) -> { teams, factors, shipEventProfile }
//     teams   : the ship's DEPLOYING ground teams (groundTeams.ts deployableGroundTeams: every slotted member
//               ready AND a member in each of its squads, Squads SQ-2; no automatic stand-ins, user 2026-10-12;
//               D18 across the deploying teams is the dispatch gate's), ascending
//               ship team index, member ids in slot order, `helpOthers` from the ship, an empty queue, idle.
//     factors : FROZEN at dispatch (D24), so a ship whose crew, officers or captain change mid-run never
//               reshapes it (the same contract as the run's other snapshots):
//       medicalShare / rapidRecoveryShare : injuries.ts shipInjuryFactors (crew.reducedCrewLosses; the Rapid
//                                           Recovery officer, officerBonusTotal(officer.repairRateMult)).
//       officerFacetShare / injurySteady  : the run's frozen Medical facets (recoveryTurnaround + quickRecovery;
//                                           injurySteady), mapped by medicalBay.ts bayCareFrom, the ONE place
//                                           the bay mapping is written. GO-7b reads the bay care back with
//                                           groundOpsBayCare(factors) (the four fields, as they were frozen).
//       offloadMult : crewOverlay.ts effectiveShipStats(...).unloadSpeedMult (the crew Efficient Unloading and
//                     Veteran Instincts multiplier missions use; absent = 1). Divides the offload step.
//       reloadMult  : 1 + crew.loadSpeed (Rapid Loadout, shipCrewContribution) + Efficient Stowage (captain
//                     secondary talent logistics4, D26). Divides the reload step.
//       securityShare[i] / scienceShare[i] : deployed team i's share of the ship's crew layer = its squad size /
//                     every deployed squad of that type [PROPOSAL, Q20]. With one team both are [1], so every
//                     crew-layer read (exp.securityStrength x share, exp.scienceStrength x share) equals today.
//     shipEventProfile : NEUTRAL_SHIP_EVENT_PROFILE until GO-8 snapshots the real one.
//   snapshotAwayRosterForTeams(state, ship, teams) : the run's UNION roster (Expedition.roster): Security then
//     Science members of the deployed teams, team order then slot order. Scan readers keep reading exp.roster.
//
// Module graph (plan section 2): groundOps.ts imports model, awayTeam, groundTeams, medicalBay, injuries,
// crewOverlay, crewBuffs, and (GO-7b) groundTasks, groundFight, groundThreat, gambit, fieldwork. It NEVER imports
// expedition.ts (expedition.ts imports this; the scan side comes in as a GroundOpsScanDriver). PURE throughout.

import {
  SECONDARY_CAPTAIN_TALENTS,
  type AwayMember,
  type AwayRosterSnapshot,
  type AwayTeamType,
  type Expedition,
  type ExpeditionActivity,
  type ExpeditionBody,
  type ExpeditionFinding,
  type GameState,
  type GroundOpsFactors,
  type GroundOpsLogEntry,
  type GroundOpsState,
  type GroundShipLeg,
  type GroundStepKind,
  type GroundStepRecord,
  type GroundMemberEnd,
  type GroundTeamRun,
  type ShipEventProfile,
  type ShipInstance,
} from "./model";
import { snapshotMembers } from "./awayTeam";
import { deployableGroundTeams, shipGroundTeams } from "./groundTeams";
import { bayCareFrom, memberBaySeconds, type BayCare } from "./medicalBay";
import { shipInjuryFactors } from "./injuries";
import { effectiveShipStats, shipCrewContribution } from "./crewOverlay";
import { CREW_STAT_KEYS } from "./crewBuffs";
// GO-7b: the timeline engine's building blocks (GO-4 task model, GO-5 fight, GO-6 odds) and the legacy reward
// rolls one task keeps whichever engine resolves it.
import {
  fightPointCount,
  fightPointFractions,
  segmentCount,
  segmentHaul,
  taskFieldworkRun,
  taskFullHaul,
  taskWorkSeconds,
  type GroundTaskTeam,
  type TaskHaul,
} from "./groundTasks";
import { resolveTaskFight, taskFightSeconds, type GroundFightTeam } from "./groundFight";
import { HELPER_MIN_TIER, groundTaskClearOdds, groundTaskThreat } from "./groundThreat";
import { tierAtLeast } from "./combat/threatAssessment";
import { getPoiById } from "./expeditionContent";
import { activityRelicFindBonus, rollRelicToken, taskRelicSeed } from "./gambit";
import { fieldworkEffect } from "./fieldwork";

export type { GroundOpsFactors, GroundOpsLogEntry, GroundOpsState, GroundShipLeg, GroundStepKind, GroundStepRecord, GroundTeamRun, ShipEventProfile };

// What snapshotGroundOps returns; GO-7b wraps it into the stored GroundOpsState.
export interface GroundOpsSnapshot {
  teams: GroundTeamRun[];
  factors: GroundOpsFactors;
  shipEventProfile: ShipEventProfile;
}

// The run's frozen Medical facets snapshotGroundOps folds into the bay factors (startExpedition computes them
// at the same dispatch instant; quickRecovery is rolled on the run's seed, so it is passed in, never re-rolled).
export type GroundOpsRunFacets = Pick<Expedition, "recoveryTurnaround" | "quickRecovery" | "injurySteady">;

// The ship-event profile a run carries until GO-8 snapshots the real one. No reader exists yet; frozen so a
// snapshot can never mutate the shared value (snapshotGroundOps writes a fresh copy).
export const NEUTRAL_SHIP_EVENT_PROFILE: Readonly<ShipEventProfile> = Object.freeze({
  evasion: 0,
  sensors: 0,
  shieldCapacity: 0,
  engineering: 0,
  boardingDefense: 0,
});

// Efficient Stowage (captain secondary talent logistics4, "+pre-mission load speed"): D26 points it at the
// Ground Ops reload step. Read from the catalog entry (+0.08), so the data stays the one source. NOTE: the
// captain SECONDARY tree is otherwise DORMANT (captainSecondaryTree.ts: nothing else applies its nodes yet);
// this is its first and only live node. Rapid Turnaround (logistics3, unload) on the offload is Q22, unbuilt.
const STOWAGE_EFFECT = SECONDARY_CAPTAIN_TALENTS.logistics4.effect;
export const EFFICIENT_STOWAGE_RELOAD: number = STOWAGE_EFFECT.type === "statMult" ? STOWAGE_EFFECT.mult : 0;

// A multiplier that DIVIDES a step: a finite positive number, else 1 (a bad value never stalls or skips a step).
function stepMult(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 1;
}

// A non-negative finite share (a missing or bad value reads 0).
function nonNegative(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

// Each entry's share of the total (0 for every entry when the total is 0). Pure.
function sharesOf(counts: readonly number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  return counts.map((n) => (total > 0 ? n / total : 0));
}

// The reload divisor (see the header): 1 + Rapid Loadout + Efficient Stowage on the ship's ASSIGNED captain.
// Pure.
export function groundReloadMult(state: GameState, ship: ShipInstance): number {
  const loadSpeed = nonNegative(shipCrewContribution(state, ship)[CREW_STAT_KEYS.loadSpeed]);
  const captain = ship.assignedCaptainId === null ? undefined : state.captains.find((c) => c.id === ship.assignedCaptainId);
  const stowage = captain?.unlockedSecondaryTalents.includes("logistics4") ? EFFICIENT_STOWAGE_RELOAD : 0;
  return stepMult(1 + loadSpeed + stowage);
}

// The dispatch snapshot (see the header). `run` = the run's frozen Medical facets. Pure: fresh data, no live
// references, no randomness.
export function snapshotGroundOps(state: GameState, ship: ShipInstance, run: GroundOpsRunFacets): GroundOpsSnapshot {
  const now = state.gameTimeSeconds;
  const slots = shipGroundTeams(ship);
  const deploying = deployableGroundTeams(state, ship.id).teams.filter((t) => t.deploys);
  const teams: GroundTeamRun[] = deploying.map((t) => ({
    index: t.index,
    securityIds: t.security.map((m) => m.id),
    scienceIds: t.science.map((m) => m.id),
    helpOthers: slots[t.index]?.helpOthers === true,
    queue: [],
    step: "idle",
    stepStartedAt: now,
    stepEndsAt: null,
    skippedBorrowed: [],
    downedThisTask: [],
    conditions: {},
    bayEnds: {},
  }));
  const care = bayCareFrom(shipInjuryFactors(state, ship), run);
  const factors: GroundOpsFactors = {
    medicalShare: care.medicalShare,
    rapidRecoveryShare: care.rapidRecoveryShare,
    officerFacetShare: care.officerFacetShare,
    injurySteady: care.injurySteady,
    offloadMult: stepMult(effectiveShipStats(state, ship).unloadSpeedMult),
    reloadMult: groundReloadMult(state, ship),
    securityShare: sharesOf(teams.map((t) => t.securityIds.length)),
    scienceShare: sharesOf(teams.map((t) => t.scienceIds.length)),
  };
  return { teams, factors, shipEventProfile: { ...NEUTRAL_SHIP_EVENT_PROFILE } };
}

// The bay care a run's frozen factors carry (GO-7b passes it to medicalBay.ts memberBaySeconds). Pure.
export function groundOpsBayCare(factors: GroundOpsFactors): BayCare {
  return {
    medicalShare: factors.medicalShare,
    rapidRecoveryShare: factors.rapidRecoveryShare,
    officerFacetShare: factors.officerFacetShare,
    injurySteady: factors.injurySteady,
  };
}

// The run's UNION roster for the deployed `teams` (see the header): Security then Science, team order then
// slot order. An id that does not name a member aboard `ship` with that squad's type, or repeats, is skipped.
// Pure: fresh snapshot data (awayTeam.ts snapshotMembers, the same freeze as snapshotAwayRoster).
export function snapshotAwayRosterForTeams(
  state: GameState,
  ship: ShipInstance,
  teams: readonly Pick<GroundTeamRun, "securityIds" | "scienceIds">[],
): AwayRosterSnapshot {
  const byId = new Map(state.awayMembers.map((m) => [m.id, m] as const));
  const seen = new Set<string>();
  const pick = (teamType: AwayTeamType, ids: (t: Pick<GroundTeamRun, "securityIds" | "scienceIds">) => readonly string[]): AwayMember[] => {
    const out: AwayMember[] = [];
    for (const team of teams) {
      for (const id of ids(team)) {
        const m = byId.get(id);
        if (!m || seen.has(id) || m.assignedShipId !== ship.id || m.teamType !== teamType) continue;
        seen.add(id);
        out.push(m);
      }
    }
    return out;
  };
  const security = pick("security", (t) => t.securityIds);
  const science = pick("science", (t) => t.scienceIds);
  return { security: snapshotMembers(state, security), science: snapshotMembers(state, science) };
}

// ============================================================================
// GO-7b: THE TIMELINE ENGINE (one combined operations window), GO-7c: several teams
// ============================================================================
//
// A flagged run (Expedition.groundOps present) resolves its ground work as an EVENT SCHEDULE over absolute game
// time, advanced from stored values only, so one big advance equals many small ones (offline == live):
//
//   THE WINDOW (user Q1, 2026-10-12): scanning and task work share ONE operations window. It opens when the
//   scanning phase begins (GroundOpsState.startedAt = the scanning anchor). A team starts a body's tasks as
//   soon as THAT body's scan completes, while the ship scans the rest. It closes (endedAt) only when every
//   body is scanned AND no task is queued or active AND every team is idle, in the bay or reloading; the
//   return phase starts then. The expedition's phase still reads "scanning" until the last body is scanned and
//   "activities" after, so the old readers keep working.
//
//   SHIP POSITION + THE RECOVERY LEG (user Q1 rule: "the ship should have to return and retrieve the ground
//   team that ran into trouble, delaying the scanning steps"): while scanning, the ship is at the first body
//   not yet scanned; teams only work SCANNED bodies, so a working team is always elsewhere. A team WIPED in a
//   fight (every Security member down) cannot shuttle up on its own: the ship flies IN_SYSTEM_LEG_SECONDS to the
//   team's body (the team's return step ends when it arrives) and IN_SYSTEM_LEG_SECONDS back. While scanning it
//   breaks off its scan, which makes no progress for the whole leg (the SCAN CLOCK below stops), then resumes.
//   After the scan (user, GO-7b answers: "can't leave them to die") the ship still flies out from holding
//   station; nothing else is delayed. Legs never overlap: a wipe during a leg starts its leg when that one
//   ends. An ordinary return (the team shuttles up itself: a win, or a retreat at the round cap with someone
//   standing) takes RETURN_SECONDS and never delays the scan.
//
//   THE SCAN CLOCK: scan progress runs on clock seconds since the window opened, minus every leg. A scan event
//   at clock c happens at time startedAt + c + (the length of every leg that started before c). Recorded
//   pauses (Task 14, GO-8) stay on the clock, so they freeze during a leg too.
//
//   ORDER: the earliest pending event goes first. At one instant, scan events (step boundaries, a body's
//   completion) go before team step ends; team step ends at the same instant are processed together in
//   ascending team index (a batch); after every event or batch, idle teams pick their next task (team index
//   order) and the run-end condition is checked. Every stepEndsAt is written from the step's own start and
//   stored values (never from the advance's "now"), so chunking never changes a time.
//
//   THE TEAM STEP MACHINE: idle -> deploy (DEPLOY_SECONDS) -> work to the next fight point (or 100%) ->
//   fight (rounds x GROUND_ROUND_SECONDS; resolved at its START, applied at its END) -> work -> ... -> return
//   -> offload (OFFLOAD_BASE_SECONDS / offloadMult; skipped when nothing new was banked [PROVISIONAL]) -> bay
//   (the longest member condition; skipped at 0) -> reload (RELOAD_BASE_SECONDS / reloadMult) -> idle.
//     work end : the segment just finished is BANKED (its banking team recorded); at 100% the task is done.
//     fight end: conditions merge into the trip's bay list, the downed sit out the rest of the TASK (and their
//                suits stop counting toward task work). Win: the point is cleared and the standing members
//                CARRY their HP and persisting statuses into the task's next fight (user Q5). Loss: progress
//                holds at the point, the carry is dropped, the task goes back to queued, the team returns.
//     offload  : one finding per offloaded batch (the banked segments not yet offloaded), each segment's
//                share of the task's full haul at the yield of the team that banked it; the relic rolls on
//                the COMPLETING batch only (gambit.ts taskRelicSeed, the legacy relic stream of that task).
//     bay      : each member's own time (medicalBay.ts memberBaySeconds on the frozen factors); everyone is
//                healed at its end (conditions, the task's downed list and the carry are cleared).
//   A lost task is retried by its team after the bay, from the held progress, against a fresh encounter. After
//   GROUND_STUCK_LOSSES losses in a row it goes to the BACK of the team's queue so easier tasks get done first
//   (user, GO-7b answers); its streak resets when it is tried again, and its progress is kept as always. It
//   never gives up on its own (user Q4: HOLD AND FLAG; groundOpsStuck is the flag).
//
// PLANNING (planTasksForTeams): one team takes a body's new tasks EASIEST FIRST by groundTaskClearOdds (ties:
// discovery order) [PROVISIONAL, Q3]. 2+ teams (GO-7c, user 9b.3): THE DEFAULT PLAN, harder tasks to the
// stronger teams (see planTasksForTeams). A task needing more teams than the ship deployed is skipped with a
// log line (GroundOpsState.log, display only) [PROVISIONAL, Q20].
//
// SEVERAL TEAMS (GO-7c): every team runs its own step machine; ends at one instant are one batch in team index
// order, FIXED before any team moves (a step that moves a partner never makes it end mid-batch).
//   HELPERS (user D25 + 9b.4): a team with "help other teams" and nothing of its own to do borrows another
//     team's queued one-team task that rates at least HELPER_MIN_TIER for it (groundThreat.ts, the display
//     odds' stream). A helper win finishes the task; a helper LOSS never touches the owner's loss streak or
//     queue: the helper lists the task in skippedBorrowed (never borrowed again) and the owner gets it back,
//     progress kept.
//   JOINT TASKS (requiredTeams N, D25 "tasks scale to multiple ground teams"; wired, no content asks yet): a
//     team that picks one goes STAGING; when every team it is assigned to is staging, the LEAD (lowest index)
//     deploys and carries the joint work and fight steps for the whole crew (the Security squads fight as one
//     side, the Science fieldwork sums); partners mirror the lead's task in "staging" until the joint return,
//     then every team runs its own return trip, offload and bay. A segment is banked for the crew's team set
//     (segmentBankers), and the offload pays that set's yield. A loss counts once; at GROUND_STUCK_LOSSES the
//     task goes to the back of every crew team's queue.
//   RECOVERY LEGS: the ship flies one leg at a time; when several teams wipe, each waits for its own pickup in
//     wipe order (a joint wipe: one leg per wiped team, team index order) [PROVISIONAL]; a helper is a team
//     like any other.
//
// DETERMINISM: no new salt. A task fight rolls on its keyed stream (groundFight.ts), the haul on the task's
// reward stream and the relic on its relic stream (gambit.ts), the plan's odds on the threat stream
// (groundThreat.ts). The scan side (step boundaries, a body's completion) is expedition.ts's, passed in as a
// GroundOpsScanDriver so this module never imports expedition.ts.

// ===== Constants (FIRST-PASS TUNABLE; each [PROVISIONAL] lives in this one place) =====

export const DEPLOY_SECONDS = 60; // drop to the surface [PROVISIONAL, Q7]
export const RETURN_SECONDS = 60; // shuttle back up on its own [PROVISIONAL, Q7]
export const OFFLOAD_BASE_SECONDS = 120; // divided by GroundOpsFactors.offloadMult [PROVISIONAL, Q7]
export const RELOAD_BASE_SECONDS = 120; // divided by GroundOpsFactors.reloadMult [PROVISIONAL, Q7]
// One in-system leg of the ship (its scan position to a team's body, or back) [PROVISIONAL]. A recovery leg is
// two of these, so the scan pauses 2 x this per wipe while scanning.
export const IN_SYSTEM_LEG_SECONDS = 300;
// After this many consecutive failed attempts that cleared no new fight point a task goes to the back of its
// team's queue and counts as stuck (user, GO-7b answers: 3).
export const GROUND_STUCK_LOSSES = 3;
// Display history records kept per team (oldest dropped). Resolution never reads history.
export const GROUND_HISTORY_CAP = 200;

// Event-time comparisons tolerate a sub-tick float residue (expedition.ts PHASE_EPS, same value).
const EVENT_EPS = 1e-6;
// A bound on events per advance: a long offline window is a few thousand; this only catches a logic error.
const WINDOW_GUARD = 5_000_000;

// ===== The scan side (expedition.ts implements it) =====

// What the window needs from the scan, which expedition.ts owns: the absolute time of the next scan event (a
// step boundary or a body's completion, through scanClockToTime), processing exactly that event (a completed
// body calls groundOpsBodyScanned), and hours since dispatch at a time (the ramps' clock).
export interface GroundOpsScanDriver {
  nextScanEventAt(exp: Expedition): number | null; // null = every body is scanned
  processScanEvent(exp: Expedition): void;
  hoursAt(exp: Expedition, t: number): number;
}

// ===== The stored record =====

// The record startExpedition stores: the dispatch snapshot plus the empty timeline. Pure.
export function newGroundOpsState(snapshot: GroundOpsSnapshot): GroundOpsState {
  return { version: 1, ...snapshot, editCount: 0, history: [], shipLegs: [] };
}

// A deep copy (plain JSON-safe data; advanceExpedition never mutates its input). Pure.
export function cloneGroundOps(ops: GroundOpsState): GroundOpsState {
  return structuredClone(ops);
}

// ===== The scan clock (see the header) =====

// The absolute time of scan clock `c` (seconds of scan time since the window opened). Pure.
export function scanClockToTime(ops: Pick<GroundOpsState, "startedAt" | "shipLegs">, c: number): number {
  const start = ops.startedAt ?? 0;
  let shift = 0;
  for (const leg of ops.shipLegs) {
    if (leg.scanBodyIndex === null) continue; // a leg after the scan pauses nothing
    if (leg.startsAt - start - shift < c) shift += leg.endsAt - leg.startsAt;
    else break;
  }
  return start + c + shift;
}

// The scan clock at absolute time `t`: seconds since the window opened, minus every leg's overlap. Pure.
export function scanClockAt(ops: Pick<GroundOpsState, "startedAt" | "shipLegs">, t: number): number {
  const start = ops.startedAt ?? 0;
  let away = 0;
  for (const leg of ops.shipLegs) {
    if (leg.scanBodyIndex === null) continue; // a leg after the scan pauses nothing
    if (leg.startsAt >= t) break;
    away += Math.min(t, leg.endsAt) - leg.startsAt;
  }
  return Math.max(0, t - start - away);
}

// Where the ship is at `t` (display, GO-14): scanning a body, away on a recovery leg, or holding station once
// the scan is done. Reads the stored legs and the bodies' scanned latches. Pure.
export type GroundShipPosition =
  | { kind: "scanning"; bodyIndex: number }
  | { kind: "recovery"; leg: GroundShipLeg }
  | { kind: "holding" };
export function groundShipPosition(exp: Pick<Expedition, "groundOps" | "bodies">, t: number): GroundShipPosition {
  const leg = exp.groundOps?.shipLegs.find((l) => l.startsAt <= t && t < l.endsAt);
  if (leg) return { kind: "recovery", leg };
  const scanning = exp.bodies.findIndex((b) => !b.scanned);
  return scanning >= 0 ? { kind: "scanning", bodyIndex: scanning } : { kind: "holding" };
}

// ===== Task lookup =====

export interface GroundTaskRef {
  body: ExpeditionBody;
  bodyIndex: number;
  task: ExpeditionActivity;
  flatIndex: number; // the task's flat index across bodies (the reward and fight seeds' key)
}

// The task with `taskId` and where it sits, or null. Pure.
export function findGroundTask(exp: Pick<Expedition, "bodies">, taskId: string): GroundTaskRef | null {
  let flat = 0;
  for (let b = 0; b < exp.bodies.length; b += 1) {
    const body = exp.bodies[b];
    for (const task of body.activities) {
      if (task.id === taskId) return { body, bodyIndex: b, task, flatIndex: flat };
      flat += 1;
    }
  }
  return null;
}

// Is this a Ground Ops task (stamped when its body's scan completed)? Pure.
function isGroundTask(task: ExpeditionActivity): boolean {
  return task.status !== undefined;
}

// ===== Team views (the shapes groundTasks.ts / groundFight.ts take) =====

function teamPos(ops: GroundOpsState, team: GroundTeamRun): number {
  return ops.teams.indexOf(team);
}

// The team as a task fight's side: its Security members, the task's sit-out list (none for a fresh read), its
// Security share.
function fightTeamOf(ops: GroundOpsState, team: GroundTeamRun, fresh = false): GroundFightTeam {
  return {
    securityIds: team.securityIds,
    downedThisTask: fresh ? [] : team.downedThisTask,
    securityShare: ops.factors.securityShare[teamPos(ops, team)] ?? 0,
  };
}

// The team as a task's work crew: only members still STANDING in the task (a downed member sits out the rest
// of the task, so their suit stops counting toward task work; GO-4 ruling (c)), with its Science share.
function workTeamOf(ops: GroundOpsState, team: GroundTeamRun): GroundTaskTeam {
  const out = new Set(team.downedThisTask);
  return {
    securityIds: team.securityIds.filter((id) => !out.has(id)),
    scienceIds: team.scienceIds,
    scienceShare: ops.factors.scienceShare[teamPos(ops, team)] ?? 0,
  };
}

// The team set that banked segment `s` of `task`, as task teams (the yield at offload). Pure.
function bankingTeams(ops: GroundOpsState, task: ExpeditionActivity, s: number, fallback: GroundTeamRun): GroundTaskTeam[] {
  const ids = task.segmentBankers?.[s] ?? [fallback.index];
  const out: GroundTaskTeam[] = [];
  for (const i of ids) {
    const tm = ops.teams.find((x) => x.index === i);
    if (tm) out.push({ securityIds: tm.securityIds, scienceIds: tm.scienceIds, scienceShare: ops.factors.scienceShare[teamPos(ops, tm)] ?? 0 });
  }
  return out;
}

// ===== Task stamping and planning (a body's scan completes) =====

// Stamp every activity of body `bodyIndex` as a Ground Ops task (plan section 2): the teams it needs (a
// content value that is a whole number >= 1 is kept, else 1; GO-7c wiring, no content asks for more yet), its
// fight points from the site's threat on the body's RAW hazard, nothing done yet, queued. Idempotent (a stamped
// task is left alone). Mutates the working clone.
export function initGroundTasks(exp: Expedition, bodyIndex: number): void {
  const body = exp.bodies[bodyIndex];
  if (!body) return;
  for (const task of body.activities) {
    if (isGroundTask(task)) continue;
    task.requiredTeams = requiredTeamsOf(task);
    task.fightPoints = fightPointFractions(fightPointCount(task.poiId, body.hazard));
    task.progress = 0;
    task.pointsCleared = 0;
    task.segmentsBanked = 0;
    task.segmentsOffloaded = 0;
    task.fightCount = 0;
    task.status = "queued";
  }
}

// The ground teams a task needs together: its requiredTeams when that is a whole number >= 1, else 1. Pure.
// SQUAD REDESIGN AHEAD: ground teams become mix-and-match SQUADS and tasks will state SQUAD requirements instead
// of a team count (docs/plans/2026-10-09-relics-v2-and-expedition-tiers-capture.md section 3b item 10). The
// joint-task wiring here carries forward into that redesign (several strike squads on one task).
export function requiredTeamsOf(task: Pick<ExpeditionActivity, "requiredTeams">): number {
  const n = task.requiredTeams;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 ? n : 1;
}

// Queue body `bodyIndex`'s new tasks at `t` (see the header: PLANNING). A task needing more teams than the ship
// deployed is skipped with a log line [PROVISIONAL, Q20]; with no deployed team every task is skipped (nobody
// could ever work them; unreachable past the D18 gate). Mutates the working clone.
export function planNewTasks(exp: Expedition, bodyIndex: number, t: number): void {
  const ops = exp.groundOps;
  const body = exp.bodies[bodyIndex];
  if (!ops || !body) return;
  const queued = new Set(ops.teams.flatMap((team) => team.queue));
  const fresh = body.activities.filter((task) => task.status === "queued" && !queued.has(task.id));
  if (fresh.length === 0) return;
  if (ops.teams.length === 0) {
    for (const task of fresh) task.status = "skipped";
    return;
  }
  const playable: GroundTaskRef[] = [];
  for (const task of fresh) {
    const required = requiredTeamsOf(task);
    if (required > ops.teams.length) {
      task.status = "skipped";
      pushLog(ops, { at: t, kind: "skippedNeedsTeams", taskId: task.id, requiredTeams: required, deployedTeams: ops.teams.length });
      continue;
    }
    const ref = findGroundTask(exp, task.id);
    if (ref) playable.push(ref);
  }
  planTasksForTeams(exp, playable);
}

// Append one display line to the run's log. Mutates.
function pushLog(ops: GroundOpsState, entry: GroundOpsLogEntry): void {
  (ops.log ??= []).push(entry);
}

// A log line in plain words (the UI shows it). Pure.
export function groundOpsLogText(exp: Pick<Expedition, "bodies">, entry: GroundOpsLogEntry): string {
  switch (entry.kind) {
    case "skippedNeedsTeams": {
      const task = findGroundTask(exp, entry.taskId)?.task;
      const name = (task && getPoiById(task.poiId)?.label) ?? "A task";
      return `Skipped ${name}: needs ${entry.requiredTeams} ground teams, ${entry.deployedTeams} deployed`;
    }
  }
}

// How many of the threat samples `teams` (fresh: full HP, nobody sitting out) clear `ref` in one go (the
// display odds' stream, groundThreat.ts; a read never shifts a real fight). Pure.
function freshWins(exp: Expedition, ops: GroundOpsState, teams: readonly GroundTeamRun[], ref: GroundTaskRef): number {
  return groundTaskClearOdds(exp, teams.map((team) => fightTeamOf(ops, team, true)), ref.body, ref.task, ref.flatIndex).wins;
}

// THE DEFAULT PLAN (user 9b.3) for `refs` (one body's new, playable tasks, discovery order): appends them to the
// deployed teams' queues and records each task's owner team(s) (assignedTeamIds). Exported so GO-7d's
// "Default plan" edit can re-run it. Mutates the working clone.
//   One team: every task to it, EASIEST FIRST by its clear odds (ties: discovery order) [PROVISIONAL, Q3].
//   2+ teams: teams ranked by their MEAN clear rate over the tasks, strongest first (ties: team index); the
//     one-team tasks sorted HARDEST first by the strongest team's odds (ties: discovery order); the strongest
//     team takes the hardest ceil(n / teams), the next team the next ones, and so on ("harder tasks to A,
//     middling to B, easy to C"). A task needing N teams goes to the N strongest [PROVISIONAL]. Each team's
//     new tasks are appended EASIEST FIRST by its own odds (a joint task's odds are its whole team set's).
export function planTasksForTeams(exp: Expedition, refs: readonly GroundTaskRef[]): void {
  const ops = exp.groundOps;
  if (!ops || ops.teams.length === 0 || refs.length === 0) return;
  const order = new Map(refs.map((ref, k) => [ref.task.id, k] as const));
  const give = new Map<GroundTeamRun, { ref: GroundTaskRef; wins: number }[]>(ops.teams.map((team) => [team, []] as const));
  if (ops.teams.length === 1) {
    const team = ops.teams[0];
    for (const ref of refs) give.get(team)!.push({ ref, wins: freshWins(exp, ops, [team], ref) });
  } else {
    const wins = new Map<GroundTeamRun, number[]>(ops.teams.map((team) => [team, refs.map((ref) => freshWins(exp, ops, [team], ref))] as const));
    const mean = (team: GroundTeamRun) => wins.get(team)!.reduce((a, b) => a + b, 0) / refs.length;
    const ranked = [...ops.teams].sort((a, b) => mean(b) - mean(a) || a.index - b.index);
    const strongest = wins.get(ranked[0])!;
    const solo = refs.map((ref, k) => ({ ref, k })).filter(({ ref }) => requiredTeamsOf(ref.task) === 1);
    solo.sort((a, b) => strongest[a.k] - strongest[b.k] || a.k - b.k);
    const per = Math.ceil(solo.length / ranked.length);
    solo.forEach(({ ref, k }, n) => {
      const team = ranked[Math.min(ranked.length - 1, Math.floor(n / per))];
      give.get(team)!.push({ ref, wins: wins.get(team)![k] });
    });
    for (const ref of refs) {
      const required = requiredTeamsOf(ref.task);
      if (required === 1) continue;
      const crew = ranked.slice(0, required).sort((a, b) => a.index - b.index);
      const joint = freshWins(exp, ops, crew, ref);
      for (const team of crew) give.get(team)!.push({ ref, wins: joint });
    }
  }
  for (const team of ops.teams) {
    const mine = give.get(team)!;
    mine.sort((a, b) => b.wins - a.wins || order.get(a.ref.task.id)! - order.get(b.ref.task.id)!);
    for (const { ref } of mine) team.queue.push(ref.task.id);
  }
  for (const ref of refs) {
    const owners = ops.teams.filter((team) => give.get(team)!.some((g) => g.ref === ref)).map((team) => team.index);
    ref.task.assignedTeamIds = owners;
  }
}

// A body's scan just completed at `t` (expedition.ts calls this right after assigning its discoveries): stamp
// and plan its tasks. The FIRST completed body is the moment the teams can first act, so every idle team's
// stepStartedAt moves there (not dispatch; GO-7a review). Mutates the working clone.
export function groundOpsBodyScanned(exp: Expedition, bodyIndex: number, t: number): void {
  const ops = exp.groundOps;
  if (!ops) return;
  if (exp.bodies.filter((b) => b.scanned).length === 1) {
    for (const team of ops.teams) if (team.step === "idle") team.stepStartedAt = t;
  }
  initGroundTasks(exp, bodyIndex);
  planNewTasks(exp, bodyIndex, t);
}

// ===== The window loop =====

// The earliest stepEndsAt among the teams, or null when every team is open-ended. Pure.
function nextTeamEnd(ops: GroundOpsState): number | null {
  let best: number | null = null;
  for (const team of ops.teams) if (team.stepEndsAt !== null && (best === null || team.stepEndsAt < best)) best = team.stepEndsAt;
  return best;
}

// Advance the run's operations window to `now` (see the header). Processes every event at or before now in
// order; stops at the first later one, or once the window has closed. Mutates the working clone (expedition.ts
// advanceExpedition's), never a stored record.
export function advanceGroundOpsWindow(exp: Expedition, now: number, driver: GroundOpsScanDriver): void {
  const ops = exp.groundOps;
  if (!ops || ops.startedAt === undefined || !Number.isFinite(now)) return;
  for (let guard = 0; guard < WINDOW_GUARD; guard += 1) {
    if (ops.endedAt !== undefined) return;
    const tScan = driver.nextScanEventAt(exp);
    const tTeam = nextTeamEnd(ops);
    const t = tScan === null ? tTeam : tTeam === null ? tScan : Math.min(tScan, tTeam);
    if (t === null || t > now + EVENT_EPS) return;
    if (tScan !== null && (tTeam === null || tScan <= tTeam)) {
      driver.processScanEvent(exp);
    } else {
      // The batch is fixed before any team moves: an end at `t` that processing creates (a zero-length step,
      // or GO-7c's joint steps touching a partner) waits for the next pass at the same instant, never mid-loop.
      // A team a batch-mate's step moved (a joint return moves the partners) is left for the next pass too.
      const batch = ops.teams.filter((team) => team.stepEndsAt === t).map((team) => ({ team, step: team.step, from: team.stepStartedAt }));
      for (const { team, step, from } of batch) if (team.step === step && team.stepStartedAt === from) endStep(exp, team, t, driver);
    }
    groundOpsAssignIdle(exp, t);
    checkRunEnd(exp, t);
  }
}

// Every idle team picks its next work at `t`, in two passes (team index order each). The window runs it after
// every event; GO-7d's live edits run it at the edit instant. Mutates the working clone.
//   Pass 1, OWN WORK: a team first JOINS a joint task a partner is already staging for (so two joint tasks can
//     never wait on each other: a team only starts staging when no staged partner waits for it), else takes
//     the first queued task of its own queue: a one-team task deploys at once; a joint task (requiredTeams 2+)
//     goes to STAGING, and when every team it is assigned to is staging the LEAD (lowest index) deploys.
//   Pass 2, HELPERS (user D25 + 9b.4): a team still idle (nothing of its own to do) with helpOthers BORROWS the
//     first task (other teams in index order, their queue order) that is queued, needs one team, is not on its
//     skippedBorrowed list and rates at least HELPER_MIN_TIER for it from the task's current progress. Own
//     work goes first, so a helper never takes a task from an owner who is free to work it.
export function groundOpsAssignIdle(exp: Expedition, t: number): void {
  const ops = exp.groundOps;
  if (!ops) return;
  for (const team of ops.teams) {
    if (team.step !== "idle") continue;
    const join = joinableTask(exp, ops, team);
    if (join) {
      stageOn(ops, team, join, t);
      continue;
    }
    let next: GroundTaskRef | null = null;
    for (const id of team.queue) {
      const ref = findGroundTask(exp, id);
      // A joint task this team is not assigned to is never staged by it (it could wait forever).
      if (ref && ref.task.status === "queued" && (requiredTeamsOf(ref.task) === 1 || (ref.task.assignedTeamIds ?? []).includes(team.index))) {
        next = ref;
        break;
      }
    }
    if (!next) continue;
    next.task.status = "active";
    // Tried again after going to the back of the line: a fresh streak (user, GO-7b answers).
    if ((next.task.lossStreak ?? 0) >= GROUND_STUCK_LOSSES) delete next.task.lossStreak;
    if (requiredTeamsOf(next.task) > 1) {
      stageOn(ops, team, next, t);
      continue;
    }
    team.taskId = next.task.id;
    team.attemptPoints = next.task.pointsCleared ?? 0;
    moveTo(ops, team, "deploy", t, t + DEPLOY_SECONDS);
  }
  for (const team of ops.teams) {
    if (team.step !== "idle" || !team.helpOthers) continue;
    const ref = borrowableTask(exp, ops, team);
    if (!ref) continue;
    ref.task.status = "active";
    team.taskId = ref.task.id;
    team.borrowed = true;
    team.attemptPoints = ref.task.pointsCleared ?? 0;
    moveTo(ops, team, "deploy", t, t + DEPLOY_SECONDS);
  }
}

// Is joint task `taskId` still WAITING for its teams (somebody is staging on it and nobody has deployed on it
// yet)? Pure.
function jointWaiting(ops: GroundOpsState, taskId: string): boolean {
  let staging = false;
  for (const team of ops.teams) {
    if (team.taskId !== taskId) continue;
    if (team.step === "staging") staging = true;
    else if (team.step === "deploy" || team.step === "work" || team.step === "fight") return false;
  }
  return staging;
}

// The joint task a partner is staging for that lists `team` and still waits for it: its own queue order first,
// then by the staging team's index. Pure.
function joinableTask(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun): GroundTaskRef | null {
  const ids = [...team.queue, ...ops.teams.filter((x) => x.step === "staging" && x.taskId !== undefined).map((x) => x.taskId as string)];
  for (const id of ids) {
    const ref = findGroundTask(exp, id);
    if (!ref || ref.task.status !== "active" || requiredTeamsOf(ref.task) < 2) continue;
    if (!(ref.task.assignedTeamIds ?? []).includes(team.index) || !jointWaiting(ops, id)) continue;
    return ref;
  }
  return null;
}

// SQUAD REDESIGN AHEAD: ground teams become mix-and-match SQUADS and tasks will state SQUAD requirements instead
// of a team count (docs/plans/2026-10-09-relics-v2-and-expedition-tiers-capture.md section 3b item 10). The
// joint-task wiring here carries forward into that redesign (several strike squads on one task).
// `team` stages on joint task `ref` at `t`; once every team the task is assigned to is staging on it (at least
// requiredTeams of them), the LEAD (the lowest index) deploys and the partners stay "staging" (mirroring the
// lead's task) until the joint return. Mutates.
function stageOn(ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number): void {
  team.taskId = ref.task.id;
  team.attemptPoints = ref.task.pointsCleared ?? 0;
  moveTo(ops, team, "staging", t, null);
  const assigned = ref.task.assignedTeamIds ?? [];
  const crew = ops.teams.filter((x) => assigned.includes(x.index));
  if (crew.length < requiredTeamsOf(ref.task)) return;
  if (!crew.every((x) => x.step === "staging" && x.taskId === ref.task.id)) return;
  moveTo(ops, crew[0], "deploy", t, t + DEPLOY_SECONDS);
}

// The task a helper borrows (see groundOpsAssignIdle pass 2), or null. Pure (the odds read is memoized).
function borrowableTask(exp: Expedition, ops: GroundOpsState, helper: GroundTeamRun): GroundTaskRef | null {
  const side = [fightTeamOf(ops, helper, true)];
  for (const owner of ops.teams) {
    if (owner === helper) continue;
    for (const id of owner.queue) {
      if (helper.skippedBorrowed.includes(id)) continue;
      const ref = findGroundTask(exp, id);
      if (!ref || ref.task.status !== "queued" || requiredTeamsOf(ref.task) !== 1) continue;
      if (tierAtLeast(groundTaskThreat(exp, side, ref.body, ref.task, ref.flatIndex).tier, HELPER_MIN_TIER)) return ref;
    }
  }
  return null;
}

// The teams ON the task `lead` carries: the lead plus the partners mirroring it ("staging" on the same task),
// ascending index. A one-team task: just the lead. Pure.
function crewOf(ops: GroundOpsState, lead: GroundTeamRun): GroundTeamRun[] {
  if (lead.taskId === undefined) return [lead];
  return ops.teams.filter((team) => team === lead || (team.step === "staging" && team.taskId === lead.taskId));
}

// The crew team a member belongs to (its Security or Science squad), else the lead. Pure.
function memberTeam(crew: readonly GroundTeamRun[], memberId: string): GroundTeamRun {
  return crew.find((team) => team.securityIds.includes(memberId) || team.scienceIds.includes(memberId)) ?? crew[0];
}

// The crew's in-task carry as one record (a one-team crew: its own, unchanged). Pure.
function crewCarry(crew: readonly GroundTeamRun[]): GroundTeamRun["carry"] {
  if (crew.length === 1) return crew[0].carry;
  let out: GroundTeamRun["carry"];
  for (const team of crew) if (team.carry) out = { ...(out ?? {}), ...team.carry };
  return out;
}

// The run-end condition (see the header); sets endedAt once. Mutates.
function checkRunEnd(exp: Expedition, t: number): void {
  const ops = exp.groundOps;
  if (!ops || ops.endedAt !== undefined) return;
  if (!exp.bodies.every((b) => b.scanned)) return;
  for (const body of exp.bodies) {
    for (const task of body.activities) if (task.status === "queued" || task.status === "active") return;
  }
  if (!ops.teams.every((team) => team.step === "idle" || team.step === "bay" || team.step === "reload")) return;
  ops.endedAt = t;
}

// ===== The team step machine =====

// Close the team's current step at `t` into the display history (a zero-length idle or staging is not recorded) and
// start `step`, ending at `endsAt` (null = open-ended). `rec` adds to the CLOSED step's record. Mutates.
function moveTo(
  ops: GroundOpsState,
  team: GroundTeamRun,
  step: GroundStepKind,
  t: number,
  endsAt: number | null,
  rec: Partial<GroundStepRecord> = {},
): void {
  if (!((team.step === "idle" || team.step === "staging") && team.stepStartedAt === t)) {
    pushHistory(ops, {
      teamIndex: team.index,
      step: team.step,
      startedAt: team.stepStartedAt,
      endedAt: t,
      ...(team.taskId !== undefined && team.step !== "idle" ? { taskId: team.taskId } : {}),
      ...rec,
    });
  }
  team.step = step;
  team.stepStartedAt = t;
  team.stepEndsAt = endsAt;
}

// Append one display record, dropping the team's oldest past GROUND_HISTORY_CAP. Mutates.
function pushHistory(ops: GroundOpsState, rec: GroundStepRecord): void {
  let count = 0;
  for (const r of ops.history) if (r.teamIndex === rec.teamIndex) count += 1;
  if (count >= GROUND_HISTORY_CAP) {
    const oldest = ops.history.findIndex((r) => r.teamIndex === rec.teamIndex);
    if (oldest >= 0) ops.history.splice(oldest, 1);
  }
  ops.history.push(rec);
}

// The team's current step ends at `t`: move it on. Mutates.
function endStep(exp: Expedition, team: GroundTeamRun, t: number, driver: GroundOpsScanDriver): void {
  const ops = exp.groundOps as GroundOpsState;
  const ref = team.taskId === undefined ? null : findGroundTask(exp, team.taskId);
  switch (team.step) {
    case "deploy":
      return ref ? beginOnTask(exp, ops, team, ref, t) : toIdle(ops, team, t);
    case "work":
      return ref ? finishWork(exp, ops, team, ref, t) : toIdle(ops, team, t);
    case "fight":
      return ref ? finishFight(exp, ops, team, ref, t) : toIdle(ops, team, t);
    case "return":
      return finishReturn(exp, ops, team, ref, t);
    case "offload":
      if (ref) offloadFindings(exp, ops, team, ref, t, driver);
      return startBay(exp, ops, team, t);
    case "bay":
      return finishBay(ops, team, t);
    case "reload":
      return toIdle(ops, team, t);
    case "idle":
    case "staging":
      return;
  }
}

// On the task at `t` (after the drop): a fight waits at the held progress (a retry resumes AT the point that
// beat the team), else work to the next point or 100%.
function beginOnTask(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number): void {
  const points = ref.task.fightPoints ?? [];
  const cleared = ref.task.pointsCleared ?? 0;
  if (cleared < points.length && (ref.task.progress ?? 0) >= points[cleared]) return startFight(exp, ops, team, ref, t);
  startWork(exp, ops, team, ref, t);
}

// Work from the task's progress to its next fight point (or 100%): (to - from) of the task's full work time
// for the crew's members still standing (a joint task: every team's, the Science fieldwork summed), whole
// seconds, at least 1. `team` is the crew's lead.
function startWork(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number, rec: Partial<GroundStepRecord> = {}): void {
  const points = ref.task.fightPoints ?? [];
  const cleared = ref.task.pointsCleared ?? 0;
  const from = ref.task.progress ?? 0;
  const to = cleared < points.length ? points[cleared] : 1;
  const full = taskWorkSeconds(exp, crewOf(ops, team).map((member) => workTeamOf(ops, member)), ref.body);
  team.workFrom = from;
  team.workTo = to;
  moveTo(ops, team, "work", t, t + Math.max(1, Math.round((to - from) * full)), rec);
}

// Work reached its target: bank the segment just finished (segment index = the points cleared so far) for the
// crew's team set, then the task is done at 100% (every crew team returns) or a fight waits at the point.
function finishWork(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number): void {
  const task = ref.task;
  const crew = crewOf(ops, team);
  const to = team.workTo ?? task.progress ?? 0;
  task.progress = to;
  const segment = task.pointsCleared ?? 0;
  const bankers = task.segmentBankers ?? [];
  bankers[segment] = crew.map((member) => member.index);
  task.segmentBankers = bankers;
  task.segmentsBanked = Math.max(task.segmentsBanked ?? 0, segment + 1);
  delete team.workFrom;
  delete team.workTo;
  if (to >= 1) {
    task.status = "done";
    task.done = true;
    task.completedAt = t;
    for (const member of crew) startReturn(exp, ops, member, ref, t, false);
    return;
  }
  startFight(exp, ops, team, ref, t);
}

// A fight starts: resolved now on its keyed stream, with the crew's carry (user Q5); applied at its end. A
// joint task's Security squads fight as ONE side (groundFight.ts taskFightTeam: team then slot order).
function startFight(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number): void {
  const crew = crewOf(ops, team);
  const record = resolveTaskFight(exp, crew.map((member) => fightTeamOf(ops, member)), ref.body, ref.task, ref.flatIndex, crewCarry(crew));
  ref.task.fightCount = (ref.task.fightCount ?? 0) + 1;
  team.pendingFight = record;
  moveTo(ops, team, "fight", t, t + taskFightSeconds(record));
}

// A fight ends: apply its record (see the header). Each member's conditions, downed state and carry land on
// the crew team it belongs to. A loss sends every crew team back on its own return trip: a team whose own
// Security squad is all down waits for the ship (a recovery leg each, serialized). A HELPER's loss never counts
// toward the owner's loss streak or moves the task in the owner's queue: the helper puts it on its
// skippedBorrowed list (never borrowed again) and the task is queued for its owner, progress kept.
function finishFight(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number): void {
  const record = team.pendingFight;
  delete team.pendingFight;
  const crew = crewOf(ops, team);
  if (!record) {
    for (const member of crew) startReturn(exp, ops, member, ref, t, false);
    return;
  }
  for (const [memberId, ids] of Object.entries(record.memberConditions)) {
    const owner = memberTeam(crew, memberId);
    const merged = owner.conditions[memberId] ?? [];
    for (const id of ids) if (!merged.includes(id)) merged.push(id);
    owner.conditions[memberId] = merged;
  }
  for (const id of record.downedMemberIds) {
    const owner = memberTeam(crew, id);
    if (!owner.downedThisTask.includes(id)) owner.downedThisTask.push(id);
  }
  const task = ref.task;
  if (record.outcome === "win") {
    task.pointsCleared = (task.pointsCleared ?? 0) + 1;
    delete task.lossStreak;
    delete task.sentBack;
    if (crew.length === 1) team.carry = structuredClone(record.memberEnd);
    else {
      for (const member of crew) {
        const mine: Record<string, GroundMemberEnd> = {};
        for (const [id, end] of Object.entries(record.memberEnd)) if (memberTeam(crew, id) === member) mine[id] = structuredClone(end);
        member.carry = mine;
      }
    }
    return startWork(exp, ops, team, ref, t, { outcome: "win" });
  }
  for (const member of crew) delete member.carry;
  task.status = "queued";
  if (team.borrowed) {
    if (!team.skippedBorrowed.includes(task.id)) team.skippedBorrowed.push(task.id);
  } else {
    const progressed = (task.pointsCleared ?? 0) > (team.attemptPoints ?? 0);
    const streak = progressed ? 0 : (task.lossStreak ?? 0) + 1;
    if (streak > 0) task.lossStreak = streak;
    else delete task.lossStreak;
    if (streak >= GROUND_STUCK_LOSSES) {
      // BACK OF THE LINE (user, GO-7b answers): easier tasks in the owner's queue go first; this one comes
      // around again. A joint task moves in every crew team's queue.
      for (const member of crew) if (member.queue.includes(task.id)) member.queue = [...member.queue.filter((id) => id !== task.id), task.id];
      task.sentBack = (task.sentBack ?? 0) + 1;
    }
  }
  for (const member of crew) {
    const out = new Set(member.downedThisTask);
    startReturn(exp, ops, member, ref, t, member.securityIds.every((id) => out.has(id)), member === team ? { outcome: "loss" } : {});
  }
}

// Back to the ship. A WIPE is a RECOVERY LEG (see the header): the team's return ends when the ship arrives;
// while scanning the scan pauses for the leg. Anything else is an ordinary RETURN_SECONDS shuttle.
function startReturn(
  exp: Expedition,
  ops: GroundOpsState,
  team: GroundTeamRun,
  ref: GroundTaskRef,
  t: number,
  wiped: boolean,
  rec: Partial<GroundStepRecord> = {},
): void {
  const scanning = exp.bodies.findIndex((b) => !b.scanned);
  if (wiped) {
    const last = ops.shipLegs[ops.shipLegs.length - 1];
    const startsAt = last !== undefined && last.endsAt > t ? last.endsAt : t;
    const leg: GroundShipLeg = {
      kind: "recovery",
      teamIndex: team.index,
      bodyIndex: ref.bodyIndex,
      scanBodyIndex: scanning >= 0 ? scanning : null,
      startsAt,
      arrivesAt: startsAt + IN_SYSTEM_LEG_SECONDS,
      endsAt: startsAt + 2 * IN_SYSTEM_LEG_SECONDS,
    };
    ops.shipLegs.push(leg);
    return moveTo(ops, team, "return", t, leg.arrivesAt, rec);
  }
  moveTo(ops, team, "return", t, t + RETURN_SECONDS, rec);
}

// Aboard: offload when the trip banked something not yet offloaded [PROVISIONAL: else straight to the bay].
function finishReturn(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef | null, t: number): void {
  const recovered = ops.shipLegs.some((l) => l.teamIndex === team.index && l.arrivesAt === t);
  const rec: Partial<GroundStepRecord> = recovered ? { recovered: true } : {};
  if (ref && (ref.task.segmentsBanked ?? 0) > (ref.task.segmentsOffloaded ?? 0)) {
    return moveTo(ops, team, "offload", t, t + OFFLOAD_BASE_SECONDS / ops.factors.offloadMult, rec);
  }
  startBay(exp, ops, team, t, rec);
}

// The offload ends: one finding for the batch of banked segments not yet offloaded (see the header). Mutates.
function offloadFindings(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number, driver: GroundOpsScanDriver): void {
  const task = ref.task;
  const from = task.segmentsOffloaded ?? 0;
  const to = task.segmentsBanked ?? 0;
  if (to <= from) return;
  const N = segmentCount(task);
  const fullBy = new Map<string, TaskHaul>();
  const materials: Record<string, number> = {};
  let credits = 0;
  for (let s = from; s < to; s += 1) {
    const key = (task.segmentBankers?.[s] ?? [team.index]).join(",");
    let full = fullBy.get(key);
    if (!full) {
      full = taskFullHaul(exp, bankingTeams(ops, task, s, team), ref.body, task.poiId, ref.flatIndex);
      fullBy.set(key, full);
    }
    const share = segmentHaul(full, N, s);
    for (const [itemId, qty] of Object.entries(share.materials)) materials[itemId] = (materials[itemId] ?? 0) + qty;
    credits += share.credits;
  }
  const finding: ExpeditionFinding = {
    id: groundTaskFindingId(exp, task.id, from, to - 1),
    source: "activity",
    poiId: task.poiId,
    materials,
    credits,
  };
  if (task.status === "done" && to >= N) {
    // The completing batch: the relic, on the task's legacy relic stream, with the completing team's fieldwork
    // find and the crew rare find ramped at the completion time.
    const fw = fieldworkEffect(taskFieldworkRun(exp, bankingTeams(ops, task, N - 1, team)), ref.body.planetType, task.poiId);
    finding.relic = rollRelicToken(
      taskRelicSeed(exp, ref.flatIndex),
      ref.body.hazard,
      task.poiId,
      `${exp.id}-relic-${task.id}`,
      activityRelicFindBonus(exp, fw, driver.hoursAt(exp, task.completedAt ?? t)),
    );
  }
  exp.findings.push(finding);
  task.segmentsOffloaded = to;
}

// The id of the finding a task's offloaded batch of segments first..last (inclusive) becomes, and the prefix
// every batch of that task shares (the UI sums a task's batches by it). Pure.
export function groundTaskFindingPrefix(exp: Pick<Expedition, "id">, taskId: string): string {
  return `${exp.id}-find-task-${taskId}-s`;
}
export function groundTaskFindingId(exp: Pick<Expedition, "id">, taskId: string, first: number, last: number): string {
  return `${groundTaskFindingPrefix(exp, taskId)}${first}-${last}`;
}

// The bay seconds of every team member for the conditions gathered on this trip (medicalBay.ts on the run's
// frozen care; a member's perks from the roster snapshot). A member with none reads 0. Pure (the bay card,
// GO-14, reads it too).
export function groundTeamBaySeconds(
  exp: Pick<Expedition, "roster" | "groundOps">,
  team: Pick<GroundTeamRun, "securityIds" | "scienceIds" | "conditions">,
): Record<string, number> {
  const out: Record<string, number> = {};
  const ops = exp.groundOps;
  if (!ops) return out;
  const care = groundOpsBayCare(ops.factors);
  const snapshots = [...(exp.roster?.security ?? []), ...(exp.roster?.science ?? [])];
  for (const id of [...team.securityIds, ...team.scienceIds]) {
    if (Object.prototype.hasOwnProperty.call(out, id)) continue;
    const perks = snapshots.find((m) => m.memberId === id)?.perks ?? [];
    out[id] = memberBaySeconds(team.conditions[id] ?? [], perks, care);
  }
  return out;
}

// The bay: each member recovers on its own clock; the step lasts the longest (0 skips it). Records each
// member's absolute bay end (carried home at claim). Mutates.
function startBay(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, t: number, rec: Partial<GroundStepRecord> = {}): void {
  let longest = 0;
  const bayEnds: Record<string, number> = {};
  for (const [id, secs] of Object.entries(groundTeamBaySeconds(exp, team))) {
    if (!(secs > 0)) continue;
    bayEnds[id] = t + secs;
    longest = Math.max(longest, secs);
  }
  team.bayEnds = bayEnds;
  if (longest > 0) {
    team.bayStart = t;
    return moveTo(ops, team, "bay", t, t + longest, rec);
  }
  delete team.bayStart;
  healTeam(team);
  moveTo(ops, team, "reload", t, t + RELOAD_BASE_SECONDS / ops.factors.reloadMult, rec);
}

// Everyone healed: the trip's conditions, the task's downed list and the in-task carry are cleared. Mutates.
function healTeam(team: GroundTeamRun): void {
  team.conditions = {};
  team.downedThisTask = [];
  delete team.carry;
}

function finishBay(ops: GroundOpsState, team: GroundTeamRun, t: number): void {
  healTeam(team);
  moveTo(ops, team, "reload", t, t + RELOAD_BASE_SECONDS / ops.factors.reloadMult);
}

// Reloaded (or the task vanished): idle, ready for the next task. Mutates.
function toIdle(ops: GroundOpsState, team: GroundTeamRun, t: number): void {
  moveTo(ops, team, "idle", t, null);
  delete team.taskId;
  delete team.borrowed;
  delete team.attemptPoints;
  delete team.workFrom;
  delete team.workTo;
}

// ===== Readers (display + the UI flag) =====

// Is `task` STUCK (user Q4: hold and flag): it hit GROUND_STUCK_LOSSES losses in a row (now, or before it went to
// the back of the line) and has cleared no new fight point since, and is not finished. Pure.
export function groundTaskStuck(task: Pick<ExpeditionActivity, "lossStreak" | "sentBack" | "status">): boolean {
  if (task.status === "done" || task.status === "skipped") return false;
  return (task.lossStreak ?? 0) >= GROUND_STUCK_LOSSES || (task.sentBack ?? 0) > 0;
}

// The stuck tasks of a run (ids, flat order), for a per-task flag. Pure.
export function groundOpsStuckTaskIds(exp: Pick<Expedition, "groundOps" | "bodies">): string[] {
  if (!exp.groundOps) return [];
  return exp.bodies.flatMap((b) => b.activities.filter((task) => isGroundTask(task) && groundTaskStuck(task)).map((task) => task.id));
}

// The task a team is on (taskId), else the first queued task of its own queue (the one it takes next), or null
// when its queue has nothing left (display: "next up"). Pure.
export function groundTeamHeadTask(exp: Pick<Expedition, "bodies">, team: Pick<GroundTeamRun, "taskId" | "queue">): ExpeditionActivity | null {
  if (team.taskId !== undefined) {
    const on = findGroundTask(exp, team.taskId)?.task;
    if (on && (on.status === "queued" || on.status === "active")) return on;
  }
  for (const id of team.queue) {
    const task = findGroundTask(exp, id)?.task;
    if (task && (task.status === "queued" || task.status === "active")) return task;
  }
  return null;
}

// The tasks a team still has (its queue's queued or active tasks, queue order). Pure.
export function groundTeamRemainingTasks(exp: Pick<Expedition, "bodies">, team: Pick<GroundTeamRun, "queue">): ExpeditionActivity[] {
  const out: ExpeditionActivity[] = [];
  for (const id of team.queue) {
    const task = findGroundTask(exp, id)?.task;
    if (task && (task.status === "queued" || task.status === "active")) out.push(task);
  }
  return out;
}

// Is this team STUCK: it still has tasks and EVERY one of them has hit the loss streak (groundTaskStuck). A stuck
// task goes to the back of the line, so it never holds up an easier task behind it (user, GO-7b answers); the
// team reads stuck only once nothing but such tasks remains. Pure.
export function groundTeamStuck(exp: Pick<Expedition, "bodies">, team: Pick<GroundTeamRun, "queue">): boolean {
  const remaining = groundTeamRemainingTasks(exp, team);
  return remaining.length > 0 && remaining.every((task) => groundTaskStuck(task));
}

// Is the RUN stuck ("Stuck: needs a stronger team or a skip", user Q4): its window is open, at least one team
// still has tasks, and every such team is stuck (groundTeamStuck). The teams keep retrying; the engine never
// gives up on its own. Pure.
export function groundOpsStuck(exp: Pick<Expedition, "groundOps" | "bodies">): boolean {
  const ops = exp.groundOps;
  if (!ops || ops.endedAt !== undefined) return false;
  let working = 0;
  for (const team of ops.teams) {
    if (groundTeamRemainingTasks(exp, team).length === 0) continue;
    working += 1;
    if (!groundTeamStuck(exp, team)) return false;
  }
  return working > 0;
}

// The player-facing stuck flag (user Q4 wording). Pure.
export const GROUND_OPS_STUCK_TEXT = "Stuck: needs a stronger team or a skip";

// A task's progress at `now` for display: the stored progress, interpolated along the current work step of
// the team on it. Pure.
export function groundTaskProgressAt(exp: Pick<Expedition, "groundOps">, task: ExpeditionActivity, now: number): number {
  const stored = task.done ? 1 : task.progress ?? 0;
  const team = exp.groundOps?.teams.find((t) => t.taskId === task.id && t.step === "work");
  if (!team || team.stepEndsAt === null || team.workFrom === undefined || team.workTo === undefined) return stored;
  const span = team.stepEndsAt - team.stepStartedAt;
  const f = span > 0 ? Math.max(0, Math.min(1, (now - team.stepStartedAt) / span)) : 1;
  return team.workFrom + (team.workTo - team.workFrom) * f;
}

// The run's ground progress in [0, 1] at `now` (the activities bar): every task's share (done or skipped counts
// whole, others their interpolated progress) over the task count. 0 before any task exists. Pure.
export function groundOpsProgress(exp: Pick<Expedition, "groundOps" | "bodies">, now: number): number {
  let total = 0;
  let sum = 0;
  for (const body of exp.bodies) {
    for (const task of body.activities) {
      total += 1;
      sum += task.done || task.status === "skipped" ? 1 : groundTaskProgressAt(exp, task, now);
    }
  }
  return total > 0 ? Math.max(0, Math.min(1, sum / total)) : 0;
}
