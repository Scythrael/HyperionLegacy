// refinedIcons.ts: the ONE UI-side place a refined good with its own glyph meets it (0.14.0 ML-2, the recipe realism
// audit's two new refined goods; docs/plans/2026-10-21-recipe-realism-audit.md USER ANSWERS Group B call 6).
//
// EVERY GRAPHIC IS SVG (user hard requirement): the values are IconName keys into the shared registry (icons.ts,
// drawn by <Icon>, classified in iconPacks.ts ICON_SEMANTICS), never emoji. Any other refined good keeps the
// Warehouse's category glyph until its surface is redrawn (icons.ts migration policy).

import type { IconName } from "./icons";

// Item id -> its glyph. The keys are ITEMS ids (refinedIcons.test.ts holds each to a real refined item).
export const REFINED_ITEM_ICON: Readonly<Record<string, IconName>> = {
  biofiber: "biofiber",
  resinDistillate: "resinDistillate",
};

// The glyph of an ITEMS key that has its own refined-good glyph, or null for any other item.
export function refinedItemIcon(itemId: string): IconName | null {
  return Object.prototype.hasOwnProperty.call(REFINED_ITEM_ICON, itemId) ? REFINED_ITEM_ICON[itemId] : null;
}
