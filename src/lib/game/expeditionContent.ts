// ============================================================================
// expeditionContent.ts -- Exploration 0.14.0 (Phase E2b): the CONTENT LAYER on top
// of the E2a expedition ENGINE. The 8 PLANET TYPES + the POINTS-OF-INTEREST catalog,
// LOCKED from the approved "Expedition Console" mockup (2026-09-30).
//
// PURE DATA + PURE READERS ONLY (no Svelte, no state, no side effects), the exact
// posture of sensorArrays.ts. This module owns:
//   - PLANET_TYPES: the 8 body types. Each carries a HAZARD tier -> scalar (feeds the
//     E2a scan-rate hazard penalty + later ground difficulty), an orbital-only flag
//     (Gas Giant: no surface landing, finds are satellite ops), and per-POOL discovery
//     BIASES that skew a body's surface vs underground finds (added to the sensor
//     array's own biases in the discovery roll, expedition.ts).
//   - POI_CATALOG: the 9 Points of Interest, split into a SURFACE pool (Wide-Beam
//     array favors) and an UNDERGROUND pool (Focused-Beam array favors). Each PoI
//     declares a per-PLANET-TYPE eligibility/WEIGHT map: a body draws its discoveries
//     from the PoIs eligible for its planetType, weighted. Absent weight => not
//     eligible on that planet type.
//   - Built-once lookup indexes + pure readers the engine (expedition.ts) + the E2c UI
//     consume: getPlanetTypeById, getPoiById, poisForPlanetType.
//
// ⚠️ THIS IS THE CONTENT LAYER, NOT THE REWARD ECONOMY. A discovery/activity's real
// finding payload (relics/research/museum) is E4; E2b only makes the discovery +
// activity CONTENT real (named, type-gated), the E3 gambit resolver + E4 relics swap
// in on top without reshaping the record.
//
// ⚠️ ALL WEIGHTS + BIASES + HAZARD SCALARS BELOW ARE FIRST-PASS TUNABLE launch
// placeholders (the balance pass owns the real numbers), the same posture as
// SHIP_TYPES / sensorArrays.ts / the expedition.ts engine constants. Names + which
// PoIs are eligible on which planet types are the user's locked content calls; the
// magnitudes are tunable.
//
// IMPORT DIRECTION (no cycle): this file imports the ExpeditionPlanetType string union
// from model.ts; model.ts does NOT import this file (the ExpeditionBody.planetType
// field is a plain union, the catalog data lives here). Same one-way arrow sensorArrays.ts
// has with model.ts.
// ============================================================================

import type { ClearingSiteId, ExpeditionPlanetType, HostileSiteId } from "./model";

// ============================================================================
// Hazard tiers -> scalars
// ============================================================================

// The hazard TIERS the mockup names, mapped to the 0..1 scalar the engine consumes as a body's
// `hazard` (expedition.ts scanRatePerSecond: hazardSlow = 1 + hazard * SCAN_HAZARD_PENALTY, and, later,
// the E3 ground-combat difficulty lever). FIRST-PASS TUNABLE magnitudes.
export type HazardTier = "low" | "lowMedium" | "medium" | "high" | "veryHigh";

export const HAZARD_TIER_SCALAR: Record<HazardTier, number> = {
  low: 0.1,
  lowMedium: 0.25,
  medium: 0.4,
  high: 0.65,
  veryHigh: 0.9,
};

// ============================================================================
// Points of Interest (the two discovery POOLS)
// ============================================================================

// The two discovery POOLS. SURFACE finds are what the Wide-Beam array's landmarkOddsBias favors;
// UNDERGROUND finds are what the Focused-Beam array's undergroundPoiOddsBias favors (sensorArrays.ts).
export type PoiPool = "surface" | "underground";

export type ExpeditionPoiId =
  // SURFACE pool (Wide-Beam favors)
  | "ancientRuins"
  | "crashedShip"
  | "xenoFloraBloom"
  | "mineralOutcrop"
  | "derelictOutpost"
  // UNDERGROUND pool (Focused-Beam favors)
  | "caveNetwork"
  | "buriedVault"
  | "subterraneanCivilization"
  | "geothermalChamber";

export interface ExpeditionPoiDef {
  id: ExpeditionPoiId;
  label: string;
  pool: PoiPool;
  flavor: string; // short mockup-locked flavor (the E2c UI surfaces it)
  // planetType -> relative WEIGHT for a weighted pick within the pool. Absent => NOT eligible on that
  // planet type (weight 0). FIRST-PASS TUNABLE; the SET of eligible types per PoI is the locked content.
  planetWeights: Partial<Record<ExpeditionPlanetType, number>>;
}

// The 9 PoIs (5 surface + 4 underground), LOCKED 2026-09-30. Each planetWeights map is FIRST-PASS
// TUNABLE. Verified below (POIS_BY_PLANET_TYPE builder asserts) that every planet type has at least one
// eligible SURFACE PoI and one eligible UNDERGROUND PoI, so both pools can always yield.
export const POI_CATALOG: readonly ExpeditionPoiDef[] = [
  // --- SURFACE pool (Wide-Beam favors) ------------------------------------------------------------
  {
    id: "ancientRuins",
    label: "Ancient Ruins",
    pool: "surface",
    flavor: "A weathered dig-site: a lead on a relic for a Science team to excavate.",
    // Terrestrial ruins; strongest on Arid (buried ruins) + Frozen (preserved relics). None on Volcanic
    // or Gas Giant (no ancient surface to survive).
    planetWeights: { terrestrial: 3, ocean: 1, arid: 4, frozen: 3, barren: 2, toxic: 1 },
  },
  {
    id: "crashedShip",
    label: "Crashed Ship",
    pool: "surface",
    flavor: "A downed hull: salvage plus a chance at intact tech or a log.",
    // Everywhere; best on Frozen (best relic-survival) + Arid (preserved) + Ocean (sunken structures).
    planetWeights: { terrestrial: 2, ocean: 3, arid: 3, volcanic: 1, frozen: 4, gasGiant: 2, barren: 2, toxic: 1 },
  },
  {
    id: "xenoFloraBloom",
    label: "Xeno-Flora Bloom",
    pool: "surface",
    flavor: "A living bloom: Science sampling for biotech + research.",
    // Life-bearing worlds: strongest on Ocean (xeno-flora) + Toxic (strange life). None on Volcanic /
    // Barren (nothing grows).
    planetWeights: { terrestrial: 2, ocean: 4, arid: 1, frozen: 1, gasGiant: 1, toxic: 3 },
  },
  {
    id: "mineralOutcrop",
    label: "Mineral Outcrop",
    pool: "surface",
    flavor: "An exposed seam of rare or exotic material, flavored by the planet.",
    // Every type mines something; strongest on Volcanic + Barren (straightforward mining) + Toxic (exotic).
    planetWeights: { terrestrial: 2, ocean: 1, arid: 2, volcanic: 4, frozen: 2, gasGiant: 2, barren: 4, toxic: 3 },
  },
  {
    id: "derelictOutpost",
    label: "Derelict Outpost",
    pool: "surface",
    flavor: "An abandoned outpost: supplies + data, with a fight risk.",
    // Habitable-ish worlds; strongest on Terrestrial (outposts). Few on Volcanic / Gas Giant / Toxic.
    planetWeights: { terrestrial: 3, ocean: 2, arid: 2, volcanic: 1, frozen: 2, gasGiant: 1, barren: 2, toxic: 1 },
  },
  // --- UNDERGROUND pool (Focused-Beam favors) -----------------------------------------------------
  {
    id: "caveNetwork",
    label: "Cave Network",
    pool: "underground",
    flavor: "A branching cave system: deposits and dens to work through.",
    // The universal underground find: eligible on EVERY planet type (guarantees an underground pool).
    planetWeights: { terrestrial: 3, ocean: 2, arid: 3, volcanic: 2, frozen: 2, gasGiant: 1, barren: 3, toxic: 2 },
  },
  {
    id: "buriedVault",
    label: "Buried Vault",
    pool: "underground",
    flavor: "A sealed cache: high relic odds waiting behind a fight.",
    // Strongest on Arid (strong underground) + Frozen (relic survival). None on Gas Giant.
    planetWeights: { terrestrial: 2, ocean: 1, arid: 4, volcanic: 1, frozen: 3, barren: 1, toxic: 2 },
  },
  {
    id: "subterraneanCivilization",
    label: "Subterranean Civilization",
    pool: "underground",
    flavor: "The big relic prize: a deep-dwelling culture that needs an exploration build.",
    // The rare deep prize: low weight everywhere it appears, best on Arid. None on Gas Giant.
    planetWeights: { terrestrial: 1, ocean: 1, arid: 2, volcanic: 1, frozen: 1, barren: 1, toxic: 1 },
  },
  {
    id: "geothermalChamber",
    label: "Geothermal Chamber",
    pool: "underground",
    flavor: "A superheated chamber: energy + exotic compounds, volcanic-flavored.",
    // Strongest on Volcanic (volcanic-flavored) + Toxic (exotic compounds). None on Gas Giant / Barren.
    planetWeights: { terrestrial: 1, ocean: 1, arid: 1, volcanic: 4, frozen: 1, toxic: 3 },
  },
];

// ============================================================================
// Planet types (the 8)
// ============================================================================

export interface PlanetTypeDef {
  id: ExpeditionPlanetType;
  label: string;
  hazardTier: HazardTier;
  hazard: number; // resolved scalar == HAZARD_TIER_SCALAR[hazardTier] (the value the engine reads)
  orbitalOnly: boolean; // Gas Giant: no surface landing; finds are satellite ops (E2c flavors it)
  // ADDITIVE per-POOL discovery biases (mirrors the sensor array's landmarkOddsBias/undergroundPoiOddsBias
  // shape). Added to the array's own biases on top of the BASE per-attempt odds in the discovery roll
  // (expedition.ts assignDiscoveriesAndActivities). A positive surfaceBias => more surface finds; a positive
  // undergroundBias => more underground finds. Models "balanced finds" vs "strong underground odds" vs "few
  // discoveries" per the mockup. FIRST-PASS TUNABLE.
  surfaceBias: number;
  undergroundBias: number;
}

// Small helper so each entry reads the hazard scalar off its tier (single source of truth for the scalar).
function planetType(
  id: ExpeditionPlanetType,
  label: string,
  hazardTier: HazardTier,
  orbitalOnly: boolean,
  surfaceBias: number,
  undergroundBias: number,
): PlanetTypeDef {
  return { id, label, hazardTier, hazard: HAZARD_TIER_SCALAR[hazardTier], orbitalOnly, surfaceBias, undergroundBias };
}

// The 8 planet types, LOCKED 2026-09-30 (names + hazard tiers + orbital-only flag are the user's calls).
// Biases FIRST-PASS TUNABLE.
export const PLANET_TYPES: readonly PlanetTypeDef[] = [
  // 1. Terrestrial: balanced finds (ruins, outposts, mixed minerals); hazard LOW.
  planetType("terrestrial", "Terrestrial", "low", false, 0.05, 0.05),
  // 2. Ocean: xeno-flora, biotech, sunken structures; surface work slower; hazard MEDIUM.
  planetType("ocean", "Ocean", "medium", false, 0.15, 0.0),
  // 3. Arid / Desert: buried ruins + preserved tech; strong UNDERGROUND odds; hazard LOW-MEDIUM.
  planetType("arid", "Arid", "lowMedium", false, 0.0, 0.2),
  // 4. Volcanic: rare/exotic minerals, few structures; hazard HIGH.
  planetType("volcanic", "Volcanic", "high", false, -0.05, 0.1),
  // 5. Frozen / Ice: preserved relics + crashed ships, best relic-survival; hazard MEDIUM.
  planetType("frozen", "Frozen", "medium", false, 0.1, 0.05),
  // 6. Gas Giant: NO LANDING, orbital scan only; its satellites host the ground activities; hazard LOW (orbital).
  planetType("gasGiant", "Gas Giant", "low", true, 0.05, -0.1),
  // 7. Barren / Airless: straightforward mining, few discoveries; hazard LOW.
  planetType("barren", "Barren", "low", false, -0.1, -0.1),
  // 8. Toxic: exotic compounds + strange life, needs a hardened team; hazard VERY HIGH.
  planetType("toxic", "Toxic", "veryHigh", false, 0.1, 0.1),
];

// ============================================================================
// Built-once lookup indexes (ids asserted globally unique + pools asserted non-empty per type)
// ============================================================================

const PLANET_TYPE_BY_ID: Map<ExpeditionPlanetType, PlanetTypeDef> = (() => {
  const map = new Map<ExpeditionPlanetType, PlanetTypeDef>();
  for (const def of PLANET_TYPES) {
    if (map.has(def.id)) throw new Error(`Duplicate planet type id: ${def.id}`);
    map.set(def.id, def);
  }
  return map;
})();

const POI_BY_ID: Map<ExpeditionPoiId, ExpeditionPoiDef> = (() => {
  const map = new Map<ExpeditionPoiId, ExpeditionPoiDef>();
  for (const def of POI_CATALOG) {
    if (map.has(def.id)) throw new Error(`Duplicate PoI id: ${def.id}`);
    map.set(def.id, def);
  }
  return map;
})();

// A PoI + its weight for one planet type (a weighted-pick candidate).
export interface WeightedPoi {
  poi: ExpeditionPoiDef;
  weight: number;
}

// The eligible PoIs per planet type, split by pool + carrying each one's weight. Built ONCE from the
// POI_CATALOG.planetWeights maps (single source of truth, no drift), so this IS the "allowed-PoI
// weighting" per planet type the discovery roll draws from. Asserts every planet type has at least one
// eligible PoI in EACH pool (so a body of any type can always yield a surface + an underground find, and
// the at-least-one-discovery guarantee always has a candidate).
const POIS_BY_PLANET_TYPE: Map<ExpeditionPlanetType, { surface: WeightedPoi[]; underground: WeightedPoi[] }> = (() => {
  const map = new Map<ExpeditionPlanetType, { surface: WeightedPoi[]; underground: WeightedPoi[] }>();
  for (const pt of PLANET_TYPES) {
    const surface: WeightedPoi[] = [];
    const underground: WeightedPoi[] = [];
    for (const poi of POI_CATALOG) {
      const weight = poi.planetWeights[pt.id];
      if (weight === undefined || weight <= 0) continue;
      (poi.pool === "surface" ? surface : underground).push({ poi, weight });
    }
    if (surface.length === 0) throw new Error(`Planet type ${pt.id} has no eligible surface PoI`);
    if (underground.length === 0) throw new Error(`Planet type ${pt.id} has no eligible underground PoI`);
    map.set(pt.id, { surface, underground });
  }
  return map;
})();

// ============================================================================
// Pure readers (for the engine + the E2c UI + tests)
// ============================================================================

// Look up a planet type def by id, or undefined. Pure reader.
export function getPlanetTypeById(id: string): PlanetTypeDef | undefined {
  return PLANET_TYPE_BY_ID.get(id as ExpeditionPlanetType);
}

// Look up a PoI def by id, or undefined. Pure reader (the E2c UI resolves a discovery/activity's poiId
// to its label + flavor through this).
export function getPoiById(id: string): ExpeditionPoiDef | undefined {
  return POI_BY_ID.get(id as ExpeditionPoiId);
}

// The eligible weighted PoIs for a planet type, split by pool. Returns EMPTY pools for an unknown id (a
// defensive default the engine never hits, since planetType is always a valid union value). Pure reader.
export function poisForPlanetType(id: string): { surface: WeightedPoi[]; underground: WeightedPoi[] } {
  return POIS_BY_PLANET_TYPE.get(id as ExpeditionPlanetType) ?? { surface: [], underground: [] };
}

// The hazard scalar for a planet type (or 0 for an unknown id). Pure convenience reader used by the
// generator to stamp a body's `hazard` from its type. Pure.
export function planetTypeHazard(id: string): number {
  return PLANET_TYPE_BY_ID.get(id as ExpeditionPlanetType)?.hazard ?? 0;
}

// ============================================================================
// Hostile sites (Squads SQ-4, design 5.3)
// ============================================================================

// The two HOSTILE SITES a risk-aware body may hold (user words "an enemy colony" / "an enemy fortification",
// names approved for now, #12). They are NOT discovery PoIs: they live outside POI_CATALOG and never enter a
// planet type's pools, so no discovery roll (legacy or new) can ever draw one. riskFactors.ts places them on a
// body; the body's scan adds one as a task when the deployed squads can field it (user #3, no softlock).
// Flavor lines are [PROPOSAL] text for the content pass.
export interface HostileSiteDef {
  id: HostileSiteId;
  label: string;
  flavor: string;
}
export const HOSTILE_SITE_CATALOG: readonly HostileSiteDef[] = [
  { id: "enemyColony", label: "Enemy Colony", flavor: "A hostile settlement dug in on the surface: clear it to work the site." },
  { id: "enemyFortification", label: "Enemy Fortification", flavor: "A fortified enemy stronghold: only several Strike squads can break it." },
];

// A hostile site def by id, or undefined. Pure.
export function getHostileSiteById(id: string): HostileSiteDef | undefined {
  return HOSTILE_SITE_CATALOG.find((def) => def.id === id);
}

// Squads SQ-6 follow-up (user, 2026-10-13): the CLEARING TASKS a dangerous body may hold (riskFactors.ts
// CLEARING_SITE_RULES), Security-only work so a Strike team has work of its own. Not discovery PoIs (outside
// POI_CATALOG, never in a pool), like the hostile sites. Labels and flavor lines are [PROPOSAL] text.
export interface ClearingSiteDef {
  id: ClearingSiteId;
  label: string;
  flavor: string;
}
export const CLEARING_SITE_CATALOG: readonly ClearingSiteDef[] = [
  { id: "clearHostiles", label: "Clear the Hostiles", flavor: "Armed hostiles hold ground near the site: drive them off before anyone digs." },
  { id: "secureLandingZone", label: "Secure the Landing Zone", flavor: "Local predators prowl the landing zone: secure it so the work can go on." },
];

// A clearing task def by id, or undefined. Pure.
export function getClearingSiteById(id: string): ClearingSiteDef | undefined {
  return CLEARING_SITE_CATALOG.find((def) => def.id === id);
}

// The player-facing name of any ground task's site: a discovery PoI, a hostile site or a clearing task, or
// undefined. Pure.
export function groundSiteLabel(id: string): string | undefined {
  return getPoiById(id)?.label ?? getHostileSiteById(id)?.label ?? getClearingSiteById(id)?.label;
}
