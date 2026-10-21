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
// TIER_ENCOUNTER_HAZARD_CEILING (groundFight.ts), Weak enemies on the curve's low end (enemyRanks.ts EARLY_CURVE_RANK),
// the affix roll and ambush chances x ramp (groundOps.ts, affixes.ts), the ship-event checks' fail chance, hull wear
// and battle enemy on the curve (shipScanEvents.ts); at full strength every number is exactly the unstamped one apart
// from the hazard ceiling. SF-4 the patrol; G1 the short-range missions (keyed per template).

import {
  SHIP_TYPES,
  freshRunCounts,
  type Expedition,
  type GameState,
  type RegionTier,
  type RunCounts,
  type RunDifficultyStamp,
  type ShipTypeKey,
} from "./model";

export type RunType = "expedition" | "patrol" | "shortRange";

// ===== the curve =====

// [PROVISIONAL] The curve is full (nominal) once this many runs have been flown after the training run: runs 2 to 10
// ramp, run 11 is full (user SF4 "full from run 11").
export const N_FULL = 10;
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

// The curve position f in [0, 1] after `completed` runs (the training run excluded): 0 on the first ramped run,
// ((completed) / (N_FULL - 1)) ^ RAMP_EXPONENT between, 1 from N_FULL - 1 completed runs on. Pure.
export function rampFraction(completed: number): number {
  const t = Math.min(1, wholeCount(completed) / (N_FULL - 1));
  return t >= 1 ? 1 : Math.pow(t, RAMP_EXPONENT);
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

// The ORDINARY run's stamp (every expedition dispatched since SF-3 that is not the training run): the curve position
// and the region tier it was dispatched at, read strictly (a missing or malformed stamp, or the training run, reads
// null: the run plays exactly as it did before SF-3). The ramp is clamped to [0, 1] and the tier to I..VII. Pure.
export function rampedStampOf(exp: Pick<Expedition, "difficulty">): RunDifficultyStamp | null {
  const d: unknown = exp.difficulty;
  if (!d || typeof d !== "object") return null;
  const s = d as Partial<RunDifficultyStamp>;
  if (s.version !== 1 || s.firstRun !== false || typeof s.ramp !== "number" || !Number.isFinite(s.ramp)) return null;
  const tier = typeof s.tier === "number" && Number.isInteger(s.tier) ? (Math.max(1, Math.min(7, s.tier)) as RegionTier) : 1;
  return { version: 1, firstRun: false, ramp: Math.max(0, Math.min(1, s.ramp)), tier };
}

// The curve position a run's odds read (the affix roll, the ambush chance, the ship-event checks and hull wear): the
// stamp's ramp on an ordinary run, 1 (nominal) on a run without one. Pure.
export function runRampOf(exp: Pick<Expedition, "difficulty">): number {
  return rampedStampOf(exp)?.ramp ?? 1;
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
  const ramp = firstRun ? 0 : veteran ? 1 : runRamp(completedRuns(state, type, key), tier);
  return { version: 1, firstRun, ramp, tier };
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

// Won patrol routes (economyTick, beside lifetimeStats.missionsCompleted). SF-4 leaves the training cycle's route out.
// Zero or junk routes return the SAME counts. Pure.
export function countPatrolRoutes(counts: RunCounts, routes: number): RunCounts {
  const n = wholeCount(routes);
  return n === 0 ? counts : { ...counts, patrol: { ...counts.patrol, completed: counts.patrol.completed + n } };
}
