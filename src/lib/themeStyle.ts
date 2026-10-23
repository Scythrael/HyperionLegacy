// themeStyle.ts: theme PRESETS, STYLES and the two gradient stops (0.13.11.1, design section 7,
// then the user's "let's go all the way" round, 2026-10-23).
//
// A look is three things: the color THEME (data-theme, the accent everything reads), a STYLE (how
// surfaces are drawn: Flat is today's look, washShine is the e10,000,000 prize) and, for gradient
// styles, two STOPS (R, G, B triplets). They are kept apart (coordinator note for the theme
// builder): app.css holds the stop tokens and, separately, one rule block per style.
//
// Settings > UI offers PRESETS:
//   Default   today's shipped look: Flat, the player's own color theme (the existing setting).
//   Starfall  once unlocked: washShine with FIXED stops, cyan into purple, on the cyan theme, so it
//             is exactly the reference image whatever the color theme says.
//   Manual    the player's own: a style (Flat for everyone, Wash plus shine once unlocked), Color 1
//             (the accent, the same list as the color theme) and Color 2 (gradient styles only).
// The UNLOCK is the style id ("washShine" in the main save's unlockedThemeStyles), so later styles
// and colors slot in as their own unlocks. Choices are device-side (localStorage via safeStorage),
// and a missing unlock (Delete Save) falls back quietly: Starfall to Default, a locked style to Flat.
//
// Readability guards: a bright Color 2 is washed in more lightly (END_STOP_BUDGET, so no pair of
// colors can wash a surface paler than every text token tolerates), and a very dark color never
// colors text (headings switch to a light gray). themeStyleContrast.test.ts sweeps every pair.

import { safeGetItem, safeSetItem } from "./safeStorage";
import { THEME_NAMES, THEME_PREVIEW_COLORS, isValidTheme, type ThemeName } from "./theme";

export type ThemeStyleId = "flat" | "washShine";

export interface ThemeStyleDef {
  id: ThemeStyleId;
  label: string;
  gradient: boolean; // uses the two stops (Color 2 is offered)
  unlock: string | null; // the unlock id needed (null: everyone)
}

export const THEME_STYLES: readonly ThemeStyleDef[] = [
  { id: "flat", label: "Flat", gradient: false, unlock: null },
  { id: "washShine", label: "Wash plus shine", gradient: true, unlock: "washShine" },
];

export const VIOLET_RGB = "160, 32, 240";

export interface ThemePreset {
  id: "starfall";
  label: string;
  style: ThemeStyleId;
  theme: ThemeName;
  stops: readonly [string, string];
}

export const STARFALL: ThemePreset = { id: "starfall", label: "Starfall", style: "washShine", theme: "cyan", stops: ["103, 232, 249", VIOLET_RGB] };

export const THEME_PRESETS: readonly ThemePreset[] = [STARFALL];

export type PresetChoice = "default" | "starfall" | "manual";

export interface LookPrefs {
  preset: PresetChoice;
  manualStyle: ThemeStyleId;
  color1: ThemeName;
  color2: ThemeName;
}

export const DEFAULT_LOOK_PREFS: LookPrefs = { preset: "default", manualStyle: "flat", color1: "cyan", color2: "purple" };

export interface Look {
  theme: ThemeName;
  style: ThemeStyleId;
  stops: readonly [string, string] | null;
}

export function themeRgb(name: ThemeName): string {
  const h = THEME_PREVIEW_COLORS[name].replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ");
}

export function styleUnlocked(id: ThemeStyleId, unlocked: readonly string[]): boolean {
  const def = THEME_STYLES.find((s) => s.id === id);
  return def !== undefined && (def.unlock === null || unlocked.includes(def.unlock));
}

export function availableStyles(unlocked: readonly string[]): ThemeStyleDef[] {
  return THEME_STYLES.filter((s) => styleUnlocked(s.id, unlocked));
}

export function availablePresets(unlocked: readonly string[]): ThemePreset[] {
  return THEME_PRESETS.filter((p) => styleUnlocked(p.style, unlocked));
}

export function isGradient(id: ThemeStyleId): boolean {
  return THEME_STYLES.find((s) => s.id === id)?.gradient === true;
}

// What the screen shows, given the choices, the account's unlocks and the Default color theme.
export function resolveLook(prefs: LookPrefs, unlocked: readonly string[], colorTheme: ThemeName): Look {
  if (prefs.preset === "starfall") {
    const p = availablePresets(unlocked).find((x) => x.id === "starfall");
    if (p) return { theme: p.theme, style: p.style, stops: p.stops };
  }
  if (prefs.preset === "manual") {
    const style = styleUnlocked(prefs.manualStyle, unlocked) ? prefs.manualStyle : "flat";
    return { theme: prefs.color1, style, stops: isGradient(style) ? [themeRgb(prefs.color1), themeRgb(prefs.color2)] : null };
  }
  return { theme: colorTheme, style: "flat", stops: null };
}

// ---------------------------------------------------------------------------
// Readability guards
// ---------------------------------------------------------------------------

function parse(rgb: string): [number, number, number] {
  const [r, g, b] = rgb.split(",").map((x) => Number(x.trim()));
  return [r, g, b];
}

function luminance([r, g, b]: [number, number, number]): number {
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

// The end stop's wash may add at most this much luminance at full strength (Starfall's purple sits
// under it, so Starfall keeps its exact look; a bright Color 2 is scaled down to it). Set by the
// contrast sweep: every accent theme with every Color 2 keeps all text at AA.
export const END_STOP_BUDGET = 0.21;

export function stopStrength(rgb: string): number {
  const l = luminance(parse(rgb));
  return l <= END_STOP_BUDGET ? 1 : Math.round((END_STOP_BUDGET / l) * 1000) / 1000;
}

const PANEL_TEXT_BG: [number, number, number] = [10, 20, 30]; // today's panel over the deep background
export const TEXT_FALLBACK_RGB = "200, 204, 212";

// The stop a heading draws with: itself, or a light gray when the color (mixed toward white by
// `whiteMix` as the heading does) would read under AA on a panel.
export function textStop(rgb: string, colorShare = 1): string {
  const c = parse(rgb).map((v) => v * colorShare + 255 * (1 - colorShare)) as [number, number, number];
  const a = luminance(c);
  const b = luminance(PANEL_TEXT_BG);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return ratio >= 4.5 ? rgb : TEXT_FALLBACK_RGB;
}

// The heading end mixes 55% of the stop with white (app.css --style-heading).
export const HEADING_END_SHARE = 0.55;

// ---------------------------------------------------------------------------
// Device-side preferences
// ---------------------------------------------------------------------------

// The preset key is the one the first staging build used ("starfall" or "default"), so a tester's
// choice survives; the color theme stays in theme.ts's own key, so nobody's look changes on update.
const PRESET_KEY = "fleet_admiral_theme_preset";
const MANUAL_KEY = "fleet_admiral_theme_manual";

const PRESETS: readonly PresetChoice[] = ["default", "starfall", "manual"];

export function loadLookPrefs(colorTheme: ThemeName): LookPrefs {
  const raw = safeGetItem(PRESET_KEY);
  const preset = (PRESETS as readonly string[]).includes(raw ?? "") ? (raw as PresetChoice) : "default";
  let manual: Partial<LookPrefs> = {};
  try {
    const parsed: unknown = JSON.parse(safeGetItem(MANUAL_KEY) ?? "null");
    if (parsed && typeof parsed === "object") manual = parsed as Partial<LookPrefs>;
  } catch {
    manual = {};
  }
  return {
    preset,
    manualStyle: THEME_STYLES.some((s) => s.id === manual.manualStyle) ? (manual.manualStyle as ThemeStyleId) : "flat",
    color1: isValidTheme(manual.color1 ?? null) ? (manual.color1 as ThemeName) : colorTheme,
    color2: isValidTheme(manual.color2 ?? null) ? (manual.color2 as ThemeName) : DEFAULT_LOOK_PREFS.color2,
  };
}

// Has the player ever saved Manual picks? (The first switch to Manual starts from their color theme.)
export function hasManualPrefs(): boolean {
  return safeGetItem(MANUAL_KEY) !== null;
}

export function savePreset(preset: PresetChoice): void {
  if (PRESETS.includes(preset)) safeSetItem(PRESET_KEY, preset);
}

export function saveManual(m: Pick<LookPrefs, "manualStyle" | "color1" | "color2">): void {
  safeSetItem(MANUAL_KEY, JSON.stringify({ manualStyle: m.manualStyle, color1: m.color1, color2: m.color2 }));
}

export const COLOR_CHOICES: readonly ThemeName[] = THEME_NAMES;

// ---------------------------------------------------------------------------
// The one writer to the root
// ---------------------------------------------------------------------------

const TOKENS = ["--grad-start-rgb", "--grad-end-rgb", "--grad-start-k", "--grad-end-k", "--grad-start-text-rgb", "--grad-end-text-rgb"];

// On load and on every change, through this one path (the same discipline as applyAccessibility).
export function applyLook(look: Look): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = look.theme;
  if (look.style === "flat" || look.stops === null) {
    delete root.dataset.style;
    for (const t of TOKENS) root.style.removeProperty(t);
    return;
  }
  const [a, b] = look.stops;
  root.dataset.style = look.style;
  root.style.setProperty("--grad-start-rgb", a);
  root.style.setProperty("--grad-end-rgb", b);
  root.style.setProperty("--grad-start-k", "1");
  root.style.setProperty("--grad-end-k", String(stopStrength(b)));
  root.style.setProperty("--grad-start-text-rgb", textStop(a));
  root.style.setProperty("--grad-end-text-rgb", textStop(b, HEADING_END_SHARE));
}
