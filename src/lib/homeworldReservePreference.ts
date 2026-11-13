// Homeworld reserve controls (user 2026-11-12 evening, "A: section under the pool (Recommended)"): whether the reserve's
// section on the Crew Pool tab is open. A per-viewer display preference, deliberately separate from the save file (the
// other *Preference.ts stores). DEFAULT CLOSED: the section "starts closed" and remembers open or closed (the signed
// mockup's note). localStorage via safeStorage, so a blocked or full store degrades to closed instead of throwing.
import { safeGetItem, safeSetItem } from "./safeStorage";

const RESERVE_OPEN_KEY = "fleet_admiral_homeworld_reserve_open";

export function loadHomeworldReserveOpen(): boolean {
  return safeGetItem(RESERVE_OPEN_KEY) === "true";
}

export function saveHomeworldReserveOpen(open: boolean): void {
  safeSetItem(RESERVE_OPEN_KEY, String(open));
}
