// Whether inspecting a blank REVEALS the rolled system in a popup before it lands in the spare
// bay, a display preference, deliberately separate from src/lib/game/save.ts's save contract so it
// survives a "delete save" (the same rationale as the other *Preference.ts stores it mirrors).
//
// DEFAULT TRUE: the reward of a roll is seeing what you got, so a fresh player gets the reveal.
// Turning it OFF (from the reveal popup's own opt-out, or Settings) restores the silent behaviour,
// which is what you want when mass-rolling a stack of blanks.
//
// localStorage via safeStorage (guarded) so a blocked/full store degrades to the ON default
// instead of throwing.
import { safeGetItem, safeSetItem } from "./safeStorage";

const INSPECT_REVEAL_KEY = "fleet_admiral_inspect_reveal";

export function loadInspectReveal(): boolean {
  const raw = safeGetItem(INSPECT_REVEAL_KEY);
  return raw === null ? true : raw === "true"; // default ON
}

export function saveInspectReveal(enabled: boolean): void {
  safeSetItem(INSPECT_REVEAL_KEY, String(enabled));
}
