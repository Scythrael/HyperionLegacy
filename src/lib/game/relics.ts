// ============================================================================
// relics.ts: Exploration 0.14.0 (Phase E4a): the RELIC CATALOG + MUSEUM MATH.
//
// Relics + artifacts are ONE combined system (user, 2026-10-01): an expedition relic
// arrives UNIDENTIFIED, Research STUDIES it to reveal which relic it is (a FIRST FIND of
// a type is the discovery unlock), and every identified copy goes to the MUSEUM, where it
// earns a per-copy passive and feeds the K-piece SET TIERS that level on the doubling copy
// ladder, bottlenecked by the least-collected required relic.
//
// PURE DATA + PURE READERS ONLY (no Svelte, no state mutation, no side effects), the
// exact posture of expeditionContent.ts / sensorArrays.ts. This module owns:
//   - RELIC_SETS + RELICS: the four LOCKED sets (approved "Relic Museum" mockup,
//     2026-10-01: "10/10, make it so") and their 17 relics, in K-piece order.
//   - RELIC_SET_BY_POI: the ONE source of truth mapping an expedition PoI to the relic set
//     it sources. BOTH the gambit reward relic roll (gambit.ts) AND the E2c foreknowledge
//     relic signature (expedition.ts) read it, so the two can never drift.
//   - MuseumStat: the closed union of stat ids the museum grants (E4b wires consumers).
//   - The museum math constants (per-copy passive, the copy ladder, the per-level tier
//     bonus) + the identification tier-skew weights + the study duration constants.
//   - identifyRelic: the keyed deterministic identification roll a completed study runs.
//   - Museum readers: relicCopyLevel, setTierLevels (with bottleneck info for the E4c UI),
//     setCompletion, museumBonuses (Record<MuseumStat, number>).
//   - Relics v2 R2-1 (end of file): the v2 catalog (RELIC_TYPES, the band and exceptional odds tables, the
//     exceptional sets, the soft cap, the culture roster), read by the later Relics v2 slices.
//   - Relics v2 R2-4 (end of file): MUSEUM MATH V2 (Tier I through the v1 math, Tiers II to VII through the D23 curve,
//     exceptional flats, the per-tier soft cap snapshot) and the pure Museum v2 deposits every writer goes through.
//
// ⚠️ ADDITIVE-NEUTRAL SEAM FOR E4b: museumBonuses on an empty museum is ALL ZEROS, so
// wiring a consumer later as `base * (1 + bonus)` or `base + bonus` changes nothing for a
// save with no identified relics. E4b wires every stat into its live consumer (see museumBonuses).
//
// ⚠️ ALL NUMERIC CONSTANTS BELOW ARE FIRST-PASS TUNABLE (the per-copy passive, the ladder,
// the per-level bonus, the capstone multiplier, the tier-skew weights, the study durations),
// the same posture as SHIP_TYPES / expeditionContent.ts. The NAMES, set membership, piece
// order, sources and stat assignments are the user's locked content calls.
//
// IMPORT DIRECTION (no cycle): this file imports TYPES only from model.ts and
// expeditionContent.ts, plus the leaf PRNG (combat/rng.ts) and the leaf D23 curve (diminishing.ts). model.ts does NOT import this
// file (RelicSetId + RelicVaultToken are declared there as plain shapes), so the arrow is
// one-way, the same arrangement expeditionContent.ts has with model.ts.
// ============================================================================

import type { EquipmentRarity, GameState, MuseumV2, RegionTier, RegionTierKey, RelicSetId } from "./model";
import type { ExpeditionPoiId } from "./expeditionContent";
import { makeRng } from "./combat/rng";
import { diminishing } from "./diminishing";

// ============================================================================
// Stats (the closed union E4b wires into consumers)
// ============================================================================

// Every stat a relic set grants. CLOSED on purpose: a new stat is a compile-time decision, and
// museumBonuses returns a full Record over this union (every key present, zero by default), so an E4b
// consumer never has to guard a missing key.
export type MuseumStat =
  // Precursor
  | "researchSpeed"
  | "craftingQuality"
  | "relicFindChance"
  // Shipwright
  | "cargoCapacity"
  | "transitSpeed"
  | "salvageYield"
  // Xenobiology
  | "sensors"
  | "scanSpeed"
  | "scienceTeamPower"
  | "crewBonuses"
  // Deep Earth
  | "miningYield"
  | "rareMaterialChance"
  | "extractionSpeed"
  | "hazardResist";

// The stat ids in a fixed canonical order (the iteration order museumBonuses seeds its Record in).
export const MUSEUM_STATS: readonly MuseumStat[] = [
  "researchSpeed",
  "craftingQuality",
  "relicFindChance",
  "cargoCapacity",
  "transitSpeed",
  "salvageYield",
  "sensors",
  "scanSpeed",
  "scienceTeamPower",
  "crewBonuses",
  "miningYield",
  "rareMaterialChance",
  "extractionSpeed",
  "hazardResist",
];

// ============================================================================
// FIRST-PASS TUNABLE museum math (from the user's own notes; the open "PIN AT DESIGN TIME")
// ============================================================================

// PER-COPY PASSIVE: every identified copy of ANY relic in a set adds this fraction of the set's
// per-copy stat (0.001 = +0.1% per copy).
export const MUSEUM_PER_COPY_BONUS = 0.001;

// The doubling COPY LADDER. A relic's copy LEVEL is how many of these thresholds its copy count meets;
// a set tier's LEVEL is the copy level of its LEAST-collected required relic (the BOTTLENECK rule).
export const MUSEUM_COPY_LADDER: readonly number[] = [10, 20, 40, 80, 160];

// Each set-tier LEVEL adds this fraction of each of the tier's stats (0.005 = +0.5% per level), additive.
export const MUSEUM_TIER_LEVEL_BONUS = 0.005;

// The CAPSTONE tier's per-level magnitude multiplier (the Precursor 5-piece "larger boon"). TUNABLE.
export const MUSEUM_CAPSTONE_MAGNITUDE = 2;

// ============================================================================
// FIRST-PASS TUNABLE relic study (identification) constants
// ============================================================================

// Concurrent relic studies: Relics v2 R2-3 replaced the single first-pass lane with lanes by Research Lab level
// (relicIdentify.ts RELIC_STUDY_LANES_BY_LAB, user call 12: Lab I 1, III 2, V 3, VII 4), still separate from
// blueprint research so studying never blocks a research project.

// The base study duration (ticks; 1 tick == 1 second at the default cadence), scaled by the token's
// rarity tier: a rarer relic takes longer to read (user call 12 "10 minutes x rarity": standard 10 min,
// augmented 15, stellar 20, radiant 30).
export const RELIC_STUDY_BASE_TICKS = 600; // ~10 min IRL for a standard relic
export const RELIC_STUDY_TIER_MULT: Readonly<Record<EquipmentRarity, number>> = {
  derelict: 1,
  standard: 1,
  augmented: 1.5,
  stellar: 2,
  radiant: 3,
  luminous: 3,
  constellar: 3,
};

// The study duration for a token of the given tier, in whole ticks. Pure.
export function relicStudyDurationTicks(tier: EquipmentRarity): number {
  // RR-1: an OWN finite entry only (an inherited name such as "constructor" would otherwise read a function and give
  // a NaN duration, a study lane that never finishes).
  const m = Object.prototype.hasOwnProperty.call(RELIC_STUDY_TIER_MULT, tier) ? RELIC_STUDY_TIER_MULT[tier] : undefined;
  return Math.max(1, Math.round(RELIC_STUDY_BASE_TICKS * (typeof m === "number" && Number.isFinite(m) ? m : 1)));
}

// ============================================================================
// Relic + set catalog (LOCKED content, approved mockup 2026-10-01)
// ============================================================================

// A relic's rarity class within its set. Each set runs common -> ... -> capstone in piece order.
export type RelicRarity = "common" | "uncommon" | "rare" | "capstone";

export interface RelicDef {
  id: string;
  label: string;
  setId: RelicSetId;
  index: number; // 1-based K-piece position in its set (relic 1..K are required for the K-piece tier)
  rarity: RelicRarity;
  flavor: string; // short evocative line (the E4c Museum card surfaces it)
}

// One K-piece set tier: requires relics 1..pieces; each tier level adds MUSEUM_TIER_LEVEL_BONUS *
// magnitude to EACH listed stat (a capstone lists two stats + a larger magnitude).
export interface RelicSetTierDef {
  pieces: number;
  stats: readonly MuseumStat[];
  magnitude: number; // per-level multiplier on MUSEUM_TIER_LEVEL_BONUS (1, or MUSEUM_CAPSTONE_MAGNITUDE)
  capstone: boolean;
}

export interface RelicSetDef {
  id: RelicSetId;
  label: string;
  sources: readonly ExpeditionPoiId[]; // the PoIs whose relics identify WITHIN this set
  perCopyStat: MuseumStat; // every copy of any relic in the set adds MUSEUM_PER_COPY_BONUS of this
  relicIds: readonly string[]; // the set's relics in K-piece order (index 1..K)
  tiers: readonly RelicSetTierDef[]; // ascending by pieces (2..K)
}

// The 17 relics, in set order then K-piece order. LOCKED names/rarities/order.
export const RELICS: readonly RelicDef[] = [
  // --- PRECURSOR SET -------------------------------------------------------------------------------
  {
    id: "glyphTablet",
    label: "Glyph Tablet",
    setId: "precursor",
    index: 1,
    rarity: "common",
    flavor: "Row upon row of patient carving. Half of it is a lesson, and the other half is a warning.",
  },
  {
    id: "resonanceShard",
    label: "Resonance Shard",
    setId: "precursor",
    index: 2,
    rarity: "uncommon",
    flavor: "It rings when held near another of its kind, a single clear note that never fades.",
  },
  {
    id: "starChartFragment",
    label: "Star-Chart Fragment",
    setId: "precursor",
    index: 3,
    rarity: "uncommon",
    flavor: "The constellations are wrong by a few thousand years. The routes between them are not.",
  },
  {
    id: "precursorLens",
    label: "Precursor Lens",
    setId: "precursor",
    index: 4,
    rarity: "rare",
    flavor: "Look through it at a blank wall and you will see the writing that used to be there.",
  },
  {
    id: "heartOfTheArchive",
    label: "Heart of the Archive",
    setId: "precursor",
    index: 5,
    rarity: "capstone",
    flavor: "Warm to the touch and slowly pulsing. Everything they knew is still in here, waiting to be asked.",
  },
  // --- SHIPWRIGHT SET ------------------------------------------------------------------------------
  {
    id: "hullRivet",
    label: "Hull Rivet",
    setId: "shipwright",
    index: 1,
    rarity: "common",
    flavor: "A single rivet, forged from an alloy no yard in the fleet can match. It held for ten thousand years.",
  },
  {
    id: "flightRecorder",
    label: "Flight Recorder",
    setId: "shipwright",
    index: 2,
    rarity: "uncommon",
    flavor: "The last entry is a calm voice reading coordinates, over and over, until the power ran out.",
  },
  {
    id: "ancientDriveCoil",
    label: "Ancient Drive Coil",
    setId: "shipwright",
    index: 3,
    rarity: "rare",
    flavor: "Still faintly humming. Whoever wound it knew a way through the dark that the fleet has forgotten.",
  },
  {
    id: "captainsSigil",
    label: "Captain's Sigil",
    setId: "shipwright",
    index: 4,
    rarity: "capstone",
    flavor: "Worn smooth by a thumb that rubbed it before every jump. Command is older than any of us.",
  },
  // --- XENOBIOLOGY SET -----------------------------------------------------------------------------
  {
    id: "sporeCapsule",
    label: "Spore Capsule",
    setId: "xenobiology",
    index: 1,
    rarity: "common",
    flavor: "Dormant, sealed, and patient. It is waiting for a world worth waking up on.",
  },
  {
    id: "bioluminescentSeed",
    label: "Bioluminescent Seed",
    setId: "xenobiology",
    index: 2,
    rarity: "uncommon",
    flavor: "It glows a little brighter whenever someone in the lab is speaking. Nobody has explained why.",
  },
  {
    id: "leviathanScale",
    label: "Leviathan Scale",
    setId: "xenobiology",
    index: 3,
    rarity: "rare",
    flavor: "One scale, wide as a cargo hatch. Somewhere out there is the rest of the animal.",
  },
  {
    id: "livingCrystal",
    label: "Living Crystal",
    setId: "xenobiology",
    index: 4,
    rarity: "capstone",
    flavor: "It grows by a fraction of a millimeter each night, always toward the nearest living thing.",
  },
  // --- DEEP EARTH SET ------------------------------------------------------------------------------
  {
    id: "geodeCore",
    label: "Geode Core",
    setId: "deepEarth",
    index: 1,
    rarity: "common",
    flavor: "Crack it open and the light inside is older than the planet that held it.",
  },
  {
    id: "magmaPearl",
    label: "Magma Pearl",
    setId: "deepEarth",
    index: 2,
    rarity: "uncommon",
    flavor: "Polished by a river of molten rock, it never quite cools all the way down.",
  },
  {
    id: "deepVeinCompass",
    label: "Deep-Vein Compass",
    setId: "deepEarth",
    index: 3,
    rarity: "rare",
    flavor: "Its needle ignores north entirely. It only ever points toward something worth digging up.",
  },
  {
    id: "tectonicKeystone",
    label: "Tectonic Keystone",
    setId: "deepEarth",
    index: 4,
    rarity: "capstone",
    flavor: "Set it on the ground and the ground settles. Whole continents once turned on stones like this.",
  },
];

// Helper: a non-capstone tier granting one stat at magnitude 1.
function tier(pieces: number, stat: MuseumStat): RelicSetTierDef {
  return { pieces, stats: [stat], magnitude: 1, capstone: false };
}

// The four relic SETS. Sources, per-copy stat, and tier stats are LOCKED (approved mockup).
export const RELIC_SETS: readonly RelicSetDef[] = [
  {
    id: "precursor",
    label: "Precursor Set",
    sources: ["subterraneanCivilization", "buriedVault", "ancientRuins"],
    perCopyStat: "researchSpeed",
    relicIds: ["glyphTablet", "resonanceShard", "starChartFragment", "precursorLens", "heartOfTheArchive"],
    tiers: [
      tier(2, "researchSpeed"),
      tier(3, "craftingQuality"),
      tier(4, "relicFindChance"),
      // The 5-piece CAPSTONE: a larger research-speed + crafting-quality boon.
      { pieces: 5, stats: ["researchSpeed", "craftingQuality"], magnitude: MUSEUM_CAPSTONE_MAGNITUDE, capstone: true },
    ],
  },
  {
    id: "shipwright",
    label: "Shipwright Set",
    sources: ["crashedShip", "derelictOutpost"],
    perCopyStat: "cargoCapacity",
    relicIds: ["hullRivet", "flightRecorder", "ancientDriveCoil", "captainsSigil"],
    tiers: [tier(2, "transitSpeed"), tier(3, "cargoCapacity"), tier(4, "salvageYield")],
  },
  {
    id: "xenobiology",
    label: "Xenobiology Set",
    sources: ["xenoFloraBloom"],
    perCopyStat: "sensors",
    relicIds: ["sporeCapsule", "bioluminescentSeed", "leviathanScale", "livingCrystal"],
    tiers: [tier(2, "scanSpeed"), tier(3, "scienceTeamPower"), tier(4, "crewBonuses")],
  },
  {
    id: "deepEarth",
    label: "Deep Earth Set",
    sources: ["caveNetwork", "geothermalChamber", "mineralOutcrop"],
    perCopyStat: "miningYield",
    relicIds: ["geodeCore", "magmaPearl", "deepVeinCompass", "tectonicKeystone"],
    tiers: [tier(2, "rareMaterialChance"), tier(3, "extractionSpeed"), tier(4, "hazardResist")],
  },
];

// ============================================================================
// Built-once indexes (ids asserted unique; set rosters asserted consistent with RELICS)
// ============================================================================

const RELIC_BY_ID: Map<string, RelicDef> = (() => {
  const map = new Map<string, RelicDef>();
  for (const def of RELICS) {
    if (map.has(def.id)) throw new Error(`Duplicate relic id: ${def.id}`);
    map.set(def.id, def);
  }
  return map;
})();

const RELIC_SET_BY_ID: Map<RelicSetId, RelicSetDef> = (() => {
  const map = new Map<RelicSetId, RelicSetDef>();
  for (const set of RELIC_SETS) {
    if (map.has(set.id)) throw new Error(`Duplicate relic set id: ${set.id}`);
    // Each roster entry must be a real relic of THIS set, at its declared 1-based index.
    set.relicIds.forEach((rid, i) => {
      const def = RELIC_BY_ID.get(rid);
      if (!def || def.setId !== set.id || def.index !== i + 1) {
        throw new Error(`Relic set ${set.id} roster mismatch at position ${i + 1}: ${rid}`);
      }
    });
    for (const t of set.tiers) {
      if (t.pieces < 2 || t.pieces > set.relicIds.length) throw new Error(`Relic set ${set.id} has an out-of-range ${t.pieces}-piece tier`);
    }
    map.set(set.id, set);
  }
  return map;
})();

// ============================================================================
// PoI -> relic set: the ONE source of truth (gambit reward roll + foreknowledge signature)
// ============================================================================

// Built from RELIC_SETS[].sources so the mapping lives in exactly one place (the set's own source list).
// A PoI sources at most ONE set (asserted). A PoI absent from every set's sources is NOT relic-bearing.
export const RELIC_SET_BY_POI: Readonly<Partial<Record<ExpeditionPoiId, RelicSetId>>> = (() => {
  const map: Partial<Record<ExpeditionPoiId, RelicSetId>> = {};
  for (const set of RELIC_SETS) {
    for (const poi of set.sources) {
      if (map[poi] !== undefined) throw new Error(`PoI ${poi} sources two relic sets`);
      map[poi] = set.id;
    }
  }
  return map;
})();

// The relic-bearing PoIs as a set (derived from RELIC_SET_BY_POI, never hand-listed).
export const RELIC_BEARING_POIS: ReadonlySet<string> = new Set<string>(Object.keys(RELIC_SET_BY_POI));

// The relic set a PoI sources, or null when the PoI is not relic-bearing (or unknown). Pure.
export function relicSetForPoi(poiId: string | undefined): RelicSetId | null {
  if (poiId === undefined) return null;
  return RELIC_SET_BY_POI[poiId as ExpeditionPoiId] ?? null;
}

// Is this PoI relic-bearing (sources some set)? The single predicate gambit.ts + expedition.ts read.
export function isRelicBearingPoi(poiId: string | undefined): boolean {
  return relicSetForPoi(poiId) !== null;
}

// ============================================================================
// Pure catalog readers
// ============================================================================

export function getRelicById(id: string): RelicDef | undefined {
  return RELIC_BY_ID.get(id);
}

export function getRelicSetById(id: string): RelicSetDef | undefined {
  return RELIC_SET_BY_ID.get(id as RelicSetId);
}

// ============================================================================
// E4d: the MASKED Research-catalog copy for a discovery-gated blueprint
// ============================================================================

// What the Research catalog shows for a blueprint still locked behind an UNDISCOVERED relic
// (model.ts blueprintRelicLocked). It names the relic's SET, never the relic itself, so the card cannot
// spoil a find the player has not made (the project's own name stays hidden too: the card shows only this
// title + detail). An unknown / absent relic id falls back to a neutral phrase rather than leaking an id.
// The ONE source of this wording: the masked card and the disabled-button block text both read it. Pure.
export function undiscoveredResearchMask(relicId: string | undefined): { title: string; detail: string } {
  const relic = relicId !== undefined ? RELIC_BY_ID.get(relicId) : undefined;
  const setLabel = relic ? RELIC_SET_BY_ID.get(relic.setId)?.label : undefined;
  return {
    title: "Undiscovered research",
    detail: setLabel ? `Requires a ${setLabel} relic discovery` : "Requires a relic discovery",
  };
}

// ============================================================================
// Identification (the keyed, tier-skewed roll a completed study runs)
// ============================================================================

// The four rarity TIERS the reward roll actually produces (SALVAGE_LOOT_POOLS standard..radiant). The
// reserved ladder ends fold onto the nearest produced tier: derelict reads as standard, luminous /
// constellar read as radiant.
type SkewTier = "standard" | "augmented" | "stellar" | "radiant";
function skewTierOf(tier: EquipmentRarity): SkewTier {
  switch (tier) {
    case "augmented":
    case "stellar":
    case "radiant":
      return tier;
    case "luminous":
    case "constellar":
      return "radiant";
    default:
      return "standard"; // standard + derelict
  }
}

// IDENTIFICATION TIER SKEW: the relative weight of each relic RARITY CLASS for a token of a given tier.
// A standard token mostly reveals low-index (common/uncommon) relics; a radiant token has strong odds
// of a rare or the capstone. The class is picked first (weighted over the classes the set actually
// has), then a relic uniformly within the class, so a set with two uncommons splits the uncommon share
// between them. FIRST-PASS TUNABLE.
export const RELIC_RARITY_WEIGHTS_BY_TIER: Readonly<Record<SkewTier, Readonly<Record<RelicRarity, number>>>> = {
  standard: { common: 60, uncommon: 30, rare: 9, capstone: 1 },
  augmented: { common: 40, uncommon: 35, rare: 20, capstone: 5 },
  stellar: { common: 20, uncommon: 30, rare: 35, capstone: 15 },
  radiant: { common: 10, uncommon: 20, rare: 40, capstone: 30 },
};

const RELIC_RARITY_ORDER: readonly RelicRarity[] = ["common", "uncommon", "rare", "capstone"];

// A fixed decorrelation salt for the identification roll (do NOT reuse across purposes).
// Exported (Ground Ops GO-5) only so salts.test.ts can check it against every other engine salt.
export const RELIC_STUDY_SALT = 0x6a09e667;

// Derive the identification roll's seed from (relicSeed, salt, studyIndex, tokenId). Mixing the token
// id in means the study ORDER cannot launder a preferred result onto a different token (the same hole
// inspectRollSeed closes for blanks). A small FNV-style string mix over the keyed base. Pure uint32.
export function relicStudySeed(relicSeed: number, studyIndex: number, tokenId: string): number {
  let h = ((relicSeed >>> 0) ^ RELIC_STUDY_SALT ^ Math.imul(studyIndex >>> 0, 0x9e3779b9)) >>> 0;
  for (let i = 0; i < tokenId.length; i++) {
    h = Math.imul(h ^ tokenId.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// IDENTIFY a token: pick a relic WITHIN its set, skewed by its tier. A pure function of (setId, tier,
// seed): the same inputs always reveal the same relic, independent of when or how the study was
// resolved (offline == live by construction). Draw order: the rarity-class pick, then the in-class pick,
// both from ONE makeRng(seed) stream. Returns the relic id, or null for an unknown set (a tampered save;
// the caller then grants nothing).
export function identifyRelic(setId: RelicSetId, tier: EquipmentRarity, seed: number): string | null {
  const set = RELIC_SET_BY_ID.get(setId);
  if (!set) return null;
  const weights = RELIC_RARITY_WEIGHTS_BY_TIER[skewTierOf(tier)];
  // Group the set's relics by rarity class (preserving piece order within a class).
  const classes: { rarity: RelicRarity; weight: number; relicIds: string[] }[] = [];
  for (const rarity of RELIC_RARITY_ORDER) {
    const relicIds = set.relicIds.filter((rid) => RELIC_BY_ID.get(rid)?.rarity === rarity);
    if (relicIds.length > 0 && weights[rarity] > 0) classes.push({ rarity, weight: weights[rarity], relicIds });
  }
  if (classes.length === 0) return set.relicIds[0] ?? null; // defensive: unreachable for the locked sets
  const rng = makeRng(seed >>> 0);
  let total = 0;
  for (const c of classes) total += c.weight;
  let roll = rng.nextInt(total);
  let picked = classes[classes.length - 1];
  for (const c of classes) {
    roll -= c.weight;
    if (roll < 0) {
      picked = c;
      break;
    }
  }
  return picked.relicIds[rng.nextInt(picked.relicIds.length)];
}

// ============================================================================
// Museum readers (pure)
// ============================================================================

// The copy count of a relic in a museum record (0 when absent). Pure.
export function relicCopies(museum: Readonly<Record<string, number>>, relicId: string): number {
  const n = museum[relicId] ?? 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// A relic's copy LEVEL: how many MUSEUM_COPY_LADDER thresholds its copy count meets (0..ladder length).
export function relicCopyLevel(copies: number): number {
  let level = 0;
  for (const threshold of MUSEUM_COPY_LADDER) if (copies >= threshold) level++;
  return level;
}

// The next ladder threshold above a copy count, or null once every rung is met.
function nextThreshold(copies: number): number | null {
  for (const threshold of MUSEUM_COPY_LADDER) if (copies < threshold) return threshold;
  return null;
}

// One set tier's state, with BOTTLENECK info for the E4c Museum UI.
export interface SetTierLevel {
  pieces: number; // K: requires relics 1..K
  stats: readonly MuseumStat[];
  magnitude: number;
  capstone: boolean;
  locked: boolean; // true when ANY required relic has 0 copies (the tier cannot level at all)
  level: number; // 0..ladder length: the copy level of the bottleneck relic (0 when locked)
  bottleneckRelicId: string; // the LEAST-collected required relic (ties -> the lowest index)
  bottleneckCopies: number;
  nextThreshold: number | null; // the bottleneck's next ladder rung, or null at max level
  copiesToNextLevel: number | null; // nextThreshold - bottleneckCopies, or null at max level
}

// The level of every K-piece tier of a set, by the BOTTLENECK rule: a tier's level is the copy level of
// its least-collected required relic (relics 1..K). A tier with any required relic at 0 copies is
// LOCKED (level 0). Ordered by ascending piece count. Pure. Unknown set -> [].
export function setTierLevels(museum: Readonly<Record<string, number>>, setId: RelicSetId): SetTierLevel[] {
  const set = RELIC_SET_BY_ID.get(setId);
  if (!set) return [];
  return set.tiers.map((t) => {
    const required = set.relicIds.slice(0, t.pieces);
    let bottleneckRelicId = required[0];
    let bottleneckCopies = relicCopies(museum, bottleneckRelicId);
    for (const rid of required) {
      const c = relicCopies(museum, rid);
      if (c < bottleneckCopies) {
        bottleneckCopies = c;
        bottleneckRelicId = rid;
      }
    }
    const locked = bottleneckCopies === 0;
    const next = nextThreshold(bottleneckCopies);
    return {
      pieces: t.pieces,
      stats: t.stats,
      magnitude: t.magnitude,
      capstone: t.capstone,
      locked,
      level: locked ? 0 : relicCopyLevel(bottleneckCopies),
      bottleneckRelicId,
      bottleneckCopies,
      nextThreshold: next,
      copiesToNextLevel: next === null ? null : next - bottleneckCopies,
    };
  });
}

// A set's COMPLETION: how many of its relics have at least one identified copy. Pure.
export interface SetCompletion {
  setId: RelicSetId;
  collected: number; // distinct relics held (>= 1 copy)
  total: number; // relics in the set
  complete: boolean; // every relic held at least once
  totalCopies: number; // every identified copy across the set (drives the per-copy passive)
}

export function setCompletion(museum: Readonly<Record<string, number>>, setId: RelicSetId): SetCompletion {
  const set = RELIC_SET_BY_ID.get(setId);
  if (!set) return { setId, collected: 0, total: 0, complete: false, totalCopies: 0 };
  let collected = 0;
  let totalCopies = 0;
  for (const rid of set.relicIds) {
    const c = relicCopies(museum, rid);
    if (c > 0) collected++;
    totalCopies += c;
  }
  return { setId, collected, total: set.relicIds.length, complete: collected === set.relicIds.length, totalCopies };
}

// An all-zero bonus record (every MuseumStat present).
export function zeroMuseumBonuses(): Record<MuseumStat, number> {
  const out = {} as Record<MuseumStat, number>;
  for (const stat of MUSEUM_STATS) out[stat] = 0;
  return out;
}

// E4c: the PER-COPY passive a set's copies grant to its perCopyStat, as a fraction. The ONE formula both
// museumBonusesFromRecord and the Museum UI read, so the displayed "+X%" can never drift from what the
// engine applies. Pure.
export function setPerCopyBonus(totalCopies: number): number {
  return totalCopies * MUSEUM_PER_COPY_BONUS;
}

// E4c: the bonus ONE set tier currently grants to EACH of its stats, as a fraction (0 when locked / level
// 0). The ONE formula both museumBonusesFromRecord and the Museum UI's tier rows read. The expression order
// (level * MUSEUM_TIER_LEVEL_BONUS * magnitude) is the original inline one, so the fold is bit-identical.
export function setTierBonus(t: Pick<SetTierLevel, "level" | "magnitude">): number {
  if (t.level <= 0) return 0;
  return t.level * MUSEUM_TIER_LEVEL_BONUS * t.magnitude;
}

// The museum's total bonuses from a museum record: per set, every copy adds MUSEUM_PER_COPY_BONUS of the
// set's per-copy stat, and every tier level adds MUSEUM_TIER_LEVEL_BONUS * magnitude to each of the tier's
// stats. All additive. An empty museum reads ALL ZEROS (the additive-neutral E4b seam). Pure.
// Relics v2 R2-4: this is the TIER I math (museumBonusesFromMuseum reads the Tier I record through it, unchanged).
export function museumBonusesFromRecord(museum: Readonly<Record<string, number>>): Record<MuseumStat, number> {
  const out = zeroMuseumBonuses();
  for (const set of RELIC_SETS) {
    const { totalCopies } = setCompletion(museum, set.id);
    if (totalCopies > 0) out[set.perCopyStat] += setPerCopyBonus(totalCopies);
    for (const t of setTierLevels(museum, set.id)) {
      if (t.level <= 0) continue;
      for (const stat of t.stats) out[stat] += setTierBonus(t);
    }
  }
  return out;
}

// The museum's total bonuses for a game state. Relics v2 R2-4: the whole Museum v2 record through museum math v2
// (museumBonusesFromMuseum, end of file): Tier I through the v1 math above (every Tier I veteran keeps exactly its
// bonus), Tiers II to VII through the D23 curve, the exceptional flats, each tier read from its soft cap snapshot once
// frozen. A pre-E4 shape reads empty.
// E4b wires every MuseumStat into its live consumer (see the consumer map below). DERIVED ON READ, never
// stored: each consumer reads it fresh off the state it is handed (economyTick once per call off its
// incoming state; actions at action time), so it can never go stale and is never cached across ticks.
//
// E4b CONSUMER MAP (all fractions, applied x (1 + b) unless noted; b = 0 is bit-identical everywhere):
//   cargoCapacity / transitSpeed / miningYield / sensors / extractionSpeed
//                       -> crewOverlay.ts applyMuseumOverlay (inside effectiveShipStats, after crew)
//   crewBonuses         -> crewOverlay.ts shipCrewContribution (every crew.* delta x (1 + b))
//   researchSpeed       -> tick.ts museumResearchDurationTicks (research + relic study, start time)
//   craftingQuality     -> model.ts rollQuality (draw-count-invariant near-miss promotion)
//   salvageYield        -> salvage.ts salvageYieldMult (recycle + hull teardown fraction)
//   rareMaterialChance  -> tick.ts museumRareChance (extraction rare-tier chance, capped at 1)
//   scanSpeed / relicFindChance / hazardResist
//                       -> SNAPSHOTTED onto the Expedition at dispatch (expedition.ts startExpedition)
//   scienceTeamPower    -> gambit.ts deriveAwayTeam (scienceStrength x (1 + b), then snapshotted)
export function museumBonuses(state: GameState): Record<MuseumStat, number> {
  return museumBonusesFromMuseum(state.museumV2);
}

// ============================================================================
// E4b: hazard resistance (pure, bounded)
// ============================================================================

// The ceiling the summed hazard resist APPROACHES, as a fraction (0.75 = a hazard-1.0 body never reads
// below 0.25). Keeps danger meaningful no matter how big the museum grows. FIRST-PASS TUNABLE.
export const MUSEUM_HAZARD_RESIST_MAX = 0.75;

// The largest double strictly below the ceiling: the curve's float guard (see effectiveHazardResist).
const HAZARD_RESIST_BELOW_MAX = MUSEUM_HAZARD_RESIST_MAX * (1 - Number.EPSILON);

// Ground Operations GO-5 (user ruling 2026-10-12, design D23 "Hazard resist exception": "Curve it, but keep
// the cap for now. 100% resistance is never something you ever want to reach."): the EFFECTIVE resist a
// summed raw resist (museum + gear + the party's resists) buys. It used to be a hard clamp at the ceiling;
// it is now a diminishing curve that approaches the ceiling and never reaches it:
//
//   effective = MAX * tanh(raw / MAX)        (raw > 0; 0 otherwise)
//
// Why tanh (over MAX * (1 - exp(-raw / MAX)) and the D23 diminishing() curve):
//   - f(0) = 0 and f'(0) = 1 with f''(0) = 0, so a SMALL resist barely changes: the loss is about
//     (raw / MAX)^2 / 3 of its value (raw 0.1 keeps 99.4%, raw 0.3 keeps 95%). The exp form loses about
//     raw / (2 MAX) from the first point (raw 0.1 would keep only 93.6%), so every existing small resist
//     would visibly weaken.
//   - Strictly increasing and concave: more resist always helps, each point a little less (D23).
//   - BOUNDED by MAX and never equal to it: the one place D23 keeps a ceiling, because full immunity
//     must never happen. diminishing() is unbounded by design, so it would need its own clamp (a hard cap
//     again); tanh is bounded by construction.
//   Before / after (raw -> effective): 0.1 -> 0.0994 (was 0.1), 0.3 -> 0.2850 (0.3), 0.5 -> 0.4371 (0.5),
//   0.75 -> 0.5712 (0.75), 1.5 -> 0.7230 (0.75, the old clamp).
// Float guard: Math.tanh rounds to exactly 1 past raw / MAX of about 19, so the result is held one ulp
// under the ceiling; "never reaches" stays true in floating point too. NaN, 0 and negatives read 0. Pure.
export function effectiveHazardResist(raw: number): number {
  if (!(raw > 0)) return 0;
  const r = MUSEUM_HAZARD_RESIST_MAX * Math.tanh(raw / MUSEUM_HAZARD_RESIST_MAX);
  return r < MUSEUM_HAZARD_RESIST_MAX ? r : HAZARD_RESIST_BELOW_MAX;
}

// The hazard a body PRESENTS to an expedition with the given summed (snapshotted) hazard resist:
// hazard * (1 - effectiveHazardResist(resist)), floored at 0 so it can never go negative. Multiplicative
// on purpose: a safe body (hazard 0) stays 0, and the reduction scales with the danger. resist 0 (an empty
// museum) returns `hazard` UNCHANGED (same value, no float op), so every no-resist hazard read is
// bit-identical to E4a. GO-5: the resist passes the curve above (it used to clamp at the ceiling), so a
// hazardous body always keeps more than (1 - MUSEUM_HAZARD_RESIST_MAX) of its hazard. Pure.
export function resistedHazard(hazard: number, resist: number): number {
  if (!(resist > 0)) return hazard;
  return Math.max(0, hazard * (1 - effectiveHazardResist(resist)));
}

// ============================================================================
// Relics v2 R2-1 (docs/plans/2026-10-17-relics-v2-plan.md section 3.1): THE V2 CATALOG.
// ============================================================================
// Pure data and pure readers, each read by its slice (R2-2 blanks by tier, R2-3 identification v2, R2-4 museum math v2,
// R2-5 exceptional sets, R2-6 cultures).
//
// The user's answers this catalog follows (plan USER ANSWERS 2026-10-19):
//   call 1  "Become Tier I pool": the 17 relics become the general pool by band, 4 / 5 / 4 / 4, ids, names, flavors
//           and first-find unlocks kept. R2-4: Tiers II to VII use the D23 curve with no ladder; Tier I keeps the v1
//           ladder so every Tier I veteran keeps exactly its bonus (the controller's R2-4 ruling).
//   call 2  "Same types, scaled per tier": ONE pool of general types, counted per region tier.
//   call 3  "1000 per tier": the soft cap (RELIC_SOFT_CAP).
//   call 5  "Growing sets, 54 pieces": EXCEPTIONAL_SET_SIZES.
//   call 6  "0.25% to 1.5%, x1.25/tier": EXCEPTIONAL_PER_100K.
//   call 9  "Tied to source planet": named at 10 study points (CULTURE_STUDY_POINTS).
//   call 10 "Curated roster, 42 names": 6 per tier. The NAMES await the user's sign-off sheet, so the roster holds
//           stable placeholder ids only and no display name at all.
//   call 13 "Better rarity only": RELIC_BAND_ODDS (the relic chance and the haul multiplier untouched).
//   call 17 site bias: "a relic's source site doubles the weight of its old set's types" (RELIC_SITE_BIAS_MULT).
// Every number the user did not answer is the plan's recommended value, marked [PROVISIONAL] on its ONE constant (the
// 2026-10-20 merge batch answers approved RELIC_TYPE_STATS, RELIC_TYPE_WEIGHT, RELIC_BAND_ODDS_ANCHORS and the
// exceptional piece and full-set values).
// Exceptional set and piece NAMES await the user's sign-off sheet (R2-5): stable ids and [PROPOSAL] labels only.

// The four BANDS a general relic type belongs to and a blank's rarity folds onto (standard..radiant, the rarities the
// relic roll produces; derelict reads standard, luminous and constellar read radiant, as identifyRelic folds them).
export type RelicBand = "standard" | "augmented" | "stellar" | "radiant";
export const RELIC_BANDS: readonly RelicBand[] = ["standard", "augmented", "stellar", "radiant"];

// A blank's band: the same fold identifyRelic applies to a token's rarity. Pure.
export function relicBandOf(rarity: EquipmentRarity): RelicBand {
  return skewTierOf(rarity);
}

// The v1 rarity class a type's band comes from (call 1: common = standard, uncommon = augmented, rare = stellar,
// capstone = radiant), which is what makes the bands 4 / 5 / 4 / 4.
const BAND_OF_V1_RARITY: Readonly<Record<RelicRarity, RelicBand>> = { common: "standard", uncommon: "augmented", rare: "stellar", capstone: "radiant" };

// One museum stat a general type grants, with its share of the type's per-copy value (1 = all of it).
export interface RelicTypeStat {
  stat: MuseumStat;
  share: number;
}

// User 2026-10-20 ("Approve (Recommended)", merge batch answers): each type carries the stat its old set position granted.
// Index 1 = the set's per-copy stat, index k = the k-piece tier's stat; the two-stat Precursor capstone keeps both at
// half share. All 14 Museum stats stay fed (a catalog test asserts the rule and the coverage).
export const RELIC_TYPE_STATS: Readonly<Record<string, readonly RelicTypeStat[]>> = {
  glyphTablet: [{ stat: "researchSpeed", share: 1 }],
  resonanceShard: [{ stat: "researchSpeed", share: 1 }],
  starChartFragment: [{ stat: "craftingQuality", share: 1 }],
  precursorLens: [{ stat: "relicFindChance", share: 1 }],
  heartOfTheArchive: [
    { stat: "researchSpeed", share: 0.5 },
    { stat: "craftingQuality", share: 0.5 },
  ],
  hullRivet: [{ stat: "cargoCapacity", share: 1 }],
  flightRecorder: [{ stat: "transitSpeed", share: 1 }],
  ancientDriveCoil: [{ stat: "cargoCapacity", share: 1 }],
  captainsSigil: [{ stat: "salvageYield", share: 1 }],
  sporeCapsule: [{ stat: "sensors", share: 1 }],
  bioluminescentSeed: [{ stat: "scanSpeed", share: 1 }],
  leviathanScale: [{ stat: "scienceTeamPower", share: 1 }],
  livingCrystal: [{ stat: "crewBonuses", share: 1 }],
  geodeCore: [{ stat: "miningYield", share: 1 }],
  magmaPearl: [{ stat: "rareMaterialChance", share: 1 }],
  deepVeinCompass: [{ stat: "extractionSpeed", share: 1 }],
  tectonicKeystone: [{ stat: "hazardResist", share: 1 }],
};

// User 2026-10-20 ("Approve (Recommended)"): every type weighs the same inside its band before the site bias; the band odds
// already make the commons dominate. An integer, so the R2-3 pick stays one integer draw.
export const RELIC_TYPE_WEIGHT = 1;

// User call 17: a blank's source site DOUBLES the in-band weight of its old set's types (a Deep Earth site favors Geode
// Core). R2-3 applies it.
export const RELIC_SITE_BIAS_MULT = 2;

// One GENERAL relic type (call 2: the same types at every region tier, counted per tier).
export interface RelicTypeDef {
  id: string; // unchanged from the v1 relic id, so relicDiscovered and every relic-gated blueprint keep working
  label: string; // the v1 name, unchanged
  flavor: string; // the v1 flavor line, unchanged
  band: RelicBand;
  siteSet: RelicSetId; // the old set, read only by the site bias (call 17)
  stats: readonly RelicTypeStat[];
  weight: number; // in-band weight before the site bias
}

// The general pool, built from the 17 approved relics so the ids, names and flavors cannot drift from them.
export const RELIC_TYPES: readonly RelicTypeDef[] = RELICS.map((r) => ({
  id: r.id,
  label: r.label,
  flavor: r.flavor,
  band: BAND_OF_V1_RARITY[r.rarity],
  siteSet: r.setId,
  stats: RELIC_TYPE_STATS[r.id] ?? [],
  weight: RELIC_TYPE_WEIGHT,
}));

const RELIC_TYPE_BY_ID: Map<string, RelicTypeDef> = (() => {
  const map = new Map<string, RelicTypeDef>();
  for (const def of RELIC_TYPES) {
    if (map.has(def.id)) throw new Error(`Duplicate relic type id: ${def.id}`);
    if (def.stats.length === 0) throw new Error(`Relic type ${def.id} grants no museum stat`);
    map.set(def.id, def);
  }
  for (const id of Object.keys(RELIC_TYPE_STATS)) if (!map.has(id)) throw new Error(`RELIC_TYPE_STATS names an unknown type: ${id}`);
  return map;
})();

export function getRelicTypeById(id: string): RelicTypeDef | undefined {
  return RELIC_TYPE_BY_ID.get(id);
}

// The general types of one band, in catalog order. Pure.
export function relicTypesInBand(band: RelicBand): RelicTypeDef[] {
  return RELIC_TYPES.filter((t) => t.band === band);
}

// Band odds per region tier (call 13: better rarity only)

// A revealed-band weight row, in RELIC_BANDS order (standard, augmented, stellar, radiant).
type BandRow = readonly [number, number, number, number];

// User 2026-10-20 ("Approve (Recommended)"): the Tier IV and Tier VII anchor rows, as built. The plan gives the standard blank at
// Tier IV (40/35/18/7) and Tier VII (20/35/28/17) and the radiant blank at Tier VII (0/10/40/50); the other rows
// follow the same upward shift. Tier I is NOT here: it is today's RELIC_RARITY_WEIGHTS_BY_TIER exactly (read below),
// and the tiers between the anchors interpolate linearly, rounded to integers.
export const RELIC_BAND_ODDS_ANCHORS: Readonly<Record<4 | 7, Readonly<Record<RelicBand, BandRow>>>> = {
  4: { standard: [40, 35, 18, 7], augmented: [28, 35, 27, 10], stellar: [12, 28, 38, 22], radiant: [5, 15, 40, 40] },
  7: { standard: [20, 35, 28, 17], augmented: [15, 32, 33, 20], stellar: [5, 22, 41, 32], radiant: [0, 10, 40, 50] },
};

const REGION_TIER_LIST: readonly RegionTier[] = [1, 2, 3, 4, 5, 6, 7];

function tierOneRow(blank: RelicBand): BandRow {
  const w = RELIC_RARITY_WEIGHTS_BY_TIER[blank];
  return [w.common, w.uncommon, w.rare, w.capstone];
}

function lerpRow(a: BandRow, b: BandRow, frac: number): BandRow {
  const at = (i: number) => Math.round(a[i] + (b[i] - a[i]) * frac);
  return [at(0), at(1), at(2), at(3)];
}

function bandRowAt(tier: RegionTier, blank: RelicBand): BandRow {
  const one = tierOneRow(blank);
  const four = RELIC_BAND_ODDS_ANCHORS[4][blank];
  const seven = RELIC_BAND_ODDS_ANCHORS[7][blank];
  if (tier === 1) return one;
  if (tier < 4) return lerpRow(one, four, (tier - 1) / 3);
  if (tier === 4) return four;
  if (tier < 7) return lerpRow(four, seven, (tier - 4) / 3);
  return seven;
}

// RELIC_BAND_ODDS[tier][blank band][revealed band]: the integer weight a blank of that band reveals a general type of
// each band with, at that region tier. Tier I is today's identification skew, so a Tier I blank keeps its v1 odds.
export const RELIC_BAND_ODDS: Readonly<Record<RegionTier, Readonly<Record<RelicBand, Readonly<Record<RelicBand, number>>>>>> = (() => {
  const out = {} as Record<RegionTier, Record<RelicBand, Record<RelicBand, number>>>;
  for (const tier of REGION_TIER_LIST) {
    out[tier] = {} as Record<RelicBand, Record<RelicBand, number>>;
    for (const blank of RELIC_BANDS) {
      const row = bandRowAt(tier, blank);
      out[tier][blank] = { standard: row[0], augmented: row[1], stellar: row[2], radiant: row[3] };
    }
  }
  return out;
})();

// Exceptional relics

// Call 6: a blank's chance to reveal an EXCEPTIONAL piece, per 100,000, at Tier I by its band (0.25% to 1.5%) ...
export const EXCEPTIONAL_PER_100K_TIER_I: Readonly<Record<RelicBand, number>> = { standard: 250, augmented: 500, stellar: 1000, radiant: 1500 };
// ... times this per region tier above I, rounded to an integer (an integer chance, so the R2-3 check is one draw).
export const EXCEPTIONAL_TIER_GROWTH = 1.25;

export const EXCEPTIONAL_PER_100K: Readonly<Record<RegionTier, Readonly<Record<RelicBand, number>>>> = (() => {
  const out = {} as Record<RegionTier, Record<RelicBand, number>>;
  for (const tier of REGION_TIER_LIST) {
    const f = Math.pow(EXCEPTIONAL_TIER_GROWTH, tier - 1);
    out[tier] = {} as Record<RelicBand, number>;
    for (const band of RELIC_BANDS) out[tier][band] = Math.round(EXCEPTIONAL_PER_100K_TIER_I[band] * f);
  }
  return out;
})();

// Call 5 "Growing sets, 54 pieces": the piece count of each exceptional set, per region tier. I: one set of 2; II: one
// of 3; III: two of 3; IV and V: two of 4; VI: three of 4; VII: three of 5.
export const EXCEPTIONAL_SET_SIZES: Readonly<Record<RegionTier, readonly number[]>> = {
  1: [2],
  2: [3],
  3: [3, 3],
  4: [4, 4],
  5: [4, 4],
  6: [4, 4, 4],
  7: [5, 5, 5],
};

// User 2026-10-20 ("Approve (Recommended)": "Tier I +3% rising to Tier VII +15%"): one piece's flat value per region tier,
// linear between the two ends. The R2-5 content sheet may retune every value.
export const EXCEPTIONAL_PIECE_VALUE: Readonly<Record<RegionTier, number>> = { 1: 0.03, 2: 0.05, 3: 0.07, 4: 0.09, 5: 0.11, 6: 0.13, 7: 0.15 };

// User 2026-10-20 ("Approve (Recommended)": "full set 5x one piece"): a completed set's bonus, in pieces.
export const EXCEPTIONAL_FULL_SET_MULT = 5;

// [PROVISIONAL] (no stat was proposed per piece; the R2-5 content sheet assigns them): pieces take the Museum stats in
// this order, cycling across the whole catalog (54 pieces over 14 stats, so every stat is fed), and a set's full-set
// bonus lands on its first piece's stat.
export const EXCEPTIONAL_PIECE_STAT_CYCLE: readonly MuseumStat[] = MUSEUM_STATS;

export interface ExceptionalPieceDef {
  id: string; // stable: "<set id>-p<n>"
  setId: string;
  label: string; // [PROPOSAL] until the user's sign-off sheet names it
  stat: MuseumStat;
  value: number; // flat fraction while held (duplicates add nothing, call 7)
}

export interface ExceptionalSetDef {
  id: string; // stable: "exc-t<tier>-<letter>"
  tier: RegionTier;
  label: string; // [PROPOSAL] until the user's sign-off sheet names it
  pieces: readonly ExceptionalPieceDef[];
  fullSet: readonly { stat: MuseumStat; value: number }[]; // granted once every piece is held
}

const ROMAN: Readonly<Record<RegionTier, string>> = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI", 7: "VII" };

// The letter of a tier's i-th exceptional set (0 -> "a", 1 -> "b", ...), DERIVED so a fourth set in a tier gets "d" and
// an id can never read "undefined". Throws past "z" (26 sets in one tier), which no catalog may reach. Pure.
export function exceptionalSetLetter(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= 26) throw new Error(`Exceptional set index out of range: ${index}`);
  return String.fromCharCode(97 + index);
}

// The 54 exceptional pieces in 14 sets, Tier I first. Ids are stable (a save stores them); labels are [PROPOSAL].
export const EXCEPTIONAL_SETS: readonly ExceptionalSetDef[] = (() => {
  const out: ExceptionalSetDef[] = [];
  let cursor = 0;
  for (const tier of REGION_TIER_LIST) {
    EXCEPTIONAL_SET_SIZES[tier].forEach((size, i) => {
      const letter = exceptionalSetLetter(i);
      const id = `exc-t${tier}-${letter}`;
      const value = EXCEPTIONAL_PIECE_VALUE[tier];
      const pieces: ExceptionalPieceDef[] = [];
      for (let k = 1; k <= size; k++) {
        pieces.push({
          id: `${id}-p${k}`,
          setId: id,
          label: `[PROPOSAL] Tier ${ROMAN[tier]} Set ${letter.toUpperCase()} piece ${k}`,
          stat: EXCEPTIONAL_PIECE_STAT_CYCLE[cursor % EXCEPTIONAL_PIECE_STAT_CYCLE.length],
          value,
        });
        cursor++;
      }
      out.push({
        id,
        tier,
        label: `[PROPOSAL] Tier ${ROMAN[tier]} Exceptional Set ${letter.toUpperCase()}`,
        pieces,
        fullSet: [{ stat: pieces[0].stat, value: value * EXCEPTIONAL_FULL_SET_MULT }],
      });
    });
  }
  return out;
})();

const EXCEPTIONAL_SET_BY_ID: Map<string, ExceptionalSetDef> = new Map(EXCEPTIONAL_SETS.map((s) => [s.id, s]));
const EXCEPTIONAL_PIECE_BY_ID: Map<string, ExceptionalPieceDef> = (() => {
  const map = new Map<string, ExceptionalPieceDef>();
  for (const set of EXCEPTIONAL_SETS) {
    for (const piece of set.pieces) {
      if (map.has(piece.id) || RELIC_TYPE_BY_ID.has(piece.id)) throw new Error(`Duplicate relic id: ${piece.id}`);
      map.set(piece.id, piece);
    }
  }
  return map;
})();

export function getExceptionalSetById(id: string): ExceptionalSetDef | undefined {
  return EXCEPTIONAL_SET_BY_ID.get(id);
}

export function getExceptionalPieceById(id: string): ExceptionalPieceDef | undefined {
  return EXCEPTIONAL_PIECE_BY_ID.get(id);
}

// The exceptional sets of one region tier, in catalog order. Pure.
export function exceptionalSetsOfTier(tier: RegionTier): ExceptionalSetDef[] {
  return EXCEPTIONAL_SETS.filter((s) => s.tier === tier);
}

// Soft cap and cultures

// Call 3 "1000 per tier" (call 4: keep counting past it and show it): identified relics per region tier (its general
// copies plus its exceptional copies, duplicates included: call 7 "a duplicate adds no stat but counts toward the tier
// total") at which that tier's counts freeze for the regular game (R2-4, museumTierTotal / withSoftCapSnapshot).
export const RELIC_SOFT_CAP = 1000;

// Call 10: six curated cultures per region tier (42). Their NAMES await the user's sign-off sheet, so the roster
// holds stable placeholder ids only ("culture-t<tier>-<n>"); nothing here is a display name. No culture is ever the
// First Cause antagonists (R2-6 guards the roster).
export const CULTURES_PER_TIER = 6;
export const CULTURE_ROSTER: Readonly<Record<RegionTier, readonly string[]>> = (() => {
  const out = {} as Record<RegionTier, string[]>;
  for (const tier of REGION_TIER_LIST) out[tier] = Array.from({ length: CULTURES_PER_TIER }, (_, i) => `culture-t${tier}-${i + 1}`);
  return out;
})();

// Call 9: a culture's name is revealed at this many study points (+1 per identified find, plus 15b ancient data; R2-6).
export const CULTURE_STUDY_POINTS = 10;

// ============================================================================
// Relics v2 R2-4 (plan 2026-10-17 section 4 R2-4): MUSEUM MATH V2. LIVE.
// ============================================================================
// What the Museum grants, from the whole Museum v2 record (museumBonusesFromMuseum, which museumBonuses reads):
//   - TIER I keeps the v1 math EXACTLY (museumBonusesFromRecord: the per-copy passive plus the set ladder with its
//     bottleneck), so every Tier I veteran's bonus is what it was before R2-4: same counts, same bonus (the controller's
//     R2-4 ruling; relicsV2MuseumGoldens.test.ts goldens 1 and 2 prove it). The ladder therefore stays for Tier I only;
//     no tier above I ever had one.
//   - TIERS II TO VII (call 2 "Same types, scaled per tier"): the same general types, each copy worth its type's stat
//     shares times MUSEUM_V2_PER_COPY[tier], summed per stat inside the tier and passed through the shared D23 curve
//     diminishing(x, MUSEUM_V2_KNEE), then summed over tiers. Unbounded and concave: more always helps, each copy a
//     little less, so a farmed tier's next copy is worth less than an early copy one tier up.
//   - EXCEPTIONAL pieces and full sets add FLAT values (call 7: they do not stack): a held piece adds its value once
//     (a duplicate adds nothing), and a set with every piece held adds its full-set bonus (5x one piece).
//   - THE SOFT CAP (calls 3 and 4): when a tier's identified total (museumTierTotal) first reaches RELIC_SOFT_CAP, its
//     record is snapshotted into `frozen` (withSoftCapSnapshot); from then on the regular game reads the snapshot
//     (the one flat line on the D23 curve, the user's stated exception), while the live counts keep growing and the
//     Museum shows them. Nothing for Endless Mode ships yet (nothing inert).
// Hazard resist still passes its consumer's effectiveHazardResist curve; every consumer reads museumBonuses unchanged.

// The region tiers the D23 curve serves (Tier I keeps the v1 math above).
export type CurvedRegionTier = 2 | 3 | 4 | 5 | 6 | 7;
const CURVED_TIERS: readonly CurvedRegionTier[] = [2, 3, 4, 5, 6, 7];

// [PROVISIONAL] (plan 3.1 "MUSEUM_V2_PER_COPY[tier] = 0.001 x (1, 1.5, 2.2, 3, 4, 5.2, 6.6)", not yet answered): one
// copy's value per stat share at each tier above I, as a fraction before the curve. Tier I's 0.001 is the v1 per-copy
// passive (MUSEUM_PER_COPY_BONUS), which Tier I keeps.
export const MUSEUM_V2_PER_COPY: Readonly<Record<CurvedRegionTier, number>> = { 2: 0.0015, 3: 0.0022, 4: 0.003, 5: 0.004, 6: 0.0052, 7: 0.0066 };

// [PROVISIONAL] (plan 3.1 "MUSEUM_V2_KNEE 0.25", not yet answered): the D23 knee of each tier's per-stat curve, in
// bonus units (a stat's pre-curve sum of +25% keeps about 73% of itself; +5% keeps about 91%).
export const MUSEUM_V2_KNEE = 0.25;

// [PROVISIONAL] (the plan freezes "its counts" and is silent on exceptional pieces): false = a held exceptional piece and
// a completed set ALWAYS act, frozen tier or not (they are flat and cannot grow, so the cap has nothing to stop, and a
// player who farmed past the cap still gets the pieces found later). true = a frozen tier's pieces are read from its
// snapshot like its general copies. The snapshot holds the tier's pieces either way, so flipping this needs no
// migration.
export const SOFT_CAP_FREEZES_EXCEPTIONAL = false;

// The region tier of an exceptional piece (its set's tier), or null for an unknown id. Pure.
export function exceptionalPieceTier(pieceId: string): RegionTier | null {
  const piece = EXCEPTIONAL_PIECE_BY_ID.get(pieceId);
  return piece ? (EXCEPTIONAL_SET_BY_ID.get(piece.setId)?.tier ?? null) : null;
}

function tierKey(tier: RegionTier): RegionTierKey {
  return String(tier) as RegionTierKey;
}

function positiveCount(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// A tier's IDENTIFIED total: its general copies plus the copies of its exceptional pieces (duplicates included). Counts
// keep growing past the cap (call 4), so this is the number the Museum shows. Pure.
export function museumTierTotal(museum: MuseumV2 | undefined, tier: RegionTier): number {
  if (!museum) return 0;
  let total = 0;
  for (const n of Object.values(museum.general?.[tierKey(tier)] ?? {})) total += positiveCount(n);
  for (const [id, n] of Object.entries(museum.exceptional ?? {})) if (exceptionalPieceTier(id) === tier) total += positiveCount(n);
  return total;
}

// Whether a tier's counts are frozen for the regular game (it reached the soft cap). Pure.
export function museumTierFrozen(museum: MuseumV2 | undefined, tier: RegionTier): boolean {
  return museum?.frozen?.[tierKey(tier)] !== undefined;
}

// A tier's whole record (its general copies and its exceptional pieces' copies in one map; the ids never collide, as the
// catalog asserts): what a snapshot stores. Pure.
function tierRecord(museum: MuseumV2, tier: RegionTier): Record<string, number> {
  const out: Record<string, number> = { ...(museum.general[tierKey(tier)] ?? {}) };
  for (const [id, n] of Object.entries(museum.exceptional)) if (exceptionalPieceTier(id) === tier && positiveCount(n) > 0) out[id] = n;
  return out;
}

// The museum with every tier at or past the soft cap that has no snapshot yet snapshotted at its current counts. The
// SAME reference when nothing changes. Every deposit ends here (a one-copy deposit reaches the cap exactly, so its
// snapshot is exact); museumDepositGeneral trims a multi-copy grant to the exact cap first. Pure.
export function withSoftCapSnapshot(museum: MuseumV2): MuseumV2 {
  let frozen = museum.frozen;
  for (const tier of REGION_TIER_LIST) {
    if (frozen[tierKey(tier)] !== undefined || museumTierTotal(museum, tier) < RELIC_SOFT_CAP) continue;
    frozen = { ...frozen, [tierKey(tier)]: tierRecord(museum, tier) };
  }
  return frozen === museum.frozen ? museum : { ...museum, frozen };
}

// `n` general copies of `typeId` deposited at `tier` (the one general deposit every writer goes through). When this
// deposit carries the tier across the soft cap, the snapshot holds exactly RELIC_SOFT_CAP copies: the record before
// it plus only the copies that reached the cap. Key positions of existing records are kept. Pure.
export function museumDepositGeneral(museum: MuseumV2, tier: RegionTier, typeId: string, n: number): MuseumV2 {
  const key = tierKey(tier);
  const count = positiveCount(n);
  if (count === 0) return museum;
  const record = museum.general[key] ?? {};
  let frozen = museum.frozen;
  const before = museumTierTotal(museum, tier);
  if (frozen[key] === undefined && before < RELIC_SOFT_CAP && before + count >= RELIC_SOFT_CAP) {
    const atCap = tierRecord(museum, tier);
    atCap[typeId] = (record[typeId] ?? 0) + (RELIC_SOFT_CAP - before);
    frozen = { ...frozen, [key]: atCap };
  }
  return withSoftCapSnapshot({ ...museum, general: { ...museum.general, [key]: { ...record, [typeId]: (record[typeId] ?? 0) + count } }, frozen });
}

// One copy of exceptional piece `pieceId` deposited (duplicates counted, call 7), the soft cap checked. Pure.
export function museumDepositExceptional(museum: MuseumV2, pieceId: string): MuseumV2 {
  return withSoftCapSnapshot({ ...museum, exceptional: { ...museum.exceptional, [pieceId]: (museum.exceptional[pieceId] ?? 0) + 1 } });
}

// The record of `tier` the REGULAR GAME reads: the snapshot once the tier reached the cap, else the live general
// counts. Pure.
export function museumActiveRecord(museum: MuseumV2 | undefined, tier: RegionTier): Readonly<Record<string, number>> {
  const key = tierKey(tier);
  return museum?.frozen?.[key] ?? museum?.general?.[key] ?? {};
}

// One curved tier's bonus per stat: each stat's copies x shares x MUSEUM_V2_PER_COPY[tier], through the D23 curve. Ids
// that are not general types (a snapshot's exceptional pieces) are skipped. Pure.
export function museumTierCurveBonuses(record: Readonly<Record<string, number>>, tier: CurvedRegionTier): Record<MuseumStat, number> {
  const raw = zeroMuseumBonuses();
  const per = MUSEUM_V2_PER_COPY[tier];
  for (const [id, n] of Object.entries(record)) {
    const type = RELIC_TYPE_BY_ID.get(id);
    const copies = positiveCount(n);
    if (!type || copies === 0) continue;
    for (const s of type.stats) raw[s.stat] += copies * s.share * per;
  }
  const out = zeroMuseumBonuses();
  for (const stat of MUSEUM_STATS) if (raw[stat] > 0) out[stat] = diminishing(raw[stat], MUSEUM_V2_KNEE);
  return out;
}

// The flat exceptional bonuses: each held piece once, each set with every piece held its full-set bonus. A frozen
// tier's pieces read from its snapshot only when SOFT_CAP_FREEZES_EXCEPTIONAL. Pure.
export function museumExceptionalBonuses(museum: MuseumV2 | undefined): Record<MuseumStat, number> {
  const out = zeroMuseumBonuses();
  if (!museum) return out;
  for (const set of EXCEPTIONAL_SETS) {
    const held = SOFT_CAP_FREEZES_EXCEPTIONAL && museumTierFrozen(museum, set.tier) ? museumActiveRecord(museum, set.tier) : (museum.exceptional ?? {});
    let all = true;
    for (const piece of set.pieces) {
      if (positiveCount(held[piece.id]) > 0) out[piece.stat] += piece.value;
      else all = false;
    }
    if (all) for (const b of set.fullSet) out[b.stat] += b.value;
  }
  return out;
}

// R2-4 review follow-up (the Museum page): what the Museum grants BEYOND the Tier I sets, per stat: the curved tiers
// and the exceptional flats, so the page can show every bonus the engine applies (museumBonusesFromMuseum less the
// Tier I v1 math). Hazard resist is the raw sum (its consumer's curve applies to the whole). Pure.
export function museumBeyondTierIBonuses(museum: MuseumV2 | undefined): Record<MuseumStat, number> {
  const total = museumBonusesFromMuseum(museum);
  const tierI = museumBonusesFromRecord(museumActiveRecord(museum, 1));
  const out = zeroMuseumBonuses();
  for (const stat of MUSEUM_STATS) {
    const d = total[stat] - tierI[stat];
    if (d > 1e-12) out[stat] = d;
  }
  return out;
}

// THE MUSEUM'S TOTAL BONUSES from a Museum v2 record: Tier I through the v1 math, Tiers II to VII through the curve,
// plus the exceptional flats; each tier read from its snapshot once frozen. A museum with only Tier I copies returns
// exactly museumBonusesFromRecord of that record (nothing else is added, not even a zero). Empty: all zeros. Pure.
export function museumBonusesFromMuseum(museum: MuseumV2 | undefined): Record<MuseumStat, number> {
  const out = museumBonusesFromRecord(museumActiveRecord(museum, 1));
  const add = (b: Record<MuseumStat, number>) => {
    for (const stat of MUSEUM_STATS) if (b[stat] !== 0) out[stat] += b[stat];
  };
  for (const tier of CURVED_TIERS) {
    const record = museumActiveRecord(museum, tier);
    if (Object.keys(record).length > 0) add(museumTierCurveBonuses(record, tier));
  }
  add(museumExceptionalBonuses(museum));
  return out;
}
