// Per-quality salvage-confirm preference (0.11.2).
//
// ⚠️ THIS MODULE IS A LEGACY MIGRATION SOURCE, NOT THE LIVE SETTING (corrected 0.13.5, the header
// had been false since 0.13.3). It used to say "localStorage only ... NOT on GameState". That
// stopped being true when 0.13.3 moved the setting INTO THE SAVE as
// GameState.salvageConfirmQualities, for the reason that governs every setting split in this
// project: the SIMULATION reads it, so it has to be in the save or the tick cannot see it offline
// and offline stops matching live.
//
// What remains here is READ ONCE: save.ts imports loadSalvageConfirmQualities to seed the save
// field in the v39 to v40 migration. Nothing writes the key any more (verified 0.13.5: no caller
// of the setter or of salvageNeedsConfirm outside this file).
//
// ⚠️ DO NOT RESURRECT THE localStorage PATH. A second writer would give one setting two homes that
// disagree depending on which screen was opened last, and the device-side copy would be invisible
// to the tick. If a UI needs this setting, it reads and writes GameState.
//
// Same shape as src/lib/refineConfirmPreference.ts, which IS still device-side and correctly so
// (it gates a DIALOG, which the simulation never reads). The
// player selects which quality tiers require a confirm before salvaging; the
// default is ALL tiers (safe: confirm everything until the player opts out of the
// low tiers). salvageNeedsConfirm(quality) answers "does salvaging an item of this
// quality need a confirm?" for the Salvage Bay UI.
//
// localStorage is reached through safeStorage (guarded get/set) so a blocked or
// full store degrades to "no persistence" (the confirm-everything default) instead
// of throwing. The JSON.parse below was already guarded; the accessor now is too.
import { QUALITY_TIERS } from "./game/inventory";
import { safeGetItem, safeSetItem } from "./safeStorage";

const SALVAGE_CONFIRM_QUALITIES_KEY = "fleet_admiral_salvage_confirm_qualities";

// The full set of quality tiers, DERIVED from the canonical QUALITY_TIERS ceiling
// (inventory.ts) rather than a hardcoded [0..5], so the "confirm everything" safe
// default automatically covers a new top tier if QUALITY_TIERS ever grows. A
// hardcoded literal would silently leave a newly added top tier UNguarded (no
// confirm), contradicting this module's own safe-default promise, and the engine
// already throws on quality-tier drift, so this stays consistent with that.
const ALL_QUALITIES: number[] = Array.from({ length: QUALITY_TIERS }, (_, i) => i);

export function loadSalvageConfirmQualities(): number[] {
  const raw = safeGetItem(SALVAGE_CONFIRM_QUALITIES_KEY);
  if (raw === null) return [...ALL_QUALITIES];
  try {
    const parsed = JSON.parse(raw);
    // Accept only a real array of numbers. A valid-JSON-but-wrong-shape value
    // (an object, a string, an array with a non-number) falls through to the
    // safe default rather than being trusted.
    if (Array.isArray(parsed) && parsed.every((n) => typeof n === "number")) return parsed;
  } catch {
    // fall through to the safe default on any parse problem
  }
  return [...ALL_QUALITIES];
}

export function saveSalvageConfirmQualities(qualities: number[]): void {
  safeSetItem(SALVAGE_CONFIRM_QUALITIES_KEY, JSON.stringify(qualities));
}

export function salvageNeedsConfirm(quality: number): boolean {
  return loadSalvageConfirmQualities().includes(quality);
}
