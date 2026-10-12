// Ground Operations 0.14.0 (D25): the run-side engine of a Ground Ops expedition.
//
// GO-7a: the DISPATCH SNAPSHOT (below). GO-7b: startExpedition stores it as Expedition.groundOps (the flag) and
// the TIMELINE ENGINE further down resolves the run (see "GO-7b: THE TIMELINE ENGINE").
//
//   snapshotGroundOps(state, ship, run) -> { teams, factors, shipEventProfile }
//     teams   : the ship's DEPLOYING ground teams (groundTeams.ts deployableGroundTeams: every slotted member
//               ready AND the D18 minimum in each squad; no automatic stand-ins, user 2026-10-12), ascending
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
  type GroundOpsState,
  type GroundShipLeg,
  type GroundStepKind,
  type GroundStepRecord,
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
import { groundTaskClearOdds } from "./groundThreat";
import { activityRelicFindBonus, rollRelicToken, taskRelicSeed } from "./gambit";
import { fieldworkEffect } from "./fieldwork";

export type { GroundOpsFactors, GroundOpsState, GroundShipLeg, GroundStepKind, GroundStepRecord, GroundTeamRun, ShipEventProfile };

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
// GO-7b: THE TIMELINE ENGINE (one combined operations window; single-team planning)
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
//   fight while the ship is still scanning (every Security member down) cannot shuttle up on its own: the ship
//   breaks off, flies IN_SYSTEM_LEG_SECONDS to the team's body (the team's return step ends when it arrives),
//   and flies IN_SYSTEM_LEG_SECONDS back. The scan makes no progress for the whole leg (the SCAN CLOCK below
//   stops), then resumes. Legs never overlap: a wipe during a leg starts its leg when that one ends. An
//   ordinary return (the team shuttles up itself: a win, a retreat at the round cap, or any loss once the
//   scan is done) takes RETURN_SECONDS and never delays the scan [PROVISIONAL: a wipe after the scan is done
//   also takes the ordinary return, since the ship is holding station in the system with nothing to delay].
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
//   A lost task is retried by its team after the bay, from the held progress, against a fresh encounter. It
//   never gives up on its own (user Q4: HOLD AND FLAG; groundOpsStuck is the flag).
//
// PLANNING (one team, GO-7b): a body's new tasks go to the lowest-index deployed team's queue, EASIEST FIRST
// by groundTaskClearOdds (ties: discovery order) [PROVISIONAL, Q3]. GO-7c replaces this for 2+ teams.
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
// A task is STUCK after this many consecutive failed attempts that cleared no new fight point [PROVISIONAL, Q4].
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

// Stamp every activity of body `bodyIndex` as a Ground Ops task (plan section 2): one team, its fight points
// from the site's threat on the body's RAW hazard, nothing done yet, queued. Idempotent (a stamped task is
// left alone). Mutates the working clone.
export function initGroundTasks(exp: Expedition, bodyIndex: number): void {
  const body = exp.bodies[bodyIndex];
  if (!body) return;
  for (const task of body.activities) {
    if (isGroundTask(task)) continue;
    task.requiredTeams = 1;
    task.fightPoints = fightPointFractions(fightPointCount(task.poiId, body.hazard));
    task.progress = 0;
    task.pointsCleared = 0;
    task.segmentsBanked = 0;
    task.segmentsOffloaded = 0;
    task.fightCount = 0;
    task.status = "queued";
  }
}

// Queue body `bodyIndex`'s new tasks (see the header: one team, easiest first). With no deployed team the
// tasks are skipped (nobody could ever work them; unreachable past the D18 gate). Mutates the working clone.
export function planNewTasks(exp: Expedition, bodyIndex: number): void {
  const ops = exp.groundOps;
  const body = exp.bodies[bodyIndex];
  if (!ops || !body) return;
  const queued = new Set(ops.teams.flatMap((t) => t.queue));
  const fresh = body.activities.filter((task) => task.status === "queued" && !queued.has(task.id));
  if (fresh.length === 0) return;
  const team = ops.teams[0];
  if (!team) {
    for (const task of fresh) task.status = "skipped";
    return;
  }
  const side = [fightTeamOf(ops, team, true)];
  const rated = fresh.map((task, order) => {
    const ref = findGroundTask(exp, task.id);
    const wins = ref ? groundTaskClearOdds(exp, side, body, task, ref.flatIndex).wins : 0;
    return { task, order, wins };
  });
  rated.sort((a, b) => b.wins - a.wins || a.order - b.order);
  for (const { task } of rated) {
    team.queue.push(task.id);
    task.assignedTeamIds = [team.index];
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
  planNewTasks(exp, bodyIndex);
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
      for (const team of ops.teams) if (team.stepEndsAt === t) endStep(exp, team, t, driver);
    }
    groundOpsAssignIdle(exp, t);
    checkRunEnd(exp, t);
  }
}

// Every idle team (team index order) takes the first queued task of its own queue: deploy at `t`. The window
// runs it after every event; GO-7d's live edits run it at the edit instant. Mutates the working clone.
export function groundOpsAssignIdle(exp: Expedition, t: number): void {
  const ops = exp.groundOps;
  if (!ops) return;
  for (const team of ops.teams) {
    if (team.step !== "idle") continue;
    let next: GroundTaskRef | null = null;
    for (const id of team.queue) {
      const ref = findGroundTask(exp, id);
      if (ref && ref.task.status === "queued") {
        next = ref;
        break;
      }
    }
    if (!next) continue;
    next.task.status = "active";
    team.taskId = next.task.id;
    team.attemptPoints = next.task.pointsCleared ?? 0;
    moveTo(ops, team, "deploy", t, t + DEPLOY_SECONDS);
  }
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

// Close the team's current step at `t` into the display history (a zero-length idle is not recorded) and
// start `step`, ending at `endsAt` (null = open-ended). `rec` adds to the CLOSED step's record. Mutates.
function moveTo(
  ops: GroundOpsState,
  team: GroundTeamRun,
  step: GroundStepKind,
  t: number,
  endsAt: number | null,
  rec: Partial<GroundStepRecord> = {},
): void {
  if (!(team.step === "idle" && team.stepStartedAt === t)) {
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
// for the members still standing, whole seconds, at least 1.
function startWork(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number, rec: Partial<GroundStepRecord> = {}): void {
  const points = ref.task.fightPoints ?? [];
  const cleared = ref.task.pointsCleared ?? 0;
  const from = ref.task.progress ?? 0;
  const to = cleared < points.length ? points[cleared] : 1;
  const full = taskWorkSeconds(exp, [workTeamOf(ops, team)], ref.body);
  team.workFrom = from;
  team.workTo = to;
  moveTo(ops, team, "work", t, t + Math.max(1, Math.round((to - from) * full)), rec);
}

// Work reached its target: bank the segment just finished (segment index = the points cleared so far), then
// the task is done at 100% (return) or a fight waits at the point.
function finishWork(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number): void {
  const task = ref.task;
  const to = team.workTo ?? task.progress ?? 0;
  task.progress = to;
  const segment = task.pointsCleared ?? 0;
  const bankers = task.segmentBankers ?? [];
  bankers[segment] = [team.index];
  task.segmentBankers = bankers;
  task.segmentsBanked = Math.max(task.segmentsBanked ?? 0, segment + 1);
  delete team.workFrom;
  delete team.workTo;
  if (to >= 1) {
    task.status = "done";
    task.done = true;
    task.completedAt = t;
    return startReturn(exp, ops, team, ref, t, false);
  }
  startFight(exp, ops, team, ref, t);
}

// A fight starts: resolved now on its keyed stream, with the team's carry (user Q5); applied at its end.
function startFight(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number): void {
  const record = resolveTaskFight(exp, [fightTeamOf(ops, team)], ref.body, ref.task, ref.flatIndex, team.carry);
  ref.task.fightCount = (ref.task.fightCount ?? 0) + 1;
  team.pendingFight = record;
  moveTo(ops, team, "fight", t, t + taskFightSeconds(record));
}

// A fight ends: apply its record (see the header).
function finishFight(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number): void {
  const record = team.pendingFight;
  delete team.pendingFight;
  if (!record) return startReturn(exp, ops, team, ref, t, false);
  for (const [memberId, ids] of Object.entries(record.memberConditions)) {
    const merged = team.conditions[memberId] ?? [];
    for (const id of ids) if (!merged.includes(id)) merged.push(id);
    team.conditions[memberId] = merged;
  }
  for (const id of record.downedMemberIds) if (!team.downedThisTask.includes(id)) team.downedThisTask.push(id);
  const task = ref.task;
  if (record.outcome === "win") {
    task.pointsCleared = (task.pointsCleared ?? 0) + 1;
    delete task.lossStreak;
    team.carry = structuredClone(record.memberEnd);
    return startWork(exp, ops, team, ref, t, { outcome: "win" });
  }
  delete team.carry;
  task.status = "queued";
  const progressed = (task.pointsCleared ?? 0) > (team.attemptPoints ?? 0);
  const streak = progressed ? 0 : (task.lossStreak ?? 0) + 1;
  if (streak > 0) task.lossStreak = streak;
  else delete task.lossStreak;
  const out = new Set(team.downedThisTask);
  startReturn(exp, ops, team, ref, t, team.securityIds.every((id) => out.has(id)), { outcome: "loss" });
}

// Back to the ship. A WIPE while the ship is still scanning is a RECOVERY LEG (see the header): the scan pauses
// and the team's return ends when the ship arrives. Anything else is an ordinary RETURN_SECONDS shuttle.
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
  if (wiped && scanning >= 0) {
    const last = ops.shipLegs[ops.shipLegs.length - 1];
    const startsAt = last !== undefined && last.endsAt > t ? last.endsAt : t;
    const leg: GroundShipLeg = {
      kind: "recovery",
      teamIndex: team.index,
      bodyIndex: ref.bodyIndex,
      scanBodyIndex: scanning,
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
  delete team.attemptPoints;
  delete team.workFrom;
  delete team.workTo;
}

// ===== Readers (display + the UI flag) =====

// Is `task` STUCK (user Q4: hold and flag): GROUND_STUCK_LOSSES consecutive failed attempts that cleared no new
// fight point, and not finished. Pure.
export function groundTaskStuck(task: Pick<ExpeditionActivity, "lossStreak" | "status">): boolean {
  return (task.lossStreak ?? 0) >= GROUND_STUCK_LOSSES && task.status !== "done" && task.status !== "skipped";
}

// The stuck tasks of a run (ids, flat order), for a per-task flag. Pure.
export function groundOpsStuckTaskIds(exp: Pick<Expedition, "groundOps" | "bodies">): string[] {
  if (!exp.groundOps) return [];
  return exp.bodies.flatMap((b) => b.activities.filter((task) => isGroundTask(task) && groundTaskStuck(task)).map((task) => task.id));
}

// The task a team is held on: the one it is on (taskId), else the first queued task of its own queue (the one
// it takes next), or null when its queue has nothing left. Pure.
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

// Is this team BLOCKED: the task it is on or takes next is stuck. A lost task is retried before the rest of the
// queue (D25: "when recovered and ready to go, they retry the mission"), so a stuck head holds every task
// queued behind it. Pure.
export function groundTeamStuck(exp: Pick<Expedition, "bodies">, team: Pick<GroundTeamRun, "taskId" | "queue">): boolean {
  const head = groundTeamHeadTask(exp, team);
  return head !== null && groundTaskStuck(head);
}

// Is the RUN stuck ("Stuck: needs a stronger team or a skip", user Q4): its window is open, at least one team
// still has work, and EVERY team with work is blocked by a stuck task (groundTeamStuck), so nothing can move on
// without a stronger team or a skip. This covers "every remaining task is stuck" and also the common case of
// easier tasks queued behind a stuck one. The engine never gives up on its own. Pure.
export function groundOpsStuck(exp: Pick<Expedition, "groundOps" | "bodies">): boolean {
  const ops = exp.groundOps;
  if (!ops || ops.endedAt !== undefined) return false;
  let working = 0;
  for (const team of ops.teams) {
    if (groundTeamHeadTask(exp, team) === null) continue;
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
