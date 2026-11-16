// Ships roster view preference (FR-C R6-3, user 2026-11-13/14 "Remember them (Recommended)": the Ships roster's sort,
// view and search persist across reloads, the same way favorites persist). localStorage only, the
// shipFavoritesPreference.ts shape and rationale: a per-device DISPLAY preference, NOT on GameState, so no save-schema
// change and no SAVE_VERSION bump. Nothing in the tick reads it.
//
// A stored value this build does not know (an older or newer sort or view key, a non-string search, malformed JSON, a
// blocked store) falls back to that field's default on its own, so one bad field never discards the others.
//
// localStorage is reached through safeStorage (guarded get/set), so a blocked or full store degrades to the defaults
// instead of throwing, exactly like the sibling preference modules.
import { safeGetItem, safeSetItem } from "./safeStorage";
import type { ShipFilterKey, ShipSortKey } from "./game/shipRoster";

const SHIP_ROSTER_VIEW_KEY = "fleet_admiral_ship_roster_view";

const SORT_KEYS: readonly ShipSortKey[] = ["attention", "name", "class", "rating", "status"];
const FILTER_KEYS: readonly ShipFilterKey[] = ["all", "needsOrders", "byClass"];

export interface ShipRosterView {
  sortKey: ShipSortKey;
  filterKey: ShipFilterKey;
  search: string;
}

// The roster's defaults: Attention first (the hulls that need the player lead), every ship, no search.
export const DEFAULT_SHIP_ROSTER_VIEW: Readonly<ShipRosterView> = { sortKey: "attention", filterKey: "all", search: "" };

export function loadShipRosterView(): ShipRosterView {
  const raw = safeGetItem(SHIP_ROSTER_VIEW_KEY);
  if (raw === null) return { ...DEFAULT_SHIP_ROSTER_VIEW };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SHIP_ROSTER_VIEW };
  }
  const o = (parsed !== null && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  return {
    sortKey: SORT_KEYS.includes(o.sortKey as ShipSortKey) ? (o.sortKey as ShipSortKey) : DEFAULT_SHIP_ROSTER_VIEW.sortKey,
    filterKey: FILTER_KEYS.includes(o.filterKey as ShipFilterKey) ? (o.filterKey as ShipFilterKey) : DEFAULT_SHIP_ROSTER_VIEW.filterKey,
    search: typeof o.search === "string" ? o.search : DEFAULT_SHIP_ROSTER_VIEW.search,
  };
}

// Best-effort: a rejected write is a silent no-op (the safeStorage posture), so the view simply does not persist.
export function saveShipRosterView(view: ShipRosterView): void {
  safeSetItem(SHIP_ROSTER_VIEW_KEY, JSON.stringify({ sortKey: view.sortKey, filterKey: view.filterKey, search: view.search }));
}
