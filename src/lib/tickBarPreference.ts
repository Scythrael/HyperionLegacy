// Tick-bar visibility persistence, a display preference, deliberately
// separate from src/lib/game/save.ts's save-file contract so it survives a
// "delete save" (same rationale as src/lib/theme.ts).
//
// localStorage is reached through safeStorage (guarded get/set) so a blocked or
// full store degrades to "no persistence" (the ON default) instead of throwing.
import { safeGetItem, safeSetItem } from "./safeStorage";

const TICK_BAR_ENABLED_KEY = "fleet_admiral_tick_bar_enabled";

export function loadTickBarEnabled(): boolean {
  const raw = safeGetItem(TICK_BAR_ENABLED_KEY);
  return raw === null ? true : raw === "true";
}

export function saveTickBarEnabled(enabled: boolean): void {
  safeSetItem(TICK_BAR_ENABLED_KEY, String(enabled));
}
