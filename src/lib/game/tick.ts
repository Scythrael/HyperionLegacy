// Tick loop, tech spec §2 (Tick Loop and Time Semantics).
// Phase 4 (docs/plans/2026-07-06-phase4-navigation-progression-overhaul-plan.md):
// the Generator Stack economy (tickCaptainStack) and everything built on top
// of it (Research, both Prestige tiers, the Skill Tree) have been removed.
// Missions (tickCaptainMission, below) are now the ONLY economy, an idle
// captain (mission === null) does nothing on a tick; there is no more
// passive production to compute for them. tick() advances the fleet-wide
// gameTimeSeconds once per call (not once per captain, gameTimeSeconds is
// fleet bookkeeping, not tied to any single captain's production).

import Decimal from "break_infinity.js";
import {
  requiredTicksForPhase,
  effectiveMissionDef,
  xpForNextLevel,
  xpForNextFleetAdminLevel,
  craftingXpForNext,
  CRAFTING_XP_PER_DURATION_TICK,
  // 0.12.1 FA-XP unblock: the per-durationTick FA XP multiplier for a completed
  // FA-feeding process, the FA twin of CRAFTING_XP_PER_DURATION_TICK. Sized in
  // model.ts (tunable placeholder). Applied in resolveProcesses' completion lump.
  FLEET_ADMIN_XP_PER_DURATION_TICK,
  rollQuality,
  // Equipment 0.11.0 (Task 19): the base craftable-rarity roll for a freshly minted piece
  // (one seeded draw, Standard..Radiant) + the rarity type generateEquipment consumes.
  rollCraftedRarity,
  type EquipmentRarity,
  MISSIONS,
  BASE_XP_PER_TICK,
  // Combat 0.13.0 (Phase 9b.5a): the patrol content table + its shapes, for patrol
  // dispatch (canDispatchPatrol / dispatchCaptainOnPatrol) and the economyTick kind routing.
  PATROLS,
  SHIP_TYPES,
  CAPTAIN_TALENTS,
  CAPTAIN_SPEC_BONUS,
  HOMEWORLD_TALENTS,
  FACILITIES,
  REFINE_RECIPES,
  ITEMS,
  freshCaptainStack,
  shipDerivedStats,
  // Equipment 0.11.0 (Task 20): the shared Standard-Issue seeder, so a ship minted by a
  // shipBuild completion or a captain-slot unlock is born fully fitted on every live slot
  // (never-empty invariant), the SAME helper freshState + the save migration use.
  seedStandardIssueForShip,
  // Combat 1.0 (Unit 1.3): the combat parallel, so a newly-built or newly-granted COMBAT hull
  // is also born with its free Standard-Issue combat set (weapon + shield emitter + hull plating)
  // installed, keeping it dispatchable past the new empty-required-slot dispatch blocker below.
  seedCombatStandardIssueForShip,
  generateCombatStandardIssue,
  // Combat-defense rework (2026-08-27, HYBRID model): the FIXED Standard-Issue gear dials (SI_PLATING_HP =
  // 100 additive hull floor; SI_EMITTER_CAP = 300, SI_EMITTER_RECHARGE = 6, the shield references). The SI
  // combat baseline carries these hull-INDEPENDENT magnitudes; the bridge ADDS the plating to the hull's
  // bare frame and MULTIPLIES the emitter by the hull's shield effectiveness, so an SI set still recomposes
  // to the hull's exact pre-gear totals (byte-identical).
  SI_PLATING_HP,
  SI_EMITTER_CAP,
  SI_EMITTER_RECHARGE,
  type CombatStandardIssueSpec,
  type ItemDef,
  type GameState,
  type EquipmentInstance,
  type ShipTypeKey,
  type ShipTypeDef,
  type ShipInstance,
  type CaptainState,
  type CaptainStopReason,
  type CaptainMissionState,
  type PatrolMissionState,
  type PatrolKey,
  type PatrolDef,
  type PatrolPhase,
  type LootMaterialKey,
  type MissionDef,
  type ShipDerivedStats,
  type MissionPhase,
  type MissionKey,
  type CaptainTalentKey,
  type HomeworldTalentKey,
  type CaptainTalentBranch,
  type CaptainTalentEffect,
  type HomeworldTalentEffect,
  type TimedProcess,
  type TimedProcessKind,
  type ProcessEffect,
  // The single-order model (RefineOrder / FabricateOrder + their *Mode unions + the
  // startRefineOrder/startFabricateOrder setters) is fully RETIRED as of Task C4, the
  // per-slot production LINES (startLine/cancelLine, below) replace it. Nothing here
  // imports the order types anymore.
  WAREHOUSE_T1_BASE_CAP,
  WAREHOUSE_T2_BASE_CAP,
  FUEL_TANK_BASE_CAP,
  FUEL_CREDITS_PER_UNIT,
  REFUEL_PENALTY_TICKS,
  FUEL_REFINE_INPUT,
  FUEL_REFINE_OUTPUT,
  FUEL_REFINE_DURATION_TICKS,
  FUEL_DEPOT_BASE_PIPELINES,
  RESEARCH_FACILITY_KEY,
  FABRICATOR_FACILITY_KEY,
  SHIPYARD_FACILITY_KEY,
  BLUEPRINTS,
  blueprintKind,
  blueprintMintsEquipmentInstance,
  blueprintUnlocked,
  // Equipment 0.11.0 Task B1: the spare-storage-cap seam. equipmentAtCap is the
  // equipment twin of materialAtCap, consulted by both fabricate gates below to refuse
  // STARTING a new equipment craft when the spare pool is full.
  equipmentAtCap,
  // Equipment 0.11.0 Task B2: the equipment-storage upgrade track. The cap-raising
  // action (canUpgradeEquipmentStorage / startEquipmentStorageUpgrade, below) reads
  // the NEXT rung's cost/duration off this to spend + start a timed upgrade process.
  EQUIPMENT_STORAGE_RUNGS,
  // Fleet Management (Docks Expansion): the docks-capacity upgrade track. The
  // cap-raising action (canUpgradeDocks / startDocksExpansion, below) reads the NEXT
  // rung's cost/duration off SHIP_DOCKS_RUNGS to spend + start a timed process, and
  // SHIP_DOCKS_BASE lets it derive the current rung INDEX from shipStorageCapacity
  // (the single source) rather than a separate stored level.
  SHIP_DOCKS_BASE,
  SHIP_DOCKS_RUNGS,
  // Combat 0.13.0 (Phase 11/11b, design S13): the ship-repair + shared-bay tunables the
  // loss/repair loop reads. REPAIR_BASE_TICKS/REPAIR_TICKS_PER_HULL drive the repair-duration
  // formula; SHIPYARD_BAY_BASE + BUILD_CONCURRENCY_CAP drive the shared build/repair bay pool
  // (shipyardBayCount + shipBuildSlotCount + processShipRepairs below).
  REPAIR_BASE_TICKS,
  REPAIR_TICKS_PER_HULL,
  SHIPYARD_BAY_BASE,
  BUILD_CONCURRENCY_CAP,
} from "./model";
import { fuelNeeded, fuelForRoundTrip } from "./fuel";
// Combat 0.13.0 (Phase 9b.5a): patrol dispatch helpers. combatHullTypeOf gates the
// combat-hull requirement + resolves the CombatHullType for the drone default;
// defaultDronesForHull seeds a carrier patrol's carry-state drones; planWaveSchedule
// resolves the persisted wave schedule at dispatch (a pure fn of the master seed).
import { combatHullTypeOf, COMBAT_DEFAULT_LOADOUT, defaultDronesForHull, installedDronesForPatrol, defaultSystemDurabilityForHull, foldedPlayerDefense, type CombatHullType } from "./combat/bridge";
// Combat 1.0 (Unit 1.4): WeaponId types the per-hull Standard-Issue weapon loadout the combat
// baseline seeder + installMissingCombatBaselines build (type-only, no runtime coupling).
import type { WeaponId } from "./combat/weapons";
// Combat 1.0 (Unit 2.3a): DroneRole types the per-hull Standard-Issue drone-pod roles the same
// seeder + installMissingCombatBaselines build (type-only, no runtime coupling).
import type { DroneRole } from "./combat/drones";
import { planWaveSchedule, patrolWaveParams } from "./combat/waveSchedule";
// Combat 0.13.0 (Phase 12b-1 review): the pure per-wave seed derivation + its four salt
// constants now live in their own dependency-free combat/ leaf (waveSeed.ts) so the
// DISPLAY-ONLY patrol replay imports them DOWN from a leaf instead of UP from this live
// loop. tick.ts imports them here and uses them exactly as before; the values are
// value-identical to their former in-file definitions (a pure relocation).
import {
  deriveWaveSeed,
  WAVE_ENEMY_SEED_SALT,
  WAVE_BATTLE_SEED_SALT,
  WAVE_LOOT_SEED_SALT,
  RELAUNCH_SEED_SALT,
} from "./combat/waveSeed";
import type { CombatStance } from "./combat/positioning";
// Combat 0.13.0 (Phase 9b.5c): the patrol TICK LOOP wiring. generateEnemyWave builds a
// wave's enemy team from the patrol def; resolveBattle runs one wave's battle and returns
// the id-sorted finalCombatants the loop reads the player's surviving hull/shield/drones
// off; replenishDrones is the between-wave (out-of-combat) drone recovery; DroneSquadron is
// the carry-state squadron shape the deep-clone helper preserves.
import { generateEnemyWave } from "./combat/enemyWave";
import { resolveBattle } from "./combat/resolveBattle";
import { replenishDrones } from "./combat/droneDefense";
import type { DroneSquadron } from "./combat/drones";
// Combat 0.13.0 (Phase 12b-1): the SHARED per-wave leaves. buildPatrolPlayerCombatant
// builds the wave's player combatant from the carry-state; regenPatrolShield is the
// between-wave shield-regen formula. The DISPLAY-ONLY patrol replay (patrolReplay.ts)
// calls these SAME leaves, so the watchable replay stays byte-identical to this live
// loop by construction (parity is structural, not coincidental).
import { buildPatrolPlayerCombatant, regenPatrolShield, capturePlayerSystemDurability } from "./combat/patrolWave";
// Combat 0.13.0 (Phase 10, design S12): the seeded per-won-wave PATROL LOOT roller.
// rollWaveLoot(table, seed) is the PURE reward roll a defeated wave (a wreck) yields;
// PatrolLootTable is the data-driven table shape. tick.ts owns the seed derivation (a
// distinct loot salt off deriveWaveSeed) + the concrete PATROL_LOOT_TABLES below, and
// folds each won wave's reward through the SAME homePlanetDelta/credits/XP deltas the
// extraction arm uses. See patrolLoot.ts for the determinism + no-gear invariants.
import { rollWaveLoot, type PatrolLootTable } from "./combat/patrolLoot";
// Equipment 0.11.0 (Task 19): the Fabricator's equipment mint. computeItemLevel derives a
// crafted piece's level (clamped by the blueprint-tier cap), generateEquipment rolls the whole
// EquipmentInstance from an INJECTED seeded rng (so the mint is offline==live reproducible), and
// EQUIPMENT_ILEVEL_CAP_PER_TIER is the first-pass per-tier level ceiling the mint feeds in.
import { computeItemLevel, generateEquipment, generateWeapon, generateDronePod, EQUIPMENT_ILEVEL_CAP_PER_TIER } from "./itemgen";
// Equipment 0.11.0 (Task 13/14): equippedFor resolves a ship's fitted pieces so both
// the mission-resolution seam (economyTick) and the dispatch gate (canDispatch) can
// fold equipment stats into shipDerivedStats from the SAME single source of truth.
import { equippedFor } from "./equipment";
// Crafting Allocation Redesign (Task C2): the per-slot line engine below reuses C1's
// pure allocation core, `lineInputsPerIteration` builds a line's per-iteration input
// map from the recipe registries (the SAME map startRefineJob/startFabricateJob build
// inline), and `CraftLine`/`CraftLineMode` are the line + run-mode shapes.
// Crafting Allocation Redesign (Task C3): canStartLine's `materials` gate + the
// maxAffordableIterations cap both read `freeItem` (inventory MINUS what active lines
// already reserved) so a new line can only reserve from the currently-free pool.
// Shipyard Task S2: `freeItemForState` is the state-taking convenience over freeItem
// used by canBuildFacilityUpgrade's material gate (and S3's canBuildShip) to spend on
// the reservation-aware `free` pool instead of raw inventory, closing the facility-
// upgrade leak documented in KNOWN_ISSUES (an upgrade could spend craft-line-reserved ore).
import { lineInputsPerIteration, freeItem, freeItemForState, type CraftLine, type CraftLineKind, type CraftLineMode } from "./allocation";
// Quality-bucketed inventory helpers (Equipment 0.11.0, Task 9a): every inventory
// read/write routes through these so the economy is identical to the old scalar shape.
import { itemTotal, addItemQuality, removeItemLowestFirst } from "./inventory";
// Captain custom-name validation seam (Combat 0.13.0, Task 1.4): renameCaptain
// runs every proposed name through this single client-side chokepoint before it
// touches state. See captainName.ts for the (deliberately minimal, bypassable)
// scope; server-side moderation in 0.14.0 plugs into the same signature.
import { validateCaptainName } from "./captainName";

// Must stay in sync with MissionPhase and requiredTicksForPhase's switch --
// there's no compiler link between this array and the union type, so a 6th
// phase added to MissionPhase without a matching entry here would silently
// wrap `.indexOf()` to -1 instead of erroring.
const MISSION_PHASE_ORDER: MissionPhase[] = ["ordersReceived", "transitOut", "extracting", "transitBack", "unloading"];

// Combat 0.13.0 (Phase 9b.5a): compile-time exhaustiveness guard for the discriminated
// CaptainState.mission union (keyed on MissionKind). Called in the DEFAULT arm of a
// switch over `mission.kind`: because its parameter is typed `never`, TS accepts the call
// ONLY when every kind has been handled by a prior case; adding a future MissionKind
// without a matching case makes `captain.mission` non-`never` there and FAILS to compile,
// forcing the new kind to be handled. Throws at runtime as a last resort (unreachable in
// well-typed code). Mirrors the "switch exhaustively" intent noted in combat/types.ts.
function assertNeverMission(mission: never): never {
  throw new Error(`Unhandled mission kind: ${JSON.stringify(mission)}`);
}

// Equipment 0.11.0 (Task 13/14 -> RETIRED in Task 20): the interim `fittedPieces`
// helper that used to guard `state.equipment ? equippedFor(...) : []` was DELETED here.
// It existed only to tolerate a pre-migration save with no equipment pool; the v27->v28
// Standard-Issue seed (save.ts MIGRATIONS[27]) now guarantees `state.equipment` on every
// save, so the fold's three consumers (economyTick / canDispatch /
// dispatchCaptainOnMission) call equippedFor(state, shipId) DIRECTLY. A genuinely missing
// pool now throws loudly at equippedFor's `.filter` instead of silently reading as "no
// gear" (Omega 6/10), which is the intended fail-loud posture once the field is guaranteed.

function emptyLootTotals(): Record<LootMaterialKey, Decimal> {
  return { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) };
}

// Progression Pacing Rework (Task 6): the mission-relevant subset of
// GameState.lifetimeStats that tickCaptainMission accrues and returns per call,
// for tick() to fold into the fleet-wide lifetimeStats. Deliberately a SUBSET --
// itemsRefined/itemsCrafted are NOT here because missions produce no
// refined/crafted goods (no refinery/fabricator runs in this function); those
// two maps stay untouched by the mission economy (they'll be fed by the crafting
// path in its own later task). itemsGathered/missionsCompleted mirror the model's
// sparse-map shape (a key absent until its first recorded event); the three
// scalars are per-call Decimal sums. All Decimal, matching lifetimeStats' own types.
export interface MissionLifetimeStatsDelta {
  itemsGathered: Record<string, Decimal>;    // raw loot DELIVERED this call, keyed by material, mirrors homePlanetDelta exactly
  missionsCompleted: Record<string, Decimal>; // +1 per completed cycle this call, keyed by MissionKey (sparse: absent when 0)
  creditsEarned: Decimal;                     // mirrors creditsDelta (credits earned this call)
  captainXpAwarded: Decimal;                  // GROSS captain XP granted this call (before level-up subtraction), NOT the captain's leftover xp
  fleetAdminXpAwarded: Decimal;               // Fleet Admiral XP granted this call
}

// The zeroed delta, returned on the early-out paths (no mission / non-positive
// ticksElapsed) so every caller always gets a fully-shaped delta to fold, never
// undefined. Empty maps (nothing gathered / no cycle completed) + Decimal(0) scalars.
function emptyMissionLifetimeStatsDelta(): MissionLifetimeStatsDelta {
  return {
    itemsGathered: {},
    missionsCompleted: {},
    creditsEarned: new Decimal(0),
    captainXpAwarded: new Decimal(0),
    fleetAdminXpAwarded: new Decimal(0),
  };
}

// Folds a per-call tally-map delta (material/mission key -> Decimal) into an
// existing lifetimeStats map, returning a NEW map (base is not mutated). Same
// "start from the existing object, add each key" shape tick() uses for
// homePlanet.storage, generalized to dynamic keys: a key absent in `base` starts
// from Decimal(0), preserving the maps' sparse-by-design contract. Used by tick()
// to merge itemsGathered/missionsCompleted; not needed for the scalar sums, which
// fold with a plain .plus().
function mergeLifetimeStatMap(
  base: Record<string, Decimal>,
  delta: Record<string, Decimal>
): Record<string, Decimal> {
  const merged: Record<string, Decimal> = { ...base };
  for (const key of Object.keys(delta)) {
    merged[key] = (merged[key] ?? new Decimal(0)).plus(delta[key]);
  }
  return merged;
}

// Progression Pacing Rework (Task 7): folds ONE captain's per-call
// MissionLifetimeStatsDelta into a fleet-wide lifetimeStats object, returning a
// NEW lifetimeStats (base is not mutated). This is the SINGLE source of truth for
// the lifetimeStats fold, called PER CAPTAIN by BOTH tick() (offline catch-up,
// below) AND App.svelte's live poll loop, so live play and offline catch-up
// cannot diverge for lifetime stats by construction. That drift-proofing is the
// whole reason it exists: the live loop is a SEPARATE re-implementation of the
// tick math and has historically dropped ship-stats/credits when it diverged
// from tick(); routing both paths through this one function removes that risk for
// lifetime stats. The 2 tally maps merge per-key via mergeLifetimeStatMap; the 3
// scalars .plus() their delta. Spread FIRST so the two fields the mission economy
// does NOT feed, itemsRefined/itemsCrafted, plus any future lifetimeStats
// field ride through untouched rather than being silently dropped (the same
// "prestige silently dropped homePlanet" bug class tick()'s homePlanet fold
// guards against). MissionLifetimeStatsDelta is a strict SUBSET of lifetimeStats
// (no itemsRefined/itemsCrafted), so those two are preserved by the spread alone
// and never overwritten here. Replaces Task 6's inline per-field accumulate +
// separate final fold inside tick(); folding one delta at a time is exactly
// value-equivalent (mergeLifetimeStatMap / .plus() are additive and associative,
// so state + d1 + d2 lands identically whether summed once or per captain).
export function foldLifetimeStatsDelta(
  lifetimeStats: GameState["lifetimeStats"],
  delta: MissionLifetimeStatsDelta
): GameState["lifetimeStats"] {
  return {
    ...lifetimeStats,
    itemsGathered: mergeLifetimeStatMap(lifetimeStats.itemsGathered, delta.itemsGathered),
    missionsCompleted: mergeLifetimeStatMap(lifetimeStats.missionsCompleted, delta.missionsCompleted),
    creditsEarned: lifetimeStats.creditsEarned.plus(delta.creditsEarned),
    captainXpAwarded: lifetimeStats.captainXpAwarded.plus(delta.captainXpAwarded),
    fleetAdminXpAwarded: lifetimeStats.fleetAdminXpAwarded.plus(delta.fleetAdminXpAwarded),
  };
}

// passiveTrickle's `material` field is typed HomePlanetMaterialKey (the wider
// superset, since a future trickle could in principle target a crafted good),
// but homePlanetDelta is keyed on the narrower LootMaterialKey, this list
// narrows one to the other at runtime. Today's only passiveTrickle entry
// (economyTrickle) targets "commonOre", which is in this list; a future
// trickle entry targeting a crafted good (e.g. "titaniumIngot") would need
// homePlanetDelta's shape (and this list) widened first, not silently work.
export const LOOT_MATERIAL_KEYS: LootMaterialKey[] = ["commonOre", "uncommonMaterial", "rareMaterial"];

// Sums every unlocked Captain Talent's commonYieldMult contribution for THIS
// captain, additive stacking, read at usage time rather than cached on
// CaptainState, per the "read at usage time" pattern the comment above
// buyCaptainTalent already documents.
//
// Radial Skill Web (Task 7): the old CAPTAIN_SPEC_BONUS.command fold-in
// (a flat commonYieldMult granted when captain.spec === "command") was removed
// here, because the `command` branch/spec and its CAPTAIN_SPEC_BONUS.command
// entry were both deleted in Task 2. This function now returns ONLY the talent
// sum. The still-valid `resourcefulness` spec bonus is handled separately in
// captainSpecBonusRollChance below (kept separate for the downstream-scaling
// reason documented there), it is unaffected by this removal.
export function captainCommonYieldMult(captain: CaptainState): number {
  return captain.unlockedCaptainTalents.reduce((sum, key) => {
    const effect = CAPTAIN_TALENTS[key].effect;
    return effect.type === "commonYieldMult" ? sum + effect.mult : sum;
  }, 0);
}

// Same additive-stacking, read-at-usage-time pattern as
// captainCommonYieldMult, for the uncommon-tier yield effect type.
export function captainUncommonYieldMult(captain: CaptainState): number {
  return captain.unlockedCaptainTalents.reduce((sum, key) => {
    const effect = CAPTAIN_TALENTS[key].effect;
    return effect.type === "uncommonYieldMult" ? sum + effect.mult : sum;
  }, 0);
}

// Same additive-stacking, read-at-usage-time pattern as the yield helpers
// above, for the uncommon-tier occurrence-chance effect type.
export function captainUncommonChanceMult(captain: CaptainState): number {
  return captain.unlockedCaptainTalents.reduce((sum, key) => {
    const effect = CAPTAIN_TALENTS[key].effect;
    return effect.type === "uncommonChanceMult" ? sum + effect.mult : sum;
  }, 0);
}

// Same additive-stacking, read-at-usage-time pattern as the helpers above,
// for the rare-tier occurrence-chance effect type.
export function captainRareChanceMult(captain: CaptainState): number {
  return captain.unlockedCaptainTalents.reduce((sum, key) => {
    const effect = CAPTAIN_TALENTS[key].effect;
    return effect.type === "rareChanceMult" ? sum + effect.mult : sum;
  }, 0);
}

// Same additive-stacking, read-at-usage-time pattern as the helpers above,
// for the bonus-roll TRIGGER chance (the base value from prospectorLuckyStrikeI --
// NOT a multiplier on an existing mission-defined chance, since there is no
// mission-level "bonus roll chance" to scale; this creates the chance from
// nothing, so summing raw values is the only mechanically coherent stacking
// rule, same as every other additive helper in this file). Note this effect's
// field is named `chance`, not `mult`, unlike every OTHER effect type in
// this file, since bonusRollChance is a base value, not itself a multiplier.
export function captainBonusRollChance(captain: CaptainState): number {
  return captain.unlockedCaptainTalents.reduce((sum, key) => {
    const effect = CAPTAIN_TALENTS[key].effect;
    return effect.type === "bonusRollChance" ? sum + effect.chance : sum;
  }, 0);
}

// Relative multiplier applied ON TOP of captainBonusRollChance's base value
// (prospectorLuckyStrikeII), same Math.min(1, base * (1 + mult)) shape
// every other chance-mult effect in this file already uses (see
// effectiveUncommonChance/effectiveRareChance in rollExtractionTick below).
export function captainBonusRollChanceMult(captain: CaptainState): number {
  return captain.unlockedCaptainTalents.reduce((sum, key) => {
    const effect = CAPTAIN_TALENTS[key].effect;
    return effect.type === "bonusRollChanceMult" ? sum + effect.mult : sum;
  }, 0);
}

// CAPTAIN_SPEC_BONUS.resourcefulness's flat +0.01 bonus-roll TRIGGER chance,
// granted once captain.spec === "resourcefulness" (independent of whether any
// prospectorLuckyStrike talent is actually unlocked, the spec bonus is a
// standalone grant, not a scaling of the talent tree's own contribution).
//
// Deliberately kept SEPARATE from captainBonusRollChance (not folded into
// that function's own return value) because bonusRollChance has a
// second-stage multiplier layer downstream (captainBonusRollChanceMult, see
// tickCaptainMission's effectiveBonusRollChance computation:
// `bonusRollChance * (1 + bonusRollChanceMult)`) that commonYieldMult does
// NOT have. Folding this spec bonus into captainBonusRollChance's own sum
// would let bonusRollChanceMult incorrectly re-scale the spec bonus too --
// e.g. with both prospectorLuckyStrikeI/II unlocked (bonusRollChance 0.02,
// bonusRollChanceMult 1.0), folding 0.01 in would give
// (0.02 + 0.01) * (1 + 1.0) = 0.06, overshooting the design doc's 0.05 target.
// Keeping it separate and adding it AFTER the base*(1+mult) scaling (see
// tickCaptainMission) gives the correct 0.02*(1+1.0) + 0.01 = 0.05 instead.
export function captainSpecBonusRollChance(captain: CaptainState): number {
  // CAPTAIN_SPEC_BONUS.resourcefulness is typed as the full CaptainTalentEffect
  // union (CAPTAIN_SPEC_BONUS's declared type is Partial<Record<
  // CaptainTalentBranch, CaptainTalentEffect>>, which TypeScript does not
  // narrow from the literal value assigned), so `.chance` is only accessed
  // after confirming effect.type === "bonusRollChance" specifically, the same
  // discriminant-check pattern as the effect.type checks in the reduce helpers
  // above, rather than a non-null assertion TypeScript would reject.
  const specEffect = CAPTAIN_SPEC_BONUS.resourcefulness;
  return captain.spec === "resourcefulness" && specEffect?.type === "bonusRollChance" ? specEffect.chance : 0;
}

// Fleet-wide equivalent of the captain-level yield helpers above, sourced
// from state.unlockedHomeworldTalents (Fleet Admiral prestige, spent
// fleet-wide) rather than one captain's own talents, so it applies
// identically to EVERY captain's mission extraction, not just whichever
// captain unlocked it. rareYieldMult is the ONLY Homeworld Talent effect type
// tied to extraction (per the design doc, there is no captain-level
// rare-yield talent).
export function fleetRareYieldMult(state: GameState): number {
  return state.unlockedHomeworldTalents.reduce((sum, key) => {
    const effect = HOMEWORLD_TALENTS[key].effect;
    return effect.type === "rareYieldMult" ? sum + effect.mult : sum;
  }, 0);
}

// Progression Pacing Rework (Task 3, docs/plans/2026-07-11-progression-pacing-
// rework-*): the SHARED per-tick XP RATE helper. Returns how much XP one whole
// extraction tick of `missionKey` is worth RIGHT NOW, for THIS captain (and,
// later, this fleet `state`). Task 4 (captain XP accrual) and Task 5 (Fleet
// Admiral XP) will BOTH call into this one function, so the two XP streams
// always scale off the exact same rate, it is a shared dependency built
// first, deliberately NOT yet wired into tickCaptainMission (that is Task 4/5).
//
// XP RATES ARE PLAIN `number`, NOT Decimal: like every *Mult helper above, this
// returns a small multiplier-scale rate, not an accumulated total. The Decimal
// accounting stays downstream where these rates are summed into the captain's
// xp / the fleet's fleetAdminXp (both Decimal) by Task 4/5.
//
// MULTIPLIER SEAM, READ BEFORE EXTENDING: today this returns the mission's
// flat BASE_XP_PER_TICK unchanged, because there are currently NO XP-boosting
// captain talents or global buffs, CaptainTalentEffect / HomeworldTalentEffect
// (model.ts) have no XP-flavored member to reduce over. Per the project's
// no-placeholder rule, we do NOT fabricate a fake "xpMult" effect type just to
// have something to multiply by. Instead the future multiplier plugs in RIGHT
// HERE as a one-line change: once a real XP-mult talent/buff effect exists, this
// body becomes `return BASE_XP_PER_TICK[missionKey] * (1 + captainXpMult(captain)) *
// (1 + buffXpMult(state))`, where captainXpMult/buffXpMult are written as the SAME
// ADDITIVE-BONUS `reduce`-over-unlocked-talents shape as captainCommonYieldMult /
// fleetRareYieldMult above, they `reduce(..., 0)` and return 0 (NOT 1) when
// nothing matches (a +50% XP talent contributes 0.5), so each is applied as
// `(1 + mult)`. Do NOT multiply the raw helper in (`... * captainXpMult(...)`):
// since these helpers return 0 when empty, that form would zero out ALL XP. The
// `captain` and `state` params already sit in the signature (intentionally
// unused today) so that extension needs no call-site changes. `state` is
// optional because the captain-level caller (Task 4) has no reason to thread
// fleet state through for a rate that ignores it today.
//
// ⚠️ CLOSED-FORM PARITY TRAP, the moment this returns a FRACTIONAL rate ⚠️
// Task 4's captain-XP accrual (tickCaptainMission) awards xpRate * (whole ticks
// advanced) and relies on that product being drift-free across chunking so one
// big offline-catchup call equals many small live calls (the closed-form parity
// test guards it). That equality holds ONLY while this rate is an INTEGER (it is
// today: BASE_XP_PER_TICK is 1). A fractional rate, exactly what the
// `(1 + captainXpMult)*(1 + buffXpMult)` extension above produces, breaks it:
// a single big-call product can differ from the summed per-call products in
// floating point (0.1*3 !== 0.1+0.1+0.1), and the current rate-1 parity test
// will NOT catch the regression. See the matching ⚠️ block at the
// `xp = xp.plus(new Decimal(xpRate).times(...))` award line in tickCaptainMission:
// activating a fractional rate requires re-deriving that accrual to stay
// drift-free AND adding a closed-form parity test AT the real fractional rate
// (the Decimal wrapping there is defense-in-depth, not a proof of parity).
export function xpPerTick(missionKey: MissionKey, captain: CaptainState, state?: GameState): number {
  return BASE_XP_PER_TICK[missionKey];
}

// Talent Tree Visual Redesign (Task 9): pure string-conversion helpers for the
// Task 12 tooltip work, turn one CAPTAIN_TALENTS/HOMEWORLD_TALENTS entry's
// `effect` field into a single human-readable line describing its numeric
// impact. No side effects, no state read, these take the effect value
// directly (as already narrowed off a specific talent's `.effect`), not a
// GameState/CaptainState, so the tooltip can call them for ANY talent entry
// (unlocked or not) purely from its static model.ts definition.
//
// Percentage rounding follows the SAME .toFixed(1) convention App.svelte
// already uses for every other displayed chance/yield percentage (e.g. the
// "Bonus Roll: ...% chance/tick" and mission phase readouts), kept
// consistent rather than introducing a second rounding convention (.toFixed(0))
// just for this new tooltip text.
//
// Discriminated union with no `default` branch: TypeScript's exhaustiveness
// checking would flag a missing case at compile time if CaptainTalentEffect
// grows a new member without a matching branch here, but there is no
// TypeScript compiler available in this dev environment to actually run that
// check, so any FUTURE new member added to CaptainTalentEffect in model.ts
// must have its switch branch added here by hand at the same time, not
// discovered later by a build failure.
export function describeCaptainTalentEffect(effect: CaptainTalentEffect): string {
  switch (effect.type) {
    case "commonYieldMult":
      return `+${(effect.mult * 100).toFixed(1)}% ${ITEMS.commonOre.label} yield`;
    case "uncommonYieldMult":
      return `+${(effect.mult * 100).toFixed(1)}% ${ITEMS.uncommonMaterial.label} yield`;
    case "uncommonChanceMult":
      return `+${(effect.mult * 100).toFixed(1)}% ${ITEMS.uncommonMaterial.label} chance`;
    case "rareChanceMult":
      return `+${(effect.mult * 100).toFixed(1)}% ${ITEMS.rareMaterial.label} chance`;
    case "bonusRollChance":
      return `+${(effect.chance * 100).toFixed(1)}% chance/tick for a bonus roll`;
    case "bonusRollChanceMult":
      return `+${(effect.mult * 100).toFixed(1)}% to bonus roll chance`;
    // Radial Skill Web (Task 2): the gateway-hub effect. Tactician/Explorer
    // hubs carry `{ type: "none" }` because their branches' real mechanics
    // (combat / science) don't exist yet. Rendered honestly as "no bonus yet"
    // rather than a misleading "+0.0%" line, this is the whole reason the
    // `none` member exists instead of a `mult: 0.0` placeholder.
    case "none":
      return "No bonus yet, unlocks this branch";
  }
}

// Same pattern as describeCaptainTalentEffect above, for the Homeworld Talent
// tree's effect union. (The `recipeBonusOutput` case was RETIRED in Phase 4,
// Task F5 with the legacy RECIPES instant-craft it described.) passiveTrickle has
// no display-label table anywhere in the codebase for HomePlanetMaterialKey, so
// it surfaces the raw material key as-is (e.g. "commonOre"), matching how
// this same codebase already displays raw LootMaterialKey/HomePlanetMaterialKey
// strings elsewhere with no translation layer (see mission cargo readouts in
// App.svelte). Introducing a new material-label map is out of scope for this
// pure-conversion-function task, flagging it as a real Task 12 (tooltip UI)
// candidate, not solving it here.
export function describeHomeworldTalentEffect(effect: HomeworldTalentEffect): string {
  switch (effect.type) {
    case "unlockCaptainSlot":
      return "Unlocks a new captain slot";
    case "rareYieldMult":
      return `+${(effect.mult * 100).toFixed(1)}% ${ITEMS.rareMaterial.label} yield (fleet-wide)`;
    case "passiveTrickle":
      return `+${effect.perTick}/tick passive ${effect.material}`;
    // 0.11.0 Storage/Salvage (Task C4): the combined salvage talent. Surfaces
    // BOTH bumps in one tooltip line, the yield as a percentage-point add onto
    // the recycle recovery, the ceiling as a "+N tier" reach on the loot roll.
    case "salvageBoost":
      return `+${(effect.yieldBonus * 100).toFixed(0)}% salvage recovery, +${effect.ceilingBonus} loot tier reach`;
    // Radial Skill Web (Task 3): the gateway-hub effect, mirroring the captain
    // side's `none` case above. Homeland Defense / Citizenry hubs carry
    // `{ type: "none" }` because their categories' real mechanics (a defense /
    // population system) don't exist yet. Rendered honestly as "no bonus yet"
    // rather than a misleading "+0.0%" line, the whole reason the `none`
    // member exists instead of a `mult: 0.0` placeholder.
    case "none":
      return "No bonus yet, unlocks this branch";
  }
}

// requiredTicksForPhase always returns a whole number, but phaseProgressTicks
// accumulates via repeated float addition across many small tickCaptainMission
// calls (e.g. offline catch-up feeding one big ticksElapsed vs. the live loop
// feeding many small ones, see the closed-form test). Summing a
// non-terminating binary fraction like 0.1 many times lands a hair short of
// (or past) the true integer boundary, e.g. 9.999999999999982 instead of 10.
// Left unhandled, that residue is invisible to a strict `>=` boundary check
// AND undercounts the extraction loot rolls below (Math.floor never sees the
// final whole-tick crossing), so one big ticksElapsed call and many small
// ones summing to the same total can disagree on both phase and loot,
// breaking the exact guarantee this function exists to provide.
const MISSION_TICK_EPSILON = 1e-9;

// A very large offline-catchup ticksElapsed could complete many mission
// cycles across many captains in one tick() call, each contributing 1-2
// Fleet Admiral XP (or a large amount of captain XP), summing to a
// potentially large delta applied in one shot. Capping a level-up loop at a
// fixed max per call and carrying any leftover XP forward (it keeps
// resolving on a LATER call) avoids an unbounded loop. Originally added for
// applyFleetAdminXp only (Fleet Admiral XP Rework); the Big-Number Migration
// (2026-07-08, docs/plans/2026-07-08-big-number-migration-plan.md, Task 5)
// has since reused this SAME constant (not redefined it) for the captain XP
// level-up loop inside tickCaptainMission too, now that captain xp is
// Decimal-typed, both loops share this one cap.
//
// Exported (2026-07-11, Progression Pacing Rework Task 12) so tick.test.ts's
// cap tests import this exact value instead of each mirroring the 10_000
// literal locally (a Task 8 review item), keeps the tests from silently
// drifting out of sync if this cap is ever retuned. Same export-to-avoid-a-
// hand-duplicated-copy rationale as RESPEC_COST_CREDITS just below.
export const MAX_LEVEL_UPS_PER_TICK = 10_000;

// foldXpLevelUps: the ONE shared subtract-and-carry level-up loop behind all
// three XP tracks (captain XP inside tickCaptainMission, Fleet Admiral XP inside
// applyFleetAdminXp, Crafting XP inside applyCraftingXp). Each track used to
// inline its OWN byte-for-byte copy of this same while-loop; they are
// consolidated here so the carry-forward + MAX_LEVEL_UPS_PER_TICK cap semantics
// live in exactly ONE place and cannot drift apart between tracks.
//
// Given a starting xp (Decimal) and level (number), plus a thresholdFor(level)
// curve (one of xpForNextLevel / xpForNextFleetAdminLevel / craftingXpForNext),
// it subtracts each crossed threshold and climbs one level per crossing, bounded
// by MAX_LEVEL_UPS_PER_TICK. Any xp beyond the cap is LEFT in the returned xp to
// carry forward to a later call (see that constant's comment above for why the
// cap + carry exist). It returns the drained xp, the new level, and the COUNT of
// level-ups, so each caller applies its own per-level award at the call site
// (captain: statPoints += levelUps; FA: adminPoints += levelUps; crafting: no
// points award). thresholdFor returns Decimal OR number because the three curves
// differ (the captain/FA curves return number, the crafting curve returns
// Decimal); Decimal.gte / Decimal.minus accept either, so this is exact for all
// three, no coercion.
//
// BEHAVIOR IS BIT-IDENTICAL to the three former inline loops: thresholdFor is
// still evaluated twice per iteration (once in the gte condition, once in the
// minus), the cap counts crossings the same way, and the leftover-xp carry is
// unchanged. This is pure fold arithmetic over (xp, level): it does NOT touch the
// closed-form offline==live guarantee each track already has (what must be
// closed-form is the DELTA each caller feeds in, which is unchanged, see the
// CLOSED-FORM PARITY TRAP comments at the captain + FA accrual sites).
//
// Exported so tick.test.ts can lock the helper's contract directly, the same
// export-for-tests rationale as applyFleetAdminXp / MAX_LEVEL_UPS_PER_TICK.
export function foldXpLevelUps(
  startingXp: Decimal,
  startingLevel: number,
  thresholdFor: (level: number) => Decimal | number,
): { xp: Decimal; level: number; levelUps: number } {
  let xp = startingXp;
  let level = startingLevel;
  let levelUps = 0;
  while (xp.gte(thresholdFor(level)) && levelUps < MAX_LEVEL_UPS_PER_TICK) {
    xp = xp.minus(thresholdFor(level));
    level += 1;
    levelUps += 1;
  }
  return { xp, level, levelUps };
}

// PROCESS_XP_AWARDS: the SINGLE source of truth for which TimedProcessKind feeds
// which XP axis when a process COMPLETES. This previously lived as TWO separate
// inline conditionals in resolveProcesses of OPPOSITE polarity: a BLACKLIST for
// Fleet Admiral XP (award unless the kind was one of four) and a WHITELIST for
// crafting XP (award only if the kind was one of three). That pairing was a trap:
// adding a NEW TimedProcessKind would SILENTLY inherit FA XP (it is not on the
// blacklist) while SILENTLY getting no crafting XP (it is not on the whitelist),
// with nothing forcing a deliberate decision on either axis.
//
// This exhaustive Record removes the trap. Because it is typed
// Record<TimedProcessKind, ...>, adding a kind to the union WITHOUT adding its row
// here is a COMPILE ERROR, so every new kind must declare, on the spot, whether it
// grants Fleet Admiral XP and whether it grants crafting XP. The values below
// reproduce the two former conditionals EXACTLY (locked by the per-kind
// characterization test in tick.test.ts):
//   - fleetAdmin (⚠️ CHANGED in 0.12.1): the old FA blacklist EXCLUDED fuelRefineJob
//     / researchProject / fabricateJob / shipBuild. As part of the 0.12.1 FA-XP
//     unblock, researchProject / fabricateJob / shipBuild were FLIPPED to true:
//     they are finite, high-value builds and SHOULD grant FA XP now that finite
//     sources are meant to be meaningful (paired with the gentler 750 curve + the
//     FLEET_ADMIN_XP_PER_DURATION_TICK lump). fuelRefineJob stays false (an
//     additive, automated, endlessly-repeatable fuel batch is the one economy that
//     must NOT feed FA, or a fuel loop would trivially farm FA levels). So today
//     every kind EXCEPT fuelRefineJob is true.
//   - crafting: the old whitelist INCLUDED only refineJob / fabricateJob /
//     shipBuild (the "you produced an item or hull" kinds), so only those three
//     are true. This still DIFFERS from the FA set: researchProject feeds FA but
//     NOT crafting (unlocking a blueprint is not producing an item), while
//     facilityUpgrade / equipmentStorageUpgrade / docksExpansion feed FA but NOT
//     crafting (building infrastructure is not crafting an item). fabricateJob +
//     shipBuild now feed BOTH axes.
// Closed-form parity is unaffected: each award still fires exactly once, on the
// completion tick that drops the process (see the parity tests).
//
// ⚠️ DESIGN NOTE (0.12.1): fabricateJob / shipBuild / researchProject NOW grant FA
// XP (flipped from false). These are finite, high-value, blueprint-gated builds; a
// long automated craft or hull build being a large FA-XP injection is now the
// DESIRED behavior (finite sources should be meaningful), the exact opposite of the
// pre-0.12.1 intent that kept the 375000 curve "pure." Only fuelRefineJob stays
// false. If a fuel loop should ever feed FA XP, flip fuelRefineJob.fleetAdmin here.
const PROCESS_XP_AWARDS: Record<TimedProcessKind, { fleetAdmin: boolean; crafting: boolean }> = {
  refineJob:               { fleetAdmin: true,  crafting: true },
  facilityUpgrade:         { fleetAdmin: true,  crafting: false },
  fuelRefineJob:           { fleetAdmin: false, crafting: false },
  researchProject:         { fleetAdmin: true,  crafting: false }, // 0.12.1: flipped to true (finite, high-value)
  fabricateJob:            { fleetAdmin: true,  crafting: true },  // 0.12.1: flipped to true (finite, high-value)
  shipBuild:               { fleetAdmin: true,  crafting: true },  // 0.12.1: flipped to true (finite, high-value)
  equipmentStorageUpgrade: { fleetAdmin: true,  crafting: false },
  docksExpansion:          { fleetAdmin: true,  crafting: false },
  // Combat 0.13.0 (Phase 11, design S13): a ship REPAIR grants NEITHER axis. Repair is a
  // CONSEQUENCE of losing a patrol (restoring a wrecked hull), not an achievement or a
  // production job, so it must not farm FA or crafting XP (a defeat-repair-redispatch loop
  // could otherwise be an XP faucet). It joins fuelRefineJob as the only neither-axis kind.
  shipRepair:              { fleetAdmin: false, crafting: false },
};

// Exported so App.svelte can display/gate on this exact value (Reset button
// affordability, modal copy) without a hand-duplicated second copy of the
// number that could silently drift out of sync with this one.
export const RESPEC_COST_CREDITS = 50; // launch placeholder, not balance-tested, same spirit as MISSIONS/talent costs

// Sequential, mutually-exclusive per-tier roll for ONE whole tick of
// extraction (2026-07-08 Extraction Rework, see the design doc). Replaces
// the old independent-and-subtractive mechanic (uncommon and rare each
// rolled separately, both COULD occur in the same tick, whatever hit was
// subtracted from a shared extractionRatePerTick pool, common absorbed the
// leftover). That old bucket-roll for uncommon's amount (75% -> 1 unit, 20%
// -> 2 units, 5% -> 3 units) and rare's flat-1-unit cap are both GONE --
// there is no per-tier amount cap anymore. Rare is checked first; if it
// misses, uncommon is checked; if that also misses, common wins by default.
// Exactly one of the three tiers wins each tick, and the winner is awarded
// the FULL extractionRatePerTick base amount for that tick (scaled by its
// own yieldMult), not a fraction of it, not a capped bucket roll.
//
// Only 1 or 2 rng() calls happen, NEVER 3 or more:
//   1. does rare occur (rng() < effective rare chance), if yes, STOP here, 1 call total.
//   2. IF rare missed: does uncommon occur (rng() < effective uncommon chance), if yes, STOP here, 2 calls total.
//   3. IF both missed: common wins, this is a guaranteed, non-conditional return, no roll needed.
// This fixed, capped call count matters for hand-tracing a deterministic test
// rng, and for the closed-form guarantee tickCaptainMission depends on (use
// a CONSTANT, non-stateful rng in tests, see that function's own comment):
// a caller can always reason about how many rng() calls one invocation of
// this function consumes without needing to know the outcome first.
//
// Behavior change worth flagging for anyone reading/testing this function:
// under the OLD mechanic, only commonYieldMult could meaningfully move the
// deterministic per-tick total in most cases, since uncommon/rare were
// capped at small flat amounts (1-3 units) regardless of the mission's
// actual per-tick rate. Under THIS mechanic, uncommonYieldMult and
// rareYieldMult now ALSO change the deterministic per-tick total whenever
// that tier wins the roll, because the winning tier receives the FULL
// per-tick base amount (extractionRatePerTick) scaled by its own mult --
// e.g. a high rareYieldMult now produces a large delivered amount on any
// tick where rare actually hits, not just a scaled flat-1 unit like before.
function rollExtractionTick(
  missionDef: MissionDef,
  bonuses: {
    commonYieldMult: number;
    uncommonYieldMult: number;
    uncommonChanceMult: number;
    rareYieldMult: number;
    rareChanceMult: number;
  },
  rng: () => number
): Record<LootMaterialKey, Decimal> {
  const effectiveUncommonChance = Math.min(1, missionDef.uncommonChance * (1 + bonuses.uncommonChanceMult));
  const effectiveRareChance = Math.min(1, missionDef.rareChance * (1 + bonuses.rareChanceMult));
  const baseAmount = new Decimal(missionDef.extractionRatePerTick);

  if (rng() < effectiveRareChance) {
    return { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: baseAmount.times(1 + bonuses.rareYieldMult) };
  }
  if (rng() < effectiveUncommonChance) {
    return { commonOre: new Decimal(0), uncommonMaterial: baseAmount.times(1 + bonuses.uncommonYieldMult), rareMaterial: new Decimal(0) };
  }
  return { commonOre: baseAmount.times(1 + bonuses.commonYieldMult), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) };
}

// The bonus roll (Resourcefulness's Lucky Strike I/II) reuses the PRIMARY
// roll's own effectiveRareChance/effectiveUncommonChance formulas (so
// rareChanceMult/uncommonChanceMult talents boost the bonus roll too), but
// replaces the primary roll's guaranteed-common floor with a 30% CHANCE at
// common, unlike rollExtractionTick, this roll can produce NOTHING. Called
// only when the separate bonus-roll TRIGGER check (captainBonusRollChance/
// captainBonusRollChanceMult, checked by the caller BEFORE this function is
// invoked) has already succeeded, this function itself has no trigger
// check of its own, it IS the mini-sequence that runs once triggered.
//
// Up to 3 rng() calls (rare, then uncommon, then the 30% common check), same
// early-return-per-branch shape as rollExtractionTick, so the two functions'
// combined call count per whole tick stays easy to hand-trace: 1 (bonus
// trigger check, made by the caller) + up to 3 (this function) on top of
// rollExtractionTick's own 1-2, for a range of 3-6 total rng() calls per
// tick depending on outcomes.
const BONUS_ROLL_COMMON_CHANCE = 0.3;

function rollBonusExtractionTick(
  missionDef: MissionDef,
  bonuses: {
    commonYieldMult: number;
    uncommonYieldMult: number;
    uncommonChanceMult: number;
    rareYieldMult: number;
    rareChanceMult: number;
  },
  rng: () => number
): Record<LootMaterialKey, Decimal> {
  const effectiveUncommonChance = Math.min(1, missionDef.uncommonChance * (1 + bonuses.uncommonChanceMult));
  const effectiveRareChance = Math.min(1, missionDef.rareChance * (1 + bonuses.rareChanceMult));
  const baseAmount = new Decimal(missionDef.extractionRatePerTick);

  if (rng() < effectiveRareChance) {
    return { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: baseAmount.times(1 + bonuses.rareYieldMult) };
  }
  if (rng() < effectiveUncommonChance) {
    return { commonOre: new Decimal(0), uncommonMaterial: baseAmount.times(1 + bonuses.uncommonYieldMult), rareMaterial: new Decimal(0) };
  }
  if (rng() < BONUS_ROLL_COMMON_CHANCE) {
    return { commonOre: baseAmount.times(1 + bonuses.commonYieldMult), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) };
  }
  return emptyLootTotals(); // all three missed, the bonus roll produces nothing this tick
}

// MUST be closed-form: calling this once with a large ticksElapsed must
// produce the same result as calling it many times with a small ticksElapsed
// summing to the same total. Generalized from "one continuous quantity
// clamped at one threshold" to "a sequence of 5 phase thresholds that wraps
// back to the start on completion, unless recalled." One call with a large
// ticksElapsed must resolve EVERY phase transition, extraction loot roll,
// and auto-repeat cycle that ticksElapsed represents, not just the first
// one, which is what the while loop below does.
//
// `ticksElapsed` is NOT deltaSeconds, it's the caller's job (tick(), in
// this same file) to convert deltaSeconds into ticksElapsed by dividing by
// the fleet's shared tickDurationSeconds. This keeps mission progress on a
// consistent fleet-wide cadence, rather than inventing a second timing
// system.
export function tickCaptainMission(
  ticksElapsed: number,
  captain: CaptainState,
  rng: () => number = Math.random,
  // Every field defaults to 0 (no bonus) so every existing call site/test
  // that omits this 4th arg (or omits individual fields) behaves EXACTLY as
  // before, the caller (tick(), below) sums each captain-level helper +
  // the fleet-wide one (rareYieldMult only, per the design doc) into one
  // value per field before calling in.
  bonuses: {
    commonYieldMult?: number;
    uncommonYieldMult?: number;
    uncommonChanceMult?: number;
    rareYieldMult?: number;
    rareChanceMult?: number;
    bonusRollChance?: number;
    bonusRollChanceMult?: number;
    // Captain Specialization's flat addition to the bonus-roll TRIGGER chance
    // (CAPTAIN_SPEC_BONUS.resourcefulness), kept as its own field, NOT
    // merged into bonusRollChance, so the extraction loop below can add it
    // AFTER bonusRollChance*(1+bonusRollChanceMult) is computed rather than
    // before (see captainSpecBonusRollChance's own comment for why order
    // matters here).
    specBonusRollChance?: number;
  } = {},
  // The assigned ship's three derived stats (cargoCapacity, transitSpeedMult,
  // extractionYieldMult), or null for "no ship modifier", the default, which
  // reproduces this function's pre-Task-6 behavior EXACTLY, so every existing
  // call site/test that omits this 5th arg is unaffected. Applied by modifying
  // the INPUTS to the existing closed-form machinery, NOT by changing the while
  // loop: transit/cargo fold into missionDef (once, before the loop) via
  // effectiveMissionDef, and extractionYieldMult folds into resolvedBonuses'
  // per-tier yield mults (also once, before the loop). Both stay constant for
  // the whole call, so the "one big jump == many small ticks" guarantee holds
  // for the exact same reason the `bonuses` constant above does. tick() resolves
  // the assigned hull to these stats and passes them in (Task 7); this function
  // no longer reads captain.shipType at all (removed in Task 3).
  shipStats: ShipDerivedStats | null = null,
  // Mission Rework (Task 5): the shared fuel tank's budget available to THIS call, and
  // the fuel one round-trip cycle of this mission burns. Both plain numbers (fuel is
  // small/human-scale, see fuel.ts). The DEFAULTS reproduce this function's pre-fuel
  // behavior EXACTLY: fuelPerCycle 0 makes every auto-repeat affordable
  // (fuelRemaining >= 0 is always true) and spends nothing, so every existing call
  // site/test that omits these two args is byte-identical to before. economyTick (the
  // only production caller) passes the real per-captain budget + per-cycle cost so the
  // auto-repeat gate below can stop the run when the tank can't cover the next cycle.
  fuelBudget: number = Infinity,
  fuelPerCycle: number = 0,
  // Fuel Economy v2 (F3): the credits available to THIS call for AUTO-BUYING a fuel shortfall
  // at a cycle boundary, and the price per fuel unit. Threaded exactly like fuelBudget above
  // (economyTick draws it down per captain so a shared credit pool can't double-spend). The
  // DEFAULT Infinity reproduces the pre-F3 behavior for any call that omits it EXCEPT that a
  // short tank now auto-buys instead of stopping, but with fuelPerCycle 0 (the default) the
  // tank is never short, so a call omitting BOTH new fuel args is byte-identical to pre-F3.
  // creditsPerUnit defaults to FUEL_CREDITS_PER_UNIT (the real price) so a caller passing only
  // a finite creditsBudget still charges correctly.
  creditsBudget: number = Infinity,
  creditsPerUnit: number = FUEL_CREDITS_PER_UNIT
): {
  captain: CaptainState;
  // Mission Rework (Task 1): widened LootMaterialKey -> string. The loot delta is now
  // keyed by the DISPATCHED mission's own ITEM keys (remapped from abstract rarity
  // tiers at cycle delivery below), which can be any raw-material key, not just the
  // 3 original ore tiers. Still seeded with the 3 ore-tier keys (emptyLootTotals) so
  // passiveTrickle's commonOre target and ore-run deliveries are byte-identical; new
  // missions append their own keys on top.
  homePlanetDelta: Record<string, Decimal>;
  fleetAdminXpDelta: number;
  creditsDelta: number;
  // Task 6: lifetime-stat accrual for this call, folded into state.lifetimeStats
  // by tick(). Always present (zeroed on the early-outs), never undefined.
  lifetimeStatsDelta: MissionLifetimeStatsDelta;
  // Mission Rework (Task 5): fuel actually spent on auto-repeats this call
  // (fuelPerCycle x cycles that repeated). economyTick subtracts this from the shared
  // Decimal tank. 0 on the early-outs and whenever fuelPerCycle is 0 (the default).
  fuelSpent: number;
  // Fuel Economy v2 (F3): credits actually spent AUTO-BUYING fuel shortfalls this call
  // (sum of shortfall * creditsPerUnit across cycle boundaries that auto-bought). economyTick
  // subtracts this from the shared Decimal credits balance, mirroring fuelSpent. 0 on the
  // early-outs and whenever no auto-buy fired (the tank always covered the cycle).
  creditsSpentOnFuel: number;
} {
  if (!captain.mission || ticksElapsed <= 0) {
    return {
      captain,
      homePlanetDelta: emptyLootTotals(),
      fleetAdminXpDelta: 0,
      creditsDelta: 0,
      lifetimeStatsDelta: emptyMissionLifetimeStatsDelta(),
      fuelSpent: 0,
      creditsSpentOnFuel: 0,
    };
  }

  // Combat 0.13.0 (Phase 9b.5a): tickCaptainMission advances ONLY the EXTRACTION arm of
  // the CaptainState.mission discriminated union. ANY non-extraction mission kind no-ops
  // here (not just today's patrol): the guard is `kind !== "extraction"`, so a future kind
  // is silently absorbed as a no-op too. This site is extraction-scoped by NATURE (its
  // whole body reads extraction-only fields), and it is NOT a compile-time exhaustiveness
  // checkpoint, only economyTick's switch(kind) + assertNeverMission is. A future kind that
  // needs a real tick path must be routed EXPLICITLY (from economyTick), never left to fall
  // through here. economyTick already routes by kind so a patrol never reaches this in
  // production; this guard is belt-and-suspenders for a DIRECT caller (a test, a future
  // path). Narrow ONCE into a typed local (`extractionMission`) so every read below sees the
  // extraction arm's fields without re-narrowing across the many statements + calls that
  // follow. A non-extraction mission returns the SAME no-op result the idle/zero-tick
  // early-out returns, i.e. no progress, no crash.
  if (captain.mission.kind !== "extraction") {
    return {
      captain,
      homePlanetDelta: emptyLootTotals(),
      fleetAdminXpDelta: 0,
      creditsDelta: 0,
      lifetimeStatsDelta: emptyMissionLifetimeStatsDelta(),
      fuelSpent: 0,
      creditsSpentOnFuel: 0,
    };
  }
  const extractionMission = captain.mission;

  // Resolve the mission's transit + cargo geometry ONCE, before the while loop
  // below, exactly like resolvedBonuses further down. effectiveMissionDef
  // rescales transitOut/BackTicks by the ship's transitSpeedMult (ceil, so they
  // stay integer) and swaps in the ship's cargoCapacity (which drives the
  // extracting phase's length via requiredTicksForPhase). Because this is
  // computed once and stays CONSTANT across every loop iteration, every phase's
  // requiredTicksForPhase value is identical whether the call was made as one
  // big ticksElapsed or as many small ones, so the closed-form guarantee is
  // preserved. Do NOT move this inside the loop: a per-iteration recompute would
  // still yield the same numbers (effectiveMissionDef is pure), but computing it
  // once is both cheaper and the clearest signal that it's a call-constant.
  const rawMissionDef = MISSIONS[extractionMission.missionKey];
  const missionDef = shipStats ? effectiveMissionDef(rawMissionDef, shipStats) : rawMissionDef;
  let mission: CaptainMissionState | null = { ...extractionMission, cargo: { ...extractionMission.cargo } };
  let remaining = ticksElapsed;
  // Mission Rework (Task 1): typed Record<string,Decimal> (not the narrow
  // LootMaterialKey) because the cycle-delivery below remaps the abstract-tier cargo
  // onto the mission's own lootTable item keys, which may not be one of the 3 seed
  // keys. Seeded with emptyLootTotals() so the ore tiers are always present (ore-run
  // delivery + passiveTrickle stay byte-identical); other missions grow keys on demand.
  const homePlanetDelta: Record<string, Decimal> = emptyLootTotals();
  // Seeded from the captain's CURRENT xp/level/statPoints. Task 4 (Progression
  // Pacing Rework) changed WHEN these mutate: captain XP is no longer a lump
  // awarded inside the cycle-completion branch, it accrues per WHOLE tick the
  // mission advances (see wholeTicksElapsed below). So the XP award + the
  // level-up loop now run exactly ONCE, AFTER the while loop, off the total
  // whole ticks counted, not once per completed cycle.
  let xp = captain.xp;
  let level = captain.level;
  let statPoints = captain.statPoints;
  // Total WHOLE ticks the mission actually advances this call, summed across
  // every phase (orders/transit/extract/unload alike). Captain XP is awarded
  // as xpRate * this count after the loop. Counted on whole-tick boundaries --
  // the SAME closed-form device the extraction loot rolls use below, so the
  // accrual is chunk-invariant: one big ticksElapsed and many small ones
  // summing to it credit the identical integer tick count (a sub-whole partial
  // tick credits nothing until a later call completes it), and because the
  // count only ever grows by integers, the Decimal XP sum carries no
  // fractional drift across chunking. A mission that terminates partway (e.g.
  // recall) simply stops contributing once the loop exits, ticks never
  // advanced are never counted, matching a tick-by-tick stepping exactly.
  let wholeTicksElapsed = 0;
  // The per-tick XP RATE for this mission, resolved ONCE (call-constant): the
  // missionKey is fixed for the whole call (auto-repeat reuses the same key),
  // and xpPerTick ignores level/state today, so pulling it out of the loop is
  // both cheaper and a clear signal it does not vary per tick. Read off
  // captain.mission (guaranteed non-null past the early return above) rather
  // than the local `mission`, which can become null on a recall before we use
  // this after the loop.
  const xpRate = xpPerTick(extractionMission.missionKey, captain);
  // The mission key this call runs, captured ONCE (call-constant: auto-repeat
  // reuses the same key). Used only to key the lifetimeStatsDelta.missionsCompleted
  // tally below. Read off captain.mission (guaranteed non-null past the early
  // return) rather than the local `mission`, which can go null on a recall.
  const missionKey = extractionMission.missionKey;
  // The per-tick Fleet Admiral XP RATE for this mission, resolved ONCE
  // (call-constant), mirroring xpRate directly above. Read off missionDef, the
  // ship-adjusted def, which is safe because effectiveMissionDef preserves
  // fleetAdminXpPerTick unchanged (it only rescales transit/cargo geometry); it
  // is fixed for the whole call since auto-repeat reuses the same missionKey.
  // Awarded after the loop as fleetAdminXpRate * wholeTicksElapsed, the SAME
  // whole-tick count captain XP uses (Task 5).
  const fleetAdminXpRate = missionDef.fleetAdminXpPerTick;
  // Accumulates this captain's Fleet Admiral XP contribution for this call.
  // Progression Pacing Rework (Task 5): FA XP is no longer a per-completed-cycle
  // lump, it now accrues per WHOLE tick the mission advances, awarded ONCE after
  // the loop (fleetAdminXpRate * wholeTicksElapsed), right beside the captain-XP
  // award, using the SAME wholeTicksElapsed counter. tick() sums this across every
  // captain fleet-wide before handing the total to applyFleetAdminXp, so N
  // captains each on an active mission stack to N FA XP/tick automatically, no
  // stacking-specific code. Kept a plain `number` (integer-exact at the rate-1
  // today); see the ⚠️ parity trap at the award line before ever making the rate
  // fractional.
  let fleetAdminXpDelta = 0;
  // Accumulates this captain's credits contribution across every mission
  // cycle completed within this call, same "accumulate locally, apply
  // once" shape as fleetAdminXpDelta immediately above. tick() sums this
  // across every captain fleet-wide, then applies it to state.credits with a
  // flat .plus() (credits has no leveling curve, unlike fleetAdminXpDelta).
  let creditsDelta = 0;
  // Task 6: counts the mission cycles COMPLETED within this call (the same
  // cycle-completion branch that awards credits below can fire many times in one
  // big offline-catchup call). Closed-form for the same reason creditsDelta is --
  // it increments in lockstep with that branch, so one big call and many small
  // ones summing to the same span count the identical number of completions.
  // Rolled into lifetimeStatsDelta.missionsCompleted[missionKey] after the loop.
  let cyclesCompleted = 0;
  // Mission Rework (Task 5): fuel accounting for the auto-repeat gate. fuelRemaining is
  // the shared-tank budget this call may still draw on (seeded from fuelBudget, drawn
  // down PER auto-repeat below); fuelSpent is the running total this call reports back
  // to economyTick to subtract from the Decimal tank. Both stay 0 / untouched when
  // fuelPerCycle is 0 (the default), so the pre-fuel closed-form behavior is preserved.
  // These decrement ONLY at cycle boundaries (the auto-repeat branch), exactly like
  // credits/cyclesCompleted, so fuel falls out of the per-tick stepping the SAME way
  // loot/XP/credits do: one big ticksElapsed and many small ones summing to it draw the
  // identical fuel at the identical cycle boundaries (closed-form / stepped-safe).
  let fuelRemaining = fuelBudget;
  let fuelSpent = 0;
  // Fuel Economy v2 (F3): the credit budget this call may still draw on for AUTO-BUYING a fuel
  // shortfall (seeded from creditsBudget, drawn down per auto-buy below), and the running total
  // this call reports back to economyTick to subtract from the shared Decimal credits balance.
  // Same cycle-boundary-only draw as fuelRemaining/fuelSpent, so credits fall out of the per-tick
  // stepping identically (closed-form / stepped-safe). NOTE: creditsRemaining is NOT replenished
  // by credits EARNED within this same call, a completed cycle's reward is banked by economyTick
  // at the END of the call (available to the NEXT call's boundary), NOT mid-loop. This matches the
  // stepped path exactly because economyTick always advances ONE tick per call in production (live
  // + offline both step economyTick(_,1)), so at most one cycle boundary occurs per call and a
  // reward is never needed to fund an auto-buy in the same call that earned it.
  let creditsRemaining = creditsBudget;
  let creditsSpentOnFuel = 0;
  // Combat 0.13.0 (offline recap "why did it stop early"): the wall-stop reason to stamp onto
  // the RETURNED captain. Set ONLY at the truly-broke out-of-fuel hard-stop below (the
  // anti-infinite-fuel floor), NOT on a clean dispatch-once completion and NOT on a recall
  // (a user recall AND the cap-recall both exit via the shared `mission.recalled` branch, so
  // this function cannot tell them apart; the CARGO reason is stamped at its deterministic
  // root, the materialAtCap seam in economyTick, instead). Same deterministic branch live and
  // offline, touches no RNG/outcome/ordering, so offline stays byte-identical to live.
  let stopReason: CaptainStopReason | undefined;

  // The ship's extractionYieldMult is a MULTIPLIER (1.0 = no change, 1.35 =
  // +35%), but resolvedBonuses' tier yield mults are stored as ADDITIVE deltas
  // on top of a 1.0 base (rollExtractionTick does baseAmount*(1+mult)). So a
  // ship yield of 1.35x contributes +0.35, added on top of whatever talent
  // yield bonuses the caller already summed into `bonuses`. null ship -> 0
  // (no change). This folds ALL THREE tiers equally: the hull scales how much
  // ore/material each extracting tick produces, regardless of which tier won.
  const shipYieldBonus = shipStats ? shipStats.extractionYieldMult - 1 : 0;

  // Computed ONCE per call, not per roll, bonuses are constant for the
  // whole call, so this stays closed-form (the "one big jump equals many
  // small ticks" test doesn't care how many rolls happen, only that each
  // roll uses the same resolved bonuses either way). shipYieldBonus, added
  // to the three tier yield mults below, is likewise a call-constant, it's
  // derived from shipStats (fixed for the whole call), so it does not disturb
  // the closed-form property. It touches ONLY the three *YieldMult fields
  // (extraction AMOUNTS); the chance/bonus-roll fields are left untouched --
  // a hull's cargo/yield stats change how much a tick yields, not the odds of
  // hitting a tier or triggering a bonus roll.
  const resolvedBonuses = {
    commonYieldMult: (bonuses.commonYieldMult ?? 0) + shipYieldBonus,
    uncommonYieldMult: (bonuses.uncommonYieldMult ?? 0) + shipYieldBonus,
    uncommonChanceMult: bonuses.uncommonChanceMult ?? 0,
    rareYieldMult: (bonuses.rareYieldMult ?? 0) + shipYieldBonus,
    rareChanceMult: bonuses.rareChanceMult ?? 0,
    bonusRollChance: bonuses.bonusRollChance ?? 0,
    bonusRollChanceMult: bonuses.bonusRollChanceMult ?? 0,
    specBonusRollChance: bonuses.specBonusRollChance ?? 0,
  };

  while (remaining > 0 && mission !== null) {
    // Fuel Economy v2 (F3): the ordersReceived phase of a cycle that AUTO-BOUGHT its fuel
    // shortfall runs REFUEL_PENALTY_TICKS longer ("refuel at a non-allied station"). The delay
    // is a per-cycle constant stamped on mission.refuelDelayTicks at the cycle boundary (below)
    // / at dispatch, added ONLY to the first phase, so a penalized cycle is exactly 2 ticks
    // longer. CLOSED-FORM: requiredTicks is a pure function of (phase, missionDef, the cycle's
    // own stamped delay), all constant across the whole cycle, so one big ticksElapsed and many
    // small ones summing to it cross the phase boundary at the identical point, the same
    // property every other requiredTicksForPhase read in this loop already relies on. Non-
    // ordersReceived phases add 0. `?? 0` tolerates a pre-F3 in-flight mission (field absent).
    const requiredTicks =
      requiredTicksForPhase(mission.phase, missionDef) +
      (mission.phase === "ordersReceived" ? mission.refuelDelayTicks ?? 0 : 0);
    const ticksLeftInPhase = requiredTicks - mission.phaseProgressTicks;
    let ticksToApply = Math.min(remaining, ticksLeftInPhase);

    // Snap to the exact phase boundary when float drift leaves the tentative
    // post-step progress within epsilon of it. Recomputing ticksToApply from
    // requiredTicks (rather than nudging the comparison alone) keeps the
    // extraction roll count below and the completion check further down
    // reading the SAME corrected value, so neither can disagree with the other.
    if (Math.abs(mission.phaseProgressTicks + ticksToApply - requiredTicks) < MISSION_TICK_EPSILON) {
      ticksToApply = requiredTicks - mission.phaseProgressTicks;
    }

    // Task 4: count the WHOLE ticks this step crosses, for captain-XP accrual.
    // Same floor-boundary device as the extracting loot rolls below, but applied
    // in EVERY phase (XP accrues whenever the mission is in progress, not only
    // while extracting). Computed BEFORE phaseProgressTicks is advanced (needs
    // the pre-step value). Kept as its own two Math.floor lines rather than
    // sharing the extracting block's identical computation: that block is
    // delicate closed-form loot code under a strict do-not-touch, and the two
    // extra floors per iteration are negligible, readability/isolation over a
    // micro-consolidation. That deferred consolidation is logged in
    // SUGGESTIONS.md ("Consolidate the whole-tick floor-boundary device...").
    wholeTicksElapsed +=
      Math.floor(mission.phaseProgressTicks + ticksToApply) - Math.floor(mission.phaseProgressTicks);

    if (mission.phase === "extracting") {
      // Roll loot once per WHOLE tick boundary crossed during this step --
      // NOT once per step, since a single step can span many whole ticks
      // during a large offline-catchup jump. E.g. going from
      // phaseProgressTicks 2.4 by ticksToApply 4 (to 6.4) crosses whole
      // boundaries 3, 4, 5, 6, 4 rolls, matching 4 whole ticks' worth of
      // extraction, regardless of how this call got chunked.
      const fromWhole = Math.floor(mission.phaseProgressTicks);
      const toWhole = Math.floor(mission.phaseProgressTicks + ticksToApply);
      const rollsThisStep = toWhole - fromWhole;
      for (let i = 0; i < rollsThisStep; i++) {
        const delta = rollExtractionTick(missionDef, resolvedBonuses, rng);
        mission.cargo.commonOre = mission.cargo.commonOre.plus(delta.commonOre);
        mission.cargo.uncommonMaterial = mission.cargo.uncommonMaterial.plus(delta.uncommonMaterial);
        mission.cargo.rareMaterial = mission.cargo.rareMaterial.plus(delta.rareMaterial);

        // Bonus-roll trigger check runs every whole tick, independent of what
        // the primary roll above produced (see rollBonusExtractionTick's own
        // comment for why). 1 rng() call for the trigger itself; if it
        // fires, rollBonusExtractionTick makes up to 3 more.
        //
        // specBonusRollChance is added AFTER the base*(1+mult) scaling, NOT
        // folded into resolvedBonuses.bonusRollChance beforehand, see
        // captainSpecBonusRollChance's own comment for the exact overshoot
        // this ordering avoids (0.06 instead of the design doc's 0.05 target
        // for a resourcefulness-specced captain with both Lucky Strike
        // talents unlocked).
        const effectiveBonusRollChance = Math.min(
          1,
          resolvedBonuses.bonusRollChance * (1 + resolvedBonuses.bonusRollChanceMult) +
            resolvedBonuses.specBonusRollChance
        );
        if (rng() < effectiveBonusRollChance) {
          const bonusDelta = rollBonusExtractionTick(missionDef, resolvedBonuses, rng);
          mission.cargo.commonOre = mission.cargo.commonOre.plus(bonusDelta.commonOre);
          mission.cargo.uncommonMaterial = mission.cargo.uncommonMaterial.plus(bonusDelta.uncommonMaterial);
          mission.cargo.rareMaterial = mission.cargo.rareMaterial.plus(bonusDelta.rareMaterial);
        }
      }
    }

    mission.phaseProgressTicks += ticksToApply;
    remaining -= ticksToApply;
    // A phase that completes with call budget left over (spilling into the
    // next phase within this same call) can leave a sub-epsilon residue in
    // `remaining` even after the snap above (e.g. 2.58e-15), since `remaining`
    // itself was never snapped, only `ticksToApply` was. Left uncorrected,
    // that residue becomes the NEXT phase's starting phaseProgressTicks,
    // making a many-small-calls chain disagree with a single big call even
    // though every phase transition landed on the exact same boundary.
    if (Math.abs(remaining) < MISSION_TICK_EPSILON) {
      remaining = 0;
    }

    if (mission.phaseProgressTicks >= requiredTicks) {
      const nextIndex = MISSION_PHASE_ORDER.indexOf(mission.phase) + 1;
      if (nextIndex >= MISSION_PHASE_ORDER.length) {
        // Just completed "unloading", one full cycle is done.
        // Capture cargo in a const: `mission` is a `let` (CaptainMissionState |
        // null), and TS drops its non-null narrowing inside the forEach closure.
        const cargo = mission.cargo;
        // Mission Rework (Task 1): THE per-mission loot remap. The cargo still
        // accumulates under the 3 ABSTRACT rarity tiers (commonOre/uncommonMaterial/
        // rareMaterial, the roll mechanic is unchanged), but on delivery each tier's
        // total is deposited under THIS mission's own lootTable item key. For an ore
        // run whose lootTable is the identity map (common->commonOre etc.) this is
        // byte-identical to the pre-rework per-key copy; for salvage/forage/lunar it
        // routes the same amounts to their own materials. `?? new Decimal(0)` because a
        // non-ore mission's target keys are not among homePlanetDelta's seed keys yet
        // (grow-on-demand, same contract as addToInventory). missionDef is the
        // ship-adjusted def, which preserves lootTable unchanged (effectiveMissionDef
        // only rescales transit/cargo geometry).
        const loot = missionDef.lootTable;
        homePlanetDelta[loot.common] = (homePlanetDelta[loot.common] ?? new Decimal(0)).plus(cargo.commonOre);
        homePlanetDelta[loot.uncommon] = (homePlanetDelta[loot.uncommon] ?? new Decimal(0)).plus(cargo.uncommonMaterial);
        homePlanetDelta[loot.rare] = (homePlanetDelta[loot.rare] ?? new Decimal(0)).plus(cargo.rareMaterial);
        // Credits are still awarded once PER completed cycle (this branch can be
        // reached multiple times within one call's while loop, e.g. a big
        // offline-catchup ticksElapsed spanning several full cycles). Captain XP
        // (Task 4) AND Fleet Admiral XP (Task 5) are NO LONGER awarded here: both
        // now accrue per WHOLE tick, awarded once after the loop (see below), so
        // this branch touches only the credit total now.
        creditsDelta += missionDef.creditsPerCycle;
        // Task 6: one more completed cycle, counted in the SAME branch as the
        // credit award and the loot delivery above, so all three (loot,
        // credits, completion count) stay perfectly in sync per cycle.
        cyclesCompleted += 1;
        // Fuel Economy v2 (F3): the AUTO-REPEAT fuel-spend rule (REPLACES Task-5's
        // stop-on-empty). A finished cycle either ends (recall) or STARTS A FRESH CYCLE,
        // which costs one round trip's fuel (need = fuelPerCycle). Outcomes, in priority
        // order:
        //   1. recalled -> end the mission (unchanged pre-fuel behavior).
        //   2. TANK HAS ENOUGH (fuelRemaining >= need) -> spend it, NO penalty. With the
        //      default fuelPerCycle 0 this is always true and spends nothing, so a call
        //      omitting the fuel args is byte-identical to the pre-fuel engine.
        //   3. TANK SHORT but the shortfall is AFFORDABLE in credits -> AUTO-BUY the
        //      shortfall at creditsPerUnit AND stamp a +2-tick refuel penalty on the new
        //      cycle (refuelDelayTicks). The tank had `fuelRemaining`; we buy exactly the
        //      `shortfall` (NOT capped by fuelCap, just enough to fly) then spend `need`,
        //      netting the tank to 0 (a reduction of `fuelRemaining`, reported as fuelSpent);
        //      credits drop by the purchase cost (reported as creditsSpentOnFuel).
        //   4. TRULY BROKE (short AND can't afford the shortfall) -> HARD-STOP (mission ->
        //      null), the anti-infinite-fuel floor. Same terminal state as a completed
        //      recall; the captain idles until refuelled/re-dispatched. Rare by design --
        //      the refinery + friendly credits keep the player afloat.
        // The reconstruction reuses `missionKey` (function-scope const == this mission's key;
        // auto-repeat never changes it) so it stays valid even after the broke branch nulls
        // `mission` (avoids a null-narrowing snag on `mission.missionKey`).
        if (mission.recalled) {
          mission = null;
        } else {
          const need = fuelPerCycle;
          let refuelDelayTicks = 0;
          let startNextCycle = true;
          if (fuelRemaining >= need) {
            fuelRemaining -= need; // draw this cycle's fuel from the call budget
            fuelSpent += need;     // report it back for the tank deduction
          } else {
            const shortfall = need - fuelRemaining;
            const cost = shortfall * creditsPerUnit;
            if (creditsRemaining >= cost) {
              creditsRemaining -= cost;      // draw the auto-buy from the credit budget
              creditsSpentOnFuel += cost;    // report it back for the credits deduction
              fuelSpent += fuelRemaining;    // the tank drains from fuelRemaining down to 0
              fuelRemaining = 0;
              refuelDelayTicks = REFUEL_PENALTY_TICKS; // +2-tick refuel penalty on this cycle
            } else {
              startNextCycle = false;
              stopReason = "fuel"; // wall-stop: could not afford the next cycle's fuel
              mission = null; // truly broke: hard-stop (anti-infinite-fuel floor)
            }
          }
          if (startNextCycle) {
            mission = {
              kind: "extraction", // Combat 0.13.0 (9b.5a): tag the auto-repeated extraction cycle
              missionKey,
              phase: "ordersReceived",
              phaseProgressTicks: 0,
              cargo: emptyLootTotals(),
              recalled: false,
              refuelDelayTicks,
            };
          }
        }
      } else {
        mission.phase = MISSION_PHASE_ORDER[nextIndex];
        mission.phaseProgressTicks = 0;
      }
    }
  }

  // Task 4: award captain XP ONCE per call, for the total whole ticks the
  // mission advanced above (xpRate is a call-constant). Then resolve every
  // level-up crossed by that award, the SAME subtract-threshold loop as
  // before (unchanged semantics), just relocated out of the per-cycle branch
  // and run a single time: a while (not if) loop so a large offline-catchup
  // accrual can climb multiple levels, bounded by MAX_LEVEL_UPS_PER_TICK with
  // any excess left in xp to carry forward to a later call (mirrors
  // applyFleetAdminXp's own carry-forward). Because this loop fully drains all
  // crossable thresholds each call, awarding the total as one lump lands the
  // identical level/statPoints/leftover-xp as accruing it tick-by-tick.
  //
  // ⚠️ CLOSED-FORM PARITY TRAP, READ BEFORE CHANGING xpRate TO A FRACTION ⚠️
  // The exact "one big call == many small calls" guarantee (protected by the
  // closed-form parity test in tick.test.ts) holds TODAY because xpRate is the
  // integer 1 (xpPerTick returns BASE_XP_PER_TICK unchanged). The big call adds
  // xpRate*(total whole ticks) in ONE product; the stepped path adds
  // xpRate*(per-call whole ticks) many times. Those two agree ONLY when the
  // per-product arithmetic is exact, which integer rates guarantee, but a
  // FRACTIONAL rate does NOT: 0.1*3 !== 0.1+0.1+0.1 in floating point, so the
  // moment xpPerTick starts returning a fractional rate (see its documented
  // XP-mult seam), a single big-call product can silently diverge from the
  // stepped sum and break parity, and the current rate-1 parity test will NOT
  // catch it. Using Decimal below (new Decimal(xpRate).times(...)) is
  // defense-in-depth, NOT a proof: Decimal reduces but does not by itself
  // guarantee distributivity for an arbitrary fractional rate. Before shipping
  // any fractional rate you MUST (a) re-derive this accrual to stay drift-free
  // at that rate, and (b) add a closed-form parity test AT the real fractional
  // rate, that test, not the Decimal call, is the actual safeguard.
  // Captured as its own const (identical value to the previous inline expression --
  // behavior-preserving) so Task 6 can report the GROSS XP awarded this call in
  // lifetimeStatsDelta.captainXpAwarded below, distinct from the captain's own `xp`
  // (which the level-up loop then drains by subtracting thresholds).
  const captainXpAwardedThisCall = new Decimal(xpRate).times(wholeTicksElapsed);
  xp = xp.plus(captainXpAwardedThisCall);
  // Captain level-ups via the shared fold helper (was an inline subtract-and-carry
  // loop). Captain XP awards ONE stat point per level, so statPoints climbs by the
  // level-up count. Behavior-identical to the old loop.
  const captainLevelUps = foldXpLevelUps(xp, level, xpForNextLevel);
  xp = captainLevelUps.xp;
  level = captainLevelUps.level;
  statPoints += captainLevelUps.levelUps;

  // Task 5: award Fleet Admiral XP ONCE per call, for the total whole ticks the
  // mission advanced above, the SAME wholeTicksElapsed counter captain XP uses
  // just above, and the SAME per-active-tick model. Relocated OUT of the per-cycle
  // completion branch (where it used to add missionDef.fleetAdminXpPerCycle once
  // per finished cycle) to here, so FA XP now tracks active TIME, not cycle count.
  // tick() sums this fleetAdminXpDelta across every captain fleet-wide, so N
  // captains each on an active mission stack to N FA XP/tick with no extra code.
  //
  // ⚠️ CLOSED-FORM PARITY TRAP, READ BEFORE MAKING fleetAdminXpRate FRACTIONAL ⚠️
  // Mirrors the captain-XP trap just above: the exact "one big call == many small
  // calls" guarantee (protected by the closed-form parity test in tick.test.ts)
  // holds TODAY because fleetAdminXpRate is the integer 1. The big call adds
  // fleetAdminXpRate * (total whole ticks) in ONE product; the stepped path adds
  // fleetAdminXpRate * (per-call whole ticks) many times, those two agree ONLY
  // when each product is exact, which integer rates guarantee but a FRACTIONAL
  // rate does NOT (0.1*3 !== 0.1+0.1+0.1 in floating point). fleetAdminXpDelta is
  // a plain `number`, integer-exact at rate 1 (no Decimal wrap needed at this rate
  //, unlike captain XP, whose total is a Decimal for its own big-number reasons).
  // The moment any mission's fleetAdminXpPerTick becomes fractional you MUST (a)
  // re-derive this accrual to stay drift-free at that rate, and (b) add a
  // closed-form parity test AT that fractional rate, the current rate-1 parity
  // test will NOT catch the regression, and the `number` type is not itself a
  // proof of parity.
  //
  // Captured as its own const (single source for the product), used at BOTH the
  // fleetAdminXpDelta accrual just below and the lifetimeStatsDelta.fleetAdminXpAwarded
  // field, mirroring captainXpAwardedThisCall's single-source treatment above.
  // Value-identical to the previous two-site computation; no behavior change.
  const fleetAdminXpAwardedThisCall = fleetAdminXpRate * wholeTicksElapsed;
  fleetAdminXpDelta += fleetAdminXpAwardedThisCall;

  // Task 6: assemble the lifetime-stat delta for this call.
  // - itemsGathered mirrors homePlanetDelta EXACTLY: inside this function
  //   homePlanetDelta is populated ONLY by the cycle-completion loot delivery
  //   above (passiveTrickle lives in tick(), not here), so it already IS the total
  //   raw loot delivered this call. A shallow clone (new object, same immutable
  //   Decimal refs) keeps it independent of the returned homePlanetDelta the caller
  //   also folds. All 3 loot keys are always present (emptyLootTotals seed), so a
  //   tier that delivered nothing records a 0, deliberately mirroring, not
  //   filtering, what went to homePlanetDelta.
  // - missionsCompleted is sparse: only the one running missionKey, only when at
  //   least one cycle finished (kept absent at 0 per the maps' sparse-by-design
  //   contract), so a call that completes no cycle contributes an empty map.
  // - creditsEarned mirrors creditsDelta; captainXpAwarded is the GROSS award
  //   captured pre-level-up; fleetAdminXpAwarded wraps the same fleetAdminXpAwardedThisCall
  //   const folded into fleetAdminXpDelta above, as a Decimal for the lifetime sum.
  const lifetimeStatsDelta: MissionLifetimeStatsDelta = {
    itemsGathered: { ...homePlanetDelta },
    missionsCompleted: cyclesCompleted > 0 ? { [missionKey]: new Decimal(cyclesCompleted) } : {},
    creditsEarned: new Decimal(creditsDelta),
    captainXpAwarded: captainXpAwardedThisCall,
    fleetAdminXpAwarded: new Decimal(fleetAdminXpAwardedThisCall),
  };

  return {
    captain: { ...captain, mission, xp, level, statPoints, lastStopReason: stopReason ?? captain.lastStopReason },
    homePlanetDelta,
    fleetAdminXpDelta,
    creditsDelta,
    lifetimeStatsDelta,
    fuelSpent,
    creditsSpentOnFuel,
  };
}

// ============================================================================
// Combat Patrols (Combat 0.13.0, Phase 9b.5c): the PATROL TICK LOOP. This is the
// patrol twin of tickCaptainMission: it advances a dispatched patrol along its
// route, fights a resolveBattle at each scheduled wave, carries the player's hull/
// shield/drones between waves (attrition, design S14), and resolves the patrol
// (success/relaunch, defeat, recall). economyTick's switch(kind) routes a patrol
// captain here; NO rewards/XP/loot are awarded (that is Phase 10), only win/loss +
// carry-state + end conditions.
//
// ⚠️ THE HARD INVARIANT: CLOSED-FORM PARITY (offline == live). economyTick is called
// as economyTick(state, 1) many times live AND as one economyTick(state, N) for
// offline catch-up; this function MUST produce a byte-identical resulting mission
// (progress, waves, carry-state, phase, nextWaveIndex) either way. The mechanism:
//   1. WHOLE-ROUTE-TICK BOUNDARIES. progressTicks advances boundary by boundary
//      exactly like tickCaptainMission's phaseProgressTicks: a fractional remainder
//      just banks into `progress` and crosses no boundary, so one big ticksElapsed
//      and many small ones summing to it cross the IDENTICAL integer route ticks in
//      the IDENTICAL order. A wave / regen happens ONLY on a whole-tick crossing.
//   2. STATE-DERIVED BATTLE SEEDS (NOT tick timing). Each wave's enemy team + battle
//      draw their seeds from deriveWaveSeed(masterSeed, waveIndex, salt), a pure
//      function of persisted state, independent of how ticks are batched. Same wave =>
//      same seeds => same outcome, always. A RELAUNCH's fresh master seed is likewise a
//      pure transform of the captain's OWN current seed (see RELAUNCH_SEED_SALT), never
//      drawn from the fleet-wide nextPatrolSeed counter, so multi-patrol relaunch order
//      cannot perturb it either (the multi-captain parity fix).
// This is TICK-BY-TICK over whole route ticks (a big call is literally a loop of the
// same single-tick advances), so parity holds BY CONSTRUCTION (the safest v1).
// TRADEOFF (flagged per the design): it is O(ticksElapsed). A patrol route is bounded
// (~14 ticks/cycle here), and a repeat-dispatch patrol under a very long offline
// absence loops many cycles' worth of ticks (bounded by tick()'s offline cap). A
// closed-form event-jumping optimization (jump straight to the next wave tick) is a
// valid FUTURE improvement, but ONLY if it provably preserves parity; if in ANY
// doubt, this tick-by-tick form is correct by construction and is what the parity
// test in patrol-tick.test.ts gates.
// ============================================================================

// Combat 0.13.0 (Phase 12b-1 review): fmix32, deriveWaveSeed, and the four wave-seed
// salts (WAVE_ENEMY_SEED_SALT, WAVE_BATTLE_SEED_SALT, RELAUNCH_SEED_SALT,
// WAVE_LOOT_SEED_SALT) were RELOCATED, value-identical, into combat/waveSeed.ts so the
// display-only patrol replay imports them from a leaf instead of UP from this live loop.
// They are imported at the top of this file and used below exactly as before. See
// combat/waveSeed.ts for the derivation + the "do NOT change these salt values once
// patrols shipped live" lock note.
//
// deriveWaveSeed is re-exported here so its long-standing external importers (the patrol
// test suites that import it from "./tick") keep working unchanged; the true source of
// truth is combat/waveSeed.ts.
export { deriveWaveSeed } from "./combat/waveSeed";

// Combat 0.13.0 (Phase 10, design S12): the PATROL LOOT TABLES, keyed by PatrolKey. This is
// the SINGLE data-driven source for what a won wave (a wreck) drops, so ship-class-specific
// and rare-enemy tables can slot in later (design S12) without touching the roller. tick.ts
// owns the concrete tables (they reference ITEMS keys + the balance values), while the pure
// roll lives in patrolLoot.ts. A patrol WITHOUT its own entry falls back to
// DEFAULT_PATROL_LOOT_TABLE, so a future PATROLS key never rolls nothing by omission.
//
// ⚠️ EVERY amount below is FIRST-PASS TUNABLE (design S20 loot-rate pass), same
// launch-placeholder discipline as MISSIONS/RECIPES/PATROLS. Rationale for the current
// values: a patrol is 2 won waves, so a full clear yields ~2x these bands. Kept modest so
// combat FEEDS the economy without trivializing it (a won patrol is a small, riskier
// alternative to an extraction cycle, not a jackpot).
//
// ⚠️ NO FUNCTIONAL GEAR (design S12): every itemId below is a MATERIAL category
// (raw/refined/component/salvagedMaterial), NEVER a shipModule/shipSystem/equipment. This
// protects the crafting loop; patrol-loot.test.ts locks the invariant against every table id.
//
// WEAPON-CRAFTING LOOT (Combat 1.0, Unit 1.7, design S12): the formerly-reserved
// "Damaged [System]" drop is now WIRED via the table's `damagedSystem` slot (weapon
// crafting exists, so the item feeds a real loop). It is the Damaged Reactor Housing
// idiom for weapons: a CHANCE-gated salvaged-material drop (the Damaged Weapon System)
// that salvages into weapon build materials. Still a MATERIAL, never functional gear
// (design S12); its draw is LAST in rollWaveLoot so the salvage/cargo/credit values above
// stay byte-identical (parity untouched for the existing loot).
// Exported so patrol-loot.test.ts can lock the tables' contract directly (every id resolves
// to a non-gear ITEMS category; the no-functional-gear invariant), the same export-for-tests
// rationale as foldXpLevelUps / MAX_LEVEL_UPS_PER_TICK.
export const DEFAULT_PATROL_LOOT_TABLE: PatrolLootTable = {
  // Guaranteed salvaged-material drop: the only existing salvagedMaterial item, the wreck's
  // stripped reactor shell. 1-2 per wave (small, per design "a small amount").
  salvage: { itemId: "intactReactorCore", minQty: 1, maxQty: 2 },
  // Cargo hold: a modest, representative spread of EXISTING raw / refined / component items
  // (no invented keys). Uniform pick over this pool, then a small qty roll per pick.
  cargoPool: [
    { itemId: "scrapAlloy", minQty: 2, maxQty: 5 },      // raw (recoveredTech): battlefield scrap
    { itemId: "commonOre", minQty: 2, maxQty: 5 },        // raw (oresMetals): structural ore
    { itemId: "titaniumIngot", minQty: 1, maxQty: 3 },    // refined: salvaged refined stock
    { itemId: "frameSegment", minQty: 1, maxQty: 2 },     // minorComponent: a recovered strut
    { itemId: "powerCoupling", minQty: 1, maxQty: 2 },    // minorComponent: a recovered junction
  ],
  cargoPicksMin: 1,
  cargoPicksMax: 2,
  // Modest bounty. A won patrol (2 waves) nets ~20-60 credits, on the order of a mission
  // cycle's payout, not a windfall (RESPEC_COST is 50, a Freighter build is 500).
  creditsMin: 10,
  creditsMax: 30,
  // XP per won wave, riding the EXISTING tracks. captainXpPerWave 20 => a 2-wave patrol is
  // ~40 captain XP (xpForNextLevel(1) is 300, so ~7-8 patrols per early level, richer than
  // extraction's 1/tick to reward the risk). fleetAdminXpPerWave 10 => ~20 FA XP/patrol
  // (xpForNextFleetAdminLevel(1) is 750, so FA still lags, per its design intent).
  captainXpPerWave: 20,
  fleetAdminXpPerWave: 10,
  // WEAPON-CRAFTING LOOT (Combat 1.0, Unit 1.7): a MODEST, chance-gated Damaged Weapon
  // System drop (a wreck's mangled gun stripped for parts). 1 in 4 won waves (25%) => a
  // won 2-wave patrol drops one ~44% of the time on average, so it is a welcome extra, not
  // a reliable feed (design S12: combat FEEDS crafting, does not trivialize it). Salvages
  // into weapon build materials via SALVAGE_LOOT_POOLS.damagedWeaponSystem. FIRST-PASS
  // TUNABLE (raise chanceNum / widen the qty band at the S20 loot-rate pass). itemId is a
  // salvagedMaterial (NOT gear): the no-functional-gear invariant (design S12) still holds.
  damagedSystem: { itemId: "damagedWeaponSystem", chanceNum: 1, chanceDen: 4, minQty: 1, maxQty: 1 },
};

// The tougher Crimson-Reaver Warband's OWN richer loot table (Combat 1.0 Unit 2.5b). It reuses
// the SAME roller + the SAME existing material ids (no invented keys, no functional gear, design
// S12 still holds); every band is a MODEST STEP UP from the default entry table to match the
// patrol's higher fuel cost + real combat risk. FIRST-PASS TUNABLE (the S20 loot-rate pass owns
// the final magnitudes). Kept beside the default so a maintainer sees the two side by side.
export const WARBAND_PATROL_LOOT_TABLE: PatrolLootTable = {
  // More wreck salvage per won wave (2-4 vs 1-2): a corsair tender is a bigger hull to strip.
  salvage: { itemId: "intactReactorCore", minQty: 2, maxQty: 4 },
  // The SAME cargo pool ids as the entry table (all real material keys), with slightly fatter qty
  // bands: a warband wreck's hold is richer. Uniform pick, then a qty roll per pick.
  cargoPool: [
    { itemId: "scrapAlloy", minQty: 3, maxQty: 7 },      // raw (recoveredTech): battlefield scrap
    { itemId: "commonOre", minQty: 3, maxQty: 7 },        // raw (oresMetals): structural ore
    { itemId: "titaniumIngot", minQty: 2, maxQty: 4 },    // refined: salvaged refined stock
    { itemId: "frameSegment", minQty: 1, maxQty: 3 },     // minorComponent: a recovered strut
    { itemId: "powerCoupling", minQty: 1, maxQty: 3 },    // minorComponent: a recovered junction
  ],
  // 2-3 cargo picks (vs 1-2): more waves + bigger wrecks yield a bit more cargo.
  cargoPicksMin: 2,
  cargoPicksMax: 3,
  // A fatter bounty band (30-70 vs 10-30): a 2-3 wave warband nets meaningfully more credits than
  // the 2-wave Sweep, on the order of a couple of the toughest missions' payout, not a windfall.
  creditsMin: 30,
  creditsMax: 70,
  // More XP per won wave than the Sweep (35 / 18 vs 20 / 10): the tougher fight pays a bigger
  // captain + Fleet Admiral XP reward for the real risk. Flat (no draw), so trivially closed-form.
  captainXpPerWave: 35,
  fleetAdminXpPerWave: 18,
  // A better-than-even Damaged Weapon System drop (2 in 5 won waves, qty 1-2, vs the Sweep's 1 in 4
  // qty 1): a corsair-heavy warband is a richer feed for the weapon-craft chain, still a MATERIAL
  // that SALVAGES into build parts (never functional gear, design S12). FIRST-PASS TUNABLE (S20).
  damagedSystem: { itemId: "damagedWeaponSystem", chanceNum: 2, chanceDen: 5, minQty: 1, maxQty: 2 },
};

export const PATROL_LOOT_TABLES: Record<PatrolKey, PatrolLootTable> = {
  // The entry patrol uses the default table. The tougher warband (Unit 2.5b) gets its OWN richer
  // entry (bigger bands + a better damaged-system feed) with no roller change.
  crimsonReaverSweep: DEFAULT_PATROL_LOOT_TABLE,
  crimsonReaverWarband: WARBAND_PATROL_LOOT_TABLE,
};

// Resolve the loot table for a patrol, falling back to the default so a future PATROLS key
// added WITHOUT a table entry still drops loot (never rolls nothing by omission).
function lootTableForPatrol(patrolKey: PatrolKey): PatrolLootTable {
  return PATROL_LOOT_TABLES[patrolKey] ?? DEFAULT_PATROL_LOOT_TABLE;
}

// patrolPhaseFor: derive the coarse PatrolPhase from the route position, PURE. The
// route is transitOut [0, transitOutTicks) -> engaging [transitOutTicks,
// transitOutTicks+rollWindowTicks) -> transitBack [.., routeLength). Floors the
// (possibly fractional) progress so a sub-tick residue reads as its whole route tick.
// The tick loop derives-and-stores mission.phase from this each whole tick so the
// persisted phase stays consistent with progressTicks (and the 9b.5d UI reads it).
// Exported for the tests.
export function patrolPhaseFor(def: PatrolDef, progressTicks: number): PatrolPhase {
  const t = Math.floor(progressTicks);
  const engageStart = def.transitOutTicks;
  const engageEnd = def.transitOutTicks + def.rollWindowTicks; // exclusive
  if (t < engageStart) return "transitOut";
  if (t < engageEnd) return "engaging";
  return "transitBack";
}

// Deep-clone a patrol's carry-state drone squadrons (squadron + its per-drone list)
// so the tick loop's in-place replenishDrones mutations NEVER touch the caller's
// input mission (purity: the offline-big-call vs stepped-call parity test advances
// the SAME input state two ways and compares). Mirrors combat/resolveBattle.ts's
// cloneParticipants drone clone exactly. An empty array (non-carrier) clones to [].
function cloneSquadrons(squadrons: DroneSquadron[]): DroneSquadron[] {
  return squadrons.map((sq) => ({ ...sq, drones: sq.drones.map((d) => ({ ...d })) }));
}

// The result tickCaptainPatrol reports back to economyTick, mirroring
// tickCaptainMission's fold: the updated captain (mission advanced, relaunched, or
// null), plus the shared-budget draws, plus the ship-damaged flag a defeat raises.
interface PatrolTickResult {
  // The captain with its mission advanced. mission is null when the patrol ENDED this
  // call (success without repeat, defeat, recall-at-cycle-end, or truly-broke relaunch).
  captain: CaptainState;
  // True iff a DEFEATED patrol finished LIMPING HOME this call: economyTick sets the
  // assigned ship's `damaged` flag + stamps repairDamage (Phase 11, design S13). Note this
  // is now raised when the limp-home countdown completes, NOT at the lost-wave instant (the
  // wreck must reach base first). A success/recall/broke end leaves the ship intact.
  shipDamaged: boolean;
  // Combat 0.13.0 (Phase 11): the HULL POINTS the ship must repair (hullIntegrity minus the
  // carry-state hull at the defeat instant), carried through the limp and reported here when
  // the hull reaches base so economyTick can stamp ShipInstance.repairDamage. 0 unless
  // shipDamaged is true this call (the only call that flags the ship).
  shipDamageTaken: number;
  // Fuel drawn from the SHARED tank budget for RELAUNCH cycles this call (0 unless a
  // repeat-dispatch patrol completed a route and relaunched). economyTick subtracts it
  // from the Decimal tank exactly as it does tickCaptainMission's fuelSpent.
  fuelSpent: number;
  // Credits drawn AUTO-BUYING a relaunch fuel shortfall (mirrors extraction's F3 rule).
  creditsSpentOnFuel: number;
  // Combat 0.13.0 (Phase 10, design S12): the REWARDS this call earned, folded by economyTick
  // through the SAME deltas the extraction arm uses (tickCaptainMission returns the identical
  // shapes). Each is the sum over the waves WON this call (a LOST wave / defeat earns nothing).
  // - homePlanetDelta: rolled loot MATERIALS (itemId -> Decimal qty), folded into home
  //   inventory EXACTLY like extraction's homePlanetDelta (grow-on-demand keys, quality roll,
  //   cap clamp). Empty when no wave was won this call.
  // - creditsDelta: the summed credit BOUNTY, folded into state.credits like extraction's.
  // - fleetAdminXpDelta: the summed Fleet Admiral XP, folded through applyFleetAdminXp like
  //   extraction's (rides the existing FA track, no new bar).
  // NOTE: captain XP is NOT a delta here, it is already applied onto `captain` above (its xp/
  //   level/statPoints reflect the won waves), mirroring how tickCaptainMission returns the
  //   captain with its XP + level-ups already folded (both use the shared foldXpLevelUps).
  homePlanetDelta: Record<string, Decimal>;
  creditsDelta: number;
  fleetAdminXpDelta: number;
  // Combat 0.13.0 (Phase 10): this call's LIFETIME-STATS contribution, folded by economyTick
  // through the SAME foldLifetimeStatsDelta seam the extraction arm uses for
  // tickCaptainMission's lifetimeStatsDelta, so patrol loot counts toward lifetime totals
  // exactly like extraction loot. Built from the SAME won-wave accumulators as the deltas
  // above (empty on a no-win call). See the build site below for which fields map and which
  // extraction-specific field (missionsCompleted) is deliberately left empty for patrols.
  lifetimeStatsDelta: MissionLifetimeStatsDelta;
}

// tickCaptainPatrol: advance ONE captain's patrol by `ticksElapsed` route ticks. PURE
// given its inputs (the only randomness is the state-derived combat seeds, never
// Math.random), so it is closed-form / offline==live (see the header invariant). A
// RELAUNCH derives its fresh master seed PURELY from this captain's OWN current seed
// (RELAUNCH_SEED_SALT), so the result depends on THIS captain's state alone, never on
// other captains or tick batching (the multi-patrol parity fix). Returns a
// PatrolTickResult; economyTick owns the shared-tank / ship threading (this function
// reports draws, it does not touch GameState or the fleet-wide nextPatrolSeed counter).
export function tickCaptainPatrol(
  ticksElapsed: number,
  captain: CaptainState,
  // The captain's assigned hull (GameState.ships find by assignedCaptainId). A patrol
  // REQUIRES a combat hull (dispatch guaranteed it); undefined / non-combat is a
  // defensive no-op (cannot happen in normal play: assignShipToCaptain locks mid-mission).
  ship: ShipInstance | undefined,
  // Shared-tank budget this call may draw for RELAUNCH cycles, and one round trip's fuel
  // cost on this hull (economyTick prices it from the equipment-folded engineEfficiency,
  // like the extraction path). Threaded exactly like tickCaptainMission's fuelBudget /
  // fuelPerCycle so two captains in one call cannot double-spend the one tank.
  fuelBudget: number,
  fuelPerCycle: number,
  // Shared credits budget for AUTO-BUYING a relaunch fuel shortfall, and the price per
  // unit (mirrors tickCaptainMission's F3 auto-buy). Default price is the real one.
  creditsBudget: number,
  creditsPerUnit: number = FUEL_CREDITS_PER_UNIT,
  // Combat 1.0 (Unit 1.4): the ship's INSTALLED combat gear (state.equipment fitted to this ship),
  // resolved by the caller via equippedFor so the player combatant reads real weapons + shield +
  // hull + defenses instead of the hull defaults. OPTIONAL: absent (the default) keeps the pre-1.4
  // hull-default build, so a direct test call with no gear still resolves combat. In normal play
  // economyTick always passes the ship's fitted set (>=1 weapon + shield + plating, guaranteed by
  // the dispatch blocker); a Standard-Issue set folds byte-identically to the old hull default.
  // UNDEFINED (not []) is the absent sentinel: an empty array would mean "gear present but bare"
  // (no weapons / zero shields), so a not-passed gear falls back to the hull-default build instead.
  installedGear?: EquipmentInstance[],
): PatrolTickResult {
  const noOp: PatrolTickResult = {
    captain,
    shipDamaged: false,
    shipDamageTaken: 0,
    fuelSpent: 0,
    creditsSpentOnFuel: 0,
    // No wave fought => no reward (empty material delta, zero credits/FA XP, captain untouched).
    homePlanetDelta: {},
    creditsDelta: 0,
    fleetAdminXpDelta: 0,
    lifetimeStatsDelta: emptyMissionLifetimeStatsDelta(),
  };
  // Only the patrol arm advances here; idle / extraction / a sub-tick call is a no-op.
  if (!captain.mission || captain.mission.kind !== "patrol" || ticksElapsed <= 0) return noOp;
  // A patrol requires a combat hull. combatHullTypeOf resolves the CombatHullType (drives
  // the player's default weapons + carrier drone screen). null / no ship -> defensive no-op.
  const hullType = ship ? combatHullTypeOf(ship.typeKey) : null;
  if (!ship || hullType === null) return noOp;

  const def = PATROLS[captain.mission.patrolKey];
  const shipDef = SHIP_TYPES[ship.typeKey];
  const playerId = ship.id; // the player combatant's stable id across every wave (id-sorted lookup)
  const routeLength = def.transitOutTicks + def.rollWindowTicks + def.transitBackTicks;
  // Combat 0.13.0 (Phase 11, design S13): the LIMP-HOME duration a defeat imposes = 2x the
  // return leg (movement is damaged, so the wreck crawls back at half speed). A pure
  // function of the def, deterministic, computed once. FIRST-PASS: fixed 2x regardless of
  // where in the route the ship died (design S13 says "2x return time"); a crew bonus /
  // module exception is a forward hook only (not this pass).
  const limpHomeTicks = 2 * def.transitBackTicks;
  // Combat 0.13.0 (Phase 10): the loot table for THIS patrol, resolved once. patrolKey is
  // invariant across a relaunch (a relaunch reuses the same patrolKey), so this one table
  // covers every cycle this call advances, exactly like `def` above.
  const patrolKey = captain.mission.patrolKey; // captured once; also keys the completed-route tally below
  const lootTable = lootTableForPatrol(patrolKey);
  // Combat-defense BLOCKER fix (2026-08-27): the ship's FOLDED defensive carry-pools (hullMax /
  // shieldMax / shieldRecharge), derived from the SAME installed-gear fold the wave combatant fights
  // with (foldedPlayerDefense -> shipToCombatant). The between-wave shield regen (its cap clamp) and
  // the limp-home damage below MUST use these, not the raw authored SHIP_TYPES stats, or a crafted
  // emitter's above-authored shield is stripped on the first quiet tick and a crafted-plated hull's
  // limp damage goes negative. Computed once (pure). For a Standard-Issue set (or absent gear) this
  // folds byte-identically to the authored stats, so parity + SI fixtures do not move.
  const foldedDefense = foldedPlayerDefense(shipDef, installedGear);

  // WORKING mission copy. Spread makes a fresh object (so wavesWon/phase/etc. mutations
  // never touch the input), and playerDrones is DEEP-cloned so the between-wave
  // replenishDrones in-place mutations stay off the caller's input (purity). waveTicks is
  // read-only here (only REPLACED wholesale on relaunch), so sharing its ref is safe.
  let mission: PatrolMissionState | null = {
    ...captain.mission,
    playerDrones: cloneSquadrons(captain.mission.playerDrones),
  };

  // The (possibly fractional) route position, advanced boundary-by-boundary below.
  let progress = mission.progressTicks;
  let shipDamaged = false;
  // Combat 0.13.0 (offline recap "why did it stop early"): the wall-stop reason to stamp onto
  // the RETURNED captain, set ONLY at a genuine wall-stop below (limp-home defeat end, or a
  // truly-broke relaunch), left undefined on a clean completion / recall. Set at the SAME
  // deterministic branch live and offline, and it touches no RNG draw / outcome / ordering, so
  // offline stays byte-identical to live. Folded into the return as `stopReason ??
  // captain.lastStopReason` so a call that does NOT wall-stop preserves whatever was there.
  let stopReason: CaptainStopReason | undefined;
  // Combat 0.13.0 (Phase 11): the hull points to repair, reported to economyTick ONLY when a
  // limp-home completes this call (0 otherwise). Captured at the defeat instant, carried on
  // the mission through the limp, and read out here when the wreck reaches base.
  let shipDamageTaken = 0;
  // Shared-budget locals, drawn down at relaunch cycle boundaries ONLY (like the
  // extraction engine's fuel/credits), reported back as the *Spent totals.
  let fuelRemaining = fuelBudget;
  let fuelSpent = 0;
  let creditsRemaining = creditsBudget;
  let creditsSpentOnFuel = 0;
  // Combat 0.13.0 (Phase 10, design S12): REWARD accumulators, summed over every wave WON
  // this call ("accumulate locally, apply once", the same shape as tickCaptainMission's
  // homePlanetDelta / creditsDelta / fleetAdminXpDelta / captainXpAwardedThisCall). A LOST
  // wave (defeat) contributes NOTHING (the defeat branch breaks before any accrual). These
  // stay 0/empty on a call that wins no wave, so a transit-only or sub-tick call is reward-free.
  const lootMaterials: Record<string, Decimal> = {}; // itemId -> summed Decimal qty (home-inventory delta)
  let creditsAwarded = 0;        // summed credit bounty
  let fleetAdminXpAwarded = 0;   // summed Fleet Admiral XP (rides the existing FA track)
  let captainXpAwarded = 0;      // summed captain XP (folded onto the captain at the end of this call)
  // Count of full routes WON this call (a patrol "mission completed"). Like extraction's
  // cyclesCompleted: a single offline call can complete MANY routes (repeat-dispatch relaunch),
  // so this counts each one and feeds the missionsCompleted lifetime tally below.
  let routesCompleted = 0;

  let remaining = ticksElapsed;
  while (remaining > 0 && mission !== null) {
    // Advance to the NEXT whole route-tick boundary (the extraction closed-form idiom).
    const nextBoundary = Math.floor(progress) + 1;
    let step = Math.min(remaining, nextBoundary - progress);
    // Snap to the boundary when float drift leaves the tentative step within epsilon of
    // it, so the "landed on a whole tick?" test below reads the corrected value.
    if (Math.abs(progress + step - nextBoundary) < MISSION_TICK_EPSILON) {
      step = nextBoundary - progress;
    }
    progress += step;
    remaining -= step;

    // A sub-tick partial (did not reach the boundary): nothing happens except banking
    // `progress`; the loop exits next check (remaining now 0) with the residue carried.
    if (Math.abs(progress - nextBoundary) >= MISSION_TICK_EPSILON) continue;
    progress = nextBoundary; // exactly on a whole route tick

    // ---- LIMP-HOME (Combat 0.13.0, Phase 11, design S13). ---------------------------
    // A prior defeat switched this patrol into the "limpingHome" phase (see the defeat
    // branch below). Every whole route tick now ONLY decrements the limp countdown, no
    // waves fire, no shield/drone recovery, no completion/relaunch check. When the counter
    // reaches 0 the wreck has reached base: END the mission (captain idles) and report the
    // ship as damaged + the hull points to repair, which economyTick stamps onto the ship
    // (ShipInstance.damaged + repairDamage). The ship is flagged ONLY here (on arrival),
    // never at the lost-wave instant, so a defeated ship is neither instantly reusable nor
    // prematurely parked in the repair bay while still flying home.
    // CLOSED-FORM / PARITY: one whole-tick crossing == one decrement, so a single big call
    // and many one-tick calls cross the identical number of ticks and land the countdown at
    // the identical value (the exact argument the wave loop's closed-form relies on).
    if (mission.phase === "limpingHome") {
      mission.limpTicksRemaining = (mission.limpTicksRemaining ?? 0) - 1;
      if (mission.limpTicksRemaining <= 0) {
        shipDamaged = true;
        shipDamageTaken = mission.limpDamage ?? 0; // 0 only on a corrupt/absent capture
        stopReason = "defeat"; // wall-stop: a defeated patrol limped home and ended damaged
        mission = null;
        break;
      }
      continue; // still crawling home; nothing else happens this tick
    }

    const routeTick = nextBoundary;
    const waveIndex = mission.nextWaveIndex;
    // A wave fires this route tick iff the schedule places one exactly here. waveTicks is
    // ascending + distinct (one wave per tick, waveSchedule.ts), so at most one per tick.
    const waveThisTick =
      waveIndex < mission.waveTicks.length && mission.waveTicks[waveIndex] === routeTick;

    if (waveThisTick) {
      // ---- FIGHT the scheduled wave. --------------------------------------------------
      // PLAYER combatant: FRESH from the hull defaults (weapons + cooldowns reset each
      // wave, each wave being a discrete battle, design-correct), then OVERRIDE hull/
      // shield/drones with the CARRY-STATE so damage + drone losses persist across waves.
      // Built through the SHARED leaf (combat/patrolWave.ts) that the display-only patrol
      // replay also uses, so the two paths cannot drift (structural parity, Phase 12b-1).
      const player = buildPatrolPlayerCombatant({
        playerId,
        stats: shipDef,
        hullType,
        stance: mission.stance,
        // Combat 1.0 (Unit 1.4): the ship's INSTALLED combat gear drives weapons + shield + hull +
        // defenses. The display replay derives this the SAME way (equippedFor off the SAME state), so
        // the two combatants stay byte-identical (the structural-parity contract this helper enforces).
        installedGear,
        carryHull: mission.playerHull,
        carryShield: mission.playerShield,
        carryDrones: mission.playerDrones,
        // Phase 12b Unit B2: apply the ACCUMULATED per-system durability so a system worn in an
        // earlier wave opens this one already worn (a multi-wave patrol can now reach Degraded/
        // Offline). Outcome-affecting + parity-critical: the wear is derived from the deterministic
        // combat stream, so big==stepped and offline==live still hold (locked by the parity tests).
        carrySystemDurability: mission.playerSystemDurability,
      });

      // ENEMY team: deterministic from the ENEMY-salt derivation. idPrefix = faction id +
      // wave index (traceable + disjoint across waves, enemyWave.ts's contract).
      const enemies = generateEnemyWave(
        deriveWaveSeed(mission.masterSeed, waveIndex, WAVE_ENEMY_SEED_SALT),
        {
          hullPool: def.hullPool,
          enemyCountMin: def.enemyCountMin,
          enemyCountMax: def.enemyCountMax,
          idPrefix: `${mission.factionId}-w${waveIndex}`,
        },
      );

      // BATTLE: the BATTLE-salt derivation (distinct from the enemy seed above).
      // generateLog defaults false: the engine needs only the OUTCOME + carry-state; the
      // watchable log is a 9b.5d concern (it re-resolves / streams for the player). Default
      // objective (lastTeamStanding) = enemies down -> player wins, player down -> loss.
      const { outcome, finalCombatants } = resolveBattle(
        { combatants: [player, ...enemies] },
        deriveWaveSeed(mission.masterSeed, waveIndex, WAVE_BATTLE_SEED_SALT),
      );

      // Read the player's POST-battle state BY ID (finalCombatants is id-SORTED, never
      // input order). Carry hull/shield/drones forward (attrition; hull never regens).
      const p = finalCombatants.find((c) => c.id === playerId);
      if (p) {
        mission.playerHull = p.hull;
        mission.playerShield = p.shield;
        mission.playerDrones = p.drones;
        // Phase 12b Unit B2: capture the post-battle per-system durability so wear CARRIES into
        // the next wave (accumulation). A FRESH object each wave (never a mutation of the input's
        // carry-state object), so purity + closed-form parity hold exactly as they do for hull/
        // shield above. Captured on BOTH win and defeat (this runs before the win/lose branch),
        // symmetric with hull/shield; on a defeat the mission then limps home and this wear is
        // discarded with the ending mission (it does not outlive the patrol in B2).
        mission.playerSystemDurability = capturePlayerSystemDurability(p);
      }

      // A win requires BOTH the objective naming "player" AND the player actually alive
      // (defensive: a cap-tiebreak "player" with a dead player, or a missing p, is a loss).
      const playerSurvived = p !== undefined && p.alive && p.hull > 0;
      if (outcome.winner === "player" && playerSurvived) {
        mission.wavesWon += 1;
        mission.nextWaveIndex = waveIndex + 1;
        // ---- REWARD the won wave (Combat 0.13.0, Phase 10, design S12). ----------------
        // This defeated wave is a WRECK to loot. Roll its reward from its OWN loot seed,
        // derived off the persisted masterSeed + THIS wave's index via the DISTINCT loot
        // salt, so the loot is a pure function of (masterSeed, waveIndex) and byte-identical
        // offline vs live. CRITICAL FOR PARITY: the seed is (masterSeed, waveIndex), NOT tick
        // timing or any fleet-wide/iteration-order state, and each wave resolves EXACTLY ONCE
        // in this loop (whether the patrol advanced as one big call or many small ones), so a
        // won wave contributes its reward exactly once, identically, on either path. The roll
        // uses the combat PRNG (makeRng), never Math.random. A LOST wave never reaches here
        // (the defeat branch below breaks first), so a defeat earns nothing for the lost wave.
        const lootSeed = deriveWaveSeed(mission.masterSeed, waveIndex, WAVE_LOOT_SEED_SALT);
        const loot = rollWaveLoot(lootTable, lootSeed);
        // Accumulate materials as Decimal (the home-inventory representation), grow-on-demand
        // per itemId, exactly the shape tickCaptainMission builds for its homePlanetDelta.
        for (const itemId of Object.keys(loot.materials)) {
          lootMaterials[itemId] = (lootMaterials[itemId] ?? new Decimal(0)).plus(loot.materials[itemId]);
        }
        creditsAwarded += loot.credits;
        fleetAdminXpAwarded += loot.fleetAdminXp;
        captainXpAwarded += loot.captainXp;
        // CONTINUE: the patrol proceeds (later waves and/or transitBack still ahead).
      } else {
        // DEFEAT (Combat 0.13.0, Phase 11, design S13): the patrol does NOT end instantly.
        // The wreck must LIMP HOME first (2x the return leg), so instead of ending we switch
        // to the "limpingHome" phase and seed the countdown. Capture the hull DAMAGE now = the
        // hull points that must be RESTORED to reach full again = the FOLDED hull max (bare frame +
        // installed plating, the same pool the wave combatant fought with) minus the surviving hull.
        // Using the folded max (not the raw authored hullIntegrity) is the BLOCKER fix: a crafted-
        // plated ship fights above authored hull, so an authored-based subtraction went NEGATIVE for
        // it (a negative repairDamage). The surviving hull is floored at 0 because a killing blow can
        // drive the carry-state hull NEGATIVE (overkill), and you cannot repair "more than a full
        // hull", so overkill past 0 must not inflate the repair. On a normal loss the hull is
        // <= 0, so this is the FULL folded hull; a rare cap-tiebreak loss with residual hull
        // yields less. Always in [0, foldedDefense.hullMax]. The ship is flagged damaged only when the
        // limp completes (the limp branch above), NOT here. A defeat is NEVER auto-repeated
        // (design), the limp just ends the mission when it lands. `continue` (not break): the
        // loop keeps advancing so the limp countdown runs; if `remaining` is exhausted first,
        // the mission persists mid-limp and resumes next call (the limp fields are persisted).
        mission.wavesLost += 1;
        mission.phase = "limpingHome";
        mission.limpTicksRemaining = limpHomeTicks;
        mission.limpDamage = foldedDefense.hullMax - Math.max(0, mission.playerHull);
        continue;
      }
    } else {
      // ---- BETWEEN-WAVE RECOVERY (no battle this route tick, design S14). -------------
      // Shields regen toward the FOLDED shield cap at the FOLDED per-tick recharge (both from
      // foldedDefense: the SAME installed-gear pools the wave combatant fights with, NOT the raw
      // authored stats: a crafted emitter recharges above authored cap, so an authored clamp
      // here stripped it away); HULL DOES NOT REGEN (attrition). Drones replenish (carrier only;
      // the array is empty otherwise,
      // so this loop is a no-op for a non-carrier). replenishDrones only touches
      // disrupted/destroyed drones, so an undamaged screen is untouched. Parity-safe under
      // batching BY CONSTRUCTION: this runs once per whole-tick crossing, and we advance
      // one whole tick at a time, so a big call applies the identical per-tick recovery.
      // Shield regen via the SHARED leaf (combat/patrolWave.ts) the display replay also
      // applies, so the between-wave carry-state stays byte-identical across the two paths.
      mission.playerShield = regenPatrolShield(
        foldedDefense.shieldMax,
        mission.playerShield,
        foldedDefense.shieldRecharge,
      );
      for (const squadron of mission.playerDrones) {
        replenishDrones(squadron, squadron.droneReplenishRate);
      }
    }

    // Keep the persisted coarse phase consistent with the route position (derive-and-store).
    mission.phase = patrolPhaseFor(def, progress);

    // ---- COMPLETION: the whole route is flown (all waves passed + player alive). --------
    // Reached only on a non-defeat tick (defeat broke out above). progress lands exactly
    // on routeLength (integer legs), so this fires precisely at route end.
    if (progress >= routeLength) {
      // A full route flown + player alive = one patrol COMPLETED (won). Count it (win-only: a
      // defeat broke out above and never reaches here), keyed into missionsCompleted below.
      routesCompleted += 1;
      if (mission.repeatDispatch && !mission.recalled) {
        // RELAUNCH (Dispatch Repeatedly, not recalled). Spend one round trip's fuel from
        // the shared budget mirroring extraction's auto-repeat rule: tank covers -> spend;
        // short but affordable -> auto-buy the shortfall; truly broke -> do NOT relaunch
        // (end + idle, the anti-infinite-fuel floor). Patrols have no refuel-penalty phase.
        const need = fuelPerCycle;
        let canRelaunch = true;
        if (fuelRemaining >= need) {
          fuelRemaining -= need;
          fuelSpent += need;
        } else {
          const shortfall = need - fuelRemaining;
          const cost = shortfall * creditsPerUnit;
          if (creditsRemaining >= cost) {
            creditsRemaining -= cost;
            creditsSpentOnFuel += cost;
            fuelSpent += fuelRemaining; // tank drains to 0
            fuelRemaining = 0;
          } else {
            canRelaunch = false;
          }
        }
        if (canRelaunch) {
          // Fresh master seed derived PURELY from this captain's OWN current master seed
          // (RELAUNCH_SEED_SALT), forming an independent per-captain chain. NOT drawn from
          // the fleet-wide nextPatrolSeed counter: that would make the seed depend on how
          // many OTHER patrols relaunched first (map order) + on tick batching, which is
          // exactly the multi-patrol offline==live parity defect this derivation fixes.
          // Re-plan the wave schedule for the new seed and reset progress + carry-state to FULL.
          const newSeed = deriveWaveSeed(mission.masterSeed, 0, RELAUNCH_SEED_SALT);
          // Mint the next cycle via the shared factory (THE single source of truth for a
          // new patrol, shared with dispatchCaptainOnPatrol so the two can never drift).
          // Relaunch reuses THIS mission's stance + repeatDispatch (they persist across a
          // relaunch) and the freshly derived per-captain newSeed; the factory re-plans the
          // wave schedule, resets progress + carry-state to FULL, and re-keys the drone id
          // prefix to newSeed.
          mission = freshPatrolMission({
            patrolKey: mission.patrolKey,
            stance: mission.stance,
            masterSeed: newSeed,
            repeatDispatch: mission.repeatDispatch,
            shipDef,
            hullType,
            // Unit 2.3b: the SAME installed gear this tick already resolved, so a relaunched cycle's
            // drone carry-state seeds from the ship's installed pods identically to a fresh dispatch.
            installedGear,
          });
          progress = 0;
          // Loop continues: any remaining ticks advance the FRESH patrol.
        } else {
          stopReason = "fuel"; // wall-stop: could not afford a relaunch (anti-infinite-fuel floor)
          mission = null; // truly broke: end (captain idles until refuelled/re-dispatched)
          break;
        }
      } else {
        // Dispatch Once, OR a recalled patrol that finished its route: end (captain idles).
        // A recalled patrol does NOT relaunch (recall honored at cycle end, like extraction).
        mission = null;
        break;
      }
    }
  }

  // Persist the (possibly fractional) route position onto the surviving mission.
  if (mission !== null) mission.progressTicks = progress;

  // ---- CAPTAIN XP + level-ups (Combat 0.13.0, Phase 10, design S12). --------------------
  // Fold the summed per-won-wave captain XP onto the captain, then resolve level-ups through
  // the SHARED foldXpLevelUps helper (the SAME subtract-and-carry loop tickCaptainMission's
  // extraction path uses; captain XP grants ONE stat point per level, so statPoints climbs by
  // the level-up count). Applied ONCE per call over the summed award, exactly mirroring
  // tickCaptainMission (captainXpAwardedThisCall -> xp.plus -> foldXpLevelUps). Closed-form
  // parity holds for the same reason it does for extraction captain XP: foldXpLevelUps is
  // subtract-and-carry, so folding the full call's award once equals folding each wave's
  // award as it lands (the sum is the sum), and the awards are flat integers (no fractional-
  // rate drift). A call that won no wave has captainXpAwarded == 0: xp/level/statPoints ride
  // through untouched (the guard skips the fold), so a reward-free call leaves the captain
  // byte-identical to before.
  let xp = captain.xp;
  let level = captain.level;
  let statPoints = captain.statPoints;
  if (captainXpAwarded > 0) {
    xp = xp.plus(captainXpAwarded);
    const captainLevelUps = foldXpLevelUps(xp, level, xpForNextLevel);
    xp = captainLevelUps.xp;
    level = captainLevelUps.level;
    statPoints += captainLevelUps.levelUps;
  }

  // Combat 0.13.0 (Phase 10): this call's LIFETIME-STATS contribution, built from the SAME
  // won-wave accumulators as the deltas above so patrol rewards count toward lifetime totals
  // exactly like extraction (economyTick folds this through the shared foldLifetimeStatsDelta).
  // Field mapping MIRRORS tickCaptainMission's lifetimeStatsDelta (see ~line 1311):
  //   - itemsGathered: the looted MATERIALS (shallow clone, same immutable Decimal refs, like
  //     extraction's `{ ...homePlanetDelta }`), so combat loot lands in lifetime itemsGathered.
  //   - creditsEarned: the credit BOUNTY (mirrors extraction's creditsDelta -> creditsEarned).
  //   - captainXpAwarded: the GROSS captain XP granted this call (the pre-level-up sum, exactly
  //     the "gross before subtraction" semantics extraction records), NOT the leftover xp.
  //   - fleetAdminXpAwarded: the FA XP granted this call (mirrors extraction).
  //   - missionsCompleted: keyed by this run's PatrolKey, counting the full routes WON this call
  //     (routesCompleted). The map is Record<string, Decimal> keyed by a mission/patrol id, and
  //     a completed patrol IS a completed mission, so it belongs here (user decision 2026-07-30:
  //     the offline recap + the Missions Completed stat should count combat patrols, grouped by
  //     TYPE via the mission->type mapping in offlineSummary.ts). Sparse: absent when no route
  //     completed this call. (Earlier left empty pending a dedicated combat counter; mixing
  //     patrol + extraction keys here is safe, both are string ids, unlock-gating reads SPECIFIC
  //     keys so it is unaffected, and statistics sums the whole map.)
  // WIN-ONLY holds by construction: every accumulator is 0/empty unless a wave was won (the
  // defeat branch breaks before any accrual), so a lost/defeated patrol contributes nothing.
  const lifetimeStatsDelta: MissionLifetimeStatsDelta = {
    itemsGathered: { ...lootMaterials },
    missionsCompleted: routesCompleted > 0 ? { [patrolKey]: new Decimal(routesCompleted) } : {},
    creditsEarned: new Decimal(creditsAwarded),
    captainXpAwarded: new Decimal(captainXpAwarded),
    fleetAdminXpAwarded: new Decimal(fleetAdminXpAwarded),
  };

  return {
    // The captain with its patrol advanced AND its won-wave XP/level-ups already folded in
    // (mirrors tickCaptainMission returning the captain with XP pre-folded).
    captain: { ...captain, mission, xp, level, statPoints, lastStopReason: stopReason ?? captain.lastStopReason },
    shipDamaged,
    shipDamageTaken,
    fuelSpent,
    creditsSpentOnFuel,
    // The rewards economyTick folds through the SAME deltas as extraction (materials into home
    // inventory, credits into state.credits, FA XP through applyFleetAdminXp). Empty/0 on a
    // no-win call.
    homePlanetDelta: lootMaterials,
    creditsDelta: creditsAwarded,
    fleetAdminXpDelta: fleetAdminXpAwarded,
    lifetimeStatsDelta,
  };
}

// Replaces the old recomputeFleetAdmin (which recomputed fleetAdminXp fresh
// each call as the sum of every captain's level, effectively frozen under
// realistic play, see this plan's design doc for the live-tested root
// cause). This function instead ADDS an already-computed delta (summed
// across every captain's completed mission cycles this call, fleet-wide,
// same "accumulate locally, apply once" shape as homePlanetDelta) and
// resolves level-ups by SUBTRACTING the threshold each time, mirroring
// captain XP's own subtract-and-carry-forward loop exactly, capped at
// MAX_LEVEL_UPS_PER_TICK to guard against a very large offline-catchup
// delta (see that constant's own comment above).
//
// CORRECTNESS NOTE (found during this branch's final holistic review): the
// no-op guard checks for an unresolved BACKLOG, not just "did this call add
// anything." If a PRIOR call's delta was large enough to hit
// MAX_LEVEL_UPS_PER_TICK, that call returns with fleetAdminXp still sitting
// AT OR ABOVE the next threshold (deliberately, so no XP is lost), an
// early-return keyed on `fleetAdminXpDelta <= 0` alone would then freeze that
// backlog forever on every subsequent poll that doesn't ALSO carry a fresh
// positive delta, contradicting this function's own intent (leftover XP
// should keep resolving on later calls, the same way it's designed to).
// Checking `hasBacklog` here means a delta-0 poll still drains an existing
// backlog if one exists, while remaining the same cheap same-reference
// no-op it always was for the overwhelmingly common case (no delta, no
// backlog). This is only reachable at all with a delta on the order of
// 10^14+ (see MAX_LEVEL_UPS_PER_TICK's own comment and this function's tests
// in tick.test.ts), astronomically unlikely in practice, but worth being
// actually correct about rather than leaving a comment that overstates what
// the code did.
export function applyFleetAdminXp(state: GameState, fleetAdminXpDelta: number): GameState {
  const startingXp = fleetAdminXpDelta > 0 ? state.fleetAdminXp.plus(fleetAdminXpDelta) : state.fleetAdminXp;
  const hasBacklog = startingXp.gte(xpForNextFleetAdminLevel(state.fleetAdminLevel));
  if (fleetAdminXpDelta <= 0 && !hasBacklog) return state; // cheap no-op: no new XP this call, and nothing left over from a prior capped call to resolve

  // Fleet Admiral level-ups via the shared fold helper (was an inline
  // subtract-and-carry loop). FA XP awards ONE admin point per level, so
  // adminPoints climbs by the level-up count. Behavior-identical to the old loop.
  const { xp, level, levelUps } = foldXpLevelUps(startingXp, state.fleetAdminLevel, xpForNextFleetAdminLevel);
  const adminPoints = state.adminPoints + levelUps;

  return { ...state, fleetAdminXp: xp, fleetAdminLevel: level, adminPoints };
}

// Crafting Level XP (Equipment 0.11.0, Phase 3, Task 8): the crafting-track twin of
// applyFleetAdminXp. Folds an already-accumulated crafting-XP delta (summed across every
// production job that COMPLETED this call, see resolveProcesses' craftingXpDelta) into
// craftingXp and resolves level-ups by subtracting the per-level threshold each time,
// carrying the remainder forward, the EXACT subtract-and-carry loop FA XP + captain XP
// use. Kept structurally identical to applyFleetAdminXp on purpose (single-source
// discipline): same cheap same-reference no-op, same backlog guard (a prior call capped
// at MAX_LEVEL_UPS_PER_TICK leaves craftingXp at/above the next threshold, so a later
// delta-0 call must still drain it), same MAX_LEVEL_UPS_PER_TICK guard against a huge
// offline-catch-up delta. The ONE difference from applyFleetAdminXp: crafting has NO
// "points" system yet (no adminPoints analog), so a level-up bumps craftingLevel alone.
//
// CLOSED-FORM / OFFLINE==LIVE: because the fold depends only on (craftingXp, craftingLevel)
// and the delta, applying the delta in one big chunk lands the same (level, remainder) as
// applying it in many small chunks across the offline economyTick loop, the same
// associativity applyFleetAdminXp relies on (barring the astronomically-unreachable
// MAX_LEVEL_UPS_PER_TICK cap). The delta itself is proven closed-form in resolveProcesses.
//
// Lives HERE (tick.ts) beside applyFleetAdminXp, NOT in model.ts with craftingXpForNext,
// because it consumes MAX_LEVEL_UPS_PER_TICK (defined in this file); hoisting it to
// model.ts would force model.ts to import from tick.ts, inverting the model<-tick
// dependency direction. model.ts owns the pure curve + tunable rate; the state-folding
// engine stays with its FA twin.
export function applyCraftingXp(state: GameState, craftingXpDelta: number): GameState {
  // craftingXp / craftingLevel are read DIRECTLY here, the interim NOT-YET-MIGRATED guard
  // (Task 3) was RETIRED in Task 20. Both fields are now GUARANTEED on every save:
  // MIGRATIONS[26] (v26->v27) backfills craftingLevel + craftingXp, hydrateDecimals
  // (save.ts) revives craftingXp to a live Decimal on load, and freshState seeds level 1 /
  // Decimal(0). So this reads state.craftingXp / state.craftingLevel with NO defaulting,
  // exactly like applyFleetAdminXp reads state.fleetAdminXp / state.fleetAdminLevel, and a
  // genuinely missing field now throws loudly (a corrupt/hand-edited save) rather than
  // silently defaulting to 0 / level 1 (Omega 6/10).
  const currentXp = state.craftingXp;
  const currentLevel = state.craftingLevel;

  const startingXp = craftingXpDelta > 0 ? currentXp.plus(craftingXpDelta) : currentXp;
  const hasBacklog = startingXp.gte(craftingXpForNext(currentLevel));
  if (craftingXpDelta <= 0 && !hasBacklog) return state; // cheap no-op: no new XP this call, and no leftover backlog from a prior capped call

  // Crafting level-ups via the shared fold helper (was an inline subtract-and-carry
  // loop). Crafting has NO points system yet, so a level-up bumps craftingLevel
  // alone (the level-up count is intentionally unused here). Behavior-identical to
  // the old loop.
  const { xp, level } = foldXpLevelUps(startingXp, currentLevel, craftingXpForNext);

  return { ...state, craftingXp: xp, craftingLevel: level };
}

// Ship Production Economy (Phase 1, Task 4): the SINGLE add-to-inventory seam.
// Every code path that GRANTS an item, mission loot delivery + passiveTrickle
// (tick(), below) and craft output (craftRecipe, further below), routes its
// addition through here, so the "gaining an item reveals it in the discovered
// (❓ -> rarity-color) set" rule lives in exactly ONE place and cannot drift
// between call sites (the same single-source discipline foldLifetimeStatsDelta
// uses for lifetime stats).
//
// Returns NEW inventory + discovered objects (the inputs are never mutated),
// matching the immutable-update style the rest of this file uses: callers thread
// the returned pair forward rather than writing in place. An inventory[itemId]
// that is absent starts from Decimal(0) before the add, preserving the map's
// grow-on-demand contract (a brand-new itemId can be granted without pre-seeding
// it), for today's callers the 3 loot keys / the 2 craft-output keys are all
// pre-seeded (freshState/migration), so the `?? new Decimal(0)` never actually
// fires and the add is value-identical to the old `storage[key].plus(amount)`.
//
// DISCOVERY IS GATED ON A POSITIVE amount: a 0 (or negative) add marks NOTHING
// discovered, you have not "seen" an item you did not actually receive. This
// matters because tick()'s loot delivery folds all three loot tiers every call,
// most of them a 0 delta on any given tick; only the tier that actually
// delivered a positive amount this call should flip to discovered. Deducts
// (craftRecipe inputs) do NOT come through here at all, they are a plain
// .minus() on the inventory clone, never a discovery event.
// Exported (Phase 1, Task 5) so App.svelte's live-poll loot-delivery path can
// route through this SAME add seam tick()'s offline catch-up uses, one shared
// helper is what makes the live and offline inventory writes byte-identical
// (drift-proof). Task 4 declared this helper for tick()'s own use but left it
// module-private; Task 5 consuming it from App.svelte is the reason it is now
// exported.
//
// WAREHOUSE CAP CLAMP (fix/warehouse-cap-clamp, 2026-07-16): every producer deposit
// is now CLAMPED at the item's warehouse cap. Callers pass `cap` (from itemCap, the
// per-item cap helper below); the stored quantity becomes
// `Decimal.min(have + amount, cap)`, so a deposit can raise a material UP TO the cap
// but NEVER past it, excess is silently discarded (standard idle-game "storage
// full = overflow lost"). This is the ROOT-CAUSE fix for the overshoot bug: the
// `materialAtCap` auto-stop only prevents a producer from STARTING when already at
// cap, so a cycle completing while just-under-cap used to dump its whole haul PAST
// the cap (Deuterium Ice seen at 1.3M against a 1M cap). Clamping HERE, at the single
// shared add seam, fixes it for the loot fold, resolveProcesses outputs, AND the
// passiveTrickle talent in one place, no call site can forget it.
//
// The clamp is a STRICT bound, so BELOW-cap deposits are BYTE-IDENTICAL to the old
// plain `.plus()`: min(have + amount, cap) == have + amount whenever have + amount <=
// cap. For an UNCAPPED item, callers pass WAREHOUSE_UNCAPPED_SENTINEL (1e1000); no
// reachable in-game quantity approaches it, so `min` is a no-op and uncapped items
// accumulate freely, exactly the fail-open stance itemCap/tierCap/materialAtCap
// already take for un-warehoused tiers.
//
// DISCOVERY IS GATED ON THE REQUESTED amount (amount.gt(0)), NOT the clamped delta:
// receiving a positive amount reveals the item even if the clamp discarded all of it.
// That is correct and simplest, an item can only be AT its cap because you already
// received it (so it was already discovered), meaning the two readings coincide in
// practice; gating on the requested amount keeps the reveal rule unchanged from
// before the clamp (drift-proof).
export function addToInventory(
  inventory: Record<string, Decimal[]>,
  discovered: string[],
  itemId: string,
  amount: Decimal,
  cap: Decimal,
  quality: number = 0
): { inventory: Record<string, Decimal[]>; discovered: string[] } {
  // Quality-bucketed inventory (Task 9a): the cap is a TOTAL clamp (the whole item's
  // on-hand, summed across buckets, may not exceed `cap`). Compute the clamped total
  // exactly as the old scalar code did (raw = priorTotal + amount, then min against
  // cap; break_infinity.js's Decimal.min is BINARY), then deposit the DELTA into the
  // rolled QUALITY bucket via addItemQuality. The delta equals the old scalar write's net
  // change: for a normal under-cap add it is just `amount`; when a prior over-cap
  // overshoot is being re-clamped it is NEGATIVE (cap - priorTotal), which pulls the
  // total back down to `cap`, byte-identical to the old `Decimal.min(raw, cap)` that
  // also clamped an over-cap balance down.
  //
  // QUALITY ROUTING (Task 9b): `quality` is the tier the CALLER already rolled for THIS
  // deposit (rollQuality, model.ts); it defaults to 0 so every non-production caller (the
  // warehouse-cap tests, any future non-rolled add) is byte-identical to before. The
  // rolled tier is only honored for a POSITIVE delta (real produced material).
  //
  // OVER-CAP RE-CLAMP DRAIN (fix: bucket-0 negative quality, 2026-08-27): a NEGATIVE delta
  // is the defensive over-cap re-clamp (priorTotal already exceeds cap, reachable because
  // salvage deposits go through addItemQuality directly and bypass this clamp). It must pull
  // the total back DOWN to cap. The old code wrote the whole negative delta onto bucket 0,
  // which drove bucket 0 NEGATIVE whenever the overflow lived in higher tiers (bucket 0 held
  // less than the drain), leaving a permanently negative per-quality readout that never
  // healed. We now drain the overflow LOWEST-quality-first via removeItemLowestFirst (the
  // same tested consume helper clampInventoryToCaps uses), so the stack lands at exactly cap
  // with NO bucket going negative, and the player keeps their best stock. The delta >= 0
  // path is UNCHANGED and byte-identical: a positive delta lands on the rolled tier, a zero
  // delta is a no-op on bucket 0 (never growing the array for a full-warehouse discard).
  const priorTotal = itemTotal(inventory, itemId);
  const clampedTotal = Decimal.min(priorTotal.plus(amount), cap);
  const delta = clampedTotal.minus(priorTotal);
  let nextInventory: Record<string, Decimal[]>;
  if (delta.lt(0)) {
    // Over-cap re-clamp: drain the overflow (priorTotal - cap) lowest-quality-first so no
    // bucket is left negative, instead of dumping the negative onto bucket 0.
    nextInventory = removeItemLowestFirst(inventory, itemId, delta.neg());
  } else {
    // delta >= 0: real produced material lands on the rolled tier; a zero delta is a
    // bucket-0 no-op (byte-identical to the pre-fix path, no array growth).
    const depositTier = delta.gt(0) ? quality : 0;
    nextInventory = addItemQuality(inventory, itemId, delta, depositTier);
  }
  // DISCOVERY IS GATED ON THE REQUESTED amount (unchanged): receiving a positive
  // amount reveals the item even if the clamp discarded all of it.
  const nextDiscovered =
    amount.gt(0) && !discovered.includes(itemId) ? [...discovered, itemId] : discovered;
  return { inventory: nextInventory, discovered: nextDiscovered };
}

// Phase 2 (Task A2, docs/plans/phase2-tick-map.md): the per-span economy body,
// extracted VERBATIM from tick() below so live play (App.svelte's poll loop) and
// offline catch-up (tick()) can share ONE implementation of the divergence
// surface, the 8-field `bonuses` build + ship-stat resolution, the
// passiveTrickle loop, the loot -> addToInventory fold, the load-bearing ordering
// (mission/lifetime fold BEFORE resolveProcesses), and the credits / FA-XP /
// gameTimeSeconds accumulation. Historically those were hand-mirrored in both
// paths and drifted (ship stats, bonus-roll, credits, all logged); centralizing
// them here is the whole point. This is a MECHANICAL lift, not a math rewrite:
// nothing in the moved arithmetic changed.
//
// Pure/deterministic given (state, ticksElapsed, rng): advancing by ticksElapsed
// in ONE call equals advancing by chunks summing to ticksElapsed, because every
// subsystem this calls (tickCaptainMission / resolveProcesses / applyFleetAdminXp)
// is already closed-form (see tickCaptainMission's header). That closed-form
// property is what lets the caller drive a span as a chunk loop: tick() steps
// economyTick(state, 1, rng) once per WHOLE tick, plus one fractional-remainder
// call, NOT once over the whole span (see tick() below). The earlier note here
// claiming a single whole-span call was stale after that chunk-loop landed.
//
// Idle captains (mission === null) have no passive economy anymore, missions
// are the only way a captain does anything. Only mission captains need advancing;
// this is the sole reason to even call .map() below rather than filtering.
// gameTimeSeconds and the keyed inventory are fleet-wide bookkeeping, each updated
// exactly once per call (not once per captain).
export function economyTick(state: GameState, ticksElapsed: number, rng: () => number = Math.random): GameState {
  // gameTimeSeconds is tracked in SECONDS, but economyTick is handed ticksElapsed
  // (not deltaSeconds), so recover the elapsed seconds via the fleet's shared
  // tickDurationSeconds, the EXACT inverse of tick()'s
  // `deltaSeconds / tickDurationSeconds` conversion. So the value used here is
  // `(deltaSeconds / tickDurationSeconds) * tickDurationSeconds`, which round-trips
  // to the original deltaSeconds bit-exactly when tickDurationSeconds is 1 (the
  // fresh default, model.ts) or any power of two, and is within 1 ULP for any
  // other value. gameTimeSeconds is display-only fleet bookkeeping that NOTHING
  // downstream in this function reads, deltaSeconds is used ONLY at the
  // gameTimeSeconds increment below, so this is behavior-equivalent to the old
  // inline `state.gameTimeSeconds + deltaSeconds`.
  const deltaSeconds = ticksElapsed * state.tickDurationSeconds;

  // Mission Rework (Task 1): Record<string,Decimal> (not narrow LootMaterialKey) --
  // each captain's per-mission loot delta may carry item keys beyond the 3 ore tiers.
  // Seeded with the 3 ore-tier keys (emptyLootTotals) so passiveTrickle's commonOre
  // target is always present and ore-run folding is byte-identical; other keys grow
  // on demand below.
  const homePlanetDelta: Record<string, Decimal> = emptyLootTotals();
  // Accumulates fleet-wide Fleet Admiral XP across every captain's completed
  // mission cycles this call, same accumulate-locally-apply-once shape as
  // homePlanetDelta immediately above. Consumed once, at the end of this
  // function, by applyFleetAdminXp.
  let fleetAdminXpDelta = 0;
  // Accumulates fleet-wide credits across every captain's completed mission
  // cycles this call, same accumulate-locally-apply-once shape as
  // fleetAdminXpDelta immediately above. Consumed once, at the end of this
  // function, via a flat state.credits.plus(), credits has no leveling
  // curve to resolve, unlike fleetAdminXpDelta's applyFleetAdminXp call.
  let creditsDelta = 0;
  // Task 7 (Progression Pacing Rework): fleet-wide lifetimeStats accumulator,
  // SEEDED from the incoming state and folded ONE captain at a time below via the
  // shared foldLifetimeStatsDelta helper, the exact same per-captain fold
  // App.svelte's live poll loop runs, so the two paths cannot diverge for lifetime
  // stats (that helper is the single source of truth). Replaces Task 6's five
  // parallel per-field accumulators + the separate final fold in the return
  // object: the helper now owns both the per-key map merge and the scalar sums, in
  // one place. Value-identical to the old two-stage approach (the fold is additive
  // and associative, so folding per captain lands the same totals as accumulating
  // then folding once). `let` because each fold returns a fresh object;
  // itemsRefined/itemsCrafted (never fed by the mission economy) ride through
  // untouched via the helper's spread, exactly as the old final fold's spread did.
  // If NO captain is on a mission this call, this stays === state.lifetimeStats.
  let lifetimeStats = state.lifetimeStats;
  // Computed ONCE for the whole fleet (same value for every captain), not
  // per captain inside the .map() below, Homeworld Talents are fleet-wide,
  // not per-captain.
  const fleetRareYield = fleetRareYieldMult(state);
  // Mission Rework (Task 5): the SHARED fuel tank, threaded through the per-captain map
  // below. fuelBudgetRemaining starts at the whole tank (state.fuel as a number, fuel
  // is human-scale, see fuel.ts) and is DRAWN DOWN as each captain's auto-repeats spend
  // from it, so two captains completing a cycle in the SAME call cannot double-spend the
  // one tank (map callbacks run sequentially, so the decrement is visible to the next
  // captain). totalFuelSpent is the sum subtracted from the Decimal tank once, below.
  // With no mission captains (or a fuel-rich tank) both stay at their seed / 0, so a
  // call lands byte-identical to before this task.
  let fuelBudgetRemaining = state.fuel.toNumber();
  let totalFuelSpent = 0;
  // Fuel Economy v2 (F3): the SHARED credit balance available for AUTO-BUYING fuel shortfalls,
  // threaded through the per-captain map exactly like fuelBudgetRemaining above so two captains
  // auto-buying in the SAME call can't double-spend the one balance (map callbacks run
  // sequentially, so each draw is visible to the next captain). totalCreditsSpentOnFuel is the
  // sum subtracted from the Decimal credits balance once, below. state.credits.toNumber() loses
  // precision only for astronomically large balances, where "can I afford a few units of fuel"
  // is trivially yes, so the affordability DECISION is unaffected; the exact credit FIELD stays
  // Decimal-exact because totalCreditsSpentOnFuel is the true sum of (small) purchase costs.
  let creditsBudgetRemaining = state.credits.toNumber();
  let totalCreditsSpentOnFuel = 0;
  // Combat 0.13.0 (Phase 9b.5c / Phase 11): patrol wiring. damagedShips maps the id of each
  // ship whose defeated patrol finished LIMPING HOME this call -> the hull points it must
  // repair (repairDamage), folded into state.ships once, below (Phase 11 carries the damage
  // amount so the repair duration can scale; 9b.5c carried only the id + a bare flag). NOTE:
  // a patrol RELAUNCH does NOT touch the fleet-wide nextPatrolSeed counter, it derives its
  // fresh master seed purely from the captain's own current seed (tickCaptainPatrol /
  // RELAUNCH_SEED_SALT), so there is no seed counter to thread here. Threading it would
  // reintroduce the multi-patrol parity defect (map-iteration-order-dependent seeds).
  const damagedShips = new Map<string, number>();
  const captains = state.captains.map((captain) => {
    if (captain.mission === null) return captain;
    // Combat 0.13.0 (Phase 9b.5a): ROUTE by mission KIND. CaptainState.mission is now a
    // discriminated union, so the per-captain economy step branches on the tag. An
    // EXHAUSTIVE switch with an assertNever default makes a future MissionKind a COMPILE
    // ERROR here (the codebase's discriminated-union hygiene) rather than a silent skip.
    //   - extraction: fall through to the UNCHANGED extraction path below (byte-identical).
    //   - patrol:     a NO-OP stub this unit, the captain stays on the patrol WITHOUT it
    //                 advancing. 9b.5b fills the patrol tick loop here (running battles,
    //                 advancing progressTicks/waves, honoring recall/repeat). No player path
    //                 dispatches a patrol yet, so a non-advancing patrol is expected + safe;
    //                 the point of this branch is that a dispatched patrol cannot CRASH the
    //                 economy tick and the OTHER captains in the same map tick normally.
    switch (captain.mission.kind) {
      case "extraction":
        break; // fall through to the extraction handling below (unchanged)
      case "patrol": {
        // Combat 0.13.0 (Phase 9b.5c): advance the patrol along its route, fighting a
        // battle at each scheduled wave and carrying hull/shield/drones between waves.
        // Mirrors the extraction arm's shared-budget threading: draw relaunch fuel/credits
        // from the SAME running tank/credit budgets (no double-spend across captains),
        // report the spends back for the single Decimal deduction below, and flag the ship
        // on a defeat. The relaunch master seed is derived per-captain inside
        // tickCaptainPatrol (batch-invariant), so no seed counter is threaded here. NO
        // rewards/XP here (Phase 10).
        const patrolShip = state.ships.find((s) => s.assignedCaptainId === captain.id);
        // Price one round trip's fuel from the SAME equipment-folded engineEfficiency the
        // dispatch gate + the extraction path use, so a RELAUNCH burns the dispatch estimate
        // (a no-gear fold is an identity). Only relaunches spend; the first cycle was pre-paid
        // at dispatch, exactly like extraction's first cycle.
        const patrolDef = PATROLS[captain.mission.patrolKey];
        // Combat 1.0 (Unit 1.4): the ship's INSTALLED combat gear, resolved ONCE off the SAME
        // equippedFor source the derived-stats fold uses, then handed to tickCaptainPatrol so the
        // player combatant reads real weapons + shield + hull + defenses. undefined when there is no
        // ship (defensive; a patrol always has one), which tickCaptainPatrol treats as the absent path.
        const patrolGear = patrolShip ? equippedFor(state, patrolShip.id) : undefined;
        const patrolStats = patrolShip && patrolGear ? shipDerivedStats(patrolShip, patrolGear) : null;
        const patrolFuelPerCycle =
          patrolShip && patrolStats
            ? fuelForRoundTrip(patrolDef.transitOutTicks, patrolDef.transitBackTicks, {
                ...SHIP_TYPES[patrolShip.typeKey],
                engineEfficiency: patrolStats.engineEfficiency,
              })
            : 0;
        const patrolResult = tickCaptainPatrol(
          ticksElapsed,
          captain,
          patrolShip,
          fuelBudgetRemaining,
          patrolFuelPerCycle,
          creditsBudgetRemaining,
          FUEL_CREDITS_PER_UNIT, // explicit so the installedGear arg below lands in the right slot
          patrolGear
        );
        // Draw down the shared budgets so a later captain sees the reduced values (no
        // double-spend), and sum for the single Decimal tank/credits deductions below.
        fuelBudgetRemaining -= patrolResult.fuelSpent;
        totalFuelSpent += patrolResult.fuelSpent;
        creditsBudgetRemaining -= patrolResult.creditsSpentOnFuel;
        totalCreditsSpentOnFuel += patrolResult.creditsSpentOnFuel;
        // Flag the ship when its defeated patrol finished limping home this call (folded into
        // state.ships once, below), recording the hull damage so the repair scales with it.
        if (patrolResult.shipDamaged && patrolShip) damagedShips.set(patrolShip.id, patrolResult.shipDamageTaken);
        // Combat 0.13.0 (Phase 10, design S12): fold this patrol's REWARDS into the SAME
        // fleet-wide accumulators the extraction arm folds tickCaptainMission's deltas into
        // (see that fold ~80 lines below), so patrol loot lands in home inventory, patrol
        // bounty in credits, and patrol FA XP on the FA track through the identical seams,
        // byte-for-byte the same code path. Captain XP is already applied onto
        // patrolResult.captain (folded inside tickCaptainPatrol via the shared foldXpLevelUps,
        // mirroring how the extraction arm receives a captain with XP pre-folded), so it needs
        // no delta here. NOTE (mirrors extraction): a patrol's bounty goes to creditsDelta
        // ONLY, NOT back into creditsBudgetRemaining, so this call's earnings are not available
        // to a LATER captain's fuel auto-buy this same call, exactly like extraction earnings.
        for (const key of Object.keys(patrolResult.homePlanetDelta)) {
          homePlanetDelta[key] = (homePlanetDelta[key] ?? new Decimal(0)).plus(patrolResult.homePlanetDelta[key]);
        }
        creditsDelta += patrolResult.creditsDelta;
        fleetAdminXpDelta += patrolResult.fleetAdminXpDelta;
        // Combat 0.13.0 (Phase 10): fold patrol rewards into lifetimeStats through the SAME
        // shared foldLifetimeStatsDelta seam the extraction arm uses (~110 lines below), so
        // combat loot/bounty/XP count toward lifetime totals exactly like extraction loot.
        lifetimeStats = foldLifetimeStatsDelta(lifetimeStats, patrolResult.lifetimeStatsDelta);
        return patrolResult.captain;
      }
      default:
        return assertNeverMission(captain.mission);
    }
    // Past the switch, TS has narrowed captain.mission to the EXTRACTION arm (the patrol +
    // default cases both return), so the extraction-only reads below type-check directly.
    // Capture the mission key ONCE, while `captain.mission` is still narrowed by the switch
    // above. The recall branch below reassigns `captain` (to flag `recalled`), which
    // re-widens `captain.mission` to the full union for TS, so downstream reads go through
    // this const instead. missionKey is invariant across a recall (recall only flags intent;
    // it never changes which mission runs), so this is exactly equivalent.
    const missionKey = captain.mission.missionKey;
    // Phase 2 (Task B3, design §3.4): AUTO-STOP, when this mission's PRIMARY material is
    // already at its warehouse tier cap the run CANNOT usefully complete (its haul would
    // land over an already-full warehouse). Rather than leave the captain FROZEN in place
    //, which stranded a ship mid-mission, forever if the cap persisted (e.g. a full fuel
    // tank keeping mined Deuterium Ice pinned at cap), we route it to IDLE AT BASE
    // (mission -> null), REUSING the existing recall mechanic (recallCaptain / the
    // `if (mission.recalled) mission = null` cycle-completion branch above). Split by phase:
    //
    //   AT BASE , phase `ordersReceived`, the pre-departure paperwork phase, the ONLY
    //     phase where the ship hasn't left home. Do NOT dispatch a capped run at all: end
    //     the mission immediately so the captain idles at base, available for re-dispatch.
    //
    //   MID-CYCLE / OUT, phase transitOut | extracting | transitBack | unloading, the ship
    //     is already away. Freezing it would strand it, so instead FLAG the mission
    //     `recalled` (exactly what recallCaptain does) and fall through to the normal
    //     tickCaptainMission advance below, which carries it HOME, unloads, and ends the
    //     mission (mission -> null) when this cycle's unloading phase completes. An already-
    //     recalled mission just gets a no-op re-flag; either way it progresses home, never
    //     sits unchanged.
    //
    // BELOW-cap behavior is byte-identical to before: materialAtCap is false (the universal
    // case until 1M+ is stockpiled), this whole branch is skipped, and the captain proceeds
    // through the identical downstream code, no behavior change, no recall.
    //
    // Placed here, inside economyTick, so it applies UNIFORMLY to live play (App.svelte calls
    // economyTick per bar) AND offline catch-up (tick()'s per-tick step loop), one seam,
    // both paths. The check reads state.inventory as it stood at the START of this call; both
    // paths step ONE tick per economyTick call (tick()'s loop below + the live poll), so the
    // cap is re-evaluated every tick and the recall resolves IDENTICALLY live and offline
    // (proven by the offline-parity test in mission-recall-on-cap.test.ts). The `recalled`
    // flag is idempotent + persisted, so flagging it once (a big-span call) or re-flagging it
    // every tick (the stepped path) reaches the same terminal idle state either way.
    if (materialAtCap(state, MISSIONS[missionKey].primaryMaterial)) {
      if (captain.mission.phase === "ordersReceived") {
        // At base, pre-departure: idle immediately rather than launching a run it can't finish.
        // Combat 0.13.0 (offline recap): stamp the CARGO stop reason here, this is the
        // deterministic ROOT of the cargo wall-stop (the materialAtCap seam), the ONLY place
        // that knows the stop is cap-caused rather than a user recall. Same check live and
        // offline (both step economyTick(_,1)), display-only string, so parity is unperturbed.
        return { ...captain, mission: null, lastStopReason: "cargo" as const };
      }
      // Mid-cycle / ship out: flag recalled and let the normal advance below fly it home + end.
      // (No early return, execution continues to the standard per-captain path.)
      // Combat 0.13.0 (offline recap): stamp CARGO on the captain ONLY when the cap is what
      // NEWLY triggers this recall (guard on !recalled), so a pre-existing USER recall flying
      // home is NOT relabeled "cargo" (a user recall must show no reason). The stamp rides the
      // `...captain` spread home through tickCaptainMission and persists to the idle end state;
      // subsequent fly-home ticks re-enter here already-recalled, skip the guard, and leave the
      // stamp intact. Deterministic (same tick live and offline), display-only, parity-safe.
      captain = captain.mission.recalled
        ? { ...captain, mission: { ...captain.mission, recalled: true } }
        : { ...captain, mission: { ...captain.mission, recalled: true }, lastStopReason: "cargo" as const };
    }
    // Resolve the hull this captain flies and project it to the three mission
    // stats tickCaptainMission consumes (transit/cargo/yield). GameState.ships[]
    // .assignedCaptainId is the SINGLE SOURCE OF TRUTH for who flies what, so
    // we find THIS captain's ship by it. The invariant (every captain always
    // has exactly one assigned hull) holds post-migration (Task 4), at new-game
    // (Task 3), and at new-captain-unlock (Task 10), so .find() will locate a
    // hull in practice. The `ship ? ... : null` guard is belt-and-suspenders: a
    // hypothetical ship-less captain falls back to null == "no ship modifier",
    // which reproduces this loop's exact pre-ship-wiring behavior (the Freighter
    // baseline) rather than throwing on shipDerivedStats(undefined).
    const ship = state.ships.find((s) => s.assignedCaptainId === captain.id);
    // Equipment 0.11.0 (Task 13/14): fold the ship's FITTED equipment into its derived
    // stats HERE, at the single seam BOTH paths share (see the block comment at line
    // ~1434: live play calls economyTick per bar, offline catch-up steps economyTick in
    // tick()'s loop, one seam, both paths). equippedFor reads GameState.equipment (the
    // fitment authority); shipDerivedStats(ship, pieces) applies the fold ONCE, before
    // the closed-form machinery, so it is a per-cycle constant (fitment is locked mid-
    // mission by the equipment.ts on-mission lock) and the one-big == many-small
    // guarantee is preserved for the same reason effectiveMissionDef's constancy is. A
    // ship-less captain keeps the pre-equipment null == "no modifier" fallback exactly.
    // equippedFor reads the now-guaranteed equipment pool directly (Task 20 retired the
    // interim fittedPieces guard); a ship-less captain keeps the "no modifier" fallback.
    const pieces = ship ? equippedFor(state, ship.id) : [];
    const shipStats = ship ? shipDerivedStats(ship, pieces) : null;
    // Mission Rework (Task 5): the fuel one round-trip cycle of THIS mission costs on
    // THIS hull. fuelNeeded reads the BASE mission's transit legs (see fuel.ts) and the
    // hull's engineEfficiency. Task 14: price it from the EQUIPMENT-FOLDED
    // engineEfficiency (shipStats.engineEfficiency), so fitting an efficiency drive
    // actually lowers per-cycle burn, consumed identically in both paths (this seam).
    // fuelNeeded only reads engineEfficiency off its ship arg, so we overlay the folded
    // value onto the static ShipTypeDef rather than widening fuelNeeded's contract. A
    // ship-less captain costs 0 -> never fuel-gated, matching the "no modifier" path.
    const fuelPerCycle =
      ship && shipStats
        ? fuelNeeded(MISSIONS[missionKey], {
            ...SHIP_TYPES[ship.typeKey],
            engineEfficiency: shipStats.engineEfficiency,
          })
        : 0;
    const bonuses = {
      commonYieldMult: captainCommonYieldMult(captain),
      uncommonYieldMult: captainUncommonYieldMult(captain),
      uncommonChanceMult: captainUncommonChanceMult(captain),
      rareYieldMult: fleetRareYield,
      rareChanceMult: captainRareChanceMult(captain),
      bonusRollChance: captainBonusRollChance(captain),
      bonusRollChanceMult: captainBonusRollChanceMult(captain),
      specBonusRollChance: captainSpecBonusRollChance(captain),
    };
    // rng passed explicitly (rather than omitted) since bonuses is positional
    // arg 4, omitting arg 3 here would pass bonuses AS rng. rng is economyTick's
    // own param, defaulting to Math.random, so tick()'s offline catch-up (which
    // calls economyTick without an rng) is byte-identical to the pre-extraction
    // inline Math.random; the live loop / tests can inject a deterministic rng.
    const {
      captain: updated,
      homePlanetDelta: delta,
      fleetAdminXpDelta: captainFleetAdminXpDelta,
      creditsDelta: captainCreditsDelta,
      lifetimeStatsDelta: captainLifetimeStatsDelta,
      fuelSpent: captainFuelSpent,
      creditsSpentOnFuel: captainCreditsSpentOnFuel,
    } = tickCaptainMission(
      ticksElapsed,
      captain,
      rng,
      bonuses,
      shipStats,
      fuelBudgetRemaining,
      fuelPerCycle,
      creditsBudgetRemaining
    );
    // Mission Rework (Task 5): draw this captain's auto-repeat fuel from the shared tank
    // budget so a later captain in this SAME map sees the reduced budget (no
    // double-spend), and sum it for the single Decimal tank deduction below.
    fuelBudgetRemaining -= captainFuelSpent;
    totalFuelSpent += captainFuelSpent;
    // Fuel Economy v2 (F3): same draw-down for the shared credit balance used to auto-buy fuel
    // shortfalls, so a later captain sees the reduced balance; summed for the single Decimal
    // credits deduction below.
    creditsBudgetRemaining -= captainCreditsSpentOnFuel;
    totalCreditsSpentOnFuel += captainCreditsSpentOnFuel;
    // Mission Rework (Task 1): the captain's delta is now keyed by its mission's own
    // item keys, so fold over the ACTUAL keys present and grow-on-demand (`?? 0`)
    // rather than assuming the fixed 3 ore tiers. For an ore-only fleet the keys are
    // exactly the 3 seeds -> byte-identical to the pre-rework forEach.
    for (const key of Object.keys(delta)) {
      homePlanetDelta[key] = (homePlanetDelta[key] ?? new Decimal(0)).plus(delta[key]);
    }
    fleetAdminXpDelta += captainFleetAdminXpDelta;
    creditsDelta += captainCreditsDelta;
    // Task 7: fold THIS captain's lifetime-stat delta into the fleet-wide
    // accumulator via the shared foldLifetimeStatsDelta helper, the SAME helper
    // App.svelte's live poll loop calls per captain, so the two paths stay
    // identical by construction. Same per-captain side-effect shape as the
    // fleetAdminXpDelta/creditsDelta accumulation two lines above.
    lifetimeStats = foldLifetimeStatsDelta(lifetimeStats, captainLifetimeStatsDelta);
    return updated;
  });

  // passiveTrickle (Homeworld Talent economyTrickle): flat fleet-wide
  // material generation, independent of missions, applies even with zero
  // captains dispatched. Scales by ticksElapsed (not deltaSeconds) to stay on
  // the same fleet-wide cadence as everything else, and multiplying by
  // ticksElapsed (rather than looping per tick) keeps this closed-form, same
  // requirement tickCaptainMission's own header comment explains.
  //
  // AUTO-STOP CONSISTENCY (Phase 2, Task B3 review, design §3.4): a trickle is
  // a PRODUCER of its material, so it must stop the moment that material is at
  // its warehouse cap, exactly like the mission auto-stop gate above idles a
  // captain whose primary material is full. Without this gate the trickle would
  // keep adding commonOre even while every commonOre-producing mission is
  // auto-stopped, contradicting "a full material's producers all stop." The cap
  // is read off `state` (START-of-tick inventory), the SAME snapshot the mission
  // gate above reads, so both producers make the stop decision on identical data.
  // This is additive/no-loss: a capped material simply receives no trickle THIS
  // tick (nothing is discarded), and tick()'s per-tick step loop re-evaluates the
  // cap every tick so the trickle resumes the instant the material drops below
  // cap. BELOW-cap behavior is byte-identical to before (the gate is false), so
  // the closed-form scaling for the universal below-cap case is unchanged.
  for (const key of state.unlockedHomeworldTalents) {
    const effect = HOMEWORLD_TALENTS[key].effect;
    if (
      effect.type === "passiveTrickle" &&
      (LOOT_MATERIAL_KEYS as string[]).includes(effect.material) &&
      !materialAtCap(state, effect.material)
    ) {
      homePlanetDelta[effect.material as LootMaterialKey] = homePlanetDelta[effect.material as LootMaterialKey].plus(
        effect.perTick * ticksElapsed
      );
    }
  }

  // Ship Production Economy (Phase 1, Task 4): fold the accumulated loot delta
  // (mission deliveries + passiveTrickle, BOTH already merged into homePlanetDelta
  // above) into a NEW inventory + discovered pair, this REPLACES the old
  // homePlanet.storage write (this task stops production code writing storage;
  // a later task removes the field entirely). Every loot tier is routed through
  // addToInventory, the single add seam, so any tier that actually delivered a
  // positive amount this call is marked discovered, while a 0-delta tier neither
  // over-reveals nor changes the counts. Threaded through the 3 loot keys in turn
  // (each call returns fresh objects); seeded from the incoming
  // state.inventory/state.discovered, so a call that delivers nothing lands a
  // value-identical inventory and returns the SAME discovered reference.
  //
  // VALUES ARE IDENTICAL to the prior storage write: inventory[key] is seeded for
  // all 3 loot keys (freshState/migration), so (inventory[key] ?? 0).plus(delta)
  // equals the old storage[key].plus(delta) exactly. The old spread-then-overwrite
  // guard that preserved untouched fields (refinedMaterial/components/any future
  // key) now lives INSIDE addToInventory, it spreads the whole inventory on each
  // add, so those keys ride through unchanged, same "don't silently drop a field"
  // protection as before.
  let inventory = state.inventory;
  let discovered = state.discovered;
  // Mission Rework (Task 1): fold over the ACTUAL delivered keys (the 3 seeded ore
  // tiers PLUS any per-mission item keys the salvage/forage/lunar deliveries added),
  // not the fixed LOOT_MATERIAL_KEYS. addToInventory grows inventory on demand and
  // gates discovery on a positive amount, so the seeded 0-delta ore tiers reveal
  // nothing and an ore-only fleet folds byte-identically to the old fixed loop.
  for (const key of Object.keys(homePlanetDelta)) {
    // Quality roll at production (Task 9b): this fold is the single deposit seam for BOTH
    // mission deliveries and passiveTrickle, so both roll a quality tier here and the whole
    // per-key delta lands in that tier's bucket. The roll is GATED on a positive delta: the
    // seeded ore tiers that delivered nothing this tick (a 0 delta) neither deposit nor
    // consume an rng draw, so the stream stays meaningful and an ore-only fleet that
    // delivered nothing rolls nothing. Because tick() (offline) and App.svelte (live) BOTH
    // drive economyTick one whole tick at a time, this per-tick roll fires at the identical
    // points off the identical stepped rng stream on both paths, so the per-bucket
    // distribution of a big offline catch-up matches many small live steps exactly (the
    // ⚠️ parity test in quality-roll.test.ts). A coarse first pass: a whole cycle's cargo
    // shares ONE tier (rolled at delivery), NOT per-unit; per-unit grading is a later retune.
    const amount = homePlanetDelta[key];
    // ⚠️ PARITY-CRITICAL, do NOT "optimize" this draw away: the roll is gated on the
    // PRE-clamp `amount`, whereas the deposit inside addToInventory re-gates on the
    // POST-clamp `delta`. So a delivery landing entirely on an ALREADY-CAPPED item still
    // CONSUMES a quality roll here yet deposits nothing. That "wasted" draw is intentional
    // and required: both offline tick() and live App.svelte step economyTick(_,1) per whole
    // tick, so the draw is consumed at the identical point on both paths, keeping the seeded
    // stream aligned. Re-gating this draw on the post-clamp delta would skip it only on the
    // capped path and silently desync offline loot rng from live.
    const quality = amount.gt(0) ? rollQuality(rng) : 0;
    // Warehouse cap clamp: the deposit is bounded at this item's cap (itemCap), so a
    // cycle completing while just-under-cap lands AT the cap instead of overshooting.
    // Below cap this is byte-identical to the old unclamped add (min is a no-op).
    const added = addToInventory(inventory, discovered, key, amount, itemCap(state, key), quality);
    inventory = added.inventory;
    discovered = added.discovered;
  }

  // Phase 1, Task 9: the post-mission fleet state, missions, passiveTrickle, and
  // the loot fold above all applied, but Fleet Admiral XP NOT yet resolved through
  // its level-up pass. Captured as a named intermediate (this was previously the
  // inline object literal passed straight to applyFleetAdminXp) SO the timed-process
  // resolver below can run against it before that final FA-XP pass. Nothing in the
  // mission/credits/loot/lifetime math above changed, these are the exact same
  // fields with the exact same values, just held in a const instead of an inline
  // literal, so a call with no active processes lands byte-identical to before.
  const postMissionState: GameState = {
    ...state,
    captains,
    // Combat 0.13.0 (Phase 9b.5c): nextPatrolSeed rides through unchanged via `...state`, a
    // RELAUNCH derives its master seed per-captain (not from this counter), so economyTick
    // never advances it (only the discrete player-dispatch action does).
    // Combat 0.13.0 (Phase 9b.5c / Phase 11): flag any ship whose defeated patrol finished
    // limping home this call, raising `damaged` (blocks re-dispatch) AND stamping
    // `repairDamage` (the repair-duration input) together (immutable map, the file's
    // state-update idiom). Same reference when none limped home (the common case), so a call
    // with no completed limp is byte-identical for ships. The auto-start repair pass
    // (processShipRepairs, below) then picks these up into the repair bay.
    ships:
      damagedShips.size > 0
        ? state.ships.map((s) =>
            damagedShips.has(s.id) ? { ...s, damaged: true, repairDamage: damagedShips.get(s.id) } : s,
          )
        : state.ships,
    gameTimeSeconds: state.gameTimeSeconds + deltaSeconds,
    // Flat .plus(), unlike fleetAdminXpDelta (which resolves through
    // applyFleetAdminXp's level-up loop below), credits has no leveling
    // curve to resolve, so the accumulated creditsDelta is applied directly
    // here rather than passed through a second wrapping function.
    // Fuel Economy v2 (F3): earnings (creditsDelta) are ADDED and auto-buy fuel spend
    // (totalCreditsSpentOnFuel) is SUBTRACTED, both exact Decimal ops. Order is irrelevant
    // (addition then subtraction of exact operands); a call with no auto-buy subtracts 0.
    credits: state.credits.plus(creditsDelta).minus(totalCreditsSpentOnFuel),
    // Mission Rework (Task 5): subtract the total auto-repeat fuel spent this call from
    // the shared Decimal tank, ONCE (totalFuelSpent is a plain number; .minus accepts
    // it). Guaranteed >= 0: each captain's spend was gated on fuelBudgetRemaining, which
    // began at state.fuel.toNumber(), so the sum never exceeds the tank. 0 when no cycle
    // repeated (or a fuel-rich/no-mission call) -> state.fuel rides through unchanged.
    fuel: state.fuel.minus(totalFuelSpent),
    // Loot now lands in the keyed `inventory` (+ its `discovered` reveal set).
    // The old homePlanet.storage field is GONE (removed in Task 7, fully
    // replaced by `inventory`), so there is nothing for `...state` to carry
    // through for it. See the loot-fold comment just above for why the values
    // are identical to the prior storage write.
    inventory,
    discovered,
    // Task 7: the fleet-wide lifetimeStats accumulated ONE captain at a time
    // above, each fold routed through the shared foldLifetimeStatsDelta helper
    // (identical to App.svelte's live loop). itemsRefined/itemsCrafted + any
    // future lifetimeStats field rode through untouched via that helper's own
    // spread (same "don't silently drop untouched fields" guard the homePlanet
    // fold above uses). If no captain was on a mission this call, `lifetimeStats`
    // is still the original state.lifetimeStats reference, an exact no-op.
    lifetimeStats,
  };

  // Phase 1, Task 9: resolve every in-flight timed process ONCE, fleet-wide (NOT
  // per-captain, processes are facility-owned, not captain-owned), with the SAME
  // `ticksElapsed` the per-captain mission loop above consumed. This is the SINGLE
  // shared resolver App.svelte's live poll loop ALSO calls (identical
  // resolveProcesses import), so offline catch-up and live play cannot diverge on
  // process completion, the same drift-proof single-source discipline
  // foldLifetimeStatsDelta / addToInventory already use. A completed process's lump
  // Fleet Admiral XP (its full durationTicks) folds into the SAME fleetAdminXpDelta
  // the mission loop accumulated, so mission FA XP + process FA XP reach
  // applyFleetAdminXp together and resolve through ONE level-up pass. Threaded on
  // top of postMissionState so any process output (inventory/discovered/facilities)
  // composes with the mission loot already folded there. activeProcesses is empty
  // until refine jobs / facility upgrades start (Task 10/11), so resolveProcesses
  // early-outs to a same-reference no-op today, inert but correct + drift-proof
  // for when processes exist.
  const {
    next: postProcessState,
    fleetAdminXpDelta: processFleetAdminXpDelta,
    craftingXpDelta: processCraftingXpDelta,
  } = resolveProcesses(postMissionState, ticksElapsed, rng);
  fleetAdminXpDelta += processFleetAdminXpDelta;

  // Crafting Allocation Redesign (Task C2): process the per-slot REFINE production LINES
  // AFTER resolveProcesses, so a slot freed by a job COMPLETING this tick is immediately
  // refillable this SAME tick (no idle gap for a continuous line). REPLACES the retired
  // single-order processRefineOrder at the EXACT same seam. Each line starts at most one
  // fresh job (one slot per line); a job it starts here is a fresh TimedProcess that begins
  // advancing on the NEXT economyTick (its remainingTicks untouched by the resolveProcesses
  // that already ran above), exactly as a manually-started startRefineJob would.
  // processRefineLines reads the SAME materialAtCap cap seam the mission/trickle auto-stop
  // uses. A same-reference no-op when there are no refine lines, so a call with none lands
  // byte-identical to before this task. It touches only inventory/activeProcesses/
  // refineLines, no FA XP, so it composes cleanly before the final applyFleetAdminXp
  // pass below. Living HERE inside economyTick is what makes it run identically on the live
  // path (App.svelte per bar) and the offline path (tick() steps economyTick(_,1) per tick)
  //, the one-seam offline==live guarantee, now over multiple lines (see the C2 parity test).
  const postRefineLinesState = processRefineLines(postProcessState);

  // Process the per-slot FABRICATE production LINES at the SAME per-tick seam, AFTER
  // resolveProcesses (a fabricate slot freed this tick is refillable this tick) and AFTER
  // processRefineLines (so a fabricate line can consume refined materials a refine line
  // just produced/started this tick; the two are independent, each bounded by its own
  // facility's slot count, sharing activeProcesses but neither gating the other). Mirrors
  // processRefineLines exactly (shared per-line stepper). A same-reference no-op when there
  // are no fabricate lines. Stepped per WHOLE tick here, so tick(bigSpan) == looping
  // economyTick(_,1) for fabrication too, the SAME one-seam guarantee.
  const postFabricateLinesState = processFabricateLines(postRefineLinesState);

  // Fuel Economy v2 (F2): run the Fuel Depot's auto-refine pipelines AFTER
  // resolveProcesses (so a fuelRefineJob completing this tick frees its pipeline slot to
  // refill same-tick) and after processRefineLines / processFabricateLines (independent --
  // fuel batches count against fuelPipelineCount, refine jobs against refineSlotCount,
  // fabricate jobs against fabricateSlotCount; all share activeProcesses but none gates the
  // others). It reads the CURRENT tank (post mission-spend + post batch-deposits) and
  // CURRENT ice (post mission-loot + post refine-line consumption), starts batches into
  // free pipeline slots while the tank has room + ice, and is a same-reference no-op when
  // the depot runs no pipeline. Living HERE inside economyTick is what makes it run
  // identically live and offline (tick() steps economyTick(_,1) per tick), the one-seam
  // parity guarantee.
  const postFuelState = processFuelPipelines(postFabricateLinesState);

  // Combat 0.13.0 (Phase 11, design S13): auto-start ship REPAIRS AFTER resolveProcesses (a
  // repair completing this tick has already cleared its ship + freed its bay, so the next
  // queued damaged hull can claim it this SAME tick) and after the mission loop flagged any
  // newly-limped-home hull as damaged (on postMissionState, carried through resolveProcesses).
  // Independent of the refine/fabricate/fuel passes (repairs count against the shared Shipyard
  // bays via shipyardBayCount, touch only activeProcesses, share nothing that gates them with
  // the crafting lines). A same-reference no-op when no
  // hull is damaged. Living HERE inside economyTick is what makes repair auto-start identically
  // live (App.svelte per bar) and offline (tick() steps economyTick(_,1) per tick), the
  // one-seam offline==live guarantee, exactly like processFuelPipelines.
  const postRepairState = processShipRepairs(postFuelState);

  // applyFleetAdminXp wraps the final state, it runs AFTER BOTH the captain loop
  // (mission FA XP) and resolveProcesses (process FA XP) have contributed to
  // fleetAdminXpDelta, so every FA XP source this call resolves through the one
  // level-up pass. It does not touch inventory/facilities/activeProcesses/refineLines/
  // fabricateLines/fuel, the loot fold + resolveProcesses + processRefineLines +
  // processFabricateLines + processFuelPipelines above already produced their final values
  // on postFuelState. Threaded through postFuelState so every engine's newly-started jobs
  // ride into the returned state; with no lines and no depot pipeline postFuelState ===
  // postProcessState, so this is byte-identical to before those features.
  // (Fuel batches + fabricate jobs + ship repairs award NO FA XP, see resolveProcesses.)
  const postFleetAdminXpState = applyFleetAdminXp(postRepairState, fleetAdminXpDelta);

  // Crafting Level XP (Equipment 0.11.0, Phase 3, Task 8): fold the crafting XP that any
  // producing job (refine / fabricate / ship-build) accrued in resolveProcesses through its
  // own level-up pass, the crafting twin of the applyFleetAdminXp fold above. Crafting XP has
  // exactly ONE source (completed production jobs), so unlike fleetAdminXpDelta there is no
  // mission contribution to accumulate first, processCraftingXpDelta IS the whole delta.
  // applyCraftingXp touches only craftingXp/craftingLevel, so it composes cleanly on top of
  // the FA pass. A same-value no-op when no producing job completed (delta 0, no backlog).
  // Living at the SAME per-tick seam as the FA fold is what keeps crafting XP identical live
  // (App.svelte per bar) and offline (tick() steps economyTick(_,1) per tick).
  return applyCraftingXp(postFleetAdminXpState, processCraftingXpDelta);
}

// Offline catch-up entry point, tech spec §2 (Tick Loop and Time Semantics).
// Converts the elapsed wall-clock span (deltaSeconds) into the fleet-wide
// ticksElapsed cadence (moved off CaptainState during the UI Redesign, see
// docs/plans/2026-07-07-ui-redesign-design.md), CLAMPS it to the offline cap, then
// STEPS the economy forward ONE tick per economyTick call across the clamped span.
//
// Phase 2 (Task B3, design §2 + §3.4): this REPLACES the old single closed-form
// economyTick(state, wholeSpan) call. Why step per tick instead of one big call:
// auto-stop (§3.4) COUPLES production to storage, a captain must stop the moment
// its material fills, which is a discrete breakpoint mid-span. A single big call
// checks the cap only ONCE (at the span's start), so it would keep producing past a
// cap crossing. Stepping ONE tick at a time re-checks the cap every tick inside
// economyTick, so a run stops exactly when its material fills, correct by
// construction across the breakpoint, no closed-form breakpoint math to get wrong
// (the whole point of the step-forward foundation).
//
// Behavior parity vs. pre-B3: for the DETERMINISTIC economy (mission phase progress,
// captain/FA XP, credits, gameTimeSeconds) stepping N ticks of 1 equals one call of
// N, because economyTick/tickCaptainMission are closed-form ("one big jump == many
// small ticks", guarded by the closed-form parity test). LOOT rng SEQUENCING can
// differ with 2+ captains: a big call ran all of captain A's rolls, then all of B's;
// the stepped loop interleaves A,B per tick. Both consume the same NUMBER of rolls
// off the same stream, only the interleaving order differs, so totals are
// statistically equivalent (a constant rng makes them bit-identical, see the test).
//
// INTENTIONAL behavior CHANGE (design decision, user-confirmed): a span longer than
// offlineCapTicks(state) (2 real days at the default cadence) advances only 2 days;
// the excess is DISCARDED. Pre-B3 tick() advanced the FULL span uncapped. This is the
// deliberate offline cap, an extensible/derived value (see offlineCapTicks).
//
// PERFORMANCE: up to floor(offlineCapTicks) iterations (~172,800 at the 1s cadence),
// each a full economyTick. Per the design (§2.3) a tight no-render loop handles this
// well under a second; the 2-day cap BOUNDS it. Deliberately NOT hoisting economyTick's
// per-captain bonus/ship resolution out of the loop even though it recomputes
// call-constant values each tick: doing so would require a SEPARATE offline code path
// that bypasses economyTick, re-introducing the exact live-vs-offline drift the
// step-forward foundation exists to eliminate (design §2.2). Correctness over speed,
// exactly as this task scoped it; adaptive chunking is an explicitly-later task. No
// per-iteration progress log either, it would dwarf the sub-second loop's own cost
// (console I/O per tick), and App.svelte already emits a start/end "Welcome back.
// Advanced Ns offline." bookend around this call.
//
// rng defaults to Math.random (the only production caller, App.svelte's offline
// catch-up, passes no rng, byte-identical to the old inline Math.random). Tests
// inject a constant rng to make the stepped loot exactly assertable.
export function tick(deltaSeconds: number, state: GameState, rng: () => number = Math.random): GameState {
  if (deltaSeconds <= 0) return state;
  // Same deltaSeconds -> ticksElapsed conversion as before, then clamp to the cap.
  // Math.min discards any excess span beyond the cap (the intentional 2-day limit).
  const rawTicksElapsed = deltaSeconds / state.tickDurationSeconds;
  const clampedTicks = Math.min(rawTicksElapsed, offlineCapTicks(state));

  // Step the WHOLE ticks first: one economyTick(state, 1) per tick, so the auto-stop
  // cap-check inside economyTick runs every tick. Each call returns a fresh state that
  // feeds the next, accumulated inventory carries forward, so a mid-span cap crossing
  // is seen on the very next iteration.
  const wholeSteps = Math.floor(clampedTicks);
  let next = state;
  for (let i = 0; i < wholeSteps; i++) {
    next = economyTick(next, 1, rng);
  }

  // Apply any fractional remainder tick LAST, matching the precision the old single
  // closed-form call carried (it passed the full fractional ticksElapsed straight to
  // economyTick). frac is exactly 0 for an integer span (skipped); for a fractional
  // span it advances the sub-tick residue, exactly as one big call's trailing fraction
  // would. Summed, wholeSteps*1 + frac == clampedTicks, so the deterministic economy
  // lands identically to a single economyTick(state, clampedTicks) call.
  const frac = clampedTicks - wholeSteps;
  if (frac > 0) {
    next = economyTick(next, frac, rng);
  }

  return next;
}

// Mission Rework (Task 7, design §4): the typed reason canDispatch returns when a
// dispatch is BLOCKED. A string union (not a numeric enum) so it serializes/logs as a
// readable token and the Operations UI (Task 8) can switch on it exhaustively. The
// order of the members mirrors canDispatch's gate order (see below):
//   noCaptain   , no captain has that id (bad caller / stale UI reference)
//   busy        , the captain is already on a mission (dispatch is idle-only)
//   locked      , MISSIONS[key].unlockLevel > the missionControl facility level (Task 6)
//   captainLevel, the captain's level is below MISSIONS[key].requiresCaptainLevel
//   cargo       , the captain's ship cargoCapacity is below requiresCargoCapacity
//   noShip      , the captain flies no hull, so the trip can't be priced/carried
//   fuelCapacity, the hull's tank is physically too small for the round trip (RANGE)
//   fuelEmpty   , the shared fuel tank can't cover the round trip's cost (RESOURCE)
// NOTE: there is deliberately NO `credits` reason. Dispatch itself spends FUEL, not
// credits (credits are spent earlier, buying fuel via buyFuel). Adding a credit gate
// here would be a ghost gate that never fires, see the report / design §4.
export type DispatchBlockReason =
  | "noCaptain"
  | "busy"
  | "locked"
  | "captainLevel"
  | "cargo"
  | "noShip"
  | "needsRepair"
  | "fuelCapacity"
  | "fuelEmpty";

// Mission Rework (Task 7): THE single consolidated dispatch gate. Pure predicate --
// reads state + the static MISSIONS/SHIP_TYPES tables, mutates nothing, spends nothing.
// This is the ONE source of truth for "can this captain fly this mission right now?":
// it folds together the Task-6 unlock gate + the Task-5 fuel range/resource gates that
// dispatchCaptainOnMission used to check inline, and ADDS the two per-mission capability
// requirements (captain level, ship cargo). dispatchCaptainOnMission calls this first
// and does nothing else gate-wise; the Operations UI (Task 8) calls it directly to
// render each mission's dispatch button (enabled, or disabled with the reason shown).
//
// GATE ORDER is deliberate, cheapest/most-fundamental first, and determines WHICH
// reason surfaces when several fail at once (ok itself is order-independent, all must
// pass): identity (noCaptain) -> status (busy) -> unlock (locked) -> captain capability
// (captainLevel) -> hull existence (noShip) -> repair state (needsRepair) -> hull capability
// (cargo) -> fuel RANGE (fuelCapacity) -> fuel RESOURCE (fuelEmpty). captainLevel is checked BEFORE noShip on
// purpose: it's a property of the CAPTAIN alone, needs no hull, and is the more useful
// thing to tell the player first.
export function canDispatch(
  state: GameState,
  captainId: number,
  missionKey: MissionKey
): { ok: true } | { ok: false; reason: DispatchBlockReason } {
  // --- Identity + status: the captain must exist and be idle (dispatch is idle-only).
  // Found by id, not array index, ids and indices can diverge if captains are ever
  // reordered/removed (nothing does today, but the contract is id-keyed).
  const captain = state.captains.find((c) => c.id === captainId);
  if (!captain) return { ok: false, reason: "noCaptain" };
  if (captain.mission !== null) return { ok: false, reason: "busy" };

  // --- Unlock gate (Task 6): the mission-control facility level must have reached this
  // mission's unlockLevel. missionUnlocked derives it from the facility level (no flag).
  if (!missionUnlocked(state, missionKey)) return { ok: false, reason: "locked" };

  const mission = MISSIONS[missionKey];

  // --- Captain-capability gate (Task 7): the flying captain's level must meet the
  // mission's requiresCaptainLevel. OPTIONAL, ore runs omit it, so `undefined` skips
  // the check entirely (it is NOT treated as a requirement of 0). Needs no ship, so it
  // is checked before the hull is resolved.
  if (mission.requiresCaptainLevel !== undefined && captain.level < mission.requiresCaptainLevel) {
    return { ok: false, reason: "captainLevel" };
  }

  // --- Hull existence: resolve THIS captain's hull. GameState.ships[].assignedCaptainId
  // is the single source of truth for who flies what (the SAME .find() the economyTick
  // mission loop + the old inline dispatch gate used). No hull -> can't price fuel or
  // carry cargo, so block rather than dispatch a free, un-fuelled trip. The invariant
  // "every captain has exactly one hull" holds in production (migration + new-game seed
  // both assign one), so this is a belt-and-suspenders guard, not a routine path.
  const ship = state.ships.find((s) => s.assignedCaptainId === captainId);
  if (!ship) return { ok: false, reason: "noShip" };
  // --- Repair state (Combat 0.13.0, Phase 11, design S13): a DAMAGED hull (a combat hull
  // that lost a patrol and limped home) cannot fly ANY mission, extraction included, until
  // the Shipyard repairs it. Only patrol defeats set `damaged`, so in practice this only
  // ever grounds a combat hull, but the gate applies to any assigned hull for safety. The
  // escape valve is the same as patrols: swap to a healthy hull via assignShipToCaptain.
  if (ship.damaged) return { ok: false, reason: "needsRepair" };
  const shipDef = SHIP_TYPES[ship.typeKey];
  // Equipment 0.11.0 (Task 13/14): the EQUIPMENT-FOLDED derived stats for this hull,
  // resolved from the SAME seam economyTick uses (equippedFor + shipDerivedStats), so
  // the dispatch gate prices fuel and range on the very numbers the mission loop will
  // burn against. With no gear fitted the fold is an identity, so pre-equipment dispatch
  // behavior is byte-identical.
  const stats = shipDerivedStats(ship, equippedFor(state, ship.id));

  // --- Hull-capability gate (Task 7): the ship's cargoCapacity must meet
  // requiresCargoCapacity. Task 13: read the EQUIPMENT-FOLDED cargoCapacity so a fitted
  // Cargo Bay can genuinely satisfy a cargo requirement. OPTIONAL, same undefined-skips
  // semantics as the captain-level gate above.
  if (mission.requiresCargoCapacity !== undefined && stats.cargoCapacity < mission.requiresCargoCapacity) {
    return { ok: false, reason: "cargo" };
  }

  // --- Fuel gates (Task 5, folded in here). fuelNeeded reads the BASE mission's transit
  // legs scaled by engineEfficiency (see fuel.ts). Task 14: price it from the FOLDED
  // engineEfficiency (overlaid on the static ShipTypeDef, as economyTick does) so the
  // dispatch estimate matches the loop's per-cycle burn exactly.
  const need = fuelNeeded(mission, { ...shipDef, engineEfficiency: stats.engineEfficiency });
  // RANGE: the hull physically cannot carry enough fuel for the round trip. A HULL-
  // capability check (independent of how much fuel is in the shared tank). Task 13:
  // read the FOLDED fuelCapacity so a fitted fuel tank extends range. Forward-defensive:
  // no current hull+mission combo trips it, but it honors the dispatch contract.
  if (stats.fuelCapacity < need) return { ok: false, reason: "fuelCapacity" };
  // RESOURCE (Fuel Economy v2 F3): a short tank NO LONGER hard-blocks dispatch by itself --
  // dispatchCaptainOnMission AUTO-BUYS the shortfall from credits (paying a +2-tick refuel
  // penalty) and flies anyway. So `fuelEmpty` now fires ONLY when the tank is short AND the
  // shortfall is UNAFFORDABLE (the "truly broke" floor). An affordable-shortfall dispatch
  // passes this gate. shortfall/cost as plain numbers (fuel is human-scale, and state.fuel <
  // need here so .toNumber() is exact); credits compared as Decimal (.lt), it's the balance.
  if (state.fuel.lt(need)) {
    const shortfall = need - state.fuel.toNumber();
    const cost = shortfall * FUEL_CREDITS_PER_UNIT;
    if (state.credits.lt(cost)) return { ok: false, reason: "fuelEmpty" };
  }

  return { ok: true };
}

// Dispatches an idle captain (mission === null) on a mission. As of Task 7 this is a
// THIN WRAPPER over canDispatch (above), canDispatch is the single source of truth
// for every gate (identity, busy, unlock, captain level, cargo, fuel range/resource),
// so this function only (a) consults it, (b) on failure returns the SAME state ref +
// success:false + the block reason (so callers/UI can show it), and (c) on success
// seeds a brand-new CaptainMissionState at the start of the cycle and spends the first
// cycle's fuel. The return grew an OPTIONAL `reason` (undefined on success), purely
// ADDITIVE, so pre-Task-7 callers that read only { next, success } are unaffected.
export function dispatchCaptainOnMission(
  state: GameState,
  captainId: number,
  missionKey: MissionKey
): { next: GameState; success: boolean; reason?: DispatchBlockReason } {
  const gate = canDispatch(state, captainId, missionKey);
  // Blocked: same-ref no-op (dispatch's long-standing failure convention) + the reason.
  if (!gate.ok) return { next: state, success: false, reason: gate.reason };

  // gate.ok GUARANTEES: the captain exists and is idle, has an assigned hull, and the
  // shared tank covers one round trip. So the lookups below cannot fail, idx !== -1 and
  // the ship .find() is non-undefined (asserted with `!`), matching what canDispatch just
  // verified. We recompute them here (rather than threading them out of canDispatch) to
  // keep canDispatch a clean boolean predicate.
  const idx = state.captains.findIndex((c) => c.id === captainId);
  const ship = state.ships.find((s) => s.assignedCaptainId === captainId)!;
  // Equipment 0.11.0 (Task 14): price the first cycle's spend from the SAME folded
  // engineEfficiency canDispatch and economyTick use, so the dispatch estimate, the
  // actual spend here, and every subsequent loop cycle all burn the identical figure.
  // No gear fitted -> fold is an identity -> byte-identical to the pre-equipment spend.
  const dispatchStats = shipDerivedStats(ship, equippedFor(state, ship.id));
  const need = fuelNeeded(MISSIONS[missionKey], {
    ...SHIP_TYPES[ship.typeKey],
    engineEfficiency: dispatchStats.engineEfficiency,
  });

  // Fuel Economy v2 (F3): the first cycle's fuel-spend, mirroring the auto-repeat rule. If the
  // tank covers `need`, spend straight from it (no penalty). If the tank is SHORT, canDispatch's
  // fuelEmpty gate has ALREADY guaranteed the shortfall is affordable, so AUTO-BUY exactly the
  // shortfall from credits and stamp the +2-tick refuel penalty on this first cycle. shortfall/
  // cost are plain numbers (fuel is human-scale, and state.fuel < need here so .toNumber() is
  // exact); the tank + credits are updated with exact Decimal ops.
  const short = state.fuel.lt(need);
  const shortfall = short ? need - state.fuel.toNumber() : 0;
  const cost = shortfall * FUEL_CREDITS_PER_UNIT;
  const refuelDelayTicks = short ? REFUEL_PENALTY_TICKS : 0;

  const captains = [...state.captains];
  captains[idx] = {
    ...captains[idx],
    mission: {
      kind: "extraction", // Combat 0.13.0 (9b.5a): tag the extraction arm of the mission union
      missionKey,
      phase: "ordersReceived",
      phaseProgressTicks: 0,
      cargo: emptyLootTotals(),
      recalled: false,
      refuelDelayTicks,
    },
    // Combat 0.13.0 (offline recap): CLEAR any stale wall-stop reason on a fresh dispatch, so a
    // captain re-dispatched after a prior fuel/cargo/defeat stop never shows the old reason.
    lastStopReason: undefined,
  };
  // Tank: buy the shortfall (if any) INTO it, then spend the full round trip, so it nets to
  // (fuel + shortfall - need), i.e. 0 on a short tank or (fuel - need) on a covered one. Credits:
  // drop by the auto-buy cost (0 when the tank covered it, so .minus(0) is a value no-op). Both
  // guaranteed >= 0 by canDispatch (fuelCapacity + fuelEmpty gates passed).
  return {
    next: {
      ...state,
      captains,
      fuel: state.fuel.plus(shortfall).minus(need),
      credits: state.credits.minus(cost),
    },
    success: true,
  };
}

// ============================================================================
// Combat Patrols (Combat 0.13.0, Phase 9b.5a): the DISPATCH gate + action for a
// captain's SECOND mission kind, a combat patrol. Deliberately mirrors canDispatch /
// dispatchCaptainOnMission above (the extraction pair) so the two kinds share shape,
// conventions, and the same-ref-on-failure contract; only the gates + the seeded
// mission state differ. The patrol TICK LOOP (running battles) is 9b.5b; this unit only
// puts a captain ONTO a patrol. No player-facing path calls these yet (UI is 9b.5c).
// ============================================================================

// patrolWaveParams (Phase 12b-1 review): RELOCATED, value-identical, into
// combat/waveSchedule.ts so the def -> params mapper sits beside planWaveSchedule (the
// params -> schedule generator) and the display replay can import both from one leaf
// rather than reaching UP into tick.ts. It is imported at the top of this file and used
// by freshPatrolMission below exactly as before. Re-exported here so its external
// importer (patrol-dispatch.test.ts, which imports it from "./tick") keeps working
// unchanged; the true source of truth is combat/waveSchedule.ts.
export { patrolWaveParams } from "./combat/waveSchedule";

// freshPatrolMission: THE single source of truth for a brand-new PatrolMissionState.
// Combat 0.13.0 (Phase 9b follow-up). A fresh patrol is minted in exactly TWO places and
// they MUST stay identical: (1) dispatchCaptainOnPatrol seeds the very first cycle, and
// (2) tickCaptainPatrol relaunches the next cycle on a Dispatch-Repeatedly success. Those
// two sites differ ONLY in stance / masterSeed / repeatDispatch (dispatch takes the
// dispatch-time args; relaunch reuses the mission's own stance + repeatDispatch and a
// freshly derived per-captain masterSeed). EVERY other field, phase init, the full
// carry-state, the resolved wave schedule, and the `patrol-${masterSeed}-p` drone id
// prefix, is identical. Hand-building the 16-field object at both sites is exactly how a
// future field (9b.5d / P10) gets added to one site and silently forgotten at the other,
// desyncing a relaunched patrol from a freshly dispatched one. Consolidating here makes
// that drift a compile-time impossibility: add a field once, both sites get it.
//
// PURE: reads only the static PATROLS/def tables + the passed args, mutates nothing. The
// factionId + wave schedule are both derived from PATROLS[patrolKey] INSIDE the factory,
// so the pinned faction and the wave params can never come from a mismatched def.
function freshPatrolMission(args: {
  // WHICH patrol (stored on the state AND used to look the def up, one source, no drift).
  patrolKey: PatrolKey;
  // The player-chosen combat stance carried by every wave. Dispatch: the dispatch arg.
  // Relaunch: the mission's own persisted stance (stance survives a relaunch).
  stance: CombatStance;
  // The persisted master seed. Dispatch: GameState.nextPatrolSeed. Relaunch: the freshly
  // derived per-captain seed (deriveWaveSeed(oldSeed, 0, RELAUNCH_SEED_SALT)). It seeds
  // BOTH the wave schedule and the drone id prefix below, so passing one value keeps them
  // in lockstep.
  masterSeed: number;
  // Auto-relaunch intent. Dispatch: the dispatch arg. Relaunch: the mission's own flag
  // (it persists across cycles, which is what makes a repeat patrol repeat).
  repeatDispatch: boolean;
  // The ship's static combat stats, for the FULL carry-state pools (hull + shield); the
  // same SHIP_TYPES entry bridge.ts's shipToCombatant reads.
  shipDef: ShipTypeDef;
  // The resolved combat hull type, for the hull's DEFAULT drone screen fallback (a carrier's Attack
  // squadron; EMPTY for destroyer/battleship) when no installed gear is supplied.
  hullType: CombatHullType;
  // Combat 1.0 (Unit 2.3b): the ship's INSTALLED combat gear (equippedFor off the SAME GameState the
  // dispatch / relaunch path already reads for fuel + stats). Its droneBay pods seed the patrol's drone
  // carry-state (installedDronesForPatrol), so a CRAFTED pod actually reaches the field. OPTIONAL:
  // absent (a direct test call with no gear) falls back to the hull DEFAULT screen, which for a
  // Standard-Issue set is byte-identical to the installed-pod build. In normal play BOTH call sites
  // pass the ship's real fitted gear, so a Standard-Issue carrier is seeded byte-identically to before.
  installedGear?: EquipmentInstance[];
}): PatrolMissionState {
  const { patrolKey, stance, masterSeed, repeatDispatch, shipDef, hullType, installedGear } = args;
  // factionId + wave params BOTH come from this one def lookup (no caller-passed def that
  // could disagree with patrolKey).
  const def = PATROLS[patrolKey];
  // Combat-defense BLOCKER fix (2026-08-27): seed the FULL hull/shield carry-pools from the FOLDED
  // installed-gear defense (foldedPlayerDefense -> shipToCombatant), NOT the raw authored SHIP_TYPES
  // stats. A crafted-plated hull / crafted emitter fights above authored, so an authored seed opened
  // wave 1 below its real pool and the first buildPatrolPlayerCombatant override clamped it there.
  // For a Standard-Issue set (or absent gear) this folds byte-identically to the authored stats, so
  // no SI patrol fixture / parity outcome moves.
  const folded = foldedPlayerDefense(shipDef, installedGear);
  return {
    kind: "patrol",
    patrolKey,
    factionId: def.factionId, // pin the fought faction (def could be retuned mid-flight)
    stance,
    masterSeed,
    phase: "transitOut", // progressTicks 0 -> initial transit
    progressTicks: 0,
    // Resolve the wave schedule NOW: a pure function of the master seed + def params, so it
    // is stable across save/load and reproducible offline==live (see PatrolMissionState
    // .waveTicks for the wave-plan-now rationale).
    waveTicks: planWaveSchedule(masterSeed, patrolWaveParams(def)),
    nextWaveIndex: 0,
    wavesWon: 0,
    wavesLost: 0,
    // Carry-state seeded to FULL: hull/shield from the FOLDED installed-gear defense (folded above,
    // the SAME pool the wave combatant fights with), and the drones the ship
    // actually carries. Combat 1.0 (Unit 2.3b): seed from the ship's INSTALLED droneBay pods
    // (installedDronesForPatrol) so a CRAFTED pod's squadron reaches the patrol; fall back to the hull
    // DEFAULT screen only when no gear was supplied (a direct test call), which for a Standard-Issue set
    // is byte-identical. The drone id prefix is keyed to the master seed so ids are stable + unique per
    // patrol cycle, and identical between this live seed and the display replay's (structural parity).
    playerHull: folded.hullMax,
    playerShield: folded.shieldMax,
    playerDrones: installedGear
      ? installedDronesForPatrol(installedGear, `patrol-${masterSeed}-p`)
      : defaultDronesForHull(hullType, `patrol-${masterSeed}-p`),
    // Carry-state seeded to FULL system durability (Phase 12b Unit B2): every weapon + the
    // reactor + the ftl at their fresh ceilings (no wear), the same "start clean" a fresh
    // dispatch AND a relaunch both want. Wear accumulates from here across the cycle's waves.
    playerSystemDurability: defaultSystemDurabilityForHull(hullType, shipDef, installedGear),
    recalled: false,
    repeatDispatch,
  };
}

// combatStandardIssueSpecFor: resolve a hull's Standard-Issue combat magnitudes (Combat 1.0 Unit
// 1.4, REVISED by the combat-defense rework 2026-08-27). THE single caller-side place the combat
// loadout table (COMBAT_DEFAULT_LOADOUT) is read to build the baseline spec
// seedCombatStandardIssueForShip consumes, so a fresh build, a captain-grant, and the save migration
// all derive the IDENTICAL spec (Omega 4, DRY) and can never drift. A non-combat hull resolves to an
// EMPTY signatureWeapons (the seeder then mints nothing, a clean no-op).
//
// The DEFENSIVE magnitudes are the FIXED SI-gear dials (SI_PLATING_HP / SI_EMITTER_CAP /
// SI_EMITTER_RECHARGE), the SAME on every hull. Each hull's defense IDENTITY (bridge.ts
// hullDefenseComposition) is HYBRID: its bare frame (innateHullArmor = authored - SI_PLATING_HP, ADDED
// to plating) + its shield EFFECTIVENESS ratios (authored / REF). The fold recomposes an SI set to the
// hull's exact pre-gear totals: hull = innateHullArmor + SI_PLATING_HP == hullIntegrity; shield =
// SI_EMITTER_CAP * shieldCapacity/REF_SHIELD_CAPACITY == shieldCapacity; recharge likewise. So a
// Standard-Issue-geared ship still folds byte-identical to the old hull default (parity + balance
// fixtures do not move), while a crafted ship now beats a modest, reachable floor. PURE.
function combatStandardIssueSpecFor(typeKey: string): CombatStandardIssueSpec {
  const hull = combatHullTypeOf(typeKey);
  if (hull === null) {
    // Non-combat hull: an empty loadout (+ no drone roles), so the seeder mints nothing.
    return { signatureWeapons: [], droneRoles: [], shieldCapacity: 0, shieldRecharge: 0, hullStrength: 0 };
  }
  return {
    // The FULL default loadout (every hardpoint the hull ships with), in order.
    signatureWeapons: [...COMBAT_DEFAULT_LOADOUT[hull].weapons],
    // The hull's default drone-pod roles (Unit 2.3a): a carrier is ["attack"] (its one built-in
    // attack squadron), a destroyer/battleship is [] (no bays). Sourced from the SAME default-loadout
    // table the ABSENT-path drone build reads, so a Standard-Issue carrier folds to its default screen.
    droneRoles: [...COMBAT_DEFAULT_LOADOUT[hull].droneRoles],
    // FIXED SI-gear dials (same on every hull). The bridge MULTIPLIES the emitter's cap/recharge by the
    // hull's shield effectiveness (an SI destroyer's 300-cap emitter x its 100% cap-effectiveness recomposes
    // to its 300 shield). The plating's hullStrength (100) is ADDED to the hull's bare frame (100 + a
    // destroyer's 500 frame == its 600 hull).
    shieldCapacity: SI_EMITTER_CAP,
    shieldRecharge: SI_EMITTER_RECHARGE,
    hullStrength: SI_PLATING_HP,
  };
}

// installMissingCombatBaselines: fill every COMBAT hull in the fleet that is missing its required
// combat slots with a freshly-minted, fitted Standard-Issue combat set (its FULL default weapon
// loadout + shield emitter + hull plating + its default drone pods), threading nextEquipmentId
// forward. Combat 1.0 (Unit 1.3, REVISED Unit 1.4 for the full loadout + behaviour-preserving
// per-hull magnitudes, and Unit 2.3a to also seed a carrier's Standard-Issue attack drone pod).
//
// THE shared "give combat hulls their baseline" fold (Omega 4, DRY): the v33->v34 save migration
// (save.ts) delegates to it so a pre-combat-gear save's combat hulls become dispatchable on load.
// It mints the SAME baseline pieces a fresh build installs via seedCombatStandardIssueForShip (both
// go through generateCombatStandardIssue in the same weapon/shield/plating order), so a migrated
// and a freshly-built combat hull land on the byte-identical shape. Also the sanctioned way a
// freshState-derived TEST fixture that retypes a hull into a combat hull re-establishes the
// never-empty combat invariant the retype skipped.
//
// IDEMPOTENT + PER-SLOT: for each combat hull, only the ABSENT required slots are minted + fitted,
// so re-running installs nothing new (a fully-equipped hull is untouched) AND a partially-stripped
// hull (once the install UI can strip a single slot) is completed WITHOUT duplicating the slots it
// still carries. Today build + migration always install the complete set, so a hull has all three
// or none and this is equivalent to seeding the whole set; the per-slot logic simply future-proofs
// the seam a later install/uninstall unit would otherwise trip on. An economy hull (combatHullTypeOf
// null) is never touched. PURE: returns a NEW GameState (or the SAME ref when nothing changed).
export function installMissingCombatBaselines(state: GameState): GameState {
  let equipment = state.equipment;
  let nextEquipmentId = state.nextEquipmentId;
  let changed = false;
  for (const ship of state.ships) {
    const hull = combatHullTypeOf(ship.typeKey);
    if (hull === null) continue; // economy hull: no combat slots to fill
    const fitted = equipment.filter((e) => e.fittedToShipId === ship.id);
    const spec = combatStandardIssueSpecFor(ship.typeKey); // per-hull loadout + magnitudes (behaviour-preserving)
    // The required combat pieces, in the deterministic mint order the fresh-build seeder uses (every
    // weapon in loadout order, then shieldEmitters, then hullPlating), each carrying the per-hull
    // signature magnitude generateCombatStandardIssue needs. Mint + fit ONLY the slots this hull is
    // missing: a bare hull gets the full set (byte-identical to seedCombatStandardIssueForShip: same
    // order, same ids), while a partially-stripped hull is completed without duplicating what it has.
    const required: {
      slotType: "weapon" | "shieldEmitters" | "hullPlating" | "droneBay";
      weaponType?: WeaponId;
      droneRole?: DroneRole;
      shieldCapacity?: number;
      shieldRecharge?: number;
      hullStrength?: number;
    }[] = [
      ...spec.signatureWeapons.map((weaponType) => ({ slotType: "weapon" as const, weaponType })),
      { slotType: "shieldEmitters", shieldCapacity: spec.shieldCapacity, shieldRecharge: spec.shieldRecharge },
      { slotType: "hullPlating", hullStrength: spec.hullStrength },
      // Combat 1.0 (Unit 2.3a): the hull's default drone pods LAST (after plating), so the v34->v35
      // migration only APPENDS the new pod to an existing carrier (its weapon/shield/plating ids are
      // untouched). A carrier is ["attack"], a destroyer/battleship [] (no bays).
      ...spec.droneRoles.map((droneRole) => ({ slotType: "droneBay" as const, droneRole })),
    ];
    // Track how many weapon AND drone-pod pieces are ALREADY fitted so we only mint the MISSING ones
    // (never double-seed a hardpoint / bay the hull already carries), by COUNT + in order. Shield /
    // plating stay a per-slot presence check (they are singletons). In today's all-or-none reality a
    // combat hull has all its weapons/pods or none; the count logic keeps the seam correct for the
    // later single-slot install/uninstall unit.
    const weaponsFitted = fitted.filter((e) => e.slotType === "weapon").length;
    const droneBaysFitted = fitted.filter((e) => e.slotType === "droneBay").length;
    let weaponsSeeded = 0;
    let droneBaysSeeded = 0;
    for (const r of required) {
      if (r.slotType === "weapon") {
        // Skip weapon hardpoints already covered by an existing fitted weapon (by count, in order).
        if (weaponsSeeded < weaponsFitted) {
          weaponsSeeded += 1;
          continue;
        }
        weaponsSeeded += 1;
      } else if (r.slotType === "droneBay") {
        // Skip drone bays already covered by an existing fitted pod (by count, in order).
        if (droneBaysSeeded < droneBaysFitted) {
          droneBaysSeeded += 1;
          continue;
        }
        droneBaysSeeded += 1;
      } else if (fitted.some((e) => e.slotType === r.slotType)) {
        continue; // shield / plating already installed: never double-seed
      }
      const mintedId = nextEquipmentId; // capture before advancing so allocateId names THIS id
      equipment = [
        ...equipment,
        generateCombatStandardIssue({
          slotType: r.slotType,
          weaponType: r.weaponType,
          droneRole: r.droneRole,
          shieldCapacity: r.shieldCapacity,
          shieldRecharge: r.shieldRecharge,
          hullStrength: r.hullStrength,
          fittedToShipId: ship.id,
          allocateId: () => `equip-${mintedId}`,
        }),
      ];
      nextEquipmentId = mintedId + 1;
      changed = true;
    }
  }
  // Same-ref no-op when every combat hull was already fully equipped (or there are none), so a
  // caller that re-runs this on an already-migrated state gets back an untouched reference.
  return changed ? { ...state, equipment, nextEquipmentId } : state;
}

// The reasons canDispatchPatrol can block, a typed union mirroring DispatchBlockReason
// (extraction). Member order mirrors the gate order below (cheapest/most-fundamental
// first). Patrols share the identity/status/fuel gates but SWAP the mission-specific
// gates: an extraction mission gates on unlock/captain-level/cargo; a patrol instead
// gates on the assigned ship being a COMBAT HULL (`notCombatHull`), a user decision (a
// freighter/prospector cannot patrol). Unlock/level/reward gates for patrols are a later
// concern (no locked patrol content this unit), so they are deliberately absent here.
export type PatrolDispatchBlockReason =
  | "noCaptain"        // no captain has that id (bad caller / stale reference)
  | "busy"             // the captain is already on a mission (extraction OR patrol); dispatch is idle-only
  | "noShip"           // the captain flies no hull, so the trip can't be priced/crewed
  | "notCombatHull"    // the assigned hull is NOT a combat hull (destroyer/battleship/carrier)
  | "needsRepair"      // the assigned hull is DAMAGED (lost a patrol) and must be repaired first (Phase 11)
  // Combat-defense rework (BUG-U6, Unit 3, design S5 "Blockers by realism"): the ONLY hard combat-
  // dispatch requirement is a reactor. A reactorCore is an economy slot that recently became
  // strippable-to-empty, so an empty reactor is now REACHABLE. No power = the ship cannot set a
  // course or engage: a physical impossibility, not a tradeoff, so it is a HARD block. Weapons are
  // NO LONGER a block: a weaponless "battering ram" is a valid (bad) player choice, surfaced as a
  // NON-blocking advisory instead (see `noWeaponAdvisory` on the ok result below). Plating and shield
  // emitter are NO LONGER blocks either: a bare hull keeps its innateHullArmor (design 3a) and a hull
  // with no emitter simply flies with 0 shields (emitters ARE the shield source), both silent player
  // choices. So the old noWeapon / noShieldEmitter / noHullPlating block reasons are DELETED here.
  | "noReactor"        // the ship's reactorCore slot is EMPTY (no power = cannot dispatch; physically impossible)
  | "fuelCapacity"     // the hull's tank is physically too small for the round trip (RANGE)
  | "fuelEmpty";       // the shared fuel tank can't cover the round trip's cost AND the shortfall is unaffordable (RESOURCE)

// canDispatchPatrol: THE single consolidated patrol-dispatch gate. Pure predicate, reads
// state + the static PATROLS/SHIP_TYPES tables, mutates + spends nothing. The ONE source
// of truth for "can this captain fly this patrol right now?" (dispatchCaptainOnPatrol
// consults it and does nothing else gate-wise; a future patrol UI calls it directly).
//
// GATE ORDER (cheapest/most-fundamental first, determines WHICH reason surfaces when
// several fail): identity (noCaptain) -> status (busy) -> hull existence (noShip) -> hull
// CAPABILITY (notCombatHull) -> repair state (needsRepair) -> POWER (noReactor) -> fuel
// RANGE (fuelCapacity) -> fuel RESOURCE (fuelEmpty). notCombatHull is checked right after
// the hull is resolved (it is a property of the hull, cheaper + more useful to report than
// any fuel arithmetic). Fuel is priced from the SAME equipment-folded engineEfficiency the
// extraction gate uses, so a patrol's dispatch estimate matches what 9b.5b will burn.
//
// Combat-defense rework (Unit 3): the reactor is the ONLY hard combat-gear block (no power =
// physically cannot fly). A missing weapon is not a block, it is surfaced as a NON-blocking
// advisory on the ok result (`noWeaponAdvisory`, rendered as a persistent note on the dispatch
// card). Missing plating / shield emitter are silent player choices (no block, no advisory).
export function canDispatchPatrol(
  state: GameState,
  captainId: number,
  patrolKey: PatrolKey
): { ok: true; noWeaponAdvisory?: boolean } | { ok: false; reason: PatrolDispatchBlockReason } {
  // --- Identity + status: the captain must exist and be idle (dispatch is idle-only).
  // Found by stable id, not array index (mirrors canDispatch). `mission !== null` covers
  // BOTH kinds, so a captain already on an extraction mission OR a patrol is "busy".
  const captain = state.captains.find((c) => c.id === captainId);
  if (!captain) return { ok: false, reason: "noCaptain" };
  if (captain.mission !== null) return { ok: false, reason: "busy" };

  const def = PATROLS[patrolKey];

  // --- Hull existence: resolve THIS captain's hull (assignedCaptainId is the single
  // source of truth). No hull -> can't price fuel or crew the patrol.
  const ship = state.ships.find((s) => s.assignedCaptainId === captainId);
  if (!ship) return { ok: false, reason: "noShip" };

  // --- Hull CAPABILITY: a patrol requires a COMBAT hull (destroyer/battleship/carrier).
  // A freighter/prospector cannot patrol (user decision). combatHullTypeOf narrows the
  // typeKey to a CombatHullType or null; null -> blocked. (dispatch reuses this to seed
  // the carrier's default drones, so the two never disagree on "is this a combat hull".)
  if (combatHullTypeOf(ship.typeKey) === null) return { ok: false, reason: "notCombatHull" };

  // --- Repair state (Combat 0.13.0, Phase 11, design S13): a DAMAGED hull (one that lost a
  // patrol and limped home) CANNOT be re-dispatched until the Shipyard repairs it. Checked
  // after the hull is confirmed a combat hull (so only combat hulls surface needsRepair) and
  // before any fuel arithmetic (a wrecked ship can't fly regardless of the tank). The escape
  // valve is assignShipToCaptain: the captain can swap to a healthy hull and dispatch that
  // one; only THIS damaged hull is grounded until its repair completes.
  if (ship.damaged) return { ok: false, reason: "needsRepair" };

  // --- POWER (Combat-defense rework, Unit 3, design S5): the ONLY hard combat-gear block. A ship
  // with an EMPTY reactorCore slot has no power, so it physically cannot set a course or engage:
  // dispatch is REFUSED. The reactorCore is an economy slot that became strippable-to-empty in a
  // recent unit, so this state is now reachable (before that a ship always carried its economy
  // Standard-Issue reactor and this never fired). Checked after needsRepair (a property of the
  // hull's fitment, more fundamental than fuel) and before any fuel arithmetic (no power = no trip
  // regardless of the tank). Queried off the fittedToShipId authority in state.equipment.
  const fittedGear = state.equipment.filter((e) => e.fittedToShipId === ship.id);
  if (!fittedGear.some((e) => e.slotType === "reactorCore")) return { ok: false, reason: "noReactor" };

  // --- Weapon ADVISORY (design S5 "inform, don't forbid"): a ship with NO weapon installed CAN still
  // dispatch (a weaponless "battering ram" is a valid, bad player choice). It does NOT block; instead
  // we flag `noWeaponAdvisory` on the ok result so the dispatch card can render a PERSISTENT note
  // ("No weapon installed. You won't be able to return fire."). Plating + shield emitter are silent
  // choices (no block, no advisory): a bare hull keeps its innateHullArmor, and no emitter = 0 shields.
  const noWeaponAdvisory = !fittedGear.some((e) => e.slotType === "weapon");

  const shipDef = SHIP_TYPES[ship.typeKey];

  // --- Fuel gates: price the round trip from the patrol's transit legs (fuelForRoundTrip),
  // using the EQUIPMENT-FOLDED engineEfficiency (overlaid on the static ShipTypeDef, as
  // canDispatch does), so the dispatch estimate matches the loop's per-cycle burn. With no
  // gear fitted the fold is an identity. The folded fuelCapacity gates RANGE.
  const stats = shipDerivedStats(ship, equippedFor(state, ship.id));
  const need = fuelForRoundTrip(def.transitOutTicks, def.transitBackTicks, {
    ...shipDef,
    engineEfficiency: stats.engineEfficiency,
  });
  // RANGE: the hull physically cannot carry enough fuel for the round trip (independent of
  // how much is in the shared tank). Forward-defensive, mirrors canDispatch's fuelCapacity.
  if (stats.fuelCapacity < need) return { ok: false, reason: "fuelCapacity" };
  // RESOURCE (mirror of canDispatch/Fuel Economy v2 F3): a short tank does NOT hard-block,
  // dispatchCaptainOnPatrol AUTO-BUYS the shortfall from credits and flies. So fuelEmpty
  // fires ONLY when the tank is short AND the shortfall is UNAFFORDABLE (the "truly broke"
  // floor). shortfall/cost as plain numbers (fuel is human-scale, and state.fuel < need here
  // so .toNumber() is exact); credits compared as Decimal.
  if (state.fuel.lt(need)) {
    const shortfall = need - state.fuel.toNumber();
    const cost = shortfall * FUEL_CREDITS_PER_UNIT;
    if (state.credits.lt(cost)) return { ok: false, reason: "fuelEmpty" };
  }

  // Dispatchable. Carry the weapon advisory (only present when true) so the card can persistently
  // warn a weaponless dispatch without ever blocking it. Omitted (undefined) when a weapon IS
  // installed, so callers asserting a plain { ok: true } stay unchanged.
  return noWeaponAdvisory ? { ok: true, noWeaponAdvisory: true } : { ok: true };
}

// dispatchCaptainOnPatrol: put an idle captain onto a patrol. A THIN WRAPPER over
// canDispatchPatrol (the single source of truth for every gate), mirroring
// dispatchCaptainOnMission exactly: (a) consult the gate, (b) on failure return the SAME
// state ref + success:false + the reason (same-ref no-op convention), (c) on success
// consume the first leg's fuel (auto-buying any affordable shortfall, like extraction),
// draw the master seed, resolve the wave schedule NOW, seed a fresh PatrolMissionState,
// and increment nextPatrolSeed.
export function dispatchCaptainOnPatrol(
  state: GameState,
  captainId: number,
  patrolKey: PatrolKey,
  stance: CombatStance,
  repeatDispatch: boolean
): { next: GameState; success: boolean; reason?: PatrolDispatchBlockReason } {
  const gate = canDispatchPatrol(state, captainId, patrolKey);
  // Blocked: same-ref no-op (dispatch's long-standing failure convention) + the reason.
  if (!gate.ok) return { next: state, success: false, reason: gate.reason };

  // gate.ok GUARANTEES: the captain exists + is idle, has an assigned COMBAT hull, and the
  // tank covers (or can affordably top up to) one round trip. So the lookups below cannot
  // fail (asserted with `!`), matching what canDispatchPatrol just verified. Recomputed
  // here (rather than threaded out of the gate) to keep the gate a clean predicate.
  const def = PATROLS[patrolKey];
  const idx = state.captains.findIndex((c) => c.id === captainId);
  const ship = state.ships.find((s) => s.assignedCaptainId === captainId)!;
  const shipDef = SHIP_TYPES[ship.typeKey];
  const hullType = combatHullTypeOf(ship.typeKey)!; // non-null: canDispatchPatrol passed notCombatHull

  // The ship's INSTALLED combat gear, resolved ONCE here: it prices the fuel (via engineEfficiency
  // below) AND seeds the patrol's drone carry-state from the installed droneBay pods (Unit 2.3b), so
  // both read the identical fitted set (no chance of a second equippedFor call drifting).
  const installedGear = equippedFor(state, ship.id);
  // Price the first cycle's fuel from the SAME folded engineEfficiency the gate + 9b.5b use.
  const dispatchStats = shipDerivedStats(ship, installedGear);
  const need = fuelForRoundTrip(def.transitOutTicks, def.transitBackTicks, {
    ...shipDef,
    engineEfficiency: dispatchStats.engineEfficiency,
  });
  // Fuel spend, mirroring dispatchCaptainOnMission: if the tank covers `need`, spend
  // straight from it; if SHORT, canDispatchPatrol's fuelEmpty gate has already guaranteed
  // the shortfall is affordable, so AUTO-BUY exactly the shortfall from credits. (Patrols
  // have no ordersReceived refuel-penalty concept, so no penalty tick is stamped, that
  // extraction mechanic does not apply to the patrol phase model.)
  const short = state.fuel.lt(need);
  const shortfall = short ? need - state.fuel.toNumber() : 0;
  const cost = shortfall * FUEL_CREDITS_PER_UNIT;

  // The persisted master seed for this patrol, taken from the never-reused counter; the
  // counter increments below so the next patrol gets a distinct seed.
  const masterSeed = state.nextPatrolSeed;
  // Seed the fresh mission via the shared factory (THE single source of truth for a new
  // patrol, shared with the relaunch site so the two can never drift): it resolves the
  // wave schedule from masterSeed + def, seeds the full hull/shield/drone carry-state, and
  // keys the drone id prefix to masterSeed. Dispatch passes the dispatch-time stance /
  // masterSeed / repeatDispatch.
  const mission = freshPatrolMission({ patrolKey, stance, masterSeed, repeatDispatch, shipDef, hullType, installedGear });

  const captains = [...state.captains];
  // Combat 0.13.0 (offline recap): CLEAR any stale wall-stop reason on a fresh patrol dispatch,
  // mirroring dispatchCaptainOnMission, so a captain re-dispatched after a prior fuel/cargo/
  // defeat stop never shows the old reason.
  captains[idx] = { ...captains[idx], mission, lastStopReason: undefined };
  // Tank + credits: buy the shortfall (if any) INTO the tank, then spend the full round
  // trip (nets to 0 on a short tank, fuel-need on a covered one); drop credits by the
  // auto-buy cost (0 when the tank covered it). Both guaranteed >= 0 by the passed gate.
  // nextPatrolSeed increments so this master seed is never reused.
  return {
    next: {
      ...state,
      captains,
      fuel: state.fuel.plus(shortfall).minus(need),
      credits: state.credits.minus(cost),
      nextPatrolSeed: state.nextPatrolSeed + 1,
    },
    success: true,
  };
}

// Flags an active mission as recalled. Deliberately does NOT reset phase,
// phaseProgressTicks, or cargo, recall only flags intent; tickCaptainMission
// (Task 2) already knows to end the mission (mission -> null) instead of
// auto-repeating once the CURRENT cycle's unloading phase completes. So
// recall takes effect at the end of the current cycle, not immediately --
// a deliberate design choice, not a bug. Fails if no captain has that id,
// or if they have no active mission to recall.
//
// Combat 0.13.0 (Phase 9b.5a): works for EITHER arm of the CaptainState.mission
// discriminated union. Both CaptainMissionState and PatrolMissionState carry a
// `recalled: boolean`, so spreading the (non-null) mission and overriding recalled
// preserves the arm's `kind` + every other field and stays a valid union member. A
// patrol honors the flag at its own cycle end (9b.5b); an extraction mission at unload.
export function recallCaptain(state: GameState, captainId: number): { next: GameState; success: boolean } {
  const idx = state.captains.findIndex((c) => c.id === captainId);
  if (idx === -1) return { next: state, success: false };
  const mission = state.captains[idx].mission;
  if (mission === null) return { next: state, success: false };

  const captains = [...state.captains];
  captains[idx] = { ...captains[idx], mission: { ...mission, recalled: true } };
  return { next: { ...state, captains }, success: true };
}

// Renames a captain: sets CaptainState.label (the editable DISPLAY name, default
// "Captain N") to a player-supplied string, AFTER routing it through the single
// validateCaptainName chokepoint (captainName.ts). This is the only supported
// way to change a captain's label, so the courtesy validation cannot be skipped
// by the UI, and when server-side moderation lands (0.14.0) it slots in behind
// the same seam without touching this call site.
//
// Return shape matches the local action-function convention (recallCaptain /
// assignShipToCaptain above): { next, success, reason? }, and it follows the
// SAME "same state reference on failure" rule so callers can cheaply detect a
// no-op with `next === state`. The `reason` field is present only on failure and
// carries either "notFound" (no captain with that id, treated as a FAILURE, not
// a silent success, mirroring recallCaptain's unknown-id handling) or the exact
// validation reason forwarded from validateCaptainName (empty | tooLong |
// charset | profanity), so the UI can show a specific message.
//
// Pure + immutable: on success it spreads a NEW captains array with ONLY the
// matching captain replaced (matched by id, never by index, so a reordered or
// sparse roster still hits the right captain); every other captain object is
// carried by reference, untouched. It never throws on a bad id.
export function renameCaptain(
  state: GameState,
  captainId: number,
  rawName: string,
): { next: GameState; success: boolean; reason?: "notFound" | "empty" | "tooLong" | "charset" | "noAlphanumeric" | "profanity" } {
  // Locate the target by STABLE id (Task 1.1 monotonic counter), not array
  // position. Unknown id is a failure no-op (same state reference), matching
  // recallCaptain rather than throwing.
  const idx = state.captains.findIndex((c) => c.id === captainId);
  if (idx === -1) return { next: state, success: false, reason: "notFound" };

  // Courtesy validation chokepoint. On rejection, return the state UNCHANGED
  // (same reference) and forward the specific reason for the UI to surface.
  const result = validateCaptainName(rawName);
  if (!result.ok) return { next: state, success: false, reason: result.reason };

  // Valid: replace ONLY the target captain's label with the cleaned (trimmed)
  // value. Immutable spread, no mutation of the incoming state or its captains.
  const captains = [...state.captains];
  captains[idx] = { ...captains[idx], label: result.value };
  return { next: { ...state, captains }, success: true };
}

// Sets (or CLEARS) a ship's optional custom name (Renamable Ships). Pure +
// immutable: returns a NEW GameState with ONLY the matching ship replaced
// (matched by stable id, never by array index, so a reordered fleet still hits
// the right hull); every other ship object is carried by reference, untouched.
// It never throws on a bad id.
//
// This is the ship analogue of renameCaptain above and routes through the SAME
// validateCaptainName courtesy chokepoint (captainName.ts), so ship and captain
// names share one seam, one char/length/profanity ruleset, and one future
// server-side moderation hook. The length ceiling is therefore MAX_CAPTAIN_NAME
// (24), reused deliberately rather than a second ad-hoc limit.
//
// CONTRACT (differs from renameCaptain on purpose, hence a distinct helper):
//   - Return type is a PLAIN GameState (not { next, success, reason }). A custom
//     ship name is a pure convenience label with no gameplay effect, so the caller
//     needs only the resulting state, not a reason code.
//   - The input is TRIMMED. An empty / whitespace-only name is a valid request
//     that CLEARS the custom name back to the hull-type default (the `name` key is
//     dropped entirely, so a cleared ship is byte-identical to a never-named one).
//   - A non-empty name is run through validateCaptainName. On rejection (too long,
//     bad charset, punctuation-only, or profanity) the state is returned UNCHANGED
//     (same reference), a silent no-op. The rename UI feeds this from a
//     length-capped input, so the reachable rejection paths are charset/profanity,
//     which simply leave the current name in place (the input visibly reverts).
//   - An unknown shipId, or an empty-clear on an already-unnamed ship, is a no-op
//     that returns the SAME state reference (no needless allocation).
export function renameShip(
  state: GameState,
  shipId: string,
  rawName: string,
): GameState {
  // Locate the target hull by STABLE id, not array position. Unknown id is a
  // no-op returning the same reference (matches renameCaptain / assignShipToCaptain).
  const idx = state.ships.findIndex((s) => s.id === shipId);
  if (idx === -1) return state;

  const trimmed = rawName.trim();

  // CLEAR path: an empty / whitespace-only name drops the custom name so the ship
  // falls back to its hull-type label. If it is already unnamed there is nothing
  // to change, so return the same reference untouched.
  if (trimmed.length === 0) {
    if (state.ships[idx].name === undefined) return state;
    const ships = [...state.ships];
    // Drop the `name` key entirely (rest-destructure) so a cleared ship matches a
    // freshly built, never-named ship exactly (no lingering `name: undefined`).
    const { name: _cleared, ...withoutName } = ships[idx];
    ships[idx] = withoutName;
    return { ...state, ships };
  }

  // SET path: run the shared courtesy validation. On rejection, leave state
  // unchanged (same reference); the UI keeps showing the current name.
  const result = validateCaptainName(trimmed);
  if (!result.ok) return state;

  const ships = [...state.ships];
  ships[idx] = { ...ships[idx], name: result.value };
  return { ...state, ships };
}

// Assigns a ship to a captain under the "captains always have a hull; swapping
// is an ATOMIC REPLACE" model (Ships, Stats Foundation, Task 8). ShipInstance
// .assignedCaptainId is the SINGLE SOURCE OF TRUTH for who flies what, this
// function is the only supported way to move it, and it keeps the invariant
// "no ship is assigned to two captains at once" intact by parking the captain's
// PREVIOUS hull whenever they take a different one. Pure: returns a new state,
// mutates nothing. The Sector Space UI (Task 11) is the caller.
//
// Same "same state reference on failure" convention as every other action
// function in this file (dispatchCaptainOnMission / recallCaptain above). Fails
// (returns the SAME state reference, success: false) if:
//   - the captain or the ship doesn't exist (find returns undefined), OR
//   - the captain is on a mission (mission !== null), a hull can't change
//     mid-mission. This lock is LOAD-BEARING for the closed-form guarantee:
//     tickCaptainMission resolves effectiveMissionDef from the assigned hull
//     ONCE per call and holds it constant across the whole cycle; letting the
//     hull change mid-cycle would break the "one big jump == many small ticks"
//     property that guarantee depends on, OR
//   - the target ship is already flown by a DIFFERENT captain (assignedCaptainId
//     is non-null and not this captain), you can't poach another captain's
//     hull; it must be parked first.
//
// ORDERING IS SUBTLE, read before touching the .map() below. We assign the
// TARGET ship first (its branch wins), THEN park any *different* hull the
// captain used to fly. The order matters ONLY for the self-reassign case
// (assigning the captain the exact ship they already fly): if we parked "the
// captain's current ship" FIRST, that would null ship-X, and then the target
// branch would re-assign the same ship-X, a wash, but fragile. By running the
// target branch first and gating the park branch on "assignedCaptainId ===
// captainId" for a DIFFERENT id, the self-reassign lands entirely in the target
// branch (s.id === shipId), so the park branch never fires on it. Net effect:
// self-reassign is a harmless no-op (the captain keeps their ship), and a true
// swap parks exactly the one old hull. See the "self-reassign" test in
// tick.test.ts, which exists specifically to lock this ordering in.
export function assignShipToCaptain(
  state: GameState,
  captainId: number,
  shipId: string
): { next: GameState; success: boolean } {
  const captain = state.captains.find((c) => c.id === captainId);
  const ship = state.ships.find((s) => s.id === shipId);
  if (!captain || !ship) return { next: state, success: false };
  if (captain.mission !== null) return { next: state, success: false };
  if (ship.assignedCaptainId !== null && ship.assignedCaptainId !== captainId) {
    return { next: state, success: false };
  }

  // ORDER MATTERS (see header comment): the target-assign branch is listed
  // FIRST so it wins for the self-reassign case; the park branch only fires on a
  // DIFFERENT old hull the captain was flying.
  const ships = state.ships.map((s) => {
    if (s.id === shipId) return { ...s, assignedCaptainId: captainId }; // assign target (wins)
    if (s.assignedCaptainId === captainId) return { ...s, assignedCaptainId: null }; // park the (different) old hull
    return s;
  });
  return { next: { ...state, ships }, success: true };
}

// (buyShip, the INSTANT Requisition credit-buy for a new hull (Ships, Stats
// Foundation, Task 9), was RETIRED in S4. Hulls are now BUILT at the Shipyard
// from materials over time (startShipBuild + the shipBuild engine), so the
// instant credit-spend path is obsolete. New hulls still arrive PARKED and are
// assigned via assignShipToCaptain, and their ids are still minted from
// state.nextShipId as "ship-N", the shipBuild completion reuses that exact
// scheme. shipStorageCapacity still caps the fleet; only the credit-buy entry
// point is gone.)

// (craftRecipe, the legacy INSTANT Homeworld craft action, was RETIRED in
// Phase 4, Task F5. The timed Fabricator engine (now the per-slot production-LINE
// engine, processFabricateLines below) fully replaces it, feeding the SAME
// lifetimeStats.itemsCrafted tally on craft completion.)

// ============================================================================
// Timed-process engine, Phase 1, Task 8
// (docs/plans/2026-07-11-facility-framework-refinery-design.md §3, §4).
//
// ONE deterministic, fixed-duration process shape backs BOTH refine jobs and
// facility upgrades (design §3). Two functions:
//   - startProcess    : gate on inputs, ATOMICALLY deduct them, push the process.
//   - resolveProcesses : decrement every process's countdown, complete any that
//                        hit zero (apply effect + lump Fleet Admiral XP), remove
//                        it. The SINGLE completion resolver Task 9 calls from BOTH
//                        tick() (offline catch-up) AND App.svelte's live poll --
//                        one helper, no second hand-mirrored copy (the drift-proof
//                        single-source pattern foldLifetimeStatsDelta established).
//
// Placed in tick.ts (not a separate process.ts) deliberately: resolveProcesses
// reuses addToInventory (the shared add seam, this file), and Task 9 wires
// resolveProcesses INTO tick() (this file), keeping it here avoids a circular
// import (process.ts -> tick.ts for addToInventory, tick.ts -> process.ts for the
// wiring) that no local typecheck could catch on this Node-less machine. It sits
// beside every other game-action function (craftRecipe/buyShip/dispatch...).
// ============================================================================

// Starts a timed process, consuming its inputs ATOMICALLY at start (design §4).
// Mirrors the { next, success } convention of every other action in this file,
// but names the flag `started` (the design doc's term) instead of `success`.
//
// GATE then DEDUCT, both against the LIVE inventory: because every running
// process already had its inputs removed at ITS start, the live inventory IS the
// available-materials ledger, no separate reservation bookkeeping. If ANY input
// is short, nothing changes and the SAME state reference is returned (the
// same-ref-on-failure convention dispatchCaptainOnMission/craftRecipe use).
//
// ATOMICITY is the whole point (design §4): deducting in the same transition that
// creates the process closes the "checked-but-not-yet-consumed" window, so two
// concurrent starts can NOT both see enough materials and both begin, the first
// start's deduct is visible to the second start's gate. A DEDUCT is not a
// discovery event, so inputs are removed with a plain .minus() on an inventory
// clone (NOT routed through addToInventory), exactly as craftRecipe deducts its
// recipe inputs. Only the process OUTPUT (granted later, in resolveProcesses)
// goes through the discovery-marking add seam.
// `lineId` (Crafting Allocation Redesign, Task C2): OPTIONAL owning-line id, stamped
// onto the created TimedProcess so the per-slot line engine can match a job back to
// its line (one in-flight job per line). OMITTED by every existing caller (manual
// refine/fabricate jobs, facility upgrades, fuel batches, research), when undefined
// the field is left OFF the process entirely (not set to undefined), so those
// processes are byte-identical to before this param existed and a deep-equal parity
// snapshot is unaffected.
export function startProcess(
  state: GameState,
  kind: TimedProcessKind,
  inputs: Record<string, Decimal>,
  durationTicks: number,
  effect: ProcessEffect,
  lineId?: string
): { next: GameState; started: boolean } {
  // Gate: EVERY input must be affordable. An absent inventory key reads as 0
  // (grow-on-demand contract, same as addToInventory), so requiring a
  // never-held item is correctly rejected unless the required qty is <= 0.
  for (const itemId of Object.keys(inputs)) {
    // Quality-bucketed inventory (Task 9a): affordability gates on the item TOTAL
    // (sum of buckets), read via itemTotal (absent key -> 0, same as the old scalar
    // `state.inventory[itemId] ?? 0`).
    const have = itemTotal(state.inventory, itemId);
    if (have.lt(inputs[itemId])) return { next: state, started: false };
  }

  // Deduct every input via removeItemLowestFirst (Task 9a), the documented consume
  // policy (drain the lowest quality bucket first). While all stock is quality 0 this
  // only ever touches bucket 0, so it is byte-identical to the old scalar `.minus()`
  // deduct; the gate above already proved every input is affordable, so no bucket goes
  // negative. Threaded immutably (each call returns a fresh inventory), the bucketed
  // twin of the old `{ ...state.inventory }` clone + per-key `.minus()`.
  let inventory = state.inventory;
  for (const itemId of Object.keys(inputs)) {
    inventory = removeItemLowestFirst(inventory, itemId, inputs[itemId]);
  }

  // id minted from nextProcessId as "proc-N" (the scheme TimedProcess.id / this
  // field's freshState seed document), then nextProcessId bumped so ids stay
  // monotonic and are never reused, identical to buyShip's "ship-N" handling.
  // remainingTicks is SEEDED from durationTicks (the countdown starts full);
  // durationTicks is retained unchanged as the fixed lump FA XP award.
  const process: TimedProcess = {
    id: `proc-${state.nextProcessId}`,
    kind,
    remainingTicks: durationTicks,
    durationTicks,
    effect,
    // Only attach lineId when a caller supplied one (the line engine), via
    // conditional spread, so a non-line process carries NO lineId key at all,
    // keeping it identical to a pre-C2 process for deep-equal snapshots.
    ...(lineId !== undefined ? { lineId } : {}),
  };

  return {
    next: {
      ...state,
      inventory,
      activeProcesses: [...state.activeProcesses, process],
      nextProcessId: state.nextProcessId + 1,
    },
    started: true,
  };
}

// ============================================================================
// Facility framework, Phase 1, Task 10
// (docs/plans/2026-07-11-facility-framework-refinery-design.md §5, §6).
//
// Two functions, built on the Task 8 startProcess engine above:
//   - canBuildFacilityUpgrade : pure predicate. Is the NEXT upgrade for a facility
//                               buildable RIGHT NOW? Returns { ok, reason? }, the
//                               reason names the FIRST failing gate (for the future
//                               Refinery panel's red "missing" readouts).
//   - startFacilityUpgrade    : the action. If buildable, hand the upgrade's
//                               materials/duration/level-up effect to startProcess
//                               (atomic deduct-at-start). Else a same-ref no-op.
//
// The NEXT upgrade for a facility at level L is FACILITIES[key].upgrades[L]
// (upgrades[i] = requirements to reach level i+1, so a fresh level-0 facility's
// next rung is upgrades[0], the build/unlock). An out-of-range index (level ==
// upgrades.length) means the track is MAXED -> not buildable.
// ============================================================================

// Reads the current level of a facility, treating an absent facility key as level
// 0 (grow-on-demand, the SAME posture resolveProcesses' facilityLevelUp uses when
// it bumps an unseen facility). freshState seeds { refinery: { level: 0 } }, so
// today this always finds the entry, but the fallback keeps a future not-yet-seeded
// facility from reading `undefined.level`.
function facilityLevel(state: GameState, facilityKey: string): number {
  return state.facilities[facilityKey]?.level ?? 0;
}

// Mission Rework (Task 6): is `missionKey` currently dispatchable, purely as a
// function of the mission-control facility's LEVEL? A mission is unlocked once the
// facility has reached that mission's declared unlockLevel (MissionDef.unlockLevel,
// the single source of truth for the mapping). There is NO separate per-mission
// unlock flag, the level derives it, so it can never drift out of sync.
//
// The mapping this pass (USER REVISION 2026-07-14, 4 missions, missionControl caps
// at level 1):
//   - level >= 1 (fresh save's seed): ALL FOUR missions (every current MissionDef is
//     unlockLevel 1), nothing is locked by default.
// A future mission adds its own higher unlockLevel + a re-added mission-control unlock
// rung (deferred today; see FACILITIES.missionControl). This predicate then gates it
// automatically, the level-derived mechanism needs no change to support a locked
// mission, which is why the locked-mission dispatch guard + UI are retained.
//
// PURE: reads state.facilities + the static MISSIONS table; mutates nothing. Exposed
// for Task 7's dispatch requirements gate + Task 8's Operations UI to gray out locked
// missions. dispatchCaptainOnMission already calls it as a belt-and-suspenders guard.
export function missionUnlocked(state: GameState, missionKey: MissionKey): boolean {
  return facilityLevel(state, "missionControl") >= MISSIONS[missionKey].unlockLevel;
}

// PURE predicate, reads state + the static FACILITIES table, mutates nothing,
// starts nothing. `ok: true` means startFacilityUpgrade would succeed right now;
// `ok: false` carries a `reason` naming the FIRST failing gate. Gate order is
// deliberate and documented inline: cheap structural gates (facility exists /
// track not maxed) first, then the prerequisite gates (FA level, talents,
// research, facility levels), then materials LAST, materials are the gate most
// likely to be transiently unmet (you gather ore over time), so a stale
// prerequisite (wrong FA level / missing talent) surfaces ahead of "just go mine
// more ore". This ordering only affects WHICH reason shows when multiple gates
// fail at once; `ok` itself is unaffected by order (all gates must pass).
export function canBuildFacilityUpgrade(
  state: GameState,
  facilityKey: string
): { ok: boolean; reason?: string } {
  const facilityDef = FACILITIES[facilityKey];
  // Unknown facility key, no such facility in the table. Defensive: today every
  // caller passes "refinery", but a typo'd/removed key returns a clear reason
  // rather than throwing on `undefined.upgrades`.
  if (!facilityDef) {
    return { ok: false, reason: `Unknown facility: ${facilityKey}` };
  }

  const currentLevel = facilityLevel(state, facilityKey);
  const upgrade = facilityDef.upgrades[currentLevel]; // the NEXT rung (undefined = maxed)
  // Track maxed, no upgrade defined past the current level. Not buildable, and
  // the UI can show the facility as fully upgraded.
  if (!upgrade) {
    return { ok: false, reason: `${facilityDef.label} is fully upgraded` };
  }

  // SEQUENTIAL-PER-FACILITY gate: at most ONE upgrade in flight for THIS facility
  // at a time. Checked BEFORE the prereq/material gates so the exploit it closes is
  // structurally impossible. Because a facility's `level` only bumps at process
  // COMPLETION, without this gate `upgrades[currentLevel]` stays the SAME rung while
  // a build is mid-flight, so a player could start the cheap level 0->1 build
  // twice and land at level 2, SKIPPING the escalating cost + FA-level/talent gates
  // on the level 1->2 rung. Requiring the in-flight rung to complete (which bumps
  // `level`, advancing `upgrades[currentLevel]` to the NEXT rung) before the next is
  // buildable makes each facility's track strictly sequential, forcing every rung's
  // real cost/gates to be paid in order.
  //
  // CONCURRENCY IS UNAFFECTED ACROSS DISTINCT FACILITIES: this keys ONLY on
  // effect.facility === facilityKey, so an upgrade to some OTHER facility in flight
  // does NOT block this one, and vice versa. Refine JOBS (kind "refineJob") are a
  // different kind entirely and are never matched here, they parallelize by slot
  // count, not by this gate.
  const upgradeInFlight = state.activeProcesses.some(
    (p) =>
      p.kind === "facilityUpgrade" &&
      p.effect.type === "facilityLevelUp" &&
      p.effect.facility === facilityKey
  );
  if (upgradeInFlight) {
    return { ok: false, reason: "Upgrade already in progress" };
  }

  // Prerequisite gate: Fleet Admiral level. Absent field => no FA-level wall.
  if (upgrade.requiresFleetAdminLevel !== undefined && state.fleetAdminLevel < upgrade.requiresFleetAdminLevel) {
    return { ok: false, reason: `Requires Fleet Admiral level ${upgrade.requiresFleetAdminLevel}` };
  }

  // Prerequisite gate: Homeworld Talents, EVERY listed talent must be unlocked
  // fleet-wide. Reason names the first missing talent by its display label (the
  // SAME HOMEWORLD_TALENTS[key].label the talent tree UI shows), not the raw key.
  if (upgrade.requiresHomeworldTalents) {
    for (const talentKey of upgrade.requiresHomeworldTalents) {
      if (!state.unlockedHomeworldTalents.includes(talentKey)) {
        return { ok: false, reason: `Requires Homeworld Talent: ${HOMEWORLD_TALENTS[talentKey].label}` };
      }
    }
  }

  // Prerequisite gate: Research topics. EMPTY today (no research topics exist), so
  // this loop never runs against real data, but it is honored if a future
  // upgrade ever lists one, per "reserve the gate, no placeholder". No label table
  // for research topics exists yet, so the raw id is surfaced as-is.
  if (upgrade.requiresResearch) {
    for (const topicId of upgrade.requiresResearch) {
      // No research-completion state exists on GameState yet, so ANY listed topic
      // is by definition unmet. When Research lands, replace this with a real
      // "is topic completed?" check against the then-existing state field.
      return { ok: false, reason: `Requires research: ${topicId}` };
    }
  }

  // Prerequisite gate: other facilities' levels (cross-facility dependency chain).
  // EMPTY today (refinery is the only Phase 1 facility, nothing to depend on), so
  // no real upgrade triggers this, reserved gate, honored if ever populated.
  if (upgrade.requiresFacilityLevels) {
    for (const depKey of Object.keys(upgrade.requiresFacilityLevels)) {
      const need = upgrade.requiresFacilityLevels[depKey];
      if (facilityLevel(state, depKey) < need) {
        const depLabel = FACILITIES[depKey]?.label ?? depKey;
        return { ok: false, reason: `Requires ${depLabel} level ${need}` };
      }
    }
  }

  // Prerequisite gate: PLAY-COMPLETION counts (Mission Rework Task 6). EVERY listed
  // mission's lifetime completion count must be >= its threshold. Reads the SAME
  // state.lifetimeStats.missionsCompleted map the mission economy already increments
  // per completed cycle (tick.ts's tickCaptainMission); an absent key reads as 0
  // (grow-on-demand, matching the sparse-map contract). This is the gate that makes
  // the mission-control unlock track "earn it by playing". Mirrors the FA-level gate
  // above: first unmet mission names the reason (its label + have/need counts).
  if (upgrade.requiresMissionCompletions) {
    for (const mKey of Object.keys(upgrade.requiresMissionCompletions) as MissionKey[]) {
      const need = upgrade.requiresMissionCompletions[mKey]!;
      const have = state.lifetimeStats.missionsCompleted[mKey] ?? new Decimal(0);
      if (have.lt(need)) {
        return {
          ok: false,
          reason: `Requires ${need} ${MISSIONS[mKey].label} completions (have ${have.toString()})`,
        };
      }
    }
  }

  // Credits gate (Research Task R2). An OPTIONAL flat credit cost, checked just before
  // materials (both are "resource affordability" gates; the prereqs above come first).
  // INERT for every PRE-R2 facility, none set `upgrade.credits`, so `!== undefined`
  // is false and this never fires for them (no behavior change / no regression). The
  // Research Lab's level 1->2 rung is the first to use it (locked design #3: research
  // costs credits, not materials). Deducted atomically at start by startFacilityUpgrade.
  if (upgrade.credits !== undefined && state.credits.lt(upgrade.credits)) {
    return {
      ok: false,
      reason: `Need ${upgrade.credits.toString()} credits (have ${state.credits.toString()})`,
    };
  }

  // Material gate (checked LAST, see the ordering note on the function). EVERY
  // material entry must be affordable against the reservation-aware FREE pool, NOT
  // raw inventory (Shipyard Task S2, closes the KNOWN_ISSUES leak). `freeItemForState`
  // = inventory MINUS what active craft LINES have reserved (their not-yet-started
  // iterations' inputs). In-flight timed processes already had their inputs deducted
  // at start (design §4), so those units already left inventory, only the derived
  // craft-line reservation is subtracted here. Gating on `free` means a facility
  // upgrade can no longer spend ore/components a craft line is holding for a queued
  // iteration. Because free <= raw, this is a STRICT tightening: when nothing is
  // reserved, free == raw and this gate is byte-identical to the old raw check (no
  // behavior change / no regression). An absent inventory key reads as 0 via freeItem's
  // own defensive floor. The `have` surfaced in the reason is the FREE amount, so the
  // "Need X (have Y)" message reflects what the player can actually spend right now.
  for (const itemId of Object.keys(upgrade.materials)) {
    const need = upgrade.materials[itemId];
    const have = freeItemForState(state, itemId);
    if (have.lt(need)) {
      const itemLabel = ITEMS[itemId]?.label ?? itemId;
      return { ok: false, reason: `Need ${need.toString()} ${itemLabel} (have ${have.toString()})` };
    }
  }

  return { ok: true };
}

// The ACTION. Starts the next upgrade for a facility IF canBuildFacilityUpgrade
// approves it, by delegating to the Task 8 startProcess engine: materials are
// deducted ATOMICALLY at start, and a "facilityUpgrade" TimedProcess is pushed
// whose completion effect { type: "facilityLevelUp", facility } bumps the level by
// 1 (resolveProcesses applies it). Returns { next, started }, same shape/naming
// as startProcess. On any failed gate it is a same-reference no-op ({ next: state,
// started: false }), matching startProcess's own reject convention.
//
// CONCURRENCY (design §5, user 2026-07-11, refined 2026-07-11): UNLIMITED across
// DISTINCT facilities (a refinery upgrade and a future warehouse upgrade run at
// once) but STRICTLY SEQUENTIAL per facility, at most ONE in-flight upgrade for
// a given facility. That per-facility limit is enforced by canBuildFacilityUpgrade
// (the "Upgrade already in progress" gate), which this function inherits by calling
// it. The limit closes the rung-skip exploit: because a facility's level only bumps
// at COMPLETION, allowing two concurrent upgrades of the SAME facility would let a
// player start the cheap level 0->1 build twice and land at level 2, skipping the
// level 1->2 rung's higher cost + FA-level/talent gates. Requiring the in-flight
// rung to finish first makes each track pay every rung's real cost/gates in order.
// Refine JOBS are separately capped by slot count, not by this gate.
export function startFacilityUpgrade(
  state: GameState,
  facilityKey: string
): { next: GameState; started: boolean } {
  const check = canBuildFacilityUpgrade(state, facilityKey);
  if (!check.ok) {
    return { next: state, started: false };
  }

  // Safe: canBuildFacilityUpgrade.ok guarantees the facility exists and the rung
  // is in range (it would have returned a reason otherwise).
  const upgrade = FACILITIES[facilityKey].upgrades[facilityLevel(state, facilityKey)];
  // Credits deduct-at-start (Research Task R2). If this rung carries a credit cost,
  // subtract it from a fresh state clone BEFORE handing off to startProcess, so the
  // credit spend + the material deduct + the process push all land in the SAME
  // transition (atomic start, the design §4 posture materials already use). >= 0 is
  // guaranteed: canBuildFacilityUpgrade.ok proved state.credits >= upgrade.credits.
  // INERT for pre-R2 facilities (upgrade.credits === undefined -> afterCredits === state),
  // so their start path is byte-identical to before. Credits are deducted ONCE here (a
  // discrete start event), never per-tick, so this adds NO offline-catch-up parity seam.
  const afterCredits =
    upgrade.credits !== undefined
      ? { ...state, credits: state.credits.minus(upgrade.credits) }
      : state;
  return startProcess(afterCredits, "facilityUpgrade", upgrade.materials, upgrade.durationTicks, {
    type: "facilityLevelUp",
    facility: facilityKey,
  });
}

// ============================================================================
// Equipment storage upgrade (Equipment 0.11.0, Storage/Salvage Task B2)
// (docs/plans/2026-07-18-storage-salvage-0.11.0-design.md §1;
//  docs/plans/2026-07-18-0.11.0-completion-plan.md Task B2.)
//
// Raises the SPARE Ship Systems storage cap by ONE rung. MIRRORS the material-
// warehouse cap upgrade (a TIMED process that spends materials at start and bumps a
// stored LEVEL at completion), but drives the STANDALONE GameState.equipmentStorageLevel
// B1 chose over a facility, so it cannot reuse startFacilityUpgrade (that bumps
// facilities[key].level). It instead follows this file's own "process-driven action"
// convention (the SAME pair-of-functions shape startResearch / startFabricateJob /
// startShipBuild use): a pure predicate + an action that delegates to startProcess with
// the dedicated "equipmentStorageUpgrade" kind and the "equipmentStorageLevelUp" effect
// (resolveProcesses applies the +1). NO UI here (the X / max readout + the upgrade button
// are Task D2's Warehouse tab); this is the DATA + LOGIC only.
//
// The rung's cap MULTIPLIER is applied by equipmentStorageCap (model.ts) on read, NOT
// here, so the cap stays COMPUTED from the level and can never drift (the B1/B2 anti-
// drift invariant).
// ============================================================================

// PURE predicate: could the player start the NEXT equipment-storage upgrade RIGHT NOW?
// `ok: true` means startEquipmentStorageUpgrade would succeed; `ok: false` carries a
// `reason` naming the FIRST failing gate. Gate order mirrors canBuildFacilityUpgrade:
// cheap structural gates (track maxed / an upgrade already in flight) first, then the
// material affordability gate LAST (the gate most likely to be transiently unmet).
export function canUpgradeEquipmentStorage(state: GameState): { ok: boolean; reason?: string } {
  const level = state.equipmentStorageLevel ?? 0; // defensive ?? 0, same as equipmentStorageCap
  const rung = EQUIPMENT_STORAGE_RUNGS[level]; // the NEXT rung (undefined = fully upgraded)
  // Track maxed: no rung defined past the current level, so the cap cannot climb further.
  if (!rung) {
    return { ok: false, reason: "Equipment storage is fully upgraded" };
  }

  // SEQUENTIAL gate: at most ONE equipment-storage upgrade in flight at a time. This is
  // the equipment-storage twin of canBuildFacilityUpgrade's "Upgrade already in progress"
  // gate, and it closes the SAME rung-skip exploit: because the level only bumps at
  // process COMPLETION, EQUIPMENT_STORAGE_RUNGS[level] stays the SAME (cheaper) rung while
  // an upgrade is mid-flight, so without this gate a player could start the cheap rung 0
  // twice and land at level 2, skipping rung 1's higher cost. Keyed on the effect type
  // (not a facility id, since this is not a facility), so a facility upgrade in flight
  // never matches here and vice versa.
  const upgradeInFlight = state.activeProcesses.some(
    (p) => p.effect.type === "equipmentStorageLevelUp"
  );
  if (upgradeInFlight) {
    return { ok: false, reason: "Upgrade already in progress" };
  }

  // Material gate (LAST): every material must be affordable against the reservation-aware
  // FREE pool (inventory MINUS what active craft lines have reserved), the SAME
  // freeItemForState gate canBuildFacilityUpgrade uses so an upgrade can never spend
  // ore/ingots a craft line is holding. An absent inventory key reads as 0 via freeItem's
  // own floor. The surfaced `have` is the FREE amount, so "Need X (have Y)" reflects what
  // the player can actually spend right now.
  for (const itemId of Object.keys(rung.materials)) {
    const need = rung.materials[itemId];
    const have = freeItemForState(state, itemId);
    if (have.lt(need)) {
      const itemLabel = ITEMS[itemId]?.label ?? itemId;
      return { ok: false, reason: `Need ${need.toString()} ${itemLabel} (have ${have.toString()})` };
    }
  }

  return { ok: true };
}

// The ACTION. Starts the next equipment-storage upgrade IF canUpgradeEquipmentStorage
// approves it, by delegating to startProcess: the rung's materials are deducted
// ATOMICALLY at start and an "equipmentStorageUpgrade" TimedProcess is pushed whose
// completion effect { type: "equipmentStorageLevelUp" } bumps the level by 1
// (resolveProcesses applies it). Returns { next, started }, the SAME shape/naming
// startFacilityUpgrade uses. On any failed gate it is a same-reference no-op
// ({ next: state, started: false }), matching startProcess's own reject convention.
export function startEquipmentStorageUpgrade(state: GameState): { next: GameState; started: boolean } {
  const check = canUpgradeEquipmentStorage(state);
  if (!check.ok) {
    return { next: state, started: false };
  }
  // Safe: canUpgradeEquipmentStorage.ok guarantees the rung is in range (it returns a
  // reason otherwise). No credits gate (unlike a facility rung); equipment storage is
  // priced purely in materials this pass.
  const rung = EQUIPMENT_STORAGE_RUNGS[state.equipmentStorageLevel ?? 0];
  return startProcess(state, "equipmentStorageUpgrade", rung.materials, rung.durationTicks, {
    type: "equipmentStorageLevelUp",
  });
}

// ============================================================================
// Docks capacity upgrade (Fleet Management): raise the max ships at the docks.
//
// Raises GameState.shipStorageCapacity (base 8) by ONE rung. MIRRORS the equipment
// Systems-Bay upgrade (a TIMED process that spends at start and bumps a stored value
// at completion), following this file's own "process-driven action" convention (the
// SAME pair-of-functions shape startEquipmentStorageUpgrade / startFacilityUpgrade
// use): a pure predicate + an action that delegates to startProcess with the
// dedicated "docksExpansion" kind and the "docksCapacityUp" effect (resolveProcesses
// applies the +1).
//
// DELIBERATE DIVERGENCE from the equipment track: equipment stores a LEVEL and
// DERIVES its cap. The docks cap has no such indirection, shipStorageCapacity IS the
// single source (canStartShipBuild reads it directly), so the current rung INDEX is
// DERIVED from the field (shipStorageCapacity - SHIP_DOCKS_BASE) and the completion
// effect mutates that field in place. No separate level field, so no drift is possible.
// ============================================================================

// PURE predicate: could the player start the NEXT docks expansion RIGHT NOW? `ok:
// true` means startDocksExpansion would succeed; `ok: false` carries a `reason`
// naming the FIRST failing gate. Gate order mirrors canUpgradeEquipmentStorage /
// canBuildFacilityUpgrade: cheap structural gates (track maxed / an expansion already
// in flight) first, then credits, then the material affordability gate LAST.
export function canUpgradeDocks(state: GameState): { ok: boolean; reason?: string } {
  // Current rung INDEX derived from the single-source field: capacity 8 = rung 0,
  // capacity 9 = rung 1, etc. A hand-edited save below the base floors at 0 (never
  // negative), matching the defensive posture the rest of the file uses.
  const rungIndex = Math.max(0, state.shipStorageCapacity - SHIP_DOCKS_BASE);
  const rung = SHIP_DOCKS_RUNGS[rungIndex]; // the NEXT rung (undefined = fully expanded)
  // Track maxed: no rung defined past the current capacity, so it cannot climb further.
  if (!rung) {
    return { ok: false, reason: "Docks are fully expanded" };
  }

  // SEQUENTIAL gate: at most ONE docks expansion in flight at a time. This is the
  // docks twin of canUpgradeEquipmentStorage's "Upgrade already in progress" gate, and
  // it closes the SAME rung-skip exploit: because shipStorageCapacity only bumps at
  // process COMPLETION, SHIP_DOCKS_RUNGS[rungIndex] stays the SAME (cheaper) rung while
  // an expansion is mid-flight, so without this gate a player could start the cheap
  // rung 0 twice and land at capacity 10, skipping rung 1's higher cost. Keyed on the
  // effect type, so a facility / equipment upgrade in flight never matches here.
  const upgradeInFlight = state.activeProcesses.some((p) => p.effect.type === "docksCapacityUp");
  if (upgradeInFlight) {
    return { ok: false, reason: "Expansion already in progress" };
  }

  // Credits gate (before materials, both are affordability gates). Deducted atomically
  // at start by startDocksExpansion.
  if (state.credits.lt(rung.credits)) {
    return {
      ok: false,
      reason: `Need ${rung.credits.toString()} credits (have ${state.credits.toString()})`,
    };
  }

  // Material gate (LAST): every material must be affordable against the reservation-
  // aware FREE pool (inventory MINUS what active craft lines have reserved), the SAME
  // freeItemForState gate the facility / equipment upgrades use, so an expansion can
  // never spend components a craft line is holding. An absent inventory key reads as 0
  // via freeItem's own floor. The surfaced `have` is the FREE amount.
  for (const itemId of Object.keys(rung.materials)) {
    const need = rung.materials[itemId];
    const have = freeItemForState(state, itemId);
    if (have.lt(need)) {
      const itemLabel = ITEMS[itemId]?.label ?? itemId;
      return { ok: false, reason: `Need ${need.toString()} ${itemLabel} (have ${have.toString()})` };
    }
  }

  return { ok: true };
}

// The ACTION. Starts the next docks expansion IF canUpgradeDocks approves it, by
// delegating to startProcess: the rung's credits are deducted from a fresh state clone
// FIRST (so the credit spend + the material deduct + the process push land in the SAME
// atomic transition, the posture startFacilityUpgrade uses for its credit rungs), then
// a "docksExpansion" TimedProcess is pushed whose completion effect
// { type: "docksCapacityUp" } bumps shipStorageCapacity by 1 (resolveProcesses applies
// it). Returns { next, started }, the SAME shape/naming startFacilityUpgrade uses. On
// any failed gate it is a same-reference no-op ({ next: state, started: false }).
export function startDocksExpansion(state: GameState): { next: GameState; started: boolean } {
  const check = canUpgradeDocks(state);
  if (!check.ok) {
    return { next: state, started: false };
  }
  // Safe: canUpgradeDocks.ok guarantees the rung is in range AND credits >= rung.credits
  // (it returns a reason otherwise), so the derived index + the credit subtraction below
  // are both in-bounds.
  const rungIndex = Math.max(0, state.shipStorageCapacity - SHIP_DOCKS_BASE);
  const rung = SHIP_DOCKS_RUNGS[rungIndex];
  const afterCredits = { ...state, credits: state.credits.minus(rung.credits) };
  return startProcess(afterCredits, "docksExpansion", rung.materials, rung.durationTicks, {
    type: "docksCapacityUp",
  });
}

// ============================================================================
// Refinery, single refine jobs (Phase 1, Task 11)
// (docs/plans/2026-07-11-facility-framework-refinery-design.md §6).
//
// Two functions, both built on the Task 8 startProcess engine + the Task 10
// FACILITIES table:
//   - refineSlotCount : how many parallel refine jobs the refinery can run RIGHT
//                       NOW, derived (not stored) by summing the `addRefineSlots`
//                       grants across every upgrade LEVEL the facility has reached.
//   - startRefineJob  : start ONE manual refine job if a slot is free AND the
//                       recipe inputs are affordable; else a same-ref no-op.
// ============================================================================

// Slot count = the sum of every `addRefineSlots` grant on the upgrade rungs the
// refinery has ALREADY reached. upgrades[i] is the rung that took the facility to
// level i+1, so a facility at level L has "banked" the effects of upgrades[0..L-1]
//, hence the loop runs `i < level`. Level 0 (unbuilt) sums nothing -> 0 slots;
// the 0->1 build (upgrades[0], addRefineSlots:1) yields the first slot; each of
// the 1->2 / 2->3 rungs adds another; the 3->4 rung is a refineSpeedMult (NOT a
// slot), so it contributes 0 here and level 4 still reports 3 slots.
//
// Derived-on-read (the SAME populated-but-inert pattern SHIP_TYPES.moduleSlots
// uses) rather than caching a slot total on FacilityState: the upgrade track is
// the single source of truth, so retuning an `addRefineSlots` value or appending a
// rung changes the slot count with no extra bookkeeping and no migration.
//
// FacilityUpgradeEffect is a NON-discriminated union ({ addRefineSlots } |
// { refineSpeedMult }), distinguished by property presence, so we narrow with
// `"addRefineSlots" in effect` (there is no `type` tag to switch on). The `i <
// upgrades.length` guard is belt-and-suspenders: today no facility can exceed its
// track length, but it keeps a hypothetical over-level read from indexing past the
// finite array.
export function refineSlotCount(state: GameState): number {
  const level = facilityLevel(state, "refinery");
  const upgrades = FACILITIES.refinery.upgrades;
  let slots = 0;
  for (let i = 0; i < level && i < upgrades.length; i++) {
    const effect = upgrades[i].effect;
    if ("addRefineSlots" in effect) {
      slots += effect.addRefineSlots;
    }
  }
  return slots;
}

// Research SLOT count (Research Task R2), how many concurrent research projects the
// Research Lab can run RIGHT NOW. Derived (not stored) by SUMMING every { addResearchSlots }
// grant on the rungs the lab has ALREADY reached, the EXACT same reached-rungs loop
// refineSlotCount uses for the refinery, just reading the `research` facility + the
// `addResearchSlots` property. A fresh save seeds research at level 1, whose founding
// rung (upgrades[0]) grants addResearchSlots:1 -> 1 slot; the level 1->2 rung adds a 2nd.
// Level 0 / an absent facility sums nothing -> 0 (the defensive floor, though freshState
// always seeds level 1). The `i < upgrades.length` guard is the same belt-and-suspenders
// bound refineSlotCount carries. Consumed by R3's startResearch (concurrency cap) + the
// R5 Overview panel; nothing reads it before R3.
export function researchSlotCount(state: GameState): number {
  const level = facilityLevel(state, RESEARCH_FACILITY_KEY);
  const upgrades = FACILITIES[RESEARCH_FACILITY_KEY].upgrades;
  let slots = 0;
  for (let i = 0; i < level && i < upgrades.length; i++) {
    const effect = upgrades[i].effect;
    if ("addResearchSlots" in effect) {
      slots += effect.addResearchSlots;
    }
  }
  return slots;
}

// Fabricate SLOT count (Fabricator Task F1), how many concurrent craft jobs the
// Fabricator can run RIGHT NOW. A LINE-FOR-LINE clone of researchSlotCount, swapping
// only the facility key + the effect field: SUM every { addFabricateSlots } grant on
// the rungs the fabricator has ALREADY reached, the EXACT same reached-rungs loop
// refineSlotCount / researchSlotCount use. A fresh save seeds fabricator at level 1,
// whose founding rung (upgrades[0]) grants addFabricateSlots:1 -> 1 slot; the level
// 1->2 rung adds a 2nd. Level 0 / an absent facility sums nothing -> 0 (the defensive
// floor). The `i < upgrades.length` guard is the same belt-and-suspenders bound the
// siblings carry. Consumed by F2's startFabricateJob (concurrency cap) + the F4 panel.
export function fabricateSlotCount(state: GameState): number {
  const level = facilityLevel(state, FABRICATOR_FACILITY_KEY);
  const upgrades = FACILITIES[FABRICATOR_FACILITY_KEY].upgrades;
  let slots = 0;
  for (let i = 0; i < level && i < upgrades.length; i++) {
    const effect = upgrades[i].effect;
    if ("addFabricateSlots" in effect) {
      slots += effect.addFabricateSlots;
    }
  }
  return slots;
}

// Shipyard BAY COUNT (Combat 0.13.0, Phase 11b, design S13 item 4), how many SHARED
// build/repair bays the Shipyard has RIGHT NOW. Bays serve BOTH ship builds and ship repairs
// out of one pool (Section 3 below), so this is the single source of truth both the build
// slot cap (shipBuildSlotCount) and the repair auto-start pass (processShipRepairs) read.
//
// DERIVE-ON-READ, mirroring shipBuildSpeedMult's loop EXACTLY (same `i < level && i <
// upgrades.length` reached-rungs scan over FACILITIES.shipyard): a SHIPYARD_BAY_BASE floor
// plus +1 per reached BUILD-SPEED upgrade rung (the rungs carrying `buildSpeedMult`; the
// founding rung [0] carries none, so founding the yard does NOT add a bay, it just unlocks
// BUILDING in the base bays that already existed for repair). With the current track:
//   level 0 (unfounded) -> 2 bays   (the invariant floor, see below)
//   level 1 (founded)    -> 2 bays   (baseline; founding adds no bay)
//   level 2              -> 3 bays   (+1 from the 1.5x speed rung)
//   level 3 (max)        -> 4 bays   (+1 more from the 2.0x speed rung)
// ⚠️ Base + scaling are FIRST-PASS TUNABLE (report for owner review; real balance at S20).
//
// ⚠️ SOFT-LOCK INVARIANT ENFORCEMENT (this replaces P11's warning comment with the actual
// guarantee): this ALWAYS returns >= SHIPYARD_BAY_BASE (2) at EVERY level, including 0. That
// floor of >= 2, combined with shipBuildSlotCount capping builds at bayCount - 1 (below) and
// repairs claiming any free bay (processShipRepairs), STRUCTURALLY guarantees >= 1 bay is
// always reachable by a damaged hull, so no reachable state strands a wreck (model.ts's
// SHIPYARD_BAY_BASE block details the (a)+(b)+(c) proof).
export function shipyardBayCount(state: GameState): number {
  const level = facilityLevel(state, SHIPYARD_FACILITY_KEY);
  const upgrades = FACILITIES[SHIPYARD_FACILITY_KEY].upgrades;
  // Start at the base floor (never below it -> the soft-lock invariant's structural >= 2).
  let bays = SHIPYARD_BAY_BASE;
  for (let i = 0; i < level && i < upgrades.length; i++) {
    // Reuse the SAME rungs shipBuildSpeedMult reads: each reached build-speed rung also adds
    // a bay. The founding rung carries no buildSpeedMult, so it is skipped here (no bay for
    // founding). The `i < upgrades.length` guard is the sibling helpers' belt-and-suspenders.
    // `const effect` extracted first to mirror shipBuildSpeedMult's loop body exactly.
    const effect = upgrades[i].effect;
    if ("buildSpeedMult" in effect) {
      bays += 1; // FIRST-PASS TUNABLE: +1 bay per build-speed upgrade rung
    }
  }
  return bays;
}

// Ship-build SLOT count (Shipyard Task S1 / Phase 11b), how many concurrent ship builds the
// Shipyard may run RIGHT NOW. Effectively 1 this pass (the Shipyard builds ONE ship at a
// time, locked brainstorm decision #2), but now expressed as the REPAIR-FAVORED RESERVATION
// arithmetic instead of a bare `return 1`:
//
//   min(BUILD_CONCURRENCY_CAP, shipyardBayCount(state) - 1)
//
// The `- 1` is design S13's "builds use all-but-one bay": a build may occupy at most
// bayCount - 1 bays so >= 1 bay is ALWAYS left free for repair (the soft-lock invariant's
// clause (b)). BUILD_CONCURRENCY_CAP is DELIBERATELY HELD AT 1 (owner directive, anti-
// regression): multi-ship building stays OFF this pass. With cap 1 and bayCount >= 2, this is
// min(1, >= 1) = 1, BYTE-IDENTICAL to the old `return 1`, so every existing shipBuild gate/
// test is unchanged. Expressing it as the min() (not a literal 1) means the reservation still
// holds if EITHER number later changes: raise BUILD_CONCURRENCY_CAP to enable multi-build and
// builds automatically flex up to bayCount - 1, never stealing repair's last bay. That
// multi-build toggle is the SEPARATE future decision the owner will make; the seam is here.
export function shipBuildSlotCount(state: GameState): number {
  const bays = shipyardBayCount(state);
  // Repair-favored reservation: leave >= 1 bay for repair (all-but-one). Math.max(0, ...) is
  // a defensive floor (never negative) though bayCount >= 2 already keeps bays - 1 >= 1.
  const buildableBays = Math.max(0, bays - 1);
  return Math.min(BUILD_CONCURRENCY_CAP, buildableBays);
}

// ============================================================================
// Shipyard build engine, Phase 5, Task S3
// (docs/plans/2026-07-16-shipyard-plan.md §S3, design §5). Three functions built on
// the shared startProcess/resolveProcesses engine + the S1 buildRecipe/facility data
// + the S2 freeItemForState reservation-aware pool:
//   - shipBuildDurationTicks : a hull's build time, SCALED FASTER by the Shipyard's
//                              build-speed upgrade track.
//   - canBuildShip           : the single typed-reason gate (mirrors canFabricate).
//   - startShipBuild         : the action, deduct BOM + credits at start, push a
//                              "shipBuild" TimedProcess (mirrors startFacilityUpgrade).
// ============================================================================

// The Shipyard's effective build-SPEED multiplier = the PRODUCT of every { buildSpeedMult }
// grant on the upgrade rungs the shipyard has ALREADY reached. This is the MULTIPLIED
// analog of refineSlotCount's SUMMED reached-rungs loop (a speed track multiplies; a slot
// track adds), the SAME derive-on-read/single-source-of-truth pattern, reading the
// `shipyard` facility + the `buildSpeedMult` property. The founding rung [0] carries an
// inert `unlocksContent` marker (no buildSpeedMult), so a level-1 (just-founded) shipyard
// reaches ZERO speed rungs -> the empty product 1.0 (baseline speed). Each later rung
// (1.5x, 2.0x) stacks multiplicatively (level 3 -> 1.5 * 2.0 = 3.0x). Level 0 (unfounded)
// also yields 1.0 (the loop runs `i < level` = 0 iterations), but a build cannot START
// at level 0 anyway (canBuildShip's `notFounded` gate), so that value is never consumed.
// The `i < upgrades.length` guard is the same belt-and-suspenders bound the sibling
// derive-on-read helpers carry.
export function shipBuildSpeedMult(state: GameState): number {
  const level = facilityLevel(state, SHIPYARD_FACILITY_KEY);
  const upgrades = FACILITIES[SHIPYARD_FACILITY_KEY].upgrades;
  let mult = 1;
  for (let i = 0; i < level && i < upgrades.length; i++) {
    const effect = upgrades[i].effect;
    if ("buildSpeedMult" in effect) {
      mult *= effect.buildSpeedMult;
    }
  }
  return mult;
}

// A hull's effective build time RIGHT NOW = its base buildRecipe.durationTicks DIVIDED by
// the Shipyard's build-speed multiplier (higher mult -> shorter build). At a just-founded
// shipyard (level 1, no speed rungs reached) the mult is 1.0, so this returns the base
// durationTicks unchanged; each build-speed upgrade cuts it further. The result may be
// FRACTIONAL (e.g. 300 / 1.5 = 200 here, but a future non-integer mult could yield 133.3)
//, that is PARITY-SAFE: durationTicks is FIXED once at process creation (startShipBuild
// below) and resolveProcesses decrements the countdown by whole ticks, so one big offline
// resolve and many small live steps cross zero at the identical point regardless of whether
// the duration is integer (the closed-form countdown property, see resolveProcesses).
export function shipBuildDurationTicks(state: GameState, typeKey: ShipTypeKey): number {
  return SHIP_TYPES[typeKey].buildRecipe.durationTicks / shipBuildSpeedMult(state);
}

// Shipyard Task S3: the typed reason canBuildShip returns when a ship build is BLOCKED.
// A string union (mirrors FabricateBlockReason / ResearchBlockReason) so it serializes/logs
// as a readable token and the S5 Shipyard UI can switch on it exhaustively to render each
// hull's disabled Build button with its cause. Member order mirrors canBuildShip's gate order:
//   notFound     , no SHIP_TYPES entry for that key (bad caller / stale UI reference)
//   notFounded   , the shipyard is still LOCKED (facilityLevel < 1); found it first
//   notResearched, the hull's requiresBlueprint is not in researchedBlueprints (research it
//                    first). CONTENT-AVAILABILITY gate: a hull with no requiresBlueprint (every
//                    economy hull + the destroyer) skips it. Combat 0.13.0 warship research gate.
//   noSlot       , the single build slot is busy (a shipBuild already in activeProcesses)
//   storageFull  , the ship store is at shipStorageCapacity (park/scrap a hull first)
//   materials    , some component BOM entry exceeds the reservation-aware FREE pool (S2)
//   credits      , state.credits < the recipe's credit cost
export type ShipBuildBlockReason =
  | "notFound"
  | "notFounded"
  | "notResearched"
  | "noSlot"
  | "storageFull"
  | "materials"
  | "credits";

// THE single consolidated ship-build gate. PURE predicate, reads state + the static
// SHIP_TYPES table + the derived shipBuildSlotCount + the S2 freeItemForState, mutates
// nothing, spends nothing. The ONE source of truth for "can this hull be built right now?",
// MIRRORING canFabricate. startShipBuild (below) calls this first and does nothing else
// gate-wise; the S5 UI calls it directly to render each hull's Build button.
//
// GATE ORDER is deliberate, cheapest/most-fundamental first, and determines WHICH reason
// surfaces when several fail at once (ok itself is order-independent, all must pass):
// identity (notFound) -> facility founded (notFounded) -> content availability (notResearched)
// -> concurrency (noSlot) -> storage (storageFull) -> resource:materials -> resource:credits.
// The research gate is a CONTENT-AVAILABILITY check (does this build content exist for the
// player yet), placed right after `notFounded` and before the concurrency/resource gates so
// "you have not unlocked this hull" reads before "the yard is busy" or "you cannot afford it".
// The storage gate sits at START (here) so a build never begins that could not be parked on
// completion, resolveProcesses can then park unconditionally (see its addShip branch).
export function canBuildShip(
  state: GameState,
  typeKey: string
): { ok: true } | { ok: false; reason: ShipBuildBlockReason } {
  // --- Identity: the key must name a real hull. An absent def means "not a real ship type"
  // (bad caller / stale UI reference), checked first so every later gate can read `def`.
  const def = SHIP_TYPES[typeKey as ShipTypeKey];
  if (!def) return { ok: false, reason: "notFound" };

  // --- Founded: the Shipyard must have been established (level >= 1). Level 0 is LOCKED --
  // the founding rung (canBuildFacilityUpgrade / startFacilityUpgrade) is the unlock. This
  // is SEPARATE from the slot cap (shipBuildSlotCount returns 1 even at level 0): whether a
  // build may start AT ALL is this gate; how many may run at once is the slot cap.
  if (facilityLevel(state, SHIPYARD_FACILITY_KEY) < 1) return { ok: false, reason: "notFounded" };

  // --- Content availability (Combat 0.13.0 warship research gate): a hull may carry an
  // OPTIONAL requiresBlueprint naming the unlock-only blueprint that must be researched before
  // it can be built. When PRESENT and NOT yet in researchedBlueprints, the hull is locked ->
  // notResearched. When ABSENT (every economy hull + the destroyer, the combat line's free entry
  // tier), this gate is SKIPPED entirely, so ungated hulls behave EXACTLY as before (no
  // behavior change for the free hulls). Reuses the SAME blueprintUnlocked membership test the
  // Research/Fabricator gates read, so "researched" means one thing across the whole app.
  if (def.requiresBlueprint !== undefined && !blueprintUnlocked(state, def.requiresBlueprint)) {
    return { ok: false, reason: "notResearched" };
  }

  // --- Concurrency: a free build slot, count in-flight shipBuilds against the cap (1 this
  // pass). At the cap, no new build starts. The EXACT slot accounting canFabricate uses.
  const activeShipBuilds = state.activeProcesses.filter((p) => p.kind === "shipBuild").length;
  if (activeShipBuilds >= shipBuildSlotCount(state)) return { ok: false, reason: "noSlot" };

  // --- Storage: the fleet must have room for the finished hull. Gated HERE at start (not at
  // completion) so a build never begins that could not be parked, resolveProcesses parks
  // unconditionally on the strength of this gate. AT capacity counts as full.
  if (state.ships.length >= state.shipStorageCapacity) return { ok: false, reason: "storageFull" };

  // --- Resource (materials): every component in the BOM must be affordable against the
  // reservation-aware FREE pool (S2's freeItemForState = inventory MINUS what active craft
  // LINES reserve), NOT raw inventory, so a build cannot spend a component a craft line is
  // holding for a queued iteration. (A ship build itself creates NO ongoing reservation: its
  // whole BOM is deducted at START, so freeItemForState never counts an in-flight build.)
  // Any single short component blocks the whole build.
  const recipe = def.buildRecipe;
  for (const itemId of Object.keys(recipe.components)) {
    const have = freeItemForState(state, itemId);
    if (have.lt(recipe.components[itemId])) return { ok: false, reason: "materials" };
  }

  // --- Resource (credits): the flat credit cost, checked LAST (after materials, mirroring
  // canFabricate's materials-before-storage nuance / the facility-upgrade credits gate).
  if (state.credits.lt(recipe.credits)) return { ok: false, reason: "credits" };

  return { ok: true };
}

// The ACTION. Starts ONE ship build for `typeKey` IF canBuildShip approves it. DEDUCT-AT-
// START, ATOMIC: a ship build consumes its WHOLE component BOM + credits IMMEDIATELY at
// start (it does NOT reserve materials over time the way a craft line does), so there is
// NO ongoing reservation for freeItemForState to count. The BOM is deducted by startProcess
// (its atomic inventory consume); the credits are subtracted from a fresh state clone BEFORE
// the handoff so the credit spend + the material deduct + the process push all land in the
// SAME transition, the identical pattern startFacilityUpgrade uses for its credit rungs.
//
// Returns the START family's { next, started } shape PLUS an OPTIONAL `reason` (undefined on
// success), EXACTLY as startFabricateJob exposes canFabricate's reason. On any blocked gate
// it is a same-reference no-op ({ next: state, started: false, reason }), the reject
// convention every other start/action in this file shares.
export function startShipBuild(
  state: GameState,
  typeKey: string
): { next: GameState; started: boolean; reason?: ShipBuildBlockReason } {
  // The single consolidated gate. On a block: same-ref no-op + the reason, so a blocked
  // start can never be mistaken for a no-op change.
  const gate = canBuildShip(state, typeKey);
  if (!gate.ok) return { next: state, started: false, reason: gate.reason };

  // gate.ok GUARANTEES a real, founded, slot-available, storage-roomed, affordable build, so
  // the def lookup + cast below cannot fail (recomputed here rather than threaded out of
  // canBuildShip, to keep canBuildShip a clean predicate).
  const shipTypeKey = typeKey as ShipTypeKey;
  const recipe = SHIP_TYPES[shipTypeKey].buildRecipe;

  // Credits deduct-at-start: subtract from a fresh state clone BEFORE startProcess, so the
  // credit spend rides the SAME atomic transition as the material deduct + process push.
  // >= 0 is guaranteed by gate.ok (canBuildShip proved credits >= recipe.credits).
  const afterCredits = { ...state, credits: state.credits.minus(recipe.credits) };

  // Build the Decimal BOM inputs from the recipe's plain-number component counts (wrapped at
  // the deduct site exactly as fabricate/fuel/research constants are). startProcess applies
  // the FINAL affordability gate against RAW inventory + atomically deducts + pushes the
  // "shipBuild" TimedProcess whose completion effect { type: "addShip", typeKey } mints the
  // hull (resolveProcesses). Because canBuildShip gated on FREE (<= raw), the raw gate here
  // cannot reject.
  const inputs: Record<string, Decimal> = {};
  for (const itemId of Object.keys(recipe.components)) {
    inputs[itemId] = new Decimal(recipe.components[itemId]);
  }

  return startProcess(afterCredits, "shipBuild", inputs, shipBuildDurationTicks(state, shipTypeKey), {
    type: "addShip",
    typeKey: shipTypeKey,
  });
}

// ============================================================================
// Ship repair engine (Combat 0.13.0, Phase 11 + 11b, design S13)
//
// The LOSS -> REPAIR half of the combat loop. A patrol defeat limps the hull home
// (tickCaptainPatrol) and economyTick flags it damaged + stamps repairDamage; this engine
// then auto-routes the wreck into a Shipyard repair bay and fixes it over TIME:
//   - shipRepairDurationTicks : a hull's repair time, scaled by the damage it took.
//   - processShipRepairs      : the AUTO-START pass (mirrors processFuelPipelines) that
//                               starts a shipRepair TimedProcess for each damaged hull as a
//                               repair bay frees, in a deterministic order.
// A completing shipRepair clears the damage (resolveProcesses' clearShipDamage branch), so
// the whole loop rides the SHARED startProcess/resolveProcesses engine, closed-form and
// offline==live exactly like shipBuild. Repair is priced in TIME only (no materials/credits
// this pass, a first-pass simplification; a materials cost is a forward tuning hook).
//
// P11b (design S13 item 4): builds and repairs now SHARE the Shipyard's bay pool
// (shipyardBayCount). This pass claims any FREE bay for repair (free = bayCount - active
// builds - active repairs), so idle build capacity flexes into repair, while the build side
// (shipBuildSlotCount) reserves >= 1 bay for repair by capping builds at bayCount - 1. Excess
// damaged hulls beyond the free bays WAIT in the deterministic monotonic-ship-id queue and
// claim a bay as one frees. The soft-lock invariant (a damaged hull always eventually gets a
// bay) is STRUCTURALLY enforced by that base-floor + reservation (see model.ts's
// SHIPYARD_BAY_BASE block and shipyardBayCount for the (a)+(b)+(c) proof).
// ============================================================================

// A hull's repair time RIGHT NOW = the deterministic first-pass formula (model.ts):
//   REPAIR_BASE_TICKS + ceil(repairDamage * REPAIR_TICKS_PER_HULL)
// FIXED at process creation (like shipBuildDurationTicks), so a repair job is closed-form:
// resolveProcesses decrements the countdown by whole ticks and one big offline resolve
// crosses zero at the identical point as many small live steps. `repairDamage` is the hull
// points the ship lost (captured at the defeat instant); a defensive fallback to the hull's
// full integrity keeps a `damaged` ship with no capture (a hand-edited save) repairable.
// PURE: reads the ship + the static SHIP_TYPES table, mutates nothing.
export function shipRepairDurationTicks(ship: ShipInstance): number {
  const shipDef = SHIP_TYPES[ship.typeKey];
  const damage = ship.repairDamage ?? shipDef.hullIntegrity;
  return REPAIR_BASE_TICKS + Math.ceil(damage * REPAIR_TICKS_PER_HULL);
}

// The AUTO-START pass. For each DAMAGED hull not already in a repair bay, start a shipRepair
// TimedProcess while a bay is FREE, in the ships array's STABLE order (monotonic ship-id
// insertion order) so which damaged hull claims a freeing bay is DETERMINISTIC, the implicit
// repair queue (now spanning the shared bays: multiple hulls repair CONCURRENTLY up to the
// free-bay count, and the excess wait in this same monotonic order). MIRRORS
// processFuelPipelines exactly (same free-capacity accounting + same-reference no-op posture),
// and like it lives INSIDE economyTick so it runs identically live (App.svelte per bar) and
// offline (tick() steps economyTick(_,1) per tick), the one-seam offline==live guarantee.
// A repair started here begins advancing on the NEXT economyTick (its countdown untouched by
// the resolveProcesses that already ran above), exactly as a fuel batch started this tick does.
export function processShipRepairs(state: GameState): GameState {
  // No damaged hull anywhere -> same-reference no-op (cheap early-out, like
  // processFuelPipelines' no-pipeline guard). The overwhelmingly common case.
  if (!state.ships.some((s) => s.damaged)) return state;

  // Total shared bays RIGHT NOW (shipyard-level-derived). Constant across this pass (facility
  // level does not change mid-tick), so read once. Active BUILDS occupy bays too (shared pool);
  // this pass only ever STARTS repairs, never builds, so the build count is ALSO loop-invariant
  // and is hoisted here alongside bayCount. Repair's free capacity is bayCount minus these
  // builds AND the repairs already running (the latter is the only per-iteration term).
  const bayCount = shipyardBayCount(state);
  const activeBuilds = state.activeProcesses.filter((p) => p.kind === "shipBuild").length;

  let working = state; // threaded immutably as each startProcess returns fresh state
  for (const ship of state.ships) {
    if (!ship.damaged) continue; // healthy hull, nothing to do

    // Already in a bay? A shipRepair process targeting THIS ship (its clearShipDamage effect
    // carries the id) means the hull is mid-repair, do not double-start it.
    const alreadyRepairing = working.activeProcesses.some(
      (p) => p.kind === "shipRepair" && p.effect.type === "clearShipDamage" && p.effect.shipId === ship.id,
    );
    if (alreadyRepairing) continue;

    // A FREE shared bay must exist. free = bayCount - active builds - active repairs. Only the
    // REPAIR count is recomputed here: each iteration may have started a repair (which consumes
    // a bay), while builds are loop-invariant (hoisted above). Repairs claim ANY free bay, so
    // idle build capacity flexes into repair; builds are separately capped at bayCount - 1
    // (shipBuildSlotCount) so a build can NEVER take the last bay a repair would need. At 0 free
    // bays the remaining damaged hulls WAIT (stay damaged + un-started) until a bay frees on a
    // future tick, the deterministic queue. The build cap (builds <= bayCount - 1) guarantees
    // >= 1 free bay whenever no repair is running, so a damaged hull is never permanently
    // stranded (the enforced soft-lock invariant).
    const activeRepairs = working.activeProcesses.filter((p) => p.kind === "shipRepair").length;
    const freeBays = bayCount - activeBuilds - activeRepairs;
    if (freeBays <= 0) break; // every shared bay busy -> stop, the rest wait in id order

    // Gates pass -> start ONE repair via the SHARED startProcess engine. Repair takes NO
    // material/credit inputs this pass (priced in time only), so the inputs map is empty:
    // startProcess's affordability gate is vacuously satisfied and it just pushes the
    // "shipRepair" TimedProcess whose completion effect { clearShipDamage } lowers the ship's
    // damaged flag (resolveProcesses). The duration is FIXED here from the captured damage.
    const { next, started } = startProcess(working, "shipRepair", {}, shipRepairDurationTicks(ship), {
      type: "clearShipDamage",
      shipId: ship.id,
    });
    if (!started) break; // defensive: empty inputs never reject, so this only guards a future gated repair
    // ⚠️ QUEUE-JUMP POLICY (decide deliberately WHEN repair gains a cost): today `break` is
    // pure plumbing, mirrored from processFuelPipelines where it is safe because every fuel
    // batch is IDENTICAL (a failed start means no batch can start, so stopping loses nothing).
    // Repairs are HETEROGENEOUS (per-ship duration, and a forward-hooked per-ship materials/
    // credits cost). Once a repair can FAIL to start for lack of resources, `break` vs
    // `continue` here becomes a real policy choice: `break` = strict FIFO head-of-line
    // blocking (an unaffordable queue head stalls every ship behind it); `continue` = skip the
    // unaffordable ship to serve a cheaper one behind it. Neither is obviously right, pick it
    // consciously when the repair cost lands (a future tuning pass), do not let this defensive
    // `break` decide it by accident. No behavior change now (empty inputs make `started` true).
    working = next;
  }
  return working;
}

// Research Task R4 (design §3): the typed reason canResearch returns when a research
// project is BLOCKED. A string union (not a numeric enum) so it serializes/logs as a
// readable token and the R5 Research Lab UI can switch on it exhaustively to render each
// blueprint's disabled Research button with its cause. This DELIBERATELY mirrors the
// mission-rework DispatchBlockReason idiom (above). The order of the members mirrors
// canResearch's gate order (see below):
//   notFound         , no blueprint has that key (bad caller / stale UI reference)
//   alreadyResearched, the blueprint is already in researchedBlueprints (blueprintUnlocked)
//   inProgress       , a researchProject for this key is already in activeProcesses
//   tierLocked       , BLUEPRINTS[key].tier > the research facility level (upgrade to unlock)
//   noSlot           , every research slot is busy (active projects >= researchSlotCount)
//   credits          , state.credits < BLUEPRINTS[key].researchCreditCost (can't afford)
export type ResearchBlockReason =
  | "notFound"
  | "alreadyResearched"
  | "inProgress"
  | "tierLocked"
  | "noSlot"
  | "credits";

// Research Task R4: THE single consolidated research gate. Pure predicate, reads state +
// the static BLUEPRINTS table + the derived researchSlotCount, mutates nothing, spends
// nothing. This is the ONE source of truth for "can this blueprint be researched right
// now?": it folds the three inline gates R3's startResearch used to check (researchable /
// free slot / affordable) into one typed-reason result, MIRRORING canDispatch. startResearch
// (below) calls this first and does nothing else gate-wise; the R5 UI calls it directly to
// render each blueprint's Research button (enabled, or disabled with the reason shown).
//
// GATE ORDER is deliberate, cheapest/most-fundamental first, and determines WHICH reason
// surfaces when several fail at once (ok itself is order-independent, all must pass):
// identity (notFound) -> ownership (alreadyResearched) -> in-flight (inProgress) -> tier
// unlock (tierLocked) -> concurrency (noSlot) -> resource (credits). NOTE: this decomposes
// blueprintResearchable's folded predicate (which returns a single bool over notFound +
// alreadyResearched + inProgress + tierLocked) back into its four distinct reasons, so the
// UI can tell the player exactly WHICH condition is unmet, the reason blueprintResearchable
// itself is NOT reused here (it can't name which of its four terms failed).
export function canResearch(
  state: GameState,
  blueprintKey: string
): { ok: true } | { ok: false; reason: ResearchBlockReason } {
  // --- Identity: the key must name a real blueprint. An absent def means "not a real
  // blueprint" (bad caller / stale UI reference), checked first so every later gate can
  // safely read `bp`.
  const bp = BLUEPRINTS[blueprintKey];
  if (!bp) return { ok: false, reason: "notFound" };

  // --- Ownership: already researched -> nothing to do. Pure membership test (the same one
  // blueprintResearchable folds in), surfaced here as its own reason.
  if (blueprintUnlocked(state, blueprintKey)) return { ok: false, reason: "alreadyResearched" };

  // --- In-flight: a researchProject for THIS key is already unlocking it. Scanned the SAME
  // way model.ts's researchInProgress + startProcess read the effect discriminant (fixed by
  // design §3: { type: "unlockBlueprint"; key }).
  const inProgress = state.activeProcesses.some(
    (p) =>
      p.kind === "researchProject" &&
      p.effect.type === "unlockBlueprint" &&
      p.effect.key === blueprintKey
  );
  if (inProgress) return { ok: false, reason: "inProgress" };

  // --- Tier unlock: the research facility's level must have reached the blueprint's tier
  // (blueprintResearchable reads the SAME level >= tier relation; here it's its own reason so
  // the UI can show the required lab level).
  if (bp.tier > facilityLevel(state, RESEARCH_FACILITY_KEY)) {
    return { ok: false, reason: "tierLocked" };
  }

  // --- Concurrency: a free research slot, count in-flight research projects against the
  // cap (the Research Lab's analog of the Refinery's refine-slot cap).
  const activeResearch = state.activeProcesses.filter((p) => p.kind === "researchProject").length;
  if (activeResearch >= researchSlotCount(state)) return { ok: false, reason: "noSlot" };

  // --- Resource: affordable. researchCreditCost is a plain number (recipe-scale, not idle-
  // scale); wrap it in a Decimal to compare against state.credits (Decimal, so .lt is exact).
  if (state.credits.lt(new Decimal(bp.researchCreditCost))) return { ok: false, reason: "credits" };

  return { ok: true };
}

// Research PROJECT start (Research Task R3, design §3). As of Task R4 this is a THIN WRAPPER
// over canResearch (above), canResearch is the single source of truth for every gate
// (notFound, alreadyResearched, inProgress, tierLocked, noSlot, credits), so this function
// only (a) consults it, (b) on a block returns the SAME state ref + started:false + the block
// reason (so callers/UI can show it), and (c) on ok deducts the blueprint's credit cost
// ATOMICALLY at start (mirroring startFacilityUpgrade's credit deduct) and pushes a
// "researchProject" TimedProcess whose completion effect { type: "unlockBlueprint", key }
// adds the key to researchedBlueprints (resolveProcesses).
//
// The return keeps the START family's { next, started } shape (startProcess / startRefineJob
// / startFacilityUpgrade), so pre-R4 callers reading only { next, started } are unaffected;
// R4 ADDS an OPTIONAL `reason` (undefined on success) EXACTLY the way dispatchCaptainOnMission
// exposes canDispatch's reason, purely additive.
//
// CREDITS DEDUCT ONCE AT START (a discrete event, never per-tick) -> the research project
// then runs as an ORDINARY timed process stepped inside economyTick, so it is offline==live
// parity-safe by construction (tick(bigSpan) == looping economyTick(_,1)); see the parity
// test in research.test.ts. Research awards NO Fleet Admiral XP (resolveProcesses excludes
// the researchProject kind from the lump award, mirroring fuelRefineJob).
export function startResearch(
  state: GameState,
  blueprintKey: string
): { next: GameState; started: boolean; reason?: ResearchBlockReason } {
  // The single consolidated gate. On a block: same-ref no-op (the reject convention every
  // other start/action in this file shares) + the reason, so a blocked start can never be
  // mistaken for a no-op change.
  const gate = canResearch(state, blueprintKey);
  if (!gate.ok) return { next: state, started: false, reason: gate.reason };

  // gate.ok GUARANTEES a real, researchable, affordable blueprint with a free slot, so the
  // def lookup below cannot fail, recomputed here (rather than threaded out of canResearch)
  // to keep canResearch a clean predicate.
  const bp = BLUEPRINTS[blueprintKey];
  const cost = new Decimal(bp.researchCreditCost);

  // Deduct credits from a FRESH state clone BEFORE handing off to startProcess, so the
  // credit spend + the process push land in the SAME transition (atomic start, the design
  // §4 posture materials/upgrade-credits already use). >= 0 guaranteed by canResearch's
  // credits gate (gate.ok above).
  const afterCredits = { ...state, credits: state.credits.minus(cost) };
  // No MATERIAL inputs (locked design #3: research costs TIME + CREDITS, not materials), so
  // the inputs map is empty, startProcess's gate/deduct loops no-op over it. It pushes the
  // "researchProject" TimedProcess (remainingTicks = researchDurationTicks) whose completion
  // effect unlocks the blueprint.
  return startProcess(afterCredits, "researchProject", {}, bp.researchDurationTicks, {
    type: "unlockBlueprint",
    key: blueprintKey,
  });
}

// ============================================================================
// Tiered Warehouse, per-item storage cap helper (Phase 2, Task B2)
// (docs/plans/2026-07-13-phase-2-warehouse-refine-economy-design.md §3.3).
//
// tierCap(state, tier) returns the CURRENT per-item storage cap for a warehouse
// tier, a DERIVED value (never stored), read off that tier's warehouse facility
// level exactly as refineSlotCount derives the refinery's slot count off its level.
// DEFINITION ONLY this task: nothing enforces the cap yet. Task B3 consumes tierCap
// at the producer seam to auto-stop a producer whose output has hit its cap.
//
// Formula: BASE_CAP[tier] doubled once per REACHED warehouse rung. Each rung of a
// warehouse track (model.ts) carries a { storageCapMult: 2 } effect, so multiplying
// that factor across the reached rungs (i < level) yields base * 2^level, the
// design's "cap doubles per level, repeatable". The doubling factor lives on the
// rung (the upgrade track is the single source of truth), so tierCap needs no edit
// if a future tier tunes a different factor.
// ============================================================================

// Base (level-0) per-item cap per tier (design §3.3). T1 = 1,000,000 (calibrated:
// a ~week-old save is already brushing 1M, a fair mid-game starting pressure). T2 =
// 1,000,000 is a STUB placeholder, the real T2 base is TBD when T2 content lands.
// A tier ABSENT from this map has NO warehouse cap system yet (see tierCap's
// fail-open branch). Kept in sync with model.ts's WAREHOUSE_T*_BASE_CAP, which feed
// the upgrade COST formula off the same design numbers.
const BASE_CAP: Record<number, Decimal> = {
  1: new Decimal(WAREHOUSE_T1_BASE_CAP),
  2: new Decimal(WAREHOUSE_T2_BASE_CAP), // STUB, real T2 base TBD
};

// Which facility key holds each tier's warehouse upgrade track. Beside BASE_CAP so a
// new tier wires its cap base + its facility in one place.
const TIER_WAREHOUSE_KEY: Record<number, string> = {
  1: "warehouseT1",
  2: "warehouseT2",
};

// "Effectively uncapped" sentinel for a tier with NO warehouse cap system (a tier
// absent from BASE_CAP). A finite-but-astronomically-large Decimal, constructed from
// a STRING so it is a genuine break_infinity value (NOT JS's own number Infinity) --
// decimal-smoke.test.ts's extreme-magnitude case verifies string-built huge Decimals
// hold exactly. Chosen over Decimal(Infinity) deliberately: this repo has no Node to
// verify the library's Infinity-constructor behavior (Omega 8, no over-assumptions),
// and 1e1000 is unreachable by any in-game quantity, so B3's "amount >= cap -> stop"
// check is fail-open for un-warehoused tiers either way (a producer is NEVER idled
// for a tier that has no warehouse).
const WAREHOUSE_UNCAPPED_SENTINEL = new Decimal("1e1000");

// PURE: reads state + the static FACILITIES/BASE_CAP tables, mutates nothing. See
// the section header above for the formula. An un-warehoused tier (no BASE_CAP entry)
// fails OPEN to the uncapped sentinel so Task B3 never auto-stops a producer for a
// tier whose warehouse doesn't exist. A tier at warehouse level 0 returns its base
// cap unchanged (no reached rung to double it), including T2 while still LOCKED
// (level 0): its cap is defined even before unlock, but is moot this phase since no
// T2 item is obtainable.
export function tierCap(state: GameState, tier: number): Decimal {
  // Explicitly typed `Decimal | undefined`: this project builds WITHOUT
  // noUncheckedIndexedAccess (so `BASE_CAP[tier]` would otherwise type as a
  // non-nullable Decimal and make the `=== undefined` guard a TS2367 "no overlap"
  // error). The lookup genuinely CAN miss at runtime (an un-warehoused tier), so
  // the annotation states that honestly, matching the codebase's `?.`/`??`
  // grow-on-demand convention for the same situation.
  const base: Decimal | undefined = BASE_CAP[tier];
  if (base === undefined) {
    return WAREHOUSE_UNCAPPED_SENTINEL; // fail-open: no warehouse cap system for this tier
  }
  const warehouseKey = TIER_WAREHOUSE_KEY[tier];
  const facilityDef = warehouseKey ? FACILITIES[warehouseKey] : undefined;
  const level = warehouseKey ? (state.facilities[warehouseKey]?.level ?? 0) : 0;
  // Multiply the base by each REACHED rung's storageCapMult (i < level), the SAME
  // reached-rungs loop refineSlotCount uses to SUM addRefineSlots. A rung whose
  // effect is not a storageCapMult (none on today's warehouse tracks) contributes
  // nothing. The `i < upgrades.length` guard mirrors refineSlotCount's, defensive
  // against a hypothetical over-level read past the finite track.
  let cap = base;
  if (facilityDef) {
    const upgrades = facilityDef.upgrades;
    for (let i = 0; i < level && i < upgrades.length; i++) {
      const effect = upgrades[i].effect;
      if ("storageCapMult" in effect) {
        cap = cap.times(effect.storageCapMult);
      }
    }
  }
  return cap;
}

// ============================================================================
// Auto-stop cap check (Phase 2, Task B3)
// (docs/plans/2026-07-13-phase-2-warehouse-refine-economy-design.md §3.4).
//
// materialAtCap(state, itemId) returns whether the fleet's stock of `itemId` has
// REACHED (or somehow exceeded) that item's tier storage cap. This is the ONE
// cap-check seam for the whole auto-stop mechanic: economyTick calls it to idle a
// mission whose primary material is full (below), and Task D's refine-order pause
// will call this SAME function for refinery outputs, so both producers share one
// definition of "full" and cannot drift.
//
// PURE: reads state.inventory + the static ITEMS table + tierCap, mutates nothing.
//
// Fails OPEN on an unknown itemId (no ITEMS entry -> no tier -> return false), so a
// producer is NEVER idled for an item that has no catalog metadata. This mirrors
// tierCap's own fail-open stance (an un-warehoused tier returns the uncapped
// sentinel, against which .gte is always false anyway), two layers of the same
// "never wrongly stop a producer for a missing warehouse" guarantee.
//
// The `.gte(cap)` (>=, not >) is deliberate: AT the cap counts as full. At the
// uncapped sentinel (1e1000) no reachable in-game quantity is >=, so those items
// read as never-full.
// ============================================================================
export function materialAtCap(state: GameState, itemId: string): boolean {
  // Explicitly typed `ItemDef | undefined` for the SAME reason tierCap annotates
  // its BASE_CAP lookup: this project builds WITHOUT noUncheckedIndexedAccess, so
  // `ITEMS[itemId]` would otherwise type as a non-nullable ItemDef and make the
  // `=== undefined` guard a TS2367 "no overlap" error, but the lookup genuinely
  // CAN miss at runtime (an unknown itemId), so the annotation states that honestly.
  const item: ItemDef | undefined = ITEMS[itemId];
  if (item === undefined) {
    return false; // fail-open: no catalog entry -> no cap system -> never "full"
  }
  const cap = tierCap(state, item.tier);
  // inventory is sparse for dynamically-acquired itemIds, so an absent key means 0
  // held. Quality-bucketed (Task 9a): the "how full" check reads the item TOTAL
  // (sum of buckets) via itemTotal, the bucketed twin of the old scalar
  // `state.inventory[itemId] ?? 0`, so a per-item cap counts every quality tier.
  const have = itemTotal(state.inventory, itemId);
  return have.gte(cap);
}

// ============================================================================
// Per-item warehouse cap (fix/warehouse-cap-clamp, 2026-07-16).
//
// itemCap(state, itemId) returns the current storage cap for `itemId`, the value
// addToInventory clamps every producer deposit against. It is the DEPOSIT-side twin
// of materialAtCap (the auto-stop cap-CHECK above): both resolve the same cap the
// same way (ITEMS[itemId] -> tierCap(state, item.tier)), so the "how full is full"
// definition lives in exactly ONE derivation and the deposit clamp and the auto-stop
// can never disagree.
//
// PURE: reads the static ITEMS table + tierCap (which reads state.facilities),
// mutates nothing.
//
// Fails OPEN on an unknown itemId (no ITEMS entry -> no tier) by returning the
// WAREHOUSE_UNCAPPED_SENTINEL, so a deposit of an un-catalogued item is NEVER clamped
//, identical fail-open stance to materialAtCap (which returns false for the same
// case) and to tierCap (which returns the sentinel for an un-warehoused tier). A
// catalogued item whose tier has no warehouse cap system likewise flows through
// tierCap's own sentinel branch, so both "no catalog" and "no warehouse" paths land
// on the same effectively-uncapped value against which Decimal.min is a no-op.
export function itemCap(state: GameState, itemId: string): Decimal {
  // Explicitly typed `ItemDef | undefined` for the SAME noUncheckedIndexedAccess
  // reason materialAtCap annotates its lookup: the ITEMS lookup genuinely CAN miss at
  // runtime (an unknown itemId), so the annotation states that honestly and keeps the
  // `=== undefined` guard from being a TS2367 "no overlap" error.
  const item: ItemDef | undefined = ITEMS[itemId];
  if (item === undefined) {
    return WAREHOUSE_UNCAPPED_SENTINEL; // fail-open: no catalog entry -> never clamp
  }
  return tierCap(state, item.tier);
}

// ============================================================================
// Over-cap reconciliation (fix/warehouse-overcap-reconcile, 2026-07-24).
//
// clampInventoryToCaps(state) returns a state whose EVERY inventory stack is at or below
// its per-item warehouse cap, draining any overflow so no stored stack can read above its
// cap (e.g. the Warehouse showing "1.52M / 1.5M").
//
// WHY THIS EXISTS (the root-cause gap it closes): the deposit clamp inside addToInventory
// only fires ON a deposit, and the materialAtCap auto-stop idles a producer the instant its
// output is AT cap, so a stack that is ALREADY over its cap never receives another deposit
// and is therefore NEVER re-clamped: it sits stuck above the cap indefinitely. A stack can
// be over cap for reasons that predate or sidestep the deposit clamp:
//   - stock deposited BEFORE the 2026-07-16 deposit-clamp fix existed (the reported
//     1.52M-vs-1.5M ore: a legit save whose ore missions are now idled at base by the
//     auto-stop, so nothing ever delivers to re-clamp it),
//   - a salvage payout (the live-only salvage paths write raw via addItemQuality), or
//   - a hypothetically lowered cap.
// This helper is the ONE reconciliation seam that brings any such stack back down to cap.
//
// WHERE IT RUNS: at LOAD (save.ts migrate), unconditionally and on every load. It is
// IDEMPOTENT (a stack already at/under cap is untouched, so re-running changes nothing) and
// it does NOT change the save SHAPE, so it needs NO SAVE_VERSION bump: it is a value
// normalization, not a schema migration. Running it every load also self-heals a stack that
// a live salvage pushed over cap since the last load.
//
// Overflow is drained LOWEST-quality-first (removeItemLowestFirst), so once quality tiers
// carry value the player keeps their BEST stock and loses the cheapest, matching the
// "cheap stock spent first" policy the consume seam already uses. Today all stock is quality
// 0, so this only ever trims bucket 0. Uncapped items (itemCap returns the 1e1000 sentinel)
// are never trimmed: no reachable quantity exceeds the sentinel.
//
// PURE: reads state.inventory + itemCap (static ITEMS + state.facilities); returns a NEW
// state only when something was actually over cap (else the SAME reference, no needless
// clone); mutates nothing.
// ============================================================================
export function clampInventoryToCaps(state: GameState): GameState {
  let inventory = state.inventory;
  let changed = false;
  for (const itemId of Object.keys(inventory)) {
    const cap = itemCap(state, itemId);
    const total = itemTotal(inventory, itemId);
    if (total.gt(cap)) {
      // Drain exactly the overflow (total - cap), lowest-quality-first, so the stack lands
      // at EXACTLY the cap. removeItemLowestFirst is the same tested consume helper the
      // economy uses, reused here so the trim policy lives in one place.
      inventory = removeItemLowestFirst(inventory, itemId, total.minus(cap));
      changed = true;
    }
  }
  return changed ? { ...state, inventory } : state;
}

// ============================================================================
// Fuel tank cap + buy (Mission Rework Task 4, design §3).
//
// fuelCap(state), the CURRENT global Fuel Tank capacity, a DERIVED value (never
// stored), read off the fuel-storage facility's level exactly as tierCap reads a
// warehouse tier's cap off its warehouse level. This is the PARALLEL of tierCap for
// the single global fuel tank.
//
// Formula: FUEL_TANK_BASE_CAP doubled once per REACHED fuel-storage rung. Each rung
// carries a { storageCapMult: 2 } effect (model.ts's buildFuelStorageUpgrades), so
// multiplying that factor across the reached rungs (i < level) yields
// base * 2^level, the same derive-on-read/reached-rungs idiom tierCap uses. The
// doubling factor lives on the rung (the upgrade track is the single source of
// truth), so fuelCap needs no edit if a future rung tunes a different factor.
//
// ⚠️ CRITICAL, NO SOFT-LOCK (design §3): unlike tierCap (which returns a fail-open
// SENTINEL for a tier ABSENT from BASE_CAP, and treats a locked tier's cap as moot),
// fuelCap ALWAYS returns a real, USABLE base cap, even at level 0 on a fresh save.
// Missions are dispatchable from game start and need fuel, so the tank must hold
// fuel BEFORE any upgrade. There is no "un-built tank" state: level 0 = a live
// FUEL_TANK_BASE_CAP tank, and the loop below simply runs zero times (returns base).
//
// PURE: reads state + the static FACILITIES table + the FUEL_TANK_BASE_CAP constant,
// mutates nothing.
// ============================================================================
export function fuelCap(state: GameState): Decimal {
  let cap = new Decimal(FUEL_TANK_BASE_CAP); // level-0 base: a real, usable tank (no soft-lock)
  const facilityDef = FACILITIES["fuelStorage"];
  // Absent key -> level 0 (grow-on-demand, the SAME `?? 0` posture facilityLevel and
  // tierCap use). A fresh/seeded save has fuelStorage at level 0, so the loop runs
  // zero times and the base cap is returned unchanged, the guaranteed usable base.
  const level = state.facilities["fuelStorage"]?.level ?? 0;
  if (facilityDef) {
    const upgrades = facilityDef.upgrades;
    // Multiply the base by each REACHED rung's storageCapMult (i < level), the SAME
    // reached-rungs loop tierCap uses. The `i < upgrades.length` guard mirrors
    // tierCap's: defensive against a hypothetical over-level read past the finite track.
    // Fuel Economy v2 (F2): the fuelStorage track now also carries PROCESSING rungs
    // (pipeline/yield/input) that have NO storageCapMult, so this loop simply skips them
    //, the cap counts only the storage rungs, exactly as refineSlotCount counts only
    // addRefineSlots rungs and ignores the refineSpeedMult rung on its own mixed track.
    for (let i = 0; i < level && i < upgrades.length; i++) {
      const effect = upgrades[i].effect;
      if ("storageCapMult" in effect) {
        cap = cap.times(effect.storageCapMult);
      }
    }
  }
  return cap;
}

// ============================================================================
// Fuel Depot pipeline derivations (Fuel Economy v2 F2, design §2).
//
// Three DERIVE-ON-READ helpers, each reading ONE fuelStorage-track effect property
// across the reached rungs, the SAME reached-rungs idiom fuelCap / refineSlotCount
// use. The upgrade track is the single source of truth (no cached counts on
// FacilityState), so retuning a rung changes these with no bookkeeping / migration.
//   - fuelPipelineCount : how many concurrent auto-refine pipelines the depot runs NOW.
//   - fuelBatchOutput   : fuel produced per completed batch (base * yield rungs).
//   - fuelBatchInput    : Deuterium Ice consumed per batch (base * input rungs; <1 = less).
// ============================================================================

// Concurrent pipelines the Fuel Depot runs right now = FUEL_DEPOT_BASE_PIPELINES (1 at
// level 0) + the sum of every { addFuelPipelines } grant on the reached rungs.
//
// ⚠️ RETURNS 0 IF THERE IS NO fuelStorage FACILITY RECORD (state.facilities.fuelStorage
// absent). Real states ALWAYS have it (freshState seeds level 0; F5 migrates it onto old
// saves), so the base-1 pipeline is live in production from game start. The 0-branch is a
// defensive guard for hand-built/partial test states that omit the depot record, those
// run NO pipelines (nothing to refine ice with), which is the honest reading of "no Fuel
// Depot". This is what keeps the refine-order tests (which construct a facilities map
// WITHOUT fuelStorage) isolated from the fuel economy.
export function fuelPipelineCount(state: GameState): number {
  const facility = state.facilities["fuelStorage"];
  if (!facility) return 0; // no Fuel Depot record -> no pipelines (defensive; see note)
  const facilityDef = FACILITIES["fuelStorage"];
  const level = facility.level;
  let count = FUEL_DEPOT_BASE_PIPELINES; // base at level 0
  if (facilityDef) {
    const upgrades = facilityDef.upgrades;
    for (let i = 0; i < level && i < upgrades.length; i++) {
      const effect = upgrades[i].effect;
      if ("addFuelPipelines" in effect) {
        count += effect.addFuelPipelines;
      }
    }
  }
  return count;
}

// Fuel produced per completed batch = FUEL_REFINE_OUTPUT * product of every
// { fuelYieldMult } on the reached rungs (an empty product = the base output). Decimal
// (feeds the Decimal fuel tank).
export function fuelBatchOutput(state: GameState): Decimal {
  let output = new Decimal(FUEL_REFINE_OUTPUT);
  const facilityDef = FACILITIES["fuelStorage"];
  const level = state.facilities["fuelStorage"]?.level ?? 0;
  if (facilityDef) {
    const upgrades = facilityDef.upgrades;
    for (let i = 0; i < level && i < upgrades.length; i++) {
      const effect = upgrades[i].effect;
      if ("fuelYieldMult" in effect) {
        output = output.times(effect.fuelYieldMult);
      }
    }
  }
  return output;
}

// Deuterium Ice consumed per batch = FUEL_REFINE_INPUT * product of every
// { fuelInputMult } on the reached rungs (each < 1 REDUCES ice; empty product = base).
// Decimal (deducted atomically at batch start by startProcess, whose input map is
// Record<string, Decimal>).
export function fuelBatchInput(state: GameState): Decimal {
  let input = new Decimal(FUEL_REFINE_INPUT);
  const facilityDef = FACILITIES["fuelStorage"];
  const level = state.facilities["fuelStorage"]?.level ?? 0;
  if (facilityDef) {
    const upgrades = facilityDef.upgrades;
    for (let i = 0; i < level && i < upgrades.length; i++) {
      const effect = upgrades[i].effect;
      if ("fuelInputMult" in effect) {
        input = input.times(effect.fuelInputMult);
      }
    }
  }
  return input;
}

// buyFuel(state, units), buy up to `units` fuel at FUEL_CREDITS_PER_UNIT credits
// each, returning a NEW GameState (immutable-update style, like buyShip/craftRecipe).
// A no-op returns the SAME state reference (the codebase's "no change on failure"
// convention).
//
// Clamping (design §3, "buy into the tank up to its cap", affordability-guarded).
// The amount actually bought is the MIN of three limits, so it can NEVER overfill
// the tank NOR overspend the credit balance:
//   1. `units` requested (floored at 0, a non-positive request buys nothing, so a
//      negative `units` can't add credits / drain fuel).
//   2. tank ROOM = fuelCap(state) - state.fuel (0 if already at/over cap).
//   3. AFFORDABLE = state.credits / FUEL_CREDITS_PER_UNIT.
// If that min is <= 0 (broke, or tank full, or non-positive request) it's a same-ref
// no-op. Otherwise deduct buy * price from credits (>= 0 guaranteed since buy <=
// affordable) and add `buy` to fuel (<= cap guaranteed since buy <= room). Both moves
// are exact Decimal math, fuel and credits never go negative.
//
// NOTE: `buy` is not floored to a whole unit, the affordability clamp can yield a
// fractional amount (spending the credit balance exactly). This is intentional: the
// tank already holds fractional fuel (fuelNeeded is fractional, Task 3), so a single
// exact-Decimal min is the cleanest rule and avoids leaving unspendable credit dust.
// PURE apart from returning the new state; reads only state + the two constants.
export function buyFuel(state: GameState, units: number): GameState {
  const want = Decimal.max(0, new Decimal(units)); // non-positive request -> 0 (no exploit)
  const room = Decimal.max(0, fuelCap(state).minus(state.fuel)); // remaining tank capacity
  const affordable = state.credits.div(FUEL_CREDITS_PER_UNIT); // units the credits cover
  // Clamp to the MIN of all three limits. break_infinity.js's Decimal.min is BINARY
  // (two DecimalSource args only, decimal-smoke.test.ts documents this), so the
  // three-way min is CHAINED, never a single 3-arg call (a silent-drop trap).
  const buy = Decimal.min(Decimal.min(want, room), affordable); // fits cap AND affordable
  if (buy.lte(0)) return state; // broke, tank full, or nothing requested -> same-ref no-op

  const cost = buy.times(FUEL_CREDITS_PER_UNIT);
  return {
    ...state,
    credits: state.credits.minus(cost), // >= 0: buy <= affordable => cost <= credits
    fuel: state.fuel.plus(buy),         // <= cap: buy <= room => fuel + buy <= cap
  };
}

// ============================================================================
// Offline catch-up cap (Phase 2, Task B3)
// (docs/plans/2026-07-13-phase-2-warehouse-refine-economy-design.md §2).
//
// The MAX number of ticks an offline catch-up will step forward, no matter how
// long the player was away. Derived (never stored) from a base of 2 real days,
// converted to ticks via the fleet's shared tickDurationSeconds, the SAME
// deltaSeconds<->ticks cadence tick()/economyTick use everywhere else. At the
// default 1s cadence this is 172,800 ticks (2 * 86,400). Any elapsed span beyond
// this is DISCARDED by tick() (the excess simply does not accrue).
//
// EXTENSIBLE BY DESIGN: the cap is a FUNCTION of state, not a bare constant, so a
// future "offline extension" upgrade can lengthen it per-save without touching the
// call site. Today it returns exactly the base; the `+ future offline-extension
// upgrades` seam below is where such a bonus plugs in (NO such upgrade source
// exists yet, per the no-placeholder rule we do NOT invent one now).
// ============================================================================
export const OFFLINE_CAP_DAYS_BASE = 2;

// Seconds in one real day, named rather than an inline 86400 magic number, so the
// day->seconds conversion reads plainly at the one place it is used.
const SECONDS_PER_DAY = 86_400;

export function offlineCapTicks(state: GameState): number {
  // Base days, with room for future upgrade bonuses to add on. Kept as its own
  // local (not folded into the return expression) so the extension seam is a
  // one-line change here: `OFFLINE_CAP_DAYS_BASE + offlineExtensionDays(state)`.
  const capDays = OFFLINE_CAP_DAYS_BASE; // + future offline-extension upgrades
  const capSeconds = capDays * SECONDS_PER_DAY;
  // Convert the wall-clock cap into the fleet-wide tick cadence, the EXACT same
  // `seconds / tickDurationSeconds` conversion tick() applies to deltaSeconds, so
  // the cap is expressed in the same unit tick() clamps against.
  return capSeconds / state.tickDurationSeconds;
}

// (startRefineJob, the ONE-shot manual "start a single refine job" action
// (Task 11 scope: slot gate + startProcess atomic deduct + a "refineJob"
// TimedProcess), was RETIRED in S4. The per-slot production LINE engine below
// (startLine + stepCraftLine, which calls startProcess DIRECTLY per iteration)
// fully replaces the manual one-shot start: refining is now configured per slot
// in the Production sub-tab, not launched by a single hardcoded-recipe button.
// The "refineJob" process kind, refineSlotCount slot gate, and startProcess
// atomic-deduct machinery it used all live on, only this one-shot entry point
// is gone.)

// ============================================================================
// Refine ORDER engine (Phase 2, Task D1)
// (docs/plans/2026-07-13-phase-2-warehouse-refine-economy-design.md §4).
//
// The standing single-order model (startRefineOrder / stopRefineOrder and their
// Fabricator twins) was RETIRED in Task C4. The per-slot production LINE engine below
// (startLine / cancelLine + processRefineLines / processFabricateLines) replaces it
// entirely: independent lines, one per occupied slot, with DERIVED allocation.
// ============================================================================

// ============================================================================
// Per-slot production LINE engine (Crafting Allocation Redesign, Task C2)
// (docs/plans/2026-07-16-crafting-allocation-redesign-design.md §2).
//
// REPLACES the retired single-order engine (processRefineOrder / processFabricateOrder,
// removed this task) with INDEPENDENT per-slot lines. The key structural change: the
// old engine ran ONE order that filled EVERY free slot of a facility with the SAME
// recipe; the new engine runs an ARRAY of lines, each owning AT MOST ONE in-flight job
// (one slot per line), so a 3-slot facility can run 3 DIFFERENT recipes concurrently.
// Parallelism now comes from HAVING multiple lines, not from one order fanning out.
//
// Everything else is the SAME closed-form, once-per-tick machinery the orders used --
// startProcess's atomic deduct-at-start, resolveProcesses' unchanged completion (addItem
// + itemsRefined/itemsCrafted), the materialAtCap storage-cap stop, so offline==live
// parity holds for the exact same reason: economyTick steps these processors ONCE per
// whole tick (tick() loops economyTick(_,1)), and allocation is DERIVED from the lines
// (no stored ledger, no new parity surface).
//
// TWO facility processors (processRefineLines / processFabricateLines) share ONE
// per-line stepper (stepCraftLine) + one loop (runCraftLines); plus the line lifecycle
// actions startLine / cancelLine. The stepper is kind-agnostic (it branches on
// line.kind for the registry lookup), but each processor only ever passes its OWN
// facility's array, so a refine line and a fabricate line never mix.
// ============================================================================

// The recipe-derived job parameters for ONE iteration of a line: the inputs to consume
// (reusing C1's lineInputsPerIteration, the SAME map startRefineJob/startFabricateJob
// build inline), the output item + amount to grant on completion, the craft duration,
// and the TimedProcess kind. Returns null for an unknown/corrupt recipeKey (a hand-
// edited/older save) so the caller leaves the line inert rather than throwing, the
// exact defensive posture the retired orders' `if (!recipe) return state` guard had.
interface CraftLineJobSpec {
  inputs: Record<string, Decimal>;
  outputItemId: string;
  outputAmount: Decimal;
  durationTicks: number;
  jobKind: TimedProcessKind;
  // Equipment 0.11.0 (Task 19): the COMPLETION effect stepCraftLine hands to startProcess. For
  // a refine line and a MATERIAL fabricate line this is the addItem the engine always used (so
  // those lines are byte-identical to pre-Task-19). For an EQUIPMENT fabricate line (blueprint
  // with `equipmentOutput`) it is the NEW addEquipment(blueprintKey), and the outputItemId /
  // outputAmount above are then INERT (empty-string / 1 fallbacks, since an equipment blueprint
  // carries no recipe.outputItem), still carried so the shared cap-check/plumbing shape is
  // unchanged; `isEquipment` tells stepCraftLine to SKIP the warehouse-cap gate (an
  // EquipmentInstance is not an inventory item, so it has no stackable output to cap).
  effect: ProcessEffect;
  isEquipment: boolean;
}
function lineJobSpec(line: CraftLine): CraftLineJobSpec | null {
  const inputs = lineInputsPerIteration(line); // C1 helper: {} for an unknown recipe
  if (line.kind === "refine") {
    const recipe = REFINE_RECIPES[line.recipeKey];
    if (!recipe) return null; // unknown refine recipe -> inert line
    return {
      inputs,
      outputItemId: recipe.output.itemId,
      outputAmount: recipe.output.amount,
      durationTicks: recipe.durationTicks,
      jobKind: "refineJob",
      // Refine always deposits an inventory item, byte-identical to the pre-Task-19 inline effect.
      effect: { type: "addItem", itemId: recipe.output.itemId, amount: recipe.output.amount },
      isEquipment: false,
    };
  }
  // kind === "fabricate"
  const bp = BLUEPRINTS[line.recipeKey];
  if (!bp) return null; // unknown blueprint -> inert line
  // Task 19: branch on blueprint SHAPE. An EQUIPMENT or WEAPON blueprint mints an
  // EquipmentInstance at completion (addEquipment); a MATERIAL blueprint deposits its stackable
  // output (addItem, UNCHANGED). All three consume recipe.inputs identically (that map is
  // meaningful for every shape). Combat 1.0 (Unit 1.2b): a WEAPON blueprint joins the equipment
  // path here via blueprintMintsEquipmentInstance (equipment OR weapon), so a crafted weapon
  // hands off the SAME addEquipment effect (resolveProcesses then mints via generateWeapon vs
  // generateEquipment on the blueprint's output shape) and SKIPS the warehouse cap like equipment.
  // For a material or equipment blueprint this is byte-identical to the prior `=== "equipment"`
  // (material stays false, equipment stays true); it only newly classifies the weapon shape.
  const isEquipment = blueprintMintsEquipmentInstance(bp);
  // recipe.outputItem/outputQty are OPTIONAL (model.ts): a MATERIAL blueprint always carries
  // them, an EQUIPMENT blueprint OMITS them (its real output is the minted EquipmentInstance).
  // These two locals are INERT on the equipment path (isEquipment skips the cap gate below and
  // uses the addEquipment effect), so an absent field falls back to a harmless placeholder that
  // is never read for equipment. For a material blueprint the fields are always present.
  const outputItemId = bp.recipe.outputItem ?? ""; // "" is inert: only the equipment path lacks it
  const outputAmount = new Decimal(bp.recipe.outputQty ?? 1); // 1 is inert: only the equipment path lacks it
  return {
    inputs,
    outputItemId,
    outputAmount,
    durationTicks: bp.craftDurationTicks,
    jobKind: "fabricateJob",
    effect: isEquipment
      ? { type: "addEquipment", blueprintKey: line.recipeKey }
      : { type: "addItem", itemId: outputItemId, amount: outputAmount },
    isEquipment,
  };
}

// Advances ONE line by (at most) one tick's worth of work, returning the state after
// any job it started AND the line's next value (null = REMOVE the line this tick). It
// enforces the core per-line invariant, AT MOST ONE in-flight job per line, and the
// same storage-cap / affordability stops the retired order used, minus the pausedReason
// bookkeeping (lines have no pause-reason field in C2; a blocked line simply survives
// unchanged and retries next tick). PURE: no mutation; the returned `next` is a fresh
// state when a job started, else the same reference.
function stepCraftLine(state: GameState, line: CraftLine): { next: GameState; line: CraftLine | null } {
  const spec = lineJobSpec(line);
  if (spec === null) {
    // Unknown/corrupt recipe on a persisted line: keep it inert (survives), start
    // nothing, never throw on `undefined.output`. Mirrors the orders' corrupt guard.
    return { next: state, line };
  }

  // ONE in-flight job per line: if this line already owns a running job (matched by the
  // lineId startProcess stamped), its single slot is BUSY, do nothing this tick. The
  // line survives, waiting for resolveProcesses to complete that job (which runs BEFORE
  // this processor each economyTick, so the slot is refillable the SAME tick it frees).
  const hasInFlightJob = state.activeProcesses.some((p) => p.lineId === line.id);
  if (hasInFlightJob) return { next: state, line };

  // No in-flight job. A BATCH line whose `remaining` has reached 0 has therefore
  // finished its LAST iteration (its final job already completed, otherwise
  // hasInFlightJob above would be true) -> REMOVE it. A CONTINUOUS line never reaches
  // this stop: its `remaining` is held at 1 and never decremented (see below).
  if (line.mode.kind === "batch" && line.remaining <= 0) {
    return { next: state, line: null };
  }

  // Output at its warehouse cap -> this line makes no progress this tick (survives,
  // starts nothing). The SAME materialAtCap seam missions/trickle/the retired orders
  // stop on. startRefineJob does NOT itself check the cap (the retired order checked it
  // externally, as we do here); startFabricateJob's canFabricate would, but we check
  // here for BOTH kinds uniformly so refine + fabricate lines behave identically.
  // Equipment 0.11.0 (Task 19): an EQUIPMENT fabricate line is EXEMPT from this gate, its
  // real output is a minted EquipmentInstance (it has no stackable outputItemId at all),
  // so the warehouse cap must NOT stall it. Material/refine lines are unaffected.
  if (!spec.isEquipment && materialAtCap(state, spec.outputItemId)) {
    return { next: state, line };
  }

  // Start this iteration's job via startProcess directly (NOT startRefineJob/
  // startFabricateJob, those apply a facility-wide slot gate that would double-count
  // sibling lines' fresh jobs, and we need to stamp the owning lineId). startProcess
  // applies the FINAL affordability gate + the atomic deduct-at-start; the line's own
  // reservation guarantees affordability, so `started:false` here is a defensive
  // backstop (short inputs -> the line simply waits and retries). The completion effect
  // is the SAME shared addItem startRefineJob/startFabricateJob use, so resolveProcesses
  // grants the output + bumps itemsRefined/itemsCrafted with NO new branch.
  const { next, started } = startProcess(
    state,
    spec.jobKind,
    spec.inputs,
    spec.durationTicks,
    // Task 19: the effect is spec-derived now (addItem for refine/material, addEquipment for an
    // equipment blueprint). For refine + material lines this is byte-identical to the old inline
    // addItem, so their deep-equal parity snapshots are unaffected.
    spec.effect,
    line.id
  );
  if (!started) return { next: state, line }; // unaffordable right now -> line waits

  // Job started -> one not-yet-started iteration has left the allocation basis. For a
  // BATCH line, decrement BOTH `remaining` and `mode.remaining` in ONE construction so
  // they cannot drift (see CraftLineMode's ⚠️ note). For a CONTINUOUS line, `remaining`
  // stays 1, it always reserves its next queued iteration and never counts down.
  if (line.mode.kind === "batch") {
    const nextRemaining = line.remaining - 1;
    return { next, line: { ...line, remaining: nextRemaining, mode: { kind: "batch", remaining: nextRemaining } } };
  }
  return { next, line };
}

// Steps every line in one facility's array, threading state immutably through each
// (so a job started by an earlier line is visible to a later line's affordability gate
// this same tick) and dropping any line stepCraftLine removed (returned null). Bounded
// work: at most one job start per line per call, and the array length is capped at the
// facility's slot count (startLine), so no Omega-14 unbounded-loop concern even across
// a 172,800-tick offline catch-up (it runs once per LINE, not once per tick).
function runCraftLines(state: GameState, lines: CraftLine[]): { next: GameState; lines: CraftLine[] } {
  let working = state;
  const nextLines: CraftLine[] = [];
  for (const line of lines) {
    const stepped = stepCraftLine(working, line);
    working = stepped.next;
    if (stepped.line !== null) nextLines.push(stepped.line);
  }
  return { next: working, lines: nextLines };
}

// The per-tick REFINE line engine, called ONCE per economyTick (AFTER resolveProcesses,
// so a slot freed by a job completing this tick is refillable the same tick). PURE:
// returns a NEW state, or the SAME reference when there are no refine lines (the
// same-ref no-op the retired processRefineOrder had for a null order). `?? []` tolerates
// a pre-C6 save that predates the field (defensive; freshState always seeds []).
export function processRefineLines(state: GameState): GameState {
  const lines = state.refineLines ?? [];
  if (lines.length === 0) return state; // no lines -> same-reference no-op
  const { next, lines: nextLines } = runCraftLines(state, lines);
  return { ...next, refineLines: nextLines };
}

// The per-tick FABRICATE line engine, the EXACT mirror of processRefineLines for the
// Fabricator's array. Shares stepCraftLine/runCraftLines (kind-agnostic); differs ONLY
// in which facility array it reads/writes. Called at the SAME economyTick seam, AFTER
// processRefineLines (so a fabricate line can consume refined materials a refine line
// produced/started this tick, the two are independent, each bounded by its own
// facility's slot count).
export function processFabricateLines(state: GameState): GameState {
  const lines = state.fabricateLines ?? [];
  if (lines.length === 0) return state; // no lines -> same-reference no-op
  const { next, lines: nextLines } = runCraftLines(state, lines);
  return { ...next, fabricateLines: nextLines };
}

// ============================================================================
// Line-start gate + affordable-now cap (Crafting Allocation Redesign, Task C3,
// plan §C3). Two PURE readers the C4 configurator UI leans on:
//   - maxAffordableIterations : the quantity cap the UI clamps its amount field to.
//   - canStartLine            : the typed-reason gate the UI shows on a disabled Start.
// Both mirror the Fabricator's canFabricate idiom (typed reason, gate-order-defined
// precedence, pure predicate). startLine (below) delegates ALL its guards here, so the
// line engine and the UI share ONE definition of "can this line start right now?".
// ============================================================================

// maxAffordableIterations(state, kind, recipeKey): the largest WHOLE iteration count
// that can be reserved from FREE stock RIGHT NOW =
//   min over each recipe input of  floor( free[item] / perIteration[item] ).
//
// The crucial word is FREE, not raw inventory: `freeItem` subtracts what the ACTIVE
// lines already reserved, so a second line can never double-book units an existing line
// is holding. This is the affordable-now quantity cap the C4 amount field clamps to, and
// the number canStartLine's `materials` gate compares the requested count against.
//
// Returns 0 when any input's free is below one iteration (the floor is 0, so the min is
// 0), or when the recipe is unknown / has no inputs (nothing to reserve against -> 0,
// NOT an unbounded cap). PURE: reads state.inventory + both line arrays + the static
// registries via lineInputsPerIteration; mutates nothing.
export function maxAffordableIterations(
  state: GameState,
  kind: CraftLineKind,
  recipeKey: string
): number {
  // Inputs consumed by ONE iteration of this recipe. Reuse the SAME per-iteration map the
  // allocation core builds, fed a PROBE line carrying only the two fields it reads
  // (kind + recipeKey); the other CraftLine fields are inert for this lookup. An unknown
  // recipe yields {} (lineInputsPerIteration's defensive empty map).
  const probe: CraftLine = { id: "", kind, recipeKey, remaining: 0, mode: { kind: "continuous" } };
  const perIteration = lineInputsPerIteration(probe);
  const inputItems = Object.keys(perIteration);

  // No inputs (unknown recipe, or a genuinely input-less recipe): there is nothing to
  // reserve against, so there is no affordable-now quantity -> 0 (the gate reads 0 as
  // "cannot start any"), deliberately NOT an unbounded cap.
  if (inputItems.length === 0) return 0;

  // FREE (inventory - already-reserved), across BOTH facilities' lines: the reservable
  // pool a NEW line draws from. `?? []` guards a pre-C2 state shape defensively.
  const allLines = [...(state.refineLines ?? []), ...(state.fabricateLines ?? [])];

  // min over inputs of floor(free / perUnit). Accumulate as a Decimal (break_infinity)
  // because free stock can exceed Number range; convert once at the end.
  let cap: Decimal | null = null;
  for (const itemId of inputItems) {
    const perUnit = perIteration[itemId];
    // A non-positive per-unit amount would divide-by-zero / be meaningless; skip it so it
    // contributes no bound (defensive, real recipes carry positive input amounts).
    if (perUnit.lte(0)) continue;
    const free = freeItem(state.inventory, allLines, itemId);
    const iterations = free.div(perUnit).floor(); // whole iterations THIS input can fund
    cap = cap === null ? iterations : Decimal.min(cap, iterations);
  }

  // Every input had a non-positive per-unit amount (degenerate recipe) -> no real bound -> 0.
  if (cap === null) return 0;
  if (cap.lte(0)) return 0;

  // Convert the Decimal bound to a plain integer count. break_infinity can hold values far
  // beyond Number range, so guard: a non-finite / oversized cap clamps to MAX_SAFE_INTEGER
  // (still a finite, usable integer for the UI's amount field). floor is belt-and-suspenders
  // on top of the Decimal .floor() above.
  const n = cap.toNumber();
  if (!isFinite(n) || n > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  return Math.floor(n);
}

// StartLineBlockReason: the typed reason canStartLine returns when a line CANNOT start.
// A string union (not a numeric enum) so it serializes/logs as a readable token and the
// C4 configurator can switch on it exhaustively to render a disabled Start with its cause.
// DELIBERATELY parallels FabricateBlockReason; the ORDER mirrors canStartLine's gate order:
//   notFound     , the key names no recipe/blueprint in the kind's registry
//   unlockOnly   , FABRICATE only: the blueprint is UNLOCK-ONLY (unlockOnly: true), it crafts
//                    nothing (its payoff is Shipyard build access via research), so a fabricate
//                    LINE can never validly produce it. Combat 0.13.0 warship research gate.
//   notResearched, FABRICATE only: the blueprint is not unlocked (blueprintUnlocked false)
//   tierLocked   , FABRICATE only: BLUEPRINTS[key].tier > the fabricator facility level
//   noSlot       , the kind's lines array already fills its slot count (one line per slot)
//   invalidCount , the requested count is not a positive integer
//   materials    , count exceeds maxAffordableIterations (can't reserve that many from free)
//   storageFull  , the output item is at its warehouse storage cap (materialAtCap)
//   equipmentStorageFull, EQUIPMENT fabricate only: the SPARE-system pool is at its cap
//                  (equipmentAtCap), the equipment twin of storageFull (Task B1)
// unlockOnly + notResearched + tierLocked are a FABRICATE-ONLY subset: refine recipes carry no
// unlock/research/tier gate (a refine recipe is always available once the refinery is built), so
// a refine line can never surface those three reasons. equipmentStorageFull is likewise fabricate-
// only (only an equipment BLUEPRINT mints a spare system), so a refine line never surfaces it.
export type StartLineBlockReason =
  | "notFound"
  | "unlockOnly"
  | "notResearched"
  | "tierLocked"
  | "noSlot"
  | "invalidCount"
  | "materials"
  | "storageFull"
  | "equipmentStorageFull";

// canStartLine(state, kind, recipeKey, count): THE single consolidated line-start gate.
// Pure predicate mirroring canFabricate, reads state + the static registries + the derived
// slot counts, mutates nothing, spends nothing. The ONE source of truth for "can this line
// start right now?": startLine (below) calls it and does nothing else gate-wise, and the C4
// UI calls it directly to render each Start button (enabled, or disabled with the reason).
//
// GATE ORDER is deliberate (cheapest/most-fundamental first) and determines WHICH reason
// surfaces when several fail at once (ok itself is order-independent, all must pass):
// identity (notFound) -> craftability (unlockOnly, fabricate) -> ownership (notResearched,
// fabricate) -> tier unlock (tierLocked, fabricate) -> concurrency (noSlot) -> count validity
// (invalidCount) -> resource (materials) -> storage (storageFull). This consolidates C2's inline
// startLine guards (recipe existence / count / slot) and ADDS the research/tier/affordability/
// storage gates canFabricate carries, plus the unlock-only craftability guard (0.13.0).
export function canStartLine(
  state: GameState,
  kind: CraftLineKind,
  recipeKey: string,
  count: number
): { ok: true } | { ok: false; reason: StartLineBlockReason } {
  // --- Identity: the key must name a real recipe/blueprint in THIS kind's registry.
  // Checked first so every later gate can safely read the def.
  if (kind === "refine") {
    if (!REFINE_RECIPES[recipeKey]) return { ok: false, reason: "notFound" };
  } else {
    if (!BLUEPRINTS[recipeKey]) return { ok: false, reason: "notFound" };
  }

  // --- Craftability + ownership + tier (FABRICATE ONLY). Refine recipes have none of these
  // gates, so a refine line skips this block entirely (these reasons are a fabricate-only subset
  // of StartLineBlockReason).
  if (kind === "fabricate") {
    // Unlock-only guard (Combat 0.13.0 warship research gate): an UNLOCK-ONLY blueprint crafts
    // NOTHING (no recipe.outputItem, no equipmentOutput), so a fabricate line producing it is a
    // contradiction. Checked FIRST, BEFORE the researched/tier gates, because it is not craftable
    // REGARDLESS of research or tier state (the same reasoning + placement as canFabricate's guard):
    // an unlock-only blueprint's "unresearched" or "tier-locked" state is irrelevant, it is simply
    // never a valid line. This is the ENGINE backstop behind the F4 UI's dropdown filter, so the
    // guarantee does not rest on UI filtering alone (the codebase treats the engine as the source
    // of truth). Without it, a RESEARCHED unlock-only blueprint would fall through to the materials
    // gate and block only incidentally (empty inputs -> 0 affordable), an honest reason, not luck.
    if (blueprintKind(BLUEPRINTS[recipeKey]) === "unlockOnly") return { ok: false, reason: "unlockOnly" };
    if (!blueprintUnlocked(state, recipeKey)) return { ok: false, reason: "notResearched" };
    if (BLUEPRINTS[recipeKey].tier > facilityLevel(state, FABRICATOR_FACILITY_KEY)) {
      return { ok: false, reason: "tierLocked" };
    }
  }

  // --- Concurrency: one line per slot. A NEW line needs a free slot: the kind's current
  // line count must be below the facility's derived slot count. EXACT mirror of C2 startLine's
  // slot guard (and canFabricate's noSlot, though that counts in-flight jobs, lines here).
  const lines = (kind === "refine" ? state.refineLines : state.fabricateLines) ?? [];
  const slotCount = kind === "refine" ? refineSlotCount(state) : fabricateSlotCount(state);
  if (lines.length >= slotCount) return { ok: false, reason: "noSlot" };

  // --- Count validity: a line must order a WHOLE, POSITIVE number of iterations. Guards a
  // continuous line's implicit 1 (always valid) and a batch line's configured count.
  if (!Number.isInteger(count) || count <= 0) return { ok: false, reason: "invalidCount" };

  // --- Resource: the requested count must be reservable NOW from FREE stock (inventory minus
  // what active lines already reserved). maxAffordableIterations is that affordable-now cap;
  // asking for more than it means the units aren't currently reservable -> materials.
  if (count > maxAffordableIterations(state, kind, recipeKey)) {
    return { ok: false, reason: "materials" };
  }

  // --- Storage: the OUTPUT item must not already be at its warehouse cap (AT the cap counts
  // as full, the SAME materialAtCap seam canFabricate/missions/trickle stop on). Refine
  // outputs a { itemId, amount } record (-> .itemId); a blueprint outputs recipe.outputItem.
  // Equipment 0.11.0 (Task 19): an EQUIPMENT blueprint (equipmentOutput present) is EXEMPT from
  // the WAREHOUSE cap, it mints an EquipmentInstance and has no stackable output, so the material
  // storage cap must not block it. The SAME exemption stepCraftLine/canFabricate apply.
  // Combat 1.0 (Unit 1.2b): a WEAPON blueprint mints an instance too, so blueprintMintsEquipmentInstance
  // (equipment OR weapon) is the exemption test; behavior-identical to the prior `=== "equipment"`
  // for material/equipment blueprints (an unlock-only blueprint was already refused above), it only
  // newly exempts the weapon shape so a weapon craft answers to the equipment cap, not the warehouse cap.
  const isEquipmentBlueprint = kind === "fabricate" && blueprintMintsEquipmentInstance(BLUEPRINTS[recipeKey]);
  if (!isEquipmentBlueprint) {
    // A non-equipment fabricate line is a MATERIAL blueprint, which always carries recipe.outputItem;
    // the `?? undefined` guard only exists because outputItem is now an optional field (a corrupt/
    // absent value simply skips the cap check rather than throwing).
    const outputItem =
      kind === "refine" ? REFINE_RECIPES[recipeKey].output.itemId : BLUEPRINTS[recipeKey].recipe.outputItem;
    if (outputItem !== undefined && materialAtCap(state, outputItem)) return { ok: false, reason: "storageFull" };
  } else if (equipmentAtCap(state)) {
    // Equipment 0.11.0 (Task B1): an equipment fabricate mints a SPARE crafted system into the
    // CAPPED pool. When spare storage is already full, refuse to START, the equipment twin of the
    // material storageFull stop above (same posture, distinct reason so the UI can surface the
    // equipment cap explicitly). Relieved by salvage (C1) / the storage upgrade (B2). Fitting,
    // salvaging, and non-equipment jobs never reach this branch.
    return { ok: false, reason: "equipmentStorageFull" };
  }

  return { ok: true };
}

// Adds a new production line to a facility (the C4 configurator's Start action; tests call
// it directly). As of Task C3 this is a THIN WRAPPER over canStartLine, canStartLine is the
// single source of truth for every gate (notFound / notResearched / tierLocked / noSlot /
// invalidCount / materials / storageFull), so this function only (a) derives the reserved
// iteration count from the mode, (b) consults the gate, (c) on a block returns the SAME state
// ref + started:false + the block reason (so the UI can show WHY), and (d) on ok appends the
// line UNCHANGED from C2.
//
// The return keeps the START family's { next, started } shape (startProcess / startRefineJob
// / startFabricateJob) and ADDS an OPTIONAL `reason` (undefined on success) EXACTLY the way
// startFabricateJob exposes canFabricate's reason.
//
// The new line's `remaining` (allocation basis) is the batch count, or 1 for a continuous
// line (it reserves exactly its one queued next iteration, see CraftLineMode). This is the
// SAME count canStartLine's affordability gate validated, so an appended line is always
// reservable from free at start.
export function startLine(
  state: GameState,
  kind: CraftLineKind,
  recipeKey: string,
  mode: CraftLineMode
): { next: GameState; started: boolean; reason?: StartLineBlockReason } {
  // Iterations this line reserves up front: a batch reserves its full count; a continuous
  // line reserves exactly its ONE queued next iteration. This is the count canStartLine gates.
  const count = mode.kind === "batch" ? mode.remaining : 1;

  // Single consolidated gate. On a block: same-ref no-op (the reject convention every other
  // start/action in this file shares) + the typed reason, so a blocked start can never be
  // mistaken for a no-op change.
  const gate = canStartLine(state, kind, recipeKey, count);
  if (!gate.ok) return { next: state, started: false, reason: gate.reason };

  // gate.ok GUARANTEES a real recipe, ownership/tier (fabricate), a free slot, a valid count,
  // affordable inputs, and output room. Append the line, byte-for-byte the C2 append path.
  const lines = (kind === "refine" ? state.refineLines : state.fabricateLines) ?? [];
  const remaining = count;
  const line: CraftLine = { id: `craft-${state.nextCraftLineId}`, kind, recipeKey, remaining, mode };
  const field = kind === "refine" ? "refineLines" : "fabricateLines";
  return {
    next: { ...state, [field]: [...lines, line], nextCraftLineId: state.nextCraftLineId + 1 },
    started: true,
  };
}

// Cancels (removes) a line by id from whichever facility array holds it. Its UNSTARTED
// reservation releases automatically, allocation is DERIVED from the lines, so fewer
// lines means less allocated, no ledger to unwind. Any IN-FLIGHT timed job the line
// started is a COMMITTED TimedProcess and is deliberately left UNTOUCHED: it completes
// normally and grants its output (design §2 / Task C2: do NOT refund an in-flight
// iteration). PURE. Same-reference no-op when no line matches the id.
export function cancelLine(state: GameState, lineId: string): GameState {
  const refineLines = state.refineLines ?? [];
  const fabricateLines = state.fabricateLines ?? [];
  const inRefine = refineLines.some((l) => l.id === lineId);
  const inFabricate = fabricateLines.some((l) => l.id === lineId);
  if (!inRefine && !inFabricate) return state; // no such line -> same-ref no-op

  // Cancel = "stop after the CURRENT iteration finishes." If the line has an iteration
  // already IN FLIGHT (a job stamped with this lineId), we DRAIN it rather than delete
  // it: set remaining -> 0 (a stopped batch), which (a) immediately releases the UNSTARTED
  // reservation via derived allocation, and (b) leaves the line in its array so stepCraftLine
  // keeps it alive, the in-flight iteration finishes VISIBLY, deposits its output, and
  // THEN stepCraftLine removes the line (remaining 0, no in-flight job). Converting a
  // CONTINUOUS line to `{ kind: "batch", remaining: 0 }` is what makes it stop too. If NO
  // iteration is in flight (an idle/paused/just-created line), there is nothing to finish
  // -> remove it outright for immediate feedback. (Before this fix, EVERY cancel deleted
  // the line, so a mid-run cancel made the still-running iteration's card vanish instantly.)
  const hasInFlightJob = state.activeProcesses.some((p) => p.lineId === lineId);
  const rebuild = (lines: CraftLine[]): CraftLine[] =>
    hasInFlightJob
      ? lines.map((l) => (l.id === lineId ? { ...l, remaining: 0, mode: { kind: "batch", remaining: 0 } } : l))
      : lines.filter((l) => l.id !== lineId);

  return {
    ...state,
    // Only the array that actually held the line is rebuilt; the other rides through
    // unchanged. (A line id is unique across both facilities via nextCraftLineId, so at
    // most one branch matches, but both are checked independently for robustness.)
    refineLines: inRefine ? rebuild(refineLines) : refineLines,
    fabricateLines: inFabricate ? rebuild(fabricateLines) : fabricateLines,
  };
}

// ============================================================================
// Fabricate engine (Fabricator Phase 4, Task F2)
// (docs/plans/2026-07-16-fabricator-design.md §2).
//
// A LINE-FOR-LINE clone of the Refinery's refine engine above (startRefineJob +
// startRefineOrder/stopRefineOrder/processRefineOrder), for the Fabricator. The Refinery
// crafts a REFINE_RECIPES entry (raw ore -> refined material); the Fabricator crafts a
// researched BLUEPRINTS entry's `recipe` (refined materials/components -> a component).
// Everything else is identical: single-job start with atomic deduct + a "fabricateJob"
// TimedProcess whose "addItem" completion effect deposits the component (resolveProcesses,
// no new branch); a standing ORDER (batch count-N / continuous) that fills free fabricate
// slots each economyTick, pauses with a reason when blocked, and auto-resumes when the
// block lifts. Offline==live parity comes from the SAME economyTick seam (tick() steps
// economyTick(_,1) per whole tick), NOT from any closed-form-in-order math, exactly as
// the refine order relies on.
//
// The ONE thing the Fabricator adds that the Refinery lacks: a blueprint carries RESEARCH
// + TIER gates (a refine recipe is always available once the refinery is built). So
// startFabricateJob's gate is richer than startRefineJob's, it also requires the
// blueprint researched (blueprintUnlocked) and tier-available (fabricator level >= tier)
// and the output not at its storage cap. These guards are INLINED here for F2; F3 lifts
// them into a typed `canFabricate` (mirroring canResearch) and this delegates to it.
// ============================================================================

// ============================================================================
// Fabricator availability gate (Fabricator Task F3, plan §F3).
//
// FabricateBlockReason: the typed reason canFabricate returns when a craft is BLOCKED.
// A string union (not a numeric enum) so it serializes/logs as a readable token and the
// F4 Fabricator UI can switch on it exhaustively to render each blueprint's disabled Craft
// button with its cause. DELIBERATELY mirrors ResearchBlockReason (above). The order of the
// members mirrors canFabricate's gate order (see below):
//   notFound      , no blueprint has that key (bad caller / stale UI reference)
//   unlockOnly    , the blueprint is UNLOCK-ONLY (unlockOnly: true): it crafts nothing, its
//                   payoff is Shipyard build access via research, so the Fabricator refuses it
//                   OUTRIGHT (checked before every other gate, since it can never be crafted no
//                   matter the research/tier/resource state). Combat 0.13.0 warship research gate.
//   notResearched , the blueprint is NOT unlocked (blueprintUnlocked is false)
//   tierLocked    , BLUEPRINTS[key].tier > the fabricator facility level (upgrade to unlock)
//   noSlot        , every fabricate slot is busy (active fabricateJobs >= fabricateSlotCount)
//   materials     , a recipe input is unaffordable (any input: on-hand < required)
//   storageFull   , the output component is at its warehouse storage cap (materialAtCap)
//   equipmentStorageFull, EQUIPMENT blueprint only: the SPARE-system pool is at its cap
//                   (equipmentAtCap), the equipment twin of storageFull (Task B1)
export type FabricateBlockReason =
  | "notFound"
  | "unlockOnly"
  | "notResearched"
  | "tierLocked"
  | "noSlot"
  | "materials"
  | "storageFull"
  | "equipmentStorageFull";

// Fabricator Task F3: THE single consolidated fabricate gate. Pure predicate, reads state
// + the static BLUEPRINTS/ITEMS tables + the derived fabricateSlotCount, mutates nothing,
// spends nothing. The ONE source of truth for "can this blueprint be fabricated right now?":
// it folds F2's inline startFabricateJob guards (researched / tier / slot / storage-cap /
// affordability) into one typed-reason result, MIRRORING canResearch. startFabricateJob
// (below) calls this first and does nothing else gate-wise; the F4 UI calls it directly to
// render each blueprint's Craft button (enabled, or disabled with the reason shown).
//
// GATE ORDER is deliberate, cheapest/most-fundamental first, and determines WHICH reason
// surfaces when several fail at once (ok itself is order-independent, all must pass):
// identity (notFound) -> ownership (notResearched) -> tier unlock (tierLocked) ->
// concurrency (noSlot) -> resource (materials) -> storage (storageFull). NOTE the
// materials-BEFORE-storageFull nuance (plan §F3): F2's startFabricateJob DELEGATED the
// affordability check to startProcess (so it ran AFTER the cap check). canFabricate must
// surface `materials` explicitly, so it checks inputs HERE, before the cap gate, mirroring
// how canResearch checks credits explicitly rather than relying on startProcess. This is a
// reason-ordering choice only: every failing gate still yields the SAME { started:false,
// same-ref } outcome F2 produced (F2 exposed no reason), so it is behavior-preserving.
export function canFabricate(
  state: GameState,
  blueprintKey: string
): { ok: true } | { ok: false; reason: FabricateBlockReason } {
  // --- Identity: the key must name a real blueprint. An absent def means "not a real
  // blueprint" (bad caller / stale UI reference), checked first so every later gate can
  // safely read `bp`.
  const bp = BLUEPRINTS[blueprintKey];
  if (!bp) return { ok: false, reason: "notFound" };

  // --- Unlock-only guard (Combat 0.13.0 warship research gate): an UNLOCK-ONLY blueprint
  // (unlockOnly: true) crafts NOTHING, it has no recipe.outputItem and no equipmentOutput, so
  // a fabricate job would mint an empty output. It is not a fabricatable thing REGARDLESS of
  // research/tier/resource state (researching it grants Shipyard build access, not a craft), so
  // reject it FIRST, before the ownership gate, with its own honest reason. This is the engine-
  // level guarantee behind the F4 UI also filtering these out of the craftable-blueprint list.
  // Classified via blueprintKind (0.13.0), the single home for the shape precedence.
  if (blueprintKind(bp) === "unlockOnly") return { ok: false, reason: "unlockOnly" };

  // --- Ownership: the blueprint must be RESEARCHED (unlocked via the Research Lab) before
  // it can be fabricated. Pure membership test, surfaced as its own reason.
  if (!blueprintUnlocked(state, blueprintKey)) return { ok: false, reason: "notResearched" };

  // --- Tier unlock: the fabricator's LEVEL must have reached the blueprint's tier, the
  // SAME level-derived tier gate the Research Lab uses (facilityLevel >= tier).
  if (bp.tier > facilityLevel(state, FABRICATOR_FACILITY_KEY)) {
    return { ok: false, reason: "tierLocked" };
  }

  // --- Concurrency: a free fabricate slot, count in-flight fabricateJobs against the cap
  // (facility upgrades do not consume fabricate slots). At 0 slots (unbuilt fabricator) this
  // is always full -> no job can start. The EXACT slot accounting startRefineJob uses.
  const activeFabricateJobs = state.activeProcesses.filter((p) => p.kind === "fabricateJob").length;
  if (activeFabricateJobs >= fabricateSlotCount(state)) return { ok: false, reason: "noSlot" };

  // --- Resource: every recipe input must be affordable (on-hand >= required). recipe.inputs
  // amounts are plain numbers; an absent inventory key reads as 0 (the SAME affordability
  // test startProcess applies, checked HERE so the `materials` reason surfaces BEFORE the
  // cap gate). Any single short input blocks the whole craft.
  for (const itemId of Object.keys(bp.recipe.inputs)) {
    // Quality-bucketed (Task 9a): affordability reads the item TOTAL via itemTotal
    // (absent key -> 0), the bucketed twin of the old scalar `state.inventory[itemId] ?? 0`.
    const have = itemTotal(state.inventory, itemId);
    if (have.lt(bp.recipe.inputs[itemId])) return { ok: false, reason: "materials" };
  }

  // --- Storage: the output component must not be at its warehouse cap. Reads the SAME
  // materialAtCap seam the refine order + missions/trickle auto-stop on (AT the cap counts
  // as full). A full component store cannot start new crafts.
  // Equipment 0.11.0 (Task 19): an EQUIPMENT blueprint (equipmentOutput present) is EXEMPT from
  // the WAREHOUSE cap, it mints an EquipmentInstance into state.equipment and has no stackable
  // output, so the material storage cap must not block it. Same exemption canStartLine/stepCraftLine
  // apply. blueprintKind === "material" narrows this to a MATERIAL blueprint (unlock-only was
  // already rejected above), so an INSTANCE-minting shape falls to the else branch. Combat 1.0
  // (Unit 1.2b): a WEAPON blueprint is NOT "material" either, so it correctly joins the equipment
  // path here (its crafted weapon is a SPARE in the capped equipment pool, same as an economy
  // system). A material blueprint always carries recipe.outputItem, the inner `!== undefined`
  // guard only satisfies the now-optional field type.
  if (blueprintKind(bp) === "material") {
    if (bp.recipe.outputItem !== undefined && materialAtCap(state, bp.recipe.outputItem)) {
      return { ok: false, reason: "storageFull" };
    }
  } else if (equipmentAtCap(state)) {
    // Equipment 0.11.0 (Task B1): an EQUIPMENT or WEAPON blueprint mints a SPARE crafted instance
    // into the CAPPED pool. A full spare store refuses the START, the equipment twin of the
    // storageFull stop above (distinct reason so the F4 UI can surface the equipment cap). Relieved
    // by salvage (C1) / the storage upgrade (B2). A material craft never reaches this branch.
    return { ok: false, reason: "equipmentStorageFull" };
  }

  return { ok: true };
}

// Starts ONE fabricate job for `blueprintKey`. As of Task F3 this is a THIN WRAPPER over
// canFabricate (above), canFabricate is the single source of truth for every gate
// (notFound, notResearched, tierLocked, noSlot, materials, storageFull), so this function
// only (a) consults it, (b) on a block returns the SAME state ref + started:false + the
// block reason (so callers/UI can show WHY), and (c) on ok deducts the recipe inputs
// ATOMICALLY at start (via startProcess) and pushes a "fabricateJob" TimedProcess whose
// completion effect { type: "addItem", itemId: recipe.outputItem } adds the component
// (resolveProcesses grants it + marks it discovered + bumps lifetimeStats.itemsCrafted).
//
// The return keeps the START family's { next, started } shape (startProcess / startRefineJob
// / startResearch) and ADDS an OPTIONAL `reason` (undefined on success) EXACTLY the way
// startResearch exposes canResearch's reason, purely additive, so callers reading only
// { next, started } (e.g. processFabricateOrder) are unaffected.
//
// ⚠️ ANTI-REGRESSION (Task F3): the SUCCESS path is UNCHANGED from F2, same inputs map,
// same startProcess call (which applies its own final affordability gate + atomic deduct),
// same "addItem" effect. Only the guards moved into canFabricate; startProcess's deduct is
// what actually spends the inputs, so the deduct-at-start behavior is byte-for-byte the same.
export function startFabricateJob(
  state: GameState,
  blueprintKey: string
): { next: GameState; started: boolean; reason?: FabricateBlockReason } {
  // The single consolidated gate. On a block: same-ref no-op (the reject convention every
  // other start/action in this file shares) + the reason, so a blocked start can never be
  // mistaken for a no-op change.
  const gate = canFabricate(state, blueprintKey);
  if (!gate.ok) return { next: state, started: false, reason: gate.reason };

  // gate.ok GUARANTEES a real, researched, tier-available blueprint with a free slot,
  // affordable inputs, and output room, so the def lookup below cannot fail, recomputed
  // here (rather than threaded out of canFabricate) to keep canFabricate a clean predicate.
  const bp = BLUEPRINTS[blueprintKey];

  // Build the Decimal inputs map from the recipe's plain-number amounts (recipe QUANTITIES,
  // wrapped at the deduct site exactly as fuel/research constants are). Then hand off to
  // startProcess, which applies the FINAL affordability gate + atomic deduct and pushes the
  // "fabricateJob" TimedProcess whose completion effect adds the component. UNCHANGED from F2.
  const inputs: Record<string, Decimal> = {};
  for (const itemId of Object.keys(bp.recipe.inputs)) {
    inputs[itemId] = new Decimal(bp.recipe.inputs[itemId]);
  }

  // Equipment 0.11.0 (Task 19): branch on the output SHAPE. An EQUIPMENT (or, Combat 1.0 Unit 1.2b,
  // WEAPON) blueprint hands off an addEquipment(blueprintKey) effect (resolveProcesses mints the
  // EquipmentInstance at completion, rolling stats off the seeded rng via generateEquipment /
  // generateWeapon per the blueprint's output shape, and grants no stackable output). A MATERIAL
  // blueprint hands off the UNCHANGED addItem effect (byte-identical to pre-Task-19). The inputs
  // deduct + startProcess call are otherwise identical for every shape.
  // The material branch always has recipe.outputItem/outputQty (equipment + weapon blueprints omit
  // them); the `?? ""` / `?? 1` fallbacks are inert there and only satisfy the optional field type.
  // blueprintMintsEquipmentInstance (equipment OR weapon) selects the mint effect; behavior-identical
  // to the prior `=== "equipment"` for material/equipment blueprints (canFabricate above already
  // rejected unlock-only, so bp is material, equipment, or weapon here).
  const effect: ProcessEffect =
    blueprintMintsEquipmentInstance(bp)
      ? { type: "addEquipment", blueprintKey }
      : { type: "addItem", itemId: bp.recipe.outputItem ?? "", amount: new Decimal(bp.recipe.outputQty ?? 1) };

  return startProcess(state, "fabricateJob", inputs, bp.craftDurationTicks, effect);
}

// The standing single-order model for the Fabricator (startFabricateOrder /
// stopFabricateOrder) was RETIRED in Task C4, together with its Refinery twin and the
// processRefineOrder/processFabricateOrder engines (already gone in C2). The per-slot
// production LINE engine (startLine/cancelLine + processFabricateLines) is the sole
// crafting model now.

// ============================================================================
// Fuel Depot pipeline engine (Fuel Economy v2 F2, design §2).
//
// processFuelPipelines(state): the per-tick engine, called ONCE per economyTick (AFTER
// resolveProcesses + the production-line engine, so a pipeline slot freed by a batch COMPLETING
// this tick is immediately refillable this same tick, no idle gap). PURE: returns a
// NEW state, or the SAME reference when no pipeline runs.
//
// UNLIKE the refine ORDER (a player-set standing instruction on refineOrder), the Fuel
// Depot's pipelines are ALWAYS-ON / AUTOMATIC, there is no order object and no manual
// start. Every tick the depot tries to fill its free pipeline slots with fuel-refine
// batches while it has room + ice. So there is NO order-state / pausedReason to persist
// (a paused pipeline is just "no batch started this tick"; F4's fuel chip derives the
// production rate on read). The batches themselves ARE persisted, each is a
// "fuelRefineJob" TimedProcess in activeProcesses (rides saves like any refine job).
//
// It mirrors processRefineOrder's structure/idiom, with fuel-tank semantics:
//   - PIPELINE SLOTS = fuelPipelineCount - (fuelRefineJobs already in flight). Fills only
//     up to the pipeline count, exactly what caps concurrency at fuelPipelineCount.
//   - TANK FULL: fuel >= fuelCap -> stop (the fuel-tank analog of materialAtCap; the
//     SAME auto-stop idea the mission / refine-order pauses use).
//   - ICE OUT: Deuterium Ice (`deuteriumIce`) < the batch input -> stop.
//   Both gates are checked BEFORE starting a batch (i.e. BEFORE startProcess consumes
//   ice), so NO ice is ever stranded: ice is only deducted when a batch actually begins,
//   and a batch only begins when there is tank room AND enough ice. A batch already in
//   flight always deposits its full output on completion (may overshoot fuelCap by up to
//   one batch, the same soft-cap overshoot the warehouse producers have).
//
// AUTO-RESUME is STRUCTURAL (no state): each tick re-reads fuel / ice fresh, so the tick
// a block lifts (mission burns fuel below cap / more ice is mined) the depot starts
// batches again, no explicit un-pause. Because it lives inside economyTick, it runs
// identically live (App.svelte per bar) and offline (tick() steps economyTick(_,1) per
// tick), the SAME one-seam guarantee the refine order + Task B3 auto-stop rely on, so
// tick(bigSpan) == looping economyTick(_,1) for fuel + ice.
//
// Bounded work: at most fuelPipelineCount (<= a few) batches start per call, so the loop
// is tightly bounded even across a 172,800-tick offline catch-up (once per free slot, not
// once per tick), no Omega-14 unbounded-loop concern.
export function processFuelPipelines(state: GameState): GameState {
  const pipelines = fuelPipelineCount(state);
  if (pipelines <= 0) return state; // no Fuel Depot / no pipelines -> same-reference no-op

  const input = fuelBatchInput(state);   // ice consumed per batch (Decimal)
  const output = fuelBatchOutput(state); // fuel produced per batch (Decimal)
  const cap = fuelCap(state);            // current tank cap

  let working = state; // threaded immutably as each startProcess returns fresh state
  while (true) {
    // A free pipeline slot must exist. All pipelines busy -> stop (not a "pause", the
    // depot is working at capacity). SAME slot accounting startRefineJob's gate uses.
    const inFlight = working.activeProcesses.filter((p) => p.kind === "fuelRefineJob").length;
    if (inFlight >= pipelines) break;

    // TANK FULL -> stop. fuel does not rise within THIS call (batch deposits happen on
    // future ticks via resolveProcesses), so this is invariant across the loop, but it is
    // checked here for symmetry with the ice gate and to mirror processRefineOrder.
    if (working.fuel.gte(cap)) break;

    // ICE OUT -> stop. Checked BEFORE consuming (gate-before-deduct), so short ice never
    // gets partially consumed / stranded. Absent key reads as 0 (grow-on-demand).
    // Fuel-sourcing RESTRUCTURE (2026-07-15): the ice is now the dedicated `deuteriumIce`
    // item (mined on localFuelRun), NOT `commonOre`, commonOre feeds only the material
    // Refinery again. This is the ONLY input the Fuel Depot draws on.
    // Quality-bucketed (Task 9a): ice on hand is the item TOTAL via itemTotal (absent
    // key -> 0), the bucketed twin of the old scalar `working.inventory["deuteriumIce"] ?? 0`.
    const iceOnHand = itemTotal(working.inventory, "deuteriumIce");
    if (iceOnHand.lt(input)) break;

    // Gates pass -> start ONE batch via the SHARED startProcess engine: it deducts the
    // ice ATOMICALLY at start and pushes a "fuelRefineJob" TimedProcess whose completion
    // effect { type: "addFuel" } deposits `output` fuel (resolveProcesses). Its own
    // affordability gate re-checks the ice we just verified and cannot reject here; the
    // defensive `!started` break guarantees loop termination regardless.
    const { next, started } = startProcess(working, "fuelRefineJob", { deuteriumIce: input }, FUEL_REFINE_DURATION_TICKS, {
      type: "addFuel",
      amount: output,
    });
    if (!started) break;
    working = next;
  }
  return working;
}

// ============================================================================
// fuelFlowSummary, the DISPLAY-ONLY fuel-economy readout (Fuel net-display fix,
// 2026-07-16).
//
// PURPOSE / THE BUG IT FIXES: the top-bar fuel chip and the Fuel Depot "REFINING"
// panel used to subtract mission burn from the refinery's THEORETICAL MAX
// throughput (a CEILING) UNCONDITIONALLY, so when the player was OUT of
// Deuterium Ice (the refinery actually produces 0) the Net still read POSITIVE.
// Reported symptom: "even when I'm out of deuterium ice, it's still showing a net
// positive." This helper computes an EFFECTIVE production that is 0 exactly when
// the real refinery makes 0, and derives the Net + sufficiency from that.
//
// PURE / READ-ONLY: mutates nothing, spends nothing, starts no process. It does
// NOT touch the tick engine, processFuelPipelines (above) is unchanged and
// still the sole authority on what the refinery DOES. This function only mirrors
// that authority's GATES so the DISPLAY matches reality.
//
// GATE MIRROR (must stay in lockstep with processFuelPipelines' three stop
// conditions above):
//   - pipelines <= 0                       -> no depot / no pipelines -> makes 0
//   - fuel >= fuelCap (tank full)          -> throttled to 0 (tank topped off)
//   - iceOnHand < fuelBatchInput (ice out) -> makes 0 (nothing to refine)
// iceOnHand reads the SAME `state.inventory["deuteriumIce"] ?? 0` (Decimal) the
// engine reads, the dedicated fuel-ore item, not commonOre.
//
// BURN: the per-tick mission-fuel-burn sum was MOVED here from App.svelte (it
// previously lived inline in the fuel reactive block). Moving it in pulls in ZERO
// new imports, MISSIONS, SHIP_TYPES, fuelNeeded, requiredTicksForPhase,
// effectiveMissionDef, shipDerivedStats are ALL already imported by this module
// (the engine computes the same burn during ticks). This makes the summary fully
// self-contained (testable from a GameState alone) and keeps burn as ONE source
// of truth in the engine module, right next to the production it is compared to.
// ============================================================================

// The five phases of one full mission round-trip, in order. Summing each phase's
// required ticks (on the SHIP-ADJUSTED def) gives the real cadence a mission
// burns its fuelNeeded over, so burn/tick = fuelNeeded / cycleTicks. Reuses
// requiredTicksForPhase (the SAME per-phase length the tick engine advances on),
// so this length cannot drift from the engine's actual cycle.
const FUEL_CYCLE_PHASES: MissionPhase[] = ["ordersReceived", "transitOut", "extracting", "transitBack", "unloading"];

// Total ticks in ONE full round-trip cycle of `baseMission` when flown by `ship`,
// summed over all five phases of the ship-adjusted def (effectiveMissionDef
// rescales transit by the hull's speed). Guards a 0/negative sum at the call site.
function missionCycleTicks(baseMission: MissionDef, ship: ShipInstance): number {
  const eff = effectiveMissionDef(baseMission, shipDerivedStats(ship));
  return FUEL_CYCLE_PHASES.reduce((total, phase) => total + requiredTicksForPhase(phase, eff), 0);
}

// The shape the fuel UI reads. See the fields' inline notes for each meaning.
export interface FuelFlowSummary {
  maxProductionPerTick: number; // CEILING: pipelines * fuelBatchOutput / duration (informational "Production (max)")
  effectiveProductionPerTick: number; // hasIce ? maxProductionPerTick : 0 , THE FIX (0 when the refinery really makes 0)
  iceInputPerTick: number; // Deuterium Ice consumed at full throughput: pipelines * fuelBatchInput / duration
  burnPerTick: number; // per-tick mission-fuel-burn sum across every captain currently on a mission
  netPerTick: number; // effectiveProductionPerTick - burnPerTick (the honest steady-state net)
  hasIce: boolean; // pipelines > 0 && iceOnHand >= fuelBatchInput (a batch can actually start)
  tankFull: boolean; // fuel >= fuelCap (refining throttled to 0 because the tank is topped off)
  refiningActive: boolean; // hasIce && !tankFull (a batch is genuinely being refined right now)
  sufficient: boolean; // netPerTick >= 0 || tankFull, topped-off tank counts as fine even when throttled
}

export function fuelFlowSummary(state: GameState): FuelFlowSummary {
  const pipelines = fuelPipelineCount(state);
  const batchInput = fuelBatchInput(state); // Decimal (ice per batch)

  // CEILING production + its ice cost, the UNCHANGED formulas the old chip used.
  // Guarded against a 0 duration exactly as the App.svelte block was.
  const maxProductionPerTick =
    FUEL_REFINE_DURATION_TICKS > 0 ? (pipelines * fuelBatchOutput(state).toNumber()) / FUEL_REFINE_DURATION_TICKS : 0;
  const iceInputPerTick =
    FUEL_REFINE_DURATION_TICKS > 0 ? (pipelines * batchInput.toNumber()) / FUEL_REFINE_DURATION_TICKS : 0;

  // --- Gate mirror (see header). iceOnHand as Decimal, compared with .gte so a
  // 49-ice reserve against a 50-ice batch reads as NO ice, exactly like the
  // engine's `iceOnHand.lt(input)` stop. pipelines > 0 folds the "no depot" stop
  // into hasIce (no pipelines -> nothing can refine -> not "has usable ice").
  // Quality-bucketed (Task 9a): ice on hand is the item TOTAL via itemTotal (absent
  // key -> 0), the bucketed twin of the old scalar `state.inventory["deuteriumIce"] ?? 0`.
  const iceOnHand = itemTotal(state.inventory, "deuteriumIce");
  const hasIce = pipelines > 0 && iceOnHand.gte(batchInput);
  const tankFull = state.fuel.gte(fuelCap(state));
  const refiningActive = hasIce && !tankFull;

  // THE FIX: effective production is the ceiling ONLY when a batch can start.
  // NOTE it is NOT zeroed on tankFull, a full tank is "topped off / fine", and
  // sufficiency (below) treats tankFull as sufficient regardless of net sign.
  const effectiveProductionPerTick = hasIce ? maxProductionPerTick : 0;

  // BURN (moved from App.svelte, formula byte-identical): for every captain
  // CURRENTLY on a mission, that mission's round-trip fuel cost / its cycle
  // length. A captain with no assigned hull contributes 0 (can't fly, can't
  // burn). fuelNeeded reads the BASE mission by its own convention (fuel.ts);
  // the cycle length uses the ship-adjusted def so the rate is fuel per REAL tick.
  const burnPerTick = state.captains.reduce((sum, captain) => {
    if (captain.mission === null) return sum;
    // Combat 0.13.0 (Phase 9b.5c): the fuel-runway burn estimate now knows BOTH arms.
    // PATROL: a patrol burns its two transit legs' fuel over one route; amortize one round
    // trip's fuel over the whole route length (transitOut + rollWindow + transitBack) for a
    // per-real-tick rate, the direct twin of the extraction term below. Uses the UNFOLDED
    // SHIP_TYPES stats, matching the extraction term's fuelNeeded convention (an estimate,
    // not the exact per-cycle spend the tick loop draws). A hull-less patrol captain burns 0.
    if (captain.mission.kind === "patrol") {
      const ship = state.ships.find((s) => s.assignedCaptainId === captain.id);
      if (!ship) return sum;
      const def = PATROLS[captain.mission.patrolKey];
      const routeTicks = def.transitOutTicks + def.rollWindowTicks + def.transitBackTicks;
      if (routeTicks <= 0) return sum;
      return sum + fuelForRoundTrip(def.transitOutTicks, def.transitBackTicks, SHIP_TYPES[ship.typeKey]) / routeTicks;
    }
    // ANY OTHER non-extraction kind is SKIPPED (a future kind that burns fuel must be added
    // EXPLICITLY here, like the patrol arm just above; this site is NOT a compile-time
    // exhaustiveness checkpoint, only economyTick's switch(kind) is). Narrow-and-skip keeps
    // the estimate from crashing on an unhandled kind.
    if (captain.mission.kind !== "extraction") return sum;
    const extractionMission = captain.mission;
    const ship = state.ships.find((s) => s.assignedCaptainId === captain.id);
    if (!ship) return sum;
    const baseMission = MISSIONS[extractionMission.missionKey];
    const cycleTicks = missionCycleTicks(baseMission, ship);
    if (cycleTicks <= 0) return sum;
    return sum + fuelNeeded(baseMission, SHIP_TYPES[ship.typeKey]) / cycleTicks;
  }, 0);

  const netPerTick = effectiveProductionPerTick - burnPerTick;
  // A topped-off tank is fine even though refining is throttled to 0, so it
  // counts as sufficient regardless of the (possibly negative) net.
  const sufficient = netPerTick >= 0 || tankFull;

  return {
    maxProductionPerTick,
    effectiveProductionPerTick,
    iceInputPerTick,
    burnPerTick,
    netPerTick,
    hasIce,
    tankFull,
    refiningActive,
    sufficient,
  };
}

// ============================================================================
// fuelRunwayProjection, "how long until the tank runs dry?" under a FULL-
// SUSTAINABILITY model (Wave 2 fuel-runway readout, 2026-07-16).
//
// PURPOSE: give the player an honest countdown to fuel-empty that CREDITS the
// Deuterium Ice their running missions keep mining. A naive "fuel / burn" ignores
// the refinery topping the tank back up from mission-looted ice; this projects
// the real two-phase trajectory instead.
//
// WHY MEASURED, NOT MODELLED: mission ice output is a stochastic loot roll (rarity
// triads), so there is no clean closed form for "ice mined per tick". The LIVE
// loop (App.svelte) therefore SAMPLES the actual per-tick fuel & ice deltas as an
// EMA and passes them in as dFuelPerTick / dIcePerTick. This function is PURE math
// over those measured rates, no Decimal, no state, no side effects, so the
// entire decision matrix is unit-testable in isolation.
//
// THE TWO PHASES (only reached when ice is actually depleting):
//   Phase 1, ice still on hand: fuel drifts at the measured dFuelPerTick until
//              the ice stockpile hits zero (iceRunway ticks from now).
//   Phase 2, ice gone: the refinery makes nothing, so the tank just burns down
//              at the deterministic mission burn (burnPerTick) with no refill.
// The fuel level entering phase 2 (fuelAtIceOut) is clamped to [0, fuelCap]
// because measured drift can only carry it between empty and a full tank.
//
// sustainable:true  <=> the tank never empties (returns runwayTicks:null).
// sustainable:false  => runwayTicks is a finite tick count >= 0, OR null when a
//                       guard trips (non-finite input / computed value), the UI
//                       renders null as "unknown".
// ============================================================================
export interface FuelRunwayProjection {
  sustainable: boolean; // true => tank never empties (runwayTicks is null)
  runwayTicks: number | null; // finite ticks-until-empty; null = self-sustaining OR unknown (see sustainable)
}

export function fuelRunwayProjection(input: {
  fuel: number; // current fuel in the tank
  fuelCap: number; // tank capacity (phase-1 fuel gain clamps here)
  ice: number; // current Deuterium Ice on hand
  dFuelPerTick: number; // MEASURED net fuel change / tick (EMA); may be + or -
  dIcePerTick: number; // MEASURED net ice change / tick (EMA); may be + or -
  burnPerTick: number; // deterministic mission fuel burn / tick, >= 0 (fuelFlowSummary.burnPerTick)
}): FuelRunwayProjection {
  const EPS = 1e-9; // treat |x| < EPS as "flat" so fp noise doesn't read as drain/growth
  const { fuel, fuelCap, ice, dFuelPerTick, dIcePerTick, burnPerTick } = input;

  // GUARD 1, any non-finite input (NaN / +-Infinity) makes the projection
  // meaningless. Bail to "unknown" before any arithmetic can propagate it.
  const inputs = [fuel, fuelCap, ice, dFuelPerTick, dIcePerTick, burnPerTick];
  if (!inputs.every((n) => Number.isFinite(n))) {
    return { sustainable: false, runwayTicks: null };
  }

  // finalize, the SINGLE exit for a computed countdown. GUARD 2: a non-finite or
  // negative result is nonsensical (e.g. from pathological inputs the finiteness
  // check above cannot catch), so it collapses to "unknown". Otherwise clamp >= 0
  // so a rounding-noise "-0"/tiny-negative never surfaces.
  const finalize = (ticks: number): FuelRunwayProjection => {
    if (!Number.isFinite(ticks) || ticks < 0) {
      return { sustainable: false, runwayTicks: null };
    }
    return { sustainable: false, runwayTicks: Math.max(0, ticks) };
  };

  // STEP 1, no burn: fuel is not being consumed at all, so there is nothing to
  // count down. Self-sustaining by definition, whatever the measured deltas say.
  if (burnPerTick <= EPS) {
    return { sustainable: true, runwayTicks: null };
  }

  // STEP 2, ice is NOT depleting (stockpile flat or growing): the refinery can
  // run indefinitely, so fuel's own measured trend decides the outcome.
  if (dIcePerTick >= -EPS) {
    // Fuel flat or rising -> the refinery keeps up forever. Self-sustaining.
    if (dFuelPerTick >= -EPS) {
      return { sustainable: true, runwayTicks: null };
    }
    // Fuel still net-negative even with unlimited ice -> burn outruns full
    // refining; the tank drains at |dFuelPerTick| per tick.
    return finalize(fuel / -dFuelPerTick);
  }

  // STEP 3, ice IS depleting (dIcePerTick < -EPS): two-phase projection.
  const iceRunway = ice / -dIcePerTick; // ticks until the ice stockpile hits zero

  // Fuel might die BEFORE the ice does. If fuel is also draining and its own
  // runway is no longer than the ice runway, fuel-empty is the first wall.
  if (dFuelPerTick < -EPS && fuel / -dFuelPerTick <= iceRunway) {
    return finalize(fuel / -dFuelPerTick);
  }

  // Otherwise fuel survives to ice-out. Project the tank level at that moment
  // (clamped to a real tank: never below empty, never above cap), then phase 2
  // burns that remaining fuel down with no more refining.
  const fuelAtIceOut = Math.min(Math.max(fuel + dFuelPerTick * iceRunway, 0), fuelCap);
  const phase2 = fuelAtIceOut / burnPerTick; // burnPerTick > EPS guaranteed by STEP 1
  return finalize(iceRunway + phase2);
}

// Advances every active process by `ticksElapsed` and resolves completions. THE
// single completion resolver (Task 9 calls it from BOTH tick() and the live loop).
//
// CLOSED-FORM: one resolveProcesses(state, N) must equal N resolveProcesses(_, 1)
//, for the final inventory TOTALS/facilities/activeProcesses AND the total FA XP. It
// holds because each process's fate is a pure function of its remainingTicks vs
// the elapsed total: decrementing by N once lands the same countdown as
// decrementing by 1 N times, and a process that crosses zero completes exactly
// ONCE either way (it is removed on completion, so a later/again call cannot
// re-complete or re-award it). See the parity test in process.test.ts.
//
// ⚠️ QUALITY-BUCKET CAVEAT (Task 9b): the closed-form equality above is now stated over
// inventory TOTALS (itemTotal), NOT the per-bucket split. Each completion rolls ONE quality
// tier off `rng` (below), and a single big resolveProcesses(_,N) rolls all completions in
// ARRAY order within one call, whereas N stepped resolveProcesses(_,1) rolls them in
// per-TICK completion order; when several processes complete at different ticks in an order
// differing from the array, the two chunkings draw the same rolls in a different order and
// can split identical TOTALS across DIFFERENT buckets. This does NOT affect the game: the
// real economy NEVER calls this with N>1, both offline (tick()) and live (App.svelte) step
// economyTick ONE whole tick at a time, so every real resolveProcesses call sees
// ticksElapsed ~= 1 and completes at most one tick's worth, making the offline==live
// per-bucket parity that actually ships hold by construction (⚠️ parity test in
// quality-roll.test.ts). The N>1 form is a unit-test convenience (process.test.ts) that
// asserts TOTALS via itemTotal, which stay quality-agnostic and exact.
//
// FRACTIONAL-TICK ROBUSTNESS: Task 9 feeds ticksElapsed = deltaSeconds /
// tickDurationSeconds, which can be fractional, so repeated decrements can leave
// a sub-epsilon residue at a completion boundary (e.g. 1e-13 instead of 0), the
// SAME float-drift hazard the mission engine's MISSION_TICK_EPSILON guards. We
// reuse that exact constant: a process is COMPLETE once remainingTicks <=
// MISSION_TICK_EPSILON, so a boundary reached via many small fractional steps
// completes at the same logical point as one big jump. For the integer stepping
// the parity test uses, epsilon is inert (integers hit 0 exactly). durationTicks
// is expected positive; a non-positive-duration process would complete on its
// first resolve, which is the correct reading of "zero-length process".
//
// FA XP is LUMPED on completion: a completed FA-feeding process contributes
// FLEET_ADMIN_XP_PER_DURATION_TICK * durationTicks to fleetAdminXpDelta, exactly
// once (0.12.1: was the bare durationTicks). Task 9 folds the returned delta via
// applyFleetAdminXp (the same path mission FA XP takes). Facility processes award
// NO captain XP (no captain pilots them).
//
// CRAFTING XP (Equipment 0.11.0, Phase 3) is lumped the SAME way, on a DIFFERENT
// set of kinds: a completed PRODUCTION job (refineJob / fabricateJob / shipBuild)
// contributes CRAFTING_XP_PER_DURATION_TICK * durationTicks to craftingXpDelta,
// exactly once. economyTick folds it via applyCraftingXp. So this resolver returns
// TWO independent XP deltas (Fleet Admiral + crafting), each closed-form for the
// same "fires exactly once per completion" reason.
export function resolveProcesses(
  state: GameState,
  ticksElapsed: number,
  // Task 9b: the seeded rng a completing PRODUCTION job (addItem) draws its output's quality
  // roll from. Threaded from economyTick (which owns the fleet's rng) so a job's tier is on
  // the SAME stepped stream mission loot rolls from, making offline==live per-bucket parity
  // structural. Defaults to Math.random so the many unit tests that call resolveProcesses
  // directly with no rng keep working; those assert inventory TOTALS (itemTotal, quality-
  // agnostic), which the roll never changes, so a nondeterministic default tier is harmless
  // there. Non-addItem completions (fuel/blueprint/ship/facility) never touch it.
  rng: () => number = Math.random
): { next: GameState; fleetAdminXpDelta: number; craftingXpDelta: number } {
  // Cheap same-reference no-op: nothing in flight, or no time actually elapsed.
  // Mirrors applyFleetAdminXp's early-out. (Every SURVIVING process always has
  // remainingTicks > epsilon, so a <=0 ticksElapsed call can never leave a
  // ready-to-complete process unresolved by skipping here.)
  if (ticksElapsed <= 0 || state.activeProcesses.length === 0) {
    return { next: state, fleetAdminXpDelta: 0, craftingXpDelta: 0 };
  }

  // Threaded immutably through completions (each addToInventory returns fresh
  // objects); seeded from the incoming state so a call that completes nothing
  // returns value-identical maps. `facilities` is re-cloned per level-up below.
  let inventory = state.inventory;
  let discovered = state.discovered;
  let facilities = state.facilities;
  // Fuel Economy v2 (F2): threaded so a completing fuelRefineJob (Fuel Depot pipeline
  // batch) can deposit its output into the fuel TANK. Seeded from the incoming state's
  // fuel, so a call that completes no fuel batch returns it value-identical (and the
  // empty/no-completion early-out leaves it exactly === state.fuel). A single deposit
  // may push fuel slightly PAST fuelCap, the SAME soft-cap overshoot addItem has vs.
  // a warehouse cap; processFuelPipelines re-gates NEW batches at/over cap next tick.
  let fuel = state.fuel;
  // Task 11: threaded so a completing refineJob can also bump its per-item
  // lifetime itemsRefined tally. Seeded from the incoming state, so a call that
  // completes no refine job returns the SAME lifetimeStats reference (value-
  // identical, the empty-early-out and the no-completion path both leave it
  // untouched). Re-cloned only when a refineJob actually completes below.
  let lifetimeStats = state.lifetimeStats;
  // Research (Task R3): threaded so a completing researchProject can append its unlocked
  // blueprint key. Seeded from the incoming state, so a call that completes no research
  // project returns it value-identical (the empty/no-completion early-out leaves it exactly
  // === state.researchedBlueprints). Re-cloned only when a research project actually completes
  // below, and only when the key is not already present (idempotent, no duplicate).
  let researchedBlueprints = state.researchedBlueprints;
  // Shipyard (Task S3): threaded so a completing shipBuild can mint + append its parked
  // ShipInstance and bump the monotonic id source. Seeded from the incoming state, so a
  // call that completes no ship build returns them value-identical (the empty/no-completion
  // early-out leaves ships exactly === state.ships and nextShipId === state.nextShipId).
  // Re-cloned (ships) / incremented (nextShipId) only when a shipBuild actually completes.
  let ships = state.ships;
  let nextShipId = state.nextShipId;
  // Equipment 0.11.0 (Task 19): threaded so a completing EQUIPMENT fabricateJob (addEquipment)
  // can mint + append its EquipmentInstance and bump the monotonic id source, the EXACT mirror of
  // ships/nextShipId. Also threaded through the addShip branch (Task 20) so a newly-built hull's
  // Standard-Issue baseline mints from the SAME counter. Read DIRECTLY off the incoming state
  // (Task 20 retired the interim `?? []` / `?? 1` guards): MIGRATIONS[26] backfills both fields
  // and MIGRATIONS[27] seeds the pool, so every save reaching here has them, and a genuinely
  // missing field now surfaces loudly rather than silently starting a fresh pool (Omega 6/10).
  // Seeded from the incoming state, so a call that completes no equipment/ship job returns them
  // value-identical (only the addEquipment / addShip branches below re-clone / increment).
  let equipment = state.equipment;
  let nextEquipmentId = state.nextEquipmentId;
  // Equipment 0.11.0 (Task B2): the spare-storage LEVEL, bumped by a completing
  // equipmentStorageUpgrade process (the equipmentStorageLevelUp branch below). Seeded
  // from the incoming state, so a call that completes no storage upgrade returns it
  // value-identical (only that one branch increments it).
  let equipmentStorageLevel = state.equipmentStorageLevel;
  // Fleet Management (Docks Expansion): the docks capacity, bumped by a completing
  // docksExpansion process (the docksCapacityUp branch below). Seeded from the incoming
  // state, so a call that completes no expansion returns it value-identical (only that
  // one branch increments it). Unlike equipmentStorageLevel (a stored LEVEL a derived
  // cap reads), this IS the cap itself, so the +1 lands here directly.
  let shipStorageCapacity = state.shipStorageCapacity;
  let fleetAdminXpDelta = 0;
  // Crafting Level XP (Equipment 0.11.0, Phase 3): accumulates CRAFTING_XP_PER_DURATION_TICK
  // * durationTicks for every PRODUCTION job (refine / fabricate / ship-build) that completes
  // this call, lumped once on completion exactly like fleetAdminXpDelta above. economyTick
  // folds the returned total through applyCraftingXp (the crafting twin of applyFleetAdminXp).
  // Seeded 0, so a call that completes no producing job returns 0 (a same-value no-op through
  // the fold). Closed-form for the SAME reason fleetAdminXpDelta is: each producing process
  // contributes its lump exactly ONCE (it is dropped on completion), so one big resolve and
  // many small resolves accrue the identical total (see the parity test in tick.test.ts).
  let craftingXpDelta = 0;
  // Survivors are rebuilt in original order, so activeProcesses ordering is stable
  // across both chunkings (the parity test compares the arrays deep-equal).
  const stillActive: TimedProcess[] = [];

  for (const process of state.activeProcesses) {
    const remainingTicks = process.remainingTicks - ticksElapsed;
    if (remainingTicks > MISSION_TICK_EPSILON) {
      // Not done, keep it with its decremented countdown. A later resolve picks
      // up exactly here, which is why one N-tick step lands the same remaining as
      // N one-tick steps (closed-form).
      stillActive.push({ ...process, remainingTicks });
      continue;
    }

    // COMPLETE. Apply the effect, award the lump FA XP, and DROP the process
    // (never pushed to stillActive) so it resolves exactly once.
    if (process.effect.type === "addItem") {
      // Quality roll at production (Task 9b): a completed refine/fabricate job rolls ONE
      // quality tier for its whole output amount, which then lands in that tier's bucket via
      // the shared add seam (rather than always bucket 0). Rolled here, ONCE per completion,
      // on the SAME rng stream mission loot uses; because the shipped economy always steps
      // one whole tick at a time (tick() offline, App.svelte live), completions and their
      // rolls occur in the identical order on both paths, so a big offline catch-up
      // distributes crafted output across buckets identically to many small live steps
      // (⚠️ parity test in quality-roll.test.ts). effect.amount is always > 0 for a real
      // recipe, so this always contributes a genuine deposit.
      const quality = rollQuality(rng);
      // Output granted through the shared add seam -> the item is marked
      // discovered (its amount is always > 0 for a real refine recipe). Warehouse cap
      // clamp: the deposit is bounded at the output item's cap (itemCap), so a job
      // completing while just-under-cap lands AT the cap rather than overshooting.
      const applied = addToInventory(
        inventory,
        discovered,
        process.effect.itemId,
        process.effect.amount,
        itemCap(state, process.effect.itemId),
        quality
      );
      inventory = applied.inventory;
      discovered = applied.discovered;
      // Task 11: a completed REFINE JOB (and ONLY a refine job) also accrues the
      // per-item lifetime itemsRefined total. Guarded on kind === "refineJob"
      // because addItem is a shared effect: a facilityUpgrade never uses it, but a
      // FUTURE fabricator "fabricateJob" will, and that must feed itemsCrafted,
      // not itemsRefined, so this stays scoped to refine jobs by kind. Closed-form
      // for the SAME reason FA XP is: it fires exactly ONCE, on the same completion
      // that drops the process (a resolved process is never revisited), so one big
      // resolve and many small ones accrue the identical total. Immutable per-key
      // add (fresh maps), mirroring addToInventory's own grow-on-demand shape:
      // an item absent from itemsRefined starts at 0.
      if (process.kind === "refineJob") {
        const itemId = process.effect.itemId;
        const priorRefined = lifetimeStats.itemsRefined[itemId] ?? new Decimal(0);
        lifetimeStats = {
          ...lifetimeStats,
          itemsRefined: {
            ...lifetimeStats.itemsRefined,
            [itemId]: priorRefined.plus(process.effect.amount),
          },
        };
      } else if (process.kind === "fabricateJob") {
        // Fabricator (Phase 4, Task F2): a completed FABRICATE JOB accrues the per-item
        // lifetime itemsCrafted total, the EXACT mirror of the refineJob -> itemsRefined
        // hook just above, keyed on kind === "fabricateJob" so the shared addItem effect
        // routes to the right lifetime map (a refineJob feeds itemsRefined, a fabricateJob
        // feeds itemsCrafted; a facilityUpgrade never uses addItem). Closed-form for the
        // SAME reason: it fires exactly ONCE, on the completion that drops the process, so
        // one big resolve and many small ones accrue the identical total. Immutable per-key
        // add (fresh maps); an item absent from itemsCrafted starts at 0.
        const itemId = process.effect.itemId;
        const priorCrafted = lifetimeStats.itemsCrafted[itemId] ?? new Decimal(0);
        lifetimeStats = {
          ...lifetimeStats,
          itemsCrafted: {
            ...lifetimeStats.itemsCrafted,
            [itemId]: priorCrafted.plus(process.effect.amount),
          },
        };
      }
    } else if (process.effect.type === "addFuel") {
      // Fuel Economy v2 (F2): a completed Fuel Depot pipeline batch deposits its
      // output into the fuel TANK (not inventory). Plain Decimal add, may overshoot
      // fuelCap by up to one batch (soft cap; re-gated next tick), the SAME behavior
      // addItem has vs. a warehouse cap. No discovery / lifetime accrual (fuel is a
      // currency, not a catalog item). Closed-form: fires exactly ONCE on the
      // completion that drops the process, so one big resolve == many small ones.
      fuel = fuel.plus(process.effect.amount);
    } else if (process.effect.type === "unlockBlueprint") {
      // Research (Task R3): a completed research project UNLOCKS its blueprint by appending
      // the key to researchedBlueprints. IDEMPOTENT, guarded on `.includes` so a duplicate
      // is never added (defensive: startResearch's in-progress gate already prevents two
      // projects for one key, and an unlocked blueprint is not researchable, so a real play
      // path can't reach a double-add, but the resolver stays correct even if it did).
      // A fresh array only when it actually appends (immutable, mirroring the accumulators
      // above). Closed-form: fires exactly ONCE on the completion that drops the process, so
      // one big resolve == many small ones lands the identical set. EXCLUDED from the FA-XP
      // lump award below (see the kind check), research is automated infra like fuel refining.
      const key = process.effect.key;
      if (!researchedBlueprints.includes(key)) {
        researchedBlueprints = [...researchedBlueprints, key];
      }
    } else if (process.effect.type === "addShip") {
      // Shipyard (Task S3): a completed shipBuild MINTS a parked hull. Its id is minted
      // from nextShipId as "ship-N" (the SAME scheme freshState / buyShip use), then
      // nextShipId is bumped so ids stay monotonic and are never reused. assignedCaptainId
      // is null (PARKED, the player assigns it via the Docks). Appended on a FRESH ships
      // array (immutable, mirroring the accumulators above). Storage was gated at START
      // (canBuildShip's storageFull reason), so a build that reached completion always has
      // room, we park UNCONDITIONALLY here rather than re-checking shipStorageCapacity
      // (a completion-time drop would silently destroy a build the player already paid for).
      // Closed-form: fires exactly ONCE on the completion that drops the process, so one big
      // resolve and many small ones mint the identical hull with the identical id.
      const minted: ShipInstance = {
        id: `ship-${nextShipId}`,
        typeKey: process.effect.typeKey,
        assignedCaptainId: null,
      };
      ships = [...ships, minted];
      nextShipId += 1;
      // Equipment 0.11.0 (Task 20): a newly-built hull is born fully fitted with its
      // Standard-Issue baseline on every live slot, so no live slot is ever empty and the
      // hull is dispatchable the moment it is assigned a captain, exactly like freshState's
      // starting hull and a migrated ship. Uses the SHARED seeder threaded through the SAME
      // equipment / nextEquipmentId accumulators this resolver already advances for crafted
      // gear (Task 19), so the ids stay monotonic across builds AND crafts in one resolve.
      const seededHull = seedStandardIssueForShip(minted.id, nextEquipmentId);
      equipment = [...equipment, ...seededHull.pieces];
      nextEquipmentId = seededHull.nextId;
      // Combat 1.0 (Unit 1.3): if the built hull is a COMBAT hull (destroyer/battleship/carrier),
      // ALSO install its free Standard-Issue combat set (weapon + shield emitter + hull plating)
      // so it clears the empty-required-slot dispatch blocker (canDispatchPatrol) the moment it is
      // crewed. Threaded off the ALREADY-advanced nextEquipmentId (economy seed first, combat seed
      // second) so every minted id stays unique + monotonic across builds and crafts in one resolve.
      // A non-combat hull resolves to an empty loadout spec and mints nothing (clean no-op). The
      // shared combatStandardIssueSpecFor resolves the FULL loadout + behaviour-preserving per-hull
      // magnitudes (Unit 1.4) from the SAME tables the migration + captain-grant paths use.
      const seededCombat = seedCombatStandardIssueForShip(
        minted.id,
        combatStandardIssueSpecFor(minted.typeKey),
        nextEquipmentId
      );
      equipment = [...equipment, ...seededCombat.pieces];
      nextEquipmentId = seededCombat.nextId;
    } else if (process.effect.type === "addEquipment") {
      // Equipment 0.11.0 (Task 19): a completed EQUIPMENT fabricate job MINTS a non-stacking
      // EquipmentInstance (NOT an inventory item, and no stackable output). We look up
      // the blueprint's equipmentOutput for the slot/variety, roll the whole piece off the
      // THREADED seeded rng, push it into the pool as a SPARE (fittedToShipId: null, set inside
      // generateEquipment), and bump nextEquipmentId. Mirrors the addShip mint exactly (mint the
      // object, append, advance the id source), the only extra is the seeded stat roll.
      //
      // ⚠️ RNG DRAW ORDER (the WHOLE parity contract, verified by the offline==live test): the
      // stream is drawn in a FIXED order every completion, so tick() (offline, looping
      // economyTick(_,1)) and App.svelte (live, one economyTick(_,1) per poll) advance it
      // identically and mint a BIT-IDENTICAL instance at the same seed:
      //   (1) rollQuality(rng):       variable draw count (1..QUALITY tiers), FIRST
      //   (2) rollCraftedRarity(rng): EXACTLY one draw, SECOND
      //   (3) generateEquipment(...): its internal affixCount + affix-pick draws, LAST
      // Nothing here draws out of band, so parity holds by construction (the SAME argument the
      // addItem quality roll relies on, now extended to two more deterministic draws + the affix
      // rolls). ⚠️ TUNABLE: quality is ROLLED for now (Task 9c will derive it from the input
      // materials' quality); rarity is the first-pass Standard..Radiant weighted base roll
      // (talent-gated Constellar/Luminous/Nova procs are a later refinement); iLevel is clamped by
      // a first-pass per-blueprint-tier cap.
      const bp = BLUEPRINTS[process.effect.blueprintKey];
      const eqOut = bp?.equipmentOutput;
      // A valid blueprint carries EXACTLY ONE output shape, so this equipment-first / weapon-second
      // check order is behavior-identical for all real data to blueprintKind's weapon-first
      // precedence; the two could only differ on a malformed double-shape blueprint, which the data
      // invariant forbids (and both branches mint an EquipmentInstance either way, no parity gap).
      if (bp !== undefined && eqOut !== undefined) {
        const quality = rollQuality(rng); // draw #1 (see order note above)
        const rarity: EquipmentRarity = rollCraftedRarity(rng); // draw #2
        const iLevel = computeItemLevel({
          craftingLevel: state.craftingLevel, // read directly: MIGRATIONS[26] guarantees the field (Task 20 retired the interim ?? 1 guard)
          achievementBoost: 0, // TUNABLE: achievement/FA-talent iLevel boosts are a later refinement
          faTalentBonus: 0,
          itemTierCap: bp.tier * EQUIPMENT_ILEVEL_CAP_PER_TIER, // first-pass per-tier cap (itemgen.ts)
        });
        // Capture the id NOW so the allocateId closure mints the SAME "equip-N" the counter names,
        // then advance the counter (never reused), the id scheme freshState documents.
        const mintedId = nextEquipmentId;
        const minted = generateEquipment({
          slotType: eqOut.slotType,
          varietyKey: eqOut.varietyKey,
          blueprintKey: process.effect.blueprintKey,
          iLevel,
          quality,
          rarity,
          ascension: "none", // base craft: never ascended this patch (see EquipmentAscension)
          rng, // draws #3.. (affix rolls) off the SAME threaded stream
          allocateId: () => `equip-${mintedId}`,
        });
        equipment = [...equipment, minted];
        nextEquipmentId = mintedId + 1;
      } else if (bp !== undefined && bp.weaponOutput !== undefined) {
        // Combat 1.0 (Unit 1.2b): a completed WEAPON fabricate job mints a crafted weapon as an
        // EquipmentInstance (slotType "weapon"), the weapon-shape parallel to the equipment branch
        // above. It draws the SAME rng stream in the SAME documented order (rollQuality #1,
        // rollCraftedRarity #2, then generateWeapon's internal affixCount + affix picks #3..), and
        // mirrors the capture-then-advance nextEquipmentId discipline EXACTLY, so the offline==live
        // parity argument extends unchanged: an else-if means a material or equipment craft draws
        // BYTE-IDENTICALLY to before (this branch never runs for them), and a weapon craft mints a
        // bit-identical instance at the same seed offline and live. Only the minter differs
        // (generateWeapon rolls the weaponYield implicit + weapon affixes off the FIXED base def).
        const quality = rollQuality(rng); // draw #1 (same order as the equipment branch)
        const rarity: EquipmentRarity = rollCraftedRarity(rng); // draw #2
        const iLevel = computeItemLevel({
          craftingLevel: state.craftingLevel,
          achievementBoost: 0, // TUNABLE: same first-pass zeros as the equipment branch
          faTalentBonus: 0,
          itemTierCap: bp.tier * EQUIPMENT_ILEVEL_CAP_PER_TIER, // first-pass per-tier cap (itemgen.ts)
        });
        const mintedId = nextEquipmentId;
        const minted = generateWeapon({
          weaponType: bp.weaponOutput.weaponType,
          blueprintKey: process.effect.blueprintKey,
          iLevel,
          quality,
          rarity,
          ascension: "none", // base craft: never ascended this patch (see EquipmentAscension)
          rng, // draws #3.. (affix rolls) off the SAME threaded stream
          allocateId: () => `equip-${mintedId}`,
        });
        equipment = [...equipment, minted];
        nextEquipmentId = mintedId + 1;
      } else if (bp !== undefined && bp.droneOutput !== undefined) {
        // Combat 1.0 (Unit 2.1b): a completed DRONE fabricate job mints a crafted drone pod as an
        // EquipmentInstance (slotType "droneBay"), the drone-shape parallel to the equipment + weapon
        // branches above. It draws the SAME rng stream in the SAME documented order (rollQuality #1,
        // rollCraftedRarity #2, then generateDronePod's internal affixCount + affix picks #3..), and
        // mirrors the capture-then-advance nextEquipmentId discipline EXACTLY, so the offline==live
        // parity argument extends unchanged: an else-if means a material / equipment / weapon craft
        // draws BYTE-IDENTICALLY to before (this branch never runs for them, and droneOutput
        // blueprints did not exist until this unit), and a drone craft mints a bit-identical instance
        // at the same seed offline and live. Only the minter differs (generateDronePod rolls the
        // droneHp implicit + drone affixes off the FIXED role template).
        const quality = rollQuality(rng); // draw #1 (same order as the equipment/weapon branches)
        const rarity: EquipmentRarity = rollCraftedRarity(rng); // draw #2
        const iLevel = computeItemLevel({
          craftingLevel: state.craftingLevel,
          achievementBoost: 0, // TUNABLE: same first-pass zeros as the equipment/weapon branches
          faTalentBonus: 0,
          itemTierCap: bp.tier * EQUIPMENT_ILEVEL_CAP_PER_TIER, // first-pass per-tier cap (itemgen.ts)
        });
        const mintedId = nextEquipmentId;
        const minted = generateDronePod({
          droneRole: bp.droneOutput.role,
          blueprintKey: process.effect.blueprintKey,
          iLevel,
          quality,
          rarity,
          ascension: "none", // base craft: never ascended this patch (see EquipmentAscension)
          rng, // draws #3.. (affix rolls) off the SAME threaded stream
          allocateId: () => `equip-${mintedId}`,
        });
        equipment = [...equipment, minted];
        nextEquipmentId = mintedId + 1;
      }
      // (bp / equipmentOutput / weaponOutput / droneOutput all missing = a corrupt/hand-edited effect
      // key: mint NOTHING and draw NOTHING, then drop the job. Mirrors lineJobSpec's "unknown recipe
      // -> inert" guard; it can only arise from a tampered save, never a real play path, so parity is
      // unaffected, both paths see the identical corrupt state and both no-op.)
    } else if (process.effect.type === "equipmentStorageLevelUp") {
      // Equipment 0.11.0 (Task B2): a completed equipment-storage upgrade bumps the
      // spare-storage LEVEL by 1, so equipmentStorageCap (model.ts) derives the NEXT
      // rung's higher cap on read. The cap is NEVER stored, only the level, so it can
      // never drift (the anti-drift invariant). Deterministic (no rng), fires exactly
      // ONCE on the completion that drops the process, so it is closed-form like
      // facilityLevelUp: one big offline resolve and many small live steps land the
      // identical level (see the offline==live parity test).
      equipmentStorageLevel += 1;
    } else if (process.effect.type === "docksCapacityUp") {
      // Fleet Management (Docks Expansion): a completed docks expansion raises the
      // docks capacity by 1, so canStartShipBuild (which reads shipStorageCapacity
      // directly) immediately allows one more hull. shipStorageCapacity IS the single
      // source (no derived cap, unlike equipment), so the +1 lands on the field here.
      // Deterministic (no rng), fires exactly ONCE on the completion that drops the
      // process, so it is closed-form like equipmentStorageLevelUp / facilityLevelUp:
      // one big offline resolve and many small live steps land the identical capacity
      // (see the offline==live parity test in docks-expansion.test.ts).
      shipStorageCapacity += 1;
    } else if (process.effect.type === "clearShipDamage") {
      // Combat 0.13.0 (Phase 11, design S13): a completed shipRepair CLEARS the target
      // ship's damage so it becomes dispatchable again. Find the hull by id and drop both
      // `damaged` and `repairDamage` (set to undefined; JSON serialization omits them and
      // deep-equal treats them as absent, so a repaired ship is byte-identical to one that
      // never lost a patrol). A fresh ships array only when the target is present (immutable,
      // mirroring the addShip branch). A STALE shipId (the ship was salvaged mid-repair) hits
      // no row and is a harmless no-op. Deterministic (no rng), fires exactly ONCE on the
      // completion that drops the process, so it is closed-form like the level-up branches:
      // one big offline resolve and many small live steps clear the identical hull.
      const shipId = process.effect.shipId;
      if (ships.some((s) => s.id === shipId)) {
        ships = ships.map((s) =>
          s.id === shipId ? { ...s, damaged: undefined, repairDamage: undefined } : s,
        );
      }
    } else {
      // facilityLevelUp: bump the target facility on a FRESH facilities map
      // (immutable). An absent facility starts from level 0 (grow-on-demand, same
      // posture as inventory), so unlock (0->1) and every later level share one path.
      const facility = process.effect.facility;
      const current = facilities[facility] ?? { level: 0 };
      facilities = { ...facilities, [facility]: { ...current, level: current.level + 1 } };
    }
    // Fleet Admiral XP + crafting XP lump awards on completion, both decided by the
    // ONE per-kind policy table PROCESS_XP_AWARDS (see its comment above for why the
    // two axes differ, and why a single exhaustive Record replaced the former
    // opposite-polarity blacklist + whitelist so a new kind cannot silently inherit
    // one axis but not the other). Each award lumps the full durationTicks once, on
    // the completion tick, closed-form exactly as before (see the parity tests).
    const xpAward = PROCESS_XP_AWARDS[process.kind];
    if (xpAward.fleetAdmin) {
      // 0.12.1: FA lump = FLEET_ADMIN_XP_PER_DURATION_TICK * durationTicks (was the
      // bare durationTicks, an implicit x1). Integer * integer, so the closed-form
      // offline==live parity is preserved exactly (see this function's parity tests).
      fleetAdminXpDelta += FLEET_ADMIN_XP_PER_DURATION_TICK * process.durationTicks;
    }
    if (xpAward.crafting) {
      craftingXpDelta += CRAFTING_XP_PER_DURATION_TICK * process.durationTicks;
    }
  }

  return {
    next: {
      ...state,
      inventory,
      discovered,
      facilities,
      lifetimeStats,
      fuel,
      researchedBlueprints,
      // Shipyard (Task S3): the parked hull(s) minted by any completing shipBuild + the
      // advanced id source. Value-identical to state.ships / state.nextShipId when no ship
      // build completed this call (seeded from them, only touched in the addShip branch).
      ships,
      nextShipId,
      // Equipment 0.11.0 (Task 19): the piece(s) minted by any completing equipment fabricateJob +
      // the advanced id source. Value-identical to state.equipment / state.nextEquipmentId when no
      // equipment craft completed this call (seeded from them, only touched in the addEquipment
      // branch). ⚠️ if the incoming state lacked the fields (pre-migration save), these are the
      // defensively-seeded [] / 1, which is the correct grow-on-demand result.
      equipment,
      nextEquipmentId,
      // Equipment 0.11.0 (Task B2): the spare-storage level, raised by any completing
      // equipmentStorageUpgrade this call. Value-identical to state.equipmentStorageLevel
      // when no storage upgrade completed (seeded from it, only the equipmentStorageLevelUp
      // branch increments it).
      equipmentStorageLevel,
      // Fleet Management (Docks Expansion): the docks capacity, raised by any completing
      // docksExpansion this call. Value-identical to state.shipStorageCapacity when no
      // expansion completed (seeded from it, only the docksCapacityUp branch increments it).
      shipStorageCapacity,
      activeProcesses: stillActive,
    },
    fleetAdminXpDelta,
    craftingXpDelta,
  };
}

// Same "same state reference on failure" convention as every other buy/action
// function in this file. Validates: talent exists, not already unlocked,
// learnable by graph adjacency (a hub, or adjacent to an already-unlocked node
// in this branch, the Radial Skill Web replaced the old single-parent
// `requires` chain with this rule; it mirrors computeVisibleTalents' learnable
// condition so what the UI shows as learnable is exactly what buy allows),
// statPoints sufficient. On success:
// deducts cost, records the unlock. The effect itself isn't APPLIED here --
// each effect type is read wherever that stat matters (the 5 tier-specific
// yield/chance mults inside tickCaptainMission's rollExtractionTick call, see
// the captainCommonYieldMult/captainUncommonYieldMult/captainUncommonChanceMult/
// captainRareChanceMult helpers above) by checking unlockedCaptainTalents at
// read time, same pattern this codebase already uses for e.g. specialization
// multipliers historically. Deliberately generalized wording (not naming
// specific effect types) so this comment doesn't go stale again next time an
// effect type is added/renamed.
export function buyCaptainTalent(
  state: GameState,
  captainId: number,
  talentKey: CaptainTalentKey
): { next: GameState; success: boolean } {
  const idx = state.captains.findIndex((c) => c.id === captainId);
  if (idx === -1) return { next: state, success: false };
  const captain = state.captains[idx];
  const talent = CAPTAIN_TALENTS[talentKey];

  if (captain.unlockedCaptainTalents.includes(talentKey)) return { next: state, success: false };
  // Adjacency gate (Radial Skill Web, Task 5): a node is learnable iff it is a
  // hub OR at least one of its neighbors is already owned. Same rule as
  // computeVisibleTalents (talentWeb.ts), buy and visibility stay consistent.
  const isLearnable =
    talent.isHub || talent.neighbors.some((n) => captain.unlockedCaptainTalents.includes(n));
  if (!isLearnable) return { next: state, success: false };
  if (captain.statPoints < talent.cost) return { next: state, success: false };

  const captains = [...state.captains];
  captains[idx] = {
    ...captain,
    statPoints: captain.statPoints - talent.cost,
    unlockedCaptainTalents: [...captain.unlockedCaptainTalents, talentKey],
  };
  return { next: { ...state, captains }, success: true };
}

// Same shape as buyCaptainTalent, fleet-wide, including the same graph
// adjacency gate: learnable iff a hub, or adjacent to an already-unlocked node
// in this branch (against state.unlockedHomeworldTalents). unlockCaptainSlot is
// the one effect type with additional side effects beyond "record the unlock"
//, appending a new captain via freshCaptainStack() (same baseline every other
// captain-creation path in this codebase uses) AND granting that captain an
// assigned General Freighter, so the "every captain always has exactly one
// assigned ship" invariant holds here too (its third enforcement site, after
// new-game and save migration).
export function buyHomeworldTalent(
  state: GameState,
  talentKey: HomeworldTalentKey
): { next: GameState; success: boolean } {
  const talent = HOMEWORLD_TALENTS[talentKey];

  if (state.unlockedHomeworldTalents.includes(talentKey)) return { next: state, success: false };
  // Adjacency gate (Radial Skill Web, Task 5): learnable iff a hub OR at least
  // one neighbor is already owned. Same rule as computeVisibleTalents.
  const isLearnable =
    talent.isHub || talent.neighbors.some((n) => state.unlockedHomeworldTalents.includes(n));
  if (!isLearnable) return { next: state, success: false };
  // Fleet-Admiral-level wall (Progression Pacing Rework, Task 9): an OPTIONAL
  // gate LAYERED on top of, not replacing, the adjacency check above and the
  // adminPoint cost check below. Only nodes that declare requiresFleetAdminLevel
  // (today: the 3rd/4th captain-slot unlocks, L5/L25, the 2nd-slot unlock is
  // intentionally UNGATED) are gated; nodes without
  // it (undefined) skip this entirely, so the gate is opt-in and every other
  // talent is unaffected. Captains are "wall breakers": recruiting one needs the
  // FA level AND the adminPoint cost AND adjacency, all three (confirmed with the
  // user 2026-07-11). Same "same state reference on failure" convention as every
  // other precondition here, purchase blocked, state returned unchanged.
  if (talent.requiresFleetAdminLevel !== undefined && state.fleetAdminLevel < talent.requiresFleetAdminLevel) {
    return { next: state, success: false };
  }
  if (state.adminPoints < talent.cost) return { next: state, success: false };

  const unlockedHomeworldTalents = [...state.unlockedHomeworldTalents, talentKey];
  const adminPoints = state.adminPoints - talent.cost;

  if (talent.effect.type === "unlockCaptainSlot") {
    // Gated ENTIRELY on the node's own `talent.cost` in adminPoints, checked
    // above, confirmed with the user that Homeworld Talents (fleet-wide
    // Fleet Admiral prestige) are deliberately independent of any individual
    // captain's own level/statPoints, unlike the old captain-scoped
    // CAPTAIN_SLOT_UNLOCKS mechanism this replaced (removed in Task 4).
    // Combat 0.13.0 (Task 1.2): allocate the new captain's id from the monotonic
    // nextCaptainId counter, NOT from captains.length + 1. Length-derivation is safe
    // only while captains are append-only; once a captain can be REMOVED (future
    // captain death) a freed slot would let length+1 reissue a live id and collide.
    // The counter guarantees every new id is strictly greater than any ever issued.
    const nextId = state.nextCaptainId;
    const captains = [
      ...state.captains,
      { id: nextId, label: `Captain ${nextId}`, ...freshCaptainStack() }, // shipType removed (captain no longer owns a hull)
    ];
    // Every captain always has exactly one assigned ship (invariant enforced at
    // new-game, migration, and HERE). A newly-unlocked captain is granted a
    // General Freighter, assigned to them, REGARDLESS of shipStorageCapacity --
    // a captain must have a hull to be dispatchable (cap is 8 > the current 4-
    // captain ceiling, so this never conflicts today).
    const newShipId = `ship-${state.nextShipId}`;
    const ships = [
      ...state.ships,
      { id: newShipId, typeKey: "generalFreighter" as const, assignedCaptainId: nextId },
    ];
    // Equipment 0.11.0 (Task 20): that granted hull is born fully fitted with its
    // Standard-Issue baseline on every live slot (never-empty invariant), so the new
    // captain is dispatchable immediately, the SAME shared seeder freshState / the save
    // migration / the shipBuild completion use. nextEquipmentId is threaded forward.
    const seededHull = seedStandardIssueForShip(newShipId, state.nextEquipmentId);
    // Combat 1.0: mirror the shipBuild path and ALSO install the combat baseline, threaded off the
    // economy seed's advanced id. Today the granted hull is ALWAYS a generalFreighter; every hull is
    // now combat-capable, so this seeds its weak Standard-Issue combat set (one autocannon + shield +
    // plating), leaving the granted freighter dispatchable to combat patrols like any other hull.
    const seededCombat = seedCombatStandardIssueForShip(
      newShipId,
      combatStandardIssueSpecFor("generalFreighter"),
      seededHull.nextId
    );
    return {
      next: {
        ...state,
        captains,
        ships,
        nextShipId: state.nextShipId + 1,
        nextCaptainId: nextId + 1, // Combat 0.13.0 (Task 1.2): consume the monotonic captain-id counter

        equipment: [...state.equipment, ...seededHull.pieces, ...seededCombat.pieces],
        nextEquipmentId: seededCombat.nextId,
        adminPoints,
        unlockedHomeworldTalents,
      },
      success: true,
    };
  }

  return { next: { ...state, adminPoints, unlockedHomeworldTalents }, success: true };
}

// Full-reset only (no per-node refunds), refunds every statPoints this
// captain spent across their ENTIRE unlockedCaptainTalents list, then clears
// it. Costs RESPEC_COST_CREDITS credits, fleet-wide (credits aren't
// per-captain). Fails with the SAME state reference if the captain doesn't
// exist or credits are insufficient, same convention as every other
// buy/action function in this file.
//
// The optional `newSpec` argument bundles a spec change into this SAME
// reset+cost (per the design doc's Captain Specialization section) --
// omitting it (or passing `undefined`) leaves the captain's CURRENT spec
// untouched, so a plain "reset my talents" click doesn't force a spec
// change. Passing an explicit spec (including `null`, to clear it) sets
// `captain.spec` atomically with the talent wipe, same cost either way.
// Does NOT validate that `newSpec` is a real, unlocked-for-selection branch
// (i.e. one with a CAPTAIN_SPEC_BONUS entry), that's a UI-layer concern
// (App.svelte only offers selectable specs as options in the first place),
// same "trust the caller" boundary this codebase already draws elsewhere.
export function respecCaptainTalents(
  state: GameState,
  captainId: number,
  newSpec?: CaptainTalentBranch | null
): { next: GameState; success: boolean } {
  const idx = state.captains.findIndex((c) => c.id === captainId);
  if (idx === -1) return { next: state, success: false };
  if (state.credits.lt(RESPEC_COST_CREDITS)) return { next: state, success: false };

  const captain = state.captains[idx];
  const refund = captain.unlockedCaptainTalents.reduce((sum, key) => sum + CAPTAIN_TALENTS[key].cost, 0);

  const captains = [...state.captains];
  captains[idx] = {
    ...captain,
    statPoints: captain.statPoints + refund,
    unlockedCaptainTalents: [],
    // NOT `newSpec ?? captain.spec`, `??` would also replace an explicit
    // `null` (clear spec) with captain.spec, indistinguishable from omitting
    // the argument entirely. Must stay a strict `undefined` check.
    spec: newSpec === undefined ? captain.spec : newSpec,
  };
  return { next: { ...state, captains, credits: state.credits.minus(RESPEC_COST_CREDITS) }, success: true };
}

// FREE first-pick spec setter (Radial Skill Web, Task 14). Sets a captain's
// spec ONLY when it is currently null, the free, one-time "choose your
// specialization" pick a captain makes before their talent web appears. It is
// deliberately NOT the way to CHANGE an already-chosen spec: once
// captain.spec !== null, this function refuses (returns the same state
// reference, success: false), and the ONLY path to a different spec is
// respecCaptainTalents(state, captainId, null), clearing the spec back to
// null (refunding points, charging RESPEC_COST_CREDITS) so this free pick
// becomes available again. That split (first pick free here; changing an
// established spec costs exactly one respec) is a confirmed design decision:
// choosing from null undoes nothing, so it's free; changing an existing spec
// means abandoning a built talent web, which is what the respec charge exists
// to gate. Unlike respecCaptainTalents this touches NO cost and NO points --
// it only sets captain.spec. Same "same state reference on failure"
// convention and immutable "map captains, spread the one" idiom as every
// other captain-mutating function in this file.
export function chooseCaptainSpec(
  state: GameState,
  captainId: number,
  branch: CaptainTalentBranch
): { next: GameState; success: boolean } {
  const idx = state.captains.findIndex((c) => c.id === captainId);
  if (idx === -1) return { next: state, success: false };
  // Only the FREE first pick is allowed here. A captain that already has a
  // spec must go through respecCaptainTalents(..., null) to clear it first --
  // see this function's header comment for why changing an established spec is
  // deliberately not free.
  if (state.captains[idx].spec !== null) return { next: state, success: false };

  const captains = [...state.captains];
  captains[idx] = { ...captains[idx], spec: branch };
  return { next: { ...state, captains }, success: true };
}

// Full-reset only, same as respecCaptainTalents, but EXCLUDES unlockCaptainSlot
// nodes entirely, those stay permanently unlocked (no refund, not removed
// from unlockedHomeworldTalents) since undoing one would mean deleting an
// existing captain and everything on it (their own Captain Talents, any
// in-progress mission, cargo). Confirmed with the user rather than silently
// making resets destructive. Fails with the SAME state reference if credits
// are insufficient.
export function respecHomeworldTalents(state: GameState): { next: GameState; success: boolean } {
  if (state.credits.lt(RESPEC_COST_CREDITS)) return { next: state, success: false };

  const refundableKeys = state.unlockedHomeworldTalents.filter(
    (key) => HOMEWORLD_TALENTS[key].effect.type !== "unlockCaptainSlot"
  );
  const refund = refundableKeys.reduce((sum, key) => sum + HOMEWORLD_TALENTS[key].cost, 0);
  const survivingKeys = state.unlockedHomeworldTalents.filter(
    (key) => HOMEWORLD_TALENTS[key].effect.type === "unlockCaptainSlot"
  );

  return {
    next: {
      ...state,
      adminPoints: state.adminPoints + refund,
      unlockedHomeworldTalents: survivingKeys,
      credits: state.credits.minus(RESPEC_COST_CREDITS),
    },
    success: true,
  };
}
