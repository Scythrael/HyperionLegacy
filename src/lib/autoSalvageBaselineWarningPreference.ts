// Standard-Issue auto-salvage warning: the per-device "show me this dialog" preference
// (0.13.3.1 follow-up).
//
// WHAT IT GUARDS. Switching the auto-salvage DUPLICATES rule off while the remaining rules
// still reach standard-rarity / quality-0 spares puts the player in a configuration that can
// destroy every Standard-Issue baseline they hold, including the last one of a kind. The
// console raises a confirmation before making that change (see
// autoSalvageDuplicatesOffWarnsAboutBaselines in src/lib/game/salvage.ts, which owns the
// trigger condition itself). This module owns only the "don't show this again" half.
//
// ⚠️ localStorage, NEVER THE SAVE, and the line is the same one every auto-salvage field was
// argued against: a value belongs in GameState when the TICK reads it. This one does not change
// what the tick does by one item. It changes whether a dialog appears on THIS device before a
// rule is written, so it is a view preference, exactly like refineConfirmPreference.ts (the
// dialog this one is modeled on) and shipFavoritesPreference.ts. Every value the rules actually
// honor stays in the save.
//
// Semantics: TRUE (the default) means "show the warning". The player turns it off through the
// dialog's own "Don't show this again" checkbox. Default TRUE mirrors
// loadRefineConfirmEnabled's "absent key reads as the ON default", and it is the safe direction:
// an unreadable preference shows a warning that was not wanted rather than silently skipping one
// about an irreversible destruction.
//
// ⚠️ THE OPTIONS TOGGLE LANDS IN 0.13.5, and it must read THIS KEY. Options has no Gameplay tab
// yet (SUGGESTIONS.md, "AUTOMATION RULES ALSO BELONG UNDER OPTIONS"), which is the only reason
// the dialog's own checkbox is the sole way to switch this off today. When that tab arrives, its
// re-enable toggle must be a SECOND VIEW of this same stored value, calling these same two
// functions, and never a copy of the setting: two stores for one preference is precisely the
// drift the confirm-by-quality preference had to be migrated out of localStorage to escape.
//
// localStorage is reached through safeStorage (guarded get/set) so a blocked or full store
// degrades to "no persistence" (the ON default) instead of throwing.
import { safeGetItem, safeSetItem } from "./safeStorage";

const AUTO_SALVAGE_BASELINE_WARNING_KEY = "fleet_admiral_auto_salvage_baseline_warning_enabled";

export function loadAutoSalvageBaselineWarningEnabled(): boolean {
  const raw = safeGetItem(AUTO_SALVAGE_BASELINE_WARNING_KEY);
  // Only the exact string "false" switches the warning off. An absent key (a fresh device), a
  // blocked store, or any other value all read as ON, because the failure that costs a player
  // their gear is the one where a warning about an irreversible destruction goes missing.
  return raw === null ? true : raw !== "false";
}

export function saveAutoSalvageBaselineWarningEnabled(enabled: boolean): void {
  safeSetItem(AUTO_SALVAGE_BASELINE_WARNING_KEY, String(enabled));
}
