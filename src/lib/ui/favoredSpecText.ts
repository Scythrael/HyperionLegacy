// favoredSpecText.ts: the player-facing FAVORED SPEC readout (WR-7 follow-up, OC-D5; user 2026-10-29 "+10% on its ship
// type"). A piece whose variety favors a hull spec (the Prospector Hold, the Prospecting Rigs, the Damage Control Suite,
// the Pathfinder Suite) counts every one of its lines +FAVORED_SPEC_LINE_BONUS while installed on a hull of that spec
// (model.ts withFavoredLines). The tooltip keeps the lines as rolled and says what the bonus does; where the host knows
// the hull (Ship Systems), it says whether the bonus applies on it, and the readouts derived from the lines read the
// favored values (favoredReadPiece).
//
// Pure presentation, node-testable (no Svelte harness); no game rules live here.

import {
  FAVORED_SPEC_LINE_BONUS,
  SHIP_TYPES,
  favoredPieceView,
  pieceFavoredSpec,
  pieceFavorsHull,
  withFavoredLines,
  type EquipmentInstance,
  type ShipSpec,
  type ShipTypeKey,
} from "../game/model";

const SPEC_LABEL: Record<ShipSpec, string> = { general: "General", prospector: "Prospector", tactician: "Tactician", explorer: "Explorer" };

// The bonus as a whole percent ("10").
const pct = (): string => String(Math.round(FAVORED_SPEC_LINE_BONUS * 100));

// The tooltip line for a favored-variety piece, or null for every other piece. With `hostTypeKey` (the hull the host
// shows it on): "Favored hull: every line counts +10% on this Hauler" when it applies there, else the general rule
// "Favors Prospector hulls: every line counts +10% while installed on one". Pure.
export function favoredSpecText(piece: EquipmentInstance, hostTypeKey?: ShipTypeKey): string | null {
  const spec = pieceFavoredSpec(piece);
  if (spec === undefined) return null;
  if (hostTypeKey !== undefined && pieceFavorsHull(piece, hostTypeKey)) return `Favored hull: every line counts +${pct()}% on this ${SHIP_TYPES[hostTypeKey].label}`;
  return `Favors ${SPEC_LABEL[spec]} hulls: every line counts +${pct()}% while installed on one`;
}

// The piece as its readers fold it on `hostTypeKey` (its favored lines when favored there; the piece itself otherwise
// or without a host), for the readouts derived from its lines (hazard resist, material quality). Pure.
export function favoredReadPiece(piece: EquipmentInstance, hostTypeKey?: ShipTypeKey): EquipmentInstance {
  return hostTypeKey !== undefined && pieceFavorsHull(piece, hostTypeKey) ? favoredPieceView(piece) : piece;
}

// The ship's pieces as their readers fold them on `hostTypeKey` (undefined stays undefined). Pure.
export function favoredReadPieces(pieces: EquipmentInstance[] | undefined, hostTypeKey?: ShipTypeKey): EquipmentInstance[] | undefined {
  return pieces === undefined || hostTypeKey === undefined ? pieces : withFavoredLines(pieces, hostTypeKey);
}
