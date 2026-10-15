// awayGearDisplay.ts: player-facing labels + tiny pure helpers for away-team MEMBER gear (E-CREW "Crew Made
// Real", Task 10). Shared by the member cards (AwayTeamPanel.svelte), the Logistics "Away-Team Gear" tab, the
// Salvage Bay, the Archive, the Fabricator / Research / Crafted Blanks groupings and the item tooltip, so every
// surface names a member piece and groups member blueprints ONE way.
//
// Same posture as awayTeamDisplay.ts: pure presentation data kept out of the components so it is node-testable
// (this repo has no Svelte component test harness). No game rules live here; the install gates are
// game/memberEquipment.ts and the catalog is game/model.ts.

import type { AwayTeamType, BlueprintDef, EquipmentInstance, EquipmentSlotType, GameState, MemberSlotType } from "./game/model";
import { EQUIPMENT_SLOTS, MEMBER_SLOT_TYPES, isMemberSlotType, memberVariety, shipDisplayLabel } from "./game/model";
import { memberFitBlockText, uniqueWearer, type MemberFitBlockReason } from "./game/memberEquipment";
import { crewLockText } from "./game/crewLock";
import { SQUAD_META } from "./awayTeamDisplay";
import { hasMedicalTraining } from "./game/awayTraits";
import type { IconName } from "./ui/icons";

// ============================================================================
// Member slot labels + glyphs
// ============================================================================
// The short cell heading the member card uses ("Weapon"), the group heading for a list of spares
// ("Weapons"), and the SVG glyph (icons.ts). The catalog's own slot labels read "Away-Team Weapon" so
// shared surfaces never confuse a member weapon with a ship weapon; inside an away-team surface the short
// noun is enough. EXHAUSTIVE over MemberSlotType, so a fifth member slot is a compile error here.
export interface MemberSlotMeta {
  label: string;
  plural: string;
  icon: IconName;
}
export const MEMBER_SLOT_META: Record<MemberSlotType, MemberSlotMeta> = {
  memberArmor: { label: "Armor", plural: "Armor", icon: "armor" },
  memberWeapon: { label: "Weapon", plural: "Weapons", icon: "weaponHand" },
  memberTool: { label: "Tool", plural: "Tools", icon: "tool" },
  implant: { label: "Implant", plural: "Implants", icon: "implant" },
};

// The SVG glyph for a member slot, or null for a ship slot (whose surfaces keep their own glyphs). Lets a
// shared tile loop (Salvage Bay, Crafted Blanks) draw a member piece's glyph without a cast. Pure.
export function memberSlotIcon(slotType: string): IconName | null {
  return isMemberSlotType(slotType) ? MEMBER_SLOT_META[slotType].icon : null;
}

// The three singleton slots a member card draws as cells, in the approved mockup's order.
export const MEMBER_GEAR_CELLS: readonly Exclude<MemberSlotType, "implant">[] = ["memberArmor", "memberWeapon", "memberTool"];

// ============================================================================
// Naming
// ============================================================================
// A member piece's player-facing NAME: its variety label ("Pulse Rifle"), with "Standard-Issue " in front for
// a Quartermaster baseline (blueprintKey null), so a requisitioned rifle reads "Standard-Issue Pulse Rifle"
// rather than a bare "Standard-Issue". A crafted piece reads its variety label, which is its blueprint's name
// minus " Blueprint". A piece whose variety cannot be resolved (no stamp, a retired key) falls back to the
// slot's catalog label. Meant for MEMBER pieces; a ship piece just reads its slot label. Pure.
export function memberPieceName(piece: Pick<EquipmentInstance, "slotType" | "moduleVariant" | "blueprintKey">): string {
  const variety = memberVariety(piece.slotType, piece.moduleVariant ?? "");
  const base = variety?.label ?? EQUIPMENT_SLOTS[piece.slotType]?.label ?? piece.slotType;
  return piece.blueprintKey === null ? `Standard-Issue ${base}` : base;
}

// Which squads may wear a member piece, as a short line ("Security only", "Security or Science"), or "" when
// the variety does not resolve. The member twin of a ship piece's hull / captain requirement. Pure.
export function memberWearersText(piece: Pick<EquipmentInstance, "slotType" | "moduleVariant">): string {
  const variety = memberVariety(piece.slotType, piece.moduleVariant ?? "");
  if (variety === undefined) return "";
  const names = variety.member.teamTypes.map((t: AwayTeamType) => SQUAD_META[t].short);
  if (names.length === 0) return "";
  return names.length === 1 ? `${names[0]} only` : names.join(" or ");
}

// ============================================================================
// Medical Training (D20): the Med Kit's heal needs it
// ============================================================================
// The hint every surface that lists or installs a Med Kit shows (Quartermaster, Logistics, the member card
// and its install flow). Its stat lines apply to anyone; only the healing needs the training.
export const NEEDS_MEDICAL_TRAINING_TEXT = "Needs Medical Training";
// The muted line under a Med Kit worn by (or offered to) a member WITHOUT the training.
export const UNTRAINED_MED_KIT_TEXT = "Needs Medical Training: no healing for this member";

// Does this piece's ground effect need Medical Training (a heal tool: the Med Kit)? Pure.
export function pieceNeedsMedicalTraining(piece: Pick<EquipmentInstance, "slotType" | "moduleVariant">): boolean {
  return memberVariety(piece.slotType, piece.moduleVariant ?? "")?.member.groundEffect?.kind === "heal";
}

// The untrained note for a piece on (or offered to) a member: UNTRAINED_MED_KIT_TEXT when the piece needs
// Medical Training and the member lacks it, else null. Pure.
export function untrainedGearNote(
  piece: Pick<EquipmentInstance, "slotType" | "moduleVariant">,
  member: { readonly traits: readonly string[] }
): string | null {
  return pieceNeedsMedicalTraining(piece) && !hasMedicalTraining(member) ? UNTRAINED_MED_KIT_TEXT : null;
}

// ============================================================================
// Grouping the spare pool
// ============================================================================
export interface MemberSpareGroup {
  slot: MemberSlotType;
  label: string;
  icon: IconName;
  pieces: EquipmentInstance[];
}

// The given pieces' MEMBER pieces grouped by slot in MEMBER_SLOT_TYPES order (Armor, Weapon, Tool, Implant),
// empty groups dropped. Favorites sort to the top of their group (the Ship Equipment bay's display pin); the
// sort is stable, so otherwise pool order is kept. The caller passes the SPARE pool (isSparePiece); ship
// pieces in the input are ignored. Pure (fresh arrays).
export function groupMemberSpares(pieces: readonly EquipmentInstance[]): MemberSpareGroup[] {
  return MEMBER_SLOT_TYPES.map((slot) => ({
    slot,
    label: MEMBER_SLOT_META[slot].plural,
    icon: MEMBER_SLOT_META[slot].icon,
    pieces: pieces
      .filter((p) => p.slotType === slot)
      .sort((a, b) => (b.favorite === true ? 1 : 0) - (a.favorite === true ? 1 : 0)),
  })).filter((g) => g.pieces.length > 0);
}

// ============================================================================
// Gear categories (Fabricator / Research / Crafted Blanks / Archive groupings)
// ============================================================================
// Which shelf a piece of gear belongs on: SHIP systems, away-team GEAR (armor / weapon / tool), or IMPLANTS.
// The approved mockup (section 6) gives the Fabricator "Ship Systems" / "Away-Team Gear" / "Implants" and
// Logistics a separate "Away-Team Gear" tab, so these are the three names every grouping uses.
export type GearCategory = "ship" | "awayTeam" | "implant";
export const GEAR_CATEGORY_LABEL: Record<GearCategory, string> = {
  ship: "Ship Systems",
  awayTeam: "Away-Team Gear",
  implant: "Implants",
};
export const GEAR_CATEGORY_ORDER: readonly GearCategory[] = ["ship", "awayTeam", "implant"];

// The category of a slot type. Pure.
export function gearCategoryOfSlot(slotType: EquipmentSlotType | string): GearCategory {
  if (slotType === "implant") return "implant";
  return isMemberSlotType(slotType) ? "awayTeam" : "ship";
}

// The category of a blueprint's crafted output, or null for a blueprint that mints no gear (a material, or an
// unlock-only hull gate). Weapon and drone-pod blueprints are ship gear. Pure.
export function blueprintGearCategory(
  bp: Pick<BlueprintDef, "unlockOnly" | "weaponOutput" | "droneOutput" | "equipmentOutput">
): GearCategory | null {
  if (bp.unlockOnly) return null;
  if (bp.weaponOutput || bp.droneOutput) return "ship";
  if (bp.equipmentOutput) return gearCategoryOfSlot(bp.equipmentOutput.slotType);
  return null;
}

// ============================================================================
// Member compare (the member install flow's "what changes" readout)
// ============================================================================
// A piece's ground stat lines summed per key (implicit + rolled), in first-seen order. Pure.
export function pieceStatTotals(piece: Pick<EquipmentInstance, "implicitStats" | "rolledStats">): [string, number][] {
  const out = new Map<string, number>();
  for (const [k, v] of Object.entries(piece.implicitStats)) out.set(k, (out.get(k) ?? 0) + v);
  for (const [k, v] of Object.entries(piece.rolledStats)) out.set(k, (out.get(k) ?? 0) + v);
  return [...out.entries()];
}

export interface MemberCompareRow {
  key: string; // the stat key (the caller labels it with EquipmentTooltip's statLabel)
  current: number; // what the slot gives now (0 for an empty slot or a line the current piece lacks)
  candidate: number; // what the candidate piece would give
  delta: number; // candidate - current
}

// A simple per-stat compare for swapping `current` (the worn piece, or null for an empty slot) for
// `candidate`: one row per stat key either piece carries, candidate's keys first then any the current piece
// alone has. A member's stats are the plain sum of their gear lines (no fold with diminishing returns yet:
// member power is design 5.3, a later task), so a per-piece difference IS the member's change. Pure.
export function memberCompareRows(
  current: Pick<EquipmentInstance, "implicitStats" | "rolledStats"> | null,
  candidate: Pick<EquipmentInstance, "implicitStats" | "rolledStats">
): MemberCompareRow[] {
  const cur = new Map(current === null ? [] : pieceStatTotals(current));
  const cand = pieceStatTotals(candidate);
  const keys = [...cand.map(([k]) => k), ...[...cur.keys()].filter((k) => !cand.some(([c]) => c === k))];
  const candMap = new Map(cand);
  return keys.map((key) => {
    const c = cur.get(key) ?? 0;
    const n = candMap.get(key) ?? 0;
    return { key, current: c, candidate: n, delta: n - c };
  });
}

// A stat magnitude the way the item tooltip prints it: "+12", "+3.5". Rounded to one decimal FIRST, so a
// tiny value never prints a signed zero ("-0.0"): anything that rounds to 0 reads "+0". Pure.
export function fmtGearStat(v: number): string {
  const r = Math.round(v * 10) / 10;
  if (r === 0) return "+0";
  const body = Number.isInteger(r) ? r.toString() : r.toFixed(1);
  return r < 0 ? body : `+${body}`;
}

// A piece's grade line: "Standard-Issue" for a Quartermaster baseline, else "Radiant · Q4"; with
// `withILevel`, " · iL 40" appended. The ONE grade text the Away-Team Gear rows, the member install flow
// and the Salvage Bay's member tiles share. Pure.
export function memberGradeText(
  piece: Pick<EquipmentInstance, "blueprintKey" | "rarity" | "quality" | "iLevel">,
  withILevel = false
): string {
  const grade =
    piece.blueprintKey === null
      ? "Standard-Issue"
      : `${piece.rarity.charAt(0).toUpperCase()}${piece.rarity.slice(1)} · Q${piece.quality}`;
  return withILevel ? `${grade} · iL ${piece.iLevel}` : grade;
}

// ============================================================================
// Unique-equipped pieces (E-CREW Task 11, D11 Neural Backup)
// ============================================================================
// A unique-equipped variety may be WORN by only one member in the whole fleet (spare copies may sit in
// storage). The install gate refuses a second with uniqueEquippedElsewhere; these helpers let every surface
// say WHO wears it instead of the generic line, and mark such a piece with a "Unique" tag.

// Is this a member piece of a unique-equipped variety? A ship piece or an unresolved variety reads false. Pure.
export function isUniqueEquippedPiece(piece: Pick<EquipmentInstance, "slotType" | "moduleVariant">): boolean {
  return memberVariety(piece.slotType, piece.moduleVariant ?? "")?.member.uniqueEquipped === true;
}

// For a unique piece, who wears ANOTHER copy right now: the wearer's id and their label, "Kira Vale (Aurora)"
// (the ship's display label, the same "#2" disambiguation the roster uses) or "Kira Vale (Security,
// unassigned)" for a benched member. null when the piece is not unique, nobody wears a copy, the worn copy IS
// this piece, or the wearer is no longer on the roster (callers then fall back to the generic text). Pure.
function otherCopyWearer(
  state: GameState,
  piece: Pick<EquipmentInstance, "id" | "slotType" | "moduleVariant">
): { memberId: string; label: string } | null {
  if (!isUniqueEquippedPiece(piece) || !isMemberSlotType(piece.slotType)) return null;
  const worn = uniqueWearer(state, piece.moduleVariant ?? "", piece.slotType);
  if (worn === null || worn.pieceId === piece.id) return null;
  const member = state.awayMembers.find((m) => m.id === worn.memberId);
  if (!member) return null;
  const ship = member.assignedShipId !== null ? state.ships.find((x) => x.id === member.assignedShipId) : undefined;
  const where = ship ? shipDisplayLabel(state, ship) : `${SQUAD_META[member.teamType].short}, unassigned`;
  return { memberId: member.id, label: `${member.name} (${where})` };
}

// The label half of otherCopyWearer: "Kira Vale (Aurora)", or null (see above). Pure.
export function uniqueWearerLabel(
  state: GameState,
  piece: Pick<EquipmentInstance, "id" | "slotType" | "moduleVariant">
): string | null {
  return otherCopyWearer(state, piece)?.label ?? null;
}

// What a unique refusal reads on the WEARER's own row, so a member is never named to themselves. One per
// surface, because each points at a different control: the picker lists the swap under the row, the gear
// modal swaps from the worn implant's own chip.
export const UNIQUE_SELF_TEXT_PICKER = "Already wears one (swap it below)";
export const UNIQUE_SELF_TEXT_GEAR_MODAL = "Already wears one (use Swap on the installed implant)";

// The player-facing reason a member install of `pieceId` is refused. For a unique refusal whose wearer
// resolves: `selfText` when the wearer IS `forMemberId` (the member being installed on), else "Installed on
// Kira Vale (Aurora)". A crew lock on `forMemberId`'s ship reads the accurate lock words (CP-6). Every other
// case, including a unique refusal whose wearer cannot be named, reads memberFitBlockText (the fallback). Pure.
export function memberFitReasonText(
  state: GameState,
  pieceId: string,
  reason: MemberFitBlockReason,
  forMemberId?: string,
  selfText: string = UNIQUE_SELF_TEXT_PICKER
): string {
  if (reason === "uniqueEquippedElsewhere") {
    const piece = state.equipment.find((e) => e.id === pieceId);
    const who = piece ? otherCopyWearer(state, piece) : null;
    if (who !== null) return forMemberId !== undefined && who.memberId === forMemberId ? selfText : `Installed on ${who.label}`;
  }
  if (reason === "onMission" && forMemberId !== undefined) {
    // CP-6: a crew lock names its real cause (mission vs expedition) for the member's own ship.
    const shipId = state.awayMembers.find((m) => m.id === forMemberId)?.assignedShipId ?? null;
    const lock = shipId === null ? null : crewLockText(state, shipId);
    if (lock !== null) return lock;
  }
  return memberFitBlockText(reason);
}
