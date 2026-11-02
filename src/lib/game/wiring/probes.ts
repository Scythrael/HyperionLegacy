// WR-1 (0.14.0 wiring registry, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 3): the SEAM
// PROBES and the minimal fixture builders the registry's sensitivity level reads.
//
// A probe is a PURE function: (state, context) -> the one number a registry entry should move, read through the
// real exported engine function its consumer calls (the ship stat sheet, the mission def, the dispatch snapshot of an
// expedition, a combatant, a facility reader, ...). No probe writes state, so the Debug "Wiring" panel (WR-3) can run
// them on a live save. The fixtures build from freshState() with the one starting hull ("ship-1") and its captain.
//
// Nothing here changes engine behavior: every probe calls code the game already runs. Where a consumer computes its
// value inline (the extraction roll's chance thresholds, the passive trickle), the probe drives the real tick with a
// controlled rng and reads what it delivered.

import Decimal from "break_infinity.js";
import {
  BLUEPRINTS,
  DEFAULT_MEMBER_GAMBIT,
  EQUIPMENT_SLOTS,
  FIELD_KITS_DEFAULT_GRENADE_RULES,
  fieldKitsShownBlueprints,
  grenadeCraftPool,
  ITEMS,
  MEMBER_SLOT_TYPES,
  MISSIONS,
  PATROLS,
  patrolRouteOf,
  patrolRouteTicks,
  REFINE_RECIPES,
  SALVAGE_LOOT_POOLS,
  SHIP_TYPES,
  favoredSpecStamp,
  blueprintResearchable,
  effectiveMissionDef,
  equipmentStorageCap,
  outboundLegSpeed,
  returnLegSpeed,
  groundTeamCount,
  freshState,
  missionPhaseTicks,
  rollQuality,
  type AffixAlignment,
  type AffixId,
  type AwayMember,
  type AwayTeamType,
  type CaptainMissionState,
  type CaptainState,
  type CrewBucket,
  type CrewRank,
  type CrewProfession,
  type CrewRace,
  type EquipmentInstance,
  type Expedition,
  type ExpeditionBody,
  type ExpeditionPlanetType,
  type GambitActionId,
  type GambitRule,
  type GambitStatusId,
  type GambitTargetSelector,
  type GameState,
  type RegionTier,
  type TimedProcessKind,
  type MissionKey,
  type ObjectiveAffix,
  type OfficerStats,
  type SeniorStaffSeat,
  type SeniorStaffOfficer,
  type ShipComplement,
  type CrewSignature,
  type ShipInstance,
  type ShipTypeKey,
  type SnapshotMember,
  type AwayTraitId,
  type ExpeditionActivity,
  type GroundTeamRun,
  memberVariety,
  type MemberPerkId,
  type PatrolMissionState,
  type ShortRangeMissionState,
  type ShortRangePhase,
  withGeneralMuseumRecord,
  emptyMuseumV2,
  RELIC_DEFAULT_SEED,
  type RelicVaultToken,
} from "../model";
// Relics v2 R2-3: identification v2 (the expected reveals the probe below is checked against).
import { applyRelicIdentification, identifyRelicV2 } from "../relicIdentify";
import {
  canBuildShip,
  canBuildFacilityUpgrade,
  canDispatch,
  startLine,
  startResearch,
  patrolPhaseFor,
  captainBonusRollChance,
  captainBonusRollChanceMult,
  captainSpecBonusRollChance,
  craftingItemLevelBonus,
  dispatchCaptainOnMission,
  dispatchCaptainOnPatrol,
  startRelicStudy,
  canResearch,
  economyTick,
  fabricateSlotCount,
  fleetRareYieldMult,
  fleetReachBonus,
  installMissingCombatBaselines,
  missionUnlocked,
  museumResearchDurationTicks,
  queueDepth,
  refineJobDurationTicks,
  refineSlotCount,
  researchSlotCount,
  salvageSlotCount,
  shipBuildDurationTicks,
  shipRangeLightYears,
  shipRepairDurationTicks,
  shipyardBayCount,
  startProcess,
  startSalvageJob,
  resolveProcesses,
  relicStudySlotCount,
  shipyardRepairSpeedBonus,
  tierCap,
  xpPerTick,
} from "../tick";
// WR-7 follow-up (OC-D5): the sheet a dispatched captain mission reads (its favored-spec stamp decides).
import { missionRunSheet } from "../gearWearEngine";
import { TRANSPORT_WINDOW_SECONDS } from "../transports";
import { OVERTIME_PROCESS_KINDS, buyOvertime } from "../processSpeed";
import { combatHullTypeOf, shipToCombatant } from "../combat/bridge";
import type { Combatant, CombatWeapon } from "../combat/types";
import type { DroneRole, DroneSquadron } from "../combat/drones";
import type { WeaponId } from "../combat/weapons";
import { fireWeapon, resolveBattle } from "../combat/resolveBattle";
import { makeWeaponInstance } from "../combat/weapons";
import { makeSquadron } from "../combat/drones";
import { replenishUnits } from "../combat/droneDefense";
import { generateEnemyWave } from "../combat/enemyWave";
import type { PirateHullId } from "../combat/enemyHulls";
import { STATUS_EFFECT_DEFS, activeStatDelta, applyEffect, tickEffects } from "../combat/statusEffects";
import { makeRng } from "../combat/rng";
// WR-8 (0.14.0): the combat descriptors' probes (a leaf module) and the resist lines' pools.
import { COMBAT_DESCRIPTOR_PROBES } from "./combatDescriptorProbes";
import { EMITTER_RESIST_LINES, PLATING_RESIST_LINES } from "../combat/combatRules";
import { generateEquipment, rollDistinctAffixStats } from "../itemgen";
import { wearProbeDef, type WearProbeId } from "./wearProbes";
import {
  advanceExpedition,
  candidateReach,
  candidateSystemById,
  candidateVoyage,
  claimExpedition,
  depositExpeditionFindings,
  discoveryOddsPermille,
  expeditionCandidates,
  expeditionLaunchView,
  expeditionSystemGate,
  resumableSystems,
  returnDurationSeconds,
  bodyDiscoveryAttempts,
  rollBodyDiscoveries,
  scanEncounterChance,
  scanRatePerSecond,
  startExpedition,
  tierCandidateSystems,
  anomalyChartPermille,
  chartedAnomalyFinding,
  type CandidateSystem,
  type ExpeditionDispatchResult,
} from "../expedition";
// Expedition Tiers G2-6: the region picker's readers (the console's tab per tier reads expeditionTierGates).
import { driveClassReachMult, expeditionTierGates, shipDriveClass } from "../propulsion";
import { LY_PER_TICK } from "../fuel";
import { tripReachRamp } from "../tick";
import { REGION_TIERS } from "../galaxy";
import { tierHaulMult } from "../riskFactors";
import { relicBlankStamp, relicBlankTable } from "../relicBlanks";
import {
  GAMBIT_STATUSES,
  activityRelicFindBonus,
  relicChancePermille,
  relicTierCeiling,
  rollRelicToken,
  applyStatus,
  buildRosterCombatants,
  deriveAwayTeam,
  evaluateAndAct,
  expeditionTeamCombatants,
  firstAidEffectiveness,
  gambitPresetPrograms,
  generateEncounter,
  resolveGroundBattle,
  resolveTarget,
  strikeHitChance,
  tickEndOfRound,
  applyBoneHit,
  statusResistPermille,
  type BattleState,
  type GambitLogEvent,
  type GroundCombatant,
} from "../gambit";
import { FIELD_DEVICES_VERSION, FIELD_KITS, FIELD_KITS_CATALOG_VERSION, FIELD_KITS_RUNS_LIVE, type FieldKitId } from "../fieldKits";
import { withThrownGrenades } from "../fieldKitsGrenades";
import { FIELD_KITS_BATTLE, withFieldKitsDefaultProgram } from "../fieldKitsBattle";
import { fieldworkEffect, fieldworkHazardResist, fieldworkSpeedMult } from "../fieldwork";
import { taskFullHaul, taskSecurityHazardResist } from "../groundTasks";
// Wiring WR-9: the Ground Ops offload step, the complement generator and a signature's contribution.
import { groundOffloadSeconds } from "../groundOps";
import { contributionForSignature } from "../crew";
import { generateComplementCrew } from "../crewGeneration";
import { CREW_RANKS, buffCountForRank } from "../crewRank";
import { getCrewBuffById } from "../crewBuffs";
import { missionCycleTiming } from "../model";
import { awayRecruitCandidates, snapshotMembers } from "../awayTeam";
import { officerPromotionCounter, seniorStaffCandidates } from "../seniorStaff";
import { applyExpeditionInjuries, injuryRecoverySeconds, shipInjuryFactors } from "../injuries";
import { boardingRepelChance, buildShipCombatant, shipSalvageScale, snapshotShipEventProfile } from "../shipScanEvents";
import { shipsWithMemberAutoSlotted } from "../groundTeamSlots";
import { canFitEquipment, equippedFor, fitEquipment } from "../equipment";
// E-MOD EM-7: the v1 module roster (the install-gate slot count probe installs it piece by piece).
import { UNIVERSAL_MODULES } from "../shipModules";
import { effectiveShipStats, officerCombatMods, officerRepairSpeedBonus, resolveCrew, shipCrewContribution, shipMissionOutputBonus, shipRepairSpeedBonus } from "../crewOverlay";
import { departmentFacet, pilotCunningStamp, seatFacet } from "../officerStats";
import { RELICS, museumBonuses, type MuseumStat } from "../relics";
import { hullTeardownFraction, salvageSalvagedMaterial, salvageShip, salvageTalentBonus, salvageTierReach, salvageYieldMult } from "../salvage";
import { alertResetSeconds, escalationAt, extraBattleChance, longRangeCover, maxExtraBattles } from "../affixes";
import { ENEMY_RANK_IDS, ENEMY_RANKS_VERSION, type EnemyRank } from "../enemyRanks";
import { taskFightGuard, taskFightTeam } from "../groundFight";
import { buyFieldKits, sellItem } from "../quartermaster";
// Field Kits FKR-7: the run plumbing (the free basic set at an objective start, the bay share).
import { carriedExtras, fieldKitsStamp, refreshObjectiveSupplies } from "../fieldKitsRun";
import { RETURN_SECONDS, ambushStrike, groundDeviceChance, groundOpsBayCare, groundTeamBaySeconds, visitReinforcements, type GroundTaskRef } from "../groundOps";
import { retirementExpMultiplier } from "../captainRetirement";
import { transitBerthCount } from "../berths";
import { shortRangeBoardSlots, startShortRangeCycle } from "../shortRangeBoard";
import { newReactorLiftFlag } from "../reactorSurplus";
import { RELIC_BLANKS_VERSION } from "../relicBlanks";
import { rollShortRangeJob, shortRangeCycleReward, shortRangeShipRatings, type ShortRangeCyclePlan, type ShortRangeRoll, type ShortRangeTemplateKey } from "../shortRange";
import { blindLaunchCount, telescopeReading } from "../telescope";
import { SENIOR_STAFF_BONUSES, getSeniorStaffBonusById } from "../seniorStaffBonuses";
import { CREW_STAT_KEYS } from "../crewBuffs";
import {
  CLEARING_SITE_CATALOG,
  HOSTILE_SITE_CATALOG,
  POI_CATALOG,
  PLANET_TYPES,
  groundSiteFlavor,
  planetTypeHazard,
  poiMaterialMult,
  poiRelicOddsMult,
  poisForPlanetType,
} from "../expeditionContent";
import { memberFieldworkTotal } from "../fieldwork";
import { taskWorkSeconds } from "../groundTasks";
import { buildHomeDashboard } from "../homeDashboard";
import { rarityProfile } from "../rarityProfiles";

import { rollHaul } from "../gambit";
import { damageControlEffect, pathfinderEffect } from "../utilityGear";
import { installedSensorArray, sensorArrayCanisterBandLift, sensorArrayEffect, sensorArrayRelicFindBonus } from "../sensorArrays";
// Gas Giant Study GG-7: the special blueprints' table.
import { PRESSURE_FORGED_PLATING_VARIETY, SPECIAL_BLUEPRINT_KEYS } from "../specialBlueprints";
import { CREW_PROFESSIONS, complementTotalCap, remainingCapacityForSignature } from "../commandStructure";
import { bridgeOfficerMultiplier, hullSpecOf, installedBridgeModule, quartersCapacityBonus } from "../crewModules";
// WR-5b (0.14.0): the captain Tactician seams.
import { captainWaveRegenFraction, patrolWaveRewardMult, shipCaptainCombatMods } from "../captainTacticianEffects";
import { captainDroneDamage, captainProjectileDamage, incomingHitChance } from "../combat/captainEdge";
import { applyProjectileDamage } from "../combat/resolveBattle";
import { addItemQuality, itemTotal } from "../inventory";
import { GROUND_CONDITIONS, conditionCureSeconds, memberBaySeconds } from "../medicalBay";
import { loadoutSlotDefsForShipType } from "../armory";
import { gambitProgramEquals } from "../memberGambits";
// Gas Giant Study GG-2 / GG-3: the study engine and its content.
import {
  GALILEO_VARIETY,
  GIANT_MASS_STEPS,
  giantDepthFactor,
  giantMassAt,
  isOrbitalPlanetType,
  rollGiantProfile,
  rollNebulaReward,
  rollStudyReward,
  studyCanisterScale,
} from "../gasGiantStudy";
import { ANCIENT_DATA_FRAGMENT_ID, GAS_CANISTER_IDS, GIANT_CLASSES, NEBULA_KINDS, canistersInBand, type GiantClassDef, type GiantClassId, type NebulaKindDef, type NebulaKindId, type ResearchFamily } from "../gasGiantContent";
// Gas Giant Study GG-5: the Research Lab's data study lane.
import { DATA_STUDY_RECIPE_PERMILLE, DATA_STUDY_TICKS, researchFamilyOf, rollDataStudyRecipe, setDataStudyPaused } from "../dataStudy";
// Relics v2 R2-10: the minigame's relic boosts (one-way: the main game's Museum read by the secret game). This audit
// reads them; no gameplay file of the main game does (relicBoosts.test.ts).
import { RELIC_TIER_LEVERS, OC_FACTOR as SECRET_OC_FACTOR, AP_POW as SECRET_AP_POW, type RelicLever } from "../../secret/config";
import { relicBoostsFromMuseum } from "../../secret/relicBoosts";
import { freshSecretState, type SecretState } from "../../secret/state";
import {
  tierMultiplier as secretTierMultiplier,
  overclockMultiplier as secretOverclockMultiplier,
  tenBonusFactor as secretTenBonusFactor,
  gamePace as secretGamePace,
  captainGain as secretCaptainGain,
  fleetGain as secretFleetGain,
  prestigeceptionGain as secretPrestigeceptionGain,
  augmentMultiplier as secretAugmentMultiplier,
} from "../../secret/engine";

// ============================================================================
// Contexts (every context a claim can cover; plan section 3.2)
// ============================================================================

export const CONTEXT_IDS = [
  "sheet", // the crew-boosted ship stat sheet (effectiveShipStats): missions, dispatch gates, berths, readouts
  "mission:extraction",
  "mission:survey",
  "mission:transport",
  "mission:shortRange", // G1: a short-range mission cycle (the G1-4 cycle engine, shortRangeCycle.ts)
  "patrol", // ship battles (patrols and the Ground Ops ship events build the same combatant)
  "shipyard", // Shipyard repair, builds, bays
  "expedition:groundOps", // a run dispatched since GO-7b (every new run)
  "expedition:legacy", // a run dispatched before GO-7b (only old in-flight saves)
  "shipEvent", // the Ground Ops ship-side scan events
  "ground", // ground battles (the Security squad)
  "ground:noInflict", // a Security member wearing no inflict piece
  "fieldwork", // the Science party's work on a task
  "medbay", // injury recovery
  "craft",
  "salvage", // recycling a piece or salvaging a material
  "salvage:teardown", // tearing down a hull
  "salvage:topTier", // a Fleet Admiral past the last loot-tier threshold
  "research",
  "facility",
  "fleet", // account-level (talent readers, queues, trickle)
  "captain", // captain progression
] as const;
export type ContextId = (typeof CONTEXT_IDS)[number];

// ============================================================================
// Fixtures
// ============================================================================

export const WIRING_SHIP_ID = "ship-1";
export const WIRING_CAPTAIN_ID = 1;
// WR-9 (OC-E4): the cycles the missionReturnTicks probe counts.
export const PILOT_PROBE_CYCLES = 40;
export const NO_OFFICER_BONUS = { id: "wiring.none", magnitude: 0 };

export type Transform = (s: GameState) => GameState;
export const identity: Transform = (s) => s;

// A fresh save with room to work (credits), optionally on another hull.
export function wiringBase(typeKey?: ShipTypeKey): GameState {
  const base = freshState();
  const s: GameState = { ...base, credits: new Decimal(1_000_000) };
  return typeKey ? editShip(s, { typeKey }) : s;
}

// A combat hull with its Standard Issue combat gear installed (plating, emitters, weapons, pods).
export function combatBase(typeKey: ShipTypeKey = "destroyer"): GameState {
  return installMissingCombatBaselines(wiringBase(typeKey));
}

export function shipOf(s: GameState): ShipInstance {
  const ship = s.ships.find((sh) => sh.id === WIRING_SHIP_ID);
  if (!ship) throw new Error("wiring fixture: no ship-1");
  return ship;
}

export function captainOf(s: GameState): CaptainState {
  const c = s.captains.find((cap) => cap.id === WIRING_CAPTAIN_ID);
  if (!c) throw new Error("wiring fixture: no captain 1");
  return c;
}

export function editShip(s: GameState, over: Partial<ShipInstance>): GameState {
  return { ...s, ships: s.ships.map((sh) => (sh.id === WIRING_SHIP_ID ? { ...sh, ...over } : sh)) };
}

export function editCaptain(s: GameState, over: Partial<CaptainState>): GameState {
  return { ...s, captains: s.captains.map((c) => (c.id === WIRING_CAPTAIN_ID ? { ...c, ...over } : c)) };
}

// Seat one officer on ship-1 carrying `bonusIds` at their catalog magnitude (an ensign stores the base magnitude).
// The default race is FIXTURE_RACE (the Belter: its racial acts only on a carrier's patrol drone screen), so a fixture
// officer moves nothing else through its race. The Earth-born racial (the first default) is Crew Effectiveness, live
// since CP-2, which would lift every complement buff the fixture also carries.
export function seatOfficer(
  s: GameState,
  seat: SeniorStaffSeat,
  bonusIds: readonly string[],
  opts: { race?: CrewRace; stats?: OfficerStats; id?: string } = {},
): GameState {
  const bonuses = bonusIds.map((id) => ({ id, magnitude: getSeniorStaffBonusById(id)!.magnitude }));
  const officer = {
    id: opts.id ?? `wiring-officer-${seat}`,
    seat,
    name: `Wiring ${seat}`,
    race: opts.race ?? FIXTURE_RACE,
    gender: "nonbinary",
    rank: "ensign" as const,
    bonuses: [bonuses[0] ?? NO_OFFICER_BONUS, bonuses[1] ?? NO_OFFICER_BONUS] as [typeof NO_OFFICER_BONUS, typeof NO_OFFICER_BONUS],
    missionsCompleted: 0,
    assignedShipId: WIRING_SHIP_ID,
    ...(opts.stats ? { stats: { ...opts.stats } } : {}),
  };
  return { ...s, officers: [...s.officers.filter((o) => o.seat !== seat || o.assignedShipId !== WIRING_SHIP_ID), officer] };
}

// 0.14.0 SPEED SEAM: one running job per Overtime context, each RUNNING_JOB_TICKS long: a hull build (shipyard), a
// research project (research) and a facility rung (facility). Started through the shared startProcess engine.
export const RUNNING_JOB_TICKS = 1000;
const RUNNING_JOB_KIND: Partial<Record<ContextId, TimedProcessKind>> = { shipyard: "shipBuild", research: "researchProject", facility: "facilityUpgrade" };
export function withRunningJobs(s: GameState): GameState {
  let out = startProcess(s, "shipBuild", {}, RUNNING_JOB_TICKS, { type: "addShip", typeKey: "generalFreighter" }).next;
  out = startProcess(out, "researchProject", {}, RUNNING_JOB_TICKS, { type: "unlockBlueprint", key: "frameSegmentBp" }).next;
  return startProcess(out, "facilityUpgrade", {}, RUNNING_JOB_TICKS, { type: "facilityLevelUp", facility: "refinery" }).next;
}

// Buy ONE Overtime step on every running job it is offered on (a job it is not, or a refusal, is left as it is).
export function overtimeOneStep(s: GameState): GameState {
  let out = s;
  for (const p of s.activeProcesses) {
    if (OVERTIME_PROCESS_KINDS.includes(p.kind)) out = buyOvertime(out, { kind: "process", id: p.id }).next;
  }
  return out;
}

export const WIRING_BUCKET_COUNT = 20; // a real-sized complement bucket (standard rarity, Crewman rank)

// CP-2: the race fixture crew and officers carry unless a test names one, chosen so a bucket's race never lifts the
// buff under test. Every racial acts since 0.14.0 (user "everything wired" 2026-10-20), so this is the Belter, whose
// racial (Deck Handling) acts only on a carrier's patrol drone screen: no other probe reads it, and the Deck Handling
// probes compare two states that both carry it. (The Spacer, the CP-2 choice, now lifts the transit speed.)
export const FIXTURE_RACE: CrewRace = "belter";

export function bucketOf(profession: CrewProfession, buff1Id: string, count = WIRING_BUCKET_COUNT, race: CrewRace = FIXTURE_RACE): CrewBucket {
  return { profession, rarity: "standard", rank: 1, race, buff1Id, buff2Id: null, count };
}

export function withBuckets(s: GameState, buckets: readonly CrewBucket[]): GameState {
  return editShip(s, { complement: { mode: "active", buckets: [...buckets] } });
}

// Install a piece on ship-1, replacing any piece of the same slot type (the readers take the first match).
export function installPiece(s: GameState, over: Omit<Partial<EquipmentInstance>, "slotType"> & { slotType: string }): GameState {
  const piece: EquipmentInstance = {
    id: `wiring-equip-${over.slotType}`,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: null,
    implicitStats: {},
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: WIRING_SHIP_ID,
    ...over,
  } as EquipmentInstance;
  const rest = s.equipment.filter((e) => !(e.fittedToShipId === WIRING_SHIP_ID && e.slotType === over.slotType));
  return { ...s, equipment: [...rest, piece] };
}

export function withFacilityLevel(s: GameState, key: string, level: number): GameState {
  return { ...s, facilities: { ...s.facilities, [key]: { level } } };
}

// Relics v2 R2-1: the record is the Tier I general record (museumV2.general["1"], where the v1 copies live).
export function withMuseum(s: GameState, record: Readonly<Record<string, number>>): GameState {
  return withGeneralMuseumRecord(s, record);
}

export function withHomeworld(s: GameState, keys: readonly string[]): GameState {
  return { ...s, unlockedHomeworldTalents: [...s.unlockedHomeworldTalents, ...keys] as GameState["unlockedHomeworldTalents"] };
}

// == away team ==

export const WIRING_SECURITY_ID = "member-901";
export const WIRING_SCIENCE_ID = "member-902";

export function wiringMember(id: string, teamType: AwayTeamType, over: Partial<AwayMember> = {}): AwayMember {
  return {
    id,
    teamType,
    spec: teamType === "science" ? "geology" : "offense",
    name: `Wiring ${id}`,
    race: "earthBorn",
    gender: "female",
    rank: 1,
    traits: [],
    assignedShipId: WIRING_SHIP_ID,
    ...over,
  } as AwayMember;
}

// Ship-1 fields one Security member and one Science member, slotted into its first ground team (the D18 minimum).
export function withAwayTeam(s: GameState, security: Partial<AwayMember> = {}, science: Partial<AwayMember> = {}): GameState {
  const members = [wiringMember(WIRING_SECURITY_ID, "security", security), wiringMember(WIRING_SCIENCE_ID, "science", science)];
  const awayMembers = [...s.awayMembers.filter((m) => !members.some((n) => n.id === m.id)), ...members];
  let ships = shipsWithMemberAutoSlotted(s.ships, WIRING_SHIP_ID, WIRING_SECURITY_ID, "security", awayMembers);
  ships = shipsWithMemberAutoSlotted(ships, WIRING_SHIP_ID, WIRING_SCIENCE_ID, "science", awayMembers);
  return { ...s, ships, awayMembers, nextAwayMemberId: Math.max(s.nextAwayMemberId, 903) };
}

export function editMember(s: GameState, id: string, over: Partial<AwayMember>): GameState {
  return { ...s, awayMembers: s.awayMembers.map((m) => (m.id === id ? ({ ...m, ...over } as AwayMember) : m)) };
}

// Put a member gear piece on a member (a fresh piece id per slot type, so two pieces can be worn together).
export function wearPiece(
  s: GameState,
  memberId: string,
  slotType: string,
  moduleVariant: string,
  lines: Readonly<Record<string, number>>,
): GameState {
  const piece: EquipmentInstance = {
    id: `wiring-wear-${memberId}-${slotType}`,
    slotType,
    moduleVariant,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: null,
    implicitStats: { ...lines },
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: null,
    fittedToMemberId: memberId,
  } as EquipmentInstance;
  const rest = s.equipment.filter((e) => e.id !== piece.id);
  return { ...s, equipment: [...rest, piece] };
}

// The ship's members, frozen exactly as a dispatch freezes them (converted gear, traits, perks).
function rosterOf(s: GameState): { security: SnapshotMember[]; science: SnapshotMember[] } {
  const aboard = s.awayMembers.filter((m) => m.assignedShipId === WIRING_SHIP_ID);
  return {
    security: snapshotMembers(s, aboard.filter((m) => m.teamType === "security")),
    science: snapshotMembers(s, aboard.filter((m) => m.teamType === "science")),
  };
}

// The Security squad's battle combatants, built by the real roster builder.
function squadCombatants(s: GameState): GroundCombatant[] {
  const roster = rosterOf(s);
  return buildRosterCombatants(roster.security, 0, "wiring");
}

function memberCombatant(s: GameState, memberId: string): GroundCombatant | undefined {
  return squadCombatants(s).find((c) => c.memberId === memberId);
}

// A minimal fieldwork run (the readers only need the roster and the crew strength).
function fieldworkRun(s: GameState): Pick<Expedition, "roster" | "scienceStrength"> {
  return { roster: rosterOf(s) as Expedition["roster"], scienceStrength: 0 };
}

const PLANET_IDS = PLANET_TYPES.map((p) => p.id as ExpeditionPlanetType);

// The best value over every planet type (planet-tuned tools count only on their own worlds).
function bestOverPlanets(f: (p: ExpeditionPlanetType) => number): number {
  return Math.max(...PLANET_IDS.map(f));
}

// == expeditions ==

// Dispatch ship-1 on its first candidate (the away team must be aboard). The run's frozen record is what every
// expedition consumer reads, so most expedition probes read it or a consumer of it. Expedition Tiers G2-4: the
// PRE-G2-4 dispatch (propulsion gates off): ship-1 is the starting General Freighter, which a player can no longer send
// on an expedition (not an explorer), and the probes measure what the run reads, never the hull gate (propulsion's own
// probes read it). The record is what a gated dispatch of a ship that passes would write.
export function dispatchRun(s: GameState): Expedition {
  const ready = s.awayMembers.some((m) => m.assignedShipId === WIRING_SHIP_ID) ? s : withAwayTeam(s);
  const cand = expeditionCandidates(ready, WIRING_SHIP_ID)[0];
  const res = startExpedition(ready, WIRING_SHIP_ID, WIRING_CAPTAIN_ID, cand.id, true, FIELD_KITS_RUNS_LIVE, false);
  if (!res.success || !res.expedition) throw new Error(`wiring dispatch refused: ${res.reason}`);
  return res.expedition;
}

export function syntheticBody(planetType: ExpeditionPlanetType, hazard: number): ExpeditionBody {
  return { id: `wiring-${planetType}-${hazard}`, planetType, scanTotal: 120, scanProgress: 0, hazard, scanned: false, discoveries: [], activities: [] };
}

// == inventory ==

export function heldOf(s: GameState, item: string): number {
  return Number(itemTotal(s.inventory, item));
}

// The state holding `qty` more of `item` (quality 0).
export function holding(s: GameState, item: string, qty: Decimal): GameState {
  return { ...s, inventory: addItemQuality(s.inventory, item, qty, 0) };
}

// == missions ==

// Put captain 1 on `missionKey` in `phase`, at the start of the phase.
export function onMission(s: GameState, missionKey: MissionKey, phase: CaptainMissionState["phase"]): GameState {
  const mission: CaptainMissionState = {
    kind: "extraction",
    missionKey,
    phase,
    phaseProgressTicks: 0,
    cargo: { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) },
    recalled: false,
  } as CaptainMissionState;
  return editCaptain(s, { mission } as Partial<CaptainState>);
}

// One extracting tick of captain 1 on `missionKey`, every economy draw returning `draw`: the cargo it took.
function extractingCargo(s: GameState, missionKey: MissionKey, draw: number): { common: number; uncommon: number; rare: number } {
  const after = economyTick(onMission(s, missionKey, "extracting"), 1, () => draw);
  const m = captainOf(after).mission as CaptainMissionState | null;
  const cargo = m && "cargo" in m ? m.cargo : undefined;
  return {
    common: cargo ? Number(cargo.commonOre) : 0,
    uncommon: cargo ? Number(cargo.uncommonMaterial) : 0,
    rare: cargo ? Number(cargo.rareMaterial) : 0,
  };
}

// The chance threshold the extraction roll compares its draw against, found by bisection on a constant-draw rng:
// the largest draw that still lands the tier. `tier` "rare" is the first draw; "uncommon" the second (a draw above
// the rare threshold falls through to it).
function extractionThreshold(s: GameState, missionKey: MissionKey, tier: "rare" | "uncommon"): number {
  // A draw below the rare threshold lands rare, so the uncommon search starts above it (the base odds' midpoint).
  const def = MISSIONS[missionKey];
  let lo = tier === "rare" ? 0 : (def.rareChance + def.uncommonChance) / 2;
  let hi = 1;
  const lands = (d: number) => extractingCargo(s, missionKey, d)[tier] > 0;
  if (!lands(lo + 1e-12)) return 0;
  for (let i = 0; i < 44; i++) {
    const mid = (lo + hi) / 2;
    if (lands(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

function missionDefFor(s: GameState, missionKey: MissionKey) {
  return effectiveMissionDef(MISSIONS[missionKey], effectiveShipStats(s, shipOf(s)));
}

const BIG_HOLD = 100;
function bigHoldMissionDef(s: GameState) {
  const stats = effectiveShipStats(s, shipOf(s));
  return effectiveMissionDef(MISSIONS.longOreRun, { ...stats, cargoCapacity: stats.cargoCapacity * BIG_HOLD });
}

// == ship combat ==

export function playerCombatant(s: GameState): Combatant {
  const ship = shipOf(s);
  const hullType = combatHullTypeOf(ship.typeKey) ?? undefined;
  return shipToCombatant({
    id: "wiring-player",
    team: "player",
    stats: SHIP_TYPES[ship.typeKey],
    hullType,
    installedGear: equippedFor(s, ship.id),
    officerCombat: officerCombatMods(s, ship),
    // WR-5b: the commanding captain's Tactician talents (absent without a node).
    captainCombat: shipCaptainCombatMods(s, ship),
  });
}

// WR-5b: the ship's combatant in a claimed ship-battle context: the patrol fold (shipToCombatant, as every wave
// builds it) or the Ground Ops ship-event combatant from the profile frozen at dispatch.
function battleCombatant(s: GameState, ctx: ContextId): Combatant {
  return ctx === "shipEvent" ? shipEventCombatant(s) ?? playerCombatant(s) : playerCombatant(s);
}

// WR-5b: ship-1's patrol, dispatched (the cycle its waves fight with, frozen at dispatch).
function dispatchedPatrol(s: GameState): PatrolMissionState {
  const r = dispatchCaptainOnPatrol(s, WIRING_CAPTAIN_ID, "crimsonReaverSweep", "balanced", false);
  if (!r.success) throw new Error(`wiring patrol refused: ${r.reason}`);
  return captainOf(r.next).mission as PatrolMissionState;
}

// WR-5b: the drone screen a claimed ship-battle context fields: the patrol cycle's seeded carry-state, or the ship
// event's combatant.
function battleDrones(s: GameState, ctx: ContextId): DroneSquadron[] {
  return ctx === "shipEvent" ? battleCombatant(s, ctx).drones : dispatchedPatrol(s).playerDrones;
}

// 0.14.0 (CP-4): the banked between-wave replenish of the dispatched cycle's first squadron, every drone destroyed, as a
// share of the plain rate. 0 when the cycle fields no squadron.
export const REPLENISH_PROBE_TICKS = 100_000;
function patrolReplenishShare(s: GameState): number {
  const first = dispatchedPatrol(s).playerDrones[0];
  if (!first || first.droneReplenishRate <= 0) return 0;
  const sq: DroneSquadron = { ...first, drones: first.drones.map((d) => ({ ...d, alive: false })) };
  let units = 0;
  for (let t = 0; t < REPLENISH_PROBE_TICKS; t++) units += replenishUnits(sq);
  return units / (REPLENISH_PROBE_TICKS * first.droneReplenishRate);
}

// WR-5b: the mean damage of 1,000 raw-100 projectiles from the combatant's first weapon (Alpha Strike's opening shot
// spent, unless `opening`), at a target `above` half hull or below it, through the seam fireWeapon calls.
const SHOT_RAW = 100;
function meanShot(c: Combatant, above: boolean, opening = false): number {
  const weapon = { ...c.weapons[0], openingVolley: opening ? c.weapons[0].openingVolley : false, damageCarryMilli: 0 };
  const target = { hull: above ? 100 : 40, hullMax: 100 };
  if (opening) return captainProjectileDamage(c.captainEdge, weapon, target, SHOT_RAW);
  let total = 0;
  for (let i = 0; i < 1000; i++) total += captainProjectileDamage(c.captainEdge, weapon, target, SHOT_RAW);
  return total / 1000;
}

// == Shipyard gates ==

// 1 when canBuildShip(generalFreighter) does not stop at `gate` (it may still stop at a later gate), else 0.
function buildGatePassed(s: GameState, gate: string): number {
  const r = canBuildShip(s, "generalFreighter");
  return r.ok || r.reason !== gate ? 1 : 0;
}

// == crafting ==

// The threshold the quality roll's first climb compares its draw against, with the museum's crafting quality
// bonus (the same rollQuality call the Fabricator makes), found by bisection on a constant draw.
function qualityClimbThreshold(bonus: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 44; i++) {
    const mid = (lo + hi) / 2;
    if (rollQuality(() => mid, bonus) >= 1) lo = mid;
    else hi = mid;
  }
  return lo;
}

// WR-5a: one delivery of captain 1's shortOreRun (the last unloading tick of a recalled cycle carrying 10 Titanium
// Ore), every economy draw returning `draw`: the quality rung the delivered ore landed at.
function deliveryTick(s: GameState, draw: number, over: Partial<CaptainState> = {}): { before: GameState; after: GameState } {
  const def = missionDefFor(s, "shortOreRun");
  const cargo = { commonOre: new Decimal(10), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) };
  const mission = {
    kind: "extraction",
    missionKey: "shortOreRun",
    phase: "unloading",
    phaseProgressTicks: missionPhaseTicks("unloading", def, cargo) - 1,
    cargo,
    recalled: true,
  } as CaptainMissionState;
  const before = editCaptain(s, { ...over, mission } as Partial<CaptainState>);
  return { before, after: economyTick(before, 1, () => draw) };
}

// WR-5a (Motherlode): the share of MOTHERLODE_BATCH real deliveries (captain 1's lifetime Motherlode counter at 0 to
// MOTHERLODE_BATCH - 1) whose 10 Titanium Ore landed doubled. G1-4: at mission:shortRange, real Supply Pickup
// deliveries (the training roll's units of Titanium Ore).
const MOTHERLODE_BATCH = 1000;
function motherlodeRate(s: GameState, ctx?: ContextId): number {
  const shortRange = ctx === "mission:shortRange";
  const units = shortRange ? shortRangeJobRoll(s, "supplyPickup").units ?? 0 : 10;
  let doubled = 0;
  for (let i = 0; i < MOTHERLODE_BATCH; i++) {
    const { before, after } = shortRange ? shortRangeDeliveryTick(s, 0.999999, { motherlodeCycles: i }) : deliveryTick(s, 0.999999, { motherlodeCycles: i });
    if (heldOf(after, "commonOre") - heldOf(before, "commonOre") > units) doubled++;
  }
  return doubled / MOTHERLODE_BATCH;
}

// == short-range missions (G1-4, the cycle engine shortRangeCycle.ts) ==

// The first cycle index on short-range slot 0 (Tier I) whose roll is `template`, on `s`'s counters (a fresh save: the
// template's training run, its smallest roll).
const SHORT_RANGE_PROBE_SLOT = { id: 0, tier: 1 as const };
function shortRangeJobIndex(s: GameState, template: ShortRangeTemplateKey): number {
  for (let i = 0; i < 2000; i++) if (rollShortRangeJob(s, SHORT_RANGE_PROBE_SLOT, i).template === template) return i;
  throw new Error(`wiring: no ${template} roll on slot 0`);
}
export function shortRangeJobRoll(s: GameState, template: ShortRangeTemplateKey): ShortRangeRoll {
  return rollShortRangeJob(s, SHORT_RANGE_PROBE_SLOT, shortRangeJobIndex(s, template));
}

// Captain 1 flying that roll on ship-1, its cycle started through the board's own seam (startShortRangeCycle), at the
// start of `phase`. Recalled unless `repeat`: the run ends after its one delivered cycle.
export function onShortRangeJob(s: GameState, template: ShortRangeTemplateKey, phase: ShortRangePhase = "transitOut", repeat = false): GameState {
  // E-MOD EM-4: the reactor lift flag a dispatch now writes (none with the Standard-Issue core).
  const reactorLift = newReactorLiftFlag(equippedFor(s, WIRING_SHIP_ID));
  // WR-7 follow-up (OC-D5): and the favored-spec stamp a dispatch now writes (none without a favored piece).
  const favoredSpec = favoredSpecStamp(equippedFor(s, WIRING_SHIP_ID), shipOf(s).typeKey);
  const start = startShortRangeCycle(s, shipOf(s), SHORT_RANGE_PROBE_SLOT, shortRangeJobIndex(s, template), undefined, reactorLift !== undefined, true, favoredSpec === 1);
  const mission: ShortRangeMissionState = {
    kind: "shortRange",
    slotId: 0,
    roll: start.roll,
    plan: start.plan,
    phase,
    phaseProgressTicks: 0,
    recalled: !repeat,
    ...(reactorLift ? { reactorLift } : {}),
    ...(favoredSpec ? { favoredSpec } : {}),
  };
  return { ...editCaptain(s, { mission } as Partial<CaptainState>), runCounts: start.runCounts };
}

function shortRangeMissionOf(s: GameState): ShortRangeMissionState {
  const m = captainOf(s).mission;
  if (m === null || m.kind !== "shortRange") throw new Error("wiring: captain 1 is not on a short-range run");
  return m;
}

// One whole short-range cycle of `template` from its departure to its delivery (economyTick, every draw common).
function shortRangeCycle(s: GameState, template: ShortRangeTemplateKey): { before: GameState; after: GameState } {
  const before = onShortRangeJob(s, template);
  return { before, after: economyTick(before, shortRangeMissionOf(before).plan.totalTicks, () => 0.5) };
}

// The training cycle of `template` on the bare wiring fixture: its roll, its plan and what it pays (the registry's
// short-range template magnitudes read these).
export function shortRangeTrainingCycle(template: ShortRangeTemplateKey): { roll: ShortRangeRoll; plan: ShortRangeCyclePlan; credits: number } {
  const s = wiringBase();
  const m = shortRangeMissionOf(onShortRangeJob(s, template));
  return { roll: m.roll, plan: m.plan, credits: shortRangeCycleReward(m.roll, effectiveShipStats(s, shipOf(s))).credits };
}

// G1-5 (short-range relic drops): the planned length of the cycle the relic probe flies, in hours. Long enough that
// each tier's expected finds are whole numbers, so the count is exact (rollShortRangeRelicBlanks still takes its
// remainder chance draw, which on a zero remainder can never land):
// Tier I 0.04 an hour x 200 = 8, Tier II 0.075 x 200 = 15.
export const SHORT_RANGE_RELIC_PROBE_HOURS = 200;

// The relic blanks one delivered short-range cycle of `tier` finds through the REAL cycle engine (economyTick): a
// Telescope Repair (no load to pay, no Warehouse gate) on a slot of that tier, its plan stretched on site to
// SHORT_RANGE_RELIC_PROBE_HOURS, recalled so the run ends at the delivery. `flagged`: the run carries G1-5's relic flag
// (a dispatch from G1-5 on); off, the same run as a pre-G1-5 dispatch.
export function shortRangeRelicCycleFinds(s: GameState, tier: 1 | 2, flagged: boolean): number {
  const slot = { id: tier === 1 ? 0 : 2, tier };
  let idx = 0;
  while (rollShortRangeJob(s, slot, idx).template !== "telescopeRepair") if (++idx > 2000) throw new Error("wiring: no telescopeRepair roll");
  const reactorLift = newReactorLiftFlag(equippedFor(s, WIRING_SHIP_ID));
  const start = startShortRangeCycle(s, shipOf(s), slot, idx, undefined, reactorLift !== undefined);
  const total = SHORT_RANGE_RELIC_PROBE_HOURS * 3600;
  const legs = start.plan.transitOutTicks + start.plan.transitBackTicks + start.plan.unloadTicks;
  const plan = { ...start.plan, onSiteTicks: total - legs, totalTicks: total };
  const mission: ShortRangeMissionState = {
    kind: "shortRange",
    slotId: slot.id,
    roll: start.roll,
    plan,
    phase: "transitOut",
    phaseProgressTicks: 0,
    recalled: true,
    ...(flagged ? { relicBlanks: { version: RELIC_BLANKS_VERSION } } : {}),
    ...(reactorLift ? { reactorLift } : {}),
  };
  const after = economyTick({ ...editCaptain(s, { mission } as Partial<CaptainState>), runCounts: start.runCounts }, total + 1, () => 0.5);
  if (captainOf(after).mission !== null) throw new Error("wiring: the relic probe's cycle was not delivered");
  return (after.relicVault ?? []).filter((t) => t.source === "shortRange").length;
}

// The last tick of a Supply Pickup's home turnaround, then that tick (economyTick, every draw `draw`).
function shortRangeDeliveryTick(s: GameState, draw: number, over: Partial<CaptainState> = {}): { before: GameState; after: GameState } {
  const on = onShortRangeJob(s, "supplyPickup", "unloading");
  const m = shortRangeMissionOf(on);
  const before = editCaptain(on, { ...over, mission: { ...m, phaseProgressTicks: m.plan.unloadTicks - 1 } } as Partial<CaptainState>);
  return { before, after: economyTick(before, 1, () => draw) };
}

// The mission output share one short-range cycle applied to its pay: a Telescope Repair's credits over the reward
// table's (shortRangeCycleReward), minus one.
function shortRangeOutputShare(s: GameState): number {
  const { before, after } = shortRangeCycle(s, "telescopeRepair");
  const base = shortRangeCycleReward(shortRangeMissionOf(before).roll, effectiveShipStats(before, shipOf(before))).credits;
  return (Number(after.credits) - Number(before.credits)) / base - 1;
}

// The ticks the engine spends on site in one cycle of `template` (stepped one tick at a time from the site's start).
function shortRangeOnSiteTicks(s: GameState, template: ShortRangeTemplateKey): number {
  let at = onShortRangeJob(s, template, "onSite");
  for (let t = 1; t < 10_000; t++) {
    at = economyTick(at, 1, () => 0.5);
    if (shortRangeMissionOf(at).phase !== "onSite") return t;
  }
  return -1;
}

// The primary size a template's training roll carries (people, units or scan points), from the cycle-start seam.
function shortRangePrimarySize(s: GameState, template: ShortRangeTemplateKey): number {
  const roll = shortRangeMissionOf(onShortRangeJob(s, template)).roll;
  return roll.guests ?? roll.units ?? roll.scan ?? -1;
}

function shortRangeContentValue(s: GameState, field: string, template: ShortRangeTemplateKey): number {
  switch (field) {
    case "rolls":
      return shortRangePrimarySize(s, template);
    case "work":
      return shortRangeOnSiteTicks(s, template);
    case "reward": {
      const { before, after } = shortRangeCycle(s, template);
      return Number(after.credits) - Number(before.credits);
    }
    default:
      throw new Error(`no short-range field probe for ${field}`);
  }
}

function deliveredQuality(s: GameState, draw: number, ctx?: ContextId): number {
  const { before, after } = ctx === "mission:shortRange" ? shortRangeDeliveryTick(s, draw) : deliveryTick(s, draw);
  const buckets = after.inventory.commonOre ?? [];
  const was = before.inventory.commonOre ?? [];
  for (let q = buckets.length - 1; q >= 0; q -= 1) if (Number(buckets[q] ?? 0) > Number(was[q] ?? 0)) return q;
  return -1;
}

// The largest constant draw whose delivery still climbs to quality 1 (the deposit's first-climb threshold). G1-4: at
// mission:shortRange, a Supply Pickup's delivery.
function deliveryQualityThreshold(s: GameState, ctx?: ContextId): number {
  let lo = 0;
  let hi = 1;
  if (deliveredQuality(s, 1e-12, ctx) < 1) return 0;
  for (let i = 0; i < 44; i++) {
    const mid = (lo + hi) / 2;
    if (deliveredQuality(s, mid, ctx) >= 1) lo = mid;
    else hi = mid;
  }
  return lo;
}

// == whole-context consumers (WR-1 review: a claimed context a stat does not reach yet is read through the
// context's OWN consumer, so the check proves the stat is absent there, and starts failing the day it arrives) ==

// A stable 32-bit digest of plain data (FNV-1a over its JSON; Decimals as their strings).
export function digestOf(v: unknown): number {
  const text = JSON.stringify(v, (_k, x: unknown) => (x instanceof Decimal ? x.toString() : x)) ?? "";
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// The state a run dispatches from (ship-1 must field its away team).
function readyForRun(s: GameState): GameState {
  return s.awayMembers.some((m) => m.assignedShipId === WIRING_SHIP_ID) ? s : withAwayTeam(s);
}

// EVERYTHING a Ground Ops run reads of the ship: the candidate list it picks from (ids, systems, regions, reach) and
// the record frozen at dispatch. The whole timeline is a pure function of that record (advanceExpedition takes no
// state), so a stat that reaches any part of a run moves this digest. -1 when the run cannot dispatch (the check's
// control then fails, so a fixture that cannot fly never passes as "flat").
export function groundOpsRunDigest(s: GameState): number {
  const ready = readyForRun(s);
  const candidates = expeditionCandidates(ready, WIRING_SHIP_ID).map((c) => [c.id, c.systemId, c.telescope.regionTier, c.telescope.inRange]);
  try {
    return digestOf({ candidates, run: dispatchRun(ready) });
  } catch {
    return -1;
  }
}

// EVERYTHING one patrol cycle reads of the ship: dispatch captain 1 on the first patrol (a combat hull), fly one
// whole cycle through the real economyTick, and digest the cycle (the mission record tick by tick, the purse, the
// hold, the tank and the ship). -1 when the ship cannot patrol (a non-combat hull: the check's control then fails).
// CP-2 (OC-E13, B17): the officer weapon bonus a Dispatch Once patrol's FIRST cycle freezes at dispatch (the
// Constitution ramp's own mid-route sample). -1 when the patrol cannot dispatch.
export function patrolCycleOneWeapons(s: GameState): number {
  const r = dispatchCaptainOnPatrol(s, WIRING_CAPTAIN_ID, Object.keys(PATROLS)[0], "balanced", false);
  if (!r.success) return -1;
  const mission = captainOf(r.next).mission;
  return mission?.kind === "patrol" ? mission.officerCombat?.weaponDamage ?? 0 : -1;
}

export function patrolDigest(s: GameState): number {
  const key = Object.keys(PATROLS)[0];
  const r = dispatchCaptainOnPatrol(s, WIRING_CAPTAIN_ID, key, "balanced", false);
  if (!r.success) return -1;
  // WR-7 follow-up OC-D8: the route the dispatched cycle flies (its frozen legs), not the def's length.
  const route = patrolRouteOf(captainOf(r.next).mission as PatrolMissionState);
  let after = r.next;
  const trace: unknown[] = [captainOf(after).mission];
  for (let t = 0; t < patrolRouteTicks(route) + 5; t++) {
    after = economyTick(after, 1, () => 0.5);
    trace.push(captainOf(after).mission); // tick by tick: the legs, every wave and the ship's pools between them
  }
  return digestOf({ trace, credits: after.credits, inventory: after.inventory, ship: shipOf(after) });
}

// The ship-side scan events' combatant: the battle profile frozen at dispatch, rebuilt as each event rebuilds it.
function shipEventCombatant(s: GameState): Combatant | undefined {
  const battle = snapshotShipEventProfile(s, shipOf(s)).battle;
  return battle ? buildShipCombatant("wiring-event", battle, 0, 0) : undefined;
}

// == E-MOD EM-7: the universal modules' combat engines ==
// The battles the module probes fight: the ship (its patrol or ship-event combatant, modules folded by bridge.ts) against
// a Standard-Issue Battleship at range, precharged, logged, MODULE_BATTLE_SEEDS seeds. A Battleship outlasts the
// fixture ship, so it takes hits (the Arc Discharger's trigger) and falls below half hull (the Shield Surge's rule).
export const MODULE_BATTLE_SEEDS = 12;
function moduleBattleEnemy(): Combatant {
  return shipToCombatant({ id: "wiring-module-enemy", team: "enemy", stats: SHIP_TYPES.battleship, hullType: combatHullTypeOf("battleship")!, position: 40 });
}
// EM-7 review: each reading is one cast's EXACT size, so the registry asserts the configured number, not just "one
// landed". arcDamage: the largest single arc against an enemy with no shield and no armor (the arc's whole points land;
// only a killing arc can be smaller). shieldRestore: the largest single restore in per-mille of the carrier's shield
// pool (the engine restores floor(pool x amount / 1000), the per-mille off by under 1000 / pool).
function moduleProcTotal(s: GameState, ctx: ContextId, effect: "arcDamage" | "shieldRestore"): number {
  let best = 0;
  for (let i = 1; i <= MODULE_BATTLE_SEEDS; i++) {
    const player = battleCombatant(s, ctx);
    const foe = moduleBattleEnemy();
    if (effect === "arcDamage") {
      foe.shield = 0;
      foe.shieldMax = 0;
      foe.ablativeArmor = 0;
      foe.kineticDampening = 0;
    }
    const r = resolveBattle({ combatants: [player, foe] }, Math.imul(i, 0x9e3779b1) >>> 0, { precharge: true, generateLog: true });
    for (const ev of r.log) {
      if (ev.type !== "moduleProc" || ev.moduleEffect !== effect) continue;
      const size = effect === "arcDamage" ? ev.damage ?? 0 : ((ev.damage ?? 0) * 1000) / Math.max(1, player.shieldMax);
      best = Math.max(best, size);
    }
  }
  return best;
}
// The first weapon's volley with the ship's hull at MODULE_LOW_HULL_PERCENT (below every module hull threshold), fired
// MODULE_SHOT_SEEDS times at a target with no shield and no armor, so the volley's damage is its raw projectiles.
export const MODULE_SHOT_SEEDS = 40;
export const MODULE_LOW_HULL_PERCENT = 10;
function moduleLowHullShot(s: GameState, ctx: ContextId): number {
  let total = 0;
  for (let seed = 1; seed <= MODULE_SHOT_SEEDS; seed++) {
    const c = battleCombatant(s, ctx);
    const w = c.weapons[0];
    if (w === undefined) return 0;
    c.hull = Math.max(1, Math.floor((c.hullMax * MODULE_LOW_HULL_PERCENT) / 100));
    const target = moduleBattleEnemy();
    target.shield = 0;
    target.shieldMax = 0;
    target.ablativeArmor = 0;
    target.kineticDampening = 0;
    total += fireWeapon(c, target, w, makeRng(seed)).damage;
  }
  return total / MODULE_SHOT_SEEDS;
}
// MODULE_HAUL_BATCH real deliveries of 10 Titanium Ore (deliveryTick, the Motherlode probe's), captain 1's lifetime
// module counter at 0 to MODULE_HAUL_BATCH - 1 (each a different key of the private mission-cycle stream): the mean
// ore above the 10 delivered.
export const MODULE_HAUL_BATCH = 1000;
function moduleBonusHaul(s: GameState): number {
  let extra = 0;
  for (let i = 0; i < MODULE_HAUL_BATCH; i++) {
    const { before, after } = deliveryTick(s, 0.999999, { moduleCycles: i });
    extra += heldOf(after, "commonOre") - heldOf(before, "commonOre") - 10;
  }
  return extra / MODULE_HAUL_BATCH;
}
// E-MOD EM-8 (the Precursor Lens, the body-scanned trigger): ship-1 dispatched (the run freezes its body-scan procs,
// Expedition.moduleScanProcs), then the real discovery roll (expedition.ts rollBodyDiscoveries) over MODULE_SCAN_BODIES
// synthetic bodies, every planet type in turn, body index 0 to MODULE_SCAN_BODIES - 1 (each its own key of the private
// body-scan stream): the mean discoveries per body.
export const MODULE_SCAN_BODIES = 2000;
function moduleScanDiscoveries(s: GameState): number {
  const run = dispatchRun(s);
  let n = 0;
  for (let i = 0; i < MODULE_SCAN_BODIES; i++) {
    const p = PLANET_IDS[i % PLANET_IDS.length];
    n += rollBodyDiscoveries(run, { ...syntheticBody(p, 0), id: `wiring-scan-${i}` }, i).length;
  }
  return n / MODULE_SCAN_BODIES;
}

// The Security squad as a dispatched run fields it (the run's frozen officer care rides along).
function runMember(s: GameState, memberId: string): GroundCombatant | undefined {
  return expeditionTeamCombatants(dispatchRun(readyForRun(s)), "wiring").find((c) => c.memberId === memberId);
}

// The member's combatant with every inflict-capable piece taken off (the "no inflict piece" context).
const INFLICT_VARIETIES = new Set(
  MEMBER_SLOT_TYPES.flatMap((slot) => EQUIPMENT_SLOTS[slot].varieties.filter((v) => v.member?.groundEffect?.kind === "inflict").map((v) => v.key)),
);
function withoutInflictPieces(s: GameState): GameState {
  return { ...s, equipment: s.equipment.filter((e) => !(e.fittedToMemberId && e.moduleVariant && INFLICT_VARIETIES.has(e.moduleVariant))) };
}

// A hull torn down at the Salvage Bay (a second hull, so the last-hull guard never refuses): what it gave back.
// What a hull teardown of a copy of ship-1 gives back (components plus credits) at the middle band draw.
export function teardownRecovered(s: GameState): number {
  const spare: ShipInstance = { ...shipOf(s), id: "wiring-teardown", assignedCaptainId: null };
  const held = { ...s, ships: [...s.ships, spare] };
  const r = salvageShip(held, spare.id, () => 0.5);
  if (!r.ok) return -1;
  const items = Object.keys(SHIP_TYPES[spare.typeKey].buildRecipe.components);
  return items.reduce((a, k) => a + heldOf(r.next, k) - heldOf(held, k), 0) + Number(r.next.credits) - Number(held.credits);
}

// WR-6: Works Directorate measured where it pays: 1,000 Fabricator blank jobs started through the real seam (each its
// own process number), all resolved; the share that delivered a second blank.
const FABRICATOR_SAMPLE_JOBS = 1000;
const FABRICATOR_SAMPLE_KEY = "wiring-blank";
function fabricatorBonusShare(s: GameState): number {
  let st: GameState = { ...s, activeProcesses: [], blanks: {} };
  for (let i = 0; i < FABRICATOR_SAMPLE_JOBS; i++) {
    const r = startProcess(st, "fabricateJob", {}, 1, { type: "addBlank", blueprintKey: FABRICATOR_SAMPLE_KEY });
    if (!r.started) return -1;
    st = r.next;
  }
  const done = resolveProcesses(st, 1, () => 0.5).next;
  const blanks = Number(done.blanks[FABRICATOR_SAMPLE_KEY] ?? 0);
  return (blanks - FABRICATOR_SAMPLE_JOBS) / FABRICATOR_SAMPLE_JOBS;
}

// CP-5: ship-1 emptied and passive, the pool replaced by 1,000 of every division at every rank (more than any hull
// seats), one resolveCrew: ship-1's headcount after.
function autoCrewFill(s: GameState): CrewBucket[] {
  const pool: CrewBucket[] = [];
  for (const profession of CREW_PROFESSIONS) {
    for (let rank = 1 as CrewRank; rank <= 8; rank = (rank + 1) as CrewRank) {
      pool.push({ profession, rarity: "standard", rank, race: "earthBorn", buff1Id: "wiring.none", buff2Id: null, count: 1000 });
    }
  }
  const ready = editShip({ ...s, crewPool: pool }, { complement: { buckets: [], mode: "passive" } });
  return shipOf(resolveCrew(ready)).complement?.buckets ?? [];
}
function autoCrewHeadcount(s: GameState): number {
  return autoCrewFill(s).reduce((a, b) => a + b.count, 0);
}
function autoCrewLeanSeats(s: GameState): number {
  const w = SHIP_TYPES[shipOf(s).typeKey].complementDivisionWeights;
  if (!w) return -1;
  const lead = CREW_PROFESSIONS.reduce((best, p) => (w[p] > w[best] ? p : best), CREW_PROFESSIONS[0]);
  return autoCrewFill(s).reduce((a, b) => a + (b.profession === lead ? b.count : 0), 0);
}

// WR-6: the crew one transport window delivers into the fleet (the pool and every complement it auto-fills).
function crewHeads(s: GameState): number {
  const count = (buckets: readonly { count: number }[]) => buckets.reduce((a, b) => a + b.count, 0);
  return count(s.crewPool) + s.ships.reduce((a, sh) => a + count(sh.complement?.buckets ?? []), 0);
}
function transportCrewDelivered(s: GameState): number {
  const due: GameState = { ...s, lastTransportWindow: 0, gameTimeSeconds: TRANSPORT_WINDOW_SECONDS };
  return crewHeads(resolveCrew(due)) - crewHeads(due);
}

// The loot tier one salvaged material gives a Fleet Admiral past every loot-tier threshold, the draw at the top.
// Wiring WR-11 (OC-J1 "Shift odds upward"): a top Fleet Admiral's material salvage (a job stamped with the roll rules)
// reads its reach as the clamped ceiling plus the talent's tiers past the top that tilt the loot weights
// (salvage.ts salvageTierReach, the roll's own reach). Before WR-11 the clamp threw the talent's tier away here.
function topTierRolled(s: GameState): number {
  const pool = SALVAGE_LOOT_POOLS[Object.keys(SALVAGE_LOOT_POOLS)[0] as keyof typeof SALVAGE_LOOT_POOLS];
  const reach = salvageTierReach({ ...s, fleetAdminLevel: 99 }, pool.length, 0, true);
  return reach.ceiling + reach.overflow;
}

// One whole shortOreRun cycle (every draw common): the credits and Titanium Ore it delivered.
function cycleOutput(s: GameState): number {
  const { before, after } = oneCycle(s, "shortOreRun");
  return Number(after.credits) - Number(before.credits) + heldOf(after, "commonOre") - heldOf(before, "commonOre");
}

// One whole shortOreRun cycle: the QUALITY of the ore it delivered (quality rung x units, summed).
// Material Lines ML-3: the delivered ore's average quality, quality-weighted units over units (the draws are pinned
// at 0.999999, so the delivery's own roll lands Q0 and the reading is the share of units that climbed a step).
function cycleOreQuality(s: GameState): number {
  const { before, after } = oneCycle(s, "shortOreRun");
  const weighted = (g: GameState) => (g.inventory.commonOre ?? []).reduce((a, q, i) => a + i * Number(q), 0);
  const units = heldOf(after, "commonOre") - heldOf(before, "commonOre");
  return units > 0 ? (weighted(after) - weighted(before)) / units : 0;
}

// How many blueprints a top-level Research Lab can start (the relic-gated ones count once their relic is found).
function researchableCount(s: GameState): number {
  const ready = withFacilityLevel(s, "research", 9);
  return Object.keys(BLUEPRINTS).filter((k) => blueprintResearchable(ready, k)).length;
}

// The legacy (pre-Ground Ops) injury path: a run whose Security member went down, brought home. Its recovery time.
function legacyInjurySeconds(s: GameState): number {
  const ready = readyForRun(s);
  const run = dispatchRun(ready);
  const legacy: Expedition = {
    ...run,
    groundOps: undefined,
    risk: undefined,
    scanEvents: [{ bodyIndex: 0, step: 1, kind: "encounter", outcome: "loss", downedMemberIds: [WIRING_SECURITY_ID] }],
  };
  return applyExpeditionInjuries(ready, legacy).injuries.find((i) => i.memberId === WIRING_SECURITY_ID)?.recoverySeconds ?? 0;
}

// == WR-5c: the explorer secondary nodes' consumers ==

// The dispatched run's finds over 24 synthetic bodies (every planet type, three body indices each): the real
// discovery roll (expedition.ts rollBodyDiscoveries). Pure.
function discoveriesOver(run: Expedition): number {
  let n = 0;
  for (const p of PLANET_IDS) {
    for (let i = 0; i < 3; i++) n += rollBodyDiscoveries(run, { ...syntheticBody(p, 0), id: `wiring-${p}-${i}` }, i).length;
  }
  return n;
}

// The dispatched run's Security member as a Ground Ops task fight fields it (groundFight.ts taskFightTeam: the run's
// frozen strength share, officer care and the captain's Away-Team Doctrine).
function runTaskMember(s: GameState, memberId: string): GroundCombatant | undefined {
  const run = dispatchRun(readyForRun(s));
  const ops = run.groundOps;
  if (!ops) return undefined;
  const teams = ops.teams.map((t, i) => ({ securityIds: t.securityIds, downedThisTask: [], securityShare: ops.factors.securityShare[i] ?? 0 }));
  return taskFightTeam(run, teams, { id: "wiring-task", fightCount: 0 }).find((c) => c.memberId === memberId);
}

// Field Kits FKR-4: the same member on a FIELD KITS run (flag 2 stamped by hand: FKR-7 stamps it at dispatch), where a
// task fight stamps the squad's Field Kits battle traits (fieldKitsConditions.ts withFieldKitsTeam: Stoneskin).
function runFieldKitsTaskMember(s: GameState, memberId: string): GroundCombatant | undefined {
  const run: Expedition = { ...dispatchRun(readyForRun(s)), fieldKits: { catalog: FIELD_KITS_CATALOG_VERSION } };
  const ops = run.groundOps;
  if (!ops) return undefined;
  const teams = ops.teams.map((t, i) => ({ securityIds: t.securityIds, downedThisTask: [], securityShare: ops.factors.securityShare[i] ?? 0 }));
  return taskFightTeam(run, teams, { id: "wiring-task", fightCount: 0 }).find((c) => c.memberId === memberId);
}

// Relics v2 R2-3: the identification v2 probe's studies: RELIC_V2_PROBE_STUDIES radiant Tier I blanks with no site, ids
// "wiring-relic-v2-<n>", studied one after another from study index 1 on the default relic seed and an empty Museum (so
// the expected reveals are a pure function of these constants).
export const RELIC_V2_PROBE_STUDIES = 600;
function relicV2ProbeToken(n: number): RelicVaultToken {
  return { id: `wiring-relic-v2-${n}`, tier: "radiant", quality: 0 };
}

// The exceptional copies those studies land when every one reveals through identification v2 (relicIdentify.ts
// identifyRelicV2 and applyRelicIdentification, run in order against the growing Museum). The registry's magnitude for
// relic:audit:identifyV2. Pure.
export function relicV2ProbeExpectedExceptional(): number {
  let museum = emptyMuseumV2();
  let discovered: string[] = [];
  for (let n = 0; n < RELIC_V2_PROBE_STUDIES; n++) {
    const outcome = identifyRelicV2(RELIC_DEFAULT_SEED, museum, relicV2ProbeToken(n), n + 1);
    ({ museum, discovered } = applyRelicIdentification(museum, discovered, outcome, null));
  }
  return Object.values(museum.exceptional).reduce((a, b) => a + b, 0);
}

// Relics v2 R2-3 content probes ("content:relic:<a>"):
//   exceptionalReveals  the exceptional copies the Museum holds after the probe's studies, each STARTED by the player's
//                       start (startRelicStudy, a Lab I) and RESOLVED by the real resolver (resolveProcesses). On = the
//                       study as started (the v2 stamp); off = the same study with the stamp removed (the v1 roll,
//                       which never reveals an exceptional piece).
//   lanes               the relic studies a Research Lab runs at once (relicStudySlotCount): on = Lab VII, off = Lab I.
function relicContentProbe(kind: string, on: boolean, s: GameState): number {
  if (kind === "lanes") return relicStudySlotCount(withFacilityLevel(s, "research", on ? 7 : 1));
  if (kind !== "exceptionalReveals") throw new Error(`unknown relic content probe ${kind}`);
  let cur: GameState = { ...withFacilityLevel(s, "research", 1), relicSeed: RELIC_DEFAULT_SEED, nextRelicStudyIndex: 1, museumV2: emptyMuseumV2(), relicVault: [], relicQueue: [] };
  for (let n = 0; n < RELIC_V2_PROBE_STUDIES; n++) {
    const token = relicV2ProbeToken(n);
    const r = startRelicStudy({ ...cur, relicVault: [token] }, token.id);
    if (!r.started) throw new Error(`relic v2 probe: study refused (${r.reason})`);
    const started = on
      ? r.next
      : {
          ...r.next,
          activeProcesses: r.next.activeProcesses.map((p) => {
            if (p.effect.type !== "identifyRelic") return p;
            const { v: _v, ...v1 } = p.effect;
            return { ...p, effect: v1 };
          }),
        };
    const proc = started.activeProcesses.find((p) => p.kind === "relicStudy")!;
    cur = resolveProcesses(started, proc.remainingTicks, () => 0).next;
  }
  return Object.values(cur.museumV2.exceptional).reduce((a, b) => a + b, 0);
}

// Relics v2 R2-10 content probes ("content:minigame:<lever>"): the fixture's Museum read as the minigame's relic boosts
// (relicBoostsFromMuseum, what the runtime reads from every main save), measured through the minigame consumer the lever
// multiplies, on one fixed minigame state. Each value is linear in its lever's boost:
//   tier1..tier8   that generator's rate multiplier (tierMultiplier); allSmall / allBig read Tier I's
//   overclock      the Overclock levels counted (log of overclockMultiplier over log 1.125)
//   stack          the game clock's speed (gamePace)
//   tenBonus       the ten bonus factor
//   captain / augment / dream   the points the next Captain Prestige / Fleet Prestige / Prestigeception pays
//   fleet          the Augment Points counted on the stack (augmentMultiplier undone through AP_POW)
function minigameProbeState(s: GameState): SecretState {
  const x = freshSecretState(0);
  x.tiersUnlocked = 8;
  x.bought = new Array(8).fill(10);
  x.owned = Array.from({ length: 8 }, () => new Decimal(10));
  x.overclock = 100;
  x.augmentPoints = new Decimal(1e6);
  x.dreamPoints = new Decimal(1e30);
  x.runPeak = new Decimal("1e5000");
  x.fleetPeak = new Decimal("1e5000");
  x.pcPeak = new Decimal("1e50000");
  const boosts = relicBoostsFromMuseum(s.museumV2);
  if (boosts) x.relicBoosts = boosts;
  return x;
}
function minigameContentProbe(lever: string, s: GameState): number {
  const x = minigameProbeState(s);
  const tier = RELIC_TIER_LEVERS.indexOf(lever as RelicLever);
  if (tier >= 0) return secretTierMultiplier(x, tier).toNumber();
  switch (lever) {
    case "allSmall":
    case "allBig":
      return secretTierMultiplier(x, 0).toNumber();
    case "overclock":
      return secretOverclockMultiplier(x).log10() / Math.log10(SECRET_OC_FACTOR);
    case "stack":
      return secretGamePace(x);
    case "tenBonus":
      return secretTenBonusFactor(x);
    case "captain":
      return secretCaptainGain(x).toNumber();
    case "augment":
      return secretFleetGain(x).toNumber();
    case "dream":
      // 0.14.0 rising bars: a Prestigeception pays only once the climb pays what the Dream Points held
      // already paid, so this one is read with none held (the Dream Points above only lift the other gains).
      x.dreamPoints = new Decimal(0);
      return secretPrestigeceptionGain(x).toNumber();
    case "fleet":
      return Math.pow(10, secretAugmentMultiplier(x).log10() / SECRET_AP_POW) - 1;
  }
  throw new Error(`unknown minigame content probe ${lever}`);
}

// A relic the dispatched run recovers (the first seed whose roll hits on a hazard-1 Buried Vault), brought home by the
// claim's deposit and studied at a Research Lab: the study's duration in ticks. -1 when no seed hits (never: the
// hazard-1 chance is 75% before any bonus).
function runRelicStudyTicks(s: GameState): number {
  const run = dispatchRun(readyForRun(s));
  for (let seed = 1; seed < 64; seed++) {
    const relic = rollRelicToken(seed, 1, "buriedVault", `wiring-relic-${seed}`, 0, run.explorerCaptain);
    if (!relic) continue;
    const home = depositExpeditionFindings(withFacilityLevel(s, "research", 1), [{ id: "wiring-find", source: "activity", poiId: "buriedVault", relic }]);
    const token = (home.relicVault ?? []).find((t) => t.id === relic.id);
    if (!token) return -1;
    const r = startRelicStudy(home, token.id);
    return r.started ? r.next.activeProcesses.find((p) => p.kind === "relicStudy")?.durationTicks ?? -1 : -1;
  }
  return -1;
}

// The first officer aboard ship-1 (the fixture seats one), after 600 economyTick seconds of a Short Ore Run: its
// crewHours (the promotion counter every run feeds). -1 when the mission cannot dispatch or no officer sits aboard.
function missionCrewHours(s: GameState, ctx?: ContextId): number {
  // G1-4: at mission:shortRange, 600 s of a short-range run (a Telescope Repair, on Repeat).
  const r = ctx === "mission:shortRange" ? { success: true, next: onShortRangeJob(s, "telescopeRepair", "transitOut", true) } : dispatchCaptainOnMission(s, WIRING_CAPTAIN_ID, "shortOreRun");
  if (!r.success) return -1;
  let after = r.next;
  for (let t = 0; t < 600; t++) after = economyTick(after, 1, () => 0.5);
  const o = after.officers.find((x) => x.assignedShipId === WIRING_SHIP_ID);
  return o ? officerPromotionCounter(o, "crewHours") : -1;
}

// A dispatched run brought home with one objective done, then claimed: the first officer aboard's
// personnelAchievement (the counter the claim feeds from the stored run). -1 without an officer aboard.
function claimedObjectives(s: GameState): number {
  const ready = readyForRun(s);
  const cand = expeditionCandidates(ready, WIRING_SHIP_ID)[0];
  const res = startExpedition(ready, WIRING_SHIP_ID, WIRING_CAPTAIN_ID, cand.id, true, FIELD_KITS_RUNS_LIVE, false); // G2-4: see dispatchRun
  if (!res.success || !res.expedition) return -1;
  const exp = res.expedition;
  const done: Expedition = {
    ...exp,
    phase: "complete",
    groundOps: undefined,
    bodies: exp.bodies.map((b, i) => (i === 0 ? { ...b, activities: [{ id: "wiring-act", bodyId: b.id, poiId: "buriedVault", done: true }] } : b)),
  };
  const claim = claimExpedition({ ...res.next, expeditions: [done] }, exp.id);
  if (!claim.success) return -1;
  const o = claim.next.officers.find((x) => x.assignedShipId === WIRING_SHIP_ID);
  return o ? o.promotionCounters?.personnelAchievement ?? 0 : -1;
}

// == the ground objective affixes (affixes.ts readers) ==

const AFFIX_READERS: Readonly<Record<string, (list: readonly ObjectiveAffix[], alignment: AffixAlignment) => number>> = {
  extraBattleChanceByRank: (l) => extraBattleChance(l),
  maxExtraBattlesByRank: (l) => maxExtraBattles(l),
  alertResetSecondsByRank: (l) => alertResetSeconds(l),
  // The side(s) the alignment covers: positive the squad, negative the enemy, neutral both (summed).
  longRangeEvasionByRank: (l, a) => {
    const c = longRangeCover(l);
    return a === "positive" ? c.team : a === "negative" ? c.enemy : c.team + c.enemy;
  },
};
export const AFFIX_HOOK_KEYS = Object.keys(AFFIX_READERS);
// The hooks whose reading depends on the instance's alignment (one source per alignment the affix may roll).
export const AFFIX_ALIGNED_HOOKS: ReadonlySet<string> = new Set(["longRangeEvasionByRank"]);

// ============================================================================
// The probes
// ============================================================================

export interface ProbeDef {
  readonly label: string;
  readonly read: (s: GameState, ctx: ContextId) => number;
}

const sheet = (s: GameState) => effectiveShipStats(s, shipOf(s));
// A sheet stat read where its consumer reads it: the sheet itself, or (at a claimed context the stat does not reach
// yet) that context's whole consumer, the Ground Ops run or the patrol cycle.
const sheetAt = (read: (s: GameState) => number) => (s: GameState, ctx: ContextId) =>
  ctx === "expedition:groundOps" ? groundOpsRunDigest(s) : ctx === "patrol" ? patrolDigest(s) : read(s);
// Expedition Tiers G2-3: the leg speed a Ground Ops dispatch of ship-1 froze on its voyage (-1 without one).
const voyageSpeed = (s: GameState, leg: "out" | "back"): number => {
  const v = dispatchRun(readyForRun(s)).voyage;
  return v ? (leg === "out" ? v.outboundSpeed : v.returnSpeed) : -1;
};
// Expedition Tiers G2-4: ship-1's Tier I candidate 0 on the save's current list.
const tierOneCandidate = (s: GameState) => {
  const cand = candidateSystemById(s, "cand-1-0");
  if (!cand) throw new Error("wiring fixture: no Tier I candidate");
  return cand;
};
// WR-7 (OC-D8 "Speed counts everywhere": expedition reach via the G2 reach gate): the expedition reach gate's reach on
// ship-1's Tier I candidate (candidateReach) split back into ONE of its two ship factors, the tank (fuel capacity, with
// the fleet reach bonus the gate folds into it) or the engine efficiency, by dividing out every other factor of the
// gate's product (range = fuel x (1 + efficiency) x LY_PER_TICK, x (1 + the trip's Engineering ramp), x the drive
// class multiplier; tick.ts shipTripRangeLightYears, propulsion.ts expeditionReachLy). A gate that stopped reading the
// factor leaves this figure flat.
function reachGateFactor(s: GameState, factor: "fuel" | "efficiency"): number {
  const ship = shipOf(s);
  const cand = tierOneCandidate(s);
  const reach = candidateReach(s, ship, cand).reachLy;
  const v = candidateVoyage(s, ship, cand, false);
  const ticks = (v.outboundSeconds + v.returnSeconds) / (s.tickDurationSeconds > 0 ? s.tickDurationSeconds : 1);
  const rest = LY_PER_TICK * (1 + tripReachRamp(s, ship, ticks)) * driveClassReachMult(shipDriveClass(s, ship));
  const stats = sheet(s);
  const fuel = stats.fuelCapacity * (1 + fleetReachBonus(s));
  return factor === "fuel" ? reach / ((1 + stats.engineEfficiency) * rest) : reach / (fuel * rest) - 1;
}
// Expedition Tiers G2-6: the dispatch console offers every region tier (a tab per tier, expeditionTierGates). The
// deepest tier whose gates ship-1 meets (0 when none: a non-explorer), the console's pick there (the nearest candidate
// the ship can launch to, else the nearest: expeditionConsoleDisplay.ts preselectCandidateId) and the gated launch.
export function deepestReadyTier(s: GameState): RegionTier | 0 {
  let best: RegionTier | 0 = 0;
  for (const t of REGION_TIERS) if (expeditionTierGates(s, shipOf(s), t).first === null) best = t;
  return best;
}
function consolePick(s: GameState, tier: RegionTier): CandidateSystem {
  const list = [...tierCandidateSystems(s, tier)].sort((a, b) => a.distanceLy - b.distanceLy || a.slot - b.slot);
  return list.find((c) => expeditionSystemGate(s, shipOf(s), c) === null) ?? list[0];
}
function consoleLaunch(s: GameState, tier: RegionTier | 0 = deepestReadyTier(s)): ExpeditionDispatchResult | null {
  if (tier === 0) return null;
  const ready = readyForRun(s);
  return startExpedition(ready, WIRING_SHIP_ID, WIRING_CAPTAIN_ID, consolePick(ready, tier).id);
}
const consoleRun = (s: GameState): Expedition | null => {
  const r = consoleLaunch(s);
  return r && r.success && r.expedition ? r.expedition : null;
};
// The recall probe's moment: a quarter of the outbound leg flown (before the anomaly check at the midpoint), so the
// recalled run flies home in a quarter of its return leg (1:1, user #7).
export const RECALL_PROBE_SHARE = 0.25;
// Ship-1 launched from the console to Tier I's cand-1-0 and the save moved to `at` (seconds after the launch, or the
// moment the run's first body is charted). Throws when the launch is refused (a fixture that cannot fly is a bug).
export function launchedAndAt(s: GameState, at: "quarterOut" | "firstCharted"): GameState {
  const r = startExpedition(readyForRun(s), WIRING_SHIP_ID, WIRING_CAPTAIN_ID, "cand-1-0");
  if (!r.success || !r.expedition) throw new Error(`wiring console launch refused: ${r.reason}`);
  const run = r.expedition;
  const out = run.voyage?.outboundSeconds ?? 0;
  let t = run.phaseAnchorSeconds + Math.floor(out * RECALL_PROBE_SHARE);
  if (at === "firstCharted") {
    t = run.phaseAnchorSeconds + out;
    for (let i = 0; i < 500 && !advanceExpedition(run, t).bodies[0]?.scanned; i++) t += 300;
  }
  return { ...r.next, gameTimeSeconds: t };
}
const sci = () => WIRING_SCIENCE_ID;
// The research probe reads a long project, so one museum step moves it by many ticks (well above its rounding).
const RESEARCH_PROBE_SCALE = 1000;
const sec = () => WIRING_SECURITY_ID;

export const PROBES = {
  // == the ship stat sheet ==
  sheetCargo: { label: "effectiveShipStats.cargoCapacity (Ground Ops / patrol: the run / cycle digest)", read: sheetAt((s) => sheet(s).cargoCapacity) },
  // WR-7 follow-up (OC-D5): the hold a run reads: the sheet, or (an extraction mission) the run sheet of a Short Ore Run
  // dispatched now by a level 10 captain (gearWearEngine.ts missionRunSheet: its favored-spec stamp decides), or (a
  // short-range run) the run sheet of a job started through the board's seam. -1 when the dispatch is refused.
  favoredRunCargo: {
    label: "effectiveShipStats.cargoCapacity (an extraction mission: missionRunSheet of a Short Ore Run dispatched now)",
    read: (s, ctx) => {
      // A short-range run's cycle engine reads the same run sheet (shortRangeCycle.ts) on the job's stamps.
      if (ctx === "mission:shortRange") return missionRunSheet(s, shipOf(s), shortRangeMissionOf(onShortRangeJob(s, "telescopeRepair"))).cargoCapacity;
      if (ctx !== "mission:extraction") return sheet(s).cargoCapacity;
      const ready = { ...s, captains: s.captains.map((c) => ({ ...c, level: Math.max(c.level, 10) })) };
      const r = dispatchCaptainOnMission(ready, WIRING_CAPTAIN_ID, "shortOreRun");
      const m = captainOf(r.next).mission;
      return r.success && m?.kind === "extraction" ? missionRunSheet(r.next, shipOf(r.next), m).cargoCapacity : -1;
    },
  },
  // Expedition Tiers G2-3: at Ground Ops, the outbound leg speed the run's voyage froze (voyage.ts: each leg's seconds
  // divide by it); the patrol reads its whole cycle digest.
  sheetTransit: {
    label: "effectiveShipStats.transitSpeedMult (Ground Ops: the voyage's frozen outbound speed; patrol: the cycle digest)",
    read: (s, ctx) => (ctx === "expedition:groundOps" ? voyageSpeed(s, "out") : ctx === "patrol" ? patrolDigest(s) : sheet(s).transitSpeedMult),
  },
  // CP-2 (OC-E5): each mission leg's own speed (effectiveMissionDef divides that leg by it). G2-3: at Ground Ops, the
  // voyage's frozen speed on that leg.
  sheetOutLeg: { label: "outboundLegSpeed(effectiveShipStats): the outbound leg's speed (Ground Ops: the voyage's)", read: (s, ctx) => (ctx === "expedition:groundOps" ? voyageSpeed(s, "out") : outboundLegSpeed(sheet(s))) },
  sheetBackLeg: { label: "returnLegSpeed(effectiveShipStats): the return leg's speed (Ground Ops: the voyage's)", read: (s, ctx) => (ctx === "expedition:groundOps" ? voyageSpeed(s, "back") : returnLegSpeed(sheet(s))) },
  // Expedition Tiers G2-4 (propulsion.ts): what a Tier I dispatch of ship-1 to cand-1-0 would fly and reach (pure
  // reads of the console readers the gate and the launch use), and whether a real launch there is allowed.
  voyageOutbound: {
    label: "candidateVoyage(cand-1-0).outboundSeconds: the outbound leg a launch freezes (halved per drive class above the tier's)",
    read: (s) => candidateVoyage(s, shipOf(s), tierOneCandidate(s), false).outboundSeconds,
  },
  expeditionReach: {
    label: "candidateReach(cand-1-0).reachLy: the ship's deep-space reach on that voyage (range x drive class multiplier x Engineering)",
    read: (s) => candidateReach(s, shipOf(s), tierOneCandidate(s)).reachLy,
  },
  expeditionLaunchAllowed: {
    label: "startExpedition(cand-1-0) succeeds (1) or is refused (0), with the minimum away team aboard",
    read: (s) => (startExpedition(withAwayTeam(s), WIRING_SHIP_ID, WIRING_CAPTAIN_ID, "cand-1-0").success ? 1 : 0),
  },
  // Expedition Tiers G2-6 (the dispatch console's region picker): what a player's launch from the console reaches.
  tierTwoLaunchAllowed: {
    label: "a console launch to Tier II (its nearest candidate in reach) succeeds (1) or is refused (0), the minimum away team aboard",
    read: (s) => (consoleLaunch(s, 2)?.success ? 1 : 0),
  },
  consoleRiskTier: {
    label: "the region tier of the risk profile a console launch to the deepest tier ship-1 can attempt freezes (RISK_TIER_ODDS, hostile sites, SCIENCE_HEAVY, the affix rows read it); 0 when refused",
    read: (s) => consoleRun(s)?.risk?.tier ?? 0,
  },
  consoleOutbound: {
    label: "the outbound leg (seconds) of the voyage a console launch to the deepest tier ship-1 can attempt freezes; 0 when refused",
    read: (s) => consoleRun(s)?.voyage?.outboundSeconds ?? 0,
  },
  consoleHaulMult: {
    label: "the tier haul multiplier a console launch's run carries (riskFactors.ts tierHaulMult of its region stamp, on every objective's haul); 0 when refused",
    read: (s) => {
      const run = consoleRun(s);
      return run ? tierHaulMult(run.region) : 0;
    },
  },
  consoleBodyCount: {
    label: "the bodies the console shows across the deepest tier's candidates (foreknowledge, the generated systems a launch flies)",
    read: (s) => {
      const tier = deepestReadyTier(s);
      return tier === 0 ? 0 : expeditionCandidates(readyForRun(s), WIRING_SHIP_ID, tier).reduce((n, c) => n + (c.foreknowledge.bodyCount ?? 0), 0);
    },
  },
  consoleBlindLaunches: {
    label: "blind launches a console launch to the deepest tier ship-1 can attempt counts (a candidate past the telescope's range)",
    read: (s) => {
      const r = consoleLaunch(s);
      return r && r.success ? blindLaunchCount(r.next) - blindLaunchCount(s) : -1;
    },
  },
  consoleOddsRead: {
    label: "the compositions whose fight odds the recommendation reads for the console's pick at the deepest tier (odds weigh in behind tier 2; ODDS_RISKY_BELOW decides when they swap the pick)",
    read: (s) => {
      const tier = deepestReadyTier(s);
      if (tier === 0) return -1;
      const ready = readyForRun(s);
      const pick = consolePick(ready, tier);
      const cand = expeditionCandidates(ready, WIRING_SHIP_ID, tier).find((c) => c.id === pick.id)!;
      return expeditionLaunchView(ready, WIRING_SHIP_ID, cand).recommendation?.ranked.filter((r) => r.fightOdds !== undefined && r.fightOdds !== null).length ?? -1;
    },
  },
  consoleBlankShare: {
    label: "the permille of a console launch's relic blank table above the standard rarity (relicBlanks.ts relicBlankTable of its stamp's tier); -1 when refused",
    read: (s) => {
      const run = consoleRun(s);
      const stamp = run ? relicBlankStamp(run, 0) : undefined;
      if (!stamp) return -1;
      const rows = relicBlankTable(stamp.tier);
      const total = rows.reduce((n, r) => n + r.weight, 0);
      return Math.round((1000 * rows.filter((r) => r.tier !== "standard").reduce((n, r) => n + r.weight, 0)) / Math.max(1, total));
    },
  },
  runReturnSeconds: {
    label: "returnDurationSeconds of ship-1's run (a recalled run: the way home its recall froze); -1 without a run",
    read: (s) => {
      const run = s.expeditions.find((e) => e.shipId === WIRING_SHIP_ID);
      return run ? returnDurationSeconds(run) : -1;
    },
  },
  resumableCount: { label: "resumableSystems: the systems the console offers to resume", read: (s) => resumableSystems(s).length },
  sheetYield: { label: "effectiveShipStats.extractionYieldMult", read: (s) => sheet(s).extractionYieldMult },
  sheetUnload: {
    label: "unload speed: effectiveShipStats.unloadSpeedMult (missions) / groundOps.factors.offloadMult (Ground Ops)",
    read: (s, ctx) => (ctx === "expedition:groundOps" ? dispatchRun(s).groundOps?.factors.offloadMult ?? 1 : sheet(s).unloadSpeedMult ?? 1),
  },
  // WR-7 (OC-D8): at Ground Ops, the engine efficiency the expedition reach gate reads (reachGateFactor).
  sheetEngineEff: {
    label: "effectiveShipStats.engineEfficiency (Ground Ops: the efficiency the expedition reach gate reads; patrol: the cycle digest)",
    read: (s: GameState, ctx: ContextId) => (ctx === "expedition:groundOps" ? reachGateFactor(s, "efficiency") : sheetAt((x) => sheet(x).engineEfficiency)(s, ctx)),
  },
  // WR-7 (OC-D8): at Ground Ops, the tank the expedition reach gate reads (reachGateFactor); the patrol reads its cycle.
  sheetFuelCapacity: {
    label: "effectiveShipStats.fuelCapacity (Ground Ops: the tank the expedition reach gate reads; patrol: the cycle digest)",
    read: (s: GameState, ctx: ContextId) => (ctx === "expedition:groundOps" ? reachGateFactor(s, "fuel") : sheetAt((x) => sheet(x).fuelCapacity)(s, ctx)),
  },
  sheetSensors: { label: "effectiveShipStats.sensors (patrol: the cycle digest)", read: sheetAt((s) => sheet(s).sensors) },
  // G1-1: guest quarters on the sheet. At mission:shortRange it reads the short-range cycle's passenger capacity, which
  // does not exist until G1-4 (the cycle engine): 0 there, so a guest source stays flat at that claimed context.
  sheetGuestQuarters: {
    label: "effectiveShipStats.colonistCapacity (mission:shortRange: the guest quarters a short-range sheet judges, shortRangeShipRatings)",
    read: (s, ctx) => (ctx === "mission:shortRange" ? shortRangeShipRatings(s, shipOf(s), 1).guests : sheet(s).colonistCapacity ?? 0),
  },
  sheetMass: { label: "effectiveShipStats.mass", read: (s) => sheet(s).mass },
  sheetPowerOutput: { label: "effectiveShipStats.powerOutput", read: (s) => sheet(s).powerOutput },
  sheetPowerDraw: { label: "effectiveShipStats.powerDraw", read: (s) => sheet(s).powerDraw },
  sheetExtractionSpeed: { label: "effectiveShipStats.extractionSpeedMult", read: (s) => sheet(s).extractionSpeedMult ?? 1 },
  sheetReturnConstitution: { label: "effectiveShipStats.returnLegConstitution", read: (s) => sheet(s).returnLegConstitution ?? 0 },
  sheetFullHoldIntegrity: { label: "effectiveShipStats.fullHoldUnloadIntegrity", read: (s) => sheet(s).fullHoldUnloadIntegrity ?? 0 },
  shipRange: { label: "shipRangeLightYears", read: (s) => shipRangeLightYears(s, shipOf(s)) },
  // == the mission def a ship flies (effectiveMissionDef) ==
  // The two tick-count probes read a 100x hold, so a small speed-up is not lost to the whole-tick rounding.
  missionUnloadTicks: { label: "effectiveMissionDef(longOreRun).unloadTicks (a 100x hold)", read: (s) => bigHoldMissionDef(s).unloadTicks },
  missionTransitOutTicks: { label: "effectiveMissionDef(longOreRun).transitOutTicks", read: (s) => missionDefFor(s, "longOreRun").transitOutTicks },
  missionExtractionTicks: {
    label: "effectiveMissionDef(longOreRun) extracting ticks (a 100x hold)",
    read: (s) => {
      const d = bigHoldMissionDef(s);
      return d.extractionTicksOverride ?? Math.ceil(d.cargoCapacity / d.extractionRatePerTick);
    },
  },
  // == the extraction roll (one real economyTick, controlled draws) ==
  extractionCommonPerTick: { label: "economyTick extracting: common ore per tick (shortOreRun)", read: (s) => extractingCargo(s, "shortOreRun", 0.999999).common },
  extractionUncommonPerTick: {
    label: "economyTick extracting: uncommon per tick (salvageWreckage)",
    read: (s) => extractingCargo(s, "salvageWreckage", MISSIONS.salvageWreckage.rareChance + (MISSIONS.salvageWreckage.uncommonChance - MISSIONS.salvageWreckage.rareChance) / 2).uncommon,
  },
  extractionRarePerTick: { label: "economyTick extracting: rare per tick (shortOreRun)", read: (s) => extractingCargo(s, "shortOreRun", 0).rare },
  extractionRareThreshold: { label: "economyTick extracting: rare-roll threshold", read: (s, ctx) => extractionThreshold(s, ctx === "mission:survey" ? "surveyMineralAnomaly" : "shortOreRun", "rare") },
  extractionUncommonThreshold: { label: "economyTick extracting: uncommon-roll threshold (salvageWreckage)", read: (s) => extractionThreshold(s, "salvageWreckage", "uncommon") },
  surveyCommonPerTick: { label: "economyTick extracting: survey common per tick", read: (s) => extractingCargo(s, "surveyMineralAnomaly", 0.999999).common },
  bonusRollTrigger: {
    label: "the bonus-roll trigger chance economyTick computes (tick.ts:2275)",
    read: (s) => {
      const c = captainOf(s);
      return captainBonusRollChance(c) * (1 + captainBonusRollChanceMult(c)) + captainSpecBonusRollChance(c);
    },
  },
  passiveTrickle: {
    label: "economyTick: Titanium Ore gained in one idle tick",
    read: (s) => {
      const idle = editCaptain(s, { mission: null } as Partial<CaptainState>);
      const after = economyTick(idle, 1, () => 0.5);
      return heldOf(after, "commonOre") - heldOf(idle, "commonOre");
    },
  },
  missionOutputBonus: {
    label: "shipMissionOutputBonus (the share economyTick applies to mission deliveries and to patrol wave loot; mission:shortRange: the share one delivered short-range cycle applied)",
    read: (s, ctx) => (ctx === "mission:shortRange" ? shortRangeOutputShare(s) : shipMissionOutputBonus(s, shipOf(s))),
  },
  // WR-9 (OC-E6): one whole Long Ore Run cycle's ticks on the sheet (missionCycleTiming of effectiveMissionDef).
  missionCycleTicks: { label: "missionCycleTiming(effectiveMissionDef(longOreRun)).total", read: (s) => missionCycleTiming(missionDefFor(s, "longOreRun")).total },
  // WR-9 fix round (user 2026-10-31 "Missions, short-range, patrols"): the same count on each run type the roll reaches.
  missionReturnTicks: {
    label: `a Short Ore Run's return-leg ticks over its first ${PILOT_PROBE_CYCLES} cycles (economyTick, 1 s steps; mission:shortRange: the legs home of ${PILOT_PROBE_CYCLES} short-range cycle starts on a stamped run; patrol: the frozen legs home of ${PILOT_PROBE_CYCLES} patrol dispatches)`,
    read: (s, ctx) => (ctx === "mission:shortRange" ? shortRangeReturnTicks(s) : ctx === "patrol" ? patrolReturnTicks(s) : missionReturnTicks(s)),
  },
  missionCycleOutput: { label: "one whole shortOreRun cycle (economyTick): the credits and Titanium Ore delivered", read: (s) => cycleOutput(s) },
  missionOreQuality: { label: "one whole shortOreRun cycle (economyTick): the average quality of the ore delivered (quality-weighted units over units)", read: (s) => cycleOreQuality(s) },
  // == the captain secondary tree (WR-5a) ==
  deliveryQualityClimb: {
    label: "economyTick's mission deposit: the largest constant draw whose delivered ore still climbs to quality 1 (shortOreRun; mission:shortRange: a Supply Pickup)",
    read: (s, ctx) => deliveryQualityThreshold(s, ctx),
  },
  motherlodeRate: {
    label: "economyTick deliveries: the share of 1,000 real deliveries whose haul landed doubled, lifetime counter 0 to 999 (shortOreRun; mission:shortRange: a Supply Pickup)",
    read: (s, ctx) => motherlodeRate(s, ctx),
  },
  transportCycleCredits: {
    label: "one whole frontierSupplyRun cycle (economyTick): the net credits it delivered (mission:shortRange: one Supply Drop-off cycle)",
    read: (s, ctx) => {
      const { before, after } = ctx === "mission:shortRange" ? shortRangeCycle(s, "supplyDropOff") : oneCycle(s, "frontierSupplyRun");
      return Number(after.credits) - Number(before.credits);
    },
  },
  dockedCredits: {
    label: "economyTick: credits gained in one tick with captain 1 docked",
    read: (s) => {
      const idle = editCaptain(s, { mission: null } as Partial<CaptainState>);
      const after = economyTick(idle, 1, () => 0.5);
      return Number(after.credits) - Number(idle.credits);
    },
  },
  rareFind: {
    label: "crew rare find: Expedition.crewRareFind (relic roll) / crew.rareFindChance read by survey rare odds (tick.ts:4148)",
    read: (s, ctx) => (ctx === "mission:survey" ? shipCrewContribution(s, shipOf(s))[CREW_STAT_KEYS.rareFindChance] ?? 0 : dispatchRun(s).crewRareFind ?? 0),
  },
  injuryCare: {
    label: "injury care: groundOps.factors.medicalShare (medical bay) / injuryRecoverySeconds (legacy claim)",
    read: (s, ctx) => (ctx === "expedition:legacy" ? injuryRecoverySeconds(shipInjuryFactors(s, shipOf(s))) : dispatchRun(s).groundOps?.factors.medicalShare ?? 0),
  },
  // == captain progression ==
  captainXpPerTick: { label: "xpPerTick(shortOreRun) x retirementExpMultiplier", read: (s) => xpPerTick("shortOreRun", captainOf(s), s) * retirementExpMultiplier(s) },
  // == ship combat ==
  officerWeapons: { label: "officerCombatMods.weaponDamage", read: (s) => officerCombatMods(s, shipOf(s))?.weaponDamage ?? 0 },
  patrolCycleOneWeapons: { label: "dispatchCaptainOnPatrol: the first cycle's frozen officerCombat.weaponDamage", read: (s) => patrolCycleOneWeapons(s) },
  officerShields: { label: "officerCombatMods.shield", read: (s) => officerCombatMods(s, shipOf(s))?.shield ?? 0 },
  officerHull: { label: "officerCombatMods.hull", read: (s) => officerCombatMods(s, shipOf(s))?.hull ?? 0 },
  officerEvasion: {
    label: "evasion: officerCombatMods.evasion (ship battles) / Expedition.encounterEvasion (scan encounters)",
    read: (s, ctx) => (ctx === "expedition:groundOps" ? dispatchRun(s).encounterEvasion ?? 0 : officerCombatMods(s, shipOf(s))?.evasion ?? 0),
  },
  officerHullMult: { label: "1 + officerCombatMods.hull", read: (s) => 1 + (officerCombatMods(s, shipOf(s))?.hull ?? 0) },
  combatHullMax: {
    label: "hullMax: shipToCombatant (patrol) / the ship-event combatant from the profile frozen at dispatch (shipEvent)",
    read: (s, ctx) => (ctx === "shipEvent" ? shipEventCombatant(s)?.hullMax ?? 0 : playerCombatant(s).hullMax),
  },
  combatShieldMax: {
    label: "shieldMax: shipToCombatant (patrol) / the ship-event combatant (shipEvent)",
    read: (s, ctx) => (ctx === "shipEvent" ? shipEventCombatant(s)?.shieldMax ?? 0 : playerCombatant(s).shieldMax),
  },
  combatShieldRecharge: {
    label: "shieldRecharge: shipToCombatant (patrol) / the ship-event combatant (shipEvent)",
    read: (s, ctx) => (ctx === "shipEvent" ? shipEventCombatant(s)?.shieldRecharge ?? 0 : playerCombatant(s).shieldRecharge),
  },
  combatShieldCoherence: { label: "shipToCombatant.shieldCoherence", read: (s) => playerCombatant(s).shieldCoherence },
  combatAblativeArmor: { label: "shipToCombatant.ablativeArmor", read: (s) => playerCombatant(s).ablativeArmor },
  combatKineticDampening: { label: "shipToCombatant.kineticDampening", read: (s) => playerCombatant(s).kineticDampening },
  combatEvasion: { label: "shipToCombatant.evasion", read: (s) => playerCombatant(s).evasion },
  combatWeaponYield: { label: "shipToCombatant first weapon yieldMax", read: (s) => playerCombatant(s).weapons[0]?.yieldMax ?? 0 },
  combatWeaponAccuracy: { label: "shipToCombatant first weapon accuracy", read: (s) => playerCombatant(s).weapons[0]?.accuracy ?? 0 },
  combatWeaponCount: { label: "shipToCombatant weapon count", read: (s) => playerCombatant(s).weapons.length },
  combatDroneHp: { label: "shipToCombatant first squadron droneHp", read: (s) => playerCombatant(s).drones[0]?.droneHp ?? 0 },
  combatDroneAccuracy: { label: "shipToCombatant first squadron accuracy", read: (s) => playerCombatant(s).drones[0]?.accuracy ?? 0 },
  combatDroneCount: { label: "shipToCombatant squadron count", read: (s) => playerCombatant(s).drones.length },
  waveHullRegen: { label: "damageControlEffect.waveHullRegenFraction (tick.ts:3002)", read: (s) => damageControlEffect(equippedFor(s, WIRING_SHIP_ID)).waveHullRegenFraction },
  // == WR-5b: the captain Tactician seams (patrol: the wave combatant / the dispatched cycle; shipEvent: the frozen
  // ship-event combatant) ==
  captainShotDamage: {
    label: "captainProjectileDamage: the mean of 1,000 raw-100 projectiles at a target below half hull (patrol / shipEvent)",
    read: (s, ctx) => meanShot(battleCombatant(s, ctx), false),
  },
  captainShotDamageHighHealth: {
    label: "captainProjectileDamage: the mean of 1,000 raw-100 projectiles at a target above half hull (patrol / shipEvent)",
    read: (s, ctx) => meanShot(battleCombatant(s, ctx), true),
  },
  captainOpeningShot: {
    label: "captainProjectileDamage: a fresh weapon's first raw-100 projectile (patrol / shipEvent)",
    read: (s, ctx) => meanShot(battleCombatant(s, ctx), false, true),
  },
  captainWeaponAccuracy: { label: "the first weapon's accuracy (patrol / shipEvent)", read: (s, ctx) => battleCombatant(s, ctx).weapons[0]?.accuracy ?? 0 },
  captainWeaponCooldown: {
    label: "the first weapon's effective cooldown: cooldownDeciSec / (chargeRatePct / 100) (patrol / shipEvent)",
    read: (s, ctx) => {
      const w = battleCombatant(s, ctx).weapons[0];
      return w ? (w.cooldownDeciSec * 100) / (w.chargeRatePct ?? 100) : 0;
    },
  },
  captainIncomingHit: { label: "incomingHitChance: a 100% shot against the ship (patrol / shipEvent)", read: (s, ctx) => incomingHitChance(battleCombatant(s, ctx), 100) },
  captainLethalSurvived: {
    label: "a lethal hit on the shieldless ship: 1 when it is still standing (patrol / shipEvent)",
    read: (s, ctx) => {
      const c = battleCombatant(s, ctx);
      c.shield = 0;
      applyProjectileDamage(c, "kinetic", 0, 0, c.hull + 10_000);
      return c.hull > 0 ? 1 : 0;
    },
  },
  captainDroneShot: {
    label: "captainDroneDamage: the mean of 1,000 raw-100 drone hits (patrol / shipEvent)",
    read: (s, ctx) => {
      const c = battleCombatant(s, ctx);
      const carry = { milli: 0 };
      let total = 0;
      for (let i = 0; i < 1000; i++) total += captainDroneDamage(c.captainEdge, carry, SHOT_RAW);
      return total / 1000;
    },
  },
  // == E-MOD EM-7: the universal modules' combat engines, through the real battle (resolveBattle / fireWeapon) ==
  moduleArcDamage: {
    label: `resolveBattle: the largest single module arc (moduleProc events) over ${MODULE_BATTLE_SEEDS} battles against an unshielded, unarmored Battleship (patrol / shipEvent)`,
    read: (s, ctx) => moduleProcTotal(s, ctx, "arcDamage"),
  },
  moduleShieldRestored: {
    label: `resolveBattle: the largest single module shield restore, per-mille of the ship's shield pool, over ${MODULE_BATTLE_SEEDS} battles against a Battleship (patrol / shipEvent)`,
    read: (s, ctx) => moduleProcTotal(s, ctx, "shieldRestore"),
  },
  moduleLowHullShot: {
    label: `fireWeapon: the mean damage of the first weapon's volley over ${MODULE_SHOT_SEEDS} seeds, the ship at ${MODULE_LOW_HULL_PERCENT}% hull, at an unarmored target (patrol / shipEvent)`,
    read: (s, ctx) => moduleLowHullShot(s, ctx),
  },
  moduleBonusHaul: {
    label: `economyTick deliveries: the mean extra Titanium Ore over ${MODULE_HAUL_BATCH} real 10-ore shortOreRun deliveries, the captain's lifetime module counter 0 to ${MODULE_HAUL_BATCH - 1}`,
    read: (s) => moduleBonusHaul(s),
  },
  moduleScanDiscoveries: {
    label: `rollBodyDiscoveries on the dispatched run: the mean discoveries per body over ${MODULE_SCAN_BODIES} synthetic bodies (every planet type, body index 0 to ${MODULE_SCAN_BODIES - 1})`,
    read: (s) => moduleScanDiscoveries(s),
  },
  battleDroneHp: { label: "the first squadron's droneHp: the patrol cycle's seed / the ship-event combatant", read: (s, ctx) => battleDrones(s, ctx)[0]?.droneHp ?? 0 },
  battleDroneReplenish: {
    label: "the first squadron's droneReplenishRate: the patrol cycle's seed / the ship-event combatant",
    read: (s, ctx) => battleDrones(s, ctx)[0]?.droneReplenishRate ?? 0,
  },
  // 0.14.0 (CP-4, OC-1): the between-wave replenish a patrol cycle's first squadron really pays, through the consumer
  // (droneDefense.ts replenishUnits, Deck Handling banked), as a share of its plain rate over REPLENISH_PROBE_TICKS
  // ticks with every drone down: 1 + deckHandling, within one banked unit over the span.
  patrolReplenishShare: { label: "replenishUnits over a long recovery / (ticks x droneReplenishRate): 1 + Deck Handling", read: (s) => patrolReplenishShare(s) },
  battleDroneSquadrons: { label: "the squadron count: the patrol cycle's seed / the ship-event combatant", read: (s, ctx) => battleDrones(s, ctx).length },
  patrolRewardMult: {
    label: "patrolWaveRewardMult(0, the dispatched cycle's captainCombat): a won wave's loot and credit factor",
    read: (s) => patrolWaveRewardMult(0, dispatchedPatrol(s).captainCombat),
  },
  captainRepairRate: {
    label: "hull repair rate: 1 + the Shipyard divisor shipRepairDurationTicks divides by / 1 + the frozen field repair divisor (Ground Ops) / the cycle's between-wave patch-up fraction (patrol)",
    read: (s, ctx) => {
      if (ctx === "expedition:groundOps") return 1 + (snapshotShipEventProfile(s, shipOf(s)).battle?.repairSpeed ?? 0);
      if (ctx === "patrol") return captainWaveRegenFraction(damageControlEffect(equippedFor(s, WIRING_SHIP_ID)).waveHullRegenFraction, dispatchedPatrol(s).captainCombat);
      return 1 + shipyardRepairSpeedBonus(s, shipOf(s));
    },
  },
  // == Shipyard ==
  repairTicks: {
    label: "shipRepairDurationTicks (500 damage)",
    read: (s) => {
      const ship = { ...shipOf(s), damaged: true, repairDamage: 500 };
      // CP-2 + WR-5b: the Shipyard's divisor (officers + complement, x the commanding captain's Damage Control when owned).
      return shipRepairDurationTicks(ship, equippedFor(s, ship.id), shipyardRepairSpeedBonus(s, ship));
    },
  },
  officerRepairBonus: {
    label: "recovery speed-up: officerRepairSpeedBonus (Shipyard) / groundOps.factors.rapidRecoveryShare (medical bay)",
    read: (s, ctx) => (ctx === "medbay" ? dispatchRun(s).groundOps?.factors.rapidRecoveryShare ?? 0 : officerRepairSpeedBonus(s, shipOf(s))),
  },
  turnaround: {
    label:
      "turnaround: effectiveShipStats.unloadSpeedMult (missions) / 1 + shipRepairSpeedBonus (Shipyard) / 1 + the field repair speed frozen at dispatch (shipEvent)",
    read: (s, ctx) =>
      ctx === "shipyard"
        ? 1 + shipRepairSpeedBonus(s, shipOf(s))
        : ctx === "shipEvent"
          ? 1 + (dispatchRun(s).groundOps?.shipEventProfile.battle?.repairSpeed ?? 0)
          : sheet(s).unloadSpeedMult ?? 1,
  },
  // CP-2 (OC-E8): the museum's crewBonuses where it amplifies: the complement on the sheet (unload) and an officer
  // bonus read directly (Fleet Triage, frozen on the run as squadTriage), each as 1 + the amplified share.
  crewAmplified: {
    label: "crew amplification: effectiveShipStats.unloadSpeedMult (sheet) / 1 + Expedition.squadTriage (ground)",
    read: (s, ctx) => (ctx === "ground" ? 1 + (dispatchRun(s).squadTriage ?? 0) : sheet(s).unloadSpeedMult ?? 1),
  },
  shipyardBays: { label: "shipyardBayCount", read: (s) => shipyardBayCount(s) },
  shipBuildTicks: { label: "shipBuildDurationTicks(destroyer)", read: (s) => shipBuildDurationTicks(s, "destroyer") },
  shipyardFounded: { label: "canBuildShip passes the founded gate (0/1)", read: (s) => buildGatePassed(s, "notFounded") },
  overtimeTicks: {
    label: "a running job's remaining ticks (processSpeed.ts Overtime): a hull build / a research project / a facility rung",
    read: (s, ctx) => s.activeProcesses.find((p) => p.kind === RUNNING_JOB_KIND[ctx])?.remainingTicks ?? -1,
  },
  dockRoom: { label: "canBuildShip passes the docks gate (0/1)", read: (s) => buildGatePassed(s, "storageFull") },
  // == facilities ==
  refineSlots: { label: "refineSlotCount", read: (s) => refineSlotCount(s) },
  refineJobTicks: { label: "refineJobDurationTicks(1000)", read: (s) => refineJobDurationTicks(s, 1000) },
  tier1Cap: { label: "tierCap(1)", read: (s) => Number(tierCap(s, 1)) },
  tier2Cap: { label: "tierCap(2)", read: (s) => Number(tierCap(s, 2)) },
  // WR-4 (OC-C1): the Fuel Depot's fleet reach (shipReachDef scales every ship's reach by 1 + this).
  fleetReach: { label: "fleetReachBonus (the Fuel Depot rungs)", read: (s) => fleetReachBonus(s) },
  researchSlots: { label: "researchSlotCount", read: (s) => researchSlotCount(s) },
  fabricateSlots: { label: "fabricateSlotCount", read: (s) => fabricateSlotCount(s) },
  salvageLanes: { label: "salvageSlotCount", read: (s) => salvageSlotCount(s) },
  // G1-3: the short-range board's slot count (shortRangeBoard.ts, derived from the Mission Control level).
  shortRangeSlots: { label: "shortRangeBoardSlots (count)", read: (s) => shortRangeBoardSlots(s).length },
  // G1-6: whether the next Mission Control rung can be built now (1) or not (0): the board rung's completion gate.
  missionControlBuildable: { label: "canBuildFacilityUpgrade(missionControl).ok (1 / 0)", read: (s) => (canBuildFacilityUpgrade(s, "missionControl").ok ? 1 : 0) },
  missionsUnlocked: { label: "missions unlocked (count)", read: (s) => (Object.keys(MISSIONS) as MissionKey[]).filter((k) => missionUnlocked(s, k)).length },
  // Expedition Tiers G2-6: at Ground Ops, the deepest region tier whose candidates the console's picker reads (every
  // candidate of that tier inside the telescope's range: not a blind launch); 0 when it reads none.
  telescopeReach: {
    label: "telescopeReading.reachTier (Ground Ops: the deepest tier the console's candidates read, not blind)",
    read: (s, ctx) => {
      if (ctx !== "expedition:groundOps") return telescopeReading(s).reachTier;
      const ready = readyForRun(s);
      let best = 0;
      for (const t of REGION_TIERS) if (expeditionCandidates(ready, WIRING_SHIP_ID, t).every((c) => !c.telescope.blind)) best = t;
      return best;
    },
  },
  telescopeDetail: { label: "telescopeReading.detail", read: (s) => telescopeReading(s).detail },
  equipmentStorage: { label: "equipmentStorageCap", read: (s) => equipmentStorageCap(s) },
  berths: { label: "transitBerthCount", read: (s) => transitBerthCount(s) },
  researchTicks: {
    label: "a long project's research ticks through the museum research speed (tick.ts:7419; 1000x a blueprint's)",
    read: (s) => museumResearchDurationTicks(Object.values(BLUEPRINTS)[0].researchDurationTicks * RESEARCH_PROBE_SCALE, museumBonuses(s).researchSpeed),
  },
  craftQualityClimb: { label: "rollQuality first-climb threshold at the museum crafting quality", read: (s) => qualityClimbThreshold(museumBonuses(s).craftingQuality) },
  // == fleet readers ==
  fleetRareYield: { label: "fleetRareYieldMult", read: (s) => fleetRareYieldMult(s) },
  queueDepthRefinery: { label: "queueDepth(refinery)", read: (s) => queueDepth(s, "refinery") },
  queueDepthFabricator: { label: "queueDepth(fabricator)", read: (s) => queueDepth(s, "fabricator") },
  queueDepthSalvageBay: { label: "queueDepth(salvageBay)", read: (s) => queueDepth(s, "salvageBay") },
  queueDepthResearchLab: { label: "queueDepth(researchLab)", read: (s) => queueDepth(s, "researchLab") },
  queueDepthShipyard: { label: "queueDepth(shipyard)", read: (s) => queueDepth(s, "shipyard") },
  craftingIlevelBonus: { label: "craftingItemLevelBonus", read: (s) => craftingItemLevelBonus(s) },
  salvageTalentYield: {
    // WR-6: the teardown reads hullTeardownFraction at the middle band draw (what salvageShip recovers from); the
    // realized refund that fraction drives is teardownRecovered (wiringPlaceholderTalents.test.ts).
    label: "salvageTalentBonus.yieldBonus (recycle fraction) / salvage:teardown: hullTeardownFraction at the middle band draw",
    read: (s, ctx) => (ctx === "salvage:teardown" ? hullTeardownFraction(s, 0.5) : salvageTalentBonus(s).yieldBonus),
  },
  // == WR-6: the Homeworld hubs ==
  fabricatorBonusShare: {
    label: "the share of 1,000 real Fabricator jobs (startProcess, then resolveProcesses) delivering a second blank",
    read: (s) => fabricatorBonusShare(s),
  },
  patrolShieldPool: {
    label: "the dispatched patrol cycle's full shield pool (playerShield, from the frozen captain combat record)",
    read: (s) => dispatchedPatrol(s).playerShield,
  },
  transportCrewDelivered: {
    label: "crew one transport window delivers (resolveCrew: the pool plus every complement)",
    read: (s) => transportCrewDelivered(s),
  },
  salvageTalentCeiling: {
    label: "salvageTalentBonus.ceilingBonus / salvage:topTier: a top Fleet Admiral's loot reach (the clamped ceiling plus the talent's tiers past the top that tilt the weights, salvageTierReach)",
    read: (s, ctx) => (ctx === "salvage:topTier" ? topTierRolled(s) : salvageTalentBonus(s).ceilingBonus),
  },
  salvageYield: { label: "salvageYieldMult", read: (s) => salvageYieldMult(s) },
  captainCount: { label: "captains (count)", read: (s) => s.captains.length },
  researchableBlueprints: { label: "blueprints a top-level Research Lab can start (blueprintResearchable)", read: (s) => researchableCount(s) },
  legacyInjurySeconds: { label: "applyExpeditionInjuries on a legacy run: the downed Security member's recovery", read: (s) => legacyInjurySeconds(s) },
  groundOpsRun: { label: "the Ground Ops run digest (candidates, the dispatch record, the run played out)", read: (s) => groundOpsRunDigest(s) },
  patrolRun: { label: "the patrol cycle digest (dispatch, one cycle through economyTick)", read: (s) => patrolDigest(s) },
  // == crew modules ==
  quartersCapacity: { label: "quartersCapacityBonus", read: (s) => quartersCapacityBonus(s, shipOf(s)) },
  // WR-7 (OC-D3): the installed bridge module's output multiplier on one officer (bridgeOfficerMultiplier, the reader
  // the crew overlay applies to every assigned officer); 1 without a bridge module.
  bridgeOfficerMult: {
    label: "bridgeOfficerMultiplier (the installed bridge module, one tactical officer)",
    read: (s) => {
      const ship = shipOf(s);
      const mod = installedBridgeModule(s, ship);
      return mod ? bridgeOfficerMultiplier(mod, { seat: "tactical", rank: 1 } as unknown as SeniorStaffOfficer, hullSpecOf(ship)) : 1;
    },
  },
  // WR-7 (OC-D7 "Spread across divisions"): the berths an EMPTY complement can actually fill, the quarters bonus
  // included: the sum over the divisions of the room for a Crewman (commandStructure.ts remainingCapacityForSignature,
  // the gate auto-crew and transfer fill through), never above the total cap. B22: before WR-7 a module raised the
  // total alone, so the division caps kept this at +0 or +1.
  fillableBerths: {
    label: "berths an empty complement can fill (sum of remainingCapacityForSignature per division, capped at the total)",
    read: (s) => {
      const ship = shipOf(s);
      const bonus = quartersCapacityBonus(s, ship);
      const empty = { buckets: [] } as unknown as ShipComplement;
      let room = 0;
      for (const profession of CREW_PROFESSIONS) room += remainingCapacityForSignature(empty, ship.typeKey, { profession, rank: 1 } as CrewSignature, bonus);
      return Math.min(complementTotalCap(ship.typeKey, bonus), room);
    },
  },
  // Complement plan CP-5 (per-hull crew caps): the crew the auto-crew fill (resolveCrew, the passive tick path) actually
  // seats on ship-1, passive and empty, from a deep pool holding every division at every rank: the hull's own total,
  // division and rank caps decide it.
  autoCrewHeadcount: {
    label: "crew resolveCrew seats on an empty passive ship-1 from a deep pool (every division at every rank)",
    read: (s) => autoCrewHeadcount(s),
  },
  // CP-5: the same fill, counting only the hull's LEADING division (its largest complementDivisionWeights share; -1 for a
  // hull with no division mix of its own).
  autoCrewLeanSeats: {
    label: "crew resolveCrew seats in ship-1's leading division (its hull's largest complementDivisionWeights share), from a deep pool",
    read: (s) => autoCrewLeanSeats(s),
  },
  // == expedition dispatch snapshot and its consumers ==
  expSquadTriage: { label: "dispatch: Expedition.squadTriage", read: (s) => dispatchRun(s).squadTriage ?? 0 },
  // CP-3: Away-Team Protection as frozen on the dispatched run (the share every Security member's max HP grows by).
  expSquadHpBonus: { label: "dispatch: Expedition.squadHpBonus (Away-Team Protection)", read: (s) => dispatchRun(s).squadHpBonus ?? 0 },
  expEncounterChance: {
    label: "scanEncounterChance on a hazard-0.4 world",
    read: (s) => scanEncounterChance(dispatchRun(s), syntheticBody("terrestrial", 0.4)),
  },
  expReloadMult: { label: "dispatch: groundOps.factors.reloadMult", read: (s) => dispatchRun(s).groundOps?.factors.reloadMult ?? 1 },
  expOffloadMult: { label: "dispatch: groundOps.factors.offloadMult", read: (s) => dispatchRun(s).groundOps?.factors.offloadMult ?? 1 },
  expBoardingRepel: {
    label: "boardingRepelChance(frozen boardingDefense)",
    read: (s) => boardingRepelChance(dispatchRun(s).groundOps?.shipEventProfile.boardingDefense ?? 0),
  },
  expBoardingDefense: { label: "dispatch: shipEventProfile.boardingDefense", read: (s) => dispatchRun(s).groundOps?.shipEventProfile.boardingDefense ?? 0 },
  expScanRate: { label: "scanRatePerSecond on a hazard-0 world", read: (s) => scanRatePerSecond(dispatchRun(s), syntheticBody("terrestrial", 0)) },
  expScanRateHazard: { label: "scanRatePerSecond on a hazard-0.9 world", read: (s) => scanRatePerSecond(dispatchRun(s), syntheticBody("toxic", 0.9)) },
  expSensorPower: { label: "dispatch: Expedition.sensorPower", read: (s) => dispatchRun(s).sensorPower },
  expScanSpeedBonus: { label: "dispatch: Expedition.scanSpeedBonus", read: (s) => dispatchRun(s).scanSpeedBonus ?? 0 },
  expHazardResist: { label: "dispatch: Expedition.hazardResist", read: (s) => dispatchRun(s).hazardResist ?? 0 },
  expRelicFindBonus: { label: "dispatch: Expedition.relicFindBonus", read: (s) => dispatchRun(s).relicFindBonus ?? 0 },
  expActivityRelicFind: { label: "activityRelicFindBonus (no fieldwork)", read: (s) => activityRelicFindBonus(dispatchRun(s), { relicFind: 0 }) },
  expScienceStrength: { label: "deriveAwayTeam.scienceStrength", read: (s) => deriveAwayTeam(s, shipOf(s)).scienceStrength },
  expSecurityStrength: { label: "deriveAwayTeam.securityStrength", read: (s) => deriveAwayTeam(s, shipOf(s)).securityStrength },
  expTeamKit: { label: "deriveAwayTeam.teamKit", read: (s) => deriveAwayTeam(s, shipOf(s)).teamKit },
  expScanRateMult: { label: "dispatch: scanParams.scanRateMult", read: (s) => dispatchRun(s).scanParams.scanRateMult },
  expCoverageWidth: { label: "dispatch: scanParams.coverageWidth", read: (s) => dispatchRun(s).scanParams.coverageWidth },
  // WR-7 (OC-D11): the discovery attempts the dispatched run's first body rolls (expedition.ts bodyDiscoveryAttempts,
  // the draw the discovery roll itself takes).
  runFirstBodyAttempts: { label: "bodyDiscoveryAttempts(dispatched run, body 0)", read: (s) => bodyDiscoveryAttempts(dispatchRun(s), 0) },
  expLandmarkBias: { label: "dispatch: scanParams.landmarkOddsBias", read: (s) => dispatchRun(s).scanParams.landmarkOddsBias },
  expUndergroundBias: { label: "dispatch: scanParams.undergroundPoiOddsBias", read: (s) => dispatchRun(s).scanParams.undergroundPoiOddsBias },
  // == WR-5c: the captain's explorer secondary nodes, through their consumers ==
  expDiscoveryOdds: {
    label: "discoveryOddsPermille: the dispatched run's surface odds on a terrestrial world",
    read: (s) => discoveryOddsPermille(dispatchRun(s).scanParams, "terrestrial").surface,
  },
  expDiscoveries: { label: "rollBodyDiscoveries: the dispatched run's finds over 24 synthetic bodies (every planet type)", read: (s) => discoveriesOver(dispatchRun(s)) },
  candDetail: { label: "expeditionCandidates[0].telescope.detail", read: (s) => expeditionCandidates(s, WIRING_SHIP_ID)[0].telescope.detail },
  runTaskSecPower: { label: "the dispatched run's Security member in a Ground Ops objective fight (taskFightTeam): power", read: (s) => runTaskMember(s, sec())?.power ?? 0 },
  runTaskSecAccuracy: { label: "the dispatched run's Security member in a Ground Ops objective fight (taskFightTeam): accuracy", read: (s) => runTaskMember(s, sec())?.accuracy ?? 0 },
  runRelicChance: {
    label: "relicChancePermille: the dispatched run's relic chance on a hazard-0.5 objective (no fieldwork)",
    read: (s) => {
      const run = dispatchRun(s);
      return relicChancePermille(0.5, activityRelicFindBonus(run, { relicFind: 0 }), run.explorerCaptain?.relicFindMult);
    },
  },
  runRelicTierCeiling: { label: "relicTierCeiling: the dispatched run's tier ceiling on a hazard-0 objective", read: (s) => relicTierCeiling(0, dispatchRun(s).explorerCaptain?.relicTierLift) },
  runRelicStudyTicks: { label: "startRelicStudy: the duration of a relic the dispatched run recovers, brought home and studied", read: (s) => runRelicStudyTicks(s) },
  crewMapCargo: { label: "shipCrewContribution[crew.effectiveCargo]", read: (s) => shipCrewContribution(s, shipOf(s))[CREW_STAT_KEYS.effectiveCargo] ?? 0 },
  missionCrewHours: { label: "economyTick: an officer's crewHours after 600 s of a Short Ore Run (mission:shortRange: of a short-range run)", read: (s, ctx) => missionCrewHours(s, ctx) },
  claimObjectives: { label: "claimExpedition: an officer's personnelAchievement after a run with one objective done", read: (s) => claimedObjectives(s) },
  officerBoard: { label: "seniorStaffCandidates (count)", read: (s) => seniorStaffCandidates(s).length },
  recruitBoard: { label: "awayRecruitCandidates (count)", read: (s) => awayRecruitCandidates(s).length },
  arrayRelicFind: { label: "sensorArrayRelicFindBonus", read: (s) => sensorArrayRelicFindBonus(installedSensorArray(s, shipOf(s))) },
  // Gas Giant Study GG-7: the Resonance Sensor Array's canister band lift (the reader the dispatch freezes).
  arrayBandLift: { label: "sensorArrayCanisterBandLift", read: (s) => sensorArrayCanisterBandLift(installedSensorArray(s, shipOf(s))) },
  arrayLandmarkBias: {
    label: "sensorArrayEffect.landmarkOddsBias",
    read: (s) => {
      const a = installedSensorArray(s, shipOf(s));
      return a ? sensorArrayEffect(a).landmarkOddsBias : 0;
    },
  },
  pathfinderScan: { label: "pathfinderEffect.scanSpeed", read: (s) => pathfinderEffect(equippedFor(s, WIRING_SHIP_ID)).scanSpeed },
  pathfinderHazard: { label: "pathfinderEffect.hazardResist", read: (s) => pathfinderEffect(equippedFor(s, WIRING_SHIP_ID)).hazardResist },
  // WR-7 (OC-D10 "Field repairs too"): at Ground Ops, the reduction the dispatched run froze for its field repairs
  // (ShipEventBattle.dcRepairTimeReduction, which groundOps.ts fieldRepairSeconds applies); the patrol reads its cycle.
  dcRepairReduction: {
    label: "damageControlEffect.repairTimeReduction (Ground Ops: the field repair reduction the run froze; patrol: the cycle digest)",
    read: (s: GameState, ctx: ContextId) =>
      ctx === "expedition:groundOps"
        ? dispatchRun(readyForRun(s)).groundOps?.shipEventProfile.battle?.dcRepairTimeReduction ?? 0
        : sheetAt((x) => damageControlEffect(equippedFor(x, WIRING_SHIP_ID)).repairTimeReduction)(s, ctx),
  },
  // == injuries ==
  // == the Security squad (real roster builder) ==
  secHp: { label: "Security combatant hp", read: (s) => memberCombatant(s, sec())?.hp ?? 0 },
  secPower: { label: "Security combatant power", read: (s) => memberCombatant(s, sec())?.power ?? 0 },
  secArmor: { label: "Security combatant armor", read: (s) => memberCombatant(s, sec())?.armor ?? 0 },
  secAccuracy: { label: "Security combatant accuracy", read: (s) => memberCombatant(s, sec())?.accuracy ?? 0 },
  secInflictPermille: {
    label: "Security combatant on-hit status permille (sum; ground:noInflict: with every inflict piece taken off)",
    read: (s, ctx) => (memberCombatant(ctx === "ground:noInflict" ? withoutInflictPieces(s) : s, sec())?.onHitStatuses ?? []).reduce((a, x) => a + x.permille, 0),
  },
  secPoisonResist: { label: "Security combatant poison resist permille", read: (s) => memberCombatant(s, sec())?.resists?.poison ?? 0 },
  // Field Kits FKR-4: the resists a Field Kits run's inflictors roll against (gambit.ts statusResistPermille).
  secFearResist: { label: "Security combatant fear resist permille", read: (s) => memberCombatant(s, sec())?.resists?.fear ?? 0 },
  secConcussionResist: {
    label: "Security combatant Concussion resist roll permille (statusResistPermille: Cortex Shield's stun resist covers it)",
    read: (s) => {
      const c = memberCombatant(s, sec());
      return c ? statusResistPermille(c, "concussion") : 0;
    },
  },
  runSecFearResist: {
    label: "the dispatched run's Security member in a Field Kits objective fight: fear resist (fraction; Morale Anchor folds in)",
    read: (s) => (runFieldKitsTaskMember(s, sec())?.resists?.fear ?? 0) / 1000,
  },
  runSecStoneskinResist: {
    label: "the dispatched run's Security member in a Field Kits objective fight: a physical status's resist roll (permille, Fracture)",
    read: (s) => {
      const c = runFieldKitsTaskMember(s, sec());
      return c ? statusResistPermille(c, "fracture") : 0;
    },
  },
  // Field Kits FKR-5: a Field Kits objective fight arms the member's worn grenade (fieldKitsGrenades.ts withThrownGrenades).
  runSecGrenadeCharges: {
    label: "the dispatched run's Security member in a Field Kits objective fight: grenade charges left (full at an objective's start)",
    read: (s) => runFieldKitsTaskMember(s, sec())?.grenade?.charges ?? 0,
  },
  runSecGrenadePower: {
    label: "the dispatched run's Security member in a Field Kits objective fight: the grenade blast's power multiplier",
    read: (s) => runFieldKitsTaskMember(s, sec())?.grenade?.powerMult ?? 0,
  },
  secGuardBelow: { label: "Security combatant guardBelow", read: (s) => memberCombatant(s, sec())?.guardBelow ?? 0 },
  secFirstStrike: { label: "Security combatant firstStrike (0/1)", read: (s) => (memberCombatant(s, sec())?.firstStrike ? 1 : 0) },
  secFirstAid: { label: "firstAidEffectiveness(Security combatant)", read: (s) => firstAidEffectiveness(memberCombatant(s, sec()) ?? { medic: false }) },
  secHeal: { label: "Security combatant heal", read: (s) => memberCombatant(s, sec())?.heal ?? 0 },
  secGroupHit: { label: "Security combatant groupHit", read: (s) => memberCombatant(s, sec())?.groupHit ?? 0 },
  secRevivePermille: { label: "Security combatant revive permille", read: (s) => memberCombatant(s, sec())?.revive?.permille ?? 0 },
  secResistSum: {
    label: "Security combatant status resists (permille, summed)",
    read: (s) => Object.values(memberCombatant(s, sec())?.resists ?? {}).reduce((a: number, x) => a + (x ?? 0), 0),
  },
  runSecHp: { label: "the dispatched run's Security combatant hp (expeditionTeamCombatants)", read: (s) => runMember(s, sec())?.hp ?? 0 },
  runSecHeal: { label: "the dispatched run's Security combatant heal (expeditionTeamCombatants)", read: (s) => runMember(s, sec())?.heal ?? 0 },
  // Complement plan CP-3: the Ground Ops consumers, read on the dispatched run's objective fight (groundFight.ts
  // taskFightTeam, the squad every Ground Ops task fields) and its medical bay.
  runTaskSecHp: { label: "the dispatched run's Security member in an objective fight: max HP (Away-Team Protection)", read: (s) => runFieldKitsTaskMember(s, sec())?.hpMax ?? 0 },
  runTaskSecHeal: { label: "the dispatched run's Security member in an objective fight: heal (Fleet Triage + Triage)", read: (s) => runFieldKitsTaskMember(s, sec())?.heal ?? 0 },
  runTaskSecDebuffResist: {
    label: "the dispatched run's Security member in an objective fight: Weakened resist roll (fraction; Counter-Infiltration)",
    read: (s) => {
      const c = runFieldKitsTaskMember(s, sec());
      return c ? statusResistPermille(c, "weakened") / 1000 : 0;
    },
  },
  runBayFractureSeconds: {
    label: "the dispatched run's medical bay: a Fracture's cure seconds on its frozen care (groundOpsBayCare; injuries only)",
    read: (s) => {
      const ops = dispatchRun(readyForRun(s)).groundOps;
      return ops ? memberBaySeconds(["fracture"], [], groundOpsBayCare(ops.factors)) : 0;
    },
  },
  // WR-9 (OC-E9): the dispatched run's objective haul (taskFullHaul on a hazard-0.4 terrestrial body, the first PoI, no
  // team): its credits plus material units, and the offload step's seconds for a batch carrying a whole objective.
  runObjectiveHaul: {
    label: "the dispatched run's objective haul (taskFullHaul, hazard-0.4 terrestrial, credits + material units)",
    read: (s) => {
      const h = taskFullHaul(dispatchRun(readyForRun(s)), [{ securityIds: [], scienceIds: [], scienceShare: 1 }], syntheticBody("terrestrial", 0.4), POI_CATALOG[0].id, 0);
      return h.credits + Object.values(h.materials).reduce((a, b) => a + b, 0);
    },
  },
  runPackedOffloadSeconds: {
    label: "the dispatched run's offload step for a batch carrying a whole objective (groundOffloadSeconds, 4 of 4 segments)",
    read: (s) => {
      const ops = dispatchRun(readyForRun(s)).groundOps;
      return ops ? groundOffloadSeconds(ops.factors, 4, 4) : 0;
    },
  },
  runBayHealthSeconds: {
    label: "the dispatched run's medical bay: a Health cure's seconds on its frozen care (groundOpsBayCare)",
    read: (s) => {
      const ops = dispatchRun(readyForRun(s)).groundOps;
      return ops ? memberBaySeconds(["health"], [], groundOpsBayCare(ops.factors)) : 0;
    },
  },
  secTaskHazardResist: {
    label: "taskSecurityHazardResist",
    read: (s) => taskSecurityHazardResist({ roster: rosterOf(s) as Expedition["roster"] }, [{ securityIds: [sec()], scienceIds: [sci()], scienceShare: 1 }]),
  },
  // Science members never fight (D2): their combat lines are read here through the SAME roster builder, which
  // takes only roster.security, so a Science piece's combat line reads 0 until the Science line swap.
  sciCombatPower: { label: "Science member's battle power (none: Science never fights)", read: (s) => squadCombatants(s).find((c) => c.memberId === sci())?.power ?? 0 },
  // == Science fieldwork ==
  fieldSpeed: { label: "fieldworkSpeedMult (best planet)", read: (s) => bestOverPlanets((p) => fieldworkSpeedMult(fieldworkRun(s), p)) },
  fieldRelicFind: { label: "fieldworkEffect.relicFind (best planet)", read: (s) => bestOverPlanets((p) => fieldworkEffect(fieldworkRun(s), p, POI_CATALOG[0].id).relicFind) },
  fieldHazardResist: { label: "fieldworkHazardResist (best planet)", read: (s) => bestOverPlanets((p) => fieldworkHazardResist(fieldworkRun(s), p)) },
  fieldYieldOrganics: { label: "fieldworkEffect(xenoFloraBloom).yieldMult (best planet)", read: (s) => bestOverPlanets((p) => fieldworkEffect(fieldworkRun(s), p, "xenoFloraBloom").yieldMult) },
  fieldYieldVault: { label: "fieldworkEffect(buriedVault).yieldMult (best planet)", read: (s) => bestOverPlanets((p) => fieldworkEffect(fieldworkRun(s), p, "buriedVault").yieldMult) },
  fieldYieldRuins: { label: "fieldworkEffect(ancientRuins).yieldMult (best planet)", read: (s) => bestOverPlanets((p) => fieldworkEffect(fieldworkRun(s), p, "ancientRuins").yieldMult) },
  fieldYieldMineral: { label: "fieldworkEffect(mineralOutcrop).yieldMult (best planet)", read: (s) => bestOverPlanets((p) => fieldworkEffect(fieldworkRun(s), p, "mineralOutcrop").yieldMult) },
  // == WR-8 (0.14.0): the combat descriptors (combatDescriptorProbes.ts, a leaf with its own on / off mark) ==
  ...COMBAT_DESCRIPTOR_PROBES,
  // WR-8: a Dispatch Once patrol's outbound leg in route ticks (the legs alone: no fight happens on them).
  patrolOutboundTicks: {
    label: "the first patrol's outbound leg (route ticks in transitOut)",
    read: (s) => {
      const r = dispatchCaptainOnPatrol(s, WIRING_CAPTAIN_ID, Object.keys(PATROLS)[0], "balanced", false);
      if (!r.success) return -1;
      let after = r.next;
      let ticks = 0;
      while ((captainOf(after).mission as PatrolMissionState | null)?.phase === "transitOut" && ticks < 10_000) {
        after = economyTick(after, 1, () => 0.5);
        ticks += 1;
      }
      return ticks;
    },
  },
  // OC-D8 follow-up: a Dispatch Once patrol's leg home in route ticks (the ticks it spends in transitBack; -1 for a run
  // that never flew home on it, a lost run limping instead).
  patrolReturnTicks: {
    label: "the first patrol's leg home (route ticks in transitBack)",
    read: (s) => {
      const r = dispatchCaptainOnPatrol(s, WIRING_CAPTAIN_ID, Object.keys(PATROLS)[0], "balanced", false);
      if (!r.success) return -1;
      let after = r.next;
      let ticks = 0;
      let back = 0;
      while (captainOf(after).mission !== null && ticks < 10_000) {
        if ((captainOf(after).mission as PatrolMissionState).phase === "transitBack") back += 1;
        after = economyTick(after, 1, () => 0.5);
        ticks += 1;
      }
      return back > 0 ? back : -1;
    },
  },
  // WR-8: the six per-family resist lines roll on crafted Hull Plating and Shield Emitters (resist picks over 300
  // two-affix rolls per variety; OFF leaves the resist lines out of the pool). A variety bias that silenced them fails.
  combatResistLinesRoll: {
    label: "rollDistinctAffixStats(plating / emitter pool): resist line picks",
    read: (s) => resistLinePicks(isOn(s)),
  },
  // WR-7 (OC-D6 "Unlisted = never rolls"): mass relief picks over 300 two-affix Cargo Bay rolls of a Hauler Hold, whose
  // statRatios does not list massReduction ("none into mass"). OFF: the same variety with massReduction listed at the
  // raw weight 1 an unlisted stat used to keep (B11), so the old rule reads as many picks as OFF.
  unlistedStatPicks: {
    label: "rollDistinctAffixStats(Cargo Bay pool, Hauler Hold): massReduction picks (unlisted: never)",
    read: (s) => {
      const slot = EQUIPMENT_SLOTS.cargoBay;
      const hauler = slot.varieties.find((v) => v.key === "haulerHold")!;
      const variety = isOn(s) ? hauler : { ...hauler, statRatios: { ...hauler.statRatios, massReduction: 1 } };
      const rng = makeRng(0x7b1f);
      let picks = 0;
      for (let i = 0; i < 300; i++) picks += rollDistinctAffixStats(slot.affixPool, variety, 2, () => rng.next()).filter((k) => k === "massReduction").length;
      return picks;
    },
  },
} satisfies Record<string, ProbeDef>;

// WR-8: how many of 300 two-affix rolls per Hull Plating and Shield Emitter variety pick a per-family resist line.
function resistLinePicks(withLines: boolean): number {
  const resist = new Set<string>([...PLATING_RESIST_LINES, ...EMITTER_RESIST_LINES]);
  let picks = 0;
  for (const slotType of ["hullPlating", "shieldEmitters"] as const) {
    const slot = EQUIPMENT_SLOTS[slotType];
    const pool = withLines ? slot.affixPool : slot.affixPool.filter((a) => !resist.has(a.stat));
    for (const variety of slot.varieties) {
      const rng = makeRng(0x7b1d);
      for (let i = 0; i < 300; i++) picks += rollDistinctAffixStats(pool, variety, 2, () => rng.next()).filter((k) => resist.has(k)).length;
    }
  }
  return picks;
}

// ============================================================================
// Content probes ("content:<family>:<args>"): content DATA the engine reads (weapons, drone roles, pirate hulls,
// patrols, statuses, gambit actions / selectors / presets, PoIs, planets, loot pools, sell values, mission fields).
// A content source is not something a save "owns", so its on / off is a MARK on the fixture state (sourceOn) that
// the probe reads to include the source or leave it out; "equals" probes read the consumer's value for the def.
// ============================================================================

const SOURCE_ON = new WeakSet<GameState>();

// The fixture with the content source switched ON (a fresh object, so the mark never leaks onto another state).
export function sourceOn(s: GameState): GameState {
  const next = { ...s };
  SOURCE_ON.add(next);
  return next;
}
function isOn(s: GameState): boolean {
  return SOURCE_ON.has(s);
}

// == ship battles ==

const DUEL_SEEDS = [11, 12345, 777];

// One duel per seed between a destroyer frame carrying `weapons` / `drones` and an enemy destroyer frame (armed with
// one autocannon when `enemyArmed`): the enemy's damage taken (hull + shield) and statuses on it, minus the player's
// own damage taken. Summed over the seeds. The enemy's shields do not recharge (WR-4): since B14 the player side
// acts first, and a light Attack squadron's damage was fully recharged by the time an armed enemy finished the duel,
// so the end-of-fight reading could not see it.
function duelScore(weapons: () => CombatWeapon[], drones: () => DroneSquadron[], enemyArmed: boolean): number {
  let total = 0;
  for (const seed of DUEL_SEEDS) {
    const p = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, weaponLoadout: weapons(), drones: drones() });
    const e = shipToCombatant({
      id: "e",
      team: "enemy",
      stats: { ...SHIP_TYPES.destroyer, shieldRecharge: 0 },
      weaponLoadout: enemyArmed ? [makeWeaponInstance("autocannon", "e-w0")] : [],
      drones: [],
    });
    const r = resolveBattle({ combatants: [p, e] }, seed, { generateLog: false });
    const fp = r.finalCombatants.find((c) => c.id === "p")!;
    const fe = r.finalCombatants.find((c) => c.id === "e")!;
    total += fe.hullMax + fe.shieldMax - Math.max(0, fe.hull) - Math.max(0, fe.shield) + fe.statusEffects.length;
    total -= fp.hullMax + fp.shieldMax - Math.max(0, fp.hull) - Math.max(0, fp.shield);
    // The player's drones still standing (a Support squadron repairs them; a Defense squadron shields).
    for (const sq of fp.drones) for (const d of sq.drones) total += Math.max(0, d.hp);
  }
  return total;
}

// == ground battles (hand-built combatants: accuracy 1 always hits, armor 0) ==

function gc(id: string, side: "team" | "enemy", over: Partial<GroundCombatant> = {}): GroundCombatant {
  return {
    id,
    side,
    role: side === "team" ? "security" : "bruiser",
    hp: 40,
    hpMax: 40,
    power: 12,
    accuracy: 1,
    armor: 0,
    heal: 0,
    threat: 12,
    groupTag: side === "team" ? "team" : "a",
    statuses: [],
    downed: false,
    ...over,
  };
}

function battle(combatants: GroundCombatant[], teamKit = 2): BattleState {
  return { combatants, round: 0, teamKit, tauntedBy: null };
}

// How much a battle state changed: hp moved, statuses gained or lost, a taunt, kit spent.
function battleChange(before: BattleState, after: BattleState): number {
  let d = 0;
  after.combatants.forEach((c, i) => {
    const b = before.combatants[i];
    d += Math.abs(c.hp - b.hp) + Math.abs(c.statuses.length - b.statuses.length);
  });
  return d + (after.tauntedBy ? 1 : 0) + Math.abs(after.teamKit - before.teamKit);
}

function cloneBattle(b: BattleState): BattleState {
  return { ...b, combatants: b.combatants.map((c) => ({ ...c, statuses: c.statuses.map((x) => ({ ...x })) })) };
}

// The action scenario: a medic actor, a poisoned wounded ally, a healthy foe and a low foe.
function actionScenario(): BattleState {
  const actor = gc("a1", "team", { medic: true, heal: 12, hp: 30, hpMax: 50 });
  const ally = gc("a2", "team", { hp: 20, hpMax: 50 });
  applyStatus(ally, "poison");
  return battle([actor, ally, gc("e1", "enemy"), gc("e2", "enemy", { hp: 10 })]);
}

const ACTION_TARGET: Readonly<Record<GambitActionId, GambitTargetSelector>> = {
  attack: "foeNearest",
  execute: "foeLowestHp",
  suppress: "foeNearest",
  taunt: "openingRound",
  brace: "self",
  cure: "allyHasStatus",
  aidHeal: "allyLowestHp",
  useItem: "allyHasStatus",
  hold: "self",
  fallBack: "self",
  shieldAlly: "allyLowestHp",
  analyze: "foeNearest",
  secureObjective: "self",
  takeCover: "self",
  flashGrenade: "foeHighestThreat",
  throwGrenade: "foeLargestGroup",
};
export const GAMBIT_ACTIONS = Object.keys(ACTION_TARGET) as GambitActionId[];

// Field Kits FKR-5: a thrown grenade needs a thrower carrying one (a Field Kits fight arms it), so its scenario arms the
// actor with an Impact Grenade's throw (one charge, one throw) facing a group of two.
function throwScenario(): BattleState {
  const grenade = { status: "concussion" as GambitStatusId, statusPermille: 300, powerMult: 1.5, charges: 1, perBattle: 1, used: 0 };
  return battle([gc("a1", "team", { grenade }), gc("e1", "enemy", { hp: 100, hpMax: 100 }), gc("e2", "enemy", { hp: 100, hpMax: 100 })]);
}

// Field Kits FKR-4: the flash grenade is an ENEMY action (a Striker's, one per battle), so its scenario puts a Striker
// carrying one first, facing the squad.
function flashScenario(): BattleState {
  return battle([gc("e0", "enemy", { role: "striker", flashGrenades: 1 }), gc("a1", "team"), gc("a2", "team", { threat: 20 })]);
}

function actionChange(action: GambitActionId): number {
  const before = action === "flashGrenade" ? flashScenario() : action === "throwGrenade" ? throwScenario() : actionScenario();
  const after = cloneBattle(before);
  evaluateAndAct([{ target: ACTION_TARGET[action], action }], after.combatants[0], after, makeRng(0x5eed));
  return battleChange(before, after);
}

// The selector scenario and the combatant each selector should pick (its label's promise).
function selectorScenario(): BattleState {
  const a1 = gc("a1", "team", { hp: 10, hpMax: 50 });
  applyStatus(a1, "weakened");
  const a2 = gc("a2", "team", { hp: 40, hpMax: 50 });
  applyStatus(a2, "poison");
  const e1 = gc("e1", "enemy", { hp: 10, threat: 5, groupTag: "a" });
  const e2 = gc("e2", "enemy", { hp: 30, threat: 20, role: "healer", groupTag: "b" });
  applyStatus(e2, "suppressed");
  const e3 = gc("e3", "enemy", { hp: 20, threat: 8, role: "caster", groupTag: "b" });
  // Field Kits FKR-6: a downed ally (no other selector sees it).
  const a3 = gc("a3", "team", { hp: 0, downed: true });
  return battle([a1, a2, e1, e2, e3, a3]);
}
const SELECTOR_PICK: Readonly<Record<GambitTargetSelector, { pick: string; params?: GambitRule["params"] }>> = {
  foeNearest: { pick: "e1" },
  foeFarthest: { pick: "e3" },
  foeHighestHp: { pick: "e2" },
  foeLowestHp: { pick: "e1" },
  foeHighestThreat: { pick: "e2" },
  foeIsHealer: { pick: "e2" },
  foeIsCaster: { pick: "e3" },
  foeHasStatus: { pick: "e2", params: { statusId: "suppressed" } },
  foeLargestGroup: { pick: "e2" },
  allyLowestHp: { pick: "a1" },
  allyHpBelow: { pick: "a1", params: { hpThreshold: 0.5 } },
  allyHasStatus: { pick: "a2", params: { statusId: "poison" } },
  self: { pick: "a1" },
  selfHpBelow: { pick: "a1", params: { hpThreshold: 0.5 } },
  selfHasStatus: { pick: "a1", params: { statusId: "weakened" } },
  openingRound: { pick: "e1" },
  outnumbered: { pick: "e1" },
  allyDowned: { pick: "a3" },
};
export const GAMBIT_SELECTORS = Object.keys(SELECTOR_PICK) as GambitTargetSelector[];

function selectorPicks(sel: GambitTargetSelector): number {
  const st = selectorScenario();
  const want = SELECTOR_PICK[sel];
  return resolveTarget(sel, want.params, st.combatants[0], st)?.id === want.pick ? 1 : 0;
}

// One attack (a fixed stream): the hp the target lost.
function strikeDamage(attackerStatus: GambitStatusId | null, targetStatus: GambitStatusId | null): number {
  const attacker = gc("a1", "team");
  const target = gc("e1", "enemy", { hp: 400, hpMax: 400 });
  if (attackerStatus) applyStatus(attacker, attackerStatus);
  if (targetStatus) applyStatus(target, targetStatus);
  const st = battle([attacker, gc("a2", "team"), target]);
  evaluateAndAct([{ target: "foeNearest", action: "attack" }], st.combatants[0], st, makeRng(0x5eed));
  return 400 - st.combatants[2].hp;
}

function groundStatusValue(id: GambitStatusId, on: boolean): number {
  const def = GAMBIT_STATUSES[id];
  switch (def.effect) {
    case "dotDamage":
    case "dotTurnLoss": {
      const c = gc("e1", "enemy", { hp: 100, hpMax: 100 });
      if (on) applyStatus(c, id);
      const st = battle([c]);
      tickEndOfRound(st);
      return 100 - st.combatants[0].hp;
    }
    case "damageDown":
    case "damageUp":
      return strikeDamage(on ? id : null, null);
    case "damageTakenDown":
      return strikeDamage(null, on ? id : null);
    case "accuracyDown":
    case "powerAccuracyDown": {
      const c = gc("a1", "team", { accuracy: 0.9 });
      if (on) applyStatus(c, id);
      return strikeHitChance(c, {});
    }
    case "turnLoss":
    case "mayFallBack": {
      // Field Kits FKR-4: a CHANCE to lose the turn (Concussion, Fear) moves the fight stream itself, so one seed can
      // read either way: the squad's hp lost summed over a batch of battles where the foe opens with it vs not.
      let lost = 0;
      for (let seed = 1; seed <= 32; seed += 1) {
        const team = [gc("a1", "team", { hp: 60, hpMax: 60, power: 20 })];
        const foe = gc("e1", "enemy", { hp: 30, hpMax: 30, power: 10 });
        if (on) applyStatus(foe, id);
        lost += team[0].hpMax - resolveGroundBattle(team, [foe], 0, makeRng(seed * 0x9e3779b1)).teamHpRemaining;
      }
      return lost;
    }
    case "skipTurn": {
      // The squad's hp lost over one battle when the foe opens stunned vs not.
      const team = [gc("a1", "team", { hp: 60, hpMax: 60, power: 20 })];
      const foe = gc("e1", "enemy", { hp: 30, hpMax: 30, power: 10 });
      if (on) applyStatus(foe, id);
      const r = resolveGroundBattle(team, [foe], 0, makeRng(0x5eed));
      return team[0].hpMax - r.teamHpRemaining;
    }
    default:
      return 0;
  }
}

// == expedition content ==

// Discoveries of `kind` on a dispatched run's bodies all turned into `planet`, scanned to the end, over a seed batch
// (the discovery roll runs at each body's scan completion, expedition.ts:1344). With the source OFF the planet's
// bias for that pool is CANCELLED by the array bias (the roll adds both), so the odds are the base; ON, base + bias.
function planetFinds(s: GameState, planet: ExpeditionPlanetType, kind: "landmark" | "underground", withBias: boolean): number {
  const def = PLANET_TYPES.find((p) => p.id === planet)!;
  let n = 0;
  for (const seed of [0x1111, 0x2222, 0x3333, 0x4444, 0x5555, 0x6666, 0x7777, 0x8888]) {
    const exp0 = dispatchRun({ ...s, expeditionSeed: seed });
    const cancel = withBias ? 0 : -(kind === "landmark" ? def.surfaceBias : def.undergroundBias);
    const scanParams =
      kind === "landmark"
        ? { ...exp0.scanParams, landmarkOddsBias: exp0.scanParams.landmarkOddsBias + cancel }
        : { ...exp0.scanParams, undergroundPoiOddsBias: exp0.scanParams.undergroundPoiOddsBias + cancel };
    let run: Expedition = { ...exp0, scanParams, bodies: exp0.bodies.map((b) => ({ ...b, planetType: planet })) };
    let t = run.phaseAnchorSeconds;
    for (let i = 0; i < 400 && !run.bodies.every((b) => b.scanned); i++) {
      t += 3600;
      run = advanceExpedition(run, t);
    }
    for (const b of run.bodies) n += b.discoveries.filter((d) => d.kind === kind && POI_CATALOG.some((p) => p.id === d.poiId)).length;
  }
  return n;
}

// Gas Giant Study GG-2: the ground objectives on a dispatched run's bodies all turned into `planet` (an orbital-only
// type), scanned to the end, over a seed batch. ON the run is stamped `study` (as a dispatch to a system with such a
// body stamps it), so the orbital bodies get none; OFF the stamp is taken away (a run dispatched before GG-2), so
// they get the ground objectives they had.
function orbitalObjectives(s: GameState, planet: ExpeditionPlanetType, study: boolean): number {
  let n = 0;
  for (const seed of [0x1111, 0x2222, 0x3333, 0x4444]) {
    const exp0 = dispatchRun({ ...s, expeditionSeed: seed });
    const { study: _stamp, ...unstamped } = exp0;
    let run: Expedition = { ...(study ? { ...unstamped, study: 1 as const } : unstamped), bodies: exp0.bodies.map((b) => ({ ...b, planetType: planet })) };
    let t = run.phaseAnchorSeconds;
    for (let i = 0; i < 400 && !run.bodies.every((b) => b.scanned); i++) {
      t += 3600;
      run = advanceExpedition(run, t);
    }
    for (const b of run.bodies) n += b.activities.length;
  }
  return n;
}

// Gas Giant Study: the save seeds the study probes search for a first candidate whose system holds an orbital body.
const STUDY_PROBE_SEEDS = [0x51f15e, 0x1111, 0x2222, 0x3333, 0x4444, 0x5555, 0x6666, 0x7777, 0x8888, 0x9999] as const;

// A run dispatched from `s` (the away team aboard) to the first candidate system, over the seed batch, that holds an
// orbital body; throws when none does (so a probe never passes on an empty fixture).
function studyRun(s: GameState): Expedition {
  for (const seed of STUDY_PROBE_SEEDS) {
    const run = dispatchRun({ ...s, expeditionSeed: seed });
    if (run.bodies.some((b) => isOrbitalPlanetType(b.planetType))) return run;
  }
  throw new Error("wiring: no study probe seed reaches a system with an orbital body");
}

// A GAS_STUDY_USES use, read through its consumer (ON the use as built, OFF its effect taken away).
//   classRoll: the orbital bodies of a dispatched study run that carry a giant profile (OFF: the profile taken away).
function gasStudyUseValue(s: GameState, use: string, on: boolean): number {
  switch (use) {
    case "classRoll": {
      const run = studyRun(readyForRun(s));
      return on ? run.bodies.filter((b) => isOrbitalPlanetType(b.planetType) && b.giant !== undefined).length : 0;
    }
    case "studyReward": {
      // The whole study run (OFF: its stamp taken away, a run dispatched before GG-2) until every body is scanned and
      // every study is done; the canisters its "study" findings carry.
      // GG-4: the system's nebula (if it holds one) comes off both sides, so only the body studies count here.
      const { nebula: _nebula, ...dispatched } = studyRun(readyForRun(s));
      const { study: _stamp, ...unstamped } = dispatched;
      let run: Expedition = on ? dispatched : unstamped;
      const settled = (r: Expedition): boolean => r.bodies.every((b) => b.scanned) && (r.groundOps?.studyLegs ?? []).every((l) => l.done);
      for (let t = run.phaseAnchorSeconds + 3600; t < run.phaseAnchorSeconds + 4_000_000 && !settled(run); t += 3600) run = advanceExpedition(run, t);
      let n = 0;
      for (const f of run.findings) if (f.source === "study") for (const id of GAS_CANISTER_IDS) n += f.materials?.[id] ?? 0;
      return n;
    }
    case "probeDive": {
      // A reference Galileo (20 points at the variety's ratios) on the Science member vs none: the study's canister
      // haul scale (the dive x the tier haul), x100.
      const ready = readyForRun(s);
      const run = studyRun(on ? wearPiece(ready, WIRING_SCIENCE_ID, "memberTool", GALILEO_VARIETY, { groundFieldwork: 12, groundHazardResist: 6, groundRelicFind: 2 }) : ready);
      const i = run.bodies.findIndex((b) => isOrbitalPlanetType(b.planetType));
      return 100 * studyCanisterScale(run, i);
    }
    case "pickupPause": {
      // The user's pickup pause (2026-10-23): a whole run to a system holding a nebula (its 2 hour sweep makes the
      // last shuttles wait on a run without the stamp). GG-6 pause review: the TOTAL seconds every team spent in its
      // return step (an ordinary shuttle, a wait behind a study, a pickup the ship flew), read negated so the source
      // raises the value: the pickups count too, so ON is measured, never 0 by construction.
      const ready = readyForRun(s);
      for (const seed of NEBULA_PROBE_SEEDS) {
        const dispatched = dispatchRun({ ...ready, expeditionSeed: seed });
        if (dispatched.nebula === undefined) continue;
        const { pickupPause: _stamp, ...unstamped } = dispatched;
        const offRun = advanceExpedition(unstamped, dispatched.phaseAnchorSeconds + 4_000_000);
        if (waitedBehindStudies(offRun) === 0) continue; // the first nebula run whose shuttles waited without the stamp
        return -returnSeconds(on ? advanceExpedition(dispatched, dispatched.phaseAnchorSeconds + 4_000_000) : offRun);
      }
      throw new Error("wiring: no nebula probe seed holds a shuttle that waits behind a study");
    }
    case "nebulaSweep": {
      // GG-4: a run to a system holding a nebula until every body is scanned and every study (the sweep included) is
      // done (OFF: its nebula stamp taken away, a run dispatched before GG-4); the canisters its sweep finding carries.
      const dispatched = nebulaRun(readyForRun(s));
      const { nebula: _stamp, ...unstamped } = dispatched;
      let run: Expedition = on ? dispatched : unstamped;
      const settled = (r: Expedition): boolean => r.bodies.every((b) => b.scanned) && (r.groundOps?.studyLegs ?? []).every((l) => l.done);
      for (let t = run.phaseAnchorSeconds + 3600; t < run.phaseAnchorSeconds + 4_000_000 && !settled(run); t += 3600) run = advanceExpedition(run, t);
      let n = 0;
      for (const f of run.findings) if (f.id === `${run.id}-find-nebula`) for (const id of GAS_CANISTER_IDS) n += f.materials?.[id] ?? 0;
      return n;
    }
    default:
      return 0;
  }
}

// ===== Gas Giant Study GG-5: the Research Lab's data study lane (dataStudy.ts) =====

// A Lab Level I save holding `units` of `itemId`, the lane on (OFF: paused, the consumer taken away), stepped one data
// study and a little past it through the real economy tick.
function dataStudyRun(s: GameState, itemId: string, on: boolean, units = 1): { before: GameState; after: GameState } {
  const lab = withFacilityLevel(s, "research", 1);
  const held: GameState = { ...lab, inventory: addItemQuality(lab.inventory, itemId, new Decimal(units), 0) };
  const before = on ? held : setDataStudyPaused(held, true);
  let after = before;
  for (let i = 0; i < DATA_STUDY_TICKS + 3; i++) after = economyTick(after, 1, () => 0.999999);
  return { before, after };
}

// The first blueprint of `family` a top Lab researches (BLUEPRINTS order).
function familyBlueprint(family: ResearchFamily): string {
  const key = Object.keys(BLUEPRINTS).find((k) => researchFamilyOf(BLUEPRINTS[k]) === family && BLUEPRINTS[k].requiresRelicDiscovery === undefined);
  if (!key) throw new Error(`wiring: no blueprint of family ${family}`);
  return key;
}

// A GG-5 lab lane value, read through its consumer.
//   lane:             boosts banked by one study of Propulsion Data (OFF: the lane paused);
//   consume:<item>:   units of the item the lane studied (OFF: paused);
//   boost:<family>:   research ticks one banked boost saves on the family's first blueprint (OFF: none banked);
//   recipe:           recipes a batch of 400 study rolls learns with candidates waiting (OFF: the chance at 0);
//   decode:           entries one Ancient Data Fragment study decodes (OFF: paused).
function dataStudyValue(s: GameState, a: string, b: string, on: boolean): number {
  switch (a) {
    case "lane": {
      const { after } = dataStudyRun(s, "propulsionData", on);
      return after.researchBoosts?.propulsion ?? 0;
    }
    case "consume": {
      const { before, after } = dataStudyRun(s, b, on);
      return heldOf(before, b) - heldOf(after, b);
    }
    case "boost": {
      const family = b as ResearchFamily;
      const key = familyBlueprint(family);
      const ready: GameState = { ...withFacilityLevel(s, "research", 9), credits: new Decimal(1e12), ...(on ? { researchBoosts: { [family]: 1 } } : {}) };
      const r = startResearch(ready, key);
      const plain = startResearch({ ...ready, researchBoosts: undefined }, key);
      const ticks = (x: typeof r) => x.next.activeProcesses[x.next.activeProcesses.length - 1]?.remainingTicks ?? 0;
      return ticks(plain) - ticks(r);
    }
    case "recipe": {
      let n = 0;
      for (let i = 1; i <= 400; i += 1) if (rollDataStudyRecipe(RELIC_DEFAULT_SEED, i, ["frameSegmentBp"], on ? DATA_STUDY_RECIPE_PERMILLE : 0) !== null) n += 1;
      return n;
    }
    case "decode": {
      const { after } = dataStudyRun(s, ANCIENT_DATA_FRAGMENT_ID, on);
      return Object.values(after.ancientDecoded ?? {}).reduce((x, y) => x + y, 0);
    }
    default:
      return 0;
  }
}

// One Fabricator craft of blueprint `key` at its tier, researched and holding its recipe's inputs (but `skip`): how much
// of item `item` the craft spends at start. -1 when the craft is refused. (The reactor fuel ladder's probe, and GG-7's
// canister uses.)
function craftSpends(s: GameState, key: string, item: string, skip: ReadonlySet<string> = new Set()): number {
  const bp = BLUEPRINTS[key];
  let ready: GameState = { ...withFacilityLevel(s, "fabricator", Math.max(1, bp.tier)), researchedBlueprints: [...s.researchedBlueprints, key] };
  for (const [id, qty] of Object.entries(bp.recipe.inputs)) if (!skip.has(id)) ready = holding(ready, id, new Decimal(qty));
  const before = heldOf(ready, item);
  const r = startLine(ready, "fabricate", key, { kind: "batch", remaining: 1 });
  if (!r.started) return -1;
  const after = economyTick(r.next, 1, () => 0.5);
  return before - heldOf(after, item);
}

// ===== Gas Giant Study GG-7: the canisters' crafting uses and the special blueprints =====
//   canisterUses: canisters one craft of every blueprint taking a canister spends (OFF: the canisters not held, so each
//                 craft refuses);
//   sweepRate:    a nebula run's sweep canisters per hour of sweep (the Ramscoop Collector raises both its haul and
//                 its speed);
//   ramscoopStamp: the sweep boost a nebula run froze at dispatch (Expedition.nebula.ramscoop, as a fraction);
//   studyBands:   the canisters above the Standard band over a batch of a dispatched study run's giant studies (its
//                 frozen Resonance band lift included; the batch reseeds the run);
//   decodeGate:   the special blueprints a Lab VII can research (OFF: no ancient entry decoded; ON: three of one culture).
//   platingLean:  the kinetic dampening points over a batch of Stellar plates minted through generateEquipment, the
//                 Pressure-Forged variety (OFF: the Reinforced Plating, the slot's straight tank plate).
function gg7Value(s: GameState, a: string, on: boolean): number {
  switch (a) {
    case "platingLean": {
      const varietyKey = on ? PRESSURE_FORGED_PLATING_VARIETY : "reinforcedPlating";
      let n = 0;
      for (let seed = 1; seed <= 300; seed++) {
        let x = (seed * 0x9e3779b1) >>> 0;
        const rng = (): number => {
          x = (x + 0x6d2b79f5) >>> 0;
          let t = x;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const p = generateEquipment({ slotType: "hullPlating", varietyKey, blueprintKey: null, iLevel: 20, quality: 0, rarity: "stellar", ascension: "none", rng, allocateId: () => "wiring-plate" });
        n += (p.implicitStats.kineticDampening ?? 0) + (p.rolledStats.kineticDampening ?? 0);
      }
      return n;
    }
    case "canisterUses": {
      let n = 0;
      const canisters = new Set<string>(GAS_CANISTER_IDS);
      for (const [key, bp] of Object.entries(BLUEPRINTS)) {
        const used = Object.keys(bp.recipe.inputs).filter((id) => canisters.has(id));
        if (used.length === 0) continue;
        for (const id of used) n += Math.max(0, craftSpends(s, key, id, on ? new Set() : canisters));
      }
      return n;
    }
    case "sweepRate": {
      let run = nebulaRun(readyForRun(s));
      const settled = (r: Expedition): boolean => r.bodies.every((b) => b.scanned) && (r.groundOps?.studyLegs ?? []).every((l) => l.done);
      for (let t = run.phaseAnchorSeconds + 3600; t < run.phaseAnchorSeconds + 4_000_000 && !settled(run); t += 3600) run = advanceExpedition(run, t);
      const leg = (run.groundOps?.studyLegs ?? []).find((l) => l.nebula === 1);
      if (!leg) return 0;
      let n = 0;
      for (const f of run.findings) if (f.id === `${run.id}-find-nebula`) for (const id of GAS_CANISTER_IDS) n += f.materials?.[id] ?? 0;
      const paused = (leg.pauses ?? []).reduce((x, p) => x + (p.to - p.from), 0);
      return (n * 3600) / Math.max(1, leg.endsAt - leg.startsAt - paused);
    }
    case "ramscoopStamp":
      return (nebulaRun(readyForRun(s)).nebula?.ramscoop ?? 0) / 1000;
    case "studyBands": {
      const run = studyRun(readyForRun(s));
      const i = run.bodies.findIndex((b) => b.giant !== undefined);
      let n = 0;
      for (let k = 1; k <= 200; k++) {
        const mats = rollStudyReward({ ...run, seed: (run.seed ^ Math.imul(k, 0x9e3779b1)) >>> 0 }, i, 0).materials ?? {};
        for (const [id, q] of Object.entries(mats)) if ((GAS_CANISTER_IDS as readonly string[]).includes(id) && ITEMS[id]?.band !== "standard") n += q;
      }
      return n;
    }
    case "decodeGate": {
      const lab: GameState = { ...withFacilityLevel(s, "research", 7), credits: new Decimal(1e15), ...(on ? { ancientDecoded: { "culture-t1-1": 3 } } : {}) };
      return SPECIAL_BLUEPRINT_KEYS.filter((k) => canResearch(lab, k).ok).length;
    }
    default:
      return 0;
  }
}

// GG-4: a run dispatched from `s` to the first candidate system, over a seed batch, that holds a nebula; throws when
// none does (so a probe never passes on an empty fixture).
const NEBULA_PROBE_SEEDS = Array.from({ length: 60 }, (_, i) => 0x51f15e + i * 0x10001);
function nebulaRun(s: GameState): Expedition {
  for (const seed of NEBULA_PROBE_SEEDS) {
    const run = dispatchRun({ ...s, expeditionSeed: seed });
    if (run.nebula !== undefined) return run;
  }
  throw new Error("wiring: no nebula probe seed reaches a system with a nebula");
}

// The user's pickup pause: the seconds every ordinary shuttle of a run spent waiting for the ship behind a study or
// the sweep (it docked at the study's end, past its RETURN_SECONDS flight). Pure.
function waitedBehindStudies(run: Expedition): number {
  const ops = run.groundOps;
  let waited = 0;
  for (const r of ops?.history ?? []) {
    if (r.step !== "return" || r.recovered || r.studyPickup || r.stopped) continue;
    if ((ops?.studyLegs ?? []).some((l) => l.endsAt === r.endedAt)) waited += Math.max(0, r.endedAt - r.startedAt - RETURN_SECONDS);
  }
  return waited;
}

// The seconds every team of a run spent in its return step (a recall's stop left out), pickups and waits included.
// Pure.
function returnSeconds(run: Expedition): number {
  let n = 0;
  for (const r of run.groundOps?.history ?? []) if (r.step === "return" && !r.stopped) n += r.endedAt - r.startedAt;
  return n;
}

// GG-4: the canisters of `pick` over a batch of sweeps of a nebula of `kindId`, the reward rolled with `kinds`.
function nebulaBatchCount(kindId: NebulaKindId, kinds: readonly NebulaKindDef[], pick: (id: string) => boolean): number {
  let n = 0;
  for (let seed = 1; seed <= 120; seed += 1) {
    const exp = {
      id: "wiring-nebula",
      seed: seed * 0x9e3779b1,
      systemName: "LB-0001",
      region: { version: 1 as const, tier: 1 as const, enemyTerritory: false, bearing: 0, distanceLy: 10 },
      nebula: { kindId },
    };
    const mats = rollNebulaReward(exp, 0, kinds).materials ?? {};
    for (const [id, q] of Object.entries(mats)) if (pick(id) && (GAS_CANISTER_IDS as readonly string[]).includes(id)) n += q;
  }
  return n;
}

// A NEBULA_KINDS field, read through the sweep's reward (GG-4).
//   bandOdds: the canisters above the Standard band with the kind's odds vs all Standard;
//   itemWeights: the kind's heaviest gas of its first band whose weights are uneven (Standard, else Augmented) with its
//   weights vs even weights (a Planetary nebula weighs its two Standard gases alike, so its Augmented pair is read).
function nebulaKindFieldValue(kindId: NebulaKindId, field: string, on: boolean): number {
  const def = NEBULA_KINDS.find((k) => k.id === kindId)!;
  switch (field) {
    case "bandOdds": {
      const flat = { standard: 100, augmented: 0, stellar: 0, radiant: 0 };
      const kinds = on ? NEBULA_KINDS : NEBULA_KINDS.map((k) => (k.id === kindId ? { ...k, bandOdds: flat } : k));
      return nebulaBatchCount(kindId, kinds, (id) => ITEMS[id]?.band !== "standard");
    }
    case "itemWeights": {
      const uneven = (band: "standard" | "augmented") => new Set(canistersInBand(band).map((id) => def.itemWeights[id])).size > 1;
      const standard = canistersInBand(uneven("standard") ? "standard" : "augmented");
      const heaviest = standard.reduce((a, b) => (def.itemWeights[b] > def.itemWeights[a] ? b : a), standard[0]);
      const even = Object.fromEntries(GAS_CANISTER_IDS.map((id) => [id, 1])) as NebulaKindDef["itemWeights"];
      const kinds = on ? NEBULA_KINDS : NEBULA_KINDS.map((k) => (k.id === kindId ? { ...k, itemWeights: even } : k));
      return nebulaBatchCount(kindId, kinds, (id) => id === heaviest);
    }
    default:
      return 0;
  }
}

// A synthetic study run of one giant of `classId` at `seed` (the reward roll reads the profile, the region and the
// roster; no probe aboard).
function syntheticStudy(classId: GiantClassId, seed: number): Parameters<typeof rollStudyReward>[0] {
  const def = GIANT_CLASSES.find((c) => c.id === classId)!;
  return {
    id: "wiring-study",
    seed,
    systemName: "LB-0001",
    region: { version: 1, tier: 1, enemyTerritory: false, bearing: 0, distanceLy: 10 },
    roster: { security: [], science: [] },
    bodies: [{ ...syntheticBody("gasGiant", 0.1), scanned: true, giant: { classId, massMilliJ: giantMassAt(def, Math.floor(GIANT_MASS_STEPS / 2)) } }],
  };
}

// The canisters of `pick` over a batch of studies of `classId`, the reward rolled with `classes`.
function studyBatchCount(classId: GiantClassId, classes: readonly GiantClassDef[], pick: (id: string) => boolean): number {
  let n = 0;
  for (let seed = 1; seed <= 300; seed += 1) {
    const mats = rollStudyReward(syntheticStudy(classId, seed * 0x9e3779b1), 0, 0, classes).materials ?? {};
    for (const [id, q] of Object.entries(mats)) if (pick(id) && (GAS_CANISTER_IDS as readonly string[]).includes(id)) n += q;
  }
  return n;
}

// A GIANT_CLASSES field, read through its consumer.
//   weight: how often the class roll picks the class over a body batch (OFF: its weight zeroed);
//   massMinMilliJ / massMaxMilliJ: the mass roll's first / last step (equals the band's end).
function giantClassFieldValue(classId: GiantClassId, field: string, on: boolean): number {
  const def = GIANT_CLASSES.find((c) => c.id === classId)!;
  switch (field) {
    case "weight": {
      const classes = on ? GIANT_CLASSES : GIANT_CLASSES.map((c) => (c.id === classId ? { ...c, weight: 0 } : c));
      let n = 0;
      for (let seed = 1; seed <= 200; seed += 1) for (let i = 0; i < 3; i += 1) if (rollGiantProfile(seed * 0x9e3779b1, i, 3, classes).classId === classId) n += 1;
      return n;
    }
    case "massMinMilliJ":
      return giantMassAt(def, 0);
    case "massMaxMilliJ":
      return giantMassAt(def, GIANT_MASS_STEPS - 1);
    case "radiusModel":
    case "inflation": {
      const off = field === "radiusModel" ? { ...def, radiusModel: "giant" as const } : { ...def, inflation: 1 };
      const profile = { classId, massMilliJ: giantMassAt(def, Math.floor(GIANT_MASS_STEPS / 2)) };
      return 1000 * giantDepthFactor(profile, on ? GIANT_CLASSES : GIANT_CLASSES.map((c) => (c.id === classId ? off : c)));
    }
    case "bandOdds": {
      const flat = { standard: 100, augmented: 0, stellar: 0, radiant: 0 };
      const classes = on ? GIANT_CLASSES : GIANT_CLASSES.map((c) => (c.id === classId ? { ...c, bandOdds: flat } : c));
      return studyBatchCount(classId, classes, (id) => ITEMS[id]?.band !== "standard");
    }
    case "itemWeights": {
      const standard = canistersInBand("standard");
      const heaviest = standard.reduce((a, b) => (def.itemWeights[b] > def.itemWeights[a] ? b : a), standard[0]);
      const even = Object.fromEntries(GAS_CANISTER_IDS.map((id) => [id, 1])) as GiantClassDef["itemWeights"];
      const classes = on ? GIANT_CLASSES : GIANT_CLASSES.map((c) => (c.id === classId ? { ...c, itemWeights: even } : c));
      return studyBatchCount(classId, classes, (id) => id === heaviest);
    }
    default:
      return 0;
  }
}

// == missions ==

// Run one whole mission cycle from dispatch with every draw common (economyTick).
function oneCycle(s: GameState, key: MissionKey): { before: GameState; after: GameState } {
  const def = MISSIONS[key];
  const before = onMission(s, key, "ordersReceived");
  let after = before;
  const ticks = 10 + def.transitOutTicks + def.transitBackTicks + def.unloadTicks + Math.ceil(SHIP_TYPES[shipOf(s).typeKey].cargoCapacity / def.extractionRatePerTick);
  for (let i = 0; i < ticks; i++) after = economyTick(after, 1, () => 0.999999);
  return { before, after };
}

// WR-9 (OC-E4): the ticks a Short Ore Run dispatched now spends on its RETURN legs over its first
// PILOT_PROBE_CYCLES cycles, stepped one tick at a time through economyTick (the Pilot's Cunning cuts a leg by a tick
// on a cycle whose roll lands; the rolls are keyed on the captain's lifetime cycle counter, so the count is fixed).
function missionReturnTicks(s: GameState): number {
  const r = dispatchCaptainOnMission(s, WIRING_CAPTAIN_ID, "shortOreRun");
  if (!r.success) throw new Error(`wiring mission dispatch refused: ${r.reason}`);
  let st = r.next;
  let ticks = 0;
  for (let guard = 0; guard < 100_000; guard++) {
    if (Number(st.lifetimeStats.missionsCompleted.shortOreRun ?? 0) >= PILOT_PROBE_CYCLES) return ticks;
    const m = st.captains.find((c) => c.id === WIRING_CAPTAIN_ID)?.mission;
    if (m?.kind === "extraction" && m.phase === "transitBack") ticks += 1;
    st = economyTick(st, 1, () => 0.5);
  }
  throw new Error("wiring mission probe: the run never finished its cycles");
}

// WR-9 fix round: the legs home of PILOT_PROBE_CYCLES short-range cycles of slot 0, each started through the board's one
// cycle-start seam (startShortRangeCycle, which dispatch and the cycle engine both call) on a run stamped as a dispatch
// stamps it now (pilotCunningStamp), cycle indices 0 up.
function shortRangeReturnTicks(s: GameState): number {
  const ship = shipOf(s);
  const stamp = pilotCunningStamp(s, ship) ?? 0;
  const lift = newReactorLiftFlag(equippedFor(s, ship.id)) !== undefined;
  const favored = favoredSpecStamp(equippedFor(s, ship.id), ship.typeKey) === 1;
  let ticks = 0;
  for (let i = 0; i < PILOT_PROBE_CYCLES; i++) ticks += startShortRangeCycle(s, ship, SHORT_RANGE_PROBE_SLOT, i, undefined, lift, true, favored, stamp).plan.transitBackTicks;
  return ticks;
}

// WR-9 fix round: the frozen legs home of PILOT_PROBE_CYCLES patrol dispatches (dispatchCaptainOnPatrol, consecutive
// master seeds), on ship-1 made a destroyer with its Standard Issue combat gear (the officers aboard are kept).
function patrolReturnTicks(s: GameState): number {
  const base = installMissingCombatBaselines(editShip(s, { typeKey: "destroyer" }));
  let ticks = 0;
  for (let i = 0; i < PILOT_PROBE_CYCLES; i++) {
    const r = dispatchCaptainOnPatrol({ ...base, nextPatrolSeed: base.nextPatrolSeed + i }, WIRING_CAPTAIN_ID, "crimsonReaverSweep", "balanced", false);
    if (!r.success) throw new Error(`wiring patrol refused: ${r.reason}`);
    ticks += patrolRouteOf(captainOf(r.next).mission as PatrolMissionState).transitBackTicks;
  }
  return ticks;
}

function missionFieldValue(s: GameState, field: string, key: MissionKey): number {
  const def = MISSIONS[key];
  switch (field) {
    case "transitOutTicks":
      return missionDefFor(s, key).transitOutTicks;
    case "transitBackTicks":
      return missionDefFor(s, key).transitBackTicks;
    case "unloadTicks":
      return missionDefFor(s, key).unloadTicks;
    case "extractionRatePerTick":
      return extractingCargo(s, key, 0.999999).common;
    case "rareChance":
      return extractionThreshold(s, key, "rare");
    case "uncommonChance":
      return extractionThreshold(s, key, "uncommon");
    case "fleetAdminXpPerTick": {
      const on = onMission(s, key, "transitOut");
      return Number(economyTick(on, 1, () => 0.5).fleetAdminXp) - Number(on.fleetAdminXp);
    }
    case "creditsPerCycle":
    case "supplyCostPerCargo":
    case "rewardMargin": {
      const { before, after } = oneCycle(s, key);
      return Number(after.credits) - Number(before.credits);
    }
    case "lootTable": {
      const { before, after } = oneCycle(s, key);
      const item = def.lootTable.common;
      return heldOf(after, item) > heldOf(before, item) ? 1 : 0;
    }
    case "unlockLevel": {
      const at = (lvl: number) => (missionUnlocked(withFacilityLevel(s, "missionControl", lvl), key) ? 1 : 0);
      return at(def.unlockLevel) - at(def.unlockLevel - 1);
    }
    case "requiresCaptainLevel": {
      const req = def.requiresCaptainLevel ?? 1;
      const blocked = (lvl: number) => {
        const r = canDispatch(editCaptain(s, { level: lvl }), WIRING_CAPTAIN_ID, key);
        return !r.ok && r.reason === "captainLevel" ? 1 : 0;
      };
      return blocked(req - 1) - blocked(req);
    }
    case "requiresCargoCapacity": {
      const blocked = (hull: ShipTypeKey) => {
        const r = canDispatch(editCaptain(editShip(s, { typeKey: hull }), { level: 99 }), WIRING_CAPTAIN_ID, key);
        return !r.ok && r.reason === "cargo" ? 1 : 0;
      };
      return blocked("prospectorRunner") - blocked("generalFreighter");
    }
    case "primaryMaterial": {
      const full = editCaptain(holding(s, def.primaryMaterial, tierCap(s, 1)), { level: 99 });
      const r = canDispatch(full, WIRING_CAPTAIN_ID, key);
      return !r.ok && r.reason === "materialAtCap" ? 1 : 0;
    }
    default:
      throw new Error(`no mission field probe for ${field}`);
  }
}

// Field Kits FKR-5: the grenade probes' reference thrower (power 1000, so a blast's rounding is a rounding step), the
// foes' hp (no blast downs one) and the thrower's own status chance (a Stun or Toxin Grenade's debuff lands at it).
const GRENADE_PROBE_HP = 1_000_000;
const GRENADE_PROBE_STATUS_CHANCE = 0.25;
function armedThrower(varietyKey: string, statusChance: number, timedFuses = false): GroundCombatant {
  const m: SnapshotMember = {
    memberId: "wiring-thrower",
    teamType: "security",
    spec: "offense",
    rank: 1,
    rankFactor: 1,
    traits: [],
    groundStats: { statusChance },
    resists: {},
    implants: [],
    gear: [{ pieceId: "wiring-grenade", slotType: "memberTool", varietyKey, points: 0 }],
    gambit: [],
    effects: [],
  };
  const c = gc("a1", "team", { memberId: m.memberId, power: 1000 });
  withThrownGrenades([c], [m], undefined, timedFuses);
  return c;
}

// Timed grenades (user 2026-10-21): ONE throw of an armed reference thrower at `foes` (who only hold), to its blast, the
// way a catalog 2 fight resolves it: a grenade on contact blasts on the throw itself (evaluateAndAct at the largest
// group); a timed one primes and goes off at the start of the thrower's next turn (a whole battle, the thrower holding
// after its throw; `fuseSeed` keys the moved-clear stream). Returns the bodies its debuff landed on; the foes keep the
// damage. Mutates the combatants it is handed.
function catalog2Throw(thrower: GroundCombatant, foes: GroundCombatant[], seed: number, fuseSeed: number): number {
  const rule = { target: "foeLargestGroup" as const, action: "throwGrenade" as const };
  if (!thrower.grenade?.fuse) {
    const status = thrower.grenade?.status;
    evaluateAndAct([rule], thrower, battle([thrower, ...foes]), makeRng(seed));
    return foes.filter((f) => f.statuses.some((x) => x.id === status)).length;
  }
  const hold = { target: "self" as const, action: "hold" as const };
  thrower.hp = thrower.hpMax = GRENADE_PROBE_HP;
  thrower.program = [rule, hold];
  for (const f of foes) f.program = [hold];
  const log: GambitLogEvent[] = [];
  resolveGroundBattle([thrower], foes, 0, makeRng(seed), log, fuseSeed);
  return log.find((e) => e.action === "grenadeDetonates")?.blast?.afflicted ?? 0;
}

// Timed grenades (user 2026-10-21): one whole battle of a reference thrower (armed as a catalog 2 fight arms it when
// `timedFuses`, else on contact as catalog 1) that throws once at a group of foes who only hold, with its log. The
// thrower's debuff is off (only the blast is read); `fuseSeed` keys the battle's moved-clear stream.
function grenadeFuseBattle(varietyKey: string, timedFuses: boolean, foes: number, fuseSeed: number, movedClearOff = false): GambitLogEvent[] | null {
  const thrower = armedThrower(varietyKey, 0, timedFuses);
  if (!thrower.grenade) return null;
  thrower.grenade = { ...thrower.grenade, statusPermille: 0, ...(movedClearOff && thrower.grenade.fuse ? { fuse: { movedClearPermille: 0 } } : {}) };
  thrower.hp = thrower.hpMax = GRENADE_PROBE_HP;
  thrower.program = [{ target: "foeLargestGroup", action: "throwGrenade" }, { target: "self", action: "hold" }];
  const hold = [{ target: "self" as const, action: "hold" as const }];
  const group = Array.from({ length: foes }, (_, i) => gc(`e${i + 1}`, "enemy", { hp: GRENADE_PROBE_HP, hpMax: GRENADE_PROBE_HP, program: hold }));
  const log: GambitLogEvent[] = [];
  resolveGroundBattle([thrower], group, 0, makeRng(0x5eed), log, fuseSeed);
  return log;
}

// The content probe dispatcher.
function readContent(id: string, s: GameState): number {
  const [, family, a, b, c, d] = id.split(":");
  const on = isOn(s);
  switch (family) {
    case "weapon":
      return duelScore(() => (on ? [makeWeaponInstance(a as WeaponId, "p-w0")] : []), () => [], false);
    case "drone": {
      // A Support squadron works on other drones, so every role is measured beside an Attack squadron.
      const escort = () => (a === "attack" ? [] : [makeSquadron("attack", undefined, 0, "p-d1")]);
      return duelScore(() => [], () => (on ? [makeSquadron(a as DroneRole, undefined, 0, "p-d0"), ...escort()] : escort()), true);
    }
    case "relic":
      return relicContentProbe(a, on, s);
    case "minigame":
      return minigameContentProbe(a, s);
    case "pirate": {
      // WR-8: generated under the combat rules (the hull's armor, dampening and evasion reach the combatant only there;
      // every other field reads the same either way).
      const e = generateEnemyWave(1, { hullPool: [a as PirateHullId], enemyCountMin: 1, enemyCountMax: 1, idPrefix: "wiring", combatRules: true })[0];
      return b === "shieldCapacity"
        ? e.shieldMax
        : b === "shieldRecharge"
          ? e.shieldRecharge
          : b === "weapons"
            ? e.weapons.length
            : b === "droneRoles"
              ? e.drones.length
              : b === "ablativeArmor"
                ? e.ablativeArmor
                : b === "evasion"
                  ? e.evasion
                  : e.hullMax;
    }
    case "patrolWindow": {
      const def = PATROLS[a];
      let engaging = 0;
      for (let t = 0; t < def.transitOutTicks + def.rollWindowTicks + def.transitBackTicks + 5; t++) if (patrolPhaseFor(def, t) === "engaging") engaging++;
      return engaging;
    }
    case "shipStatus": {
      const def = STATUS_EFFECT_DEFS[a];
      const effects = applyEffect([], a, 0, makeRng(1));
      if (def.mechanic.type === "statDelta") return activeStatDelta(effects, def.mechanic.stat);
      const c = { hull: 1000, alive: true, statusEffects: effects };
      tickEffects(c, 10, makeRng(1));
      return 1000 - c.hull;
    }
    case "groundStatus":
      return groundStatusValue(a as GambitStatusId, on);
    case "action":
      return actionChange(on ? (a as GambitActionId) : "hold");
    case "selector":
      return selectorPicks(a as GambitTargetSelector);
    case "preset": {
      const want = gambitPresetPrograms(a)?.security;
      const c = squadCombatants(s).find((x) => x.memberId === WIRING_SECURITY_ID);
      return want && c?.program && gambitProgramEquals(c.program, want) ? 1 : 0;
    }
    case "poi":
      return PLANET_IDS.filter((p) => {
        const pools = poisForPlanetType(p);
        return [...pools.surface, ...pools.underground].some((w) => w.poi.id === a);
      }).length;
    case "planetHazard":
      return planetTypeHazard(a);
    case "planetBias":
      return planetFinds(s, a as ExpeditionPlanetType, b as "landmark" | "underground", on);
    case "orbitalOnly":
      return orbitalObjectives(s, a as ExpeditionPlanetType, on);
    case "gasStudy":
      return gasStudyUseValue(s, a, on);
    case "giantClass":
      return giantClassFieldValue(a as GiantClassId, b, on);
    case "nebulaKind":
      return nebulaKindFieldValue(a as NebulaKindId, b, on);
    case "dataStudy":
      return dataStudyValue(s, a, b, on);
    case "lootPool": {
      // One salvage of the material: the item it gave is one of the pool's configured drops.
      const held = holding(s, a, new Decimal(1));
      const r = salvageSalvagedMaterial(held, a, () => 0.0001);
      if (!r.ok) return 0;
      const drops = new Set(SALVAGE_LOOT_POOLS[a as keyof typeof SALVAGE_LOOT_POOLS].flatMap((t) => t.drops.map((d) => d.itemId)));
      return [...drops].some((k) => heldOf(r.next, k) > heldOf(held, k)) ? 1 : 0;
    }
    case "sell": {
      const held = holding(s, a, new Decimal(10));
      const r = sellItem(held, a, new Decimal(1));
      return r.ok ? Number(r.next.credits) - Number(held.credits) : 0;
    }
    case "mission":
      return missionFieldValue(s, a, b as MissionKey);
    case "shortRange":
      return shortRangeContentValue(s, a, b as ShortRangeTemplateKey);
    case "loadoutSlots":
      return loadoutSlotDefsForShipType(a as ShipTypeKey).filter((d) => d.slotType === b).length;
    case "moduleInstalls": {
      // E-MOD EM-7: the hull bare (no Spec Utility, which shares the module slots), every catalog module offered in id
      // order through the real install gate: how many it installs before the slots are full.
      const hull = wiringBase(a as ShipTypeKey);
      let st: GameState = { ...hull, equipment: hull.equipment.filter((e) => e.fittedToShipId !== WIRING_SHIP_ID) };
      let installed = 0;
      for (const def of [...UNIVERSAL_MODULES].sort((x, y) => (x.id < y.id ? -1 : 1))) {
        const id = `wiring-module-${def.id}`;
        st = { ...st, equipment: [...st.equipment, { id, slotType: "module", moduleVariant: def.id, rarity: "standard", ascension: "none", quality: 0, iLevel: 10, blueprintKey: `${def.id}Bp`, implicitStats: {}, rolledStats: {}, mass: 0, powerDraw: def.powerDraw, durabilityMax: 100, fittedToShipId: null } as EquipmentInstance] };
        if (!canFitEquipment(st, WIRING_SHIP_ID, id).ok) break;
        st = fitEquipment(st, WIRING_SHIP_ID, id);
        installed++;
      }
      return installed;
    }
    case "groundTeams":
      return groundTeamCount(a as ShipTypeKey);
    case "cure": {
      // The medical bay time of one condition with no care (b = "stoneskin": an Ossir's perk, when the source is on).
      const perks = b === "stoneskin" && on ? (["stoneskin"] as MemberPerkId[]) : [];
      return conditionCureSeconds(GROUND_CONDITIONS[a], perks, { medicalShare: 0, rapidRecoveryShare: 0, officerFacetShare: 0, injurySteady: 0 });
    }
    case "research": {
      // Start the blueprint's research at a top-level Lab with every relic found: the project's ticks.
      const ready = {
        ...withFacilityLevel(s, "research", 9),
        credits: new Decimal(1e12),
        relicDiscovered: RELICS.map((r) => r.id),
        // GG-7: and every ancient entry a special blueprint waits on, decoded by one culture.
        ancientDecoded: { "wiring-culture": 99 },
      };
      const r = startResearch(ready, a);
      return r.started ? r.next.activeProcesses[r.next.activeProcesses.length - 1].remainingTicks : -1;
    }
    case "refine": {
      // Start a one-job refine line on a built Refinery holding the inputs: the job's ticks once it starts.
      const recipe = REFINE_RECIPES[a];
      let ready = withFacilityLevel(s, "refinery", 1);
      for (const [item, qty] of Object.entries(recipe.input)) ready = holding(ready, item, qty.times(10));
      const r = startLine(ready, "refine", a, { kind: "batch", remaining: 1 });
      if (!r.started) return -1;
      const after = economyTick(r.next, 1, () => 0.5);
      const job = after.activeProcesses.find((p) => p.kind === "refineJob");
      return job ? job.remainingTicks : -1;
    }
    case "craft": {
      // Field Kits FKR-3: one craft of blueprint `a` on a Fabricator at its tier, researched and holding the inputs, run
      // to completion: how many of its output item the inventory gained.
      const bp = BLUEPRINTS[a];
      const out = bp.recipe.outputItem;
      if (out === undefined) return -1;
      let ready: GameState = { ...withFacilityLevel(s, "fabricator", Math.max(1, bp.tier)), researchedBlueprints: [...s.researchedBlueprints, a] };
      for (const [item, qty] of Object.entries(bp.recipe.inputs)) ready = holding(ready, item, new Decimal(qty));
      const before = heldOf(ready, out);
      const r = startLine(ready, "fabricate", a, { kind: "batch", remaining: 1 });
      if (!r.started) return -1;
      let after = r.next;
      for (let i = 0; i < bp.craftDurationTicks + 2; i += 1) after = economyTick(after, 1, () => 0.5);
      return heldOf(after, out) - before;
    }
    case "reactorFuel":
      // Reactor fuel ladder (0.14.0): one Fabricator craft of Reactor Core blueprint `a` at its tier, researched and
      // holding its recipe's inputs: how much of fuel item `b` the craft spends at start (reactorTech.ts, the fuel the
      // recipe carries). -1 when the craft is refused.
      return craftSpends(s, a, b);
    case "craftSpends":
      // Gas Giant Study GG-7: the same craft, for a canister input of any blueprint.
      return craftSpends(s, a, b);
    case "gg7":
      return gg7Value(s, a, on);
    case "affix": {
      // An objective carrying one instance of affix `a` at rank `b` (alignment `d`), read by the hook `c`'s reader.
      const alignment = (d ?? "negative") as AffixAlignment;
      const list: ObjectiveAffix[] = on ? [{ id: a as AffixId, rank: Number(b), alignment }] : [];
      return AFFIX_READERS[c](list, alignment);
    }
    case "escalation": {
      // An objective one alert level up (on) vs calm: the escalation's `a` (extraEnemies or damageMult).
      const e = escalationAt(on ? 1 : 0) as unknown as Record<string, number>;
      return e[a];
    }
    case "bone": {
      // Field Kits FKR-4: the bone hits (gambit.ts applyBoneHit, the hit a Bruiser's heavy hit lands) a fresh combatant
      // takes to hold bone condition `a`: its severity rank (Fracture first, then one rank worse per hit).
      if (!on) return 0;
      const c = gc("a1", "team");
      for (let hits = 1; hits <= 10; hits += 1) {
        applyBoneHit(c);
        if (c.statuses.some((x) => x.id === a)) return hits;
      }
      return -1;
    }
    case "fieldKitsCure": {
      // Field Kits FKR-4 (FK2 "Basic debuffs only"): a medic's Cure on an ally holding a Poison, plus (on) a serious
      // condition (a Concussion): the statuses the ally still holds after it (the serious one stays).
      const actor = gc("a1", "team", { medic: true });
      const ally = gc("a2", "team");
      applyStatus(ally, "poison");
      if (on) applyStatus(ally, "concussion");
      const st = battle([actor, ally, gc("e1", "enemy")]);
      evaluateAndAct([{ target: "allyHasStatus", action: "cure" }], actor, st, makeRng(0x5eed));
      return ally.statuses.length;
    }
    case "grenade": {
      // Field Kits FKR-5: grenade variety `a`, armed on a reference thrower the way a Field Kits fight arms it
      // (fieldKitsGrenades.ts withThrownGrenades), field `b`:
      //   charges   : the charges it brings to an objective (off: no grenade worn, 0);
      //   perBattle : the throws one whole battle lets it make, with charges to spare and a program that throws every
      //               turn it can (off: no grenade, 0);
      //   blast     : the hp one throw takes off a foe with no armor (off: the same throw at power x1);
      //   status    : the bodies its debuff lands on over a batch of throws at a group of two (off: the debuff chance 0).
      if (b === "charges") return on ? (armedThrower(a, 0).grenade?.charges ?? 0) : 0;
      if (b === "fuse") {
        // Timed grenades: the turns from the throw to the blast, armed as a catalog 2 fight arms it (off: as catalog 1,
        // every grenade on contact).
        const log = grenadeFuseBattle(a, on, 1, 1);
        const thrown = log?.find((e) => e.action === "throwGrenade");
        if (!log || !thrown) return -1;
        const blast = thrown.primed ? log.find((e) => e.action === "grenadeDetonates") : thrown;
        return blast ? blast.round - thrown.round : -1;
      }
      if (b === "movedClear") {
        // Timed grenades: the foes that moved clear over 64 detonations at a group of two (off: a moved-clear chance of 0).
        let moved = 0;
        for (let seed = 1; seed <= 64; seed += 1) {
          const log = grenadeFuseBattle(a, true, 2, Math.imul(seed, 0x9e3779b1) >>> 0, !on);
          if (!log) return -1;
          moved += log.find((e) => e.action === "grenadeDetonates")?.blast?.movedClear ?? 0;
        }
        return moved;
      }
      if (b === "perBattle") {
        if (!on) return 0;
        const thrower = armedThrower(a, 0);
        if (!thrower.grenade) return -1;
        thrower.grenade = { ...thrower.grenade, charges: 99 };
        thrower.hp = thrower.hpMax = GRENADE_PROBE_HP;
        thrower.program = [{ target: "foeNearest", action: "throwGrenade" }, { target: "foeNearest", action: "attack" }];
        const foe = gc("e1", "enemy", { hp: GRENADE_PROBE_HP, hpMax: GRENADE_PROBE_HP });
        return resolveGroundBattle([thrower], [foe], 0, makeRng(0x5eed)).chargesUsed?.[thrower.memberId!] ?? 0;
      }
      // Timed grenades (user 2026-10-21): blast and status arm the reference thrower as a catalog 2 fight arms it (what a
      // new run fights with), so they measure a timed grenade's DETONATION and the Impact Grenade's contact blast
      // (catalog2Throw).
      if (b === "blast") {
        const thrower = armedThrower(a, 0, true);
        if (!thrower.grenade) return -1;
        thrower.grenade = { ...thrower.grenade, statusPermille: 0, ...(on ? {} : { powerMult: 1 }) };
        const foe = gc("e1", "enemy", { hp: GRENADE_PROBE_HP, hpMax: GRENADE_PROBE_HP });
        catalog2Throw(thrower, [foe], 0x5eed, 1);
        return GRENADE_PROBE_HP - foe.hp;
      }
      let afflicted = 0;
      for (let seed = 1; seed <= 64; seed += 1) {
        const thrower = armedThrower(a, GRENADE_PROBE_STATUS_CHANCE, true);
        if (!thrower.grenade) return -1;
        if (!on) thrower.grenade = { ...thrower.grenade, statusPermille: 0 };
        const foes = [gc("e1", "enemy", { hp: GRENADE_PROBE_HP, hpMax: GRENADE_PROBE_HP }), gc("e2", "enemy", { hp: GRENADE_PROBE_HP, hpMax: GRENADE_PROBE_HP })];
        afflicted += catalog2Throw(thrower, foes, Math.imul(seed, 0x9e3779b1) >>> 0, seed);
      }
      return afflicted;
    }
    case "kit":
      return kitProbe(a as FieldKitId, on);
    case "kitPrice": {
      // Field Kits FKR-7: the credits one Quartermaster sale of kit `a` takes (quartermaster.ts buyFieldKits, the price the
      // launch top-up charges too); off: no sale, 0.
      if (!on) return 0;
      const r = buyFieldKits(s, a, 1);
      if (!r.ok) throw new Error(`kit price probe: the sale of ${a} was refused (${r.reason})`);
      return s.credits.minus(r.next.credits).toNumber();
    }
    case "freeBasic":
      return freeBasicProbe(s, a as FieldKitId, b, on);
    case "runTreatment": {
      // Field Kits FKR-7: a member's Broken Bone bay time on a Ground Ops run (groundOps.ts groundTeamBaySeconds, the bay
      // step's reader, no care) with (on) the share one Injury Kit records on the team's trip treatment, or none.
      const id = "wiring-treated";
      const exp = {
        roster: { security: [], science: [] },
        groundOps: { factors: { medicalShare: 0, rapidRecoveryShare: 0, officerFacetShare: 0, injurySteady: 0 } },
      } as unknown as Parameters<typeof groundTeamBaySeconds>[0];
      const team = { securityIds: [id], scienceIds: [], conditions: { [id]: ["brokenBone"] }, ...(on ? { treatment: { [id]: FIELD_KITS.injuryKit.treatmentShare ?? 0 } } : {}) };
      return groundTeamBaySeconds(exp, team)[id];
    }
    case "kitCategory":
      return kitCategoryProbe(a, on);
    case "rankCondition":
      return rankConditionProbe(on ? (a as EnemyRank) : undefined);
    case "bossReserve":
      return bossReserveProbe(on);
    case "fieldKitsDefault":
      return fieldKitsDefaultProbe(on);
    case "enemyRank": {
      // Field Kits FKR-1: the guard of a REAL task fight (groundFight.ts taskFightGuard, the list resolveTaskFightOnSeed
      // fields) at the fight point the placement leads with rank `a`: an objective of the grade and point
      // ENEMY_RANK_PROBE_FIGHT names, on a Derelict Outpost (hazard 0.1). On = a ranked run, off = the same run without
      // the flag (every enemy Normal). The lead's (the strongest enemy's) stat `b`: "hp" (whole numbers) or "power".
      // Safe first runs SF-3: Weak is placed by the difficulty curve, so its fight is on an ORDINARY run at the curve's
      // floor (the stamp ramp 0, Tier I: the curve's low end), the same stamp on and off; every enemy there is Weak.
      const at = ENEMY_RANK_PROBE_FIGHT[a as EnemyRank];
      if (!at) throw new Error(`enemy rank ${a} has no placement to probe`);
      const task = { id: "wiring-task", poiId: "derelictOutpost", fightCount: at.point, pointsCleared: at.point, difficulty: at.grade, fightPoints: [0.25, 0.5, 0.75] };
      const curve = at.curveFloor ? { difficulty: { version: 1 as const, firstRun: false, ramp: 0, tier: 1 as const } } : {};
      const guard = taskFightGuard({ hazardResist: 0, ...curve, ...(on ? { enemyRanks: { version: ENEMY_RANKS_VERSION } } : {}) }, { hazard: 0.1 }, task, 0x5eed);
      const lead = guard.reduce((best, e) => (e.power > best.power ? e : best));
      return b === "hp" ? lead.hp : lead.power;
    }
    case "fieldKitsRunsSwitch": {
      // Field Kits FKR-9 / FKR-10 (the switch-on): the extras a REAL Launch packs. On: startExpedition with its DEFAULT
      // runs switch (fieldKits.ts FIELD_KITS_RUNS_LIVE, the argument the dispatch console's Launch leaves out) for a crew
      // whose Warehouse holds FIELD_KITS_SWITCH_PROBE_STOCK First Aid Kits; off: the same launch with kits off. The
      // extras the run carries (each member's default pack holds one First Aid Kit, so the stock is the limit).
      const ready = withAwayTeam({ ...s, inventory: { ...s.inventory, firstAidKit: [new Decimal(FIELD_KITS_SWITCH_PROBE_STOCK)] } });
      const cand = expeditionCandidates(ready, WIRING_SHIP_ID)[0];
      // G2-4: past the propulsion gates (see dispatchRun); the runs switch is the argument under test.
      const res = on
        ? startExpedition(ready, WIRING_SHIP_ID, WIRING_CAPTAIN_ID, cand.id, true, FIELD_KITS_RUNS_LIVE, false)
        : startExpedition(ready, WIRING_SHIP_ID, WIRING_CAPTAIN_ID, cand.id, true, false, false);
      if (!res.success || !res.expedition) throw new Error(`field kits switch probe: dispatch refused (${res.reason})`);
      return Object.values(carriedExtras(res.expedition)).reduce((n, x) => n + (x ?? 0), 0);
    }
    case "fieldDevice":
      return fieldDeviceProbe(a, on);
    case "shortRangeRelics":
      // G1-5: the relic blanks a Tier I and a Tier II short-range cycle of SHORT_RANGE_RELIC_PROBE_HOURS find through
      // the cycle engine; on, runs carrying G1-5's relic flag; off, the same runs without it (dispatched before G1-5).
      return shortRangeRelicCycleFinds(s, 1, on) + shortRangeRelicCycleFinds(s, 2, on);
    case "fieldKitsHiddenPieces": {
      // Field Kits FKR-9 / FKR-10 (model.ts FIELD_KITS_PLAYER_LIVE): the pieces kept hidden until kits went live that a
      // player can now reach: each FIELD_KITS_HIDDEN_BLUEPRINTS blueprint in BLUEPRINTS (Research, the Fabricator, the
      // Archive), and each of the Stun and Toxin Grenades whose craft pool rolls the +1 Carry Capacity line. Both sides
      // run the same readers the build uses: on, the switched-on catalog (the shown blueprints found in BLUEPRINTS, the
      // varieties' real craft pools); off, the same readers with the switch off (model.ts fieldKitsShownBlueprints(false),
      // grenadeCraftPool(key, false)), the state a player saw before kits went live.
      const shown = fieldKitsShownBlueprints(on);
      const merged = Object.keys(shown).filter((k) => BLUEPRINTS[k] === shown[k]).length;
      const tool = EQUIPMENT_SLOTS.memberTool.varieties;
      const poolOf = (key: "stunGrenade" | "toxinGrenade") => (on ? tool.find((v) => v.key === key)?.affixPool : grenadeCraftPool(key, false).affixPool) ?? [];
      const carry = (["stunGrenade", "toxinGrenade"] as const).filter((key) => poolOf(key).some((a) => a.stat === "groundCarryCapacity")).length;
      return merged + carry;
    }
    // Wiring WR-11 content probes (OC-G4, OC-G6): the site flavor the objective card and queue row render, and the
    // rewards the flavor names, each read on a run stamped with the site rules (on) vs an unstamped run (off).
    case "poiFlavor": {
      const def = POI_CATALOG.find((p) => p.id === a);
      return def && def.flavor.length > 0 && groundSiteFlavor(a) === def.flavor ? 1 : 0;
    }
    case "siteFlavor":
      return [...HOSTILE_SITE_CATALOG, ...CLEARING_SITE_CATALOG].filter((d) => d.flavor.length > 0 && groundSiteFlavor(d.id) === d.flavor).length;
    case "poiRelicOdds":
      // The relic chance (permille) of an objective at this site on a calm world: gambit.ts relicChancePermille with the
      // site's factor (expeditionContent.ts poiRelicOddsMult, rollRelicToken's factor on a stamped run).
      return relicChancePermille(0, 0, poiRelicOddsMult(on ? { siteRules: 1 } : {}, a));
    case "poiMaterials": {
      // One task haul's material count at this site (gambit.ts rollHaul at a large scale, so rounding is one unit of 100).
      const haul = rollHaul(0x5eed, "terrestrial", 0, 100, poiMaterialMult(on ? { siteRules: 1 } : {}, a));
      return Object.values(haul.materials).reduce((x, y) => x + y, 0);
    }
    case "surfaceWork": {
      // One surface objective's work seconds on a world of this type, no team (groundTasks.ts taskWorkSeconds).
      const run = { roster: undefined, scienceStrength: 0, hazardResist: 0, ...(on ? { siteRules: 1 as const } : {}) };
      return taskWorkSeconds(run, [], { planetType: a as ExpeditionPlanetType, hazard: 0 }, "crashedShip");
    }
    case "wr11":
      return wr11AuditValue(s, a, on);
    case "wr9":
      return wr9AuditValue(a);
    default:
      throw new Error(`unknown content probe ${id}`);
  }
}

// WR-9: the generated complement batch the third-buff check reads (seed WR9_CREW_PROBE_SEED, rows 0 to WR9_CREW_PROBE_ROWS - 1).
export const WR9_CREW_PROBE_SEED = 0x3b0ff;
export const WR9_CREW_PROBE_ROWS = 600;
// The crew in that batch whose rank carries 3 buffs (buffCountForRank, the catalog's count): the check's magnitude. Pure.
export function wr9TopRankCount(): number {
  let n = 0;
  for (let i = 0; i < WR9_CREW_PROBE_ROWS; i++) if (buffCountForRank(generateComplementCrew(WR9_CREW_PROBE_SEED, i).rank) >= 3) n++;
  return n;
}

// Wiring WR-9's content audit rows. Pure.
function wr9AuditValue(key: string): number {
  switch (key) {
    case "noEnlisted":
      // OC-E11: the rank ladder carries no enlisted flag (1 = deleted).
      return Object.values(CREW_RANKS).every((r) => !("enlisted" in r)) ? 1 : 0;
    case "noAttrition":
      // OC-E7: Morale Anchor's text names only its Fear resist (1 = the attrition half is gone).
      return SENIOR_STAFF_BONUSES.filter((d) => d.id === "xo.moraleAnchor").every((d) => !/attrition/i.test(d.description)) ? 1 : 0;
    case "thirdBuff": {
      // OC-E12: the crew of the batch that carry a third buff its contribution counts (the buff's key holds at least the
      // buff's own magnitude scaled by rarity and rank, so a third buff the rollup dropped would not count).
      let n = 0;
      for (let i = 0; i < WR9_CREW_PROBE_ROWS; i++) {
        const sig = generateComplementCrew(WR9_CREW_PROBE_SEED, i);
        const def = sig.buff3Id !== undefined ? getCrewBuffById(sig.buff3Id) : undefined;
        if (!def) continue;
        const without = contributionForSignature({ ...sig, buff3Id: undefined })[def.statKey] ?? 0;
        if ((contributionForSignature(sig)[def.statKey] ?? 0) > without) n++;
      }
      return n;
    }
    default:
      throw new Error(`unknown WR-9 content probe ${key}`);
  }
}

// Wiring WR-11's audit rows, each read through the consumer that makes it true (on = the WR-11 rule, off = the
// record or run without it). Pure.
function wr11AuditValue(s: GameState, key: string, on: boolean): number {
  switch (key) {
    case "anomalySensors":
      // The anomaly chart chance of the run this fixture dispatches (its sensors frozen at dispatch).
      return anomalyChartPermille(dispatchRun(s));
    case "anomalyFinding": {
      // The credits plus material units a charted anomaly's finding carries home: a stamped run (on) vs an older one.
      const run = dispatchRun(s);
      const f = chartedAnomalyFinding(on ? run : { ...run, siteRules: undefined }, () => 0x1234);
      return (f.credits ?? 0) + Object.values(f.materials ?? {}).reduce((x, y) => x + y, 0);
    }
    case "noRelicSignature":
      // The candidate lists' foreknowledge without the deleted always-true relicSignature (1 = none carries it).
      return expeditionCandidates(withAwayTeam(s), WIRING_SHIP_ID).every((c) => !("relicSignature" in c.foreknowledge)) ? 1 : 0;
    case "noProfileCopies": {
      // The ship-event profile a dispatch freezes, without the two deleted display copies (1 = neither is written).
      const profile = snapshotShipEventProfile(s, shipOf(s)) as unknown as Record<string, unknown>;
      return !("evasion" in profile) && !("shieldCapacity" in profile) ? 1 : 0;
    }
    case "noStatusColor":
      return Object.values(STATUS_EFFECT_DEFS).every((d) => !("color" in d)) ? 1 : 0;
    case "salvageRoll":
    case "salvageTierName": {
      // One real material salvage job (startSalvageJob, then resolveProcesses): its completed-events entry carries the
      // rolled loot tier (salvageRoll), and the Home board row names it ("Standard quality"). Off: the job's roll rules
      // stamp removed (a job started before WR-11).
      const item = Object.keys(SALVAGE_LOOT_POOLS)[0];
      const started = startSalvageJob(holding(s, item, new Decimal(1)), { type: "salvage", target: { kind: "material", itemId: item }, mode: { kind: "batch", remaining: 1 } });
      if (!started.started) return -1;
      let st: GameState = on
        ? started.next
        : { ...started.next, activeProcesses: started.next.activeProcesses.map((p) => (p.effect.type === "salvageResolve" ? { ...p, effect: { type: "salvageResolve" as const, target: p.effect.target } } : p)) };
      for (let i = 0; i < 100_000 && st.activeProcesses.some((p) => p.kind === "salvageJob"); i += 1) st = resolveProcesses(st, 1, () => 0.5, 1).next;
      const entry = st.completionLog[st.completionLog.length - 1];
      if (key === "salvageRoll") return entry?.salvageRoll !== undefined ? 1 : 0;
      const row = buildHomeDashboard(st).recentlyCompleted.find((r) => r.id === entry?.id);
      return row?.secondaryLabel?.endsWith(" quality") ? 1 : 0;
    }
    case "deadEndSell": {
      // Selling one Salvaged Circuitry and one Precursor Circuit at the Quartermaster: the credits they bring.
      let total = 0;
      for (const id of ["salvagedCircuitry", "precursorCircuit"]) {
        const held = holding(s, id, new Decimal(1));
        const r = sellItem(held, id, new Decimal(1));
        total += r.ok ? Number(r.next.credits) - Number(held.credits) : 0;
      }
      return total;
    }
    case "precursorSell": {
      const held = holding(s, "precursorCircuit", new Decimal(1));
      const r = sellItem(held, "precursorCircuit", new Decimal(1));
      return r.ok ? Number(r.next.credits) - Number(held.credits) : 0;
    }
    case "safetyAffixes":
      // The affix count rows of the unreachable bands (itemgen.ts affixCount reads rarityProfile): each is a finite row.
      return (["derelict", "luminous", "constellar"] as const).filter((r) => Number.isFinite(rarityProfile(r).affixes)).length;
    case "memberFieldwork": {
      // The named Science members' own fieldwork on the dispatched run (best planet), which the Museum's Science team
      // power scales (fieldwork.ts memberFieldworkTotal, frozen museumSciencePower).
      const run = dispatchRun(s);
      return bestOverPlanets((p) => memberFieldworkTotal(run, p));
    }
    default:
      throw new Error(`unknown WR-11 audit probe ${key}`);
  }
}

// == Field Kits FKR-6: kits in battle, rank conditions, the Boss reserve, the Field Kits default program ==

// A battle state with the Field Kits kit rules (a Field Kits run's battle), and a member carrying `n` of `kit`.
function kitBattle(combatants: GroundCombatant[]): BattleState {
  return { ...battle(combatants, 0), kitRules: FIELD_KITS_BATTLE };
}
function packed(c: GroundCombatant, kit: FieldKitId, n: number): GroundCombatant {
  c.kits = { basics: {}, extras: n > 0 ? { [kit]: n } : {}, basicsUsed: {}, extrasUsed: {} };
  return c;
}
const ZERO_CARE = { medicalShare: 0, rapidRecoveryShare: 0, officerFacetShare: 0, injurySteady: 0 };

// Kit `kit`'s effect through Use Item rules (on: the actor carries the kits; off: none, so the rule never fires):
//   firstAidKit : the hp an afflicted ally gains from one use at effectiveness 1 (an untrained hand x a Fleet Triage of
//                 2; the heal rides the cleanse);
//   antitoxin   : the conditions one use removes from a Poisoned ally (a Medical Training hand);
//   combatStim  : the Inspired rounds one use grants at effectiveness 1;
//   splint      : the allies two uses treat (a Fracture splinted, a Broken Bone turned into a Fracture);
//   traumaKit   : the conditions two uses clear (Hemorrhage, Neurotoxin, Concussion and a Fracture on one ally, a Broken
//                 Bone on another);
//   injuryKit   : a downed ally's Broken Bone bay time with the share one use records (the medical bay divisor).
function kitProbe(kit: FieldKitId, on: boolean): number {
  const n = on ? 2 : 0;
  const use = (actor: GroundCombatant, st: BattleState, target: GambitRule["target"], times = 1) => {
    for (let i = 0; i < times; i += 1) evaluateAndAct([{ target, params: { kitId: kit }, action: "useItem" }], actor, st, makeRng(0x5eed));
  };
  switch (kit) {
    case "firstAidKit": {
      const actor = packed(gc("a1", "team", { careMult: 2 }), kit, n);
      const ally = gc("a2", "team", { hp: 50, hpMax: 200 });
      applyStatus(ally, "weakened");
      use(actor, kitBattle([actor, ally, gc("e1", "enemy")]), "allyHasStatus");
      return ally.hp - 50;
    }
    case "antitoxin": {
      const actor = packed(gc("a1", "team", { medic: true }), kit, n);
      const ally = gc("a2", "team");
      applyStatus(ally, "poison");
      use(actor, kitBattle([actor, ally, gc("e1", "enemy")]), "allyHasStatus");
      return 1 - ally.statuses.length;
    }
    case "combatStim": {
      const actor = packed(gc("a1", "team", { careMult: 2 }), kit, n);
      use(actor, kitBattle([actor, gc("e1", "enemy")]), "self");
      return actor.statuses.find((x) => x.id === "inspired")?.remaining ?? 0;
    }
    case "splint": {
      const actor = packed(gc("a1", "team", { medic: true }), kit, n);
      const a2 = gc("a2", "team");
      const a3 = gc("a3", "team");
      applyBoneHit(a2);
      applyBoneHit(a3);
      applyBoneHit(a3);
      const before = [a2, a3].map((c) => JSON.stringify(c.statuses));
      use(actor, kitBattle([actor, a2, a3, gc("e1", "enemy")]), "allyHasStatus", 2);
      return [a2, a3].filter((c, i) => JSON.stringify(c.statuses) !== before[i]).length;
    }
    case "traumaKit": {
      const actor = packed(gc("a1", "team", { medic: true }), kit, n);
      const a2 = gc("a2", "team", { hp: 20 });
      for (const id of ["hemorrhage", "neurotoxin", "concussion"] as const) applyStatus(a2, id);
      applyBoneHit(a2);
      const a3 = gc("a3", "team");
      applyBoneHit(a3);
      applyBoneHit(a3);
      const held = a2.statuses.length + a3.statuses.length;
      use(actor, kitBattle([actor, a2, a3, gc("e1", "enemy")]), "allyHasStatus", 2);
      return held - a2.statuses.length - a3.statuses.length;
    }
    case "injuryKit": {
      const actor = packed(gc("a1", "team", { medic: true }), kit, n);
      const ally = gc("a2", "team", { memberId: "wiring-downed", hp: 0, downed: true });
      use(actor, kitBattle([actor, ally, gc("e1", "enemy")]), "allyDowned");
      return conditionCureSeconds(GROUND_CONDITIONS.brokenBone, [], ZERO_CARE, ally.injuryTreated ?? 0);
    }
  }
}

// Field Kits FKR-7: the free basic set (fieldKits.ts FREE_BASIC_SET) a Security member holds of kit `kit` as their crew
// lands on an objective (fieldKitsRun.ts refreshObjectiveSupplies on the run's stamp, fieldKitsStamp, frozen off the
// fixture ship's Medical and Operations headcount):
//   base : on, a ship with no support crew (the set's base); off, a run stamped with no free set (0);
//   crew : on, a ship with FREE_BASIC_PROBE_HEADS Medical crew; off, none (the D23 crew curve's rise).
const FREE_BASIC_PROBE_HEADS = 16;
// Field Kits FKR-9 / FKR-10: the First Aid Kits the runs switch probe's Warehouse holds (one per wiring Security member).
export const FIELD_KITS_SWITCH_PROBE_STOCK = 1;

// Field Kits FKR-8 (the wiring plan's OC-F1): the field devices on the ground, rolled per use. Each part reads the
// engine's own reader on a run carrying the field devices stamp (FIELD_DEVICES_VERSION) whose one Security member
// (the crew) wears a Lure Beacon when `on` (none when off), over FIELD_DEVICE_PROBE_USES uses (each use its own key):
//   ambush        : the uses an ambush strikes (groundOps.ts ambushStrike, the roll startWork makes) on a calm objective
//                   at FIELD_DEVICE_PROBE_CHANCE;
//   reinforcement : the visits that bring reinforcements (groundOps.ts visitReinforcements, the roll landOnTask makes) on
//                   a Reinforcing I objective;
//   roll          : the distinct percents the Lure's per-use effectiveness takes (groundOps.ts groundDeviceChance, the
//                   chance both rolls compare against, read back to the percent); off, no device works, one value;
//   codebreaker   : the Lure's lift on one use's chance (groundDeviceChance / the chance, minus 1), the Lure worn either
//                   way and (on) a Codebreaker among the Science squad;
//   salvage       : the summed rollHaul scale of a won probe battle (shipScanEvents.ts shipSalvageScale, the scale
//                   shipEventSalvage rolls the haul at) over the probe's scan boundaries.
export const FIELD_DEVICE_PROBE_USES = 256;
export const FIELD_DEVICE_PROBE_CHANCE = 0.3;
// The scan boundaries the salvage part reads: bodies 0 to 3, steps 1 to 9.
export const FIELD_DEVICE_PROBE_BOUNDARIES: readonly (readonly [number, number])[] = [0, 1, 2, 3].flatMap((b) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => [b, k] as const));
function fieldDeviceProbe(part: string, on: boolean): number {
  const lure = part === "codebreaker" || on;
  const codebreaker = part === "codebreaker" && on;
  const member = (memberId: string, teamType: "security" | "science", varietyKey: string | null, traits: AwayTraitId[]) =>
    ({ memberId, teamType, traits, gear: varietyKey ? [{ pieceId: `wiring-${varietyKey}`, slotType: "memberTool", varietyKey, points: 0 }] : [] }) as unknown as SnapshotMember;
  const exp = {
    id: "wiring-devices",
    seed: 0x5eed8,
    fieldKits: { catalog: FIELD_KITS_CATALOG_VERSION, devices: FIELD_DEVICES_VERSION },
    roster: { security: [member("wiring-sec", "security", lure ? "lureBeacon" : null, [])], science: [member("wiring-sci", "science", null, codebreaker ? ["codebreaker"] : [])] },
    bodies: [],
  } as unknown as Expedition;
  const crew = [{ securityIds: ["wiring-sec"], scienceIds: ["wiring-sci"], downedThisTask: [] }] as unknown as GroundTeamRun[];
  const ref = (flatIndex: number, task: Partial<ExpeditionActivity>) =>
    ({ body: { id: "wiring-body", hazard: 0 }, bodyIndex: 0, flatIndex, task: { id: `wiring-task-${flatIndex}`, poiId: "derelictOutpost", ...task } }) as unknown as GroundTaskRef;
  const uses = Array.from({ length: FIELD_DEVICE_PROBE_USES }, (_, k) => k);
  switch (part) {
    case "ambush":
      return uses.filter((k) => ambushStrike(exp, ref(k, { fightPoints: [], ambushChance: FIELD_DEVICE_PROBE_CHANCE }), 100, crew) !== null).length;
    case "reinforcement":
      return uses.filter((k) => visitReinforcements(exp, crew, ref(k, { fightPoints: [0.5], affixes: [{ id: "reinforcing", rank: 1, alignment: "negative" }] }), 0).length > 0).length;
    case "roll": {
      const dial = memberVariety("memberTool", "lureBeacon")?.member.encounterBias ?? 0;
      return new Set(uses.map((k) => Math.round(((groundDeviceChance(exp, crew, FIELD_DEVICE_PROBE_CHANCE, "ambush", k, 0) / FIELD_DEVICE_PROBE_CHANCE - 1) / dial) * 100))).size;
    }
    case "codebreaker":
      return groundDeviceChance(exp, crew, FIELD_DEVICE_PROBE_CHANCE, "ambush", 0, 0) / FIELD_DEVICE_PROBE_CHANCE - 1;
    case "salvage":
      return FIELD_DEVICE_PROBE_BOUNDARIES.reduce((sum, [b, k]) => sum + shipSalvageScale(exp, b, k, false), 0);
  }
  throw new Error(`field device probe: no part ${part}`);
}
function freeBasicProbe(s: GameState, kit: FieldKitId, part: string, on: boolean): number {
  const heads = part === "crew" && on ? FREE_BASIC_PROBE_HEADS : 0;
  const buckets = heads > 0 ? [{ profession: "medical" as const, rarity: "standard" as const, rank: 1 as const, race: "earthBorn" as const, buff1Id: "med.triage", buff2Id: null, count: heads }] : [];
  const fixture: GameState = { ...editShip(s, { complement: { buckets, mode: "passive" } }), notableCrew: [] };
  const stamp = part === "base" && !on ? { catalog: FIELD_KITS_CATALOG_VERSION } : fieldKitsStamp(fixture, shipOf(fixture));
  const team = { securityIds: ["wiring-member"] } as unknown as Parameters<typeof refreshObjectiveSupplies>[1][number];
  refreshObjectiveSupplies({ fieldKits: stamp }, [team]);
  return team.basics?.["wiring-member"]?.[kit] ?? 0;
}

// Kit category `cat`'s rule (on: a Medical Training hand; off: an untrained one):
//   firstAid        : the hp one First Aid Kit restores (a large Fleet Triage keeps the rounding out of the ratio);
//   advancedMedical : the Splints that fire on a Fractured ally (the gate).
function kitCategoryProbe(cat: string, on: boolean): number {
  if (cat === "firstAid") {
    const actor = packed(gc("a1", "team", { medic: on, careMult: 100 }), "firstAidKit", 1);
    const ally = gc("a2", "team", { hp: 1, hpMax: 100_000 });
    applyStatus(ally, "weakened");
    evaluateAndAct([{ target: "allyHasStatus", params: { kitId: "firstAidKit" }, action: "useItem" }], actor, kitBattle([actor, ally, gc("e1", "enemy")]), makeRng(0x5eed));
    return ally.hp - 1;
  }
  if (cat === "advancedMedical") {
    const actor = packed(gc("a1", "team", { medic: on }), "splint", 1);
    const ally = gc("a2", "team");
    applyBoneHit(ally);
    evaluateAndAct([{ target: "allyHasStatus", params: { kitId: "splint" }, action: "useItem" }], actor, kitBattle([actor, ally, gc("e1", "enemy")]), makeRng(0x5eed));
    return actor.kits?.extrasUsed.splint ?? 0;
  }
  throw new Error(`kit category ${cat} has no battle probe`);
}

// A rank condition (on: "target is <rank> or stronger"; off: no condition): how many of a lineup of one enemy per rank
// (Weak to Boss) the rule attacks.
function rankConditionProbe(minRank: EnemyRank | undefined): number {
  let fires = 0;
  for (const rank of ENEMY_RANK_IDS) {
    const actor = gc("a1", "team");
    const foe = gc("e1", "enemy", { rank, hp: 1000, hpMax: 1000 });
    evaluateAndAct([{ target: "foeNearest", ...(minRank ? { params: { minRank } } : {}), action: "attack" }], actor, battle([actor, foe]), makeRng(0x5eed));
    if (foe.hp < 1000) fires += 1;
  }
  return fires;
}

// The Boss reserve (on: the Field Kits default's "keep N for a Boss" on a throw rule; off: none): the charges a thrower
// with two left, throwing every turn it can, spends over a whole battle against a Normal foe.
function bossReserveProbe(on: boolean): number {
  const keep = FIELD_KITS_DEFAULT_GRENADE_RULES.find((r) => r.params?.reserveForBoss !== undefined)?.params?.reserveForBoss;
  const thrower = gc("a1", "team", { memberId: "wiring-thrower", hp: GRENADE_PROBE_HP, hpMax: GRENADE_PROBE_HP });
  thrower.grenade = { status: "concussion", statusPermille: 0, powerMult: 1, charges: 2, perBattle: 99, used: 0 };
  thrower.program = [
    { target: "foeNearest", ...(on && keep !== undefined ? { params: { reserveForBoss: keep } } : {}), action: "throwGrenade" },
    { target: "foeNearest", action: "attack" },
  ];
  const foe = gc("e1", "enemy", { hp: GRENADE_PROBE_HP, hpMax: GRENADE_PROBE_HP });
  return resolveGroundBattle([thrower], [foe], 0, makeRng(0x5eed)).chargesUsed?.[thrower.memberId!] ?? 0;
}

// The Field Kits default program (on: a Field Kits fight swaps it in for a member on D19's default; off: D19's own): the
// grenades a member on the default, armed with an Impact Grenade, throws in one battle against a group of two.
function fieldKitsDefaultProbe(on: boolean): number {
  const thrower = armedThrower("impactGrenade", 0);
  thrower.program = DEFAULT_MEMBER_GAMBIT.map((r) => ({ ...r }));
  thrower.hp = thrower.hpMax = GRENADE_PROBE_HP;
  if (on) withFieldKitsDefaultProgram([thrower]);
  const foes = [gc("e1", "enemy", { hp: GRENADE_PROBE_HP, hpMax: GRENADE_PROBE_HP }), gc("e2", "enemy", { hp: GRENADE_PROBE_HP, hpMax: GRENADE_PROBE_HP })];
  return resolveGroundBattle([thrower], foes, 0, makeRng(0x5eed)).chargesUsed?.[thrower.memberId!] ?? 0;
}

// Field Kits FKR-1: the fight each placed rank is probed on (grade 1 Simple .. 5 Deadly, the 0-based fight point of a
// three-point objective): Normal on a Simple final, Strong on a Dangerous earlier point, Elite on a Challenging final,
// Boss on a Deadly final; Weak (safe first runs SF-3, the curve's low end) on a Simple final of an ordinary run at the
// curve's floor (`curveFloor`).
const ENEMY_RANK_PROBE_FIGHT: Readonly<Partial<Record<EnemyRank, { grade: number; point: number; curveFloor?: true }>>> = {
  weak: { grade: 1, point: 2, curveFloor: true },
  normal: { grade: 1, point: 2 },
  strong: { grade: 4, point: 0 },
  elite: { grade: 3, point: 2 },
  boss: { grade: 5, point: 2 },
};

// The officer stat facets: the department facet each facet consumer reads (officerStats.ts departmentFacet; for
// the XO's own bonuses, seatFacet). "facet:<dept>:<stat>".
export type FacetProbeId = `facet:${CrewProfession | "all"}:${keyof OfficerStats}`;
export type ContentProbeId = `content:${string}`;
export type MuseumProbeId = `museum:${string}`;
// GEAR WEAR step 3: the `wear:` probes live in wearProbes.ts (their fixtures drive the gear wear engine).
export type ProbeId = keyof typeof PROBES | FacetProbeId | ContentProbeId | MuseumProbeId | WearProbeId;

export function probeLabel(id: ProbeId): string {
  if (id.startsWith("content:")) return id;
  if (id.startsWith("wear:")) return wearProbeDef(id as WearProbeId).label;
  if (id.startsWith("museum:")) return `museumBonuses.${id.slice(7)}`;
  if (id.startsWith("facet:")) {
    const [, dept, stat] = id.split(":");
    return dept === "all" ? `seatFacet(executive, ${stat})` : `departmentFacet(${dept}, ${stat})`;
  }
  return (PROBES[id as keyof typeof PROBES] as ProbeDef).label;
}

function readFacet(id: FacetProbeId, s: GameState): number {
  const [, dept, stat] = id.split(":") as [string, CrewProfession | "all", keyof OfficerStats];
  return dept === "all" ? seatFacet(s, shipOf(s), "executive", stat) : departmentFacet(s, shipOf(s), dept, stat);
}

// A probe's value, by id (the registry stores ids so the Debug panel can name them). A non-finite value throws.
export function readProbe(id: ProbeId, s: GameState, ctx: ContextId): number {
  const v = id.startsWith("wear:")
    ? wearProbeDef(id as WearProbeId).read(s, ctx)
    : id.startsWith("facet:")
    ? readFacet(id as FacetProbeId, s)
    : id.startsWith("content:")
      ? readContent(id, s)
      : id.startsWith("museum:")
        ? museumBonuses(s)[id.slice(7) as MuseumStat]
        : (PROBES[id as keyof typeof PROBES] as ProbeDef).read(s, ctx);
  if (!Number.isFinite(v)) throw new Error(`probe ${id} returned a non-finite value: ${v}`);
  return v;
}
