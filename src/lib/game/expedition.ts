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
  ExpeditionScanEvent,
  AwayRosterSnapshot,
  SnapshotMember,
} from "./model";
import { memberVariety } from "./model";
import { makeRng, type Rng } from "./combat/rng";
import { installedSensorArray, sensorArrayEffect, sensorArrayRelicFindBonus } from "./sensorArrays";
// E4d: the relic-unlocked Pathfinder Suite's expedition effect (a pure leaf over the installed pieces).
import { pathfinderEffect } from "./utilityGear";
import { equippedFor } from "./equipment";
import { effectiveShipStats, officerBonusTotal, shipCrewContribution } from "./crewOverlay";
import { CREW_STAT_KEYS } from "./crewBuffs";
import { fieldworkHazardResist, fieldworkSpeedMult } from "./fieldwork";
import { ACTIVITY_SECONDS } from "./groundTasks";
// E-CREW 0.14.0 (Task 21): the officer stat facets that reach a run (frozen at dispatch).
import { CUNNING_AMBUSH_SOFTEN, CUNNING_QUICK_RECOVERY, constitutionRamp, cunningProc, departmentFacet } from "./officerStats";
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
import {
  deriveAwayTeam,
  resolveExpeditionActivity,
  resolveScanEncounter,
  rollSupplyCache,
  scanDownedBefore,
  scanStepKey,
} from "./gambit";
// Ground Ops (GO-2): the D18 minimums live in groundTeams.ts (its deployable reader applies them per ground
// team); imported for the dispatch gate below and re-exported so existing callers keep their import.
// GO-7b: dispatch reads the slotted ground teams (deployableGroundTeams), no automatic stand-ins (user
// 2026-10-12); the named roster is the deployed teams' union snapshot (groundOps.ts).
import { MIN_SCIENCE_MEMBERS, MIN_SECURITY_MEMBERS, deployableGroundTeams, type GroundDeployCheck } from "./groundTeams";
export { MIN_SCIENCE_MEMBERS, MIN_SECURITY_MEMBERS };
// Ground Operations (GO-7b): the timeline engine of a flagged run (Expedition.groundOps). groundOps.ts never
// imports this module: the scan side reaches it through GROUND_OPS_SCAN_DRIVER below.
import {
  advanceGroundOpsWindow,
  cloneGroundOps,
  groundOpsBodyScanned,
  groundOpsProgress,
  newGroundOpsState,
  scanClockAt,
  scanClockToTime,
  snapshotAwayRosterForTeams,
  snapshotGroundOps,
  type GroundOpsScanDriver,
} from "./groundOps";
// E-CREW (Task 16): the claim turns the run's downed members into injuries (pure; imports model types,
// crewOverlay and crewBuffs only, never this module, so no cycle). GO-7b: a Ground Ops run brings home the
// members still in the medical bay instead (applyGroundOpsInjuries).
import { applyExpeditionInjuries, applyGroundOpsInjuries, type MemberInjury } from "./injuries";
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
// E-CREW Task 15: ACTIVITY_SECONDS is a BARE party's pace; the Science party's fieldwork speed divides it
// per body (activityDurationSeconds). Without a Science member every task still takes exactly this.
// Ground Operations (GO-4): the constant now LIVES in groundTasks.ts (the task model; it must not import this
// module) and is re-exported here unchanged, so every existing importer keeps working.
export { ACTIVITY_SECONDS };

// ============================================================================
// E-CREW 0.14.0 (Task 14): RANDOM ENCOUNTERS during scan progress (design D10, FIRST-PASS TUNABLE)
// ============================================================================
//
// STEP MATH. Each body's scan divides into ENCOUNTER_STEPS equal steps of scan WORK (so equal time: a body
// scans at one constant rate). The rolls fire at the INTERIOR step boundaries, boundary N (1..STEPS-1) at
// N / STEPS of the body's scan (10%, 20%, ... 90% at 10 steps): never at 0% (the team has not landed) or
// 100% (the body is done and its discoveries take over). Each boundary rolls exactly ONCE, latched by the
// expedition's scanStepCursor, from its own keyed stream makeRng(seed ^ ENCOUNTER_SALT ^ (bodyIndex * 100 +
// N)), so the outcome never depends on how the elapsed span was chunked.
//   draw 1: an ENCOUNTER, at scanEncounterChance (below). It runs one Security battle (gambit.ts
//           resolveScanEncounter). WIN: the enemy drops become a finding and the scan continues. LOSS: the
//           team withdraws to orbit (findings so far stay) and THIS body's scan PAUSES until the next
//           activity window. Win or lose, the battle's downed members are recorded on the scan event, and
//           (Task 16) they sit out every later battle of the run and come home injured at claim. A
//           boundary whose squad is entirely out rolls a 0 encounter chance (draw 1 is still taken).
//   draw 2: the supply-cache EVENT, at SUPPLY_CACHE_CHANCE. Always drawn (a fixed draw count per stream),
//           but it only counts when draw 1 fired no encounter: one thing per boundary.
//
// ACTIVITY WINDOW. The away team's ground operations run on the ACTIVITY_SECONDS cadence (the same 10-minute
// slot the activities phase gives each task). During scanning that cadence is a grid of windows every
// ACTIVITY_SECONDS of elapsed-in-scanning time, counted from the scanning phase's anchor. A team that
// withdraws at time t redeploys at the next window strictly after t (nextActivityWindow), so a loss pauses
// the scan for (0, ACTIVITY_SECONDS] seconds. The pause is recorded on the scan event (pauseSeconds) and
// the scanning phase lasts the bodies' scan time PLUS every recorded pause.
//
// ACTIVITIES ARE UNCHANGED. Encounters happen only in the SCANNING phase, on a body that has no
// discoveries yet; the PoI ground tasks (and their guardian battles, resolveActivitiesPhase) run in the
// ACTIVITIES phase afterwards, with their own keyed streams. The two never share a moment or a stream, so
// nothing double-battles: a body's roaming encounters and its PoI guardian fights are separate events.
// ENCOUNTER_STEPS must stay below 100: a boundary's stream key is gambit.ts scanStepKey (bodyIndex * 100 +
// step), so 100 or more steps would collide one body's boundaries with the next body's (a test asserts it).
export const ENCOUNTER_STEPS = 10;
export const ENCOUNTER_BASE_CHANCE = 0.08; // per boundary, on a hazard-0 body
export const ENCOUNTER_HAZARD_CHANCE = 0.2; // + this * the body's (resisted) hazard
export const ENCOUNTER_CHANCE_MAX = 0.9; // the chance never exceeds this, whatever the dial
export const SUPPLY_CACHE_CHANCE = 0.05; // the per-boundary supply-cache event (draw 2)

// D20 FIELD DEVICES (Shroud Emitter / Lure Beacon): anyone can use them, at REDUCED ability unless a
// category specialist is aboard. AWAITING THE USER: the untrained multiplier is the user's decision (the
// mockup proposes 0.75). Until they answer it is 1 (no penalty). Flipping it is this ONE number: every
// device bias is multiplied by fieldDeviceEffectiveness, which reads it (proven by a test).
export const FIELD_DEVICE_UNTRAINED_EFFECTIVENESS = 1;
// With a field-device specialist aboard the device works at full strength (the specialist's own 5%/6%
// category boost, D20, is a later design: see fieldDeviceSpecialistAboard).
export const FIELD_DEVICE_TRAINED_EFFECTIVENESS = 1;

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
// Exported (GO-4) so salts.test.ts can assert every engine salt is odd and distinct; read-only constants.
export const SYSTEM_SALT = 0x1b56c4f9;
export const ANOMALY_SALT = 0x7f4a7c15;
export const DISCOVERY_SALT = 0x2c1b3c6d;
export const ENCOUNTER_SALT = 0x3a8f05c5; // E-CREW Task 14: the per-boundary scan step roll

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

// Why startExpedition refuses a dispatch (the typed reason a failed ExpeditionDispatchResult carries).
//   noSuchShip:               the ship does not exist
//   captainNotAssigned:       the captain is not the one assigned to the ship
//   shipAlreadyOnExpedition:  the ship already has an expedition (one per ship)
//   noSuchCandidate:          the candidate is not on the ship's current console list
//   needsAwayTeam:            D18 (user, 2026-10-06): the ship lacks the MINIMUM AWAY TEAM, at least
//                             MIN_SECURITY_MEMBERS ready Security AND MIN_SCIENCE_MEMBERS ready Science members
//                             (see expeditionAwayTeamCheck). No roster, no expedition.
export type ExpeditionDispatchBlockReason =
  | "noSuchShip"
  | "captainNotAssigned"
  | "shipAlreadyOnExpedition"
  | "noSuchCandidate"
  | "needsAwayTeam";

export interface ExpeditionDispatchResult {
  next: GameState;
  success: boolean;
  reason?: ExpeditionDispatchBlockReason; // set only on failure
  expedition?: Expedition; // set only on success
}

// The player-facing line for a dispatch refusal (US English). EXHAUSTIVE with no default on purpose (the
// awayCrewBlockText pattern): a new reason is a compile error here until it has text. Pure.
export function expeditionDispatchBlockText(reason: ExpeditionDispatchBlockReason): string {
  switch (reason) {
    case "noSuchShip":
      return "That ship is no longer in the fleet";
    case "captainNotAssigned":
      return "Assign a captain to this ship first";
    case "shipAlreadyOnExpedition":
      return "This ship is already on an expedition";
    case "noSuchCandidate":
      return "Select a target system";
    case "needsAwayTeam":
      return "Needs a ground team with at least 1 Security and 1 Science member slotted and ready: set it up on the ship's Away Team tab";
  }
}

// D18 MINIMUM AWAY TEAM (user, 2026-10-06): "A ship with no roster should not be able to fight." An
// expedition launches only with at least this many DEPLOYABLE members in each squad. There is no anonymous
// stand-in team. Composition beyond the minimum is the player's choice (D17: no rails).
// MIN_SECURITY_MEMBERS / MIN_SCIENCE_MEMBERS (both 1) are defined in groundTeams.ts and re-exported above.
// Ground Ops (GO-7b): "deployable" now means the ship's SLOTTED ground teams (groundTeams.ts
// deployableGroundTeams: a team deploys only when every slotted member is ready and each squad meets D18; a
// ready reserve member never stands in, user 2026-10-12). The dispatch snapshot (groundOps.ts
// snapshotGroundOps) reads the same reader, so the gate and the snapshot can never disagree.

// Does `ship` field the minimum away team right now? Returns the deploying head counts and the full per-team
// readiness (`ground`: what each team waits on, groundTeams.ts groundTeamWaitText) so the dispatch UI can say
// what is missing. Pure.
export interface ExpeditionAwayTeamCheck {
  ok: boolean;
  security: number; // Security members across the deploying ground teams
  science: number; // Science members across the deploying ground teams
  ground: GroundDeployCheck;
}
export function expeditionAwayTeamCheck(state: GameState, ship: ShipInstance): ExpeditionAwayTeamCheck {
  const ground = deployableGroundTeams(state, ship.id);
  return { ok: ground.ok, security: ground.security, science: ground.science, ground };
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
    // neutral zero team + an empty (inert since D19) program pair keeps this throwaway well-typed without
    // affecting the roll.
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
// instead of the captain. Enforces at most ONE expedition per ship + the assigned-captain guard + (D18) the
// minimum away team (expeditionAwayTeamCheck), checked last so a bad ship/captain/candidate reports first. The
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
  // D18: no minimum away team (1 Security + 1 Science, ready), no expedition.
  if (!expeditionAwayTeamCheck(state, ship).ok) return { next: state, success: false, reason: "needsAwayTeam" };

  const number = state.nextExpeditionId;
  const seed = candidate.seed; // COMMIT the previewed candidate's seed so the launch matches its preview
  const id = `expedition-${number}`;
  const gen = generateSystem(seed);
  const snap = shipSensorSnapshot(state, ship);
  // E3a: snapshot the away team's crew-derived strength + team kit, so the expedition's ground battles
  // resolve as a pure function of the stored expedition (parity, matching the sensor snapshot). D19: the
  // members' programs ride the roster snapshot below, not the account-level pair.
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
  // D19: Expedition.gambitPrograms is INERT (no battle reads it; each member carries its own program in the
  // roster). Written empty so the stored shape stays loadable, and so no one mistakes it for a live input.
  const gambitPrograms = { security: [], science: [] };
  // E-CREW (Task 20): Fleet Triage (stronger in-battle healing + first-aid cures) and Morale Anchor (Fear
  // resist) for the away team, read off the seated officers at the same dispatch instant.
  const squadTriage = officerBonusTotal(state, ship, "officer.crewLossPrevention");
  const squadFearResist = officerBonusTotal(state, ship, "officer.crewRetention");
  const encounterEvasion = officerBonusTotal(state, ship, "officer.evasion");
  const crewRareFind = shipCrewContribution(state, ship)[CREW_STAT_KEYS.rareFindChance] ?? 0;
  // E-CREW (Task 21): the officer stat FACETS that reach this run, frozen here like the bonuses above and
  // written only when they do something (absent = none, so an all-10 bridge stores the pre-Task-21 record).
  //   Cunning (this run is ONE mission: rolled once, keyed on the run's seed and the seat, private streams):
  //     Security softens the run's ambushes; Medical brings the injured home with a quicker recovery.
  //   Constitution: Medical's share of the turnaround (injury care); the long-haul ramps of the two buffs
  //     this run carries, the Science crew's rare find (relic roll) and Evasive Command (encounter chance),
  //     stored only when that buff is non-zero.
  const ambushSoften = cunningProc(seed, "tactical", departmentFacet(state, ship, "security", "cunning")) ? CUNNING_AMBUSH_SOFTEN : 0;
  const quickRecovery = cunningProc(seed, "medical", departmentFacet(state, ship, "medical", "cunning")) ? CUNNING_QUICK_RECOVERY : 0;
  const recoveryTurnaround = departmentFacet(state, ship, "medical", "constitution");
  const rampScience = crewRareFind > 0 ? departmentFacet(state, ship, "science", "constitution") : 0;
  const rampFlightDeck = encounterEvasion > 0 ? departmentFacet(state, ship, "flightDeck", "constitution") : 0;
  // E-CREW (Task 21 review calls, the per-seat rows), frozen here too and written only when non-zero:
  //   Flight Deck Constitution: a faster return the longer the run; Science Integrity: less hazard scan slow;
  //   Medical Integrity: a shorter recovery for the members who come home injured.
  const rampReturn = departmentFacet(state, ship, "flightDeck", "constitution");
  const hazardSteady = departmentFacet(state, ship, "science", "integrity");
  const injurySteady = departmentFacet(state, ship, "medical", "integrity");
  // E-CREW (Task 12) + Ground Ops (GO-7b): the deploying ground teams with their frozen bay / offload / reload
  // factors (GO-7a), and the named ROSTER = those teams' union snapshot (converted gear, traits, implants,
  // programs), at the same dispatch instant. D18: the gate above guarantees a deploying team with both
  // squads, so every expedition launched from here on carries a roster. (An OLD in-flight expedition may still
  // lack one; the legacy battle resolver handles that safely, see gambit.ts resolveExpeditionActivity.) One
  // team slotted in hire order snapshots exactly what the pre-GO-7b snapshotAwayRoster did.
  const groundSnapshot = snapshotGroundOps(state, ship, { recoveryTurnaround, quickRecovery, injurySteady });
  const roster = snapshotAwayRosterForTeams(state, ship, groundSnapshot.teams);

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
    roster,
    // E-CREW (Task 14): random encounters during scanning. The step count and Evasive Command are frozen
    // here (the same "the launch is what you saw at dispatch" contract), so retuning ENCOUNTER_STEPS or
    // reseating the pilot never reshapes an in-flight run.
    encounterSteps: ENCOUNTER_STEPS,
    encounterEvasion,
    // E-CREW (Task 15): the crew rare find for the relic roll, frozen here like encounterEvasion. ONE read
    // of the crew rollup, which already folds Discovery Instinct (officer.rareFindMult -> crew.rareFindChance)
    // with the Science division's Keen Analysis; adding officerBonusTotal on top would count the officer twice.
    crewRareFind,
    scanStepCursor: 0,
    scanEvents: [],
    // E-CREW (Task 20): the away team's two officer bonuses, frozen here like encounterEvasion and written
    // ONLY when non-zero, so a run without the officer stores exactly the pre-Task-20 record.
    ...(squadTriage > 0 ? { squadTriage } : {}),
    ...(squadFearResist > 0 ? { squadFearResist } : {}),
    // E-CREW (Task 21): the officer stat facets (see above), each only when non-zero.
    ...(ambushSoften > 0 ? { ambushSoften } : {}),
    ...(quickRecovery > 0 ? { quickRecovery } : {}),
    ...(recoveryTurnaround > 0 ? { recoveryTurnaround } : {}),
    ...(rampScience > 0 ? { rampScience } : {}),
    ...(rampFlightDeck > 0 ? { rampFlightDeck } : {}),
    ...(rampReturn > 0 ? { rampReturn } : {}),
    ...(hazardSteady > 0 ? { hazardSteady } : {}),
    ...(injurySteady > 0 ? { injurySteady } : {}),
    // Ground Operations (GO-7b): the flag. This run resolves on the Ground Ops timeline (groundOps.ts).
    groundOps: newGroundOpsState(groundSnapshot),
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
//
// E-CREW Task 15: the Science party's hazard resist on THIS body (Hazard Suit, Environmental Adaptation,
// Steady, a tuned tool's hazard line on its bodies; fieldwork.ts fieldworkHazardResist) ADDS to the stored
// museum + gear resist before the cut (resistedHazard bounds the sum). It shapes the scan slowdown only:
// encounter odds and battle guards keep the stored resist (Science never fights). 0 without a party, so
// the sum is the stored value bit-for-bit.
// E-CREW (Task 21 review calls): the Science department's Integrity (exp.hazardSteady, frozen at dispatch) adds
// to the resist too, so a HAZARDOUS world slows the scan less (a calm one has no slow to cut). 0 = unchanged.
export function scanRatePerSecond(exp: Expedition, body: ExpeditionBody): number {
  const sensorBoost = 1 + Math.max(0, exp.sensorPower) * SCAN_SENSOR_COEFF;
  const partyResist = fieldworkHazardResist(exp, body.planetType) + (exp.hazardSteady ?? 0);
  const resist = partyResist > 0 ? (exp.hazardResist ?? 0) + partyResist : exp.hazardResist ?? 0;
  const hazardSlow = 1 + Math.max(0, resistedHazard(body.hazard, resist)) * SCAN_HAZARD_PENALTY;
  const museumScan = 1 + (exp.scanSpeedBonus ?? 0);
  return (SCAN_BASE_RATE * exp.scanParams.scanRateMult * exp.scanParams.coverageWidth * sensorBoost * museumScan) / hazardSlow;
}

// Total time to scan the WHOLE system (all bodies, sequentially). The SCANNING phase's duration. E-CREW
// Task 14: an encounter-enabled run adds every recorded loss pause (encounterScanDurationSeconds).
function scanningDurationSeconds(exp: Expedition): number {
  if (hasScanEncounters(exp)) return encounterScanDurationSeconds(exp);
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

// E-CREW Task 15: how long ONE ground task on `body` takes: ACTIVITY_SECONDS divided by the Science party's
// fieldwork speed on that body (fieldwork.ts fieldworkSpeedMult; the PoI does not change the pace),
// rounded to whole seconds. Exactly ACTIVITY_SECONDS without a Science member. Pure (reads the stored run).
export function activityDurationSeconds(exp: Expedition, body: ExpeditionBody): number {
  const speed = fieldworkSpeedMult(exp, body.planetType);
  // D23: the pace has no cap, so floor a task at 1 second (never a zero-length task).
  return speed === 1 ? ACTIVITY_SECONDS : Math.max(1, Math.round(ACTIVITY_SECONDS / speed));
}

// The ACTIVITIES phase duration: every task's duration, in flat body/activity order (one task per
// ACTIVITY_SECONDS for a run without a Science party).
function activitiesDurationSeconds(exp: Expedition): number {
  let total = 0;
  for (const body of exp.bodies) total += body.activities.length * activityDurationSeconds(exp, body);
  return total;
}

// E-CREW (Task 21 review calls, Flight Deck CONSTITUTION): the RETURN leg, divided by (1 + the ramp on the
// hours since dispatch when it starts: the transit, the scan and the tasks, all fixed by then). Exactly the base
// transit without exp.rampReturn. Pure.
export function returnDurationSeconds(exp: Expedition): number {
  const base = baseTransitSeconds(exp);
  if (!exp.rampReturn) return base;
  // Ground Ops (GO-7b): a flagged run's scan and tasks share one window (flaggedWindowSeconds).
  const outbound = exp.groundOps ? flaggedWindowSeconds(exp) : scanningDurationSeconds(exp) + activitiesDurationSeconds(exp);
  const hours = (transitDurationSeconds(exp) + outbound) / 3600;
  const ramp = constitutionRamp(exp.rampReturn, hours);
  return ramp === 0 ? base : base / (1 + ramp);
}

// The current phase's total duration in seconds (0 for "complete", which the loop never asks about).
function phaseDurationSeconds(exp: Expedition): number {
  switch (exp.phase) {
    case "transit":
      return transitDurationSeconds(exp);
    case "scanning":
      // Ground Ops (GO-7b): a flagged run's scan ends at its clock's end mapped through the recovery legs.
      return exp.groundOps ? flaggedScanEndAt(exp) - exp.phaseAnchorSeconds : scanningDurationSeconds(exp);
    case "activities":
      // Ground Ops (GO-7b): unknown until the window closes (the phase does not end before endedAt).
      if (exp.groundOps) return exp.groundOps.endedAt === undefined ? Infinity : Math.max(0, exp.groundOps.endedAt - exp.phaseAnchorSeconds);
      return activitiesDurationSeconds(exp);
    case "return":
      return returnDurationSeconds(exp);
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
    // Same form as the phase-end check (x + PHASE_EPS vs the duration), so a rounding sliver at the end of
    // the phase still completes the body.
    if (remaining + PHASE_EPS >= bodyTime) {
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

// ============================================================================
// E-CREW 0.14.0 (Task 14): scan-step encounters (see the constants block at the top for the rules)
// ============================================================================

// Does this run roll random encounters while scanning? Only one dispatched since Task 14 (it froze
// encounterSteps); an older run scans exactly as before. Pure.
function hasScanEncounters(exp: Expedition): boolean {
  return (exp.encounterSteps ?? 0) >= 1;
}

// D20 hook: is a FIELD-DEVICE category specialist aboard (a member whose skills improve the efficacy of
// field devices)? No such trait or skill exists yet (the category-efficacy specialists come with the D20
// kit design), so it is false and every device runs at the untrained effectiveness. Pure.
export function fieldDeviceSpecialistAboard(_roster: AwayRosterSnapshot | undefined): boolean {
  return false;
}

// The multiplier on every field device's encounter bias for this roster. Pure.
export function fieldDeviceEffectiveness(roster: AwayRosterSnapshot | undefined): number {
  return fieldDeviceSpecialistAboard(roster) ? FIELD_DEVICE_TRAINED_EFFECTIVENESS : FIELD_DEVICE_UNTRAINED_EFFECTIVENESS;
}

// The Security squad's summed encounter dial: every worn piece's variety encounterBias (Shroud Emitter
// -0.4, Lure Beacon +0.4; every other piece 0), times the field-device effectiveness. Pure.
export function squadEncounterBias(security: readonly SnapshotMember[], effectiveness: number): number {
  let bias = 0;
  for (const m of security) {
    for (const g of m.gear) bias += memberVariety(g.slotType, g.varietyKey)?.member.encounterBias ?? 0;
  }
  return bias * effectiveness;
}

// The plan's chance formula: (base + hazard * coeff) * (1 + device bias) * (1 - Evasive Command share),
// clamped to [0, ENCOUNTER_CHANCE_MAX]. The evasion share is clamped to [0, 1] first. Pure.
export function encounterChance(hazard: number, deviceBias: number, evasion: number): number {
  const base = ENCOUNTER_BASE_CHANCE + Math.max(0, hazard) * ENCOUNTER_HAZARD_CHANCE;
  const evade = Math.max(0, Math.min(1, evasion));
  const chance = base * (1 + deviceBias) * (1 - evade);
  return Math.max(0, Math.min(ENCOUNTER_CHANCE_MAX, chance));
}

// The per-boundary encounter chance on `body` for this run: the body's hazard as the run presents it
// (museum hazardResist applied, as for its battles), the snapshotted Security squad's device dial, and the
// snapshotted Evasive Command. 0 with no Security member (no team, no fight: only a pre-D18 run). Pure.
// E-CREW (Task 16): `sittingOut` (gambit.ts scanDownedBefore, the members downed at earlier boundaries)
// leaves those members out of the squad: their worn devices stop counting, and with the whole squad out
// the chance is 0 (nobody is on the ground to be found). scanStepRoll passes it; absent = the full squad.
// E-CREW (Task 21): `hoursOut` (the boundary's hours since dispatch) drives the Flight Deck's Constitution
// ramp on Evasive Command (exp.rampFlightDeck): the frozen evasion grows by constitutionRamp(ramp, hours).
// Absent / 0 = the frozen evasion as is.
export function scanEncounterChance(exp: Expedition, body: ExpeditionBody, sittingOut?: ReadonlySet<string>, hoursOut: number = 0): number {
  const deployed = exp.roster?.security ?? [];
  const security = sittingOut && sittingOut.size > 0 ? deployed.filter((m) => !sittingOut.has(m.memberId)) : deployed;
  if (security.length === 0) return 0;
  return encounterChance(
    resistedHazard(body.hazard, exp.hazardResist ?? 0),
    squadEncounterBias(security, fieldDeviceEffectiveness(exp.roster)),
    rampedEncounterEvasion(exp, hoursOut),
  );
}

// The run's Evasive Command at `hoursOut` hours since dispatch: the frozen encounterEvasion, grown by the
// Flight Deck's Constitution ramp (E-CREW Task 21). Exactly the frozen value without a ramp. Pure.
export function rampedEncounterEvasion(exp: Expedition, hoursOut: number): number {
  const evasion = exp.encounterEvasion ?? 0;
  const ramp = constitutionRamp(exp.rampFlightDeck ?? 0, hoursOut);
  return ramp === 0 ? evasion : evasion * (1 + ramp);
}

// E-CREW (Task 21): hours since dispatch at `secondsIntoScan` seconds into the scanning phase (the transit,
// detour included, is fully flown by then). Pure.
export function expeditionHoursAtScan(exp: Expedition, secondsIntoScan: number): number {
  return (transitDurationSeconds(exp) + secondsIntoScan) / 3600;
}

// The step roll at `body` boundary `step`: draw 1 decides an encounter, draw 2 a supply cache (counted
// only when no encounter fired). Its own keyed stream per boundary. Pure.
// E-CREW (Task 21): `hoursOut` is the boundary's hours since dispatch (the Constitution ramp's clock), passed
// by the scan walk from the boundary's stored time. Default 0 = no ramp.
export function scanStepRoll(exp: Expedition, bodyIndex: number, step: number, hoursOut: number = 0): { encounter: boolean; supplyCache: boolean } {
  const rng = makeRng((exp.seed ^ ENCOUNTER_SALT ^ scanStepKey(bodyIndex, step)) >>> 0);
  const body = exp.bodies[bodyIndex];
  // Draw 1 is ALWAYS taken (chance 0 for a missing body), so draw 2 sits at the same stream position.
  // E-CREW (Task 16): members downed at an earlier boundary are out of the squad (scanDownedBefore reads
  // only the boundaries before this one, so the roll is the same whenever it is evaluated).
  // Ground Ops (GO-7b, user 9b.6): a FLAGGED run rolls no scan-time ground battle (nobody is on the ground
  // while the ship scans; GO-8's ship-side events take this draw). The draw is still taken at chance 0, so the
  // supply cache (draw 2) reads the same stream position as on a legacy run.
  const chance = body && !exp.groundOps ? clampPermille(scanEncounterChance(exp, body, scanDownedBefore(exp, bodyIndex, step), hoursOut)) : 0;
  const encounter = rng.chance(chance, 1000);
  const cache = rng.chance(clampPermille(SUPPLY_CACHE_CHANCE), 1000);
  return { encounter, supplyCache: !encounter && cache };
}

// The next activity window strictly after `elapsedInScan` seconds into the scanning phase (see the
// constants block). Pure.
export function nextActivityWindow(elapsedInScan: number): number {
  return (Math.floor(elapsedInScan / ACTIVITY_SECONDS) + 1) * ACTIVITY_SECONDS;
}

// The recorded loss pause at `body` boundary `step`, 0 when none. Pure.
function pauseAt(events: readonly ExpeditionScanEvent[], bodyIndex: number, step: number): number {
  for (const ev of events) {
    if (ev.bodyIndex === bodyIndex && ev.step === step) return ev.pauseSeconds ?? 0;
  }
  return 0;
}

// The scanning phase's length for an encounter-enabled run: every body's scan time plus its recorded
// pauses, summed in EXACTLY the order resolveEncounterScanningPhase walks them (so the phase-end check and
// the last body's completion agree to the bit). Only RESOLVED boundaries can carry a pause, and every
// unresolved boundary lies later than any elapsed value the phase has reached, so this is exact wherever it
// is read. Pure.
function encounterScanDurationSeconds(exp: Expedition): number {
  const steps = exp.encounterSteps ?? 1;
  const events = exp.scanEvents ?? [];
  let bodyStart = 0;
  for (let i = 0; i < exp.bodies.length; i++) {
    const body = exp.bodies[i];
    let paused = 0;
    for (let k = 1; k < steps; k++) paused += pauseAt(events, i, k);
    bodyStart = bodyStart + body.scanTotal / scanRatePerSecond(exp, body) + paused;
  }
  return bodyStart;
}

// Roll ONE step boundary (the caller latches it via the cursor) and record what happened. `at` is the
// boundary's elapsed-in-scanning time (for the loss pause). Mutates the working clone only.
function rollStepBoundary(exp: Expedition, events: ExpeditionScanEvent[], body: ExpeditionBody, bodyIndex: number, step: number, at: number): void {
  // E-CREW (Task 21): the boundary's hours since dispatch, from its stored time (only a ramped run reads it).
  const roll = scanStepRoll(exp, bodyIndex, step, exp.rampFlightDeck ? expeditionHoursAtScan(exp, at) : 0);
  if (roll.encounter) {
    const res = resolveScanEncounter(exp, body, bodyIndex, step);
    const ev: ExpeditionScanEvent = { bodyIndex, step, kind: "encounter", outcome: res.outcome, downedMemberIds: res.downedMemberIds };
    if (res.finding) {
      exp.findings.push(res.finding);
      ev.findingId = res.finding.id;
    }
    if (res.outcome === "loss") ev.pauseSeconds = nextActivityWindow(at) - at;
    events.push(ev);
  } else if (roll.supplyCache) {
    const finding = rollSupplyCache(exp, body, bodyIndex, step);
    exp.findings.push(finding);
    events.push({ bodyIndex, step, kind: "supplyCache", findingId: finding.id });
  }
}

// Resolve SCANNING for an encounter-enabled run up to `elapsed` seconds into the phase. The timeline is a
// walk over the stored run: body by body, boundary by boundary, each boundary's time = the body's start +
// N step times + the pauses already recorded on earlier boundaries of this body. A boundary not yet rolled
// (at or past the cursor) rolls the moment elapsed reaches it, in scan order; a recorded loss pause holds
// the body's progress at that boundary until the pause ends. Every time is computed from stored values only
// (never from `elapsed`), so one big advance and many small ones roll the same boundaries at the same
// times with the same results (offline == live). Idempotent: rolled boundaries never roll again, and the
// `scanned` latch assigns a body's discoveries once.
function resolveEncounterScanningPhase(exp: Expedition, elapsed: number): void {
  const steps = exp.encounterSteps ?? 1;
  const perBody = Math.max(0, steps - 1);
  const events = exp.scanEvents ?? [];
  // E-CREW (Task 16): the step roll and the encounter read who is already out from exp.scanEvents, so the
  // working list must BE that array while boundaries roll (commit below re-stores it either way).
  exp.scanEvents = events;
  let cursor = exp.scanStepCursor ?? 0;
  const commit = (): void => {
    exp.scanStepCursor = cursor;
    exp.scanEvents = events;
  };
  let bodyStart = 0;
  for (let i = 0; i < exp.bodies.length; i++) {
    const body = exp.bodies[i];
    const rate = scanRatePerSecond(exp, body);
    const bodyTime = body.scanTotal / rate;
    const stepTime = bodyTime / steps;
    let paused = 0;
    for (let k = 1; k <= perBody; k++) {
      const at = bodyStart + k * stepTime + paused;
      const flat = i * perBody + (k - 1);
      if (flat >= cursor) {
        if (elapsed + PHASE_EPS < at) {
          body.scanProgress = Math.min(body.scanTotal, Math.max(0, elapsed - bodyStart - paused) * rate);
          commit();
          return;
        }
        rollStepBoundary(exp, events, body, i, k, at);
        cursor = flat + 1;
      }
      const pause = pauseAt(events, i, k);
      if (pause > 0) {
        if (elapsed + PHASE_EPS < at + pause) {
          // The team is back in orbit: the scan holds at this boundary until the next activity window.
          body.scanProgress = Math.min(body.scanTotal, k * stepTime * rate);
          commit();
          return;
        }
        paused += pause;
      }
    }
    const bodyEnd = bodyStart + bodyTime + paused;
    // The EXACT negation of advanceExpedition's phase-end check (elapsed + PHASE_EPS < dur), and the last
    // bodyEnd equals encounterScanDurationSeconds bit for bit, so the phase can never end with its last body
    // unscanned in a rounding sliver.
    if (elapsed + PHASE_EPS >= bodyEnd) {
      body.scanProgress = body.scanTotal;
      if (!body.scanned) {
        body.scanned = true;
        assignDiscoveriesAndActivities(exp, body, i);
      }
      bodyStart = bodyEnd;
    } else {
      body.scanProgress = Math.min(body.scanTotal, Math.max(0, elapsed - bodyStart - paused) * rate);
      commit();
      return; // later bodies are not started yet (they stay at scanProgress 0)
    }
  }
  commit();
}

// ============================================================================
// Ground Operations (GO-7b): the SCAN side of a flagged run's combined operations window
// ============================================================================
//
// A flagged run (Expedition.groundOps) scans on the SAME boundary walk as an encounter-enabled legacy run
// (resolveEncounterScanningPhase: body by body, boundary by boundary, recorded pauses on the clock), but the
// walk runs on the SCAN CLOCK (groundOps.ts scanClockToTime / scanClockAt: seconds since the window opened
// minus every recovery leg), and it is advanced ONE EVENT AT A TIME by groundOps.ts advanceGroundOpsWindow,
// interleaved in time order with the ground teams' step ends. So a team's wipe that sends the ship on a
// recovery leg shifts every LATER scan event, and nothing earlier. A completed body hands its new tasks to the
// teams (groundOps.ts groundOpsBodyScanned) at that body's completion time.

type FlaggedScanEvent =
  | { kind: "boundary"; clock: number; bodyIndex: number; step: number; flat: number }
  | { kind: "body"; clock: number; bodyIndex: number };

// The next scan event of a flagged run on the scan clock: the first boundary not yet rolled (at or past the
// cursor), or the completion of the first body not yet scanned, whichever the walk reaches first. Every time
// is computed from stored values exactly as resolveEncounterScanningPhase computes it. Pure.
function flaggedScanNext(exp: Expedition): FlaggedScanEvent | null {
  const steps = exp.encounterSteps ?? 1;
  const perBody = Math.max(0, steps - 1);
  const events = exp.scanEvents ?? [];
  const cursor = exp.scanStepCursor ?? 0;
  let bodyStart = 0;
  for (let i = 0; i < exp.bodies.length; i++) {
    const body = exp.bodies[i];
    const bodyTime = body.scanTotal / scanRatePerSecond(exp, body);
    const stepTime = bodyTime / steps;
    let paused = 0;
    for (let k = 1; k <= perBody; k++) {
      const at = bodyStart + k * stepTime + paused;
      const flat = i * perBody + (k - 1);
      if (flat >= cursor) return { kind: "boundary", clock: at, bodyIndex: i, step: k, flat };
      paused += pauseAt(events, i, k);
    }
    const bodyEnd = bodyStart + bodyTime + paused;
    if (!body.scanned) return { kind: "body", clock: bodyEnd, bodyIndex: i };
    bodyStart = bodyEnd;
  }
  return null;
}

// Hours since dispatch at absolute time `t` of a flagged run's window (the transit is fully flown). Pure.
function flaggedHoursAt(exp: Expedition, t: number): number {
  const start = exp.groundOps?.startedAt ?? t;
  return (transitDurationSeconds(exp) + (t - start)) / 3600;
}

// The scan side handed to groundOps.ts advanceGroundOpsWindow. processScanEvent rolls the boundary (a flagged
// run's encounter chance is 0: scanStepRoll) or completes the body (discoveries, then the ground tasks).
const GROUND_OPS_SCAN_DRIVER: GroundOpsScanDriver = {
  nextScanEventAt(exp) {
    const ops = exp.groundOps;
    const ev = flaggedScanNext(exp);
    return ev && ops ? scanClockToTime(ops, ev.clock) : null;
  },
  processScanEvent(exp) {
    const ops = exp.groundOps;
    const ev = flaggedScanNext(exp);
    if (!ops || !ev) return;
    const body = exp.bodies[ev.bodyIndex];
    if (ev.kind === "boundary") {
      const events = exp.scanEvents ?? [];
      exp.scanEvents = events; // the step roll reads exp.scanEvents (Task 16), so the working list must BE it
      rollStepBoundary(exp, events, body, ev.bodyIndex, ev.step, ev.clock);
      exp.scanStepCursor = ev.flat + 1;
      return;
    }
    body.scanProgress = body.scanTotal;
    body.scanned = true;
    assignDiscoveriesAndActivities(exp, body, ev.bodyIndex);
    groundOpsBodyScanned(exp, ev.bodyIndex, scanClockToTime(ops, ev.clock));
  },
  hoursAt: flaggedHoursAt,
};

// The scan's display progress at `now` on a flagged run: the body being scanned shows the scan clock's
// progress, held at a boundary through a recorded pause (the resolveEncounterScanningPhase rule); scanned
// bodies are full and later bodies untouched (0). Display only: the window owns every latch. Mutates the clone.
function setFlaggedScanProgress(exp: Expedition, now: number): void {
  const ops = exp.groundOps;
  if (!ops || ops.startedAt === undefined) return;
  const clock = scanClockAt(ops, now);
  const steps = exp.encounterSteps ?? 1;
  const perBody = Math.max(0, steps - 1);
  const events = exp.scanEvents ?? [];
  let bodyStart = 0;
  for (let i = 0; i < exp.bodies.length; i++) {
    const body = exp.bodies[i];
    const rate = scanRatePerSecond(exp, body);
    const bodyTime = body.scanTotal / rate;
    const stepTime = bodyTime / steps;
    let paused = 0;
    for (let k = 1; k <= perBody; k++) {
      if (!body.scanned) {
        const at = bodyStart + k * stepTime + paused;
        if (clock + PHASE_EPS < at) break;
        const pause = pauseAt(events, i, k);
        if (pause > 0 && clock + PHASE_EPS < at + pause) {
          body.scanProgress = Math.min(body.scanTotal, k * stepTime * rate);
          return;
        }
      }
      paused += pauseAt(events, i, k);
    }
    if (!body.scanned) {
      body.scanProgress = Math.min(body.scanTotal, Math.max(0, clock - bodyStart - paused) * rate);
      return;
    }
    bodyStart = bodyStart + bodyTime + paused;
  }
}

// When a flagged run's scan ends (absolute time): the whole scan on the clock (every body plus its recorded
// pauses, encounterScanDurationSeconds) mapped through the recovery legs. Exact once every body is scanned. Pure.
function flaggedScanEndAt(exp: Expedition): number {
  const ops = exp.groundOps;
  const clock = encounterScanDurationSeconds(exp);
  return ops && ops.startedAt !== undefined ? scanClockToTime(ops, clock) : exp.phaseAnchorSeconds + clock;
}

// The seconds a flagged run's operations window lasts: endedAt - startedAt once it has closed, else the scan
// alone (an estimate, for the readers that ask before the end). Pure.
function flaggedWindowSeconds(exp: Expedition): number {
  const ops = exp.groundOps;
  if (ops && ops.startedAt !== undefined && ops.endedAt !== undefined) return ops.endedAt - ops.startedAt;
  return encounterScanDurationSeconds(exp);
}

// Resolve ACTIVITIES up to `consumed` seconds into the phase: the E3 GAMBIT resolver (swapped in for the
// E2a placeholder). It completes tasks in flat body/activity order, each taking its body's
// activityDurationSeconds (ACTIVITY_SECONDS without a Science party; see below), flipping `done`
// and appending the task's REAL finding (materials + credits + a relic chance) from the away-team gambit
// battle (gambit.ts resolveExpeditionActivity). The ExpeditionActivity record is UNCHANGED (still just
// id/bodyId/poiId/done): `done` stays the completion flag and findings are still appended to exp.findings,
// exactly the E2a contract. Idempotent (only touches !done activities); deterministic (each battle is keyed
// off exp.seed + a fixed salt + the activity's flat index, never a live stream position), so re-running at a
// larger `consumed` yields the identical findings and the done-latch prevents any double-award. `seen` is
// the activity's stable FLAT index across bodies, which is exactly the globalIndex the resolver seeds off.
//
// E-CREW Task 15: tasks run back to back, each taking its body's activityDurationSeconds, so a task is
// complete once `consumed` reaches the running sum of the durations up to and including it. The sums are
// whole seconds, so without a Science party (every task ACTIVITY_SECONDS) this is exactly the old
// floor(consumed / ACTIVITY_SECONDS) count.
function resolveActivitiesPhase(exp: Expedition, consumed: number): void {
  const total = totalActivities(exp);
  if (total === 0) return;
  let seen = 0;
  let endsAt = 0;
  for (const body of exp.bodies) {
    const duration = activityDurationSeconds(exp, body);
    for (const act of body.activities) {
      endsAt += duration;
      if (endsAt <= consumed + PHASE_EPS && !act.done) {
        act.done = true;
        // E-CREW (Task 21): a Science-ramped run reads the task's start in hours since dispatch (transit +
        // the finished scan + the tasks before it, all stored), the clock of its relic roll's ramp.
        const hoursOut = exp.rampScience
          ? (transitDurationSeconds(exp) + scanningDurationSeconds(exp) + endsAt - duration) / 3600
          : 0;
        const res = resolveExpeditionActivity(exp, body, act, seen, undefined, hoursOut);
        exp.findings.push(res.finding);
        // E-CREW (Task 16): record who went down, so they sit out every later task and come home injured.
        // Tasks complete in flat order, so every lower index is already recorded when this one resolves.
        if (res.downedMemberIds.length > 0) act.downedMemberIds = res.downedMemberIds;
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
      activities: b.activities.map(cloneActivity),
    })),
    findings: exp.findings.map((f) => ({ ...f })),
    // E-CREW (Task 14): the scan events (absent on a pre-Task-14 run stays absent).
    ...(exp.scanEvents
      ? { scanEvents: exp.scanEvents.map((ev) => (ev.downedMemberIds ? { ...ev, downedMemberIds: [...ev.downedMemberIds] } : { ...ev })) }
      : {}),
    // Ground Operations (GO-7b): the run's operations record (absent on a legacy run stays absent).
    ...(exp.groundOps ? { groundOps: cloneGroundOps(exp.groundOps) } : {}),
  };
}

// One activity, its arrays copied (a legacy record has only downedMemberIds; a Ground Ops task also carries its
// fight points, owner teams and segment bankers). Keys keep their order, so a legacy clone serializes exactly
// as before.
function cloneActivity(a: ExpeditionActivity): ExpeditionActivity {
  const c = { ...a };
  if (a.downedMemberIds) c.downedMemberIds = [...a.downedMemberIds];
  if (a.fightPoints) c.fightPoints = [...a.fightPoints];
  if (a.assignedTeamIds) c.assignedTeamIds = [...a.assignedTeamIds];
  if (a.segmentBankers) c.segmentBankers = a.segmentBankers.map((ids) => [...ids]);
  return c;
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
    // Ground Operations (GO-7b): a flagged run's scanning and activities phases are ONE operations window
    // (groundOps.ts advanceGroundOpsWindow, see the scan-side block above). The window opens at the scanning
    // anchor; the scanning phase ends once every body is scanned (its exact end time, recovery legs included),
    // the activities phase once the window has closed (endedAt). Both ends are latches the window sets, so the
    // phase math never disagrees with the event schedule.
    if (e.groundOps && (e.phase === "scanning" || e.phase === "activities")) {
      const ops = e.groundOps;
      if (e.phase === "scanning" && ops.startedAt === undefined) ops.startedAt = e.phaseAnchorSeconds;
      advanceGroundOpsWindow(e, nowSeconds, GROUND_OPS_SCAN_DRIVER);
      setFlaggedScanProgress(e, nowSeconds);
      if (e.phase === "scanning") {
        if (!e.bodies.every((b) => b.scanned)) break;
        e.phaseAnchorSeconds += flaggedScanEndAt(e) - e.phaseAnchorSeconds;
      } else {
        if (ops.endedAt === undefined) break;
        e.phaseAnchorSeconds += Math.max(0, ops.endedAt - e.phaseAnchorSeconds);
      }
      e.phase = PHASE_NEXT[e.phase];
      continue;
    }
    // E-CREW (Task 14): an encounter-enabled scan resolves BEFORE its duration is read, because a loss
    // pause rolled on the way lengthens the phase (see encounterScanDurationSeconds for why this is exact).
    const encounterScan = e.phase === "scanning" && hasScanEncounters(e);
    if (encounterScan) resolveEncounterScanningPhase(e, elapsed);
    const dur = phaseDurationSeconds(e);
    const consumed = Math.min(elapsed, dur);
    if (e.phase === "scanning") {
      if (!encounterScan) resolveScanningPhase(e, consumed);
    } else if (e.phase === "activities") {
      resolveActivitiesPhase(e, consumed);
    }
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
  // E-CREW (Task 16): the members who came home injured (every member downed during the run who is still
  // on the roster), with their recovery. Set only on success; [] when nobody went down.
  injuries?: MemberInjury[];
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
// E-CREW (Task 16): the claim also brings the away team home. Every member downed during the run comes
// home INJURED (injuries.ts applyExpeditionInjuries: recovery timed by the ship's Medical share and Rapid
// Recovery at this moment), so they miss the next dispatch until they recover.
export function claimExpedition(state: GameState, expeditionId: string): ExpeditionClaimResult {
  const exp = state.expeditions.find((e) => e.id === expeditionId);
  if (!exp) return { next: state, success: false, reason: "notFound" };
  if (exp.phase !== "complete") return { next: state, success: false, reason: "notComplete" };
  const removed: GameState = { ...state, expeditions: state.expeditions.filter((e) => e.id !== expeditionId) };
  const deposited = depositExpeditionFindings(removed, exp.findings);
  // Ground Ops (GO-7b): a flagged run brings home the members still in the medical bay with the time they have
  // left (never the flat 2h); a legacy run keeps Task 16's injuries.
  const { next, injuries } = exp.groundOps ? applyGroundOpsInjuries(deposited, exp) : applyExpeditionInjuries(deposited, exp);
  return {
    next,
    success: true,
    findings: exp.findings,
    injuries,
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
  // Ground Ops (GO-7b): the activities phase has no known length until it ends; its bar is the tasks' progress.
  if (exp.groundOps && exp.phase === "activities") return groundOpsProgress(exp, nowSeconds);
  // GO-7b review: a flagged scan reads its SCAN CLOCK over the whole scan, so a recovery leg (which lengthens the
  // phase in wall time) holds the bar instead of pulling it backward.
  if (exp.groundOps && exp.phase === "scanning" && exp.groundOps.startedAt !== undefined) {
    const total = encounterScanDurationSeconds(exp);
    return total > 0 ? Math.max(0, Math.min(1, scanClockAt(exp.groundOps, nowSeconds) / total)) : 1;
  }
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
