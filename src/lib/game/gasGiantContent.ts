// ============================================================================
// gasGiantContent.ts: Gas Giant Study (0.14.0, E-CREW Task 15b) GG-1, the CONTENT LAYER.
// Plan: docs/plans/2026-10-17-gas-giant-study-plan.md section 3.1; user answers of 2026-10-17 and 2026-10-19 (every
// gas giant call answered).
//
// PURE DATA + PURE READERS ONLY (no Svelte, no state, no draws), the posture of expeditionContent.ts. This module
// owns:
//   - GIANT_CLASSES: the giant classes by real science (user call 1, "By name + Sudarsky"): Sudarsky I to V plus
//     Ice Giant and Brown Dwarf. Each carries its mass band (its own number, integer milli-Jupiter masses), the band
//     odds of a study's canisters (Standard / Augmented / Stellar / Radiant, percent), the within-band item weights,
//     and the inputs of its derived physics (radius model, heat inflation). Shown BY NAME ("Ammonia-cloud giant,
//     Sudarsky I"), so the Sudarsky numerals never collide with drive classes or region tiers.
//   - NEBULA_KINDS: the system-level nebula sweep's four kinds (user call 2, "System-level sweep"; the four kinds
//     approved 2026-10-21). Radiant odds 0: a nebula has no magnetosphere, so no trapped antimatter.
//   - giantPhysics / starProgress: pure physics from (class, mass): radius, density, cloud-top gravity, the probe's
//     depth factor (gravity^0.4), and "how close it got to becoming a star" (the 13 and ~78 Jupiter-mass lines).
//   - The study's item ids: the six canisters (user call 5 mapping), the eight research data types (user call 9: the
//     six plus Materials and Sensors) and the Ancient Data Fragment (user call 10, "One lane"). The ITEMS rows
//     themselves live in model.ts (ITEMS is the one item registry).
//   - GAS_STUDY_SOURCE_PENDING: the study items nothing produces yet (the warehouse keeps them off its shelves until
//     GG-3 / GG-4 give them a source; the user's "hide until live" ruling for field kits).
//   - GAS_STUDY_USES: the study's engine uses, each a pending wiring registry entry owned by the slice that wires it.
//
// GG-1 IS DATA ONLY: nothing in the engine reads this module yet, so no gameplay golden moves. Every consumer is a
// registered pending entry in the wiring registry (wiring/registry.ts gasStudyEntries): the class roll (GG-2), the
// study reward and the probe dive (GG-3), the nebula sweep (GG-4), the Research Lab study lane (GG-5) and the canister
// recipe uses (GG-7). FIRST-PASS TUNABLE magnitudes; the names and the mapping are the user's calls where noted.
//
// IMPORT DIRECTION (no cycle): this file imports types from model.ts; model.ts does NOT import this file.
// ============================================================================

import { ITEMS, type ItemBand } from "./model";

// ============================================================================
// Item ids
// ============================================================================

// The six Gas Storage Canisters (user call 5, "Proposed mapping"): Standard Hydrogen and Methane, Augmented Ammonia
// and Deuterium, Stellar Helium-3, Radiant the Antimatter Containment Cell (the user's antimatter: "Not a gas, but it
// will require its own specialized container"). Each ITEMS row carries its band (ItemDef.band).
export const GAS_CANISTER_IDS = [
  "hydrogenCanister",
  "methaneCanister",
  "ammoniaCanister",
  "deuteriumCanister",
  "helium3Canister",
  "antimatterCell",
] as const;
export type GasCanisterId = (typeof GAS_CANISTER_IDS)[number];

// The research data families (user call 9, "Your six + 2"): Propulsion, Defense, Weapons, Systems, Field, Hull
// Design, plus Materials and Sensors. GG-5's lab lane banks one boost of the item's family per completed study.
export const RESEARCH_FAMILIES = ["propulsion", "defense", "weapons", "systems", "field", "hullDesign", "materials", "sensors"] as const;
export type ResearchFamily = (typeof RESEARCH_FAMILIES)[number];

// The research data item of each family (one ITEMS row each, category "researchData").
export const RESEARCH_DATA_ITEM: Readonly<Record<ResearchFamily, string>> = {
  propulsion: "propulsionData",
  defense: "defenseData",
  weapons: "weaponsData",
  systems: "systemsData",
  field: "fieldData",
  hullDesign: "hullDesignData",
  materials: "materialsData",
  sensors: "sensorsData",
};

// User call 10 (2026-10-19, "One lane"): the Ancient Data Fragment is a data type whose study decodes the next ancient
// entry (GG-5); some entries unlock special blueprints. No culture name in 0.14.0 text: names come with G3 Relics v2.
export const ANCIENT_DATA_FRAGMENT_ID = "ancientDataFragment";

// Every item the study introduces, in ITEMS order.
export function gasStudyItemIds(): string[] {
  return [...GAS_CANISTER_IDS, ...RESEARCH_FAMILIES.map((f) => RESEARCH_DATA_ITEM[f]), ANCIENT_DATA_FRAGMENT_ID];
}

// The study items with no source yet: every one but the Deuterium Canister, which the Refinery already makes from
// Deuterium Ice (REFINE_RECIPES.refineDeuteriumCanister). GG-3 (the study reward) and GG-4 (the nebula sweep) give the
// rest their source and empty this set; until then the warehouse keeps them off its shelves and out of its catalog
// count (App.svelte), so no tile points at a study that does not run yet.
export const GAS_STUDY_SOURCE_OWNER = "GG-3 (the ship's study of a gas giant returns it; GG-4 adds the nebula sweep)";
export const GAS_STUDY_SOURCE_PENDING: ReadonlySet<string> = new Set(gasStudyItemIds().filter((id) => id !== "deuteriumCanister"));

// Does this item wait on a gas study source (GAS_STUDY_SOURCE_PENDING)? False for every other item. Pure.
export function gasStudySourcePending(itemId: string): boolean {
  return GAS_STUDY_SOURCE_PENDING.has(itemId);
}

// The study's engine uses, each owned by the slice that wires it (one pending wiring registry entry per use, the
// PROSPECTING_USES precedent). A use goes live, and leaves this table, in the slice that builds it.
export const GAS_STUDY_USES = {
  classRoll: "GG-2 (an orbital body of a study run rolls its giant class and mass, and loses its ground objectives)",
  studyReward: "GG-3 (the study leg returns canisters always, research data at 40% and a Survey Log readout at 15%)",
  probeDive: "GG-3 (a Galileo-Class Probe dives: fieldwork is study speed, hazard resist the crush rating, relic find the ancient data odds)",
  nebulaSweep: "GG-4 (the ship sweeps the system's nebula after the bodies)",
  labLane: "GG-5 (the Research Lab study lane studies held data into family boosts and decodes ancient entries)",
  canisterRecipes: "GG-7 (canisters feed the G2 drive classes and the Lab tier 3 to 7 blueprints)",
} as const;
export type GasStudyUse = keyof typeof GAS_STUDY_USES;

// The canisters of one band, in GAS_CANISTER_IDS order, read off each ITEMS row's band. Pure.
export function canistersInBand(band: ItemBand): GasCanisterId[] {
  return GAS_CANISTER_IDS.filter((id) => ITEMS[id]?.band === band);
}

// ============================================================================
// Band odds and item weights (shared by giants and nebulae)
// ============================================================================

// The bands low to high: the order GG-3's band draw walks the class odds in (plan section 3.4, draw (6)).
export const ITEM_BANDS: readonly ItemBand[] = ["standard", "augmented", "stellar", "radiant"];

// The band a canister rolls, in percent (sums to 100; the study's draw (6), plan section 3.4).
export type BandOdds = Readonly<Record<ItemBand, number>>;

// The item within its band (the study's draw (7)): an integer weight per canister. A one-item band weighs 1.
export type CanisterWeights = Readonly<Record<GasCanisterId, number>>;

function weights(hydrogen: number, methane: number, ammonia: number, deuterium: number): CanisterWeights {
  return { hydrogenCanister: hydrogen, methaneCanister: methane, ammoniaCanister: ammonia, deuteriumCanister: deuterium, helium3Canister: 1, antimatterCell: 1 };
}

function odds(standard: number, augmented: number, stellar: number, radiant: number): BandOdds {
  return { standard, augmented, stellar, radiant };
}

// ============================================================================
// Giant classes (user call 1)
// ============================================================================

export type GiantClassId = "sudarskyI" | "sudarskyII" | "sudarskyIII" | "sudarskyIV" | "sudarskyV" | "iceGiant" | "brownDwarf";

// Which radius model the physics uses: a gas giant (radius flat near one Jupiter radius above a Jupiter mass), an ice
// giant (Uranus and Neptune sized) or a brown dwarf (shrinking slightly as it gets heavier).
export type GiantRadiusModel = "giant" | "ice" | "brownDwarf";

export interface GiantClassDef {
  id: GiantClassId;
  name: string; // the display name, sentence case ("Ammonia-cloud giant")
  sudarsky?: "I" | "II" | "III" | "IV" | "V"; // the Sudarsky class, shown after the name; absent on Ice Giant and Brown Dwarf
  weight: number; // the class roll's integer weight (GG-2; approved 2026-10-21)
  massMinMilliJ: number; // the mass band, integer milli-Jupiter masses (the mass is its own roll inside it, GG-2)
  massMaxMilliJ: number;
  radiusModel: GiantRadiusModel;
  inflation: number; // heat puffs a hot giant up: radius x this (1 = none)
  bandOdds: BandOdds;
  itemWeights: CanisterWeights;
  temperature: string;
  example: string;
  gases: string;
  feature: string;
}

// The seven classes. Mass bands from the science (design section 2): a planet stops below 13 Jupiter masses (the
// deuterium-burning line), an ice giant sits near Uranus and Neptune (0.03 to 0.08), a brown dwarf runs from 13 to
// the ~78 hydrogen-fusion line. Band odds and item weights are the v2 mockup's [PROPOSAL] table; the class weights
// were approved by the user on 2026-10-21 (a cold Sudarsky I and an ice giant are the common sights, a brown dwarf the
// rare one).
export const GIANT_CLASSES: readonly GiantClassDef[] = [
  {
    id: "sudarskyI",
    name: "Ammonia-cloud giant",
    sudarsky: "I",
    weight: 4,
    massMinMilliJ: 100,
    massMaxMilliJ: 13_000,
    radiusModel: "giant",
    inflation: 1,
    bandOdds: odds(66, 26, 6, 2),
    itemWeights: weights(3, 1, 3, 1),
    temperature: "below about 150 K",
    example: "Jupiter, Saturn",
    gases: "hydrogen, helium, methane, ammonia, water; traces of deuterium and helium-3",
    feature: "A storm wider than Earth that has raged for centuries",
  },
  {
    id: "sudarskyII",
    name: "Water-cloud giant",
    sudarsky: "II",
    weight: 2,
    massMinMilliJ: 100,
    massMaxMilliJ: 13_000,
    radiusModel: "giant",
    inflation: 1,
    bandOdds: odds(68, 25, 6, 1),
    itemWeights: weights(3, 1, 1, 1),
    temperature: "below about 250 K",
    example: "47 Ursae Majoris b (predicted)",
    gases: "hydrogen, helium, water vapor, methane, ammonia gas",
    feature: "A brilliant white world: its water clouds reflect most of the light that reaches them",
  },
  {
    id: "sudarskyIII",
    name: "Cloudless giant",
    sudarsky: "III",
    weight: 2,
    massMinMilliJ: 100,
    massMaxMilliJ: 13_000,
    radiusModel: "giant",
    inflation: 1.05,
    bandOdds: odds(70, 22, 7, 1),
    itemWeights: weights(2, 1, 1, 2),
    temperature: "about 350 to 800 K",
    example: "warm giants on tight orbits",
    gases: "hydrogen, helium, methane, water vapor",
    feature: "A clear azure sky, with nothing to hide the deep layers",
  },
  {
    id: "sudarskyIV",
    name: "Alkali-metal giant",
    sudarsky: "IV",
    weight: 1,
    massMinMilliJ: 100,
    massMaxMilliJ: 13_000,
    radiusModel: "giant",
    inflation: 1.25,
    bandOdds: odds(66, 24, 9, 1),
    itemWeights: weights(6, 1, 1, 3),
    temperature: "above about 900 K",
    example: "hot Jupiters",
    gases: "hydrogen, helium, carbon monoxide, water vapor, sodium, potassium",
    feature: "Darker than charcoal: sodium and potassium vapor drink the light",
  },
  {
    id: "sudarskyV",
    name: "Silicate-cloud giant",
    sudarsky: "V",
    weight: 1,
    massMinMilliJ: 100,
    massMaxMilliJ: 13_000,
    radiusModel: "giant",
    inflation: 1.4,
    bandOdds: odds(62, 26, 11, 1),
    itemWeights: weights(8, 1, 1, 4),
    temperature: "above about 1,400 K",
    example: "51 Pegasi b",
    gases: "hydrogen, helium, carbon monoxide, vaporized rock and iron",
    feature: "Silicate and iron clouds glowing red on the night side",
  },
  {
    id: "iceGiant",
    name: "Ice giant",
    weight: 3,
    massMinMilliJ: 30,
    massMaxMilliJ: 80,
    radiusModel: "ice",
    inflation: 1,
    bandOdds: odds(64, 30, 5, 1),
    itemWeights: weights(1, 3, 3, 1),
    temperature: "about 50 to 80 K",
    example: "Uranus, Neptune",
    gases: "hydrogen, helium, methane, ammonia, water, hydrogen sulfide",
    feature: "Winds over 2,000 km/h, the fastest in the solar system",
  },
  {
    id: "brownDwarf",
    name: "Brown dwarf",
    weight: 1,
    massMinMilliJ: 13_000,
    massMaxMilliJ: 78_000,
    radiusModel: "brownDwarf",
    inflation: 1,
    bandOdds: odds(55, 30, 12, 3),
    itemWeights: weights(3, 1, 1, 1),
    temperature: "about 300 to 2,500 K",
    example: "Luhman 16, 6.5 light-years away",
    gases: "hydrogen, helium, helium-3, methane or carbon monoxide (by temperature)",
    feature: "Auroras far brighter than any in our solar system",
  },
];

const GIANT_CLASS_BY_ID = new Map(GIANT_CLASSES.map((c) => [c.id, c] as const));

export function giantClassById(id: GiantClassId): GiantClassDef | undefined {
  return GIANT_CLASS_BY_ID.get(id);
}

// The display name (user call 1: "shown by name"): "Ammonia-cloud giant, Sudarsky I"; "Ice giant"; "Brown dwarf".
export function giantClassDisplayName(def: Pick<GiantClassDef, "name" | "sudarsky">): string {
  return def.sudarsky ? `${def.name}, Sudarsky ${def.sudarsky}` : def.name;
}

// ============================================================================
// Derived physics (pure; the v2 mockup's planetPhys)
// ============================================================================

// Jupiter's mean density in g/cm3: a one-Jupiter-mass body of one Jupiter radius reads this.
export const JUPITER_DENSITY_G_CM3 = 1.326;
// The deuterium-burning line (a brown dwarf, "the failed star" line) and the hydrogen-fusion line (a true star), in
// milli-Jupiter masses.
export const DEUTERIUM_BURNING_MILLI_J = 13_000;
export const HYDROGEN_FUSION_MILLI_J = 78_000;
// The probe's depth factor is the cloud-top gravity (Jupiter = 1) to this power: heavier, denser giants dive deeper.
export const DEPTH_FACTOR_EXPONENT = 0.4;

export interface GiantPhysics {
  radiusRj: number; // Jupiter radii
  densityGcm3: number; // g/cm3 (water is 1)
  gravityRel: number; // cloud-top gravity, Jupiter = 1
  depthFactor: number; // gravityRel ^ DEPTH_FACTOR_EXPONENT
}

// The physics of a giant of class `def` and mass `massMilliJ` (integer milli-Jupiter masses). Pure.
export function giantPhysics(def: Pick<GiantClassDef, "radiusModel" | "inflation">, massMilliJ: number): GiantPhysics {
  const m = massMilliJ / 1000;
  let r: number;
  if (def.radiusModel === "ice") r = 0.355 * Math.pow(m / 0.05, 0.1);
  else if (def.radiusModel === "brownDwarf") r = 1 - (0.2 * Math.log(m / 13)) / Math.log(75 / 13);
  else r = m >= 1 ? 1 : 0.84 + (0.16 * Math.log(m / 0.3)) / Math.log(1 / 0.3);
  r *= def.inflation;
  const gravityRel = m / (r * r);
  return { radiusRj: r, densityGcm3: (JUPITER_DENSITY_G_CM3 * m) / (r * r * r), gravityRel, depthFactor: Math.pow(gravityRel, DEPTH_FACTOR_EXPONENT) };
}

// "How close it got to becoming a star" (D22): the mass as a share of the deuterium-burning line and of the
// hydrogen-fusion line. A brown dwarf crossed the first (deuteriumShare >= 1). Pure.
export function starProgress(massMilliJ: number): { deuteriumShare: number; fusionShare: number } {
  return { deuteriumShare: massMilliJ / DEUTERIUM_BURNING_MILLI_J, fusionShare: massMilliJ / HYDROGEN_FUSION_MILLI_J };
}

// ============================================================================
// Nebula kinds (user call 2: a system-level sweep; the four kinds approved 2026-10-21)
// ============================================================================

export type NebulaKindId = "molecularCloud" | "emissionNebula" | "planetaryNebula" | "supernovaRemnant";

export interface NebulaKindDef {
  id: NebulaKindId;
  name: string;
  stage: 0 | 1 | 2 | 3; // the stellar life cycle: a nursery, its first stars, a dying star's shell, an exploded star
  bandOdds: BandOdds; // radiant is 0 on every kind
  itemWeights: CanisterWeights;
  example: string;
  gases: string;
  feature: string;
}

export const NEBULA_KINDS: readonly NebulaKindDef[] = [
  {
    id: "molecularCloud",
    name: "Molecular cloud",
    stage: 0,
    bandOdds: odds(70, 27, 3, 0),
    itemWeights: weights(2, 1, 3, 1),
    example: "Barnard 68, the Horsehead Nebula",
    gases: "molecular hydrogen, carbon monoxide, water, ammonia, methanol and other organics",
    feature: "Dense cores are collapsing into stars right now",
  },
  {
    id: "emissionNebula",
    name: "Emission nebula",
    stage: 1,
    bandOdds: odds(72, 22, 6, 0),
    itemWeights: weights(9, 1, 1, 3),
    example: "the Orion Nebula, 1,344 light-years away",
    gases: "ionized hydrogen, helium, traces of oxygen and nitrogen",
    feature: "Lit from inside by a cluster of hot young stars",
  },
  {
    id: "planetaryNebula",
    name: "Planetary nebula",
    stage: 2,
    bandOdds: odds(64, 30, 6, 0),
    itemWeights: weights(1, 1, 4, 1),
    example: "the Ring Nebula (M57)",
    gases: "hydrogen, helium, carbon, nitrogen, oxygen",
    feature: "A glowing shell still expanding from the white dwarf at its heart",
  },
  {
    id: "supernovaRemnant",
    name: "Supernova remnant",
    stage: 3,
    bandOdds: odds(58, 27, 15, 0),
    itemWeights: weights(3, 1, 1, 1),
    example: "the Crab Nebula, from the supernova seen in 1054",
    gases: "hydrogen, helium, oxygen, silicon, sulfur, iron and heavier",
    feature: "A pulsar at its center, spinning about 30 times a second",
  },
];

const NEBULA_KIND_BY_ID = new Map(NEBULA_KINDS.map((k) => [k.id, k] as const));

export function nebulaKindById(id: NebulaKindId): NebulaKindDef | undefined {
  return NEBULA_KIND_BY_ID.get(id);
}
