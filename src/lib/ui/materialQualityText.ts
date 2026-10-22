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

// The item tooltip's readout ("+8.5% chance per unit to arrive one quality higher"), or null when the piece carries
// no material quality. Pure.
export function pieceMaterialQualityText(piece: EquipmentInstance): string | null {
  const p = materialQualityClimbChance(pieceMaterialQualityPoints(piece));
  if (!(p > 0)) return null;
  return `+${(Math.round(p * 1000) / 10).toFixed(1)}% chance per unit to arrive one quality higher`;
}
