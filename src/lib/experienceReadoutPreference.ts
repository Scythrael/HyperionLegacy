// Experience-values readout visibility persistence, a display preference, deliberately
// separate from src/lib/game/save.ts's save-file contract so it survives a "delete save"
// (same rationale as src/lib/tickReadoutPreference.ts, whose shape this file mirrors exactly).
//
// Controls whether the header's EXP and CRAFT readouts show the raw current/total XP (and a
// decimal percent) instead of just the whole-number percent. DEFAULT FALSE: the compact whole
// percent is enough for most players; the exact values are an opt-in for anyone who wants to SEE
// small per-job gains that a rounded percent hides (a level-7 crafting job is a fraction of a
// percent, so "99%" looks stuck even while it is climbing).
//
// localStorage is reached through safeStorage (guarded get/set) so a blocked or full store
// degrades to "no persistence" (the OFF default) instead of throwing.
import { safeGetItem, safeSetItem } from "./safeStorage";

const EXPERIENCE_VALUES_SHOWN_KEY = "fleet_admiral_show_experience_values";

export function loadShowExperienceValues(): boolean {
  const raw = safeGetItem(EXPERIENCE_VALUES_SHOWN_KEY);
  return raw === null ? false : raw === "true";
}

export function saveShowExperienceValues(enabled: boolean): void {
  safeSetItem(EXPERIENCE_VALUES_SHOWN_KEY, String(enabled));
}
