// WR-1 (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 3): THE WIRING REGISTRY.
//
// The user (capture 2026-10-15 section 5): "if you spec into something that provides 8% to a stat, it provides that
// 8%. The 8% will change, but the effect of that 8% will not." Every effect source the game configures is listed
// here ONCE, with:
//   - the game value it should move (a seam probe, probes.ts: a pure read through the real consumer),
//   - every context its claim covers (a PARTIAL source lists the contexts that do not move yet in its status),
//   - the direction and the curve it moves on, and its magnitude READ FROM THE CATALOG (never a literal), so a
//     retune stays green and a broken wire fails,
//   - on / off transforms (grant the source; the same state without it), and
//   - its status: live, pending (a 0.14.0 slice brings it live; the release gate blocks), deferred (the user moved
//     it past 0.14.0, with the user's words as its reference) or held (D14 Craft Duplicate).
//
// Tests: wiring.sensitivity.test.ts (direction + magnitude per live entry per context; pending entries must NOT
// move), wiring.completeness.test.ts (catalog enumeration, field roles, unread constants, claim text, release
// gate), wiring.liveness.test.ts (id parity with the no-dead-stats liveness level) and no-dead-stats.test.ts (the
// liveness level itself, whose expectations come from the statuses here).
//
// Pure data and pure transforms; no state writes. The registry rule (plan section 0): a slice that adds or changes
// an effect source updates its entry in the same commit, and a slice that wires a pending entry flips it to live in
// the same commit.

import {
  BLUEPRINTS,
  emptyMuseumV2,
  withGeneralMuseumRecord,
  FIELD_KITS_HIDDEN_BLUEPRINTS,
  CAPTAIN_RACIAL_SCALE,
  CAPTAIN_SPEC_BONUS,
  CAPTAIN_TALENTS,
  EQUIPMENT_SLOTS,
  EQUIPMENT_STORAGE_RUNGS,
  FACILITIES,
  MISSION_CONTROL_UNLOCK_COMPLETIONS,
  GENERAL_QUARTERS_GUEST_PERK,
  GRENADE_CARRY_PER_LINE,
  HOMEWORLD_TALENTS,
  ITEMS,
  LIVE_STAT_KEYS,
  MASS_SPEED_DRAG,
  MEMBER_GROUND_STAT_KEYS,
  MEMBER_SLOT_TYPES,
  MISSIONS,
  PATROLS,
  FIELD_KITS_DEFAULT_GRENADE_RULES,
  PERCENT_STAT_CURVES,
  REFINE_RECIPES,
  refineRecipeOffered,
  SALVAGE_LOOT_POOLS,
  SECONDARY_CAPTAIN_TALENTS,
  SHIP_DOCKS_BASE,
  SHIP_DOCKS_RUNGS,
  SHIP_TYPES,
  SI_EMITTER_CAP,
  SI_EMITTER_RECHARGE,
  SI_PLATING_HP,
  SLOT_BASE_PHYSICALS,
  STANDARD_ISSUE_MEMBER_POINTS,
  STANDARD_ISSUE_MEMBER_SHARES,
  standardIssueMemberLines,
  generateStandardIssue,
  driveClassPowerDraw,
  SUBSPACE_TELESCOPE_FACILITY_KEY,
  SUBSPACE_TELESCOPE_LEVELS,
  TRANSIT_BERTH_RUNGS,
  blueprintsUnlockedByRelic,
  type AffixAlignment,
  type AffixId,
  type AwayTeamType,
  type CaptainTalentBranch,
  type CaptainTalentKey,
  type CrewBucket,
  type CrewProfession,
  type EquipmentAscension,
  type EquipmentRarity,
  type CrewRace,
  type GambitActionId,
  type GambitStatusId,
  type GameState,
  type HomeworldTalentKey,
  type MemberGroundStatKey,
  type MemberSlotType,
  type MissionKey,
  type OfficerStats,
  type SecondaryTalentKey,
  type SeniorStaffSeat,
  type ShipTypeKey,
} from "../model";
import Decimal from "break_infinity.js";
import { diminishing } from "../diminishing";
import { materialQualityClimbChance } from "../materialQuality";
import { secondaryTalentEffectText } from "../captainSecondaryEffects";
import { buyHomeworldTalent, describeCaptainTalentEffect, installMissingCombatBaselines } from "../tick";
import type { CaptainPrimaryMultKind } from "../captainPrimaryEffects";
import { BASE_FTL_DURABILITY, BASE_REACTOR_DURABILITY, COMBAT_DEFAULT_LOADOUT, combatHullTypeOf, hullDefenseComposition } from "../combat/bridge";
// WR-8 (0.14.0): the combat descriptors (combatRules.ts), their probes' on / off mark, and the readers they name.
import { DEFENSIVE_STANCE, ENCOUNTER_OPEN_DISTANCE, WEAPON_RULE_TRAITS, familyResistPercent, podLineShare } from "../combat/combatRules";
// E-MOD EM-3: the combat over-budget penalty's floor (its registry row's magnitude).
import { POWER_SUPPLY_FLOOR_PERCENT } from "../combat/power";
import { reactorSurplusSpeedLift } from "../reactorSurplus";
import { qualityDurabilityMax } from "../combat/durability";
import { stancePreferredDistance } from "../combat/positioning";
import { combatDescriptorOn } from "./combatDescriptorProbes";
import { SENIOR_STAFF_BONUSES, type SeniorStaffBonusDef } from "../seniorStaffBonuses";
import { CREW_PROFESSION_BUFFS, CREW_STAT_KEYS, HELD_CREW_BUFF_IDS, SECOND_LEVEL_EXCLUSIVE, TRANSIT_SPEED_KEY, type CrewBuffDef } from "../crewBuffs";
import { CREW_RACES } from "../crewRaces";
import { CREW_RARITY_CAP, CREW_RARITY_MULTIPLIER } from "../crewRarity";
import { memberVariety, rarityIndex } from "../model";
import { CREW_RANKS, CREW_RANK_ORDER, rankMagnitudeFactor } from "../crewRank";
import { GROUND_CONDITIONS, STONESKIN_INJURY_MULT } from "../medicalBay";
import { OFFICER_STAT_KEYS } from "../seniorStaff";
import { DEPARTMENT_OF_SEAT, OFFICER_STAT_NEUTRAL, XO_DEPARTMENT_SHARE, officerStatFacet } from "../officerStats";
import { CREW_EFFECTIVENESS_KNEE, OFFICER_BONUSES_PENDING_IN_RELEASE, POWER_EFFICIENCY_KNEE } from "../crewOverlay";
import { patrolCycleOneRampHours } from "../tick";
import { constitutionRamp } from "../constitutionRamp";
import { DRIVE_CLASS_REACH_MULT, FRONTIER_SENSORS } from "../propulsion";
import { TIER_TRANSIT_HOURS, VOYAGE_BAND_SCALE_PERMILLE, voyageClassSteps } from "../voyage";
import { TIER_HAUL_MULT } from "../riskFactors";
import { recallExpedition } from "../expedition";
import { AWAY_TRAITS, type AwayTraitDef } from "../awayTraits";
import { FIRST_AID_TRAINED_EFFECTIVENESS, FIRST_AID_UNTRAINED_EFFECTIVENESS, GAMBIT_PRESETS, GAMBIT_STATUSES, STONESKIN_BATTLE_RESIST } from "../gambit";
import { applyMemberGambitPreset } from "../memberGambits";
import { GEAR_POINT_BUMP, GROUND_STAT_MEMBER_STAT, FIELDWORK_YIELD_PER_POINT, STATUS_RESIST_PER_POINT } from "../awayTeam";
import { PROSPECTING_BLUEPRINTS, PROSPECTING_SPEC_BASE, PROSPECTING_USES } from "../prospecting";
import { FIELDWORK_SPEED_KNEE, FIELDWORK_SPEED_PER_BUMP, FIELDWORK_YIELD_KNEE } from "../fieldwork";
import {
  EXCEPTIONAL_SETS,
  MUSEUM_COPY_LADDER,
  MUSEUM_PER_COPY_BONUS,
  MUSEUM_STATS,
  MUSEUM_TIER_LEVEL_BONUS,
  MUSEUM_V2_KNEE,
  MUSEUM_V2_PER_COPY,
  RELIC_SETS,
  RELIC_SOFT_CAP,
  RELIC_TYPES,
  RELICS,
  museumBonusesFromRecord,
  museumDepositGeneral,
  type CurvedRegionTier,
  type MuseumStat,
} from "../relics";
import { shortRangeRelicMicrosPerHour } from "../relicBlanks";
// Relics v2 R2-10: the minigame's relic boost table (one-way; the audit reads it, no gameplay file does).
import { RELIC_BOOSTS } from "../../secret/config";
import { BRIDGE_MODULES, QUARTERS_MODULES, moduleEffectScale } from "../crewModules";
// E-MOD EM-7: the v1 universal module roster (each module's registry row reads its def through CATALOGS).
import { UNIVERSAL_MODULES, bonusHaulUnits, type UniversalModuleDef } from "../shipModules";
import { graduateStandout } from "../crewGraduation";
import { signatureKey } from "../crew";
import { SENSOR_ARRAYS } from "../sensorArrays";
import { RETIREMENT_EXP_PER } from "../captainRetirement";
import { explorerTalentText } from "../captainExplorerEffects";
import { POI_CATALOG, PLANET_TYPES } from "../expeditionContent";
import { WEAPON_DEFS } from "../combat/weapons";
import { ROLE_TEMPLATE } from "../combat/drones";
import { PIRATE_HULLS } from "../combat/enemyHulls";
import { STATUS_EFFECT_DEFS } from "../combat/statusEffects";
import { DAMAGE_CONTROL_SUITE_KEY, DC_REPAIR_SPEED_B, DC_REPAIR_SPEED_R, DC_WAVE_REGEN_B, DC_WAVE_REGEN_R, PF_HAZARD_RESIST_B, PF_HAZARD_RESIST_R, PF_SCAN_SPEED_B, PF_SCAN_SPEED_R } from "../utilityGear";
import { DRONE_POD_AFFIX_POOL, DRONE_POD_BASE_DURABILITY, DRONE_POD_IMPLICIT_STAT, QUALITY_DURABILITY_BONUS, WEAPON_AFFIX_POOL, WEAPON_IMPLICIT_STAT, budgetAtMult, budgetShares, generateEquipment, legendaryAffixLineValue } from "../itemgen";
// RARITY READINESS RR-5: the Luminous legendary affix catalog (each row measured on its fold).
import { LUMINOUS_AFFIXES, type LegendaryAffixDef } from "../legendaryAffixes";
import { MODULE_RARITY_FACTOR, type EquipmentInstance as RrEquipmentInstance } from "../model";
// RARITY READINESS RR-6: the one set engine's catalog (each tier measured exactly on its fold).
import { CELESTIAL_SET_REDUCTION, GEAR_SETS, type GearSetDef } from "../gearSets";
// RARITY READINESS RR-3: the per-rarity profile table (each row measured on a real mint).
import { RARITY_PROFILES } from "../rarityProfiles";
// RARITY READINESS RR-4: the Nova / Celestial budget multipliers (each measured on a real legendary mint).
import { ASCENSION_BUDGET_MULT } from "../ascension";
import { AFFIX_DEFS, ESCALATION_ENEMIES_PER_LEVEL, HEIGHTENED_SENSES_KNEE, HEIGHTENED_SENSES_PER_LEVEL } from "../affixes";
import { ENEMY_RANKS, ENEMY_RANK_IDS } from "../enemyRanks";
import { OVERTIME_STEP_RATE } from "../processSpeed";
import { SHORT_RANGE_TEMPLATES, SHORT_RANGE_TEMPLATE_KEYS } from "../shortRange";
import { GAS_CANISTER_IDS, GAS_STUDY_USES, GIANT_CLASSES, NEBULA_KINDS, RESEARCH_FAMILIES, type GasCanisterId, type GasStudyUse } from "../gasGiantContent";
// Gas Giant Study GG-7: the special blueprints and the canisters' consumers.
import { PRESSURE_FORGED_PLATING_VARIETY, RAMSCOOP_COLLECTOR_MODULE, RESONANCE_SENSOR_ARRAY, SPECIAL_BLUEPRINT_KEYS, type SpecialBlueprintKey } from "../specialBlueprints";
// Gas Giant Study GG-5: the Research Lab's data study lane.
import { DATA_STUDY_RECIPE_PERMILLE, RESEARCH_BOOST_PER, isResearchDataItem } from "../dataStudy";
import { REACTOR_FUEL_LADDER, REACTOR_TECH_TIERS, REACTOR_VARIETY_TECH, reactorFuelRung } from "../reactorTech";
import { effectFieldsOf } from "./fieldRoles";
import { REPAIR_RATES, REPAIR_RATE_BONUSES, TOUGHNESS_REFERENCE, USE_WEAR_FLOOR, WEAR_EFFICIENCY, WEAR_SOURCES, wearEfficiency } from "../gearWear";
import {
  WEAR_DIVE_PROBE_ID,
  WEAR_FIXTURE_CONDITION,
  WEAR_REPAIR_MINUTES,
  battleFixture,
  repairPauseFixture,
  underRepairPauseLine,
  combatConsumerFixture,
  withFirstPieceDurability,
  withoutSlotPieces,
  diveFixture,
  fieldRepairHome,
  inShipyardBay,
  memberVarietyFor,
  onFieldRepairLeg,
  wearMemberOf,
  wearPieceIdFor,
  wearRepairMinutes,
  withFixtureCondition,
} from "./wearProbes";
import {
  CONDITION_LINES,
  CONDITION_LINE_IDS,
  FIELD_KITS,
  FIELD_KIT_BLUEPRINT,
  FIELD_KIT_IDS,
  FIELD_KIT_PRICES,
  FREE_BASIC_CURVE_KNEE,
  FREE_BASIC_SET,
  KIT_CATEGORY_RULES,
  FIELD_DEVICE_MIN_PERCENT,
  FIELD_DEVICE_SPAN_PERCENT,
  LURE_SALVAGE_PER_DIAL,
  type FieldKitDef,
  type FieldKitId,
  type KitCategory,
} from "../fieldKits";
import { GRENADES, GRENADE_IDS } from "../fieldKitsGrenades";
import { PROBE_SALVAGE_SCALE } from "../shipScanEvents";
import {
  WIRING_SCIENCE_ID,
  WIRING_SECURITY_ID,
  shortRangeTrainingCycle,
  bucketOf,
  combatBase,
  editCaptain,
  editMember,
  identity,
  installPiece,
  onMission,
  editShip,
  seatOfficer,
  wearPiece,
  wiringBase,
  withAwayTeam,
  withBuckets,
  withFacilityLevel,
  withHomeworld,
  withMuseum,
  withRunningJobs,
  overtimeOneStep,
  WIRING_BUCKET_COUNT,
  WIRING_SHIP_ID,
  AFFIX_ALIGNED_HOOKS,
  AFFIX_HOOK_KEYS,
  GAMBIT_ACTIONS,
  GAMBIT_SELECTORS,
  sourceOn,
  FIELD_KITS_SWITCH_PROBE_STOCK,
  FIELD_DEVICE_PROBE_BOUNDARIES,
  FIELD_DEVICE_PROBE_USES,
  SHORT_RANGE_RELIC_PROBE_HOURS,
  relicV2ProbeExpectedExceptional,
  RECALL_PROBE_SHARE,
  launchedAndAt,
  type ContextId,
  type ProbeId,
  type Transform,
} from "./probes";
import { relicStudyLanesAt } from "../relicIdentify";

// ============================================================================
// Types (plan section 3.2)
// ============================================================================

export type WiringSystem =
  | "captain"
  | "fleetAdmiral"
  | "facility"
  | "ship"
  | "crew"
  | "away"
  | "expedition"
  | "relic"
  | "mission"
  | "salvage"
  // Gear wear (0.14.0, design 2026-10-16 section 9): the wear sources, repair contexts and efficiency consumers.
  | "wear";

export const WIRING_SYSTEMS: readonly WiringSystem[] = ["captain", "fleetAdmiral", "facility", "ship", "crew", "away", "expedition", "relic", "mission", "salvage", "wear"];

export type WiringStatus =
  | { kind: "live" }
  // A 0.14.0 slice brings it live (the release gate blocks). `contexts`: for a PARTIAL source, the claimed contexts
  // that do not move yet (the entry's own `contexts` are the live ones); absent for a wholly inert source.
  | { kind: "pending"; owner: string; contexts?: readonly ContextId[] }
  // The user deferred it past 0.14.0 (capture 2026-10-15 section 3 T3 and the like).
  | { kind: "deferred"; owner: string; userRef: string; contexts?: readonly ContextId[] }
  | { kind: "held"; userRef: string } // D14 Craft Duplicate only
  // 0.14.0: a SEAM the user asked to be built now and called by a later patch (the tutorial time skip and the grant
  // hook: "Hook only", USER ANSWERS group 2 of the safe first runs plan). Tested in its own suite; not a placeholder
  // effect (it moves nothing on its own) and not a release blocker. `owner` = the patch that calls it.
  | { kind: "seam"; owner: string; userRef: string };

export type Curve =
  | { kind: "linearRelative" } // value(on) = value(off) x (1 + m)
  | { kind: "linearAbsolute" } // value(on) = value(off) + m
  | { kind: "divisor" } // durations: value(on) = value(off) / (1 + m)
  | { kind: "diminishing"; knee: number; base: number } // value = base + diminishing(x, knee); the source adds m to x
  | { kind: "chanceAbsolute" } // the probability fed to the roll rises by m
  | { kind: "gate" } // a refusal becomes an allowance (or a count rises by m)
  | { kind: "event"; metric: string } // a proc or outcome: direction only, with a minimum effect size m
  // WR-1 additions (the plan's list did not cover these shapes the code has):
  | { kind: "bonusRelative"; base: number } // an AMPLIFIER: the bonus part above `base` grows by (1 + m)
  | { kind: "equals" } // content data: the consumer reads the configured value verbatim, value(on) = m
  // A gear EFFECT whose size is linear in the piece's points through a per-point factor its module keeps private:
  // value(on) = value(off) + points x (value(unitOn) - value(off)), where unitOn wears the same piece at 1 point.
  | { kind: "perPoint"; points: number; unitOn: Transform }
  // The mass drag (model.ts shipDerivedStats): speed x 1 / (1 + drag x mass). The source takes m off a piece of
  // mass `massOff` (the ship's only mass): value(on) = value(off) x (1 + drag x massOff) / (1 + drag x (massOff - m)).
  | { kind: "massDrag"; drag: number; massOff: number };

export type Direction = "up" | "down" | "none";

// WR-1 review: how the sensitivity level checks that one claimed context does NOT move yet (a PARTIAL source's
// missing context, or a wholly inert source's claimed one). Each field defaults to the entry's own; an override
// reads the context's own consumer (probe) on a fixture that HAS the system the effect would act on (base), so the
// check is real: its control (flatControl below) must move the same probe on the same fixture.
export interface FlatCheck {
  readonly probe?: ProbeId;
  readonly base?: () => GameState;
  readonly on?: Transform;
  readonly off?: Transform;
}

export interface WiringEntry {
  readonly id: string; // "<system>:<catalog>:<key>" (the no-dead-stats ids keep their own prefixes)
  readonly system: WiringSystem;
  readonly source: { readonly catalog: string; readonly key: string }; // matches catalogs.ts
  readonly claim: string; // the player text (or the catalog's own description)
  readonly probe?: ProbeId; // absent only on a non-live entry with nothing to read yet
  readonly contexts: readonly ContextId[]; // the LIVE contexts (each one asserted)
  readonly outOfScope?: readonly { readonly context: ContextId; readonly reason: string; readonly userRef?: string }[];
  readonly direction: Direction;
  readonly curve: Curve;
  readonly magnitude: (cfg: Catalogs) => number; // from the catalog, never a literal
  readonly on: Transform;
  readonly off: Transform;
  readonly base: () => GameState; // the fixture the transforms apply to
  readonly tolerance?: number; // absolute; default is exact (1e-9 relative)
  readonly status: WiringStatus;
  readonly liveness?: true; // also an entry of the liveness level (no-dead-stats ids)
  // A catalog field that does not apply to this one def (a transport's loot fields): live, nothing to measure.
  readonly notApplicable?: string;
  readonly note?: string;
  // The checks of the claimed contexts that do not move yet (status.contexts), by context (see FlatCheck).
  readonly flatChecks?: Partial<Record<ContextId, FlatCheck>>;
  // An equals entry configured 0 proves its reader is not a constant 0 through a WITNESS: another live entry on the
  // same reader configured nonzero. Found automatically (same catalog, same field); named here when it is not.
  readonly witness?: string;
  // The no-dead-stats allow-list's reason for a liveness entry that is not live (kept verbatim at the move).
  readonly reason?: string;
}

// Every catalog a magnitude may read (the registry entries read their numbers through this, so the Debug panel can
// show the configured value beside the measured one).
export const CATALOGS = {
  SENIOR_STAFF_BONUSES,
  CREW_PROFESSION_BUFFS,
  SECOND_LEVEL_EXCLUSIVE,
  CREW_RACES,
  CREW_RARITY_MULTIPLIER,
  CAPTAIN_TALENTS,
  CAPTAIN_SPEC_BONUS,
  SECONDARY_CAPTAIN_TALENTS,
  HOMEWORLD_TALENTS,
  FACILITIES,
  EQUIPMENT_STORAGE_RUNGS,
  SHIP_DOCKS_RUNGS,
  TRANSIT_BERTH_RUNGS,
  SUBSPACE_TELESCOPE_LEVELS,
  SHIP_TYPES,
  EQUIPMENT_SLOTS,
  AWAY_TRAITS,
  GEAR_POINT_BUMP,
  // 0.14.0: the Quartermaster Standard-Issue member lines (their points and slot-role shares).
  STANDARD_ISSUE_MEMBER_POINTS,
  STANDARD_ISSUE_MEMBER_SHARES,
  GAMBIT_STATUSES,
  MISSIONS,
  PATROLS,
  QUARTERS_MODULES,
  BRIDGE_MODULES,
  SENSOR_ARRAYS,
  RELIC_SETS,
  RELICS,
  RELIC_TYPES,
  EXCEPTIONAL_SETS,
  // Relics v2 R2-4: each copy's value per tier above I (museum math v2).
  MUSEUM_V2_PER_COPY,
  WEAPON_DEFS,
  SLOT_BASE_PHYSICALS,
  ROLE_TEMPLATE,
  PIRATE_HULLS,
  STATUS_EFFECT_DEFS,
  REFINE_RECIPES,
  BLUEPRINTS,
  ITEMS,
  SALVAGE_LOOT_POOLS,
  POI_CATALOG,
  PLANET_TYPES,
  AFFIX_DEFS,
  ENEMY_RANKS,
  FIELD_KITS,
  KIT_CATEGORY_RULES,
  CONDITION_LINES,
  FREE_BASIC_SET,
  FIELD_KIT_PRICES,
  GRENADES,
  GRENADE_CARRY_PER_LINE,
  // G1-4: the short-range template catalog (its rolls, work and pay are live through the cycle engine).
  SHORT_RANGE_TEMPLATES,
  WEAR_SOURCES,
  REPAIR_RATES,
  REPAIR_RATE_BONUSES,
  // RARITY READINESS RR-3: the per-rarity rows (budget, affixes, secondaries, Artisan).
  RARITY_PROFILES,
  // RARITY READINESS RR-4: the ascension budget multipliers.
  ASCENSION_BUDGET_MULT,
  // RARITY READINESS RR-5: the Luminous legendary affixes.
  LUMINOUS_AFFIXES,
  // Review of RR-3 / RR-4: the module effect factor per band.
  MODULE_RARITY_FACTOR,
  // RARITY READINESS RR-6: the gear sets.
  GEAR_SETS,
  // E-MOD EM-7: the v1 universal modules.
  UNIVERSAL_MODULES,
  WEAR_EFFICIENCY,
  // The reactor fuel ladder (0.14.0, reactorTech.ts): the fuel each Reactor Core blueprint takes.
  REACTOR_FUEL_LADDER,
  // Gas Giant Study GG-2 / GG-3: the giant classes the class roll and the study reward read.
  GIANT_CLASSES,
  // Relics v2 R2-10: the minigame's relic boost table (its audit rows read A and the knee here).
  RELIC_BOOSTS,
} as const;
export type Catalogs = typeof CATALOGS;

// ============================================================================
// The curve math
// ============================================================================

// The inverse of diminishing(x, k) = 2x / (sqrt(1 + 2x/k) + 1): x = y + y^2 / (2k).
export function invDiminishing(y: number, knee: number): number {
  return y + (y * y) / (2 * knee);
}

// The value a source of magnitude m should produce through `curve`, from the value without it. null for an event
// curve (direction and minimum effect size only). `unit` is the perPoint curve's one-point reading.
export function curveExpected(curve: Curve, off: number, m: number, unit?: number): number | null {
  switch (curve.kind) {
    case "linearRelative":
      return off * (1 + m);
    case "linearAbsolute":
    case "chanceAbsolute":
    case "gate":
      return off + m;
    case "divisor":
      return off / (1 + m);
    case "diminishing":
      return curve.base + diminishing(invDiminishing(off - curve.base, curve.knee) + m, curve.knee);
    case "bonusRelative":
      return curve.base + (off - curve.base) * (1 + m);
    case "equals":
      return m;
    case "massDrag":
      return (off * (1 + curve.drag * curve.massOff)) / (1 + curve.drag * (curve.massOff - m));
    case "perPoint":
      return unit === undefined ? null : off + curve.points * (unit - off);
    case "event":
      return null;
  }
}

// ============================================================================
// Builders
// ============================================================================

interface EntryInput extends Partial<Omit<WiringEntry, "id" | "system" | "source" | "claim">> {
  id: string;
  system: WiringSystem;
  source: { catalog: string; key: string };
  claim: string;
}

const LIVE: WiringStatus = { kind: "live" };

function entry(e: EntryInput): WiringEntry {
  return {
    contexts: [],
    direction: "up",
    curve: { kind: "linearAbsolute" },
    magnitude: () => 0,
    on: identity,
    off: identity,
    base: () => wiringBase(),
    status: LIVE,
    ...e,
  };
}

function pending(owner: string, contexts?: readonly ContextId[]): WiringStatus {
  return contexts ? { kind: "pending", owner, contexts } : { kind: "pending", owner };
}

// The phase strings no-dead-stats used (kept verbatim: the liveness level reads them as owners).
// The slice that owns the four Ground Ops complement consumers still pending (complement plan
// docs/plans/2026-10-14-complement-and-acquisition-plan.md section 3 CP-3). The old owner, "E-CREW Task 23 (division
// pools + exclusive pool live, design 6.2)", was split into CP-1 to CP-4; CP-2 and the inert-racials slice (0.14.0,
// user "everything wired" 2026-10-20) took the rest live. Exported for the liveness parity test (the renamed owner).
export const CP_3 = "Complement plan CP-3 (Ground Ops complement consumers: Security, Medical, exclusive pool)";
// Expedition Tiers G2-6 (the dispatch console's region picker and recall): the tier-gated sources G2-2 to G2-5 left to
// it (owners "G2-6 (the region picker ...)" and "G2-6 (the recall button ...)") are live, each with its own check
// (auditRowWiring below; expeditionConsoleRegistry.fixture.ts G2_6_FLIPPED_BEFORE holds the flips apart in the pins).
const PILOT_CUNNING = "pending user decision (officerStats.ts CUNNING_PENDING_SEATS)";
// Gear wear (0.14.0, design docs/plans/2026-10-16-gear-wear-design.md section 11) owners: step 3 wires the use wear
// sources, the repair contexts and the economy / ground efficiency; step 4 the combat half (battle wear, the
// true-condition pools, shield / plating / pod efficiency); step 5 the UI and the optional paid repair. Each step
// flips its entries live in the same commit. Step 4 flipped every entry it owned (the battle sources, the combat
// consumers, the Damage Control Suite's fires and lines, the defense and pod toughness rows); the Reactor Core's power
// output consumer is re-owned to the user's EM-4 open call (item 4, the drive lift reads it pristine as built).
const GEAR_WEAR_STEP_3 = "gear wear step 3 (use wear sources, repair contexts and settling at events)";
const EM4_WORN_OUTPUT_CALL = "the user's EM-4 open call (review item 4, material lines plan): the drive lift reads the Reactor Core's PRISTINE output as built ((a) keep pristine; (b) read the worn output); in combat the core's wear acts through its true-condition pool (wear:WEAR_SOURCES:reactorCore:hitsTaken), never a second penalty (user W3)";
const GEAR_WEAR_STEP_5 = "gear wear step 5 (UI: condition bars, the care line, Quick gear repair and Overtime for credits)";
// The user's T3 deferrals (capture 2026-10-15 section 3: "Move all five (Recommended)").
const T3 = "capture 2026-10-15 section 3 T3 (moved to 0.14.x)";
// G1-4: the guest quarters sources and the short-range template catalog are LIVE at mission:shortRange (the cycle
// engine, shortRangeCycle.ts): see the guest quarters entries, missionEntries and SHORT_RANGE_SWEEP below.

// Prospecting squads (0.14.0, built HIDDEN; design docs/plans/2026-10-16-prospecting-squads-design.md section 8):
// every Prospecting source is deferred to the prospecting quests patch, the user-approved exception to "no
// placeholders" (user group 4, 2026-10-16: "It's building in the foundation for them as is, rather than building
// them in after the fact"). A deferred entry moves no probe and does not block the release gate; the
// completeness test still enumerates each one, so nothing Prospecting can hide unregistered.
const PROSPECTING_DEFERRED: WiringStatus = {
  kind: "deferred",
  owner: "prospecting quests patch",
  userRef: "safe-first-runs plan, user answers group 4 (2026-10-16): build Prospecting fully but hidden",
};

// ============================================================================
// crew: officer bonuses, complement buffs, racials, facets (the no-dead-stats ids)
// ============================================================================

const SEATS = Object.keys(DEPARTMENT_OF_SEAT) as SeniorStaffSeat[];

function seatFor(def: SeniorStaffBonusDef): SeniorStaffSeat {
  return def.seat === "any" ? "executive" : def.seat;
}

// E-MOD EM-1: power efficiency (Reactor Overdrive, Power Discipline, the Martian racial) cuts the ship's NET power draw,
// draw / (1 + diminishing(e, knee)) rounded up to a whole point. Read on a ship carrying a large powered piece, so the
// whole-point rounding is a small share of the move (tolerance: one point).
const POWERED_PIECE_DRAW = 1000;
const poweredBase = (): GameState => installPiece(wiringBase(), { slotType: "cargoBay", powerDraw: POWERED_PIECE_DRAW });
const POWER_EFFICIENCY_SEAM = {
  probe: "sheetPowerDraw" as ProbeId,
  contexts: ["sheet"] as ContextId[],
  curve: { kind: "divisor" } as Curve,
  direction: "down" as const,
  tolerance: 1,
  base: poweredBase,
  effect: (m: number) => diminishing(m, POWER_EFFICIENCY_KNEE),
};

// What each officer statKey moves (probe, contexts, curve). Absent = pending (OFFICER_PENDING below). E-MOD EM-1: an
// optional fixture, direction, tolerance and the move the catalog magnitude makes through the consumer's curve.
interface OfficerSeam {
  probe: ProbeId;
  contexts: ContextId[];
  curve: Curve;
  direction?: "up" | "down";
  tolerance?: number;
  base?: () => GameState;
  effect?: (m: number) => number;
}
const OFFICER_SEAMS: Readonly<Record<string, OfficerSeam>> = {
  "officer.powerEfficiencyMult": POWER_EFFICIENCY_SEAM,
  "officer.shipOutputMult": { probe: "missionOutputBonus", contexts: ["mission:extraction"], curve: { kind: "linearAbsolute" } },
  "officer.transitTimeCut": { probe: "sheetTransit", contexts: ["sheet", "expedition:groundOps"], curve: { kind: "linearRelative" } },
  "officer.evasion": { probe: "officerEvasion", contexts: ["patrol", "expedition:groundOps"], curve: { kind: "linearAbsolute" } },
  "officer.unloadTimeCut": { probe: "sheetUnload", contexts: ["sheet", "expedition:groundOps"], curve: { kind: "linearRelative" } },
  "officer.effectiveCargoMult": { probe: "sheetCargo", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  "officer.extractionYieldMult": { probe: "sheetYield", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  "officer.rareFindMult": { probe: "rareFind", contexts: ["expedition:groundOps", "mission:survey"], curve: { kind: "linearAbsolute" } },
  "officer.weaponEffectivenessMult": { probe: "officerWeapons", contexts: ["patrol"], curve: { kind: "linearAbsolute" } },
  "officer.shieldEffectivenessMult": { probe: "officerShields", contexts: ["patrol"], curve: { kind: "linearAbsolute" } },
  "officer.crewLossPrevention": { probe: "expSquadTriage", contexts: ["ground"], curve: { kind: "linearAbsolute" } },
  // Field Kits FKR-4: Morale Anchor's Fear resist, now that a Field Kits run's Swarm and hostile garrisons inflict Fear.
  "officer.crewRetention": { probe: "runSecFearResist", contexts: ["ground"], curve: { kind: "chanceAbsolute" } },
  "officer.repairRateMult": { probe: "officerRepairBonus", contexts: ["shipyard", "medbay"], curve: { kind: "linearAbsolute" } },
  "officer.rangeMult": { probe: "sheetEngineEff", contexts: ["sheet"], curve: { kind: "linearAbsolute" } },
  "officer.allStatsMult": { probe: "sheetCargo", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  "officer.missionTurnaroundCut": { probe: "turnaround", contexts: ["sheet", "shipyard"], curve: { kind: "linearRelative" } },
};

const OFFICER_PENDING: Readonly<Record<string, string>> = {
  ...OFFICER_BONUSES_PENDING_IN_RELEASE,
};

function officerEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  for (const def of SENIOR_STAFF_BONUSES) {
    const seat = seatFor(def);
    const seam = OFFICER_SEAMS[def.statKey];
    const owner = OFFICER_PENDING[def.statKey];
    out.push(
      entry({
        id: `officer:${def.statKey}`,
        system: "crew",
        source: { catalog: "SENIOR_STAFF_BONUSES", key: def.id },
        claim: `${def.label}: ${def.description}`,
        liveness: true,
        probe: seam?.probe,
        contexts: owner ? [] : seam?.contexts ?? [],
        curve: seam?.curve ?? { kind: "linearAbsolute" },
        ...(seam?.direction ? { direction: seam.direction } : {}),
        ...(seam?.tolerance !== undefined ? { tolerance: seam.tolerance } : {}),
        magnitude: (c) => (seam?.effect ?? ((m: number) => m))(c.SENIOR_STAFF_BONUSES.find((d) => d.id === def.id)!.magnitude),
        on: (s) => seatOfficer(s, seat, [def.id]),
        off: (s) => seatOfficer(s, seat, []),
        base:
          seam?.base ??
          (def.statKey.startsWith("officer.weapon") || def.statKey.startsWith("officer.shield") ? () => combatBase() : () => wiringBase()),
        status: owner ? pending(owner) : LIVE,
      }),
    );
  }
  // Inspiring Leader's combat half (its sheet half is the entry above): one more context on its own id.
  return out;
}

// What each crew.* key moves when a complement carries it. Absent = no consumer (pending, below).
interface CrewSeam {
  probe: ProbeId;
  contexts: ContextId[];
  curve: Curve;
  tolerance?: number;
  // CP-2: a fixture the key needs to show on (Crew Effectiveness lifts OTHER buffs, so its fixture carries one), the
  // complement the source's bucket joins (default: the source's bucket alone), and the move the source's catalog
  // magnitude makes through the consumer's curve (default: the magnitude itself).
  base?: () => GameState;
  alongside?: readonly CrewBucket[];
  effect?: (m: number) => number;
  direction?: "up" | "down"; // E-MOD EM-1: power efficiency moves the draw DOWN
}

// CP-2 (OC-3): Crew Effectiveness lifts every OTHER complement buff, read on a fixture carrying one (Efficient
// Unloading, a Spacer bucket, whose race lifts nothing): the unload bonus above 1 grows by diminishing(e, knee).
const LIFTED_BUCKET = bucketOf("operations", "ops.unloadSpeed");
const EFFECTIVENESS_SEAM: CrewSeam = {
  probe: "sheetUnload",
  contexts: ["sheet"],
  curve: { kind: "bonusRelative", base: 1 },
  base: () => withBuckets(wiringBase(), [LIFTED_BUCKET]),
  alongside: [LIFTED_BUCKET],
  effect: (e) => diminishing(e, CREW_EFFECTIVENESS_KNEE),
};

const CREW_SEAMS: Readonly<Record<string, CrewSeam>> = {
  [CREW_STAT_KEYS.unloadSpeed]: { probe: "sheetUnload", contexts: ["sheet", "expedition:groundOps"], curve: { kind: "linearRelative" } },
  [CREW_STAT_KEYS.loadSpeed]: { probe: "expReloadMult", contexts: ["expedition:groundOps"], curve: { kind: "linearAbsolute" } },
  [CREW_STAT_KEYS.effectiveCargo]: { probe: "sheetCargo", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  // CP-2 (OC-E5): each transit buff lifts its own leg.
  [CREW_STAT_KEYS.transitOutSpeed]: { probe: "sheetOutLeg", contexts: ["sheet", "expedition:groundOps"], curve: { kind: "linearRelative" } },
  [CREW_STAT_KEYS.transitBackSpeed]: { probe: "sheetBackLeg", contexts: ["sheet", "expedition:groundOps"], curve: { kind: "linearRelative" } },
  // CP-2: Damage Control joins the repair divisor (Shipyard, and the field repair frozen at dispatch).
  [CREW_STAT_KEYS.hullRepairRate]: { probe: "turnaround", contexts: ["shipyard", "shipEvent"], curve: { kind: "linearRelative" } },
  // CP-2: Mission Turnaround: the unload x (1 + t) and the same repair divisor (Veteran Instincts' shape, own key).
  [CREW_STAT_KEYS.missionTurnaround]: { probe: "turnaround", contexts: ["sheet", "shipyard", "shipEvent"], curve: { kind: "linearRelative" } },
  // CP-2 (OC-E3): Crew Output Multiplier joins the mission output share (mission deliveries and patrol wave loot).
  [CREW_STAT_KEYS.crewOutputMult]: { probe: "missionOutputBonus", contexts: ["mission:extraction", "patrol"], curve: { kind: "linearAbsolute" } },
  [CREW_STAT_KEYS.crewEffectiveness]: EFFECTIVENESS_SEAM,
  [CREW_STAT_KEYS.rangeEfficiency]: { probe: "sheetEngineEff", contexts: ["sheet"], curve: { kind: "linearAbsolute" } },
  [CREW_STAT_KEYS.boardingDefense]: { probe: "expBoardingDefense", contexts: ["shipEvent"], curve: { kind: "linearAbsolute" } },
  [CREW_STAT_KEYS.extractionYield]: { probe: "sheetYield", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  [CREW_STAT_KEYS.rareFindChance]: { probe: "rareFind", contexts: ["expedition:groundOps", "mission:survey"], curve: { kind: "linearAbsolute" } },
  [CREW_STAT_KEYS.reducedCrewLosses]: { probe: "injuryCare", contexts: ["medbay"], curve: { kind: "linearAbsolute" } },
  [CREW_STAT_KEYS.fuelEfficiency]: { probe: "sheetEngineEff", contexts: ["sheet"], curve: { kind: "linearAbsolute" } },
  // E-MOD EM-1 (P4): Power Discipline and the Martian racial cut the net power draw (POWER_EFFICIENCY_SEAM).
  [CREW_STAT_KEYS.powerEfficiency]: POWER_EFFICIENCY_SEAM,
  // The inert racials go live (0.14.0, user "everything wired" 2026-10-20). Deck Handling + the Belter racial (CP-4,
  // OC-1 "Faster drone replenish"): the patrol cycle's between-wave replenish x (1 + it), banked in whole units so any
  // amount acts, read through the consumer over a long recovery (within one banked unit), on a carrier with drones.
  [CREW_STAT_KEYS.droneHandling]: { probe: "patrolReplenishShare", contexts: ["patrol"], curve: { kind: "linearAbsolute" }, tolerance: 1e-5, base: () => combatBase("carrier") },
  // Survey Aptitude + the Vael and Outer-Colony racials (CP-3's racial piece, OC-4 "Faster scans"): the dispatch's
  // scanSpeedBonus, so the scan rate x (1 + it) on a run that carries no other scan bonus.
  [CREW_STAT_KEYS.surveyAptitude]: { probe: "expScanRate", contexts: ["expedition:groundOps"], curve: { kind: "linearRelative" } },
  // The Spacer racial (user 2026-10-20 "+Transit speed"): the sweeping transit speed key, read exactly as the Pilot's
  // Ace Navigator (the sheet and the voyage's frozen speed). No crew buff targets it, so only the racial reads this.
  [TRANSIT_SPEED_KEY]: { probe: "sheetTransit", contexts: ["sheet", "expedition:groundOps"], curve: { kind: "linearRelative" } },
};

// The claimed consumer of each dead crew.* key, read so a pending key that starts moving fails until it is flipped:
// the probe, the claimed context, and a fixture that HAS the system the key would act on (WR-1 review: an away team
// for the squad keys, a medic for Triage, a carrier with drones for Deck Handling), so the flat check is real.
interface DeadKeySeam {
  probe: ProbeId;
  context: ContextId;
  base?: () => GameState;
}
const withMedic: Transform = (s) => editMember(s, WIRING_SECURITY_ID, { traits: ["fieldMedic"] });
const CREW_PENDING_PROBES: Readonly<Record<string, DeadKeySeam>> = {
  [CREW_STAT_KEYS.awayTeamProtection]: { probe: "runSecHp", context: "ground", base: () => withAwayTeam(wiringBase()) },
  [CREW_STAT_KEYS.triage]: { probe: "runSecHeal", context: "ground", base: () => withMedic(withAwayTeam(wiringBase())) },
  [CREW_STAT_KEYS.preventCrewLoss]: { probe: "injuryCare", context: "medbay" },
};

const CREW_PENDING: Readonly<Record<string, string>> = {
  [CREW_STAT_KEYS.counterInfiltration]: CP_3,
  [CREW_STAT_KEYS.awayTeamProtection]: CP_3,
  [CREW_STAT_KEYS.triage]: CP_3,
  [CREW_STAT_KEYS.preventCrewLoss]: CP_3,
};

const PROFESSION_OF_BUFF = new Map<string, CrewProfession>(
  (Object.entries(CREW_PROFESSION_BUFFS) as [CrewProfession, CrewBuffDef[]][]).flatMap(([p, defs]) => defs.map((d) => [d.id, p] as const)),
);

function crewEntries(): WiringEntry[] {
  const all = [...Object.values(CREW_PROFESSION_BUFFS).flat(), ...SECOND_LEVEL_EXCLUSIVE];
  return all.map((def) => {
    const profession = PROFESSION_OF_BUFF.get(def.id) ?? "operations";
    const held = HELD_CREW_BUFF_IDS.has(def.id);
    const owner = CREW_PENDING[def.statKey];
    const seam = CREW_SEAMS[def.statKey];
    const dead = owner ? CREW_PENDING_PROBES[def.statKey] : undefined;
    const probe = owner ? dead?.probe : seam?.probe;
    return entry({
      id: `crew:${def.statKey}`,
      system: "crew",
      source: { catalog: held || !PROFESSION_OF_BUFF.has(def.id) ? "SECOND_LEVEL_EXCLUSIVE" : "CREW_PROFESSION_BUFFS", key: def.id },
      claim: def.label,
      ...(held ? {} : { liveness: true as const }),
      probe: held ? undefined : probe,
      contexts: held || owner ? [] : seam?.contexts ?? [],
      curve: seam?.curve ?? { kind: "linearAbsolute" },
      ...(seam?.direction && !owner ? { direction: seam.direction } : {}),
      // One standard Crewman per head: the buff's catalog magnitude x the bucket's head count (through the
      // consumer's curve where the seam names one, CP-2).
      magnitude: () => (seam?.effect ?? ((m: number) => m))(def.magnitude * WIRING_BUCKET_COUNT),
      on: (s) => withBuckets(s, [...(seam?.alongside ?? []), bucketOf(profession, def.id)]),
      off: (s) => withBuckets(s, [...(seam?.alongside ?? []), bucketOf(profession, "wiring.none")]),
      ...(dead?.base ? { base: dead.base } : seam?.base && !owner ? { base: seam.base } : {}),
      ...(seam?.tolerance !== undefined ? { tolerance: seam.tolerance } : {}),
      status: held
        ? { kind: "held", userRef: "D14 (design 2026-10-02): Craft Duplicate is held for homeworld staffing" }
        : owner
          ? pending(owner, dead ? [dead.context] : undefined)
          : LIVE,
    });
  });
}

// Every racial is live (0.14.0, user "everything wired" 2026-10-20): Belter through Deck Handling's replenish (CP-4,
// OC-1), Vael and Outer-Colony through Survey Aptitude's scan speed (CP-3's racial piece, OC-4), and the Spacer on the
// sweeping transit speed (merge-batch answers 2026-10-20 "+Transit speed"). The Spacer long-haul ramp itself
// (crew.endurance, D26) stays 0.14.x (T3); no source targets that key in 0.14.0, so it has no entry.
const RACIAL_PENDING: Readonly<Partial<Record<CrewRace, WiringStatus>>> = {};

function racialEntries(): WiringEntry[] {
  return (Object.keys(CREW_RACES) as CrewRace[]).map((race) => {
    const rb = CREW_RACES[race].racialBonus;
    const status = RACIAL_PENDING[race] ?? LIVE;
    const seam = CREW_SEAMS[rb.statKey];
    const dead = status.kind === "live" ? undefined : CREW_PENDING_PROBES[rb.statKey];
    const probe = status.kind === "live" ? seam?.probe : dead?.probe;
    const claimed = dead && status.kind === "pending" ? pending(status.owner, [dead.context]) : dead && status.kind === "deferred" ? { ...status, contexts: [dead.context] } : status;
    return entry({
      id: `racial:${race}`,
      system: "crew",
      source: { catalog: "CREW_RACES", key: race },
      claim: `${CREW_RACES[race].label} racial (${rb.statKey})`,
      liveness: true,
      probe,
      contexts: status.kind === "live" ? seam?.contexts ?? [] : [],
      curve: seam?.curve ?? { kind: "linearAbsolute" },
      ...(seam?.direction && status.kind === "live" ? { direction: seam.direction } : {}),
      ...(seam?.tolerance !== undefined && status.kind === "live" ? { tolerance: seam.tolerance } : {}),
      magnitude: (c) => (seam?.effect ?? ((m: number) => m))(c.CREW_RACES[race].racialBonus.seniorStaff),
      on: (s) => seatOfficer(s, "executive", [], { race }),
      off: identity,
      ...(dead?.base ? { base: dead.base } : seam?.base && status.kind === "live" ? { base: seam.base } : {}),
      status: claimed,
    });
  });
}

const FACET_HIGH = 20; // the top of the officer stat roll (OFFICER_STAT_ROLL_MAX), a real value

function facetEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  const neutral: OfficerStats = { strength: OFFICER_STAT_NEUTRAL, integrity: OFFICER_STAT_NEUTRAL, cunning: OFFICER_STAT_NEUTRAL, constitution: OFFICER_STAT_NEUTRAL };
  for (const seat of SEATS) {
    for (const stat of OFFICER_STAT_KEYS) {
      const dept = DEPARTMENT_OF_SEAT[seat];
      const pendingOwner = seat === "pilot" && stat === "cunning" ? PILOT_CUNNING : undefined;
      // The XO's facet reaches every department at XO_DEPARTMENT_SHARE (read here on Operations).
      const probe: ProbeId = dept === "all" ? `facet:operations:${stat}` : `facet:${dept}:${stat}`;
      out.push(
        entry({
          id: `facet:${seat}:${stat}`,
          system: "crew",
          source: { catalog: "OFFICER_STAT_FACETS", key: `${seat}:${stat}` },
          claim: `${seat} ${stat} (department: ${dept})`,
          liveness: true,
          probe: pendingOwner ? undefined : probe,
          contexts: pendingOwner ? [] : ["sheet"],
          magnitude: () => officerStatFacet(FACET_HIGH) * (dept === "all" ? XO_DEPARTMENT_SHARE : 1),
          on: (s) => seatOfficer(s, seat, [], { stats: { ...neutral, [stat]: FACET_HIGH } }),
          off: (s) => seatOfficer(s, seat, [], { stats: neutral }),
          status: pendingOwner ? pending(pendingOwner) : LIVE,
          note: "the facet each consumer reads; the liveness level proves the consumers move",
        }),
      );
    }
  }
  return out;
}

// ============================================================================
// away: member gear lines (the no-dead-stats ids), traits, ground effects, statuses
// ============================================================================

export const GEAR_TEST_POINTS = 20; // an iLevel 10 standard piece's budget (awayTeam.ts reference point)

// The rollable ground lines of a member variety (the variety's own pools, else the slot's).
export function memberRollableKeys(slotType: MemberSlotType, variety: { implicitStats?: string[]; affixPool?: { stat: string }[] }): Set<string> {
  const slot = EQUIPMENT_SLOTS[slotType];
  return new Set([...(variety.implicitStats ?? slot.implicitStats), ...(variety.affixPool ?? slot.affixPool).map((a) => a.stat)]);
}

// A member gear line still waiting on a named owner, by entry id. Empty since the D26 line swap (user 2026-10-21 "Give
// them Science lines"): the Sidearm, Field Suit and Hazard Suit no longer roll the combat lines that never acted for
// Science, so the seven SCIENCE_LINE_SWAP entries are gone and their Science lines are live.
const GEAR_PENDING: Readonly<Record<string, string>> = {};

function wearerOf(team: AwayTeamType): string {
  return team === "science" ? WIRING_SCIENCE_ID : WIRING_SECURITY_ID;
}

// The seam a member line moves, by squad and key.
// `points` (0.14.0): the line's points as the catalog reads them (the Standard-Issue entries pass their own line's
// value); absent, the GEAR_TEST_POINTS test piece.
function gearSeam(
  team: AwayTeamType,
  key: MemberGroundStatKey,
  points: (c: Catalogs) => number = () => GEAR_TEST_POINTS,
): { probe: ProbeId; curve: Curve; magnitude: (c: Catalogs) => number; context: ContextId; tolerance?: number } | null {
  const bump = (c: Catalogs, k: MemberGroundStatKey) => points(c) * c.GEAR_POINT_BUMP[GROUND_STAT_MEMBER_STAT[k]!];
  if (team === "security") {
    switch (key) {
      case "groundHp":
        return { probe: "secHp", curve: { kind: "linearRelative" }, magnitude: (c) => bump(c, key), context: "ground", tolerance: 1 };
      case "groundPower":
        return { probe: "secPower", curve: { kind: "linearRelative" }, magnitude: (c) => bump(c, key), context: "ground" };
      case "groundArmor":
        return { probe: "secArmor", curve: { kind: "linearRelative" }, magnitude: (c) => bump(c, key), context: "ground" };
      case "groundAccuracy":
        return { probe: "secAccuracy", curve: { kind: "linearRelative" }, magnitude: (c) => bump(c, key), context: "ground" };
      case "groundStatusChance":
        return { probe: "secInflictPermille", curve: { kind: "chanceAbsolute" }, magnitude: (c) => bump(c, key) * 1000, context: "ground", tolerance: 1 };
      case "groundStatusResist":
        return { probe: "secPoisonResist", curve: { kind: "chanceAbsolute" }, magnitude: (c) => points(c) * STATUS_RESIST_PER_POINT * 1000, context: "ground", tolerance: 1 };
      case "groundHazardResist":
        return { probe: "secTaskHazardResist", curve: { kind: "linearAbsolute" }, magnitude: (c) => bump(c, key), context: "fieldwork" };
      // Field Kits FKR-5 (FK11 "+1 carry capacity"): one more grenade charge per objective, read on a Field Kits
      // objective fight's armed squad (the count, whatever the line's value).
      case "groundCarryCapacity":
        return { probe: "runSecGrenadeCharges", curve: { kind: "gate" }, magnitude: (c) => c.GRENADE_CARRY_PER_LINE, context: "ground" };
      default:
        return null;
    }
  }
  if (team === "science") {
    switch (key) {
      case "groundFieldwork":
        return {
          probe: "fieldSpeed",
          curve: { kind: "diminishing", knee: FIELDWORK_SPEED_KNEE, base: 1 },
          magnitude: (c) => FIELDWORK_SPEED_PER_BUMP * bump(c, key),
          context: "fieldwork",
        };
      case "groundRelicFind":
        return { probe: "fieldRelicFind", curve: { kind: "linearAbsolute" }, magnitude: (c) => bump(c, key), context: "fieldwork" };
      case "groundHazardResist":
        return { probe: "fieldHazardResist", curve: { kind: "linearAbsolute" }, magnitude: (c) => bump(c, key), context: "fieldwork" };
      case "groundOrganicsYield":
        return { probe: "fieldYieldOrganics", curve: { kind: "diminishing", knee: FIELDWORK_YIELD_KNEE, base: 1 }, magnitude: (c) => points(c) * FIELDWORK_YIELD_PER_POINT, context: "fieldwork" };
      case "groundVaultYield":
        return { probe: "fieldYieldVault", curve: { kind: "diminishing", knee: FIELDWORK_YIELD_KNEE, base: 1 }, magnitude: (c) => points(c) * FIELDWORK_YIELD_PER_POINT, context: "fieldwork" };
      case "groundHp":
      case "groundPower":
      case "groundArmor":
      case "groundAccuracy":
      case "groundStatusChance":
        // Science never fights (D2): the battle roster takes Security only, so this reads 0 (pending).
        return { probe: "sciCombatPower", curve: { kind: "linearAbsolute" }, magnitude: () => 0, context: "ground" };
      default:
        return null;
    }
  }
  return null;
}

// A MEMBER-WIDE status-chance line pays out only through an inflict piece the member wears: a piece that inflicts
// nothing of its own is measured with a bare Stun Grenade worn beside it (no-dead-stats MEMBER_WIDE_PAIRING).
function inflicts(slotType: MemberSlotType, varietyKey: string): boolean {
  const v = EQUIPMENT_SLOTS[slotType].varieties.find((x) => x.key === varietyKey);
  return v?.member?.groundEffect?.kind === "inflict";
}

function gearEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  for (const slotType of MEMBER_SLOT_TYPES) {
    for (const v of EQUIPMENT_SLOTS[slotType].varieties) {
      if (!v.member) continue;
      const rollable = memberRollableKeys(slotType, v);
      for (const team of v.member.teamTypes) {
        for (const key of MEMBER_GROUND_STAT_KEYS) {
          if (!rollable.has(key)) continue;
          const id = `gear:${team}:${v.key}:${key}`;
          if (team === "prospecting") {
            // Hidden with the squad: no Prospecting member deploys anywhere in 0.14.0, so nothing reads the line yet.
            out.push(
              entry({
                id,
                system: "away",
                source: { catalog: "EQUIPMENT_SLOTS.member", key: `${slotType}:${v.key}:${team}:${key}` },
                claim: `${v.label} (${slotType}) ${key} on ${team}`,
                liveness: true,
                status: PROSPECTING_DEFERRED,
                reason: "hidden with the Prospecting squad until the prospecting quests patch: no Prospecting member deploys in 0.14.0",
                // User ruling 2026-10-19 ("Give ARM/HP a dig meaning"): on a Prospecting wearer Armor and HP feed the
                // dig-safety value the quests patch's cave-in and retreat injury rolls consume.
                ...(key === "groundArmor" || key === "groundHp"
                  ? { note: "reads into prospecting.ts prospectingCrewStats digSafety (cave-in and retreat injury cut, D23 curve); consumed by the quests patch's injury rolls" }
                  : {}),
              }),
            );
            continue;
          }
          const owner = GEAR_PENDING[id];
          const baseSeam = gearSeam(team, key);
          // Field Kits FKR-4 (user FK6): Cortex Shield's resist covers stun and fear, and its stun half covers Concussion,
          // which a Field Kits run's Bruisers inflict: measured on the combatant's Concussion resist roll.
          const cortex = v.key === "cortexShield" && key === "groundStatusResist" && baseSeam !== null;
          const seam = cortex ? { ...baseSeam!, probe: "secConcussionResist" as ProbeId } : baseSeam;
          const wearer = wearerOf(team);
          const pair = key === "groundStatusChance" && team === "security" && !inflicts(slotType, v.key) && slotType !== "memberTool";
          const withPair: Transform = pair ? (s) => wearPiece(s, wearer, "memberTool", "stunGrenade", {}) : identity;
          // groundStatusResist only acts on the statuses a resistStatus piece lists: measured on Toxin Filters (poison)
          // and on Cortex Shield (Concussion, through its stun resist).
          const resistOk = key !== "groundStatusResist" || v.key === "toxinFilters" || cortex;
          const live = !owner && seam !== null && resistOk;
          out.push(
            entry({
              id,
              system: "away",
              source: { catalog: "EQUIPMENT_SLOTS.member", key: `${slotType}:${v.key}:${team}:${key}` },
              claim: `${v.label} (${slotType}) ${key} on ${team}`,
              liveness: true,
              probe: seam?.probe,
              contexts: live ? [seam!.context] : [],
              curve: seam?.curve ?? { kind: "linearAbsolute" },
              magnitude: seam?.magnitude ?? (() => 0),
              tolerance: seam?.tolerance,
              base: () => withAwayTeam(wiringBase()),
              on: (s) => withPair(wearPiece(s, wearer, slotType, v.key, { [key]: GEAR_TEST_POINTS })),
              off: (s) => withPair(wearPiece(s, wearer, slotType, v.key, {})),
              status: owner
                ? pending(owner)
                : live
                  ? LIVE
                  : pending("WR-1 follow-up: no seam probe for this squad and line"),
            }),
          );
        }
      }
    }
  }
  return out;
}

// 0.14.0: the Quartermaster Standard-Issue member lines (model.ts STANDARD_ISSUE_MEMBER_SHARES). Each line of each
// issued variety is measured on the REAL issued piece (generateStandardIssue) worn by the squad's member: ON keeps only
// that line as issued, OFF is the piece as a pre-change build issued it (every line 0), so the entry reads the line's
// own catalog points through the same seam its crafted twin moves (gearSeam). Prospecting's rows are deferred with the
// squad, like their crafted lines.
function wearStandardIssue(s: GameState, memberId: string, slotType: MemberSlotType, varietyKey: string, keep: string | null): GameState {
  const minted = generateStandardIssue({ slotType, varietyKey, fittedToShipId: null, allocateId: () => `wiring-si-${memberId}-${slotType}` });
  const implicitStats = Object.fromEntries(Object.entries(minted.implicitStats).map(([k, v]) => [k, k === keep ? v : 0]));
  const piece = { ...minted, implicitStats, fittedToMemberId: memberId };
  return { ...s, equipment: [...s.equipment.filter((e) => e.id !== piece.id), piece] };
}

function standardIssueEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  for (const slotType of MEMBER_SLOT_TYPES) {
    for (const v of EQUIPMENT_SLOTS[slotType].varieties) {
      const shares = STANDARD_ISSUE_MEMBER_SHARES[v.key];
      if (!v.member || shares === undefined) continue;
      for (const team of v.member.teamTypes) {
        for (const stat of Object.keys(shares) as MemberGroundStatKey[]) {
          const id = `si:${team}:${v.key}:${stat}`;
          const source = { catalog: "STANDARD_ISSUE_MEMBER_SHARES", key: `${slotType}:${v.key}:${team}:${stat}` };
          const claim = `Standard-Issue ${v.label} (${slotType}) ${stat} on ${team}`;
          if (team === "prospecting") {
            out.push(
              entry({
                id,
                system: "away",
                source,
                claim,
                status: PROSPECTING_DEFERRED,
                reason: "hidden with the Prospecting squad until the prospecting quests patch: no Prospecting member deploys in 0.14.0",
              }),
            );
            continue;
          }
          const points = (c: Catalogs) => Math.round(c.STANDARD_ISSUE_MEMBER_POINTS * (c.STANDARD_ISSUE_MEMBER_SHARES[v.key]?.[stat] ?? 0));
          const seam = gearSeam(team, stat, points);
          const wearer = wearerOf(team);
          out.push(
            entry({
              id,
              system: "away",
              source,
              claim,
              probe: seam?.probe,
              contexts: seam ? [seam.context] : [],
              curve: seam?.curve ?? { kind: "linearAbsolute" },
              magnitude: seam?.magnitude ?? (() => 0),
              tolerance: seam?.tolerance,
              base: () => withAwayTeam(wiringBase()),
              on: (s) => wearStandardIssue(s, wearer, slotType, v.key, stat),
              off: (s) => wearStandardIssue(s, wearer, slotType, v.key, null),
              status: seam ? LIVE : pending("WR-1 follow-up: no seam probe for this squad and line"),
              note: `the issued piece carries ${standardIssueMemberLines(v.key)[stat] ?? 0} points of this line`,
            }),
          );
        }
      }
    }
  }
  return out;
}

function traitEntry(t: AwayTraitDef): WiringEntry {
  const e = t.effects[0];
  const team = t.teamTypes[0];
  if (team === "prospecting") {
    // A Prospecting-only trait (hidden with the squad): no Prospecting member deploys in 0.14.0.
    return entry({
      id: `away:AWAY_TRAITS:${t.id}`,
      system: "away",
      source: { catalog: "AWAY_TRAITS", key: t.id },
      claim: `${t.label}: ${t.description}`,
      status: PROSPECTING_DEFERRED,
    });
  }
  const memberId = wearerOf(team);
  const withTrait: Transform = (s) => editMember(s, memberId, { traits: [t.id] });
  const common = {
    id: `away:AWAY_TRAITS:${t.id}`,
    system: "away" as const,
    source: { catalog: "AWAY_TRAITS", key: t.id },
    claim: `${t.label}: ${t.description}`,
    base: () => withAwayTeam(wiringBase()),
    on: withTrait,
    off: identity,
  };
  const value = (c: Catalogs) => {
    const eff = c.AWAY_TRAITS.find((x) => x.id === t.id)!.effects[0];
    return "value" in eff ? eff.value : "allyHpBelow" in eff ? eff.allyHpBelow : 0;
  };
  switch (e.kind) {
    case "stat": {
      if (e.stat === "statusChance") {
        // Saboteur: lands only with an inflict piece worn (PARTIAL, OC-F4).
        return entry({
          ...common,
          probe: "secInflictPermille",
          contexts: ["ground"],
          curve: { kind: "chanceAbsolute" },
          magnitude: (c) => value(c) * 1000,
          tolerance: 1,
          base: () => wearPiece(withAwayTeam(wiringBase()), memberId, "memberTool", "stunGrenade", {}),
          status: pending("WR-10 OC-F4 (status chance without an inflict piece)", ["ground:noInflict"]),
          note: "live with an inflict piece worn (the base wears a bare Stun Grenade); the no-inflict context is pending",
        });
      }
      const probe: Record<string, ProbeId> = { accuracy: "secAccuracy", power: "secPower", armor: "secArmor", relicFind: "fieldRelicFind", hazardResist: "fieldHazardResist" };
      const relative = e.stat === "accuracy" || e.stat === "power" || e.stat === "armor";
      return entry({ ...common, probe: probe[e.stat], contexts: [relative ? "ground" : "fieldwork"], curve: { kind: relative ? "linearRelative" : "linearAbsolute" }, magnitude: value });
    }
    case "guard":
      return entry({ ...common, probe: "secGuardBelow", contexts: ["ground"], magnitude: value });
    case "medic":
      return entry({ ...common, probe: "secFirstAid", contexts: ["ground"], magnitude: () => FIRST_AID_TRAINED_EFFECTIVENESS - FIRST_AID_UNTRAINED_EFFECTIVENESS });
    case "firstStrike":
      return entry({ ...common, probe: "secFirstStrike", contexts: ["ground"], curve: { kind: "gate" }, magnitude: () => 1, note: "weak: the team already acts first (OC-F5)" });
    case "resistStatus":
      // Field Kits FKR-4: Iron Will's Fear resist, now that a Field Kits run's Swarm and hostile garrisons inflict Fear.
      if (e.status === "fear") return entry({ ...common, probe: "secFearResist", contexts: ["ground"], curve: { kind: "chanceAbsolute" }, magnitude: (c) => value(c) * 1000, tolerance: 1 });
      return entry({ ...common, status: pending("WR-10 (a trait resist with no seam probe for its status)"), note: "the resist is computed; no probe reads this status yet" });
    case "poiYield": {
      const poi = e.pois[0];
      const probe: Record<string, ProbeId> = { ancientRuins: "fieldYieldRuins", xenoFloraBloom: "fieldYieldOrganics", buriedVault: "fieldYieldVault", mineralOutcrop: "fieldYieldMineral" };
      return entry({ ...common, probe: probe[poi], contexts: ["fieldwork"], curve: { kind: "diminishing", knee: FIELDWORK_YIELD_KNEE, base: 1 }, magnitude: value });
    }
  }
}

// The member gear ground EFFECTS (a piece's total points scale them; awayTeam.ts snapshotMember).
function groundEffectEntries(): WiringEntry[] {
  const N = GEAR_TEST_POINTS;
  const base = () => withAwayTeam(wiringBase());
  const medic = withMedic;
  const piece = (slot: string, variety: string, lines: Record<string, number>): Transform => (s) => wearPiece(s, WIRING_SECURITY_ID, slot, variety, lines);
  // Neural Backup's configured revive chance (the implant variety's groundEffect), as the combatant's permille.
  const reviveChance = (c: Catalogs) => {
    const v = c.EQUIPMENT_SLOTS.implant.varieties.find((x) => x.key === "neuralBackup");
    const g = v?.member?.groundEffect;
    return g && g.kind === "revive" ? Math.round(g.chance * 1000) : 0;
  };
  const fx = (kind: string, claim: string, e: Partial<EntryInput>): WiringEntry =>
    entry({ id: `away:groundEffect:${kind}`, system: "away", source: { catalog: "MEMBER_GROUND_EFFECTS", key: kind }, claim, base, ...e } as EntryInput);
  return [
    fx("groupHit", "Scattergun: a landed hit splashes onto the target's group", {
      probe: "secGroupHit",
      contexts: ["ground"],
      on: piece("memberWeapon", "scattergun", { groundPower: N }),
      off: piece("memberWeapon", "pulseRifle", { groundPower: N }),
      // The splash is linear in the piece's points (gambit.ts GROUP_HIT_PER_POINT, module-private) below its cap.
      curve: { kind: "perPoint", points: N, unitOn: piece("memberWeapon", "scattergun", { groundPower: 1 }) },
      magnitude: () => N,
    }),
    fx("inflict", "Stun Grenade / Toxin Grenade / Shock Baton: a landed hit can afflict", {
      probe: "secInflictPermille",
      contexts: ["ground"],
      on: piece("memberTool", "stunGrenade", { groundStatusChance: N }),
      off: piece("memberTool", "medKit", { groundStatusChance: N }),
      curve: { kind: "chanceAbsolute" },
      magnitude: (c) => N * c.GEAR_POINT_BUMP.statusChance * 1000,
      tolerance: 1,
    }),
    fx("heal", "Med Kit: heals with Medical Training", {
      probe: "secHeal",
      contexts: ["ground"],
      base: () => medic(withAwayTeam(wiringBase())),
      on: piece("memberTool", "medKit", { groundHp: N }),
      off: piece("memberTool", "stunGrenade", { groundHp: N }),
      // The heal grows linearly with the kit's points (gambit.ts HEAL_PER_GEAR_POINT, module-private) on the medic's base.
      curve: { kind: "perPoint", points: N, unitOn: piece("memberTool", "medKit", { groundHp: 1 }) },
      magnitude: () => N,
    }),
    fx("revive", "Neural Backup: once per battle, a downed ally may come back", {
      probe: "secRevivePermille",
      contexts: ["ground"],
      on: (s) => wearPiece(s, WIRING_SECURITY_ID, "implant", "neuralBackup", {}),
      off: (s) => wearPiece(s, WIRING_SECURITY_ID, "implant", "dermalWeave", {}),
      curve: { kind: "linearAbsolute" },
      magnitude: reviveChance,
      tolerance: 0.5,
      note: "revives the FIRST downed ally, not the wearer (B13, WR-10 OC-F2)",
    }),
    fx("resistStatus", "Toxin Filters: resist poison (Cortex Shield: stun and fear, and Concussion through its stun resist)", {
      probe: "secPoisonResist",
      contexts: ["ground"],
      on: (s) => wearPiece(s, WIRING_SECURITY_ID, "implant", "toxinFilters", { groundStatusResist: N }),
      off: (s) => wearPiece(s, WIRING_SECURITY_ID, "implant", "dermalWeave", { groundStatusResist: N }),
      curve: { kind: "chanceAbsolute" },
      magnitude: () => N * STATUS_RESIST_PER_POINT * 1000,
      tolerance: 1,
    }),
  ];
}

// ============================================================================
// captain
// ============================================================================

function captainTalentEntries(): WiringEntry[] {
  return (Object.keys(CAPTAIN_TALENTS) as CaptainTalentKey[]).map((key) => {
    const def = CAPTAIN_TALENTS[key];
    const eff = def.effect;
    const common = {
      id: `captain:CAPTAIN_TALENTS:${key}`,
      system: "captain" as const,
      source: { catalog: "CAPTAIN_TALENTS", key },
      claim: `${def.label}: ${def.flavor}`,
      on: (s: GameState) => editCaptain(s, { unlockedCaptainTalents: [...s.captains[0].unlockedCaptainTalents, key] }),
    };
    const mult = (c: Catalogs) => {
      const e = c.CAPTAIN_TALENTS[key].effect;
      return "mult" in e ? e.mult : "chance" in e ? e.chance : 0;
    };
    switch (eff.type) {
      case "commonYieldMult":
        return entry({ ...common, probe: "extractionCommonPerTick", contexts: ["mission:extraction"], curve: { kind: "linearRelative" }, magnitude: mult });
      case "uncommonYieldMult":
        return entry({ ...common, probe: "extractionUncommonPerTick", contexts: ["mission:extraction"], curve: { kind: "linearRelative" }, magnitude: mult });
      case "uncommonChanceMult":
        return entry({ ...common, probe: "extractionUncommonThreshold", contexts: ["mission:extraction"], curve: { kind: "linearRelative" }, magnitude: mult, tolerance: 1e-9 });
      case "rareChanceMult":
        return entry({ ...common, probe: "extractionRareThreshold", contexts: ["mission:extraction"], curve: { kind: "linearRelative" }, magnitude: mult, tolerance: 1e-9 });
      case "bonusRollChance":
        return entry({ ...common, probe: "bonusRollTrigger", contexts: ["mission:extraction"], curve: { kind: "chanceAbsolute" }, magnitude: mult });
      case "bonusRollChanceMult":
        // A multiplier on Lucky Strike I's chance: measured with Lucky Strike I owned in both states.
        return entry({
          ...common,
          base: () => editCaptain(wiringBase(), { unlockedCaptainTalents: ["prospectorLuckyStrikeI"] }),
          probe: "bonusRollTrigger",
          contexts: ["mission:extraction"],
          curve: { kind: "linearRelative" },
          magnitude: mult,
        });
      case "weaponDamageMult":
      case "scanRateMult":
      case "relicFindMult":
        // WR-6: the Tactician / Explorer hubs, each its own factor where the matching secondary node acts.
        return entry({ ...common, ...PRIMARY_SEAMS[eff.type], magnitude: mult, note: "size OC-A40 / OC-A41 (user 2026-10-19)" });
      case "none":
        throw new Error(`wiring: captain talent ${key} is a "none" gateway (WR-6 wired every hub)`);
    }
  });
}

// WR-6 (0.14.0): where the captain primary bonuses (the two hubs, the tactical and science specs) act: on the ship
// the captain commands, through the records the secondary tree freezes (captainPrimaryEffects.ts).
const PRIMARY_SEAMS: Readonly<Record<CaptainPrimaryMultKind, Pick<EntryInput, "probe" | "contexts" | "curve" | "tolerance" | "base">>> = {
  weaponDamageMult: { probe: "captainShotDamage", contexts: ["patrol", "shipEvent"], curve: { kind: "linearRelative" }, base: () => combatBase() },
  scanRateMult: { probe: "expScanRate", contexts: ["expedition:groundOps"], curve: { kind: "linearRelative" } },
  relicFindMult: { probe: "runRelicChance", contexts: ["expedition:groundOps"], curve: { kind: "linearRelative" }, tolerance: 0.5 },
};

function captainSpecEntries(): WiringEntry[] {
  const branches = [...new Set(Object.values(CAPTAIN_TALENTS).map((d) => d.branch))] as CaptainTalentBranch[];
  return branches.map((branch) => {
    const eff = CAPTAIN_SPEC_BONUS[branch];
    // WR-6 (OC-A42): the tactical and science spec bonuses, each its own factor on the hub's seam.
    if (eff && (eff.type === "weaponDamageMult" || eff.type === "scanRateMult" || eff.type === "relicFindMult")) {
      const kind = eff.type;
      return entry({
        id: `captain:CAPTAIN_SPEC_BONUS:${branch}`,
        system: "captain",
        source: { catalog: "CAPTAIN_SPEC_BONUS", key: branch },
        claim: `${branch} specialization bonus: ${describeCaptainTalentEffect(eff)}`,
        ...PRIMARY_SEAMS[kind],
        magnitude: (c) => {
          const e = c.CAPTAIN_SPEC_BONUS[branch];
          return e && e.type === kind ? e.mult : 0;
        },
        on: (s) => editCaptain(s, { spec: branch }),
        note: "size OC-A42 (user 2026-10-19)",
      });
    }
    // Release gate (0.14.0): every spec carries a real bonus since WR-6, so a spec without one is a placeholder bug.
    if (eff?.type !== "bonusRollChance") throw new Error(`wiring: the ${branch} spec has no wired bonus`);
    return entry({
      id: `captain:CAPTAIN_SPEC_BONUS:${branch}`,
      system: "captain",
      source: { catalog: "CAPTAIN_SPEC_BONUS", key: branch },
      claim: `${branch} specialization bonus`,
      probe: "bonusRollTrigger",
      contexts: ["mission:extraction"],
      curve: { kind: "chanceAbsolute" },
      magnitude: (c) => {
        const e = c.CAPTAIN_SPEC_BONUS[branch];
        return e && "chance" in e ? e.chance : 0;
      },
      on: (s) => editCaptain(s, { spec: branch }),
    });
  });
}

// WR-5a: the Prospector tree, LIVE. Each node's seam, context(s) and curve; the magnitude is the node's catalog
// magnitude (captainSecondaryEffects.ts secondaryTalentMagnitude), unless the entry names its own.
const FRONTIER = MISSIONS.frontierSupplyRun;
// The freighter's whole Frontier Supply Run load (ship-1 is the General Freighter).
const FRONTIER_LOAD = SHIP_TYPES.generalFreighter.cargoCapacity * (FRONTIER.supplyCostPerCargo ?? 0);
// A save whose fleet has delivered one supply run cycle (Trade Routes pays only on an established route).
const withSupplyRoute = (s: GameState): GameState => ({
  ...s,
  lifetimeStats: { ...s.lifetimeStats, missionsCompleted: { ...s.lifetimeStats.missionsCompleted, frontierSupplyRun: new Decimal(1) } },
});
const ownsNodes = (s: GameState, keys: readonly SecondaryTalentKey[]): GameState =>
  editCaptain(s, { unlockedSecondaryTalents: [...s.captains[0].unlockedSecondaryTalents, ...keys] });
const PROSPECTOR_SEAMS: Readonly<
  Partial<Record<SecondaryTalentKey, { probe: ProbeId; contexts: ContextId[]; curve: Curve; direction?: Direction; tolerance?: number; base?: () => GameState; magnitude?: (c: Catalogs) => number; note?: string }>>
> = {
  extraction1: { probe: "sheetYield", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  // The rare threshold the extraction roll compares against, on an ore run and a survey (its own factor; the uncommon
  // half: captainSecondaryEffects.test.ts).
  extraction2: { probe: "extractionRareThreshold", contexts: ["mission:extraction", "mission:survey"], curve: { kind: "linearRelative" }, tolerance: 1e-9 },
  extraction3: { probe: "missionExtractionTicks", contexts: ["mission:extraction"], curve: { kind: "divisor" }, direction: "down", tolerance: 1 },
  extraction4: { probe: "deliveryQualityClimb", contexts: ["mission:extraction"], curve: { kind: "linearRelative" }, tolerance: 1e-12 },
  // The realized double hauls over 1,000 real deliveries (lifetime counter 0 to 999): their share sits at the
  // configured chance within the batch's sampling spread (about 3 standard deviations).
  extraction5: { probe: "motherlodeRate", contexts: ["mission:extraction"], curve: { kind: "chanceAbsolute" }, tolerance: 0.02 },
  logistics1: { probe: "sheetCargo", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  // "Always multiply" (user 2026-10-17): +5% reach, its own factor on (1 + engineEfficiency).
  logistics2: { probe: "shipRange", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  logistics3: { probe: "sheetUnload", contexts: ["sheet", "expedition:groundOps"], curve: { kind: "linearRelative" } },
  // The overflow's free unload: captainSecondaryEffects.test.ts (the unload ticks stay the hold's).
  logistics5: { probe: "sheetCargo", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  trade1: { probe: "transportCycleCredits", contexts: ["mission:transport"], curve: { kind: "linearRelative" } },
  // The discount saved on the supplies: the load value x the discount, added to the net.
  trade2: {
    probe: "transportCycleCredits",
    contexts: ["mission:transport"],
    curve: { kind: "linearAbsolute" },
    magnitude: (c) => {
      const e = c.SECONDARY_CAPTAIN_TALENTS.trade2.effect;
      return (e.type === "statMult" ? e.mult : 0) * FRONTIER_LOAD;
    },
  },
  trade3: { probe: "transportCycleCredits", contexts: ["mission:transport"], curve: { kind: "linearRelative" } },
  trade4: { probe: "dockedCredits", contexts: ["fleet"], curve: { kind: "linearAbsolute" }, base: () => withSupplyRoute(wiringBase()) },
  // Trade Baron multiplies every Trade value by its factor: on a captain owning Trade 1 to 4 on an established route,
  // the docked trickle x factor. Its margin and purchase cost terms: captainSecondaryEffects.test.ts.
  trade5: {
    probe: "dockedCredits",
    contexts: ["fleet"],
    curve: { kind: "linearRelative" },
    base: () => withSupplyRoute(ownsNodes(wiringBase(), ["trade1", "trade2", "trade3", "trade4"])),
    magnitude: (c) => {
      const e = c.SECONDARY_CAPTAIN_TALENTS.trade5.effect;
      return (e.type === "capstone" ? e.magnitude ?? 1 : 1) - 1;
    },
  },
};

// The catalog magnitude of a secondary node (a statMult's mult, a procChance's chance, a capstone's magnitude, a
// trickle's perTick, a levelLift's levels). Every tree's entries read it.
function secondaryMagnitude(key: SecondaryTalentKey): (c: Catalogs) => number {
  return (c) => {
    const e = c.SECONDARY_CAPTAIN_TALENTS[key].effect;
    return e.type === "statMult" ? e.mult : e.type === "procChance" ? e.chance : e.type === "capstone" ? e.magnitude ?? 0 : e.type === "creditTrickle" ? e.perTick : e.type === "levelLift" ? e.levels : 0;
  };
}

// WR-5b: the Tactician tree, live (captainTacticianEffects.ts, combat/captainEdge.ts). Ship battles are read on the
// ship the captain commands: the patrol fold every wave builds and the Ground Ops ship-event combatant frozen at
// dispatch. The drone nodes on a carrier (a destroyer fields no drones); the patrol-only nodes on the dispatched
// cycle. Each the node's catalog magnitude, its own x (1 + m) factor.
const BATTLE: ContextId[] = ["patrol", "shipEvent"];
const carrierBase = (): GameState => combatBase("carrier");
// A destroyer with a Damage Control Suite installed (the between-wave patch-up has a fraction to lift).
const suiteBase = (): GameState =>
  installPiece(combatBase(), { slotType: "specUtility", moduleVariant: DAMAGE_CONTROL_SUITE_KEY, implicitStats: { repairSpeed: 20, waveHullRegen: 20 } });
const TACTICIAN_SEAMS: Readonly<
  Partial<Record<SecondaryTalentKey, { probe: ProbeId; contexts: ContextId[]; curve: Curve; direction?: Direction; tolerance?: number; base: () => GameState; note?: string }>>
> = {
  gunnery1: { probe: "captainShotDamage", contexts: BATTLE, curve: { kind: "linearRelative" }, base: () => combatBase() },
  gunnery2: { probe: "captainWeaponAccuracy", contexts: BATTLE, curve: { kind: "linearRelative" }, tolerance: 0.5, base: () => combatBase() },
  gunnery3: { probe: "captainShotDamageHighHealth", contexts: BATTLE, curve: { kind: "linearRelative" }, base: () => combatBase() },
  gunnery4: { probe: "captainWeaponCooldown", contexts: BATTLE, curve: { kind: "divisor" }, direction: "down", tolerance: 0.01, base: () => combatBase() },
  gunnery5: { probe: "captainOpeningShot", contexts: BATTLE, curve: { kind: "linearRelative" }, base: () => combatBase() },
  aegis1: { probe: "combatShieldMax", contexts: BATTLE, curve: { kind: "linearRelative" }, tolerance: 0.5, base: () => combatBase() },
  aegis2: { probe: "combatHullMax", contexts: BATTLE, curve: { kind: "linearRelative" }, tolerance: 0.5, base: () => combatBase() },
  aegis3: {
    probe: "captainRepairRate",
    contexts: ["shipyard", "expedition:groundOps", "patrol"],
    curve: { kind: "linearRelative" },
    base: suiteBase,
    note: "Shipyard: the repair divisor (the ticks it shortens: captainTacticianEffects.test.ts); Ground Ops: the frozen field repair divisor; patrol: the Damage Control Suite's between-wave fraction",
  },
  aegis4: { probe: "captainIncomingHit", contexts: BATTLE, curve: { kind: "divisor" }, direction: "down", tolerance: 0.5, base: () => combatBase() },
  aegis5: { probe: "captainLethalSurvived", contexts: BATTLE, curve: { kind: "gate" }, base: () => combatBase() },
  fleetOps1: { probe: "captainDroneShot", contexts: BATTLE, curve: { kind: "linearRelative" }, base: carrierBase },
  fleetOps2: { probe: "battleDroneHp", contexts: BATTLE, curve: { kind: "linearRelative" }, tolerance: 0.5, base: carrierBase },
  fleetOps3: { probe: "patrolRewardMult", contexts: ["patrol"], curve: { kind: "linearRelative" }, base: () => combatBase() },
  fleetOps4: { probe: "battleDroneReplenish", contexts: BATTLE, curve: { kind: "linearRelative" }, tolerance: 0.5, base: carrierBase },
  fleetOps5: { probe: "battleDroneSquadrons", contexts: BATTLE, curve: { kind: "gate" }, base: carrierBase },
};

function secondaryEntries(): WiringEntry[] {
  return (Object.keys(SECONDARY_CAPTAIN_TALENTS) as SecondaryTalentKey[]).flatMap((key) => {
    const def = SECONDARY_CAPTAIN_TALENTS[key];
    const on: Transform = (s) => editCaptain(s, { unlockedSecondaryTalents: [...s.captains[0].unlockedSecondaryTalents, key] });
    // WR-5c: the explorer tree builds its own entries (one per claimed value).
    if (def.tree === "explorer") return explorerSecondaryEntries(key);
    // WR-5a / WR-5b: the claim is the node's player text, from the same helper the talent tooltip renders.
    const common = { id: `captain:SECONDARY_CAPTAIN_TALENTS:${key}`, system: "captain" as const, source: { catalog: "SECONDARY_CAPTAIN_TALENTS", key }, claim: `${def.label}: ${secondaryTalentEffectText(key)}`, on };
    const seam = PROSPECTOR_SEAMS[key];
    if (seam) {
      return entry({
        ...common,
        probe: seam.probe,
        contexts: seam.contexts,
        curve: seam.curve,
        direction: seam.direction ?? "up",
        magnitude: seam.magnitude ?? secondaryMagnitude(key),
        ...(seam.tolerance !== undefined ? { tolerance: seam.tolerance } : {}),
        ...(seam.base ? { base: seam.base } : {}),
      });
    }
    const tactician = TACTICIAN_SEAMS[key];
    if (tactician) {
      return entry({
        ...common,
        probe: tactician.probe,
        contexts: tactician.contexts,
        curve: tactician.curve,
        direction: tactician.direction ?? "up",
        magnitude: secondaryMagnitude(key),
        base: tactician.base,
        ...(tactician.tolerance !== undefined ? { tolerance: tactician.tolerance } : {}),
        ...(tactician.note ? { note: tactician.note } : {}),
      });
    }
    if (key === "logistics4") {
      return entry({
        ...common,
        probe: "expReloadMult",
        contexts: ["expedition:groundOps"],
        magnitude: (c) => {
          const e = c.SECONDARY_CAPTAIN_TALENTS.logistics4.effect;
          return e.type === "statMult" ? e.mult : 0;
        },
        outOfScope: [{ context: "mission:extraction", reason: "missions have no load phase (D26 points Efficient Stowage at the Ground Ops reload)" }],
      });
    }
    // Release gate (0.14.0): every secondary node is live (WR-5a, WR-5b, WR-5c), so a node without a seam is a bug.
    throw new Error(`wiring: secondary node ${key} has no seam`);
  });
}

// WR-5c: the EXPLORER tree (Survey & Sensors, Expedition & Relics, Command & Crew), every node live (plan section 5.A,
// OC-A1 "Always multiply", OC-A2 own ship, OC-A3 proposed sizes). Each node reads its value through the consumer it
// claims; a node with more than one claimed value has one entry per value ("<key>:<part>"). Magnitudes come from the
// catalog through `c`, so a retune stays green.
function explorerSecondaryEntries(key: SecondaryTalentKey): WiringEntry[] {
  const def = SECONDARY_CAPTAIN_TALENTS[key];
  const on: Transform = (s) => editCaptain(s, { unlockedSecondaryTalents: [...s.captains[0].unlockedSecondaryTalents, key] });
  const claim = `${def.label}: ${explorerTalentText(key) ?? def.flavor}`;
  const magnitude = secondaryMagnitude(key);
  const node = (part: string | null, e: Omit<EntryInput, "id" | "system" | "source" | "claim">): WiringEntry =>
    entry({
      id: `captain:SECONDARY_CAPTAIN_TALENTS:${key}${part ? `:${part}` : ""}`,
      system: "captain",
      source: { catalog: "SECONDARY_CAPTAIN_TALENTS", key: part ? `${key}:${part}` : key },
      claim,
      on,
      magnitude,
      ...e,
    });
  const rel: Curve = { kind: "linearRelative" };
  const sensorsBase = () => installPiece(wiringBase(), { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
  const crewBase = () => withBuckets(wiringBase(), [bucketOf("security", "sec.boarding"), bucketOf("science", "sci.rareFind"), bucketOf("operations", "ops.effectiveCargo")]);
  const presenceBase = () => seatOfficer(wiringBase(), "executive", ["xo.commandOutput"]);
  const weaponsBase = () => seatOfficer(combatBase(), "tactical", ["tac.weaponCommand"]);
  const officerAboard = () => seatOfficer(wiringBase(), "science", ["sci.discovery"]);
  const run: ContextId[] = ["expedition:groundOps"];
  switch (key) {
    case "surveySensors1":
      return [node(null, { probe: "sheetSensors", contexts: ["sheet"], curve: rel, base: sensorsBase, note: "every survey, expedition, telescope and ship-event reader reads the sheet's sensors" })];
    case "surveySensors2":
      return [node(null, { probe: "expScanRate", contexts: run, curve: rel })];
    case "surveySensors3":
      return [node(null, { probe: "expDiscoveryOdds", contexts: run, curve: rel, tolerance: 0.5 })];
    case "surveySensors4":
      return [node(null, { probe: "candDetail", contexts: run, curve: { kind: "gate" } })];
    case "surveySensors5":
      return [
        node(null, { probe: "candDetail", contexts: run, curve: { kind: "event", metric: "telescope detail levels (to the top)" } }),
        node("sureFinds", { probe: "expDiscoveries", contexts: run, curve: { kind: "event", metric: "finds over 24 bodies" } }),
      ];
    case "expeditionRelics1":
      return [
        node(null, { probe: "expSecurityStrength", contexts: run, curve: rel, base: crewBase }),
        node("science", { probe: "expScienceStrength", contexts: run, curve: rel, base: crewBase }),
      ];
    case "expeditionRelics2":
      return [node(null, { probe: "runRelicChance", contexts: run, curve: rel, tolerance: 0.5 })];
    case "expeditionRelics3":
      return [
        node(null, { probe: "runTaskSecPower", contexts: ["ground"], curve: rel }),
        node("accuracy", { probe: "runTaskSecAccuracy", contexts: ["ground"], curve: rel }),
      ];
    case "expeditionRelics4":
      return [node(null, { probe: "runRelicStudyTicks", contexts: ["research"], direction: "down", curve: { kind: "divisor" }, tolerance: 1 })];
    case "expeditionRelics5":
      return [node(null, { probe: "runRelicTierCeiling", contexts: run, curve: { kind: "gate" } })];
    case "commandCrew1":
      return [node(null, { probe: "crewMapCargo", contexts: ["sheet"], curve: rel, base: crewBase })];
    case "commandCrew2":
      return [
        node(null, { probe: "missionOutputBonus", contexts: ["mission:extraction"], curve: rel, base: presenceBase }),
        node("combat", { probe: "officerWeapons", contexts: ["patrol"], curve: rel, base: weaponsBase }),
      ];
    case "commandCrew3":
      return [
        node(null, { probe: "missionCrewHours", contexts: ["mission:extraction"], curve: rel, base: officerAboard }),
        node("claim", { probe: "claimObjectives", contexts: run, curve: rel, base: officerAboard }),
      ];
    case "commandCrew4":
      return [
        node(null, { probe: "officerBoard", contexts: ["fleet"], curve: rel, tolerance: 1, note: "rounded up to whole candidates" }),
        node("recruits", { probe: "recruitBoard", contexts: ["fleet"], curve: rel, tolerance: 1, note: "rounded up to whole candidates" }),
      ];
    case "commandCrew5":
      return [
        node(null, { probe: "crewMapCargo", contexts: ["sheet"], curve: rel, base: crewBase }),
        node("officers", { probe: "missionOutputBonus", contexts: ["mission:extraction"], curve: rel, base: presenceBase }),
        node("combat", { probe: "officerWeapons", contexts: ["patrol"], curve: rel, base: weaponsBase }),
      ];
    default:
      throw new Error(`wiring: ${key} is not an explorer node`);
  }
}

function captainProgressionEntries(): WiringEntry[] {
  return [
    entry({
      id: "captain:progression:retirementXp",
      system: "captain",
      source: { catalog: "CAPTAIN_PROGRESSION", key: "retirementExpMultiplier" },
      claim: "Each retirement raises captain XP fleet-wide",
      probe: "captainXpPerTick",
      contexts: ["captain"],
      curve: { kind: "linearRelative" },
      magnitude: () => RETIREMENT_EXP_PER,
      on: (s) => editCaptain(s, { retirements: 1 }),
    }),
    // WR-6 (OC-A43, user 2026-10-19 "Same as an officer"): the captain carries its race's racial on the ship it commands, at the officer
    // magnitude x CAPTAIN_RACIAL_SCALE. Measured with a Station-born captain (crew.unloadSpeed, a live racial key; the
    // other races ride the same crew map as their officer racial entries).
    entry({
      id: "captain:progression:race",
      system: "captain",
      source: { catalog: "CAPTAIN_PROGRESSION", key: "race" },
      claim: "Captain race: the captain carries its race's racial on the ship it commands, at the officer magnitude",
      probe: "sheetUnload",
      contexts: ["sheet", "expedition:groundOps"],
      curve: { kind: "linearRelative" },
      magnitude: (c) => c.CREW_RACES.stationBorn.racialBonus.seniorStaff * CAPTAIN_RACIAL_SCALE,
      on: (s) => editCaptain(s, { race: "stationBorn" }),
      note: "magnitude CAPTAIN_RACIAL_SCALE 1 (user 2026-10-19)",
    }),
  ];
}

// ============================================================================
// fleetAdmiral: Homeworld talents
// ============================================================================

const QUEUE_PROBE: Record<string, ProbeId> = {
  refinery: "queueDepthRefinery",
  fabricator: "queueDepthFabricator",
  salvageBay: "queueDepthSalvageBay",
  researchLab: "queueDepthResearchLab",
  shipyard: "queueDepthShipyard",
};

function homeworldEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  for (const key of Object.keys(HOMEWORLD_TALENTS) as HomeworldTalentKey[]) {
    const def = HOMEWORLD_TALENTS[key];
    const eff = def.effect;
    const common = {
      id: `fleetAdmiral:HOMEWORLD_TALENTS:${key}`,
      system: "fleetAdmiral" as const,
      source: { catalog: "HOMEWORLD_TALENTS", key },
      claim: `${def.label}: ${def.flavor}`,
      on: (s: GameState) => withHomeworld(s, [key]),
    };
    const field = (f: string) => (c: Catalogs) => (c.HOMEWORLD_TALENTS[key].effect as unknown as Record<string, number>)[f];
    switch (eff.type) {
      case "rareYieldMult":
        out.push(entry({ ...common, probe: "extractionRarePerTick", contexts: ["mission:extraction"], curve: { kind: "linearRelative" }, magnitude: field("mult") }));
        break;
      case "queueDepth":
        out.push(entry({ ...common, probe: "queueDepthRefinery", contexts: ["facility"], magnitude: field("depth") }));
        break;
      case "facilityQueueDepth":
        out.push(entry({ ...common, probe: QUEUE_PROBE[eff.facility], contexts: ["facility"], magnitude: field("depth") }));
        break;
      case "passiveTrickle":
        out.push(entry({ ...common, probe: "passiveTrickle", contexts: ["fleet"], magnitude: field("perTick") }));
        break;
      case "craftingItemLevel":
        out.push(entry({ ...common, probe: "craftingIlevelBonus", contexts: ["craft"], magnitude: field("bonus") }));
        break;
      case "salvageBoost":
        out.push(
          entry({
            ...common,
            probe: "salvageTalentYield",
            // WR-6 (OC-B1 "Apply to hull teardown"): the recycle fraction and the hull teardown fraction (B16: the
            // text says percentage points, the flat add it is).
            contexts: ["salvage", "salvage:teardown"],
            magnitude: field("yieldBonus"),
            note: "a flat add onto the recovery fraction: salvageEquipment and hullTeardownFraction",
          }),
          entry({
            ...common,
            id: `${common.id}:ceiling`,
            claim: `${def.label}: +1 loot tier reach`,
            probe: "salvageTalentCeiling",
            contexts: ["salvage"],
            magnitude: field("ceilingBonus"),
            status: pending("WR-11, OC-J1 (the +1 tier is clamped and wasted from FA 15, B16)", ["salvage:topTier"]),
          }),
        );
        break;
      case "unlockCaptainSlot":
        out.push(
          entry({
            ...common,
            probe: "captainCount",
            contexts: ["fleet"],
            curve: { kind: "gate" },
            magnitude: () => 1,
            base: () => {
              const s = wiringBase();
              const chain: HomeworldTalentKey[] = ["fleetLogisticsHub", "fleetLogisticsSlot1", "fleetLogisticsSlot2", "fleetLogisticsSlot3"];
              const before = chain.slice(0, chain.indexOf(key)).filter((k) => k !== key);
              return { ...withHomeworld(s, before.filter((k) => k === "fleetLogisticsHub")), adminPoints: 99, fleetAdminLevel: 30 };
            },
            on: (s) => buyChain(s, key),
            off: (s) => buyChain(s, key, true),
            note: "the purchase grants a captain and a General Freighter (buyHomeworldTalent)",
          }),
        );
        break;
      // WR-6 (OC-B2 / OC-B3, user 2026-10-15 "Give them real effects"; sizes approved 2026-10-19).
      case "fabricatorBonusOutput":
        // The realized extra output over 1,000 real Fabricator jobs (process numbers 1 to 1,000): its share sits at the
        // configured chance within the batch's sampling spread (about 3 standard deviations).
        out.push(entry({ ...common, probe: "fabricatorBonusShare", contexts: ["craft"], curve: { kind: "chanceAbsolute" }, magnitude: field("chance"), tolerance: 0.02, note: "chance OC-B2 (user 2026-10-19); also gates Refinery rungs 3 and 4" }));
        break;
      case "patrolShieldMult":
        out.push(entry({ ...common, probe: "patrolShieldPool", contexts: ["patrol"], curve: { kind: "linearRelative" }, magnitude: field("mult"), tolerance: 0.5, base: () => combatBase(), note: "size OC-B3 (user 2026-10-19)" }));
        break;
      case "transportCrewBonus":
        out.push(entry({ ...common, probe: "transportCrewDelivered", contexts: ["fleet"], magnitude: field("crew"), note: "size OC-B3 (user 2026-10-19)" }));
        break;
      case "none":
        throw new Error(`wiring: Homeworld talent ${key} is a "none" placeholder (WR-6 wired every hub)`);
    }
  }
  return out;
}

// Buy the captain-slot chain up to `key` through the real purchase (stopping before `key` when `exceptLast`).
function buyChain(s: GameState, key: HomeworldTalentKey, exceptLast = false): GameState {
  const chain: HomeworldTalentKey[] = ["fleetLogisticsSlot1", "fleetLogisticsSlot2", "fleetLogisticsSlot3"];
  let next = s;
  for (const k of chain.slice(0, chain.indexOf(key) + (exceptLast ? 0 : 1))) {
    const r = buyHomeworldTalent(next, k);
    if (!r.success) throw new Error(`wiring: buying ${k} failed`);
    next = r.next;
  }
  return next;
}

// ============================================================================
// facility: facility rungs, storage / docks / berth tracks, telescope, recipes, blueprints, items
// ============================================================================

function facilityRungEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  for (const [fkey, fdef] of Object.entries(FACILITIES)) {
    fdef.upgrades.forEach((up, i) => {
      const eff = up.effect as unknown as Record<string, unknown>;
      const common = {
        id: `facility:FACILITIES:${fkey}:${i}`,
        system: "facility" as const,
        source: { catalog: "FACILITIES", key: `${fkey}:${i}` },
        claim: `${fdef.label} rung ${i + 1}`,
        on: (s: GameState) => withFacilityLevel(s, fkey, i + 1),
        off: (s: GameState) => withFacilityLevel(s, fkey, i),
      };
      const num = (f: string) => (c: Catalogs) => ((c.FACILITIES[fkey].upgrades[i].effect as unknown as Record<string, number>)[f]);
      // WR-4 (OC-C1, "Turn into range"): every Fuel Depot rung adds its share to the fleet's reach.
      if ("fleetReachBonus" in eff) {
        out.push(entry({ ...common, probe: "fleetReach", contexts: ["sheet"], magnitude: num("fleetReachBonus"), note: "shipReachDef scales every ship's reach by 1 + the sum (wiringBugs.test.ts pins the gate and the readout)" }));
        return;
      }
      if ("addRefineSlots" in eff) out.push(entry({ ...common, probe: "refineSlots", contexts: ["facility"], magnitude: num("addRefineSlots") }));
      else if ("refineSpeedMult" in eff)
        out.push(entry({ ...common, probe: "refineJobTicks", contexts: ["facility"], direction: "down", curve: { kind: "divisor" }, magnitude: (c) => num("refineSpeedMult")(c) - 1, tolerance: 1 }));
      else if ("storageCapMult" in eff) {
        // WR-4 (OC-C2, B7): Warehouse T2's Dense Ore rungs are reachable (the Lunar Mine Contract mines Dense Ore).
        const tier = fkey === "warehouseT2" ? 2 : 1;
        out.push(
          entry({
            ...common,
            probe: tier === 2 ? "tier2Cap" : "tier1Cap",
            contexts: ["facility"],
            curve: { kind: "linearRelative" },
            magnitude: (c) => num("storageCapMult")(c) - 1,
          }),
        );
      } else if ("addResearchSlots" in eff) out.push(entry({ ...common, probe: "researchSlots", contexts: ["research"], magnitude: num("addResearchSlots") }));
      else if ("addFabricateSlots" in eff) out.push(entry({ ...common, probe: "fabricateSlots", contexts: ["craft"], magnitude: num("addFabricateSlots") }));
      else if ("buildSpeedMult" in eff)
        out.push(entry({ ...common, probe: "shipBuildTicks", contexts: ["shipyard"], direction: "down", curve: { kind: "divisor" }, magnitude: (c) => num("buildSpeedMult")(c) - 1 }));
      else if ("addShipyardBays" in eff) out.push(entry({ ...common, probe: "shipyardBays", contexts: ["shipyard"], magnitude: num("addShipyardBays") }));
      else if ("addSalvageSlots" in eff) out.push(entry({ ...common, probe: "salvageLanes", contexts: ["salvage"], magnitude: num("addSalvageSlots") }));
      // G1-3: a Mission Control board rung opens one short-range slot. G1-6 flipped SHORT_RANGE_BOARD_LIVE, so both rungs
      // are in FACILITIES and enumerate here (facility:FACILITIES:missionControl:1 and :2); the level 2 rung's
      // completion gate is facility:audit:missionControlUnlock's check.
      else if ("addShortRangeSlot" in eff) out.push(entry({ ...common, probe: "shortRangeSlots", contexts: ["mission:shortRange"], magnitude: () => 1 }));
      else if ("telescope" in eff) {
        const t = eff.telescope as { detail: number; reachTier: number };
        const prev = i > 0 ? ((fdef.upgrades[i - 1].effect as unknown as { telescope: { detail: number; reachTier: number } }).telescope) : { detail: 0, reachTier: 0 };
        const detailMoves = t.detail !== prev.detail;
        // G2-6: a rung that only moves the reach tier is live on the region picker (the tiers whose candidates the
        // console reads instead of launching blind); a detail rung reads its detail (information only, by design).
        out.push(
          entry({
            ...common,
            probe: detailMoves ? "telescopeDetail" : "telescopeReach",
            contexts: detailMoves ? ["expedition:groundOps"] : ["facility", "expedition:groundOps"],
            magnitude: () => (detailMoves ? t.detail - prev.detail : t.reachTier - prev.reachTier),
            status: LIVE,
            note: detailMoves
              ? "detail is information only (by design); its reach tier reads on the SUBSPACE_TELESCOPE_LEVELS entries"
              : "the reach tier: the deepest region tier whose candidates the console's picker reads (G2-6)",
          }),
        );
      } else if ("unlocksContent" in eff) {
        if (fkey === "missionControl")
          out.push(
            entry({
              ...common,
              probe: "missionsUnlocked",
              contexts: ["mission:extraction"],
              curve: { kind: "gate" },
              magnitude: (c) => Object.values(c.MISSIONS).filter((m) => m.unlockLevel === i + 1).length,
            }),
          );
        else if (fkey === "shipyard") out.push(entry({ ...common, probe: "shipyardFounded", contexts: ["shipyard"], curve: { kind: "gate" }, magnitude: () => 1 }));
        else out.push(entry({ ...common, status: pending("WR-1 follow-up: unlocksContent on an unknown facility") }));
      } else out.push(entry({ ...common, status: pending("WR-1 follow-up: unclassified rung effect") }));
    });
  }
  // The research tier gate rides the level itself (blueprintResearchable), and the Works Directorate gate rides
  // requiresHomeworldTalents; both are gates, covered by the rung entries above and the talent entry.
  return out;
}

function trackEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  EQUIPMENT_STORAGE_RUNGS.forEach((r, i) =>
    out.push(
      entry({
        id: `facility:EQUIPMENT_STORAGE_RUNGS:${i}`,
        system: "facility",
        source: { catalog: "EQUIPMENT_STORAGE_RUNGS", key: String(i) },
        claim: `Equipment storage rung ${i + 1}: +${r.slotIncrement} slots`,
        probe: "equipmentStorage",
        contexts: ["facility"],
        magnitude: (c) => c.EQUIPMENT_STORAGE_RUNGS[i].slotIncrement,
        on: (s) => ({ ...s, equipmentStorageLevel: i + 1 }),
        off: (s) => ({ ...s, equipmentStorageLevel: i }),
      }),
    ),
  );
  SHIP_DOCKS_RUNGS.forEach((_r, i) =>
    out.push(
      entry({
        id: `facility:SHIP_DOCKS_RUNGS:${i}`,
        system: "facility",
        source: { catalog: "SHIP_DOCKS_RUNGS", key: String(i) },
        claim: `Ship docks rung ${i + 1}: +1 dock`,
        probe: "dockRoom",
        contexts: ["shipyard"],
        curve: { kind: "gate" },
        magnitude: () => 1,
        // A founded Shipyard and a fleet that fills the docks at this rung's capacity.
        base: () => {
          const s = withFacilityLevel(wiringBase(), "shipyard", 1);
          const cap = SHIP_DOCKS_BASE + i;
          const extra = Array.from({ length: cap - s.ships.length }, (_, k) => ({ ...s.ships[0], id: `ship-${100 + k}`, assignedCaptainId: null }));
          return { ...s, ships: [...s.ships, ...extra], shipStorageCapacity: cap };
        },
        on: (s) => ({ ...s, shipStorageCapacity: s.shipStorageCapacity + 1 }),
      }),
    ),
  );
  TRANSIT_BERTH_RUNGS.forEach((_r, i) =>
    out.push(
      entry({
        id: `facility:TRANSIT_BERTH_RUNGS:${i}`,
        system: "facility",
        source: { catalog: "TRANSIT_BERTH_RUNGS", key: String(i) },
        claim: `Transit berth rung ${i + 1}: +1 berth`,
        probe: "berths",
        contexts: ["mission:extraction"],
        magnitude: () => 1,
        on: (s) => ({ ...s, transitBerthCapacity: i + 1 }),
        off: (s) => ({ ...s, transitBerthCapacity: i }),
      }),
    ),
  );
  // The Subspace Telescope ladder, rung by rung: the reading reaches the rung's region tier and reads its detail.
  // Since G2-6 the console's region picker offers every tier, so the reach is live at Ground Ops too: it decides the
  // deepest tier whose candidates the console reads (probes.ts telescopeReach there), not only the card's line.
  for (const row of SUBSPACE_TELESCOPE_LEVELS) {
    const at = (s: GameState) => withFacilityLevel(s, SUBSPACE_TELESCOPE_FACILITY_KEY, row.level);
    const below = (s: GameState) => withFacilityLevel(s, SUBSPACE_TELESCOPE_FACILITY_KEY, row.level - 1);
    const value = (field: "reachTier" | "detail") => (c: Catalogs) => c.SUBSPACE_TELESCOPE_LEVELS.find((r) => r.level === row.level)![field];
    out.push(
      entry({
        id: `facility:SUBSPACE_TELESCOPE_LEVELS:${row.level}:reachTier`,
        system: "facility",
        source: { catalog: "SUBSPACE_TELESCOPE_LEVELS", key: `${row.level}:reachTier` },
        claim: `Telescope level ${row.level} reaches region tier ${row.reachTier}`,
        probe: "telescopeReach",
        // G2-6: the console's region picker reads every tier, so the reach tier decides which tiers' candidates read
        // (risk, objectives) and which launch blind.
        contexts: ["facility", "expedition:groundOps"],
        direction: "none",
        curve: { kind: "equals" },
        magnitude: value("reachTier"),
        on: at,
        off: below,
      }),
      entry({
        id: `facility:SUBSPACE_TELESCOPE_LEVELS:${row.level}:detail`,
        system: "facility",
        source: { catalog: "SUBSPACE_TELESCOPE_LEVELS", key: `${row.level}:detail` },
        claim: `Telescope level ${row.level} reads detail ${row.detail}`,
        probe: "telescopeDetail",
        contexts: ["expedition:groundOps"],
        direction: "none",
        curve: { kind: "equals" },
        magnitude: value("detail"),
        on: at,
        off: below,
        note: "detail is information only (by design)",
      }),
    );
  }
  return out;
}

// The owner of a hidden refine recipe: the reserve on its output, or on the first reserved good its output feeds
// (Ferrite Ingot -> Osmium Plate, owner ML-2).
function hiddenRecipeOwner(itemId: string, seen: Set<string> = new Set()): string {
  const reserved = ITEMS[itemId]?.reserved;
  if (reserved !== undefined) return reserved;
  seen.add(itemId);
  for (const r of Object.values(REFINE_RECIPES)) {
    if (r.input[itemId] === undefined || seen.has(r.output.itemId)) continue;
    const owner = hiddenRecipeOwner(r.output.itemId, seen);
    if (!owner.startsWith("WR-1 follow-up")) return owner;
  }
  return "WR-1 follow-up: a hidden refine recipe with no reserved output";
}

// Content data the engine reads verbatim: refine recipes (the job's duration) and blueprints (the research project's).
function recipeAndBlueprintEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  for (const [key, r] of Object.entries(REFINE_RECIPES)) {
    out.push(
      entry({
        id: `facility:REFINE_RECIPES:${key}`,
        system: "facility",
        source: { catalog: "REFINE_RECIPES", key },
        claim: `Refine ${r.output.itemId}`,
        probe: `content:refine:${key}`,
        contexts: ["facility"],
        direction: "none",
        curve: { kind: "equals" },
        magnitude: (c) => c.REFINE_RECIPES[key].durationTicks,
        note: "inputs and output ride the refine tests; the duration reaches the started job (Refinery speed 1)",
        // ML-1: a recipe the Refinery does not offer yet (its output leads nowhere: model.ts refineRecipeOffered) is
        // pending on the slice that gives its output a use (no probe: the engine refuses to start it, so there is
        // nothing to measure); it reads live, probe and all, by itself once that marker drops.
        ...(refineRecipeOffered(key) ? {} : { probe: undefined, contexts: [], status: pending(hiddenRecipeOwner(r.output.itemId)) }),
      }),
    );
  }
  for (const key of Object.keys(BLUEPRINTS)) {
    out.push(
      entry({
        id: `facility:BLUEPRINTS:${key}`,
        system: "facility",
        source: { catalog: "BLUEPRINTS", key },
        claim: `Blueprint ${key}: research time, cost and Lab tier`,
        probe: `content:research:${key}`,
        contexts: ["research"],
        direction: "none",
        curve: { kind: "equals" },
        magnitude: (c) => c.BLUEPRINTS[key].researchDurationTicks,
        note: "the research time reaches the started project (no museum); cost and Lab tier are the start gates",
      }),
    );
  }
  // Field Kits FKR-3: a field kit blueprint's craft deposits its kits (the output count reaches the inventory). The
  // kit's battle use stays pending on its own entry (away:FIELD_KITS:<id>, owner FKR-6).
  for (const id of FIELD_KIT_IDS) {
    const key = FIELD_KIT_BLUEPRINT[id];
    out.push(
      entry({
        id: `facility:BLUEPRINTS:${key}:craft`,
        system: "facility",
        source: { catalog: "BLUEPRINTS", key: `${key}:craft` },
        claim: `${FIELD_KITS[id].label} Blueprint: a craft deposits its kits`,
        probe: `content:craft:${key}`,
        contexts: ["craft"],
        direction: "none",
        curve: { kind: "equals" },
        magnitude: (c) => c.BLUEPRINTS[key].recipe.outputQty ?? 0,
        note: "one craft at a built Fabricator, researched and holding the inputs: the kits it leaves in the inventory",
      }),
    );
  }
  return out;
}

// ============================================================================
// ship: gear lines, hull fields, slots, modules, arrays, utility suites
// ============================================================================

const SHIP_PIECE_FOR: Readonly<Record<string, { slotType: string; moduleVariant?: string }>> = {
  cargoCapacity: { slotType: "cargoBay" },
  transitSpeedMult: { slotType: "ftlDrive" },
  engineEfficiency: { slotType: "ftlDrive" },
  fuelCapacity: { slotType: "ftlDrive" },
  extractionYieldMult: { slotType: "specUtility" },
  powerOutput: { slotType: "reactorCore" },
  powerDrawReduction: { slotType: "reactorCore" },
  massReduction: { slotType: "cargoBay" },
  sensors: { slotType: "sensor", moduleVariant: "sensorBalanced" },
  materialQualityChance: { slotType: "specUtility" },
  shieldCapacity: { slotType: "shieldEmitters" },
  shieldRecharge: { slotType: "shieldEmitters" },
  shieldCoherence: { slotType: "shieldEmitters" },
  hullStrength: { slotType: "hullPlating" },
  ablativeArmor: { slotType: "hullPlating" },
  kineticDampening: { slotType: "hullPlating" },
  crewStations: { slotType: "quarters", moduleVariant: "quartersUtilitarian" },
  crewEfficiency: { slotType: "bridge", moduleVariant: "bridgeBalancedCommand" },
  colonistCapacity: { slotType: "quarters", moduleVariant: "quartersGuestWing" },
  repairSpeed: { slotType: "specUtility", moduleVariant: "damageControlSuite" },
  waveHullRegen: { slotType: "specUtility", moduleVariant: "damageControlSuite" },
  expeditionScanSpeed: { slotType: "specUtility", moduleVariant: "pathfinderSuite" },
  hazardResist: { slotType: "specUtility", moduleVariant: "pathfinderSuite" },
  weaponYield: { slotType: "weapon" },
  weaponAccuracy: { slotType: "weapon" },
  droneHp: { slotType: "droneBay" },
  droneAccuracy: { slotType: "droneBay" },
  // WR-8 (0.14.0, OC-D12): the per-family resist lines and the drone pod counter lines.
  damageResist_kinetic: { slotType: "hullPlating" },
  damageResist_particle: { slotType: "hullPlating" },
  damageResist_ew: { slotType: "hullPlating" },
  disruptionResist_kinetic: { slotType: "shieldEmitters" },
  disruptionResist_particle: { slotType: "shieldEmitters" },
  disruptionResist_ew: { slotType: "shieldEmitters" },
  droneInCombatReplenish: { slotType: "droneBay" },
  droneSmartReflect: { slotType: "droneBay" },
};

const LINE_POINTS = 20;

// plusToPercent (model.ts): the percent curve every percent line runs on.
function plusToPercent(p: number, b: number, r: number): number {
  return p <= 0 ? 0 : (b * (1 - Math.pow(r, p))) / (1 - r);
}

interface LineSeam {
  probe: ProbeId;
  contexts: ContextId[];
  curve: Curve;
  magnitude: (c: Catalogs) => number;
  base?: () => GameState;
  tolerance?: number;
  where?: "implicit" | "rolled";
}

// What each ship gear line moves (the fold in model.ts equipmentStatMods / shipDerivedStats, the combat bridge,
// the utility suite readers). The percent lines run on PERCENT_STAT_CURVES (plusToPercent); flat lines add.
function percent(key: string): number {
  const c = PERCENT_STAT_CURVES[key];
  return plusToPercent(LINE_POINTS / c.plusDivisor, c.B, c.r);
}
const LINE_SEAMS: Readonly<Record<string, LineSeam | null>> = {
  cargoCapacity: { probe: "sheetCargo", contexts: ["sheet"], curve: { kind: "linearAbsolute" }, magnitude: () => LINE_POINTS },
  fuelCapacity: { probe: "sheetFuelCapacity", contexts: ["sheet"], curve: { kind: "linearAbsolute" }, magnitude: () => LINE_POINTS },
  sensors: { probe: "sheetSensors", contexts: ["sheet"], curve: { kind: "linearAbsolute" }, magnitude: () => LINE_POINTS },
  // G1-1: a guest line is stored in berths and adds them flat. Measured on an Orion (an explorer: the General quarters
  // perk would multiply both readings, which is its own entry, ship:SHIP_SEAMS:generalQuartersGuestPerk).
  // G1-4: and the guest quarters a short-range sheet judges (mission:shortRange, shortRangeShipRatings).
  colonistCapacity: { probe: "sheetGuestQuarters", contexts: ["sheet", "mission:shortRange"], curve: { kind: "linearAbsolute" }, magnitude: () => LINE_POINTS, base: () => wiringBase("orion") },
  // Expedition Tiers G2-3: the voyage flies each leg at the ship's own speed on it (the run freezes it).
  engineEfficiency: { probe: "sheetEngineEff", contexts: ["sheet"], curve: { kind: "linearAbsolute" }, magnitude: () => percent("engineEfficiency") },
  extractionYieldMult: { probe: "sheetYield", contexts: ["sheet"], curve: { kind: "linearRelative" }, magnitude: () => percent("extractionYieldMult") },
  massReduction: null, // consumed at mint (itemgen.ts:425): measured below as its own entry on the piece's mass
  // E-MOD EM-1: a Reactor Core's powerOutput line adds to the ship's power output (on top of the hull's own, P1).
  powerOutput: { probe: "sheetPowerOutput", contexts: ["sheet"], curve: { kind: "linearAbsolute" }, magnitude: () => LINE_POINTS },
  powerDrawReduction: null, // consumed at mint like massReduction: measured below as its own entry on the piece's draw
  // Material Lines ML-3 (OC-D2): the line's points become the chance a delivered unit climbs one quality step
  // (materialQuality.ts): a delivery climbs floor(amount x p) units plus one keyed rounding roll, so the share that
  // climbed is p to within one unit of the haul.
  materialQualityChance: {
    probe: "missionOreQuality",
    contexts: ["mission:extraction"],
    curve: { kind: "chanceAbsolute" },
    magnitude: () => materialQualityClimbChance(LINE_POINTS),
    tolerance: 0.02,
  },
  // An emitter's raw lines scale by the hull's shield effectiveness (bridge.ts hullDefenseComposition).
  shieldCapacity: {
    probe: "combatShieldMax",
    contexts: ["patrol"],
    curve: { kind: "linearAbsolute" },
    magnitude: (c) => LINE_POINTS * hullDefenseComposition(c.SHIP_TYPES.destroyer).shieldCapEffectiveness,
    base: () => combatBase(),
    tolerance: 1,
  },
  shieldRecharge: {
    probe: "combatShieldRecharge",
    contexts: ["patrol"],
    curve: { kind: "linearAbsolute" },
    magnitude: (c) => LINE_POINTS * hullDefenseComposition(c.SHIP_TYPES.destroyer).shieldRechargeEffectiveness,
    base: () => combatBase(),
    tolerance: 1,
  },
  hullStrength: { probe: "combatHullMax", contexts: ["patrol"], curve: { kind: "linearAbsolute" }, magnitude: () => LINE_POINTS, base: () => combatBase(), tolerance: 1 },
  shieldCoherence: { probe: "combatShieldCoherence", contexts: ["patrol"], curve: { kind: "linearAbsolute" }, magnitude: () => LINE_POINTS, base: () => combatBase(), where: "rolled" },
  ablativeArmor: { probe: "combatAblativeArmor", contexts: ["patrol"], curve: { kind: "linearAbsolute" }, magnitude: () => LINE_POINTS, base: () => combatBase(), where: "rolled" },
  kineticDampening: { probe: "combatKineticDampening", contexts: ["patrol"], curve: { kind: "linearAbsolute" }, magnitude: () => LINE_POINTS, base: () => combatBase(), where: "rolled" },
  repairSpeed: { probe: "dcRepairReduction", contexts: ["shipyard"], curve: { kind: "linearAbsolute" }, magnitude: () => plusToPercent(LINE_POINTS, DC_REPAIR_SPEED_B, DC_REPAIR_SPEED_R) },
  waveHullRegen: { probe: "waveHullRegen", contexts: ["patrol"], curve: { kind: "linearAbsolute" }, magnitude: () => plusToPercent(LINE_POINTS, DC_WAVE_REGEN_B, DC_WAVE_REGEN_R) },
  expeditionScanSpeed: { probe: "pathfinderScan", contexts: ["expedition:groundOps"], curve: { kind: "linearAbsolute" }, magnitude: () => plusToPercent(LINE_POINTS, PF_SCAN_SPEED_B, PF_SCAN_SPEED_R) },
  hazardResist: { probe: "pathfinderHazard", contexts: ["expedition:groundOps"], curve: { kind: "linearAbsolute" }, magnitude: () => plusToPercent(LINE_POINTS, PF_HAZARD_RESIST_B, PF_HAZARD_RESIST_R) },
  weaponYield: { probe: "combatWeaponYield", contexts: ["patrol"], curve: { kind: "linearAbsolute" }, magnitude: () => LINE_POINTS, base: () => combatBase() },
  weaponAccuracy: { probe: "combatWeaponAccuracy", contexts: ["patrol"], curve: { kind: "linearAbsolute" }, magnitude: () => LINE_POINTS, base: () => combatBase(), where: "rolled" },
  droneHp: { probe: "combatDroneHp", contexts: ["patrol"], curve: { kind: "linearAbsolute" }, magnitude: () => LINE_POINTS, base: () => combatBase("carrier") },
  droneAccuracy: { probe: "combatDroneAccuracy", contexts: ["patrol"], curve: { kind: "linearAbsolute" }, magnitude: () => LINE_POINTS, base: () => combatBase("carrier"), where: "rolled" },
  // WR-8 (0.14.0, OC-D12 "Feed them all"): the per-family resist lines become a percent on the D23 curve
  // (combatRules.ts familyResistPercent), read off the installed plating (damage) and emitter (disruption), in the
  // patrol fold and the ship events' (the same shipToCombatant).
  damageResist_kinetic: resistSeam("combatDamageResistKinetic"),
  damageResist_particle: resistSeam("combatDamageResistParticle"),
  damageResist_ew: resistSeam("combatDamageResistEw"),
  disruptionResist_kinetic: resistSeam("combatDisruptionResistKinetic"),
  disruptionResist_particle: resistSeam("combatDisruptionResistParticle"),
  disruptionResist_ew: resistSeam("combatDisruptionResistEw"),
  // The drone pod counter lines on combatRules.ts podLineShare: a whole percent of in-combat replenish, a whole percent
  // of Smart Reflect chance. (Rapid Charge is out of the pool: ship:wr8:podRapidChargeLine, deferred.)
  droneInCombatReplenish: { probe: "combatInCombatReplenish", contexts: ["patrol"], curve: { kind: "linearAbsolute" }, magnitude: () => Math.round(100 * podLineShare(LINE_POINTS)), base: () => combatBase("carrier"), where: "rolled" },
  droneSmartReflect: { probe: "combatSmartReflectChance", contexts: ["patrol"], curve: { kind: "linearAbsolute" }, magnitude: () => Math.round(100 * podLineShare(LINE_POINTS)), base: () => combatBase("carrier"), where: "rolled" },
};
function resistSeam(probe: ProbeId): LineSeam {
  return { probe, contexts: ["patrol", "shipEvent"], curve: { kind: "linearAbsolute" }, magnitude: () => familyResistPercent(LINE_POINTS), base: () => combatBase(), where: "rolled" };
}

const LINE_PENDING: Readonly<Record<string, { owner: string; probe?: ProbeId; contexts?: ContextId[] }>> = {
  crewStations: { owner: "WR-7, OC-D3 (the tooltip prints the rolled value; nothing reads it)", probe: "quartersCapacity", contexts: ["sheet"] },
  crewEfficiency: { owner: "WR-7, OC-D3 (the tooltip prints the rolled value; nothing reads it)", probe: "sheetUnload", contexts: ["sheet"] },
};

// Install a ship piece carrying `points` of `key` (on the right slot and line), on ship-1.
function shipPiece(key: string, points: number): Transform {
  const at = SHIP_PIECE_FOR[key];
  const seam = LINE_SEAMS[key];
  const where = seam?.where ?? "implicit";
  return (s) => {
    const ship = s.ships[0];
    const existing = s.equipment.find((e) => e.fittedToShipId === ship.id && e.slotType === at.slotType);
    const lines = points === 0 ? {} : { [key]: points };
    if (existing && (at.slotType === "weapon" || at.slotType === "droneBay" || at.slotType === "hullPlating" || at.slotType === "shieldEmitters")) {
      // Keep the installed combat piece's own lines (its Standard Issue base) and add the tested line.
      const implicitStats = where === "implicit" ? { ...existing.implicitStats, [key]: (existing.implicitStats[key] ?? 0) + points } : existing.implicitStats;
      const rolledStats = where === "rolled" ? { ...existing.rolledStats, [key]: (existing.rolledStats[key] ?? 0) + points } : existing.rolledStats;
      return { ...s, equipment: s.equipment.map((e) => (e.id === existing.id ? { ...e, implicitStats, rolledStats } : e)) };
    }
    return installPiece(s, {
      slotType: at.slotType,
      ...(at.moduleVariant ? { moduleVariant: at.moduleVariant } : {}),
      implicitStats: where === "implicit" ? lines : {},
      rolledStats: where === "rolled" ? lines : {},
    });
  };
}

// Every line key a ship piece can roll: the ship slots' pools and varieties, plus the weapon and pod pools.
export function shipRollableLineKeys(): Set<string> {
  const keys = new Set<string>();
  for (const [slotType, slot] of Object.entries(EQUIPMENT_SLOTS)) {
    if ((MEMBER_SLOT_TYPES as readonly string[]).includes(slotType)) continue;
    for (const k of slot.implicitStats) keys.add(k);
    for (const a of slot.affixPool) keys.add(a.stat);
    for (const v of slot.varieties) {
      for (const k of v.implicitStats ?? []) keys.add(k);
      for (const a of v.affixPool ?? []) keys.add(a.stat);
    }
  }
  keys.add(WEAPON_IMPLICIT_STAT);
  for (const a of WEAPON_AFFIX_POOL) keys.add(a.stat);
  keys.add(DRONE_POD_IMPLICIT_STAT);
  for (const a of DRONE_POD_AFFIX_POOL) keys.add(a.stat);
  return keys;
}

function shipLineEntries(): WiringEntry[] {
  const keys = [...new Set([...LIVE_STAT_KEYS, ...shipRollableLineKeys()])];
  return keys.map((key) => {
    const seam = LINE_SEAMS[key];
    const p = LINE_PENDING[key];
    const common = {
      id: `ship:gearLine:${key}`,
      system: "ship" as const,
      source: { catalog: "SHIP_GEAR_LINES", key },
      claim: `Ship gear line ${key}`,
      on: shipPiece(key, LINE_POINTS),
      off: shipPiece(key, 0),
    };
    if (key === "massReduction") {
      return entry({
        ...common,
        probe: "sheetTransit",
        contexts: ["sheet"],
        direction: "up",
        // The line (consumed at mint into piece.mass) takes LINE_POINTS off a piece of mass MASS_PIECE, the bare
        // hull's only mass: the speed factor's drag drops exactly by that much.
        curve: { kind: "massDrag", drag: MASS_SPEED_DRAG, massOff: MASS_PIECE },
        magnitude: () => LINE_POINTS,
        base: bareHull,
        on: (s) => installPiece(s, { slotType: "cargoBay", mass: MASS_PIECE - LINE_POINTS }),
        off: (s) => installPiece(s, { slotType: "cargoBay", mass: MASS_PIECE }),
        note: "consumed at mint (itemgen.ts:425) into the piece's mass; measured as the lighter piece's speed",
      });
    }
    if (key === "powerDrawReduction") {
      // E-MOD EM-1: the line (consumed at mint into piece.powerDraw, itemgen.ts) takes LINE_POINTS off a powered piece:
      // the ship's power draw drops by exactly that much.
      return entry({
        ...common,
        probe: "sheetPowerDraw",
        contexts: ["sheet"],
        direction: "down",
        curve: { kind: "linearAbsolute" },
        magnitude: () => -LINE_POINTS,
        base: bareHull,
        on: (s) => installPiece(s, { slotType: "reactorCore", powerDraw: POWER_PIECE - LINE_POINTS }),
        off: (s) => installPiece(s, { slotType: "reactorCore", powerDraw: POWER_PIECE }),
        note: "consumed at mint (itemgen.ts) into the piece's powerDraw; measured as the leaner piece's draw",
      });
    }
    if (p) return entry({ ...common, probe: p.probe, status: pending(p.owner, p.contexts) });
    if (!seam) return entry({ ...common, status: pending("WR-1 follow-up: no seam probe for this ship line") });
    // The patrol checks fly a combat hull (a freighter cannot patrol, so its patrol reading would be vacuous).
    // WR-8: transit speed now reaches a patrol's combat speed (ship:audit:derivedStatsInCombat), so its pending patrol
    // context is the legs alone (patrolOutboundTicks).
    const patrolOnCombat: Partial<Record<ContextId, FlatCheck>> = {
      patrol: { base: () => combatBase(), ...(key === "transitSpeedMult" ? { probe: "patrolOutboundTicks" as ProbeId } : {}) },
    };
    const partial: Readonly<Record<string, WiringStatus>> = {
      cargoCapacity: pending("WR-7, OC-D8 (expeditions and patrols do not read the hold)", ["expedition:groundOps", "patrol"]),
      transitSpeedMult: pending("WR-7, OC-D8 (patrol legs are fixed)", ["patrol"]),
      fuelCapacity: pending("G2-4 (no expedition range gate)", ["expedition:groundOps"]),
      engineEfficiency: pending("G2-4 (no expedition range gate)", ["expedition:groundOps"]),
      sensors: { kind: "deferred", owner: "CP-15 (patrol cloak detection)", userRef: `${T3}: patrol cloak detection`, contexts: ["patrol"] },
      repairSpeed: pending("WR-7, OC-D10 (not Ground Ops field repair)", ["expedition:groundOps"]),
    };
    return entry({
      ...common,
      probe: seam.probe,
      contexts: seam.contexts,
      curve: seam.curve,
      magnitude: seam.magnitude,
      tolerance: seam.tolerance,
      ...(seam.base ? { base: seam.base } : {}),
      status: partial[key] ?? LIVE,
      ...(claimsPatrol(partial[key]) ? { flatChecks: patrolOnCombat } : {}),
    });
  });
}

const MASS_PIECE = 30; // the massReduction fixture's piece mass (the bare hull carries no other mass)
const POWER_PIECE = 30; // the powerDrawReduction fixture's piece draw (the bare hull draws nothing else)
const claimsPatrol = (st: WiringStatus | undefined): boolean => (st?.kind === "pending" || st?.kind === "deferred") && (st.contexts ?? []).includes("patrol");
const bareHull = (): GameState => {
  const s = wiringBase();
  return { ...s, equipment: s.equipment.filter((e) => e.fittedToShipId !== "ship-1") };
};

// Hull fields: each numeric ShipTypeDef field of each hull reaches its consumer verbatim (a bare hull's sheet,
// its Standard Issue combat fold, its slot counts).
const HULL_FIELD_PROBES: Readonly<Record<string, ProbeId>> = {
  cargoCapacity: "sheetCargo",
  transitSpeedMult: "sheetTransit",
  extractionYieldMult: "sheetYield",
  fuelCapacity: "sheetFuelCapacity",
  engineEfficiency: "sheetEngineEff",
};
const HULL_FIELD_PENDING: Readonly<Record<string, string>> = {
  // (E-MOD EM-7 took `moduleSlots` live: the module slot is shown since UNIVERSAL_MODULES_LIVE, see hullEntries.)
  equipmentSlots: "WR-7, OC-C4 (a forward bucket; 0 on every hull)",
};

function hullEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  const hullEntry = (hull: ShipTypeKey, field: string, e: Partial<EntryInput>) =>
    entry({
      id: `ship:SHIP_TYPES:${hull}:${field}`,
      system: "ship",
      source: { catalog: "SHIP_TYPES", key: `${hull}:${field}` },
      claim: `${SHIP_TYPES[hull].label} ${field}`,
      direction: "none",
      curve: { kind: "equals" },
      ...e,
    } as EntryInput);
  for (const hull of Object.keys(SHIP_TYPES) as ShipTypeKey[]) {
    const combat = combatHullTypeOf(hull) !== null; // only a combat hull can patrol, so only it claims the patrol
    for (const field of ["cargoCapacity", "transitSpeedMult", "extractionYieldMult", "fuelCapacity", "engineEfficiency"] as const) {
      // Expedition Tiers G2-3: the hull's speed reaches the expedition voyage (the run freezes it as each leg's speed).
      const transit = field === "transitSpeedMult";
      out.push(
        hullEntry(hull, field, {
          probe: HULL_FIELD_PROBES[field],
          contexts: transit ? ["sheet", "expedition:groundOps"] : ["sheet"],
          magnitude: (c) => c.SHIP_TYPES[hull][field],
          base: () => {
            // A bare hull: no installed gear, so the sheet is the hull's own number.
            const s = wiringBase(hull);
            return { ...s, equipment: s.equipment.filter((e) => e.fittedToShipId !== "ship-1") };
          },
          status:
            field === "cargoCapacity"
              ? pending("WR-7, OC-D8 (missions only)", combat ? ["expedition:groundOps", "patrol"] : ["expedition:groundOps"])
              : transit
                ? combat
                  ? pending("WR-7, OC-D8 (patrol legs are fixed)", ["patrol"])
                  : LIVE
                : field === "fuelCapacity" || field === "engineEfficiency"
                  ? pending("G2-4 (no expedition reach gate)", ["expedition:groundOps"])
                  : LIVE,
          // A hull field reaches a run or a patrol only through the sheet stat it seeds: the flat checks raise that
          // same stat with a gear line on the hull (patrols fly the hull with its combat baseline installed).
          ...(field === "extractionYieldMult" || (transit && !combat)
            ? {}
            : {
                flatChecks: {
                  ...(transit ? {} : { "expedition:groundOps": { on: shipPiece(field, LINE_POINTS), off: identity } }),
                  // WR-8: a transit flat check reads the patrol legs alone (combat speed reads transit speed now).
                  ...(combat && (field === "cargoCapacity" || transit)
                    ? { patrol: { base: () => combatBase(hull), on: shipPiece(field, LINE_POINTS), off: identity, ...(transit ? { probe: "patrolOutboundTicks" as ProbeId } : {}) } }
                    : {}),
                },
              }),
        }),
      );
    }
    // The defense pools: a Standard Issue plating and emitter fold to the hull's authored numbers exactly
    // (bridge.ts hullDefenseComposition). A combat hull gets its full baseline; any other hull the two pieces.
    const defenseBase = () => {
      const s = combatBase(hull);
      const withPlating = s.equipment.some((e) => e.fittedToShipId === "ship-1" && e.slotType === "hullPlating")
        ? s
        : installPiece(s, { slotType: "hullPlating", implicitStats: { hullStrength: SI_PLATING_HP } });
      return withPlating.equipment.some((e) => e.fittedToShipId === "ship-1" && e.slotType === "shieldEmitters")
        ? withPlating
        : installPiece(withPlating, { slotType: "shieldEmitters", implicitStats: { shieldCapacity: SI_EMITTER_CAP, shieldRecharge: SI_EMITTER_RECHARGE } });
    };
    for (const [field, probe] of [
      ["hullIntegrity", "combatHullMax"],
      ["shieldCapacity", "combatShieldMax"],
      ["shieldRecharge", "combatShieldRecharge"],
    ] as const) {
      out.push(
        hullEntry(hull, field, {
          probe,
          contexts: ["patrol", "shipEvent"],
          magnitude: (c) => c.SHIP_TYPES[hull][field],
          base: defenseBase,
          tolerance: 0.5,
        }),
      );
    }
    out.push(
      hullEntry(hull, "weaponHardpoints", {
        probe: `content:loadoutSlots:${hull}:weapon`,
        contexts: ["patrol"],
        magnitude: (c) => c.SHIP_TYPES[hull].weaponHardpoints,
        note: "the Armory and install gate offer one weapon slot per hardpoint",
      }),
      ...(SHIP_TYPES[hull].droneBays === undefined
        ? []
        : [
            hullEntry(hull, "droneBays", {
              probe: `content:loadoutSlots:${hull}:droneBay`,
              contexts: ["patrol"],
              magnitude: (c) => c.SHIP_TYPES[hull].droneBays ?? 0,
            }),
          ]),
      hullEntry(hull, "groundSquads", {
        probe: `content:groundTeams:${hull}`,
        contexts: ["expedition:groundOps"],
        magnitude: (c) => Math.floor((c.SHIP_TYPES[hull].groundSquads ?? 0) / 2),
        note: "two squads make one ground team (groundTeamCount)",
      }),
      // E-MOD EM-1 (P1): the hull's own power generation, read verbatim off its bare sheet's power output.
      hullEntry(hull, "basePowerOutput", {
        probe: "sheetPowerOutput",
        contexts: ["sheet"],
        magnitude: (c) => c.SHIP_TYPES[hull].basePowerOutput,
        base: () => {
          const s = wiringBase(hull);
          return { ...s, equipment: s.equipment.filter((e) => e.fittedToShipId !== "ship-1") };
        },
      }),
    );
    // E-MOD EM-7: the hull's shared module slots (modules + the Spec Utility, user M1 "Separate counts"), counted through
    // the real install gate: distinct catalog modules installed one by one on the bare hull until moduleSlotsFull.
    out.push(
      hullEntry(hull, "moduleSlots", {
        probe: `content:moduleInstalls:${hull}`,
        contexts: ["sheet"],
        magnitude: (c) => c.SHIP_TYPES[hull].moduleSlots,
        note: "canFitEquipment accepts that many distinct modules on the bare hull (no Spec Utility), then refuses moduleSlotsFull; the Armory offers the same count of module slots",
      }),
    );
    for (const field of Object.keys(HULL_FIELD_PENDING)) {
      out.push(hullEntry(hull, field, { status: pending(HULL_FIELD_PENDING[field]) }));
    }
    // G1-1: a transport-minded hull's base guest quarters, read verbatim off its bare sheet.
    if (SHIP_TYPES[hull].colonistCapacity !== undefined) {
      out.push(
        hullEntry(hull, "colonistCapacity", {
          probe: "sheetGuestQuarters",
          contexts: ["sheet", "mission:shortRange"],
          magnitude: (c) => c.SHIP_TYPES[hull].colonistCapacity ?? 0,
          base: () => {
            const s = wiringBase(hull);
            return { ...s, equipment: s.equipment.filter((e) => e.fittedToShipId !== "ship-1") };
          },
        }),
      );
    }
  }
  // G1-1: the General hull family's quarters perk, "guest quarters +10% for passenger runs": a Crew Quarters module
  // (here a Utilitarian, which carries no guest line) on the General Freighter multiplies its base berths.
  out.push(
    entry({
      id: "ship:SHIP_SEAMS:generalQuartersGuestPerk",
      system: "ship",
      source: { catalog: "SHIP_SEAMS", key: "generalQuartersGuestPerk" },
      claim: "General Quarters: guest quarters +10% for passenger runs",
      probe: "sheetGuestQuarters",
      contexts: ["sheet", "mission:shortRange"],
      curve: { kind: "linearRelative" },
      magnitude: () => GENERAL_QUARTERS_GUEST_PERK,
      on: (s) => installPiece(s, { slotType: "quarters", moduleVariant: "quartersUtilitarian" }),
      tolerance: 0.5, // whole berths
    }),
  );
  out.push(
    entry({
      id: "ship:SHIP_TYPES:sensors",
      system: "ship",
      source: { catalog: "SHIP_TYPES.missing", key: "sensors" },
      claim: "Explorer hulls carry a sensor advantage (no field exists; MISSING)",
      status: pending("CP-14 (hull base sensors, S4-B04)"),
    }),
  );
  return out;
}


// Where each division's not-yet-live complement keys would act (a division wing amplifies them too, once they do).
// (Science's Survey Aptitude and the Flight Deck's Deck Handling went live with the inert racials, 0.14.0.)
const DEAD_DIVISION_CONTEXTS: Readonly<Partial<Record<CrewProfession, ContextId[]>>> = {
  security: ["ground"], // counterInfiltration, awayTeamProtection
  medical: ["ground"], // triage (Crew Effectiveness is live since CP-2)
};

// A division wing's flat check: its division's complement carrying the division's dead key, read where the key
// claims to act (the dead key's own consumer and fixture). The wing amplifies nothing there until the key is live.
const DEAD_KEY_OF_DIVISION: Readonly<Partial<Record<CrewProfession, string>>> = {
  security: "sec.awayTeam",
  medical: "med.triage",
};
function divisionWingChecks(division: CrewProfession): Partial<Record<ContextId, FlatCheck>> {
  const buffId = DEAD_KEY_OF_DIVISION[division];
  const def = buffId ? [...Object.values(CREW_PROFESSION_BUFFS).flat()].find((d) => d.id === buffId) : undefined;
  const dead = def ? CREW_PENDING_PROBES[def.statKey] : undefined;
  if (!def || !dead) return {};
  const fixture = dead.base ?? (() => wiringBase());
  return { [dead.context]: { probe: dead.probe, base: () => withBuckets(fixture(), [bucketOf(division, def.id)]) } };
}

// CP-2: the Engineering wing is LIVE: every Engineering key it amplifies acts (Engine Tuning, Damage Control since
// CP-2, and Power Discipline since E-MOD EM-1). The Science and Flight Deck wings went live with the inert racials
// (0.14.0: Survey Aptitude's scan speed, Deck Handling's drone replenish), so every key they amplify acts too. The
// Security and Medical wings wait on CP-3's Ground Ops consumers.
const LIVE_WINGS: ReadonlySet<CrewProfession> = new Set(["operations", "engineering", "science", "flightDeck"]);
function wingPending(division: CrewProfession): WiringStatus {
  return pending(`CP-3 (the ${division} division's dead keys; its live keys move)`, DEAD_DIVISION_CONTEXTS[division] ?? ["ground"]);
}

function moduleEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  const scale = moduleEffectScale("standard", 0, "none");
  // Each module measured on an Operations complement bucket carrying Efficient Unloading (a live key), so the
  // module's division multiplier shows on the unload speed: the bonus part above 1 grows by the boost.
  const opsBase = () => withBuckets(wiringBase(), [bucketOf("operations", "ops.unloadSpeed")]);
  for (const def of QUARTERS_MODULES) {
    const boost = def.kind === "division" ? (def.division === "operations" ? def.focusBoost : def.offBoost) : def.focusBoost;
    // G1-1: a module with no effectiveness boost at all (the Guest Wing: its effect is its guest quarters line,
    // ship:gearLine:colonistCapacity) has nothing to measure on the crew; its capacity entry below still applies.
    if (def.kind === "general" && boost === 0) {
      out.push(
        entry({
          id: `ship:QUARTERS_MODULES:${def.id}`,
          system: "ship",
          source: { catalog: "QUARTERS_MODULES", key: def.id },
          claim: def.label,
          notApplicable: "no crew-effectiveness boost (focusBoost 0): its effect is its guest quarters line (ship:gearLine:colonistCapacity)",
        }),
        entry({
          id: `ship:QUARTERS_MODULES:${def.id}:capacity`,
          system: "ship",
          source: { catalog: "QUARTERS_MODULES", key: `${def.id}:capacity` },
          claim: `${def.label}: more crew berths`,
          status: pending("CP-5 + WR-7, OC-D7 (raises only the total cap; division caps still bind, B22)"),
        }),
      );
      continue;
    }
    out.push(
      entry({
        id: `ship:QUARTERS_MODULES:${def.id}`,
        system: "ship",
        source: { catalog: "QUARTERS_MODULES", key: def.id },
        claim: def.label,
        probe: "sheetUnload",
        contexts: ["sheet"],
        direction: boost >= 0 ? "up" : "down",
        curve: { kind: "bonusRelative", base: 1 },
        magnitude: () => boost * scale,
        base: opsBase,
        on: (s) => installPiece(s, { slotType: "quarters", moduleVariant: def.id }),
        status: def.kind === "division" && !LIVE_WINGS.has(def.division!) ? wingPending(def.division!) : LIVE,
        ...(def.kind === "division" && !LIVE_WINGS.has(def.division!) ? { flatChecks: divisionWingChecks(def.division!) } : {}),
        note:
          def.kind === "division" && def.division !== "operations"
            ? "measured on Operations, the OFF division (its own division boost is the same multiplier)"
            : undefined,
      }),
      entry({
        id: `ship:QUARTERS_MODULES:${def.id}:capacity`,
        system: "ship",
        source: { catalog: "QUARTERS_MODULES", key: `${def.id}:capacity` },
        claim: `${def.label}: more crew berths`,
        status: pending("CP-5 + WR-7, OC-D7 (raises only the total cap; division caps still bind, B22)"),
      }),
    );
  }
  for (const def of BRIDGE_MODULES) {
    // The bridge amplifies a seated officer's bonuses: an Operations officer carrying Cargo Optimization.
    out.push(
      entry({
        id: `ship:BRIDGE_MODULES:${def.id}`,
        system: "ship",
        source: { catalog: "BRIDGE_MODULES", key: def.id },
        claim: def.label,
        probe: "sheetCargo",
        contexts: ["sheet"],
        curve: { kind: "bonusRelative", base: SHIP_TYPES.generalFreighter.cargoCapacity },
        magnitude: (c) => c.BRIDGE_MODULES.find((b) => b.id === def.id)!.amp * scale,
        base: () => seatOfficer(wiringBase(), "operations", ["ops.cargoExpand"]),
        on: (s) => installPiece(s, { slotType: "bridge", moduleVariant: def.id }),
        note: def.kind === "flag" ? "an ensign's rank factor is 1" : def.kind === "focused" ? "Operations is a General Freighter role seat" : undefined,
      }),
    );
  }
  out.push(
    entry({
      id: "ship:EQUIPMENT_SLOTS:bridge+quarters:obtainable",
      system: "ship",
      source: { catalog: "SHIP_SEAMS", key: "bridge+quarters:obtainable" },
      claim: "Bridge and quarters modules can be built and installed",
      status: pending("CP-11, CP-12 (no blueprint makes any of the 12 modules; no install tile)"),
    }),
  );
  return out;
}

function sensorArrayEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  const fields: [keyof (typeof SENSOR_ARRAYS)[number], ProbeId][] = [
    ["scanRateMult", "expScanRateMult"],
    ["coverageWidth", "expCoverageWidth"],
    ["landmarkOddsBias", "expLandmarkBias"],
    ["undergroundPoiOddsBias", "expUndergroundBias"],
    ["relicFindBonus", "arrayRelicFind"],
    // Gas Giant Study GG-7: the Resonance Sensor Array's canister band lift (the reader the dispatch freezes).
    ["canisterBandLift", "arrayBandLift"],
  ];
  for (const def of SENSOR_ARRAYS) {
    for (const [field, probe] of fields) {
      out.push(
        entry({
          id: `ship:SENSOR_ARRAYS:${def.id}:${field}`,
          system: "ship",
          source: { catalog: "SENSOR_ARRAYS", key: `${def.id}:${field}` },
          claim: `${def.label} ${field}`,
          probe,
          contexts: ["expedition:groundOps"],
          direction: "none",
          curve: { kind: "equals" },
          magnitude: (c) => (c.SENSOR_ARRAYS.find((a) => a.id === def.id)![field] as number) * (field === "landmarkOddsBias" || field === "undergroundPoiOddsBias" || field === "relicFindBonus" || field === "canisterBandLift" ? moduleEffectScale("standard", 0, "none") : 1),
          base: () => installPiece(wiringBase(), { slotType: "sensor", moduleVariant: def.id }),
          note: field === "scanRateMult" || field === "coverageWidth" ? "the net rate is their product (B12: Focused reads faster but nets 0.78x; WR-7 OC-D11)" : undefined,
        }),
      );
    }
  }
  out.push(
    entry({
      id: "ship:sensorEffectScale",
      system: "ship",
      source: { catalog: "SHIP_SEAMS", key: "sensorEffectScale" },
      claim: "sensorArrays.ts sensorEffectScale (no caller)",
      status: pending("WR-7 (fold into the array reader or delete)"),
    }),
  );
  return out;
}

// ============================================================================
// relic: the Museum stats and the relic set tiers
// ============================================================================

const MUSEUM_SEAMS: Readonly<Record<MuseumStat, { probe: ProbeId; contexts: ContextId[]; curve: Curve; base?: () => GameState; tolerance?: number; direction?: Direction } | null>> = {
  cargoCapacity: { probe: "sheetCargo", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  transitSpeed: { probe: "sheetTransit", contexts: ["sheet", "expedition:groundOps"], curve: { kind: "linearRelative" } },
  miningYield: { probe: "sheetYield", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  sensors: { probe: "sheetSensors", contexts: ["sheet"], curve: { kind: "linearRelative" }, base: () => installPiece(wiringBase(), { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } }) },
  extractionSpeed: { probe: "sheetExtractionSpeed", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  // CP-2 (OC-E8, "Officers too"): the complement on the sheet AND an officer bonus read directly (Fleet Triage, frozen
  // on the run as squadTriage), one fixture carrying both.
  crewBonuses: {
    probe: "crewAmplified",
    contexts: ["sheet", "ground"],
    curve: { kind: "bonusRelative", base: 1 },
    base: () => withBuckets(seatOfficer(withAwayTeam(wiringBase()), "medical", ["med.fleetTriage"]), [bucketOf("operations", "ops.unloadSpeed")]),
  },
  researchSpeed: { probe: "researchTicks", contexts: ["research"], curve: { kind: "divisor" }, tolerance: 1, direction: "down" },
  craftingQuality: { probe: "craftQualityClimb", contexts: ["craft"], curve: { kind: "linearRelative" }, tolerance: 1e-12 },
  salvageYield: { probe: "salvageYield", contexts: ["salvage"], curve: { kind: "linearAbsolute" } },
  rareMaterialChance: { probe: "extractionRareThreshold", contexts: ["mission:extraction"], curve: { kind: "linearRelative" }, tolerance: 1e-9 },
  scanSpeed: { probe: "expScanSpeedBonus", contexts: ["expedition:groundOps"], curve: { kind: "linearAbsolute" } },
  relicFindChance: { probe: "expRelicFindBonus", contexts: ["expedition:groundOps"], curve: { kind: "linearAbsolute" } },
  hazardResist: { probe: "expHazardResist", contexts: ["expedition:groundOps"], curve: { kind: "linearAbsolute" } },
  scienceTeamPower: { probe: "expScienceStrength", contexts: ["fieldwork"], curve: { kind: "linearRelative" }, base: () => withBuckets(wiringBase(), [bucketOf("science", "sci.extraction")]) },
};

const MUSEUM_PARTIAL: Readonly<Partial<Record<MuseumStat, WiringStatus>>> = {
  transitSpeed: pending("OC-D8 (patrol legs are fixed; G2-3 put it on the expedition voyage)", ["patrol"]),
};

// The museum's PARTIAL checks: transit on a patrol flies a combat hull.
const MUSEUM_FLAT_CHECKS: Readonly<Partial<Record<MuseumStat, Partial<Record<ContextId, FlatCheck>>>>> = {
  transitSpeed: { patrol: { base: () => combatBase() } },
};

// A museum record that sets ONLY `stat` (one set tier at level 1), and the stat's value in it. The set's per-copy
// stat also rises with the copies; tiers whose stat is the per-copy stat count both (museumBonusesFromRecord).
function museumGrantFor(stat: MuseumStat): Record<string, number> | null {
  for (const set of RELIC_SETS) {
    for (const tier of set.tiers) {
      if (!tier.stats.includes(stat)) continue;
      const rec: Record<string, number> = {};
      for (const id of set.relicIds.slice(0, tier.pieces)) rec[id] = MUSEUM_COPY_LADDER[0];
      return rec;
    }
    if (set.perCopyStat === stat) return { [set.relicIds[0]]: 1 };
  }
  return null;
}

function museumEntries(): WiringEntry[] {
  return MUSEUM_STATS.map((stat) => {
    const seam = MUSEUM_SEAMS[stat];
    const grant = museumGrantFor(stat);
    return entry({
      id: `relic:MUSEUM_STATS:${stat}`,
      system: "relic",
      source: { catalog: "MUSEUM_STATS", key: stat },
      claim: `Museum ${stat}`,
      probe: seam?.probe,
      contexts: seam ? seam.contexts : [],
      curve: seam?.curve ?? { kind: "linearAbsolute" },
      magnitude: () => (grant ? museumBonusesFromRecord(grant)[stat] : 0),
      tolerance: seam?.tolerance,
      direction: seam?.direction ?? "up",
      ...(seam?.base ? { base: seam.base } : {}),
      on: (s) => withMuseum(s, grant ?? {}),
      off: (s) => withMuseum(s, {}),
      status: MUSEUM_PARTIAL[stat] ?? (seam && grant ? LIVE : pending("WR-1 follow-up: no grant or seam")),
      ...(MUSEUM_FLAT_CHECKS[stat] ? { flatChecks: MUSEUM_FLAT_CHECKS[stat] } : {}),
    });
  });
}

// The relic identified (its first find), as state.relicDiscovered records it.
const discovered = (relicId: string): Transform => (s) => ({ ...s, relicDiscovered: [...(s.relicDiscovered ?? []), relicId] });

function relicEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  for (const set of RELIC_SETS) {
    set.tiers.forEach((tier, ti) => {
      const stat = tier.stats[0];
      // The tier's relics at the first copy-ladder rung vs one copy short: the tier reaches level 1, plus the copies'
      // per-copy share when the tier's stat is the set's per-copy stat.
      const relics = set.relicIds.slice(0, tier.pieces);
      const at = (n: number) => Object.fromEntries(relics.map((id) => [id, n]));
      const ladder = MUSEUM_COPY_LADDER[0];
      out.push(
        entry({
          id: `relic:RELIC_SETS:${set.id}:${tier.pieces}`,
          system: "relic",
          source: { catalog: "RELIC_SETS", key: `${set.id}:${tier.pieces}` },
          claim: `${set.label} ${tier.pieces}-piece: ${tier.stats.join(" + ")}`,
          probe: `museum:${stat}`,
          contexts: ["fleet"],
          magnitude: (c) => {
            const t = c.RELIC_SETS.find((x) => x.id === set.id)!.tiers[ti];
            return MUSEUM_TIER_LEVEL_BONUS * t.magnitude + (c.RELIC_SETS.find((x) => x.id === set.id)!.perCopyStat === stat ? MUSEUM_PER_COPY_BONUS : 0);
          },
          tolerance: 1e-12,
          on: (s) => withMuseum(s, at(ladder)),
          // One copy short on the tier's LAST relic: the lower tiers stay reached, only this tier drops to level 0.
          off: (s) => withMuseum(s, { ...at(ladder), [relics[relics.length - 1]]: ladder - 1 }),
          note: "the museum stat it sets is a relic:MUSEUM_STATS entry (its consumer is proved there)",
        }),
      );
    });
  }
  for (const r of RELICS) {
    const set = RELIC_SETS.find((x) => x.relicIds.includes(r.id));
    out.push(
      entry({
        id: `relic:RELICS:${r.id}`,
        system: "relic",
        source: { catalog: "RELICS", key: r.id },
        claim: r.label,
        probe: set ? `museum:${set.perCopyStat}` : undefined,
        contexts: set ? ["fleet"] : [],
        magnitude: () => MUSEUM_PER_COPY_BONUS,
        tolerance: 1e-12,
        on: (s) => withMuseum(s, { [r.id]: 1 }),
        off: (s) => withMuseum(s, {}),
        status: r.id === "precursorLens" ? pending("E-MOD (the first find unlocks a special module, deferred to E-MOD by decision)", ["craft"]) : LIVE,
        // Its first find (the relic identified) unlocks nothing to make yet: no blueprint is gated on it.
        ...(r.id === "precursorLens" ? { flatChecks: { craft: { probe: "researchableBlueprints", on: discovered(r.id), off: identity } } } : {}),
        note: "each copy in the Museum adds its set's per-copy share",
      }),
    );
  }
  return out;
}

// Relics v2 R2-4 (plan 2026-10-17 section 4 R2-4): museum math v2 reads the v2 catalog, so each effect source is LIVE,
// measured on its Museum stat (the relic:MUSEUM_STATS entry proves that stat's consumer):
//   - a general type: one copy at Tier II moves its first stat by diminishing(share x MUSEUM_V2_PER_COPY[2], knee)
//     (Tier I copies are the relic:RELICS entries, through the v1 math Tier I keeps);
//   - each tier's per-copy value: one Hull Rivet at that tier moves cargoCapacity through the same curve;
//   - an exceptional piece: held alone it adds its flat value once (call 7: a duplicate adds nothing);
//   - a full set: every piece held vs all but the last, which moves the full-set stat by exactly the full-set bonus
//     (the last piece's stat differs: a set's pieces take distinct stats).
// No player reaches Tier II or deeper until the region picker (relic:audit:blankTiers, G2-6); the math is live.
const V2_FIXTURE_TIER: CurvedRegionTier = 2;
const SOFT_CAP_PROBE_PAST = 200;
const v2Curve = { kind: "diminishing", knee: MUSEUM_V2_KNEE, base: 0 } as const;
const withTierCopies =
  (tier: CurvedRegionTier, record: Readonly<Record<string, number>>): Transform =>
  (s) =>
    withGeneralMuseumRecord(s, record, tier);
const withPieces =
  (ids: readonly string[]): Transform =>
  (s) => ({ ...s, museumV2: { ...(s.museumV2 ?? emptyMuseumV2()), exceptional: Object.fromEntries(ids.map((id) => [id, 1])) } });

function relicV2Entries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  for (const t of RELIC_TYPES) {
    const stat = t.stats[0].stat;
    out.push(
      entry({
        id: `relic:RELIC_TYPES:${t.id}`,
        system: "relic",
        source: { catalog: "RELIC_TYPES", key: t.id },
        claim: `${t.label}: ${t.stats.map((s) => s.stat).join(" + ")} per copy, per tier`,
        probe: `museum:${stat}`,
        contexts: ["fleet"],
        curve: v2Curve,
        magnitude: (c) => c.RELIC_TYPES.find((x) => x.id === t.id)!.stats.find((x) => x.stat === stat)!.share * c.MUSEUM_V2_PER_COPY[V2_FIXTURE_TIER],
        on: withTierCopies(V2_FIXTURE_TIER, { [t.id]: 1 }),
        off: withTierCopies(V2_FIXTURE_TIER, {}),
        note: "one copy at Tier II; the museum stat it sets is a relic:MUSEUM_STATS entry (its consumer is proved there)",
      }),
    );
  }
  for (const tier of Object.keys(MUSEUM_V2_PER_COPY).map(Number) as CurvedRegionTier[]) {
    out.push(
      entry({
        id: `relic:MUSEUM_V2_PER_COPY:${tier}`,
        system: "relic",
        source: { catalog: "MUSEUM_V2_PER_COPY", key: String(tier) },
        claim: `Tier ${tier} general copies: +${(MUSEUM_V2_PER_COPY[tier] * 100).toFixed(2)}% per copy before the curve`,
        probe: "museum:cargoCapacity",
        contexts: ["fleet"],
        curve: v2Curve,
        magnitude: (c) => c.MUSEUM_V2_PER_COPY[tier],
        on: withTierCopies(tier, { hullRivet: 1 }),
        off: withTierCopies(tier, {}),
        note: "one Hull Rivet (cargoCapacity, share 1) at this tier",
      }),
    );
  }
  for (const set of EXCEPTIONAL_SETS) {
    for (const p of set.pieces) {
      out.push(
        entry({
          id: `relic:EXCEPTIONAL_SETS:${set.id}:${p.id}`,
          system: "relic",
          source: { catalog: "EXCEPTIONAL_SETS", key: `${set.id}:${p.id}` },
          claim: `${p.label}: ${p.stat}`,
          probe: `museum:${p.stat}`,
          contexts: ["fleet"],
          magnitude: (c) => c.EXCEPTIONAL_SETS.find((x) => x.id === set.id)!.pieces.find((x) => x.id === p.id)!.value,
          tolerance: 1e-12,
          on: withPieces([p.id]),
          off: withPieces([]),
          note: "the piece held alone (no set completes); names and values await the R2-5 content sheet",
        }),
      );
    }
    const fullStat = set.fullSet[0].stat;
    const ids = set.pieces.map((p) => p.id);
    out.push(
      entry({
        id: `relic:EXCEPTIONAL_SETS:${set.id}:full`,
        system: "relic",
        source: { catalog: "EXCEPTIONAL_SETS", key: `${set.id}:full` },
        claim: `${set.label} full set: ${set.fullSet.map((b) => b.stat).join(" + ")}`,
        probe: `museum:${fullStat}`,
        contexts: ["fleet"],
        magnitude: (c) => c.EXCEPTIONAL_SETS.find((x) => x.id === set.id)!.fullSet.filter((b) => b.stat === fullStat).reduce((a, b) => a + b.value, 0),
        tolerance: 1e-12,
        on: withPieces(ids),
        off: withPieces(ids.slice(0, -1)),
        note: "every piece held vs all but the last (whose stat is not the full-set stat)",
      }),
    );
  }
  return out;
}

// ============================================================================
// mission: MISSIONS fields
// ============================================================================

function missionEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  // field -> [curve family, the value it should produce on a bare General Freighter] (null: not read for this mission)
  const fields: readonly string[] = [
    "transitOutTicks",
    "transitBackTicks",
    "unloadTicks",
    "extractionRatePerTick",
    "rareChance",
    "uncommonChance",
    "fleetAdminXpPerTick",
    "creditsPerCycle",
    "lootTable",
    "unlockLevel",
    "requiresCaptainLevel",
    "requiresCargoCapacity",
    "primaryMaterial",
    "supplyCostPerCargo",
    "rewardMargin",
  ];
  for (const key of Object.keys(MISSIONS) as MissionKey[]) {
    const def = MISSIONS[key];
    const transport = def.missionType === "transport";
    const survey = def.missionType === "survey";
    for (const field of fields) {
      if (field === "requiresCaptainLevel" && def.requiresCaptainLevel === undefined) continue;
      if (field === "requiresCargoCapacity" && def.requiresCargoCapacity === undefined) continue;
      if ((field === "supplyCostPerCargo" || field === "rewardMargin") && !transport) continue;
      const common = {
        id: `mission:MISSIONS:${key}:${field}`,
        system: "mission" as const,
        source: { catalog: "MISSIONS", key: `${key}:${field}` },
        claim: `${def.label} ${field}`,
        probe: `content:mission:${field}:${key}` as ProbeId,
        contexts: [transport ? "mission:transport" : survey ? "mission:survey" : "mission:extraction"] as ContextId[],
        direction: "none" as const,
        curve: { kind: "equals" } as Curve,
      };
      if (transport && (field === "lootTable" || field === "creditsPerCycle")) {
        // A transport is a pure credit loop: no loot deposit, no flat per-cycle award (model.ts:698 to 705).
        out.push(entry({ ...common, probe: undefined, contexts: [], notApplicable: "a transport deposits no loot and pays its margin, not a flat award" }));
        continue;
      }
      if (transport && field === "primaryMaterial") {
        // WR-4 (B2, OC-I3 "Let them launch"): neither the dispatch gate nor the auto-stop reads it for a transport.
        out.push(entry({ ...common, probe: undefined, contexts: [], claim: `${def.label}: "inert for transport"`, notApplicable: "a transport delivers no loot, so a full warehouse never stops or blocks it (WR-4, B2)" }));
        continue;
      }
      const magnitude = (c: Catalogs): number => {
        const d = c.MISSIONS[key];
        switch (field) {
          case "unloadTicks":
            return Math.max(3, d.unloadTicks); // effectiveMissionDef's floor (UNLOAD_MIN_TICKS) on the reference hold
          case "extractionRatePerTick":
            return d.extractionRatePerTick;
          case "rareChance":
            return d.rareChance;
          case "uncommonChance":
            return d.uncommonChance;
          case "creditsPerCycle":
            return d.creditsPerCycle;
          case "supplyCostPerCargo":
          case "rewardMargin":
            // A transport's whole reward is its margin on the load: supplyCostPerCargo x the hold x rewardMargin.
            return (d.supplyCostPerCargo ?? 0) * SHIP_TYPES.generalFreighter.cargoCapacity * (d.rewardMargin ?? 0);
          case "lootTable":
          case "unlockLevel":
          case "requiresCaptainLevel":
          case "requiresCargoCapacity":
          case "primaryMaterial":
            return 1; // the gate flips (or the configured item is the one deposited)
          default:
            return (d as unknown as Record<string, number>)[field];
        }
      };
      out.push(
        entry({
          ...common,
          magnitude,
          tolerance: field === "rareChance" || field === "uncommonChance" ? 1e-9 : undefined,
          note: field === "supplyCostPerCargo" || field === "rewardMargin" ? "the credits one delivered cycle earns: the load cost x the margin" : undefined,
        }),
      );
    }
    out.push(
      entry({
        id: `mission:MISSIONS:${key}:cargoCapacity`,
        system: "mission",
        source: { catalog: "MISSIONS", key: `${key}:cargoCapacity` },
        claim: `${def.label} per-cycle units`,
        status: pending("WR-11, OC-I1 (overwritten by the hull hold, model.ts:3733)"),
      }),
    );
  }
  // G1-2 + G1-4: every effect field of every short-range template, LIVE through the cycle engine (shortRangeCycle.ts),
  // each read on the template's training cycle on the bare wiring fixture (probes.ts shortRangeTrainingCycle):
  //   rolls   the training roll's primary size (people, units or scan points) is its span's smallest (SF: smallest roll)
  //   work    the ticks economyTick spends on site equal the cycle plan's (shortRangeCyclePlan reads `work`)
  //   reward  the credits one delivered cycle pays equal the reward table's (shortRangeCycleReward reads `reward`)
  for (const key of SHORT_RANGE_TEMPLATE_KEYS) {
    const def = SHORT_RANGE_TEMPLATES[key];
    for (const field of ["rolls", "work", "reward"] as const) {
      out.push(
        entry({
          id: `mission:SHORT_RANGE_TEMPLATES:${key}:${field}`,
          system: "mission",
          source: { catalog: "SHORT_RANGE_TEMPLATES", key: `${key}:${field}` },
          claim: `${def.label} ${field}`,
          probe: `content:shortRange:${field}:${key}` as ProbeId,
          contexts: ["mission:shortRange"],
          direction: "none",
          curve: { kind: "equals" },
          magnitude: (c) => {
            if (field === "rolls") {
              const spans = c.SHORT_RANGE_TEMPLATES[key].rolls[1];
              return (spans.guests ?? spans.units ?? spans.scan ?? [-1])[0];
            }
            const training = shortRangeTrainingCycle(key);
            return field === "work" ? training.plan.onSiteTicks : training.credits;
          },
        }),
      );
    }
  }
  for (const id of Object.keys(PATROLS)) {
    out.push(
      entry({
        id: `mission:PATROLS:${id}`,
        system: "mission",
        source: { catalog: "PATROLS", key: id },
        claim: `${PATROLS[id].label}: its legs and engagement window`,
        probe: `content:patrolWindow:${id}`,
        contexts: ["patrol"],
        direction: "none",
        curve: { kind: "equals" },
        magnitude: (c) => c.PATROLS[id].rollWindowTicks,
        note: "the engagement window reaches the patrol phase reader; waves, pools and odds ride the patrol goldens",
      }),
    );
  }
  return out;
}

// ============================================================================
// Content: ship combat, ground combat, expedition content, salvage pools, sell values
// ============================================================================

// WR-8 (0.14.0) took the last five live: Sensor Power Drain and Coolant Leak act now that fights open at range
// (combatEventSensorDrain, combatEventCoolantLeak), Manifold Overheat on the pirates' evasion
// (combatEventManifoldOverheat), Inhibit has Point Defense as its source and the drone volley clock as its reader
// (combatEventInhibitSource / Reader), and the support pulse charges Overcharged Capacitors (combatEventOvercharge).
const SHIP_STATUS_PENDING: Readonly<Record<string, string>> = {};

// WR-8 review: Rapid Charge waits for a podded ship that can be ambushed.
const RAPID_CHARGE_DEFERRED: WiringStatus = {
  kind: "deferred",
  owner: "CP-15 patrol cloak, T3, or explorer drone bays",
  userRef: `${T3}: patrol cloak detection`,
};
// (combatDescriptorProbes.ts combatEventRapidCharge is the rows' check the day a podded ship can be ambushed.)

// Field Kits FKR-11: Inspired went live with the Combat Stim (fieldKitsBattle.ts applyKit, a Field Kits run's Use Item);
// its row reads the strike seam like Weakened's, the other way.
const GROUND_STATUS_PENDING: Readonly<Record<string, string>> = {
  corroded: "WR-10, OC-F9 (only analyze, never run, inflicts it)",
};

// Field Kits FKR-11 (the close-out): the three audit rows it RE-OWNED. The two field device rows went LIVE at FKR-8 (the
// plan's field device slice; FKR8_FLIPPED_LIVE); the status picker's Field Kits half is done (every condition and
// Inspired can fire on a Field Kits run), leaving only Corroded, WR-10's OC-F9. Exported for the registry pins' read-back
// (shortRangeGoldens, emodGoldens).
export const FKR11_REOWNED = {
  shroudLureGroundOps: "FKR-8 + OC-F1 (the field device slice: Shroud and Lure on the ground, the 50 to 75% per-use roll)",
  fieldDeviceEffectiveness: "FKR-8 (the field device slice: the 50 to 75% per-use roll, Codebreaker +6%)",
  statusPicker: "WR-10, OC-F9 (Corroded: only Analyze inflicts it)",
} as const;

// Field Kits FKR-8 (the field devices roll 50 to 75% per use, on the ground: the wiring plan's OC-F1): the entries it
// FLIPPED pending -> live (each was pending on FKR-8, the owner FKR11_REOWNED and CATEGORY_OWNER named) and the two it
// ADDED (the reinforcement and salvage halves of OC-F1). Exported for the registry pins' read-back.
export const FKR8_FLIPPED_LIVE: Readonly<Record<string, string>> = {
  "away:KIT_CATEGORY_RULES:fieldDevices": "FKR-8 (the 50 to 75% per-use device roll, Codebreaker +6%)",
  "away:audit:shroudLureGroundOps": FKR11_REOWNED.shroudLureGroundOps,
  "away:audit:fieldDeviceEffectiveness": FKR11_REOWNED.fieldDeviceEffectiveness,
};
export const FKR8_ADDED_IDS: ReadonlySet<string> = new Set(["away:audit:fieldDeviceReinforcements", "away:audit:lureSalvage"]);

const ACTION_PENDING: Readonly<Partial<Record<GambitActionId, string>>> = {
  fallBack: "WR-10, OC-F6 (identical to Hold, gambit.ts:887)",
  shieldAlly: "WR-10, OC-F10 (a Science action: never offered or run)",
  analyze: "WR-10, OC-F10 (a Science action: never offered or run)",
  secureObjective: "WR-10, OC-F10 (a Science action: never offered or run)",
  takeCover: "WR-10, OC-F10 (a Science action: never offered or run)",
};

function contentEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  const base = (system: WiringSystem, catalog: string, key: string, claim: string) => ({ id: `${system}:${catalog}:${key}`, system, source: { catalog, key }, claim });

  for (const id of Object.keys(WEAPON_DEFS)) {
    out.push(
      entry({
        ...base("ship", "WEAPON_DEFS", id, `Weapon ${id}: a lone mount hurts an enemy hull`),
        probe: `content:weapon:${id}`,
        contexts: ["patrol"],
        curve: { kind: "event", metric: "enemy damage and statuses over three duels" },
        magnitude: () => 1,
        on: sourceOn,
        note: "yield, cooldown, accuracy, projectiles and procs move this together; the patrol goldens pin the numbers",
      }),
    );
  }
  for (const role of Object.keys(ROLE_TEMPLATE)) {
    out.push(
      entry({
        ...base("ship", "ROLE_TEMPLATE", role, `Drone role ${role}: a squadron improves the duel`),
        probe: `content:drone:${role}`,
        contexts: ["patrol"],
        curve: { kind: "event", metric: "enemy damage taken minus own damage taken over three duels" },
        magnitude: () => 1,
        on: sourceOn,
      }),
    );
  }
  for (const id of Object.keys(PIRATE_HULLS) as (keyof typeof PIRATE_HULLS)[]) {
    for (const field of ["hullIntegrity", "shieldCapacity", "shieldRecharge", "weapons", "droneRoles"] as const) {
      out.push(
        entry({
          ...base("ship", "PIRATE_HULLS", `${id}:${field}`, `${PIRATE_HULLS[id].name} ${field}`),
          probe: `content:pirate:${id}:${field}`,
          contexts: ["patrol"],
          direction: "none",
          curve: { kind: "equals" },
          magnitude: (c) => {
            const v = c.PIRATE_HULLS[id][field];
            return Array.isArray(v) ? v.length : (v as number);
          },
        }),
      );
    }
    // WR-8 (OC-D9 "stance matters"): the hull's stance is the distance its combatant holds at under the combat rules
    // (capped at its own reach in the fight; combatEventStance proves a stance moves a fight).
    out.push(
      entry({
        ...base("ship", "PIRATE_HULLS", `${id}:stance`, `${PIRATE_HULLS[id].name} stance`),
        probe: `combatPirateStance:${id}`,
        contexts: ["patrol"],
        direction: "none",
        curve: { kind: "equals" },
        magnitude: (c) => stancePreferredDistance(c.PIRATE_HULLS[id].stance),
      }),
    );
    // WR-8 (OC-D12 "pirate hulls get armor and evasion"): the hull's mitigation reaches its combatant under the combat
    // rules (combatEventEnemyMitigation proves it changes the damage a ship lands).
    for (const field of ["ablativeArmor", "evasion"] as const) {
      out.push(
        entry({
          ...base("ship", "PIRATE_HULLS", `${id}:${field}`, `${PIRATE_HULLS[id].name} ${field}`),
          probe: `content:pirate:${id}:${field}`,
          contexts: ["patrol"],
          direction: "none",
          curve: { kind: "equals" },
          magnitude: (c) => c.PIRATE_HULLS[id][field],
        }),
      );
    }
  }
  for (const [id, def] of Object.entries(STATUS_EFFECT_DEFS)) {
    const owner = SHIP_STATUS_PENDING[id];
    out.push(
      entry({
        ...base("ship", "STATUS_EFFECT_DEFS", id, `${def.displayName}`),
        probe: owner ? undefined : `content:shipStatus:${id}`,
        contexts: owner ? [] : ["patrol"],
        direction: "none",
        curve: { kind: "equals" },
        magnitude: (c) => {
          const m = c.STATUS_EFFECT_DEFS[id].mechanic;
          return m.type === "statDelta" ? m.deltaPercentPerRank : m.damagePerRankPerRound;
        },
        status: owner ? pending(owner) : LIVE,
        note: owner ? undefined : "the configured delta reaches the stat resolver the sim reads (resolveBattle.ts activeStatDelta)",
      }),
    );
  }
  for (const [id, def] of Object.entries(GAMBIT_STATUSES) as [GambitStatusId, (typeof GAMBIT_STATUSES)[GambitStatusId]][]) {
    const owner = GROUND_STATUS_PENDING[id];
    // Field Kits FKR-4: Neurotoxin's DoT reads as a DoT, the bone line's cut as an accuracy cut (its power half rides the
    // same magnitude, fieldKitsConditions.test.ts), and a turn loss or Fear as the squad's hp lost to a foe opening with it.
    const shape: Partial<EntryInput> =
      def.effect === "dotDamage" || def.effect === "dotTurnLoss"
        ? { curve: { kind: "linearAbsolute" }, magnitude: (c) => Math.round(c.GAMBIT_STATUSES[id].magnitude) }
        : def.effect === "accuracyDown" || def.effect === "powerAccuracyDown"
          ? { direction: "down", curve: { kind: "linearRelative" }, magnitude: (c) => -c.GAMBIT_STATUSES[id].magnitude }
          : def.effect === "damageDown" || def.effect === "damageTakenDown"
            ? { direction: "down", curve: { kind: "linearRelative" }, magnitude: (c) => -c.GAMBIT_STATUSES[id].magnitude, tolerance: 1 }
            : def.effect === "damageUp"
              ? { direction: "up", curve: { kind: "linearRelative" }, magnitude: (c) => c.GAMBIT_STATUSES[id].magnitude, tolerance: 1 }
            : def.effect === "skipTurn" || def.effect === "turnLoss" || def.effect === "mayFallBack"
              ? {
                  direction: "down",
                  curve: { kind: "event", metric: def.effect === "skipTurn" ? "squad hp lost to a foe that opens stunned" : `squad hp lost to a foe that opens with ${def.label}` },
                  magnitude: () => 1,
                }
              : {};
    out.push(
      entry({
        ...base("away", "GAMBIT_STATUSES", id, `${def.label}: ${def.effect} ${def.magnitude}`),
        ...shape,
        probe: owner ? undefined : `content:groundStatus:${id}`,
        contexts: owner ? [] : ["ground"],
        on: sourceOn,
        status: owner ? pending(owner) : LIVE,
      }),
    );
  }
  for (const action of GAMBIT_ACTIONS) {
    const owner = ACTION_PENDING[action];
    out.push(
      entry({
        ...base("away", "GAMBIT_ACTIONS", action, `Gambit action ${action}`),
        probe: owner ? undefined : `content:action:${action}`,
        contexts: owner ? [] : ["ground"],
        direction: action === "hold" ? "none" : "up",
        curve: action === "hold" ? { kind: "equals" } : { kind: "event", metric: "the battle state the action changes" },
        magnitude: () => (action === "hold" ? 0 : 1),
        on: sourceOn,
        status: owner ? pending(owner) : LIVE,
        note: action === "hold" ? "Hold does nothing, as its label says" : undefined,
        ...(action === "hold" ? { witness: "away:GAMBIT_ACTIONS:attack" } : {}),
      }),
    );
  }
  for (const sel of GAMBIT_SELECTORS) {
    out.push(
      entry({
        ...base("away", "GAMBIT_SELECTORS", sel, `Gambit target ${sel}`),
        probe: `content:selector:${sel}`,
        contexts: ["ground"],
        direction: "none",
        curve: { kind: "equals" },
        magnitude: () => 1,
        note: "the selector picks the combatant its label names in a fixed scenario",
      }),
    );
  }
  for (const preset of GAMBIT_PRESETS) {
    out.push(
      entry({
        ...base("away", "GAMBIT_PRESETS", preset.id, `Gambit preset ${preset.title}`),
        probe: `content:preset:${preset.id}`,
        contexts: ["ground"],
        direction: "none",
        curve: { kind: "equals" },
        magnitude: () => 1,
        base: () => withAwayTeam(wiringBase()),
        on: (s) => applyMemberGambitPreset(s, WIRING_SECURITY_ID, preset.id),
        note: "the member's battle program is the preset's Security program",
      }),
    );
  }
  out.push(
    entry({
      ...base("away", "GAMBIT_PROGRAMS", "account", "The account gambit pair (DEFAULT_GAMBIT_PROGRAMS, state.gambitPrograms)"),
      status: pending("WR-10, OC-F12 (D19: no battle reads it)"),
    }),
  );
  // Field Kits FKR-6 (group 7 "Rank rules + reserve"; N15): the rank conditions ("target is Elite or stronger",
  // "target is a Boss": the ranks of a Weak-to-Boss lineup a rule still attacks), the "keep N for a Boss" reserve (the
  // charges a thrower spends against a Normal foe drop by N) and the Field Kits default program (the grenades a member
  // on the default throws in one battle).
  for (const min of ["elite", "boss"] as const) {
    out.push(
      entry({
        ...base("away", "GAMBIT_PROGRAMS", `minRank:${min}`, `Gambit condition: target is ${ENEMY_RANKS[min].label}${min === "boss" ? "" : " or stronger"}`),
        probe: `content:rankCondition:${min}`,
        contexts: ["ground"],
        direction: "down",
        curve: { kind: "equals" },
        magnitude: (c) => Object.values(c.ENEMY_RANKS).filter((r) => r.order >= c.ENEMY_RANKS[min].order).length,
        on: sourceOn,
      }),
    );
  }
  const reserve = FIELD_KITS_DEFAULT_GRENADE_RULES.find((r) => r.params?.reserveForBoss !== undefined)?.params?.reserveForBoss ?? 0;
  out.push(
    entry({
      ...base("away", "GAMBIT_PROGRAMS", "reserveForBoss", "Gambit option: keep N charges or kits for a Boss"),
      probe: "content:bossReserve",
      contexts: ["ground"],
      direction: "down",
      curve: { kind: "linearAbsolute" },
      magnitude: () => -reserve,
      on: sourceOn,
    }),
    entry({
      ...base("away", "GAMBIT_PROGRAMS", "fieldKitsDefault", "The default program throws grenades on a Field Kits run, keeping one for an Elite or a Boss"),
      probe: "content:fieldKitsDefault",
      contexts: ["ground"],
      curve: { kind: "event", metric: "grenades a member on the default throws in one battle" },
      magnitude: () => 1,
      on: sourceOn,
    }),
  );
  for (const p of POI_CATALOG) {
    out.push(
      entry({
        ...base("expedition", "POI_CATALOG", p.id, `${p.label}: found on its planets`),
        probe: `content:poi:${p.id}`,
        contexts: ["expedition:groundOps"],
        direction: "none",
        curve: { kind: "equals" },
        magnitude: (c) => Object.values(c.POI_CATALOG.find((x) => x.id === p.id)!.planetWeights).filter((w) => (w ?? 0) > 0).length,
      }),
      entry({
        ...base("expedition", "POI_CATALOG", `${p.id}:flavor`, `${p.label} flavor: ${p.flavor}`),
        status: pending("WR-11, OC-G4 (never rendered; relic odds and haul do not vary by PoI)"),
      }),
    );
  }
  for (const p of PLANET_TYPES) {
    out.push(
      entry({
        ...base("expedition", "PLANET_TYPES", `${p.id}:hazard`, `${p.label} hazard`),
        probe: `content:planetHazard:${p.id}`,
        contexts: ["expedition:groundOps"],
        direction: "none",
        curve: { kind: "equals" },
        magnitude: (c) => c.PLANET_TYPES.find((x) => x.id === p.id)!.hazard,
      }),
    );
    for (const [field, kind] of [
      ["surfaceBias", "landmark"],
      ["undergroundBias", "underground"],
    ] as const) {
      const bias = p[field];
      out.push(
        entry({
          ...base("expedition", "PLANET_TYPES", `${p.id}:${field}`, `${p.label} ${field}`),
          probe: bias === 0 ? undefined : `content:planetBias:${p.id}:${kind}`,
          contexts: bias === 0 ? [] : ["expedition:groundOps"],
          direction: bias > 0 ? "up" : "down",
          curve: { kind: "event", metric: `${kind} finds with the bias vs with it cancelled by the array bias` },
          magnitude: () => 1,
          base: () => withAwayTeam(wiringBase()),
          on: sourceOn,
          ...(bias === 0 ? { notApplicable: "a zero bias leaves the base odds" } : {}),
        }),
      );
    }
    if (p.orbitalOnly) {
      out.push(
        entry({
          ...base("expedition", "PLANET_TYPES", `${p.id}:orbitalOnly`, `${p.label}: "no surface landing; finds are satellite ops"`),
          // Gas Giant Study GG-2 (D22, OC-G2): live. A study run's orbital body gets no ground objective (the ship
          // studies it instead): the objectives on the run's bodies, all of this type, with the study stamp vs without.
          probe: `content:orbitalOnly:${p.id}`,
          contexts: ["expedition:groundOps"],
          direction: "down",
          curve: { kind: "event", metric: `ground objectives on ${p.label} bodies of a study run vs the same run unstamped` },
          magnitude: () => 1,
          base: () => withAwayTeam(wiringBase()),
          on: sourceOn,
        }),
      );
    }
  }
  for (const id of Object.keys(SALVAGE_LOOT_POOLS)) {
    out.push(
      entry({
        ...base("salvage", "SALVAGE_LOOT_POOLS", id, `Salvaging ${id} yields its pool's drops`),
        probe: `content:lootPool:${id}`,
        contexts: ["salvage"],
        direction: "none",
        curve: { kind: "equals" },
        magnitude: () => 1,
      }),
    );
  }
  for (const [id, item] of Object.entries(ITEMS)) {
    if ((item as { sellValue?: number }).sellValue === undefined) continue;
    out.push(
      entry({
        ...base("facility", "ITEMS", `${id}:sellValue`, `${item.label} sells for its value`),
        probe: `content:sell:${id}`,
        contexts: ["facility"],
        direction: "none",
        curve: { kind: "equals" },
        magnitude: (c) => (c.ITEMS[id] as { sellValue?: number }).sellValue ?? 0,
      }),
    );
  }
  // ML-1: an item produced today whose consumer a later slice wires (ItemDef.reserved names it). Pending until that
  // slice adds the consumer and drops the marker (materialLines.test.ts fails while both are true).
  for (const [id, item] of Object.entries(ITEMS)) {
    // Gas Giant Study GG-5 built the research data's consumer (the Research Lab's data study lane) and dropped their
    // markers: each row is live now, read through the lane (the units it studied; OFF: the lane paused). The row keeps
    // its id (and its place); its source is the lane's consumer (DATA_STUDY consume:<item>), the marker being gone.
    if (item.reserved === undefined && isResearchDataItem(id)) {
      out.push(
        entry({
          ...base("facility", "DATA_STUDY", `consume:${id}`, `${item.label} is produced and has a consumer`),
          id: `facility:ITEMS:${id}:reserved`,
          probe: `content:dataStudy:consume:${id}`,
          contexts: ["research"],
          curve: { kind: "event", metric: `units of ${item.label} the Research Lab's data study lane studies` },
          magnitude: () => 1,
          on: sourceOn,
        }),
      );
      continue;
    }
    if (item.reserved === undefined) continue;
    out.push(
      entry({
        ...base("facility", "ITEMS", `${id}:reserved`, `${item.label} is produced and has a consumer`),
        status: pending(item.reserved),
      }),
    );
  }
  return out;
}

// ============================================================================
// expedition: the ground objective affixes (affixes.ts AFFIX_DEFS) and the alert escalation
// ============================================================================

// Every rank of every affix hook, read by the hook's own reader on an objective carrying that one instance (the
// cover hook once per alignment it may roll: positive covers the squad, negative the enemy, neutral both).
function affixEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  for (const def of Object.values(AFFIX_DEFS)) {
    for (const hook of AFFIX_HOOK_KEYS) {
      const byRank = (def.hooks as Readonly<Record<string, readonly number[] | undefined>>)[hook];
      if (!byRank) continue;
      const cover = AFFIX_ALIGNED_HOOKS.has(hook);
      byRank.forEach((_, i) => {
        const rank = i + 1;
        const alignments: readonly AffixAlignment[] = cover ? def.alignments : [def.alignments[0]];
        for (const alignment of alignments) {
          const key = `${def.id}:${rank}:${hook}${cover ? `:${alignment}` : ""}`;
          out.push(
            entry({
              id: `expedition:AFFIX_DEFS:${key}`,
              system: "expedition",
              source: { catalog: "AFFIX_DEFS", key },
              claim: `${def.name} rank ${rank}: ${hook}${cover ? ` (${alignment})` : ""}`,
              probe: `content:affix:${def.id}:${rank}:${hook}:${alignment}`,
              contexts: ["ground"],
              direction: "none",
              curve: { kind: "equals" },
              magnitude: (c) => {
                const v = (c.AFFIX_DEFS[def.id as AffixId].hooks as Readonly<Record<string, readonly number[]>>)[hook][i];
                return cover && alignment === "neutral" ? 2 * Math.min(1, v) : v; // neutral: each side evades
              },
              on: sourceOn,
            }),
          );
        }
      });
    }
  }
  out.push(
    entry({
      id: "expedition:AFFIX_ESCALATION:damageMult",
      system: "expedition",
      source: { catalog: "AFFIX_ESCALATION", key: "damageMult" },
      claim: "Heightened Senses: an alerted objective's enemies deal stacking extra damage",
      probe: "content:escalation:damageMult",
      contexts: ["ground"],
      curve: { kind: "diminishing", knee: HEIGHTENED_SENSES_KNEE, base: 1 },
      magnitude: () => HEIGHTENED_SENSES_PER_LEVEL,
      on: sourceOn,
    }),
    entry({
      id: "expedition:AFFIX_ESCALATION:extraEnemies",
      system: "expedition",
      source: { catalog: "AFFIX_ESCALATION", key: "extraEnemies" },
      claim: "Reinforcing alert: every fight there fields one more enemy per alert level",
      probe: "content:escalation:extraEnemies",
      contexts: ["ground"],
      magnitude: () => ESCALATION_ENEMIES_PER_LEVEL,
      on: sourceOn,
    }),
  );
  return out;
}

// ============================================================================
// expedition: enemy ranks (Field Kits FKR-1, enemyRanks.ts ENEMY_RANKS)
// ============================================================================

// Every rank's ONE multiplier (user N1: HP and power alike; heal follows), read on a REAL task fight's guard
// (groundFight.ts taskFightGuard) at a fight point the placement leads with that rank: the lead's power and its HP on a
// ranked run are its unranked values x the multiplier (HP within one rounding step). Weak (safe first runs SF-3, user
// 2026-10-16 "Use them on the curve") is read on the difficulty curve's low end: an ordinary run at the curve's floor.
function enemyRankEntries(): WiringEntry[] {
  return ENEMY_RANK_IDS.flatMap((rank) =>
    (["power", "hp"] as const).map((stat) => {
      const mult = ENEMY_RANKS[rank].mult;
      const shared = {
        id: `expedition:ENEMY_RANKS:${rank}${stat === "hp" ? ":hp" : ""}`,
        system: "expedition" as const,
        source: { catalog: "ENEMY_RANKS", key: stat === "hp" ? `${rank}:hp` : rank },
        claim: `${ENEMY_RANKS[rank].label} enemy rank: its ${stat === "hp" ? "HP" : "power"} takes the rank multiplier`,
      };
      return entry({
        ...shared,
        probe: `content:enemyRank:${rank}:${stat}`,
        contexts: ["ground"],
        direction: mult > 1 ? "up" : mult < 1 ? "down" : "none",
        curve: { kind: "linearRelative" },
        magnitude: (c) => c.ENEMY_RANKS[rank].mult - 1,
        ...(stat === "hp" ? { tolerance: 0.5 } : {}),
        on: sourceOn,
      });
    }),
  );
}

// ============================================================================
// away: the field kits (Field Kits FKR-2, fieldKits.ts). Since FKR-6 every kit and the First Aid / Advanced Medical rules
// are LIVE in a Field Kits run's battle (fieldKitsBattle.ts; probes content:kit / content:kitCategory, each kit spent
// through a real Use Item rule on a battle carrying the Field Kits kit rules). Field Devices stays pending (FKR-8).
// ============================================================================

// The categories not live yet, by owner (Explosives went live at FKR-5, First Aid and Advanced Medical at FKR-6, Field
// Devices at FKR-8).
const CATEGORY_OWNER: Readonly<Partial<Record<KitCategory, string>>> = {};

// Field Kits FKR-6: the category rules measured in battle (content:kitCategory): First Aid's trained lift on one First
// Aid Kit's heal, Advanced Medical's Medical Training gate on a Splint.
const CATEGORY_BATTLE_PROBE: Readonly<Partial<Record<KitCategory, true>>> = { firstAid: true, advancedMedical: true };

function fieldKitEntries(): WiringEntry[] {
  // Each kit's measurable effect, read from the catalog: a heal (HP), a bay treatment share (the bay divisor), a buff
  // (its rounds, read verbatim), else the conditions one use treats (what it clears plus the line ranks it reaches).
  const conditionsTreated = (k: FieldKitDef): number => k.clears.length + Object.values(k.lines ?? {}).reduce((n, care) => n + (care?.upTo ?? 0), 0);
  const out: WiringEntry[] = FIELD_KIT_IDS.map((id) => {
    const def = FIELD_KITS[id];
    const shape: Pick<EntryInput, "curve" | "direction" | "magnitude"> =
      def.heal !== undefined
        ? { curve: { kind: "linearAbsolute" }, magnitude: (c) => c.FIELD_KITS[id].heal ?? 0 }
        : def.treatmentShare !== undefined
          ? { curve: { kind: "divisor" }, direction: "down", magnitude: (c) => c.FIELD_KITS[id].treatmentShare ?? 0 }
          : def.buff !== undefined
            ? { curve: { kind: "equals" }, direction: "none", magnitude: (c) => c.FIELD_KITS[id].buff?.rounds ?? 0 }
            : { curve: { kind: "event", metric: "conditions treated" }, magnitude: (c) => conditionsTreated(c.FIELD_KITS[id]) };
    // Field Kits FKR-6: live in a Field Kits run's battle. The Injury Kit's share is measured through the medical bay's
    // divisor (medicalBay.ts conditionCureSeconds, a Broken Bone's time; whole seconds, so one step of tolerance);
    // FKR-7 sums the fight record's `treated` into the run's bay.
    return entry({
      id: `away:FIELD_KITS:${id}`,
      system: "away",
      source: { catalog: "FIELD_KITS", key: id },
      claim: `${def.label}: what one use treats, heals or grants`,
      ...shape,
      probe: `content:kit:${id}`,
      contexts: ["ground"],
      on: sourceOn,
      ...(def.treatmentShare !== undefined ? { tolerance: 1, note: "the battle records the share; FKR-7 sums it on the member's trip treatment, which the run's medical bay reads" } : {}),
    });
  });
  for (const cat of Object.keys(KIT_CATEGORY_RULES) as KitCategory[]) {
    const owner = CATEGORY_OWNER[cat];
    // Field Kits FKR-5 (FK10 "Own grenades only"): Explosives' specialist bonus is Saboteur's x1.06 on the Saboteur's own
    // throws, read on a Field Kits objective fight's armed squad (the blast's power multiplier of a worn Impact
    // Grenade; the debuff chance takes the same factor, fieldKitsGrenades.test.ts).
    const saboteur: Partial<EntryInput> =
      cat === "explosives"
        ? {
            probe: "runSecGrenadePower",
            contexts: ["ground"],
            base: () => wearPiece(withAwayTeam(wiringBase()), WIRING_SECURITY_ID, "memberTool", "impactGrenade", {}),
            on: (s) => editMember(s, WIRING_SECURITY_ID, { traits: ["saboteur"] }),
          }
        : CATEGORY_BATTLE_PROBE[cat]
          ? { probe: `content:kitCategory:${cat}` as ProbeId, contexts: ["ground"] as ContextId[], on: sourceOn }
          : cat === "fieldDevices"
            ? // Field Kits FKR-8 (FK8 "+6% to the roll"): a Codebreaker anywhere on the expedition lifts a worn Lure Beacon's
              // effect on one use by x1.06 (groundOps.ts groundDeviceChance, the chance an ambush roll compares against).
              { probe: "content:fieldDevice:codebreaker" as ProbeId, contexts: ["expedition:groundOps"] as ContextId[], on: sourceOn }
            : {};
    out.push(
      entry({
        id: `away:KIT_CATEGORY_RULES:${cat}`,
        system: "away",
        source: { catalog: "KIT_CATEGORY_RULES", key: cat },
        claim: `Kit category ${cat}: who can use it and how well`,
        // First Aid: training's lift over the untrained use; Advanced Medical: the gate (untrained 0 to trained 1);
        // Explosives and Field Devices: their specialist's bonus (Saboteur, Codebreaker).
        curve: cat === "advancedMedical" ? { kind: "gate" } : { kind: "linearRelative" },
        magnitude: (c) => {
          const rule = c.KIT_CATEGORY_RULES[cat];
          if (cat === "firstAid") return rule.trained / rule.untrained - 1;
          if (cat === "advancedMedical") return rule.trained - rule.untrained;
          return rule.specialistBonus;
        },
        ...saboteur,
        status: owner ? pending(owner) : LIVE,
      }),
    );
  }
  // Field Kits FKR-5: the grenade family (FK11, N4, N6), each grenade measured on a reference thrower armed the way a
  // Field Kits fight arms it: its charges per objective and throws per battle (read verbatim), its blast (the thrower's
  // power x powerMult) and its debuff (bodies afflicted over a batch of throws).
  for (const k of GRENADE_IDS) {
    const g = GRENADES[k];
    const label = EQUIPMENT_SLOTS.memberTool.varieties.find((v) => v.key === k)?.label ?? k;
    const shared = (field: string) => ({
      id: `away:GRENADES:${k}:${field}`,
      system: "away" as const,
      source: { catalog: "GRENADES", key: `${k}:${field}` },
      probe: `content:grenade:${k}:${field}` as ProbeId,
      contexts: ["ground"] as ContextId[],
      on: sourceOn,
    });
    out.push(
      entry({ ...shared("charges"), claim: `${label}: its charges per objective`, curve: { kind: "equals" }, magnitude: (c) => c.GRENADES[k].charges.perObjective }),
      entry({ ...shared("perBattle"), claim: `${label}: its throws per battle`, curve: { kind: "equals" }, magnitude: (c) => c.GRENADES[k].charges.perBattle }),
      entry({
        ...shared("blast"),
        claim: `${label}: the blast hits the target's group at a multiple of the thrower's power`,
        direction: g.powerMult > 1 ? "up" : g.powerMult < 1 ? "down" : "none",
        curve: { kind: "linearRelative" },
        magnitude: (c) => c.GRENADES[k].powerMult - 1,
        // The damage is a whole number at power 1000: one rounding step each side.
        tolerance: 2,
      }),
      entry({
        ...shared("status"),
        claim: `${label}: the blast may inflict ${GAMBIT_STATUSES[g.status].label} on each body it hits`,
        curve: { kind: "event", metric: "bodies its debuff lands on over 64 throws at a group of two" },
        magnitude: () => 1,
      }),
      // Timed grenades (user 2026-10-21; fuse ruling "1 round later"): the turns from the throw to the blast on a run
      // that reads fuses (catalog 2), against the same grenade armed on contact (catalog 1). A timed grenade reads 1, the
      // Impact Grenade (the default, on contact) 0 (its witness: a timed sibling on the same reader).
      entry({
        ...shared("fuse"),
        claim: g.fuse
          ? `${label}: a timed fuse, it detonates at the start of the thrower's next turn`
          : `${label}: detonates on contact, the turn it is thrown`,
        direction: g.fuse ? "up" : "none",
        curve: { kind: "equals" },
        magnitude: (c) => (c.GRENADES[k].fuse ? 1 : 0),
      }),
      g.fuse
        ? entry({
            ...shared("movedClear"),
            claim: `${label}: before it detonates, each foe of the target's group may move clear and is not hit`,
            curve: { kind: "event", metric: "foes that moved clear over 64 detonations at a group of two" },
            magnitude: () => 1,
          })
        : entry({
            ...shared("movedClear"),
            probe: undefined,
            contexts: [],
            claim: `${label}: no fuse, so no foe moves clear`,
            direction: "none",
            curve: { kind: "equals" },
            notApplicable: "detonates on contact: there is no fuse for a foe to move clear of",
          }),
    );
  }
  for (const line of CONDITION_LINE_IDS) {
    CONDITION_LINES[line].forEach((r, i) =>
      out.push(
        entry({
          id: `away:CONDITION_LINES:${line}:${r.id}`,
          system: "away",
          source: { catalog: "CONDITION_LINES", key: `${line}:${r.id}` },
          claim: `${r.label}: severity rank ${i + 1} of the ${line} line, worse at higher ranks`,
          // Field Kits FKR-4: the bone hits a fresh combatant takes to hold this rank (Fracture first, one rank worse per
          // hit); its power and accuracy cut is its GAMBIT_STATUSES entry.
          probe: `content:bone:${r.id}`,
          contexts: ["ground"],
          direction: "none",
          curve: { kind: "equals" },
          magnitude: (c) => c.CONDITION_LINES[line].findIndex((x) => x.id === r.id) + 1,
          on: sourceOn,
        }),
      ),
    );
  }
  // Field Kits FKR-7: the free basic set, refilled as a crew lands on an objective (every objective and every trip),
  // frozen at dispatch off the ship's Medical and Operations headcount (fieldKitsRun.ts). Its base is read verbatim; the
  // crew's D23 curve (FREE_BASIC_CURVE_KNEE, whole kits) is its own entry: a ship with Medical crew lands more kits.
  for (const id of Object.keys(FREE_BASIC_SET) as FieldKitId[]) {
    out.push(
      entry({
        id: `away:FREE_BASIC_SET:${id}`,
        system: "away",
        source: { catalog: "FREE_BASIC_SET", key: id },
        claim: `Free basic set: every member starts each objective with ${FIELD_KITS[id].label} supplies`,
        curve: { kind: "equals" },
        magnitude: (c) => c.FREE_BASIC_SET[id]?.base ?? 0,
        probe: `content:freeBasic:${id}:base`,
        contexts: ["ground"],
        on: sourceOn,
      }),
    );
    if (FREE_BASIC_SET[id]?.crewCurve) {
      out.push(
        entry({
          id: `away:FREE_BASIC_SET:${id}:crew`,
          system: "away",
          source: { catalog: "FREE_BASIC_SET", key: `${id}:crew` },
          claim: `Free basic set: more ${FIELD_KITS[id].label} supplies with Medical and Operations crew (diminishing, knee ${FREE_BASIC_CURVE_KNEE} kits)`,
          curve: { kind: "event", metric: "free kits a member lands with, 16 Medical crew vs none" },
          magnitude: () => 1,
          probe: `content:freeBasic:${id}:crew`,
          contexts: ["ground"],
          on: sourceOn,
        }),
      );
    }
  }
  // FKR-3: the Quartermaster price of each kit (N13, 3x material value). FKR-7: the Quartermaster's kit sale charges it
  // (quartermaster.ts buyFieldKits), and so does a dispatch's top-up (fieldKitsRun.ts planDispatchPacks).
  for (const id of FIELD_KIT_IDS) {
    out.push(
      entry({
        id: `facility:FIELD_KIT_PRICES:${id}`,
        system: "facility",
        source: { catalog: "FIELD_KIT_PRICES", key: id },
        claim: `${FIELD_KITS[id].label}: the Quartermaster sells it for its price`,
        direction: "none",
        curve: { kind: "equals" },
        magnitude: (c) => c.FIELD_KIT_PRICES[id],
        probe: `content:kitPrice:${id}`,
        contexts: ["facility"],
        on: sourceOn,
      }),
    );
  }
  return out;
}

// ============================================================================
// crew scalars, the away team's crew strength, the medical bay
// ============================================================================

function crewScalarEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  // Every crew rarity and rank scales a bucket's buffs (crew.ts contributionForSignature): measured on Efficient
  // Unloading, the bonus part above 1 of the unload speed grows by the multiplier's step from the standard Crewman.
  const opsBucket = (over: Partial<CrewBucket>): Transform => (s) => withBuckets(s, [{ ...bucketOf("operations", "ops.unloadSpeed"), ...over }]);
  for (const [rarity, mult] of Object.entries(CREW_RARITY_MULTIPLIER) as [EquipmentRarity, number][]) {
    // RARITY READINESS RR-7 (answer 7): the rows above the crew cap exist so a raised cap never makes a higher band
    // weaker, but the generator never mints above CREW_RARITY_CAP (Stellar), so nothing reads them until the user raises
    // the cap: deferred with the user's words, never claimed live.
    if (rarityIndex(rarity) > rarityIndex(CREW_RARITY_CAP)) {
      out.push(
        entry({
          id: `crew:CREW_RARITY_MULTIPLIER:${rarity}`,
          system: "crew",
          source: { catalog: "CREW_RARITY_MULTIPLIER", key: rarity },
          claim: `${rarity} crew carry their buffs at x${mult}`,
          status: {
            kind: "deferred",
            owner: "the patch that raises CREW_RARITY_CAP above Stellar",
            userRef: "rarity readiness answer 7 (2026-10-22): \"Yes, same for both (Recommended)\": multiplier rows Radiant to Constellar so higher crew are always stronger, Luminous and Constellar sharing one value, and the cap staying at Stellar until the user raises it",
          },
        }),
      );
      continue;
    }
    out.push(
      entry({
        id: `crew:CREW_RARITY_MULTIPLIER:${rarity}`,
        system: "crew",
        source: { catalog: "CREW_RARITY_MULTIPLIER", key: rarity },
        claim: `${rarity} crew carry their buffs at x${mult}`,
        probe: "sheetUnload",
        contexts: mult === 1 ? [] : ["sheet"],
        direction: mult >= 1 ? "up" : "down",
        curve: { kind: "bonusRelative", base: 1 },
        magnitude: (c) => (c.CREW_RARITY_MULTIPLIER[rarity] ?? 1) - 1,
        on: opsBucket({ rarity: rarity as CrewBucket["rarity"] }),
        off: opsBucket({}),
        ...(mult === 1 ? { notApplicable: "the reference rarity (x1)" } : {}),
      }),
    );
  }
  for (const rank of CREW_RANK_ORDER) {
    out.push(
      entry({
        id: `crew:CREW_RANKS:${rank}`,
        system: "crew",
        source: { catalog: "CREW_RANKS", key: String(rank) },
        claim: `${CREW_RANKS[rank].label}: buffs at the rank factor`,
        probe: "sheetUnload",
        contexts: rank === 1 ? [] : ["sheet"],
        curve: { kind: "bonusRelative", base: 1 },
        magnitude: () => rankMagnitudeFactor(rank) - 1,
        on: opsBucket({ rank }),
        off: opsBucket({}),
        ...(rank === 1 ? { notApplicable: "the reference rank (x1)" } : {}),
      }),
    );
  }
  // The away team's crew layer (gambit.ts deriveAwayTeam): Security and Science heads become squad strength.
  for (const [profession, probe] of [
    ["security", "expSecurityStrength"],
    ["science", "expScienceStrength"],
  ] as const) {
    out.push(
      entry({
        id: `crew:awayTeamStrength:${profession}`,
        system: "crew",
        source: { catalog: "AWAY_TEAM_STRENGTH", key: profession },
        claim: `${profession} crew strengthen the away team`,
        probe,
        contexts: ["ground"],
        magnitude: () => WIRING_BUCKET_COUNT, // standard Crewmen: one point a head
        on: (s) => withBuckets(s, [bucketOf(profession, "wiring.none")]),
      }),
    );
  }
  out.push(
    entry({
      id: "crew:awayTeamStrength:officerSeat",
      system: "crew",
      source: { catalog: "AWAY_TEAM_STRENGTH", key: "officerSeat" },
      claim: "A Tactical officer strengthens the Security squad",
      probe: "expSecurityStrength",
      contexts: ["ground"],
      curve: { kind: "event", metric: "squad strength" },
      magnitude: () => 1,
      on: (s) => seatOfficer(s, "tactical", []),
    }),
    entry({
      id: "crew:awayTeamStrength:teamKit",
      system: "crew",
      source: { catalog: "AWAY_TEAM_STRENGTH", key: "teamKit" },
      claim: "Medical and Operations crew stock the team kit",
      probe: "expTeamKit",
      contexts: ["ground"],
      curve: { kind: "event", metric: "team kit consumables" },
      magnitude: () => 1,
      on: (s) => withBuckets(s, [bucketOf("medical", "wiring.none")]),
    }),
  );
  return out;
}

const ossir: Transform = (s) => editMember(s, WIRING_SECURITY_ID, { race: "ossir" });
// Field Kits FKR-4: a Field Kits run's fights apply every bay condition (Bleed since the user's 2026-10-19 call:
// a Striker's landed normal hit, fieldKitsConditions.ts STRIKER_NORMAL_HIT_AFFLICTION). None pending.
const PENDING_CONDITIONS: Readonly<Record<string, string>> = {};

function medicalEntries(): WiringEntry[] {
  const out: WiringEntry[] = Object.keys(GROUND_CONDITIONS).map((id) => {
    const owner = PENDING_CONDITIONS[id];
    return entry({
      id: `away:GROUND_CONDITIONS:${id}`,
      system: "away",
      source: { catalog: "GROUND_CONDITIONS", key: id },
      claim: `${GROUND_CONDITIONS[id].label}: its medical bay time`,
      probe: owner ? undefined : `content:cure:${id}`,
      contexts: owner ? [] : ["medbay"],
      direction: "none",
      curve: { kind: "equals" },
      magnitude: () => GROUND_CONDITIONS[id].cureSeconds,
      status: owner ? pending(owner) : LIVE,
    });
  });
  out.push(
    entry({
      id: "away:MEMBER_PERKS:stoneskin",
      system: "away",
      source: { catalog: "MEMBER_PERKS", key: "stoneskin" },
      claim: "Ossir Stoneskin: injuries take longer to heal in the bay (x1.25)",
      probe: "content:cure:fracture:stoneskin",
      contexts: ["medbay"],
      curve: { kind: "linearRelative" },
      magnitude: () => STONESKIN_INJURY_MULT - 1,
      tolerance: 1,
      on: sourceOn,
      status: pending("OC-G1 (the legacy claim ignores perks, injuries.ts:93)", ["expedition:legacy"]),
      // An Ossir Security member (the race carries the perk) vs an Earth-born one: the legacy injury path's recovery
      // time. (The in-battle half is its own entry below, live since Field Kits FKR-4.)
      flatChecks: {
        "expedition:legacy": { probe: "legacyInjurySeconds", base: () => withAwayTeam(wiringBase()), on: ossir, off: identity },
      },
    }),
    // Field Kits FKR-4: Stoneskin's battle half (D24 "Chances of receiving physical ailments is reduced by 25%, but if
    // they do land, they last for 25% longer"): on a Field Kits run's fight an Ossir member's resist roll against a
    // physical status (a Fracture here) rises by STONESKIN_BATTLE_RESIST; the longer duration rides the same stamp.
    entry({
      id: "away:MEMBER_PERKS:stoneskin:battle",
      system: "away",
      source: { catalog: "MEMBER_PERKS", key: "stoneskin:battle" },
      claim: "Ossir Stoneskin: physical conditions land 25% less often in battle and last 25% longer",
      probe: "runSecStoneskinResist",
      contexts: ["ground"],
      curve: { kind: "chanceAbsolute" },
      magnitude: () => STONESKIN_BATTLE_RESIST * 1000,
      tolerance: 1,
      base: () => withAwayTeam(wiringBase()),
      on: ossir,
      off: identity,
    }),
  );
  return out;
}

// ============================================================================
// Audit rows with no catalog key of their own (plan section 2): seams, record fields, legacy-only constants,
// display text that promises an effect, and the combat descriptors the sim never feeds. Registered so the release
// gate and the Debug panel see every not-live row; each names its owning slice.
// ============================================================================

const AUDIT_ROWS: readonly { id: string; system: WiringSystem; claim: string; status: WiringStatus }[] = [
  // A. Captain
  { id: "captain:audit:gearGates", system: "captain", claim: "Gear gates minCaptainLevel / requiresTalent / captainSpec (no slot sets them)", status: pending("WR-4, OC-C4") },
  // C. Facilities, items, fuel
  { id: "facility:audit:fuelAutoBuy", system: "facility", claim: "The mission fuel budget and credit auto-buy plumbing (FUEL_CREDITS_PER_UNIT, REFUEL_PENALTY_TICKS, refuelDelayTicks): unreachable since 0.13.6 (an infinite fuel budget). (B5's Buy Fuel, tank and refinery are gone, WR-4.)", status: pending("S4-A02 (the fuel-economy cleanup: remove or keep, a user call)") },
  { id: "facility:audit:requiresResearch", system: "facility", claim: "The requiresResearch rung gate (B1 fixed in WR-4: it checks the researched blueprint; no rung lists one yet)", status: pending("OC-C4") },
  { id: "facility:audit:requiresFacilityLevels", system: "facility", claim: "requiresFacilityLevels rung gate (correct, no rung uses it); its twin requiresMissionCompletions is live on the Short-Range board's level 2 rung (G1-6, facility:audit:missionControlUnlock)", status: pending("WR-4, OC-C4") },
  // G1-6 flipped SHORT_RANGE_BOARD_LIVE: the board rungs are in FACILITIES (each enumerates as a facility rung entry on
  // the shortRangeSlots probe), and this row checks their 50-completion gate (auditRowWiring).
  { id: "facility:audit:missionControlUnlock", system: "facility", claim: "MISSION_CONTROL_UNLOCK_COMPLETIONS 50: the Mission Control board rung that opens the Tier II short-range slot (MISSION_CONTROL_BOARD_RUNGS[0], level 2) waits on 50 completions of each ore run", status: LIVE },
  { id: "facility:audit:itemEquipStats", system: "facility", claim: "ItemDef.equipStats (no item fills it)", status: pending("WR-4, OC-C4") },
  { id: "facility:audit:precursorCircuit", system: "facility", claim: "Precursor Circuit: salvage drops it, nothing consumes it", status: pending("WR-10, OC-J3") },
  // D. Ship
  { id: "ship:audit:statRatios", system: "ship", claim: "Variety statRatios: an unlisted key keeps weight 1, so Hauler Hold rolls massReduction more than Prospector Hold (B11)", status: pending("WR-7, OC-D6") },
  { id: "ship:audit:favorsSpec", system: "ship", claim: "Variety favorsSpec (no reader)", status: pending("WR-7, OC-D5") },
  { id: "ship:audit:slotPowerDraw", system: "ship", claim: "SLOT_BASE_PHYSICALS powerDraw: a crafted piece draws its slot's power from the ship's budget", status: LIVE },
  // Gear wear step 3: a piece's durabilityMax is its TOUGHNESS (gearWear.ts toughnessScale): every use wear amount on
  // it scales by TOUGHNESS_REFERENCE / durabilityMax, so the slot bases act on every piece that wears by use (economy,
  // crew, sensor and member pieces). The defense pieces wear by battle (step 4): their own row below.
  { id: "ship:audit:slotDurability", system: "ship", claim: "SLOT_BASE_PHYSICALS durability for economy, crew, sensor and member pieces: a tougher piece wears slower by use", status: LIVE },
  // Gear wear step 4: the defense pieces' toughness scales their battle wear (gearWear.ts applyBattleWearAt).
  { id: "ship:audit:slotDurabilityDefense", system: "ship", claim: "SLOT_BASE_PHYSICALS durability for defense pieces (shield emitters, hull plating): a tougher piece wears slower in battle", status: LIVE },
  // E-MOD EM-4 (P3 "Speeds the drive"): B10 fixed. The core's unused power lifts the transit speed (reactorSurplus.ts),
  // and its mass only eats into that lift (never slower than Standard Issue); its mass still costs fuel efficiency.
  { id: "ship:audit:reactorCoreNet", system: "ship", claim: "A crafted Reactor Core's unused power speeds the drive on a diminishing curve (the hull's own power is never surplus); its mass eats into that lift but never makes the ship slower than Standard Issue (B10 fixed)", status: LIVE },
  { id: "ship:audit:arrayCharacter", system: "ship", claim: "ARRAY_CHARACTER: \"Focused: faster\" while its net rate is 0.78x; no Bio-Resonance line (B12)", status: pending("WR-7, OC-D11") },
  { id: "ship:audit:hullDescriptions", system: "ship", claim: "Hull descriptions (Aurora, Eir, Orion) claim what the engine does not do", status: pending("WR-7, OC-D13 (heavy cruiser wording: SF-6)") },
  // WR-8 (0.14.0, OC-D9 "Enemies start at range", OC-D12 "Feed them all"): the combat descriptors, each live with its
  // own check (auditRowWiring, combatDescriptorProbes.ts). Every one acts only on a battle whose run carries the
  // combat rules stamp (a patrol cycle or an expedition started since WR-8), except the gear lines and their rows.
  { id: "ship:audit:combatPositions", system: "ship", claim: "Fights open at range: the enemy side opens at ENCOUNTER_OPEN_DISTANCE and closes (patrol waves and the ship events)", status: LIVE },
  { id: "ship:wr8:weaponRange", system: "ship", claim: "Weapon range gates fire: a gun fires only at a target within its range", status: LIVE },
  { id: "ship:wr8:droneRange", system: "ship", claim: "Drone range gates volleys: a squadron volleys only at a target within its reach", status: LIVE },
  { id: "ship:wr8:stance", system: "ship", claim: "Stance (the one the player picks per patrol, and every pirate's) decides where a ship parks under the combat rules (resolveBattle.ts stanceHoldDistance)", status: LIVE },
  { id: "ship:wr8:speedKite", system: "ship", claim: "Speed: only a faster ship opens the range on its target (an equal or slower one holds and the fight closes); a Defensive ship backs off only if faster", status: LIVE },
  // WR-8 review (user 2026-10-22, "if it's a systemic issue, we fix the systemic issue"): the stances park where their
  // guns work, and Defensive does all four of its claims. Every number [PROVISIONAL] (combatRules.ts DEFENSIVE_STANCE,
  // BALANCED_FIREPOWER_SHARE); each acts on a patrol whose cycle carries the combat rules stamp.
  { id: "ship:wr8:stanceAggressive", system: "ship", claim: "Aggressive parks at its shortest gun's reach (every gun fires)", status: LIVE },
  { id: "ship:wr8:stanceBalanced", system: "ship", claim: "Balanced parks at the farthest range where more than half its expected damage reaches (a Standard-Issue Destroyer's autocannon fires)", status: LIVE },
  { id: "ship:wr8:stanceBalancedShare", system: "ship", claim: "Balanced leaves a small short gun out when the long guns carry most of the damage (BALANCED_FIREPOWER_SHARE)", status: LIVE },
  { id: "ship:wr8:stanceDefensive", system: "ship", claim: "Defensive (stored key \"standoff\") parks at its longest gun's reach", status: LIVE },
  { id: "ship:wr8:defensiveDamageTaken", system: "ship", claim: "Defensive takes DEFENSIVE_STANCE.damageTakenPct less damage from every hit", status: LIVE },
  { id: "ship:wr8:defensiveDamageDealt", system: "ship", claim: "Defensive deals DEFENSIVE_STANCE.damageDealtPct less with its guns and drones", status: LIVE },
  { id: "ship:wr8:defensiveShieldRecharge", system: "ship", claim: "Defensive shields recharge DEFENSIVE_STANCE.shieldRechargePct faster", status: LIVE },
  { id: "ship:wr8:defensiveShieldAbsorb", system: "ship", claim: "Defensive shields stop DEFENSIVE_STANCE.shieldAbsorbPct more damage per point (their effective capacity)", status: LIVE },
  { id: "ship:wr8:closingEvasive", system: "ship", claim: "Closing is evasive: a ship closing toward its stance range while none of its guns reaches a foe takes CLOSING_EVASION_PCT less from every hit (both sides)", status: LIVE },
  { id: "ship:wr8:defensiveGuardWeapons", system: "ship", claim: "A Defensive ship's Point Defense and EMP turn on the in-range foe fielding the most drones first", status: LIVE },
  { id: "ship:wr8:defensiveGuardDrones", system: "ship", claim: "A Defensive ship's drone squadrons hunt the in-range foe's drone screen first", status: LIVE },
  {
    id: "ship:wr8:defensiveMissileIntercept",
    system: "ship",
    claim: "A Defensive ship with working Point Defense or EMP shoots down DEFENSIVE_STANCE.missileInterceptPct of incoming missiles (the engine reads it; no enemy fires a missile in 0.14.0)",
    status: pending("the first enemy loadout with a missile (WR-8 review: no pirate or ship event vessel installs a torpedo yet)"),
  },
  { id: "ship:audit:ftlSpeedPenalty", system: "ship", claim: "FTL_SPEED_PENALTY: a Degraded or Offline drive slows the close", status: LIVE },
  { id: "ship:wr8:sensorDrainActs", system: "ship", claim: "Sensor Power Drain shrinks a ship's weapon reach in the fight", status: LIVE },
  { id: "ship:wr8:coolantLeakActs", system: "ship", claim: "Coolant Leak slows a ship in the fight", status: LIVE },
  { id: "ship:wr8:manifoldOverheatActs", system: "ship", claim: "Manifold Overheat cuts a pirate hull's evasion", status: LIVE },
  { id: "ship:audit:torpedoArmorPen", system: "ship", claim: "Torpedo armorPen sees through a pirate hull's armor", status: LIVE },
  { id: "ship:audit:qualityDurabilityMax", system: "ship", claim: "qualityDurabilityMax for the reactor and FTL: the installed Reactor Core's and FTL drive's quality sets their combat pools (WR-8; gear wear step 4 opens them at the piece's true condition)", status: LIVE },
  { id: "ship:audit:particleTraceDetector", system: "ship", claim: "particleTraceDetector (hard 0, bridge.ts:960)", status: { kind: "deferred", owner: "CP-15 (patrol cloak detection)", userRef: `${T3}: patrol cloak detection` } },
  // WR-8 review: only an explorer on an expedition is ever ambushed in 0.14.0 and no explorer has a drone bay, so a pod's
  // Rapid Charge could never act; the line stays out of the pod pool and both rows wait (the engine reads it already:
  // resolveBattle's return-fire delay, bridge.ts podLinePoints).
  { id: "ship:audit:rapidChargeAfterAmbush", system: "ship", claim: "Rapid Charge shortens an ambushed ship's return-fire delay", status: RAPID_CHARGE_DEFERRED },
  { id: "ship:wr8:podRapidChargeLine", system: "ship", claim: "Rapid Charge as a drone pod line (droneRapidCharge on combatRules.ts podLineShare): out of the pod pool until a ship with drone bays can be ambushed", status: RAPID_CHARGE_DEFERRED },
  { id: "ship:audit:inCombatReplenishPercent", system: "ship", claim: "In-Combat Replenish (a drone pod line) rebuilds and repairs drones during the fight", status: LIVE },
  { id: "ship:audit:antiDrone", system: "ship", claim: "Point Defense and EMP fire at the target's drones (anti-drone fire)", status: LIVE },
  { id: "ship:audit:smartReflect", system: "ship", claim: "Smart Reflect (a Defense pod line) sends reflected shots at the weakest foe", status: LIVE },
  { id: "ship:audit:droneDisrupted", system: "ship", claim: "An EW anti-drone hit leaves a drone it does not destroy disrupted (drone evasion when targeted acts on the anti-drone fire)", status: LIVE },
  { id: "ship:audit:familyResists", system: "ship", claim: "damageResist_<family> / disruptionResist_<family>: crafted Hull Plating rolls the damage resists, Shield Emitters the disruption resists", status: LIVE },
  { id: "ship:audit:installedSystems", system: "ship", claim: "Reactor / FTL systems from installed gear: the combat pools take the installed pieces' quality", status: LIVE },
  { id: "ship:audit:derivedStatsInCombat", system: "ship", claim: "ShipDerivedStats in combat: the transit speed (its gear, crew, captain and mass drag) sets the combat speed", status: LIVE },
  // E-MOD EM-3 (user answers 2026-10-17: Over budget "Gentle penalty curve", P6 "sqrt curve, floor 60%"): live in place,
  // its checks in wr8AuditWiring below; the shield and floor rows beside it are EM-3's own.
  { id: "ship:wr8:powerInCombat", system: "ship", claim: "ShipDerivedStats in combat: power output against the net draw. An over-budget ship's weapons hit at its power supply (sqrt(output / draw), frozen in the run's combat rules stamp)", status: LIVE },
  { id: "ship:em3:powerShieldRecharge", system: "ship", claim: "An over-budget ship's shields recharge at its power supply in combat", status: LIVE },
  { id: "ship:em3:powerSupplyFloor", system: "ship", claim: "POWER_SUPPLY_FLOOR_PERCENT: however far over budget, a ship fights at no less than this power supply (nothing shuts off)", status: LIVE },
  { id: "ship:audit:weaponPowerDraw", system: "ship", claim: "Weapon powerDraw: a crafted weapon draws its def's power from the ship's budget", status: LIVE },
  { id: "ship:audit:commentOnlyRules", system: "ship", claim: "The Tachyon anti-shield exception: a Tachyon shot takes its own vs-Shields column", status: LIVE },
  { id: "ship:wr8:voltaicChain", system: "ship", claim: "The Voltaic chain: a connecting Voltaic shot arcs part of its damage onto the attacker's weakest other foe", status: LIVE },
  { id: "ship:wr8:vsDronesColumn", system: "ship", claim: "The vs-Drones triangle column: a drone absorbing a shot takes its family's column (Kinetic 90%, Particle 100%, EW 110%)", status: LIVE },
  { id: "ship:wr8:statusPersistence", system: "ship", claim: "Statuses persist across the waves of one patrol: the next wave opens with what the last one left", status: LIVE },
  { id: "ship:wr8:inhibitSource", system: "ship", claim: "Point Defense procs Inhibit on a target that fields drones", status: LIVE },
  { id: "ship:wr8:inhibitReader", system: "ship", claim: "Inhibit slows the inhibited ship's drone volleys and pulses", status: LIVE },
  { id: "ship:wr8:overchargeSource", system: "ship", claim: "A support drone pulse charges its owner's capacitors (Overcharged Capacitors)", status: LIVE },
  // OC-C4 (user 2026-10-15): "Keep tested hooks (Recommended)". builtInBays (a duplicate of SHIP_TYPES droneBays) and the
  // legacy frameHp split were retired by WR-8.
  { id: "ship:audit:inertDescriptors", system: "ship", claim: "ResolveOptions.objective (a pluggable win condition), TargetingPolicy.escortShare (escort ships) and the DoT rng (a DoT with variance): framework hooks with no caller", status: { kind: "seam", owner: "the first mission type with its own win condition, escort ships, a varying DoT", userRef: "OC-C4 (user 2026-10-15): \"Keep tested hooks (Recommended)\"" } },
  { id: "ship:audit:statusColor", system: "ship", claim: "Status color (no reader)", status: pending("WR-11 (use in the combat view or delete; no call)") },
  { id: "ship:audit:partialCombat", system: "ship", claim: "Patrols pre-charge their guns during the close, like the ship events", status: LIVE },
  { id: "ship:wr8:enemyMitigation", system: "ship", claim: "Enemy mitigation and evasion: a pirate hull fights with its armor and evasion", status: LIVE },
  { id: "ship:wr8:ambushInPatrols", system: "ship", claim: "The ambush opener in patrols (only a cloak ambushes; it and Rapid Charge act in the ship events today)", status: { kind: "deferred", owner: "CP-15 (patrol cloak detection)", userRef: `${T3}: patrol cloak detection` } },
  // Gear wear step 4: a pod wears by its drones lost, scaled by its toughness (DRONE_POD_BASE_DURABILITY, lifted by
  // QUALITY_DURABILITY_BONUS like every non-weapon piece).
  // Gear wear step 4, pause to repair (user 2026-10-27 "Pause to repair"): a stamped Repeat patrol whose next cycle would
  // break a worn system (projectedCycleBreak, the trigger from realism, user 2026-10-28) goes home to repair, then resumes.
  { id: "ship:audit:patrolRepairPause", system: "ship", claim: "A Repeat patrol whose next cycle would break a worn system goes home to repair first, then resumes", status: LIVE },
  { id: "ship:audit:podDurability", system: "ship", claim: "DRONE_POD_BASE_DURABILITY and QUALITY_DURABILITY_BONUS on non-weapons: a pod (and every piece) is as tough as its durability, so a tougher one wears slower in battle", status: LIVE },
  // E. Crew
  { id: "crew:audit:enlisted", system: "crew", claim: "The crew rank enlisted flag (never read)", status: pending("WR-9, OC-E11") },
  { id: "crew:audit:thirdBuff", system: "crew", claim: "buffCountForRank 3 (only gates the exclusive pick)", status: pending("WR-9, OC-E12") },
  { id: "crew:audit:commandCaps", system: "crew", claim: "Command structure caps (passive ships only; not enforced on load)", status: pending("CP-5, CP-7") },
  { id: "crew:audit:rapidLoadoutScope", system: "crew", claim: "Rapid Loadout acts on Ground Ops only", status: pending("WR-9, OC-E6") },
  { id: "crew:audit:moraleAttrition", system: "crew", claim: "Morale Anchor's \"complement attrition\" half (no system)", status: pending("WR-9, OC-E7") },
  // The inert racials (0.14.0): the Spacer racial went live on the transit speed (user 2026-10-20 "+Transit speed"); the
  // long-haul ramp it was first named for stays the user's 0.14.x deferral, kept visible here.
  {
    id: "crew:audit:spacerLongHaulRamp",
    system: "crew",
    claim: "The Spacer long-haul ramp (crew.endurance: a complement build-up like Constitution, D23 curve; no source in 0.14.0)",
    status: { kind: "deferred", owner: "Task 23: complement long-haul ramp (D26)", userRef: `${T3}: the Spacer long-haul ramp` },
  },
  { id: "crew:audit:commandPresenceExpedition", system: "crew", claim: "Command Presence and Operations Integrity do not reach expeditions", status: pending("WR-9, OC-E9") },
  // F. Away team and ground
  { id: "away:audit:shroudLureGroundOps", system: "away", claim: "Shroud Emitter and Lure Beacon work on the ground (OC-F1): they scale a crew's ambush chance on a calm objective, rolled per use", status: LIVE },
  { id: "away:audit:neuralBackupClaim", system: "away", claim: "Neural Backup revives the FIRST downed ally; its flavor says the wearer (B13)", status: pending("WR-10, OC-F2") },
  { id: "away:audit:medKitClaim", system: "away", claim: "Med Kit \"keeps a downed friend in the fight\" (no revive)", status: pending("WR-10, OC-F3") },
  { id: "away:audit:quickDraw", system: "away", claim: "Quick Draw only reorders teammates (the team already acts first)", status: pending("WR-10, OC-F5") },
  { id: "away:audit:scienceRank", system: "away", claim: "Science member rank \"nudges magnitude\" (fieldwork never reads it)", status: pending("WR-10, OC-F7") },
  { id: "away:audit:fieldDeviceEffectiveness", system: "away", claim: "Field devices work at a rolled 50 to 75% per use (fieldKits.ts fieldDevicePercent; the old untrained / trained knob retired)", status: LIVE },
  // WR-8 settled mass and power draw (0 by design: member gear never moves ship stats) and gear wear step 3 made the
  // durability live (a member piece's toughness scales its use wear, wired through ship:audit:slotDurability's check).
  { id: "away:audit:memberSlotPhysicals", system: "away", claim: "Member slot physicals: durability is the piece's toughness (a tougher member piece wears slower by use; ship:audit:slotDurability); mass and power draw are 0 by design (member gear never moves ship stats)", status: LIVE },
  // Field Kits FKR-7: the Injury Kit's share (a fight's `treated`) sums on the member's trip treatment and the run's bay
  // divides that member's cures by it (auditRowWiring below).
  { id: "away:audit:treatmentShare", system: "away", claim: "An Injury Kit shortens the treated member's medical bay time (treatmentShare)", status: LIVE },
  { id: "away:audit:memberFallOutcome", system: "away", claim: "memberFallOutcome (the Safety Interlock hook, one branch)", status: pending("OC-F13") },
  { id: "away:audit:prospectingTeam", system: "away", claim: "The Prospecting squad type: built (specs, traits, YIELD / GRADE, recruits, gear, slots), hidden until a quest step unlocks it per save", status: PROSPECTING_DEFERRED },
  { id: "away:audit:prospectingUnlock", system: "away", claim: "The per-save Prospecting unlock (GameState.prospectingSquadsUnlocked, unlockProspectingSquads): nothing sets it in 0.14.0", status: PROSPECTING_DEFERRED },
  { id: "away:audit:prospectingBoardSlots", system: "away", claim: "The recruit board's separate Prospecting slots (PROSPECTING_BOARD_SLOTS), shown once unlocked", status: PROSPECTING_DEFERRED },
  { id: "away:audit:prospectingTeamKinds", system: "away", claim: "The hidden Claim and Dig team kinds and their Prospecting slots (refused \"kindLocked\" while locked)", status: PROSPECTING_DEFERRED },
  { id: "away:audit:prospectingStandardIssue", system: "away", claim: "The Quartermaster's Standard-Issue Prospecting rows (Plasma Cutter, Excavator Suit, Assay Scanner), shown once unlocked", status: PROSPECTING_DEFERRED },
  { id: "away:audit:steadyProspecting", system: "away", claim: "Steady's Prospecting reach (+hazard resistance on a Prospecting member)", status: PROSPECTING_DEFERRED },
  { id: "away:audit:sharedHazardGear", system: "away", claim: "The Hazard Suit and Environmental Adaptation worn by Prospecting (shared hazard gear)", status: PROSPECTING_DEFERRED },
  { id: "away:audit:prospectingDigSafety", system: "away", claim: "Dig safety: a Prospecting crew's Armor and HP cut cave-in and retreat injuries (prospectingCrewStats digSafety, DIG_SAFETY_KNEE)", status: PROSPECTING_DEFERRED },
  // Field Kits FKR-5 review ruling (user 2026-10-20 "Hide until kits are live"): model.ts FIELD_KITS_PLAYER_LIVE.
  // FKR-7 kept both switches off; FKR-9 / FKR-10 flipped both with the pack screen (user 2026-10-20 "Yes, with the pack
  // screen"): live in place with their own checks (auditRowWiring below).
  { id: "away:audit:fieldKitsHiddenPieces", system: "away", claim: "Hidden until kits are live (FIELD_KITS_PLAYER_LIVE): the Impact Grenade blueprint (FIELD_KITS_HIDDEN_BLUEPRINTS, out of Research, the Fabricator and the Archive) and the +1 Carry Capacity line on new Stun and Toxin Grenade crafts", status: LIVE },
  { id: "away:audit:fieldKitsRunsSwitch", system: "away", claim: "Field Kits in runs (fieldKits.ts FIELD_KITS_RUNS_LIVE): a new dispatch stamps flag 2, packs each member from stock, buys a top-up team's shortfall, and the unused extras come home at claim", status: LIVE },
  { id: "away:audit:statusPicker", system: "away", claim: "Status picker entries that never match (Corroded: only Analyze inflicts it, and no battle runs Analyze)", status: pending(FKR11_REOWNED.statusPicker) },
  { id: "away:audit:fieldRepairOrder", system: "away", claim: "Player-ordered field repair (engine only, no UI)", status: pending("WR-10, OC-F14") },
  { id: "away:audit:legacyOnly", system: "away", claim: "Legacy-only: MAX_BATTLE_ATTEMPTS, EVAC_REWARD_FRACTION, ENCOUNTER_DROP_SCALE, scan ground battles, softenAmbush, the flat 2 h injury", status: pending("OC-G1") },
  // Expedition Tiers G2-6: the region picker offers every tier, so the tier rows read on a player's launch (the run's
  // risk profile at the picked tier). The tier haul and the tier body counts have their own rows (the G2-2 review
  // note); the future difficulty tiers keep theirs (nothing designed yet).
  { id: "away:audit:tierDormant", system: "away", claim: "The tier rows a deeper launch reads: RISK_TIER_ODDS II to VII, enemy territory (the homeworld's fixed sectors), hostile sites, SCIENCE_HEAVY, affix rows above Tier I, the deeper famous systems", status: LIVE },
  { id: "away:audit:tierHaulMult", system: "away", claim: "The tier haul TIER_HAUL_MULT II to VII: every objective's haul of a deeper run, x1.25 to x3.3 (user G16)", status: LIVE },
  { id: "expedition:audit:tierBodyCount", system: "expedition", claim: "TIER_BODY_COUNT II to VII: deeper systems hold more bodies, up to 3 to 5 at Tiers VI and VII (user G17)", status: LIVE },
  { id: "away:audit:difficultyTiers", system: "away", claim: "DIFFICULTY_TIER_ROLL_MULT above the base difficulty tier (the future difficulty tiers hook: one row today)", status: pending("SF-3 follow-up (the future difficulty tiers: nothing designed; objective affixes capture 2026-10-14)") },
  { id: "away:audit:objectiveHooks", system: "away", claim: "taskChainFollowUp, calmObjective, affix weightFor (no caller)", status: pending("OC-C4") },
  // G. Expedition content
  { id: "expedition:audit:siteFlavor", system: "expedition", claim: "Hostile and clearing site flavor (never rendered)", status: pending("WR-11 (render; no call)") },
  { id: "expedition:audit:anomalyFinding", system: "expedition", claim: "Charting the anomaly costs a detour (a voyage run: 25% of its outbound leg; an older run: 1 h) and pays nothing (B15)", status: pending("WR-11, OC-G3") },
  // Expedition Tiers G2-3: the voyage engine reaches every tier and every drive class (voyage.test.ts proves the ladder,
  // the band scale and the halving); since G2-6 a player picks any tier on the console, so the deeper ladder is live.
  { id: "expedition:audit:voyageDeepTiers", system: "expedition", claim: "The voyage ladder above Tier I: TIER_TRANSIT_HOURS II 4 h, III 8 h, IV 12 h, V 24 h, VI 72 h, VII 168 h", status: LIVE },
  // Expedition Tiers G2-4 (propulsion.ts): a Class II drive is researchable, installable and halves a Tier I leg today;
  // the deep-space reach reads its class at every launch; no hull but an explorer launches. The tier gates themselves
  // (drive class and frontier sensors per tier) refuse at Tier II and deeper, which a player picks on the G2-6 console.
  { id: "expedition:audit:voyageDriveClass", system: "expedition", claim: "A voyage leg halves per drive class above the tier's minimum (voyage.ts voyageClassSteps; the ship's class: propulsion.ts shipDriveClass)", status: LIVE },
  { id: "expedition:audit:deepSpaceReach", system: "expedition", claim: "Deep-space reach: the gear-inclusive range x DRIVE_CLASS_REACH_MULT by drive class x the Engineering long-haul ramp, against the round trip (outOfReach)", status: LIVE },
  { id: "expedition:audit:explorerHullGate", system: "expedition", claim: "Only an explorer hull launches an expedition, Tier I included (notExplorer)", status: LIVE },
  { id: "expedition:audit:driveClassTierGate", system: "expedition", claim: "A tier asks for a drive class at least its own number (driveClassTooLow, driveClassUnavailable)", status: LIVE },
  { id: "expedition:audit:frontierSensors", system: "expedition", claim: "Frontier sensors to attempt a tier: FRONTIER_SENSORS I 0, II 10, III 20, IV 30, V 40, VI 55, VII 65 (frontierSensors)", status: LIVE },
  { id: "expedition:audit:hullBaseDriveClass", system: "expedition", claim: "A hull's base drive class from its tier (propulsion.ts hullBaseDriveClass): every explorer built today is Class I", status: { kind: "seam", owner: "the first tier 3 explorer hull (none is built yet)", userRef: "G2 OC-3 (user 2026-10-16): \"A combination of higher tier ships and better drive blueprints/stats/etc.\"" } },
  // Expedition Tiers G2-5: the recall and the resumable systems are built in the engine (expeditionRecall.test.ts proves
  // the 1:1 times, the closing window and the resume); G2-6's console recalls, resumes and abandons.
  { id: "expedition:audit:recall", system: "expedition", claim: "Recall: home in the outbound time flown (the detour not counted), or after arrival the window closes, one shared pickup, then the full return leg; finished work comes home", status: LIVE },
  { id: "expedition:audit:resumableSystems", system: "expedition", claim: "A recalled system with charted bodies stays open to resume by any explorer (scans done, objectives keep progress, the trip flown again) until finished or abandoned; one recalled before anything was charted is an ordinary candidate again", status: LIVE },
  { id: "facility:audit:heldDriveClasses", system: "facility", claim: "The Class III to VII Drive Blueprints (DRIVE_CLASS_BLUEPRINTS) join BLUEPRINTS once the Research Lab and Fabricator tracks reach their tiers", status: LIVE },
  { id: "expedition:audit:anomalySensors", system: "expedition", claim: "ANOMALY_CHANCE_PERMILLE: \"if sensors detect one\" (sensors not read)", status: pending("WR-11, OC-G3") },
  { id: "expedition:audit:relicSignature", system: "expedition", claim: "Foreknowledge relicSignature (the UI never reads it)", status: pending("WR-11 (delete or render; no call)") },
  { id: "expedition:audit:blindLaunch", system: "expedition", claim: "The blind launch path (a candidate past the telescope's reach: a deeper tier)", status: LIVE },
  { id: "expedition:audit:oddsRiskyBelow", system: "expedition", claim: "ODDS_RISKY_BELOW (behind tier > 2)", status: LIVE },
  { id: "expedition:audit:shipEventProfileFields", system: "expedition", claim: "ShipEventProfile evasion and shieldCapacity (frozen, never read)", status: pending("WR-11, OC-G5") },
  { id: "expedition:audit:planetComments", system: "expedition", claim: "Planet comments: Ocean slower work, Frozen best relic survival, Toxic hardened team", status: pending("OC-G6") },
  { id: "expedition:audit:legacyFallbacks", system: "expedition", claim: "FIGHT_POINTS_DEFAULT / MIN, SURVEY_AMBUSH_CHANCE (old runs only)", status: pending("OC-G1") },
  // H. Relics v2 R2-2 (relicBlanks.ts): live on every new run at Tier I; the rest waits for the slice that reaches it.
  { id: "relic:audit:blankTiers", system: "relic", claim: "Relic blanks above Tier I: RELIC_BLANK_WEIGHTS II to VII (a deeper find rolls rarer on the same chance, user call 13 \"Better rarity only\")", status: LIVE },
  { id: "relic:audit:blankCulture", system: "relic", claim: "A blank's culture (cultureForBody, stamped on every new run's relic): the culture study reads it", status: pending("Relics v2 R2-6 (cultures: study points and the name reveal)") },
  // G1-5 wired the hook into every delivered cycle of a run dispatched from G1-5 on (shortRangeCycle.ts
  // shortRangeCycleRelics): live in place, its check in auditRowWiring below.
  { id: "relic:audit:shortRangeBlanks", system: "relic", claim: "Short-range relic drops (rollShortRangeRelicBlanks: per hour, Tier I 0.08x and Tier II 0.15x of the expedition rate)", status: LIVE },
  { id: "relic:audit:completionBlank", system: "relic", claim: "The planet 100% bonus roll (planetCompletionRelicBlank: one extra blank, one rarity step up)", status: pending("G7 (calls the hook when a planet is fully completed)") },
  // Relics v2 R2-3 (relicIdentify.ts; the queue in tick.ts): every new study identifies through identification v2.
  { id: "relic:audit:identifyV2", system: "relic", claim: "Identification v2: a new study reveals an exceptional piece at EXCEPTIONAL_PER_100K (user call 6), preferring the pieces the Museum lacks (call 7); else a general type on the blank's own rarity band odds (\"Only one boost\") with the site bias", status: LIVE },
  { id: "relic:audit:identifyLanes", system: "relic", claim: "Relic-study lanes by Research Lab tier (RELIC_STUDY_LANES_BY_LAB: Lab I 1, III 2, V 3, VII 4; user call 12)", status: LIVE },
  { id: "relic:audit:identifyQueue", system: "relic", claim: "The identification queue: the next queued blank starts the moment a lane frees, also while away (tick.ts queueRelicStudy / resolveRelicStudies)", status: pending("Relics v2 R2-7 (the Identification tab: feed, queue, reorder; the engine queue is built and tested)") },
  { id: "relic:audit:generalPick", system: "relic", claim: "A blank with no set identifies over the general pool by band, with the site bias (identifyGeneralRelic)", status: pending("Relics v2 R2-3 follow-up (retire the v1 setless branch of identifyStudiedRelic: identification v2, relic:audit:identifyV2, studies every new blank, G1-5's short-range blanks included, so no study reaches this pick)") },
  // Relics v2 R2-4 (relics.ts museum math v2): the per-tier soft cap snapshot (user calls 3 and 4).
  { id: "relic:audit:softCap", system: "relic", claim: "The soft cap: a tier's counts freeze for the regular game at RELIC_SOFT_CAP identified relics (1000 per tier, user call 3); counts keep growing and show (call 4)", status: LIVE },
  // Relics v2 R2-10 (secret/relicBoosts.ts): every relic type boosts one minigame lever (user table 2026-10-26).
  ...minigameAuditRows(),
  // I. Missions, patrols, factions
  { id: "mission:audit:unusedFactions", system: "mission", claim: "voidJackals, ironVultures, ashenCorsairs and Faction.id (no patrol references them)", status: pending("WR-11, OC-I2") },
  // J. Salvage and item generation
  { id: "salvage:audit:rolledNarration", system: "salvage", claim: "SalvageRoll rolled: \"the UI narrates the drop\" (dropped)", status: pending("WR-11, OC-J2") },
  { id: "salvage:audit:lootTierNames", system: "salvage", claim: "Loot tier names (damagedWeaponSystem) unread", status: pending("WR-11, OC-J2") },
  { id: "salvage:audit:deadEndDrops", system: "salvage", claim: "Salvaged Circuitry, Precursor Circuit: nothing uses them (Scrap Alloy refines into Reclaimed Alloy since WR-4, OC-C3)", status: pending("WR-11, OC-J3") },
  { id: "salvage:audit:achievementBoost", system: "salvage", claim: "achievementBoost (always 0)", status: pending("OC-C4") },
  { id: "salvage:audit:affixCountBranches", system: "salvage", claim: "affixCount derelict / luminous / constellar (unreachable rarities)", status: pending("WR-11, OC-J4") },
  { id: "salvage:audit:ascension", system: "salvage", claim: "ascension (always none)", status: pending("OC-C4") },
  // K. Gear wear (0.14.0): the user's "Free auto + paid rush" and credit sinks "Quick gear repair" plus Overtime.
  { id: "wear:audit:quickGearRepair", system: "wear", claim: "Quick gear repair: an optional instant gear repair for credits; the free automatic repair stays the default", status: pending(GEAR_WEAR_STEP_5) },
  { id: "wear:audit:gearRepairOvertime", system: "wear", claim: "Overtime on gear repair: pay credits to speed a ship's gear recovery by a set percent (never doubling, never instant)", status: pending(GEAR_WEAR_STEP_5) },
];

function auditEntries(): WiringEntry[] {
  return [
    ...AUDIT_ROWS.map((r) => entry({ id: r.id, system: r.system, source: { catalog: "AUDIT", key: r.id }, claim: r.claim, status: r.status, ...(auditRowWiring()[r.id] ?? {}) })),
    ...cp2AuditEntries(),
    ...fieldKitsAuditEntries(),
    ...cp8AuditEntries(),
    ...emodAuditEntries(),
  ];
}

// E-MOD EM-1: the wiring of the audit rows that went live in place (their row keeps its registry position): the power
// draw rows, live with the power budget (the ship's power draw readout, the budget the install gate EM-2 and the combat
// penalty EM-3 read).
// WR-8 (0.14.0, OC-D9, OC-D12, OC-D14): the combat descriptor rows' checks (combatDescriptorProbes.ts). A battle event
// is measured with the descriptor in play (combatDescriptorOn) against it out of play, on fixed seeds: it moves by at
// least one whole unit of its metric, the declared way. The pools, the open distance, the speed stamp, the Tachyon
// column and the status carry are exact seams.
function wr8AuditWiring(): Readonly<Record<string, Partial<EntryInput>>> {
  const ev = (probe: ProbeId, direction: "up" | "down" | "none", metric: string, contexts: ContextId[] = ["patrol"]): Partial<EntryInput> => ({
    probe,
    contexts,
    direction,
    curve: { kind: "event", metric },
    magnitude: () => 1,
    on: combatDescriptorOn,
  });
  const reactorAt = (quality: number): Transform => (s) => installPiece(s, { slotType: "reactorCore", quality });
  const ftlAt = (quality: number): Transform => (s) => installPiece(s, { slotType: "ftlDrive", quality });
  const transitDrive = (points: number): Transform => (s) => installPiece(s, { slotType: "ftlDrive", implicitStats: points > 0 ? { transitSpeedMult: points } : {} });
  // E-MOD EM-3: a Cargo Bay drawing num / den of the Destroyer's own output (combatBase's hull; its gear draws 0).
  const overBudget = (num: number, den: number): Transform => (s) => installPiece(s, { slotType: "cargoBay", powerDraw: Math.ceil((SHIP_TYPES.destroyer.basePowerOutput * num) / den) });
  return {
    "ship:audit:combatPositions": { probe: "combatOpenDistance", contexts: ["patrol", "shipEvent"], direction: "none", curve: { kind: "equals" }, magnitude: () => ENCOUNTER_OPEN_DISTANCE },
    "ship:wr8:weaponRange": ev("combatEventWeaponRange", "up", "the target's damage taken (a railgun's range on vs out of reach)"),
    "ship:wr8:droneRange": ev("combatEventDroneRange", "down", "the target's damage taken (an Attack squadron's reach on vs a long reach)"),
    "ship:wr8:stance": ev("combatEventStance", "none", "both ships' damage taken (Aggressive vs Defensive against a Marauder)"),
    "ship:wr8:speedKite": ev("combatEventSpeedKite", "down", "the faster ship's damage taken"),
    "ship:wr8:stanceAggressive": { probe: "combatHoldAggressive", contexts: ["patrol"], direction: "none", curve: { kind: "equals" }, magnitude: () => WEAPON_DEFS.autocannon.range }, // the Standard-Issue Battleship fills its spare hardpoints with autocannons
    "ship:wr8:stanceBalanced": { probe: "combatHoldBalanced", contexts: ["patrol"], direction: "none", curve: { kind: "equals" }, magnitude: () => WEAPON_DEFS.autocannon.range },
    "ship:wr8:stanceBalancedShare": { probe: "combatHoldBalancedLongGuns", contexts: ["patrol"], direction: "none", curve: { kind: "equals" }, magnitude: () => WEAPON_DEFS.railgun.range },
    "ship:wr8:stanceDefensive": { probe: "combatHoldDefensive", contexts: ["patrol"], direction: "none", curve: { kind: "equals" }, magnitude: () => Math.max(...COMBAT_DEFAULT_LOADOUT.battleship.weapons.map((w) => WEAPON_DEFS[w].range)) },
    "ship:wr8:defensiveDamageTaken": { probe: "combatDefensiveDamageTaken", contexts: ["patrol"], direction: "down", curve: { kind: "linearRelative" }, magnitude: () => -DEFENSIVE_STANCE.damageTakenPct / 100, on: combatDescriptorOn },
    "ship:wr8:defensiveShieldAbsorb": { probe: "combatDefensiveShieldAbsorb", contexts: ["patrol"], direction: "down", curve: { kind: "divisor" }, magnitude: () => DEFENSIVE_STANCE.shieldAbsorbPct / 100, on: combatDescriptorOn, tolerance: 1 },
    "ship:wr8:defensiveDamageDealt": ev("combatEventDefensiveDamageDealt", "down", "an autocannon's damage over 300 shots"),
    "ship:wr8:defensiveShieldRecharge": { probe: "combatEventDefensiveShieldRecharge", contexts: ["patrol"], direction: "up", curve: { kind: "linearRelative" }, magnitude: () => DEFENSIVE_STANCE.shieldRechargePct / 100, on: combatDescriptorOn, tolerance: 1 },
    "ship:wr8:closingEvasive": ev("combatEventClosingEvasive", "down", "the closing ship's damage taken"),
    "ship:wr8:defensiveGuardWeapons": ev("combatEventDefensiveGuardWeapons", "up", "the drone-fielding foe's drone hit points lost to Point Defense"),
    "ship:wr8:defensiveGuardDrones": ev("combatEventDefensiveGuardDrones", "up", "the drone-fielding foe's drone hit points lost to an Attack squadron"),
    "ship:audit:ftlSpeedPenalty": ev("combatEventFtlSpeedPenalty", "up", "the first round within 100 (a Degraded drive vs nominal)"),
    "ship:wr8:sensorDrainActs": ev("combatEventSensorDrain", "up", "the first shot's tick (the drained reach opens once the drain lapses)"),
    "ship:wr8:coolantLeakActs": ev("combatEventCoolantLeak", "up", "the distance on round 3"),
    "ship:wr8:manifoldOverheatActs": ev("combatEventManifoldOverheat", "up", "autocannon projectiles that hit a Raider"),
    "ship:audit:torpedoArmorPen": ev("combatEventArmorPen", "up", "a torpedo's damage on a Marauder's plates"),
    "ship:audit:qualityDurabilityMax": {
      probe: "combatReactorPoolMax",
      contexts: ["patrol", "shipEvent"],
      curve: { kind: "linearAbsolute" },
      magnitude: () => qualityDurabilityMax(BASE_REACTOR_DURABILITY, 3) - qualityDurabilityMax(BASE_REACTOR_DURABILITY, 0),
      base: () => combatBase(),
      on: reactorAt(3),
      off: reactorAt(0),
    },
    "ship:audit:installedSystems": {
      probe: "combatFtlPoolMax",
      contexts: ["patrol", "shipEvent"],
      curve: { kind: "linearAbsolute" },
      magnitude: () => qualityDurabilityMax(BASE_FTL_DURABILITY, 2) - qualityDurabilityMax(BASE_FTL_DURABILITY, 0),
      base: () => combatBase(),
      on: ftlAt(2),
      off: ftlAt(0),
    },
    "ship:audit:inCombatReplenishPercent": ev("combatEventInCombatReplenish", "up", "the squadron's drones online at the end"),
    "ship:audit:antiDrone": ev("combatEventAntiDrone", "none", "the drone carrier's damage taken"),
    "ship:audit:smartReflect": ev("combatEventSmartReflect", "up", "the weakest foe's damage taken"),
    "ship:audit:droneDisrupted": ev("combatEventDroneDisrupted", "up", "the enemy's drones disrupted at the end"),
    "ship:audit:familyResists": { probe: "combatResistLinesRoll", contexts: ["craft"], curve: { kind: "event", metric: "resist line picks over the plating and emitter rolls" }, magnitude: () => 1, on: sourceOn },
    "ship:audit:derivedStatsInCombat": {
      probe: "combatSpeedStamp",
      contexts: ["patrol", "shipEvent"],
      curve: { kind: "linearRelative" },
      magnitude: () => percent("transitSpeedMult"),
      base: bareHull,
      on: transitDrive(LINE_POINTS),
      off: transitDrive(0),
      tolerance: 1,
    },
    // E-MOD EM-3: a Standard-Issue Destroyer (its own gear draws nothing) taking a powered Cargo Bay that draws half
    // again its hull's output (supply sqrt(2 / 3), 81%), or four times it (the floor), against the ship in budget.
    // Weapons and shields are measured as a patrol cycle builds the ship (the stamp it would write now) and as an
    // expedition's ship event does (its dispatch snapshot).
    "ship:wr8:powerInCombat": { probe: "combatPowerSupplyDamage", contexts: ["patrol", "shipEvent"], direction: "down", curve: { kind: "event", metric: "the first weapon's damage over 300 shots" }, magnitude: () => 1, base: () => combatBase(), on: overBudget(3, 2) },
    "ship:em3:powerShieldRecharge": { probe: "combatPowerSupplyShieldRecharge", contexts: ["patrol", "shipEvent"], direction: "down", curve: { kind: "event", metric: "the shields recharged in a battle with no fire" }, magnitude: () => 1, base: () => combatBase(), on: overBudget(3, 2) },
    "ship:em3:powerSupplyFloor": { probe: "combatPowerSupplyStamp", contexts: ["patrol"], direction: "none", curve: { kind: "equals" }, magnitude: () => POWER_SUPPLY_FLOOR_PERCENT, base: () => combatBase(), on: overBudget(4, 1) },
    "ship:audit:commentOnlyRules": { probe: "combatTachyonVsShields", contexts: ["patrol"], direction: "none", curve: { kind: "equals" }, magnitude: () => WEAPON_RULE_TRAITS.tachyonBurstEmitter?.vsShieldsPct ?? 0, on: combatDescriptorOn },
    "ship:wr8:voltaicChain": ev("combatEventVoltaicChain", "up", "the second foe's damage taken"),
    "ship:wr8:vsDronesColumn": ev("combatEventVsDrones", "down", "a Defense drone's hit points lost to kinetic fire"),
    "ship:wr8:statusPersistence": { probe: "combatStatusCarry", contexts: ["patrol"], curve: { kind: "gate" }, magnitude: () => 1, on: combatDescriptorOn },
    "ship:wr8:inhibitSource": ev("combatEventInhibitSource", "up", "Inhibits Point Defense applied"),
    "ship:wr8:inhibitReader": ev("combatEventInhibitReader", "down", "the inhibited squadron's volleys in 5 s"),
    "ship:wr8:overchargeSource": ev("combatEventOvercharge", "up", "the owner's Overcharged Capacitors rank at the end"),
    "ship:audit:partialCombat": ev("combatEventPrecharge", "down", "the first shot's tick"),
    "ship:wr8:enemyMitigation": {
      ...ev("combatEventEnemyMitigation", "down", "an autocannon's damage on a Marauder"),
      outOfScope: [{ context: "shipEvent", reason: "the user named the pirate hulls; a ship event's vessel is not one", userRef: "OC-D12 (user 2026-10-16): \"pirate hulls get armor and evasion\"" }],
    },
  };
}

function auditRowWiring(): Readonly<Record<string, Partial<EntryInput>>> {
  const emitter = (draw: number): Transform => (s) => installPiece(s, { slotType: "shieldEmitters", powerDraw: draw });
  const torpedo = (draw: number): Transform => (s) => installPiece(s, { slotType: "weapon", weaponType: "concussionTorpedo", powerDraw: draw });
  // G1-6: a level 1 Mission Control with credits to spare and N completions of each ore run.
  const playedOreRuns = (n: number): Transform => (s) => ({
    ...s,
    credits: new Decimal(1e9),
    lifetimeStats: { ...s.lifetimeStats, missionsCompleted: { ...s.lifetimeStats.missionsCompleted, shortOreRun: new Decimal(n), longOreRun: new Decimal(n) } },
  });
  return {
    ...wr8AuditWiring(),
    // E-MOD EM-4: a Reactor Core of REACTOR_LIFT_PROBE_OUTPUT power against the same core (same mass) supplying none, on a
    // bare hull (the hull's own power covers its draw, so the whole output is surplus): the sheet's transit speed and
    // the Ground Ops voyage's frozen outbound speed rise by exactly the lift.
    "ship:audit:reactorCoreNet": {
      probe: "sheetTransit",
      contexts: ["sheet", "expedition:groundOps"],
      direction: "up",
      curve: { kind: "linearRelative" },
      magnitude: () => reactorSurplusSpeedLift(REACTOR_LIFT_PROBE_OUTPUT) - 1,
      base: bareHull,
      on: reactorOutput(REACTOR_LIFT_PROBE_OUTPUT),
      off: reactorOutput(0),
    },
    // Pause to repair: weapons worn so far down that the next cycle would break them pause; pristine gear relaunches.
    "ship:audit:patrolRepairPause": {
      probe: "wear:repairPause" as ProbeId,
      contexts: ["patrol"],
      direction: "up",
      curve: { kind: "gate" },
      magnitude: () => 1,
      base: () => repairPauseFixture(),
      on: underRepairPauseLine,
    },
    // Gear wear step 4: hull plating at its slot base (SLOT_BASE_PHYSICALS.hullPlating.durability) against one at the
    // TOUGHNESS_REFERENCE: a battle's hull loss takes reference / base as much (a rounding step per unit of tolerance).
    "ship:audit:slotDurabilityDefense": {
      probe: "wear:battle:hullPlating:hullLost" as ProbeId,
      contexts: ["patrol"],
      direction: "up",
      curve: { kind: "linearRelative" },
      magnitude: (c) => TOUGHNESS_REFERENCE / c.SLOT_BASE_PHYSICALS.hullPlating.durability - 1,
      base: () => battleFixture(),
      on: (s) => withFirstPieceDurability(s, "hullPlating", SLOT_BASE_PHYSICALS.hullPlating.durability),
      tolerance: WEAR_BATTLE_TOLERANCE,
    },
    // Gear wear step 4: a drone pod at the toughest a quality 5 pod gets (DRONE_POD_BASE_DURABILITY x (1 + 5 x
    // QUALITY_DURABILITY_BONUS)) against one at the TOUGHNESS_REFERENCE: its drones lost take reference / that as much.
    "ship:audit:podDurability": {
      probe: "wear:battle:droneBay:dronesLost" as ProbeId,
      contexts: ["patrol"],
      direction: "up",
      curve: { kind: "linearRelative" },
      magnitude: () => TOUGHNESS_REFERENCE / Math.round(DRONE_POD_BASE_DURABILITY * (1 + 5 * QUALITY_DURABILITY_BONUS)) - 1,
      base: () => battleFixture(),
      on: (s) => withFirstPieceDurability(s, "droneBay", Math.round(DRONE_POD_BASE_DURABILITY * (1 + 5 * QUALITY_DURABILITY_BONUS))),
      tolerance: WEAR_BATTLE_TOLERANCE,
    },
    // Gear wear step 3: a Reactor Core at its slot base (SLOT_BASE_PHYSICALS.reactorCore.durability) against one at
    // the TOUGHNESS_REFERENCE: a minute underway takes reference / base as much (one rounding step of tolerance).
    "ship:audit:slotDurability": {
      probe: "wear:use:reactorCore:minutesRunning" as ProbeId,
      contexts: ["mission:extraction", "mission:shortRange"],
      direction: "up",
      curve: { kind: "linearRelative" },
      magnitude: (c) => TOUGHNESS_REFERENCE / c.SLOT_BASE_PHYSICALS.reactorCore.durability - 1,
      base: () => installPiece(seatOfficer(wiringBase(), "operations", []), { slotType: "reactorCore", durabilityMax: TOUGHNESS_REFERENCE }),
      on: (s) => ({ ...s, equipment: s.equipment.map((e) => (e.id === wearPieceIdFor("reactorCore") ? { ...e, durabilityMax: SLOT_BASE_PHYSICALS.reactorCore.durability } : e)) }),
      tolerance: 1,
    },
    // Merged WR-8 + gear wear step 3: a member weapon's durability is its toughness too. Its slot base equals the
    // TOUGHNESS_REFERENCE, so the check sets a piece twice as tough against one at the slot base: a ground fight takes
    // (2 x reference) / base as much from the slot-base piece (one rounding step of tolerance).
    "away:audit:memberSlotPhysicals": {
      probe: "wear:use:memberWeapon:groundFight" as ProbeId,
      contexts: ["expedition:groundOps"],
      direction: "down",
      curve: { kind: "linearRelative" },
      magnitude: (c) => (2 * TOUGHNESS_REFERENCE) / c.SLOT_BASE_PHYSICALS.memberWeapon.durability - 1,
      base: () => {
        const s = wearSlotFixture("memberWeapon");
        return { ...s, equipment: s.equipment.map((e) => (e.id === wearPieceIdFor("memberWeapon") ? { ...e, durabilityMax: 2 * TOUGHNESS_REFERENCE } : e)) };
      },
      on: (s) => ({ ...s, equipment: s.equipment.map((e) => (e.id === wearPieceIdFor("memberWeapon") ? { ...e, durabilityMax: SLOT_BASE_PHYSICALS.memberWeapon.durability } : e)) }),
      tolerance: 1,
    },
    // G1-6 (SHORT_RANGE_BOARD_LIVE): the board's level 2 rung opens once each ore run has MISSION_CONTROL_UNLOCK_COMPLETIONS
    // completions; one fewer keeps it shut.
    "facility:audit:missionControlUnlock": {
      probe: "missionControlBuildable",
      contexts: ["facility"],
      curve: { kind: "gate" },
      magnitude: () => 1,
      on: playedOreRuns(MISSION_CONTROL_UNLOCK_COMPLETIONS),
      off: playedOreRuns(MISSION_CONTROL_UNLOCK_COMPLETIONS - 1),
    },
    // G1-5: a Tier I and a Tier II short-range cycle of SHORT_RANGE_RELIC_PROBE_HOURS find their per-hour rate x the
    // hours in relic blanks (8 + 15) through the cycle engine; the same runs without G1-5's flag find none.
    "relic:audit:shortRangeBlanks": {
      probe: "content:shortRangeRelics",
      contexts: ["mission:shortRange"],
      curve: { kind: "gate" },
      magnitude: () => ((shortRangeRelicMicrosPerHour(1) + shortRangeRelicMicrosPerHour(2)) * SHORT_RANGE_RELIC_PROBE_HOURS) / 1_000_000,
      on: sourceOn,
    },
    // Field Kits FKR-8 (OC-F1): a crew's worn Lure Beacon raises its ambush chance on a calm objective at each use's
    // rolled 50 to 75%: over the probe's uses, more ambushes strike (the draws are the same; only the chance moves).
    "away:audit:shroudLureGroundOps": {
      probe: "content:fieldDevice:ambush",
      contexts: ["expedition:groundOps"],
      curve: { kind: "event", metric: `ambushes over ${FIELD_DEVICE_PROBE_USES} uses` },
      magnitude: () => 1,
      on: sourceOn,
    },
    // Field Kits FKR-8: the device works at a rolled 50 to 75% PER USE: a worn Lure's effectiveness takes every whole
    // percent of the span over the probe's uses (a roll fixed per run, or no roll, would show one value).
    "away:audit:fieldDeviceEffectiveness": {
      probe: "content:fieldDevice:roll",
      contexts: ["expedition:groundOps"],
      curve: { kind: "event", metric: `distinct rolled percents over ${FIELD_DEVICE_PROBE_USES} uses` },
      magnitude: () => FIELD_DEVICE_SPAN_PERCENT - 1,
      on: sourceOn,
    },
    // Field Kits FKR-7: one Injury Kit's share on a member's trip treatment divides their Broken Bone bay time.
    "away:audit:treatmentShare": {
      probe: "content:runTreatment",
      contexts: ["medbay"],
      direction: "down",
      curve: { kind: "divisor" },
      magnitude: (c) => c.FIELD_KITS.injuryKit.treatmentShare ?? 0,
      on: sourceOn,
      tolerance: 1,
    },
    // Field Kits FKR-9 / FKR-10: the runs switch: a real Launch (the console's default argument) packs a member's
    // default pack from the Warehouse; with kits off it packs nothing.
    "away:audit:fieldKitsRunsSwitch": {
      probe: "content:fieldKitsRunsSwitch",
      contexts: ["expedition:groundOps"],
      curve: { kind: "gate" },
      magnitude: () => FIELD_KITS_SWITCH_PROBE_STOCK,
      on: sourceOn,
    },
    // Field Kits FKR-9 / FKR-10: the hidden pieces are reachable: the Impact Grenade blueprint merged into BLUEPRINTS and
    // the carry line in the Stun and Toxin Grenade craft pools.
    // Relics v2 R2-3: the reveals a real study start and resolve land, against the v1 roll (no exceptional piece).
    "relic:audit:identifyV2": {
      probe: "content:relic:exceptionalReveals",
      contexts: ["research"],
      curve: { kind: "gate" },
      magnitude: () => relicV2ProbeExpectedExceptional(),
      on: sourceOn,
    },
    // Relics v2 R2-4: 200 Hull Rivets past the cap, deposited one at a time through the real deposit (the snapshot holds
    // the first RELIC_SOFT_CAP), against the same copies as a plain record with no snapshot: the cap takes exactly the
    // curve's growth over those copies off the regular game's cargoCapacity.
    "relic:audit:softCap": {
      probe: "museum:cargoCapacity",
      contexts: ["fleet"],
      direction: "down",
      magnitude: () => {
        const at = (n: number) => diminishing(n * MUSEUM_V2_PER_COPY[V2_FIXTURE_TIER], MUSEUM_V2_KNEE);
        return at(RELIC_SOFT_CAP) - at(RELIC_SOFT_CAP + SOFT_CAP_PROBE_PAST);
      },
      on: (s) => {
        let m = s.museumV2 ?? emptyMuseumV2();
        for (let i = 0; i < RELIC_SOFT_CAP + SOFT_CAP_PROBE_PAST; i++) m = museumDepositGeneral(m, V2_FIXTURE_TIER, "hullRivet", 1);
        return { ...s, museumV2: m };
      },
      off: withTierCopies(V2_FIXTURE_TIER, { hullRivet: RELIC_SOFT_CAP + SOFT_CAP_PROBE_PAST }),
    },
    // Relics v2 R2-3: Lab VII runs three more relic studies at once than Lab I.
    "relic:audit:identifyLanes": {
      probe: "content:relic:lanes",
      contexts: ["research"],
      curve: { kind: "gate" },
      magnitude: () => relicStudyLanesAt(7) - relicStudyLanesAt(1),
      on: sourceOn,
    },
    "away:audit:fieldKitsHiddenPieces": {
      probe: "content:fieldKitsHiddenPieces",
      contexts: ["research", "craft"],
      curve: { kind: "gate" },
      magnitude: () => Object.keys(FIELD_KITS_HIDDEN_BLUEPRINTS).length + 2,
      on: sourceOn,
    },
    "ship:audit:slotPowerDraw": {
      probe: "sheetPowerDraw",
      contexts: ["sheet"],
      curve: { kind: "linearAbsolute" },
      magnitude: (c) => c.SLOT_BASE_PHYSICALS.shieldEmitters.powerDraw,
      base: bareHull,
      on: emitter(SLOT_BASE_PHYSICALS.shieldEmitters.powerDraw),
      off: emitter(0),
    },
    // Expedition Tiers G2-4: an Orion's Tier I outbound leg with a Class II drive installed is half its Class I leg
    // (whole seconds: one rounding step).
    "expedition:audit:voyageDriveClass": {
      probe: "voyageOutbound",
      contexts: ["expedition:groundOps"],
      direction: "down",
      curve: { kind: "divisor" },
      magnitude: () => 2 ** voyageClassSteps(1, 2) - 1,
      base: () => wiringBase("orion"),
      on: classedDrive("classIIDriveBp"),
      off: classedDrive("balancedDriveBp"),
      tolerance: 1,
    },
    // G2-4: the same Orion's reach on that voyage, Class II over Class I (the drives carry no range lines here).
    "expedition:audit:deepSpaceReach": {
      probe: "expeditionReach",
      contexts: ["expedition:groundOps"],
      curve: { kind: "linearRelative" },
      magnitude: () => DRIVE_CLASS_REACH_MULT[2] / DRIVE_CLASS_REACH_MULT[1] - 1,
      base: () => wiringBase("orion"),
      on: classedDrive("classIIDriveBp"),
      off: classedDrive("balancedDriveBp"),
    },
    // G2-4 + OC-15 (the Lab and Fabricator reach tier VII, so drivesWithinFacilityReach serves Class III to VII): the
    // Class VII drive is a real blueprint, so installed it draws its class's power on the sheet, above the Class II
    // drive's (ftlDriveClass reads BLUEPRINTS; a key outside it would read Class I and draw the base). The voyage leg is
    // not the probe here: at Tier I a Class III leg already sits on the voyage floor.
    "facility:audit:heldDriveClasses": {
      probe: "sheetPowerDraw",
      contexts: ["sheet"],
      curve: { kind: "linearAbsolute" },
      magnitude: (c) => driveClassPowerDraw(c.SLOT_BASE_PHYSICALS.ftlDrive.powerDraw, 7) - driveClassPowerDraw(c.SLOT_BASE_PHYSICALS.ftlDrive.powerDraw, 2),
      base: bareHull,
      on: classedDrive("classVIIDriveBp"),
      off: classedDrive("classIIDriveBp"),
    },
    // G2-4: the starting General Freighter is refused, the same save on an Orion launches.
    "expedition:audit:explorerHullGate": {
      probe: "expeditionLaunchAllowed",
      contexts: ["expedition:groundOps"],
      curve: { kind: "gate" },
      magnitude: () => 1,
      on: (s) => installMissingCombatBaselines(editShip(s, { typeKey: "orion" })),
      off: identity,
    },
    // ===== Expedition Tiers G2-6: the console's region picker and recall (probes.ts consoleLaunch: the deepest tier
    // ship-1 can attempt, its nearest candidate in reach, the gated launch a player's Launch sends) =====
    // A Tier II launch needs a Class II drive (the Orion's sensors cleared first); with Class I it is refused.
    "expedition:audit:driveClassTierGate": {
      probe: "tierTwoLaunchAllowed",
      contexts: ["expedition:groundOps"],
      curve: { kind: "gate" },
      magnitude: () => 1,
      base: () => consoleOrion(G2_6_SENSORS),
      on: classedDrive("classIIDriveBp"),
      off: classedDrive("balancedDriveBp"),
    },
    // With the Class II drive, Tier II asks for its frontier sensors: a stock Orion reads 0; FRONTIER_SENSORS[2] clears it.
    "expedition:audit:frontierSensors": {
      probe: "tierTwoLaunchAllowed",
      contexts: ["expedition:groundOps"],
      curve: { kind: "gate" },
      magnitude: () => 1,
      base: () => classedDrive("classIIDriveBp")(consoleOrion(0)),
      on: (s) => installPiece(s, { slotType: "sensor", implicitStats: { sensors: FRONTIER_SENSORS[2] } }),
      off: identity,
    },
    // The console's Tier II launch flies Tier II's ladder (4 h nominal), the Class I ship's Tier I launch Tier I's (2 h):
    // at least the gap between Tier II's nearest and Tier I's farthest band position, at up to twice the stock speed.
    "expedition:audit:voyageDeepTiers": {
      probe: "consoleOutbound",
      contexts: ["expedition:groundOps"],
      curve: { kind: "event", metric: "seconds of the outbound leg (Tier II over Tier I)" },
      magnitude: () => ((TIER_TRANSIT_HOURS[2] * VOYAGE_BAND_SCALE_PERMILLE.near - TIER_TRANSIT_HOURS[1] * VOYAGE_BAND_SCALE_PERMILLE.far) * 3.6) / 2,
      base: () => consoleOrion(G2_6_SENSORS),
      on: classedDrive("classIIDriveBp"),
      off: classedDrive("balancedDriveBp"),
    },
    // The console's Tier II launch rolls its risk on Tier II's rows (RISK_TIER_ODDS, hostile sites, affixes...).
    "away:audit:tierDormant": {
      probe: "consoleRiskTier",
      contexts: ["expedition:groundOps"],
      magnitude: () => 1,
      base: () => consoleOrion(G2_6_SENSORS),
      on: classedDrive("classIIDriveBp"),
      off: classedDrive("balancedDriveBp"),
    },
    // ...and pays Tier II's haul on every objective.
    "away:audit:tierHaulMult": {
      probe: "consoleHaulMult",
      contexts: ["expedition:groundOps"],
      curve: { kind: "linearRelative" },
      magnitude: () => TIER_HAUL_MULT[2] / TIER_HAUL_MULT[1] - 1,
      base: () => consoleOrion(G2_6_SENSORS),
      on: classedDrive("classIIDriveBp"),
      off: classedDrive("balancedDriveBp"),
    },
    // A Class VII ship's console reads Tier VII's systems (3 to 5 bodies each) where a Class I ship reads Tier I's (1 to 3).
    "expedition:audit:tierBodyCount": {
      probe: "consoleBodyCount",
      contexts: ["expedition:groundOps"],
      curve: { kind: "event", metric: "bodies across the three nearest candidates" },
      magnitude: () => 1,
      base: () => withFacilityLevel(consoleOrion(G2_6_SENSORS), SUBSPACE_TELESCOPE_FACILITY_KEY, 8),
      on: classedDrive("classVIIDriveBp"),
      off: classedDrive("balancedDriveBp"),
    },
    // A Tier II launch beyond a Level 1 telescope goes blind (counted); a Level 2 telescope reads Tier II.
    "expedition:audit:blindLaunch": {
      probe: "consoleBlindLaunches",
      contexts: ["expedition:groundOps"],
      curve: { kind: "gate" },
      magnitude: () => 1,
      base: () => classedDrive("classIIDriveBp")(consoleOrion(G2_6_SENSORS)),
      on: (s) => withFacilityLevel(s, SUBSPACE_TELESCOPE_FACILITY_KEY, 1),
      off: (s) => withFacilityLevel(s, SUBSPACE_TELESCOPE_FACILITY_KEY, 2),
    },
    // At Tier III (behind tier 2) the recommendation reads the fight odds (ODDS_RISKY_BELOW judges them); at Tier I never.
    "expedition:audit:oddsRiskyBelow": {
      probe: "consoleOddsRead",
      contexts: ["expedition:groundOps"],
      curve: { kind: "event", metric: "compositions whose fight odds the recommendation reads" },
      magnitude: () => 1,
      base: () => withFacilityLevel(consoleOrion(G2_6_SENSORS), SUBSPACE_TELESCOPE_FACILITY_KEY, 5),
      on: classedDrive("classIIIDriveBp"),
      off: classedDrive("balancedDriveBp"),
    },
    // A Tier II launch's relic blanks roll on Tier II's table (more weight above the standard rarity).
    "relic:audit:blankTiers": {
      probe: "consoleBlankShare",
      contexts: ["expedition:groundOps"],
      curve: { kind: "event", metric: "permille of the blank table above the standard rarity" },
      magnitude: () => 1,
      base: () => consoleOrion(G2_6_SENSORS),
      on: classedDrive("classIIDriveBp"),
      off: classedDrive("balancedDriveBp"),
    },
    // Recalled a quarter of the way out, the run flies home in a quarter of its return leg (1:1, user #7).
    "expedition:audit:recall": {
      probe: "runReturnSeconds",
      contexts: ["expedition:groundOps"],
      direction: "down",
      curve: { kind: "linearRelative" },
      magnitude: () => RECALL_PROBE_SHARE - 1,
      tolerance: 2,
      base: () => launchedAndAt(consoleOrion(0), "quarterOut"),
      on: (s) => recallExpedition(s, s.expeditions[0].id),
      off: identity,
    },
    // Recalled once a body is charted, the system stays open to resume; recalled in transit, it is a candidate again.
    "expedition:audit:resumableSystems": {
      probe: "resumableCount",
      contexts: ["expedition:groundOps"],
      curve: { kind: "gate" },
      magnitude: () => 1,
      base: () => consoleOrion(0),
      on: (s) => {
        const at = launchedAndAt(s, "firstCharted");
        return recallExpedition(at, at.expeditions[0].id);
      },
      off: (s) => {
        const at = launchedAndAt(s, "quarterOut");
        return recallExpedition(at, at.expeditions[0].id);
      },
    },
    "ship:audit:weaponPowerDraw": {
      probe: "sheetPowerDraw",
      contexts: ["sheet"],
      curve: { kind: "linearAbsolute" },
      magnitude: (c) => c.WEAPON_DEFS.concussionTorpedo.powerDraw,
      base: bareHull,
      on: torpedo(WEAPON_DEFS.concussionTorpedo.powerDraw),
      off: torpedo(0),
    },
    // Relics v2 R2-10: MINIGAME_PROBE_COPIES Tier I copies of each relic type move its minigame lever by exactly its
    // boost, 1 + perCopy x diminishing(copies, knee), through the lever's minigame consumer (probes.ts).
    ...minigameRelicWiring(),
  };
}

// R2-10: the relic copies each minigame probe deposits (all at Tier I, below the soft cap: weighted 1:1).
const MINIGAME_PROBE_COPIES = 10;

function minigameRelicWiring(): Record<string, Partial<EntryInput>> {
  const out: Record<string, Partial<EntryInput>> = {};
  for (const d of RELIC_BOOSTS) {
    const gain = d.lever === "captain" || d.lever === "augment" || d.lever === "dream";
    out[minigameAuditId(d.lever)] = {
      probe: `content:minigame:${d.lever}`,
      contexts: ["fleet"],
      curve: { kind: "linearRelative" },
      magnitude: (c) => {
        const def = c.RELIC_BOOSTS.find((x) => x.lever === d.lever)!;
        return def.perCopy * diminishing(MINIGAME_PROBE_COPIES, def.knee);
      },
      on: (s) => withGeneralMuseumRecord(s, { [d.relicId]: MINIGAME_PROBE_COPIES }, 1),
      off: (s) => withGeneralMuseumRecord(s, {}, 1),
      // the three point gains are whole points (floored): one point either way
      ...(gain ? { tolerance: 1 } : {}),
      note: "the minigame's relic boost (one-way: the main game never reads it)",
    };
  }
  return out;
}

function minigameAuditId(lever: string): string {
  return `relic:audit:minigame:${lever}`;
}

// R2-10 audit rows, one per relic type (the user's 17-row table, config.ts RELIC_BOOSTS).
function minigameAuditRows(): { id: string; system: WiringSystem; claim: string; status: WiringStatus }[] {
  return RELIC_BOOSTS.map((d) => ({
    id: minigameAuditId(d.lever),
    system: "relic" as const,
    claim: `Relic boosts in the minigame: ${RELIC_TYPES.find((t) => t.id === d.relicId)?.label ?? d.relicId} copies (past a tier's soft cap 5x) boost ${d.boosts} on the D23 curve`,
    status: LIVE,
  }));
}

// E-MOD EM-1: the drive class draw. Expedition Tiers G2-4 made it live: the Class II Drive Blueprint (researchable at
// Lab tier 2) draws x1.6 its slot's base draw, rounded up, on the sheet.
// E-MOD EM-4: the reactor surplus probe's core (whole power points; weightless, so the never-slower floor never binds
// and on and off differ only in the output).
const REACTOR_LIFT_PROBE_OUTPUT = 40;
function reactorOutput(points: number, mass = 0): Transform {
  return (s) => installPiece(s, { slotType: "reactorCore", mass, implicitStats: { powerOutput: points } });
}

function emodAuditEntries(): WiringEntry[] {
  const draw = SLOT_BASE_PHYSICALS.ftlDrive.powerDraw;
  return [
    // E-MOD EM-4 (WR-8 hand-off: combat speed reads the sheet's transit speed): the reactor surplus lift reaches the
    // combat speed a run starting now freezes in its stamp (a patrol cycle, an expedition's ship events). Whole speed
    // units, so one rounding step of tolerance.
    entry({
      id: "ship:em4:reactorLiftCombatSpeed",
      system: "ship",
      source: { catalog: "AUDIT", key: "ship:em4:reactorLiftCombatSpeed" },
      claim: "A crafted Reactor Core's unused power also speeds the ship in combat (its combat speed comes from its transit speed)",
      probe: "combatSpeedStamp",
      contexts: ["patrol", "shipEvent"],
      direction: "up",
      curve: { kind: "linearRelative" },
      magnitude: () => reactorSurplusSpeedLift(REACTOR_LIFT_PROBE_OUTPUT) - 1,
      base: () => combatBase(),
      on: reactorOutput(REACTOR_LIFT_PROBE_OUTPUT),
      off: reactorOutput(0),
      tolerance: 1,
    }),
    // E-MOD EM-4 (user 2026-10-23 "Never slower (Recommended)"): a crafted core whose lift is smaller than its own mass
    // drag (a 1 output core at the slot's base mass 12, on a bare hull) flies exactly at the hull's Standard-Issue speed:
    // the sheet and the Ground Ops voyage read the hull's own transit speed, not the dragged one.
    entry({
      id: "ship:em4:reactorNeverSlower",
      system: "ship",
      source: { catalog: "AUDIT", key: "ship:em4:reactorNeverSlower" },
      claim: "A crafted Reactor Core never makes the ship slower than its Standard-Issue core: its mass only eats into the surplus speed",
      probe: "sheetTransit",
      contexts: ["sheet", "expedition:groundOps"],
      direction: "none",
      curve: { kind: "equals" },
      magnitude: (c) => c.SHIP_TYPES.generalFreighter.transitSpeedMult,
      base: bareHull,
      on: reactorOutput(1, SLOT_BASE_PHYSICALS.reactorCore.mass),
    }),
    entry({
      id: "ship:SHIP_SEAMS:driveClassPowerDraw",
      system: "ship",
      source: { catalog: "SHIP_SEAMS", key: "driveClassPowerDraw" },
      claim: "An FTL drive draws x1.6 power per drive class above I (DRIVE_CLASS_POWER_DRAW_MULT)",
      probe: "sheetPowerDraw",
      contexts: ["sheet"],
      curve: { kind: "linearAbsolute" },
      magnitude: (c) => driveClassPowerDraw(c.SLOT_BASE_PHYSICALS.ftlDrive.powerDraw, 2) - c.SLOT_BASE_PHYSICALS.ftlDrive.powerDraw,
      base: bareHull,
      on: classedDrive("classIIDriveBp", draw),
      off: classedDrive("balancedDriveBp", draw),
    }),
  ];
}

// Expedition Tiers G2-6: an Orion (an explorer) fielding the minimum away team, with a sensor piece of `sensors` (0: none)
// installed; G2_6_SENSORS clears every tier's frontier sensors (Tier VII asks 65).
const G2_6_SENSORS = 70;
function consoleOrion(sensors: number): GameState {
  const s = withAwayTeam(wiringBase("orion"));
  return sensors > 0 ? installPiece(s, { slotType: "sensor", implicitStats: { sensors } }) : s;
}

// Expedition Tiers G2-4: ship-1 with an FTL drive of blueprint `blueprintKey` installed (no stat lines, `powerDraw`).
function classedDrive(blueprintKey: string, powerDraw: number = SLOT_BASE_PHYSICALS.ftlDrive.powerDraw): Transform {
  return (s) => installPiece(s, { slotType: "ftlDrive", blueprintKey, powerDraw });
}

// Field Kits FKR-4: the audit row FKR-4 resolves, now live with its own check.
function fieldKitsAuditEntries(): WiringEntry[] {
  return [
    // FK2 (user 2026-10-15, "Basic debuffs only"): the medic's free Cure clears basic debuffs only (gambit.ts
    // BASIC_DEBUFFS); a serious condition (here a Concussion) stays for its kit or the medical bay. Every debuff before
    // Field Kits is basic, so an older fight cures exactly as before.
    entry({
      id: "away:audit:fieldKitsCure",
      system: "away",
      source: { catalog: "AUDIT", key: "away:audit:fieldKitsCure" },
      claim: "Cure clears basic debuffs only (gambit.ts BASIC_DEBUFFS): a serious condition stays for its kit or the bay",
      probe: "content:fieldKitsCure",
      contexts: ["ground"],
      curve: { kind: "gate" },
      magnitude: () => 1,
      on: sourceOn,
    }),
    // Field Kits FKR-8 (OC-F1, user "Move them to the ground"): the reinforcement half. The landing crew's worn Lure Beacon
    // raises a Reinforcing objective's chance per visit at that visit's rolled 50 to 75%: over the probe's visits, more
    // bring reinforcements (the roll's draws are the same; only the chance moves).
    entry({
      id: "away:audit:fieldDeviceReinforcements",
      system: "away",
      source: { catalog: "AUDIT", key: "away:audit:fieldDeviceReinforcements" },
      claim: "Shroud Emitter and Lure Beacon scale a Reinforcing objective's reinforcement chance per visit (OC-F1), rolled per use",
      probe: "content:fieldDevice:reinforcement",
      contexts: ["expedition:groundOps"],
      curve: { kind: "event", metric: `visits with reinforcements over ${FIELD_DEVICE_PROBE_USES} visits` },
      magnitude: () => 1,
      on: sourceOn,
    }),
    // Field Kits FKR-8 (OC-F1: "Lure adds a drop scale on probe salvage"): a won ship battle's haul scale grows by the
    // expedition's Lure dial at each use's rolled effectiveness (LURE_SALVAGE_PER_DIAL per unit of dial). Every use rolls
    // at least FIELD_DEVICE_MIN_PERCENT, so the probe's boundaries gain at least that much.
    entry({
      id: "away:audit:lureSalvage",
      system: "away",
      source: { catalog: "AUDIT", key: "away:audit:lureSalvage" },
      claim: "A Lure Beacon raises a won ship battle's salvage (OC-F1), rolled per use",
      probe: "content:fieldDevice:salvage",
      contexts: ["shipEvent"],
      curve: { kind: "event", metric: `the probe salvage scale summed over ${FIELD_DEVICE_PROBE_BOUNDARIES.length} boundaries` },
      magnitude: () =>
        FIELD_DEVICE_PROBE_BOUNDARIES.length * PROBE_SALVAGE_SCALE * (memberVariety("memberTool", "lureBeacon")?.member.encounterBias ?? 0) * (FIELD_DEVICE_MIN_PERCENT / 100) * LURE_SALVAGE_PER_DIAL,
      on: sourceOn,
    }),
  ];
}

// CP-8: notables are created now (graduation). Identity only (user 2026-10-16, "Let's keep it identity only"): a
// graduate counts aboard exactly like one crew of its group. Measured on Efficient Unloading: a ship of 20 Crewmen
// graduates one; against the same ship with that one crewmember gone, the unload bonus is 20 / 19 of it (the notable
// carries its share), and against the ship before graduating it does not move at all.
function cp8AuditEntries(): WiringEntry[] {
  const ops = bucketOf("operations", "ops.unloadSpeed");
  const crewed = () => withBuckets(wiringBase(), [ops]);
  const graduate: Transform = (s) => graduateStandout(s, WIRING_SHIP_ID, signatureKey(ops)).next;
  return [
    entry({
      id: "crew:audit:notables",
      system: "crew",
      source: { catalog: "AUDIT", key: "crew:audit:notables" },
      claim: "A graduated notable stays aboard and carries its buffs like one crew of its group",
      probe: "sheetUnload",
      contexts: ["sheet"],
      curve: { kind: "bonusRelative", base: 1 },
      magnitude: () => 1 / (WIRING_BUCKET_COUNT - 1),
      base: crewed,
      on: graduate,
      off: (s) => withBuckets(s, [{ ...ops, count: WIRING_BUCKET_COUNT - 1 }]),
      note: "on: 19 Crewmen + the notable; off: the 19 alone",
    }),
    entry({
      id: "crew:audit:notableIdentityOnly",
      system: "crew",
      source: { catalog: "AUDIT", key: "crew:audit:notableIdentityOnly" },
      claim: "Graduating is identity only: the ship's stats do not change",
      probe: "sheetUnload",
      contexts: ["sheet"],
      direction: "none",
      magnitude: () => 0,
      base: crewed,
      on: graduate,
      note: "a move of 0: the notable replaces the crewmember it was",
    }),
  ];
}

// CP-2: the two crew audit rows CP-2 resolves, now live with their own checks.
const CONSTITUTION_HIGH = 20; // the top of the officer stat roll (OFFICER_STAT_ROLL_MAX)
function cp2AuditEntries(): WiringEntry[] {
  const neutral: OfficerStats = { strength: OFFICER_STAT_NEUTRAL, integrity: OFFICER_STAT_NEUTRAL, cunning: OFFICER_STAT_NEUTRAL, constitution: OFFICER_STAT_NEUTRAL };
  const tactical = (constitution: number): Transform => (s) => seatOfficer(s, "tactical", ["tac.weaponCommand"], { stats: { ...neutral, constitution } });
  return [
    // OC-E13 (B17, user 2026-10-15 "Ramp cycle 1 too"): the first cycle of a Dispatch Once patrol freezes the
    // Constitution ramp at its own mid-route sample, so a high Constitution grows its battle bonus from cycle 1.
    entry({
      id: "crew:audit:constitutionCycle1",
      system: "crew",
      source: { catalog: "AUDIT", key: "crew:audit:constitutionCycle1" },
      claim: "The Constitution battle ramp acts on patrol cycle 1 too (B17), so a Dispatch Once patrol ramps",
      probe: "patrolCycleOneWeapons",
      contexts: ["patrol"],
      curve: { kind: "linearRelative" },
      magnitude: () => constitutionRamp(officerStatFacet(CONSTITUTION_HIGH), patrolCycleOneRampHours(Object.values(PATROLS)[0], combatBase().tickDurationSeconds)),
      base: () => combatBase(),
      on: tactical(CONSTITUTION_HIGH),
      off: tactical(OFFICER_STAT_NEUTRAL),
      note: "the tactical seat's Constitution ramps its own Weapons Command; the sample is half the patrol's route",
    }),
    // OC-E5 (user 2026-10-15 "Each its own leg"): Fast Departure lifts the outbound leg (its crew entry proves it) and
    // leaves the return leg exactly where it was (this check: a move of 0 on the other leg).
    entry({
      id: "crew:audit:transitSplit",
      system: "crew",
      source: { catalog: "AUDIT", key: "crew:audit:transitSplit" },
      claim: "Fast Departure and Fast Return each act on their own leg (Fast Departure leaves the return leg unchanged)",
      probe: "sheetBackLeg",
      contexts: ["sheet"],
      direction: "none",
      magnitude: () => 0,
      on: (s) => withBuckets(s, [bucketOf("flightDeck", "flight.transitOut")]),
      off: (s) => withBuckets(s, [bucketOf("flightDeck", "wiring.none")]),
      note: "a move of 0: the other leg's speed is untouched; crew:crew.transitOutSpeed / transitBackSpeed prove each own leg",
    }),
  ];
}

// ============================================================================
// 0.14.0 SPEED SEAM (processSpeed.ts): Overtime is live; the tutorial time skip and the grant hook are seams
// ============================================================================

const TUTORIAL_HOOKS = 'safe first runs plan USER ANSWERS group 2 (2026-10-16): "Hook only"; grant hook "Yes, add it now (Recommended)"';

function speedSeamEntries(): WiringEntry[] {
  return [
    entry({
      id: "facility:SPEED_SEAM:overtime",
      system: "facility",
      source: { catalog: "SPEED_SEAM", key: "overtime" },
      claim: "Overtime: each step bought speeds a running job by 25% of its normal rate (Shipyard builds and repairs, research, facility upgrades)",
      probe: "overtimeTicks",
      contexts: ["shipyard", "research", "facility"],
      direction: "down",
      curve: { kind: "divisor" },
      magnitude: () => OVERTIME_STEP_RATE,
      on: overtimeOneStep,
      base: () => withRunningJobs(wiringBase()),
      note: "one step from the normal rate: the time left is divided by 1 + 0.25 (the countdown then runs unchanged)",
    }),
    entry({
      id: "fleetAdmiral:SPEED_SEAM:timeSkip",
      system: "fleetAdmiral",
      source: { catalog: "SPEED_SEAM", key: "timeSkip" },
      claim: "Tutorial time skip: instantly finishes any timed process, mission cycle, patrol route or expedition, for free",
      status: { kind: "seam", owner: "the tutorial patch", userRef: TUTORIAL_HOOKS },
      note: "processSpeed.test.ts proves it per process type",
    }),
    entry({
      id: "fleetAdmiral:SPEED_SEAM:grant",
      system: "fleetAdmiral",
      source: { catalog: "SPEED_SEAM", key: "grant" },
      claim: "Grant hook: items, credits, gear, a hull and relics (a general relic by type and tier, the first Tier I exceptional piece), with a log line",
      status: { kind: "seam", owner: "the tutorial / quests patch", userRef: TUTORIAL_HOOKS },
      note: "processSpeed.test.ts proves it",
    }),
  ];
}

// ============================================================================
// The no-dead-stats allow-list's reasons (kept verbatim from PENDING_IN_RELEASE at the WR-1 move)
// ============================================================================

const OFFICER_DORMANT = "dormant by design until its system lands (crewOverlay.ts OFFICER_BONUSES_PENDING_IN_RELEASE)";
const ALLOW_LIST_REASONS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.keys(OFFICER_BONUSES_PENDING_IN_RELEASE).map((k) => [`officer:${k}`, OFFICER_DORMANT])),
  "crew:crew.counterInfiltration": "Counter-Infiltration: resists enemy debuffs (Security pool)",
  "crew:crew.awayTeamProtection": "Away-Team Protection: squad HP (Security pool)",
  "crew:crew.triage": "Triage: squad healing (Medical pool)",
  "crew:crew.preventCrewLoss": "Prevent a Crew Loss: shorter injuries (exclusive pool)",
  "facet:pilot:cunning": "the Flight Deck has no over-delivery of its own yet (design section 7 names none)",
};

// ============================================================================
// The flat checks' claimed contexts and controls (WR-1 review)
// ============================================================================

// The context a probe's consumer belongs to (a wholly inert entry is checked flat there).
const PROBE_HOME_CONTEXT: Readonly<Partial<Record<string, ContextId>>> = {
  sheetCargo: "sheet",
  sheetYield: "sheet",
  sheetEngineEff: "sheet",
  sheetUnload: "sheet",
  sheetSensors: "sheet",
  sheetPowerDraw: "sheet",
  missionExtractionTicks: "mission:extraction",
  missionCycleOutput: "mission:extraction",
  officerWeapons: "patrol",
  officerShields: "patrol",
  officerEvasion: "patrol",
  repairTicks: "shipyard",
  expScanRate: "expedition:groundOps",
  expActivityRelicFind: "expedition:groundOps",
};
export function homeContextOf(probe: ProbeId): ContextId {
  const c = PROBE_HOME_CONTEXT[probe];
  if (!c) throw new Error(`wiring: no home context for probe ${probe}`);
  return c;
}

// The probes whose claimed context reads a whole-context digest (probes.ts sheetAt).
const DIGEST_PROBES = new Set<string>(["sheetCargo", "sheetTransit", "sheetFuelCapacity", "sheetEngineEff", "sheetSensors", "dcRepairReduction", "groundOpsRun", "patrolRun"]);

const strongerOfficers: Transform = (s) => ({
  ...s,
  officers: s.officers.map((o) =>
    o.assignedShipId === "ship-1" ? { ...o, bonuses: o.bonuses.map((b) => ({ ...b, magnitude: b.magnitude * 1.5 })) as typeof o.bonuses } : o,
  ),
});
const halvedPowerDraw: Transform = (s) => ({ ...s, equipment: s.equipment.map((e) => (e.fittedToShipId === "ship-1" ? { ...e, powerDraw: e.powerDraw / 2 } : e)) });
const museumOf = (stat: MuseumStat): Transform => (s) => withMuseum(s, museumGrantFor(stat) ?? {});
const GATING_RELIC = RELICS.find((r) => r.id !== "precursorLens" && blueprintsUnlockedByRelic(r.id).length > 0)?.id ?? "";

// The CONTROL of a flat check: a LIVE effect of the same shape, through the same probe, on the check's fixture.
// The check is real only if the control moves the probe there (an away team present, drones aboard, power drawn,
// a run that dispatches, a hull that patrols ...). null: no live effect can reach that consumer yet (the reason
// is in FLAT_UNCONTROLLED).
export function flatControl(probe: ProbeId, ctx: ContextId): Transform | null {
  if (DIGEST_PROBES.has(probe) && ctx === "expedition:groundOps") return shipPiece("sensors", LINE_POINTS); // the run freezes sensorPower
  if (DIGEST_PROBES.has(probe) && ctx === "patrol") return shipPiece("hullStrength", LINE_POINTS); // the cycle carries the hull pool
  switch (probe) {
    case "repairTicks":
      return shipPiece("repairSpeed", LINE_POINTS);
    case "expScanRate":
      return museumOf("scanSpeed");
    case "runSecHp":
      return (s) => wearPiece(s, WIRING_SECURITY_ID, "memberArmor", "ballisticWeave", { groundHp: LINE_POINTS });
    case "runSecHeal":
      return (s) => seatOfficer(s, "medical", ["med.fleetTriage"]); // Fleet Triage strengthens a medic's heal
    case "combatDroneHp":
      return shipPiece("droneHp", LINE_POINTS);
    case "missionUnloadTicks":
    case "sheetUnload":
      return (s) => seatOfficer(s, "operations", ["ops.unloadSurge"]);
    case "sheetPowerDraw":
      return halvedPowerDraw; // a power-draw cut shows only when something draws power
    case "missionCycleOutput":
      return (s) => seatOfficer(s, "executive", ["xo.commandOutput"]);
    case "injuryCare":
    case "legacyInjurySeconds":
      return (s) => withBuckets(s, [bucketOf("medical", "med.reducedLosses")]);
    case "sheetYield":
      return shipPiece("extractionYieldMult", LINE_POINTS);
    case "missionExtractionTicks":
      return museumOf("extractionSpeed");
    case "sheetCargo":
      return shipPiece("cargoCapacity", LINE_POINTS);
    case "sheetEngineEff":
      return shipPiece("engineEfficiency", LINE_POINTS);
    case "sheetSensors":
      return shipPiece("sensors", LINE_POINTS);
    case "officerWeapons":
    case "officerShields":
    case "expSquadTriage":
      return strongerOfficers; // a relative multiplier on the seated officers' existing bonus shows
    case "officerEvasion":
      return (s) => seatOfficer(s, "pilot", ["pilot.evasion"]);
    case "expActivityRelicFind":
      return museumOf("relicFindChance");
    case "quartersCapacity":
      return (s) => installPiece(s, { slotType: "quarters", moduleVariant: "quartersEfficient" });
    case "salvageTalentYield":
      return museumOf("salvageYield"); // the museum's salvage yield does reach a teardown
    case "researchableBlueprints":
      return discovered(GATING_RELIC);
    case "secResistSum":
      return (s) => wearPiece(s, WIRING_SECURITY_ID, "implant", "toxinFilters", { groundStatusResist: LINE_POINTS });
    default:
      return null;
  }
}

// The flat checks no live effect can control yet, and why ("<probe>@<context>").
export const FLAT_UNCONTROLLED: Readonly<Record<string, string>> = {
  "sciCombatPower@ground": "Science never fights (D2): nothing live reaches a Science member's battle stats",
  "secInflictPermille@ground:noInflict": "an inflict piece is the only live source of on-hit statuses, and this context is the one without it",
  "salvageTalentCeiling@salvage:topTier": "the pool's top tier is the clamp: nothing can raise the tier a top Fleet Admiral rolls",
  // WR-8: transit speed reaches a patrol's combat speed now (ship:audit:derivedStatsInCombat), so its pending patrol
  // context is the LEGS alone, read here; no live effect moves a patrol leg until WR-7 (OC-D8) scales them.
  "patrolOutboundTicks@patrol": "a patrol's legs are fixed route ticks until WR-7 (OC-D8: patrol legs scale with transit speed): nothing live moves them yet",
};

// ============================================================================
// G1-4: the mission:shortRange sweep (plan 4 G1-4: every entry whose claim covers missions gains mission:shortRange,
// or an explicit outOfScope with its reason; wiring.completeness.test.ts holds every mission-claim entry to it)
// ============================================================================

const SR_CONTEXT: ContextId = "mission:shortRange";
// The sources a short-range cycle reads, LIVE there through their own probe's mission:shortRange branch (probes.ts):
// the ship's mission output share on the pay, the officers' promotion hours out, the captain's Trade margin on a
// drop-off, Assayer on a delivered haul's quality, Motherlode on a delivered haul, and the transit berths its home
// turnaround occupies.
const SHORT_RANGE_SWEEP_LIVE: ReadonlySet<string> = new Set([
  "officer:officer.shipOutputMult",
  "crew:crew.crewOutputMult",
  "captain:SECONDARY_CAPTAIN_TALENTS:commandCrew2",
  "captain:SECONDARY_CAPTAIN_TALENTS:commandCrew5:officers",
  "captain:SECONDARY_CAPTAIN_TALENTS:commandCrew3",
  "captain:SECONDARY_CAPTAIN_TALENTS:trade1",
  "captain:SECONDARY_CAPTAIN_TALENTS:trade3",
  "captain:SECONDARY_CAPTAIN_TALENTS:extraction4",
  "captain:SECONDARY_CAPTAIN_TALENTS:extraction5",
  ...TRANSIT_BERTH_RUNGS.map((_, i) => `facility:TRANSIT_BERTH_RUNGS:${i}`),
]);
// The mission-claim sources a short-range cycle has nothing for, and why. [PROPOSAL, the user's to confirm: the
// extraction-roll talents stay with extraction missions.]
const NO_EXTRACTING = "a short-range job has no extracting phase or ore rolls: it pays its rolled job (shortRange.ts shortRangeCycleReward)";
const SHORT_RANGE_SWEEP_OUT_OF_SCOPE: Readonly<Record<string, string>> = {
  // E-MOD EM-7: the mission-cycle module trigger fires on extraction runs only (user 2026-10-22, "Extraction runs only":
  // Prospector's Echo is about material hauls), and a short-range board run is not one.
  "ship:UNIVERSAL_MODULES:prospectorsEcho": "the mission-cycle module trigger fires on extraction runs only (user 2026-10-22); a short-range board run is not one",
  "officer:officer.rareFindMult": "a short-range survey's yield is its scan size and Sensors, with no rare-tier roll to raise (its relic blanks roll the fixed per-hour rate of call 11, G1-5)",
  "crew:crew.rareFindChance": "a short-range survey's yield is its scan size and Sensors, with no rare-tier roll to raise (its relic blanks roll the fixed per-hour rate of call 11, G1-5)",
  "captain:CAPTAIN_TALENTS:prospectorHub": NO_EXTRACTING,
  "captain:CAPTAIN_TALENTS:prospectorBulkExtraction": NO_EXTRACTING,
  "captain:CAPTAIN_TALENTS:prospectorRefinedExtraction": NO_EXTRACTING,
  "captain:CAPTAIN_TALENTS:prospectorKeenEyeI": NO_EXTRACTING,
  "captain:CAPTAIN_TALENTS:prospectorKeenEyeII": NO_EXTRACTING,
  "captain:CAPTAIN_TALENTS:prospectorLuckyStrikeI": NO_EXTRACTING,
  "captain:CAPTAIN_TALENTS:prospectorLuckyStrikeII": NO_EXTRACTING,
  "captain:CAPTAIN_SPEC_BONUS:resourcefulness": NO_EXTRACTING,
  "captain:SECONDARY_CAPTAIN_TALENTS:extraction2": "Deep Veins raises the extraction roll's find chances; a short-range job draws no find roll",
  "captain:SECONDARY_CAPTAIN_TALENTS:extraction3": "Efficient Haul shortens the extracting phase; a short-range cycle has none",
  "captain:SECONDARY_CAPTAIN_TALENTS:logistics4": "missions have no load phase (D26 points Efficient Stowage at the Ground Ops reload)",
  "captain:SECONDARY_CAPTAIN_TALENTS:trade2": "measured on its own entry at the drop-off's own load (captain:SECONDARY_CAPTAIN_TALENTS:trade2:shortRange)",
  "fleetAdmiral:HOMEWORLD_TALENTS:fleetLogisticsHub": NO_EXTRACTING,
  "fleetAdmiral:HOMEWORLD_TALENTS:fleetLogisticsYield": NO_EXTRACTING,
  "facility:FACILITIES:missionControl:0": "the short-range board's two base slots need no Mission Control level; its later slots are the MISSION_CONTROL_BOARD_RUNGS (addShortRangeSlot)",
  "ship:gearLine:materialQualityChance": "a Prospecting Rig's ore quality is an extraction line; a short-range pickup's ore takes the deposit's own quality roll",
  // Rarity readiness RR-5: the Transmuter's Seal legendary affix rides the same line, so the same reason.
  "ship:LUMINOUS_AFFIXES:transmutersSeal": "a Prospecting Rig's ore quality is an extraction line; a short-range pickup's ore takes the deposit's own quality roll",
  "relic:MUSEUM_STATS:rareMaterialChance": NO_EXTRACTING,
};
// The Trade margin talents pay a drop-off's margin in whole credits (shortRangeCycle.ts shortRangeDropOffMargin rounds
// once after the bonus), so at mission:shortRange their outcome is an integer: one rounding step of tolerance.
const SHORT_RANGE_WHOLE_CREDITS: ReadonlySet<string> = new Set(["captain:SECONDARY_CAPTAIN_TALENTS:trade1", "captain:SECONDARY_CAPTAIN_TALENTS:trade3"]);
function withShortRangeScope(e: WiringEntry): WiringEntry {
  if (SHORT_RANGE_WHOLE_CREDITS.has(e.id)) return { ...e, contexts: [...e.contexts, SR_CONTEXT], tolerance: Math.max(e.tolerance ?? 0, 0.5) };
  if (SHORT_RANGE_SWEEP_LIVE.has(e.id)) return { ...e, contexts: [...e.contexts, SR_CONTEXT] };
  const reason = SHORT_RANGE_SWEEP_OUT_OF_SCOPE[e.id];
  return reason ? { ...e, outOfScope: [...(e.outOfScope ?? []), { context: SR_CONTEXT, reason }] } : e;
}
// Shrewd Negotiator on a short-range drop-off: the discount saved is the discount x THAT job's load (the training
// drop-off's smallest units x its tier's supply cost), so it is its own entry beside the supply-run one.
function trade2ShortRangeEntry(main: WiringEntry): WiringEntry {
  return {
    ...main,
    id: `${main.id}:shortRange`,
    source: { catalog: main.source.catalog, key: `${main.source.key}:shortRange` },
    contexts: [SR_CONTEXT],
    outOfScope: undefined,
    magnitude: (c) => {
      const e = c.SECONDARY_CAPTAIN_TALENTS.trade2.effect;
      const drop = c.SHORT_RANGE_TEMPLATES.supplyDropOff;
      const load = drop.reward.kind === "supplyLoop" ? (drop.rolls[1].units?.[0] ?? 0) * drop.reward.supplyCostPerUnit[1] : 0;
      return (e.type === "statMult" ? e.mult : 0) * load;
    },
    note: "one Supply Drop-off cycle's net credits: the load bought at the discount, sold at full value",
  };
}
function shortRangeSwept(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.flatMap((e) => {
    const scoped = withShortRangeScope(e);
    return e.id === "captain:SECONDARY_CAPTAIN_TALENTS:trade2" ? [scoped, trade2ShortRangeEntry(e)] : [scoped];
  });
}

// ============================================================================
// The registry
// ============================================================================

function build(): readonly WiringEntry[] {
  return [
    ...officerEntries(),
    ...crewEntries(),
    ...racialEntries(),
    ...facetEntries(),
    ...gearEntries(),
    ...standardIssueEntries(),
    ...AWAY_TRAITS.map(traitEntry),
    ...groundEffectEntries(),
    ...captainTalentEntries(),
    ...captainSpecEntries(),
    ...secondaryEntries(),
    ...captainProgressionEntries(),
    ...homeworldEntries(),
    ...facilityRungEntries(),
    ...trackEntries(),
    ...recipeAndBlueprintEntries(),
    ...shipLineEntries(),
    ...hullEntries(),
    ...moduleEntries(),
    ...sensorArrayEntries(),
    ...museumEntries(),
    ...relicEntries(),
    ...relicV2Entries(),
    ...missionEntries(),
    ...contentEntries(),
    ...affixEntries(),
    ...enemyRankEntries(),
    ...fieldKitEntries(),
    ...crewScalarEntries(),
    ...medicalEntries(),
    ...prospectingEntries(),
    ...gasStudyEntries(),
    ...reactorTechEntries(),
    ...rarityProfileEntries(),
    ...ascensionEntries(),
    ...legendaryAffixEntries(),
    ...moduleRarityEntries(),
    ...universalModuleEntries(),
    ...gearSetEntries(),
    ...auditEntries(),
    ...speedSeamEntries(),
    ...wearEntries(),
  ]
    .map((e) => (ALLOW_LIST_REASONS[e.id] ? { ...e, reason: ALLOW_LIST_REASONS[e.id] } : e))
    .flatMap((e) => shortRangeSwept([e]));
}

// RARITY READINESS RR-3 (docs/plans/2026-10-23-rarity-readiness-plan.md): each RARITY_PROFILES row, measured on a REAL
// mint through the generator that reads it: a balanced cargo bay (iLevel 40, quality 5, one fixed rng stream) of the
// band installed on the bare hull, against the same mint one band down (Radiant for the two legendaries; Standard for
// Derelict, which sits below it). Standard is the reference row.
//   - A LIVE row (Derelict to Radiant) installs the mint's signature line alone (its rolled lines dropped: a band's
//     affix count and Augmented's draw change WHICH affixes roll, so the rolled cargo is not monotone). The sheet moves
//     by EXACTLY the implicit line's difference at the two rows' budget multipliers (linearAbsolute).
//   - A LEGENDARY row installs the WHOLE mint (secondaries and Artisan included). It rolls the same affix picks as the
//     Radiant mint on the same stream (its extras draw comes after them), so every line is at least as large and the
//     sheet moves by at least the implicit difference (an event curve; the secondaries only add to it).
const RARITY_PROBE_ILEVEL = 40;
const RARITY_PROBE_QUALITY = 5;
function rarityCargoMint(rarity: EquipmentRarity, signatureOnly: boolean, ascension: EquipmentAscension = "none"): Transform {
  return (s) => {
    let x = 0x2468ace1;
    const rng = () => {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      return x / 4294967296;
    };
    const piece = generateEquipment({
      slotType: "cargoBay",
      varietyKey: EQUIPMENT_SLOTS.cargoBay.varieties[1].key,
      blueprintKey: null,
      iLevel: RARITY_PROBE_ILEVEL,
      quality: RARITY_PROBE_QUALITY,
      rarity,
      ascension,
      rng,
      allocateId: () => "wiring-equip-cargoBay",
    });
    return installPiece(s, { ...piece, ...(signatureOnly ? { rolledStats: {} } : {}), fittedToShipId: WIRING_SHIP_ID });
  };
}
// A cargo bay's single implicit line at a row's budget multiplier (the mint's own split).
const cargoImplicitAt = (mult: number): number => Math.round(budgetShares(budgetAtMult(RARITY_PROBE_ILEVEL, RARITY_PROBE_QUALITY, mult)).implicitShare);
const RARITY_PROBE_AGAINST: Readonly<Record<EquipmentRarity, EquipmentRarity | null>> = {
  derelict: "standard",
  standard: null,
  augmented: "standard",
  stellar: "augmented",
  radiant: "stellar",
  luminous: "radiant",
  constellar: "radiant",
};
function rarityProfileEntries(): WiringEntry[] {
  return (Object.keys(RARITY_PROFILES) as EquipmentRarity[]).map((rarity) => {
    const row = RARITY_PROFILES[rarity];
    const against = RARITY_PROBE_AGAINST[rarity];
    const extras = row.secondaries > 0 ? `, ${row.secondaries} secondary line(s) and a ${row.artisanPermille / 10}% Artisan chance` : "";
    const claim = `${rarity} gear rolls at x${row.budgetMult.toFixed(4)} budget with ${row.affixes} affix line(s)${row.extraAffixChance > 0 ? ` (${row.extraAffixChance * 100}% chance of one more)` : ""}${extras}`;
    if (against === null) {
      return entry({ id: `ship:RARITY_PROFILES:${rarity}`, system: "ship", source: { catalog: "RARITY_PROFILES", key: rarity }, claim, probe: "sheetCargo", notApplicable: "the reference band (every other row is measured against the band below it)" });
    }
    // RR-7 (answer 9): Derelict reads the Standard-Issue floor's budget, so its signature line equals Standard's (the
    // equality is pinned in rarityTraps.test.ts); its one difference, no affixes, is a rolled-line fact.
    if (rarity === "derelict" && row.budgetMult === RARITY_PROFILES[against].budgetMult) {
      return entry({ id: `ship:RARITY_PROFILES:${rarity}`, system: "ship", source: { catalog: "RARITY_PROFILES", key: rarity }, claim, probe: "sheetCargo", notApplicable: `reads the ${against} row's budget (the Standard-Issue floor, rarity readiness answer 9)` });
    }
    // Review of RR-3: EVERY row, the legendary ones too, installs the signature line alone and moves EXACTLY by the
    // implicit difference (linearAbsolute), so a budget the generator stops reading fails here. The secondaries, Artisan
    // and legendary affix are rolled lines, pinned exactly in rarityReviewFixes.test.ts (the generator's lines equal its
    // picks plus rollRarityExtras on the next draw) and rarityProfiles.test.ts / legendaryAffixes.test.ts.
    const delta = (c: Catalogs): number => cargoImplicitAt(c.RARITY_PROFILES[rarity].budgetMult) - cargoImplicitAt(c.RARITY_PROFILES[against].budgetMult);
    return entry({
      id: `ship:RARITY_PROFILES:${rarity}`,
      system: "ship",
      source: { catalog: "RARITY_PROFILES", key: rarity },
      claim,
      probe: "sheetCargo",
      contexts: ["sheet"],
      direction: row.budgetMult >= RARITY_PROFILES[against].budgetMult ? "up" : "down",
      curve: { kind: "linearAbsolute" },
      magnitude: delta,
      base: bareHull,
      on: rarityCargoMint(rarity, true),
      off: rarityCargoMint(against, true),
      note: "measured through generateEquipment (itemgen.ts rarityBudget / affixCount / rollRarityExtras read the row)",
    });
  });
}

// RARITY READINESS (review of RR-3 / RR-4): the module twin of the rows above. Each MODULE_RARITY_FACTOR band, and Nova /
// Celestial on a Luminous module, measured on a Utilitarian Quarters module (a live general crew boost) installed at
// that band and quality 0 on an Operations complement carrying Efficient Unloading: the bonus part above 1 of the unload
// speed is the module's boost x its effect scale (the QUARTERS_MODULES entries' own seam), so the scale is read exactly.
// Then the pending row: a Luminous / Constellar bridge or quarters module's secondaries and Artisan ride its crewEfficiency
// / crewStations lines, which nothing reads yet (LINE_PENDING, WR-7 OC-D3), so that part claims nothing live.
function moduleRarityEntries(): WiringEntry[] {
  const def = QUARTERS_MODULES.find((d) => d.id === "quartersUtilitarian")!;
  const boost = (c: Catalogs): number => c.QUARTERS_MODULES.find((d) => d.id === def.id)!.focusBoost;
  const opsBase = () => withBuckets(wiringBase(), [bucketOf("operations", "ops.unloadSpeed")]);
  const at = (rarity: EquipmentRarity, ascension: EquipmentAscension): Transform => (s) =>
    installPiece(s, { slotType: "quarters", moduleVariant: def.id, rarity, ascension, quality: 0 });
  const out: WiringEntry[] = (Object.keys(MODULE_RARITY_FACTOR) as EquipmentRarity[]).map((rarity) =>
    entry({
      id: `ship:MODULE_RARITY_FACTOR:${rarity}`,
      system: "ship",
      source: { catalog: "MODULE_RARITY_FACTOR", key: rarity },
      claim: `a ${rarity} crew, sensor or universal module acts at x${MODULE_RARITY_FACTOR[rarity].toFixed(4)} its catalog effect (before quality)`,
      probe: "sheetUnload",
      contexts: ["sheet"],
      curve: { kind: "bonusRelative", base: 1 },
      magnitude: (c) => boost(c) * c.MODULE_RARITY_FACTOR[rarity],
      base: opsBase,
      on: at(rarity, "none"),
      note: "measured through crewModules.ts (moduleEffectScale reads MODULE_RARITY_FACTOR)",
    }),
  );
  for (const ascension of ["nova", "celestial"] as const) {
    out.push(
      entry({
        id: `ship:ASCENSION_BUDGET_MULT:${ascension}:modules`,
        system: "ship",
        source: { catalog: "ASCENSION_BUDGET_MULT", key: `${ascension}:modules` },
        claim: `a ${ascension} Luminous or Constellar module acts at x${ASCENSION_BUDGET_MULT[ascension]} the legendary module effect`,
        probe: "sheetUnload",
        contexts: ["sheet"],
        curve: { kind: "bonusRelative", base: 1 },
        magnitude: (c) => boost(c) * c.MODULE_RARITY_FACTOR.luminous * c.ASCENSION_BUDGET_MULT[ascension],
        base: opsBase,
        on: at("luminous", ascension),
        note: "measured through crewModules.ts (moduleEffectScale reads the piece's ascension)",
      }),
    );
  }
  out.push(
    entry({
      id: "ship:audit:rrCrewModuleExtras",
      system: "ship",
      source: { catalog: "AUDIT", key: "ship:audit:rrCrewModuleExtras" },
      claim: "A Luminous / Constellar bridge or quarters module's secondaries and Artisan can land on its crewEfficiency / crewStations lines",
      status: pending("WR-7, OC-D3 (the tooltip prints the rolled value; nothing reads it)"),
    }),
  );
  return out;
}

// RARITY READINESS RR-4: each ASCENSION_BUDGET_MULT row, measured like a live rarity row: a Luminous cargo bay of the
// ascension (signature line only, the same stream) against the plain Luminous one, the sheet cargo moving by EXACTLY the
// implicit difference at the two multipliers. "none" is the reference. (The guaranteed Artisan and the Celestial
// secondary are rolled lines, pinned in ascension.test.ts; the Celestial auto-salvage exemption in salvage.ts.)
function ascensionEntries(): WiringEntry[] {
  return (Object.keys(ASCENSION_BUDGET_MULT) as EquipmentAscension[]).map((ascension) => {
    const mult = ASCENSION_BUDGET_MULT[ascension];
    const claim = `a ${ascension} Luminous or Constellar piece rolls at x${mult} the legendary budget`;
    if (ascension === "none") {
      return entry({ id: "ship:ASCENSION_BUDGET_MULT:none", system: "ship", source: { catalog: "ASCENSION_BUDGET_MULT", key: "none" }, claim, probe: "sheetCargo", notApplicable: "the reference (no ascension, x1)" });
    }
    return entry({
      id: `ship:ASCENSION_BUDGET_MULT:${ascension}`,
      system: "ship",
      source: { catalog: "ASCENSION_BUDGET_MULT", key: ascension },
      claim,
      probe: "sheetCargo",
      contexts: ["sheet"],
      direction: "up",
      curve: { kind: "linearAbsolute" },
      magnitude: (c) => {
        const lum = c.RARITY_PROFILES.luminous.budgetMult;
        return cargoImplicitAt(lum * c.ASCENSION_BUDGET_MULT[ascension]) - cargoImplicitAt(lum);
      },
      base: bareHull,
      on: rarityCargoMint("luminous", true, ascension),
      off: rarityCargoMint("luminous", true),
      note: "measured through generateEquipment (itemgen.ts ascendedProfile reads the row)",
    });
  });
}

// RARITY READINESS RR-5: each LUMINOUS_AFFIXES row, measured on the fold its stat line already moves. The row's value is
// its budget share of a Luminous piece at the registry's reference roll (iLevel 40, quality 5), through the mint's own
// legendaryAffixLineValue; the piece carrying that line goes on ship-1 (or on the squad's member) against the same piece
// without it, through the SAME seam the gear line's own entry uses (LINE_SEAMS, or gearSeam for a member line), with the
// seam's curve evaluated at the row's value. legendaryAffixes.test.ts pins that a Luminous mint adds exactly that value.
const legendaryProbeBudget = (c: Catalogs): number => budgetAtMult(RARITY_PROBE_ILEVEL, RARITY_PROBE_QUALITY, c.RARITY_PROFILES.luminous.budgetMult);
// The catalog row when the catalog holds it (a retune moves the magnitude), else the def itself (a candidate row).
const legendaryValueOf = (c: Catalogs, def: LegendaryAffixDef): number => legendaryAffixLineValue(c.LUMINOUS_AFFIXES.find((d) => d.id === def.id) ?? def, legendaryProbeBudget(c));
// A ship line's seam at an arbitrary number of points (the LINE_SEAMS shapes, generalized from LINE_POINTS).
const SHIP_LINE_AT: Readonly<Record<string, (c: Catalogs, points: number) => number>> = {
  cargoCapacity: (_c, p) => p,
  fuelCapacity: (_c, p) => p,
  powerOutput: (_c, p) => p,
  colonistCapacity: (_c, p) => p,
  weaponYield: (_c, p) => p,
  droneHp: (_c, p) => p,
  hullStrength: (_c, p) => p,
  shieldCapacity: (c, p) => p * hullDefenseComposition(c.SHIP_TYPES.destroyer).shieldCapEffectiveness,
  materialQualityChance: (_c, p) => materialQualityClimbChance(p),
  // Review of RR-5: the sensors line is live (flat on the sheet), for Far Watcher.
  sensors: (_c, p) => p,
  // Review of RR-5: transit speed is a percent line (the sheet's speed x (1 + its percent)), so "Fold Engine" is a
  // one-line catalog swap if the user picks it over Endless Wake.
  transitSpeedMult: (_c, p) => plusToPercent(p / PERCENT_STAT_CURVES.transitSpeedMult.plusDivisor, PERCENT_STAT_CURVES.transitSpeedMult.B, PERCENT_STAT_CURVES.transitSpeedMult.r),
};
// The seams LINE_SEAMS does not carry (transit speed is measured by its own speed entries there).
const LEGENDARY_EXTRA_SEAMS: Readonly<Record<string, LineSeam>> = {
  transitSpeedMult: { probe: "sheetTransit", contexts: ["sheet"], curve: { kind: "linearRelative" }, magnitude: () => 0 },
};
// The squad a member row is measured on (one that may wear the slot's first matching variety).
const LEGENDARY_MEMBER_TEAM: Readonly<Partial<Record<string, AwayTeamType>>> = {
  memberWeapon: "security",
  memberArmor: "security",
  memberTool: "science",
  implant: "security",
};
function legendaryAffixEntries(): WiringEntry[] {
  return LUMINOUS_AFFIXES.map(legendaryAffixEntryFor);
}
// One legendary affix row's entry (exported so a candidate row, such as the Fold Engine alternative, can be measured
// before it joins the catalog).
export function legendaryAffixEntryFor(def: LegendaryAffixDef): WiringEntry {
  const slotType = def.slotTypes[0];
  const value = legendaryValueOf(CATALOGS, def);
  const claim = `${def.label} (a Luminous ${slotType} legendary affix): ${def.budgetShare * 100}% of the piece's budget onto ${def.stat}`;
  const source = { catalog: "LUMINOUS_AFFIXES", key: def.id };
  const team = LEGENDARY_MEMBER_TEAM[slotType];
  if (team !== undefined) {
    const seam = gearSeam(team, def.stat as MemberGroundStatKey, (c) => legendaryValueOf(c, def))!;
    const variety = EQUIPMENT_SLOTS[slotType].varieties.find((v) => v.member?.teamTypes.includes(team))!;
    return entry({
      id: `away:LUMINOUS_AFFIXES:${def.id}`,
      system: "away",
      source,
      claim,
      probe: seam.probe,
      contexts: [seam.context],
      curve: seam.curve,
      magnitude: seam.magnitude,
      tolerance: seam.tolerance,
      base: () => withAwayTeam(wiringBase()),
      on: (s) => wearPiece(s, wearerOf(team), slotType, variety.key, { [def.stat]: value }),
      off: (s) => wearPiece(s, wearerOf(team), slotType, variety.key, {}),
    });
  }
  const seam = (LINE_SEAMS[def.stat] ?? LEGENDARY_EXTRA_SEAMS[def.stat])!;
  const at = SHIP_LINE_AT[def.stat]!;
  return entry({
    id: `ship:LUMINOUS_AFFIXES:${def.id}`,
    system: "ship",
    source,
    claim,
    probe: seam.probe,
    contexts: seam.contexts,
    curve: seam.curve,
    magnitude: (c) => at(c, legendaryValueOf(c, def)),
    tolerance: seam.tolerance,
    ...(seam.base ? { base: seam.base } : {}),
    on: shipPiece(def.stat, value),
    off: shipPiece(def.stat, 0),
  });
}

// RARITY READINESS RR-6: each GEAR_SETS tier, measured exactly on its fold. A tier of k pieces: k Constellar pieces of
// the set worn by one wearer (ship-1's slots, or the Security member's member slots; their own lines empty, so only the
// set acts) against the same k pieces with the k-th one out of the set, so exactly that tier switches (each tier of a
// test set adds a different line). Ship tiers read the line's own sheet seam (LINE_SEAMS); member tiers the squad
// line's seam (gearSeam). Plus the Celestial hook: four Survey Cadre pieces with one Celestial against none, which
// switches exactly the 5-piece tier on.
function setShipPieces(def: GearSetDef, k: number, last: "in" | "out", celestialFirst = false): Transform {
  return (s) => {
    let out = s;
    def.slotTypes.slice(0, k).forEach((slotType, i) => {
      out = installPiece(out, {
        slotType,
        rarity: "constellar",
        ...(celestialFirst && i === 0 ? { ascension: "celestial" as const } : {}),
        ...(i === k - 1 && last === "out" ? {} : { setId: def.id }),
      });
    });
    return out;
  };
}
// The member slots a Field-style set fills, in order (a second implant for the 5-piece: implants are a multi slot).
const SET_MEMBER_SLOTS = (def: GearSetDef): string[] => [...def.slotTypes, ...(def.slotTypes.includes("implant") ? ["implant"] : [])];
function setMemberPieces(def: GearSetDef, k: number, last: "in" | "out"): Transform {
  return (s) => {
    const memberId = WIRING_SECURITY_ID;
    const pieces = SET_MEMBER_SLOTS(def)
      .slice(0, k)
      .map(
        (slotType, i) =>
          ({
            id: `wiring-set-${def.id}-${i}`,
            slotType,
            moduleVariant: EQUIPMENT_SLOTS[slotType].varieties.find((v) => v.member?.teamTypes.includes("security"))!.key,
            rarity: "constellar",
            ascension: "none",
            quality: 0,
            iLevel: 10,
            blueprintKey: null,
            implicitStats: {},
            rolledStats: {},
            mass: 0,
            powerDraw: 0,
            durabilityMax: 100,
            fittedToShipId: null,
            fittedToMemberId: memberId,
            ...(i === k - 1 && last === "out" ? {} : { setId: def.id }),
          }) as RrEquipmentInstance,
      );
    const ids = new Set(pieces.map((p) => p.id));
    return { ...s, equipment: [...s.equipment.filter((e) => !ids.has(e.id)), ...pieces] };
  };
}
const setTierMagnitude = (c: Catalogs, setId: string, pieces: number): number => c.GEAR_SETS.find((x) => x.id === setId)!.tiers.find((t) => t.pieces === pieces)!.magnitude;
// ============================================================================
// E-MOD EM-7: the v1 universal modules (shipModules.ts UNIVERSAL_MODULES), one row each, measured on the engine its
// category reads at Standard quality 0 (moduleEffectScale 1), installed as the real piece (its catalog id stamped,
// its def's draw)
// ============================================================================

// The probe a module SET's bonus line reaches (its consumer).
const MODULE_SET_PROBES: Readonly<Record<string, ProbeId>> = { scanSpeedBonus: "expScanSpeedBonus" };

// A module piece of `def` on ship-1, its own id so two modules sit side by side (installPiece replaces by slot).
function modulePieceOn(def: UniversalModuleDef): Transform {
  return (s) => ({
    ...s,
    equipment: [
      ...s.equipment.filter((e) => e.id !== `wiring-module-${def.id}`),
      {
        id: `wiring-module-${def.id}`,
        slotType: "module",
        moduleVariant: def.id,
        rarity: "standard",
        ascension: "none",
        quality: 0,
        iLevel: 10,
        blueprintKey: `${def.id}Bp`,
        implicitStats: {},
        rolledStats: {},
        mass: 0,
        powerDraw: def.powerDraw,
        durabilityMax: 100,
        fittedToShipId: WIRING_SHIP_ID,
      } as GameState["equipment"][number],
    ],
  });
}
// The first `k` catalog modules of set `setId` installed (catalog order).
function moduleSetPieces(setId: string, k: number, except?: string): Transform {
  return (s) => UNIVERSAL_MODULES.filter((d) => d.category === "set" && d.setId === setId && d.id !== except).slice(0, k).reduce((acc, d) => modulePieceOn(d)(acc), s);
}

// The restore is floored to a whole point: in per-mille of the Destroyer's Standard-Issue pool that is under 1000 / pool.
const MODULE_SHIELD_RESTORE_TOLERANCE = 4;
const MODULE_BONUS_HAUL_TOLERANCE = 0.15; // three standard deviations of the 1,000-delivery sample at a 10% chance of +5
function universalModuleEntries(): WiringEntry[] {
  const std = moduleEffectScale("standard", 0, "none");
  const pct = (f: number): number => Math.round(f * 1000) / 10;
  const defOf = (c: Catalogs, id: string) => c.UNIVERSAL_MODULES.find((d) => d.id === id)!;
  const combat = (def: UniversalModuleDef): ContextId[] => def.contexts.filter((c): c is "patrol" | "shipEvent" => c === "patrol" || c === "shipEvent");
  return UNIVERSAL_MODULES.map((def) => {
    const common = {
      id: `ship:UNIVERSAL_MODULES:${def.id}`,
      system: "ship" as const,
      source: { catalog: "UNIVERSAL_MODULES", key: def.id },
      on: modulePieceOn(def),
    };
    switch (def.effect.key) {
      case "powerOutput":
        return entry({
          ...common,
          claim: `${def.label}: +${def.effect.magnitude} power output`,
          probe: "sheetPowerOutput",
          contexts: ["sheet"],
          magnitude: (c) => Math.round(defOf(c, def.id).effect.magnitude * std),
          base: () => wiringBase(),
          note: "a Passive power line: the sheet, the install gate and the budget read it (shipPower.ts moduleOutput)",
        });
      case "hullIntegrity":
        return entry({
          ...common,
          claim: `${def.label}: +${pct(def.effect.magnitude)}% hull integrity`,
          probe: "combatHullMax",
          contexts: combat(def),
          curve: { kind: "linearRelative" },
          magnitude: (c) => defOf(c, def.id).effect.magnitude * std,
          base: () => combatBase(),
          tolerance: 1,
          note: "bridge.ts applyModuleCombat lifts the combat hull pool (rounded to a whole point)",
        });
      case "weaponDamage":
        return entry({
          ...common,
          claim: `${def.label}: +${pct(def.effect.magnitude)}% weapon damage while the hull is below ${pct(def.condition?.fraction ?? 0)}%`,
          probe: "moduleLowHullShot",
          contexts: combat(def),
          curve: { kind: "linearRelative" },
          magnitude: (c) => defOf(c, def.id).effect.magnitude * std,
          base: () => combatBase(),
          tolerance: 0.5,
          note: "resolveBattle reads the Conditional per projectile (each rounded to a whole point, so the mean is within half a point)",
        });
      case "arcDamage":
        return entry({
          ...common,
          claim: `${def.label}: on a hit taken, a ${pct(def.chance ?? 0)}% chance to arc ${def.effect.magnitude} damage back`,
          probe: "moduleArcDamage",
          contexts: combat(def),
          magnitude: (c) => Math.round(defOf(c, def.id).effect.magnitude * std),
          base: () => combatBase(),
          note: "the largest single arc is exactly the configured whole points (resolveBattle's on-hit trigger, the module's private stream, an unarmored target)",
        });
      case "shieldRestore":
        return entry({
          ...common,
          claim: `${def.label}: once per battle below ${pct(def.trigger?.kind === "hullBelow" ? def.trigger.fraction : 0)}% hull, restore ${pct(def.effect.magnitude)}% shields`,
          probe: "moduleShieldRestored",
          contexts: combat(def),
          magnitude: (c) => Math.min(1000, Math.round(defOf(c, def.id).effect.magnitude * std * 1000)),
          base: () => combatBase(),
          tolerance: MODULE_SHIELD_RESTORE_TOLERANCE,
          note: "the largest single cast restores floor(pool x amount / 1000), so its per-mille of the pool is the configured share within one floor step (shipModuleRoster.test.ts asserts every cast exactly)",
        });
      case "bonusHaul":
        return entry({
          ...common,
          claim: `${def.label}: each extraction cycle, a ${pct(def.chance ?? 0)}% chance of ${pct(def.effect.magnitude)}% more common material`,
          probe: "moduleBonusHaul",
          contexts: ["mission:extraction"],
          magnitude: (c) => {
            const d = defOf(c, def.id);
            return (d.chance ?? 0) * bonusHaulUnits(10, d.effect.magnitude * std);
          },
          base: () => wiringBase(),
          tolerance: MODULE_BONUS_HAUL_TOLERANCE,
          note: "the mean extra ore per 10-ore delivery: the chance times the bonus (tickCaptainMission, the private mission-cycle stream)",
        });
      case "scanSpeedBonus":
        // A set piece: it COMPLETES its set (the other pieces already installed), so the set's tier switches on.
        return entry({
          ...common,
          claim: `${def.label}: completes the ${def.setId} set (+${pct(def.effect.magnitude)}% expedition scan speed with its partner)`,
          probe: MODULE_SET_PROBES[def.effect.key]!,
          contexts: ["expedition:groundOps"],
          magnitude: (c) => defOf(c, def.id).effect.magnitude * std,
          base: () => moduleSetPieces(def.setId!, Number.MAX_SAFE_INTEGER, def.id)(wiringBase("aurora")),
          note: "alone the piece gives nothing; it switches its set's tier on (gearSets.ts, read by expeditionGearBonuses)",
        });
      case "nebulaSweep":
        // Gas Giant Study GG-7: the Ramscoop Collector. Its consumer is the expedition dispatch, which freezes the boost
        // on the run's nebula stamp (per mille); the sweep's length and haul read the stamp (gasGiantStudy.ts), measured
        // end to end by the special blueprint's own row (facility:BLUEPRINTS:ramscoopCollectorBp:effect).
        return entry({
          ...common,
          claim: `${def.label}: nebula sweeps +${pct(def.effect.magnitude)}% canisters and that much faster`,
          probe: "content:gg7:ramscoopStamp",
          contexts: ["expedition:groundOps"],
          direction: "none",
          curve: { kind: "equals" },
          magnitude: (c) => Math.round(defOf(c, def.id).effect.magnitude * std * 1000) / 1000,
          base: () => withAwayTeam(wiringBase()),
          note: "the dispatch to a nebula system freezes the module's boost (Expedition.nebula.ramscoop, whole per mille)",
        });
      default:
        return entry({ ...common, claim: def.label, status: pending(`EM-8 (the ${def.effect.key} engine's registry row arrives with the Precursor Lens)`) });
    }
  });
}

function gearSetEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  for (const def of GEAR_SETS) {
    for (const t of def.tiers) {
      const key = `${def.id}:${t.pieces}`;
      const claim = `${def.label} (${def.scope} set) ${t.pieces}-piece: +${t.magnitude} ${t.stat}`;
      const source = { catalog: "GEAR_SETS", key };
      if (def.moduleSet === true) {
        // E-MOD EM-7: a MODULE set (the Survey Pair): its catalog modules installed together on an Aurora move the
        // dispatched run's scan speed bonus by the tier (Standard quality 0: the module scale is 1 there).
        out.push(
          entry({
            id: `ship:GEAR_SETS:${key}`,
            system: "ship",
            source,
            claim,
            probe: MODULE_SET_PROBES[t.stat]!,
            contexts: ["expedition:groundOps"],
            curve: { kind: "linearAbsolute" },
            magnitude: (c) => setTierMagnitude(c, def.id, t.pieces) * moduleEffectScale("standard", 0, "none"),
            base: () => wiringBase("aurora"),
            on: moduleSetPieces(def.id, t.pieces),
            note: "the set's modules installed on the ship; expedition.ts expeditionGearBonuses reads model.ts shipGearSetBonusLines",
          }),
        );
        continue;
      }
      if (def.scope === "ship") {
        const seam = LINE_SEAMS[t.stat]!;
        out.push(
          entry({
            id: `ship:GEAR_SETS:${key}`,
            system: "ship",
            source,
            claim,
            probe: seam.probe,
            contexts: seam.contexts,
            curve: { kind: "linearAbsolute" },
            magnitude: (c) => setTierMagnitude(c, def.id, t.pieces),
            base: bareHull,
            on: setShipPieces(def, t.pieces, "in"),
            off: setShipPieces(def, t.pieces, "out"),
            note: "the set's pieces carry no lines of their own, so only the tier moves (equipmentStatMods reads gearSetBonusLines)",
          }),
        );
      } else {
        const seam = gearSeam("security", t.stat as MemberGroundStatKey, (c) => setTierMagnitude(c, def.id, t.pieces))!;
        out.push(
          entry({
            id: `away:GEAR_SETS:${key}`,
            system: "away",
            source,
            claim,
            probe: seam.probe,
            contexts: [seam.context],
            curve: seam.curve,
            magnitude: seam.magnitude,
            tolerance: seam.tolerance,
            base: () => withAwayTeam(wiringBase()),
            on: setMemberPieces(def, t.pieces, "in"),
            off: setMemberPieces(def, t.pieces, "out"),
            note: "the set's pieces carry no lines of their own, so only the tier moves (snapshotMember reads gearSetBonusLines)",
          }),
        );
      }
    }
  }
  const survey = GEAR_SETS.find((d) => d.id === "testSetSurvey")!;
  const fiveStat = survey.tiers.find((t) => t.pieces === 5)!.stat;
  const fiveSeam = LINE_SEAMS[fiveStat]!;
  out.push(
    entry({
      id: "ship:GEAR_SETS:celestialReduction",
      system: "ship",
      source: { catalog: "GEAR_SETS", key: "celestialReduction" },
      claim: `a Celestial Constellar piece lowers every tier of its set by ${CELESTIAL_SET_REDUCTION} (four ${survey.label} pieces reach the 5-piece)`,
      probe: fiveSeam.probe,
      contexts: fiveSeam.contexts,
      curve: { kind: "linearAbsolute" },
      magnitude: (c) => setTierMagnitude(c, survey.id, 5),
      base: bareHull,
      on: setShipPieces(survey, 5 - CELESTIAL_SET_REDUCTION, "in", true),
      off: setShipPieces(survey, 5 - CELESTIAL_SET_REDUCTION, "in"),
    }),
  );
  return out;
}

// Prospecting squads (hidden): the role bases, the hidden blueprints and the three later uses, each deferred to
// the prospecting quests patch (PROSPECTING_DEFERRED). The gear lines and traits register in gearEntries and
// traitEntry.
function prospectingEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  for (const spec of Object.keys(PROSPECTING_SPEC_BASE)) {
    out.push(entry({ id: `away:PROSPECTING_SPEC_BASE:${spec}`, system: "away", source: { catalog: "PROSPECTING_SPEC_BASE", key: spec }, claim: `The ${spec} role's base lift`, status: PROSPECTING_DEFERRED }));
  }
  for (const [key, bp] of Object.entries(PROSPECTING_BLUEPRINTS)) {
    out.push(entry({ id: `facility:PROSPECTING_BLUEPRINTS:${key}`, system: "facility", source: { catalog: "PROSPECTING_BLUEPRINTS", key }, claim: `${bp.label}: research time, cost and Lab tier (merged into BLUEPRINTS when Prospecting goes visible)`, status: PROSPECTING_DEFERRED }));
  }
  const useClaim: Readonly<Record<string, string>> = {
    quest: "Prospecting quests: a squad works a claim's deposits (YIELD, GRADE, FIELD, HAZ)",
    mineralSite: "Expedition mineral sites: a Prospecting squad at Mineral Outcrop, Cave Network and Geothermal Chamber",
    miningMission: "Ship mining missions: a Prospecting squad aboard lifts the ship's extraction",
  };
  for (const use of PROSPECTING_USES) {
    out.push(entry({ id: `away:PROSPECTING_USES:${use}`, system: "away", source: { catalog: "PROSPECTING_USES", key: use }, claim: useClaim[use] ?? use, status: PROSPECTING_DEFERRED }));
  }
  return out;
}

// Gas Giant Study GG-1 (data only; plan docs/plans/2026-10-17-gas-giant-study-plan.md section 3.5): every effect the
// study's content configures, pending on the slice that reads it. The study's engine uses (GAS_STUDY_USES, owners in
// gasGiantContent.ts), each giant class's roll weight and mass band (GG-2: the class roll), its physics inputs and
// band odds and item weights (GG-3: the study reward and the probe's depth factor), and each nebula kind's band odds
// and item weights (GG-4: the nebula sweep). A slice flips its entries live, with a probe, in the commit that wires
// them. The items' own reserves and sell values register with the other ITEMS rows (recipeAndBlueprintEntries).
// GG-7: the blueprint each canister's registry row reads (a recipe taking it; GG-7's own where it added one).
const CANISTER_CONSUMER: Readonly<Record<GasCanisterId, string>> = {
  hydrogenCanister: "eliteQuartersBp",
  methaneCanister: "pressureForgedPlatingBp",
  ammoniaCanister: "eliteQuartersBp",
  deuteriumCanister: "classIIIDriveBp",
  helium3Canister: "resonanceSensorArrayBp",
  antimatterCell: "classVIDriveBp",
};

// GG-7: the piece blueprint `key` mints (Standard, quality 0, iLevel 10, a flat roll stream), installed on the ship.
function mintedOn(key: string): Transform {
  return (s) => {
    const out = BLUEPRINTS[key].equipmentOutput!;
    const piece = generateEquipment({ slotType: out.slotType, varietyKey: out.varietyKey, blueprintKey: key, iLevel: 10, quality: 0, rarity: "standard", ascension: "none", rng: () => 0.5, allocateId: () => `wiring-gg7-${key}` });
    return installPiece(s, { ...piece, fittedToShipId: WIRING_SHIP_ID });
  };
}

// GG-7: one special blueprint's effect row.
//   Pressure-Forged Plating: its lean on the Hull Plating lines, the kinetic dampening a batch of minted plates rolls vs
//     the Reinforced Plating (the slot's straight tank plate).
//   Ramscoop Collector: a nebula run's sweep canisters per hour of sweep, the minted module installed vs none.
//   Resonance Sensor Array: a study run's canisters above Standard over a reseeded batch, the minted array installed vs
//     none (user 2026-10-27, "Better canister odds").
function specialBlueprintEntry(key: SpecialBlueprintKey): WiringEntry {
  const source = { catalog: "BLUEPRINTS", key: `${key}:effect` };
  const label = BLUEPRINTS[key]?.label.replace(/ Blueprint$/, "") ?? key;
  switch (key) {
    case "pressureForgedPlatingBp":
      return entry({
        id: `ship:BLUEPRINTS:${key}:effect`,
        system: "ship",
        source,
        claim: `${label}: Hull Plating leaning into kinetic dampening (${PRESSURE_FORGED_PLATING_VARIETY})`,
        probe: "content:gg7:platingLean",
        contexts: ["craft"],
        curve: { kind: "event", metric: "kinetic dampening points over a batch of Stellar plates minted through generateEquipment, the variety vs the Reinforced Plating" },
        magnitude: () => 1,
        on: sourceOn,
        note: "the plate's lines fold into combat like every Hull Plating line (the SHIP_GEAR_LINES rows)",
      });
    case "ramscoopCollectorBp":
      return entry({
        id: `expedition:BLUEPRINTS:${key}:effect`,
        system: "expedition",
        source,
        claim: `${label}: bigger, faster nebula sweeps (${RAMSCOOP_COLLECTOR_MODULE}); never a gate`,
        probe: "content:gg7:sweepRate",
        contexts: ["expedition:groundOps"],
        curve: { kind: "event", metric: "a nebula run's sweep canisters per hour of sweep, the module installed vs none" },
        magnitude: () => 1,
        base: () => withAwayTeam(wiringBase()),
        on: mintedOn(key),
      });
    case "resonanceSensorArrayBp":
      return entry({
        id: `expedition:BLUEPRINTS:${key}:effect`,
        system: "expedition",
        source,
        claim: `${label}: richer canister bands (more Augmented and Stellar) from every gas giant study (${RESONANCE_SENSOR_ARRAY})`,
        probe: "content:gg7:studyBands",
        contexts: ["expedition:groundOps"],
        curve: { kind: "event", metric: "a study run's canisters above Standard over a reseeded batch of its giant studies, the array installed vs none" },
        magnitude: () => 1,
        base: () => withAwayTeam(wiringBase()),
        on: mintedOn(key),
      });
  }
}

function gasStudyEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  const useSystem: Readonly<Record<GasStudyUse, WiringSystem>> = {
    classRoll: "expedition",
    studyReward: "expedition",
    probeDive: "away",
    nebulaSweep: "expedition",
    labLane: "facility",
    canisterRecipes: "facility",
    pickupPause: "expedition",
  };
  // The uses a built slice has taken live, each with its probe (the rest stay pending on their owner).
  //   classRoll (GG-2): a dispatch to a system with an orbital body freezes a giant profile on it.
  const liveUse: Partial<Record<GasStudyUse, Partial<EntryInput>>> = {
    classRoll: {
      probe: "content:gasStudy:classRoll",
      contexts: ["expedition:groundOps"],
      curve: { kind: "event", metric: "orbital bodies of a dispatched study run carrying a giant profile" },
      magnitude: () => 1,
      base: () => withAwayTeam(wiringBase()),
      on: sourceOn,
    },
    //   studyReward (GG-3): a study run's claim brings home the canisters of its studies (OFF: the same run unstamped).
    studyReward: {
      probe: "content:gasStudy:studyReward",
      contexts: ["expedition:groundOps"],
      curve: { kind: "event", metric: "canisters the studies of a whole study run return" },
      magnitude: () => 1,
      base: () => withAwayTeam(wiringBase()),
      on: sourceOn,
    },
    //   probeDive (GG-3): a Science member's Galileo dives: the study's canister haul scale x100 with it vs without.
    probeDive: {
      probe: "content:gasStudy:probeDive",
      contexts: ["expedition:groundOps"],
      curve: { kind: "event", metric: "the study's canister haul scale x100 with a reference Galileo aboard vs none" },
      magnitude: () => 1,
      base: () => withAwayTeam(wiringBase()),
      on: sourceOn,
    },
    //   labLane (GG-5): the Research Lab's data study lane banks a boost from one held research data item (OFF: paused).
    labLane: {
      probe: "content:dataStudy:lane",
      contexts: ["research"],
      curve: { kind: "event", metric: "boosts banked by one study of Propulsion Data on the Research Lab's lane" },
      magnitude: () => 1,
      on: sourceOn,
    },
    //   pickupPause (the user, 2026-10-23): a study run's shuttles no longer wait out a study or the sweep when the ship
    //   can collect them sooner (OFF: the stamp taken away, a run dispatched before the change). Read as the seconds
    //   teams spend in the return step over a whole run, pickups included (the source cuts them).
    pickupPause: {
      probe: "content:gasStudy:pickupPause",
      contexts: ["expedition:groundOps"],
      curve: { kind: "event", metric: "seconds teams spend in the return step over a whole nebula run, pickups and waits included (negated: the source cuts them)" },
      magnitude: () => 1,
      base: () => withAwayTeam(wiringBase()),
      on: sourceOn,
    },
    //   canisterRecipes (GG-7): every canister feeds a recipe (the G2 drive classes, the Reactor Cores, the special
    //   blueprints and the Lab tier III Elite Quarters): one craft of each spends its canisters (OFF: none held).
    canisterRecipes: {
      probe: "content:gg7:canisterUses",
      contexts: ["craft"],
      curve: { kind: "event", metric: "canisters one craft of every canister recipe spends (OFF: none held, so each craft refuses)" },
      magnitude: () => 1,
      on: sourceOn,
    },
    //   nebulaSweep (GG-4): a run to a system with a nebula brings home its sweep's canisters (OFF: the stamp taken away).
    nebulaSweep: {
      probe: "content:gasStudy:nebulaSweep",
      contexts: ["expedition:groundOps"],
      curve: { kind: "event", metric: "canisters the nebula sweep of a whole run returns" },
      magnitude: () => 1,
      base: () => withAwayTeam(wiringBase()),
      on: sourceOn,
    },
  };
  for (const use of Object.keys(GAS_STUDY_USES) as GasStudyUse[]) {
    const system = useSystem[use];
    const live = liveUse[use];
    out.push(
      entry({
        id: `${system}:GAS_STUDY_USES:${use}`,
        system,
        source: { catalog: "GAS_STUDY_USES", key: use },
        claim: GAS_STUDY_USES[use],
        ...(live ?? { status: pending(GAS_STUDY_USES[use]) }),
      }),
    );
  }
  // A giant class's field a built slice reads, live with its probe (content:giantClass:<class>:<field>), else null.
  //   weight (GG-2): the class roll picks the class more often with its weight than with it zeroed.
  //   massMinMilliJ / massMaxMilliJ (GG-2): the mass roll's first and last steps are the band's ends.
  const liveClassField = (c: (typeof GIANT_CLASSES)[number], field: string): Partial<EntryInput> | null => {
    const probe = `content:giantClass:${c.id}:${field}` as const;
    switch (field) {
      case "weight":
        return { probe, contexts: ["expedition:groundOps"], curve: { kind: "event", metric: `${c.name} rolls over a body batch with its weight vs zeroed` }, magnitude: () => 1, on: sourceOn };
      case "massMinMilliJ":
      case "massMaxMilliJ":
        return {
          probe,
          contexts: ["expedition:groundOps"],
          direction: "none",
          curve: { kind: "equals" },
          magnitude: (cfg) => {
            const def = cfg.GIANT_CLASSES.find((x) => x.id === c.id)!;
            return field === "massMinMilliJ" ? def.massMinMilliJ : def.massMaxMilliJ;
          },
        };
      // GG-3, the probe's depth factor (gravity^0.4 from the radius model and the heat inflation), x1000 at the band's
      // middle step: with the class's own model vs the plain giant curve, with its inflation vs none.
      case "radiusModel":
        return c.radiusModel === "giant"
          ? { probe: undefined, contexts: [], notApplicable: "the plain giant radius curve is the baseline the other models are read against" }
          : { probe, contexts: ["expedition:groundOps"], direction: "up", curve: { kind: "event", metric: `${c.name}'s depth factor x1000, its own radius model vs the giant curve` }, magnitude: () => 1, on: sourceOn };
      case "inflation":
        return c.inflation === 1
          ? { probe: undefined, contexts: [], notApplicable: "no heat inflation (x1)" }
          : { probe, contexts: ["expedition:groundOps"], direction: "down", curve: { kind: "event", metric: `${c.name}'s depth factor x1000 with its inflation vs none` }, magnitude: () => 1, on: sourceOn };
      // GG-3, the study reward over a batch of studies of this class: the canisters above the Standard band with the
      // class's odds vs all Standard; the class's heaviest Standard gas with its weights vs even weights.
      case "bandOdds":
        return { probe, contexts: ["expedition:groundOps"], curve: { kind: "event", metric: `${c.name} canisters above Standard over a study batch, its odds vs all Standard` }, magnitude: () => 1, on: sourceOn };
      case "itemWeights":
        return { probe, contexts: ["expedition:groundOps"], curve: { kind: "event", metric: `${c.name}'s heaviest Standard gas over a study batch, its weights vs even` }, magnitude: () => 1, on: sourceOn };
      default:
        return null;
    }
  };
  // The slice that reads each effect field. A field with no owner here gets NO entry (never a fallback owner), so the
  // completeness test ("every enumerated source has a registry entry") fails until it is given one.
  const classOwner: Readonly<Record<string, string>> = {
    weight: GAS_STUDY_USES.classRoll,
    massMinMilliJ: GAS_STUDY_USES.classRoll,
    massMaxMilliJ: GAS_STUDY_USES.classRoll,
    radiusModel: GAS_STUDY_USES.probeDive,
    inflation: GAS_STUDY_USES.probeDive,
    bandOdds: GAS_STUDY_USES.studyReward,
    itemWeights: GAS_STUDY_USES.studyReward,
  };
  const kindOwner: Readonly<Record<string, string>> = {
    bandOdds: GAS_STUDY_USES.nebulaSweep,
    itemWeights: GAS_STUDY_USES.nebulaSweep,
  };
  for (const c of GIANT_CLASSES) {
    for (const field of effectFieldsOf("GIANT_CLASSES")) {
      const owner = classOwner[field];
      if (owner === undefined) continue;
      const live = liveClassField(c, field);
      out.push(
        entry({
          id: `expedition:GIANT_CLASSES:${c.id}:${field}`,
          system: "expedition",
          source: { catalog: "GIANT_CLASSES", key: `${c.id}:${field}` },
          claim: `${c.name}: its ${field}`,
          ...(live ?? { status: pending(owner) }),
        }),
      );
    }
  }
  for (const k of NEBULA_KINDS) {
    for (const field of effectFieldsOf("NEBULA_KINDS")) {
      const owner = kindOwner[field];
      if (owner === undefined) continue;
      // GG-4 built the sweep: both fields go live, each read through a batch of sweep rewards of the kind (the canisters
      // above Standard with its odds vs all Standard; its heaviest gas of an uneven band with its weights vs even).
      const metric = field === "bandOdds" ? `${k.name} canisters above Standard over a sweep batch, its odds vs all Standard` : `${k.name}'s heaviest gas of an uneven band over a sweep batch, its weights vs even`;
      out.push(
        entry({
          id: `expedition:NEBULA_KINDS:${k.id}:${field}`,
          system: "expedition",
          source: { catalog: "NEBULA_KINDS", key: `${k.id}:${field}` },
          claim: `${k.name}: its ${field}`,
          probe: `content:nebulaKind:${k.id}:${field}`,
          contexts: ["expedition:groundOps"],
          curve: { kind: "event", metric },
          magnitude: () => 1,
          on: sourceOn,
        }),
      );
    }
  }
  // GG-7 (the dead-stock rule, user call 7): each canister's consumer, a NEW blueprint taking it (no existing recipe
  // moved), read through one Fabricator craft of it: the canisters it spends equal its recipe's count.
  for (const id of GAS_CANISTER_IDS) {
    const key = CANISTER_CONSUMER[id];
    out.push(
      entry({
        id: `facility:GAS_STUDY_USES:canisterRecipes:${id}`,
        system: "facility",
        source: { catalog: "GAS_STUDY_USES", key: `canisterRecipes:${id}` },
        claim: `${ITEMS[id]?.label ?? id}: ${BLUEPRINTS[key]?.label ?? key} takes it`,
        probe: `content:craftSpends:${key}:${id}`,
        contexts: ["craft"],
        direction: "none",
        curve: { kind: "equals" },
        magnitude: (c) => c.BLUEPRINTS[key]?.recipe.inputs[id] ?? 0,
        note: "one craft at a Fabricator of its tier, researched and holding the inputs: the canisters it spends at start",
      }),
    );
  }
  // GG-7: each special blueprint's effect, measured through its consumer with the piece its blueprint mints (Standard,
  // quality 0, iLevel 10) installed on the ship.
  for (const key of SPECIAL_BLUEPRINT_KEYS) out.push(specialBlueprintEntry(key));
  // GG-3: the probe dive (gasGiantStudy.ts studyDiveEvents): one event per finished study with a Galileo aboard. Gear
  // wear step 3 wires it LIVE: each dive is one fieldwork step's use on the probe that dove (gearWearEngine.ts
  // expeditionWear), measured on the real run read at its first dive (wiring/wearProbes.ts divePerUnit).
  out.push(
    entry({
      id: "away:GAS_STUDY_SEAM:probeDiveWear",
      system: "away",
      source: { catalog: "GAS_STUDY_SEAM", key: "probeDiveWear" },
      claim: "Each finished study with a Galileo-Class Probe aboard is one probe dive (the probe's use wear)",
      probe: "wear:dive" as ProbeId,
      contexts: ["expedition:groundOps"],
      direction: "down",
      magnitude: (c) => -(c.WEAR_SOURCES.find((w) => w.id === "memberTool:fieldworkStep")?.raw ?? 0),
      base: () => diveFixture(),
      off: (s) => ({ ...s, equipment: s.equipment.filter((e) => e.id !== WEAR_DIVE_PROBE_ID) }),
      tolerance: 1,
      note: "one fieldwork step on the probe (gear wear design 3.1, user 2026-10-16: \"sensors by scans, tools by fieldwork\"); gasGiantStudyLeg.test.ts proves the events",
    }),
  );
  // GG-5: the lab lane's effects (dataStudy.ts): one banked boost per research family (the ticks it saves on the
  // family's first blueprint) and the recipe chance, each live with its probe; the Ancient Data Fragment's decode is a
  // seam until a blueprint reads it (GG-7).
  for (const family of RESEARCH_FAMILIES) {
    out.push(
      entry({
        id: `facility:DATA_STUDY:boost:${family}`,
        system: "facility",
        source: { catalog: "DATA_STUDY", key: `boost:${family}` },
        claim: `A banked ${family} data boost speeds the next ${family} research project by ${Math.round(RESEARCH_BOOST_PER * 100)}% (D23 stacking)`,
        probe: `content:dataStudy:boost:${family}`,
        contexts: ["research"],
        curve: { kind: "event", metric: `research ticks one banked boost saves on the first ${family} blueprint` },
        magnitude: () => 1,
        on: sourceOn,
      }),
    );
  }
  out.push(
    entry({
      id: "facility:DATA_STUDY:recipeChance",
      system: "facility",
      source: { catalog: "DATA_STUDY", key: "recipeChance" },
      claim: `A data study learns a recipe of its family at ${DATA_STUDY_RECIPE_PERMILLE / 10}%`,
      probe: "content:dataStudy:recipe",
      contexts: ["research"],
      curve: { kind: "event", metric: "recipes learned over 400 study rolls with a candidate waiting" },
      magnitude: () => 1,
      on: sourceOn,
    }),
    entry({
      id: "facility:DATA_STUDY:ancientDecode",
      system: "facility",
      source: { catalog: "DATA_STUDY", key: "ancientDecode" },
      claim: "An Ancient Data Fragment's study decodes the next entry of its own culture (the entries open the special blueprints)",
      // GG-7: LIVE. The study raises GameState.ancientDecoded (probe content:dataStudy:decode measures it) and the
      // special blueprints read it (decodeGate below). The culture study point it also gives waits on culture naming
      // (its own seam below, R2-6).
      probe: "content:dataStudy:decode",
      contexts: ["research"],
      curve: { kind: "event", metric: "entries one Ancient Data Fragment study decodes" },
      magnitude: () => 1,
      on: sourceOn,
    }),
    entry({
      id: "facility:DATA_STUDY_SEAM:decodeGate",
      system: "facility",
      source: { catalog: "DATA_STUDY_SEAM", key: "decodeGate" },
      claim: "A special blueprint opens once enough ancient entries of one culture are decoded (BlueprintDef.requiresDecode)",
      // GG-7: LIVE. The three special blueprints carry requiresDecode; a Lab VII researches each once one culture has
      // decoded its entry (OFF: no entry decoded, every one refused as `undecoded`).
      probe: "content:gg7:decodeGate",
      contexts: ["research"],
      curve: { kind: "gate" },
      magnitude: (c) => SPECIAL_BLUEPRINT_KEYS.filter((k) => (c.BLUEPRINTS[k]?.requiresDecode ?? Infinity) <= 3).length,
      on: sourceOn,
      note: "gasGiantSpecials.test.ts walks each special blueprint across its own entry",
    }),
    entry({
      id: "facility:DATA_STUDY_SEAM:cultureStudyPoint",
      system: "facility",
      source: { catalog: "DATA_STUDY_SEAM", key: "cultureStudyPoint" },
      claim: "An Ancient Data Fragment's study gives its culture one study point (the Museum v2 culture record)",
      status: { kind: "seam", owner: "Relics v2 R2-6 (culture naming reads the study points)", userRef: "relics v2 call 9 (2026-10-19, \"Tied to source planet\"): +1 study point per identified find plus 15b ancient data; named at 10" },
      note: "dataStudy.ts feedCultureData writes the point; nothing reads it until culture names are signed off (R2-8)",
    }),
  );
  return out;
}

// ============================================================================
// Reactor tech foundation + the reactor fuel ladder (0.14.0, reactorTech.ts; capture
// docs/plans/2026-10-21-reactor-fuel-and-recipe-realism-capture.md sections 1 to 6)
// ============================================================================
// Live: each fuel rung some Reactor Core blueprint reads today (fusion tiers I and II), and each Reactor Core variety's
// tech tag (the tag picks the ladder its blueprint's fuel comes from), both measured by one Fabricator craft (the
// canisters it spends). Every rung no blueprint reads yet (the larger fusion cores, the three higher tech tiers) and the
// hull tier power generation requirement are SEAMS the user asked to be built now for the balancing patch (audit Group
// A: Helium-3 goes in no reactor in 0.14.0). A rung goes live, probe and all, by itself the moment a blueprint reads it.

const REACTOR_BALANCING_REF =
  "capture 2026-10-21 (user): \"Probably a requirement of power generation on T7 ships. Which likely won't appear until at least the balancing patch\"; foundation \"Data model + hooks (Recommended)\", no new reactors in 0.14.0; recipe realism audit Group A call 3: Helium-3 \"reactors take it in the balancing patch\"";

function reactorCoreBlueprints(): string[] {
  return Object.keys(BLUEPRINTS).filter((k) => BLUEPRINTS[k].equipmentOutput?.slotType === "reactorCore");
}

function reactorTechEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  const cores = reactorCoreBlueprints();
  const varietyOf = (bp: string): string => BLUEPRINTS[bp].equipmentOutput!.varietyKey;
  for (const t of REACTOR_TECH_TIERS) {
    t.fuelLadder.forEach((rung, i) => {
      const upTo = t.fuelLadder[i + 1]?.fromBlueprintTier ?? Infinity;
      const readers = cores.filter((k) => REACTOR_VARIETY_TECH[varietyOf(k)] === t.id && BLUEPRINTS[k].tier >= rung.fromBlueprintTier && BLUEPRINTS[k].tier < upTo);
      const fuel = Object.keys(rung.fuel);
      const common = {
        id: `facility:REACTOR_TECH_TIERS:${t.id}:fuel:${i}`,
        system: "facility" as const,
        source: { catalog: "REACTOR_TECH_TIERS", key: `${t.id}:fuel:${i}` },
        claim: `${t.label} Reactor Core blueprints from tier ${rung.fromBlueprintTier} take ${fuel.map((f) => `${rung.fuel[f]} ${f}`).join(" and ")} per craft`,
      };
      if (readers.length > 0) {
        const item = fuel[0];
        out.push(
          entry({
            ...common,
            probe: `content:reactorFuel:${readers[0]}:${item}` as ProbeId,
            contexts: ["craft"],
            direction: "none",
            curve: { kind: "equals" },
            magnitude: (c) => c.REACTOR_FUEL_LADDER[t.id][i].fuel[item] ?? 0,
            note: `one Fabricator craft of ${readers[0]}: the ${item} it spends (read by ${readers.join(", ")})`,
          }),
        );
      } else {
        out.push(entry({ ...common, status: { kind: "seam", owner: "balancing patch", userRef: REACTOR_BALANCING_REF } }));
      }
    });
  }
  for (const variety of Object.keys(REACTOR_VARIETY_TECH)) {
    const tech = REACTOR_VARIETY_TECH[variety];
    const bp = cores.find((k) => varietyOf(k) === variety);
    const common = {
      id: `facility:REACTOR_VARIETY_TECH:${variety}`,
      system: "facility" as const,
      source: { catalog: "REACTOR_VARIETY_TECH", key: variety },
      claim: `A ${variety} Reactor Core is ${tech} tech, so its blueprint burns its tier's ${tech} fuel`,
    };
    if (bp === undefined) {
      out.push(entry({ ...common, status: pending("a Reactor Core blueprint of this variety (none crafts it yet)") }));
      continue;
    }
    const rung = reactorFuelRung(tech, BLUEPRINTS[bp].tier);
    const index = REACTOR_TECH_TIERS.find((x) => x.id === tech)!.fuelLadder.indexOf(rung);
    const item = Object.keys(rung.fuel)[0];
    out.push(
      entry({
        ...common,
        probe: `content:reactorFuel:${bp}:${item}` as ProbeId,
        contexts: ["craft"],
        direction: "none",
        curve: { kind: "equals" },
        magnitude: (c) => c.REACTOR_FUEL_LADDER[tech][index].fuel[item] ?? 0,
        note: `one Fabricator craft of ${bp}: the ${item} it spends`,
      }),
    );
  }
  out.push(
    entry({
      id: "ship:SHIP_SEAMS:hullReactorRequirement",
      system: "ship",
      source: { catalog: "SHIP_SEAMS", key: "hullReactorRequirement" },
      claim: "A hull's tier can require a reactor tech for its power generation (reactorTech.ts HULL_TIER_REACTOR_REQUIREMENT, read by shipPowerBudget.reactorTechMet)",
      status: { kind: "seam", owner: "balancing patch", userRef: REACTOR_BALANCING_REF },
      note: "no requirement is active in 0.14.0 (the table is empty); reactorTech.test.ts proves the seam on a test table",
    }),
  );
  return out;
}

// ============================================================================
// gear wear (0.14.0, design docs/plans/2026-10-16-gear-wear-design.md section 9; build order steps 1 to 3)
// ============================================================================

// Step 3: the contexts a USE source's event happens in (wiring/wearProbes.ts drives each: a delivered captain-mission
// cycle, a delivered non-training short-range cycle, a stamped expedition coming home).
const WEAR_MISSION_CONTEXTS: ContextId[] = ["mission:extraction", "mission:survey", "mission:transport", "mission:shortRange"];
const WEAR_RUN_CONTEXTS: ContextId[] = [...WEAR_MISSION_CONTEXTS, "expedition:groundOps"];
const WEAR_USE_CONTEXTS: Readonly<Record<string, ContextId[]>> = {
  "cargoBay:haul": WEAR_MISSION_CONTEXTS,
  "ftlDrive:distance": WEAR_RUN_CONTEXTS,
  "reactorCore:minutesRunning": WEAR_RUN_CONTEXTS,
  "bridge:minutesCrewed": WEAR_RUN_CONTEXTS,
  "quarters:minutesCrewed": WEAR_RUN_CONTEXTS,
  "module:minutesUnderway": WEAR_RUN_CONTEXTS,
  "sensor:surveyCycle": ["mission:survey", "mission:shortRange"],
  "sensor:bodyScanned": ["expedition:groundOps"],
  // Gear wear step 4: and a Damage Control Suite's fires (a Shipyard repair it shortens, a patrol wave it patches).
  "specUtility:effectFires": ["mission:extraction", "mission:survey", "expedition:groundOps", "shipyard", "patrol"],
  "memberWeapon:groundFight": ["expedition:groundOps"],
  "memberTool:fieldworkStep": ["expedition:groundOps"],
  "implant:minutesOnGround": ["expedition:groundOps"],
};
const WEAR_USE_OUT_OF_SCOPE: Readonly<Record<string, { context: ContextId; reason: string }[]>> = {
  "specUtility:effectFires": [
    { context: "mission:shortRange", reason: "a short-range job draws no prospecting haul (it pays its rolled job), so no rig fires there" },
  ],
};
// Gear wear step 4: the contexts a BATTLE source's battle happens in (wiring/wearProbes.ts drives each: a stamped patrol
// cycle through the live engine, an expedition's light hull wear through its homecoming, a ground fight's armor wear).
// The ship pieces' sources also act in the Ground Ops ship battles (gearWearCombatGoldens.test.ts pins them).
const WEAR_BATTLE_CONTEXTS: Readonly<Record<string, ContextId[]>> = {
  "weapon:hitsTaken": ["patrol"],
  "reactorCore:hitsTaken": ["patrol"],
  "ftlDrive:hitsTaken": ["patrol"],
  "shieldEmitters:damageAbsorbed": ["patrol"],
  "hullPlating:hullLost": ["patrol", "shipEvent"],
  "droneBay:dronesLost": ["patrol"],
  "memberArmor:hpLost": ["ground"],
};
// A battle source's per-unit read is whole per-mille over the battle's measure (the share of the pool it took), so a
// floor of one per-mille shows as up to 1 / share: the tolerance (the probes' fixtures take a large share).
const WEAR_BATTLE_TOLERANCE = 6;
// The variety each ship slot's use fixture installs (a prospecting rig for the utility slot: it fires on a haul).
const WEAR_FIXTURE_VARIETY: Readonly<Record<string, string>> = { sensor: "sensorBalanced", specUtility: "yieldRig", bridge: "bridgeBalancedCommand", quarters: "quartersUtilitarian" };

// A fixture with ONE pristine piece of `slot` at the TOUGHNESS_REFERENCE (so a raw amount is the amount), crew aboard
// (an officer with no bonus: the crew modules wear only with crew aboard), and `lines` on the piece.
function wearSlotFixture(slot: string, lines: Readonly<Record<string, number>> = {}, variety?: string): GameState {
  if (slot.startsWith("member") || slot === "implant") {
    const member = wearMemberOf(slot);
    const team: AwayTeamType = member === WIRING_SCIENCE_ID ? "science" : "security";
    return wearPiece(withAwayTeam(wiringBase()), member, slot, variety ?? memberVarietyFor(slot, team) ?? "", lines);
  }
  const s = seatOfficer(wiringBase(), "operations", []);
  const v = variety ?? WEAR_FIXTURE_VARIETY[slot];
  return installPiece(s, { slotType: slot, durabilityMax: TOUGHNESS_REFERENCE, implicitStats: { ...lines }, ...(v ? { moduleVariant: v } : {}) });
}

// A worn piece (the repair fixtures): ship-1's cargo bay at WEAR_FIXTURE_CONDITION, anchored now.
function wornCargoFixture(s: GameState = wiringBase()): GameState {
  return withFixtureCondition(installPiece(s, { slotType: "cargoBay", durabilityMax: TOUGHNESS_REFERENCE }), "cargoBay", WEAR_FIXTURE_CONDITION);
}

// The ship-1 cargo piece (installPiece's id) as a pristine reference, to read a line's efficiency through.
const WEAR_LINE = LINE_POINTS;
const WEAR_FLOOR_EFFICIENCY = (): number => wearEfficiency(USE_WEAR_FLOOR);

function wearEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  // The sign convention (the registry's curve math, curveExpected): a magnitude is SIGNED so the curve lands on the
  // expected value. A wear source (linearAbsolute, down) is minus its raw per-mille per unit of its event; an
  // efficiency consumer (down) is the efficiency at the use floor's move; a repair context or bonus (up) is positive.
  //
  // One entry per wear source (kind x source). A USE source is LIVE (step 3) at every context its event happens in:
  // the probe drives that event once through the real engine on a TOUGHNESS_REFERENCE piece at full condition (the
  // headroom factor at full is 1) and reads what it took per unit of the event (one rounding step of tolerance: the
  // whole per-mille). off = the fixture without the piece (nothing to wear). A BATTLE source waits for step 4.
  for (const w of WEAR_SOURCES) {
    const use = w.mode === "use";
    out.push(
      entry({
        id: `wear:WEAR_SOURCES:${w.id}`,
        system: "wear",
        source: { catalog: "WEAR_SOURCES", key: w.id },
        claim: `${w.slot} wears by ${w.by}, ${w.event}${use ? " (use stops at the use floor)" : " (battle can go below the floor, never breaks)"}`,
        direction: "down",
        magnitude: (c) => -(c.WEAR_SOURCES.find((x) => x.id === w.id)?.raw ?? 0),
        ...(use
          ? {
              probe: `wear:use:${w.id}` as ProbeId,
              contexts: WEAR_USE_CONTEXTS[w.id] ?? [],
              base: () => wearSlotFixture(w.slot),
              off: (s: GameState) => ({ ...s, equipment: s.equipment.filter((e) => e.id !== wearPieceIdFor(w.slot)) }),
              tolerance: 1,
              ...(WEAR_USE_OUT_OF_SCOPE[w.id] ? { outOfScope: WEAR_USE_OUT_OF_SCOPE[w.id] } : {}),
              note: "per unit of the event (a haul, 10 ly, a minute, a scan, a fight, a step); a run dispatched before step 3 carries no stamp and wears nothing",
            }
          : {
              // Step 4: LIVE. The probe fights one battle through the live engine on a TOUGHNESS_REFERENCE piece and
              // reads what it took per unit of the battle's measure (raw per-mille); off = the fixture without the piece.
              probe: `wear:battle:${w.id}` as ProbeId,
              contexts: WEAR_BATTLE_CONTEXTS[w.id] ?? [],
              base: () => (w.slot === "memberArmor" ? wearSlotFixture("memberArmor") : battleFixture()),
              on: (s: GameState) => s,
              off: (s: GameState) => (w.slot === "memberArmor" ? { ...s, equipment: s.equipment.filter((e) => e.id !== wearPieceIdFor("memberArmor")) } : withoutSlotPieces(s, w.slot)),
              tolerance: WEAR_BATTLE_TOLERANCE,
              note: "per unit of what one battle took (the pool lost over its ceiling, the shields absorbed, the hull or hp lost, the drones lost); a patrol cycle or run dispatched before step 4, or the training run, carries no stamp and wears nothing",
            }),
      }),
    );
  }
  // One entry per repair context: WEAR_REPAIR_MINUTES there from a known worn condition raises it by rate x minutes
  // (the engine's pass, gearWearEngine.ts resolveGearWear; integer rates, so exact).
  const REPAIR_FIXTURE: Readonly<Record<keyof typeof REPAIR_RATES, { context: ContextId; base: () => GameState; offRun: boolean; home?: boolean; note: string }>> = {
    home: { context: "fleet", base: () => wornCargoFixture(), offRun: false, note: "ship-1 docked, on no run" },
    shipyardBay: { context: "shipyard", base: () => inShipyardBay(wornCargoFixture()), offRun: false, note: "ship-1 in a Shipyard repair bay (its hull repair process)" },
    fieldRepair: { context: "expedition:groundOps", base: () => onFieldRepairLeg(wornCargoFixture()), offRun: false, home: true, note: "ship-1 set down on a GO-8b field repair leg for the whole span, settled as the run comes home (in event order with its wear)" },
    underway: { context: "fleet", base: () => onMission(wornCargoFixture(), "shortOreRun", "transitOut"), offRun: true, note: "a run's upkeep, settled as the run comes home (a piece underway settles only at its run's events)" },
  };
  for (const ctx of Object.keys(REPAIR_RATES) as (keyof typeof REPAIR_RATES)[]) {
    const f = REPAIR_FIXTURE[ctx];
    out.push(
      entry({
        id: `wear:REPAIR_RATES:${ctx}`,
        system: "wear",
        source: { catalog: "REPAIR_RATES", key: ctx },
        claim: `Gear recovers on its own, free, at ${REPAIR_RATES[ctx]} per-mille a minute (${ctx})`,
        probe: "wear:condition" as ProbeId,
        contexts: [f.context],
        direction: "up",
        magnitude: (c) => c.REPAIR_RATES[ctx] * WEAR_REPAIR_MINUTES,
        base: f.base,
        on: (s) => (f.home ? fieldRepairHome(s) : wearRepairMinutes(s, f.offRun)),
        note: f.note,
      }),
    );
  }
  // The two hull repair bonuses lift every gear repair rate too (no new sources): the repair a docked piece gets in
  // WEAR_REPAIR_MINUTES grows by (1 + the officers' repair speed) and by 1 / (1 - the Damage Control Suite's time cut).
  const homeGain = (s: GameState) => wearRepairMinutes(s, false);
  const dcPoints = WEAR_LINE;
  out.push(
    entry({
      id: "wear:REPAIR_RATE_BONUSES:officerRepairSpeed",
      system: "wear",
      source: { catalog: "REPAIR_RATE_BONUSES", key: "officerRepairSpeed" },
      claim: "The officerRepairSpeed hull repair bonus also speeds every gear repair rate",
      probe: "wear:repairGain" as ProbeId,
      contexts: ["fleet"],
      curve: { kind: "linearRelative" },
      magnitude: (c) => c.SENIOR_STAFF_BONUSES.find((b) => b.id === "med.recovery")?.magnitude ?? 0,
      base: () => wornCargoFixture(),
      on: (s) => homeGain(seatOfficer(s, "medical", ["med.recovery"])),
      off: homeGain,
      tolerance: 1,
      note: "Rapid Recovery seated; the hull repair's whole speed bonus (officers, crew and captain) lifts the rate",
    }),
    entry({
      id: "wear:REPAIR_RATE_BONUSES:damageControlRepairTime",
      system: "wear",
      source: { catalog: "REPAIR_RATE_BONUSES", key: "damageControlRepairTime" },
      claim: "The damageControlRepairTime hull repair bonus also speeds every gear repair rate",
      probe: "wear:repairGain" as ProbeId,
      contexts: ["fleet"],
      curve: { kind: "linearRelative" },
      magnitude: () => {
        const r = plusToPercent(dcPoints, DC_REPAIR_SPEED_B, DC_REPAIR_SPEED_R);
        return r / (1 - r);
      },
      base: () => wornCargoFixture(),
      on: (s) => homeGain(installPiece(s, { slotType: "specUtility", moduleVariant: "damageControlSuite", implicitStats: { repairSpeed: dcPoints } })),
      off: homeGain,
      tolerance: 1,
      note: "a Damage Control Suite installed: the rate divides by (1 - its repair time cut)",
    }),
  );
  // One entry per efficiency consumer: the piece at the use floor reads its own lines at efficiency(floor) where a run
  // reads them (the run sheet, gearWearEngine.ts runShipStats, at the mission contexts; the dispatch snapshot at
  // expedition:groundOps). off = the same piece pristine.
  const e = WEAR_FLOOR_EFFICIENCY;
  const transitPercent = (p: number) => plusToPercent(p / PERCENT_STAT_CURVES.transitSpeedMult.plusDivisor, PERCENT_STAT_CURVES.transitSpeedMult.B, PERCENT_STAT_CURVES.transitSpeedMult.r);
  const quarters = QUARTERS_MODULES.find((q) => q.kind === "general" && q.focusBoost > 0)!;
  const bridgeAmp = (c: Catalogs) => (c.BRIDGE_MODULES.find((b) => b.id === "bridgeBalancedCommand")?.amp ?? 0) * moduleEffectScale("standard", 0, "none");
  const quartersBoost = (c: Catalogs) => (c.QUARTERS_MODULES.find((q) => q.id === quarters.id)?.focusBoost ?? 0) * moduleEffectScale("standard", 0, "none");
  const memberLine = (slot: string, line: string, stat: keyof typeof GEAR_POINT_BUMP) => ({
    contexts: ["expedition:groundOps"] as ContextId[],
    base: () => wearSlotFixture(slot, { [line]: WEAR_LINE }),
    magnitude: (c: Catalogs) => WEAR_LINE * c.GEAR_POINT_BUMP[stat] * (e() - 1),
  });
  const CONSUMERS: Readonly<Record<string, Partial<WiringEntry> | WiringStatus>> = {
    "cargoBay:cargoCapacity": { contexts: WEAR_MISSION_CONTEXTS, base: () => wearSlotFixture("cargoBay", { cargoCapacity: WEAR_LINE }), magnitude: () => WEAR_LINE * (e() - 1) },
    "ftlDrive:transitSpeed": {
      contexts: WEAR_RUN_CONTEXTS,
      curve: { kind: "linearRelative" },
      base: () => wearSlotFixture("ftlDrive", { transitSpeedMult: WEAR_LINE }),
      magnitude: () => (1 + transitPercent(WEAR_LINE * e())) / (1 + transitPercent(WEAR_LINE)) - 1,
    },
    // Engine efficiency's only reader inside a run is a captain mission's fuel price per cycle, unreachable since
    // 0.13.6 (an infinite fuel budget: facility:audit:fuelAutoBuy); reach reads the pristine drive (design 4.3).
    "ftlDrive:engineEfficiency": pending("S4-A02 (the fuel-economy cleanup: a run's fuel price is engine efficiency's only run-time reader, unreachable since 0.13.6; reach reads the pristine drive, design 4.3)"),
    // The reactor's power output is read by the install gate (pristine), the combat power budget, where combat's own
    // model is the authority (W3), and since E-MOD EM-4 the reactor surplus drive lift, which reads it pristine too
    // ([PROVISIONAL], an open call for the user: reactorSurplus.ts).
    "reactorCore:powerOutput": pending(EM4_WORN_OUTPUT_CALL),
    "specUtility:lines": {
      // Gear wear step 4: and a Damage Control Suite's lines (the Shipyard repair speed, the patrol wave patch-up).
      contexts: ["mission:survey", "mission:shortRange", "expedition:groundOps", "shipyard", "patrol"],
      base: () => wearSlotFixture("specUtility", { sensors: WEAR_LINE }, "pathfinderSuite"),
      magnitude: () => WEAR_LINE * (e() - 1),
      note: "a Pathfinder Suite's sensors line (the survey yield, the short-range scan, the expedition's sensor power), and at the Shipyard and on a patrol the same piece as a Damage Control Suite (its repair speed line as the repair reads it, its wave patch-up line as the cycle's frozen gear holds it); every line scales the same way",
    },
    "sensor:lines": { contexts: ["mission:survey", "mission:shortRange", "expedition:groundOps"], base: () => wearSlotFixture("sensor", { sensors: WEAR_LINE }), magnitude: () => WEAR_LINE * (e() - 1) },
    "bridge:crewEfficiency": {
      contexts: WEAR_MISSION_CONTEXTS,
      curve: { kind: "bonusRelative", base: SHIP_TYPES.generalFreighter.cargoCapacity },
      base: () => installPiece(seatOfficer(wiringBase(), "operations", ["ops.cargoExpand"]), { slotType: "bridge", moduleVariant: "bridgeBalancedCommand", durabilityMax: TOUGHNESS_REFERENCE }),
      magnitude: (c) => (1 + bridgeAmp(c) * e()) / (1 + bridgeAmp(c)) - 1,
      note: "an Operations officer's Cargo Optimization through a Balanced Command bridge",
    },
    "quarters:crewEfficiency": {
      contexts: WEAR_MISSION_CONTEXTS,
      curve: { kind: "bonusRelative", base: 1 },
      base: () => installPiece(withBuckets(wiringBase(), [bucketOf("operations", "ops.unloadSpeed")]), { slotType: "quarters", moduleVariant: quarters.id, durabilityMax: TOUGHNESS_REFERENCE }),
      magnitude: (c) => (1 + quartersBoost(c) * e()) / (1 + quartersBoost(c)) - 1,
      note: `an Operations complement's Efficient Unloading through ${quarters.label} quarters`,
    },
    "memberArmor:groundLines": { ...memberLine("memberArmor", "groundArmor", "armor"), note: "armor wears by battle (step 4); its efficiency acts on the dispatch snapshot now" },
    "memberWeapon:groundLines": memberLine("memberWeapon", "groundPower", "power"),
    "memberTool:fieldworkLines": memberLine("memberTool", "groundFieldwork", "fieldwork"),
    "implant:groundLines": memberLine("implant", "groundHp", "hp"),
    // Gear wear step 4 (the combat consumers, design 4.2 and 4.4): the piece at the use floor in a dispatched patrol
    // cycle's frozen gear (gearWear.ts combatGearView): the cycle's shield and hull pools, its squadron's drone hp,
    // and a Structural Bracing module's hull lift. The same view folds the Ground Ops ship battles.
    "shieldEmitters:shields": {
      contexts: ["patrol"],
      curve: { kind: "linearRelative" },
      base: () => combatConsumerFixture("shieldEmitters", { implicitStats: { shieldCapacity: SI_EMITTER_CAP, shieldRecharge: SI_EMITTER_RECHARGE } }),
      magnitude: () => e() - 1,
      tolerance: 1,
      note: "a Standard-Issue emitter's capacity on a carrier, the cycle's frozen shield pool (recharge scales the same way)",
    },
    "hullPlating:hullPoints": {
      contexts: ["patrol"],
      base: () => combatConsumerFixture("hullPlating", { implicitStats: { hullStrength: SI_PLATING_HP } }),
      magnitude: () => SI_PLATING_HP * (e() - 1),
      tolerance: 1,
      note: "a Standard-Issue plating's own hull points (the bare frame is the hull's, never worn), the cycle's frozen hull pool",
    },
    "droneBay:drones": {
      contexts: ["patrol"],
      curve: { kind: "linearRelative" },
      base: () => combatConsumerFixture("droneBay", { droneRole: "attack" }),
      magnitude: () => e() - 1,
      tolerance: 1,
      note: "an Attack pod's squadron as the cycle seeds it: each drone's hp (its volley yield scales the same way)",
    },
    "module:effect": {
      contexts: ["patrol"],
      curve: { kind: "bonusRelative", base: SHIP_TYPES.carrier.hullIntegrity },
      base: () => combatConsumerFixture("module", { moduleVariant: "structuralBracing" }),
      magnitude: () => e() - 1,
      tolerance: 1,
      note: "a Structural Bracing module's hull lift on a Standard-Issue carrier, the cycle's frozen hull pool (every module effect scales the same way)",
    },
  };
  for (const c of WEAR_EFFICIENCY) {
    const spec = CONSUMERS[c.id];
    const isStatus = spec !== undefined && "kind" in spec;
    out.push(
      entry({
        id: `wear:WEAR_EFFICIENCY:${c.id}`,
        system: "wear",
        source: { catalog: "WEAR_EFFICIENCY", key: c.id },
        claim: `A worn ${c.slot} piece scales its ${c.reads} on the gentle wear curve (never below 75%)`,
        direction: "down",
        curve: { kind: "linearAbsolute" },
        magnitude: () => wearEfficiency(USE_WEAR_FLOOR) - 1,
        ...(spec === undefined
          ? { status: pending(GEAR_WEAR_STEP_3) }
          : isStatus
            ? { status: spec as WiringStatus }
            : {
                probe: `wear:eff:${c.id}` as ProbeId,
                on: (s: GameState) => withFixtureCondition(s, c.slot, USE_WEAR_FLOOR),
                ...(spec as Partial<WiringEntry>),
              }),
      }),
    );
  }
  return out;
}

export const WIRING_REGISTRY: readonly WiringEntry[] = build();

const BY_ID = new Map(WIRING_REGISTRY.map((e) => [e.id, e] as const));

export function wiringEntry(id: string): WiringEntry | undefined {
  return BY_ID.get(id);
}

// Is the entry LIVE in full (every claimed context moves)?
export function isFullyLive(e: WiringEntry): boolean {
  return e.status.kind === "live";
}

// The entries a release blocks on: every pending entry (deferred and held entries carry the user's reference).
export function releaseBlockers(): WiringEntry[] {
  return WIRING_REGISTRY.filter((e) => e.status.kind === "pending");
}


