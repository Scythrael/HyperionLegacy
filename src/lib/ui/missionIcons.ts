// missionIcons.ts: the ONE UI-side place a gathering mission meets its own glyph (0.14.0, reactor fuel ladder).
//
// EVERY GRAPHIC IS SVG (user hard requirement): the values are IconName keys into the shared registry (icons.ts, drawn
// by <Icon>, classified in iconPacks.ts ICON_SEMANTICS), never emoji. A mission listed here draws its glyph on the
// mission row; the older missions still wear the shared row emoji until their surface is redrawn (icons.ts migration
// policy: existing emoji migrate only on a surface a later unit rewrites).

import type { IconName } from "./icons";
import type { MissionKey } from "../game/model";

export const MISSION_ICON: Readonly<Partial<Record<MissionKey, IconName>>> = {
  cometIceHarvest: "comet",
};

// The glyph of a mission, or null for one that has none yet.
export function missionIcon(key: MissionKey): IconName | null {
  return MISSION_ICON[key] ?? null;
}
