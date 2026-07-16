// Tick-count readout visibility persistence -- a display preference, deliberately
// separate from src/lib/game/save.ts's save-file contract so it survives a
// "delete save" (same rationale as src/lib/theme.ts and
// src/lib/tickBarPreference.ts, whose shape this file mirrors exactly).
//
// Controls whether the raw tick numbers are shown next to the human-readable
// clock timers on every "N remaining" / "Duration" readout. DEFAULT FALSE:
// most players want just the clock ("01:39 remaining"); the tick counts are an
// opt-in power-user detail.

const TICK_COUNTS_SHOWN_KEY = "fleet_admiral_show_tick_counts";

export function loadShowTickCounts(): boolean {
  const raw = localStorage.getItem(TICK_COUNTS_SHOWN_KEY);
  return raw === null ? false : raw === "true";
}

export function saveShowTickCounts(enabled: boolean): void {
  localStorage.setItem(TICK_COUNTS_SHOWN_KEY, String(enabled));
}
