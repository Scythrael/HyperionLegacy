// Ground Operations 0.14.0 (D25): the run-side engine of a Ground Ops expedition.
//
// GO-7a: the DISPATCH SNAPSHOT (below). GO-7b: startExpedition stores it as Expedition.groundOps (the flag) and
// the TIMELINE ENGINE further down resolves the run (see "GO-7b: THE TIMELINE ENGINE"). GO-7c: several teams,
// the default plan, helpers and joint tasks (see "SEVERAL TEAMS" there). Squads SQ-3: task NEEDS in squads,
// crews that cover them, one offload per joint crew, the shared pickup and the Survey ambush (see "PLANNING").
// GO-7d: LIVE QUEUE EDITS applied from now (assign, reorder, skip, requeue, Default plan, Auto-assign randomly,
// the help toggle; see "GO-7d: LIVE QUEUE EDITS"; expedition.ts editGroundOps advances the run to now first).
//
//   snapshotGroundOps(state, ship, run) -> { teams, factors, shipEventProfile }
//     teams   : the ship's DEPLOYING ground teams (groundTeams.ts deployableGroundTeams: every slotted member
//               ready AND a member in each of its squads, Squads SQ-2; no automatic stand-ins, user 2026-10-12;
//               D18 across the deploying teams is the dispatch gate's), ascending
//               ship team index, the team's KIND (Squads SQ-3: its squads), member ids in slot order,
//               `helpOthers` from the ship, an empty queue, idle.
//     factors : FROZEN at dispatch (D24), so a ship whose crew, officers or captain change mid-run never
//               reshapes it (the same contract as the run's other snapshots):
//       medicalShare / rapidRecoveryShare : injuries.ts shipInjuryFactors (crew.reducedCrewLosses; the Rapid
//                                           Recovery officer, officerBonusTotal(officer.repairRateMult)).
//       officerFacetShare / injurySteady  : the run's frozen Medical facets (recoveryTurnaround + quickRecovery;
//                                           injurySteady), mapped by medicalBay.ts bayCareFrom, the ONE place
//                                           the bay mapping is written. GO-7b reads the bay care back with
//                                           groundOpsBayCare(factors) (the four fields, as they were frozen).
//       preventLossShare : CP-3, Prevent a Crew Loss (crewOverlay.ts shipPreventCrewLoss): the bay's injury care;
//                          written only when non-zero (groundOpsBayCare carries it).
//       offloadMult : crewOverlay.ts effectiveShipStats(...).unloadSpeedMult (the crew Efficient Unloading and
//                     Veteran Instincts multiplier missions use; absent = 1). Divides the offload step.
//       reloadMult  : 1 + crew.loadSpeed (Rapid Loadout, shipCrewContribution) + Efficient Stowage (captain
//                     secondary talent logistics4, D26). Divides the reload step.
//       securityShare[i] / scienceShare[i] : deployed team i's share of the ship's crew layer = its SQUADS of
//                     that type / every deployed squad of that type (Squads SQ-3, design 3.4; GO-7a split by
//                     member count) [PROPOSAL, Q20]. With one team both are [1] (a Ground team), so every
//                     crew-layer read (exp.securityStrength x share, exp.scienceStrength x share) equals today.
//     shipEventProfile : the ship-side scan events' frozen inputs (GO-8, shipScanEvents.ts
//               snapshotShipEventProfile: sensors, Engineering, Boarding Defense, the battle inputs). A run
//               dispatched before GO-8 carries NEUTRAL_SHIP_EVENT_PROFILE (no battle inputs: no ship events).
//   snapshotAwayRosterForTeams(state, ship, teams) : the run's UNION roster (Expedition.roster): Security then
//     Science members of the deployed teams, team order then slot order. Scan readers keep reading exp.roster.
//
// Module graph (plan section 2): groundOps.ts imports model, awayTeam, groundTeams, medicalBay, injuries,
// crewOverlay, crewBuffs, and (GO-7b) groundTasks, groundFight, groundThreat, gambit, fieldwork. It NEVER imports
// expedition.ts (expedition.ts imports this; the scan side comes in as a GroundOpsScanDriver). PURE throughout.

import {
  SECONDARY_CAPTAIN_TALENTS,
  commandingCaptain,
  type AwayMember,
  type AwayRosterSnapshot,
  type AwayTeamType,
  type Expedition,
  type ExpeditionActivity,
  type ExpeditionBody,
  type ExpeditionDiscovery,
  type ExpeditionFinding,
  type GameState,
  type GroundOpsFactors,
  type GroundOpsLogEntry,
  type GroundOpsState,
  type GroundRepairLeg,
  type GroundShipLeg,
  type GroundStudyLeg,
  type GroundTaskNeeds,
  type GroundTeamKind,
  type GroundStepKind,
  type GroundStepRecord,
  type GroundMemberEnd,
  type GroundTeamRun,
  type ShipEventProfile,
  type ShipInstance,
  type ExpeditionPlanetType,
  FULL_HOLD_FRACTION,
  WR9_SWITCH,
  repairTicksForDamage,
} from "./model";
import { damageControlRepairTicks } from "./utilityGear";
import { snapshotMembers } from "./awayTeam";
// GO-8: the ship-side scan events' dispatch snapshot (shipScanEvents.ts never imports this module).
import { snapshotShipEventProfile } from "./shipScanEvents";
import { deployableGroundTeams, shipGroundTeams } from "./groundTeams";
import { bayCareFrom, memberBaySeconds, type BayCare } from "./medicalBay";
import { shipInjuryFactors } from "./injuries";
import { effectiveShipStats, shipCrewContribution, shipPreventCrewLoss } from "./crewOverlay";
// Complement CP-13: the quarters module's hull-family bay perks (crewModules.ts imports no ground code, so no cycle).
import { hullFamilyQuartersPerk } from "./crewModules";
import { departmentFacet } from "./officerStats";
import { CREW_STAT_KEYS } from "./crewBuffs";
// GO-7b: the timeline engine's building blocks (GO-4 task model, GO-5 fight, GO-6 odds) and the legacy reward
// rolls one task keeps whichever engine resolves it.
import {
  fightPointCount,
  fightPointFractions,
  riskFightPointCount,
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
import { threatAssessment, tierAtLeast, type ThreatAssessment } from "./combat/threatAssessment";
import { getPoiById, groundSiteLabel, poiRelicOddsMult } from "./expeditionContent";
import { activityRelicFindBonus, rollRelicToken, taskRelicSeed } from "./gambit";
import { relicBlankStamp } from "./relicBlanks";
import { fieldworkEffect } from "./fieldwork";
// Squads SQ-3: team squads by kind (composition math) and the ambush roll's private stream.
import { DEFAULT_GROUND_TEAM_KIND, isGroundTeamKind, scienceSquadsOf, securitySquadsOf } from "./groundComposition";
import { makeRng } from "./combat/rng";
// Squads SQ-4: risk-aware stamping (needs, difficulty, the ambush chance) and the risk reward.
import {
  difficultyGradeOf,
  difficultyWeight,
  generatedTaskNeeds,
  isHostileSiteId,
  riskAmbushChance,
  riskRewardBonus,
  runAffixCatalog,
  runDifficultyTier,
  taskChainFollowUp,
  taskDifficultyScore,
  tierNeeds,
} from "./riskFactors";
// Objective affixes (AF-1): the stamping roll, the per-visit reinforcements, the alert and its failsafe. AF-2: the
// cover against long-range attacks (Rocky Outcroppings).
import {
  ALERT_RESET_TEXT,
  alertAfterSetback,
  alertLevelAt,
  alertResetsAt,
  hasCover,
  longRangeCover,
  objectiveHeld,
  rollObjectiveAffixes,
  rollReinforcements,
  type GroundCover,
} from "./affixes";
// Safe first runs SF-2: the training run stamp's one read (no affixes, no ambushes, the backstop).
import { isTrainingRun } from "./enemyRanks";
import { rampedChance, runOddsRampOf } from "./runDifficulty";
// Field Kits FKR-7: the flag (flag 2) and the run plumbing (the per-objective refresh, the fight spends, the bay share).
import { fieldDeviceChance, fieldDeviceDial, fieldDeviceUseEffectiveness, fieldDevicesLive, fieldKitsLive } from "./fieldKits";
import { freshBasicsFor, refreshObjectiveSupplies, spendFightSupplies } from "./fieldKitsRun";
// Gas Giant Study GG-3: the ship's study of an orbital body (gasGiantStudy.ts never imports this module).
import { NEBULA_SWEEP_BODY_INDEX, isStudyBody, nebulaSweepSeconds, rollNebulaReward, rollStudyReward, studySeconds, sweepsNebula } from "./gasGiantStudy";

// Safe first runs SF-2 (user SF12): the log line of a training run's lost fight whose guards fell back (the backstop).
export const TRAINING_FELL_BACK_TEXT = "The guards fell back. Training run: no setback.";

export type { GroundOpsFactors, GroundOpsLogEntry, GroundOpsState, GroundRepairLeg, GroundShipLeg, GroundStepKind, GroundStepRecord, GroundStudyLeg, GroundTaskNeeds, GroundTeamRun, ShipEventProfile };

// What snapshotGroundOps returns; GO-7b wraps it into the stored GroundOpsState.
export interface GroundOpsSnapshot {
  teams: GroundTeamRun[];
  factors: GroundOpsFactors;
  shipEventProfile: ShipEventProfile;
}

// The run's frozen Medical facets snapshotGroundOps folds into the bay factors (startExpedition computes them
// at the same dispatch instant; quickRecovery is rolled on the run's seed, so it is passed in, never re-rolled).
export type GroundOpsRunFacets = Pick<Expedition, "recoveryTurnaround" | "quickRecovery" | "injurySteady">;

// The ship-event profile every flagged run dispatched BEFORE GO-8 carries (no `battle`: it rolls no ship event).
// Frozen so nothing can mutate the shared value. Since GO-8 snapshotGroundOps writes the real profile.
export const NEUTRAL_SHIP_EVENT_PROFILE: Readonly<ShipEventProfile> = Object.freeze({
  sensors: 0,
  engineering: 0,
  boardingDefense: 0,
});

// Efficient Stowage (captain secondary talent logistics4, "+pre-mission load speed"): D26 points it at the
// Ground Ops reload step. Read from the catalog entry (+0.08), so the data stays the one source. WR-5a: the
// rest of the Prospector tree is live through captainSecondaryEffects.ts; Rapid Turnaround (logistics3) reaches
// the offload through effectiveShipStats.unloadSpeedMult (offloadMult below, frozen at dispatch).
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
  const captain = commandingCaptain(state, ship);
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
    kind: t.kind,
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
  // Complement plan CP-3 (OC-E2): Prevent a Crew Loss, frozen here and written only when non-zero (injuries only).
  const preventLossShare = shipPreventCrewLoss(state, ship);
  // Wiring WR-9 (OC-E9): the Operations officer's Integrity steadies a packed offload (written only when non-zero).
  const offloadSteady = WR9_SWITCH.live ? departmentFacet(state, ship, "operations", "integrity") : 0;
  // Complement CP-13 (OC-13): the quarters module's hull-family bay perks, frozen here (written only when non-zero).
  const hullInjuryShare = hullFamilyQuartersPerk(state, ship, "injuryRecovery");
  const hullBayShare = hullFamilyQuartersPerk(state, ship, "bayTime");
  const factors: GroundOpsFactors = {
    medicalShare: care.medicalShare,
    rapidRecoveryShare: care.rapidRecoveryShare,
    officerFacetShare: care.officerFacetShare,
    injurySteady: care.injurySteady,
    offloadMult: stepMult(effectiveShipStats(state, ship).unloadSpeedMult),
    reloadMult: groundReloadMult(state, ship),
    // Squads SQ-3: split per SQUAD (design 3.4): a Strike team carries two Security shares and no Science share.
    securityShare: sharesOf(teams.map((t) => teamSquadsOf(t).security)),
    scienceShare: sharesOf(teams.map((t) => teamSquadsOf(t).science)),
    ...(preventLossShare > 0 ? { preventLossShare } : {}),
    ...(offloadSteady > 0 ? { offloadSteady } : {}),
    ...(hullInjuryShare > 0 ? { hullInjuryShare } : {}),
    ...(hullBayShare > 0 ? { hullBayShare } : {}),
  };
  return { teams, factors, shipEventProfile: snapshotShipEventProfile(state, ship) };
}

// Complement CP-13 fix round (review: "the tile says 10% shorter, the bay can give 7%"): the bay care a Ground Ops run
// dispatched now on `ship` would freeze, read off the dispatch snapshot itself (so it can never drift from it), with
// the expedition's Medical facets read exactly as its dispatch reads them (expedition.ts startExpedition) and the
// Medical Cunning roll left out (it is rolled per dispatch, on the run's seed). Display only: the quarters tile reads it
// to show what a hull-family bay perk does on this ship. Pure.
export function shipBayCareNow(state: GameState, ship: ShipInstance): BayCare {
  const run = {
    recoveryTurnaround: departmentFacet(state, ship, "medical", "constitution"),
    injurySteady: departmentFacet(state, ship, "medical", "integrity"),
  };
  return groundOpsBayCare(snapshotGroundOps(state, ship, run).factors);
}

// The bay care a run's frozen factors carry (GO-7b passes it to medicalBay.ts memberBaySeconds). CP-3: plus Prevent a
// Crew Loss when the run froze one (absent on every other run, so its care reads exactly as before). Pure.
export function groundOpsBayCare(factors: GroundOpsFactors): BayCare {
  return {
    medicalShare: factors.medicalShare,
    rapidRecoveryShare: factors.rapidRecoveryShare,
    officerFacetShare: factors.officerFacetShare,
    injurySteady: factors.injurySteady,
    ...(factors.preventLossShare !== undefined ? { preventLossShare: factors.preventLossShare } : {}),
    // CP-13: the hull-family bay perks when the run froze them.
    ...(factors.hullInjuryShare !== undefined ? { hullInjuryShare: factors.hullInjuryShare } : {}),
    ...(factors.hullBayShare !== undefined ? { hullBayShare: factors.hullBayShare } : {}),
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
// PLANNING (planTasksForTeams): every task states its NEEDS in squads (Squads SQ-3, design 3.2: taskNeedsOf;
// requiredTeams N carries forward as { N, N }), and its CREW is the smallest set of deployed teams whose squads
// cover them (a Ground team brings { 1, 1 }, Strike { 2, 0 }, Survey { 0, 2 }). One team takes a body's new
// tasks EASIEST FIRST by groundTaskClearOdds (ties: discovery order) [PROVISIONAL, Q3]. 2+ teams (GO-7c, user
// 9b.3): THE DEFAULT PLAN, harder solo tasks to the stronger teams that cover them, joint tasks to their crews
// (see planTasksForTeams). A task NO crew of the deployed teams covers is skipped with a log line
// (GroundOpsState.log, display only) and never planned, so a run can never wait on work nobody aboard can do
// (user: no softlock) [PROVISIONAL, Q20].
//
// SEVERAL TEAMS (GO-7c): every team runs its own step machine; ends at one instant are one batch in team index
// order, FIXED before any team moves (a step that moves a partner never makes it end mid-batch).
//   HELPERS (user D25 + 9b.4): a team with "help other teams" and nothing of its own to do borrows another
//     team's queued solo task that its OWN squads cover (SQ-3) and that rates at least HELPER_MIN_TIER for it
//     (groundThreat.ts, the display odds' stream). A helper win finishes the task; a helper LOSS never touches
//     the owner's loss streak or queue: the helper lists the task in skippedBorrowed (never borrowed again) and
//     the owner gets it back, progress kept.
//   JOINT TASKS (a crew of 2+ teams, D25 "tasks scale to multiple ground teams"; no content asks yet): a team
//     that picks one goes STAGING; when every team of its crew is staging, the LEAD (lowest index) deploys and
//     carries the joint work and fight steps for the whole crew (every Security squad of the crew fights as one
//     side, every Science squad's fieldwork sums; a crew with no Science works at the bare pace); partners
//     mirror the lead's task in "staging" until the joint return. The task completes ONCE, when the crew's
//     work reaches 100%, and pays ONCE (user #13): the LEAD runs the one offload, the partners go straight to
//     their own bay (design 3.5), then everyone reloads and goes back to their own queue. A segment is banked
//     for the crew's team set (segmentBankers), and the offload pays that set's yield. A loss counts once; at
//     GROUND_STUCK_LOSSES the task goes to the back of every crew team's queue.
//   RECOVERY LEGS: the ship flies one leg at a time. A team is WIPED when it has a Security member and all of
//     them are down (a team with no Security member never is: SQ-2 review); when a whole crew's Security is down
//     every team of the crew waits. The wiped teams of ONE crew share ONE leg (user 2026-10-12: one shared
//     pickup trip when several teams wipe together on one body); separate crews each wait for their own, in
//     wipe order. A helper is a team like any other.
//   THE AMBUSH (user #5, SQ-3; SQ-4): a crew on a calm task (no fight points) may be ambushed by something
//     unknown (groundTaskAmbushChance: the body's risk on a risk-aware run, else 0), at most
//     SURVEY_AMBUSH_MAX_PER_TASK times per task. A crew with NO standing Security member never fights: it
//     RETREATS with light injuries (SURVEY_AMBUSH_CONDITIONS), the task pauses with its progress kept, and the
//     crew comes back after its bay. A crew WITH one meets it as a SURPRISE FIGHT where it stands (SQ-4, user):
//     a win and the work goes on from the same spot; a loss is an ordinary loss (a wipe waits for the ship).
//
// RISK (Squads SQ-4): a risk-aware run (Expedition.risk, each body's risk grades) stamps its tasks from the risk
//   (initGroundTasks: fight points, generated needs (one squad a type at Tiers I and II, as rolled from III),
//   the difficulty grade, the ambush chance); flora slows the work (groundTasks.ts) and poisons the fights (groundFight.ts); the difficulty
//   weights the completion (groundOpsProgress) and raises the haul and the relic find at offload. A run without
//   risk resolves exactly as stamped before SQ-4.
//
// OBJECTIVE AFFIXES (AF-1, user 2026-10-14; affixes.ts): an AFFIX-AWARE run (its risk profile carries
//   difficultyTier: every run dispatched since AF-1) stamps each objective's affixes with its difficulty score.
//   REINFORCING: each VISIT may bring 1 to N extra battles (REINFORCEMENT fights that strike MID-WORK at points rolled
//   along the progress bar, like ambushes: a win passes no fight point and the work goes on from that spot, a loss
//   is an ordinary loss); every lost fight raises the objective's ALERT (more
//   enemies, Heightened Senses, a higher rating) until it lapses; an alert that pushes the rating to Impossible
//   HOLDS the objective (no crew starts it; it stays queued) until the reset, an event of the window (the record is
//   cleared and a log line written at that instant, so idle teams pick it up again). A run without the flag
//   stamps and resolves exactly as before.
//   ROCKY OUTCROPPINGS (AF-2): the objective's fights (point, surprise and reinforcement fights alike) and every odds
//   read of it carry its COVER against long-range attacks (taskCover). The run stamps from its own affix CATALOG
//   version (riskFactors.ts runAffixCatalog), so an affix-aware run dispatched before AF-2 rolls exactly as before.
//
// THE TRAINING RUN (safe first runs SF-2; enemyRanks.ts isTrainingRun reads the dispatch stamp): its objectives stamp
//   no affixes (the roll is still made and dropped) and no ambush chance, and a LOST fight still clears its point
//   (trainingFellBack: the guards fell back, nothing set back, the crew comes home as from any loss). Its guards are
//   scaled down in groundFight.ts and its odds read Guaranteed (groundThreat.ts). A run without the stamp is exactly
//   as before.
//
// FIELD KITS (FKR-7; fieldKitsRun.ts; a run stamped with flag 2 only, fieldKits.ts fieldKitsLive): as a crew LANDS on an
//   objective (every objective start and every trip) each Security member's free basic set refills and every grenade
//   charge resets to full; each fight's spends (charges, basics, the extras packed at dispatch) come off the team's
//   run, won or lost, so an objective's fights share one set of supplies; the Injury Kit shares a fight records add up
//   on the treated member's trip treatment, which shortens that member's bay time only, and clear when the team is
//   healed. The fight's side carries the supplies (fightTeamOf); an odds read for an objective not yet started reads
//   what the crew would land with. A run without the flag never reads or writes any of it.
//
// FIELD DEVICES (FKR-8; the wiring plan's OC-F1, user "Move them to the ground"; a run carrying the field devices
//   stamp only, fieldKits.ts fieldDevicesLive): the crew's standing Security members' Shroud Emitters and Lure Beacons
//   scale each ambush roll on a calm objective and each landing's reinforcement roll on a Reinforcing one, at a 50 to 75%
//   rolled PER USE (x1.06 with a Codebreaker aboard) on its own keyed stream (groundDeviceChance). The ambush and
//   reinforcement streams draw exactly as before; only the chance their first draw is compared against moves.
//
// DETERMINISM: two salts here, GROUND_AMBUSH_SALT (the ambush roll, keyed by the task and its ambushes) and
// AUTO_ASSIGN_SALT (GO-7d's Auto-assign randomly, keyed by the run's edit count). A task
// fight rolls on its keyed stream (groundFight.ts), the haul on the task's reward stream and the relic on its
// relic stream (gambit.ts), the plan's odds on the threat stream (groundThreat.ts). The scan side (step
// boundaries, a body's completion) is expedition.ts's, passed in as a GroundOpsScanDriver so this module never
// imports expedition.ts.

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

// Squads SQ-3, THE SURVEY AMBUSH (user #5: "Survey teams shouldn't face any fights. But realistically, you could
// be ambushed by something you don't know"; follow-up: an ambushed Survey team RETREATS with light injuries, the
// task pauses, they come back later). Only a calm task (no fight points) can be ambushed; a crew with no standing
// Security member never fights it (SQ-4: a crew with one meets it as a surprise fight, user).
// The chance an unknown-risk ambush strikes on one attempt at a body WITHOUT risk grades (every run before SQ-4):
// 0. A risk-aware body reads riskFactors.ts riskAmbushChance instead (groundTaskAmbushChance is the hook).
export const SURVEY_AMBUSH_CHANCE = 0;
// The light injuries every member of an ambushed crew comes back with (medicalBay.ts GROUND_CONDITIONS; "health"
// is the minor-injury condition, a 60 s cure before care) [PROVISIONAL].
export const SURVEY_AMBUSH_CONDITIONS: readonly string[] = ["health"];
// The most ambushes one task can suffer, so a survey-only task can never be ambushed forever (no softlock, user)
// [PROVISIONAL].
export const SURVEY_AMBUSH_MAX_PER_TASK = 2;
// The ambush roll's stream salt: odd, distinct from every engine salt (salts.test.ts checks it).
export const GROUND_AMBUSH_SALT = 0x2b6f9d35;

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

// Every leg the ship flies (recovery legs, GO-8b's field repairs and Gas Giant Study GG-3's studies), in start order
// (legs never overlap). The stored recovery list itself when the run has neither a repair nor a study (the same
// array). Pure.
export type GroundShipAnyLeg = GroundShipLeg | GroundRepairLeg | GroundStudyLeg;
type LegLists = Pick<GroundOpsState, "shipLegs" | "repairLegs" | "studyLegs">;
export function shipLegsInOrder(ops: LegLists): readonly GroundShipAnyLeg[] {
  const repairs = ops.repairLegs ?? [];
  const studies = ops.studyLegs ?? [];
  if (repairs.length === 0 && studies.length === 0) return ops.shipLegs;
  return [...ops.shipLegs, ...repairs, ...studies].sort((a, b) => a.startsAt - b.startsAt);
}

// When the ship is free of every leg it has been given (the latest leg end), or null when it has none. Pure.
export function shipFreeAt(ops: LegLists): number | null {
  let free: number | null = null;
  for (const leg of shipLegsInOrder(ops)) if (free === null || leg.endsAt > free) free = leg.endsAt;
  return free;
}

// The absolute time of scan clock `c` (seconds of scan time since the window opened). Pure.
export function scanClockToTime(ops: Pick<GroundOpsState, "startedAt" | "shipLegs" | "repairLegs" | "studyLegs">, c: number): number {
  const start = ops.startedAt ?? 0;
  let shift = 0;
  for (const leg of shipLegsInOrder(ops)) {
    if (leg.scanBodyIndex === null) continue; // a leg after the scan pauses nothing
    if (leg.startsAt - start - shift < c) shift += leg.endsAt - leg.startsAt;
    else break;
  }
  return start + c + shift;
}

// The scan clock at absolute time `t`: seconds since the window opened, minus every leg's overlap. Pure.
export function scanClockAt(ops: Pick<GroundOpsState, "startedAt" | "shipLegs" | "repairLegs" | "studyLegs">, t: number): number {
  const start = ops.startedAt ?? 0;
  let away = 0;
  for (const leg of shipLegsInOrder(ops)) {
    if (leg.scanBodyIndex === null) continue; // a leg after the scan pauses nothing
    if (leg.startsAt >= t) break;
    away += Math.min(t, leg.endsAt) - leg.startsAt;
  }
  return Math.max(0, t - start - away);
}

// Where the ship is at `t` (display, GO-14): scanning a body, away on a recovery leg, or holding station once
// the scan is done. Reads the stored legs and the bodies' scanned latches. Pure.
// GO-8b: or on a FIELD REPAIR (flying to its site, repairing, flying back). Gas Giant Study GG-3: or holding orbit on a
// STUDY of an orbital body.
export type GroundShipPosition =
  | { kind: "scanning"; bodyIndex: number }
  | { kind: "recovery"; leg: GroundShipLeg }
  | { kind: "repair"; leg: GroundRepairLeg }
  | { kind: "study"; leg: GroundStudyLeg }
  | { kind: "holding" };
// The user's pickup pause: a pickup leg lies INSIDE the study it paused, so the legs are read before the studies (on
// every run without the stamp no two legs overlap, so the order changes nothing there).
export function groundShipPosition(exp: Pick<Expedition, "groundOps" | "bodies">, t: number): GroundShipPosition {
  const repair = exp.groundOps?.repairLegs?.find((l) => l.startsAt <= t && t < l.endsAt);
  if (repair) return { kind: "repair", leg: repair };
  const leg = exp.groundOps?.shipLegs.find((l) => l.startsAt <= t && t < l.endsAt);
  if (leg) return { kind: "recovery", leg };
  const study = exp.groundOps?.studyLegs?.find((l) => l.startsAt <= t && t < l.endsAt);
  if (study) return { kind: "study", leg: study };
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
// Security share. Field Kits FKR-7 (a Field Kits run only): the supplies it carries into the fight, its grenade
// charges, free basics and extras left (fieldKitsRun.ts); a FRESH read (an odds read for an objective not yet
// started) carries what it would land with: full charges, a fresh free basic set, its extras left. Every other run's
// side is exactly as before.
function fightTeamOf(exp: Pick<Expedition, "fieldKits">, ops: GroundOpsState, team: GroundTeamRun, fresh = false): GroundFightTeam {
  const side: GroundFightTeam = {
    securityIds: team.securityIds,
    downedThisTask: fresh ? [] : team.downedThisTask,
    securityShare: ops.factors.securityShare[teamPos(ops, team)] ?? 0,
  };
  if (!fieldKitsLive(exp)) return side;
  const basics = fresh ? freshBasicsFor(exp, team.securityIds) : team.basics;
  if (!fresh && team.charges) side.charges = team.charges;
  if (basics) side.basics = basics;
  if (team.kits) side.kits = team.kits;
  return side;
}

// Squads SQ-6 (the telescope's FORECAST, display only): the threat tier of the crew `teamIndices` (deployed team
// indices, e.g. a planned task's assignedTeamIds) on `taskId`, fresh (full HP, nobody sitting out) on the threat's
// own stream (groundThreat.ts), so a read never shifts a fight. Null when the run, the task or a team is missing.
// Pure.
export function groundCrewThreat(exp: Expedition, teamIndices: readonly number[], taskId: string): ThreatAssessment | null {
  const odds = groundCrewClearOdds(exp, teamIndices, taskId);
  return odds ? threatAssessment(odds.wins, odds.samples) : null;
}

// The clear odds behind groundCrewThreat (the SQ-6 follow-up's odds-aware recommendation averages them). Pure.
export function groundCrewClearOdds(exp: Expedition, teamIndices: readonly number[], taskId: string): { wins: number; samples: number } | null {
  const ops = exp.groundOps;
  const ref = findGroundTask(exp, taskId);
  if (!ops || !ref || teamIndices.length === 0) return null;
  const crew: GroundTeamRun[] = [];
  for (const i of teamIndices) {
    const team = ops.teams.find((t) => t.index === i);
    if (!team) return null;
    crew.push(team);
  }
  return groundTaskClearOdds(exp, crew.map((team) => fightTeamOf(exp, ops, team, true)), ref.body, ref.task, ref.flatIndex, undefined, undefined, 0, taskCover(ref.task));
}

// AF-2 (Rocky Outcroppings): the objective's cover against long-range attacks (affixes.ts longRangeCover), or
// undefined when it has none (so its fights and odds reads are exactly as before). Pure.
export function taskCover(task: Pick<ExpeditionActivity, "affixes">): GroundCover | undefined {
  if (!task.affixes || task.affixes.length === 0) return undefined;
  const cover = longRangeCover(task.affixes);
  return hasCover(cover) ? cover : undefined;
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

// ===== Squads SQ-3: needs in squads, team squads, coverage =====

// A whole number of squads (>= 0). Pure.
function isSquadCount(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

// The squads of each type a task's crew must bring (design 3.2): its stored `needs` when both counts are whole
// numbers >= 0; else the CARRY-FORWARD of GO-7c's requiredTeams N (a whole number >= 1) as N Ground teams'
// worth, { N, N }; else one Ground team's worth, { 1, 1 } (every task stamped before SQ-3 reads this way, so an
// in-flight run plans exactly as it did). Returns a fresh object. Pure.
export function taskNeedsOf(task: Pick<ExpeditionActivity, "needs" | "requiredTeams">): GroundTaskNeeds {
  const n = task.needs;
  if (n && isSquadCount(n.security) && isSquadCount(n.science)) return { security: n.security, science: n.science };
  const r = task.requiredTeams;
  const teams = typeof r === "number" && Number.isInteger(r) && r >= 1 ? r : 1;
  return { security: teams, science: teams };
}

// A deployed team's squads by its kind (groundComposition.ts): Ground { 1, 1 }, Strike { 2, 0 }, Survey { 0, 2 }.
// An absent or unknown kind reads as Ground (every run dispatched before SQ-3). Pure.
export function teamSquadsOf(team: Pick<GroundTeamRun, "kind">): GroundTaskNeeds {
  const kind: GroundTeamKind = isGroundTeamKind(team.kind) ? team.kind : DEFAULT_GROUND_TEAM_KIND;
  return { security: securitySquadsOf(kind), science: scienceSquadsOf(kind) };
}

// The squads of a set of teams, summed (a crew). Pure.
export function crewSquadsOf(teams: readonly Pick<GroundTeamRun, "kind">[]): GroundTaskNeeds {
  const out = { security: 0, science: 0 };
  for (const team of teams) {
    const q = teamSquadsOf(team);
    out.security += q.security;
    out.science += q.science;
  }
  return out;
}

// Do `squads` meet `needs` (at least as many squads of each type)? Pure.
export function squadsCover(squads: GroundTaskNeeds, needs: GroundTaskNeeds): boolean {
  return squads.security >= needs.security && squads.science >= needs.science;
}

// Does one team cover the task ALONE (a crew of one)? Pure.
function teamCovers(team: Pick<GroundTeamRun, "kind">, task: ExpeditionActivity): boolean {
  return squadsCover(teamSquadsOf(team), taskNeedsOf(task));
}

// Is the task a JOINT task (planned for a crew of 2+ teams: its assignedTeamIds)? GO-7c read requiredTeams > 1;
// the plan now writes the crew, so the crew it wrote is the one source (a pre-SQ-3 joint task was assigned its N
// teams the same way). Pure.
function isJointTask(task: Pick<ExpeditionActivity, "assignedTeamIds">): boolean {
  return (task.assignedTeamIds?.length ?? 0) >= 2;
}

// The needs a task is STAMPED with: taskNeedsOf, with at least 1 Security squad when the task holds a fight point
// (design 3.4: a crew with no Security can only take a task with no fight points; a Security-less crew sent at a
// fight could never win it). Pure.
function stampedNeeds(task: ExpeditionActivity, fights: number): GroundTaskNeeds {
  const needs = taskNeedsOf(task);
  if (fights > 0 && needs.security < 1) needs.security = 1;
  return needs;
}

// THE AMBUSH HOOK (user #5): the chance an unknown-risk ambush strikes a crew on this task, one roll per attempt.
// Only a calm task (no fight points: no fights expected) can be ambushed. Squads SQ-4: on a body carrying risk
// grades the chance is its risk's (riskFactors.ts riskAmbushChance: the worse of combat and fauna); without them
// (every run before SQ-4) SURVEY_AMBUSH_CHANCE (0). Pure.
export function groundTaskAmbushChance(task: Pick<ExpeditionActivity, "fightPoints">, body?: Pick<ExpeditionBody, "risk">): number {
  if ((task.fightPoints?.length ?? 0) !== 0) return 0;
  return body?.risk ? riskAmbushChance(body.risk) : SURVEY_AMBUSH_CHANCE;
}

// Does the task carry needs of its own (content needs, or a content requiredTeams)? Pure.
function hasContentNeeds(task: Pick<ExpeditionActivity, "needs" | "requiredTeams">): boolean {
  return task.needs !== undefined || task.requiredTeams !== undefined;
}

// ===== Task stamping and planning (a body's scan completes) =====

// Stamp every activity of body `bodyIndex` as a Ground Ops task (plan section 2): its fight points from the
// site's threat on the body's RAW hazard, its NEEDS in squads (Squads SQ-3: content needs, else the carry-forward
// of a content requiredTeams, else { 1, 1 }; at least 1 Security squad with a fight point), its ambush chance when
// above 0, nothing done yet, queued. Idempotent (a stamped task is left alone). Mutates the working clone.
// Squads SQ-4, a RISK-AWARE body (ExpeditionBody.risk, written at dispatch since SQ-4): the fight points read the
// body's risk (groundTasks.ts riskFightPointCount, floor 0), the needs are GENERATED from them and the site
// (riskFactors.ts generatedTaskNeeds; content needs still win), at most one squad of each type at Tiers I and II
// and as rolled from Tier III (riskFactors.ts tierNeeds, user 2026-10-13: SAFE TIERS ADAPT, LATER SKIP; a Tier
// III+ task the deployed squads cannot cover is skipped at planning with its log line), the DIFFICULTY grade is
// rated once from the generated needs, and a calm task takes its body's ambush chance. A body without risk
// stamps exactly as before.
export function initGroundTasks(exp: Expedition, bodyIndex: number): void {
  const body = exp.bodies[bodyIndex];
  if (!body) return;
  const risk = body.risk;
  const tier = exp.risk?.tier ?? 1;
  // Objective affixes (AF-1): only an affix-aware run (its profile carries a difficulty tier) stamps them.
  const difficultyTier = runDifficultyTier(exp.risk);
  // AF-2: the run's affix catalog version (a run dispatched before AF-2 stamps from AF-1's, on AF-1's draw layout).
  const catalog = runAffixCatalog(exp.risk);
  const training = isTrainingRun(exp);
  // Safe first runs SF-3: an ordinary run's curve position (1 = full strength, every run without the stamp).
  // (SF-3 review: the odds' own position, one run behind the enemy curve.)
  const ramp = runOddsRampOf(exp);
  for (let k = 0; k < body.activities.length; k += 1) {
    const task = body.activities[k];
    if (isGroundTask(task)) continue;
    if (risk) {
      const fights = riskFightPointCount(task.poiId, body.hazard, risk);
      task.fightPoints = fightPointFractions(fights);
      const content = hasContentNeeds(task);
      const raw = content ? taskNeedsOf(task) : generatedTaskNeeds(task.poiId, fights, tier);
      // A hostile site keeps its own needs (it is only ever placed where the deployed squads field it).
      const needs = content || isHostileSiteId(task.poiId) ? { ...raw } : tierNeeds(raw, tier);
      if (fights > 0 && needs.security < 1) needs.security = 1;
      task.needs = needs;
      delete task.requiredTeams;
      const score = taskDifficultyScore({ fightPoints: fights, hazard: body.hazard, needs: raw, combat: risk.combat });
      task.difficulty = difficultyGradeOf(score);
      if (difficultyTier !== null) {
        task.difficultyScore = score;
        const affixes = rollObjectiveAffixes({
          seed: exp.seed,
          bodyIndex,
          taskIndex: k,
          tier,
          difficulty: task.difficulty,
          difficultyTier,
          combat: fights > 0,
          catalog,
          planetType: body.planetType,
          ...(ramp < 1 ? { ramp } : {}),
        });
        // Safe first runs SF-2: a training run's objectives carry no affixes (the roll is still made, on its own keyed
        // stream, and dropped), so no Reinforcing, no alert, no cover.
        if (affixes.length > 0 && !training) task.affixes = affixes;
      }
    } else {
      task.fightPoints = fightPointFractions(fightPointCount(task.poiId, body.hazard));
      task.needs = stampedNeeds(task, task.fightPoints.length);
      delete task.requiredTeams; // read into needs (the carry-forward); never stored twice
    }
    // Safe first runs SF-2: no ambushes on a training run. SF-3: an ordinary run's chance on the curve (x ramp).
    const chance = training ? 0 : rampedChance(groundTaskAmbushChance(task, body), ramp);
    if (chance > 0) task.ambushChance = chance;
    task.progress = 0;
    task.pointsCleared = 0;
    task.segmentsBanked = 0;
    task.segmentsOffloaded = 0;
    task.fightCount = 0;
    task.status = "queued";
  }
}

// Queue body `bodyIndex`'s new tasks at `t` (see the header: PLANNING) through planTasksForTeams, which skips and
// logs a task NO crew of the deployed teams can cover (user: no softlock) [PROVISIONAL, Q20]; with no deployed
// team every task is skipped (nobody could ever work them; unreachable past the D18 gate). Mutates the clone.
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
  const refs: GroundTaskRef[] = [];
  for (const task of fresh) {
    const ref = findGroundTask(exp, task.id);
    if (ref) refs.push(ref);
  }
  planTasksForTeams(exp, refs, t);
}

// Append one display line to the run's log. Mutates.
function pushLog(ops: GroundOpsState, entry: GroundOpsLogEntry): void {
  (ops.log ??= []).push(entry);
}

// "3 Security squads" / "1 Science squad". Pure.
function squadsText(n: number, type: "Security" | "Science"): string {
  return `${n} ${type} squad${n === 1 ? "" : "s"}`;
}

// A log line in plain words (the UI shows it). Pure.
export function groundOpsLogText(exp: Pick<Expedition, "bodies">, entry: GroundOpsLogEntry): string {
  const task = findGroundTask(exp, entry.taskId)?.task;
  const name = (task && groundSiteLabel(task.poiId)) ?? "An objective";
  switch (entry.kind) {
    case "skippedNeedsTeams":
      return `Skipped ${name}: needs ${entry.requiredTeams} ground teams, ${entry.deployedTeams} deployed`;
    case "skippedNeedsSquads": {
      const short: string[] = [];
      if (entry.needs.security > entry.deployed.security) {
        short.push(`${squadsText(entry.needs.security, "Security")}, ${entry.deployed.security} deployed`);
      }
      if (entry.needs.science > entry.deployed.science) {
        short.push(`${squadsText(entry.needs.science, "Science")}, ${entry.deployed.science} deployed`);
      }
      return `Skipped ${name}: needs ${short.join("; ")}`;
    }
    case "alertReset":
      // Objective affixes (AF-1): the user's words.
      return `${name}: ${ALERT_RESET_TEXT}`;
    case "trainingFellBack":
      // Safe first runs SF-2: the user's words (SF12).
      return `${name}: ${TRAINING_FELL_BACK_TEXT}`;
  }
}

// How many of the threat samples `teams` (fresh: full HP, nobody sitting out) clear `ref` in one go (the
// display odds' stream, groundThreat.ts; a read never shifts a real fight). Pure.
function freshWins(exp: Expedition, ops: GroundOpsState, teams: readonly GroundTeamRun[], ref: GroundTaskRef): number {
  return groundTaskClearOdds(exp, teams.map((team) => fightTeamOf(exp, ops, team, true)), ref.body, ref.task, ref.flatIndex, undefined, undefined, 0, taskCover(ref.task))
    .wins;
}

// THE DEFAULT PLAN (user 9b.3) for `refs` (one body's new, playable tasks, discovery order): appends them to the
// deployed teams' queues and records each task's CREW (assignedTeamIds). Exported so GO-7d's "Default plan" edit
// can re-run it. Mutates the working clone.
//   A task's crew (Squads SQ-3, design 3.3) is the SMALLEST set of deployed teams whose squads cover its needs:
//   one team when any single team covers it (a SOLO task), else a joint crew.
//   One team: every task to it, EASIEST FIRST by its clear odds (ties: discovery order) [PROVISIONAL, Q3].
//   2+ teams: teams ranked by their MEAN clear rate over the SOLO tasks they cover (GO-7c review (a): joint
//     tasks never rank a team), strongest first (ties: team index); the solo tasks sorted HARDEST first by the
//     odds of the strongest team that covers each (ties: discovery order); the strongest team takes the hardest
//     ceil(n / teams), the next team the next ones, and so on ("harder tasks to A, middling to B, easy to C"),
//     a team only ever taking a task it covers alone (a task whose covering teams are all full goes to the one
//     holding the fewest, ties by rank). "teams" counts the teams that cover at least one solo task. With every
//     team covering every task this is exactly GO-7c's split. A JOINT task goes to the smallest covering set
//     with the best clear odds as a whole (ties: the set whose teams rank best) [PROVISIONAL], appended into
//     each crew team's queue. Each team's new tasks are appended EASIEST FIRST by its own odds (a joint task's
//     odds are its whole crew's).
//   A task no set of deployed teams covers (its needs exceed every deployed squad summed) is SKIPPED here with a
//   log line at `t` (the SQ-3 review: here, not in planNewTasks, so a GO-7d re-plan logs too), never queued.
export function planTasksForTeams(exp: Expedition, refs: readonly GroundTaskRef[], t: number): void {
  const ops = exp.groundOps;
  if (!ops || ops.teams.length === 0 || refs.length === 0) return;
  const order = new Map(refs.map((ref, k) => [ref.task.id, k] as const));
  const give = new Map<GroundTeamRun, { ref: GroundTaskRef; wins: number }[]>(ops.teams.map((team) => [team, []] as const));
  const deployed = crewSquadsOf(ops.teams);
  const playable = refs.filter((ref) => {
    const needs = taskNeedsOf(ref.task);
    if (squadsCover(deployed, needs)) return true;
    ref.task.status = "skipped";
    pushLog(ops, { at: t, kind: "skippedNeedsSquads", taskId: ref.task.id, needs, deployed: { ...deployed } });
    return false;
  });
  if (ops.teams.length === 1) {
    const team = ops.teams[0];
    for (const ref of playable) give.get(team)!.push({ ref, wins: freshWins(exp, ops, [team], ref) });
  } else {
    const memo = new Map<GroundTeamRun, Map<GroundTaskRef, number>>(ops.teams.map((team) => [team, new Map()] as const));
    const wins = (team: GroundTeamRun, ref: GroundTaskRef): number => {
      const mine = memo.get(team)!;
      let w = mine.get(ref);
      if (w === undefined) mine.set(ref, (w = freshWins(exp, ops, [team], ref)));
      return w;
    };
    const solo = playable.map((ref, k) => ({ ref, k })).filter(({ ref }) => ops.teams.some((team) => teamCovers(team, ref.task)));
    const mean = new Map<GroundTeamRun, number>();
    for (const team of ops.teams) {
      const mine = solo.filter(({ ref }) => teamCovers(team, ref.task));
      mean.set(team, mine.length > 0 ? mine.reduce((a, { ref }) => a + wins(team, ref), 0) / mine.length : -1);
    }
    const ranked = [...ops.teams].sort((a, b) => mean.get(b)! - mean.get(a)! || a.index - b.index);
    const pool = ranked.filter((team) => solo.some(({ ref }) => teamCovers(team, ref.task)));
    const strongestFor = (ref: GroundTaskRef): GroundTeamRun => pool.find((team) => teamCovers(team, ref.task)) as GroundTeamRun;
    solo.sort((a, b) => wins(strongestFor(a.ref), a.ref) - wins(strongestFor(b.ref), b.ref) || a.k - b.k);
    const per = Math.ceil(solo.length / Math.max(1, pool.length));
    const held = new Map<GroundTeamRun, number>(pool.map((team) => [team, 0] as const));
    for (const { ref } of solo) {
      const eligible = pool.filter((team) => teamCovers(team, ref.task));
      const team = eligible.find((x) => held.get(x)! < per) ?? eligible.reduce((best, x) => (held.get(x)! < held.get(best)! ? x : best));
      held.set(team, held.get(team)! + 1);
      give.get(team)!.push({ ref, wins: wins(team, ref) });
    }
    for (const ref of playable) {
      if (ops.teams.some((team) => teamCovers(team, ref.task))) continue;
      const crew = jointCrewFor(exp, ops, ranked, ref);
      if (!crew) {
        ref.task.status = "skipped";
        continue;
      }
      const joint = freshWins(exp, ops, crew, ref);
      for (const team of crew) give.get(team)!.push({ ref, wins: joint });
    }
  }
  for (const team of ops.teams) {
    const mine = give.get(team)!;
    mine.sort((a, b) => b.wins - a.wins || order.get(a.ref.task.id)! - order.get(b.ref.task.id)!);
    for (const { ref } of mine) team.queue.push(ref.task.id);
  }
  for (const ref of playable) {
    if (ref.task.status === "skipped") continue;
    const owners = ops.teams.filter((team) => give.get(team)!.some((g) => g.ref === ref)).map((team) => team.index);
    ref.task.assignedTeamIds = owners;
  }
}

// The JOINT crew for a task no single team covers (see planTasksForTeams): among the SMALLEST sets of deployed
// teams whose squads cover its needs, the one with the most fresh clear wins as a whole; ties go to the set whose
// teams rank best (`ranked` positions compared in order). Ascending team index; null when no set covers it.
// Pure (the odds reads are the display stream).
function jointCrewFor(exp: Expedition, ops: GroundOpsState, ranked: readonly GroundTeamRun[], ref: GroundTaskRef): GroundTeamRun[] | null {
  const needs = taskNeedsOf(ref.task);
  const n = ops.teams.length;
  const rankOf = (team: GroundTeamRun) => ranked.indexOf(team);
  for (let size = 2; size <= n; size += 1) {
    let best: { crew: GroundTeamRun[]; wins: number; ranks: number[] } | null = null;
    for (let mask = 1; mask < 1 << n; mask += 1) {
      const crew = ops.teams.filter((_, i) => (mask & (1 << i)) !== 0);
      if (crew.length !== size || !squadsCover(crewSquadsOf(crew), needs)) continue;
      const w = freshWins(exp, ops, crew, ref);
      const ranks = crew.map(rankOf).sort((a, b) => a - b);
      if (best === null || w > best.wins || (w === best.wins && ranksBefore(ranks, best.ranks))) best = { crew, wins: w, ranks };
    }
    if (best) return best.crew;
  }
  return null;
}

// Do rank positions `a` come before `b` (compared in order; both sorted, the same length)? Pure.
function ranksBefore(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
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
  // Gas Giant Study GG-3: an orbital body of a study run (no ground objective, GG-2) is studied by the ship, from now.
  const body = exp.bodies[bodyIndex];
  if (body && isStudyBody(exp, body)) scheduleStudyLeg(exp, bodyIndex, t);
  // GG-4: once the last body is scanned the ship sweeps the system's nebula, after any study under way.
  if (sweepsNebula(exp)) scheduleNebulaSweep(exp, t);
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
    // GO-8b: a field repair's end (absent on every run without one, so the order below is GO-7b's exactly).
    const repair = nextRepairEnd(ops);
    const tRepair = repair ? repair.endsAt : null;
    // AF-1: an objective's alert lapsing (null on every run without an alert, so the order below is unchanged).
    const tAlert = nextAlertReset(exp);
    // Gas Giant Study GG-3: a study's end (absent on every run without one, so the order below is unchanged).
    const study = nextStudyEnd(ops);
    const tStudy = study ? study.endsAt : null;
    const t = [tScan, tTeam, tRepair, tAlert, tStudy].reduce<number | null>((a, b) => (b === null ? a : a === null ? b : Math.min(a, b)), null);
    if (t === null || t > now + EVENT_EPS) return;
    if (tAlert === t) {
      // At one instant an alert's reset goes first: housekeeping (the pure alert level already reads 0 from this
      // instant), then idle teams pick the objective up again below.
      resetAlerts(exp, t);
    } else if (repair && tRepair === t) {
      // At one instant a repair's end goes first (the ship is whole again before the next scan event can hurt it).
      finishFieldRepair(ops, repair);
    } else if (study && tStudy === t) {
      // Then a study's end: its reward lands before the scan resumes and before a team docks at this instant.
      finishStudy(exp, study);
    } else if (tScan !== null && (tTeam === null || tScan <= tTeam)) {
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
//     the first queued task of its own queue: a solo task deploys at once; a joint task (a crew of 2+ teams,
//     Squads SQ-3) goes to STAGING, and when every team of its crew is staging the LEAD (lowest index) deploys.
//   Pass 2, HELPERS (user D25 + 9b.4): a team still idle (nothing of its own to do) with helpOthers BORROWS the
//     first task (other teams in index order, their queue order) that is queued, planned for a crew of one, that
//     the helper's own squads cover ALONE (Squads SQ-3, design 3.3), is not on its skippedBorrowed list and rates
//     at least HELPER_MIN_TIER for it from the task's current progress. Own work goes first, so a helper never
//     takes a task from an owner who is free to work it.
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
      // A joint task this team is not assigned to is never staged by it (it could wait forever). An objective HELD
      // by its alert (AF-1's failsafe: Impossible until the alert lapses) is passed over; the team moves on.
      if (
        ref &&
        ref.task.status === "queued" &&
        (!isJointTask(ref.task) || (ref.task.assignedTeamIds ?? []).includes(team.index)) &&
        !objectiveHeld(ref.task, t)
      ) {
        next = ref;
        break;
      }
    }
    if (!next) continue;
    next.task.status = "active";
    // Tried again after going to the back of the line: a fresh streak (user, GO-7b answers).
    if ((next.task.lossStreak ?? 0) >= GROUND_STUCK_LOSSES) delete next.task.lossStreak;
    if (isJointTask(next.task)) {
      stageOn(ops, team, next, t);
      continue;
    }
    team.taskId = next.task.id;
    team.attemptPoints = next.task.pointsCleared ?? 0;
    moveTo(ops, team, "deploy", t, t + DEPLOY_SECONDS);
  }
  for (const team of ops.teams) {
    if (team.step !== "idle" || !team.helpOthers) continue;
    const ref = borrowableTask(exp, ops, team, t);
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
    if (!ref || ref.task.status !== "active" || !isJointTask(ref.task)) continue;
    if (!(ref.task.assignedTeamIds ?? []).includes(team.index) || !jointWaiting(ops, id)) continue;
    return ref;
  }
  return null;
}

// `team` stages on joint task `ref` at `t`; once every team of its crew (assignedTeamIds, Squads SQ-3: the
// smallest set covering its needs) is staging on it and the crew's squads cover the needs, the LEAD (the lowest
// index) deploys and the partners stay "staging" (mirroring the lead's task) until the joint return. Mutates.
function stageOn(ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number): void {
  team.taskId = ref.task.id;
  team.attemptPoints = ref.task.pointsCleared ?? 0;
  moveTo(ops, team, "staging", t, null);
  const assigned = ref.task.assignedTeamIds ?? [];
  const crew = ops.teams.filter((x) => assigned.includes(x.index));
  if (crew.length < 2 || !squadsCover(crewSquadsOf(crew), taskNeedsOf(ref.task))) return;
  if (!crew.every((x) => x.step === "staging" && x.taskId === ref.task.id)) return;
  moveTo(ops, crew[0], "deploy", t, t + DEPLOY_SECONDS);
}

// The task a helper borrows (see groundOpsAssignIdle pass 2), or null. Pure (the odds read is memoized).
// AF-1: never a HELD objective, and the floor reads the objective's alert at `t` (its escalated fights).
function borrowableTask(exp: Expedition, ops: GroundOpsState, helper: GroundTeamRun, t: number): GroundTaskRef | null {
  const side = [fightTeamOf(exp, ops, helper, true)];
  for (const owner of ops.teams) {
    if (owner === helper) continue;
    for (const id of owner.queue) {
      if (helper.skippedBorrowed.includes(id)) continue;
      const ref = findGroundTask(exp, id);
      if (!ref || ref.task.status !== "queued" || isJointTask(ref.task) || !teamCovers(helper, ref.task)) continue;
      if (objectiveHeld(ref.task, t)) continue;
      const alert = alertLevelAt(ref.task, t);
      const threat = groundTaskThreat(exp, side, ref.body, ref.task, ref.flatIndex, undefined, undefined, alert, taskCover(ref.task));
      if (tierAtLeast(threat.tier, HELPER_MIN_TIER)) return ref;
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
  // GO-8b: the ship heads home only once its field repair is done.
  if (nextRepairEnd(ops)) return;
  // Gas Giant Study GG-3: and once every study is done.
  if (nextStudyEnd(ops)) return;
  ops.endedAt = t;
}

// ===== Expedition Tiers G2-5: the recall closes the window; a resumed run opens it on charted bodies =====

// The steps a team is DOWN on a surface in (or on its way between it and the ship): the recall's pickup collects
// them. Every other step is aboard (idle, staging for a partner, offload, bay, reload).
const SURFACE_STEPS: ReadonlySet<GroundStepKind> = new Set<GroundStepKind>(["deploy", "work", "fight", "return"]);

// THE RECALL (user #4 "you retain your progress"; plan G2-5): the operations window closes at `t`. Every crew on a
// surface stops where it is: a work step keeps the progress interpolated along it (nothing of the unfinished segment
// is banked, the GO-7d stopCrew rule), a fight under way is broken off (its result, resolved at its start, is never
// applied: the crew is pulled out), a drop or a shuttle simply ends; the teams come up on ONE shared in-system pickup
// (IN_SYSTEM_LEG_SECONDS, only when anyone was down). Finished work comes home: every banked segment not yet
// offloaded is offloaded now (its finding, and a completed objective's relic roll, exactly as an offload makes them).
// Objectives in progress go back to queued with their progress kept; a team staging for a partner is released. The
// medical bay works on the way home: each member's bay time for the conditions gathered on this trip starts once
// aboard (a team already in the bay keeps its own clock); claimExpedition brings home whoever is still in it. A
// field repair under way stops (the hull comes home with its damage). Returns the pickup seconds. Mutates the working
// clone (expedition.ts recallExpedition's).
export function closeGroundOps(exp: Expedition, t: number, driver: GroundOpsScanDriver): number {
  const ops = exp.groundOps;
  if (!ops || ops.endedAt !== undefined) return 0;
  const surface = ops.teams.filter((team) => SURFACE_STEPS.has(team.step));
  const pickup = surface.length > 0 ? IN_SYSTEM_LEG_SECONDS : 0;
  const aboardAt = t + pickup;
  // Work under way keeps its interpolated progress (the lead carries a crew's work step).
  for (const team of ops.teams) {
    if (team.step !== "work" || team.taskId === undefined || team.workFrom === undefined || team.workTo === undefined || team.stepEndsAt === null) continue;
    const ref = findGroundTask(exp, team.taskId);
    if (!ref) continue;
    const span = team.stepEndsAt - team.stepStartedAt;
    const f = span > 0 ? Math.max(0, Math.min(1, (t - team.stepStartedAt) / span)) : 0;
    ref.task.progress = team.workFrom + (team.workTo - team.workFrom) * f;
  }
  // Finished work comes home: every banked segment not offloaded yet, credited to the team set that banked it.
  for (const body of exp.bodies) {
    for (const task of body.activities) {
      if (!((task.segmentsBanked ?? 0) > (task.segmentsOffloaded ?? 0))) continue;
      const ref = findGroundTask(exp, task.id);
      if (!ref) continue;
      const holder = ops.teams.find((team) => team.taskId === task.id) ?? ops.teams.find((team) => (task.assignedTeamIds ?? []).includes(team.index)) ?? ops.teams[0];
      if (holder) offloadFindings(exp, ops, holder, ref, t, driver);
    }
  }
  for (const body of exp.bodies) for (const task of body.activities) if (task.status === "active") task.status = "queued";
  for (const team of ops.teams) {
    if (team.step === "bay") continue;
    const wasDown = SURFACE_STEPS.has(team.step);
    if (wasDown) moveTo(ops, team, "return", t, aboardAt, { stopped: true });
    const at = wasDown ? aboardAt : t;
    let longest = 0;
    const bayEnds: Record<string, number> = {};
    for (const [id, secs] of Object.entries(groundTeamBaySeconds(exp, team))) {
      if (!(secs > 0)) continue;
      bayEnds[id] = at + secs;
      longest = Math.max(longest, secs);
    }
    team.bayEnds = bayEnds;
    if (longest > 0) {
      team.bayStart = at;
      moveTo(ops, team, "bay", at, at + longest, wasDown ? {} : { stopped: true });
    } else {
      moveTo(ops, team, "idle", at, null, wasDown ? {} : { stopped: true });
    }
    delete team.taskId;
    delete team.borrowed;
    delete team.attemptPoints;
    delete team.workFrom;
    delete team.workTo;
    delete team.pendingFight; // a fight broken off: never applied
    delete team.ambushed;
    delete team.jointPartner;
    delete team.recalled;
    delete team.reinforcementsAt;
    delete team.reinforcing;
  }
  ops.endedAt = t;
  ops.recalledAt = t;
  return pickup;
}

// A RESUMED run's window opens at `t` on its first `charted` bodies already scanned (expedition.ts opens the scan
// clock past them): those bodies' objectives still to do (queued, nothing assigned: the recall left them so) are
// planned for THIS run's teams as a body's new objectives are (planNewTasks: easiest first, a crew that cannot cover
// one skips it with its log line), every team can act from `t`, idle teams take their work, and the run-end condition
// is checked (a system whose remaining bodies are all charted closes at once when nothing is left). Mutates.
export function openResumedGroundOps(exp: Expedition, charted: number, t: number): void {
  const ops = exp.groundOps;
  if (!ops) return;
  for (const team of ops.teams) if (team.step === "idle") team.stepStartedAt = t;
  for (let i = 0; i < Math.min(charted, exp.bodies.length); i += 1) planNewTasks(exp, i, t);
  // Gas Giant Study GG-3 x G2-5: a charted giant whose study the recall cut short is studied now (from the window's
  // opening, one after another); one studied on an earlier trip (`studied`) is not studied again.
  for (let i = 0; i < Math.min(charted, exp.bodies.length); i += 1) {
    const body = exp.bodies[i];
    if (isStudyBody(exp, body) && body.studied !== true) scheduleStudyLeg(exp, i, t);
  }
  // GG-4: a resumed system whose every body is charted sweeps its nebula from the opening, after those studies (one an
  // earlier trip swept carries `swept` and is not swept again).
  if (sweepsNebula(exp)) scheduleNebulaSweep(exp, t);
  groundOpsAssignIdle(exp, t);
  checkRunEnd(exp, t);
}

// ===== Objective affixes (AF-1): the alert's reset event =====

// The earliest instant a stored alert lapses (affixes.ts alertResetsAt), over EVERY task of the run whatever its
// status (so a stored alert can never outlive its reset and fire in the past), or null. Pure.
function nextAlertReset(exp: Expedition): number | null {
  let best: number | null = null;
  for (const body of exp.bodies) {
    for (const task of body.activities) {
      if (!task.alert) continue;
      const at = alertResetsAt(task);
      if (at === null) continue;
      if (best === null || at < best) best = at;
    }
  }
  return best;
}

// Every alert that lapses at or before `t` is cleared ("the threat appears to have retreated", user); a log line
// for a task still to do. The objective is back to normal and workable (the window's assignment then runs at `t`).
// Mutates the working clone.
function resetAlerts(exp: Expedition, t: number): void {
  const ops = exp.groundOps as GroundOpsState;
  for (const body of exp.bodies) {
    for (const task of body.activities) {
      if (!task.alert) continue;
      const at = alertResetsAt(task);
      if (at !== null && at > t) continue;
      delete task.alert;
      if (task.status === "queued" || task.status === "active") pushLog(ops, { at: t, kind: "alertReset", taskId: task.id });
    }
  }
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
  // A zero-length idle or staging step is not recorded, unless a player's edit ended it (GO-7d `stopped`).
  if (rec.stopped || !((team.step === "idle" || team.step === "staging") && team.stepStartedAt === t)) {
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
      return ref ? landOnTask(exp, ops, team, ref, t) : toIdle(ops, team, t);
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

// The crew LANDS on the task at `t` (the drop ended). Objective affixes (AF-1, Reinforcing): an objective whose
// affixes bring reinforcements rolls this VISIT's extra battles (affixes.ts rollReinforcements on its keyed stream,
// the objective's `visits` the key) as STRIKE POINTS along the progress still ahead (user 2026-10-14: mid-work, at
// random points along the progress bar, like ambushes), stored on the lead (reinforcementsAt); startWork cuts the
// work where each strikes. Any other task: no draw, no visit counted. Then the visit begins (beginOnTask).
function landOnTask(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number): void {
  const task = ref.task;
  if (task.affixes && task.affixes.length > 0 && (task.fightPoints?.length ?? 0) > 0) {
    const visit = task.visits ?? 0;
    const strikes = visitReinforcements(exp, crewOf(ops, team), ref, visit);
    task.visits = visit + 1;
    const from = task.progress ?? 0;
    if (strikes.length > 0) team.reinforcementsAt = strikes.map((f) => from + (1 - from) * f);
  }
  // Field Kits FKR-7 (a Field Kits run only): the crew lands with fresh supplies, every objective and every trip (user
  // N12, group 7 "Free, every objective"): each Security member's free basic set refilled, every grenade charge full.
  refreshObjectiveSupplies(exp, crewOf(ops, team));
  beginOnTask(exp, ops, team, ref, t);
}

// The strike points visit number `visit` of the objective brings (affixes.ts rollReinforcements, on its keyed stream).
// Field Kits FKR-8 (OC-F1): the landing crew's Shroud Emitter or Lure Beacon scales the visit's chance, rolled for this
// use (a run carrying the field devices stamp only; groundDeviceChance). The one reader of the roll (landOnTask), exported
// for the wiring probe. Pure.
export function visitReinforcements(exp: Expedition, crew: readonly GroundTeamRun[], ref: GroundTaskRef, visit: number): number[] {
  const scaled = fieldDevicesLive(exp) ? (c: number) => groundDeviceChance(exp, crew, c, "reinforcement", ref.flatIndex, visit) : undefined;
  return rollReinforcements(exp.seed, ref.flatIndex, visit, ref.task.affixes, scaled);
}

// On the task at `t` (after the drop): a fight waits at the held progress
// (a retry resumes AT the point that beat the team), else work to the next point or 100%. `rec` adds to the closed
// step's record.
function beginOnTask(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number, rec: Partial<GroundStepRecord> = {}): void {
  const points = ref.task.fightPoints ?? [];
  const cleared = ref.task.pointsCleared ?? 0;
  if (cleared < points.length && (ref.task.progress ?? 0) >= points[cleared]) return startFight(exp, ops, team, ref, t, rec);
  startWork(exp, ops, team, ref, t, rec);
}

// Work from the task's progress to its next fight point (or 100%): (to - from) of the task's full work time
// for the crew's members still standing (a joint task: every team's, the Science fieldwork summed), whole
// seconds, at least 1. `team` is the crew's lead. On a calm task a crew may meet an AMBUSH (Squads SQ-3, user #5):
// rolled here, at the step's start, on its own keyed stream; the step then ends early, where it strikes, and at
// its end (finishWork) a crew with a standing Security member fights it where it stands (SQ-4, a surprise fight)
// while one without retreats.
function startWork(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number, rec: Partial<GroundStepRecord> = {}): void {
  const points = ref.task.fightPoints ?? [];
  const cleared = ref.task.pointsCleared ?? 0;
  const from = ref.task.progress ?? 0;
  const to = cleared < points.length ? points[cleared] : 1;
  const crew = crewOf(ops, team);
  const full = taskWorkSeconds(exp, crew.map((member) => workTeamOf(ops, member)), ref.body, ref.task.poiId);
  const secs = Math.max(1, Math.round((to - from) * full));
  team.workFrom = from;
  // AF-1, Reinforcing: this visit's next reinforcement strikes inside this step (its point before `to`): the step
  // ends there, at whole second 1 to secs - 1 of it, and finishWork fights it where the work stopped. A step under
  // 2 s runs WHOLE (to `to`, exactly) and the strike lands at its end: finishWork then banks the finished segment
  // FIRST, so the working crew gets its credit, and fights the reinforcements after (AF-1 re-review). Calm
  // objectives never carry it, so it never meets an ambush.
  const next = team.reinforcementsAt?.[0];
  if (next !== undefined && next < to) {
    team.reinforcementsAt = (team.reinforcementsAt as number[]).slice(1);
    if (team.reinforcementsAt.length === 0) delete team.reinforcementsAt;
    const at = secs >= 2 ? Math.max(1, Math.min(secs - 1, Math.round(((Math.max(next, from) - from) / Math.max(to - from, 1e-12)) * secs))) : secs;
    team.workTo = at === secs ? to : from + (to - from) * (at / secs);
    team.reinforcing = true;
    return moveTo(ops, team, "work", t, t + at, rec);
  }
  const strike = ambushStrike(exp, ref, secs, crew);
  if (strike !== null) {
    team.workTo = from + (to - from) * (strike / secs);
    team.ambushed = true;
    return moveTo(ops, team, "work", t, t + strike, rec);
  }
  team.workTo = to;
  moveTo(ops, team, "work", t, t + secs, rec);
}

// The ambush roll's private stream seed, keyed by the task's flat index and its ambushes so far (so every attempt
// rolls fresh, and an attempt that is not ambushed finishes the task). Pure.
export function groundAmbushSeed(exp: Pick<Expedition, "seed">, flatIndex: number, ambushes: number): number {
  return (exp.seed ^ GROUND_AMBUSH_SALT ^ Math.imul(flatIndex + 1, 0x9e3779b9) ^ Math.imul(ambushes + 1, 0x85ebca6b)) >>> 0;
}

// When an ambush strikes this work step of `secs` seconds (whole seconds into it, 1 to secs - 1), or null. Any
// crew on a task with an ambush chance above 0 (groundTaskAmbushChance, stamped; only risk-aware runs since SQ-4
// stamp one) can be ambushed, at most SURVEY_AMBUSH_MAX_PER_TASK times per task, and only on a step long enough
// to cut (SQ-3 struck only a crew with no Security squad; SQ-4's surprise fight covers the rest). Two draws on
// makeRng(groundAmbushSeed): whether it strikes (next() < chance), then the second it strikes at
// (1 + nextInt(secs - 1)). Field Kits FKR-8 (OC-F1): on a run carrying the field devices stamp the working crew's
// Shroud Emitter or Lure Beacon scales the chance draw 1 compares against, rolled for this use (groundDeviceChance, its
// own stream); the two draws are the same either way. The one reader of the roll (startWork), exported for the wiring
// probe. Pure.
export function ambushStrike(exp: Expedition, ref: GroundTaskRef, secs: number, crew: readonly GroundTeamRun[]): number | null {
  const raw = ref.task.ambushChance;
  const chance = typeof raw === "number" && Number.isFinite(raw) ? Math.min(1, raw) : 0;
  if (!(chance > 0) || secs < 2) return null;
  const ambushes = ref.task.ambushes ?? 0;
  if (ambushes >= SURVEY_AMBUSH_MAX_PER_TASK) return null;
  const rng = makeRng(groundAmbushSeed(exp, ref.flatIndex, ambushes));
  if (!(rng.next() < groundDeviceChance(exp, crew, chance, "ambush", ref.flatIndex, ambushes))) return null;
  return 1 + rng.nextInt(secs - 1);
}

// Field Kits FKR-8 (the wiring plan's OC-F1, user "Move them to the ground"): a chance the crew's FIELD DEVICES act on,
// for one use. On a run carrying the field devices stamp (fieldKits.ts fieldDevicesLive) the crew's STANDING Security
// members' worn Shroud Emitters and Lure Beacons (their summed dial; a member downed in the objective sits out, as on
// the legacy scan) scale `chance` at this use's rolled 50 to 75% (x1.06 with a Codebreaker aboard), keyed by the use
// (`use`, `a`, `b`: the objective's flat index and its ambush or visit count). No device worn, or an earlier run: the
// chance as is, and no roll is read. Pure.
export function groundDeviceChance(exp: Expedition, crew: readonly GroundTeamRun[], chance: number, use: "ambush" | "reinforcement", a: number, b: number): number {
  if (!fieldDevicesLive(exp) || !(chance > 0)) return chance;
  const standing = new Set(crew.flatMap((member) => member.securityIds.filter((id) => !member.downedThisTask.includes(id))));
  const dial = fieldDeviceDial((exp.roster?.security ?? []).filter((m) => standing.has(m.memberId)));
  if (dial === 0) return chance;
  return fieldDeviceChance(chance, dial, fieldDeviceUseEffectiveness(exp, use, a, b));
}

// Work reached its target: bank the segment just finished (segment index = the points cleared so far) for the
// crew's team set, then the task is done at 100% (every crew team returns) or a fight waits at the point. A
// step an AMBUSH cut short banks nothing (the segment is not finished): a crew with a standing Security member
// meets it as a SURPRISE FIGHT where it stands (Squads SQ-4, user: "win: work continues; lose: a normal wipe"),
// a crew with none retreats (SQ-3).
function finishWork(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number): void {
  if (team.reinforcing) {
    // AF-1 re-review: a strike that landed at the END of a step (the step ran whole: under 2 s) finds the segment
    // finished, so the working crew banks it FIRST; the reinforcement fight follows where the work stopped.
    const points = ref.task.fightPoints ?? [];
    const cleared = ref.task.pointsCleared ?? 0;
    const target = cleared < points.length ? points[cleared] : 1;
    if (team.workTo !== undefined && team.workTo >= target) {
      bankSegment(ops, team, ref.task);
      if (exp.gearWear) tallyGroundWear(ops, crewOf(ops, team).flatMap((member) => member.scienceIds), "steps");
    }
    return reinforcementFight(exp, ops, team, ref, t);
  }
  if (team.ambushed) {
    const crew = crewOf(ops, team);
    const standing = crew.some((member) => member.securityIds.some((id) => !member.downedThisTask.includes(id)));
    return standing ? surpriseFight(exp, ops, team, ref, t) : ambushRetreat(exp, ops, team, ref, t);
  }
  const task = ref.task;
  const crew = crewOf(ops, team);
  const to = team.workTo ?? task.progress ?? 0;
  task.progress = to;
  bankSegment(ops, team, task);
  // GEAR WEAR step 3: the crew's Science members completed one fieldwork step (their tools wear by fieldwork).
  if (exp.gearWear) tallyGroundWear(ops, crew.flatMap((member) => member.scienceIds), "steps");
  delete team.workFrom;
  delete team.workTo;
  if (to >= 1) {
    // A joint task completes ONCE, here, for the whole crew (user #13), and pays once (the lead's offload).
    task.status = "done";
    task.done = true;
    task.completedAt = t;
    // TASK CHAINS (user #14, WR-13): a completed task may reveal a follow-up on its body, planned at this instant
    // (before the crew returns, so the run cannot close on it). No chain is authored today (riskFactors.ts).
    revealFollowUpTask(exp, ref, t);
    returnCrew(exp, ops, team, crew, ref, t, []);
    return;
  }
  startFight(exp, ops, team, ref, t);
}

// The task for discovery `discovery`, body `body`'s k-th task (its id is its position). The ONE builder of a body's
// tasks: expedition.ts assignDiscoveriesAndActivities maps a scanned body's discoveries through it, and a task chain
// reveal (revealFollowUpTask) appends through it. Pure.
export function bodyTaskFor(exp: Pick<Expedition, "id">, body: Pick<ExpeditionBody, "id">, discovery: Pick<ExpeditionDiscovery, "poiId">, k: number): ExpeditionActivity {
  return { id: `${exp.id}-${body.id}-act-${k}`, bodyId: body.id, poiId: discovery.poiId, done: false };
}

// TASK CHAINS (user #14; WR-13, OC-C4 "Keep tested hooks"): the task `ref` just completed at `t`. When
// riskFactors.ts taskChainFollowUp names a follow-up site for it, that site joins the same body exactly as a scan's
// discovery does: one more discovery (its pool's kind; a site outside the catalog, a hostile or clearing site, is a
// landmark) and its task (bodyTaskFor), stamped by initGroundTasks (it touches only the unstamped new task) and
// planned for the deployed teams by planNewTasks (a crew that cannot cover it skips it with its log line). Called
// once per task, from the one place a task completes (finishWork), inside the window's event at `t`, so a reveal
// lands at the same instant however the run is stepped. The new task takes the next flat index after its body's
// tasks, so the flat index (the seed key) of every task on a LATER body moves up by one from `t` on. No chain is
// authored today (TASK_CHAIN_FOLLOW_UPS is empty), so nothing is revealed. Mutates the working clone.
function revealFollowUpTask(exp: Expedition, ref: GroundTaskRef, t: number): void {
  const poiId = taskChainFollowUp(ref.task.poiId);
  if (poiId === null) return;
  const body = ref.body;
  const kind: ExpeditionDiscovery["kind"] = getPoiById(poiId)?.pool === "underground" ? "underground" : "landmark";
  const discovery: ExpeditionDiscovery = { id: `${exp.id}-${body.id}-disc-${body.discoveries.length}`, kind, poiId };
  body.discoveries.push(discovery);
  body.activities.push(bodyTaskFor(exp, body, discovery, body.activities.length));
  initGroundTasks(exp, ref.bodyIndex);
  planNewTasks(exp, ref.bodyIndex, t);
}

// GEAR WEAR step 3 (a run stamped Expedition.gearWear only): count one ground fight or fieldwork step for each listed
// member (once each), in ops.wearTally, read when the run comes home (gearWearEngine.ts expeditionWear). Resolution
// never reads it. Mutates the ops record.
function tallyGroundWear(ops: GroundOpsState, memberIds: readonly string[], kind: "fights" | "steps"): void {
  const ids = [...new Set(memberIds)];
  if (ids.length === 0) return;
  const tally = (ops.wearTally ??= {});
  for (const id of ids) {
    const row = (tally[id] ??= {});
    row[kind] = (row[kind] ?? 0) + 1;
  }
}

// GEAR WEAR step 4: add a fight's armor wear (memberId -> raw per-mille) to ops.wearTally. Mutates the ops record.
function tallyArmorWear(ops: GroundOpsState, armorWear: Readonly<Record<string, number>>): void {
  const tally = (ops.wearTally ??= {});
  for (const [id, raw] of Object.entries(armorWear)) {
    if (!(raw > 0)) continue;
    const row = (tally[id] ??= {});
    row.armor = (row.armor ?? 0) + raw;
  }
}

// Bank the segment the crew just finished (segment index = the points cleared so far) for the crew's team set. A
// segment already banked keeps its first bankers (AF-1 re-review: a crew that banked a segment and then lost the
// reinforcement fight there keeps the credit; the crew that later finishes the zero-length remainder does not take
// it). Mutates the task.
function bankSegment(ops: GroundOpsState, team: GroundTeamRun, task: ExpeditionActivity): void {
  const segment = task.pointsCleared ?? 0;
  const bankers = task.segmentBankers ?? [];
  if (bankers[segment] === undefined || !((task.segmentsBanked ?? 0) > segment)) bankers[segment] = crewOf(ops, team).map((member) => member.index);
  task.segmentBankers = bankers;
  task.segmentsBanked = Math.max(task.segmentsBanked ?? 0, segment + 1);
}

// THE SURPRISE FIGHT (Squads SQ-4; user, SQ-3 calls (c)): an ambush struck a crew with a standing Security member.
// The progress up to the ambush is kept (nothing banked), the ambush counts toward the task's cap, and the crew's
// Security fights where it stands, on the task's ordinary keyed fight stream (fightCount moves on, so every fight
// stays fresh), with its carry. The record is marked `surprise`: a win passes no fight point and the work goes on
// from the same spot; a loss is an ordinary loss (finishFight: a wipe waits for the ship). Mutates.
function surpriseFight(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number): void {
  const task = ref.task;
  task.progress = team.workTo ?? task.progress ?? 0;
  task.ambushes = (task.ambushes ?? 0) + 1;
  delete team.workFrom;
  delete team.workTo;
  delete team.ambushed;
  startFight(exp, ops, team, ref, t, { ambushed: true }, "surprise");
}

// A REINFORCEMENT strikes (AF-1, Reinforcing; user 2026-10-14: mid-work, like an ambush): the progress up to the
// strike is kept (nothing banked: the segment is unfinished) and the crew fights the reinforcements where it stands,
// on the task's ordinary keyed fight stream (fightCount moves on), with its carry, escalated by the objective's
// alert. The record is marked `reinforcement`: a win passes no fight point and the work goes on from the same spot;
// a loss is an ordinary loss (finishFight). A crew with no standing Security member still has to meet it: the fight
// fields nobody and is lost (a combat objective's crew always brings Security). Mutates.
function reinforcementFight(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number): void {
  ref.task.progress = team.workTo ?? ref.task.progress ?? 0;
  delete team.workFrom;
  delete team.workTo;
  delete team.reinforcing;
  startFight(exp, ops, team, ref, t, {}, "reinforcement");
}

// THE SURVEY RETREAT (user #5): an ambush struck a crew with no Security squad. It never fights: the progress up
// to the ambush is kept (nothing is banked: the segment is unfinished), the task goes back to queued for a later
// try, every crew member comes back with SURVEY_AMBUSH_CONDITIONS (a short bay), and the crew shuttles up on its
// own (an ordinary return: standing members are never a wipe). A loss streak never counts it (progress was made);
// a helper lists the task in skippedBorrowed like any give-up. Mutates.
function ambushRetreat(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number): void {
  const task = ref.task;
  const crew = crewOf(ops, team);
  task.progress = team.workTo ?? task.progress ?? 0;
  task.ambushes = (task.ambushes ?? 0) + 1;
  task.status = "queued";
  delete team.workFrom;
  delete team.workTo;
  delete team.ambushed;
  for (const member of crew) {
    for (const id of [...member.securityIds, ...member.scienceIds]) {
      const merged = member.conditions[id] ?? [];
      for (const c of SURVEY_AMBUSH_CONDITIONS) if (!merged.includes(c)) merged.push(c);
      member.conditions[id] = merged;
    }
  }
  if (team.borrowed && !team.skippedBorrowed.includes(task.id)) team.skippedBorrowed.push(task.id);
  returnCrew(exp, ops, team, crew, ref, t, [], { ambushed: true });
}

// A fight starts: resolved now on its keyed stream, with the crew's carry (user Q5); applied at its end. A
// joint task's Security squads fight as ONE side (groundFight.ts taskFightTeam: team then slot order). `rec` adds
// to the closed step's record; `kind` marks an ambush met as a fight (Squads SQ-4) or a Reinforcing extra battle
// (AF-1). The objective's ALERT at `t` escalates the fight (AF-1: groundFight.ts withEscalation; 0 = none), and its
// COVER shapes it (AF-2, Rocky Outcroppings: groundFight.ts withCover; none = as before). On a ranked run (Field Kits
// FKR-1) `kind` places the ranks: only the objective's final fight point is led by an Elite or a Boss.
function startFight(
  exp: Expedition,
  ops: GroundOpsState,
  team: GroundTeamRun,
  ref: GroundTaskRef,
  t: number,
  rec: Partial<GroundStepRecord> = {},
  kind?: "surprise" | "reinforcement",
): void {
  const crew = crewOf(ops, team);
  const alert = alertLevelAt(ref.task, t);
  const record = resolveTaskFight(
    exp,
    crew.map((member) => fightTeamOf(exp, ops, member)),
    ref.body,
    ref.task,
    ref.flatIndex,
    crewCarry(crew),
    undefined,
    alert,
    taskCover(ref.task),
    kind ?? "point",
  );
  if (kind === "surprise") record.surprise = true;
  if (kind === "reinforcement") record.reinforcement = true;
  ref.task.fightCount = (ref.task.fightCount ?? 0) + 1;
  team.pendingFight = record;
  moveTo(ops, team, "fight", t, t + taskFightSeconds(record), rec);
}

// The crew teams a lost fight WIPED (Squads SQ-3): a team with at least one Security member, all of them down
// (a team with NO Security member is never a wipe on its own: the SQ-2 review guard against `every` on an empty
// list); and when the WHOLE crew's Security (at least one member) is down, every team of the crew, so a Survey
// partner waits with its Strike team for the one shared pickup. Ascending index. Pure.
function wipedTeams(crew: readonly GroundTeamRun[]): GroundTeamRun[] {
  const allDown = (team: GroundTeamRun) => team.securityIds.every((id) => team.downedThisTask.includes(id));
  const crewWiped = crew.some((team) => team.securityIds.length > 0) && crew.every(allDown);
  return crew.filter((team) => crewWiped || (team.securityIds.length > 0 && allDown(team)));
}

// A fight ends: apply its record (see the header). Each member's conditions, downed state and carry land on
// the crew team it belongs to. A loss sends every crew team back on its own return trip; the WIPED teams
// (wipedTeams) wait for the ship, ONE shared recovery leg for all of them (user, Squads SQ-3). A HELPER's loss
// never counts toward the owner's loss streak or moves the task in the owner's queue: the helper puts it on its
// skippedBorrowed list (never borrowed again) and the task is queued for its owner, progress kept.
function finishFight(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number): void {
  const record = team.pendingFight;
  delete team.pendingFight;
  // GO-7d: the player skipped or reassigned the task during this fight; its result stands, then the crew heads back.
  const recalled = team.recalled === true;
  delete team.recalled;
  const crew = crewOf(ops, team);
  if (!record) {
    returnCrew(exp, ops, team, crew, ref, t, []);
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
  // Field Kits FKR-7 (a Field Kits run only): what the fight spent comes off each crew team's supplies, won or lost
  // (charges, free basics, extras), and its Injury Kit shares go on the treated member's trip treatment.
  spendFightSupplies(exp, crew, record, (id) => memberTeam(crew, id));
  // GEAR WEAR step 3: every named member who fought (standing or downed at the end) counts one ground fight.
  if (exp.gearWear) tallyGroundWear(ops, [...Object.keys(record.memberEnd), ...record.downedMemberIds], "fights");
  // GEAR WEAR step 4: and a battle-stamped run sums each member's armor wear (record.armorWear) for the homecoming.
  if (exp.gearWear?.battle === 1 && record.armorWear) tallyArmorWear(ops, record.armorWear);
  const task = ref.task;
  const surprise: Partial<GroundStepRecord> = {
    ...(record.surprise ? { surprise: true as const } : {}),
    ...(record.reinforcement ? { reinforcement: true as const } : {}),
  };
  if (record.outcome === "win") {
    // A SURPRISE fight won (Squads SQ-4) passes no fight point: the work goes on from where the ambush struck. A
    // REINFORCEMENT fight won (AF-1) passes none either: the work goes on from where it struck.
    if (!record.surprise && !record.reinforcement) {
      task.pointsCleared = (task.pointsCleared ?? 0) + 1;
      delete task.lossStreak;
      delete task.sentBack;
    }
    if (crew.length === 1) team.carry = structuredClone(record.memberEnd);
    else {
      for (const member of crew) {
        const mine: Record<string, GroundMemberEnd> = {};
        for (const [id, end] of Object.entries(record.memberEnd)) if (memberTeam(crew, id) === member) mine[id] = structuredClone(end);
        member.carry = mine;
      }
    }
    if (recalled) {
      // GO-7d: no more work on this trip. A skipped task stays skipped; a reassigned one is free for its new crew.
      delete team.reinforcementsAt;
      if (task.status !== "skipped") task.status = "queued";
      return returnCrew(exp, ops, team, crew, ref, t, [], { outcome: "win", ...surprise, stopped: true });
    }
    return startWork(exp, ops, team, ref, t, { outcome: "win", ...surprise });
  }
  for (const member of crew) delete member.carry;
  delete team.reinforcementsAt;
  if (isTrainingRun(exp)) return trainingFellBack(exp, ops, team, crew, ref, t, surprise, recalled);
  // AF-1 (Reinforcing): every retreat or wipe here raises the objective's alert (affixes.ts alertAfterSetback; a
  // task whose affixes raise none is untouched). Whoever lost it (owner, helper, a recalled crew): the enemy saw
  // a crew beaten off either way.
  const alert = alertAfterSetback(task, t);
  if (alert) task.alert = alert;
  // A task the player skipped during the fight (GO-7d) stays skipped; any other loss puts it back in the queue.
  task.status = task.status === "skipped" ? "skipped" : "queued";
  if (team.borrowed) {
    if (!team.skippedBorrowed.includes(task.id)) team.skippedBorrowed.push(task.id);
  } else if (!recalled) {
    // GO-7d review: a RECALLED crew no longer holds the task (the player skipped or reassigned it mid-fight), so its
    // loss never counts toward the task's loss streak or sends it back; the crew still returns as any loss does.
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
  returnCrew(exp, ops, team, crew, ref, t, wipedTeams(crew), { outcome: "loss", ...surprise, ...(recalled ? { stopped: true as const } : {}) });
}

// THE TRAINING RUN'S BACKSTOP (safe first runs SF-2, plan section 3.2 item 5; user OC-1 "Finish 100%, no setbacks"):
// on a training run (enemyRanks.ts isTrainingRun) a LOST fight still clears its fight point, so every objective
// reaches 100% by construction even if the tuned-down guards (groundFight.ts) ever win. The guards FELL BACK: the
// crew comes home as from any loss (the hurt to the medical bay, a wiped team on its recovery leg) and nothing is set
// back: no alert, no loss streak, no send-back, no helper skip list; the objective is queued again with its progress
// kept (a skipped one stays skipped). A surprise or reinforcement fight passes no point (neither can occur on a
// training run: no ambushes, no affixes). Logged in the user's words (TRAINING_FELL_BACK_TEXT). No draw. Mutates.
function trainingFellBack(
  exp: Expedition,
  ops: GroundOpsState,
  team: GroundTeamRun,
  crew: GroundTeamRun[],
  ref: GroundTaskRef,
  t: number,
  surprise: Partial<GroundStepRecord>,
  recalled: boolean,
): void {
  const task = ref.task;
  if (!surprise.surprise && !surprise.reinforcement) task.pointsCleared = (task.pointsCleared ?? 0) + 1;
  delete task.lossStreak;
  task.status = task.status === "skipped" ? "skipped" : "queued";
  pushLog(ops, { at: t, kind: "trainingFellBack", taskId: task.id });
  returnCrew(exp, ops, team, crew, ref, t, wipedTeams(crew), {
    outcome: "loss",
    fellBack: true,
    ...surprise,
    ...(recalled ? { stopped: true as const } : {}),
  });
}

// Every team of the crew `lead` carries heads back at `t`. The `wiped` ones wait for ONE recovery leg (a shared
// pickup when several wiped together, user 2026-10-12); the rest shuttle up on their own. `leadRec` adds to the
// lead's closed step record. A joint crew's partners are marked jointPartner: the lead offloads once for the
// crew (design 3.5). Mutates.
function returnCrew(
  exp: Expedition,
  ops: GroundOpsState,
  lead: GroundTeamRun,
  crew: readonly GroundTeamRun[],
  ref: GroundTaskRef,
  t: number,
  wiped: readonly GroundTeamRun[],
  leadRec: Partial<GroundStepRecord> = {},
): void {
  const leg = wiped.length > 0 ? scheduleRecoveryLeg(exp, ops, wiped, ref, t) : null;
  // The user's pickup pause: the crew's teams who were not wiped and whose shuttle would dock while the ship holds a
  // study (or the sweep) get ONE shared pickup the ship flies, pausing the study (null: no stamp, or no study then).
  const shuttles = crew.filter((member) => !wiped.includes(member));
  const pickup = exp.pickupPause === 1 && shuttles.length > 0 && studyHolding(ops, t + RETURN_SECONDS) ? schedulePausePickup(exp, ops, shuttles, ref, t) : null;
  for (const member of crew) {
    if (crew.length > 1 && member !== lead) member.jointPartner = true;
    startReturn(ops, member, t, wiped.includes(member) ? leg : pickup, member === lead ? leadRec : {});
  }
}

// ===== The user's PICKUP PAUSE (2026-10-23; Expedition.pickupPause, stamped runs only) =====
//
// "I think the ship should be able to stop mid-scan and pick back up where it left off, so going to get the team from
// where they are is fine. Then go back and continue scanning." On a stamped run a team that needs the ship while it
// holds a study (or sweeps the nebula) does not wait for its end: the ship PAUSES the study at the first moment it is
// free of its other legs, flies the pickup (IN_SYSTEM_LEG_SECONDS out, the same back), and resumes the study exactly
// where it left off. Stored as: the pickup leg (studyPause, scanBodyIndex null: the study's own scanBodyIndex already
// holds the scan) INSIDE the study leg, the study's end pushed back by the leg's length with the span in its
// `pauses`, and every leg stored to start later (a queued sweep, recovery or repair) pushed back by the same length,
// with the shuttles tied to them. All stored when it happens, so every later time is a pure function of stored values
// (offline == live). No draw.

// The study holding the ship at `at` (a shuttle docking then would wait for it), or null. Pure.
function studyHolding(ops: Pick<GroundOpsState, "studyLegs">, at: number): GroundStudyLeg | null {
  return (ops.studyLegs ?? []).find((l) => !l.done && l.startsAt < at && at < l.endsAt) ?? null;
}

// Where a pickup asked for at `t` can pause a study: the first moment from `t` the ship is free of its other legs
// (recovery, pickup, repair), when a study holds it then; else null. Pure.
export function pickupPauseSlot(ops: Pick<GroundOpsState, "shipLegs" | "repairLegs" | "studyLegs">, t: number): { from: number; study: GroundStudyLeg } | null {
  let from = t;
  for (let moved = true; moved; ) {
    moved = false;
    for (const l of [...ops.shipLegs, ...(ops.repairLegs ?? [])]) {
      if (l.startsAt <= from && from < l.endsAt) {
        from = l.endsAt;
        moved = true;
      }
    }
  }
  const study = (ops.studyLegs ?? []).find((l) => !l.done && l.startsAt <= from && from < l.endsAt);
  return study ? { from, study } : null;
}

// Push the ship's time after `from` back by `d` for a pause of `study` (see the block header). Mutates.
function pauseStudyAt(ops: GroundOpsState, study: GroundStudyLeg, from: number, d: number): void {
  for (const l of ops.shipLegs) {
    if (l.startsAt < from) continue;
    for (const team of ops.teams) {
      if (team.step === "return" && team.stepEndsAt === l.arrivesAt && groundLegTeams(l).includes(team.index)) team.stepEndsAt += d;
    }
    l.startsAt += d;
    l.arrivesAt += d;
    l.endsAt += d;
  }
  for (const l of ops.repairLegs ?? []) {
    if (l.startsAt < from) continue;
    l.startsAt += d;
    l.arrivesAt += d;
    l.repairedAt += d;
    l.endsAt += d;
  }
  for (const l of ops.studyLegs ?? []) {
    if (l === study) continue;
    if (l.startsAt < from) continue;
    // A shuttle waiting for this later study's end (the fallback below) docks later with it.
    for (const team of ops.teams) if (team.step === "return" && team.stepEndsAt === l.endsAt) team.stepEndsAt += d;
    l.startsAt += d;
    l.endsAt += d;
    if (l.pauses) l.pauses = l.pauses.map((p) => ({ from: p.from + d, to: p.to + d }));
  }
  for (const team of ops.teams) if (team.step === "return" && team.stepEndsAt === study.endsAt) team.stepEndsAt += d;
  study.endsAt += d;
  (study.pauses ??= []).push({ from, to: from + d });
}

// When a shuttle that leaves at `t` would dock by WAITING (the GG-3 rule: at the end of the study that holds the ship
// when it lands, studyPickupAt). Pure.
export function waitDockAt(ops: Pick<GroundOpsState, "studyLegs">, t: number): number {
  return studyPickupAt(ops, t + RETURN_SECONDS);
}

// GG-6 pause review: a pause is flown only when it brings the team aboard SOONER than waiting would (a pickup that
// arrives at `arrivesAt` against the waiting shuttle's dock): a team ready with less than a leg's flight of study left
// waits as before, so a pause is never worse for the team and never delays the study for nothing. Pure.
export function pausePaysOff(ops: Pick<GroundOpsState, "studyLegs">, t: number, arrivesAt: number): boolean {
  return arrivesAt < waitDockAt(ops, t);
}

// The pickup leg of `teams` (one crew, one body) asked for at `t`, pausing the study that holds the ship, or null when
// no study can be paused or a pause would not bring them aboard sooner (the shuttles then wait as before,
// studyPickupAt). Mutates.
function schedulePausePickup(exp: Expedition, ops: GroundOpsState, teams: readonly GroundTeamRun[], ref: GroundTaskRef, t: number): GroundShipLeg | null {
  // The ship already on its way to this body for a pickup (not arrived yet) takes these teams too: one shared pickup.
  const joining = ops.shipLegs.find((l) => l.pickup === 1 && l.bodyIndex === ref.bodyIndex && l.arrivesAt >= t && pausePaysOff(ops, t, l.arrivesAt));
  if (joining) {
    const indices = [...new Set([...groundLegTeams(joining), ...teams.map((team) => team.index)])].sort((a, b) => a - b);
    joining.teamIndex = indices[0];
    if (indices.length > 1) joining.teamIndices = indices;
    return joining;
  }
  const slot = pickupPauseSlot(ops, t);
  if (!slot || !pausePaysOff(ops, t, slot.from + IN_SYSTEM_LEG_SECONDS)) return null;
  return pausedLeg(ops, slot, teams, ref, true);
}

// Store a leg that pauses `slot.study` for `teams`. Mutates.
function pausedLeg(ops: GroundOpsState, slot: { from: number; study: GroundStudyLeg }, teams: readonly GroundTeamRun[], ref: GroundTaskRef, pickup: boolean): GroundShipLeg {
  const d = 2 * IN_SYSTEM_LEG_SECONDS;
  pauseStudyAt(ops, slot.study, slot.from, d);
  const indices = teams.map((team) => team.index).sort((a, b) => a - b);
  const leg: GroundShipLeg = {
    kind: "recovery",
    teamIndex: indices[0],
    ...(indices.length > 1 ? { teamIndices: indices } : {}),
    bodyIndex: ref.bodyIndex,
    scanBodyIndex: null,
    startsAt: slot.from,
    arrivesAt: slot.from + IN_SYSTEM_LEG_SECONDS,
    endsAt: slot.from + d,
    studyPause: 1,
    ...(pickup ? { pickup: 1 as const } : {}),
  };
  ops.shipLegs.push(leg);
  return leg;
}

// Store the RECOVERY LEG (see the header) that picks up `teams` (one crew, one body) at `t`: it starts when the
// ship is free (legs never overlap), arrives IN_SYSTEM_LEG_SECONDS later and is back IN_SYSTEM_LEG_SECONDS after
// that; while scanning, the scan pauses for it. One team: exactly GO-7b's leg; several: one shared leg listing
// them all (teamIndices). Mutates.
function scheduleRecoveryLeg(exp: Expedition, ops: GroundOpsState, teams: readonly GroundTeamRun[], ref: GroundTaskRef, t: number): GroundShipLeg {
  // The user's pickup pause: on a stamped run a wiped team is not left waiting behind a study either. Its recovery leg
  // would otherwise start when the ship is free of every leg (after the study), so a pause inside the study always
  // brings it aboard sooner; the check says so anyway.
  if (exp.pickupPause === 1) {
    const slot = pickupPauseSlot(ops, t);
    const free = shipFreeAt(ops);
    if (slot && slot.from < (free !== null && free > t ? free : t)) return pausedLeg(ops, slot, teams, ref, false);
  }
  const scanning = exp.bodies.findIndex((b) => !b.scanned);
  // Legs never overlap (GO-8b: a field repair counts too).
  const free = shipFreeAt(ops);
  const startsAt = free !== null && free > t ? free : t;
  const indices = teams.map((team) => team.index).sort((a, b) => a - b);
  const leg: GroundShipLeg = {
    kind: "recovery",
    teamIndex: indices[0],
    ...(indices.length > 1 ? { teamIndices: indices } : {}),
    bodyIndex: ref.bodyIndex,
    scanBodyIndex: scanning >= 0 ? scanning : null,
    startsAt,
    arrivesAt: startsAt + IN_SYSTEM_LEG_SECONDS,
    endsAt: startsAt + 2 * IN_SYSTEM_LEG_SECONDS,
  };
  ops.shipLegs.push(leg);
  return leg;
}

// The teams a recovery leg picks up. Pure.
export function groundLegTeams(leg: Pick<GroundShipLeg, "teamIndex" | "teamIndices">): number[] {
  return leg.teamIndices ? [...leg.teamIndices] : [leg.teamIndex];
}

// Back to the ship. A team waiting on a RECOVERY LEG returns when the ship arrives; anything else is an ordinary
// RETURN_SECONDS shuttle. Gas Giant Study GG-3 (mockup v3, "Pickup waits for the ship"): a shuttle that would dock
// while the ship holds orbit on a study waits for that study to end (studyPickupAt). Mutates.
function startReturn(ops: GroundOpsState, team: GroundTeamRun, t: number, leg: GroundShipLeg | null, rec: Partial<GroundStepRecord> = {}): void {
  moveTo(ops, team, "return", t, leg ? leg.arrivesAt : studyPickupAt(ops, t + RETURN_SECONDS), rec);
}

// Aboard: offload when the trip banked something not yet offloaded [PROVISIONAL: else straight to the bay]. A
// joint crew's PARTNER skips the offload (the lead's offload delivers the crew's haul once, design 3.5) and goes
// straight to its own bay.
function finishReturn(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef | null, t: number): void {
  const on = ops.shipLegs.filter((l) => l.arrivesAt === t && groundLegTeams(l).includes(team.index));
  const recovered = on.some((l) => l.pickup !== 1);
  // The user's pickup pause: a team the ship flew to collect (not wiped) is a study pickup, never a recovery.
  const rec: Partial<GroundStepRecord> = recovered ? { recovered: true } : on.length > 0 ? { studyPickup: true } : {};
  if (!team.jointPartner && ref && (ref.task.segmentsBanked ?? 0) > (ref.task.segmentsOffloaded ?? 0)) {
    const batch = (ref.task.segmentsBanked ?? 0) - (ref.task.segmentsOffloaded ?? 0);
    return moveTo(ops, team, "offload", t, t + groundOffloadSeconds(ops.factors, batch, segmentCount(ref.task)), rec);
  }
  startBay(exp, ops, team, t, rec);
}

// The offload step's seconds for a batch of `batch` of a task's `segments` segments: OFFLOAD_BASE_SECONDS divided by
// the frozen offloadMult, and (Wiring WR-9, OC-E9) by (1 + offloadSteady) too when the batch carries at least
// FULL_HOLD_FRACTION of the objective's haul (the Operations officer's Integrity, the twin of a mission's full-hold
// unload). Without offloadSteady (every run dispatched before WR-9) it is exactly the old divide. Pure.
export function groundOffloadSeconds(factors: Pick<GroundOpsFactors, "offloadMult" | "offloadSteady">, batch: number, segments: number): number {
  const base = OFFLOAD_BASE_SECONDS / factors.offloadMult;
  const steady = factors.offloadSteady;
  if (steady === undefined || !(steady > 0) || !(segments > 0) || batch / segments < FULL_HOLD_FRACTION) return base;
  return base / (1 + steady);
}

// The offload ends: one finding for the batch of banked segments not yet offloaded (see the header). Mutates.
function offloadFindings(exp: Expedition, ops: GroundOpsState, team: GroundTeamRun, ref: GroundTaskRef, t: number, driver: GroundOpsScanDriver): void {
  const task = ref.task;
  const from = task.segmentsOffloaded ?? 0;
  const to = task.segmentsBanked ?? 0;
  if (to <= from) return;
  const N = segmentCount(task);
  // Squads SQ-4 (user #6): the task's difficulty raises its haul and its relic find (0 for an unrated task).
  const riskBonus = riskRewardBonus(task.difficulty);
  const fullBy = new Map<string, TaskHaul>();
  const materials: Record<string, number> = {};
  let credits = 0;
  for (let s = from; s < to; s += 1) {
    const key = (task.segmentBankers?.[s] ?? [team.index]).join(",");
    let full = fullBy.get(key);
    if (!full) {
      full = taskFullHaul(exp, bankingTeams(ops, task, s, team), ref.body, task.poiId, ref.flatIndex, riskBonus);
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
    const find = activityRelicFindBonus(exp, fw, driver.hoursAt(exp, task.completedAt ?? t));
    finding.relic = rollRelicToken(
      taskRelicSeed(exp, ref.flatIndex),
      ref.body.hazard,
      task.poiId,
      `${exp.id}-relic-${task.id}`,
      riskBonus > 0 ? find + riskBonus : find,
      // WR-5c: the captain's Field Science, Relic Hunter and Preservationist, frozen at dispatch (absent = unchanged).
      exp.explorerCaptain,
      // Relics v2 R2-2: the blank stamp (the run's region tier, the body's culture) on a run with the R2-2 flag only.
      relicBlankStamp(exp, ref.bodyIndex),
      // Wiring WR-11 (OC-G4): the site's relic odds on a run stamped with the site rules (1 otherwise).
      poiRelicOddsMult(exp, task.poiId),
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
// Field Kits FKR-7: a member's Injury Kit share this trip (GroundTeamRun.treatment, only a Field Kits run's fights
// write it; absent = 0) shortens that member's cures (medicalBay.ts treatmentShare), and only theirs.
export function groundTeamBaySeconds(
  exp: Pick<Expedition, "roster" | "groundOps">,
  team: Pick<GroundTeamRun, "securityIds" | "scienceIds" | "conditions" | "treatment">,
): Record<string, number> {
  const out: Record<string, number> = {};
  const ops = exp.groundOps;
  if (!ops) return out;
  const care = groundOpsBayCare(ops.factors);
  const snapshots = [...(exp.roster?.security ?? []), ...(exp.roster?.science ?? [])];
  for (const id of [...team.securityIds, ...team.scienceIds]) {
    if (Object.prototype.hasOwnProperty.call(out, id)) continue;
    const perks = snapshots.find((m) => m.memberId === id)?.perks ?? [];
    const treated = team.treatment && Object.prototype.hasOwnProperty.call(team.treatment, id) ? team.treatment[id] : 0;
    out[id] = memberBaySeconds(team.conditions[id] ?? [], perks, care, Number.isFinite(treated) && treated > 0 ? treated : 0);
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

// Everyone healed: the trip's conditions, the task's downed list and the in-task carry are cleared (Field Kits FKR-7:
// and the trip's Injury Kit treatment, which the bay just read; absent on every other run). Mutates.
function healTeam(team: GroundTeamRun): void {
  team.conditions = {};
  team.downedThisTask = [];
  delete team.carry;
  delete team.treatment;
}

function finishBay(ops: GroundOpsState, team: GroundTeamRun, t: number): void {
  healTeam(team);
  moveTo(ops, team, "reload", t, t + RELOAD_BASE_SECONDS / ops.factors.reloadMult);
}

// Reloaded (or the task vanished): idle, ready for the next task. Mutates.
function toIdle(ops: GroundOpsState, team: GroundTeamRun, t: number, rec: Partial<GroundStepRecord> = {}): void {
  moveTo(ops, team, "idle", t, null, rec);
  delete team.taskId;
  delete team.borrowed;
  delete team.attemptPoints;
  delete team.workFrom;
  delete team.workTo;
  delete team.ambushed;
  delete team.jointPartner;
  delete team.recalled;
  delete team.reinforcementsAt;
  delete team.reinforcing;
}

// ============================================================================
// GO-7d: LIVE QUEUE EDITS ("apply from now")
// ============================================================================
//
// The player edits a running operation's queues at any time (plan GO-7d; GO-13's queue screen calls them through
// expedition.ts editGroundOps, which first ADVANCES the run to now, then validates and applies here, then lets
// idle teams pick their next work at the edit instant). Every edit is applied AT the edit instant `t` and
// stored, so the run stays a pure function of its stored record: one big advance after an edit equals many small
// ones. Nothing ever waits for the player: an edit only changes what happens next.
//   assign   : move a task into a team's queue (at a position among its remaining tasks, else the end). The task's
//              CREW becomes that team plus any `partners` (Squads SQ-3: the crew must COVER the task's needs, so a
//              joint task can never stage forever: crewDoesNotCover; and the deployed squads summed must cover
//              it at all: notEnoughSquads). Partners get it appended; every other queue drops it.
//   reorder  : move a task one place up or down among its team's REMAINING tasks; never interrupts.
//   skip     : drop the task from every queue, status skipped (progress, points and banked segments kept). The
//              escape hatch for a stuck run (user: "retry forever, skip by hand"): once every remaining task is
//              skipped the window closes as the teams settle.
//   requeue  : a skipped task back into a team's queue (crew and position rules as assign), resuming from its
//              kept progress; its loss streak starts fresh (a deliberate new try) [PROVISIONAL].
//   defaultPlan / autoAssign : the body's QUEUED tasks (not active, done or skipped) re-planned: by GO-7c's plan
//              (planTasksForTeams, which logs a skip), or uniformly at random over the SMALLEST covering crews
//              on the AUTO_ASSIGN_SALT stream keyed by the edit count, appended in drawn order.
//   setHelp  : the team's "help other teams" flag for the rest of this run (a helper already on a borrowed task
//              finishes it) [PROVISIONAL].
// AN ACTIVE TASK (plan Q14) [PROVISIONAL]: a skip, or an assign that changes the crew away from the crew on it,
// during the DROP or the WORK stops that crew at the edit instant: the task keeps the progress interpolated along
// the work step, no partial segment is banked or paid, and every crew team takes its ordinary return trip (the
// lead offloads anything already banked). During a FIGHT the edit waits for the fight's end (the lead is marked
// `recalled`; the fight's result stands, then the crew heads back; its loss never counts toward the task's loss
// streak). A task only STAGED (a joint crew still gathering) releases its staging teams (each staging step is
// recorded `stopped`). A reorder, or an assign that keeps the crew, never interrupts.

// The Auto-assign stream's salt: odd, distinct from every engine salt (salts.test.ts checks it).
export const AUTO_ASSIGN_SALT = 0x71c3e8a9;

export type GroundOpsEdit =
  | { kind: "assign"; taskId: string; teamIndex: number; position?: number; partners?: number[] }
  | { kind: "reorder"; teamIndex: number; taskId: string; delta: -1 | 1 }
  | { kind: "skip"; taskId: string }
  | { kind: "requeue"; taskId: string; teamIndex: number; position?: number; partners?: number[] }
  | { kind: "defaultPlan"; bodyIndex: number }
  | { kind: "autoAssign"; bodyIndex: number } // the user's "Auto-assign randomly"
  | { kind: "setHelp"; teamIndex: number; on: boolean };

export type GroundOpsEditBlockReason =
  | "noExpedition"
  | "notGroundOps"
  | "runFinished"
  | "noSuchTask"
  | "taskDone"
  | "taskSkipped"
  | "notSkipped"
  | "noSuchTeam"
  | "noSuchBody"
  | "noTasks"
  | "notInQueue"
  | "notEnoughSquads"
  | "crewDoesNotCover"
  | "noChange";

export type GroundOpsEditCheck = { ok: true } | { ok: false; reason: GroundOpsEditBlockReason };

// A refusal in plain words (the GO-13 queue screen shows it; player-facing text says "objective", user 2026-10-14).
// Exhaustive. Pure.
export function groundOpsEditBlockText(reason: GroundOpsEditBlockReason): string {
  switch (reason) {
    case "noExpedition":
      return "No such expedition";
    case "notGroundOps":
      return "This expedition launched before Ground Operations: its objectives run on their own";
    case "runFinished":
      return "The ground operations are over: the ship is heading home";
    case "noSuchTask":
      return "No such objective";
    case "taskDone":
      return "That objective is already done";
    case "taskSkipped":
      return "That objective was skipped: re-queue it first";
    case "notSkipped":
      return "Only a skipped objective can be re-queued";
    case "noSuchTeam":
      return "No such ground team on this run";
    case "noSuchBody":
      return "No scanned body there";
    case "noTasks":
      return "No queued objectives on that body to plan";
    case "notInQueue":
      return "That objective is not in this team's queue";
    case "notEnoughSquads":
      return "Nobody deployed brings the squads this objective needs";
    case "crewDoesNotCover":
      return "That crew does not bring the squads this objective needs: add a partner team";
    case "noChange":
      return "Nothing to change";
  }
}

// The SMALLEST sets of deployed teams whose squads cover `task`'s needs (Squads SQ-3: a task's crew), as team
// index lists (ascending), in team order; [] when nothing deployed covers it. Pure.
function coveringCrews(ops: GroundOpsState, task: ExpeditionActivity): GroundTeamRun[][] {
  const needs = taskNeedsOf(task);
  const n = ops.teams.length;
  for (let size = 1; size <= n; size += 1) {
    const out: GroundTeamRun[][] = [];
    for (let mask = 1; mask < 1 << n; mask += 1) {
      const crew = ops.teams.filter((_, i) => (mask & (1 << i)) !== 0);
      if (crew.length === size && squadsCover(crewSquadsOf(crew), needs)) out.push(crew);
    }
    if (out.length > 0) return out;
  }
  return [];
}

// The crews the player can pick for task `taskId` with no extra partner: the smallest sets of deployed teams that
// cover its needs, as team index lists (GO-13: the "Assigned" choices; Auto-assign draws among them). Pure.
export function groundTaskCrews(exp: Pick<Expedition, "groundOps" | "bodies">, taskId: string): number[][] {
  const ops = exp.groundOps;
  const ref = findGroundTask(exp, taskId);
  if (!ops || !ref) return [];
  return coveringCrews(ops, ref.task).map((crew) => crew.map((team) => team.index));
}

// AF-1, LARGER JOINT CREWS (user 2026-10-14: "Let's allow this. It will allow players to be able to get a foothold
// into harder content if they want. They'd sacrifice speed from only having one team that can do it"): every crew
// the player can pick for task `taskId`, the smallest covering crews first (groundTaskCrews, `larger: false`), then
// every LARGER set of deployed teams that also covers it (`larger: true`; e.g. both Ground teams on one hard
// objective), by size, then team order. THE TRADE-OFF: a larger crew pools its squads (every Security squad on one
// fight side, every Science squad's fieldwork summed) but works ONE objective at a time as a joint crew, so the
// ship works fewer objectives at once: better odds on the hard one, a slower run overall (the same machinery as
// any joint task; the edits accept such a crew through `partners`). The plan and Auto-assign never pick a larger
// crew; it is the player's choice. Pure.
export function groundTaskCrewOptions(exp: Pick<Expedition, "groundOps" | "bodies">, taskId: string): { teams: number[]; larger: boolean }[] {
  const ops = exp.groundOps;
  const ref = findGroundTask(exp, taskId);
  if (!ops || !ref) return [];
  const smallest = coveringCrews(ops, ref.task);
  if (smallest.length === 0) return [];
  const out = smallest.map((crew) => ({ teams: crew.map((team) => team.index), larger: false }));
  const needs = taskNeedsOf(ref.task);
  const n = ops.teams.length;
  for (let size = smallest[0].length + 1; size <= n; size += 1) {
    for (let mask = 1; mask < 1 << n; mask += 1) {
      const crew = ops.teams.filter((_, i) => (mask & (1 << i)) !== 0);
      if (crew.length === size && squadsCover(crewSquadsOf(crew), needs)) out.push({ teams: crew.map((team) => team.index), larger: true });
    }
  }
  return out;
}

// Is the task still to do (queued or active)? Pure.
function isRemaining(exp: Pick<Expedition, "bodies">, taskId: string): boolean {
  const status = findGroundTask(exp, taskId)?.task.status;
  return status === "queued" || status === "active";
}

// The deployed team with ship team index `index`, or undefined. Pure.
function runTeam(ops: GroundOpsState, index: unknown): GroundTeamRun | undefined {
  return typeof index === "number" && Number.isInteger(index) ? ops.teams.find((team) => team.index === index) : undefined;
}

// The crew an assign or requeue names: `teamIndex` plus `partners` (repeats dropped), in team order; null when a
// team is not deployed. Pure.
function editCrew(ops: GroundOpsState, teamIndex: number, partners: readonly number[] | undefined): GroundTeamRun[] | null {
  const want = [teamIndex, ...(Array.isArray(partners) ? partners : [])];
  const crew: GroundTeamRun[] = [];
  for (const index of want) {
    const team = runTeam(ops, index);
    if (!team) return null;
    if (!crew.includes(team)) crew.push(team);
  }
  return ops.teams.filter((team) => crew.includes(team));
}

// `queue` with `taskId` moved to `position` among the queue's REMAINING tasks (before the remaining task now at
// that index; past the end, or no position, appends). Done tasks keep their places. Pure.
function placeInQueue(exp: Pick<Expedition, "bodies">, queue: readonly string[], taskId: string, position: number | undefined): string[] {
  const without = queue.filter((id) => id !== taskId);
  const remaining = without.filter((id) => isRemaining(exp, id));
  const p = typeof position === "number" && Number.isFinite(position) ? Math.max(0, Math.floor(position)) : remaining.length;
  if (p >= remaining.length) return [...without, taskId];
  const at = without.indexOf(remaining[p]);
  return [...without.slice(0, at), taskId, ...without.slice(at)];
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// The body's tasks a Default plan or an Auto-assign re-plans: stamped, QUEUED (not active, done or skipped), in
// discovery order. Pure.
function replannable(exp: Expedition, bodyIndex: number): GroundTaskRef[] {
  const body = exp.bodies[bodyIndex];
  if (!body) return [];
  const out: GroundTaskRef[] = [];
  for (const task of body.activities) {
    if (task.status !== "queued") continue;
    const ref = findGroundTask(exp, task.id);
    if (ref) out.push(ref);
  }
  return out;
}

// The team on the task in the field (its drop, work or fight; a joint crew's LEAD), or undefined. Pure.
function fieldLead(ops: GroundOpsState, taskId: string): GroundTeamRun | undefined {
  return ops.teams.find((team) => team.taskId === taskId && (team.step === "deploy" || team.step === "work" || team.step === "fight"));
}

// Validate `edit` on the run as it stands (expedition.ts editGroundOps has advanced it to now). Pure.
export function checkGroundOpsEdit(exp: Expedition, edit: GroundOpsEdit): GroundOpsEditCheck {
  const no = (reason: GroundOpsEditBlockReason): GroundOpsEditCheck => ({ ok: false, reason });
  const ops = exp.groundOps;
  if (!ops) return no("notGroundOps");
  if (ops.endedAt !== undefined || exp.phase === "return" || exp.phase === "complete") return no("runFinished");
  switch (edit.kind) {
    case "assign":
    case "requeue": {
      const ref = findGroundTask(exp, edit.taskId);
      if (!ref || !isGroundTask(ref.task)) return no("noSuchTask");
      const task = ref.task;
      if (task.status === "done") return no("taskDone");
      if (edit.kind === "assign" && task.status === "skipped") return no("taskSkipped");
      if (edit.kind === "requeue" && task.status !== "skipped") return no("notSkipped");
      const crew = editCrew(ops, edit.teamIndex, edit.partners);
      if (!crew) return no("noSuchTeam");
      const needs = taskNeedsOf(task);
      if (!squadsCover(crewSquadsOf(ops.teams), needs)) return no("notEnoughSquads");
      if (!squadsCover(crewSquadsOf(crew), needs)) return no("crewDoesNotCover");
      if (edit.kind === "assign") {
        const ids = crew.map((team) => team.index);
        const unchanged =
          sameList(ids, task.assignedTeamIds ?? []) &&
          ops.teams.every((team) => {
            if (team.index === edit.teamIndex) return sameList(placeInQueue(exp, team.queue, task.id, edit.position), team.queue);
            return team.queue.includes(task.id) === ids.includes(team.index);
          });
        if (unchanged) return no("noChange");
      }
      return { ok: true };
    }
    case "reorder": {
      const team = runTeam(ops, edit.teamIndex);
      if (!team) return no("noSuchTeam");
      const ref = findGroundTask(exp, edit.taskId);
      if (!ref || !isGroundTask(ref.task)) return no("noSuchTask");
      if (ref.task.status === "done") return no("taskDone");
      const remaining = team.queue.filter((id) => isRemaining(exp, id));
      const at = remaining.indexOf(edit.taskId);
      if (at < 0) return no("notInQueue");
      const to = at + edit.delta;
      if ((edit.delta !== -1 && edit.delta !== 1) || to < 0 || to >= remaining.length) return no("noChange");
      return { ok: true };
    }
    case "skip": {
      const ref = findGroundTask(exp, edit.taskId);
      if (!ref || !isGroundTask(ref.task)) return no("noSuchTask");
      if (ref.task.status === "done") return no("taskDone");
      if (ref.task.status === "skipped") return no("taskSkipped");
      return { ok: true };
    }
    case "defaultPlan":
    case "autoAssign": {
      const body = Number.isInteger(edit.bodyIndex) ? exp.bodies[edit.bodyIndex] : undefined;
      if (!body || !body.scanned) return no("noSuchBody");
      if (replannable(exp, edit.bodyIndex).length === 0) return no("noTasks");
      return { ok: true };
    }
    case "setHelp": {
      const team = runTeam(ops, edit.teamIndex);
      if (!team) return no("noSuchTeam");
      if (team.helpOthers === (edit.on === true)) return no("noChange");
      return { ok: true };
    }
  }
}

// Apply `edit` at `t` (the run already advanced to `t`): validate, apply, count it, then let idle teams pick their
// next work at `t` and check the window's end. Mutates the working clone only when the edit is valid.
export function applyGroundOpsEdit(exp: Expedition, edit: GroundOpsEdit, t: number): GroundOpsEditCheck {
  const check = checkGroundOpsEdit(exp, edit);
  if (!check.ok) return check;
  const ops = exp.groundOps as GroundOpsState;
  switch (edit.kind) {
    case "assign":
    case "requeue": {
      const ref = findGroundTask(exp, edit.taskId) as GroundTaskRef;
      const crew = editCrew(ops, edit.teamIndex, edit.partners) as GroundTeamRun[];
      assignCrew(exp, ops, ref, crew, edit.teamIndex, edit.position, edit.kind === "requeue", t);
      break;
    }
    case "reorder": {
      const team = runTeam(ops, edit.teamIndex) as GroundTeamRun;
      const remaining = team.queue.filter((id) => isRemaining(exp, id));
      const other = remaining[remaining.indexOf(edit.taskId) + edit.delta];
      const a = team.queue.indexOf(edit.taskId);
      const b = team.queue.indexOf(other);
      const queue = [...team.queue];
      queue[a] = other;
      queue[b] = edit.taskId;
      team.queue = queue;
      break;
    }
    case "skip": {
      const ref = findGroundTask(exp, edit.taskId) as GroundTaskRef;
      for (const team of ops.teams) if (team.queue.includes(ref.task.id)) team.queue = team.queue.filter((id) => id !== ref.task.id);
      leaveTask(exp, ops, ref, t);
      ref.task.status = "skipped";
      break;
    }
    case "defaultPlan":
    case "autoAssign": {
      const refs = replannable(exp, edit.bodyIndex);
      const ids = new Set(refs.map((ref) => ref.task.id));
      for (const team of ops.teams) team.queue = team.queue.filter((id) => !ids.has(id));
      for (const ref of refs) delete ref.task.assignedTeamIds;
      if (edit.kind === "defaultPlan") planTasksForTeams(exp, refs, t);
      else autoAssignTasks(exp, ops, refs, t);
      break;
    }
    case "setHelp": {
      (runTeam(ops, edit.teamIndex) as GroundTeamRun).helpOthers = edit.on === true;
      break;
    }
  }
  ops.editCount += 1;
  if (ops.startedAt !== undefined) {
    groundOpsAssignIdle(exp, t);
    checkRunEnd(exp, t);
  }
  return check;
}

// Give `ref`'s task to `crew` (validated: deployed, covering), `teamIndex`'s queue at `position`, the partners'
// queues appended when missing, every other queue dropping it. A requeue (`fromSkip`) brings a skipped task back
// with a fresh loss streak. Then the crew in the field, if any, is settled (see the section header). Mutates.
function assignCrew(
  exp: Expedition,
  ops: GroundOpsState,
  ref: GroundTaskRef,
  crew: readonly GroundTeamRun[],
  teamIndex: number,
  position: number | undefined,
  fromSkip: boolean,
  t: number,
): void {
  const task = ref.task;
  const ids = crew.map((team) => team.index);
  const changed = fromSkip || !sameList(ids, task.assignedTeamIds ?? []);
  for (const team of ops.teams) {
    if (team.index === teamIndex) team.queue = placeInQueue(exp, team.queue, task.id, position);
    else if (ids.includes(team.index)) {
      if (!team.queue.includes(task.id)) team.queue = [...team.queue, task.id];
    } else if (team.queue.includes(task.id)) team.queue = team.queue.filter((id) => id !== task.id);
  }
  task.assignedTeamIds = ids;
  if (fromSkip) {
    delete task.lossStreak;
    delete task.sentBack;
  }
  if (!changed) return;
  const lead = fieldLead(ops, task.id);
  if (lead && sameList(crewOf(ops, lead).map((team) => team.index), ids)) {
    // The crew in the field IS the new crew (a recalled crew given its task back, or a helper made its owner):
    // it carries on.
    delete lead.recalled;
    delete lead.borrowed;
    task.status = "active";
    return;
  }
  leaveTask(exp, ops, ref, t);
  // A crew still fighting it holds it until the fight ends (then it is queued); otherwise it is free now.
  task.status = fieldLead(ops, task.id)?.recalled ? "active" : "queued";
}

// Whoever is on `ref`'s task leaves it at `t` (a skip, or a reassign away): a lead in its DROP or WORK stops now
// (stopCrew); a lead in a FIGHT is marked recalled (it heads back at the fight's end); teams only STAGED on it
// are released to idle. The task's status is the caller's. Mutates.
function leaveTask(exp: Expedition, ops: GroundOpsState, ref: GroundTaskRef, t: number): void {
  const lead = fieldLead(ops, ref.task.id);
  if (lead) {
    if (lead.step === "fight") lead.recalled = true;
    else stopCrew(exp, ops, lead, ref, t);
    return;
  }
  // Released stagers: their staging step is recorded `stopped` (GO-14's timeline shows the moment; GO-7d review).
  for (const team of ops.teams) if (team.step === "staging" && team.taskId === ref.task.id) toIdle(ops, team, t, { stopped: true });
}

// Stop `lead`'s crew at `t` (its drop or its work): the task keeps the progress interpolated along the work step
// (nothing banked: the segment is unfinished, so nothing of it is ever paid), and every crew team takes its
// ordinary return trip (a joint crew's partners straight to their bay, the lead offloading anything already
// banked). The closed step is recorded `stopped`. Mutates.
function stopCrew(exp: Expedition, ops: GroundOpsState, lead: GroundTeamRun, ref: GroundTaskRef, t: number): void {
  const crew = crewOf(ops, lead);
  if (lead.step === "work" && lead.workFrom !== undefined && lead.workTo !== undefined && lead.stepEndsAt !== null) {
    const span = lead.stepEndsAt - lead.stepStartedAt;
    const f = span > 0 ? Math.max(0, Math.min(1, (t - lead.stepStartedAt) / span)) : 0;
    ref.task.progress = lead.workFrom + (lead.workTo - lead.workFrom) * f;
  }
  delete lead.workFrom;
  delete lead.workTo;
  delete lead.ambushed;
  delete lead.reinforcing;
  delete lead.reinforcementsAt;
  returnCrew(exp, ops, lead, crew, ref, t, [], { stopped: true });
}

// AUTO-ASSIGN RANDOMLY (the user's words): `refs` go to the deployed teams uniformly at random, on
// makeRng(seed ^ AUTO_ASSIGN_SALT ^ imul(editCount + 1, golden)) (so the same edit count draws the same plan and
// the next one draws afresh). A fixed draw layout per task: one draw picks the next task among those left (the
// "drawn order" they are appended in), one picks its crew among the SMALLEST covering crews (Squads SQ-3). A task
// nobody deployed covers is skipped with the plan's log line (no draw for its crew). Mutates.
function autoAssignTasks(exp: Expedition, ops: GroundOpsState, refs: readonly GroundTaskRef[], t: number): void {
  const rng = makeRng((exp.seed ^ AUTO_ASSIGN_SALT ^ Math.imul(ops.editCount + 1, 0x9e3779b9)) >>> 0);
  const left = [...refs];
  const deployed = crewSquadsOf(ops.teams);
  while (left.length > 0) {
    const ref = left.splice(rng.nextInt(left.length), 1)[0];
    const crews = coveringCrews(ops, ref.task);
    if (crews.length === 0) {
      ref.task.status = "skipped";
      pushLog(ops, { at: t, kind: "skippedNeedsSquads", taskId: ref.task.id, needs: taskNeedsOf(ref.task), deployed: { ...deployed } });
      continue;
    }
    const crew = crews[rng.nextInt(crews.length)];
    for (const team of crew) team.queue = [...team.queue, ref.task.id];
    ref.task.assignedTeamIds = crew.map((team) => team.index);
  }
}

// ============================================================================
// GO-8b: EXPEDITION FIELD REPAIR (user, 2026-10-12: "WWVD. What Would Voyager Do?")
// ============================================================================
//
// A damaged ship on an expedition NEVER has to go home (user: no soft-lock, never force a return). Once the light
// hull damage of its scan events (GroundOpsState.hullDamage, GO-8) reaches FIELD_REPAIR_DAMAGE_SHARE of its frozen
// hull pool, or when the player orders it (expedition.ts orderFieldRepair), the ship flies a REPAIR LEG
// (GroundRepairLeg): it sets down on the NEAREST suitable body (a rocky world with an atmosphere,
// FIELD_REPAIR_PLANET_TYPES; never a gas giant, D22), repairs on a timer and flies back to resume the run. With
// no suitable body in the system it repairs IN ORBIT where it is, slower. The repair time is the Shipyard's
// formula (model.ts repairTicksForDamage, one tick = one second) on the damage, divided by the ship's frozen
// Engineering repair speed-up (ShipEventBattle.repairSpeed: Rapid Recovery, Veteran Instincts, the Engineering
// Constitution), times the field multiplier. The leg is stored when it starts (so it is a pure function of stored
// values), pauses the scan clock like a recovery leg, never overlaps another leg (a wiped team's pickup waits for
// it, and it waits for one already under way), and fixes the damage at its end (the window's event). The ground
// teams keep working meanwhile: the ship can still recover any of them, after the repair (Q1 rule).
// [PROVISIONAL] the threshold, the planet list, "nearest" (the body index closest to the ship's position: the
// body it scans, or the last body once the scan is done; ties to the lower index), the multipliers.

export const FIELD_REPAIR_DAMAGE_SHARE = 0.25; // of ShipEventBattle.hullMax [PROVISIONAL]
export const FIELD_REPAIR_PLANET_TYPES: readonly ExpeditionPlanetType[] = ["terrestrial", "ocean", "arid", "frozen"]; // [PROVISIONAL]
export const FIELD_REPAIR_TIME_MULT = 2; // a field repair on the ground vs the Shipyard's time [PROVISIONAL]
export const ORBIT_REPAIR_TIME_MULT = 3; // in orbit, with no suitable world [PROVISIONAL]

// The earliest field repair not yet finished, or null. Pure.
function nextRepairEnd(ops: GroundOpsState): GroundRepairLeg | null {
  let best: GroundRepairLeg | null = null;
  for (const leg of ops.repairLegs ?? []) if (!leg.done && (best === null || leg.endsAt < best.endsAt)) best = leg;
  return best;
}

// A field repair ends: the damage it set out to fix is gone. Mutates.
function finishFieldRepair(ops: GroundOpsState, leg: GroundRepairLeg): void {
  leg.done = true;
  const left = Math.max(0, (ops.hullDamage ?? 0) - leg.hullRepaired);
  if (left > 0) ops.hullDamage = left;
  else delete ops.hullDamage;
}

// Where the ship is for a field repair: the body it scans, else (the scan done) the last body. Pure.
function repairPosition(exp: Pick<Expedition, "bodies">): number {
  const scanning = exp.bodies.findIndex((b) => !b.scanned);
  return scanning >= 0 ? scanning : exp.bodies.length - 1;
}

// The body the ship sets down on from body `from`: the nearest one of FIELD_REPAIR_PLANET_TYPES (ties: the lower
// index), or null (repair in orbit). Pure.
export function fieldRepairSite(exp: Pick<Expedition, "bodies">, from: number = repairPosition(exp)): number | null {
  let best: number | null = null;
  exp.bodies.forEach((body, i) => {
    if (!FIELD_REPAIR_PLANET_TYPES.includes(body.planetType)) return;
    if (best === null || Math.abs(i - from) < Math.abs(best - from)) best = i;
  });
  return best;
}

// How long a field repair of `damage` hull points takes on the ground (`landed`) or in orbit. WR-7 (OC-D10, "Field
// repairs too"): the Damage Control Suite's frozen reduction (ShipEventBattle.dcRepairTimeReduction, 0 without it)
// shortens the repair exactly as it shortens a Shipyard repair (utilityGear.ts damageControlRepairTicks), before the
// field multiplier. Pure.
export function fieldRepairSeconds(damage: number, repairSpeed: number, landed: boolean, dcRepairTimeReduction = 0): number {
  const ticks = damageControlRepairTicks(repairTicksForDamage(Math.max(0, damage), Math.max(0, repairSpeed)), dcRepairTimeReduction);
  return ticks * (landed ? FIELD_REPAIR_TIME_MULT : ORBIT_REPAIR_TIME_MULT);
}

// Why a field repair cannot start now (null = it can). Pure.
export type FieldRepairBlockReason = "noFieldRepair" | "noDamage" | "alreadyRepairing" | "runFinished";
export function fieldRepairBlock(exp: Pick<Expedition, "groundOps">): FieldRepairBlockReason | null {
  const ops = exp.groundOps;
  if (!ops || ops.shipEventProfile?.battle?.repairSpeed === undefined) return "noFieldRepair";
  if (ops.endedAt !== undefined) return "runFinished";
  if (nextRepairEnd(ops)) return "alreadyRepairing";
  if (!((ops.hullDamage ?? 0) > 0)) return "noDamage";
  return null;
}

// The refusal in plain words. Exhaustive. Pure.
export function fieldRepairBlockText(reason: FieldRepairBlockReason): string {
  switch (reason) {
    case "noFieldRepair":
      return "This expedition launched before field repairs";
    case "noDamage":
      return "The ship has no damage to repair";
    case "alreadyRepairing":
      return "The ship is already setting down for repairs";
    case "runFinished":
      return "The ground operations are over: the Shipyard will repair the ship at home";
  }
}

// Start a field repair at `t` (validated by fieldRepairBlock): stored now, starting when the ship is free of its
// legs. Returns the leg, or null when it cannot start. Mutates the working clone.
export function scheduleFieldRepair(exp: Expedition, t: number, ordered: boolean): GroundRepairLeg | null {
  const ops = exp.groundOps;
  if (!ops || fieldRepairBlock(exp) !== null) return null;
  const battle = ops.shipEventProfile.battle!;
  const from = repairPosition(exp);
  const site = fieldRepairSite(exp, from);
  const travel = site === null || site === from ? 0 : IN_SYSTEM_LEG_SECONDS;
  const free = shipFreeAt(ops);
  const startsAt = free !== null && free > t ? free : t;
  const damage = ops.hullDamage ?? 0;
  const arrivesAt = startsAt + travel;
  const repairedAt = arrivesAt + fieldRepairSeconds(damage, battle.repairSpeed ?? 0, site !== null, battle.dcRepairTimeReduction ?? 0);
  const scanning = exp.bodies.findIndex((b) => !b.scanned);
  const leg: GroundRepairLeg = {
    kind: "repair",
    siteBodyIndex: site,
    ...(ordered ? { ordered: true as const } : {}),
    scanBodyIndex: scanning >= 0 ? scanning : null,
    startsAt,
    arrivesAt,
    repairedAt,
    endsAt: repairedAt + travel,
    hullRepaired: damage,
  };
  (ops.repairLegs ??= []).push(leg);
  return leg;
}

// The THRESHOLD trigger (expedition.ts calls it after a scan event added hull damage at `t`): past
// FIELD_REPAIR_DAMAGE_SHARE of the frozen hull pool the ship sets down for repairs on its own. Mutates.
export function maybeAutoFieldRepair(exp: Expedition, t: number): GroundRepairLeg | null {
  const battle = exp.groundOps?.shipEventProfile.battle;
  if (!battle || (exp.groundOps?.hullDamage ?? 0) < FIELD_REPAIR_DAMAGE_SHARE * battle.hullMax) return null;
  return scheduleFieldRepair(exp, t, false);
}

// ============================================================================
// Gas Giant Study GG-3: THE SHIP'S STUDY of an orbital body (gasGiantStudy.ts holds the rules)
// ============================================================================
//
// When an orbital body of a study run finishes its scan (groundOpsBodyScanned) the ship holds orbit there for the
// study (STUDY LEG, GroundStudyLeg): it starts then, or when the ship is free of a leg under way (legs never overlap),
// and lasts gasGiantStudy.ts studySeconds. While the scan still has bodies to go the scan clock pauses for it (the
// next body waits, scanBodyIndex); the teams keep working the scanned bodies; an ordinary pickup that would dock during
// it waits for its end (studyPickupAt), and a wiped team's recovery leg queues behind it like any leg. At its end the
// window latches `done` and the reward lands (gasGiantStudy.ts rollStudyReward: one "study" finding). The window does
// not close before every study is done. Stored when it starts, so every later time is a pure function of stored
// values (offline == live).

// The earliest study not yet finished, or null. Pure.
function nextStudyEnd(ops: GroundOpsState): GroundStudyLeg | null {
  let best: GroundStudyLeg | null = null;
  for (const leg of ops.studyLegs ?? []) if (!leg.done && (best === null || leg.endsAt < best.endsAt)) best = leg;
  return best;
}

// Store the study of orbital body `bodyIndex`, its scan complete at `t`. Returns the leg. Mutates the working clone.
export function scheduleStudyLeg(exp: Expedition, bodyIndex: number, t: number): GroundStudyLeg | null {
  const ops = exp.groundOps;
  const body = exp.bodies[bodyIndex];
  if (!ops || !body) return null;
  if ((ops.studyLegs ?? []).some((l) => l.bodyIndex === bodyIndex)) return null; // one study per body
  const free = shipFreeAt(ops);
  const startsAt = free !== null && free > t ? free : t;
  const scanning = exp.bodies.findIndex((b) => !b.scanned);
  const leg: GroundStudyLeg = {
    kind: "study",
    bodyIndex,
    scanBodyIndex: scanning >= 0 ? scanning : null,
    startsAt,
    endsAt: startsAt + studySeconds(exp, body),
  };
  (ops.studyLegs ??= []).push(leg);
  return leg;
}

// GG-4: store the NEBULA SWEEP of a run that sweeps one (gasGiantStudy.ts sweepsNebula), once every body is scanned
// (`t`: the last scan's completion, or a resumed window's opening). It starts then, or when the ship is free of a leg
// under way (a study of the last body included), and lasts nebulaSweepSeconds (GG-7: shorter with a Ramscoop Collector). One
// per run. Returns the leg, or null.
// Mutates the working clone.
export function scheduleNebulaSweep(exp: Expedition, t: number): GroundStudyLeg | null {
  const ops = exp.groundOps;
  if (!ops || !sweepsNebula(exp)) return null;
  if (!exp.bodies.every((b) => b.scanned)) return null;
  if ((ops.studyLegs ?? []).some((l) => l.nebula === 1)) return null; // one sweep per run
  const free = shipFreeAt(ops);
  const startsAt = free !== null && free > t ? free : t;
  const leg: GroundStudyLeg = {
    kind: "study",
    bodyIndex: NEBULA_SWEEP_BODY_INDEX,
    scanBodyIndex: null,
    startsAt,
    endsAt: startsAt + nebulaSweepSeconds(exp),
    nebula: 1,
  };
  (ops.studyLegs ??= []).push(leg);
  return leg;
}

// A study ends: latched done, and its reward found (GG-4: the sweep's reward for the nebula sweep). Mutates the
// working clone.
function finishStudy(exp: Expedition, leg: GroundStudyLeg): void {
  leg.done = true;
  exp.findings.push(leg.nebula === 1 ? rollNebulaReward(exp, leg.endsAt) : rollStudyReward(exp, leg.bodyIndex, leg.endsAt));
}

// When a shuttle that would dock at `landing` actually docks: at the end of the study that holds the ship then (one
// that started before `landing` and ends after it), else at `landing`. Legs never overlap, so one pass in start order
// settles it. Exactly `landing` on a run without a study. Pure.
export function studyPickupAt(ops: Pick<GroundOpsState, "studyLegs">, landing: number): number {
  let at = landing;
  for (const leg of ops.studyLegs ?? []) if (leg.startsAt < at && at < leg.endsAt) at = leg.endsAt;
  return at;
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

// The share of a study (or the sweep) done at `now`, in [0, 1]: its elapsed time over its length, both without the
// spans a pickup paused it (the user's pickup pause: progress is kept, never lost or counted twice). Exactly the plain
// elapsed share on a study no pickup paused. Pure.
export function studyLegShare(leg: Pick<GroundStudyLeg, "startsAt" | "endsAt" | "done" | "pauses">, now: number): number {
  if (leg.done) return 1;
  let paused = 0;
  let pausedSoFar = 0;
  for (const p of leg.pauses ?? []) {
    paused += p.to - p.from;
    pausedSoFar += Math.max(0, Math.min(now, p.to) - p.from);
  }
  const span = leg.endsAt - leg.startsAt - paused;
  return span > 0 ? Math.max(0, Math.min(1, (now - leg.startsAt - pausedSoFar) / span)) : 1;
}

// The run's ground progress in [0, 1] at `now` (the activities bar, the system's COMPLETION): every task's share
// (done or skipped counts whole, others their interpolated progress), each weighted by its difficulty's completion
// weight (Squads SQ-4, design section 4: sum(weight x progress) / sum(weight); riskFactors.ts difficultyWeight, 1
// for an unrated task, so a run before SQ-4 reads the plain mean as before). 0 before any task exists. Pure.
// Gas Giant Study GG-3 (plan section 2: the study counts as its body's one objective): on a study run each orbital body
// adds its STUDY at weight 1 (0 until it starts, then its elapsed share, 1 once done), so a run with no ground
// objective still shows its progress. Every other run reads exactly as before.
// GG-4: a run with a nebula adds its SWEEP the same way (weight 1; whole when an earlier trip of a resumed system swept
// it).
export function groundOpsProgress(exp: Pick<Expedition, "groundOps" | "bodies" | "study" | "nebula">, now: number): number {
  let total = 0;
  let sum = 0;
  exp.bodies.forEach((body, i) => {
    for (const task of body.activities) {
      const w = difficultyWeight(task.difficulty);
      total += w;
      sum += w * (task.done || task.status === "skipped" ? 1 : groundTaskProgressAt(exp, task, now));
    }
    if (!isStudyBody(exp, body)) return;
    const leg = exp.groundOps?.studyLegs?.find((l) => l.bodyIndex === i);
    total += 1;
    // G2-5: a resumed run's giant studied on an earlier trip counts whole.
    if (!leg && body.studied === true) sum += 1;
    if (!leg) return;
    sum += studyLegShare(leg, now);
  });
  if (exp.nebula !== undefined) {
    total += 1;
    const sweep = exp.groundOps?.studyLegs?.find((l) => l.nebula === 1);
    if (exp.nebula.swept === 1) sum += 1;
    else if (sweep) sum += studyLegShare(sweep, now);
  }
  return total > 0 ? Math.max(0, Math.min(1, sum / total)) : 0;
}
