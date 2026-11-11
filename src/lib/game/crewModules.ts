// Crew 0.14.0 (Phase 1b): the BRIDGE + CREW-QUARTERS MODULE catalogs + their pure EFFECT readers.
//
// The two crew-module slots (model.ts EQUIPMENT_SLOTS bridge / quarters) are craftable, rollable,
// ALLOW-EMPTY ship systems (quality / rarity / iLevel) that AMPLIFY the now-live crew stack:
//   - a QUARTERS module boosts the COMPLEMENT (its capacity + per-division / per-head effectiveness),
//   - a BRIDGE module boosts the SENIOR STAFF (assigned officers' output).
//
// A module is a normal EquipmentInstance on its slot; WHICH variant it is lives on the instance as
// `moduleVariant` (a catalog id, stamped by generateEquipment). This module owns the catalogs
// (QUARTERS_MODULES = 10, BRIDGE_MODULES = 3) and the pure functions that turn an installed piece into
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
  ShipSpec,
  CrewProfession,
  SeniorStaffSeat,
  SeniorStaffOfficer,
} from "./model";
import { GENERAL_QUARTERS_GUEST_PERK, HULL_FAMILY_SWITCH, SHIP_TYPES, crewModuleEffectScale, crewModuleLinePoints as linePoints, moduleEffectScale } from "./model";
import { equippedFor } from "./equipmentQueries";
import { officerRankMagnitudeFactor } from "./seniorStaff";
import { diminishing } from "./diminishing";

// ============================================================================
// Rarity/quality effect scale (shared by both module kinds)
// ============================================================================

// moduleEffectScale and its two steps MOVED to model.ts (E-MOD EM-5: the universal modules' power output folds in
// equipmentStatMods there, which cannot import this file). Re-exported here unchanged, so every importer keeps working.
export { MODULE_RARITY_STEP, MODULE_QUALITY_STEP, moduleEffectScale } from "./model";
// The crew module effect scale (CREW_MODULE_LINE_KNEE, crewModuleLineScale, crewModuleEffectScale) and the CP-13 test
// switch MOVED to model.ts in the CP-13 fix round (the General guest perk, folded in shipDerivedStats there, scales with
// the module). Re-exported here unchanged, so every importer keeps working.
export { CREW_MODULE_LINE_KNEE, HULL_FAMILY_SWITCH, crewModuleEffectScale, crewModuleLineScale } from "./model";

// WR-7 (OC-D3, user 2026-10-15 "They scale the module (Recommended)", "Crew Stations also adds capacity"): a crew
// module's rolled CREW STATIONS and CREW EFFICIENCY lines (the bridge's signature crewEfficiency; the quarters'
// signature crewStations and its crewEfficiency affix) scale the module's effect: their points, summed, lift its boost
// on the D23 curve, x (1 + diminishing(points, CREW_MODULE_LINE_KNEE) / CREW_MODULE_LINE_KNEE), about +1% per point at
// first and never capped. A Crew Stations line ALSO adds berths (crewStationsBerths, a small curve; a count
// that never wears, gearWear.ts WEAR_EXEMPT_LINES), on top of the module's own capacity. Every minted bridge and quarters
// piece carries one of these lines as its implicit signature (the Guest Wing excepted), so a module minted before WR-7
// is LIFTED by it too: in a live sheet at once, and in a captain mission or short-range run only when that run carries
// the stamp (CaptainMissionState.moduleLines, crewModuleLinesStamp below), so a run in flight at the update reads its
// modules exactly as before (effectiveShipStats opts.moduleLines false: withoutCrewModuleLines). Expeditions and patrol
// cycles freeze the officer and complement effects at dispatch / the cycle start, so a run in flight keeps its record.
// The berths act only through the crew fill (auto-crew, transfer, rosters), which a ship out on a run never takes
// (crewLock.ts shipCrewLocked), so they cannot change a run in flight.
// [PROVISIONAL] the scale's knee, 100 points (no number was asked).
// WR-7 review (user 2026-10-29, "Small curve (Recommended)"; "Elite stays at 0 (Recommended)"): the berths a Crew
// Stations line adds ride a gentle D23 curve, CREW_STATIONS_BERTH_SCALE x diminishing(points, CREW_STATIONS_BERTH_KNEE),
// rounded to whole berths and never capped: 25 points 1, 50 points 2, 113 points 4 (the quarters' own berths stay the
// main source). The Elite Quarters, with no berths of its own, takes none from its line (it only scales its effect).
// [PROVISIONAL] the curve's two numbers.
export const CREW_STATIONS_BERTH_SCALE = 0.0416;
export const CREW_STATIONS_BERTH_KNEE = 300;
const CREW_MODULE_LINE_KEYS = ["crewStations", "crewEfficiency"] as const;

const isCrewModule = (piece: EquipmentInstance): boolean => piece.slotType === "bridge" || piece.slotType === "quarters";
const hasModuleLine = (piece: EquipmentInstance): boolean => isCrewModule(piece) && CREW_MODULE_LINE_KEYS.some((k) => linePoints(piece, k) > 0);

// The stamp a new captain mission or short-range run carries when the ship's crew modules carry a line (the run then
// reads them, OC-D3); undefined when none does (both readings agree, so the record stays as it was). Pure.
export function crewModuleLinesStamp(state: GameState, ship: ShipInstance): 1 | undefined {
  return equippedFor(state, ship.id).some(hasModuleLine) ? 1 : undefined;
}

// The state with every crew module's Crew Stations and Crew Efficiency lines left out: the pre-WR-7 reading, for a run
// dispatched before the lines acted. The SAME state reference when no module carries one. Pure.
export function withoutCrewModuleLines<T extends { equipment: EquipmentInstance[] }>(state: T): T {
  if (!state.equipment.some(hasModuleLine)) return state;
  const strip = (lines: Record<string, number>): Record<string, number> => {
    const out = { ...lines };
    for (const k of CREW_MODULE_LINE_KEYS) delete out[k];
    return out;
  };
  return { ...state, equipment: state.equipment.map((p) => (hasModuleLine(p) ? { ...p, implicitStats: strip(p.implicitStats), rolledStats: strip(p.rolledStats) } : p)) };
}

// The berths a crew module's Crew Stations line adds (0 without it). Pure.
export function crewStationsBerths(piece: EquipmentInstance): number {
  const points = linePoints(piece, "crewStations");
  return points > 0 ? Math.round(CREW_STATIONS_BERTH_SCALE * diminishing(points, CREW_STATIONS_BERTH_KNEE)) : 0;
}

// ============================================================================
// Quarters modules (10): 6 division-focused + 3 general + the Guest Wing (G1-1)
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

// G1-1: the Guest Wing's fixed crew capacity, below every other capacity-giving module (division 6, Utilitarian 12,
// Efficient 40) because its berths go to guests. [PROVISIONAL] first pass (the plan's "fewer crew stations in trade";
// no number was asked).
export const GUEST_WING_CREW_CAPACITY = 4;

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
  // G1-1 (Short-Range Missions, user 2026-10-19 "Guest Wing (Recommended)"): berths for PASSENGERS, not crew. Its
  // effect is its guest quarters line (the variety's signature, model.ts EQUIPMENT_SLOTS.quarters, folded into
  // ShipDerivedStats.colonistCapacity); for the crew it is a plain module: no effectiveness boost and a small fixed
  // crew capacity (fewer crew stations, the trade for the guest berths). Guests never count toward the complement.
  {
    id: "quartersGuestWing",
    label: "Guest Wing",
    slot: "quarters",
    kind: "general",
    focusBoost: 0,
    offBoost: 0,
    baseCapacity: GUEST_WING_CREW_CAPACITY,
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

// crewModuleEffectScale (the scale a crew module's effect and every hull-family line carry) lives in model.ts (the CP-13
// fix round moved it there for the General guest perk) and is re-exported above.

// The EFFECTIVENESS multiplier a quarters module applies to a given division's complement
// contribution. 1.0 means no change. For a division module: focusBoost (scaled) on its own division,
// offBoost (scaled) on the others. For a general module: focusBoost (scaled) uniformly. Pure.
// CP-13 (OC-13): `hullSpec` given, the hull family's division lift joins the boost for the family's two signature
// divisions (hullFamilyDivisionLift: "division lifts inside the quarters multiplier", the same scale). Omitted (a run
// dispatched before CP-13, or the switch off) it is exactly the pre-CP-13 multiplier.
export function quartersProfessionMultiplier(mod: InstalledQuartersModule, profession: CrewProfession, hullSpec?: ShipSpec): number {
  // GEAR WEAR step 3: a worn module boosts at its efficiency where a run reads it (gearWear.ts viewPieceEfficiency, 1 on
  // a stored piece). Its capacity is a count and never wears (quartersCapacityBonus).
  // WR-7 (OC-D3): x its Crew Stations and Crew Efficiency lines (crewModuleLineScale).
  const scale = crewModuleEffectScale(mod.instance);
  const raw =
    mod.def.kind === "division"
      ? profession === mod.def.division
        ? mod.def.focusBoost
        : mod.def.offBoost
      : mod.def.focusBoost;
  const lift = hullSpec === undefined ? 0 : hullFamilyDivisionLiftRaw(hullSpec, profession);
  return 1 + (lift === 0 ? raw : raw + lift) * scale;
}

// The crew-capacity BONUS a ship's installed quarters module grants (threaded into complementTotalCap
// / autoCrewShip as bonusCapacity). 0 when no quarters module is installed. FIXED (the catalog base)
// for every module EXCEPT the Efficient module, whose capacity SCALES with rarity/quality (the one
// capacity-principle exception). Pure.
// WR-7 (OC-D3): plus the berths of its Crew Stations line (crewStationsBerths); OC-D7: the whole bonus spreads across
// the division caps by the hull's role weights (commandStructure.ts commandStructureWithBonus).
export function quartersCapacityBonus(state: GameState, ship: ShipInstance): number {
  const mod = installedQuartersModule(state, ship);
  if (!mod) return 0;
  // User 2026-10-29 "Elite stays at 0": a module with no berths of its own (the Elite Quarters) takes none from its line.
  const stations = mod.def.baseCapacity > 0 ? crewStationsBerths(mod.instance) : 0;
  if (!mod.def.capacityScales) return mod.def.baseCapacity + stations;
  return Math.round(mod.def.baseCapacity * moduleEffectScale(mod.instance.rarity, mod.instance.quality, mod.instance.ascension)) + stations;
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
  // GEAR WEAR step 3: a worn bridge module amplifies at its efficiency where a run reads it (gearWear.ts).
  // WR-7 (OC-D3): x its Crew Efficiency signature line (crewModuleLineScale).
  const scale = crewModuleEffectScale(mod.instance);
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

// ============================================================================
// CP-13 (G5): the HULL-FAMILY module bonuses
// ============================================================================
//
// User OC-13 (2026-10-16, "One catalog, by hull (Recommended)": the eight SMS-1 lines at +5% to +10%): every bridge
// and quarters module gives, on top of its variant effect, the bonus of the hull family (ShipSpec) it is INSTALLED ON.
// Moving a module to another hull changes its bonus; there are no per-family variants. Each line scales with the
// module exactly as its variant effect does (crewModuleEffectScale: rarity, quality, ascension, wear, its Crew
// Stations / Crew Efficiency lines). The General guest quarters perk is G1-1's (model.ts GENERAL_QUARTERS_GUEST_PERK,
// folded in shipDerivedStats; this catalog names it and reads it): G1-1 built it flat, and the CP-13 fix round (user
// 2026-11-04 "Yes, grow like the rest (Recommended)") scales it like the other seven lines.
// WEAR: each line reads the module exactly as the module's own effect does on the same path (one scale, one state), so
// wear lowers a line only where it lowers the module's own effect: the sheet a captain mission, short-range run or
// expedition flies on (their gear views). A patrol's sheet, combat records and weapon line, the rare-find roll, the
// output share and the Ground Ops bay snapshot read the module at full condition, as its own effect does there.
//
//   family      bridge                                  quarters (two signature divisions +8%, and one perk)
//   general     +6% FTL transit speed, +6% unload speed  Operations, Flight Deck; guest quarters +10%
//   prospector  +6% extraction yield                     Engineering, Science; +3% rare finds on mining and survey hauls
//   tactician   +5% weapon damage                        Security, Engineering; injured crew recover 15% faster
//   explorer    +10% sensors                             Science, Medical; ground-team medical bay time 10% shorter
//
// One bonus per slot per ship (one bridge, one quarters module), so nothing here stacks without bound and the lines
// stay linear (the officer lifts' rule; D23 is for sources that stack). The bay and injury perks act as care shares
// in the bay's divisor (medicalBay.ts), so they never reach zero time.
// CAPACITY PRINCIPLE: no quarters bonus adds berths (crew spec 182); the division lifts are per-head effectiveness.
// D12: the Tactician weapon line comes from INSTALLED GEAR (the bridge module), not the crew, so the rule "the
// Complement never feeds weapons or shields" holds.
// Where they act (each frozen where a run would otherwise read it mid-run, the favoredSpec precedent):
//   the sheet lines        crewOverlay.ts effectiveShipStats (applyHullFamilyLines); a captain mission, short-range run
//                          or patrol reads them when stamped at dispatch (hullBonus), an expedition freezes its sheet.
//   the division lifts     crewOverlay.ts rawShipCrewContribution, through quartersProfessionMultiplier (same stamp).
//   the weapon line        frozen per patrol cycle (PatrolMissionState.hullWeapon) and per expedition ship battle
//                          (ShipEventBattle.hullWeapon), applied by combat/bridge.ts shipToCombatant.
//   rare finds             tick.ts economyTick's mission arm (stamped runs) and missionDropChances.
//   injury and bay perks   frozen at Ground Operations dispatch (GroundOpsFactors.hullInjuryShare / hullBayShare; OC-G1
//                          deleted the legacy claim's run-level copy with the legacy path). Each is a care share
//                          that ADDS to the bay's other care, so with more care aboard it saves a little less time (the
//                          tile shows the ship's own number: groundOps.ts shipBayCareNow).
// [PROVISIONAL] every size (the SMS-1 first pass the user approved; the 0.16.0 balance pass owns the numbers).

export type HullFamilyBridgeStat = "transitSpeed" | "unloadSpeed" | "extractionYield" | "weaponDamage" | "sensors";
export type HullFamilyQuartersPerk = "guestQuarters" | "rareFind" | "injuryRecovery" | "bayTime";

export interface HullFamilyModuleBonus {
  // The bridge lines: each a fractional lift at a Standard quality 0 module (0.06 = +6%).
  bridge: Readonly<Partial<Record<HullFamilyBridgeStat, number>>>;
  quarters: {
    divisions: readonly CrewProfession[]; // the family's two signature divisions
    divisionLift: number; // their effectiveness lift, inside the quarters multiplier
    perk: HullFamilyQuartersPerk;
    // The perk at a Standard quality 0 module: guestQuarters / rareFind / injuryRecovery a fractional lift (rare finds
    // add it to the rare chance multiplier; injured crew recover that much faster, time / (1 + it), with no other care),
    // bayTime the share of the bay time cut with no other care (10% shorter = time x 0.9). Every perk scales with the
    // module (crewModuleEffectScale).
    perkSize: number;
  };
}

export const HULL_FAMILY_MODULE_BONUS: Readonly<Record<ShipSpec, HullFamilyModuleBonus>> = {
  general: {
    bridge: { transitSpeed: 0.06, unloadSpeed: 0.06 },
    quarters: { divisions: ["operations", "flightDeck"], divisionLift: 0.08, perk: "guestQuarters", perkSize: GENERAL_QUARTERS_GUEST_PERK },
  },
  prospector: {
    bridge: { extractionYield: 0.06 },
    quarters: { divisions: ["engineering", "science"], divisionLift: 0.08, perk: "rareFind", perkSize: 0.03 },
  },
  tactician: {
    bridge: { weaponDamage: 0.05 },
    quarters: { divisions: ["security", "engineering"], divisionLift: 0.08, perk: "injuryRecovery", perkSize: 0.15 },
  },
  explorer: {
    bridge: { sensors: 0.1 },
    quarters: { divisions: ["science", "medical"], divisionLift: 0.08, perk: "bayTime", perkSize: 0.1 },
  },
};

// HULL_FAMILY_SWITCH (the test switch, the FAVORED_SPEC_SWITCH pattern) lives in model.ts and is re-exported above.

// The family `hullSpec`'s raw division lift for `profession` (0 off its two divisions, or with the switch off). Pure.
function hullFamilyDivisionLiftRaw(hullSpec: ShipSpec, profession: CrewProfession): number {
  if (!HULL_FAMILY_SWITCH.live) return 0;
  const q = HULL_FAMILY_MODULE_BONUS[hullSpec]?.quarters;
  return q !== undefined && q.divisions.includes(profession) ? q.divisionLift : 0;
}

// The scaled bridge lines a ship's installed bridge module gives on its hull (every stat present, 0 where the family has
// none), or null without a bridge module (or with the switch off). Pure.
export type HullFamilyBridgeLines = Readonly<Record<HullFamilyBridgeStat, number>>;
const NO_BRIDGE_LINES: HullFamilyBridgeLines = { transitSpeed: 0, unloadSpeed: 0, extractionYield: 0, weaponDamage: 0, sensors: 0 };
export function hullFamilyBridgeLines(state: GameState, ship: ShipInstance): HullFamilyBridgeLines | null {
  if (!HULL_FAMILY_SWITCH.live) return null;
  const mod = installedBridgeModule(state, ship);
  if (mod === null) return null;
  const lines = HULL_FAMILY_MODULE_BONUS[hullSpecOf(ship)]?.bridge;
  if (lines === undefined) return null;
  const scale = crewModuleEffectScale(mod.instance);
  const out: Record<HullFamilyBridgeStat, number> = { ...NO_BRIDGE_LINES };
  for (const [k, v] of Object.entries(lines) as [HullFamilyBridgeStat, number][]) out[k] = v * scale;
  return out;
}

// The Tactician bridge's weapon damage line on `ship` (0 off a Tactician hull or without a bridge module). Pure.
export function hullFamilyWeaponLine(state: GameState, ship: ShipInstance): number {
  return hullFamilyBridgeLines(state, ship)?.weaponDamage ?? 0;
}

// The quarters perk `perk` on `ship` as its consumer reads it (0 when the hull's family has another perk, without a
// quarters module, or with the switch off):
//   rareFind        the share added to the run's rare chance multiplier
//   injuryRecovery  a care share for INJURY-class conditions in the medical bay (recover 1 + it times as fast)
//   bayTime         a care share for EVERY condition in the bay: cut / (1 - cut) at the module's scale, so a Standard
//                   module's bay time is exactly `cut` shorter alone
//   guestQuarters   the G1-1 perk at the module's scale (model.ts foldGuestQuarters applies it; read here for the readouts)
// Pure.
export function hullFamilyQuartersPerk(state: GameState, ship: ShipInstance, perk: HullFamilyQuartersPerk): number {
  if (!HULL_FAMILY_SWITCH.live) return 0;
  const q = HULL_FAMILY_MODULE_BONUS[hullSpecOf(ship)]?.quarters;
  if (q === undefined || q.perk !== perk) return 0;
  const mod = installedQuartersModule(state, ship);
  if (mod === null) return 0;
  return hullFamilyPerkShare(q, crewModuleEffectScale(mod.instance));
}

// The consumer's share of a family's quarters perk at module scale `scale` (see hullFamilyQuartersPerk). Pure.
export function hullFamilyPerkShare(q: Pick<HullFamilyModuleBonus["quarters"], "perk" | "perkSize">, scale: number): number {
  if (q.perk === "bayTime") return (q.perkSize / (1 - q.perkSize)) * scale;
  return q.perkSize * scale;
}

// The stamp a captain mission, short-range run or patrol dispatched now carries: 1 when the ship has a bridge or quarters
// module installed (the run then reads its hull bonus), undefined otherwise (both readings agree, so the record stays as
// it was). A run without it (every run dispatched before CP-13) reads no hull bonus to its end. Pure.
export function hullFamilyStamp(state: GameState, ship: ShipInstance): 1 | undefined {
  if (!HULL_FAMILY_SWITCH.live) return undefined;
  return installedBridgeModule(state, ship) !== null || installedQuartersModule(state, ship) !== null ? 1 : undefined;
}
