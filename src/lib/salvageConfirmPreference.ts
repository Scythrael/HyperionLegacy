// Per-quality salvage-confirm preference (0.11.2). localStorage only, same shape
// and rationale as src/lib/refineConfirmPreference.ts (NOT on GameState). The
// player selects which quality tiers require a confirm before salvaging; the
// default is ALL tiers (safe: confirm everything until the player opts out of the
// low tiers). salvageNeedsConfirm(quality) answers "does salvaging an item of this
// quality need a confirm?" for the Salvage Bay UI.
import { QUALITY_TIERS } from "./game/inventory";

const SALVAGE_CONFIRM_QUALITIES_KEY = "fleet_admiral_salvage_confirm_qualities";

// The full set of quality tiers, DERIVED from the canonical QUALITY_TIERS ceiling
// (inventory.ts) rather than a hardcoded [0..5], so the "confirm everything" safe
// default automatically covers a new top tier if QUALITY_TIERS ever grows. A
// hardcoded literal would silently leave a newly added top tier UNguarded (no
// confirm), contradicting this module's own safe-default promise, and the engine
// already throws on quality-tier drift, so this stays consistent with that.
const ALL_QUALITIES: number[] = Array.from({ length: QUALITY_TIERS }, (_, i) => i);

export function loadSalvageConfirmQualities(): number[] {
  const raw = localStorage.getItem(SALVAGE_CONFIRM_QUALITIES_KEY);
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
  localStorage.setItem(SALVAGE_CONFIRM_QUALITIES_KEY, JSON.stringify(qualities));
}

export function salvageNeedsConfirm(quality: number): boolean {
  return loadSalvageConfirmQualities().includes(quality);
}
