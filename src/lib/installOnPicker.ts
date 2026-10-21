// installOnPicker.ts: the row model behind the item-side "Install on..." picker (E-CREW 0.14.0 Task 10,
// inventory S5-151), extracted from App.svelte so it is node-testable. InstallOnPicker.svelte renders the
// rows; App.svelte builds them ONCE when a picker opens (installTargetsFor runs a full gate per target, so
// it is never called per row in a reactive statement) and routes the clicks to its install handlers.
//
// Ship gear lists only ships and member gear only members, by construction (installTargetsFor). A target
// the gate refuses stays listed, disabled, with its reason. A member at the implant cap also lists one
// "Replace <implant>" choice per worn implant (the targeted swap), each with its own gate. A UNIQUE piece
// (Task 11, Neural Backup) refused because a copy is worn names that wearer ("Installed on Kira Vale
// (Aurora)") instead of the generic line; the wearer's own row never names them to themselves ("Already
// wears one (swap it below)") and offers the one swap the gate allows: trading the copy they wear for this. Usable targets
// come first (a stable sort keeps fleet / roster order within each band). The list is a SNAPSHOT: the click
// re-runs the real gate in the host's handlers, so a stale target is refused there, never half-applied.

import type { EquipmentInstance, GameState } from "./game/model";
import { SHIP_TYPES, isMemberSlotType, shipDisplayLabels } from "./game/model";
import type { EquipFitRefusal } from "./game/equipment";
import { canFitToMember, installTargetsFor, memberPieceInSlot, memberSlotPieces, uniqueWearer } from "./game/memberEquipment";
import { crewRankLabel } from "./game/crewRank";
import { SQUAD_META, awayTargetLabel } from "./awayTeamDisplay";
import { memberFitReasonText, memberPieceName } from "./awayGearDisplay";

// One "Replace <implant>" choice under a member whose implant slots are full.
export interface InstallOnReplace {
  id: string; // the worn implant this swap sends back to storage
  name: string;
  ok: boolean;
  reason: string; // "" when ok
}

// One target row: a ship (ship gear) or a member (member gear).
export interface InstallOnRow {
  key: string; // unique per row ("ship:<id>" / "member:<id>")
  kind: "ship" | "member";
  targetId: string;
  label: string;
  sub: string; // the hull class under a custom ship name; rank, squad and "wears X" for a member
  ok: boolean;
  reason: string; // "" when ok
  replace: InstallOnReplace[];
}

// Sentence-case a lower-case reason line (the ship gate's reason text reads lower case). Pure.
export function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Is a row worth listing first: installable itself, or offering at least one installable implant swap.
function usable(r: InstallOnRow): number {
  return r.ok || r.replace.some((x) => x.ok) ? 1 : 0;
}

// The picker's rows for one piece. `shipReasonText` renders a ship gate refusal (the host owns that
// wording, App.svelte devFitReasonText); member refusals use memberFitReasonText (memberFitBlockText, or the
// wearer for a unique refusal). Pure.
export function buildInstallOnRows(
  s: GameState,
  pieceId: string,
  shipReasonText: (refusal: EquipFitRefusal) => string
): InstallOnRow[] {
  const labels = shipDisplayLabels(s.ships);
  const piece: EquipmentInstance | undefined = s.equipment.find((e) => e.id === pieceId);
  const rows = installTargetsFor(s, pieceId).map((t): InstallOnRow => {
    if (t.kind === "ship") {
      const ship = s.ships.find((x) => x.id === t.shipId);
      const label = labels.get(t.shipId) ?? t.shipId;
      // The hull class under a custom name; nothing when the label already is (or starts with) the class.
      const hull = ship ? SHIP_TYPES[ship.typeKey]?.label ?? "" : "";
      return {
        key: `ship:${t.shipId}`,
        kind: "ship",
        targetId: t.shipId,
        label,
        sub: hull !== "" && !label.startsWith(hull) ? hull : "",
        ok: t.ok,
        reason: t.ok || t.refusal === undefined ? "" : sentenceCase(shipReasonText(t.refusal)),
        replace: [],
      };
    }
    const m = s.awayMembers.find((x) => x.id === t.memberId);
    const ship = m && m.assignedShipId !== null ? s.ships.find((x) => x.id === m.assignedShipId) : undefined;
    const where = m ? (ship ? awayTargetLabel(ship, m.teamType) : `Unassigned · ${SQUAD_META[m.teamType].short}`) : "";
    // What the slot holds now, so the row says what a singleton install would swap out.
    const occupant =
      m && piece && isMemberSlotType(piece.slotType) && piece.slotType !== "implant"
        ? memberPieceInSlot(s, m.id, piece.slotType)
        : null;
    // The worn implants a targeted swap could send back: every one at the cap, or, for the member who
    // already wears a copy of this unique piece, just that copy (swapping anything else would still leave
    // two worn, so the gate would refuse it).
    let swappable: EquipmentInstance[] = [];
    if (!t.ok && m) {
      if (t.reason === "implantSlotsFull") {
        swappable = memberSlotPieces(s, m.id, "implant");
      } else if (
        t.reason === "uniqueEquippedElsewhere" &&
        piece?.moduleVariant !== undefined &&
        isMemberSlotType(piece.slotType)
      ) {
        const worn = uniqueWearer(s, piece.moduleVariant, piece.slotType);
        const wornPiece = worn !== null && worn.memberId === m.id ? s.equipment.find((e) => e.id === worn.pieceId) : undefined;
        if (wornPiece !== undefined) swappable = [wornPiece];
      }
    }
    const replace: InstallOnReplace[] = m
      ? swappable.map((imp) => {
          const g = canFitToMember(s, m.id, pieceId, imp.id);
          return { id: imp.id, name: memberPieceName(imp), ok: g.ok, reason: g.ok ? "" : memberFitReasonText(s, pieceId, g.reason, m.id) };
        })
      : [];
    return {
      key: `member:${t.memberId}`,
      kind: "member",
      targetId: t.memberId,
      label: m ? m.name : t.memberId,
      sub: m ? `${crewRankLabel(m.rank)} · ${where}${occupant ? ` · wears ${memberPieceName(occupant)}` : ""}` : "",
      ok: t.ok,
      reason: t.ok || t.reason === undefined ? "" : memberFitReasonText(s, pieceId, t.reason, t.memberId),
      replace,
    };
  });
  return rows.sort((a, b) => usable(b) - usable(a)); // stable: fleet / roster order within each band
}
