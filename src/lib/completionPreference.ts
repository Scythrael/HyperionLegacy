// Completion tracking (0.14.0, the approved 2026-11-13 mockup): the Survey Log's Systems section, per viewer: its sort
// chip ("the choice is remembered per viewer, like the other sort chips") and whether it is open (it "starts open" and
// has a Hide). A display preference, deliberately separate from the save file (the other *Preference.ts stores).
// localStorage via safeStorage, so a blocked or full store degrades to the defaults instead of throwing.
import { safeGetItem, safeSetItem } from "./safeStorage";
import { isSystemsSort, type SystemsSort } from "./completionDisplay";

const SORT_KEY = "fleet_admiral_survey_systems_sort";
const OPEN_KEY = "fleet_admiral_survey_systems_open";

export function loadSystemsSort(): SystemsSort {
  const v = safeGetItem(SORT_KEY);
  return isSystemsSort(v) ? v : "tier";
}
export function saveSystemsSort(sort: SystemsSort): void {
  safeSetItem(SORT_KEY, sort);
}
export function loadSystemsOpen(): boolean {
  return safeGetItem(OPEN_KEY) !== "false";
}
export function saveSystemsOpen(open: boolean): void {
  safeSetItem(OPEN_KEY, String(open));
}
