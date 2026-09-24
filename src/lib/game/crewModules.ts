// Crew 0.14.0 (Phase 1b): the BRIDGE + CREW-QUARTERS MODULE catalogs + their pure EFFECT readers.
//
// The two crew-module slots (model.ts EQUIPMENT_SLOTS bridge / quarters) are craftable, rollable,
// ALLOW-EMPTY ship systems (quality / rarity / iLevel) that AMPLIFY the now-live crew stack:
//   - a QUARTERS module boosts the COMPLEMENT (its capacity + per-division / per-head effectiveness),
//   - a BRIDGE module boosts the SENIOR STAFF (assigned officers' output).
//
// A module is a normal EquipmentInstance on its slot; WHICH variant it is lives on the instance as
// `moduleVariant` (a catalog id, stamped by generateEquipment). This module owns the catalogs
// (QUARTERS_MODULES = 9, BRIDGE_MODULES = 3) and the pure functions that turn an installed piece into
// its effect. The crew overlay (crewOverlay.ts) calls these; nothing here mutates state.
//
// ⚠️ CAPACITY PRINCIPLE (balance, LOCKED, docs/plans/2026-09-22-crew-0.14.0-plan.md): base crew
// capacity is a LOCKED per-HULL value (commandStructure.ts). Module rarity/quality scales a module's
// EFFECT BOOSTS (effectiveness, division focus, officer amplification), NOT capacity, EXCEPT the
// Efficient quarters module whose added CAPACITY is its effect and DOES scale with rarity/quality.
// Every OTHER module contributes a FIXED capacity (or none). So `moduleEffectScale` multiplies the
// effectiveness/officer boosts and the Efficient module's capacity, while every other module's
// `quartersCapacityBonus` returns its fixed base unscaled.
//
// PURE + offline-safe: no Date.now / Math.random; a ship with no module yields no effect (multiplier
// 1 / capacity bonus 0), which is what keeps the crew overlay additive-neutral and byte-identical for
// the universal no-module case.
//
// ⚠️ ALL MAGNITUDES BELOW ARE FIRST-PASS + TUNABLE launch placeholders (the balance pass owns the
// numbers), the same posture as SHIP_TYPES / the crew buff pools. The bridge set is the leaner
// 3-variant first pass (user-recommended, TUNABLE / expandable).

import type {
  GameState,
  ShipInstance,
  EquipmentInstance,
  EquipmentRarity,
  ShipSpec,
  CrewProfession,
  SeniorStaffSeat,
  SeniorStaffOfficer,
} from "./model";
import { rarityIndex, SHIP_TYPES } from "./model";
import { equippedFor } from "./equipment";
import { officerRankMagnitudeFactor } from "./seniorStaff";

// ============================================================================
// Rarity/quality effect scale (shared by both module kinds)
// ============================================================================

// Per-rarity-step and per-quality-rung growth of a module's EFFECT (NOT its capacity, except the
// Efficient module). Referenced to "standard" == the neutral base: a standard, quality-0 module reads
// scale 1.0 (so its catalog magnitude is used as-is), and a rarer / higher-quality module amplifies
// it. FIRST-PASS TUNABLE.
export const MODULE_RARITY_STEP = 0.12; // +12% effect per rarity band above standard
export const MODULE_QUALITY_STEP = 0.06; // +6% effect per quality rung

// The multiplicative effect scale for a module of the given rarity/quality. Monotonic non-decreasing
// in both (steps are >= 0). standard/q0 == 1.0. derelict clamps to the standard base (no negative
// step), which is fine: the module generator rarely mints derelict and a below-1 scale is undesirable
// here. Pure arithmetic.
export function moduleEffectScale(rarity: EquipmentRarity, quality: number): number {
  const rarityStep = Math.max(0, rarityIndex(rarity) - rarityIndex("standard"));
  const q = Math.max(0, quality);
  return (1 + rarityStep * MODULE_RARITY_STEP) * (1 + q * MODULE_QUALITY_STEP);
}

// ============================================================================
// Quarters modules (9): 6 division-focused + 3 general
// ============================================================================

export type QuartersModuleKind = "division" | "general";

export interface QuartersModuleDef {
  id: string; // == the slot variety key (stamped onto the instance as moduleVariant)
  label: string;
  slot: "quarters";
  kind: QuartersModuleKind;
  // For kind "division": which complement division this module favors. Absent for a general module.
  division?: CrewProfession;
  // EFFECTIVENESS boost applied (SCALED by moduleEffectScale) to the FOCUSED division, or to EVERY
  // division for a general module. A fractional multiplier delta (0.5 == the division's complement
  // contribution counts 1.5x). FIRST-PASS TUNABLE.
  focusBoost: number;
  // EFFECTIVENESS delta applied to the NON-focused divisions (division modules trade the others'
  // output for the focus, "at the others' cost"). 0 for a general module (its boost is uniform).
  // May be negative. FIRST-PASS TUNABLE.
  offBoost: number;
  // FIXED capacity this module adds to the hull's LOCKED base crew cap (the reserved crewStations
  // role). Does NOT scale with rarity/quality UNLESS capacityScales is true (the Efficient module).
  // 0 for Elite (the hull base is the floor; Elite trades capacity for per-head effectiveness).
  baseCapacity: number;
  // TRUE only for the Efficient module: its added CAPACITY is its effect and DOES scale with
  // rarity/quality (the one capacity-principle exception).
  capacityScales: boolean;
}

// FIRST-PASS division magnitudes: a strong lift to the focused division (+50% at standard/q0), a
// modest tax on the others (-10%), and a small fixed capacity contribution. TUNABLE.
const DIVISION_FOCUS_BOOST = 0.5;
const DIVISION_OFF_BOOST = -0.1;
const DIVISION_CAPACITY = 6;

function divisionModule(division: CrewProfession, label: string, id: string): QuartersModuleDef {
  return {
    id,
    label,
    slot: "quarters",
    kind: "division",
    division,
    focusBoost: DIVISION_FOCUS_BOOST,
    offBoost: DIVISION_OFF_BOOST,
    baseCapacity: DIVISION_CAPACITY,
    capacityScales: false,
  };
}

export const QUARTERS_MODULES: readonly QuartersModuleDef[] = [
  // 6 DIVISION-focused (each boosts ITS division's effectiveness at the others' cost, fixed capacity).
  divisionModule("security", "Security Quarters", "quartersSecurityWing"),
  divisionModule("engineering", "Engineering Quarters", "quartersEngineeringWing"),
  divisionModule("science", "Science Quarters", "quartersScienceWing"),
  divisionModule("medical", "Medical Quarters", "quartersMedicalWing"),
  divisionModule("operations", "Operations Quarters", "quartersOperationsWing"),
  divisionModule("flightDeck", "Flight-Deck Quarters", "quartersFlightDeckWing"),
  // 3 GENERAL.
  // Utilitarian: balanced, a small uniform per-head lift + a modest fixed capacity.
  {
    id: "quartersUtilitarian",
    label: "Utilitarian Quarters",
    slot: "quarters",
    kind: "general",
    focusBoost: 0.1,
    offBoost: 0,
    baseCapacity: 12,
    capacityScales: false,
  },
  // Efficient: HIGH crew CAPACITY (the one module whose capacity SCALES with rarity/quality), traded
  // for a small uniform per-head effectiveness penalty.
  {
    id: "quartersEfficient",
    label: "Efficient Quarters",
    slot: "quarters",
    kind: "general",
    focusBoost: -0.05,
    offBoost: 0,
    baseCapacity: 40,
    capacityScales: true,
  },
  // Elite: FEWER crew (no added capacity, so the hull base is the ceiling) but a STRONG uniform
  // per-head effectiveness lift.
  {
    id: "quartersElite",
    label: "Elite Quarters",
    slot: "quarters",
    kind: "general",
    focusBoost: 0.4,
    offBoost: 0,
    baseCapacity: 0,
    capacityScales: false,
  },
];

// ============================================================================
// Bridge modules (3, first-pass leaner set; TUNABLE / expandable)
// ============================================================================

export type BridgeModuleKind = "balanced" | "focused" | "flag";

export interface BridgeModuleDef {
  id: string; // == the slot variety key (stamped onto the instance as moduleVariant)
  label: string;
  slot: "bridge";
  kind: BridgeModuleKind;
  // FIRST-PASS base amplification of an officer's output (SCALED by moduleEffectScale, and, for the
  // flag module, ALSO by the officer's rank factor). A fractional multiplier delta. TUNABLE.
  amp: number;
}

export const BRIDGE_MODULES: readonly BridgeModuleDef[] = [
  // Balanced Command: an even lift to ALL assigned officers.
  { id: "bridgeBalancedCommand", label: "Balanced Command", slot: "bridge", kind: "balanced", amp: 0.1 },
  // Focused Command: a larger lift, but ONLY to officers whose seat matches the hull's role (the
  // folded-in "hull specialist" fantasy). Unmatched officers get no lift.
  { id: "bridgeFocusedCommand", label: "Focused Command", slot: "bridge", kind: "focused", amp: 0.3 },
  // Flag Command: scales with each officer's RANK (rewards a small, elite, high-rank bridge).
  { id: "bridgeFlagCommand", label: "Flag Command", slot: "bridge", kind: "flag", amp: 0.15 },
];

// ============================================================================
// Focused Command: hull role -> the officer seats it amplifies
// ============================================================================

// Which Senior Staff seats a hull's ROLE (ShipSpec) counts as its "specialists". Focused Command
// amplifies only officers sitting these seats. FIRST-PASS TUNABLE (mirrors the command-structure
// division weighting: a warship leans tactical/engineering/pilot, a prospector operations/science/
// engineering, an explorer science/medical/engineering, a hauler operations/pilot/executive).
export const HULL_ROLE_SEATS: Record<ShipSpec, readonly SeniorStaffSeat[]> = {
  general: ["operations", "pilot", "executive"],
  prospector: ["operations", "science", "engineering"],
  tactician: ["tactical", "engineering", "pilot"],
  explorer: ["science", "medical", "engineering"],
};

// ============================================================================
// Catalog lookups (built once; ids asserted globally unique)
// ============================================================================

const QUARTERS_BY_ID: Map<string, QuartersModuleDef> = (() => {
  const map = new Map<string, QuartersModuleDef>();
  for (const def of QUARTERS_MODULES) {
    if (map.has(def.id)) throw new Error(`Duplicate quarters module id: ${def.id}`);
    map.set(def.id, def);
  }
  return map;
})();

const BRIDGE_BY_ID: Map<string, BridgeModuleDef> = (() => {
  const map = new Map<string, BridgeModuleDef>();
  for (const def of BRIDGE_MODULES) {
    if (map.has(def.id)) throw new Error(`Duplicate bridge module id: ${def.id}`);
    map.set(def.id, def);
  }
  return map;
})();

// Look up a quarters / bridge module def by id (its moduleVariant), or undefined. Pure readers.
export function getQuartersModuleById(id: string): QuartersModuleDef | undefined {
  return QUARTERS_BY_ID.get(id);
}
export function getBridgeModuleById(id: string): BridgeModuleDef | undefined {
  return BRIDGE_BY_ID.get(id);
}

// ============================================================================
// Installed-module resolution (pure reads over the fitment authority)
// ============================================================================

// A resolved installed module: the catalog def + the concrete instance (for its rarity/quality).
export interface InstalledQuartersModule {
  def: QuartersModuleDef;
  instance: EquipmentInstance;
}
export interface InstalledBridgeModule {
  def: BridgeModuleDef;
  instance: EquipmentInstance;
}

// The quarters module installed on a ship, or null (empty slot / no recognizable variant). Reads the
// fitment authority (equippedFor) filtered to the quarters slot; a slot is a singleton so at most one
// matches. Pure.
export function installedQuartersModule(state: GameState, ship: ShipInstance): InstalledQuartersModule | null {
  const piece = equippedFor(state, ship.id).find((e) => e.slotType === "quarters");
  if (!piece || piece.moduleVariant === undefined) return null;
  const def = getQuartersModuleById(piece.moduleVariant);
  return def ? { def, instance: piece } : null;
}

// The bridge module installed on a ship, or null. Pure.
export function installedBridgeModule(state: GameState, ship: ShipInstance): InstalledBridgeModule | null {
  const piece = equippedFor(state, ship.id).find((e) => e.slotType === "bridge");
  if (!piece || piece.moduleVariant === undefined) return null;
  const def = getBridgeModuleById(piece.moduleVariant);
  return def ? { def, instance: piece } : null;
}

// ============================================================================
// Effect readers (pure)
// ============================================================================

// The EFFECTIVENESS multiplier a quarters module applies to a given division's complement
// contribution. 1.0 means no change. For a division module: focusBoost (scaled) on its own division,
// offBoost (scaled) on the others. For a general module: focusBoost (scaled) uniformly. Pure.
export function quartersProfessionMultiplier(mod: InstalledQuartersModule, profession: CrewProfession): number {
  const scale = moduleEffectScale(mod.instance.rarity, mod.instance.quality);
  const raw =
    mod.def.kind === "division"
      ? profession === mod.def.division
        ? mod.def.focusBoost
        : mod.def.offBoost
      : mod.def.focusBoost;
  return 1 + raw * scale;
}

// The crew-capacity BONUS a ship's installed quarters module grants (threaded into complementTotalCap
// / autoCrewShip as bonusCapacity). 0 when no quarters module is installed. FIXED (the catalog base)
// for every module EXCEPT the Efficient module, whose capacity SCALES with rarity/quality (the one
// capacity-principle exception). Pure.
export function quartersCapacityBonus(state: GameState, ship: ShipInstance): number {
  const mod = installedQuartersModule(state, ship);
  if (!mod) return 0;
  if (!mod.def.capacityScales) return mod.def.baseCapacity;
  return Math.round(mod.def.baseCapacity * moduleEffectScale(mod.instance.rarity, mod.instance.quality));
}

// The output multiplier a bridge module applies to ONE officer's contribution, given the hull's role.
// 1.0 means no change. Balanced: uniform (scaled). Focused: the scaled lift only if the officer's seat
// matches the hull's role, else 1.0. Flag: scaled AND multiplied by the officer's rank factor (rewards
// high-rank officers). Pure.
export function bridgeOfficerMultiplier(
  mod: InstalledBridgeModule,
  officer: SeniorStaffOfficer,
  hullSpec: ShipSpec,
): number {
  const scale = moduleEffectScale(mod.instance.rarity, mod.instance.quality);
  switch (mod.def.kind) {
    case "balanced":
      return 1 + mod.def.amp * scale;
    case "focused":
      return HULL_ROLE_SEATS[hullSpec].includes(officer.seat) ? 1 + mod.def.amp * scale : 1;
    case "flag":
      return 1 + mod.def.amp * scale * officerRankMagnitudeFactor(officer.rank);
  }
}

// A convenience: the hull spec for a ship (the input Focused/Flag readers need). Pure.
export function hullSpecOf(ship: ShipInstance): ShipSpec {
  return SHIP_TYPES[ship.typeKey].spec;
}
