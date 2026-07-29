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

// --- combatLogStyle: how each log line reads --------------------------------
// "default"   -> the layered cosmetic flavor narration (flavor.ts), the current look.
// "simplified"-> a distilled, plain damage report (attacker, weapon, shield/hull
//                numbers), for readability + accessibility. Default "default".
export type CombatLogStyle = "default" | "simplified";
const COMBAT_LOG_STYLE_KEY = "fleet_admiral_combat_log_style";

export function loadCombatLogStyle(): CombatLogStyle {
  // Only the one non-default token is honored; anything else (absent, corrupt, a
  // foreign value) falls back to "default".
  return localStorage.getItem(COMBAT_LOG_STYLE_KEY) === "simplified"
    ? "simplified"
    : "default";
}

export function saveCombatLogStyle(style: CombatLogStyle): void {
  localStorage.setItem(COMBAT_LOG_STYLE_KEY, style);
}

// --- combatDamageColors: color-code the damage numbers ----------------------
// When true, the Simplified log tints shield-damage numbers one color and
// hull-damage numbers another (accessibility: distinguish the two at a glance).
// Default FALSE (opt-in), so the log stays monochrome until the player asks for it.
const COMBAT_DAMAGE_COLORS_KEY = "fleet_admiral_combat_damage_colors";

export function loadCombatDamageColors(): boolean {
  // Default false: only the exact "true" token enables it (absent/corrupt => off).
  return localStorage.getItem(COMBAT_DAMAGE_COLORS_KEY) === "true";
}

export function saveCombatDamageColors(enabled: boolean): void {
  localStorage.setItem(COMBAT_DAMAGE_COLORS_KEY, String(enabled));
}

// --- combatLogSpeed: log-stream cadence -------------------------------------
// "fast" -> reveal one round per second (the design default cadence).
// "slow" -> one round per five seconds, for reading the log at a relaxed pace.
// The combat view maps these to milliseconds via combatView.ts logSpeedToMs (the
// string values line up with its LogSpeed type on purpose). Default "fast".
export type CombatLogSpeed = "fast" | "slow";
const COMBAT_LOG_SPEED_KEY = "fleet_admiral_combat_log_speed";

export function loadCombatLogSpeed(): CombatLogSpeed {
  return localStorage.getItem(COMBAT_LOG_SPEED_KEY) === "slow" ? "slow" : "fast";
}

export function saveCombatLogSpeed(speed: CombatLogSpeed): void {
  localStorage.setItem(COMBAT_LOG_SPEED_KEY, speed);
}

// --- combatAutoScroll: pin the log to the newest line -----------------------
// When true (the default), the combat log auto-scrolls to keep the freshest round
// in view as the stream advances. When false, the log holds position so the player
// can read back without being yanked to the bottom each update. Default TRUE.
const COMBAT_AUTO_SCROLL_KEY = "fleet_admiral_combat_auto_scroll";

export function loadCombatAutoScroll(): boolean {
  const raw = localStorage.getItem(COMBAT_AUTO_SCROLL_KEY);
  // Default TRUE when unset; otherwise only the exact "false" token disables it.
  return raw === null ? true : raw !== "false";
}

export function saveCombatAutoScroll(enabled: boolean): void {
  localStorage.setItem(COMBAT_AUTO_SCROLL_KEY, String(enabled));
}
