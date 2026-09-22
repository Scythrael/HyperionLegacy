// inspectSort.ts — Crafted Blanks 0.13.7 (bulk inspect-reveal).
//
// The display ordering for a batch of freshly inspected systems. The engine (inspectBlanks)
// returns the rolled pieces in ROLL ORDER; the reveal modal wants them ranked best-first so the
// prize rolls sit at the top of the scrolling list. Pure + isolated here so it is trivially
// unit-testable and shared from ONE place (the App imports this, never re-implements the order).
import { rarityIndex, type EquipmentInstance } from "./model";

// Sort by rarity DESC (primary), then quality DESC, then iLevel DESC, using the game's canonical
// rarity ordering (rarityIndex, model.ts). Returns a NEW array (never mutates the input), so a
// caller can hand it the engine's roll-order array without disturbing it. rarityIndex collapses
// luminous + constellar to the same top tier (they are parallel legendary flavors), so two such
// pieces tie on rarity and fall through to the quality / iLevel tiebreakers.
export function sortRolledPieces(pieces: EquipmentInstance[]): EquipmentInstance[] {
  return [...pieces].sort(
    (a, b) =>
      rarityIndex(b.rarity) - rarityIndex(a.rarity) || b.quality - a.quality || b.iLevel - a.iLevel,
  );
}
