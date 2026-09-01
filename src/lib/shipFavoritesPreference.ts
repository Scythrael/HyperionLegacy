// Ship-favorites preference (0.13.2 Ships tab, Unit 3). localStorage only, same shape
// and rationale as src/lib/salvageConfirmPreference.ts (NOT on GameState, so it adds NO
// save-schema change and no SAVE_VERSION bump). The player stars hulls in the Ships-tab
// roster to pin them to a Favorites group; this module persists that set of ship ids
// per device.
//
// WHY NOT ON THE SAVE. A favorite is a personal, per-device view preference (like the
// salvage-confirm and tick-bar prefs), not game state: it must survive a reload but does
// not belong in the shared, migratable save. Keyed by ShipInstance.id, which is stable
// within a save; ids from a different save (or a salvaged hull) simply never match a live
// ship, so a stale entry is inert (buildShipRoster only ever asks "is THIS live id in the
// set"). We keep those stale ids rather than prune them here, because pruning would need
// the live ship list and this module is deliberately state-free; the set stays tiny.
//
// localStorage is reached through safeStorage (guarded get/set) so a blocked or full
// store degrades to "no favorites" (the empty-set default) instead of throwing, exactly
// like the sibling preference modules.
//
// No em dashes / no "--" as punctuation (project rule): commas, periods, parens only.
import { safeGetItem, safeSetItem } from "./safeStorage";

const SHIP_FAVORITES_KEY = "fleet_admiral_ship_favorites";

// Load the favorited ship ids as a Set. Returns an EMPTY set when the key is absent or
// the store is unreachable (the safe default: no ship is favorited). A valid-JSON but
// wrong-shape value (an object, a string, an array with a non-string) also falls through
// to the empty default rather than being trusted.
export function loadShipFavorites(): Set<string> {
  const raw = safeGetItem(SHIP_FAVORITES_KEY);
  if (raw === null) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return new Set(parsed);
    }
  } catch {
    // fall through to the empty default on any parse problem
  }
  return new Set();
}

// Persist the favorited ship ids. Serializes the Set as a plain string array (JSON has no
// Set type). Best-effort: a rejected write (blocked or full store) is a silent no-op, the
// documented safeStorage posture, so a favorite simply does not persist across reload.
export function saveShipFavorites(favorites: Set<string>): void {
  safeSetItem(SHIP_FAVORITES_KEY, JSON.stringify([...favorites]));
}
