// themeStyle.ts: theme STYLES and their presets (0.13.11.1, design section 7).
//
// A style is HOW the surfaces are drawn (where a wash, a shine, a gradient heading or bar goes);
// the two gradient STOPS are the colors it draws with. They are kept apart on purpose (coordinator
// note for the 0.14.2 theme builder): app.css holds the stop tokens (--grad-start-rgb,
// --grad-end-rgb) and, separately, one rule block per style keyed on :root[data-style]. A PRESET is
// just data: a style plus two stops. Starfall, the e10,000,000 prize, is the washShine style with
// the player's accent into purple. The UNLOCK is recorded as the style id ("washShine" in the main
// save's unlockedThemeStyles), not as Starfall, so a later builder that lets players pick their own
// stops for an unlocked style needs no migration.
//
// The chosen preset is a device-side preference (like the color theme): localStorage through
// safeStorage, outside the save. It only APPLIES while its style is unlocked on this account, so a
// Delete Save (which clears the unlock) quietly returns the game to the default look.

import { safeGetItem, safeSetItem } from "./safeStorage";

export const THEME_STYLES = ["washShine"] as const;
export type ThemeStyleId = (typeof THEME_STYLES)[number];

// "accent" follows whichever color theme the player picked; otherwise an R, G, B triplet.
export type GradientStop = "accent" | { rgb: string };

export interface ThemePreset {
  id: string;
  label: string;
  style: ThemeStyleId;
  stops: readonly [GradientStop, GradientStop];
}

export const STARFALL: ThemePreset = { id: "starfall", label: "Starfall", style: "washShine", stops: ["accent", { rgb: "160, 32, 240" }] };

export const THEME_PRESETS: readonly ThemePreset[] = [STARFALL];

// The shipped look, implicit: no style attribute, no stop overrides.
export const DEFAULT_PRESET_ID = "default";

const PRESET_KEY = "fleet_admiral_theme_preset";

export function isKnownPreset(id: string | null): boolean {
  return id === DEFAULT_PRESET_ID || THEME_PRESETS.some((p) => p.id === id);
}

export function loadThemePreset(): string {
  const raw = safeGetItem(PRESET_KEY);
  return isKnownPreset(raw) ? (raw as string) : DEFAULT_PRESET_ID;
}

export function saveThemePreset(id: string): void {
  if (isKnownPreset(id)) safeSetItem(PRESET_KEY, id);
}

// The presets this account may pick (their style is unlocked). Empty means the setting stays hidden.
export function availablePresets(unlockedStyles: readonly string[]): ThemePreset[] {
  return THEME_PRESETS.filter((p) => unlockedStyles.includes(p.style));
}

// What actually applies: the chosen preset when its style is unlocked, else the default (null).
export function effectivePreset(chosenId: string, unlockedStyles: readonly string[]): ThemePreset | null {
  return availablePresets(unlockedStyles).find((p) => p.id === chosenId) ?? null;
}

export function stopValue(stop: GradientStop): string {
  return stop === "accent" ? "var(--color-accent-rgb)" : stop.rgb;
}

// ONE writer to the root, for the same reason applyAccessibility is one: on load and on every change
// through the same path. null restores the default look exactly (attribute and tokens removed).
export function applyThemePreset(preset: ThemePreset | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (preset === null) {
    delete root.dataset.style;
    root.style.removeProperty("--grad-start-rgb");
    root.style.removeProperty("--grad-end-rgb");
    return;
  }
  root.dataset.style = preset.style;
  root.style.setProperty("--grad-start-rgb", stopValue(preset.stops[0]));
  root.style.setProperty("--grad-end-rgb", stopValue(preset.stops[1]));
}
