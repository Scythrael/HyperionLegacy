// ============================================================================
// accessibilityPreference.ts: the ACCESSIBILITY settings, device-side.
// 0.13.5 Phase 1. Design: 2026-09-11-presentation-0.13.5-design.md section 1.3.
//
// ⚠️ EVERY SETTING HERE IS localStorage, NOT THE SAVE, AND THAT IS THE SORTING RULE RATHER THAN A
// CONVENIENCE. The simulation reads none of them: they change how the interface is READ and
// OPERATED, not what the game does. A setting the TICK consults must be in the save or offline
// stops matching live (the conflict 0.13.3 surfaced and resolved by moving the salvage-confirm
// preference into GameState). These are the other side of that line.
//
// They are also genuinely per-DEVICE, which is the second reason: a player who needs larger text
// on a phone does not necessarily want it on a desktop monitor, and a save that carried the
// setting would force one choice onto both.
//
// Every accessor goes through safeStorage, so a blocked or full store degrades to the default
// rather than throwing. That matters more here than anywhere else in the app: an accessibility
// setting that throws is a setting that locks out the person who needs it.
// ============================================================================

import { safeGetItem, safeSetItem } from "./safeStorage";

const UI_SCALE_KEY = "fleet_admiral_ui_scale";
const REDUCED_MOTION_KEY = "fleet_admiral_reduced_motion";
const HIGH_CONTRAST_KEY = "fleet_admiral_high_contrast";
const DYSLEXIA_FONT_KEY = "fleet_admiral_dyslexia_font";
const FORCE_MOBILE_KEY = "fleet_admiral_force_mobile";

// ---------------------------------------------------------------------------
// UI SCALE
// ---------------------------------------------------------------------------

// The offered steps, as multipliers of the base type scale. 1 is today's sizes exactly, so a
// player who never opens this tab sees no change whatsoever.
//
// ⚠️ THE RANGE IS DELIBERATELY ASYMMETRIC: 0.9 down, 1.5 up. The external UX review's finding was
// that the app is TOO SMALL ("fonts a bit too small, I have to get really close at 100% on
// desktop"), so the useful headroom is upward. One step down exists for players on small phones
// who want more on screen, and no further: shrinking an interface already criticised as small is
// not a direction worth offering.
//
// ⚠️ THE CEILING IS A LAYOUT CONSTRAINT, NOT A PREFERENCE. Every step scales the ENTIRE interface
// through one CSS variable, and beyond roughly 1.5 the denser screens (the queue rows, the loadout
// board) begin to wrap in ways nobody has designed. Raising it is a layout job, not a number
// change. Phase 4's desktop treatment is the natural place to revisit it.
export const UI_SCALE_STEPS = [0.9, 1, 1.1, 1.25, 1.4, 1.5] as const;
export const UI_SCALE_DEFAULT = 1;

export function loadUiScale(): number {
  const raw = safeGetItem(UI_SCALE_KEY);
  if (raw === null) return UI_SCALE_DEFAULT;
  const parsed = Number(raw);
  // Guarded against a hand-edited or corrupt value: anything not on the offered ladder falls back
  // to the default rather than applying an arbitrary multiplier to every element in the game.
  return (UI_SCALE_STEPS as readonly number[]).includes(parsed) ? parsed : UI_SCALE_DEFAULT;
}

export function saveUiScale(scale: number): void {
  safeSetItem(UI_SCALE_KEY, String(scale));
}

// ---------------------------------------------------------------------------
// BOOLEAN TOGGLES
// ---------------------------------------------------------------------------

function loadFlag(key: string, fallback: boolean): boolean {
  const raw = safeGetItem(key);
  if (raw === null) return fallback;
  return raw === "true";
}

function saveFlag(key: string, value: boolean): void {
  safeSetItem(key, String(value));
}

// ⚠️ REDUCED MOTION DEFAULTS TO THE OS SETTING, NOT TO false. A player who has already told their
// operating system they want reduced motion should not have to tell this game separately: that is
// the whole point of the media query existing. The stored value is an OVERRIDE of that default in
// either direction, so someone can opt back into motion on a machine where the OS flag is on.
//
// The app's CSS already honours `prefers-reduced-motion` independently (the tick bar's sweep is
// disabled under it), so this toggle makes the same reduction available to someone whose OS is not
// configured for it, rather than duplicating the query.
export function loadReducedMotion(): boolean {
  const raw = safeGetItem(REDUCED_MOTION_KEY);
  if (raw !== null) return raw === "true";
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function saveReducedMotion(value: boolean): void {
  saveFlag(REDUCED_MOTION_KEY, value);
}

// High contrast: raises text and border contrast further than the AA baseline the palette already
// meets. ⚠️ NOT a replacement for the palette being correct. 0.13.5 lifted every text token to
// clear AA in all six themes, so this is a step BEYOND compliance for players who need it, never
// the thing that makes the default palette acceptable.
export function loadHighContrast(): boolean {
  return loadFlag(HIGH_CONTRAST_KEY, false);
}
export function saveHighContrast(value: boolean): void {
  saveFlag(HIGH_CONTRAST_KEY, value);
}

// A dyslexia-friendly typeface for body text. Leaves the display font alone: the headings are
// short, they carry the game's identity, and swapping them buys little while costing the look.
export function loadDyslexiaFont(): boolean {
  return loadFlag(DYSLEXIA_FONT_KEY, false);
}
export function saveDyslexiaFont(value: boolean): void {
  saveFlag(DYSLEXIA_FONT_KEY, value);
}

// ⚠️ FORCE MOBILE IS STORED HERE BUT DOES NOTHING UNTIL PHASE 4. The separate mobile and desktop
// view layers do not exist yet, so there is no mobile view to force. The preference is defined now
// because it belongs to this tab and because storing it early means phase 4 wires a switch that is
// already persisted, rather than adding persistence and a view layer in the same change.
// The control is rendered DISABLED with an honest explanation rather than hidden: a setting that
// appears later without warning is worse than one that says "not yet".
export function loadForceMobile(): boolean {
  return loadFlag(FORCE_MOBILE_KEY, false);
}
export function saveForceMobile(value: boolean): void {
  saveFlag(FORCE_MOBILE_KEY, value);
}

// ---------------------------------------------------------------------------
// APPLYING THEM
// ---------------------------------------------------------------------------

// Push the settings onto the document root, where the CSS reads them.
//
// ⚠️ ONE WRITER, AND IT IS THIS FUNCTION. The alternative (each control setting its own attribute
// at its own call site) is how a setting ends up applied on change but not on load, which is the
// single most common bug in preference code. Calling this on load AND after any change means there
// is exactly one path.
//
// --ui-scale is the hook every type step is a calc() against, so setting one property rescales the
// whole interface; the data-attributes let CSS opt in to the other modes.
export function applyAccessibility(settings: {
  uiScale: number;
  highContrast: boolean;
  dyslexiaFont: boolean;
  reducedMotion: boolean;
}): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--ui-scale", String(settings.uiScale));
  root.dataset.highContrast = settings.highContrast ? "on" : "off";
  root.dataset.dyslexiaFont = settings.dyslexiaFont ? "on" : "off";
  root.dataset.reducedMotion = settings.reducedMotion ? "on" : "off";
}
