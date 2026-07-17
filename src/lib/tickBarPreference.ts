// Tick-bar visibility persistence, a display preference, deliberately
// separate from src/lib/game/save.ts's save-file contract so it survives a
// "delete save" (same rationale as src/lib/theme.ts).

const TICK_BAR_ENABLED_KEY = "fleet_admiral_tick_bar_enabled";

export function loadTickBarEnabled(): boolean {
  const raw = localStorage.getItem(TICK_BAR_ENABLED_KEY);
  return raw === null ? true : raw === "true";
}

export function saveTickBarEnabled(enabled: boolean): void {
  localStorage.setItem(TICK_BAR_ENABLED_KEY, String(enabled));
}
