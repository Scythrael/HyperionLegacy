// Safe first runs SF-1 (docs/plans/2026-10-15-safe-first-runs-plan.md section 3.3, 3.4, 4 SF-1 and the USER ANSWERS
// at its end, which override the original slices): the per-type RUN COUNTERS, the TRAINING-RUN rule and the gentle
// DIFFICULTY CURVE. Pure functions over stored state: no RNG, no clock.
//
// What SF-1 decides (user, 2026-10-16):
// - The expedition TRAINING RUN is the first expedition FROM AN EXPLORER (spec "explorer": Orion, Aurora, Eir), not the
//   first on the account (SF3). One at a time: while a stamped training run is out, another explorer flies a ramped
//   run. A RECALLED training run carries the training run over (SF16): the next explorer run is still the training run.
// - ONE safe patrol in total (SF9): the save's first patrol dispatch, either route.
// - The curve counts COMPLETED runs only, MINUS the training run (SF5): a claimed expedition that was not recalled, a
//   won patrol route. After the training run the next run sits at the floor ("run 2 at 35%").
// - Slow start (SF4): run 2 at 35%, run 6 about 54%, run 9 about 80%, full from run 11. Tier I only (SF6): Tier II and
//   up read full strength from their first run there (the tier is the step).
// - Existing saves count as done (veterans): a save that flew a type before 0.14.0 never gets its training run, and
//   its curve reads full strength, so it plays exactly as today (save.ts v70, veteranRunCountsV70 below).
//
// SF-1 changed NO behavior. SF-2 stamps the expedition TRAINING RUN (runDifficultyAt in expedition.ts buildExpedition,
// written only when firstRun is true) and applies its profile (FIRST_RUN_ENEMY_SCALE and FIRST_RUN_MAX_ENEMIES in
// groundFight.ts, no affixes or ambushes and the fell-back backstop in groundOps.ts, pass-only ship events, Guaranteed
// odds, expedition.ts TUTORIAL_TRANSIT_SECONDS). SF-3 stamps EVERY other new expedition with its curve position and
// tier (an ORDINARY run, rampedStampOf) and applies the curve: its guards at rampEnemyScale on the hazard at most
// TIER_ENCOUNTER_HAZARD_CEILING (groundFight.ts), the faded Weak factor on unled enemies (enemyRanks.ts
// curveBaseFactor), the affix roll and ambush chances x the odds ramp, one run behind (groundOps.ts, affixes.ts,
// rampOddsFraction), the ship-event checks' fail chance, hull wear
// and battle enemy on the curve (shipScanEvents.ts); at full strength every number is exactly the unstamped one apart
// from the hazard ceiling. SF-4 stamps the patrol (patrolDifficultyAt, the safe first patrol and the patrol curve, read
// by combat/patrolProfile.ts in the live loop and the forecast alike); G1 the short-range missions (keyed per template).

import {
  SHIP_TYPES,
  freshRunCounts,
  type Expedition,
  type GameState,
  type PatrolDifficultyStamp,
  type RegionTier,
  type RunCounts,
  type RunDifficultyStamp,
  type ShipTypeKey,
} from "./model";

export type RunType = "expedition" | "patrol" | "shortRange";

// ===== the curve =====

// [PROVISIONAL] The curve is full (nominal) once N_FULL - 1 runs have been flown after the training run: runs 2 to 11
// ramp, run 12 is full. User SF4 "full from run 11", then the SF-3 review (2026-10-21, "Smooth the last steps"): the
// final climb is spread over runs 9 to 12 so no single run is a wall.
export const N_FULL = 11;
// The ease-in's span and its end (completed runs): the SF4 slow start ((c / RAMP_EASE_SPAN) ^ RAMP_EXPONENT, the
// anchors run 2 at 35%, run 6 about 54%, run 9 about 80%, unchanged) up to RAMP_EASE_UNTIL completed runs (run 9), then
// an even climb to full at N_FULL - 1 (runs 10, 11, 12: about 86%, 93%, 100%), each step smaller than the ease-in's last.
export const RAMP_EASE_SPAN = 9;
export const RAMP_EASE_UNTIL = 7;
// The SF-3 review (2026-10-21): the affix roll and the ambush chance reach full strength this many runs AFTER the
// enemy curve (their own curve position is the enemy curve's RAMP_ODDS_LAG runs earlier; full from run 13).
export const RAMP_ODDS_LAG = 1;
// [PROVISIONAL] Enemy strength on the first ramped run (run 2), as a fraction of nominal (user SF4 "run 2 at 35%").
export const RAMP_FLOOR = 0.35;
// The ease-in power (user SF4 "Slow start"): polynomial, so the curve can never become exponential.
export const RAMP_EXPONENT = 1.5;
// [PROVISIONAL] The training run's enemy strength and enemy cap per fight (plan section 2.5 D: no lost fight for the
// weakest launchable crew in 126 runs). Read by SF-2's encounter profile.
export const FIRST_RUN_ENEMY_SCALE = 0.2;
export const FIRST_RUN_MAX_ENEMIES = 1;
// The highest tier the curve applies to (user SF6 "Tier I only").
export const RAMP_MAX_TIER: RegionTier = 1;
// The hazard an ENCOUNTER reads at most, per tier (user SF7 "Cap by tier": I 0.1, II 0.5, uncapped from III; the scan
// and the risk grade keep the real hazard). A tier with no entry reads the raw hazard. Read by SF-3.
export const TIER_ENCOUNTER_HAZARD_CEILING: Readonly<Partial<Record<RegionTier, number>>> = { 1: 0.1, 2: 0.5 };

// A completed-run count read as a whole, non-negative number (junk reads as none). Pure.
function wholeCount(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// The curve position f in [0, 1] after `completed` runs (the training run excluded): 0 on the first ramped run, the
// ease-in (completed / RAMP_EASE_SPAN) ^ RAMP_EXPONENT up to RAMP_EASE_UNTIL, then even steps to 1 at N_FULL - 1
// completed runs, 1 from there on. Pure.
export function rampFraction(completed: number): number {
  const c = wholeCount(completed);
  if (c >= N_FULL - 1) return 1;
  const ease = (n: number): number => Math.pow(n / RAMP_EASE_SPAN, RAMP_EXPONENT);
  if (c <= RAMP_EASE_UNTIL) return ease(c);
  const from = ease(RAMP_EASE_UNTIL);
  return from + ((1 - from) * (c - RAMP_EASE_UNTIL)) / (N_FULL - 1 - RAMP_EASE_UNTIL);
}

// The curve position the affix roll and the ambush chance read after `completed` runs: the enemy curve RAMP_ODDS_LAG
// runs earlier (0 until then), so they reach full strength one run after the enemies (SF-3 review). Pure.
export function rampOddsFraction(completed: number): number {
  const c = wholeCount(completed);
  return c < RAMP_ODDS_LAG ? 0 : rampFraction(c - RAMP_ODDS_LAG);
}

// The ramp a run at `tier` reads after `completed` runs: the curve at Tier I, full strength above it. Pure.
export function runRamp(completed: number, tier: RegionTier): number {
  return tier > RAMP_MAX_TIER ? 1 : rampFraction(completed);
}

// Enemy strength (a multiplier on nominal HP, power and heal) at curve position `ramp`: exactly 1 at full strength.
// Pure.
export function rampEnemyScale(ramp: number): number {
  return ramp >= 1 ? 1 : RAMP_FLOOR + (1 - RAMP_FLOOR) * ramp;
}

// A run's enemy strength from its stamp: the training run's own scale, else the curve. Pure.
export function runEnemyScale(stamp: Pick<RunDifficultyStamp, "firstRun" | "ramp">): number {
  return stamp.firstRun ? FIRST_RUN_ENEMY_SCALE : rampEnemyScale(stamp.ramp);
}

// The most enemies one fight fields on a run: the training run's cap, else no cap (null). Pure.
export function runMaxEnemies(stamp: Pick<RunDifficultyStamp, "firstRun">): number | null {
  return stamp.firstRun ? FIRST_RUN_MAX_ENEMIES : null;
}

// The hazard an encounter reads at `tier`: the raw hazard, at most the tier's ceiling. Pure.
export function encounterHazard(rawHazard: number, tier: RegionTier): number {
  const ceiling = TIER_ENCOUNTER_HAZARD_CEILING[tier];
  return ceiling === undefined ? rawHazard : Math.min(rawHazard, ceiling);
}

// ===== SF-3: a stored run on the curve =====

// The ORDINARY run's stamp (every expedition dispatched since SF-3 that is not the training run): the curve position,
// the region tier it was dispatched at and (when it lags the enemy curve) the odds' own position, read strictly (a
// missing or malformed stamp, or the training run, reads null: the run plays exactly as it did before SF-3). The ramps
// are clamped to [0, 1] and the tier to I..VII. Pure.
export function rampedStampOf(exp: Pick<Expedition, "difficulty">): RunDifficultyStamp | null {
  const d: unknown = exp.difficulty;
  if (!d || typeof d !== "object") return null;
  const s = d as Partial<RunDifficultyStamp>;
  if (s.version !== 1 || s.firstRun !== false || typeof s.ramp !== "number" || !Number.isFinite(s.ramp)) return null;
  const tier = typeof s.tier === "number" && Number.isInteger(s.tier) ? (Math.max(1, Math.min(7, s.tier)) as RegionTier) : 1;
  const clamp = (n: number): number => Math.max(0, Math.min(1, n));
  const odds = typeof s.oddsRamp === "number" && Number.isFinite(s.oddsRamp) ? { oddsRamp: clamp(s.oddsRamp) } : {};
  return { version: 1, firstRun: false, ramp: clamp(s.ramp), tier, ...odds };
}

// The curve position a run's ship events read (the checks' fail chance and hull wear): the stamp's ramp on an ordinary
// run, 1 (nominal) on a run without one. Pure.
export function runRampOf(exp: Pick<Expedition, "difficulty">): number {
  return rampedStampOf(exp)?.ramp ?? 1;
}

// The curve position a run's affix roll and ambush chance read (SF-3 review: one run behind the enemy curve): the
// stamp's oddsRamp, else its ramp, 1 (nominal) on a run without a stamp. Pure.
export function runOddsRampOf(exp: Pick<Expedition, "difficulty">): number {
  const stamp = rampedStampOf(exp);
  return stamp ? (stamp.oddsRamp ?? stamp.ramp) : 1;
}

// A chance on the curve: `chance` x `ramp`, exactly `chance` at full strength (so a nominal run reads the same
// number, bit for bit). Pure.
export function rampedChance(chance: number, ramp: number): number {
  return ramp >= 1 ? chance : chance * Math.max(0, ramp);
}

// A pass chance on the curve: the FAIL chance (1 - pass) x `ramp`, so a check gets harder as the curve rises and is
// exactly `pass` at full strength. Pure.
export function rampedPassChance(pass: number, ramp: number): number {
  return ramp >= 1 ? pass : 1 - (1 - pass) * Math.max(0, ramp);
}

// ===== SF-4: the safe first patrol and the patrol curve =====
//
// User answers: ONE safe patrol in total (SF9), flown as "Fewest waves, lightest raider" (SF10: 2 waves of 1 Raider)
// that cannot be lost (OC-1); after it the enemies "start weaker and grow to full over the first several patrols (same
// gentle curve)" (SF11), the curve counting PATROL RUNS (user 2026-10-21 "One step per patrol run": each dispatched
// patrol is one step however many routes a Repeat run flies; a run counts once it wins a route), the training run left
// out (SF5). Patrols are Tier I
// content (no region tier), so the curve applies (SF6). The Weak fade, the affix lag and the ambush lag of the SF-3
// review are Ground Ops rules: a patrol battle has no ranks, affixes or ambushes, so the enemy scale below is the whole
// patrol curve (the smoothed last steps come with rampFraction, one source).

// The training cycle's wave count at most (user SF10 "2 waves of 1 Raider"): the first FIRST_PATROL_WAVES waves of the
// cycle's own schedule (never more than the route's minWaves), so the schedule draws are unchanged.
export const FIRST_PATROL_WAVES = 2;

// The difficulty a patrol dispatched now flies: the save's one safe patrol (firstRun), else the curve at the patrol
// runs counted so far, Tier I. ABSENT (undefined) at full strength (a veteran, or the curve at its top): the cycle is stored
// and fought exactly as before SF-4. Pure.
export function patrolDifficultyAt(state: GameState): PatrolDifficultyStamp | undefined {
  const stamp = runDifficultyAt(state, "patrol", RAMP_MAX_TIER);
  if (!stamp.firstRun && stamp.ramp >= 1) return undefined;
  return { ...stamp, completed: stamp.firstRun ? 0 : completedRuns(state, "patrol") };
}

// The next cycle's difficulty at a Dispatch Repeatedly relaunch, from THIS cycle's stamp alone (so a relaunch is a
// pure function of the stored mission: one big call == many small ones, and a second captain's runs never reach it
// mid-run). User 2026-10-21 "One step per patrol run": a run keeps ONE curve position for every route it repeats, so a
// ramped cycle hands over its own stamp unchanged; the training cycle hands over the curve's floor (the training run
// does not count, SF5, so its later routes fly where the next patrol will start). Absent in = absent out (full strength
// stays full; an in-flight patrol from before SF-4 relaunches as it did). Pure.
export function nextPatrolCycleDifficulty(stamp: PatrolDifficultyStamp | undefined): PatrolDifficultyStamp | undefined {
  const s = patrolStampOf({ difficulty: stamp });
  if (s === null) return undefined;
  if (!s.firstRun) return s;
  const ramp = runRamp(s.completed, RAMP_MAX_TIER);
  return ramp >= 1 ? undefined : { version: 1, firstRun: false, ramp, tier: RAMP_MAX_TIER, completed: s.completed };
}

// A patrol cycle's stamp read strictly (a missing or malformed stamp reads null: full strength, the cycle plays as it
// did before SF-4). The ramp is clamped to [0, 1]. Pure.
export function patrolStampOf(mission: { difficulty?: PatrolDifficultyStamp }): PatrolDifficultyStamp | null {
  const d: unknown = mission.difficulty;
  if (!d || typeof d !== "object") return null;
  const s = d as Partial<PatrolDifficultyStamp>;
  if (s.version !== 1 || typeof s.firstRun !== "boolean" || typeof s.ramp !== "number" || !Number.isFinite(s.ramp)) return null;
  return {
    version: 1,
    firstRun: s.firstRun,
    ramp: Math.max(0, Math.min(1, s.ramp)),
    tier: RAMP_MAX_TIER,
    completed: typeof s.completed === "number" ? wholeCount(s.completed) : 0,
  };
}

// Whether a patrol cycle is the save's safe training cycle. Pure.
export function isTrainingPatrol(mission: { difficulty?: PatrolDifficultyStamp }): boolean {
  return patrolStampOf(mission)?.firstRun === true;
}

// The enemy strength a patrol cycle fights at (a multiplier on each enemy's hull, shields, weapon yields and drones):
// the curve's rampEnemyScale on a ramped cycle, nominal (1) on the training cycle (its lesson is the shape: the
// lightest hull, one per wave, two waves) and on a cycle without a stamp. Pure.
export function patrolEnemyScale(mission: { difficulty?: PatrolDifficultyStamp; combatRules?: unknown }): number {
  const s = patrolStampOf(mission);
  if (s === null || s.firstRun) return 1;
  // WR-8 answer 6: a cycle under the combat rules (its stamp) climbs the patrol rules curve; an older cycle the shared one.
  return mission.combatRules !== undefined ? patrolRulesEnemyScale(s.ramp) : rampEnemyScale(s.ramp);
}

// [PROVISIONAL] WR-8 review answer 6 (user 2026-10-22, "Ship it, soften early curve"): the WR-8 combat rules made the
// early Warbands harder for the light hulls, so a patrol cycle under the rules climbs the same curve from a lower floor:
// PATROL_RULES_RAMP_FLOOR of nominal on the first ramped run (the shared RAMP_FLOOR is 0.35), the same climb, exactly
// nominal at full strength (c10 unchanged). Expeditions, short-range runs and pre-WR-8 cycles keep the shared curve.
export const PATROL_RULES_RAMP_FLOOR = 0.2;
export function patrolRulesEnemyScale(ramp: number): number {
  if (!(ramp < 1)) return 1;
  return PATROL_RULES_RAMP_FLOOR + (1 - PATROL_RULES_RAMP_FLOOR) * Math.max(0, ramp);
}

// ===== the counters =====

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

// The stored counters' shape check (a malformed value is re-derived from the save's history). Pure.
export function isWellFormedRunCounts(v: unknown): v is RunCounts {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, any>;
  const e = c.expedition;
  const p = c.patrol;
  return (
    c.version === 1 &&
    !!e && typeof e === "object" && isCount(e.completed) && typeof e.trainingDone === "boolean" && typeof e.veteran === "boolean" &&
    !!p && typeof p === "object" && isCount(p.dispatched) && isCount(p.completed) && typeof p.veteran === "boolean" &&
    !!c.shortRange && typeof c.shortRange === "object" && !Array.isArray(c.shortRange) &&
    Object.values(c.shortRange).every((r: any) => !!r && typeof r === "object" && isCount(r.dispatched) && isCount(r.completed))
  );
}

// The patrol routes v70 knew (FROZEN: PATROLS' keys when v70 shipped), for the veteran derivation.
export const V70_PATROL_KEYS: readonly string[] = ["crimsonReaverSweep", "crimsonReaverWarband"];

// A raw save's number (a plain number, a Decimal or its serialized string), read as a whole count. Pure.
function rawCount(v: unknown): number {
  const n = typeof v === "number" ? v : v !== null && v !== undefined && typeof v !== "boolean" ? Number(String(v)) : NaN;
  return wholeCount(n);
}

// FROZEN (save v70): the counters a save without them has EARNED, read from the history it already stores, so a save
// that flew a type before 0.14.0 is a VETERAN of it (no training run, the curve at full strength: today's play).
// - Expeditions: nextExpeditionId - 1 were dispatched; every one no longer in `expeditions` was claimed (a claim is the
//   only removal). Any dispatch makes the save a veteran (an in-flight run at the upgrade has no stamp and finishes
//   exactly as before).
// - Patrols: nextPatrolSeed - 1 were dispatched (the counter moves only on a dispatch), at least 1 when a route was
//   ever won; completed = the won routes (lifetimeStats.missionsCompleted over V70_PATROL_KEYS).
// - Short-range missions: none existed.
// Reads only the raw save and frozen constants, never live data, so retuning the game can never reshape an old save.
// Hardened: any unreadable field reads as none. Pure.
export function veteranRunCountsV70(state: any): RunCounts {
  const s = state && typeof state === "object" ? state : {};
  const dispatched = Math.max(0, rawCount(s.nextExpeditionId) - 1);
  const inFlight = Array.isArray(s.expeditions) ? s.expeditions.length : 0;
  const missions = s.lifetimeStats && typeof s.lifetimeStats === "object" ? s.lifetimeStats.missionsCompleted : undefined;
  const won = missions && typeof missions === "object" ? V70_PATROL_KEYS.reduce((sum, k) => sum + rawCount(missions[k]), 0) : 0;
  const patrols = Math.max(Math.max(0, rawCount(s.nextPatrolSeed) - 1), won > 0 ? 1 : 0);
  const fresh = freshRunCounts();
  return {
    ...fresh,
    expedition: { completed: Math.max(0, dispatched - inFlight), trainingDone: dispatched > 0, veteran: dispatched > 0 },
    patrol: { dispatched: patrols, completed: won, veteran: patrols > 0 },
  };
}

// The save's counters: the stored ones, else (a dev save at v70 from before SF-1, or a hand-built state) the ones its
// history earned. Pure.
export function runCountsOf(state: GameState): RunCounts {
  return isWellFormedRunCounts(state.runCounts) ? state.runCounts : veteranRunCountsV70(state);
}

// Completed runs of a type so far, the training run excluded (short-range missions per template). Pure.
export function completedRuns(state: GameState, type: RunType, key?: string): number {
  const c = runCountsOf(state);
  if (type === "expedition") return c.expedition.completed;
  if (type === "patrol") return c.patrol.completed;
  return key === undefined ? 0 : c.shortRange[key]?.completed ?? 0;
}

// G2-5's recall marker (`Expedition.recall`, written only by the recall action), read by shape until it lands. Pure.
function wasRecalled(exp: Expedition): boolean {
  return (exp as { recall?: unknown }).recall !== undefined;
}

// Whether an explorer of hull `hull` dispatched now would fly the training run: an explorer, the save's training run
// not yet done, no stamped training run already out, and not a veteran. Pure.
export function isTrainingExpedition(state: GameState, hull: ShipTypeKey): boolean {
  const c = runCountsOf(state).expedition;
  if (c.trainingDone || c.veteran) return false;
  if (SHIP_TYPES[hull]?.spec !== "explorer") return false;
  return !state.expeditions.some((e) => e.difficulty?.firstRun === true);
}

// Whether the next run of a type is its safe first run. `key`: the dispatching hull for an expedition, the template
// for a short-range mission (no key: false); patrols take none. Pure.
export function isFirstRun(state: GameState, type: RunType, key?: string): boolean {
  if (type === "expedition") return key !== undefined && isTrainingExpedition(state, key as ShipTypeKey);
  const c = runCountsOf(state);
  if (type === "patrol") return !c.patrol.veteran && c.patrol.dispatched === 0;
  return key !== undefined && (c.shortRange[key]?.dispatched ?? 0) === 0;
}

// The difficulty stamp a dispatch of `type` at `tier` writes now (SF-2 the training run, SF-3 every other expedition,
// SF-4 the patrol): the training run, else the curve position (a veteran reads full strength). SF-3 (user SF6 "Tier I
// only"): an EXPEDITION above RAMP_MAX_TIER is never the training run and reads full strength from its first run there
// (the tier is the step; Tier II and up are not safe), so the expedition training run waits for a Tier I run. Other
// run types keep their own first-run rule (G1: a short-range template's first roll is its training run at any tier,
// taking that tier's smallest roll). Frozen on the run so an in-flight run never changes. Pure.
export function runDifficultyAt(state: GameState, type: RunType, tier: RegionTier, key?: string): RunDifficultyStamp {
  const firstRun = (type !== "expedition" || tier <= RAMP_MAX_TIER) && isFirstRun(state, type, key);
  const c = runCountsOf(state);
  const veteran = type === "expedition" ? c.expedition.veteran : type === "patrol" ? c.patrol.veteran : false;
  const completed = completedRuns(state, type, key);
  const ramp = firstRun ? 0 : veteran ? 1 : runRamp(completed, tier);
  // SF-3 review: an ordinary expedition's affix roll and ambushes lag the enemy curve by RAMP_ODDS_LAG runs, stored
  // only where they differ from `ramp` (so a veteran or Tier II+ run, and every other run type, stores what it did).
  const oddsRamp = type === "expedition" && !firstRun && !veteran && tier <= RAMP_MAX_TIER ? rampOddsFraction(completed) : ramp;
  return { version: 1, firstRun, ramp, tier, ...(oddsRamp !== ramp ? { oddsRamp } : {}) };
}

// The claim rule (claimExpedition): a recalled run changes nothing (a recalled training run carries over; a recalled
// run is not a completed one); the training run marks training done and never counts on the curve; any other claimed
// run counts once. Pure: new objects, the input untouched.
export function countClaimedExpedition(counts: RunCounts, exp: Expedition): RunCounts {
  if (wasRecalled(exp)) return counts;
  if (exp.difficulty?.firstRun === true) return { ...counts, expedition: { ...counts.expedition, trainingDone: true } };
  return { ...counts, expedition: { ...counts.expedition, completed: counts.expedition.completed + 1 } };
}

// One patrol dispatch (dispatchCaptainOnPatrol). Pure.
export function countPatrolDispatch(counts: RunCounts): RunCounts {
  return { ...counts, patrol: { ...counts.patrol, dispatched: counts.patrol.dispatched + 1 } };
}

// One short-range cycle START of `template` (G1-3: the first cycle at dispatch; G1-4: every later cycle start). The
// whole job re-rolls each cycle, so a template's training run is decided by THIS count (isFirstRun: dispatched === 0),
// bumped per cycle start of that template, never per slot dispatch. Pure.
export function countShortRangeCycleStart(counts: RunCounts, template: string): RunCounts {
  const prev = counts.shortRange[template] ?? { dispatched: 0, completed: 0 };
  return { ...counts, shortRange: { ...counts.shortRange, [template]: { ...prev, dispatched: prev.dispatched + 1 } } };
}

// G1-4: a cycle start that never left home (recalled while it waited at the departure gate, recallCaptain) was never
// flown, so its start is taken back: the template keeps its training run. Never below 0. Pure.
export function uncountShortRangeCycleStart(counts: RunCounts, template: string): RunCounts {
  const prev = counts.shortRange[template];
  if (prev === undefined || prev.dispatched === 0) return counts;
  return { ...counts, shortRange: { ...counts.shortRange, [template]: { ...prev, dispatched: prev.dispatched - 1 } } };
}

// G1-4: one DELIVERED short-range cycle of `template` on the curve (SF5: completed runs only, the training run
// excluded, so the caller skips a training cycle). Pure.
export function countShortRangeCycleComplete(counts: RunCounts, template: string): RunCounts {
  const prev = counts.shortRange[template] ?? { dispatched: 0, completed: 0 };
  return { ...counts, shortRange: { ...counts.shortRange, [template]: { ...prev, completed: prev.completed + 1 } } };
}

// Patrol runs on the curve (economyTick, from tickCaptainPatrol's curveRunsCompleted: a run counts ONCE, when it wins
// its first route, user 2026-10-21 "One step per patrol run"; the training run is left out, SF5). Zero or junk counts
// return the SAME counts. Pure.
export function countPatrolRuns(counts: RunCounts, runs: number): RunCounts {
  const n = wholeCount(runs);
  return n === 0 ? counts : { ...counts, patrol: { ...counts.patrol, completed: counts.patrol.completed + n } };
}
