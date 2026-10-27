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
  PromotionObjectiveKind,
} from "./model";
import { SHIP_TYPES, commandingCaptain, memberVariety, moduleEffectScale, shipGearSetBonusLines } from "./model";
// E-MOD EM-6: the body-scanned module trigger (its frozen procs and private stream).
import { moduleNebulaSweep, moduleScanProcs, moduleScanSeed, rollModuleChance } from "./shipModules";
import { makeRng, type Rng } from "./combat/rng";
import { installedSensorArray, sensorArrayCanisterBandLift, sensorArrayEffect, sensorArrayRelicFindBonus } from "./sensorArrays";
// E4d: the relic-unlocked Pathfinder Suite's expedition effect (a pure leaf over the installed pieces).
import { pathfinderEffect } from "./utilityGear";
import { equippedFor } from "./equipment";
import { viewPieceEfficiency, wornGearView } from "./gearWear";
import { gearWearLive } from "./gearWearEngine";
import { effectiveShipStats, foldOfficerPromotionCounters, officerBonusTotal, shipCrewContribution, shipSurveyAptitude } from "./crewOverlay";
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
// Ground Ops (GO-2): the D18 minimums live in groundTeams.ts (its deployable reader applies them across the
// deploying ground teams since Squads SQ-2); imported for the dispatch gate below and re-exported so existing callers keep their import.
// GO-7b: dispatch reads the slotted ground teams (deployableGroundTeams), no automatic stand-ins (user
// 2026-10-12); the named roster is the deployed teams' union snapshot (groundOps.ts).
import { MIN_SCIENCE_MEMBERS, MIN_SECURITY_MEMBERS, deployableGroundTeams, type GroundDeployCheck } from "./groundTeams";
export { MIN_SCIENCE_MEMBERS, MIN_SECURITY_MEMBERS };
// Ground Operations (GO-7b): the timeline engine of a flagged run (Expedition.groundOps). groundOps.ts never
// imports this module: the scan side reaches it through GROUND_OPS_SCAN_DRIVER below.
import {
  advanceGroundOpsWindow,
  applyGroundOpsEdit,
  closeGroundOps,
  openResumedGroundOps,
  checkGroundOpsEdit,
  cloneGroundOps,
  crewSquadsOf,
  groundCrewClearOdds,
  groundCrewThreat,
  groundOpsBodyScanned,
  initGroundTasks,
  fieldRepairBlock,
  maybeAutoFieldRepair,
  scheduleFieldRepair,
  taskNeedsOf,
  type FieldRepairBlockReason,
  groundOpsProgress,
  newGroundOpsState,
  scanClockAt,
  scanClockToTime,
  snapshotAwayRosterForTeams,
  snapshotGroundOps,
  type GroundOpsEdit,
  type GroundOpsEditCheck,
  type GroundOpsScanDriver,
} from "./groundOps";
// Field Kits FKR-1: the enemy ranks catalog version a new run is stamped with (enemyRanks.ts is pure, no cycle).
import { ENEMY_RANKS_VERSION, isTrainingRun } from "./enemyRanks";
import { RELIC_BLANKS_VERSION } from "./relicBlanks";
// Field Kits FKR-7: the runs switch, the flag, and the dispatch / claim plumbing (fieldKitsRun.ts never imports this).
import { FIELD_KITS_RUNS_LIVE, fieldKitsLive } from "./fieldKits";
import { fieldKitsStamp, planDispatchPacks, returnCarriedExtras, settleDispatchPacks, withDispatchPacks } from "./fieldKitsRun";
// E-CREW (Task 16): the claim turns the run's downed members into injuries (pure; imports model types,
// crewOverlay and crewBuffs only, never this module, so no cycle). GO-7b: a Ground Ops run brings home the
// members still in the medical bay instead (applyGroundOpsInjuries).
import { applyExpeditionInjuries, applyGroundOpsInjuries, type MemberInjury } from "./injuries";
// Ground Ops GO-8 (user 9b.6): the ship-side scan events of a flagged run (shipScanEvents.ts never imports this
// module), their bonus-discovery stream, and the light hull damage brought home at claim (user Q12).
import { applyShipEventDamage, ghostFindSeed, resolveShipScanEvent, shipEventsLive, takeBoardingLoss } from "./shipScanEvents";
// Squads SQ-4: the risk profile drawn at dispatch, flora's Bloom lift and the hostile-site gate.
import {
  DIFFICULTY_NAMES,
  FLORA_BLOOM_WEIGHT_MULT,
  difficultyWeight,
  bodyFloraGrade,
  TIER_I_REGION,
  generateRiskProfile,
  hostileSiteFieldable,
  isClearingSiteId,
  isHostileSiteId,
  type ExpeditionRegion,
} from "./riskFactors";
import type { BodyRiskGrades, ExpeditionRecall, ExpeditionRegionStamp, ExpeditionRiskProfile, ExpeditionVoyage, GroundTaskNeeds, GroundTeamKind, HeldSystem, RegionTier } from "./model";
// Expedition Tiers G2-3: the voyage engine (pure; imports model and galaxy types only, so no cycle).
import { planVoyage, voyageOf } from "./voyage";
// Expedition Tiers G2-4: the drive class, the reach gate and frontier sensors.
import { expeditionTierGates, reachCheck, shipDriveClass, type ExpeditionGateDetail } from "./propulsion";
// Squads SQ-5: the Subspace Telescope's reading of each candidate (display only; a run never reads it).
import { TELESCOPE_DETAIL, blindLaunchCount, readSystem, stateHomeworld, systemDistanceLy, telescopeLevel, telescopeReading, type HomeworldPlacement } from "./telescope";
// Expedition Tiers G2-2: the region ladder, the enemy sectors and the star catalog (pure; neither imports this module).
import { BEARING_TURN, REGION_TIERS, inEnemySector } from "./galaxy";
import { WOLF_359_ID, CATALOG_NUMBER_MAX, catalogSystemName, famousSystem, famousSystemFrom, famousSystemsOfTier, type FamousSystem } from "./starCatalog";
// WR-5c: the commanding captain's explorer secondary nodes (pure; imports only model.ts).
import { NO_CAPTAIN_SIGHT, captainSurveyScanParams, captainTelescopeSight, explorerCaptainRun } from "./captainExplorerEffects";
// Squads SQ-6: the task preview's readers, the launch recommendation and the forecast (display only), and the one
// engine action they offer (applyComposition, SQ-7's "Set composition").
import {
  compositionChanges,
  gateLaunchView,
  previewForHull,
  recommendLaunch,
  taskDemand,
  type CandidateTelescopeReading,
  type LaunchView,
  type ForecastHardestTask,
  type LaunchForecast,
  type PreviewTask,
  type SystemTaskPreview,
} from "./launchRecommendation";
import { compositionLabel, compositionSquads, shipTeamKinds, validCompositions } from "./groundComposition";
import { applyComposition } from "./groundTeams";
import { groundSiteLabel } from "./expeditionContent";
// E4a: the PoI -> relic-set single source of truth (pure data) for the foreknowledge signature + the
// claim deposit's set routing.
import { RELIC_SETS, relicSetForPoi, museumBonuses, resistedHazard } from "./relics";
import type { RelicSetId, RelicVaultToken, SurveyLogEntry } from "./model";
// E4a: the CLAIM DEPOSIT routes materials through the discovery-safe add seam (addToInventory, clamped at
// itemCap) and folds the haul into lifetimeStats through the shared fold. These are imported from tick.ts,
// which itself imports resolveExpeditions from this module: an ESM cycle that is SAFE because neither
// module touches the other's bindings at module-evaluation time (only inside function bodies, called
// long after both modules have finished loading). ⚠️ Keep it that way: never call a tick.ts export at the
// top level of this file.
import { addToInventory, itemCap, foldLifetimeStatsDelta } from "./tick";
import Decimal from "break_infinity.js";
import { formatCountdown } from "./format";
// Safe first runs SF-1: the run counters a claim updates (runDifficulty.ts imports model.ts only, so no cycle).
import { countClaimedExpedition, runCountsOf, runDifficultyAt } from "./runDifficulty";
// Gas Giant Study GG-2: the study stamp, the orbital bodies and their giant profiles (gasGiantStudy.ts never imports
// this module).
import { gearPermilleStamp, isStudyBody, nebulaStampFor, studyStampFor, sweepsNebula, withGiantProfiles } from "./gasGiantStudy";
// Gas Giant Study GG-5: the Research Lab's held data queue (dataStudy.ts imports neither this file nor tick.ts).
import { dataArrivals } from "./dataStudy";

// ============================================================================
// FIRST-PASS TUNABLE constants
// ============================================================================

// TRANSIT. Expedition Tiers G2-3: every run dispatched from G2-3 on flies its VOYAGE (voyage.ts: the tier's nominal
// hours, the band position, the drive class, each leg at the ship's own speed on it), frozen on the run. The fixed
// legs below are what a run dispatched BEFORE G2-3 (no `voyage`) keeps flying, byte-identically:
// design I.2's ~6 HOURS IRL (1 tick == 1 second at the default cadence, so 6 hrs == 21600 ticks), both ways.
export const TRANSIT_SECONDS = 21600; // ~6 hours IRL at the 1s cadence: pre-G2-3 runs only
// The RETIRED inaugural SHAKEDOWN (the per-account first expedition, 30 minutes). Safe first runs SF-2 (user, group 3)
// retired it as a special length: only a run in flight at the update (Expedition.shakedown stored true) still flies it.
export const SHAKEDOWN_TRANSIT_SECONDS = 1800; // ~30 min IRL: the retired inaugural shakedown (in-flight runs only)
// Safe first runs SF-2: the TRAINING RUN's nominal transit lives with the voyage (voyage.ts TUTORIAL_TRANSIT_SECONDS,
// equal to the Tier I nominal). A training run dispatched before G2-3 flew TRANSIT_SECONDS (the constant was equal to
// it then) and keeps it.
export { TUTORIAL_TRANSIT_SECONDS } from "./voyage";

// The RETURN leg mirrors the outbound BASE transit (design C.0: recall re-runs that same transit
// home). It does NOT re-add the anomaly detour time (charting happened on the way out). A voyage run's return leg
// is its own (`voyage.returnSeconds`, at the ship's return-leg speed: CP-2 OC-E5).
// (returnDuration reads baseReturnSeconds below.)

// ANOMALY: a mid-transit seeded chance to CHART AN ANOMALY -> adds time + a small placeholder bonus.
// The roll fires once, at the transit MIDPOINT (a "window boundary"); it is decided by a seed +
// salt, so evaluating it lazily at the midpoint is identical to any other resolution ordering.
export const ANOMALY_CHECK_FRACTION = 0.5; // roll at the halfway point of the BASE transit
// Charting adds ~1 hour IRL to a pre-G2-3 run's transit leg; a voyage run's detour is `voyage.anomalySeconds`
// (voyage.ts VOYAGE_ANOMALY_DETOUR_PERMILLE of its outbound leg).
export const ANOMALY_EXTRA_SECONDS = 3600;
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
// (a display-derived projection of generateBodies(seed, tier) + the same discovery roll) can never lie.
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

// The banked sci-fi system names (design Part E). RETIRED by Expedition Tiers G2-2 (user G9, 2026-10-16: "Retire
// them"): new candidates take star catalog names (starCatalog.ts); a run dispatched before G2-2 keeps its stored
// banked name. The list stays because the system stream's FIRST draw (the old pick) is kept with its value unused,
// on this same bound, so every later draw of that stream (body count, planet types, sizes) lands as before.
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
// Expedition Tiers G2-2: the candidate's own streams, each keyed by the candidate's seed alone (one draw layout per
// stream, so none shifts another): its catalog number, its bearing from the homeworld, the famous-system roll and the
// deeper tiers' body count.
export const SYSTEM_NAME_SALT = 0x5d3f8a2b;
export const CANDIDATE_BEARING_SALT = 0x6e2c47d9;
export const FAMOUS_SYSTEM_SALT = 0x19b7e563;
export const BODY_COUNT_SALT = 0x2a64f1e7;

// ============================================================================
// Expedition Tiers G2-2: candidates per region tier (user #5 and G11 "Region, then 3 nearest")
// ============================================================================
//
// The console offers EXPEDITION_CANDIDATE_COUNT candidates PER TIER, shown nearest first. Candidate `slot` of tier `t`
// takes seed makeExpeditionSeed(expeditionSeed, (t - 1) * CANDIDATE_STRIDE + slot), so Tier I's three are exactly
// the pre-G2 three (their bodies, risk and objectives byte-identical). Ids read `cand-<tier>-<slot>`; a pre-G2 id
// `cand-<slot>` names the Tier I slot. [PROPOSAL] the stride (room for more candidates per tier later).
export const CANDIDATE_STRIDE = 16;
// [PROPOSAL] a candidate slot is a FAMOUS system (starCatalog.ts, its tier's list) one time in this many.
export const FAMOUS_SYSTEM_ONE_IN = 12;
// User G10 (2026-10-16, "Guaranteed early"): Wolf 359 is guaranteed in the first Tier I list after the first run,
// i.e. the list a save holds after this many dispatches (nextExpeditionId - 1); it takes Tier I slot 0. A VETERAN
// save (user 2026-10-19, "Next list for veterans") already past that list gets it in its NEXT Tier I list, once
// (GameState.wolf359List, written by startExpedition: wolf359ListAfterDispatch).
export const WOLF_359_LIST_AFTER_DISPATCHES = 1;
// User G17 (2026-10-16, "Grows with tier"): each tier's body count range. Tier I keeps the system stream's own
// 1 to 3 draw; deeper tiers draw their count on BODY_COUNT_SALT (the mockup's ranges).
export const TIER_BODY_COUNT: Readonly<Record<RegionTier, readonly [number, number]>> = {
  1: [BODY_COUNT_MIN, BODY_COUNT_MAX],
  2: [1, 3],
  3: [2, 3],
  4: [2, 4],
  5: [2, 4],
  6: [3, 5],
  7: [3, 5],
};

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
//   shipDamaged:              Ground Ops GO-8 review (user, 2026-10-14: "Must be repaired first", the patrol rule):
//                             the ship is damaged or under Shipyard repair (expeditionShipDamaged). The detail line
//                             with the repair's countdown is expeditionShipRepairText.
//   notExplorer / driveClassUnavailable / driveClassTooLow / frontierSensors / outOfReach:
//                             Expedition Tiers G2-4 (propulsion.ts): the hull is not an explorer (user 2026-10-16: no
//                             non-explorer hull reaches any expedition system), the region's drive class cannot be
//                             built yet or the ship's is too low, its sensors are below the region's frontier
//                             threshold, or the system's round trip is beyond the ship's reach. The refusal carries
//                             the numbers (ExpeditionDispatchResult.gate; propulsion.ts expeditionGateText).
export type ExpeditionDispatchBlockReason =
  | "noSuchShip"
  | "captainNotAssigned"
  | "shipAlreadyOnExpedition"
  | "shipDamaged"
  | "notExplorer"
  | "noSuchCandidate"
  | "driveClassUnavailable"
  | "driveClassTooLow"
  | "frontierSensors"
  | "outOfReach"
  | "needsAwayTeam";

export interface ExpeditionDispatchResult {
  next: GameState;
  success: boolean;
  reason?: ExpeditionDispatchBlockReason; // set only on failure
  gate?: ExpeditionGateDetail; // G2-4: set only on a propulsion refusal (the numbers its text names)
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
    case "shipDamaged":
      return "Ship is damaged, repair it first"; // the patrol gate's wording (App.svelte needsRepair)
    case "noSuchCandidate":
      return "Select a target system";
    case "needsAwayTeam":
      return "Needs a ground team with at least 1 Security and 1 Science member slotted and ready: set it up on the ship's Away Team tab";
    // G2-4: the short forms; the refusal's `gate` gives the full line with its numbers (propulsion.ts expeditionGateText).
    case "notExplorer":
      return "This hull cannot reach any expedition system. Expeditions need an explorer hull.";
    case "driveClassUnavailable":
      return "Needs a higher drive class. None can be built yet.";
    case "driveClassTooLow":
      return "Needs a higher drive class for this region";
    case "frontierSensors":
      return "Needs stronger sensors to chart this region";
    case "outOfReach":
      return "Beyond this ship's reach";
  }
}

// Ground Ops GO-8 review (user, 2026-10-14: "Must be repaired first", the same rule as patrols): a ship that is
// DAMAGED (ShipInstance.damaged, e.g. a lost patrol or an expedition's light hull damage brought home) or has a
// Shipyard repair running cannot launch an expedition until the repair is done. Pure.
export function expeditionShipDamaged(state: GameState, ship: ShipInstance): boolean {
  return ship.damaged === true || shipRepairProcess(state, ship.id) !== undefined;
}

// The ship's running Shipyard repair (tick.ts processShipRepairs), if any. Pure.
function shipRepairProcess(state: GameState, shipId: string): GameState["activeProcesses"][number] | undefined {
  return state.activeProcesses.find((p) => p.kind === "shipRepair" && p.effect.type === "clearShipDamage" && p.effect.shipId === shipId);
}

// The dispatch console's detail line for a damaged ship: "Repairing: ready in 4m" from the repair process's own
// remaining time, or, damaged with no bay yet, "Damaged: waiting for a free Shipyard repair bay". Null for a ship
// that can launch. Pure.
export function expeditionShipRepairText(state: GameState, ship: ShipInstance): string | null {
  const repair = shipRepairProcess(state, ship.id);
  if (repair) return `Repairing: ready in ${formatCountdown(repair.remainingTicks * state.tickDurationSeconds)}`;
  return ship.damaged === true ? "Damaged: waiting for a free Shipyard repair bay" : null;
}

// D18 MINIMUM AWAY TEAM (user, 2026-10-06): "A ship with no roster should not be able to fight." An
// expedition launches only with at least this many DEPLOYABLE members in each squad. There is no anonymous
// stand-in team. Composition beyond the minimum is the player's choice (D17: no rails).
// MIN_SECURITY_MEMBERS / MIN_SCIENCE_MEMBERS (both 1) are defined in groundTeams.ts and re-exported above.
// Ground Ops (GO-7b): "deployable" now means the ship's SLOTTED ground teams (groundTeams.ts
// deployableGroundTeams: a team deploys only when every slotted member is ready and each of its squads has a
// member slotted (Squads SQ-2), D18 holds across the deploying teams; a ready reserve member never stands
// in, user 2026-10-12). The dispatch snapshot (groundOps.ts
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

// The body count of a system of `tier` (TIER_BODY_COUNT): Tier I reads the system stream's own draw (`drawn`);
// deeper tiers draw theirs on BODY_COUNT_SALT. Pure.
function tierBodyCount(seed: number, tier: RegionTier, drawn: number): number {
  if (tier === 1) return drawn;
  const [min, max] = TIER_BODY_COUNT[tier] ?? TIER_BODY_COUNT[1];
  return makeRng((seed ^ BODY_COUNT_SALT) >>> 0).nextRange(min, max);
}

// Generate the target system's bodies from the expedition seed and its region tier. Deterministic. The
// body-generation stream is SEPARATE from each body's own discovery stream (see assignDiscoveries), so
// generation order never perturbs discovery outcomes. G2-2: the stream's FIRST draw (the retired banked-name pick)
// is kept with its value unused, and so is the 1 to 3 count draw on a deeper tier, so a Tier I system draws exactly
// as before; the name comes from the candidate (tierCandidateSystems).
function generateBodies(seed: number, tier: RegionTier): ExpeditionBody[] {
  const rng = makeRng((seed ^ SYSTEM_SALT) >>> 0);
  rng.nextInt(BANKED_SYSTEMS.length); // the retired banked-name pick: draw kept, value unused
  const bodyCount = tierBodyCount(seed, tier, rng.nextRange(BODY_COUNT_MIN, BODY_COUNT_MAX));
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
  return bodies;
}

// ===== Expedition Tiers G2-2: the candidate systems of a tier =====

// One candidate system's identity: where it is and what it is called, ship-independent. `distanceLy` and `bearing`
// are measured from the save's homeworld; `region` is what the risk roll and the run read.
export interface CandidateSystem {
  id: string; // "cand-<tier>-<slot>"
  tier: RegionTier;
  slot: number;
  seed: number;
  systemId: string;
  systemName: string;
  famousId: string | null; // a starCatalog.ts famous system, or null (a catalog-named one)
  bearing: number; // whole tenths of a degree from the homeworld (galaxy.ts bearingDirection)
  distanceLy: number; // whole light-years from the homeworld, inside the tier's band
  region: ExpeditionRegion;
}

// The seed of candidate `slot` of `tier` (Tier I's slot i is the pre-G2 candidate i). Pure.
export function candidateSlotSeed(expeditionSeed: number, tier: RegionTier, slot: number): number {
  return makeExpeditionSeed(expeditionSeed, (tier - 1) * CANDIDATE_STRIDE + slot);
}

// The famous system a slot rolls (FAMOUS_SYSTEM_ONE_IN; then which of its tier's), or null. Both draws are always
// taken, one stream per candidate seed. Pure.
function rolledFamousSystem(seed: number, tier: RegionTier): FamousSystem | null {
  const rng = makeRng((seed ^ FAMOUS_SYSTEM_SALT) >>> 0);
  const hit = rng.nextInt(FAMOUS_SYSTEM_ONE_IN) === 0;
  const list = famousSystemsOfTier(tier);
  const pick = rng.nextInt(Math.max(1, list.length));
  return hit ? list[pick] ?? null : null;
}

// How many expeditions the save has dispatched (the Wolf 359 guarantee's clock). Pure.
function dispatchedExpeditions(state: Pick<GameState, "nextExpeditionId">): number {
  const n = state.nextExpeditionId;
  return typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.floor(n) - 1) : 0;
}

// Does the save's current Tier I list carry Wolf 359 on slot 0 by guarantee: the list after the first run (every
// save), or a veteran's scheduled list (GameState.wolf359List). Pure.
function wolf359Guaranteed(state: Pick<GameState, "nextExpeditionId" | "wolf359List">): boolean {
  const n = dispatchedExpeditions(state);
  return n === WOLF_359_LIST_AFTER_DISPATCHES || (typeof state.wolf359List === "number" && state.wolf359List === n);
}

// User 2026-10-19 ("Next list for veterans"): the GameState.wolf359List a dispatch writes, or undefined (no key).
// Only a VETERAN save (it flew expeditions before 0.14.0) that has no stamp yet gets one: the count of the list it
// dispatches from when that list holds Wolf 359 (guaranteed or rolled: it has now seen it), else the next count (the
// next freshly generated Tier I list holds it on slot 0). The list on screen is never rerolled. Pure.
export function wolf359ListAfterDispatch(state: GameState): number | undefined {
  if (typeof state.wolf359List === "number") return undefined;
  if (!runCountsOf(state).expedition.veteran) return undefined;
  const n = dispatchedExpeditions(state);
  const seen = tierCandidateSystems(state, 1).some((c) => c.famousId === WOLF_359_ID);
  return seen ? n : n + 1;
}

// The candidate systems the console offers for `tier`, in SLOT order (the console shows them nearest first:
// expeditionDispatchDisplay.ts nearestFirst, so a list index never shifts under a test or a sim). Each slot is a famous system
// (Wolf 359 on Tier I slot 0 in the first list after the first run, user G10, or a veteran's scheduled list; else the
// rolled one, never twice in
// one list) at its real distance and bearing from the homeworld (clamped into the band, as a near star can sit
// closer to a homeworld than the band's nearest-star edge), or a catalog-named system at its drawn distance
// (telescope.ts systemDistanceLy) and drawn bearing. Enemy territory: its bearing inside the tier's fixed sector
// (galaxy.ts inEnemySector; Tier I has none). Stable until a dispatch advances expeditionSeed. Pure.
export function tierCandidateSystems(
  state: Pick<GameState, "expeditionSeed" | "nextExpeditionId" | "homeworld" | "wolf359List">,
  tier: RegionTier,
  homeworld: HomeworldPlacement = stateHomeworld(state),
): CandidateSystem[] {
  const wolfSlot = tier === 1 && wolf359Guaranteed(state) ? 0 : -1;
  const used = new Set<string>(wolfSlot >= 0 ? [WOLF_359_ID] : []);
  const band = homeworld.regionBandsLy[tier] ?? homeworld.regionBandsLy[1];
  const out: CandidateSystem[] = [];
  for (let slot = 0; slot < EXPEDITION_CANDIDATE_COUNT; slot++) {
    const seed = candidateSlotSeed(state.expeditionSeed, tier, slot);
    let famous = slot === wolfSlot ? famousSystem(WOLF_359_ID) ?? null : rolledFamousSystem(seed, tier);
    if (famous && slot !== wolfSlot) {
      if (used.has(famous.id)) famous = null;
      else used.add(famous.id);
    }
    let named: { systemId: string; systemName: string };
    let bearing: number;
    let distanceLy: number;
    if (famous) {
      const seen = famousSystemFrom(famous, homeworld);
      named = { systemId: famous.id, systemName: famous.name };
      bearing = seen.bearing;
      distanceLy = Math.max(Math.min(band.near + 1, band.far), Math.min(band.far, seen.distanceLy));
    } else {
      named = catalogSystemName(tier, makeRng((seed ^ SYSTEM_NAME_SALT) >>> 0).nextRange(1, CATALOG_NUMBER_MAX));
      bearing = makeRng((seed ^ CANDIDATE_BEARING_SALT) >>> 0).nextInt(BEARING_TURN);
      distanceLy = systemDistanceLy(seed, tier, homeworld);
    }
    out.push({
      id: `cand-${tier}-${slot}`,
      tier,
      slot,
      seed,
      ...named,
      famousId: famous?.id ?? null,
      bearing,
      distanceLy,
      region: { tier, enemyTerritory: inEnemySector(homeworld, tier, bearing) },
    });
  }
  return out;
}

// The candidate system `candidateId` names on the current console (any tier; a pre-G2 `cand-<slot>` id names the
// Tier I slot), or null. Pure.
export function candidateSystemById(state: Pick<GameState, "expeditionSeed" | "nextExpeditionId" | "homeworld" | "wolf359List">, candidateId: string): CandidateSystem | null {
  const m = /^cand-(?:([1-7])-)?(0|[1-9]\d*)$/.exec(candidateId);
  if (!m) return null;
  const tier = (m[1] === undefined ? 1 : Number(m[1])) as RegionTier;
  const slot = Number(m[2]);
  if (!REGION_TIERS.includes(tier) || slot >= EXPEDITION_CANDIDATE_COUNT) return null;
  return tierCandidateSystems(state, tier).find((c) => c.slot === slot) ?? null;
}

// The region stamp a dispatch to `cand` freezes on its run (Expedition.region). Pure; a fresh object.
function regionStampOf(cand: CandidateSystem): ExpeditionRegionStamp {
  return { version: 1, tier: cand.tier, enemyTerritory: cand.region.enemyTerritory, bearing: cand.bearing, distanceLy: cand.distanceLy };
}

// Expedition Tiers G2-3: the voyage a dispatch of `ship` to `cand` freezes (voyage.ts planVoyage): the candidate's
// tier and distance inside its tier's band from the homeworld, the ship's drive class (G2-4: propulsion.ts
// shipDriveClass, the hull's base class plus its installed drive's, the same ftlDriveClass the power draw reads) and its
// stat sheet (each leg at its own speed); `training` = the training run (its own nominal). Exported for the console's
// transit row (G2-6) so it shows exactly what a launch would fly. Pure: a fresh object.
export function candidateVoyage(
  state: GameState,
  ship: ShipInstance,
  cand: Pick<CandidateSystem, "tier" | "distanceLy">,
  training: boolean,
  homeworld: HomeworldPlacement = stateHomeworld(state),
  // GEAR WEAR step 3: the voyage a launch FLIES reads the worn-gear view (a worn drive flies slower); every GATE reads
  // the pristine voyage (design 4.3: no gate reads a worn value), so candidateReach passes false.
  worn: boolean = true,
): ExpeditionVoyage {
  return planVoyage({
    tier: cand.tier,
    distanceLy: cand.distanceLy,
    band: homeworld.regionBandsLy[cand.tier] ?? homeworld.regionBandsLy[1],
    driveClass: shipDriveClass(state, ship),
    stats: effectiveShipStats(worn ? wornGearView(state) : state, ship),
    training,
  });
}

// Expedition Tiers G2-4: the reach check of a dispatch of `ship` to `cand` (propulsion.ts reachCheck): the round trip
// to it (2 x its distance from the homeworld) against the ship's deep-space reach on the voyage it would fly there (its
// ordinary voyage: the training run flies the same Tier I nominal today, voyage.ts TUTORIAL_TRANSIT_SECONDS). The
// console's reach row (G2-6) reads exactly what the gate reads. Pure.
export function candidateReach(
  state: GameState,
  ship: ShipInstance,
  cand: Pick<CandidateSystem, "tier" | "distanceLy">,
  homeworld: HomeworldPlacement = stateHomeworld(state),
): { roundTripLy: number; reachLy: number; met: boolean } {
  // GEAR WEAR step 3: the pristine voyage (a gate never reads a worn value, design 4.3).
  const voyage = candidateVoyage(state, ship, cand, false, homeworld, false);
  return reachCheck(state, ship, cand.distanceLy, voyage.outboundSeconds + voyage.returnSeconds);
}

// Expedition Tiers G2-4: the first propulsion gate `ship` fails for `cand` (the tier's gates, propulsion.ts
// expeditionTierGates: explorer hull, drive class, frontier sensors; then this system's reach), or null when it may
// launch there. A blind launch (beyond the telescope) is never refused here (SQ-7). Pure.
export function expeditionSystemGate(
  state: GameState,
  ship: ShipInstance,
  cand: Pick<CandidateSystem, "tier" | "distanceLy">,
  homeworld: HomeworldPlacement = stateHomeworld(state),
): ExpeditionGateDetail | null {
  const gates = expeditionTierGates(state, ship, cand.tier);
  if (gates.first) return gates.first;
  const reach = candidateReach(state, ship, cand, homeworld);
  if (reach.met) return null;
  const { tier, driveClass, driveClassNeeded, sensors, sensorsNeeded } = gates;
  return { reason: "outOfReach", tier, driveClass, driveClassNeeded, sensors, sensorsNeeded, roundTripLy: reach.roundTripLy, reachLy: reach.reachLy };
}

// Expedition Tiers G2-4 (D18 "Launch can never offer a dispatch the engine would refuse"): the propulsion refusal
// startExpedition would give `ship` for `candidateId`, in its order (a non-explorer hull first, whatever the
// candidate; then the candidate's tier gates and reach, a held system's included), or null when the propulsion gates
// pass. An unknown candidate reads null (startExpedition refuses it as noSuchCandidate). The console disables Launch
// on it and shows propulsion.ts expeditionGateText. Pure.
export function expeditionDispatchGate(state: GameState, ship: ShipInstance, candidateId: string | null): ExpeditionGateDetail | null {
  if (SHIP_TYPES[ship.typeKey]?.spec !== "explorer") return expeditionTierGates(state, ship, 1).first;
  if (candidateId === null) return null;
  const held = heldSystemById(state, candidateId);
  const cand = held ? heldCandidateSystem(held) : candidateSystemById(state, candidateId);
  return cand ? expeditionSystemGate(state, ship, cand) : null;
}

// A throwaway system for a preview at `seed` in `region` (the forecast's simulated launch; no candidate name is
// needed there). Pure.
function previewSystem(seed: number, region: ExpeditionRegion): { systemId: string; systemName: string; bodies: ExpeditionBody[] } {
  return { systemId: "preview", systemName: "", bodies: generateBodies(seed, region.tier) };
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
  // GEAR WEAR step 3: the snapshot reads the worn-gear view (gearWear.ts), so the launch and every preview built from
  // this snapshot read a worn array or sensor line the same way.
  const gearView = wornGearView(state);
  const installed = installedSensorArray(gearView, ship);
  // WR-5c: the commanding captain's survey nodes (Cartographer, Anomaly Sense, Deep Scan) ride the scan params, so
  // the dispatch freezes them and every preview built from this snapshot reads them. {} without them.
  const captainSurvey = captainSurveyScanParams(commandingCaptain(state, ship));
  return {
    sensorArrayId: installed?.def.id ?? null,
    scanParams: { ...(installed ? sensorArrayEffect(installed) : NEUTRAL_SCAN_PARAMS), ...captainSurvey },
    // effectiveShipStats folds equipment + crew (crewOverlay), so a Science officer / Science division /
    // a fitted sensor item all shape this by construction. 0 for a bare hull today.
    sensorPower: effectiveShipStats(gearView, ship).sensors,
  };
}

// E4d: the ship's INSTALLED-GEAR expedition bonuses, added to the museum's at dispatch: the Pathfinder
// Suite's scan speed + hazard resist, and the installed sensor array's relic-find bonus (non-zero only for
// the Bio-Resonance Array). Exact zeros for a ship carrying neither (every existing loadout), so the
// snapshot sum museum + 0 is the museum value bit-for-bit. E-MOD EM-7: a complete module set's scan bonus (the Survey
// Pair: model.ts shipGearSetBonusLines, scaled by its pieces and worn with them in the run's gear view) joins the scan
// speed; added only when there is one, so every set-free ship reads the Pathfinder's value unchanged. Pure.
export interface ExpeditionGearBonuses {
  scanSpeed: number;
  hazardResist: number;
  relicFindChance: number;
}
export function expeditionGearBonuses(state: GameState, ship: ShipInstance): ExpeditionGearBonuses {
  // GEAR WEAR step 3: a worn suite or array reads at its efficiency (the worn-gear view, gearWear.ts).
  const gearView = wornGearView(state);
  const installed = equippedFor(gearView, ship.id);
  const pathfinder = pathfinderEffect(installed);
  const setScan = shipGearSetBonusLines(installed).scanSpeedBonus ?? 0;
  return {
    scanSpeed: setScan > 0 ? pathfinder.scanSpeed + setScan : pathfinder.scanSpeed,
    hazardResist: pathfinder.hazardResist,
    relicFindChance: sensorArrayRelicFindBonus(installedSensorArray(gearView, ship)),
  };
}

// Gas Giant Study GG-7: the ship's installed special-blueprint gear the dispatch freezes (fractions, 0 without the
// piece): the Ramscoop Collector's nebula sweep boost (shipModules.ts moduleNebulaSweep, scaled by the module's rarity
// and quality and worn with it) and the Resonance Sensor Array's canister band lift. Kept apart from
// expeditionGearBonuses so its shape (and every pin of it) is unchanged; the dispatch hands in the worn gear view it
// already built. Pure.
export interface ExpeditionGasGiantGear {
  nebulaSweep: number;
  bandLift: number;
}
export function expeditionGasGiantGear(state: GameState, ship: ShipInstance, gearView: GameState = wornGearView(state)): ExpeditionGasGiantGear {
  const installed = equippedFor(gearView, ship.id);
  return {
    nebulaSweep: moduleNebulaSweep(installed, (p) => moduleEffectScale(p.rarity, p.quality, p.ascension) * viewPieceEfficiency(p)),
    bandLift: sensorArrayCanisterBandLift(installedSensorArray(gearView, ship)),
  };
}

// ============================================================================
// E2c: candidate targets + sensor-gated foreknowledge (pure readers)
// ============================================================================

// A candidate's FOREKNOWLEDGE view: a progressive reveal gated by the ship's crew-inclusive `sensors`.
// Below SENSOR_REVEAL_IN_RANGE the destination is `inRange: false` (only its name is known); each higher
// threshold unlocks the next field. Every revealed value is a projection of generateBodies(candidate.seed, its tier)
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
  id: string; // "cand-<tier>-<slot>" (G2-2), stable for a given expeditionSeed
  index: number; // the slot within its tier (the console sorts nearest first, so not its screen position)
  // Expedition Tiers G2-2: the region the candidate lies in (its tier, and enemy territory by the homeworld's fixed
  // sectors). The risk roll, the previews and the run read it; the UI shows only what `telescope` reads of it.
  region: ExpeditionRegion;
  seed: number; // == the committed expedition's seed if this candidate is chosen (so the preview matches)
  systemId: string;
  systemName: string;
  foreknowledge: ExpeditionForeknowledge;
  // Squads SQ-5: the Subspace Telescope's reading of this system (telescope.ts readSystem): its region, distance,
  // whether it is in range or BLIND (SQ-7's dispatch confirm warns on `telescope.blind`), the detail it reads
  // (the ship's sensors may lift it one level) and the risk preview gated by that detail. Squads SQ-6 adds, gated
  // by the same detail (launchRecommendation.ts gateLaunchView): the task demand (Per body), the launch
  // recommendation (Recommendation) and the forecast (Forecast). Display only.
  // ⚠️ THE UI MUST READ `candidate.telescope` AND NEVER RE-DERIVE ANYTHING FROM `seed` (SQ-5 review Minor 2): the
  // seed would reveal what the telescope cannot see yet (risk grades, tasks, hostile sites); the reading here is
  // exactly what this ship's telescope detail allows, nothing more.
  telescope: CandidateTelescopeReading;
}

// The foreknowledge of a BLIND candidate: beyond the telescope's range the ship's own sensor layers are hidden too
// (design 6.4: a ship parked at the homeworld cannot see thousands of light-years) [PROPOSAL, open call 7; user #7
// asks for a "truly unknown territory" warning]. G2-2: a candidate of a tier past the telescope's reach reads it (the
// console offers deeper tiers once G2-6 adds the region picker).
const BLIND_FOREKNOWLEDGE: ExpeditionForeknowledge = { inRange: false, bodyCount: null, bodies: null, relicSignature: null, relicSets: null };

// Run the REAL seeded discovery roll for a preview system (generateBodies), reusing the exact
// engine path (assignDiscoveriesAndActivities) so the projection cannot drift from what the committed
// expedition resolves. Builds a throwaway expedition-shaped object with the given seed + the ship's
// snapshotted scan params (the array bias skews discoveries, so the preview must use the ship's array),
// then reads the resulting discoveries. Pure: mutates only the local throwaway. Returns the distinct relic
// SETS the would-be discoveries source (relics.ts relicSetForPoi), in canonical RELIC_SETS order; the
// boolean signature is "this list is non-empty".
function previewRelicSets(seed: number, scanParams: ExpeditionScanParams, region: ExpeditionRegion): RelicSetId[] {
  const fake = previewRun(seed, scanParams, region);
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

// The PREVIEW's throwaway run (previewRelicSets, systemTaskPreview): the candidate's system on `region` with its
// RISK GRADES on every body and the run's risk profile (Squads SQ-6: exactly the shape startExpedition commits, so
// flora's Bloom lift shapes the previewed discoveries as it shapes the run's), and the ship's scan params. No
// ground teams, so no hostile site joins unless the caller passes the squads. Pure: fresh objects.
function previewRun(seed: number, scanParams: ExpeditionScanParams, region: ExpeditionRegion): Expedition {
  const gen = previewSystem(seed, region);
  const risk = generateRiskProfile(seed, region, gen.bodies);
  // Gas Giant Study GG-2: the same study flag and giant profiles the dispatch freezes (buildExpedition), so the
  // preview drops the orbital bodies' objectives exactly as the run will.
  const study = studyStampFor(gen.bodies);
  const risked = gen.bodies.map((b, i) => ({ ...b, risk: risk.bodies[i] }));
  const nebula = nebulaStampFor(seed, region.tier, gen.systemId);
  return {
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
    bodies: study ? withGiantProfiles(seed, risked) : risked,
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
    risk: risk.profile,
    ...(study ? { study } : {}),
    // GG-4: the same nebula stamp the dispatch freezes (buildExpedition).
    ...(nebula ? { nebula } : {}),
  };
}

// Gate a generated system into a foreknowledge VIEW by the ship's sensor power. Pure.
function gateForeknowledge(
  sensorPower: number,
  bodies: ExpeditionBody[],
  seed: number,
  scanParams: ExpeditionScanParams,
  region: ExpeditionRegion,
): ExpeditionForeknowledge {
  const inRange = sensorPower >= SENSOR_REVEAL_IN_RANGE;
  if (!inRange) return { inRange: false, bodyCount: null, bodies: null, relicSignature: null, relicSets: null };
  const showTypes = sensorPower >= SENSOR_REVEAL_PLANET_TYPES;
  const showHazard = sensorPower >= SENSOR_REVEAL_HAZARD;
  const showRelic = sensorPower >= SENSOR_REVEAL_RELIC;
  const relicSets = showRelic ? previewRelicSets(seed, scanParams, region) : null;
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
// Expedition Tiers G2-2: the list of ONE region tier (tierCandidateSystems: three per tier, nearest first); Tier I
// by default. The console shows Tier I until G2-6 adds the region picker.
export function expeditionCandidates(state: GameState, shipId: string, tier: RegionTier = 1): ExpeditionCandidate[] {
  const ship = state.ships.find((s) => s.id === shipId);
  const snap = shipSensorSnapshot(state, ship);
  const homeworld = stateHomeworld(state); // G2-1: the range and distances from the save's own homeworld
  const reading = telescopeReading(state, homeworld);
  // WR-5c: the commanding captain's Foreknowledge (+ detail levels) and Deep Scan (the full reading, and every
  // foreknowledge field below). Display only, like the telescope; never past its range.
  const sight = ship ? captainTelescopeSight(commandingCaptain(state, ship)) : NO_CAPTAIN_SIGHT;
  const foreSensors = sight.full ? Number.POSITIVE_INFINITY : snap.sensorPower;
  // G2-5: a system a recall returned to the candidates (nothing charted) joins its tier's list after the three.
  return [...tierCandidateSystems(state, tier, homeworld), ...heldCandidates(state, tier)].map((cand) => {
    const { seed, region } = cand;
    const bodies = generateBodies(seed, region.tier);
    const sys = readSystem(reading, seed, snap.sensorPower, expeditionRiskPreview(seed, region), homeworld, sight, cand.distanceLy);
    // Squads SQ-6: the task demand (cheap: one throwaway discovery and stamping pass) rides the candidate from Per
    // body. The recommendation and the forecast simulate launches, so they are NOT built here: the UI asks for them
    // per candidate (expeditionLaunchView, e.g. for an expanded card).
    const demand =
      ship && sys.detail >= TELESCOPE_DETAIL.perBody ? taskDemand(previewForHull(systemTaskPreview(seed, snap.scanParams, region), ship.typeKey)) : null;
    const telescope: CandidateTelescopeReading = { ...sys, demand };
    return {
      id: cand.id,
      index: cand.slot,
      region: { ...region },
      seed,
      systemId: cand.systemId,
      systemName: cand.systemName,
      foreknowledge: telescope.blind ? { ...BLIND_FOREKNOWLEDGE } : gateForeknowledge(foreSensors, bodies, seed, snap.scanParams, region),
      telescope,
    };
  });
}

// ============================================================================
// Squads SQ-6: the TASK PREVIEW and the FORECAST (display only; design 6.3 and 6.5)
// ============================================================================

// Squads that field every hostile site (the system preview lists every placed site; a composition that cannot
// field one leaves it behind, launchRecommendation.ts).
const EVERY_SITE: GroundTaskNeeds = { security: Number.POSITIVE_INFINITY, science: Number.POSITIVE_INFINITY };

// Every task a candidate system holds, as the run would STAMP them: the run's own discovery roll (the committed
// seed, the ship's scan params, the bodies' risk grades) and the run's own stamping (groundOps.ts
// initGroundTasks: fight points, needs under riskFactors.ts tierNeeds, difficulty), body by body. Every hostile
// site the risk roll placed is listed (`hostile`); the run reveals one only when the deployed squads field it.
// `region` is the candidate's (G2-2), Tier I by default. Pure: a throwaway run, never stored.
// The UI never calls this for a candidate: it reads candidate.telescope, which carries only what the detail allows.
export function systemTaskPreview(seed: number, scanParams: ExpeditionScanParams, region: ExpeditionRegion = TIER_I_REGION): SystemTaskPreview {
  const run = previewRun(seed, scanParams, region);
  const tasks: PreviewTask[] = [];
  run.bodies.forEach((body, i) => {
    assignDiscoveriesAndActivities(run, body, i, EVERY_SITE);
    initGroundTasks(run, i);
    for (const t of body.activities) {
      tasks.push({ bodyIndex: i, poiId: t.poiId, hostile: isHostileSiteId(t.poiId), fightPoints: t.fightPoints?.length ?? 0, needs: taskNeedsOf(t), difficulty: t.difficulty ?? 1 });
    }
  });
  // Gas Giant Study GG-2: the bodies the ship studies (no objective, no squad), only when the system holds one.
  const studies = run.bodies.flatMap((b, i) => (isStudyBody(run, b) ? [i] : []));
  return {
    tier: region.tier,
    enemyTerritory: region.enemyTerritory,
    bodies: run.bodies.map((b) => ({ ...(b.risk as BodyRiskGrades) })),
    tasks,
    ...(studies.length > 0 ? { studies } : {}),
    // GG-4: the system's nebula (the ship sweeps it after the bodies, no squad), only when it holds one.
    ...(run.nebula ? { nebula: run.nebula.kindId } : {}),
  };
}

// The throwaway expedition id a simulated launch carries (SQ-6 review Minor 3): never the id the real dispatch
// will mint, so no display memo or log can ever mistake a forecast run for the real one.
export const FORECAST_EXPEDITION_ID = "expedition-forecast";

// A SIMULATED LAUNCH (the forecast and the odds-aware recommendation): `shipId` launched at candidate `seed` with
// composition `kinds`, set as "Set composition" would set it (groundTeams.ts applyComposition; when it cannot be,
// e.g. the ship is out, the current composition is used and `used` says so), the run BUILT exactly as
// startExpedition builds it (the deploying teams, their roster, the risk) under FORECAST_EXPEDITION_ID, and every
// body scanned through the run's own discovery, stamping and planning path. `exp` is null when no ground team is
// ready to launch. Pure: everything is a throwaway; `state` is never touched.
export interface SimulatedLaunch {
  used: GroundTeamKind[];
  state: GameState;
  ship: ShipInstance;
  exp: Expedition | null;
  placed: number; // hostile sites the risk roll placed that SOME valid composition of the hull fields
}
export function simulateLaunch(state: GameState, shipId: string, seed: number, kinds: readonly GroundTeamKind[], region: ExpeditionRegion): SimulatedLaunch | null {
  const before = state.ships.find((x) => x.id === shipId);
  if (!before) return null;
  let s = state;
  let used = shipTeamKinds(before);
  if (compositionChanges(used, kinds) > 0) {
    const applied = applyComposition(state, shipId, kinds);
    if (applied !== state) {
      s = applied;
      used = [...kinds];
    }
  }
  const ship = s.ships.find((x) => x.id === shipId) as ShipInstance;
  const gen = previewSystem(seed, region);
  const risk = generateRiskProfile(seed, region, gen.bodies);
  const fleets = validCompositions(ship.typeKey).map(compositionSquads);
  const placed = risk.bodies.filter((b) => b.site !== undefined && fleets.some((sq) => hostileSiteFieldable(b.site!, sq))).length;
  if (!expeditionAwayTeamCheck(s, ship).ok) return { used, state: s, ship, exp: null, placed };
  const exp = buildExpedition(s, ship, ship.assignedCaptainId ?? 0, seed, true, s.nextExpeditionId, gen, risk, FORECAST_EXPEDITION_ID);
  exp.bodies.forEach((body, i) => {
    body.scanProgress = body.scanTotal;
    body.scanned = true;
    assignDiscoveriesAndActivities(exp, body, i);
    groundOpsBodyScanned(exp, i, s.gameTimeSeconds);
  });
  return { used, state: s, ship, exp, placed };
}

// The odds-aware recommendation's reader (user, 2026-10-13: Strike's role "BOTH"): composition `kinds`' weighted
// mean CLEAR RATE on the previewed fights, i.e. over every task of `preview` with a fight point that the
// composition's squads cover, the fresh clear odds (groundThreat.ts, the display stream) of the crew the plan
// sends (assignedTeamIds of the simulated launch), weighted by difficulty. A task the simulated launch cannot work
// (skipped, or a hostile site its deployment does not field) counts as 0. Null when the composition cannot be set,
// nobody is ready, or no covered task holds a fight. Pure.
export function compositionFightOdds(
  state: GameState,
  shipId: string,
  seed: number,
  kinds: readonly GroundTeamKind[],
  preview: SystemTaskPreview,
  region: ExpeditionRegion = TIER_I_REGION,
  sim: SimulatedLaunch | null = simulateLaunch(state, shipId, seed, kinds, region),
): number | null {
  if (!sim || !sim.exp || compositionChanges(sim.used, kinds) > 0) return null;
  const exp = sim.exp;
  const squads = compositionSquads(kinds);
  // Preview tasks and simulated tasks PAIR by body and PoI id, in order: both lists come from the same discovery
  // roll and the same stamping path (systemTaskPreview and the simulated scan share assignDiscoveriesAndActivities
  // and initGroundTasks), so the n-th task of a PoI on a body is the same task in both. A hostile site the
  // simulated deployment does not field has no partner and counts 0.
  const used = new Set<ExpeditionActivity>();
  let total = 0;
  let sum = 0;
  for (const t of preview.tasks) {
    if (t.fightPoints <= 0 || t.needs.security > squads.security || t.needs.science > squads.science) continue;
    const w = difficultyWeight(t.difficulty);
    total += w;
    const task = exp.bodies[t.bodyIndex]?.activities.find((a) => a.poiId === t.poiId && !used.has(a));
    if (!task) continue;
    used.add(task);
    if (task.status === "skipped") continue;
    const odds = groundCrewClearOdds(exp, task.assignedTeamIds ?? [], task.id);
    if (odds) sum += w * (odds.wins / Math.max(1, odds.samples));
  }
  return total > 0 ? sum / total : null;
}

// One grade's slot (index 0 Simple .. 4 Deadly) for a stored difficulty. Pure.
function gradeSlot(difficulty: number | undefined): number {
  return Math.max(0, Math.min(DIFFICULTY_NAMES.length - 1, (difficulty ?? 1) - 1));
}

// The FORECAST (design 6.3 Forecast) of a simulated launch with composition `kinds` (the recommendation's): the
// tasks it would work per difficulty grade, what it would leave unfinished, and the threat tier (groundThreat.ts,
// the display stream) of the crew the plan would send on the hardest task with a fight. With no ground team ready
// the counts come from the task preview and there is no threat read. Pure.
export function launchForecast(
  state: GameState,
  shipId: string,
  seed: number,
  kinds: readonly GroundTeamKind[],
  region: ExpeditionRegion = TIER_I_REGION,
  sim: SimulatedLaunch | null = simulateLaunch(state, shipId, seed, kinds, region),
): LaunchForecast | null {
  if (!sim) return null;
  const { used, exp } = sim;
  const label = compositionLabel(used);
  const byDifficulty = DIFFICULTY_NAMES.map(() => 0);
  if (!exp) {
    const squads = compositionSquads(used);
    let tasks = 0;
    let unfinished = 0;
    const preview = previewForHull(systemTaskPreview(seed, shipSensorSnapshot(sim.state, sim.ship).scanParams, region), sim.ship.typeKey);
    for (const t of preview.tasks) {
      if (squads.security >= t.needs.security && squads.science >= t.needs.science) {
        tasks += 1;
        byDifficulty[gradeSlot(t.difficulty)] += 1;
      } else unfinished += 1;
    }
    const previewStudies = preview.studies?.length ?? 0;
    return {
      kinds: used,
      label,
      teamsDeployed: 0,
      tasks,
      byDifficulty,
      unfinished,
      hardest: null,
      threat: null,
      note: "No ground team is ready to launch",
      ...(previewStudies > 0 ? { studies: previewStudies } : {}),
      ...(preview.nebula ? { nebula: preview.nebula } : {}),
    };
  }
  let revealed = 0;
  let tasks = 0;
  let skipped = 0;
  let pick: { task: ExpeditionActivity; bodyIndex: number } | null = null;
  exp.bodies.forEach((body, bodyIndex) => {
    for (const task of body.activities) {
      if (isHostileSiteId(task.poiId)) revealed += 1;
      if (task.status === "skipped") {
        skipped += 1;
        continue;
      }
      tasks += 1;
      byDifficulty[gradeSlot(task.difficulty)] += 1;
      const fights = task.fightPoints?.length ?? 0;
      if (fights === 0) continue;
      const d = task.difficulty ?? 1;
      const held = pick?.task;
      const heldD = held?.difficulty ?? 1;
      if (!held || d > heldD || (d === heldD && fights > (held.fightPoints?.length ?? 0))) pick = { task, bodyIndex };
    }
  });
  const chosen = pick as { task: ExpeditionActivity; bodyIndex: number } | null;
  const studyCount = exp.bodies.filter((b) => isStudyBody(exp, b)).length;
  const crew = chosen?.task.assignedTeamIds ?? [];
  const hardest: ForecastHardestTask | null = chosen
    ? {
        bodyIndex: chosen.bodyIndex,
        poiId: chosen.task.poiId,
        label: groundSiteLabel(chosen.task.poiId) ?? "An objective",
        difficulty: chosen.task.difficulty ?? 1,
        difficultyName: DIFFICULTY_NAMES[gradeSlot(chosen.task.difficulty)],
        fightPoints: chosen.task.fightPoints?.length ?? 0,
        crew: [...crew],
      }
    : null;
  return {
    kinds: used,
    label,
    teamsDeployed: exp.groundOps?.teams.length ?? 0,
    tasks,
    byDifficulty,
    // A hostile site the hull could field but this deployment does not is left behind; one NO valid composition of
    // the hull fields never exists for it (previewForHull), so it is not counted.
    unfinished: skipped + Math.max(0, sim.placed - revealed),
    hardest,
    threat: chosen ? groundCrewThreat(exp, crew, chosen.task.id) : null,
    note: chosen ? null : "No fights expected",
    // Gas Giant Study GG-2: the run's ship studies (one per orbital body of a study run), only when there is one.
    ...(studyCount > 0 ? { studies: studyCount } : {}),
    // GG-4: the nebula the ship would sweep after the bodies, only when there is one.
    ...(exp.nebula ? { nebula: exp.nebula.kindId } : {}),
  };
}

// ===== The candidate's launch view, lazy and memoized (SQ-6 reviews) =====

// The launch view of one candidate for one ship: the task demand (Per body), the recommendation (Recommendation)
// and the forecast (Forecast), each computed ONLY when the candidate's telescope detail shows it (gateLaunchView).
// The recommendation and the forecast simulate launches, so the candidate list never builds them: the UI asks for
// this view when it shows them (SQ-7: an expanded candidate card), and it is MEMOIZED (bounded, LRU) on everything
// that shapes those launches:
//   - the candidate (seed), the telescope level and the effective detail (the sensor band: the lift), the ship's
//     scan params;
//   - the ship record (hull, slotting, composition), its assigned captain (id, spec, secondary talents), its
//     SEATED OFFICERS (whole records: seat, rank, bonuses, stats) and its ASSIGNED NOTABLE CREW (whole records);
//   - the members aboard (slotted or in reserve) and the gear they wear or the ship carries, and which teams would
//     deploy now;
//   - the museum's bonuses;
//   - and, as a catch-all for any other dispatch input, the dispatch record a launch of the CURRENT composition
//     would commit (buildExpedition: the frozen roster, crew layers, officer facets and bonuses, sensors, museum and
//     gear snapshots), with its id and the dispatch instant taken out.
// A tick that only moves time or credits (or another ship) hits the memo; a stale view is display only.
export const LAUNCH_VIEW_MEMO_SIZE = 32;
const launchViewMemo = new Map<string, LaunchView>();

function launchViewKey(state: GameState, ship: ShipInstance, seed: number, region: ExpeditionRegion, detail: number, scanParams: ExpeditionScanParams): string {
  const aboard = state.awayMembers.filter((m) => m.assignedShipId === ship.id);
  const ids = new Set(aboard.map((m) => m.id));
  const gear = state.equipment.filter((e) => e.fittedToShipId === ship.id || (e.fittedToMemberId !== undefined && e.fittedToMemberId !== null && ids.has(e.fittedToMemberId)));
  const deploys = expeditionAwayTeamCheck(state, ship).ground.teams.map((t) => t.deploys);
  const captain = commandingCaptain(state, ship);
  const officers = state.officers.filter((o) => o.assignedShipId === ship.id);
  const notables = state.notableCrew.filter((n) => (n.assignedShipId ?? null) === ship.id);
  const gen = previewSystem(seed, region);
  const dispatch = buildExpedition(state, ship, ship.assignedCaptainId ?? 0, seed, true, 0, gen, generateRiskProfile(seed, region, gen.bodies), "");
  const frozen = JSON.stringify({ ...dispatch, phaseAnchorSeconds: 0 }, (k, v) => (k === "stepStartedAt" ? undefined : v));
  return JSON.stringify([
    seed,
    region,
    telescopeLevel(state),
    detail,
    scanParams,
    ship,
    captain ? [captain.id, captain.spec, captain.unlockedSecondaryTalents] : null,
    officers,
    notables,
    aboard,
    gear,
    deploys,
    museumBonuses(state),
    frozen,
  ]);
}

// The memo's size, for the tests. Pure read.
export function launchViewMemoSize(): number {
  return launchViewMemo.size;
}

// The launch view of `candidate` (one of expeditionCandidates(state, shipId)) for ship `shipId` (see above). Display
// only; all nulls for an unknown ship or below Per body. Pure in effect (memoized on its whole input).
// G2-2: the candidate's region (Tier I when a caller passes none).
export function expeditionLaunchView(
  state: GameState,
  shipId: string,
  candidate: Pick<ExpeditionCandidate, "seed" | "telescope"> & { region?: ExpeditionRegion },
): LaunchView {
  const ship = state.ships.find((x) => x.id === shipId);
  const detail = candidate.telescope.detail;
  if (!ship || !(detail >= TELESCOPE_DETAIL.perBody)) return { demand: null, recommendation: null, forecast: null };
  const seed = candidate.seed;
  const region = candidate.region ?? TIER_I_REGION;
  const scanParams = shipSensorSnapshot(state, ship).scanParams;
  const key = launchViewKey(state, ship, seed, region, detail, scanParams);
  const hit = launchViewMemo.get(key);
  if (hit) {
    launchViewMemo.delete(key);
    launchViewMemo.set(key, hit);
    return hit;
  }
  const sims = new Map<string, SimulatedLaunch | null>();
  const simOf = (kinds: readonly GroundTeamKind[]): SimulatedLaunch | null => {
    const k = [...kinds].sort().join("+");
    if (!sims.has(k)) sims.set(k, simulateLaunch(state, ship.id, seed, kinds, region));
    return sims.get(k) ?? null;
  };
  const view = gateLaunchView(detail, {
    preview: () => previewForHull(systemTaskPreview(seed, scanParams, region), ship.typeKey),
    // The odds reader is lazy: recommendLaunch reads the winner's odds, and the others only when they read risky.
    recommend: (preview) =>
      recommendLaunch(preview, ship.typeKey, shipTeamKinds(ship), (kinds) => compositionFightOdds(state, ship.id, seed, kinds, preview, region, simOf(kinds))),
    forecast: (_preview, rec) => (rec ? launchForecast(state, ship.id, seed, rec.kinds, region, simOf(rec.kinds)) : null),
  });
  if (launchViewMemo.size >= LAUNCH_VIEW_MEMO_SIZE) {
    const oldest = launchViewMemo.keys().next().value;
    if (oldest !== undefined) launchViewMemo.delete(oldest);
  }
  launchViewMemo.set(key, view);
  return view;
}

// Squads SQ-4: a candidate's RISK PROFILE (riskFactors.ts): the candidate's region (G2-2: its tier and enemy
// territory; Tier I by default), the system's grades and every body's, on the candidate's own seed (RISK_SALT).
// Pure and ship-independent: startExpedition stores exactly this for the committed candidate, so a pre-launch
// reading (the Subspace Telescope, SQ-5) can never disagree with the run. A body's hostile `site` is the seeded
// placement; whether it becomes a task depends on the squads the ship deploys (hostileSiteFieldable).
export function expeditionRiskPreview(seed: number, region: ExpeditionRegion = TIER_I_REGION): { profile: ExpeditionRiskProfile; bodies: BodyRiskGrades[] } {
  return generateRiskProfile(seed, region, generateBodies(seed, region.tier));
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
  // Field Kits FKR-7: the runs switch (fieldKits.ts FIELD_KITS_RUNS_LIVE, off); the tests pass true to dispatch a Field
  // Kits run the way the switch will.
  fieldKitsRuns: boolean = FIELD_KITS_RUNS_LIVE,
  // Expedition Tiers G2-4: the propulsion gates (explorer hull, drive class, frontier sensors, reach), always on for a
  // player. false is the PRE-G2-4 DISPATCH, for the test fixtures and wiring probes that fly the starting freighter to
  // measure something else (awayTeamTestFixtures.ts dispatchPastPropulsion): every record it writes is the one a
  // gated dispatch of a ship that passes would write.
  propulsionGates: boolean = true,
): ExpeditionDispatchResult {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return { next: state, success: false, reason: "noSuchShip" };
  if (ship.assignedCaptainId !== captainId) return { next: state, success: false, reason: "captainNotAssigned" };
  if (state.expeditions.some((e) => e.shipId === shipId))
    return { next: state, success: false, reason: "shipAlreadyOnExpedition" };
  // GO-8 review (user, 2026-10-14): a damaged ship, or one in a Shipyard repair bay, is repaired first.
  if (expeditionShipDamaged(state, ship)) return { next: state, success: false, reason: "shipDamaged" };
  // G2-4 (user 2026-10-16): no non-explorer hull reaches any expedition system, Tier I included.
  if (propulsionGates && SHIP_TYPES[ship.typeKey]?.spec !== "explorer") {
    return { next: state, success: false, reason: "notExplorer", gate: expeditionTierGates(state, ship, 1).first ?? undefined };
  }

  // The candidate (the console's ids, without building every reading: SQ-6's forecast builds runs). G2-2: any tier's.
  // G2-5: a held system (a recall left it: an ordinary candidate again, or resumable) is dispatched by its id too.
  const held = heldSystemById(state, candidateId);
  const cand = held ? heldCandidateSystem(held) : candidateSystemById(state, candidateId);
  if (cand === null) return { next: state, success: false, reason: "noSuchCandidate" };
  // G2-4: the region's drive class and frontier sensors, then this system's reach (propulsion.ts).
  if (propulsionGates) {
    const gate = expeditionSystemGate(state, ship, cand);
    if (gate) return { next: state, success: false, reason: gate.reason, gate };
  }
  // D18: no minimum away team (1 Security + 1 Science, ready), no expedition.
  if (!expeditionAwayTeamCheck(state, ship).ok) return { next: state, success: false, reason: "needsAwayTeam" };

  const number = state.nextExpeditionId;
  const seed = cand.seed; // COMMIT the previewed candidate's seed so the launch matches its preview
  // G2-5 (user G12 "Pick up where you left off"): a resumed system flies to its held bodies (scans, discoveries and
  // objectives as the recall left them) under its held risk profile; every other dispatch generates the system.
  const resumed = held?.kind === "resume" && held.bodies && held.risk ? held : null;
  const gen = { systemId: cand.systemId, systemName: cand.systemName, bodies: resumed ? resumedBodies(resumed) : generateBodies(seed, cand.tier) };
  // Squads SQ-4: the RISK PROFILE (riskFactors.ts), drawn from the committed candidate's seed and region exactly as
  // expeditionRiskPreview reads it, so the pre-launch reading and the run are one draw.
  const risk = resumed ? { profile: { ...resumed.risk! }, bodies: gen.bodies.map((b, i) => b.risk ?? expeditionRiskPreview(seed, cand.region).bodies[i]) } : expeditionRiskPreview(seed, cand.region);
  // G2-2: the run freezes where it went (Expedition.region), so it never re-reads the homeworld. G2-3: and how long
  // it flies (Expedition.voyage), so a later drive, crew or homeworld change never reshapes it.
  const homeworld = stateHomeworld(state);
  const built = buildExpedition(state, ship, captainId, seed, anomalyOptIn, number, gen, risk, undefined, fieldKitsRuns);
  // GEAR WEAR step 3 (gearWearEngine.ts): the committed run's wear flag with its dispatch instant, while any wear source is
  // live and never on the training run (user W9 "No wear on training"). Only a committed run carries it (the forecast's
  // throwaway runs never wear anything).
  const wear = gearWearLive() && !isTrainingRun(built) ? { gearWear: { version: 1 as const, dispatchedAt: state.gameTimeSeconds } } : {};
  // Relics v2 R2-2: and the relic blanks flag (its relic tokens carry the region tier and the body's culture, and roll
  // their rarity on the tier's blank table; Tier I's is today's).
  const launched: Expedition = {
    ...built,
    region: regionStampOf(cand),
    voyage: candidateVoyage(state, ship, cand, isTrainingRun(built), homeworld),
    relicBlanks: { version: RELIC_BLANKS_VERSION },
    ...wear,
  };
  // G2-5: a resumed run met its route's anomaly on the first trip (resolved, never charted twice), and records how
  // many bodies were charted before (the window opens past them, openResumedWindow).
  // GG-4: a nebula an earlier trip swept is marked swept (the same key, so the record keeps its order) and not swept again.
  const expedition: Expedition = resumed
    ? {
        ...launched,
        ...(resumed.nebulaSwept && launched.nebula ? { nebula: { ...launched.nebula, swept: 1 as const } } : {}),
        anomalyResolved: true,
        resume: { version: 1, heldId: resumed.id, scannedBodies: chartedPrefix(resumed.bodies!) },
      }
    : launched;
  // Field Kits FKR-7: the packs leave stock (lowest quality first) and a top-up's credits are spent: the SAME plan
  // buildExpedition packed (planDispatchPacks is pure on the same inputs). A run without flag 2 settles nothing.
  const packed = fieldKitsLive(built)
    ? settleDispatchPacks(state, planDispatchPacks(state, ship, built.groundOps?.teams ?? [], built.roster?.security ?? []))
    : state;
  // Squads SQ-6 (user, SQ-5 call (b)): count a BLIND launch (beyond the telescope's range: the same reading the
  // candidate showed), so the future "go in blind" achievement can award retroactively. Never read by a run.
  const blind = readSystem(telescopeReading(state, homeworld), seed, expedition.sensorPower, risk, homeworld, undefined, cand.distanceLy).blind;
  // User 2026-10-19: a veteran's Wolf 359 list (no key on any other save). G2-5: a held system is not from the list.
  const wolf359List = held ? undefined : wolf359ListAfterDispatch(state);
  // G2-5: the held system leaves the console (an ordinary candidate launched, or a resumed system flown again).
  const heldLeft = held ? (state.heldSystems ?? []).filter((h) => h.id !== held.id) : undefined;

  return {
    next: {
      ...packed,
      expeditions: [...state.expeditions, expedition],
      nextExpeditionId: number + 1,
      // Safe first runs SF-1 (review): the counters as they read BEFORE this dispatch. A state without stored counters
      // (a dev save or fixture from before SF-1) derives them from its history, and that derivation would read this
      // dispatch as pre-0.14.0 play (a veteran); storing them here keeps the save on its real counts. The stored
      // object itself (the same reference) when present.
      runCounts: runCountsOf(state),
      // Advance the preview seed ONLY here (a commit), so previews stay stable until a dispatch happens. G2-5: a held
      // system was not on the list, so the list on screen stays.
      expeditionSeed: held ? state.expeditionSeed : advanceExpeditionSeed(state.expeditionSeed),
      ...(blind ? { blindLaunches: blindLaunchCount(state) + 1 } : {}),
      ...(wolf359List !== undefined ? { wolf359List } : {}),
      ...(heldLeft !== undefined ? { heldSystems: heldLeft } : {}),
    },
    success: true,
    expedition,
  };
}

// The expedition record a dispatch of `ship` at `seed` commits (startExpedition, after its gates), and the record
// SQ-6's forecast builds as a throwaway: every snapshot taken at the dispatch instant. Pure: fresh data.
function buildExpedition(
  state: GameState,
  ship: ShipInstance,
  captainId: number,
  seed: number,
  anomalyOptIn: boolean,
  number: number,
  gen: { systemId: string; systemName: string; bodies: ExpeditionBody[] },
  risk: { profile: ExpeditionRiskProfile; bodies: BodyRiskGrades[] },
  idOverride?: string,
  fieldKitsRuns: boolean = FIELD_KITS_RUNS_LIVE,
): Expedition {
  const shipId = ship.id;
  const id = idOverride ?? `expedition-${number}`;
  const snap = shipSensorSnapshot(state, ship);
  // E3a: snapshot the away team's crew-derived strength + team kit, so the expedition's ground battles
  // resolve as a pure function of the stored expedition (parity, matching the sensor snapshot). D19: the
  // members' programs ride the roster snapshot below, not the account-level pair.
  // (E4b: deriveAwayTeam already folds the museum's scienceTeamPower into scienceStrength.)
  // GEAR WEAR step 3: the away team and its roster freeze the members' gear through the worn-gear view (gearWear.ts),
  // so a worn weapon, armor, tool or implant reads at its efficiency on this run (the same state when nothing is worn).
  const gearView = wornGearView(state);
  const awayTeam = deriveAwayTeam(gearView, ship);
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
  // Survey Aptitude + the Vael and Outer-Colony racials (complement plan CP-3, OC-4 "Faster scans"): the crew's share
  // of the scan speed, frozen into scanSpeedBonus below. 0 without the key, so the stored bonus is unchanged.
  const crewSurvey = shipSurveyAptitude(state, ship);
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
  // programs), at the same dispatch instant. D18: the gate above guarantees deploying teams that hold a
  // Security AND a Science member between them (Squads SQ-2), so every expedition launched from here on
  // carries a roster. (An OLD in-flight expedition may still
  // lack one; the legacy battle resolver handles that safely, see gambit.ts resolveExpeditionActivity.) One
  // team slotted in hire order snapshots exactly what the pre-GO-7b snapshotAwayRoster did.
  const groundSnapshot = snapshotGroundOps(state, ship, { recoveryTurnaround, quickRecovery, injurySteady });
  const roster = snapshotAwayRosterForTeams(gearView, ship, groundSnapshot.teams);
  // Field Kits FKR-7 (behind fieldKits.ts FIELD_KITS_RUNS_LIVE): each deploying Security member's pack, from stock and a
  // top-up team's purchases (fieldKitsRun.ts planDispatchPacks; startExpedition settles the same plan).
  if (fieldKitsRuns) withDispatchPacks(groundSnapshot.teams, planDispatchPacks(state, ship, groundSnapshot.teams, roster.security));
  // Squads SQ-4: the RISK PROFILE's presence (with each body's grades) is the risk-aware flag the ground tasks
  // stamp from.
  // Gas Giant Study GG-2: a system with an orbital body is a STUDY run (Expedition.study, written last below), and each
  // orbital body freezes its giant profile (ExpeditionBody.giant, after its risk). Neither is written on any other run.
  const study = studyStampFor(gen.bodies);
  const risked = gen.bodies.map((b, i) => ({ ...b, risk: risk.bodies[i] }));
  const bodies = study ? withGiantProfiles(seed, risked) : risked;
  // Gas Giant Study GG-4: the system's nebula (its own keyed draw at the run's region tier, a famous nebula always),
  // written last below, only when there is one.
  // GG-7: the Ramscoop Collector's sweep boost joins the nebula stamp, and the Resonance Sensor Array's band lift is
  // frozen on a study run (Expedition.bandLift), each only when the ship carries the piece.
  const gasGear = expeditionGasGiantGear(state, ship, gearView);
  const nebulaDrawn = nebulaStampFor(seed, risk.profile.tier, gen.systemId);
  const ramscoop = nebulaDrawn ? gearPermilleStamp(gasGear.nebulaSweep) : undefined;
  const nebula = nebulaDrawn && ramscoop !== undefined ? { ...nebulaDrawn, ramscoop } : nebulaDrawn;
  const bandLift = study ? gearPermilleStamp(gasGear.bandLift) : undefined;
  // Safe first runs SF-2 / SF-3: the run's difficulty stamp, from stored state only (the counters and the runs out):
  // the training run's, else the curve position and the region tier this run is dispatched at.
  const difficulty = runDifficultyAt(state, "expedition", risk.profile.tier, ship.typeKey);
  // WR-5c: the commanding captain's run-frozen explorer nodes (undefined without them).
  const explorer = explorerCaptainRun(commandingCaptain(state, ship));
  // E-MOD EM-6: the ship's body-scan modules, frozen here (empty without one, so nothing is written).
  const scanProcs = moduleScanProcs(equippedFor(state, shipId), (p) => moduleEffectScale(p.rarity, p.quality, p.ascension));

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
    // Safe first runs SF-2: the 30 minute shakedown is retired (user, group 3); the training run below flies the
    // tutorial transit instead.
    shakedown: false,
    // Safe first runs SF-2 / SF-3: the difficulty stamp (runDifficulty.ts runDifficultyAt) on EVERY new run: the training
    // run's (the first expedition from an explorer) or an ordinary run's curve position (ramp) and tier, which its
    // guards, affix roll, ambushes and ship events read (a run in flight from before SF-3 has none and plays as it
    // did). The forecast's throwaway run is built here too, so the launch view reads the same profile.
    difficulty,
    bodies,
    anomalyResolved: false,
    anomalyCharted: false,
    anomalyOptIn,
    findings: [],
    seed,
    securityStrength: awayTeam.securityStrength,
    scienceStrength: awayTeam.scienceStrength,
    teamKit: awayTeam.teamKit,
    gambitPrograms,
    scanSpeedBonus: crewSurvey > 0 ? museum.scanSpeed + gear.scanSpeed + crewSurvey : museum.scanSpeed + gear.scanSpeed,
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
    // Squads SQ-4: the risk-aware flag (see above).
    risk: risk.profile,
    // Field Kits FKR-1: the enemy ranks flag (enemyRanks.ts), stamped with the rank catalog's version, so a run in
    // flight at the update (no flag) keeps fielding every enemy at Normal.
    enemyRanks: { version: ENEMY_RANKS_VERSION },
    // Field Kits FKR-7: the FIELD KITS flag (flag 2) with the frozen free basic set (fieldKitsRun.ts fieldKitsStamp),
    // only behind fieldKits.ts FIELD_KITS_RUNS_LIVE (off until the pack UI lands), so every dispatch until then stores
    // exactly the FKR-6 record and a run in flight at the update (no flag) keeps fighting as before.
    ...(fieldKitsRuns ? { fieldKits: fieldKitsStamp(state, ship) } : {}),
    // WR-5c: the commanding captain's run-frozen explorer nodes (Field Science, Away-Team Doctrine, Preservationist,
    // Relic Hunter, Drillmaster), only when it owns one (captainExplorerEffects.ts explorerCaptainRun).
    ...(explorer ? { explorerCaptain: explorer } : {}),
    // E-MOD EM-6: the body-scanned modules (assignDiscoveriesAndActivities), only when the ship carries one.
    ...(scanProcs.length > 0 ? { moduleScanProcs: scanProcs } : {}),
    // Gas Giant Study GG-2: the study flag (see above), only on a system with an orbital body.
    ...(study ? { study } : {}),
    // Gas Giant Study GG-4: the nebula stamp (see above), only on a system that holds one.
    ...(nebula ? { nebula } : {}),
    // The user's pickup pause (2026-10-23): a study run's pickups pause the study instead of waiting for its end
    // (groundOps.ts). Written last, only on a run with a study or a nebula, so every other record is byte-identical.
    ...(study || nebula ? { pickupPause: 1 as const } : {}),
    // Gas Giant Study GG-7: the Resonance Sensor Array's band lift (see above), only when the ship carries one.
    ...(bandLift !== undefined ? { bandLift } : {}),
  };
  return expedition;
}

// ============================================================================
// Per-phase pure helpers (all read from ELAPSED-in-phase seconds)
// ============================================================================

// The BASE transit duration (no anomaly detour). Expedition Tiers G2-3: a voyage run's outbound leg as frozen at
// dispatch. A run dispatched before G2-3 keeps its fixed leg: the retired shakedown's 30 minutes when it flew one,
// else TRANSIT_SECONDS (its training run too: the tutorial constant equaled it then).
function baseTransitSeconds(exp: Expedition): number {
  const voyage = voyageOf(exp);
  if (voyage) return voyage.outboundSeconds;
  return exp.shakedown ? SHAKEDOWN_TRANSIT_SECONDS : TRANSIT_SECONDS;
}

// The RETURN leg's base (before the Flight Deck ramp): a voyage run's own return leg, else the pre-G2-3 mirror of
// the outbound base. Pure.
function baseReturnSeconds(exp: Expedition): number {
  return voyageOf(exp)?.returnSeconds ?? baseTransitSeconds(exp);
}

// The charted anomaly's detour: a voyage run's frozen share of its outbound leg, else the pre-G2-3 flat hour. Pure.
function anomalyDetourSeconds(exp: Expedition): number {
  return voyageOf(exp)?.anomalySeconds ?? ANOMALY_EXTRA_SECONDS;
}

// The full TRANSIT duration: base + the anomaly detour once charted. anomalyCharted only becomes true
// after the anomaly resolves at the midpoint (ANOMALY_CHECK_FRACTION < 1), and the midpoint is strictly
// inside the base transit, so by the time elapsed could reach the base duration the anomaly is always
// resolved -> this duration is stable at the completion check (no mid-flight inconsistency).
function transitDurationSeconds(exp: Expedition): number {
  return baseTransitSeconds(exp) + (exp.anomalyCharted ? anomalyDetourSeconds(exp) : 0);
}

// The scan rate (scan units / second) for one body: base rate, shaped by the snapshotted array's
// cadence + coverage and the ship's sensors, slowed by the body's hazard. Always > 0.
//
// E4b: two SNAPSHOTTED museum bonuses shape it too. scanSpeedBonus multiplies the rate by (1 + b), and
// hazardResist shrinks the hazard the body presents (resistedHazard, bounded, never negative) before the
// hazard slow is computed. Both are stored on the expedition at dispatch, so the rate stays a pure
// function of the stored run. Both are 0 for an empty museum: x * 1 is exact and resistedHazard returns
// the hazard unchanged, so the rate is bit-identical to E4a. (0.14.0: the crew's Survey Aptitude, with the Vael and
// Outer-Colony racials, joins the stored scanSpeedBonus at dispatch; OC-4 "Faster scans".)
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
  const rate = (SCAN_BASE_RATE * exp.scanParams.scanRateMult * exp.scanParams.coverageWidth * sensorBoost * museumScan) / hazardSlow;
  // WR-5c: the captain's Cartographer, its own factor (frozen in the scan params at dispatch). Absent = the rate.
  const cartographer = exp.scanParams.captainScanRateMult;
  return cartographer !== undefined && cartographer > 0 && Number.isFinite(cartographer) ? rate * cartographer : rate;
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
// transit without exp.rampReturn. Pure. Expedition Tiers G2-3: a voyage run's base is its own return leg.
export function returnDurationSeconds(exp: Expedition): number {
  // G2-5: a recalled run flies the way home frozen at its recall (the pickup and the leg, ramp included).
  const recall = recallOf(exp);
  if (recall) return recall.returnSeconds;
  const base = baseReturnSeconds(exp);
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
// `deployed` = the squads the hostile-site gate reads: the run's deployed teams (the default), or (Squads SQ-6's
// system task preview) squads that field every site.
function assignDiscoveriesAndActivities(
  exp: Expedition,
  body: ExpeditionBody,
  bodyIndex: number,
  deployed: GroundTaskNeeds | null = exp.groundOps ? crewSquadsOf(exp.groundOps.teams) : null,
): void {
  // Gas Giant Study GG-2 (D22, OC-G2): an orbital body of a study run has no surface: no discovery, no hostile site,
  // no clearing objective, no sensor ghost find, so no ground objective at all (the ship studies it instead, GG-3).
  // Its discovery stream is its own (keyed by the body), so leaving it undrawn shifts no other body's roll.
  if (isStudyBody(exp, body)) {
    body.discoveries = [];
    body.activities = [];
    return;
  }
  const rng = makeRng((exp.seed ^ (DISCOVERY_SALT + Math.imul(bodyIndex + 1, 0x9e3779b9))) >>> 0);
  // The planet type gates the eligible pools; PLANET_TYPES[0] (terrestrial) is a defensive default the
  // union type makes unreachable, kept so an unexpected id still yields a valid pool.
  const planet = PLANET_TYPES.find((p) => p.id === body.planetType) ?? PLANET_TYPES[0];
  const pools = floraWeightedPools(poisForPlanetType(planet.id), body);
  const attempts = DISCOVERY_ATTEMPTS_BASE + rng.nextInt(DISCOVERY_ATTEMPTS_SPREAD + 1);
  // Per-pool per-attempt odds: base + the PLANET TYPE's pool bias + the sensor ARRAY's pool bias.
  // WR-5c: the captain's Anomaly Sense multiplies each attempt's odds (its own factor, before the clamp), and Deep Scan
  // makes the first `captainSureFinds` attempts land (the surface roll, or the underground one on a world with no
  // surface pool). A sure attempt still draws its chance, so the draw order is the same; a find it adds takes its PoI
  // pick from this body's own keyed stream, like any find. Absent, the odds and the rolls are the pre-WR-5c ones.
  const { surface: surfacePermille, underground: undergroundPermille } = discoveryOddsPermille(exp.scanParams, planet.id);
  const sure = Math.max(0, Math.floor(exp.scanParams.captainSureFinds ?? 0));
  const discoveries: ExpeditionDiscovery[] = [];
  for (let a = 0; a < attempts; a++) {
    const sureSurface = a < sure && pools.surface.length > 0;
    const sureUnderground = a < sure && pools.surface.length === 0;
    if (pools.surface.length > 0 && (rng.chance(surfacePermille, 1000) || sureSurface)) {
      const poi = pickWeightedPoi(rng, pools.surface).poi;
      discoveries.push({ id: `${exp.id}-${body.id}-disc-${discoveries.length}`, kind: "landmark", poiId: poi.id });
    }
    if (pools.underground.length > 0 && (rng.chance(undergroundPermille, 1000) || sureUnderground)) {
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
  // Squads SQ-4: a HOSTILE SITE the body's risk placed joins as one more discovery (and task), after every drawn
  // one so the discovery roll above is untouched, but ONLY when the squads the ship deployed can field it and
  // still keep a Science squad (user #3: no softlock). Never on a run without risk grades or ground teams.
  const site = body.risk?.site;
  if (site !== undefined && deployed !== null && hostileSiteFieldable(site, deployed)) {
    discoveries.push({ id: `${exp.id}-${body.id}-disc-${discoveries.length}`, kind: "landmark", poiId: site });
  }
  // Squads SQ-6 follow-up: the body's CLEARING TASKS (Security-only work its risk roll placed) join last, always
  // (their needs follow tierNeeds; a Tier III+ one the deployed squads cannot cover is skipped at planning). A run
  // dispatched before the follow-up has no `clearing` on its bodies, so it draws exactly as before.
  for (const id of body.risk?.clearing ?? []) {
    if (isClearingSiteId(id)) discoveries.push({ id: `${exp.id}-${body.id}-disc-${discoveries.length}`, kind: "landmark", poiId: id });
  }
  // Ground Ops GO-8: every SENSOR GHOST read true on this body while it scanned (a ship event with
  // bonusDiscovery) adds ONE discovery, last, each from its own keyed stream (shipScanEvents.ts ghostFindSeed),
  // never the body's discovery stream above, so the body's other discoveries are untouched. Draws: the pool
  // (when both have candidates), then the PoI. A run without ship events has no such event.
  for (const ev of exp.scanEvents ?? []) {
    if (ev.kind !== "shipEvent" || ev.bonusDiscovery !== true || ev.bodyIndex !== bodyIndex) continue;
    const ghost = makeRng(ghostFindSeed(exp, bodyIndex, ev.step));
    const both = pools.surface.length > 0 && pools.underground.length > 0;
    const surface = both ? ghost.nextInt(2) === 0 : pools.surface.length > 0;
    const pool = surface ? pools.surface : pools.underground;
    if (pool.length === 0) continue;
    const poi = pickWeightedPoi(ghost, pool).poi;
    discoveries.push({ id: `${exp.id}-${body.id}-disc-${discoveries.length}`, kind: surface ? "landmark" : "underground", poiId: poi.id });
  }
  // E-MOD EM-6 (the body-scanned trigger): each frozen body-scan module (Expedition.moduleScanProcs, module id order)
  // rolls its chance as the body completes, on ONE private stream per body (shipModules.ts moduleScanSeed), never the
  // body's discovery stream, so every discovery above is untouched; a landed extraDiscovery adds `count` discoveries,
  // last, each drawn like the ghost's (the pool when both have candidates, then the site). A run without the field
  // (every run today) takes no draw here.
  const scanProcs = exp.moduleScanProcs;
  if (scanProcs !== undefined && scanProcs.length > 0) {
    const stream = makeRng(moduleScanSeed(exp.seed, bodyIndex));
    for (const proc of scanProcs) {
      if (!rollModuleChance(stream, proc.chanceUnits)) continue;
      for (let k = 0; k < proc.count; k++) {
        const both = pools.surface.length > 0 && pools.underground.length > 0;
        const surface = both ? stream.nextInt(2) === 0 : pools.surface.length > 0;
        const pool = surface ? pools.surface : pools.underground;
        if (pool.length === 0) continue;
        const poi = pickWeightedPoi(stream, pool).poi;
        discoveries.push({ id: `${exp.id}-${body.id}-disc-${discoveries.length}`, kind: surface ? "landmark" : "underground", poiId: poi.id });
      }
    }
  }
  body.discoveries = discoveries;
  body.activities = discoveries.map((d, k) => ({
    id: `${exp.id}-${body.id}-act-${k}`,
    bodyId: body.id,
    poiId: d.poiId,
    done: false,
  }));
}

// The per-attempt discovery odds of each pool, in permille, on a planet type: the base odds + the planet type's pool
// bias + the sensor array's pool bias, x the captain's Anomaly Sense (WR-5c, its own factor, before the clamp; absent
// = the pre-WR-5c odds). The one formula assignDiscoveriesAndActivities rolls against (the wiring probe reads it). Pure.
export function discoveryOddsPermille(scanParams: ExpeditionScanParams, planetType: ExpeditionPlanetType): { surface: number; underground: number } {
  const planet = PLANET_TYPES.find((p) => p.id === planetType) ?? PLANET_TYPES[0];
  const oddsMult = scanParams.captainDiscoveryMult;
  const lift = (p: number): number => (oddsMult !== undefined && oddsMult > 0 && Number.isFinite(oddsMult) ? p * oddsMult : p);
  return {
    surface: clampPermille(lift(BASE_DISCOVERY_PERMILLE / 1000 + planet.surfaceBias + scanParams.landmarkOddsBias)),
    underground: clampPermille(lift(BASE_DISCOVERY_PERMILLE / 1000 + planet.undergroundBias + scanParams.undergroundPoiOddsBias)),
  };
}

// The discoveries the real roll gives `body` (at `bodyIndex`) on run `exp`, without touching either: a throwaway copy
// through assignDiscoveriesAndActivities (no hostile site joins: no deployed squads). Pure (the wiring probe reads it).
export function rollBodyDiscoveries(exp: Expedition, body: ExpeditionBody, bodyIndex: number): ExpeditionDiscovery[] {
  const copy: ExpeditionBody = { ...body, discoveries: [], activities: [] };
  assignDiscoveriesAndActivities({ ...exp, scanEvents: [] }, copy, bodyIndex, null);
  return copy.discoveries;
}

// Squads SQ-4 (design 5.3): a High or Extreme FLORA body draws Xeno-Flora Bloom sites more often: the Bloom's
// weight in its pool times riskFactors.ts FLORA_BLOOM_WEIGHT_MULT. The same pools come back untouched (the same
// reference) for any other body, so every run without risk grades draws exactly as before. Pure.
function floraWeightedPools(
  pools: { surface: WeightedPoi[]; underground: WeightedPoi[] },
  body: Pick<ExpeditionBody, "risk">,
): { surface: WeightedPoi[]; underground: WeightedPoi[] } {
  const mult = FLORA_BLOOM_WEIGHT_MULT[bodyFloraGrade(body)] ?? 1;
  if (!(mult > 1)) return pools;
  const lift = (list: WeightedPoi[]) => list.map((c) => (c.poi.id === "xenoFloraBloom" ? { poi: c.poi, weight: c.weight * mult } : c));
  return { surface: lift(pools.surface), underground: lift(pools.underground) };
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
  // GO-8: a flagged run WITH ship events (shipScanEvents.ts shipEventsLive) rolls draw 1 at the ship-event chance
  // (shipScanEventChance, the same formula); one dispatched before GO-8 keeps chance 0 (its exact shape).
  const chance = !body
    ? 0
    : !exp.groundOps
      ? clampPermille(scanEncounterChance(exp, body, scanDownedBefore(exp, bodyIndex, step), hoursOut))
      : shipEventsLive(exp)
        ? clampPermille(shipScanEventChance(exp, body, hoursOut))
        : 0;
  const encounter = rng.chance(chance, 1000);
  const cache = rng.chance(clampPermille(SUPPLY_CACHE_CHANCE), 1000);
  // Gas Giant Study GG-2 (user call 4, 2026-10-19: "Stop on gas giants"): no supply cache at an orbital body of a
  // study run (a cache is a ground find). Draw 2 is still taken, so the stream reads exactly as before.
  return { encounter, supplyCache: !encounter && cache && !(body !== undefined && isStudyBody(exp, body)) };
}

// Ground Ops GO-8: the per-boundary SHIP EVENT chance on `body` for a flagged run with ship events: the scan
// encounter formula (encounterChance: the body's hazard as the run presents it, the Security squad's Shroud /
// Lure dial [PROVISIONAL, Q11], Evasive Command ramped by the Flight Deck's Constitution at `hoursOut`, the
// event's WALL hours since dispatch). Unlike a ground battle nobody sits out (no ground fight while scanning),
// and the dial reads the whole union roster. Pure.
export function shipScanEventChance(exp: Expedition, body: ExpeditionBody, hoursOut: number = 0): number {
  return encounterChance(
    resistedHazard(body.hazard, exp.hazardResist ?? 0),
    squadEncounterBias(exp.roster?.security ?? [], fieldDeviceEffectiveness(exp.roster)),
    rampedEncounterEvasion(exp, hoursOut),
  );
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
  return scanClockThroughBodies(exp, exp.bodies.length);
}

// The scan clock at the end of the first `n` bodies (their scan times and recorded pauses, in the walk's own order),
// so the whole scan reads exactly as encounterScanDurationSeconds. G2-5: a resumed run's window opens this far into its
// clock (the bodies charted before). Pure.
function scanClockThroughBodies(exp: Expedition, n: number): number {
  const steps = exp.encounterSteps ?? 1;
  const events = exp.scanEvents ?? [];
  let bodyStart = 0;
  for (let i = 0; i < Math.min(n, exp.bodies.length); i++) {
    const body = exp.bodies[i];
    let paused = 0;
    for (let k = 1; k < steps; k++) paused += pauseAt(events, i, k);
    bodyStart = bodyStart + body.scanTotal / scanRatePerSecond(exp, body) + paused;
  }
  return bodyStart;
}

// Roll ONE step boundary (the caller latches it via the cursor) and record what happened. `at` is the
// boundary's elapsed-in-scanning time (for the loss pause). Mutates the working clone only.
// Ground Ops (GO-7b): on a flagged run `at` is the boundary's SCAN-CLOCK time; GO-8 reads the ramps at its WALL
// time (flaggedHoursAt(scanClockToTime(at)), the GO-7b carry note), and a fired draw 1 is a SHIP EVENT
// (shipScanEvents.ts): its finding is appended, its light hull damage added to the run (GroundOpsState.hullDamage).
function rollStepBoundary(exp: Expedition, events: ExpeditionScanEvent[], body: ExpeditionBody, bodyIndex: number, step: number, at: number): void {
  const ops = exp.groundOps;
  if (ops && shipEventsLive(exp)) {
    const hoursOut = flaggedHoursAt(exp, scanClockToTime(ops, at));
    const roll = scanStepRoll(exp, bodyIndex, step, hoursOut);
    if (roll.encounter) {
      const res = resolveShipScanEvent(exp, body, bodyIndex, step, hoursOut);
      if (res.finding) exp.findings.push(res.finding);
      // GO-9: boarders who were not repelled take a small share of the run's credits (never the player's bank).
      if (res.event.boarding?.creditsLost) takeBoardingLoss(exp.findings, res.event.boarding.creditsLost);
      events.push(res.event);
      if (res.event.hullWear) {
        ops.hullDamage = (ops.hullDamage ?? 0) + res.event.hullWear;
        // GO-8b (user WWVD): past the damage threshold the ship sets down for a field repair, starting now.
        maybeAutoFieldRepair(exp, scanClockToTime(ops, at));
      }
    } else if (roll.supplyCache) {
      const finding = rollSupplyCache(exp, body, bodyIndex, step);
      exp.findings.push(finding);
      events.push({ bodyIndex, step, kind: "supplyCache", findingId: finding.id });
    }
    return;
  }
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

// GO-14 (display only, the ship lane of the team timelines): a flagged run's scan as WALL-time spans, one per body
// the walk has reached (endsAt null while that body is still being scanned), plus every recorded scan PAUSE (a
// ship event's delay, GO-8 / GO-9) with its wall-time span. The same walk as flaggedScanNext over the boundaries
// already rolled (the cursor), mapped through scanClockToTime, so a recovery or repair leg inside a body's scan
// widens that body's span and a pause lands where the window applied it. Resolution never reads it. Pure.
export interface FlaggedScanSpan {
  bodyIndex: number;
  startsAt: number;
  endsAt: number | null; // null = this body is still being scanned
}
export interface FlaggedScanPause {
  bodyIndex: number;
  step: number;
  startsAt: number;
  endsAt: number;
  event: ExpeditionScanEvent;
}
export function flaggedScanTimeline(exp: Expedition): { bodies: FlaggedScanSpan[]; pauses: FlaggedScanPause[] } {
  const ops = exp.groundOps;
  const bodies: FlaggedScanSpan[] = [];
  const pauses: FlaggedScanPause[] = [];
  if (!ops || ops.startedAt === undefined) return { bodies, pauses };
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
      if (i * perBody + (k - 1) >= cursor) break; // not rolled yet
      const at = bodyStart + k * stepTime + paused;
      const pause = pauseAt(events, i, k);
      const event = events.find((ev) => ev.bodyIndex === i && ev.step === k);
      if (pause > 0 && event) {
        pauses.push({ bodyIndex: i, step: k, startsAt: scanClockToTime(ops, at), endsAt: scanClockToTime(ops, at + pause), event });
      }
      paused += pause;
    }
    const bodyEnd = bodyStart + bodyTime + paused;
    // G2-5: a resumed run's bodies charted before were scanned on an earlier trip (no span on this run's lane).
    if (i >= (exp.resume?.scannedBodies ?? 0)) bodies.push({ bodyIndex: i, startsAt: scanClockToTime(ops, bodyStart), endsAt: body.scanned ? scanClockToTime(ops, bodyEnd) : null });
    if (!body.scanned) break;
    bodyStart = bodyEnd;
  }
  return { bodies, pauses };
}

// Hours since dispatch at absolute time `t` of a flagged run's window (the transit is fully flown). Pure.
function flaggedHoursAt(exp: Expedition, t: number): number {
  // G2-5: a resumed run's startedAt sits its clock skip before the window opened (the transit ended there).
  const start = (exp.groundOps?.startedAt ?? t) + (exp.groundOps?.scanClockSkip ?? 0);
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
      if (e.phase === "scanning" && ops.startedAt === undefined) {
        ops.startedAt = e.phaseAnchorSeconds;
        // G2-5: a RESUMED run opens past the bodies charted before (openResumedWindow).
        if (e.resume) openResumedWindow(e);
      }
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

// CP-6 review: GHOST expeditions, whose ship is no longer in the fleet (a save that salvaged a hull on an
// expedition before CP-6 closed that gap). They keep advancing on their own record and claimExpedition
// claims them like any run (findings deposit, members unlock); the console lists them so they can be.
// Never auto-deleted. Pure.
export function orphanExpeditions(state: GameState): Expedition[] {
  if (state.expeditions.length === 0) return [];
  const live = new Set(state.ships.map((s) => s.id));
  return state.expeditions.filter((e) => !live.has(e.shipId));
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
// Gas Giant Study GG-5: research data units also join the Research Lab's held queue in arrival order
// (GameState.dataStudyHeld, dataStudy.ts dataArrivals: an Ancient Data Fragment with the culture of the body it came
// from, read off `exp`), so the lane studies the oldest first.
export function depositExpeditionFindings(state: GameState, findings: readonly ExpeditionFinding[], exp?: Pick<Expedition, "id" | "seed" | "region" | "risk">): GameState {
  let inventory = state.inventory;
  let discovered = state.discovered;
  let credits = state.credits;
  const vaultAdds: RelicVaultToken[] = [];
  // Gas Giant Study GG-3: a study's Survey Log readout (GameState.surveyLog, appended in finding order).
  const surveys: SurveyLogEntry[] = [];
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
        // WR-5c: a Preservationist token keeps its study speed in the vault (absent otherwise, the pre-WR-5c token).
        // Relics v2 R2-2: a stamped blank keeps its region tier and culture (absent on a token from before R2-2).
        const { studySpeed, regionTier, cultureId } = f.relic;
        vaultAdds.push({
          id: f.relic.id,
          tier: f.relic.tier,
          quality: f.relic.quality,
          setId,
          poiId: f.poiId,
          ...(studySpeed !== undefined && studySpeed > 0 ? { studySpeed } : {}),
          ...(regionTier !== undefined ? { regionTier } : {}),
          ...(cultureId !== undefined ? { cultureId } : {}),
        });
        touched = true;
      }
    }
    if (f.survey) {
      surveys.push({ ...f.survey });
      touched = true;
    }
  }
  if (!touched) return state;
  const arrivals = dataArrivals(findings, exp, state.relicSeed);

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
    ...(surveys.length > 0 ? { surveyLog: [...(state.surveyLog ?? []), ...surveys] } : {}),
    ...(arrivals.length > 0 ? { dataStudyHeld: [...(state.dataStudyHeld ?? []), ...arrivals] } : {}),
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
  // Field Kits FKR-7: the extras the run still carries come home, even over the warehouse cap (call 17); the SAME state
  // for a run that carries none (every run without flag 2).
  const deposited = depositExpeditionFindings(returnCarriedExtras(removed, exp), exp.findings, exp);
  // Ground Ops (GO-7b): a flagged run brings home the members still in the medical bay with the time they have
  // left (never the flat 2h); a legacy run keeps Task 16's injuries.
  const { next: home, injuries } = exp.groundOps ? applyGroundOpsInjuries(deposited, exp) : applyExpeditionInjuries(deposited, exp);
  // Ground Ops GO-8 (user Q12): the light hull damage the ship's scan events left comes home with it (the Shipyard
  // repairs it); none on a run without ship events (the SAME state).
  const repaired = applyShipEventDamage(home, exp);
  // WR-4 (B4, OC-E10): the run's promotion counters for the officers aboard the ship it flew: personnelAchievement
  // from the objectives its squads completed, shipsDestroyed from the ship battles it won (each a one-enemy fight,
  // shipScanEvents.ts). Counted at the claim, from the stored run (the crewHours of its time out accrue live, tick.ts).
  // Safe first runs SF-1: the run counters (runDifficulty.ts countClaimedExpedition): a completed run counts on the curve,
  // the training run marks training done instead, a recalled run changes nothing. Read from the PRE-claim state, so a
  // save without stored counters derives them with this run still out.
  const next = {
    ...repaired,
    // WR-5c: x the run's frozen Drillmaster (Expedition.explorerCaptain), exactly 1 without it.
    officers: foldOfficerPromotionCounters(repaired.officers, expeditionPromotionIncrements(exp), () => exp.explorerCaptain?.promotionMult ?? 1),
    runCounts: countClaimedExpedition(runCountsOf(state), exp),
  };
  return {
    next,
    success: true,
    findings: exp.findings,
    injuries,
  };
}

// WR-4 (B4): one claimed run's promotion counter increments, keyed by its ship. Pure.
function expeditionPromotionIncrements(exp: Expedition): Map<string, Partial<Record<PromotionObjectiveKind, number>>> {
  const objectives = exp.bodies.reduce((n, b) => n + b.activities.filter((a) => a.done).length, 0);
  const shipWins = (exp.scanEvents ?? []).filter((e) => e.kind === "shipEvent" && e.outcome === "win").length;
  const inc: Partial<Record<PromotionObjectiveKind, number>> = {};
  if (objectives > 0) inc.personnelAchievement = objectives;
  if (shipWins > 0) inc.shipsDestroyed = shipWins;
  return new Map(Object.keys(inc).length > 0 ? [[exp.shipId, inc]] : []);
}

// ============================================================================
// Expedition Tiers G2-5: RECALL and the RESUMABLE systems
// ============================================================================
//
// User decisions (verbatim records in the plan's USER ANSWERS and docs/plans/2026-10-19-merge-batch-answers.md):
//   - #7 "BAsed on distance traveled 1:1": recalled in transit, the ship flies home the time it has flown toward the
//     system (G14: the anomaly detour is not distance flown), at its own return speed and the Flight Deck ramp of the
//     time out so far; after arrival, the full return leg. Never longer than an ordinary return.
//   - #4 "you retain your progress": after arrival the operations window closes at the recall instant
//     (groundOps.ts closeGroundOps): objectives in progress stop with their progress kept, finished work comes home,
//     teams on a surface come up on one shared in-system pickup before the return leg, the medical bay works on the
//     way home.
//   - G12 "Resumable": a system with charted bodies stays open (GameState.heldSystems, kind "resume"); "Any explorer"
//     resumes it, "Until finished" or abandoned (one confirm, the console's), "Pick up where you left off": finished
//     scans stay done, objectives keep their progress, the trip is flown again. Mockup sign-off (2026-10-21): a recall
//     BEFORE anything was charted returns the system to the ordinary candidates (kind "candidate").
//   - G13 "One confirm": the console's confirm names the return time and whether the system can be resumed
//     (recallPreview). No Overtime on expeditions (user 2026-10-20): the recall never offers a paid speed-up.
// A recall is a player action at an instant (the run is advanced to now first, the editGroundOps contract); after it
// the run is again a pure function of its stored record. Allowed in transit, scanning and activities; refused once
// the run is returning or complete. A run in flight from before G2-5 can be recalled too (a new action changes no run
// nobody recalls); one without a region stamp (before G2-2) or without Ground Ops leaves no held system.

export type RecallBlockReason = "noExpedition" | "returning" | "complete";

// What a recall at the state's now would do (the confirm's numbers): the whole way home, its pickup, where it turns,
// and what is left behind ("resume" / "candidate" / null). Read from the same recall the action applies. Pure.
export interface RecallPreview {
  phase: ExpeditionRecall["phaseAtRecall"];
  returnSeconds: number;
  pickupSeconds: number;
  held: HeldSystem["kind"] | null;
}

// The player-facing line of a refusal (US English). EXHAUSTIVE with no default. Pure.
export function recallBlockText(reason: RecallBlockReason): string {
  switch (reason) {
    case "noExpedition":
      return "That expedition is no longer out";
    case "returning":
      return "The ship is already on its way home";
    case "complete":
      return "The ship is home: claim the expedition";
  }
}

// The stored recall when well formed, else undefined. Pure.
function recallOf(exp: { recall?: unknown }): ExpeditionRecall | undefined {
  const r = exp.recall as Partial<ExpeditionRecall> | undefined;
  if (typeof r !== "object" || r === null) return undefined;
  return typeof r.returnSeconds === "number" && Number.isFinite(r.returnSeconds) && r.returnSeconds >= 0 ? (r as ExpeditionRecall) : undefined;
}

// When the run's transit ended (its window opened), for the hours out of a recall after arrival. Pure.
function transitEndedAt(exp: Expedition): number {
  if (exp.phase === "scanning") return exp.phaseAnchorSeconds;
  const ops = exp.groundOps;
  if (ops && ops.startedAt !== undefined) return ops.startedAt + (ops.scanClockSkip ?? 0);
  return exp.phaseAnchorSeconds - scanningDurationSeconds(exp);
}

// The outbound time flown toward the system `elapsed` seconds into the transit: the detour, inserted at the anomaly
// check, is never distance flown (user G14). Pure.
function outboundFlown(exp: Expedition, elapsed: number): number {
  const base = baseTransitSeconds(exp);
  const mid = base * ANOMALY_CHECK_FRACTION;
  if (elapsed <= mid || !exp.anomalyCharted) return Math.max(0, Math.min(base, elapsed));
  return Math.max(mid, Math.min(base, elapsed - anomalyDetourSeconds(exp)));
}

// The return leg after `hoursOut` hours out, at the Flight Deck ramp (exactly the ordinary leg's rule). Pure.
function rampedReturnLeg(exp: Expedition, base: number, hoursOut: number): number {
  if (!exp.rampReturn) return base;
  const ramp = constitutionRamp(exp.rampReturn, hoursOut);
  return ramp === 0 ? base : base / (1 + ramp);
}

// The run's leading charted bodies (a scan runs in body order, so the scanned bodies are a prefix). Pure.
function chartedPrefix(bodies: readonly ExpeditionBody[]): number {
  let n = 0;
  while (n < bodies.length && bodies[n].scanned) n += 1;
  return n;
}

// Is anything left to do in the system (a body to scan, an objective not done)? Pure.
// Gas Giant Study GG-3: a held study body (heldBodies) whose study is not finished is unfinished too.
function systemUnfinished(exp: Pick<Expedition, "study">, bodies: readonly ExpeditionBody[]): boolean {
  return bodies.some((b) => !b.scanned || b.activities.some((a) => !a.done) || (isStudyBody(exp, b) && b.studied !== true));
}

// The held record a recall of `exp` (already advanced and recalled at `t`) leaves behind, or null. Pure: fresh data.
function heldFromRecall(exp: Expedition, t: number): HeldSystem | null {
  const region = exp.region;
  if (!region) return null;
  const base = {
    version: 1 as const,
    id: `held-${exp.id}`,
    fromExpeditionId: exp.id,
    heldAt: t,
    seed: exp.seed,
    systemId: exp.targetSystemId,
    systemName: exp.systemName,
    famousId: famousSystem(exp.targetSystemId)?.id ?? null,
    region: { ...region },
  };
  const charted = chartedPrefix(exp.bodies);
  if (charted === 0) return { ...base, kind: "candidate" };
  if (!exp.groundOps || !exp.risk) return null;
  const bodies = heldBodies(exp);
  // GG-4: a nebula swept on this trip (or on an earlier one) is not swept again; one the recall cut short (or never
  // reached) keeps the system unfinished, so it is resumable for its sweep alone.
  const swept = exp.nebula !== undefined && (exp.nebula.swept === 1 || (exp.groundOps.studyLegs ?? []).some((l) => l.nebula === 1 && l.done === true));
  const sweepLeft = sweepsNebula(exp) && !swept;
  if (!systemUnfinished(exp, bodies) && !sweepLeft) return null;
  return { ...base, kind: "resume", risk: { ...exp.risk }, bodies, ...(swept ? { nebulaSwept: true as const } : {}) };
}

// The bodies a resume record keeps (user G12 "Pick up where you left off"): charted bodies whole, with their
// objectives back in the queue (nothing assigned, no streak, no alert: a new crew lands on them after a trip home and
// back), progress, cleared fight points and banked segments kept; an unfinished body's scan starts over. Pure.
// Gas Giant Study GG-3: a charted giant whose study finished on this trip is marked `studied` (the resumed run does not
// study it again); one cut short by the recall is not, so the resumed run studies it from the start.
function heldBodies(exp: Pick<Expedition, "bodies" | "groundOps" | "study">): ExpeditionBody[] {
  const studiedNow = new Set((exp.groundOps?.studyLegs ?? []).filter((l) => l.done).map((l) => l.bodyIndex));
  return exp.bodies.map((b, i) => {
    if (!b.scanned) return { ...b, scanProgress: 0, discoveries: [], activities: [] };
    return {
      ...b,
      ...(isStudyBody(exp, b) && studiedNow.has(i) ? { studied: true as const } : {}),
      discoveries: b.discoveries.map((d) => ({ ...d })),
      activities: b.activities.map((a) => {
        const c = cloneActivity(a);
        if (c.done) return c;
        c.status = "queued";
        delete c.assignedTeamIds;
        delete c.lossStreak;
        delete c.sentBack;
        delete c.alert;
        return c;
      }),
    };
  });
}

// The bodies a resumed dispatch flies to: the held bodies, copied. Pure.
function resumedBodies(held: HeldSystem): ExpeditionBody[] {
  return (held.bodies ?? []).map((b) => ({ ...b, discoveries: b.discoveries.map((d) => ({ ...d })), activities: b.activities.map(cloneActivity) }));
}

// Open a RESUMED run's window (advanceExpedition, at the scanning anchor): the scan clock starts past the bodies
// charted before (their scan time on THIS run's sensors, no pauses: their boundaries are not rolled again), and those
// bodies' remaining objectives are planned for this run's teams (groundOps.ts openResumedGroundOps). Mutates the clone.
function openResumedWindow(e: Expedition): void {
  const ops = e.groundOps;
  const resume = e.resume;
  if (!ops || !resume) return;
  const charted = Math.max(0, Math.min(e.bodies.length, Math.floor(resume.scannedBodies)));
  const skip = scanClockThroughBodies(e, charted);
  const open = e.phaseAnchorSeconds;
  ops.startedAt = open - skip;
  if (skip > 0) ops.scanClockSkip = skip;
  e.scanStepCursor = charted * Math.max(0, (e.encounterSteps ?? 1) - 1);
  openResumedGroundOps(e, charted, open);
}

// The held systems of the save (oldest first). Pure.
export function heldSystems(state: Pick<GameState, "heldSystems">): HeldSystem[] {
  return Array.isArray(state.heldSystems) ? state.heldSystems : [];
}
function heldSystemById(state: Pick<GameState, "heldSystems">, id: string): HeldSystem | null {
  if (!id.startsWith("held-")) return null;
  return heldSystems(state).find((h) => h.id === id) ?? null;
}

// A held system as a candidate (its own id; slot -1: it is not one of the list's slots). Pure.
function heldCandidateSystem(h: HeldSystem): CandidateSystem {
  return {
    id: h.id,
    tier: h.region.tier,
    slot: -1,
    seed: h.seed,
    systemId: h.systemId,
    systemName: h.systemName,
    famousId: h.famousId,
    bearing: h.region.bearing,
    distanceLy: h.region.distanceLy,
    region: { tier: h.region.tier, enemyTerritory: h.region.enemyTerritory },
  };
}

// The ordinary candidates a recall returned to `tier` (kind "candidate"), oldest first. Pure.
function heldCandidates(state: Pick<GameState, "heldSystems">, tier: RegionTier): CandidateSystem[] {
  return heldSystems(state).filter((h) => h.kind === "candidate" && h.region.tier === tier).map(heldCandidateSystem);
}

// One resumable system for the console (the mockup's Resume card): its identity, its charted bodies and the
// objectives with progress kept, and its completion (groundOps.ts groundOpsProgress over its objectives). Pure.
export interface ResumableSystemView {
  id: string;
  tier: RegionTier;
  systemName: string;
  distanceLy: number;
  bodies: number;
  bodiesScanned: number;
  objectivesInProgress: number;
  progress: number; // 0..1
}
export function resumableSystems(state: Pick<GameState, "heldSystems">, tier?: RegionTier): ResumableSystemView[] {
  return heldSystems(state)
    .filter((h) => h.kind === "resume" && (tier === undefined || h.region.tier === tier))
    .map((h) => {
      const bodies = h.bodies ?? [];
      return {
        id: h.id,
        tier: h.region.tier,
        systemName: h.systemName,
        distanceLy: h.region.distanceLy,
        bodies: bodies.length,
        bodiesScanned: bodies.filter((b) => b.scanned).length,
        objectivesInProgress: bodies.reduce((n, b) => n + b.activities.filter((a) => !a.done && (a.progress ?? 0) > 0).length, 0),
        progress: groundOpsProgress({ bodies }, 0),
      };
    });
}

// ABANDON a resumable system (one confirm, the console's): its saved progress is let go; findings already claimed stay
// claimed. Refused (the SAME state) for an id that is not a resumable system. Pure.
export function canAbandonHeldSystem(state: Pick<GameState, "heldSystems">, id: string): boolean {
  return heldSystemById(state, id)?.kind === "resume";
}
export function abandonHeldSystem(state: GameState, id: string): GameState {
  if (!canAbandonHeldSystem(state, id)) return state;
  return { ...state, heldSystems: heldSystems(state).filter((h) => h.id !== id) };
}

// The recall of `exp` at `t` (the run advanced to `t` first): the recalled run and what it leaves behind, or the
// refusal. Pure: fresh data, the input untouched.
function recallAt(exp: Expedition, t: number): { ok: true; exp: Expedition; held: HeldSystem | null } | { ok: false; reason: RecallBlockReason } {
  const e = advanceExpedition(exp, t);
  if (e.phase === "complete") return { ok: false, reason: "complete" };
  if (e.phase === "return") return { ok: false, reason: "returning" };
  const r = e === exp ? cloneExpedition(exp) : e;
  const phaseAtRecall = r.phase as ExpeditionRecall["phaseAtRecall"];
  let pickupSeconds = 0;
  let returnSeconds: number;
  let flownSeconds: number | undefined;
  if (phaseAtRecall === "transit") {
    const elapsed = Math.max(0, t - r.phaseAnchorSeconds);
    flownSeconds = outboundFlown(r, elapsed);
    const base = baseTransitSeconds(r);
    const share = base > 0 ? flownSeconds / base : 0;
    returnSeconds = Math.round(rampedReturnLeg(r, baseReturnSeconds(r) * share, elapsed / 3600));
  } else {
    if (r.groundOps) pickupSeconds = closeGroundOps(r, t, GROUND_OPS_SCAN_DRIVER);
    const hoursOut = (transitDurationSeconds(r) + Math.max(0, t - transitEndedAt(r))) / 3600;
    returnSeconds = pickupSeconds + Math.round(rampedReturnLeg(r, baseReturnSeconds(r), hoursOut));
  }
  const held = heldFromRecall(r, t);
  r.recall = {
    version: 1,
    atSeconds: t,
    phaseAtRecall,
    ...(flownSeconds !== undefined ? { flownSeconds } : {}),
    pickupSeconds,
    returnSeconds,
    ...(held ? { held: held.id } : {}),
  };
  r.phase = "return";
  r.phaseAnchorSeconds = t;
  return { ok: true, exp: r, held };
}

// Can the player recall this expedition now? Pure.
export function canRecallExpedition(state: GameState, expeditionId: string): { ok: true } | { ok: false; reason: RecallBlockReason } {
  const exp = state.expeditions.find((e) => e.id === expeditionId);
  if (!exp) return { ok: false, reason: "noExpedition" };
  const res = recallAt(exp, state.gameTimeSeconds);
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

// The confirm's numbers (G13): exactly what recallExpedition would freeze now, or the refusal. Pure.
export function recallPreview(state: GameState, expeditionId: string): { ok: true; preview: RecallPreview } | { ok: false; reason: RecallBlockReason } {
  const exp = state.expeditions.find((e) => e.id === expeditionId);
  if (!exp) return { ok: false, reason: "noExpedition" };
  const res = recallAt(exp, state.gameTimeSeconds);
  if (!res.ok) return res;
  const rc = res.exp.recall!;
  return { ok: true, preview: { phase: rc.phaseAtRecall, returnSeconds: rc.returnSeconds, pickupSeconds: rc.pickupSeconds, held: res.held?.kind ?? null } };
}

// RECALL the expedition now: the run turns for home (it claims like any run once home) and its system is held as the
// recall leaves it. A refusal returns the SAME state. Pure.
export function recallExpedition(state: GameState, expeditionId: string): GameState {
  const index = state.expeditions.findIndex((e) => e.id === expeditionId);
  if (index < 0) return state;
  const res = recallAt(state.expeditions[index], state.gameTimeSeconds);
  if (!res.ok) return state;
  const expeditions = state.expeditions.map((e, i) => (i === index ? res.exp : e));
  return { ...state, expeditions, ...(res.held ? { heldSystems: [...heldSystems(state), res.held] } : {}) };
}

// ============================================================================
// Ground Operations GO-7d: live queue edits ("apply from now")
// ============================================================================
//
// The player edits a running operation's queues (groundOps.ts GroundOpsEdit; the GO-13 queue screen's handler
// calls editGroundOps). Order: (1) ADVANCE the run to state.gameTimeSeconds (advanceExpedition: everything up to
// now has happened), (2) validate (groundOps.ts checkGroundOpsEdit), (3) apply at now, count the edit
// (editCount += 1) and let idle teams pick their next work at now (groundOps.ts applyGroundOpsEdit), (4) settle
// the phase latches at now (an edit that closes the window moves the run on to its return leg). Pure: a
// refusal returns the SAME state reference; the stored expedition is never mutated. Allowed while the
// operations window is open (scanning or activities; the queues of the bodies scanned so far) and during the
// transit (only the help toggle has anything to change then); refused once the window has closed.

// The run advanced to now, ready for an edit, or the reason it cannot be edited. Pure.
function groundOpsEditTarget(
  state: GameState,
  expeditionId: string,
): { ok: true; exp: Expedition; index: number } | { ok: false; reason: "noExpedition" | "notGroundOps" | "runFinished" } {
  const index = state.expeditions.findIndex((e) => e.id === expeditionId);
  if (index < 0) return { ok: false, reason: "noExpedition" };
  const stored = state.expeditions[index];
  if (!stored.groundOps) return { ok: false, reason: "notGroundOps" };
  const exp = advanceExpedition(stored, state.gameTimeSeconds);
  if (exp === stored) return { ok: false, reason: "runFinished" }; // only a complete run comes back unchanged
  return { ok: true, exp, index };
}

// Can `edit` be applied to expedition `expeditionId` now? (Advances a copy to now to read it.) Pure.
export function canEditGroundOps(state: GameState, expeditionId: string, edit: GroundOpsEdit): GroundOpsEditCheck {
  const target = groundOpsEditTarget(state, expeditionId);
  if (!target.ok) return target;
  return checkGroundOpsEdit(target.exp, edit);
}

// Apply `edit` to expedition `expeditionId` now (see the block above). Pure: the SAME state on a refusal.
export function editGroundOps(state: GameState, expeditionId: string, edit: GroundOpsEdit): GameState {
  const target = groundOpsEditTarget(state, expeditionId);
  if (!target.ok) return state;
  if (!applyGroundOpsEdit(target.exp, edit, state.gameTimeSeconds).ok) return state;
  const settled = advanceExpedition(target.exp, state.gameTimeSeconds);
  return { ...state, expeditions: state.expeditions.map((e, i) => (i === target.index ? settled : e)) };
}

// ============================================================================
// Ground Operations GO-8b: the player's FIELD REPAIR order (groundOps.ts "EXPEDITION FIELD REPAIR")
// ============================================================================
//
// The player can order the ship to set down for repairs at any time while the operations window is open and the
// ship carries damage (no UI yet). Order: advance the run to now, validate (groundOps.ts fieldRepairBlock), store
// the repair leg starting now (or when the ship is free of a leg under way), then settle at now. Pure: a refusal
// returns the SAME state; the stored expedition is never mutated.

export type FieldRepairOrderBlockReason = "noExpedition" | "notGroundOps" | FieldRepairBlockReason;

// Can the ship of expedition `expeditionId` be ordered to set down for repairs now? (Advances a copy.) Pure.
export function canOrderFieldRepair(state: GameState, expeditionId: string): { ok: true } | { ok: false; reason: FieldRepairOrderBlockReason } {
  const target = groundOpsEditTarget(state, expeditionId);
  if (!target.ok) return { ok: false, reason: target.reason === "runFinished" ? "runFinished" : target.reason };
  const blocked = fieldRepairBlock(target.exp);
  return blocked ? { ok: false, reason: blocked } : { ok: true };
}

// Order the field repair now (see above). Pure: the SAME state on a refusal.
export function orderFieldRepair(state: GameState, expeditionId: string): GameState {
  const target = groundOpsEditTarget(state, expeditionId);
  if (!target.ok || fieldRepairBlock(target.exp) !== null) return state;
  if (!scheduleFieldRepair(target.exp, state.gameTimeSeconds, true)) return state;
  const settled = advanceExpedition(target.exp, state.gameTimeSeconds);
  return { ...state, expeditions: state.expeditions.map((e, i) => (i === target.index ? settled : e)) };
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
