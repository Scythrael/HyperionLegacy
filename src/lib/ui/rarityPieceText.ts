// rarityPieceText.ts: RARITY READINESS RR-8 (docs/plans/2026-10-23-rarity-readiness-plan.md). The two tooltip lines a
// legendary piece gains: the Luminous legendary affix it rolled, and the Constellar gear set it belongs to. Each is one
// plain line under the piece's stats (no new layout). The affix's value is already in the piece's rolled lines, so the
// line only names it; the set line names the set and its thresholds.
//
// Pure presentation, node-testable (no Svelte harness); no game rules live here.

import type { EquipmentInstance } from "../game/model";
import { legendaryAffixDef } from "../game/legendaryAffixes";
import { CELESTIAL_SET_REDUCTION, gearSetDef, pieceSetId } from "../game/gearSets";

// "Legendary affix: Starfall Lance", or null when the piece carries no known legendary affix. Pure.
export function pieceLegendaryAffixText(piece: Pick<EquipmentInstance, "legendaryAffixId">): string | null {
  const def = legendaryAffixDef(piece.legendaryAffixId);
  return def ? `Legendary affix: ${def.label}` : null;
}

// "Set: Survey Cadre (2 / 3 / 5 pieces)" for a piece that counts toward a set (a Constellar piece of a slot its set
// covers, or a set module); a Celestial Constellar piece adds that it lowers each threshold. Null otherwise. Pure.
export function pieceSetText(piece: EquipmentInstance): string | null {
  const set = gearSetDef(pieceSetId(piece));
  if (!set) return null;
  const tiers = set.tiers.map((t) => t.pieces).join(" / ");
  const celestial = piece.rarity === "constellar" && piece.ascension === "celestial";
  const note = celestial ? `, ${CELESTIAL_SET_REDUCTION === 1 ? "one" : String(CELESTIAL_SET_REDUCTION)} fewer each with this Celestial piece` : "";
  return `Set: ${set.label} (${tiers} pieces${note})`;
}
