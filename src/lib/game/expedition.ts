// ============================================================================
// expedition.ts -- Exploration 0.14.0 (Phase E2a): the long-distance EXPEDITION
// state machine ENGINE (the big semi-idle exploration mode, design Part I.2).
//
// PURE FUNCTIONS ONLY (no Svelte, no UI). This module owns:
//   - startExpedition: dispatch a ship + captain on an expedition (seeds the target
//     system + bodies, snapshots the installed sensor array).
//   - resolveExpeditions: the per-tick engine, run ONCE per whole tick at the same
//     tail seam as resolveCrew (tick.ts), advancing every active expedition.
//   - claimExpedition: collect a completed expedition and DEPOSIT its findings (E4a: materials,
//     credits, and relic tokens into the relic vault; see depositExpeditionFindings).
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
  ShipInstance,
  Expedition,
  ExpeditionBody,
  ExpeditionDiscovery,
  ExpeditionActivity,
  ExpeditionFinding,
  ExpeditionScanParams,
} from "./model";
import { makeRng, type Rng } from "./combat/rng";
import { installedSensorArray, sensorArrayEffect, sensorArrayRelicFindBonus } from "./sensorArrays";
// E4d: the relic-unlocked Pathfinder Suite's expedition effect (a pure leaf over the installed pieces).
import { pathfinderEffect } from "./utilityGear";
import { equippedFor } from "./equipment";
import { effectiveShipStats } from "./crewOverlay";
import {
  PLANET_TYPES,
  poisForPlanetType,
  planetTypeHazard,
  type WeightedPoi,
} from "./expeditionContent";
import type { ExpeditionPlanetType } from "./model";
// E3a: the away-team GAMBIT engine. deriveAwayTeam snapshots the ship's crew-derived team strength at
// dispatch; resolveExpeditionActivity is the real gambit-combat swap-in for the placeholder activity
// resolver below. The gambit catalogs are static data touched ONLY on the activities path, so importing
// them here keeps the no-expedition tick byte-identical (additive-neutral).
import { deriveAwayTeam, resolveExpeditionActivity } from "./gambit";
// E4a: the PoI -> relic-set single source of truth (pure data) for the foreknowledge signature + the
// claim deposit's set routing.
import { RELIC_SETS, relicSetForPoi, museumBonuses, resistedHazard } from "./relics";
import type { RelicSetId, RelicVaultToken } from "./model";
// E4a: the CLAIM DEPOSIT routes materials through the discovery-safe add seam (addToInventory, clamped at
// itemCap) and folds the haul into lifetimeStats through the shared fold. These are imported from tick.ts,
// which itself imports resolveExpeditions from this module: an ESM cycle that is SAFE because neither
// module touches the other's bindings at module-evaluation time (only inside function bodies, called
// long after both modules have finished loading). ⚠️ Keep it that way: never call a tick.ts export at the
// top level of this file.
import { addToInventory, itemCap, foldLifetimeStatsDelta } from "./tick";
import Decimal from "break_infinity.js";

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

// Per-body generation ranges (sizes). A body's HAZARD is no longer a free roll: E2b derives it from the
// body's assigned PLANET TYPE (planetTypeHazard, expeditionContent.ts), so a body's danger tracks its
// type (Volcanic HIGH, Toxic VERY HIGH, Terrestrial LOW) instead of an independent random scalar.
export const BODY_COUNT_MIN = 1;
export const BODY_COUNT_MAX = 3;
export const BODY_SCAN_MIN = 80; // smallest body's scanTotal (~27 min at base rate 0.05)
export const BODY_SCAN_MAX = 200; // largest body's scanTotal

// DISCOVERY: seeded generic tokens deposited when a body finishes scanning. Attempts per body, and the
// per-attempt base odds (the sensor array's discovery-odds biases add on top). A body ALWAYS yields at
// least one discovery (so it always yields at least one activity, per design I.2 step 4).
export const DISCOVERY_ATTEMPTS_BASE = 3;
export const DISCOVERY_ATTEMPTS_SPREAD = 2; // total attempts in [3, 4]
export const BASE_DISCOVERY_PERMILLE = 500; // 50% base per-attempt odds, before the array's bias

// ACTIVITIES: the placeholder resolver completes one task every ACTIVITY_SECONDS, granting one
// placeholder finding each. (E3's real gambit combat replaces the resolver, not this cadence.)
export const ACTIVITY_SECONDS = 600; // ~10 min IRL per ground-team task

// ============================================================================
// E2c: candidate targets + sensor-gated foreknowledge (FIRST-PASS TUNABLE)
// ============================================================================
//
// The dispatch console offers a small STABLE list of candidate frontier systems. The list is derived
// PURELY from the per-save expeditionSeed + a candidate INDEX (via makeExpeditionSeed), so it is stable
// across ticks (a preview NEVER advances expeditionSeed) yet reproducible; dispatch COMMITS one
// candidate's seed to the launched expedition and only THEN advances expeditionSeed so the next list is
// fresh. Because a candidate's seed IS the seed the committed expedition uses, the foreknowledge preview
// (a display-derived projection of generateSystem(seed) + the same discovery roll) can never lie.
export const EXPEDITION_CANDIDATE_COUNT = 3; // how many candidate targets the console offers (TUNABLE)

// SENSOR FOREKNOWLEDGE THRESHOLDS: the crew-inclusive `sensors` power (effectiveShipStats) a ship needs
// to reveal each successive layer of a candidate's contents. Below the first threshold the destination
// reads "beyond sensor range" (only its name is known, like the mockup's Cygnus Gate). A standard fitted
// sensor array folds to ~20 sensors (tick.test), so a bare hull (0) is beyond range, a basic sensor
// reveals the body count + planet types, and richer sensors (rarity/quality/iLevel, later crew-amplified)
// unlock hazard + the relic signature. FIRST-PASS TUNABLE placeholders (the balance pass owns the reveal
// curve), the same posture as the transit/scan/anomaly constants above.
export const SENSOR_REVEAL_IN_RANGE = 8; // >= this: in range -> body COUNT is known
export const SENSOR_REVEAL_PLANET_TYPES = 20; // >= this: each body's PLANET TYPE is known
export const SENSOR_REVEAL_HAZARD = 40; // >= this: each body's HAZARD tier is known
export const SENSOR_REVEAL_RELIC = 65; // >= this: the system's RELIC SIGNATURE flag is known

// The PoIs whose findings carry a RELIC lead (the relic-signature detector keys off these). E4a: this is
// no longer a curated local list. It reads relics.ts RELIC_SET_BY_POI (via relicSetForPoi), the ONE
// source of truth the gambit reward relic roll (gambit.ts rollRelicToken) also reads, so the signature
// and the actual drops can never drift. The signature is a truthful HINT ("this system, scanned with your
// array, would surface a relic lead"), derived from the SAME seeded discovery roll the committed
// expedition runs, so it never lies.

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

// Advance the per-save expeditionSeed after a dispatch COMMITS a candidate, so the NEXT candidate list is
// a fresh set of systems (the old list's un-chosen candidates are not re-offered). Pure uint32 mixing, a
// decorrelated transform distinct from makeExpeditionSeed's per-index mix. Only startExpedition calls it
// (never a preview, never the tick), so previews stay STABLE until a dispatch actually happens.
export function advanceExpeditionSeed(saveSeed: number): number {
  return (Math.imul((saveSeed >>> 0) ^ 0x9e3779b9, 0x27d4eb2f) ^ 0x85ebca6b) >>> 0;
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
    // E2b: pick the body's PLANET TYPE from the seeded generation stream (FIRST-PASS uniform over the 8
    // types; a weighted rarity distribution is a tuning knob). The type gates the body's discoveries +
    // odds (assignDiscoveriesAndActivities) and stamps its `hazard` (planetTypeHazard). The pick draws
    // from the SAME generation stream as the size/count, kept SEPARATE from each body's discovery stream
    // (assignDiscoveriesAndActivities), so generation order never perturbs discovery outcomes.
    const planetType: ExpeditionPlanetType = PLANET_TYPES[rng.nextInt(PLANET_TYPES.length)].id;
    bodies.push({
      id: `body-${i + 1}`,
      planetType,
      scanTotal: rng.nextRange(BODY_SCAN_MIN, BODY_SCAN_MAX),
      scanProgress: 0,
      hazard: planetTypeHazard(planetType),
      scanned: false,
      discoveries: [],
      activities: [],
    });
  }
  return { systemId: system.id, systemName: system.name, bodies };
}

// The resolved sensor snapshot for a ship: its installed array (or null), that array's rarity/quality-
// scaled scan params (or the NEUTRAL params when none is fitted), and the ship's crew-inclusive `sensors`
// power. Factored out so the DISPATCH commit and the FOREKNOWLEDGE preview read the SAME inputs, which is
// what makes the preview truthful (the launched expedition snapshots exactly what the preview projected).
// A missing ship reads neutral params + sensors 0 (defensive; startExpedition guards the ship first).
function shipSensorSnapshot(
  state: GameState,
  ship: ShipInstance | undefined,
): { sensorArrayId: string | null; scanParams: ExpeditionScanParams; sensorPower: number } {
  if (!ship) return { sensorArrayId: null, scanParams: { ...NEUTRAL_SCAN_PARAMS }, sensorPower: 0 };
  const installed = installedSensorArray(state, ship);
  return {
    sensorArrayId: installed?.def.id ?? null,
    scanParams: installed ? sensorArrayEffect(installed) : { ...NEUTRAL_SCAN_PARAMS },
    // effectiveShipStats folds equipment + crew (crewOverlay), so a Science officer / Science division /
    // a fitted sensor item all shape this by construction. 0 for a bare hull today.
    sensorPower: effectiveShipStats(state, ship).sensors,
  };
}

// E4d: the ship's INSTALLED-GEAR expedition bonuses, added to the museum's at dispatch: the Pathfinder
// Suite's scan speed + hazard resist, and the installed sensor array's relic-find bonus (non-zero only for
// the Bio-Resonance Array). Exact zeros for a ship carrying neither (every existing loadout), so the
// snapshot sum museum + 0 is the museum value bit-for-bit. Pure.
export interface ExpeditionGearBonuses {
  scanSpeed: number;
  hazardResist: number;
  relicFindChance: number;
}
export function expeditionGearBonuses(state: GameState, ship: ShipInstance): ExpeditionGearBonuses {
  const pathfinder = pathfinderEffect(equippedFor(state, ship.id));
  return {
    scanSpeed: pathfinder.scanSpeed,
    hazardResist: pathfinder.hazardResist,
    relicFindChance: sensorArrayRelicFindBonus(installedSensorArray(state, ship)),
  };
}

// ============================================================================
// E2c: candidate targets + sensor-gated foreknowledge (pure readers)
// ============================================================================

// A candidate's FOREKNOWLEDGE view: a progressive reveal gated by the ship's crew-inclusive `sensors`.
// Below SENSOR_REVEAL_IN_RANGE the destination is `inRange: false` (only its name is known); each higher
// threshold unlocks the next field. Every revealed value is a projection of generateSystem(candidate.seed)
// (+ the same discovery roll for the relic signature), so it matches what the committed expedition
// resolves. A field is null until its threshold is met (the UI shows a masked placeholder for a null).
export interface ExpeditionForeknowledgeBody {
  planetType: ExpeditionPlanetType | null; // revealed at SENSOR_REVEAL_PLANET_TYPES
  hazard: number | null; // revealed at SENSOR_REVEAL_HAZARD (the planet type's hazard scalar)
}
export interface ExpeditionForeknowledge {
  inRange: boolean; // sensors >= SENSOR_REVEAL_IN_RANGE
  bodyCount: number | null; // revealed with inRange
  bodies: ExpeditionForeknowledgeBody[] | null; // one per body once in range (fields fill by threshold)
  relicSignature: boolean | null; // revealed at SENSOR_REVEAL_RELIC: a relic lead is present
  // E4a (additive): WHICH relic sets the system's would-be discoveries source, in canonical RELIC_SETS
  // order, revealed at the same SENSOR_REVEAL_RELIC threshold (null below it). Since E4a every PoI sources
  // some set, so the boolean above reads true for any revealed system; this list is the informative half
  // (the E4c UI can name the sets instead of a bare "Relic signature" chip).
  relicSets: RelicSetId[] | null;
}

// One offered candidate target: a stable id + index, the seed the committed expedition WILL use, the
// system identity (always known -- a name shows even beyond sensor range, like the mockup's Cygnus Gate),
// and the sensor-gated foreknowledge view.
export interface ExpeditionCandidate {
  id: string; // "cand-<index>", stable for a given expeditionSeed
  index: number;
  seed: number; // == the committed expedition's seed if this candidate is chosen (so the preview matches)
  systemId: string;
  systemName: string;
  foreknowledge: ExpeditionForeknowledge;
}

// Run the REAL seeded discovery roll for a preview system (generateSystem's bodies), reusing the exact
// engine path (assignDiscoveriesAndActivities) so the projection cannot drift from what the committed
// expedition resolves. Builds a throwaway expedition-shaped object with the given seed + the ship's
// snapshotted scan params (the array bias skews discoveries, so the preview must use the ship's array),
// then reads the resulting discoveries. Pure: mutates only the local throwaway. Returns the distinct relic
// SETS the would-be discoveries source (relics.ts relicSetForPoi), in canonical RELIC_SETS order; the
// boolean signature is "this list is non-empty".
function previewRelicSets(seed: number, scanParams: ExpeditionScanParams): RelicSetId[] {
  const gen = generateSystem(seed);
  const fake: Expedition = {
    id: "preview",
    shipId: "",
    captainId: 0,
    targetSystemId: gen.systemId,
    systemName: gen.systemName,
    sensorArrayId: null,
    scanParams,
    sensorPower: 0,
    phase: "scanning",
    phaseAnchorSeconds: 0,
    shakedown: false,
    bodies: gen.bodies,
    anomalyResolved: false,
    anomalyCharted: false,
    anomalyOptIn: false,
    findings: [],
    seed,
    // E3a snapshot fields: irrelevant to the discovery-only preview (it never resolves activities), so a
    // neutral zero team + the default program pair keeps this throwaway well-typed without affecting the roll.
    securityStrength: 0,
    scienceStrength: 0,
    teamKit: 0,
    gambitPrograms: { security: [], science: [] },
    // E4b museum snapshot: irrelevant to the discovery roll (it reads only the seed + scan-param biases),
    // so the neutral zeros keep the throwaway well-typed without touching the preview.
    scanSpeedBonus: 0,
    relicFindBonus: 0,
    hazardResist: 0,
  };
  fake.bodies.forEach((b, i) => assignDiscoveriesAndActivities(fake, b, i));
  const found = new Set<RelicSetId>();
  for (const b of fake.bodies) {
    for (const d of b.discoveries) {
      const setId = relicSetForPoi(d.poiId);
      if (setId !== null) found.add(setId);
    }
  }
  return RELIC_SETS.map((s) => s.id).filter((id) => found.has(id));
}

// Gate a generated system into a foreknowledge VIEW by the ship's sensor power. Pure.
function gateForeknowledge(
  sensorPower: number,
  bodies: ExpeditionBody[],
  seed: number,
  scanParams: ExpeditionScanParams,
): ExpeditionForeknowledge {
  const inRange = sensorPower >= SENSOR_REVEAL_IN_RANGE;
  if (!inRange) return { inRange: false, bodyCount: null, bodies: null, relicSignature: null, relicSets: null };
  const showTypes = sensorPower >= SENSOR_REVEAL_PLANET_TYPES;
  const showHazard = sensorPower >= SENSOR_REVEAL_HAZARD;
  const showRelic = sensorPower >= SENSOR_REVEAL_RELIC;
  const relicSets = showRelic ? previewRelicSets(seed, scanParams) : null;
  return {
    inRange: true,
    bodyCount: bodies.length,
    bodies: bodies.map((b) => ({
      planetType: showTypes ? b.planetType : null,
      hazard: showHazard ? b.hazard : null,
    })),
    relicSignature: relicSets === null ? null : relicSets.length > 0,
    relicSets,
  };
}

// The STABLE list of candidate targets a ship's expedition console offers. PURE reader: derived only from
// the per-save expeditionSeed + a candidate index (via makeExpeditionSeed) and the ship's sensor snapshot,
// so it is stable across ticks (nothing here advances expeditionSeed) and identical on repeated reads of
// an unchanged state. The candidate SEEDS are ship-independent (all ships see the same frontier systems);
// only the FOREKNOWLEDGE reveal differs by the ship's sensors. dispatch (startExpedition) commits one
// candidate's seed and only THEN advances expeditionSeed for a fresh next list.
export function expeditionCandidates(state: GameState, shipId: string): ExpeditionCandidate[] {
  const ship = state.ships.find((s) => s.id === shipId);
  const snap = shipSensorSnapshot(state, ship);
  const out: ExpeditionCandidate[] = [];
  for (let i = 0; i < EXPEDITION_CANDIDATE_COUNT; i++) {
    const seed = makeExpeditionSeed(state.expeditionSeed, i);
    const gen = generateSystem(seed);
    out.push({
      id: `cand-${i}`,
      index: i,
      seed,
      systemId: gen.systemId,
      systemName: gen.systemName,
      foreknowledge: gateForeknowledge(snap.sensorPower, gen.bodies, seed, snap.scanParams),
    });
  }
  return out;
}

// Dispatch a ship + captain on a NEW expedition by COMMITTING a chosen candidate target. Pure: returns
// { success, next, expedition } or a failure with a reason and the UNCHANGED state (same reference).
// Mirrors how a mission binds a captain (dispatchCaptainOnMission), but writes to state.expeditions
// instead of the captain. Enforces at most ONE expedition per ship + the assigned-captain guard. The
// launched system is generated from the CHOSEN CANDIDATE'S seed (so it matches the foreknowledge preview
// the player saw), the sensor array + crew-inclusive `sensors` are SNAPSHOTTED (resolution is then a pure
// function of the stored expedition), the anomaly OPT-IN is stored, and expeditionSeed is advanced so the
// next candidate list is fresh. `anomalyOptIn` defaults true (the E2a/E2b always-chart behavior).
export function startExpedition(
  state: GameState,
  shipId: string,
  captainId: number,
  candidateId: string,
  anomalyOptIn: boolean = true,
): ExpeditionDispatchResult {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return { next: state, success: false, reason: "noSuchShip" };
  if (ship.assignedCaptainId !== captainId) return { next: state, success: false, reason: "captainNotAssigned" };
  if (state.expeditions.some((e) => e.shipId === shipId))
    return { next: state, success: false, reason: "shipAlreadyOnExpedition" };

  const candidate = expeditionCandidates(state, shipId).find((c) => c.id === candidateId);
  if (!candidate) return { next: state, success: false, reason: "noSuchCandidate" };

  const number = state.nextExpeditionId;
  const seed = candidate.seed; // COMMIT the previewed candidate's seed so the launch matches its preview
  const id = `expedition-${number}`;
  const gen = generateSystem(seed);
  const snap = shipSensorSnapshot(state, ship);
  // E3a: snapshot the away team's crew-derived strength + team kit + the account-level gambit program
  // pair, so the expedition's ground battles resolve as a pure function of the stored expedition (parity;
  // editing the account programs mid-flight never changes an in-flight run, matching the sensor snapshot).
  // (E4b: deriveAwayTeam already folds the museum's scienceTeamPower into scienceStrength.)
  const awayTeam = deriveAwayTeam(state, ship);
  // E4b: snapshot the account-level museum's EXPEDITION bonuses at dispatch (the same "the launch is what
  // you saw at dispatch" contract as the sensor + away-team snapshots), so resolution reads only stored
  // values and a museum that grows mid-flight never changes an in-flight run (parity by construction).
  const museum = museumBonuses(state);
  // E4d: the ship's installed relic-unlocked gear (Pathfinder Suite, Bio-Resonance Array) adds to the SAME
  // snapshot, ADDITIVELY and at the same dispatch instant, so resolution reads only stored values and an
  // in-flight run never changes if the ship's gear changes later (the same contract as the museum and
  // sensor-array snapshots). Zeros without the gear, so museum + 0 is bit-identical to the E4b snapshot.
  const gear = expeditionGearBonuses(state, ship);
  const gambitPrograms = {
    security: state.gambitPrograms.security.map((r) => ({ ...r, params: r.params ? { ...r.params } : undefined })),
    science: state.gambitPrograms.science.map((r) => ({ ...r, params: r.params ? { ...r.params } : undefined })),
  };

  const expedition: Expedition = {
    id,
    shipId,
    captainId,
    targetSystemId: gen.systemId,
    systemName: gen.systemName,
    sensorArrayId: snap.sensorArrayId,
    scanParams: snap.scanParams,
    sensorPower: snap.sensorPower,
    phase: "transit",
    phaseAnchorSeconds: state.gameTimeSeconds,
    shakedown: number === 1, // per-account inaugural run (nextExpeditionId === 1 means none dispatched yet)
    bodies: gen.bodies,
    anomalyResolved: false,
    anomalyCharted: false,
    anomalyOptIn,
    findings: [],
    seed,
    securityStrength: awayTeam.securityStrength,
    scienceStrength: awayTeam.scienceStrength,
    teamKit: awayTeam.teamKit,
    gambitPrograms,
    scanSpeedBonus: museum.scanSpeed + gear.scanSpeed,
    relicFindBonus: museum.relicFindChance + gear.relicFindChance,
    hazardResist: museum.hazardResist + gear.hazardResist,
  };

  return {
    next: {
      ...state,
      expeditions: [...state.expeditions, expedition],
      nextExpeditionId: number + 1,
      // Advance the preview seed ONLY here (a commit), so previews stay stable until a dispatch happens.
      expeditionSeed: advanceExpeditionSeed(state.expeditionSeed),
    },
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
//
// E4b: two SNAPSHOTTED museum bonuses shape it too. scanSpeedBonus multiplies the rate by (1 + b), and
// hazardResist shrinks the hazard the body presents (resistedHazard, bounded, never negative) before the
// hazard slow is computed. Both are stored on the expedition at dispatch, so the rate stays a pure
// function of the stored run. Both are 0 for an empty museum: x * 1 is exact and resistedHazard returns
// the hazard unchanged, so the rate is bit-identical to E4a.
function scanRatePerSecond(exp: Expedition, body: ExpeditionBody): number {
  const sensorBoost = 1 + Math.max(0, exp.sensorPower) * SCAN_SENSOR_COEFF;
  const hazardSlow = 1 + Math.max(0, resistedHazard(body.hazard, exp.hazardResist ?? 0)) * SCAN_HAZARD_PENALTY;
  const museumScan = 1 + (exp.scanSpeedBonus ?? 0);
  return (SCAN_BASE_RATE * exp.scanParams.scanRateMult * exp.scanParams.coverageWidth * sensorBoost * museumScan) / hazardSlow;
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

// Pick one PoI from a weighted candidate list via a single integer draw over the total weight. Pure
// function of the rng's next draw, so it stays chunking-independent + reproducible. The list is never
// empty at the call sites (POIS_BY_PLANET_TYPE asserts each pool non-empty per type; the caller also
// length-guards), so the trailing return is a defensive floor, never reached.
function pickWeightedPoi(rng: Rng, candidates: WeightedPoi[]): WeightedPoi {
  let total = 0;
  for (const c of candidates) total += c.weight;
  let roll = rng.nextInt(total); // [0, total)
  for (const c of candidates) {
    roll -= c.weight;
    if (roll < 0) return c;
  }
  return candidates[candidates.length - 1];
}

// Assign a body's discoveries + one activity per discovery, ONCE, when it first hits 100%. E2b makes the
// discoveries REAL + TYPE-GATED: they are drawn from the body's PLANET TYPE eligible PoI pools
// (poisForPlanetType, expeditionContent.ts), and skewed by the SNAPSHOTTED sensor array bias (surface vs
// underground). Each per-attempt pool roll extends the E2a formula by adding the PLANET TYPE's own
// per-pool bias to the array's bias on top of the base odds, so Wide-Beam (surface bias) yields more
// surface finds, Focused-Beam (underground bias) yields more underground finds, AND the planet type
// shapes the mix (Arid skews underground, Barren yields fewer, etc.). Seeded off (expedition seed,
// DISCOVERY_SALT, body index), so it is chunking-independent + reproducible (unchanged from E2a; the
// extra weighted-pick draws come from this same keyed stream, never a live stream position). A body
// ALWAYS yields at least one discovery (design I.2: 100% scan yields an activity list).
function assignDiscoveriesAndActivities(exp: Expedition, body: ExpeditionBody, bodyIndex: number): void {
  const rng = makeRng((exp.seed ^ (DISCOVERY_SALT + Math.imul(bodyIndex + 1, 0x9e3779b9))) >>> 0);
  // The planet type gates the eligible pools; PLANET_TYPES[0] (terrestrial) is a defensive default the
  // union type makes unreachable, kept so an unexpected id still yields a valid pool.
  const planet = PLANET_TYPES.find((p) => p.id === body.planetType) ?? PLANET_TYPES[0];
  const pools = poisForPlanetType(planet.id);
  const attempts = DISCOVERY_ATTEMPTS_BASE + rng.nextInt(DISCOVERY_ATTEMPTS_SPREAD + 1);
  // Per-pool per-attempt odds: base + the PLANET TYPE's pool bias + the sensor ARRAY's pool bias.
  const surfacePermille = clampPermille(BASE_DISCOVERY_PERMILLE / 1000 + planet.surfaceBias + exp.scanParams.landmarkOddsBias);
  const undergroundPermille = clampPermille(BASE_DISCOVERY_PERMILLE / 1000 + planet.undergroundBias + exp.scanParams.undergroundPoiOddsBias);
  const discoveries: ExpeditionDiscovery[] = [];
  for (let a = 0; a < attempts; a++) {
    if (pools.surface.length > 0 && rng.chance(surfacePermille, 1000)) {
      const poi = pickWeightedPoi(rng, pools.surface).poi;
      discoveries.push({ id: `${exp.id}-${body.id}-disc-${discoveries.length}`, kind: "landmark", poiId: poi.id });
    }
    if (pools.underground.length > 0 && rng.chance(undergroundPermille, 1000)) {
      const poi = pickWeightedPoi(rng, pools.underground).poi;
      discoveries.push({ id: `${exp.id}-${body.id}-disc-${discoveries.length}`, kind: "underground", poiId: poi.id });
    }
  }
  if (discoveries.length === 0) {
    // Guarantee at least one discovery: prefer a surface find, else fall to underground (every planet
    // type has at least one eligible PoI in each pool, so a candidate always exists).
    const useSurface = pools.surface.length > 0;
    const poi = pickWeightedPoi(rng, useSurface ? pools.surface : pools.underground).poi;
    discoveries.push({ id: `${exp.id}-${body.id}-disc-0`, kind: useSurface ? "landmark" : "underground", poiId: poi.id });
  }
  body.discoveries = discoveries;
  body.activities = discoveries.map((d, k) => ({
    id: `${exp.id}-${body.id}-act-${k}`,
    bodyId: body.id,
    poiId: d.poiId,
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

// Resolve ACTIVITIES up to `consumed` seconds into the phase: the E3 GAMBIT resolver (swapped in for the
// E2a placeholder). It completes one task per ACTIVITY_SECONDS in flat body/activity order, flipping `done`
// and appending the task's REAL finding (materials + credits + a relic chance) from the away-team gambit
// battle (gambit.ts resolveExpeditionActivity). The ExpeditionActivity record is UNCHANGED (still just
// id/bodyId/poiId/done): `done` stays the completion flag and findings are still appended to exp.findings,
// exactly the E2a contract. Idempotent (only touches !done activities); deterministic (each battle is keyed
// off exp.seed + a fixed salt + the activity's flat index, never a live stream position), so re-running at a
// larger `consumed` yields the identical findings and the done-latch prevents any double-award. `seen` is
// the activity's stable FLAT index across bodies, which is exactly the globalIndex the resolver seeds off.
function resolveActivitiesPhase(exp: Expedition, consumed: number): void {
  const total = totalActivities(exp);
  if (total === 0) return;
  const completedCount = Math.min(total, Math.floor((consumed + PHASE_EPS) / ACTIVITY_SECONDS));
  let seen = 0;
  for (const body of exp.bodies) {
    for (const act of body.activities) {
      if (seen < completedCount && !act.done) {
        act.done = true;
        exp.findings.push(resolveExpeditionActivity(exp, body, act, seen).finding);
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
  // E2c ANOMALY OPT-IN: only ATTEMPT the chart when the player opted in at dispatch. When opted out we
  // still latch anomalyResolved at the midpoint (so the check fires exactly once, keeping the phase math
  // stable) but never roll -> the detour is never added and no anomaly finding is granted. The gate is a
  // stored flag, not a live value, so this stays deterministic + offline==live parity-safe.
  if (!exp.anomalyOptIn) return;
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

// DEPOSIT a list of expedition findings into the state (E4a, the claim-deposit foundation). Pure: returns
// a NEW state (the input is never mutated), or the SAME reference when nothing in the findings carries a
// payload (e.g. an anomaly-only run). Per finding:
//   - MATERIALS go through addToInventory (tick.ts), the discovery-safe add seam: a positive amount marks
//     the item DISCOVERED and the stack is CLAMPED at itemCap (overflow discarded, the standard deposit
//     rule). ⚠️ NEVER raw addItemQuality: that bypasses discovery (the 0.13.8 invisible-exotic hotfix).
//     Deposited at quality 0 (the reward roll carries no material quality).
//   - CREDITS add to state.credits (Decimal).
//   - A RELIC token becomes a RelicVaultToken in state.relicVault, keeping its tier + quality + the
//     finding's PoI, ROUTED to its set by relics.ts relicSetForPoi (the single PoI -> set source). A token
//     whose PoI maps to no set is skipped (unreachable for a real roll: rollRelicToken only fires on a
//     relic-bearing PoI).
//   - EVACUATED partial findings deposit exactly like any other (their payload is already the reduced
//     "always win something" haul, and never carries a relic).
//   - ANOMALY findings carry no payload today, so they are no-ops.
// LIFETIME STATS: the haul folds through the shared foldLifetimeStatsDelta seam (the one extraction and
// patrol loot use): materials into itemsGathered (the gross amount, mirroring how mission loot counts) and
// credits into creditsEarned.
export function depositExpeditionFindings(state: GameState, findings: readonly ExpeditionFinding[]): GameState {
  let inventory = state.inventory;
  let discovered = state.discovered;
  let credits = state.credits;
  const vaultAdds: RelicVaultToken[] = [];
  const gathered: Record<string, Decimal> = {};
  let creditsGained = 0;
  let touched = false;

  for (const f of findings) {
    if (f.materials) {
      for (const [itemId, qty] of Object.entries(f.materials)) {
        if (!(qty > 0)) continue;
        const amount = new Decimal(qty);
        // itemCap reads state.facilities only (the warehouse levels), which a claim never changes, so
        // reading it off the incoming state is exact.
        const applied = addToInventory(inventory, discovered, itemId, amount, itemCap(state, itemId));
        inventory = applied.inventory;
        discovered = applied.discovered;
        gathered[itemId] = (gathered[itemId] ?? new Decimal(0)).plus(amount);
        touched = true;
      }
    }
    if (f.credits !== undefined && f.credits > 0) {
      credits = credits.plus(f.credits);
      creditsGained += f.credits;
      touched = true;
    }
    if (f.relic) {
      const setId = relicSetForPoi(f.poiId);
      if (setId !== null && f.poiId !== undefined) {
        vaultAdds.push({ id: f.relic.id, tier: f.relic.tier, quality: f.relic.quality, setId, poiId: f.poiId });
        touched = true;
      }
    }
  }
  if (!touched) return state;

  const lifetimeStats = foldLifetimeStatsDelta(state.lifetimeStats, {
    itemsGathered: gathered,
    missionsCompleted: {},
    creditsEarned: new Decimal(creditsGained),
    captainXpAwarded: new Decimal(0),
    fleetAdminXpAwarded: new Decimal(0),
  });
  return {
    ...state,
    inventory,
    discovered,
    credits,
    lifetimeStats,
    relicVault: vaultAdds.length > 0 ? [...(state.relicVault ?? []), ...vaultAdds] : state.relicVault,
  };
}

// A compact summary of what a list of findings carries (the REQUESTED amounts, before any warehouse
// clamp), for the claim log line. Pure DISPLAY reader: draws nothing, mutates nothing.
export interface ExpeditionFindingsSummary {
  materials: Record<string, number>; // itemId -> total quantity across the findings
  credits: number;
  relics: number; // relic tokens headed for the vault
  evacuated: number; // findings from an evacuated (lost) task
}

export function summarizeExpeditionFindings(findings: readonly ExpeditionFinding[]): ExpeditionFindingsSummary {
  const out: ExpeditionFindingsSummary = { materials: {}, credits: 0, relics: 0, evacuated: 0 };
  for (const f of findings) {
    if (f.materials) {
      for (const [itemId, qty] of Object.entries(f.materials)) {
        if (qty > 0) out.materials[itemId] = (out.materials[itemId] ?? 0) + qty;
      }
    }
    if (f.credits !== undefined && f.credits > 0) out.credits += f.credits;
    if (f.relic && relicSetForPoi(f.poiId) !== null) out.relics++;
    if (f.evacuated) out.evacuated++;
  }
  return out;
}

// Collect a COMPLETE expedition: remove it from the fleet, DEPOSIT its findings (E4a: materials,
// credits, and relic tokens into the vault, see depositExpeditionFindings), and hand the findings back
// for the caller's log. Pure: { next, success, reason?, findings? }. A CLAIM step (rather than
// auto-deposit on completion) is deliberate: a claim keeps the completed expedition visible until the
// player collects it. Fails (same-ref state) if not found or not complete.
export function claimExpedition(state: GameState, expeditionId: string): ExpeditionClaimResult {
  const exp = state.expeditions.find((e) => e.id === expeditionId);
  if (!exp) return { next: state, success: false, reason: "notFound" };
  if (exp.phase !== "complete") return { next: state, success: false, reason: "notComplete" };
  const removed: GameState = { ...state, expeditions: state.expeditions.filter((e) => e.id !== expeditionId) };
  return {
    next: depositExpeditionFindings(removed, exp.findings),
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

// The total number of ground-team activities across all bodies (0 until the SCANNING phase generates
// them at each body's 100%). Pure reader for the E2c UI's activity tally. (totalActivities is internal;
// this is its exported twin.)
export function expeditionActivitiesTotal(exp: Expedition): number {
  return totalActivities(exp);
}

// The CURRENT phase's progress fraction in [0, 1], derived from ELAPSED-in-phase / the phase duration at
// state.gameTimeSeconds. Pure DISPLAY reader (drives the transit/return bars + the scanning meter): it
// reads the stored phaseAnchorSeconds the tick maintains, never advancing anything. A "complete"
// expedition reads 1. A zero-length phase (e.g. no activities) reads 1 so the UI shows it filled/skipped.
export function expeditionPhaseFraction(exp: Expedition, nowSeconds: number): number {
  if (exp.phase === "complete") return 1;
  const dur = phaseDurationSeconds(exp);
  if (dur <= 0) return 1;
  const elapsed = Math.max(0, nowSeconds - exp.phaseAnchorSeconds);
  return Math.max(0, Math.min(1, elapsed / dur));
}

// Where the charted-anomaly MARKER sits on the transit bar, as a fraction in [0, 1], or null when the
// expedition opted OUT (no marker to show). The anomaly is checked at ANOMALY_CHECK_FRACTION of the BASE
// transit; once charted the bar total grows by the detour, so the marker's fractional position shifts
// left. Pure DISPLAY reader. Only meaningful during the transit phase (the UI reads it there).
export function expeditionAnomalyMarkerFraction(exp: Expedition): number | null {
  if (!exp.anomalyOptIn) return null;
  const total = transitDurationSeconds(exp);
  if (total <= 0) return null;
  return Math.max(0, Math.min(1, (baseTransitSeconds(exp) * ANOMALY_CHECK_FRACTION) / total));
}
