// hazardResistText.ts: the player-facing HAZARD RESIST readouts (Ground Operations GO-6, folding in the GO-5
// review display fix). Since GO-5 the summed hazard resist (museum + gear + the party's resists) passes
// relics.ts effectiveHazardResist, a diminishing curve toward the 75% cap that never reaches it (user
// 2026-10-12, design D23 "Hazard resist exception"). A readout therefore shows the EFFECTIVE resist and says it
// diminishes, adding the raw value only where the curve moved the shown number ("28.5% (diminishing from
// 30.0%)"). Each readout curves ITS OWN source (a museum tier, one piece): in a run the curve applies to the
// combined sum, so sources stack a little less than their readouts add up to.
//
// Pure presentation, node-testable (no Svelte harness); no game rules live here.

import type { EquipmentInstance } from "../game/model";
import { effectiveHazardResist } from "../game/relics";
import { pathfinderEffect } from "../game/utilityGear";
import { convertGroundPoints, pieceGroundPoints } from "../game/awayTeam";

// A fraction as a one-decimal percent ("28.5%"), float noise removed; 0 (or not a positive number) reads "0%".
function pct(fraction: number, signed: boolean): string {
  const sign = signed ? "+" : "";
  if (!(fraction > 0)) return `${sign}0%`;
  return `${sign}${(Math.round(fraction * 1000) / 10).toFixed(1)}%`;
}

// The effective resist a raw summed resist buys, split for wording: the percent and its note ("(diminishing)",
// or "(diminishing from 30.0%)" where the curve moved the shown number). `signed` prefixes "+" (the museum's
// bonus wording). No resist: "0%" and an empty note. Pure.
export function hazardResistEffectParts(raw: number, signed = false): { effective: string; note: string } {
  if (!(raw > 0)) return { effective: pct(0, signed), note: "" };
  const effective = pct(effectiveHazardResist(raw), signed);
  const rawText = pct(raw, signed);
  return { effective, note: effective === rawText ? "(diminishing)" : `(diminishing from ${rawText})` };
}

// The effective resist with its note in one string ("28.5% (diminishing from 30.0%)"). Pure.
export function hazardResistEffectText(raw: number, signed = false): string {
  const { effective, note } = hazardResistEffectParts(raw, signed);
  return note ? `${effective} ${note}` : effective;
}

// One piece's raw hazard resist fraction, converted the way a run reads it: a Pathfinder Suite's ship-side
// hazardResist line through its own curve (utilityGear.ts pathfinderEffect, the only ship piece that line
// does anything on), and a member piece's groundHazardResist line through THE ground conversion
// (awayTeam.ts convertGroundPoints, as the dispatch snapshot does). 0 when the piece has neither. Pure.
export function pieceHazardResist(piece: EquipmentInstance): number {
  const ship = pathfinderEffect([piece]).hazardResist;
  const member = convertGroundPoints(pieceGroundPoints(piece)).stats.hazardResist;
  return ship + member;
}

// The item tooltip's readout for a piece's hazard resist ("Hazard resist 12.2% (diminishing)"), or null when
// the piece has no hazard resist that a run reads. Pure.
export function pieceHazardResistText(piece: EquipmentInstance): string | null {
  const raw = pieceHazardResist(piece);
  return raw > 0 ? `Hazard resist ${hazardResistEffectText(raw)}` : null;
}
