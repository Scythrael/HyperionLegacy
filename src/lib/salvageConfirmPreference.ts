// Per-quality salvage-confirm preference (0.11.2). localStorage only, same shape
// and rationale as src/lib/refineConfirmPreference.ts (NOT on GameState). The
// player selects which quality tiers (0 to 5) require a confirm before salvaging;
// the default is ALL tiers (safe: confirm everything until the player opts out of
// the low tiers). salvageNeedsConfirm(quality) answers "does salvaging an item of
// this quality need a confirm?" for the Salvage Bay UI.
const KEY = "fleet_admiral_salvage_confirm_qualities";
const ALL_QUALITIES = [0, 1, 2, 3, 4, 5];

export function loadSalvageConfirmQualities(): number[] {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return [...ALL_QUALITIES];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((n) => typeof n === "number")) return parsed;
  } catch {
    // fall through to the safe default on any parse problem
  }
  return [...ALL_QUALITIES];
}

export function saveSalvageConfirmQualities(qualities: number[]): void {
  localStorage.setItem(KEY, JSON.stringify(qualities));
}

export function salvageNeedsConfirm(quality: number): boolean {
  return loadSalvageConfirmQualities().includes(quality);
}
