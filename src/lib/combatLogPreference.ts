// ============================================================================
// combatLogPreference.ts: Combat-log DISPLAY preferences (Combat 0.13.0)
//
// localStorage-backed UI preferences for the combat view's log, deliberately kept
// OUT of src/lib/game/save.ts's save-file contract (the same rationale as
// theme.ts / tickBarPreference.ts / salvageConfirmPreference.ts): they are pure
// presentation, so they survive a "delete save", need NO SAVE_VERSION migration,
// and never touch GameState.
//
// EXTENSIBLE BY DESIGN. This is the first module of a growing accessibility /
// theming options hub. Each preference is an INDEPENDENT get/set pair under its own
// localStorage key, so a future preference (high-contrast, a colorblind-safe damage
// palette, a pride theme) is added as a sibling block below without touching the
// others and without a shared blob to migrate.
//
// ROBUSTNESS. Every loader tolerates an ABSENT or CORRUPT stored value by returning
// the documented default (mirroring salvageConfirmPreference.ts's defensive shape),
// so a wiped, hand-edited, or foreign store can never throw or render a broken
// control. The setters coerce to a stable string form so a round-trip is exact.
//
// No em dashes / no "--" as punctuation (project rule): commas, periods, parens only.
// ============================================================================

// localStorage is reached through safeStorage (guarded get/set) so a blocked or full
// store (blocked site data, Safari private mode) degrades to "no persistence" (each
// loader's documented default) instead of throwing. This is load-bearing: these
// loaders run at CombatView mount, so a bare throw here took the whole panel down.
import { safeGetItem, safeSetItem } from "./safeStorage";

// --- combatLogStyle: how each log line reads --------------------------------
// "default"   -> the layered cosmetic flavor narration (flavor.ts), the current look.
// "simplified"-> a distilled, plain damage report (attacker, weapon, shield/hull
//                numbers), for readability + accessibility. Default "default".
export type CombatLogStyle = "default" | "simplified";
const COMBAT_LOG_STYLE_KEY = "fleet_admiral_combat_log_style";

export function loadCombatLogStyle(): CombatLogStyle {
  // Only the one non-default token is honored; anything else (absent, corrupt, a
  // foreign value) falls back to "default".
  return safeGetItem(COMBAT_LOG_STYLE_KEY) === "simplified"
    ? "simplified"
    : "default";
}

export function saveCombatLogStyle(style: CombatLogStyle): void {
  safeSetItem(COMBAT_LOG_STYLE_KEY, style);
}

// --- combatDamageColors: color-code the damage numbers ----------------------
// When true, the Simplified log tints shield-damage numbers one color and
// hull-damage numbers another (accessibility: distinguish the two at a glance).
// Default FALSE (opt-in), so the log stays monochrome until the player asks for it.
const COMBAT_DAMAGE_COLORS_KEY = "fleet_admiral_combat_damage_colors";

export function loadCombatDamageColors(): boolean {
  // Default false: only the exact "true" token enables it (absent/corrupt => off).
  return safeGetItem(COMBAT_DAMAGE_COLORS_KEY) === "true";
}

export function saveCombatDamageColors(enabled: boolean): void {
  safeSetItem(COMBAT_DAMAGE_COLORS_KEY, String(enabled));
}

// --- combatLogSpeed: log-stream cadence -------------------------------------
// "slow" -> reveal one round per five seconds, the READABLE default: a full battle now
//           plays round by round (the counter fix), and 1s/round flashes past too fast
//           to read (user feedback 2026-07-29), so the relaxed pace is the default.
// "fast" -> one round per second, an opt-in skim / fast-forward for players who just
//           want the outcome quickly.
// The combat view maps these to milliseconds via combatView.ts logSpeedToMs (the string
// values line up with its LogSpeed type on purpose). Default "slow".
export type CombatLogSpeed = "fast" | "slow";
const COMBAT_LOG_SPEED_KEY = "fleet_admiral_combat_log_speed";

export function loadCombatLogSpeed(): CombatLogSpeed {
  // Default "slow" (readable). Only the explicit "fast" token selects the skim pace, so an
  // absent / corrupt value falls back to the readable default.
  return safeGetItem(COMBAT_LOG_SPEED_KEY) === "fast" ? "fast" : "slow";
}

export function saveCombatLogSpeed(speed: CombatLogSpeed): void {
  safeSetItem(COMBAT_LOG_SPEED_KEY, speed);
}

// --- combatAutoScroll: pin the log to the newest line -----------------------
// When true (the default), the combat log auto-scrolls to keep the freshest round
// in view as the stream advances. When false, the log holds position so the player
// can read back without being yanked to the bottom each update. Default TRUE.
const COMBAT_AUTO_SCROLL_KEY = "fleet_admiral_combat_auto_scroll";

export function loadCombatAutoScroll(): boolean {
  const raw = safeGetItem(COMBAT_AUTO_SCROLL_KEY);
  // Default TRUE when unset; otherwise only the exact "false" token disables it.
  return raw === null ? true : raw !== "false";
}

export function saveCombatAutoScroll(enabled: boolean): void {
  safeSetItem(COMBAT_AUTO_SCROLL_KEY, String(enabled));
}
