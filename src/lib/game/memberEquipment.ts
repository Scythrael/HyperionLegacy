// ============================================================================
// E-CREW 0.14.0 (Task 8): installing gear on away-team MEMBERS, plus the item-side install list.
//
// The member analogue of equipment.ts (canFitEquipment / fitEquipment / unfitEquipmentInstance), in the
// SAME pure, immutable posture: every mutator returns a NEW GameState and never touches its input; the gate
// is a pure predicate with a typed reason; the mutators THROW on a blocked call (see equipment.ts
// fitEquipment, WHY THROW: the bare-GameState signature makes a silent no-op indistinguishable from a real
// change, and the UI asks the gate first, so a throw is a defensive assertion on a vetted call).
//
// THE ONE INVARIANT: EquipmentInstance.fittedToMemberId is the authority for which MEMBER wears a piece
// (absent or null = worn by nobody), exactly as fittedToShipId is for ships. "Install" == set it,
// "uninstall" == null it, "what does member M wear" == filter by it. No second bookkeeping list.
//
// WHY A SEPARATE FILE (not equipment.ts): the gate needs awayTeam.ts (shipCrewLocked, implantSlotsFor), and
// awayTeam.ts already imports onMissionLock from equipment.ts, so putting this in equipment.ts would close an
// equipment <-> awayTeam import cycle. This file imports both and nothing imports it back.
//
// SLOT SHAPES (design D3/D8):
//   memberArmor / memberWeapon / memberTool  SINGLETONS: one per member. Installing into an occupied slot
//                                            SWAPS: the occupant returns to storage in the same transition.
//   implant                                  MULTI, capped by implantSlotsFor(member) (1, or 2 with augment
//                                            affinity). Over the cap the install is refused (implantSlotsFull)
//                                            unless replacingInstanceId names one of the member's implants: a
//                                            TARGETED SWAP, mirroring the 0.13.9 ship weapon / drone pod swap
//                                            (one transition, never over cap, nothing lost or duplicated).
//
// ⚠️ EVERY ROUTE HERE THAT POOLS A PIECE RESTARTS ITS AUTO-SALVAGE GRACE (startAutoSalvageGrace, model.ts),
// for the reason equipment.ts's header gives: worn gear is never an auto-salvage candidate, so without the
// stamp a piece the player just took off would be fully exposed the same instant. The routes:
//   fitToMember       the singleton swap's displaced occupant, and the targeted implant swap's outgoing piece
//   unfitFromMember   the uninstalled piece
// fireAwayMember (awayTeam.ts) pools everything a fired member wore and stamps it the same way.
//
// UNIQUE-EQUIPPED (D11, Neural Backup): ONE worn in the entire fleet, period. A piece whose variety carries
// member.uniqueEquipped refuses (uniqueEquippedElsewhere) while ANY other piece of the SAME variety is worn by
// ANY member (on any ship, or benched), including the target member. The one exception is the piece this
// install REPLACES: swapping a worn Neural Backup for a better-rolled one on the same member is allowed,
// because the old one leaves in the same transition. Swapping a piece for ITSELF is refused: the incoming
// piece is already worn, so it fails notSpare before any swap logic runs.
//
// Contents:
//   MemberFitBlockReason / MemberFitGate  the typed reasons + verdict shape
//   memberFitBlockText                    player-facing text per reason (exhaustive)
//   memberEquipment / memberPieceInSlot   queries
//   memberSlotCapacity                    how many pieces of a member slot one member can wear
//   canFitToMember / fitToMember          the install gate + mutator (singleton swap, targeted implant swap)
//   canUnfitFromMember / unfitFromMember  the uninstall gate + mutator
//   InstallTarget / installTargetsFor     the item-side install list (S5-151), ships AND members
// ============================================================================

import type { AwayMember, EquipmentInstance, GameState, MemberSlotType } from "./model";
import { isMemberSlotType, isSparePiece, memberVariety, startAutoSalvageGrace } from "./model";
// Imported from reservation.ts (the type-only leaf), the same way equipment.ts does, never from salvage.ts.
import { salvageReservedInstanceIds } from "./reservation";
import { canFitEquipment, type EquipFitBlockReason } from "./equipment";
import { implantSlotsFor, shipCrewLocked } from "./awayTeam";

// ============================================================================
// MemberFitBlockReason
// ============================================================================
// Why a member install (canFitToMember) or uninstall (canUnfitFromMember) is refused. A string union so it
// logs readably and the UI can switch on it exhaustively (see memberFitBlockText). Install gate order:
//   noInstance              no piece has that id
//   notMemberSlot           the piece is SHIP gear (installs on a hull via canFitEquipment)
//   queuedForSalvage        a queued salvage order owns the piece (cancel it to install)
//   committedToLoadout      the piece is committed to a loadout; ALSO returned when the piece an install
//                           would swap out (a singleton occupant or the named implant) is held by a loadout
//   locked                  the player's Lock flag
//   notSpare                the piece is not a free spare (isSparePiece false): worn by a member, including
//                           this one, or installed on a ship
//   noMember                no member has that id
//   onMission               the member's ship is crew-locked (shipCrewLocked); a benched member never is
//   wrongTeam               the variety's teamTypes exclude the member's squad, or the piece's variety cannot
//                           be resolved (no stamp, or a retired key), so no squad is known to wear it
//   replaceTargetInvalid    replacingInstanceId is unknown, is the incoming piece, is not worn by this
//                           member, or is a different slot type
//   uniqueEquippedElsewhere another piece of the same unique-equipped variety is already worn somewhere
//   implantSlotsFull        the member already wears implantSlotsFor(member) implants and none is replaced
// Uninstall gate only:
//   notWornByMember         the piece exists but this member does not wear it
// (The uninstall gate also returns noInstance, noMember, onMission and committedToLoadout.)
export type MemberFitBlockReason =
  | "noInstance"
  | "notMemberSlot"
  | "queuedForSalvage"
  | "committedToLoadout"
  | "locked"
  | "notSpare"
  | "noMember"
  | "onMission"
  | "wrongTeam"
  | "replaceTargetInvalid"
  | "uniqueEquippedElsewhere"
  | "implantSlotsFull"
  | "notWornByMember";

export type MemberFitGate = { ok: true } | { ok: false; reason: MemberFitBlockReason };

// The player-facing line for a block reason (US English), shown on a disabled control. EXHAUSTIVE with no
// default on purpose (the awayCrewBlockText pattern): a new reason is a compile error here until it has text.
// Says "install", never "fit". Pure.
export function memberFitBlockText(reason: MemberFitBlockReason): string {
  switch (reason) {
    case "noInstance":
      return "No longer in storage";
    case "notMemberSlot":
      return "Ship gear installs on a ship, not a crew member";
    case "queuedForSalvage":
      return "Queued for salvage (cancel the salvage order to install it)";
    case "committedToLoadout":
      return "Committed to a loadout (uninstall it there first)";
    case "locked":
      return "Locked (unlock it first)";
    case "notSpare":
      return "Already installed";
    case "noMember":
      return "No longer in the fleet";
    case "onMission":
      return "Ship is out on a mission";
    case "wrongTeam":
      return "This squad cannot use this gear";
    case "replaceTargetInvalid":
      return "The piece to replace is no longer installed";
    case "uniqueEquippedElsewhere":
      return "Unique: only one can be installed in the whole fleet";
    case "implantSlotsFull":
      return "All implant slots are full (replace an implant instead)";
    case "notWornByMember":
      return "Not installed on this crew member";
  }
}

// ============================================================================
// Queries
// ============================================================================

// Every piece the member wears, read straight off the fittedToMemberId authority, in pool order. Pure.
export function memberEquipment(state: GameState, memberId: string): EquipmentInstance[] {
  return state.equipment.filter((e) => e.fittedToMemberId === memberId);
}

// The piece the member wears in `slotType`, or null when that slot is empty. Exact for the three singleton
// slots (fitToMember's swap keeps at most one each). For "implant", a MULTI slot, it returns the FIRST worn
// implant only; read every implant with memberEquipment(...).filter(e => e.slotType === "implant"). Pure.
export function memberPieceInSlot(
  state: GameState,
  memberId: string,
  slotType: MemberSlotType
): EquipmentInstance | null {
  return state.equipment.find((e) => e.fittedToMemberId === memberId && e.slotType === slotType) ?? null;
}

// How many pieces of `slotType` one member can wear at once: implantSlotsFor(member) for implants, 1 for the
// singleton slots. Pure.
export function memberSlotCapacity(member: Pick<AwayMember, "race">, slotType: MemberSlotType): number {
  return slotType === "implant" ? implantSlotsFor(member) : 1;
}

// Is this member crew-locked right now? A benched member (assignedShipId null) never is. Pure.
function memberCrewLocked(state: GameState, member: AwayMember): boolean {
  return member.assignedShipId !== null && shipCrewLocked(state, member.assignedShipId);
}

// ============================================================================
// canFitToMember
// ============================================================================
// THE member install gate: can this spare piece be installed on this member right now? Pure; the single
// source of truth fitToMember consults, and what the UI calls to enable an Install button with its reason.
//
// GATE ORDER (properties of the PIECE first, then the member, then the slot arithmetic), mirroring
// canFitEquipment: noInstance -> notMemberSlot -> queuedForSalvage -> committedToLoadout -> locked ->
// notSpare -> noMember -> onMission -> wrongTeam -> replaceTargetInvalid (and committedToLoadout for the
// outgoing piece) -> uniqueEquippedElsewhere -> implantSlotsFull. committedToLoadout sits BEFORE notSpare on
// purpose: isSparePiece also folds in the commitment, so checking it first keeps the more specific reason
// reachable. Uniqueness precedes the implant cap because freeing a slot would not help a duplicate.
//
// replacingInstanceId (optional): the worn piece this install swaps out. Required to swap at the implant
// cap. Accepted for a singleton too when it names that slot's current occupant (the same swap the singleton
// makes on its own, so a UI may pass the occupant uniformly).
export function canFitToMember(
  state: GameState,
  memberId: string,
  pieceId: string,
  replacingInstanceId?: string
): MemberFitGate {
  const piece = state.equipment.find((e) => e.id === pieceId);
  if (!piece) return { ok: false, reason: "noInstance" };
  if (!isMemberSlotType(piece.slotType)) return { ok: false, reason: "notMemberSlot" };
  const slotType = piece.slotType;
  // The same central salvage seam canFitEquipment guards: a reserved piece is uninstallable everywhere.
  if (salvageReservedInstanceIds(state).has(pieceId)) return { ok: false, reason: "queuedForSalvage" };
  if (piece.committedToLoadoutId !== undefined) return { ok: false, reason: "committedToLoadout" };
  if (piece.locked === true) return { ok: false, reason: "locked" };
  if (!isSparePiece(piece)) return { ok: false, reason: "notSpare" };

  const member = state.awayMembers.find((m) => m.id === memberId);
  if (!member) return { ok: false, reason: "noMember" };
  if (memberCrewLocked(state, member)) return { ok: false, reason: "onMission" };

  const variety = memberVariety(slotType, piece.moduleVariant ?? "");
  if (!variety || !variety.member.teamTypes.includes(member.teamType)) return { ok: false, reason: "wrongTeam" };

  // The piece(s) leaving in the same transition: the named replace target, or (singleton) the occupant.
  const outgoing = outgoingPieceFor(state, member.id, piece, replacingInstanceId);
  if (outgoing === "invalid") return { ok: false, reason: "replaceTargetInvalid" };
  if (outgoing !== null && outgoing.committedToLoadoutId !== undefined) {
    return { ok: false, reason: "committedToLoadout" };
  }
  const outgoingId = outgoing?.id;

  // Fleet-wide uniqueness: any OTHER worn piece of the same variety blocks, except the one being swapped out.
  if (variety.member.uniqueEquipped === true) {
    const wornElsewhere = state.equipment.some(
      (e) =>
        e.id !== pieceId &&
        e.id !== outgoingId &&
        !!e.fittedToMemberId &&
        e.slotType === slotType &&
        e.moduleVariant === piece.moduleVariant
    );
    if (wornElsewhere) return { ok: false, reason: "uniqueEquippedElsewhere" };
  }

  // Implant capacity: the implants staying on the member (the outgoing one leaves) must leave a free slot.
  if (slotType === "implant") {
    const staying = state.equipment.filter(
      (e) => e.fittedToMemberId === member.id && e.slotType === "implant" && e.id !== outgoingId
    ).length;
    if (staying >= memberSlotCapacity(member, slotType)) return { ok: false, reason: "implantSlotsFull" };
  }

  return { ok: true };
}

// The worn piece an install of `incoming` on this member would swap out, null when none, or "invalid" when
// replacingInstanceId names something that is not a valid swap-out target. Pure.
//   - A named target must be worn by THIS member, in the SAME slot type, and not the incoming piece itself.
//     (For a singleton that is exactly its current occupant, since a singleton holds at most one.)
//   - No named target: a singleton swaps its current occupant (if any); an implant swaps nothing.
function outgoingPieceFor(
  state: GameState,
  memberId: string,
  incoming: EquipmentInstance,
  replacingInstanceId: string | undefined
): EquipmentInstance | null | "invalid" {
  if (replacingInstanceId !== undefined) {
    const target = state.equipment.find((e) => e.id === replacingInstanceId);
    if (
      target === undefined ||
      target.id === incoming.id ||
      target.fittedToMemberId !== memberId ||
      target.slotType !== incoming.slotType
    ) {
      return "invalid";
    }
    return target;
  }
  if (incoming.slotType === "implant") return null;
  return state.equipment.find((e) => e.fittedToMemberId === memberId && e.slotType === incoming.slotType) ?? null;
}

// ============================================================================
// fitToMember
// ============================================================================
// Install a spare piece on a member. THROWS with the reason token when canFitToMember refuses. In ONE .map():
// the incoming piece gets fittedToMemberId; the outgoing piece (the singleton occupant, or the named implant)
// returns to storage with its auto-salvage grace restarted. Only ever MOVES pieces (never mints or destroys),
// so the slot is never briefly double-occupied, the implant count never exceeds the cap, and nothing is lost
// or duplicated. Pure.
export function fitToMember(
  state: GameState,
  memberId: string,
  pieceId: string,
  replacingInstanceId?: string
): GameState {
  const gate = canFitToMember(state, memberId, pieceId, replacingInstanceId);
  if (!gate.ok) throw new Error(`fitToMember blocked: ${gate.reason}`);

  // gate.ok guarantees the piece exists and the outgoing piece (if any) is valid.
  const incoming = state.equipment.find((e) => e.id === pieceId)!;
  const outgoing = outgoingPieceFor(state, memberId, incoming, replacingInstanceId);
  const outgoingId = outgoing !== null && outgoing !== "invalid" ? outgoing.id : undefined;

  return {
    ...state,
    equipment: state.equipment.map((e) => {
      if (e.id === pieceId) return { ...e, fittedToMemberId: memberId };
      if (outgoingId !== undefined && e.id === outgoingId) {
        return startAutoSalvageGrace({ ...e, fittedToMemberId: null }, state.gameTimeSeconds);
      }
      return e;
    }),
  };
}

// ============================================================================
// canUnfitFromMember / unfitFromMember
// ============================================================================
// The uninstall gate: noInstance -> noMember -> notWornByMember -> onMission -> committedToLoadout (a piece
// a checked-out squad loadout installed is edited in the Armory, mirroring unfitEquipmentInstance). Pure.
export function canUnfitFromMember(state: GameState, memberId: string, pieceId: string): MemberFitGate {
  const piece = state.equipment.find((e) => e.id === pieceId);
  if (!piece) return { ok: false, reason: "noInstance" };
  const member = state.awayMembers.find((m) => m.id === memberId);
  if (!member) return { ok: false, reason: "noMember" };
  if (piece.fittedToMemberId !== memberId) return { ok: false, reason: "notWornByMember" };
  if (memberCrewLocked(state, member)) return { ok: false, reason: "onMission" };
  if (piece.committedToLoadoutId !== undefined) return { ok: false, reason: "committedToLoadout" };
  return { ok: true };
}

// Uninstall one worn piece: it returns to storage (fittedToMemberId -> null) with its auto-salvage grace
// restarted, and the slot is left empty. THROWS with the reason token when canUnfitFromMember refuses
// (notably while the member's ship is crew-locked). Pure.
export function unfitFromMember(state: GameState, memberId: string, pieceId: string): GameState {
  const gate = canUnfitFromMember(state, memberId, pieceId);
  if (!gate.ok) throw new Error(`unfitFromMember blocked: ${gate.reason}`);
  return {
    ...state,
    equipment: state.equipment.map((e) =>
      e.id === pieceId ? startAutoSalvageGrace({ ...e, fittedToMemberId: null }, state.gameTimeSeconds) : e
    ),
  };
}

// ============================================================================
// installTargetsFor (S5-151, install from the item side)
// ============================================================================
// One discriminated entry per possible target: SHIP gear lists every ship (fleet order) with
// canFitEquipment's verdict; MEMBER gear lists every member (roster order) with canFitToMember's verdict.
// Disabled targets stay in the list with their reason so the picker can show why. An unknown piece has no
// kind to list, so it returns []. NOTE: canFitEquipment does not itself require a spare (a ship piece may be
// moved between hulls), so the Warehouse should offer "Install on..." only on spare rows. Pure.
export type InstallTarget =
  | { kind: "ship"; shipId: string; ok: boolean; reason?: EquipFitBlockReason }
  | { kind: "member"; memberId: string; ok: boolean; reason?: MemberFitBlockReason };

export function installTargetsFor(state: GameState, pieceId: string): InstallTarget[] {
  const piece = state.equipment.find((e) => e.id === pieceId);
  if (!piece) return [];
  if (isMemberSlotType(piece.slotType)) {
    return state.awayMembers.map((m): InstallTarget => {
      const gate = canFitToMember(state, m.id, pieceId);
      return gate.ok
        ? { kind: "member", memberId: m.id, ok: true }
        : { kind: "member", memberId: m.id, ok: false, reason: gate.reason };
    });
  }
  return state.ships.map((s): InstallTarget => {
    const gate = canFitEquipment(state, s.id, pieceId);
    return gate.ok
      ? { kind: "ship", shipId: s.id, ok: true }
      : { kind: "ship", shipId: s.id, ok: false, reason: gate.reason };
  });
}
