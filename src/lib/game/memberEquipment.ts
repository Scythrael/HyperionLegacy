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
//   memberEquipment / memberPieceInSlot / memberSlotPieces   queries
//   memberSlotCapacity                    how many pieces of a member slot one member can wear
//   pieceWearableBy                       may a squad type wear this piece (its variety's teamTypes)
//   memberWornIndex                       every member's worn pieces in ONE pass (memberId -> pieces)
//   uniqueWearer                          who wears a (unique-equipped) variety right now, if anyone
//   canFitToMember / fitToMember          the install gate + mutator (singleton swap, targeted implant swap)
//   canUnfitFromMember / unfitFromMember  the uninstall gate + mutator
//   InstallTarget / installTargetsFor     the item-side install list (S5-151), ships AND members
// ============================================================================

import type { AwayMember, EquipmentInstance, GameState, MemberSlotType, MemberVarietyDef } from "./model";
import { isMemberSlotType, isUninstalledPiece, memberVariety, startAutoSalvageGrace } from "./model";
// Imported from reservation.ts (the type-only leaf), the same way equipment.ts does, never from salvage.ts.
import { salvageReservedInstanceIds } from "./reservation";
import { canFitEquipment, type EquipFitBlockReason } from "./equipment";
import { implantSlotsFor, shipCrewLocked } from "./awayTeam";

// ============================================================================
// MemberFitBlockReason
// ============================================================================
// Why a member install (canFitToMember) or uninstall (canUnfitFromMember) is refused. A string union so it
// logs readably and the UI can switch on it exhaustively (see memberFitBlockText).
// THE INSTALL GATE ORDER (the one authoritative list; canFitToMember's header points here). Properties of the
// PIECE first, then the member, then the swap and slot arithmetic, mirroring canFitEquipment:
//   noInstance              no piece has that id
//   notMemberSlot           the piece is SHIP gear (installs on a hull via canFitEquipment)
//   notSpare                the piece is already installed somewhere (!isUninstalledPiece): worn by a member,
//                           including this one, or installed on a ship. FIRST among the piece's states, so a
//                           worn piece that is also locked reads "Already installed", not "Locked".
//   queuedForSalvage        a queued salvage order owns the piece (cancel it to install)
//   committedToLoadout      the (resting) piece is committed to a loadout. Checked as its own reason rather
//                           than folded into notSpare (isSparePiece folds it in), so it stays specific.
//   locked                  the player's Lock flag
//   noMember                no member has that id
//   onMission               the member's ship is crew-locked (shipCrewLocked); a benched member never is
//   wrongTeam               the variety's teamTypes exclude the member's squad, or the piece's variety cannot
//                           be resolved (no stamp, or a retired key), so no squad is known to wear it
//   replaceTargetInvalid    replacingInstanceId is unknown, is the incoming piece, is not worn by this
//                           member, or is a different slot type
//   occupantInLoadout       the OUTGOING piece (the singleton occupant, or the named implant) belongs to a
//                           checked-out loadout, so this install may not swap it out
//   uniqueEquippedElsewhere another piece of the same unique-equipped variety is already worn somewhere.
//                           Before the implant cap: freeing a slot would not make a duplicate allowed.
//   implantSlotsFull        the member already wears implantSlotsFor(member) implants and none is replaced
// The UNINSTALL gate (canUnfitFromMember) returns, in order: noInstance, noMember, notWornByMember (the piece
// exists but this member does not wear it; uninstall only), onMission, occupantInLoadout (the worn piece
// belongs to a checked-out loadout).
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
  | "occupantInLoadout"
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
    case "occupantInLoadout":
      return "The installed piece belongs to a checked-out loadout (check that loadout in first)";
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

// The piece the member wears in a SINGLETON slot, or null when that slot is empty (fitToMember's swap keeps
// at most one each). "implant" is excluded at the type level on purpose: it is a MULTI slot, so "the" implant
// is ambiguous; use memberSlotPieces for it. Pure.
export function memberPieceInSlot(
  state: GameState,
  memberId: string,
  slotType: Exclude<MemberSlotType, "implant">
): EquipmentInstance | null {
  return state.equipment.find((e) => e.fittedToMemberId === memberId && e.slotType === slotType) ?? null;
}

// Every piece the member wears in `slotType`, for ANY member slot, so a slot grid can index singleton and
// implant slots uniformly (index i = the i-th drawn slot). DETERMINISTIC ORDER: by the numeric suffix of the
// "equip-N" id (mint order). This is NOT position-stable: removing a lower-id piece shifts the rest down,
// and a targeted swap's replacement lands by its own mint number, not in the replaced piece's index (a
// position-stable grid would need a persisted slot index; see the Task 10 note in the plan). An id without a
// numeric suffix sorts after, in pool order (Array.prototype.sort is stable). Length is at most
// memberSlotCapacity(member, slotType) because every install goes through canFitToMember, which keeps it
// there; nothing is truncated here, so a worn piece can never be hidden. Pure (fresh array).
export function memberSlotPieces(state: GameState, memberId: string, slotType: MemberSlotType): EquipmentInstance[] {
  return state.equipment
    .filter((e) => e.fittedToMemberId === memberId && e.slotType === slotType)
    .sort(byMintOrder);
}

// The mint-order comparator: by "equip-N" number; equal keys (incl. two Infinity) keep pool order. Pure.
function byMintOrder(a: EquipmentInstance, b: EquipmentInstance): number {
  const x = mintOrder(a.id);
  const y = mintOrder(b.id);
  return x === y ? 0 : x - y;
}

// The mint number of an "equip-N" id (any trailing integer), or Infinity when there is none. Pure.
function mintOrder(id: string): number {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

// How many pieces of `slotType` one member can wear at once: implantSlotsFor(member) for implants, 1 for the
// singleton slots. Pure.
export function memberSlotCapacity(member: Pick<AwayMember, "race">, slotType: MemberSlotType): number {
  return slotType === "implant" ? implantSlotsFor(member) : 1;
}

// May a member of squad `teamType` wear this piece? True only for a MEMBER piece whose stamped variety
// (moduleVariant) resolves and lists that squad in its teamTypes. A ship piece, an unstamped member piece or a
// retired variety key all read false (no squad is known to wear it). THE ONE "which squad wears this" rule,
// shared by the install gate (canFitToMember's wrongTeam) and the Quartermaster's per-squad requisition bound
// (freeSpareBaselinesFor), so the two can never disagree about whose gear a piece is. Pure.
export function pieceWearableBy(
  piece: Pick<EquipmentInstance, "slotType" | "moduleVariant">,
  teamType: AwayMember["teamType"]
): boolean {
  return varietyWearableBy(memberVariety(piece.slotType, piece.moduleVariant ?? ""), teamType);
}

// The rule itself, on an already-resolved variety (undefined = unresolved = nobody). A type guard, so the
// install gate resolves the variety ONCE and keeps using it. Pure.
function varietyWearableBy(
  variety: MemberVarietyDef | undefined,
  teamType: AwayMember["teamType"]
): variety is MemberVarietyDef {
  return variety !== undefined && variety.member.teamTypes.includes(teamType);
}

// Every member's worn pieces in ONE pass over the pool (memberId -> pieces, each list in memberSlotPieces'
// deterministic mint order), so a roster view reads a member's cells and implants without rescanning
// state.equipment per member per slot. A member wearing nothing has no entry. Pure (fresh map + arrays).
export function memberWornIndex(state: GameState): Map<string, EquipmentInstance[]> {
  const out = new Map<string, EquipmentInstance[]>();
  for (const e of state.equipment) {
    if (!e.fittedToMemberId) continue;
    const list = out.get(e.fittedToMemberId);
    if (list) list.push(e);
    else out.set(e.fittedToMemberId, [e]);
  }
  for (const list of out.values()) list.sort(byMintOrder);
  return out;
}

// Who wears a piece of the member variety `varietyKey` in member slot `slotType` right now: the wearing member
// and the worn piece, or null when no piece of it is worn (spare copies in storage do not count). Matched on
// the slot too, because a variety key is only unique WITHIN its slot (the gate's own match does the same).
// Meant for a unique-equipped
// variety (D11, Neural Backup), which canFitToMember keeps to at most ONE worn in the whole fleet, so "the"
// wearer is well defined; for an ordinary variety it is simply the first worn piece in pool order. Reads only
// MEMBER pieces (fittedToMemberId is the authority), so a ship piece never matches. The UI names this member
// instead of the generic uniqueEquippedElsewhere text. Pure.
export function uniqueWearer(
  state: GameState,
  varietyKey: string,
  slotType: MemberSlotType
): { memberId: string; pieceId: string } | null {
  const worn = state.equipment.find(
    (e) => !!e.fittedToMemberId && e.slotType === slotType && e.moduleVariant === varietyKey
  );
  return worn ? { memberId: worn.fittedToMemberId as string, pieceId: worn.id } : null;
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
// GATE ORDER: see the MemberFitBlockReason list above (the one authoritative copy).
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
  return evaluateFit(state, memberId, pieceId, replacingInstanceId).gate;
}

// The whole install evaluation in ONE pass, shared by canFitToMember and fitToMember so the mutator never
// re-derives what the gate already found: the verdict, plus (when ok) the worn piece leaving in the same
// transition (the named replace target, or a singleton's current occupant), null when nothing leaves. Pure.
function evaluateFit(
  state: GameState,
  memberId: string,
  pieceId: string,
  replacingInstanceId: string | undefined
): { gate: MemberFitGate; outgoing: EquipmentInstance | null } {
  const refuse = (reason: MemberFitBlockReason): { gate: MemberFitGate; outgoing: null } => ({
    gate: { ok: false, reason },
    outgoing: null,
  });

  const piece = state.equipment.find((e) => e.id === pieceId);
  if (!piece) return refuse("noInstance");
  if (!isMemberSlotType(piece.slotType)) return refuse("notMemberSlot");
  const slotType = piece.slotType;
  if (!isUninstalledPiece(piece)) return refuse("notSpare");
  // The same central salvage seam canFitEquipment guards: a reserved piece is uninstallable everywhere.
  if (salvageReservedInstanceIds(state).has(pieceId)) return refuse("queuedForSalvage");
  if (piece.committedToLoadoutId !== undefined) return refuse("committedToLoadout");
  if (piece.locked === true) return refuse("locked");
  // Past these checks the piece is a free spare (isSparePiece: uninstalled and not committed).

  const member = state.awayMembers.find((m) => m.id === memberId);
  if (!member) return refuse("noMember");
  if (memberCrewLocked(state, member)) return refuse("onMission");

  // Resolved ONCE; the shared wearable rule (pieceWearableBy's core) also narrows it to defined.
  const variety = memberVariety(slotType, piece.moduleVariant ?? "");
  if (!varietyWearableBy(variety, member.teamType)) return refuse("wrongTeam");

  // The piece leaving in the same transition. A named target must be worn by THIS member, in the SAME slot
  // type, and not the incoming piece itself (for a singleton that is exactly its current occupant, since a
  // singleton holds at most one). No named target: a singleton swaps its occupant (if any); an implant
  // swaps nothing.
  let outgoing: EquipmentInstance | null;
  if (replacingInstanceId !== undefined) {
    const target = state.equipment.find((e) => e.id === replacingInstanceId);
    if (
      target === undefined ||
      target.id === pieceId ||
      target.fittedToMemberId !== member.id ||
      target.slotType !== slotType
    ) {
      return refuse("replaceTargetInvalid");
    }
    outgoing = target;
  } else if (slotType === "implant") {
    outgoing = null;
  } else {
    outgoing = state.equipment.find((e) => e.fittedToMemberId === member.id && e.slotType === slotType) ?? null;
  }
  if (outgoing !== null && outgoing.committedToLoadoutId !== undefined) return refuse("occupantInLoadout");
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
    if (wornElsewhere) return refuse("uniqueEquippedElsewhere");
  }

  // Implant capacity: the implants staying on the member (the outgoing one leaves) must leave a free slot.
  if (slotType === "implant") {
    const staying = state.equipment.filter(
      (e) => e.fittedToMemberId === member.id && e.slotType === "implant" && e.id !== outgoingId
    ).length;
    if (staying >= memberSlotCapacity(member, slotType)) return refuse("implantSlotsFull");
  }

  return { gate: { ok: true }, outgoing };
}

// The " (member M, piece P, replacing R)" suffix the mutators' throw messages carry, so a log line names
// exactly what was refused. Pure.
function idSuffix(memberId: string, pieceId: string, replacingInstanceId?: string): string {
  const replacing = replacingInstanceId !== undefined ? `, replacing ${replacingInstanceId}` : "";
  return ` (member ${memberId}, piece ${pieceId}${replacing})`;
}

// ============================================================================
// fitToMember
// ============================================================================
// Install a spare piece on a member. THROWS with the reason token (and the ids) when the gate refuses. In
// ONE .map(): the incoming piece gets fittedToMemberId; the outgoing piece (the singleton occupant, or the
// named implant) returns to storage with its auto-salvage grace restarted. Only ever MOVES pieces (never
// mints or destroys), so the slot is never briefly double-occupied, the implant count never exceeds the
// cap, and nothing is lost or duplicated. Pure.
export function fitToMember(
  state: GameState,
  memberId: string,
  pieceId: string,
  replacingInstanceId?: string
): GameState {
  const { gate, outgoing } = evaluateFit(state, memberId, pieceId, replacingInstanceId);
  if (!gate.ok) {
    throw new Error(`fitToMember blocked: ${gate.reason}${idSuffix(memberId, pieceId, replacingInstanceId)}`);
  }
  const outgoingId = outgoing?.id;

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
// The uninstall gate (order listed under MemberFitBlockReason). A piece a checked-out squad loadout
// installed reports occupantInLoadout: it is edited in the Armory, mirroring unfitEquipmentInstance. Pure.
export function canUnfitFromMember(state: GameState, memberId: string, pieceId: string): MemberFitGate {
  const piece = state.equipment.find((e) => e.id === pieceId);
  if (!piece) return { ok: false, reason: "noInstance" };
  const member = state.awayMembers.find((m) => m.id === memberId);
  if (!member) return { ok: false, reason: "noMember" };
  if (piece.fittedToMemberId !== memberId) return { ok: false, reason: "notWornByMember" };
  if (memberCrewLocked(state, member)) return { ok: false, reason: "onMission" };
  if (piece.committedToLoadoutId !== undefined) return { ok: false, reason: "occupantInLoadout" };
  return { ok: true };
}

// Uninstall one worn piece: it returns to storage (fittedToMemberId -> null) with its auto-salvage grace
// restarted, and the slot is left empty. THROWS with the reason token when canUnfitFromMember refuses
// (notably while the member's ship is crew-locked). Pure.
export function unfitFromMember(state: GameState, memberId: string, pieceId: string): GameState {
  const gate = canUnfitFromMember(state, memberId, pieceId);
  if (!gate.ok) throw new Error(`unfitFromMember blocked: ${gate.reason}${idSuffix(memberId, pieceId)}`);
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
// moved between hulls), so the Warehouse should offer "Install on..." only on spare rows.
// COST (Task 10): every entry runs a full gate (salvage reservations, uniqueness and capacity scans), so it is
// O(targets x pool). Call it ONCE when a picker opens, never in a per-row reactive statement over the
// Warehouse list. Pure.
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
