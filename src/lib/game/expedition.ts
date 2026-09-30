// ============================================================================
// expedition.ts -- Exploration 0.14.0 (Phase E2a): the long-distance EXPEDITION
// state machine ENGINE (the big semi-idle exploration mode, design Part I.2).
//
// PURE FUNCTIONS ONLY (no Svelte, no UI). This module owns:
//   - startExpedition: dispatch a ship + captain on an expedition (seeds the target
//     system + bodies, snapshots the installed sensor array).
//   - resolveExpeditions: the per-tick engine, run ONCE per whole tick at the same
//     tail seam as resolveCrew (tick.ts), advancing every active expedition.
//   - claimExpedition: collect a completed expedition's placeholder findings.
//
// THE CROWN-JEWEL INVARIANT (offline == live parity), preserved BY CONSTRUCTION:
//   1. Every intra-phase state (transit elapse, scan %, activity completion) is a
//      PURE FUNCTION of ELAPSED gameTimeSeconds since the current phase began
//      (phaseAnchorSeconds). One big offline catch-up window advances gameTimeSeconds
//      by the same total as many small live ticks, so the elapsed value at any point
//      is identical, so every phase transition + intra-phase value is identical. This
//      mirrors tickCaptainMission's phaseProgressTicks closed-form advancement and
//      resolveCrew's gameTimeSeconds-window accumulator (crewOverlay.ts): a phase
//      boundary advances the anchor by the EXACT phase duration (never snaps to the
//      live clock), so overflow carries and several phases can resolve in one big call.
//   2. Every SEEDED outcome (the anomaly chart, per-body discoveries + activities) is a
//      pure function of the expedition's own `seed` + a fixed salt + an index (via
//      makeRng / mulberry32, combat/rng.ts), NEVER a live PRNG stream position and
//      NEVER Date.now()/Math.random(). So the outcome does not depend on HOW the elapsed
//      span was chunked into calls. (Contrast the extraction loot stream, which is
//      stream-position-based and therefore needs the whole-tick-boundary roll device;
//      keying every expedition roll off (seed, salt, index) sidesteps that entirely.)
//   3. ADDITIVE-NEUTRAL: with NO active expedition, resolveExpeditions returns the SAME
//      state reference, so the tick path is byte-identical to before this phase.
//
// ⚠️ E2a SCOPE (do NOT over-build): the ENGINE + a GENERIC body model ONLY.
//   - PLANET TYPES + a named LANDMARK/PoI catalog = E2b. Bodies here are generic (a scan
//     size, a hazard scalar, generic discovery tokens).
//   - The real away-team GAMBIT activity resolver = E3. E2a resolves activities through a
//     deterministic PLACEHOLDER resolver (resolveActivitiesPhase below): it flips `done` +
//     grants one placeholder finding per task. E3 swaps in real gambit combat WITHOUT
//     reshaping ExpeditionActivity (it keeps `done` as the completion flag).
//   - Relics/research/museum = E4. Findings here are generic placeholder tokens (a count +
//     a provenance tag), NOT the relic system.
//
// ⚠️ ALL NUMERIC CONSTANTS BELOW ARE FIRST-PASS TUNABLE launch placeholders (transit
// lengths, scan rates, anomaly odds, discovery counts), the same posture as SHIP_TYPES /
// MISSIONS / sensorArrays.ts. The balance pass owns the real numbers.
// ============================================================================

import type {
  GameState,
  Expedition,
  ExpeditionBody,
  ExpeditionDiscovery,
  ExpeditionActivity,
  ExpeditionFinding,
  ExpeditionScanParams,
} from "./model";
import { makeRng } from "./combat/rng";
import { installedSensorArray, sensorArrayEffect } from "./sensorArrays";
import { effectiveShipStats } from "./crewOverlay";

// ============================================================================
// FIRST-PASS TUNABLE constants
// ============================================================================

// TRANSIT: design I.2 says ~6 HOURS IRL to the first real target with a decent ship. At the default
// 1s tick cadence, 1 tick == 1 second, so 6 hrs == 21600 ticks. The inaugural SHAKEDOWN run (the
// per-account first expedition) is much shorter to "prove the drives" before the real long-haul.
export const TRANSIT_SECONDS = 21600; // ~6 hours IRL at the 1s cadence
export const SHAKEDOWN_TRANSIT_SECONDS = 1800; // ~30 min IRL: the inaugural shakedown

// The RETURN leg mirrors the outbound BASE transit (design C.0: recall re-runs that same transit
// home). It does NOT re-add the anomaly detour time (charting happened on the way out).
// (returnDuration reads baseTransitSeconds below.)

// ANOMALY: a mid-transit seeded chance to CHART AN ANOMALY -> adds time + a small placeholder bonus.
// The roll fires once, at the transit MIDPOINT (a "window boundary"); it is decided by a seed +
// salt, so evaluating it lazily at the midpoint is identical to any other resolution ordering.
export const ANOMALY_CHECK_FRACTION = 0.5; // roll at the halfway point of the BASE transit
export const ANOMALY_EXTRA_SECONDS = 3600; // charting adds ~1 hour IRL to the transit leg
export const ANOMALY_CHANCE_PERMILLE = 350; // 35% chance to chart (permille -> exact integer draw)

// SCANNING: % scanned per second via the installed array's effect + the ship's sensors. Bigger body
// (larger scanTotal) = longer; more hazardous = slower. The per-array scanRateMult / coverageWidth
// come from the snapshotted sensor array (sensorArrays.ts); a better array / higher sensors scans
// faster (proven by the scanning test).
export const SCAN_BASE_RATE = 0.05; // base scan units per second (a bare, un-sensored ship)
export const SCAN_SENSOR_COEFF = 0.02; // each point of the ship's sensors adds +2% scan speed (mirrors SURVEY_SENSOR_YIELD_COEFF)
export const SCAN_HAZARD_PENALTY = 0.5; // a hazard-1.0 body scans at 1/(1+0.5) == ~67% speed

// Per-body generation ranges (generic sizes + hazards).
export const BODY_COUNT_MIN = 1;
export const BODY_COUNT_MAX = 3;
export const BODY_SCAN_MIN = 80; // smallest body's scanTotal (~27 min at base rate 0.05)
export const BODY_SCAN_MAX = 200; // largest body's scanTotal
export const HAZARD_MAX_PERMILLE = 800; // hazard rolls in [0, 0.8]

// DISCOVERY: seeded generic tokens deposited when a body finishes scanning. Attempts per body, and the
// per-attempt base odds (the sensor array's discovery-odds biases add on top). A body ALWAYS yields at
// least one discovery (so it always yields at least one activity, per design I.2 step 4).
export const DISCOVERY_ATTEMPTS_BASE = 3;
export const DISCOVERY_ATTEMPTS_SPREAD = 2; // total attempts in [3, 4]
export const BASE_DISCOVERY_PERMILLE = 500; // 50% base per-attempt odds, before the array's bias

// ACTIVITIES: the placeholder resolver completes one task every ACTIVITY_SECONDS, granting one
// placeholder finding each. (E3's real gambit combat replaces the resolver, not this cadence.)
export const ACTIVITY_SECONDS = 600; // ~10 min IRL per ground-team task

// The banked sci-fi system names (design Part E). A dispatched expedition picks one by a seeded index.
// Extend this list as more systems are named; the seeded pick just indexes into it.
export interface BankedSystem {
  id: string;
  name: string;
}
export const BANKED_SYSTEMS: readonly BankedSystem[] = [
  { id: "keplersReach", name: "Kepler's Reach" },
  { id: "tychoVerge", name: "Tycho Verge" },
  { id: "cygnusGate", name: "Cygnus Gate" },
  { id: "erebusDeep", name: "Erebus Deep" },
  { id: "halcyonDrift", name: "Halcyon Drift" },
  { id: "meridianCradle", name: "Meridian Cradle" },
  { id: "vesperHollow", name: "Vesper Hollow" },
  { id: "oberonSpan", name: "Oberon Span" },
  { id: "calliopeReach", name: "Calliope Reach" },
  { id: "nyxThreshold", name: "Nyx Threshold" },
  { id: "sableExpanse", name: "Sable Expanse" },
  { id: "requiemBelt", name: "Requiem Belt" },
  { id: "auricShoals", name: "Auric Shoals" },
  { id: "thessalyRun", name: "Thessaly Run" },
  { id: "lyrasWake", name: "Lyra's Wake" },
  { id: "cinderMarches", name: "Cinder Marches" },
  { id: "ossuaryField", name: "Ossuary Field" },
  { id: "dholesCrossing", name: "Dhole's Crossing" },
];

// The neutral scan-param snapshot for a ship with no sensor array fitted (all-1 multipliers, 0 biases).
// Structurally an ExpeditionScanParams; scanning still works (at the base rate), just without an
// array's cadence/coverage character or discovery biases.
const NEUTRAL_SCAN_PARAMS: ExpeditionScanParams = {
  scanRateMult: 1,
  coverageWidth: 1,
  landmarkOddsBias: 0,
  undergroundPoiOddsBias: 0,
};

// Fixed decorrelation salts, so the several seeded draws an expedition makes (system pick, anomaly,
// per-body discoveries) come from independent, reproducible streams. Arbitrary-but-fixed nonzero
// constants (the exact values only have to be stable). ⚠️ Do NOT reuse a salt across purposes.
const SYSTEM_SALT = 0x1b56c4f9;
const ANOMALY_SALT = 0x7f4a7c15;
const DISCOVERY_SALT = 0x2c1b3c6d;

// A small epsilon for phase-boundary comparisons: scan/return durations can be fractional
// (scanTotal / rate), and gameTimeSeconds is float, so an "elapsed >= duration" check must tolerate a
// sub-tick float residue. Chosen far below one tick so it never merges two genuine ticks.
const PHASE_EPS = 1e-6;

// ============================================================================
// Seed derivation (reload-deterministic, decorrelated per expedition)
// ============================================================================

// Derive one expedition's stable PRNG seed from the per-save expeditionSeed + its expedition number,
// so every expedition's outcomes are reproducible across reloads yet decorrelated from each other
// (the same pattern crewOverlay's transportSeedFor + inspectSeed use). Pure uint32 mixing.
export function makeExpeditionSeed(saveSeed: number, expeditionNumber: number): number {
  return (
    (Math.imul((saveSeed >>> 0) ^ Math.imul(expeditionNumber, 0x9e3779b9), 0x85ebca6b) ^ 0xc2b2ae35) >>> 0
  );
}

function clampPermille(fraction: number): number {
  return Math.max(0, Math.min(1000, Math.round(fraction * 1000)));
}

// ============================================================================
// Dispatch (startExpedition)
// ============================================================================

export interface ExpeditionDispatchResult {
  next: GameState;
  success: boolean;
  reason?: string; // set only on failure
  expedition?: Expedition; // set only on success
}

// Generate the target system + its 1..3 generic bodies from the expedition seed. Deterministic. The
// body-generation stream is SEPARATE from each body's own discovery stream (see assignDiscoveries), so
// generation order never perturbs discovery outcomes.
function generateSystem(seed: number): { systemId: string; systemName: string; bodies: ExpeditionBody[] } {
  const rng = makeRng((seed ^ SYSTEM_SALT) >>> 0);
  const system = BANKED_SYSTEMS[rng.nextInt(BANKED_SYSTEMS.length)];
  const bodyCount = rng.nextRange(BODY_COUNT_MIN, BODY_COUNT_MAX);
  const bodies: ExpeditionBody[] = [];
  for (let i = 0; i < bodyCount; i++) {
    bodies.push({
      id: `body-${i + 1}`,
      scanTotal: rng.nextRange(BODY_SCAN_MIN, BODY_SCAN_MAX),
      scanProgress: 0,
      hazard: rng.nextInt(HAZARD_MAX_PERMILLE + 1) / 1000,
      scanned: false,
      discoveries: [],
      activities: [],
    });
  }
  return { systemId: system.id, systemName: system.name, bodies };
}

// Dispatch a ship + captain on a NEW expedition. Pure: returns { success, next, expedition } or a
// failure with a reason and the UNCHANGED state (same reference). Mirrors how a mission binds a
// captain (dispatchCaptainOnMission), but writes to state.expeditions instead of the captain. Enforces
// at most ONE expedition per ship. The target system + bodies are seeded from the per-save
// expeditionSeed + the expedition number; the installed sensor array + the crew-inclusive `sensors`
// derived stat are SNAPSHOTTED at dispatch so resolution is a pure function of the stored expedition.
export function startExpedition(state: GameState, shipId: string, captainId: number): ExpeditionDispatchResult {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return { next: state, success: false, reason: "noSuchShip" };
  if (ship.assignedCaptainId !== captainId) return { next: state, success: false, reason: "captainNotAssigned" };
  if (state.expeditions.some((e) => e.shipId === shipId))
    return { next: state, success: false, reason: "shipAlreadyOnExpedition" };

  const number = state.nextExpeditionId;
  const seed = makeExpeditionSeed(state.expeditionSeed, number);
  const id = `expedition-${number}`;
  const gen = generateSystem(seed);

  // Snapshot the installed sensor array's resolved (rarity/quality-scaled) scan params + the ship's
  // crew-inclusive sensors stat. effectiveShipStats folds equipment + crew (crewOverlay), so a Science
  // officer / Science division / a fitted sensor item all shape the snapshot by construction. A ship
  // with no sensor array snapshots the NEUTRAL params + whatever `sensors` its gear/crew fold to (0 for
  // a bare hull today, since the sensor slot has no Standard-Issue baseline).
  const installed = installedSensorArray(state, ship);
  const scanParams: ExpeditionScanParams = installed ? sensorArrayEffect(installed) : { ...NEUTRAL_SCAN_PARAMS };
  const sensorPower = effectiveShipStats(state, ship).sensors;

  const expedition: Expedition = {
    id,
    shipId,
    captainId,
    targetSystemId: gen.systemId,
    systemName: gen.systemName,
    sensorArrayId: installed?.def.id ?? null,
    scanParams,
    sensorPower,
    phase: "transit",
    phaseAnchorSeconds: state.gameTimeSeconds,
    shakedown: number === 1, // per-account inaugural run (nextExpeditionId === 1 means none dispatched yet)
    bodies: gen.bodies,
    anomalyResolved: false,
    anomalyCharted: false,
    findings: [],
    seed,
  };

  return {
    next: { ...state, expeditions: [...state.expeditions, expedition], nextExpeditionId: number + 1 },
    success: true,
    expedition,
  };
}

// ============================================================================
// Per-phase pure helpers (all read from ELAPSED-in-phase seconds)
// ============================================================================

// The BASE transit duration (no anomaly detour), shakedown-aware. The RETURN leg reuses this.
function baseTransitSeconds(exp: Expedition): number {
  return exp.shakedown ? SHAKEDOWN_TRANSIT_SECONDS : TRANSIT_SECONDS;
}

// The full TRANSIT duration: base + the anomaly detour once charted. anomalyCharted only becomes true
// after the anomaly resolves at the midpoint (ANOMALY_CHECK_FRACTION < 1), and the midpoint is strictly
// inside the base transit, so by the time elapsed could reach the base duration the anomaly is always
// resolved -> this duration is stable at the completion check (no mid-flight inconsistency).
function transitDurationSeconds(exp: Expedition): number {
  return baseTransitSeconds(exp) + (exp.anomalyCharted ? ANOMALY_EXTRA_SECONDS : 0);
}

// The scan rate (scan units / second) for one body: base rate, shaped by the snapshotted array's
// cadence + coverage and the ship's sensors, slowed by the body's hazard. Always > 0.
function scanRatePerSecond(exp: Expedition, body: ExpeditionBody): number {
  const sensorBoost = 1 + Math.max(0, exp.sensorPower) * SCAN_SENSOR_COEFF;
  const hazardSlow = 1 + Math.max(0, body.hazard) * SCAN_HAZARD_PENALTY;
  return (SCAN_BASE_RATE * exp.scanParams.scanRateMult * exp.scanParams.coverageWidth * sensorBoost) / hazardSlow;
}

// Total time to scan the WHOLE system (all bodies, sequentially). The SCANNING phase's duration.
function scanningDurationSeconds(exp: Expedition): number {
  let total = 0;
  for (const body of exp.bodies) total += body.scanTotal / scanRatePerSecond(exp, body);
  return total;
}

// The total number of ground-team activities across all bodies (generated at each body's 100% scan).
function totalActivities(exp: Expedition): number {
  let n = 0;
  for (const body of exp.bodies) n += body.activities.length;
  return n;
}

// The ACTIVITIES phase duration: one task per ACTIVITY_SECONDS.
function activitiesDurationSeconds(exp: Expedition): number {
  return totalActivities(exp) * ACTIVITY_SECONDS;
}

// The current phase's total duration in seconds (0 for "complete", which the loop never asks about).
function phaseDurationSeconds(exp: Expedition): number {
  switch (exp.phase) {
    case "transit":
      return transitDurationSeconds(exp);
    case "scanning":
      return scanningDurationSeconds(exp);
    case "activities":
      return activitiesDurationSeconds(exp);
    case "return":
      return baseTransitSeconds(exp);
    case "complete":
      return 0;
  }
}

// Assign a body's generic discoveries + one activity per discovery, ONCE, when it first hits 100%.
// Seeded off (expedition seed, DISCOVERY_SALT, body index) so it is chunking-independent + reproducible.
// A body ALWAYS yields at least one discovery (design I.2: 100% scan yields an activity list).
function assignDiscoveriesAndActivities(exp: Expedition, body: ExpeditionBody, bodyIndex: number): void {
  const rng = makeRng((exp.seed ^ (DISCOVERY_SALT + Math.imul(bodyIndex + 1, 0x9e3779b9))) >>> 0);
  const attempts = DISCOVERY_ATTEMPTS_BASE + rng.nextInt(DISCOVERY_ATTEMPTS_SPREAD + 1);
  const landmarkPermille = clampPermille(BASE_DISCOVERY_PERMILLE / 1000 + exp.scanParams.landmarkOddsBias);
  const undergroundPermille = clampPermille(BASE_DISCOVERY_PERMILLE / 1000 + exp.scanParams.undergroundPoiOddsBias);
  const discoveries: ExpeditionDiscovery[] = [];
  for (let a = 0; a < attempts; a++) {
    if (rng.chance(landmarkPermille, 1000))
      discoveries.push({ id: `${exp.id}-${body.id}-disc-${discoveries.length}`, kind: "landmark" });
    if (rng.chance(undergroundPermille, 1000))
      discoveries.push({ id: `${exp.id}-${body.id}-disc-${discoveries.length}`, kind: "underground" });
  }
  if (discoveries.length === 0)
    discoveries.push({ id: `${exp.id}-${body.id}-disc-0`, kind: "landmark" });
  body.discoveries = discoveries;
  body.activities = discoveries.map((_, k) => ({
    id: `${exp.id}-${body.id}-act-${k}`,
    bodyId: body.id,
    done: false,
  }));
}

// Resolve SCANNING up to `consumed` seconds into the phase. Sequential, per-body: allocate the elapsed
// time body by body. A body that fully scans gets its discoveries + activities assigned exactly once
// (the `scanned` latch). Idempotent: scanProgress is SET from elapsed (never incremented), so re-running
// with the same or larger `consumed` is correct + never double-assigns.
function resolveScanningPhase(exp: Expedition, consumed: number): void {
  let remaining = consumed;
  for (let i = 0; i < exp.bodies.length; i++) {
    const body = exp.bodies[i];
    const rate = scanRatePerSecond(exp, body);
    const bodyTime = body.scanTotal / rate;
    if (remaining >= bodyTime - PHASE_EPS) {
      body.scanProgress = body.scanTotal;
      remaining -= bodyTime;
      if (!body.scanned) {
        body.scanned = true;
        assignDiscoveriesAndActivities(exp, body, i);
      }
    } else {
      body.scanProgress = Math.min(body.scanTotal, Math.max(0, remaining) * rate);
      remaining = 0;
      break; // later bodies are not started yet (they stay at scanProgress 0)
    }
  }
}

// Resolve ACTIVITIES up to `consumed` seconds into the phase: the PLACEHOLDER resolver. It completes one
// task per ACTIVITY_SECONDS in flat body/activity order, flipping `done` + appending one placeholder
// finding per newly-completed task. Idempotent (only touches !done activities). ⚠️ E3 SWAP-IN SEAM: the
// real gambit away-team combat replaces the "flip done + grant a finding" body here; it keeps
// ExpeditionActivity.done as the completion flag + appends to exp.findings, so the record is unchanged.
function resolveActivitiesPhase(exp: Expedition, consumed: number): void {
  const total = totalActivities(exp);
  if (total === 0) return;
  const completedCount = Math.min(total, Math.floor((consumed + PHASE_EPS) / ACTIVITY_SECONDS));
  let seen = 0;
  for (const body of exp.bodies) {
    for (const act of body.activities) {
      if (seen < completedCount && !act.done) {
        act.done = true;
        exp.findings.push({ id: `${exp.id}-find-act-${act.id}`, source: "activity" });
      }
      seen++;
    }
  }
}

// Resolve the mid-transit anomaly, ONCE, when elapsed reaches the midpoint. Seeded (expedition seed +
// ANOMALY_SALT), so the result is chunking-independent. On success: latch anomalyCharted (which extends
// the transit duration via transitDurationSeconds) + append one placeholder finding. Guarded by
// anomalyResolved so it fires exactly once. Because the midpoint is strictly inside the base transit,
// this always resolves before the transit-completion check reads transitDurationSeconds.
function maybeResolveAnomaly(exp: Expedition, elapsedInPhase: number): void {
  if (exp.anomalyResolved) return;
  if (elapsedInPhase + PHASE_EPS < baseTransitSeconds(exp) * ANOMALY_CHECK_FRACTION) return;
  exp.anomalyResolved = true;
  const charted = makeRng((exp.seed ^ ANOMALY_SALT) >>> 0).chance(ANOMALY_CHANCE_PERMILLE, 1000);
  if (charted) {
    exp.anomalyCharted = true;
    exp.findings.push({ id: `${exp.id}-find-anomaly`, source: "anomaly" });
  }
}

const PHASE_NEXT: Record<Expedition["phase"], Expedition["phase"]> = {
  transit: "scanning",
  scanning: "activities",
  activities: "return",
  return: "complete",
  complete: "complete",
};

// A guard on the phase-advance loop: an expedition has exactly 4 non-terminal phases, so even a span
// that clears all of them in one big call needs at most 4 transitions. A generous ceiling catches any
// future logic error (a zero-length phase that never advances) without risking an infinite loop.
const PHASE_ADVANCE_GUARD = 8;

// Deep-clone an expedition so advanceExpedition never mutates the stored input (bodies + their nested
// arrays + findings are all copied). Cheap: an expedition holds a handful of small arrays.
function cloneExpedition(exp: Expedition): Expedition {
  return {
    ...exp,
    scanParams: { ...exp.scanParams },
    bodies: exp.bodies.map((b) => ({
      ...b,
      discoveries: b.discoveries.map((d) => ({ ...d })),
      activities: b.activities.map((a) => ({ ...a })),
    })),
    findings: exp.findings.map((f) => ({ ...f })),
  };
}

// Advance ONE expedition to the given game time. Pure: returns the SAME reference when nothing changes
// (already complete), else a fresh advanced expedition. Loops across phase boundaries so a big offline
// span can clear transit -> scanning -> activities -> return -> complete in one call. Each boundary
// advances phaseAnchorSeconds by the EXACT phase duration (overflow carries), the closed-form invariant.
export function advanceExpedition(exp: Expedition, nowSeconds: number): Expedition {
  if (exp.phase === "complete") return exp;
  const e = cloneExpedition(exp);
  let guard = 0;
  while (e.phase !== "complete" && guard++ < PHASE_ADVANCE_GUARD) {
    const elapsed = Math.max(0, nowSeconds - e.phaseAnchorSeconds);
    if (e.phase === "transit") maybeResolveAnomaly(e, elapsed);
    const dur = phaseDurationSeconds(e);
    const consumed = Math.min(elapsed, dur);
    if (e.phase === "scanning") resolveScanningPhase(e, consumed);
    else if (e.phase === "activities") resolveActivitiesPhase(e, consumed);
    // transit + return have no intra-phase state beyond the anomaly (handled above).
    if (elapsed + PHASE_EPS < dur) break; // still inside this phase
    e.phaseAnchorSeconds += dur; // exact-duration advance so overflow carries to the next phase
    e.phase = PHASE_NEXT[e.phase];
  }
  return e;
}

// ============================================================================
// The per-tick engine (resolveExpeditions) + claim
// ============================================================================

// Advance every active expedition to state.gameTimeSeconds, ONCE per whole tick. Run at the same tail
// seam as resolveCrew (tick.ts). Deterministic + offline-safe (see the module header). ADDITIVE-NEUTRAL
// FAST PATH: with NO expedition the array is empty, so this returns the SAME state reference and the
// tick path is byte-identical to before this phase.
export function resolveExpeditions(state: GameState): GameState {
  if (state.expeditions.length === 0) return state;
  let changed = false;
  const next = state.expeditions.map((exp) => {
    const advanced = advanceExpedition(exp, state.gameTimeSeconds);
    if (advanced !== exp) changed = true;
    return advanced;
  });
  return changed ? { ...state, expeditions: next } : state;
}

export interface ExpeditionClaimResult {
  next: GameState;
  success: boolean;
  reason?: string; // set only on failure
  findings?: ExpeditionFinding[]; // set only on success
}

// Collect a COMPLETE expedition: remove it from the fleet and hand back its findings. Pure.
// ⚠️ E2a findings are GENERIC placeholder tokens with no reward payload, so claim just REMOVES the
// expedition and returns the findings for the caller (the E2c UI / the E4 relic system) to deposit; it
// does NOT itself deposit anything (there is nothing generic to deposit yet). A CLAIM step (rather than
// auto-deposit) is deliberate: the real deposit lands with E4, and a claim keeps the completed
// expedition visible until the player collects it. Fails (same-ref state) if not found or not complete.
export function claimExpedition(state: GameState, expeditionId: string): ExpeditionClaimResult {
  const exp = state.expeditions.find((e) => e.id === expeditionId);
  if (!exp) return { next: state, success: false, reason: "notFound" };
  if (exp.phase !== "complete") return { next: state, success: false, reason: "notComplete" };
  return {
    next: { ...state, expeditions: state.expeditions.filter((e) => e.id !== expeditionId) },
    success: true,
    findings: exp.findings,
  };
}

// ============================================================================
// Pure readers (for the E2c UI + tests; no state mutation)
// ============================================================================

// The whole-system scan fraction in [0, 1] (total scanned work / total work). Pure.
export function expeditionScanFraction(exp: Expedition): number {
  let total = 0;
  let done = 0;
  for (const body of exp.bodies) {
    total += body.scanTotal;
    done += body.scanProgress;
  }
  return total > 0 ? Math.min(1, done / total) : 0;
}

// The number of completed activities across all bodies. Pure.
export function expeditionActivitiesDone(exp: Expedition): number {
  let n = 0;
  for (const body of exp.bodies) for (const act of body.activities) if (act.done) n++;
  return n;
}
