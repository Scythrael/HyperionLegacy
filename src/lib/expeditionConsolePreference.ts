// Expedition Tiers G2-6: the dispatch console's per-viewer conveniences (a display preference, deliberately separate
// from the save file, like theme.ts and tickBarPreference.ts):
//   - the region last launched to (the signed-off mockup's zero-click path: "the console opens on the region you last
//     launched to"; expeditionConsoleDisplay.ts consoleDefaultTier falls back when this ship cannot attempt it), and
//   - whether the small region map (the alternative picker) is open.
// localStorage is reached through safeStorage, so a blocked or full store degrades to the defaults (Tier I, map shut).

import { safeGetItem, safeSetItem } from "./safeStorage";
import type { RegionTier } from "./game/model";

const LAST_TIER_KEY = "fleet_admiral_expedition_last_tier";
const MAP_OPEN_KEY = "fleet_admiral_expedition_region_map_open";

// The stored tier when it is a whole tier I to VII, else null. Pure over the stored string.
export function parseStoredTier(raw: string | null): RegionTier | null {
  if (raw === null || !/^[1-7]$/.test(raw)) return null;
  return Number(raw) as RegionTier;
}

export function loadLastExpeditionTier(): RegionTier | null {
  return parseStoredTier(safeGetItem(LAST_TIER_KEY));
}

export function saveLastExpeditionTier(tier: RegionTier): void {
  safeSetItem(LAST_TIER_KEY, String(tier));
}

export function loadRegionMapOpen(): boolean {
  return safeGetItem(MAP_OPEN_KEY) === "true";
}

export function saveRegionMapOpen(open: boolean): void {
  safeSetItem(MAP_OPEN_KEY, String(open));
}
