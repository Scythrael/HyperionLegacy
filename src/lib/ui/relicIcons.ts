// relicIcons.ts: the ONE UI-side place relics meet their display vocabulary (Exploration 0.14.0, E4c).
//
// The relic ENGINE (game/relics.ts) is pure data + math and knows nothing about glyphs, colors or
// wording. Every relic surface (the Research facility's Relics sub-tab, the Archive's Museum sub-tab,
// the Expedition Console's foreknowledge chip, the identification reveal) reads its glyph, tint and
// labels from HERE, so a relic can never wear two different icons on two screens.
//
// EVERY GRAPHIC IS SVG (user hard requirement, 2026-10-01): the values below are IconName keys into
// the shared registry (icons.ts, drawn by <Icon>), never emoji. A set's EMBLEM is its CAPSTONE relic's
// glyph (derived, not hand-listed, so a roster change cannot leave the emblem pointing at a non-capstone).
//
// Colors are var(--rarity-*) TOKENS (app.css), never hex, so every theme (and the color-blind palette)
// remaps them for free. Icons take their color from `currentColor`, so callers tint the WRAPPER.

import type { IconName } from "./icons";
import { hazardResistEffectParts } from "./hazardResistText";
import type { RelicSetId } from "../game/model";
import { tierNumeral } from "../game/galaxy";
import {
  MUSEUM_PER_COPY_BONUS,
  RELIC_SETS,
  getRelicById,
  getRelicSetById,
  getRelicTypeById,
  type MuseumStat,
  type RelicRarity,
} from "../game/relics";

// Tiers read as Roman numerals through the one shared formatter (galaxy.ts tierNumeral).

// The tier stagger (user 2026-10-27): where a relic type starts turning up, for the Museum's undiscovered tile beside
// its set's "From:" sites ("Tier IV+"). Empty for a type that turns up at every tier (Tier I) or an unknown id. Pure.
export function relicFirstTierLabel(relicId: string): string {
  const tier = getRelicTypeById(relicId)?.firstTier;
  if (tier === undefined || tier <= 1) return "";
  return tier >= 7 ? `Tier ${tierNumeral(7)}` : `Tier ${tierNumeral(tier)}+`;
}

// relic id -> its glyph. Exhaustive over the 17 locked relics (relicIcons.test.ts asserts every RELICS id
// is present and every value is a real registry key).
export const RELIC_ICON: Readonly<Record<string, IconName>> = {
  // Precursor
  glyphTablet: "relicGlyphTablet",
  resonanceShard: "relicResonanceShard",
  starChartFragment: "relicStarChartFragment",
  precursorLens: "relicPrecursorLens",
  heartOfTheArchive: "relicHeartOfTheArchive",
  // Shipwright
  hullRivet: "relicHullRivet",
  flightRecorder: "relicFlightRecorder",
  ancientDriveCoil: "relicAncientDriveCoil",
  captainsSigil: "relicCaptainsSigil",
  // Xenobiology
  sporeCapsule: "relicSporeCapsule",
  bioluminescentSeed: "relicBioluminescentSeed",
  leviathanScale: "relicLeviathanScale",
  livingCrystal: "relicLivingCrystal",
  // Deep Earth
  geodeCore: "relicGeodeCore",
  magmaPearl: "relicMagmaPearl",
  deepVeinCompass: "relicDeepVeinCompass",
  tectonicKeystone: "relicTectonicKeystone",
};

// Relics v2 (user 2026-11-13 "One per set"): each exceptional set's own glyph, by set id; a piece wears its set's glyph.
// Exhaustive over EXCEPTIONAL_SETS (relicIcons.test.ts asserts it).
export const EXCEPTIONAL_SET_ICON: Readonly<Record<string, IconName>> = {
  "exc-t1-a": "excWaystation",
  "exc-t2-a": "excHearthward",
  "exc-t3-a": "excLightkeeper",
  "exc-t3-b": "excDeepcut",
  "exc-t4-a": "excStormglass",
  "exc-t4-b": "excKeelsong",
  "exc-t5-a": "excTidewright",
  "exc-t5-b": "excEmberCourt",
  "exc-t6-a": "excVeilward",
  "exc-t6-b": "excStarwake",
  "exc-t6-c": "excGrandOrrery",
  "exc-t7-a": "excDawnmaker",
  "exc-t7-b": "excKinring",
  "exc-t7-c": "excLongVigil",
};

// A set's glyph; the shared `exceptional` glyph only for an unknown set id. Pure.
export function exceptionalSetIcon(setId: string): IconName {
  return EXCEPTIONAL_SET_ICON[setId] ?? "exceptional";
}

// A relic's glyph; the generic unidentified-token glyph for an unknown id (a tampered save), never blank.
export function relicIcon(relicId: string): IconName {
  return RELIC_ICON[relicId] ?? "relic";
}

// A set's EMBLEM: its capstone relic's glyph (the last relic in K-piece order is the capstone for every
// locked set; found by rarity so the rule survives a reorder). Falls back to the museum glyph.
export function relicSetEmblem(setId: RelicSetId): IconName {
  const set = getRelicSetById(setId);
  if (!set) return "museum";
  const capstone = set.relicIds.find((rid) => getRelicById(rid)?.rarity === "capstone");
  return capstone ? relicIcon(capstone) : "museum";
}

// A set's SHORT name for chips ("Precursor Set" -> "Precursor"), derived from the catalog label.
// Relics v2 R2-2: a blank with no set (no site: a short-range, completion or grant blank) reads "General" (it
// identifies over the general pool).
export function relicSetShortLabel(setId: RelicSetId | undefined): string {
  if (setId === undefined) return "General";
  const label = getRelicSetById(setId)?.label ?? setId;
  return label.replace(/\s+Set$/, "");
}

// Relic RARITY CLASS (within a set) -> the shared rarity token. Mirrors the item-rarity ladder
// (EquipmentTooltip itemRarityColor): common silver, uncommon green, rare blue, capstone violet.
export function relicRarityColor(rarity: RelicRarity): string {
  switch (rarity) {
    case "common":
      return "var(--rarity-standard)";
    case "uncommon":
      return "var(--rarity-augmented)";
    case "rare":
      return "var(--rarity-stellar)";
    case "capstone":
      return "var(--rarity-radiant)";
  }
}

export const RELIC_RARITY_LABEL: Readonly<Record<RelicRarity, string>> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  capstone: "Capstone",
};

// The player-facing wording of every museum stat (lowercase, read inside a sentence like
// "+1.5% research speed"). Exhaustive Record, so a new MuseumStat is a compile error until it is named.
export const MUSEUM_STAT_LABEL: Readonly<Record<MuseumStat, string>> = {
  researchSpeed: "research speed",
  craftingQuality: "crafting quality",
  relicFindChance: "relic find chance",
  cargoCapacity: "cargo capacity",
  transitSpeed: "transit speed",
  // Wiring WR-11 (OC-H2 "Keep scope, honest text"): it scales recycling and hull teardown only (salvage.ts salvageYieldMult).
  salvageYield: "salvage yield (recycling and hull teardown)",
  sensors: "sensors",
  scanSpeed: "scan speed",
  scienceTeamPower: "science team power",
  crewBonuses: "crew bonuses",
  miningYield: "mining yield",
  rareMaterialChance: "rare material chance",
  extractionSpeed: "extraction speed",
  hazardResist: "hazard resist",
};

// A museum bonus FRACTION as a signed percent with one decimal ("+1.5%", "+0.1%", "+0%" for zero).
export function formatMuseumPct(fraction: number): string {
  if (!(fraction > 0)) return "+0%";
  const pct = Math.round(fraction * 1000) / 10; // one decimal, float noise removed
  return `+${pct.toFixed(1)}%`;
}

// A museum bonus as its player-facing line ("+1.5% research speed"). Hazard resist reads EFFECTIVE (GO-6, the
// GO-5 review display fix): the summed resist passes the diminishing curve toward the 75% cap (relics.ts
// effectiveHazardResist), so it shows "+28.5% hazard resist (diminishing from +30.0%)", never the raw sum.
export function formatMuseumStatBonus(stat: MuseumStat, fraction: number): string {
  if (stat === "hazardResist" && fraction > 0) {
    const { effective, note } = hazardResistEffectParts(fraction, true);
    return `${effective} ${MUSEUM_STAT_LABEL[stat]} ${note}`;
  }
  return `${formatMuseumPct(fraction)} ${MUSEUM_STAT_LABEL[stat]}`;
}

// A set's per-copy line in the museum ("Per copy: +0.1% research speed · 5 copies, total +0.5% research
// speed"). The TOTAL routes through formatMuseumStatBonus (GO-6 review), so a hazard resist per-copy stat would
// read its EFFECTIVE value on the curve toward the cap, never the raw sum. Pure.
export function museumPerCopyText(stat: MuseumStat, totalCopies: number, perCopyTotal: number): string {
  const head = `Per copy: ${formatMuseumPct(MUSEUM_PER_COPY_BONUS)} ${MUSEUM_STAT_LABEL[stat]}`;
  if (!(totalCopies > 0)) return head;
  return `${head} · ${totalCopies} ${totalCopies === 1 ? "copy" : "copies"}, total ${formatMuseumStatBonus(stat, perCopyTotal)}`;
}

// The canonical set order (RELIC_SETS), re-exported for UI iteration without a second import.
export const RELIC_SET_IDS: readonly RelicSetId[] = RELIC_SETS.map((s) => s.id);
