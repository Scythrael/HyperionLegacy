// fieldKitIcons.ts: the ONE UI-side place field kits, the bone severity line and the enemy ranks meet their glyphs
// (Field Kits FKR-3, 0.14.0; docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R3 FKR-3).
//
// EVERY GRAPHIC IS SVG (user hard requirement): the values are IconName keys into the shared registry (icons.ts,
// drawn by <Icon>, classified in iconPacks.ts ICON_SEMANTICS), never emoji, so a kit or a rank can never wear two
// different glyphs on two screens. The engine modules (game/fieldKits.ts, game/enemyRanks.ts) stay glyph-free.

import type { IconName } from "./icons";
import { ITEMS, BLUEPRINTS, type EnemyRank } from "../game/model";
import type { FieldKitId, FieldKitStatusId } from "../game/fieldKits";

// Kit id -> its glyph. Exhaustive over FieldKitId (a new kit without a glyph is a compile error).
export const FIELD_KIT_ICON: Readonly<Record<FieldKitId, IconName>> = {
  firstAidKit: "kitFirstAid",
  antitoxin: "kitAntitoxin",
  combatStim: "kitCombatStim",
  splint: "kitSplint",
  traumaKit: "kitTrauma",
  injuryKit: "kitInjury",
};

// The glyph of an ITEMS key that is a field kit, or null for any other item (a kit's item key IS its kit id).
export function fieldKitIcon(itemId: string): IconName | null {
  return ITEMS[itemId]?.category === "fieldKit" ? FIELD_KIT_ICON[itemId as FieldKitId] ?? null : null;
}

// The glyph of a blueprint whose craft is a field kit, or null for any other blueprint.
export function fieldKitBlueprintIcon(blueprintKey: string): IconName | null {
  const out = BLUEPRINTS[blueprintKey]?.recipe.outputItem;
  return out === undefined ? null : fieldKitIcon(out);
}

// The bone line, lightest first (fieldKits.ts CONDITION_LINES.bone): Fracture, Broken Bone, Shattered Bone.
export type BoneConditionId = Extract<FieldKitStatusId, "fracture" | "brokenBone" | "shatteredBone">;
export const BONE_CONDITION_ICON: Readonly<Record<BoneConditionId, IconName>> = {
  fracture: "boneFracture",
  brokenBone: "boneBroken",
  shatteredBone: "boneShattered",
};

// The enemy rank chips, Weak to Boss (enemyRanks.ts). Exhaustive over EnemyRank.
export const ENEMY_RANK_ICON: Readonly<Record<EnemyRank, IconName>> = {
  weak: "rankWeak",
  normal: "rankNormal",
  strong: "rankStrong",
  elite: "rankElite",
  boss: "rankBoss",
};
