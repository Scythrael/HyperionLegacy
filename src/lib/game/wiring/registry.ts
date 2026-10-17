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
  CAPTAIN_SPEC_BONUS,
  CAPTAIN_TALENTS,
  EQUIPMENT_SLOTS,
  EQUIPMENT_STORAGE_RUNGS,
  FACILITIES,
  HOMEWORLD_TALENTS,
  ITEMS,
  LIVE_STAT_KEYS,
  MASS_SPEED_DRAG,
  MEMBER_GROUND_STAT_KEYS,
  MEMBER_SLOT_TYPES,
  MISSIONS,
  PATROLS,
  PERCENT_STAT_CURVES,
  REFINE_RECIPES,
  SALVAGE_LOOT_POOLS,
  SECONDARY_CAPTAIN_TALENTS,
  SHIP_DOCKS_BASE,
  SHIP_DOCKS_RUNGS,
  SHIP_TYPES,
  SI_EMITTER_CAP,
  SI_EMITTER_RECHARGE,
  SI_PLATING_HP,
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
import { diminishing } from "../diminishing";
import { buyHomeworldTalent } from "../tick";
import { combatHullTypeOf, hullDefenseComposition } from "../combat/bridge";
import { SENIOR_STAFF_BONUSES, type SeniorStaffBonusDef } from "../seniorStaffBonuses";
import { CREW_PROFESSION_BUFFS, CREW_STAT_KEYS, HELD_CREW_BUFF_IDS, SECOND_LEVEL_EXCLUSIVE, type CrewBuffDef } from "../crewBuffs";
import { CREW_RACES } from "../crewRaces";
import { CREW_RARITY_MULTIPLIER } from "../crewRarity";
import { CREW_RANKS, CREW_RANK_ORDER, rankMagnitudeFactor } from "../crewRank";
import { GROUND_CONDITIONS, STONESKIN_INJURY_MULT } from "../medicalBay";
import { OFFICER_STAT_KEYS } from "../seniorStaff";
import { DEPARTMENT_OF_SEAT, OFFICER_STAT_NEUTRAL, XO_DEPARTMENT_SHARE, officerStatFacet } from "../officerStats";
import { OFFICER_BONUSES_PENDING_IN_RELEASE } from "../crewOverlay";
import { AWAY_TRAITS, type AwayTraitDef } from "../awayTraits";
import { FIRST_AID_TRAINED_EFFECTIVENESS, FIRST_AID_UNTRAINED_EFFECTIVENESS, GAMBIT_PRESETS, GAMBIT_STATUSES } from "../gambit";
import { applyMemberGambitPreset } from "../memberGambits";
import { GEAR_POINT_BUMP, GROUND_STAT_MEMBER_STAT, FIELDWORK_YIELD_PER_POINT, STATUS_RESIST_PER_POINT } from "../awayTeam";
import { FIELDWORK_SPEED_KNEE, FIELDWORK_SPEED_PER_BUMP, FIELDWORK_YIELD_KNEE } from "../fieldwork";
import {
  MUSEUM_COPY_LADDER,
  MUSEUM_PER_COPY_BONUS,
  MUSEUM_STATS,
  MUSEUM_TIER_LEVEL_BONUS,
  RELIC_SETS,
  RELICS,
  museumBonusesFromRecord,
  type MuseumStat,
} from "../relics";
import { BRIDGE_MODULES, QUARTERS_MODULES, moduleEffectScale } from "../crewModules";
import { SENSOR_ARRAYS } from "../sensorArrays";
import { RETIREMENT_EXP_PER } from "../captainRetirement";
import { POI_CATALOG, PLANET_TYPES } from "../expeditionContent";
import { WEAPON_DEFS } from "../combat/weapons";
import { ROLE_TEMPLATE } from "../combat/drones";
import { PIRATE_HULLS } from "../combat/enemyHulls";
import { STATUS_EFFECT_DEFS } from "../combat/statusEffects";
import { DC_REPAIR_SPEED_B, DC_REPAIR_SPEED_R, DC_WAVE_REGEN_B, DC_WAVE_REGEN_R, PF_HAZARD_RESIST_B, PF_HAZARD_RESIST_R, PF_SCAN_SPEED_B, PF_SCAN_SPEED_R } from "../utilityGear";
import { DRONE_POD_AFFIX_POOL, DRONE_POD_IMPLICIT_STAT, WEAPON_AFFIX_POOL, WEAPON_IMPLICIT_STAT } from "../itemgen";
import { AFFIX_DEFS, ESCALATION_ENEMIES_PER_LEVEL, HEIGHTENED_SENSES_KNEE, HEIGHTENED_SENSES_PER_LEVEL } from "../affixes";
import { ENEMY_RANKS, ENEMY_RANK_IDS } from "../enemyRanks";
import {
  CONDITION_LINES,
  CONDITION_LINE_IDS,
  FIELD_KITS,
  FIELD_KIT_IDS,
  FREE_BASIC_CURVE_KNEE,
  FREE_BASIC_SET,
  KIT_CATEGORY_RULES,
  type FieldKitDef,
  type FieldKitId,
  type KitCategory,
} from "../fieldKits";
import {
  WIRING_SCIENCE_ID,
  WIRING_SECURITY_ID,
  bucketOf,
  combatBase,
  editCaptain,
  editMember,
  identity,
  installPiece,
  seatOfficer,
  wearPiece,
  wiringBase,
  withAwayTeam,
  withBuckets,
  withFacilityLevel,
  withHomeworld,
  withMuseum,
  WIRING_BUCKET_COUNT,
  AFFIX_ALIGNED_HOOKS,
  AFFIX_HOOK_KEYS,
  GAMBIT_ACTIONS,
  GAMBIT_SELECTORS,
  sourceOn,
  type ContextId,
  type ProbeId,
  type Transform,
} from "./probes";

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
  | "salvage";

export const WIRING_SYSTEMS: readonly WiringSystem[] = ["captain", "fleetAdmiral", "facility", "ship", "crew", "away", "expedition", "relic", "mission", "salvage"];

export type WiringStatus =
  | { kind: "live" }
  // A 0.14.0 slice brings it live (the release gate blocks). `contexts`: for a PARTIAL source, the claimed contexts
  // that do not move yet (the entry's own `contexts` are the live ones); absent for a wholly inert source.
  | { kind: "pending"; owner: string; contexts?: readonly ContextId[] }
  // The user deferred it past 0.14.0 (capture 2026-10-15 section 3 T3 and the like).
  | { kind: "deferred"; owner: string; userRef: string; contexts?: readonly ContextId[] }
  | { kind: "held"; userRef: string }; // D14 Craft Duplicate only

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
  GAMBIT_STATUSES,
  MISSIONS,
  PATROLS,
  QUARTERS_MODULES,
  BRIDGE_MODULES,
  SENSOR_ARRAYS,
  RELIC_SETS,
  RELICS,
  WEAPON_DEFS,
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
const TASK_23 = "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)";
const E_MOD = "E-MOD power budget";
const FIELD_KITS_FEAR = "Field Kits 16b: enemies inflict Fear (D26)";
const SCIENCE_LINE_SWAP = "Science gear line swap (D26): Science gear rolls fieldwork/hazard/find lines instead";
const TASK_23_ALL_BUFFS = "Task 23: small boost to all complement buffs (D26)";
const CORTEX_RESIST = "Field Kits 16b: Fear (D26) + stun resist covers Concussion [proposal, pending user]";
const PILOT_CUNNING = "pending user decision (officerStats.ts CUNNING_PENDING_SEATS)";
// The user's T3 deferrals (capture 2026-10-15 section 3: "Move all five (Recommended)").
const T3 = "capture 2026-10-15 section 3 T3 (moved to 0.14.x)";

// ============================================================================
// crew: officer bonuses, complement buffs, racials, facets (the no-dead-stats ids)
// ============================================================================

const SEATS = Object.keys(DEPARTMENT_OF_SEAT) as SeniorStaffSeat[];

function seatFor(def: SeniorStaffBonusDef): SeniorStaffSeat {
  return def.seat === "any" ? "executive" : def.seat;
}

// What each officer statKey moves (probe, contexts, curve). Absent = pending (OFFICER_PENDING below).
const OFFICER_SEAMS: Readonly<Record<string, { probe: ProbeId; contexts: ContextId[]; curve: Curve }>> = {
  "officer.shipOutputMult": { probe: "missionOutputBonus", contexts: ["mission:extraction"], curve: { kind: "linearAbsolute" } },
  "officer.transitTimeCut": { probe: "sheetTransit", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  "officer.evasion": { probe: "officerEvasion", contexts: ["patrol", "expedition:groundOps"], curve: { kind: "linearAbsolute" } },
  "officer.unloadTimeCut": { probe: "sheetUnload", contexts: ["sheet", "expedition:groundOps"], curve: { kind: "linearRelative" } },
  "officer.effectiveCargoMult": { probe: "sheetCargo", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  "officer.extractionYieldMult": { probe: "sheetYield", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  "officer.rareFindMult": { probe: "rareFind", contexts: ["expedition:groundOps", "mission:survey"], curve: { kind: "linearAbsolute" } },
  "officer.weaponEffectivenessMult": { probe: "officerWeapons", contexts: ["patrol"], curve: { kind: "linearAbsolute" } },
  "officer.shieldEffectivenessMult": { probe: "officerShields", contexts: ["patrol"], curve: { kind: "linearAbsolute" } },
  "officer.crewLossPrevention": { probe: "expSquadTriage", contexts: ["ground"], curve: { kind: "linearAbsolute" } },
  "officer.repairRateMult": { probe: "officerRepairBonus", contexts: ["shipyard", "medbay"], curve: { kind: "linearAbsolute" } },
  "officer.rangeMult": { probe: "sheetEngineEff", contexts: ["sheet"], curve: { kind: "linearAbsolute" } },
  "officer.allStatsMult": { probe: "sheetCargo", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  "officer.missionTurnaroundCut": { probe: "turnaround", contexts: ["sheet", "shipyard"], curve: { kind: "linearRelative" } },
};

const OFFICER_PENDING: Readonly<Record<string, string>> = {
  ...OFFICER_BONUSES_PENDING_IN_RELEASE,
  "officer.crewRetention": FIELD_KITS_FEAR,
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
        magnitude: (c) => c.SENIOR_STAFF_BONUSES.find((d) => d.id === def.id)!.magnitude,
        on: (s) => seatOfficer(s, seat, [def.id]),
        off: (s) => seatOfficer(s, seat, []),
        base: def.statKey.startsWith("officer.weapon") || def.statKey.startsWith("officer.shield") ? () => combatBase() : () => wiringBase(),
        status: owner ? pending(owner) : LIVE,
      }),
    );
  }
  // Inspiring Leader's combat half (its sheet half is the entry above): one more context on its own id.
  return out;
}

// What each crew.* key moves when a complement carries it. Absent = no consumer (pending, below).
const CREW_SEAMS: Readonly<Record<string, { probe: ProbeId; contexts: ContextId[]; curve: Curve; tolerance?: number }>> = {
  [CREW_STAT_KEYS.unloadSpeed]: { probe: "sheetUnload", contexts: ["sheet", "expedition:groundOps"], curve: { kind: "linearRelative" } },
  [CREW_STAT_KEYS.loadSpeed]: { probe: "expReloadMult", contexts: ["expedition:groundOps"], curve: { kind: "linearAbsolute" } },
  [CREW_STAT_KEYS.effectiveCargo]: { probe: "sheetCargo", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  [CREW_STAT_KEYS.transitOutSpeed]: { probe: "sheetTransit", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  [CREW_STAT_KEYS.transitBackSpeed]: { probe: "sheetTransit", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  [CREW_STAT_KEYS.rangeEfficiency]: { probe: "sheetEngineEff", contexts: ["sheet"], curve: { kind: "linearAbsolute" } },
  [CREW_STAT_KEYS.boardingDefense]: { probe: "expBoardingDefense", contexts: ["shipEvent"], curve: { kind: "linearAbsolute" } },
  [CREW_STAT_KEYS.extractionYield]: { probe: "sheetYield", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  [CREW_STAT_KEYS.rareFindChance]: { probe: "rareFind", contexts: ["expedition:groundOps", "mission:survey"], curve: { kind: "linearAbsolute" } },
  [CREW_STAT_KEYS.reducedCrewLosses]: { probe: "injuryCare", contexts: ["medbay"], curve: { kind: "linearAbsolute" } },
  [CREW_STAT_KEYS.fuelEfficiency]: { probe: "sheetEngineEff", contexts: ["sheet"], curve: { kind: "linearAbsolute" } },
};

// The claimed consumer of each dead crew.* key, read so a pending key that starts moving fails until it is flipped:
// the probe, the claimed context, and a fixture that HAS the system the key would act on (WR-1 review: an away team
// for the squad keys, a medic for Triage, a carrier with drones for Deck Handling, a powered piece for Power
// Discipline), so the flat check is real.
interface DeadKeySeam {
  probe: ProbeId;
  context: ContextId;
  base?: () => GameState;
}
const POWERED_PIECE_DRAW = 20; // a piece drawing real power, so a power-draw cut would show
const withMedic: Transform = (s) => editMember(s, WIRING_SECURITY_ID, { traits: ["fieldMedic"] });
const CREW_PENDING_PROBES: Readonly<Record<string, DeadKeySeam>> = {
  [CREW_STAT_KEYS.hullRepairRate]: { probe: "repairTicks", context: "shipyard" },
  [CREW_STAT_KEYS.surveyAptitude]: { probe: "expScanRate", context: "expedition:groundOps" },
  [CREW_STAT_KEYS.awayTeamProtection]: { probe: "runSecHp", context: "ground", base: () => withAwayTeam(wiringBase()) },
  [CREW_STAT_KEYS.droneHandling]: { probe: "combatDroneHp", context: "patrol", base: () => combatBase("carrier") },
  [CREW_STAT_KEYS.triage]: { probe: "runSecHeal", context: "ground", base: () => withMedic(withAwayTeam(wiringBase())) },
  [CREW_STAT_KEYS.missionTurnaround]: { probe: "missionUnloadTicks", context: "mission:extraction" },
  [CREW_STAT_KEYS.powerEfficiency]: {
    probe: "sheetPowerDraw",
    context: "sheet",
    base: () => installPiece(wiringBase(), { slotType: "cargoBay", powerDraw: POWERED_PIECE_DRAW }),
  },
  [CREW_STAT_KEYS.crewOutputMult]: { probe: "missionCycleOutput", context: "mission:extraction" },
  [CREW_STAT_KEYS.preventCrewLoss]: { probe: "injuryCare", context: "medbay" },
};

const CREW_PENDING: Readonly<Record<string, string>> = {
  [CREW_STAT_KEYS.powerEfficiency]: E_MOD,
  [CREW_STAT_KEYS.droneHandling]: TASK_23,
  [CREW_STAT_KEYS.hullRepairRate]: TASK_23,
  [CREW_STAT_KEYS.counterInfiltration]: TASK_23,
  [CREW_STAT_KEYS.awayTeamProtection]: TASK_23,
  [CREW_STAT_KEYS.surveyAptitude]: TASK_23,
  [CREW_STAT_KEYS.triage]: TASK_23,
  [CREW_STAT_KEYS.crewOutputMult]: TASK_23,
  [CREW_STAT_KEYS.missionTurnaround]: TASK_23,
  [CREW_STAT_KEYS.preventCrewLoss]: TASK_23,
  [CREW_STAT_KEYS.crewEffectiveness]: TASK_23_ALL_BUFFS,
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
      // One standard Crewman per head: the buff's catalog magnitude x the bucket's head count.
      magnitude: () => def.magnitude * WIRING_BUCKET_COUNT,
      on: (s) => withBuckets(s, [bucketOf(profession, def.id)]),
      off: (s) => withBuckets(s, [bucketOf(profession, "wiring.none")]),
      ...(dead?.base ? { base: dead.base } : {}),
      status: held
        ? { kind: "held", userRef: "D14 (design 2026-10-02): Craft Duplicate is held for homeworld staffing" }
        : owner
          ? pending(owner, dead ? [dead.context] : undefined)
          : LIVE,
    });
  });
}

const RACIAL_PENDING: Readonly<Partial<Record<CrewRace, WiringStatus>>> = {
  martian: pending(E_MOD),
  belter: pending(TASK_23),
  outerColony: pending(TASK_23),
  vael: pending(TASK_23),
  stheni: pending(TASK_23),
  earthBorn: pending(TASK_23_ALL_BUFFS),
  spacer: { kind: "deferred", owner: "Task 23: complement long-haul ramp (D26)", userRef: `${T3}: the Spacer long-haul ramp` },
};

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
      magnitude: (c) => c.CREW_RACES[race].racialBonus.seniorStaff,
      on: (s) => seatOfficer(s, "executive", [], { race }),
      off: identity,
      ...(dead?.base ? { base: dead.base } : {}),
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

const GEAR_PENDING: Readonly<Record<string, string>> = {
  "gear:science:sidearm:groundPower": SCIENCE_LINE_SWAP,
  "gear:science:sidearm:groundAccuracy": SCIENCE_LINE_SWAP,
  "gear:science:sidearm:groundStatusChance": SCIENCE_LINE_SWAP,
  "gear:science:fieldSuit:groundArmor": SCIENCE_LINE_SWAP,
  "gear:science:fieldSuit:groundHp": SCIENCE_LINE_SWAP,
  "gear:science:hazardSuit:groundArmor": SCIENCE_LINE_SWAP,
  "gear:science:hazardSuit:groundHp": SCIENCE_LINE_SWAP,
  "gear:security:cortexShield:groundStatusResist": CORTEX_RESIST,
};

function wearerOf(team: AwayTeamType): string {
  return team === "science" ? WIRING_SCIENCE_ID : WIRING_SECURITY_ID;
}

// The seam a member line moves, by squad and key.
function gearSeam(team: AwayTeamType, key: MemberGroundStatKey): { probe: ProbeId; curve: Curve; magnitude: (c: Catalogs) => number; context: ContextId; tolerance?: number } | null {
  const N = GEAR_TEST_POINTS;
  const bump = (c: Catalogs, k: MemberGroundStatKey) => N * c.GEAR_POINT_BUMP[GROUND_STAT_MEMBER_STAT[k]!];
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
        return { probe: "secPoisonResist", curve: { kind: "chanceAbsolute" }, magnitude: () => N * STATUS_RESIST_PER_POINT * 1000, context: "ground", tolerance: 1 };
      case "groundHazardResist":
        return { probe: "secTaskHazardResist", curve: { kind: "linearAbsolute" }, magnitude: (c) => bump(c, key), context: "fieldwork" };
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
        return { probe: "fieldYieldOrganics", curve: { kind: "diminishing", knee: FIELDWORK_YIELD_KNEE, base: 1 }, magnitude: () => N * FIELDWORK_YIELD_PER_POINT, context: "fieldwork" };
      case "groundVaultYield":
        return { probe: "fieldYieldVault", curve: { kind: "diminishing", knee: FIELDWORK_YIELD_KNEE, base: 1 }, magnitude: () => N * FIELDWORK_YIELD_PER_POINT, context: "fieldwork" };
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
          const owner = GEAR_PENDING[id];
          const seam = gearSeam(team, key);
          const wearer = wearerOf(team);
          const pair = key === "groundStatusChance" && team === "security" && !inflicts(slotType, v.key) && slotType !== "memberTool";
          const withPair: Transform = pair ? (s) => wearPiece(s, wearer, "memberTool", "stunGrenade", {}) : identity;
          // groundStatusResist only acts on the statuses a resistStatus piece lists: measured on Toxin Filters (poison).
          const resistOk = key !== "groundStatusResist" || v.key === "toxinFilters";
          const live = !owner && seam !== null && resistOk;
          out.push(
            entry({
              id,
              system: "away",
              source: { catalog: "EQUIPMENT_SLOTS.member", key: `${slotType}:${v.key}:${team}:${key}` },
              claim: `${v.label} (${slotType}) ${key} on ${team}`,
              liveness: true,
              probe: owner === CORTEX_RESIST ? undefined : seam?.probe,
              contexts: live ? [seam!.context] : [],
              curve: seam?.curve ?? { kind: "linearAbsolute" },
              magnitude: seam?.magnitude ?? (() => 0),
              tolerance: seam?.tolerance,
              base: () => withAwayTeam(wiringBase()),
              on: (s) => withPair(wearPiece(s, wearer, slotType, v.key, { [key]: GEAR_TEST_POINTS })),
              off: (s) => withPair(wearPiece(s, wearer, slotType, v.key, {})),
              status: owner
                ? pending(owner, owner === SCIENCE_LINE_SWAP ? ["ground"] : undefined)
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

function traitEntry(t: AwayTraitDef): WiringEntry {
  const e = t.effects[0];
  const team = t.teamTypes[0];
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
      return entry({ ...common, status: pending(FIELD_KITS_FEAR), note: "the resist is computed, but nothing inflicts the status on the squad" });
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
    fx("resistStatus", "Toxin Filters: resist poison (Cortex Shield: stun and fear, pending Field Kits)", {
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
      default:
        return entry({ ...common, status: pending(key === "tacticianHub" ? "WR-6, OC-A40" : "WR-6, OC-A41"), note: "\"No bonus yet\" gateway hub" });
    }
  });
}

function captainSpecEntries(): WiringEntry[] {
  const branches = [...new Set(Object.values(CAPTAIN_TALENTS).map((d) => d.branch))] as CaptainTalentBranch[];
  return branches.map((branch) => {
    const eff = CAPTAIN_SPEC_BONUS[branch];
    return entry({
      id: `captain:CAPTAIN_SPEC_BONUS:${branch}`,
      system: "captain",
      source: { catalog: "CAPTAIN_SPEC_BONUS", key: branch },
      claim: `${branch} specialization bonus`,
      probe: eff ? "bonusRollTrigger" : undefined,
      contexts: eff ? ["mission:extraction"] : [],
      curve: { kind: "chanceAbsolute" },
      magnitude: (c) => {
        const e = c.CAPTAIN_SPEC_BONUS[branch];
        return e && "chance" in e ? e.chance : 0;
      },
      on: (s) => editCaptain(s, { spec: branch }),
      status: eff ? LIVE : pending("WR-6, OC-A42"),
    });
  });
}

// The pending owner of each secondary node (plan section 5.A: WR-5a prospector, WR-5b tactician, WR-5c explorer),
// with the claimed value's probe where one already exists (it must not move until the slice wires it).
const SECONDARY_PROBES: Partial<Record<SecondaryTalentKey, ProbeId>> = {
  extraction1: "sheetYield",
  extraction3: "missionExtractionTicks",
  logistics1: "sheetCargo",
  logistics2: "sheetEngineEff",
  logistics3: "sheetUnload",
  gunnery1: "officerWeapons",
  aegis1: "officerShields",
  aegis3: "repairTicks",
  aegis4: "officerEvasion",
  surveySensors1: "sheetSensors",
  surveySensors2: "expScanRate",
  expeditionRelics2: "expActivityRelicFind",
  commandCrew2: "missionCycleOutput",
};

function secondaryEntries(): WiringEntry[] {
  return (Object.keys(SECONDARY_CAPTAIN_TALENTS) as SecondaryTalentKey[]).map((key) => {
    const def = SECONDARY_CAPTAIN_TALENTS[key];
    const owner = def.tree === "prospector" ? "WR-5a" : def.tree === "tactician" ? "WR-5b" : "WR-5c";
    const on: Transform = (s) => editCaptain(s, { unlockedSecondaryTalents: [...s.captains[0].unlockedSecondaryTalents, key] });
    const common = { id: `captain:SECONDARY_CAPTAIN_TALENTS:${key}`, system: "captain" as const, source: { catalog: "SECONDARY_CAPTAIN_TALENTS", key }, claim: `${def.label}: ${def.flavor}`, on };
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
    const probe = SECONDARY_PROBES[key];
    // OC-A1: a relative multiplier on the NAMED existing value of the captain's own ship. The combat nodes are read
    // with a Tactical officer's weapon and shield bonuses seated on a combat hull, so a multiplier on them shows.
    const combatNode = key === "gunnery1" || key === "aegis1";
    return entry({
      ...common,
      probe,
      ...(combatNode ? { base: () => seatOfficer(combatBase(), "tactical", ["tac.weaponCommand", "tac.shieldCommand"]) } : {}),
      status: pending(`${owner} (section 5.A ${key})`, probe ? [homeContextOf(probe)] : undefined),
    });
  });
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
    entry({
      id: "captain:progression:race",
      system: "captain",
      source: { catalog: "CAPTAIN_PROGRESSION", key: "race" },
      claim: "Captain race (\"racial bonus is a follow-on\")",
      status: pending("WR-6, OC-A43"),
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
            contexts: ["salvage"],
            magnitude: field("yieldBonus"),
            status: pending("WR-6, OC-B1 (hull teardown: salvageShip skips the bonus; B16 wording)", ["salvage:teardown"]),
            note: "recycle LIVE (salvage.ts:439); hull teardown not (salvage.ts:913)",
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
      default:
        out.push(
          entry({
            ...common,
            status: pending(key === "industryHub" ? "WR-6, OC-B2 (its text says No bonus yet; it gates Refinery rungs 3 and 4)" : "WR-6, OC-B3"),
            note: "\"No bonus yet\" placeholder hub",
          }),
        );
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
      else if ("telescope" in eff) {
        const t = eff.telescope as { detail: number; reachTier: number };
        const prev = i > 0 ? ((fdef.upgrades[i - 1].effect as unknown as { telescope: { detail: number; reachTier: number } }).telescope) : { detail: 0, reachTier: 0 };
        const detailMoves = t.detail !== prev.detail;
        out.push(
          entry({
            ...common,
            probe: detailMoves ? "telescopeDetail" : undefined,
            contexts: detailMoves ? ["expedition:groundOps"] : [],
            magnitude: () => t.detail - prev.detail,
            status: detailMoves ? LIVE : pending("G2-2 (reach tiers 2 to 7: every candidate is Tier I)"),
            note: "detail is information only (by design); the reach tier waits for G2-2",
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
  // The reach is information on the card today; the candidate pool stays Tier I until G2-2 (the PARTIAL check
  // reads the highest tier the candidates offer).
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
        contexts: ["facility"],
        direction: "none",
        curve: { kind: "equals" },
        magnitude: value("reachTier"),
        on: at,
        off: below,
        status: pending("G2-2 (every candidate is Tier I)", ["expedition:groundOps"]),
        flatChecks: { "expedition:groundOps": { probe: "candidateTopTier" } },
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
  repairSpeed: { slotType: "specUtility", moduleVariant: "damageControlSuite" },
  waveHullRegen: { slotType: "specUtility", moduleVariant: "damageControlSuite" },
  expeditionScanSpeed: { slotType: "specUtility", moduleVariant: "pathfinderSuite" },
  hazardResist: { slotType: "specUtility", moduleVariant: "pathfinderSuite" },
  weaponYield: { slotType: "weapon" },
  weaponAccuracy: { slotType: "weapon" },
  droneHp: { slotType: "droneBay" },
  droneAccuracy: { slotType: "droneBay" },
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
  transitSpeedMult: { probe: "sheetTransit", contexts: ["sheet"], curve: { kind: "linearRelative" }, magnitude: () => percent("transitSpeedMult") },
  engineEfficiency: { probe: "sheetEngineEff", contexts: ["sheet"], curve: { kind: "linearAbsolute" }, magnitude: () => percent("engineEfficiency") },
  extractionYieldMult: { probe: "sheetYield", contexts: ["sheet"], curve: { kind: "linearRelative" }, magnitude: () => percent("extractionYieldMult") },
  massReduction: null, // consumed at mint (itemgen.ts:425): measured below as its own entry on the piece's mass
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
};

const LINE_PENDING: Readonly<Record<string, { owner: string; probe?: ProbeId; contexts?: ContextId[] }>> = {
  powerOutput: { owner: "E-MOD + WR-7, OC-D1 (display only; promises a power budget)" },
  powerDrawReduction: { owner: "E-MOD + WR-7, OC-D1 (display only; promises a power budget)" },
  materialQualityChance: { owner: "WR-7, OC-D2 (rolls on every Prospecting Rig, read by nothing)", probe: "missionOreQuality", contexts: ["mission:extraction"] },
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
    if (p) return entry({ ...common, probe: p.probe, status: pending(p.owner, p.contexts) });
    if (!seam) return entry({ ...common, status: pending("WR-1 follow-up: no seam probe for this ship line") });
    // The patrol checks fly a combat hull (a freighter cannot patrol, so its patrol reading would be vacuous).
    const patrolOnCombat: Partial<Record<ContextId, FlatCheck>> = { patrol: { base: () => combatBase() } };
    const partial: Readonly<Record<string, WiringStatus>> = {
      cargoCapacity: pending("WR-7, OC-D8 (expeditions and patrols do not read the hold)", ["expedition:groundOps", "patrol"]),
      transitSpeedMult: pending("G2-3 + WR-7, OC-D8 (patrol legs and expedition transit are fixed)", ["patrol", "expedition:groundOps"]),
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
  moduleSlots: "WR-7, OC-D4 (no reader; every hull has the same slot set)",
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
      out.push(
        hullEntry(hull, field, {
          probe: HULL_FIELD_PROBES[field],
          contexts: ["sheet"],
          magnitude: (c) => c.SHIP_TYPES[hull][field],
          base: () => {
            // A bare hull: no installed gear, so the sheet is the hull's own number.
            const s = wiringBase(hull);
            return { ...s, equipment: s.equipment.filter((e) => e.fittedToShipId !== "ship-1") };
          },
          status:
            field === "cargoCapacity"
              ? pending("WR-7, OC-D8 (missions only)", combat ? ["expedition:groundOps", "patrol"] : ["expedition:groundOps"])
              : field === "transitSpeedMult"
                ? pending("G2-3 + WR-7, OC-D8 (missions only)", combat ? ["expedition:groundOps", "patrol"] : ["expedition:groundOps"])
                : field === "fuelCapacity" || field === "engineEfficiency"
                  ? pending("G2-4 (no expedition reach gate)", ["expedition:groundOps"])
                  : LIVE,
          // A hull field reaches a run or a patrol only through the sheet stat it seeds: the flat checks raise that
          // same stat with a gear line on the hull (patrols fly the hull with its combat baseline installed).
          ...(field === "extractionYieldMult"
            ? {}
            : {
                flatChecks: {
                  "expedition:groundOps": { on: shipPiece(field, LINE_POINTS), off: identity },
                  ...(combat && (field === "cargoCapacity" || field === "transitSpeedMult")
                    ? { patrol: { base: () => combatBase(hull), on: shipPiece(field, LINE_POINTS), off: identity } }
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
    );
    for (const field of Object.keys(HULL_FIELD_PENDING)) {
      out.push(hullEntry(hull, field, { status: pending(HULL_FIELD_PENDING[field]) }));
    }
  }
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
const DEAD_DIVISION_CONTEXTS: Readonly<Partial<Record<CrewProfession, ContextId[]>>> = {
  security: ["ground"], // counterInfiltration, awayTeamProtection
  engineering: ["shipyard"], // hullRepairRate, powerEfficiency
  science: ["expedition:groundOps"], // surveyAptitude
  medical: ["ground"], // crewEffectiveness, triage
  flightDeck: ["patrol"], // droneHandling
};

// A division wing's flat check: its division's complement carrying the division's dead key, read where the key
// claims to act (the dead key's own consumer and fixture). The wing amplifies nothing there until the key is live.
const DEAD_KEY_OF_DIVISION: Readonly<Partial<Record<CrewProfession, string>>> = {
  security: "sec.awayTeam",
  engineering: "eng.hullRepair",
  science: "sci.survey",
  medical: "med.triage",
  flightDeck: "flight.droneHandling",
};
function divisionWingChecks(division: CrewProfession): Partial<Record<ContextId, FlatCheck>> {
  const buffId = DEAD_KEY_OF_DIVISION[division];
  const def = buffId ? [...Object.values(CREW_PROFESSION_BUFFS).flat()].find((d) => d.id === buffId) : undefined;
  const dead = def ? CREW_PENDING_PROBES[def.statKey] : undefined;
  if (!def || !dead) return {};
  const fixture = dead.base ?? (() => wiringBase());
  return { [dead.context]: { probe: dead.probe, base: () => withBuckets(fixture(), [bucketOf(division, def.id)]) } };
}

function moduleEntries(): WiringEntry[] {
  const out: WiringEntry[] = [];
  const scale = moduleEffectScale("standard", 0);
  // Each module measured on an Operations complement bucket carrying Efficient Unloading (a live key), so the
  // module's division multiplier shows on the unload speed: the bonus part above 1 grows by the boost.
  const opsBase = () => withBuckets(wiringBase(), [bucketOf("operations", "ops.unloadSpeed")]);
  for (const def of QUARTERS_MODULES) {
    const boost = def.kind === "division" ? (def.division === "operations" ? def.focusBoost : def.offBoost) : def.focusBoost;
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
        status:
          def.kind === "division" && def.division !== "operations"
            ? pending(`CP-2, CP-3, CP-4, E-MOD (the ${def.division} division's dead keys; its live keys move)`, DEAD_DIVISION_CONTEXTS[def.division!] ?? ["ground"])
            : LIVE,
        ...(def.kind === "division" && def.division !== "operations" ? { flatChecks: divisionWingChecks(def.division!) } : {}),
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
          magnitude: (c) => (c.SENSOR_ARRAYS.find((a) => a.id === def.id)![field] as number) * (field === "landmarkOddsBias" || field === "undergroundPoiOddsBias" || field === "relicFindBonus" ? moduleEffectScale("standard", 0) : 1),
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
  transitSpeed: { probe: "sheetTransit", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  miningYield: { probe: "sheetYield", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  sensors: { probe: "sheetSensors", contexts: ["sheet"], curve: { kind: "linearRelative" }, base: () => installPiece(wiringBase(), { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } }) },
  extractionSpeed: { probe: "sheetExtractionSpeed", contexts: ["sheet"], curve: { kind: "linearRelative" } },
  crewBonuses: { probe: "sheetUnload", contexts: ["sheet"], curve: { kind: "bonusRelative", base: 1 }, base: () => withBuckets(wiringBase(), [bucketOf("operations", "ops.unloadSpeed")]) },
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
  transitSpeed: pending("G2-3 + OC-D8 (missions only)", ["expedition:groundOps", "patrol"]),
  crewBonuses: pending("WR-9, OC-E8 (officer bonuses read through officerBonusTotal are not amplified)", ["ground"]),
};

// The museum's PARTIAL checks: transit on a patrol flies a combat hull; the crew amplifier is read on the officer
// bonus it does not reach (Fleet Triage, frozen on the run as squadTriage).
const MUSEUM_FLAT_CHECKS: Readonly<Partial<Record<MuseumStat, Partial<Record<ContextId, FlatCheck>>>>> = {
  transitSpeed: { patrol: { base: () => combatBase() } },
  crewBonuses: { ground: { probe: "expSquadTriage", base: () => seatOfficer(withAwayTeam(wiringBase()), "medical", ["med.fleetTriage"]) } },
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

const SHIP_STATUS_PENDING: Readonly<Record<string, string>> = {
  sensorPowerDrain: "WR-8, OC-D9 (range: every ship sits at position 0, B3)",
  coolantLeak: "WR-8, OC-D9 (speed: every ship sits at position 0, B3)",
  manifoldOverheat: "WR-8, OC-D12 (maneuver: enemy evasion is always 0)",
  inhibit: "WR-8, OC-D12 (no source applies it; nothing reads droneAttackRate)",
  overchargedCapacitors: "WR-8, OC-D12 (no source applies the buff)",
};

const GROUND_STATUS_PENDING: Readonly<Record<string, string>> = {
  bleed: "FK-4 (bleed per FK call 7: nothing inflicts it)",
  corroded: "WR-10, OC-F9 (only analyze, never run, inflicts it)",
  inspired: "FK-5 (nothing inflicts it)",
  fear: FIELD_KITS_FEAR,
};

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
    out.push(
      entry({
        ...base("ship", "PIRATE_HULLS", `${id}:stance`, `${PIRATE_HULLS[id].name} stance`),
        status: pending("WR-8, OC-D9 (every ship sits at position 0, so stance changes nothing, B3)"),
      }),
    );
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
    const shape: Partial<EntryInput> =
      def.effect === "dotDamage"
        ? { curve: { kind: "linearAbsolute" }, magnitude: (c) => Math.round(c.GAMBIT_STATUSES[id].magnitude) }
        : def.effect === "accuracyDown"
          ? { direction: "down", curve: { kind: "linearRelative" }, magnitude: (c) => -c.GAMBIT_STATUSES[id].magnitude }
          : def.effect === "damageDown" || def.effect === "damageTakenDown"
            ? { direction: "down", curve: { kind: "linearRelative" }, magnitude: (c) => -c.GAMBIT_STATUSES[id].magnitude, tolerance: 1 }
            : def.effect === "skipTurn"
              ? { direction: "down", curve: { kind: "event", metric: "squad hp lost to a foe that opens stunned" }, magnitude: () => 1 }
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
          status: pending("gas giant study 15b + OC-G2 (teams land and fight there, B21)"),
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
// ranked run are its unranked values x the multiplier (HP within one rounding step). Weak is pending: SF-3 places it
// on the difficulty curve (user 2026-10-16 "Use them on the curve"), so no fight fields it yet.
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
      if (rank === "weak") return entry({ ...shared, status: pending("SF-3 (the difficulty curve places Weak enemies)") });
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
// away: the field kits (Field Kits FKR-2, fieldKits.ts). Nothing reads the catalog yet: every entry is PENDING and
// names the FKR slice that makes it live (with a sensitivity check) in its own commit.
// ============================================================================

const KIT_OWNER: Readonly<Record<FieldKitId, string>> = {
  firstAidKit: "FKR-6 (kits in battle: a Use Item rule spends the member's own First Aid Kit)",
  antitoxin: "FKR-6 (kits in battle: Antitoxin clears Poison)",
  combatStim: "FKR-6 (kits in battle: Combat Stim grants Inspired)",
  splint: "FKR-6 (kits in battle: Splint on the bone line, N8)",
  traumaKit: "FKR-6 (kits in battle: Trauma Kit on serious conditions)",
  injuryKit: "FKR-6 + FKR-7 (the Injury Kit treatment share reaches the medical bay)",
};

const CATEGORY_OWNER: Readonly<Record<KitCategory, string>> = {
  firstAid: "FKR-6 (First Aid kits at 0.5x untrained, 1.25x with Medical Training)",
  advancedMedical: "FKR-6 (the Medical Training gate on Splint, Trauma Kit and Injury Kit)",
  explosives: "FKR-5 (Saboteur +6% on the Saboteur's own grenade throws)",
  fieldDevices: "FKR-8 (the 50 to 75% per-use device roll, Codebreaker +6%)",
};

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
    return entry({
      id: `away:FIELD_KITS:${id}`,
      system: "away",
      source: { catalog: "FIELD_KITS", key: id },
      claim: `${def.label}: what one use treats, heals or grants`,
      ...shape,
      status: pending(KIT_OWNER[id]),
    });
  });
  for (const cat of Object.keys(KIT_CATEGORY_RULES) as KitCategory[]) {
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
        status: pending(CATEGORY_OWNER[cat]),
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
          direction: "down",
          curve: { kind: "equals" },
          magnitude: (c) => c.CONDITION_LINES[line].findIndex((x) => x.id === r.id) + 1,
          status: pending("FKR-4 (the bone line in battle: inflicted, worsening, power and accuracy down)"),
        }),
      ),
    );
  }
  for (const id of Object.keys(FREE_BASIC_SET) as FieldKitId[]) {
    out.push(
      entry({
        id: `away:FREE_BASIC_SET:${id}`,
        system: "away",
        source: { catalog: "FREE_BASIC_SET", key: id },
        claim: `Free basic set: every member starts each objective with ${FIELD_KITS[id].label} supplies, more with Medical and Operations crew`,
        curve: { kind: "diminishing", knee: FREE_BASIC_CURVE_KNEE, base: FREE_BASIC_SET[id]?.base ?? 0 },
        magnitude: (c) => c.FREE_BASIC_SET[id]?.base ?? 0,
        status: pending("FKR-7 (the per-objective free basic set, refreshed each objective and reload)"),
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

const CONDITION_PENDING = "FK-4 (no battle or task applies the condition yet)";
const ossir: Transform = (s) => editMember(s, WIRING_SECURITY_ID, { race: "ossir" });
const LIVE_CONDITIONS = new Set(["health", "poison", "downed"]);

function medicalEntries(): WiringEntry[] {
  const out: WiringEntry[] = Object.keys(GROUND_CONDITIONS).map((id) =>
    entry({
      id: `away:GROUND_CONDITIONS:${id}`,
      system: "away",
      source: { catalog: "GROUND_CONDITIONS", key: id },
      claim: `${GROUND_CONDITIONS[id].label}: its medical bay time`,
      probe: LIVE_CONDITIONS.has(id) ? `content:cure:${id}` : undefined,
      contexts: LIVE_CONDITIONS.has(id) ? ["medbay"] : [],
      direction: "none",
      curve: { kind: "equals" },
      magnitude: () => GROUND_CONDITIONS[id].cureSeconds,
      status: LIVE_CONDITIONS.has(id) ? LIVE : pending(CONDITION_PENDING),
    }),
  );
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
      status: pending("FK-4 (the battle half) + OC-G1 (the legacy claim ignores perks, injuries.ts:93)", ["expedition:legacy", "ground"]),
      // An Ossir Security member (the race carries the perk) vs an Earth-born one: the legacy injury path's recovery
      // time, and the member's battle resists (the in-battle half: injuries land less often).
      flatChecks: {
        "expedition:legacy": { probe: "legacyInjurySeconds", base: () => withAwayTeam(wiringBase()), on: ossir, off: identity },
        ground: { probe: "secResistSum", base: () => withAwayTeam(wiringBase()), on: ossir, off: identity },
      },
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
  { id: "facility:audit:requiresFacilityLevels", system: "facility", claim: "requiresFacilityLevels / requiresMissionCompletions rung gates (correct, no rung uses them)", status: pending("WR-4, OC-C4") },
  { id: "facility:audit:missionControlUnlock", system: "facility", claim: "MISSION_CONTROL_UNLOCK_COMPLETIONS 50 (only a commented-out rung)", status: pending("WR-4, OC-C4") },
  { id: "facility:audit:itemEquipStats", system: "facility", claim: "ItemDef.equipStats (no item fills it)", status: pending("WR-4, OC-C4") },
  { id: "facility:audit:precursorCircuit", system: "facility", claim: "Precursor Circuit: salvage drops it, nothing consumes it", status: pending("WR-10, OC-J3") },
  // D. Ship
  { id: "ship:audit:statRatios", system: "ship", claim: "Variety statRatios: an unlisted key keeps weight 1, so Hauler Hold rolls massReduction more than Prospector Hold (B11)", status: pending("WR-7, OC-D6") },
  { id: "ship:audit:favorsSpec", system: "ship", claim: "Variety favorsSpec (no reader)", status: pending("WR-7, OC-D5") },
  { id: "ship:audit:slotPowerDraw", system: "ship", claim: "SLOT_BASE_PHYSICALS powerDraw (display only; promises a budget)", status: pending("E-MOD + WR-7, OC-D1") },
  { id: "ship:audit:slotDurability", system: "ship", claim: "SLOT_BASE_PHYSICALS durability for economy, defense, crew, sensor and member pieces (never read)", status: pending("WR-8, OC-D14") },
  { id: "ship:audit:reactorCoreNet", system: "ship", claim: "A crafted Reactor Core is net negative: no power budget, and its mass drags speed and fuel (B10)", status: pending("E-MOD + OC-D1") },
  { id: "ship:audit:arrayCharacter", system: "ship", claim: "ARRAY_CHARACTER: \"Focused: faster\" while its net rate is 0.78x; no Bio-Resonance line (B12)", status: pending("WR-7, OC-D11") },
  { id: "ship:audit:hullDescriptions", system: "ship", claim: "Hull descriptions (Aurora, Eir, Orion) claim what the engine does not do", status: pending("WR-7, OC-D13 (heavy cruiser wording: SF-6)") },
  { id: "ship:audit:combatPositions", system: "ship", claim: "Weapon and drone range, stance (incl. the patrol stance the player picks), BAND_*, enemy stance, speed and position: every ship spawns at 0 (B3)", status: pending("WR-8, OC-D9") },
  { id: "ship:audit:ftlSpeedPenalty", system: "ship", claim: "FTL_SPEED_PENALTY (depends on position)", status: pending("WR-8, OC-D9") },
  { id: "ship:audit:torpedoArmorPen", system: "ship", claim: "Torpedo armorPen (enemy armor is 0)", status: pending("WR-8, OC-D12") },
  { id: "ship:audit:qualityDurabilityMax", system: "ship", claim: "qualityDurabilityMax for the reactor and FTL (always quality 0)", status: pending("WR-8, OC-D14") },
  { id: "ship:audit:particleTraceDetector", system: "ship", claim: "particleTraceDetector (hard 0, bridge.ts:960)", status: { kind: "deferred", owner: "CP-15 (patrol cloak detection)", userRef: `${T3}: patrol cloak detection` } },
  { id: "ship:audit:rapidChargeAfterAmbush", system: "ship", claim: "rapidChargeAfterAmbush (nothing sets it)", status: pending("WR-8, OC-D12") },
  { id: "ship:audit:inCombatReplenishPercent", system: "ship", claim: "inCombatReplenishPercent (nothing sets it)", status: pending("WR-8, OC-D12") },
  { id: "ship:audit:antiDrone", system: "ship", claim: "antiDrone (the PDA and EMP claim the role; no def sets it)", status: pending("WR-8, OC-D12") },
  { id: "ship:audit:smartReflect", system: "ship", claim: "smartReflect (nothing sets it)", status: pending("WR-8, OC-D12") },
  { id: "ship:audit:droneDisrupted", system: "ship", claim: "Drone status disrupted and drone evasion when targeted (nothing sets them)", status: pending("WR-8, OC-D12") },
  { id: "ship:audit:familyResists", system: "ship", claim: "damageResist_<family> / disruptionResist_<family> (read in combat; no affix pool rolls them)", status: pending("WR-8, OC-D12") },
  { id: "ship:audit:installedSystems", system: "ship", claim: "Reactor / FTL systems from installed gear (bridge.ts:945 uses a fresh quality-0 system)", status: pending("WR-8, OC-D12") },
  { id: "ship:audit:derivedStatsInCombat", system: "ship", claim: "ShipDerivedStats in combat (powerOutput, sensors, mass)", status: pending("WR-8, OC-D12") },
  { id: "ship:audit:weaponPowerDraw", system: "ship", claim: "Weapon powerDraw and the power.ts helpers (powerBudget, canFitByPower, totalPowerDraw: no callers)", status: pending("E-MOD + WR-7, OC-D1") },
  { id: "ship:audit:commentOnlyRules", system: "ship", claim: "The Tachyon anti-shield exception and the Voltaic chain (comments only)", status: pending("WR-8, OC-D12") },
  { id: "ship:audit:inertDescriptors", system: "ship", claim: "The vs-Drones triangle column, status persistence between battles, ResolveOptions.objective, TargetingPolicy.escortShare, builtInBays, frameHp, the DoT rng", status: pending("WR-8, OC-D12") },
  { id: "ship:audit:statusColor", system: "ship", claim: "Status color (no reader)", status: pending("WR-11 (use in the combat view or delete; no call)") },
  { id: "ship:audit:partialCombat", system: "ship", claim: "Ambush opener (expedition cloaked events only), precharge (Ground Ops only), enemy mitigation (players only), evasion (Evasive Command only), drone replenish (between waves only)", status: pending("WR-8, OC-D9 / OC-D12") },
  { id: "ship:audit:podDurability", system: "ship", claim: "DRONE_POD_BASE_DURABILITY (pods never wear) and QUALITY_DURABILITY_BONUS on non-weapons", status: pending("WR-8, OC-D14") },
  // E. Crew
  { id: "crew:audit:notables", system: "crew", claim: "Notable crew: the read paths are live but nothing creates one", status: pending("CP-8") },
  { id: "crew:audit:enlisted", system: "crew", claim: "The crew rank enlisted flag (never read)", status: pending("WR-9, OC-E11") },
  { id: "crew:audit:thirdBuff", system: "crew", claim: "buffCountForRank 3 (only gates the exclusive pick)", status: pending("WR-9, OC-E12") },
  { id: "crew:audit:commandCaps", system: "crew", claim: "Command structure caps (passive ships only; not enforced on load)", status: pending("CP-5, CP-7") },
  { id: "crew:audit:constitutionCycle1", system: "crew", claim: "The Constitution battle ramp skips patrol cycle 1, so a Dispatch Once patrol never ramps (B17)", status: pending("WR-9, OC-E13") },
  { id: "crew:audit:transitSplit", system: "crew", claim: "Fast Departure and Fast Return merge into one transit multiplier", status: pending("WR-9, OC-E5") },
  { id: "crew:audit:rapidLoadoutScope", system: "crew", claim: "Rapid Loadout acts on Ground Ops only", status: pending("WR-9, OC-E6") },
  { id: "crew:audit:moraleAttrition", system: "crew", claim: "Morale Anchor's \"complement attrition\" half (no system)", status: pending("WR-9, OC-E7") },
  { id: "crew:audit:commandPresenceExpedition", system: "crew", claim: "Command Presence and Operations Integrity do not reach expeditions", status: pending("WR-9, OC-E9") },
  // F. Away team and ground
  { id: "away:audit:shroudLureGroundOps", system: "away", claim: "Shroud Emitter and Lure Beacon on Ground Ops move the ship event chance; no drop multiplier", status: pending("FK-7 + OC-F1") },
  { id: "away:audit:neuralBackupClaim", system: "away", claim: "Neural Backup revives the FIRST downed ally; its flavor says the wearer (B13)", status: pending("WR-10, OC-F2") },
  { id: "away:audit:medKitClaim", system: "away", claim: "Med Kit \"keeps a downed friend in the fight\" (no revive)", status: pending("WR-10, OC-F3") },
  { id: "away:audit:quickDraw", system: "away", claim: "Quick Draw only reorders teammates (the team already acts first)", status: pending("WR-10, OC-F5") },
  { id: "away:audit:scienceRank", system: "away", claim: "Science member rank \"nudges magnitude\" (fieldwork never reads it)", status: pending("WR-10, OC-F7") },
  { id: "away:audit:fieldDeviceEffectiveness", system: "away", claim: "fieldDevice effectiveness (both values 1; the specialist check is always false)", status: pending("FK-7") },
  { id: "away:audit:memberSlotPhysicals", system: "away", claim: "Member slot physicals (mass, powerDraw, durability)", status: pending("WR-8, OC-D14") },
  { id: "away:audit:treatmentShare", system: "away", claim: "treatmentShare (always 0)", status: pending("FK-5 / FK-6") },
  { id: "away:audit:fieldKitsCure", system: "away", claim: "Cure clears basic debuffs only on a Field Kits run (fieldKits.ts BASIC_DEBUFFS; today it clears any debuff)", status: pending("FKR-4 (Cure reads BASIC_DEBUFFS on flagged runs)") },
  { id: "away:audit:memberFallOutcome", system: "away", claim: "memberFallOutcome (the Safety Interlock hook, one branch)", status: pending("OC-F13") },
  { id: "away:audit:prospectingTeam", system: "away", claim: "The Prospecting team type (no recruits, specs or gear)", status: pending("WR-10, OC-F11") },
  { id: "away:audit:statusPicker", system: "away", claim: "Status picker entries that never match (only six of nine statuses can fire)", status: pending("FK-9 + WR-10") },
  { id: "away:audit:fieldRepairOrder", system: "away", claim: "Player-ordered field repair (engine only, no UI)", status: pending("WR-10, OC-F14") },
  { id: "away:audit:legacyOnly", system: "away", claim: "Legacy-only: MAX_BATTLE_ATTEMPTS, EVAC_REWARD_FRACTION, ENCOUNTER_DROP_SCALE, scan ground battles, softenAmbush, the flat 2 h injury", status: pending("OC-G1") },
  { id: "away:audit:tierDormant", system: "away", claim: "Tier-dormant rows: RISK_TIER_ODDS II to VII, enemy territory, hostile sites, SCIENCE_HEAVY, affix rows above Tier I, DIFFICULTY_TIER_ROLL_MULT", status: pending("G2-2, SF-3") },
  { id: "away:audit:objectiveHooks", system: "away", claim: "taskChainFollowUp, calmObjective, affix weightFor (no caller)", status: pending("OC-C4") },
  // G. Expedition content
  { id: "expedition:audit:siteFlavor", system: "expedition", claim: "Hostile and clearing site flavor (never rendered)", status: pending("WR-11 (render; no call)") },
  { id: "expedition:audit:anomalyFinding", system: "expedition", claim: "Charting the anomaly costs 1 h and pays nothing (B15)", status: pending("WR-11, OC-G3") },
  { id: "expedition:audit:anomalySensors", system: "expedition", claim: "ANOMALY_CHANCE_PERMILLE: \"if sensors detect one\" (sensors not read)", status: pending("WR-11, OC-G3") },
  { id: "expedition:audit:relicSignature", system: "expedition", claim: "Foreknowledge relicSignature (the UI never reads it)", status: pending("WR-11 (delete or render; no call)") },
  { id: "expedition:audit:blindLaunch", system: "expedition", claim: "The blind launch path (unreachable)", status: pending("G2-2") },
  { id: "expedition:audit:oddsRiskyBelow", system: "expedition", claim: "ODDS_RISKY_BELOW (behind tier > 2)", status: pending("G2-2") },
  { id: "expedition:audit:shipEventProfileFields", system: "expedition", claim: "ShipEventProfile evasion and shieldCapacity (frozen, never read)", status: pending("WR-11, OC-G5") },
  { id: "expedition:audit:planetComments", system: "expedition", claim: "Planet comments: Ocean slower work, Frozen best relic survival, Toxic hardened team", status: pending("OC-G6") },
  { id: "expedition:audit:legacyFallbacks", system: "expedition", claim: "FIGHT_POINTS_DEFAULT / MIN, SURVEY_AMBUSH_CHANCE (old runs only)", status: pending("OC-G1") },
  // I. Missions, patrols, factions
  { id: "mission:audit:unusedFactions", system: "mission", claim: "voidJackals, ironVultures, ashenCorsairs and Faction.id (no patrol references them)", status: pending("WR-11, OC-I2") },
  // J. Salvage and item generation
  { id: "salvage:audit:rolledNarration", system: "salvage", claim: "SalvageRoll rolled: \"the UI narrates the drop\" (dropped)", status: pending("WR-11, OC-J2") },
  { id: "salvage:audit:lootTierNames", system: "salvage", claim: "Loot tier names (damagedWeaponSystem) unread", status: pending("WR-11, OC-J2") },
  { id: "salvage:audit:deadEndDrops", system: "salvage", claim: "Salvaged Circuitry, Precursor Circuit: nothing uses them (Scrap Alloy refines into Reclaimed Alloy since WR-4, OC-C3)", status: pending("WR-11, OC-J3") },
  { id: "salvage:audit:achievementBoost", system: "salvage", claim: "achievementBoost (always 0)", status: pending("OC-C4") },
  { id: "salvage:audit:affixCountBranches", system: "salvage", claim: "affixCount derelict / luminous / constellar (unreachable rarities)", status: pending("WR-11, OC-J4") },
  { id: "salvage:audit:ascension", system: "salvage", claim: "ascension (always none)", status: pending("OC-C4") },
];

function auditEntries(): WiringEntry[] {
  return AUDIT_ROWS.map((r) => entry({ id: r.id, system: r.system, source: { catalog: "AUDIT", key: r.id }, claim: r.claim, status: r.status }));
}

// ============================================================================
// The no-dead-stats allow-list's reasons (kept verbatim from PENDING_IN_RELEASE at the WR-1 move)
// ============================================================================

const OFFICER_DORMANT = "dormant by design until its system lands (crewOverlay.ts OFFICER_BONUSES_PENDING_IN_RELEASE)";
const SCIENCE_NEVER_FIGHTS = "Science never fights (D2)";
const SIDEARM_TOOL = "Science never fights (D2); the Sidearm becomes a tool";
const ALLOW_LIST_REASONS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.keys(OFFICER_BONUSES_PENDING_IN_RELEASE).map((k) => [`officer:${k}`, OFFICER_DORMANT])),
  "officer:officer.crewRetention":
    "Morale Anchor: wired as the squad's Fear resist (Task 20), but nothing inflicts Fear yet (enemy casters apply " +
    "weakened or poison), so the resist never rolls. The Iron Will trait and Cortex Shield's fear half wait the same way.",
  "crew:crew.powerEfficiency": "Power Discipline: power efficiency waits for the power budget (design 6.2)",
  "crew:crew.droneHandling": "Deck Handling: carrier drone handling (Flight Deck pool)",
  "crew:crew.hullRepairRate": "Damage Control: Shipyard repair rate (Engineering pool)",
  "crew:crew.counterInfiltration": "Counter-Infiltration: resists enemy debuffs (Security pool)",
  "crew:crew.awayTeamProtection": "Away-Team Protection: squad HP (Security pool)",
  "crew:crew.surveyAptitude": "Survey Aptitude: scan speed (Science pool)",
  "crew:crew.triage": "Triage: squad healing (Medical pool)",
  "crew:crew.crewOutputMult": "Crew Output Multiplier: output mult (exclusive pool)",
  "crew:crew.missionTurnaround": "Mission Turnaround: turnaround cut (exclusive pool)",
  "crew:crew.preventCrewLoss": "Prevent a Crew Loss: shorter injuries (exclusive pool)",
  "crew:crew.crewEffectiveness": "Crew Effectiveness (Medical): healthy crew work better",
  "racial:martian": "racial crew.powerEfficiency waits for the power budget",
  "racial:belter": "racial crew.droneHandling (Flight Deck pool key)",
  "racial:outerColony": "racial crew.surveyAptitude (Science pool key)",
  "racial:vael": "racial crew.surveyAptitude (Science pool key)",
  "racial:stheni": "racial crew.hullRepairRate (Engineering pool key)",
  "racial:earthBorn": "racial crew.crewEffectiveness (see crew:crew.crewEffectiveness)",
  "racial:spacer": "racial crew.endurance: a complement build-up like Constitution (D23 curve)",
  "gear:science:sidearm:groundPower": SIDEARM_TOOL,
  "gear:science:sidearm:groundAccuracy": SIDEARM_TOOL,
  "gear:science:sidearm:groundStatusChance": SIDEARM_TOOL,
  "gear:science:fieldSuit:groundArmor": SCIENCE_NEVER_FIGHTS,
  "gear:science:fieldSuit:groundHp": SCIENCE_NEVER_FIGHTS,
  "gear:science:hazardSuit:groundArmor": SCIENCE_NEVER_FIGHTS,
  "gear:science:hazardSuit:groundHp": SCIENCE_NEVER_FIGHTS,
  "gear:security:cortexShield:groundStatusResist": "its resist covers stun and fear, and no enemy inflicts either on the squad today",
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
  "candidateTopTier@expedition:groundOps": "every candidate is Tier I until G2-2: nothing raises the offered region tier",
  "missionOreQuality@mission:extraction": "nothing raises mined ore quality today (this line would be the first source)",
};

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
    ...missionEntries(),
    ...contentEntries(),
    ...affixEntries(),
    ...enemyRankEntries(),
    ...fieldKitEntries(),
    ...crewScalarEntries(),
    ...medicalEntries(),
    ...auditEntries(),
  ].map((e) => (ALLOW_LIST_REASONS[e.id] ? { ...e, reason: ALLOW_LIST_REASONS[e.id] } : e));
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


