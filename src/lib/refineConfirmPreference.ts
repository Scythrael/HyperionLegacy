// Refine-order confirmation-popup persistence, a display/UX preference,
// deliberately separate from src/lib/game/save.ts's save-file contract so it
// survives a "delete save" and needs no save-schema migration (the SAME
// rationale, and the SAME localStorage-only shape, as src/lib/tickBarPreference.ts
// and src/lib/theme.ts).
//
// Semantics: TRUE (the default) means "show the 'are you sure you wish to refine
// this item?' confirmation modal before starting any refine order." The player
// turns it off either via the modal's own "Don't show this again" checkbox or the
// System -> Options toggle, and can re-enable it from that same toggle. Default
// TRUE mirrors loadTickBarEnabled's "absent key reads as the ON default".
//
// localStorage is reached through safeStorage (guarded get/set) so a blocked or
// full store degrades to "no persistence" (the ON default) instead of throwing.
import { safeGetItem, safeSetItem } from "./safeStorage";

const REFINE_CONFIRM_ENABLED_KEY = "fleet_admiral_refine_confirm_enabled";

export function loadRefineConfirmEnabled(): boolean {
  const raw = safeGetItem(REFINE_CONFIRM_ENABLED_KEY);
  return raw === null ? true : raw === "true";
}

export function saveRefineConfirmEnabled(enabled: boolean): void {
  safeSetItem(REFINE_CONFIRM_ENABLED_KEY, String(enabled));
}
