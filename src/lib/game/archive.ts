// archive.ts — ITEM LIFECYCLE 0.13.6 (Phase 4, the Archive).
//
// The completionist record of the empire the player is building: enshrine your best-crafted version
// of each item for a score and a completion percentage. Slotting an item CONSUMES it and keeps only
// the SCORE (a plain number), so the save never grows with the collection and a better craft later
// simply overwrites the score. Pure over GameState, like armory.ts / salvage.ts.
import type { GameState, EquipmentInstance, BlueprintDef } from "./model";
import { BLUEPRINTS, blueprintMintsEquipmentInstance, rarityIndex } from "./model";
import { EQUIPMENT_ILEVEL_CAP_PER_TIER } from "./itemgen";

const MAX_QUALITY = 5; // quality rungs 0..5
const MAX_RARITY_INDEX = 5; // luminous / constellar (the top tier) -> rarityIndex 5

// The score for a specific rolled instance: (rarityIndex+1) x (quality+1) x iLevel x 10 (the
// 1-INDEXED form the user confirmed, so a Q0 / derelict item still scores rather than reading as a
// broken zero). Rolls and durability deliberately do not count (design section 5).
export function itemScore(inst: Pick<EquipmentInstance, "rarity" | "quality" | "iLevel">): number {
  return (rarityIndex(inst.rarity) + 1) * (inst.quality + 1) * inst.iLevel * 10;
}

// The MAXIMUM achievable score for a craftable blueprint: top rarity, top quality, and the item's
// ABSOLUTE tier ceiling for iLevel (NOT the player's current crafting cap, so completion % moves as
// you COLLECT, not as you level, design section 5).
export function maxItemScore(bp: BlueprintDef): number {
  return (MAX_RARITY_INDEX + 1) * (MAX_QUALITY + 1) * (bp.tier * EQUIPMENT_ILEVEL_CAP_PER_TIER) * 10;
}

// Every craftable-equipment blueprint (one Archive slot each), keyed by blueprint key. DERIVED from
// BLUEPRINTS via blueprintMintsEquipmentInstance, so a new equipment/weapon/drone blueprint appears
// as an Archive slot automatically (content-driven rule).
export function archivableBlueprints(): { key: string; bp: BlueprintDef }[] {
  return Object.entries(BLUEPRINTS)
    .filter(([, bp]) => blueprintMintsEquipmentInstance(bp))
    .map(([key, bp]) => ({ key, bp }));
}

// Completion across the whole Archive: the summed enshrined scores over the summed per-item maximums.
export function archiveCompletion(state: GameState): { total: number; max: number; pct: number } {
  let total = 0;
  let max = 0;
  for (const { key, bp } of archivableBlueprints()) {
    max += maxItemScore(bp);
    total += state.archive[key]?.score ?? 0;
  }
  return { total, max, pct: max > 0 ? (total / max) * 100 : 0 };
}

// Enshrine a rolled system into the Archive. It must be a free SPARE (fittedToShipId null, not
// committed to a loadout) and a CRAFTED item (has a blueprintKey, not a Standard-Issue baseline).
// Slotting CONSUMES the instance (removed from state.equipment) and records max(existing, newScore)
// for its blueprint. Same-ref no-op on any failed guard. Atomic: the score update and the consume
// land in the one new state.
export function archiveItem(state: GameState, instanceId: string): GameState {
  const inst = state.equipment.find((e) => e.id === instanceId);
  if (inst === undefined) return state;
  if (inst.fittedToShipId !== null || inst.committedToLoadoutId !== undefined) return state; // not a free spare
  const key = inst.blueprintKey;
  if (key === null || !(key in BLUEPRINTS)) return state; // baselines / unknown blueprints are not archivable
  // Keep the BEST by score. When the new roll wins (or there is no entry yet), record its score AND
  // its rarity/quality so the console can show what is enshrined; otherwise keep the existing entry.
  const existing = state.archive[key];
  const newScore = itemScore(inst);
  const entry = existing !== undefined && existing.score >= newScore
    ? existing
    : { score: newScore, rarity: inst.rarity, quality: inst.quality };
  return {
    ...state,
    equipment: state.equipment.filter((e) => e.id !== instanceId), // consumed into the Archive
    archive: { ...state.archive, [key]: entry },
  };
}
