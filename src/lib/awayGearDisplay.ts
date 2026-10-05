// awayGearDisplay.ts: player-facing labels + tiny pure helpers for away-team MEMBER gear (E-CREW "Crew Made
// Real", Task 10). Shared by the member cards (AwayTeamPanel.svelte), the Logistics "Away-Team Gear" tab, the
// Salvage Bay, the Archive, the Fabricator / Research / Crafted Blanks groupings and the item tooltip, so every
// surface names a member piece and groups member blueprints ONE way.
//
// Same posture as awayTeamDisplay.ts: pure presentation data kept out of the components so it is node-testable
// (this repo has no Svelte component test harness). No game rules live here; the install gates are
// game/memberEquipment.ts and the catalog is game/model.ts.

import type { AwayTeamType, BlueprintDef, EquipmentInstance, EquipmentSlotType, MemberSlotType } from "./game/model";
import { EQUIPMENT_SLOTS, MEMBER_SLOT_TYPES, isMemberSlotType, memberVariety } from "./game/model";
import { SQUAD_META } from "./awayTeamDisplay";
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

// A stat magnitude the way the item tooltip prints it: "+12", "+3.5". Pure.
export function fmtGearStat(v: number): string {
  const body = Number.isInteger(v) ? v.toString() : v.toFixed(1);
  return v < 0 ? body : `+${body}`;
}
