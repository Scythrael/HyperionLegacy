// Which currencies show in the header currencies band, and in what order, a DISPLAY
// preference, deliberately separate from src/lib/game/save.ts's save-file contract so it
// survives a "delete save" (the same rationale as src/lib/theme.ts and the other
// *Preference.ts stores, whose shape this mirrors).
//
// STORED SHAPE: a JSON array of currency KEYS (CURRENCY_META keys, e.g. "credits"), in the
// order the player wants them shown, capped to MAX_HEADER_CURRENCIES. The value is:
//   - null  -> NEVER SET. The caller treats this as "default": show all available currencies
//              (up to the cap). This keeps a fresh player's header exactly as it was before this
//              preference existed (both currencies shown).
//   - []    -> an EXPLICIT empty choice: the player deselected everything, so the band shows its
//              "pick currencies in Options" placeholder. Distinct from null on purpose.
//   - [...] -> the explicit ordered selection.
//
// localStorage is reached through safeStorage (guarded get/set) so a blocked or full store
// degrades to "no persistence" (the null default) instead of throwing.
import { safeGetItem, safeSetItem } from "./safeStorage";

const CURRENCY_DISPLAY_KEY = "fleet_admiral_header_currencies";

// The header band splits its width evenly between the shown currencies. Four is the agreed
// ceiling (user, 2026-09-16): past four the values go tight and the band stops reading cleanly.
export const MAX_HEADER_CURRENCIES = 4;

// Returns the stored selection, or null when the player has never set one (-> caller shows all).
// A malformed / non-array stored value is treated as "never set" rather than throwing, and each
// entry is coerced to a string; the caller still filters to keys that actually exist and applies
// the cap, so a stale key (a currency that was later removed) can never crash the header.
export function loadCurrencyDisplay(): string[] | null {
  const raw = safeGetItem(CURRENCY_DISPLAY_KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((k) => String(k)).slice(0, MAX_HEADER_CURRENCIES);
  } catch {
    return null;
  }
}

export function saveCurrencyDisplay(keys: string[]): void {
  safeSetItem(CURRENCY_DISPLAY_KEY, JSON.stringify(keys.slice(0, MAX_HEADER_CURRENCIES)));
}
