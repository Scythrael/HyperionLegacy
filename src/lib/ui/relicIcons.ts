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
import type { RelicSetId } from "../game/model";
import {
  RELIC_SETS,
  getRelicById,
  getRelicSetById,
  type MuseumStat,
  type RelicRarity,
} from "../game/relics";

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
export function relicSetShortLabel(setId: RelicSetId): string {
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
  salvageYield: "salvage yield",
  sensors: "sensors",
  scanSpeed: "scan speed",
  scienceTeamPower: "Science team power",
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

// The canonical set order (RELIC_SETS), re-exported for UI iteration without a second import.
export const RELIC_SET_IDS: readonly RelicSetId[] = RELIC_SETS.map((s) => s.id);
