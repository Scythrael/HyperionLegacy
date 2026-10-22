// materialQualityText.ts: the player-facing MATERIAL QUALITY readout (Material Lines ML-3, OC-D2). A Prospecting Rig's
// "Material Quality" line is stat POINTS; this is what they buy on a mission delivery: the chance each delivered unit
// arrives one quality step higher (materialQuality.ts materialQualityClimbChance, a diminishing curve).
//
// Pure presentation, node-testable (no Svelte harness); no game rules live here.

import type { EquipmentInstance } from "../game/model";
import { materialQualityClimbChance } from "../game/materialQuality";

// Material Lines ML-4 (L5): the note under a craft order's "Use best materials" switch, worded as the signed-off
// Refinery mockup words it (2026-10-21). Pure.
export function bestMaterialsNote(on: boolean): string {
  return on ? "Highest quality first. Carries more quality into the output." : "Off: lowest quality first, so your good stock is saved.";
}

// One piece's material quality points (signature and rolled lines together, as the ship fold sums them). Pure.
export function pieceMaterialQualityPoints(piece: EquipmentInstance): number {
  return (piece.implicitStats.materialQualityChance ?? 0) + (piece.rolledStats.materialQualityChance ?? 0);
}

// A chance as a one-decimal percent ("8.5").
const pct = (p: number): string => (Math.round(p * 1000) / 10).toFixed(1);

// The item tooltip's readout ("+8.5% chance per unit to arrive one quality higher"), or null when the piece carries
// no material quality. Pure.
export function pieceMaterialQualityText(piece: EquipmentInstance): string | null {
  const p = materialQualityClimbChance(pieceMaterialQualityPoints(piece));
  if (!(p > 0)) return null;
  return `+${pct(p)}% chance per unit to arrive one quality higher`;
}

// The ship's combined chance when the piece is installed beside other pieces with the line (the ship sums their
// points, then the curve diminishes the sum, model.ts shipDerivedStats): "Ship total, 2 pieces: +14.6% per unit (the
// points add, then diminish)". Null when `shipPieces` is not given, the piece has no line, or it is the ship's only
// such piece (its own readout already is the ship's). Today only one Prospecting Rig installs per ship, so this shows
// once more than one slot can carry the line. Pure.
export function shipMaterialQualityText(piece: EquipmentInstance, shipPieces: readonly EquipmentInstance[] | undefined): string | null {
  if (shipPieces === undefined || !(pieceMaterialQualityPoints(piece) > 0)) return null;
  const carriers = shipPieces.filter((p) => pieceMaterialQualityPoints(p) > 0);
  if (carriers.length < 2 || !carriers.some((p) => p.id === piece.id)) return null;
  const total = carriers.reduce((sum, p) => sum + pieceMaterialQualityPoints(p), 0);
  return `Ship total, ${carriers.length} pieces: +${pct(materialQualityClimbChance(total))}% per unit (the points add, then diminish)`;
}
