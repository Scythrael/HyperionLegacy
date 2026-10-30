// backgroundStyle.ts: the BACKGROUND visualization track (0.14.0 minigame redesign Slice 5b).
//
// Signed off as drawn (user, 2026-10-29, mockup v2: docs/plans/2026-10-29-background-settings-mockup.html).
// It mirrors the theme style setting (themeStyle.ts) exactly:
//   Background preset   one dropdown: Default (today's backdrop, Starfield.svelte), one preset per
//                       unlocked background (e.g. Faster Than Light), then Manual.
//   Manual              a Background style dropdown plus Configure; the Configure window lists every
//                       background on top and its own controls below (Default: nothing to tune).
// Locked backgrounds show a generic hint at their source and never their name (no spoiler).
//
// The UNLOCK is the background id in the main save's unlockedBackgrounds (accountExtras.ts), mirrored
// from the milestone whose rewardHook names it (secret/config.ts), so later backgrounds slot in as
// their own unlocks. Choices are device-side (localStorage via safeStorage); each background keeps
// its own Manual settings, and a missing unlock (Delete Save) falls back quietly to Default.
//
// Colors: Faster Than Light follows the player's look (themeStyle.ts Look): Flat streaks in the one
// accent color, a gradient style washes each streak between its stops. "Ignore theme colors" (off
// in every preset) draws the classic white streaks instead.

import { safeGetItem, safeSetItem } from "./safeStorage";
import { themeRgb, type Look } from "./themeStyle";
import { MILESTONES } from "./secret/config";

export type BackgroundId = "default" | "fasterThanLight";

export interface BackgroundDef {
  id: BackgroundId;
  label: string;
  unlock: string | null; // the unlock id needed (null: everyone)
}

export const BACKGROUNDS: readonly BackgroundDef[] = [
  { id: "default", label: "Default", unlock: null },
  { id: "fasterThanLight", label: "Faster Than Light", unlock: "fasterThanLight" },
];

// The locked hint (user: "Unlocked by completing an achievement." and so forth). Generic on purpose:
// it never names the background, the milestone or its number.
export const LOCKED_HINT = "Unlocked by completing an achievement";
export const LOCKED_OPTION = "Locked: unlocked by completing an achievement";

export type BackgroundPresetChoice = "default" | "fasterThanLight" | "manual";

// Faster Than Light's settings. Sliders run 1 to 10 (the mockup's ranges and defaults).
export interface FtlSettings {
  speed: number;
  streakLength: number;
  stars: number;
  brightness: number;
  ignoreThemeColors: boolean; // classic white streaks; OFF in every preset
  jumpOnStart: boolean; // the Jump to warp burst when it turns on
  still: boolean; // no motion (also automatic with reduced motion)
}

export const SLIDER_MIN = 1;
export const SLIDER_MAX = 10;

export const FTL_DEFAULTS: Readonly<FtlSettings> = {
  speed: 6,
  streakLength: 6,
  stars: 5,
  brightness: 6,
  ignoreThemeColors: false,
  jumpOnStart: true,
  still: false,
};

export interface BackgroundPrefs {
  preset: BackgroundPresetChoice;
  manualBackground: BackgroundId;
  ftl: FtlSettings; // Manual's Faster Than Light settings (presets always use FTL_DEFAULTS)
}

export const DEFAULT_BACKGROUND_PREFS: BackgroundPrefs = { preset: "default", manualBackground: "default", ftl: { ...FTL_DEFAULTS } };

export function backgroundUnlocked(id: BackgroundId, unlocked: readonly string[]): boolean {
  const def = BACKGROUNDS.find((b) => b.id === id);
  return def !== undefined && (def.unlock === null || unlocked.includes(def.unlock));
}

// Every unlocked background other than Default brings its own preset.
export function availableBackgroundPresets(unlocked: readonly string[]): BackgroundDef[] {
  return BACKGROUNDS.filter((b) => b.unlock !== null && backgroundUnlocked(b.id, unlocked));
}

// The backgrounds the player may pick in Manual (Default always).
export function availableBackgrounds(unlocked: readonly string[]): BackgroundDef[] {
  return BACKGROUNDS.filter((b) => backgroundUnlocked(b.id, unlocked));
}

// How many backgrounds are still locked (each shows as one generic locked entry).
export function lockedBackgroundCount(unlocked: readonly string[]): number {
  return BACKGROUNDS.filter((b) => !backgroundUnlocked(b.id, unlocked)).length;
}

export interface ResolvedBackground {
  id: BackgroundId;
  ftl: Readonly<FtlSettings>;
}

// What plays, given the choices and the account's unlocks. A preset whose unlock is gone, or a Manual
// pick that is locked, plays Default.
export function resolveBackground(prefs: BackgroundPrefs, unlocked: readonly string[]): ResolvedBackground {
  if (prefs.preset === "fasterThanLight" && backgroundUnlocked("fasterThanLight", unlocked)) return { id: "fasterThanLight", ftl: FTL_DEFAULTS };
  if (prefs.preset === "manual") {
    const id = backgroundUnlocked(prefs.manualBackground, unlocked) ? prefs.manualBackground : "default";
    return { id, ftl: prefs.ftl };
  }
  return { id: "default", ftl: FTL_DEFAULTS };
}

// The preset the dropdown shows: a preset whose unlock is gone shows (and behaves) as Default.
export function shownBackgroundPreset(prefs: BackgroundPrefs, unlocked: readonly string[]): BackgroundPresetChoice {
  if (prefs.preset === "manual" || prefs.preset === "default") return prefs.preset;
  return backgroundUnlocked(prefs.preset, unlocked) ? prefs.preset : "default";
}

// Still (no motion): the player's switch, or automatically when reduced motion is asked for (the
// system setting, or the game's own Reduce motion setting, which defaults to the system's).
export function effectiveStill(ftl: Readonly<FtlSettings>, reducedMotion: boolean): boolean {
  return reducedMotion || ftl.still;
}

// ---------------------------------------------------------------------------
// Unlocks: the milestone reward hooks
// ---------------------------------------------------------------------------

// The backgrounds the minigame's reached milestones award (MilestoneDef.rewardHook).
export function backgroundsFromMilestones(reached: Partial<Record<string, number>>): BackgroundId[] {
  const out: BackgroundId[] = [];
  for (const m of MILESTONES) {
    if (m.rewardHook !== undefined && reached[m.id] !== undefined && !out.includes(m.rewardHook)) out.push(m.rewardHook);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export type Rgb = readonly [number, number, number];

// Classic white warp streaks (Ignore theme colors).
export const WHITE_STREAK: Rgb = [240, 246, 255];

function parseRgb(rgb: string): Rgb {
  const [r, g, b] = rgb.split(",").map((x) => Number(x.trim()));
  return [r, g, b];
}

// The streak colors: one for a Flat look (its accent), the stops for a gradient style (a streak washes
// between them), or white when theme colors are ignored.
export function streakPalette(look: Look, ignoreThemeColors: boolean): Rgb[] {
  if (ignoreThemeColors) return [WHITE_STREAK];
  if (look.style !== "flat" && look.stops !== null) return look.stops.map(parseRgb);
  return [parseRgb(themeRgb(look.theme))];
}

// A streak's color at t in [0, 1] along the palette (a gradient wipe across two or more colors).
export function paletteAt(palette: readonly Rgb[], t: number): Rgb {
  if (palette.length === 1) return palette[0];
  const seg = Math.max(0, Math.min(1, t)) * (palette.length - 1);
  const i = Math.min(palette.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = palette[i];
  const b = palette[i + 1];
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
}

// ---------------------------------------------------------------------------
// Device-side preferences
// ---------------------------------------------------------------------------

const PRESET_KEY = "fleet_admiral_background_preset";
const MANUAL_KEY = "fleet_admiral_background_manual";

const PRESETS: readonly BackgroundPresetChoice[] = ["default", "fasterThanLight", "manual"];

function slider(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, Math.round(v))) : fallback;
}

function flag(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

// Anything stored is checked, never trusted: an unknown or damaged value takes its default.
export function sanitizeFtl(raw: unknown): FtlSettings {
  const o = raw && typeof raw === "object" ? (raw as Partial<Record<keyof FtlSettings, unknown>>) : {};
  return {
    speed: slider(o.speed, FTL_DEFAULTS.speed),
    streakLength: slider(o.streakLength, FTL_DEFAULTS.streakLength),
    stars: slider(o.stars, FTL_DEFAULTS.stars),
    brightness: slider(o.brightness, FTL_DEFAULTS.brightness),
    ignoreThemeColors: flag(o.ignoreThemeColors, FTL_DEFAULTS.ignoreThemeColors),
    jumpOnStart: flag(o.jumpOnStart, FTL_DEFAULTS.jumpOnStart),
    still: flag(o.still, FTL_DEFAULTS.still),
  };
}

export function loadBackgroundPrefs(): BackgroundPrefs {
  const raw = safeGetItem(PRESET_KEY);
  const preset = (PRESETS as readonly string[]).includes(raw ?? "") ? (raw as BackgroundPresetChoice) : "default";
  let manual: { background?: unknown; settings?: { fasterThanLight?: unknown } } = {};
  try {
    const parsed: unknown = JSON.parse(safeGetItem(MANUAL_KEY) ?? "null");
    if (parsed && typeof parsed === "object") manual = parsed as typeof manual;
  } catch {
    manual = {};
  }
  const bg = BACKGROUNDS.some((b) => b.id === manual.background) ? (manual.background as BackgroundId) : "default";
  const settings = manual.settings && typeof manual.settings === "object" ? manual.settings : {};
  return { preset, manualBackground: bg, ftl: sanitizeFtl(settings.fasterThanLight) };
}

export function saveBackgroundPreset(preset: BackgroundPresetChoice): void {
  if (PRESETS.includes(preset)) safeSetItem(PRESET_KEY, preset);
}

// Each background keeps its own settings (one object per background id).
export function saveBackgroundManual(m: Pick<BackgroundPrefs, "manualBackground" | "ftl">): void {
  safeSetItem(MANUAL_KEY, JSON.stringify({ background: m.manualBackground, settings: { fasterThanLight: sanitizeFtl(m.ftl) } }));
}

// ---------------------------------------------------------------------------
// The one writer to the root
// ---------------------------------------------------------------------------

// data-background on <html> drives the readability guard in app.css (panels turn nearly opaque over
// a moving background). Default writes nothing, so today's look is untouched by construction.
export function applyBackground(id: BackgroundId): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (id === "default") delete root.dataset.background;
  else root.dataset.background = id;
}
