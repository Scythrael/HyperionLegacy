// ============================================================================
// confirmationPresets.ts: the CONFIRMATION LEVEL ladder.
// 0.13.5, rebuilt 2026-09-12 after the first pass shipped the wrong interaction model.
//
// ⚠️ WHAT WENT WRONG THE FIRST TIME, because it is the same failure twice in this project.
// SUGGESTIONS.md records a refined interaction model the user gave on 2026-09-11: "individual
// checkboxes AND a preset dropdown, side by side. Editing any checkbox flips the dropdown to
// Custom. Changing the dropdown raises a confirmation asking whether to overwrite the current
// settings with that preset." The 0.13.5 design doc compressed all of that into "a preset is a
// WRITE ACTION, not a stored mode", and the build followed the design doc. What shipped was three
// buttons with no checkboxes, no dropdown and no Custom state. The detail was already written down;
// the thin design doc is what lost it. Same shape as the 0.11.2 finding.
//
// THE MODEL, as specified:
//   1. Individual checkboxes for each managed confirmation, always editable.
//   2. A preset dropdown beside them, naming a level.
//   3. Editing a checkbox by hand flips the dropdown to CUSTOM.
//   4. Choosing a preset OVERWRITES the checkboxes.
//   5. ⚠️ The overwrite confirm appears ONLY when the current state is Custom. Switching between
//      clean presets destroys nothing, so a dialog there is pure friction, which is the exact
//      nagging this feature exists to reduce.
//   6. ⚠️ That confirm is NOT ITSELF A MANAGED DIALOG. Otherwise "All Off" switches off the
//      protection on the control that sets "All Off": both a recursion and a way to lose
//      hand-tuned settings in one click.
//
// ⚠️ THE SELECTED PRESET IS DERIVED, NOT STORED, and that is a deliberate improvement on the
// record's "the preset itself is one more stored value". A stored id is a second source of truth
// that can disagree with the checkboxes, which is precisely the stale-label bug the record warns
// about two bullets earlier ("a preset control that keeps claiming a preset the player has since
// edited is the classic way these systems start lying"). Deriving it from the values makes that bug
// UNREPRESENTABLE rather than merely tested for, and it needs no key, no migration and no loader.
// The requirement this has to meet in exchange is that the presets are PAIRWISE DISTINCT, so a
// value set never matches two rungs; that is asserted in the tests.
// ============================================================================

import { QUALITY_TIERS } from "./game/inventory";

// Every quality tier, derived from the canonical ceiling rather than a [0..5] literal, for the same
// reason salvageConfirmPreference.ts derives it: a seventh tier must not silently arrive unguarded.
export const ALL_QUALITY_TIERS: number[] = Array.from({ length: QUALITY_TIERS }, (_, i) => i);

// The full managed set: every confirmation a preset governs.
//
// ⚠️ THREE TODAY, AND THE SHAPE IS WHAT MATTERS MORE THAN THE COUNT. The record's list also named a
// "batch confirm" and a "no-grace warning"; neither exists as a toggle (verified 2026-09-12, no
// preference module and no gate in App.svelte), so they are not managed here. Adding one later is a
// field here plus a rung entry, and the Record below makes forgetting the rung a compile error.
//
// ⚠️ The unconditional destructive confirms (Delete Save, respec, captain-aboard ship salvage) are
// deliberately NOT in this set. They have no toggle at all today, so putting them under "All Off"
// would mean BUILDING a way to skip them, which is new behaviour rather than a settings reorg.
// Logged instead of smuggled in.
export interface ConfirmationSettings {
  // Confirm before starting a refine. Device-side (refineConfirmPreference): a dialog gate the
  // simulation never reads.
  refine: boolean;
  // The Standard-Issue auto-salvage warning (0.13.3.1). Device-side.
  baselineWarning: boolean;
  // Which quality tiers require a confirm before salvaging. ⚠️ SAVE-SIDE
  // (GameState.salvageConfirmQualities): the tick reads it, so it cannot be device-local.
  // A preset writing it therefore writes the save, which is why applying one is a state action.
  salvageQualities: number[];
}

export type ConfirmationPresetId =
  | "allEnabled"
  | "tutorial"
  | "beginner"
  | "intermediate"
  | "advanced"
  | "allOff";

// "custom" is not a preset: it is the ABSENCE of one, reported when the live settings match no rung.
export type ConfirmationLevel = ConfirmationPresetId | "custom";

export interface ConfirmationPreset {
  label: string;
  // The help text shown beside the selector. ⚠️ The record was specific that this belongs NEXT TO
  // the control rather than in the manual ("the user was specific"), so each rung carries its own
  // sentence here instead of the panel hardcoding a paragraph.
  blurb: string;
  values: ConfirmationSettings;
}

// Tiers from `from` upward, so a rung is expressed as "confirm anything this good or better".
const tiersFrom = (from: number): number[] => ALL_QUALITY_TIERS.filter((t) => t >= from);

// THE LADDER. ⚠️ EXHAUSTIVE over ConfirmationPresetId, so adding a rung without deciding what it
// does is a COMPILE ERROR rather than a dropdown entry that silently does nothing. Same discipline
// as QUEUE_ADAPTERS, PROCESS_XP_AWARDS and ICON_SEMANTICS.
//
// ⚠️ THE QUALITY TIERS ARE WHAT MAKE SIX RUNGS HONEST. With only two booleans there are four
// possible states, so a six-rung ladder built on booleans alone would have to ship duplicate rungs,
// and a duplicate rung makes the derived label ambiguous (two names for one state). The per-quality
// salvage confirm is a graduated setting, so it supplies the intermediate steps: each rung stops
// asking about one more band of cheap gear before the booleans start switching off.
export const CONFIRMATION_PRESETS: Record<ConfirmationPresetId, ConfirmationPreset> = {
  // Literally everything, including the junk tier. The game's own default and the safe end.
  allEnabled: {
    label: "Ask me everything",
    blurb: "Every confirmation on, including salvaging the cheapest gear. This is the default.",
    values: { refine: true, baselineWarning: true, salvageQualities: tiersFrom(0) },
  },
  // Everything that could matter. The only thing it drops is Q0, which is worth so little that
  // asking about it is noise rather than protection.
  tutorial: {
    label: "Tutorial",
    blurb: "Everything on except salvaging the lowest quality tier, which is rarely worth a pause.",
    values: { refine: true, baselineWarning: true, salvageQualities: tiersFrom(1) },
  },
  beginner: {
    label: "Beginner",
    blurb: "Still confirms refining and the Standard-Issue warning, and asks before salvaging anything of middling quality or better.",
    values: { refine: true, baselineWarning: true, salvageQualities: tiersFrom(2) },
  },
  // The first rung where a boolean switches off: refining is routine and reversible, so it stops
  // asking, while the warning about irreversible loss of gear your ships depend on stays.
  intermediate: {
    label: "Intermediate",
    blurb: "Stops asking before refining. Keeps the Standard-Issue warning and confirms salvage on better gear.",
    values: { refine: false, baselineWarning: true, salvageQualities: tiersFrom(3) },
  },
  advanced: {
    label: "Advanced",
    blurb: "Only the top quality tier and the Standard-Issue warning still ask. Everything else runs without a pause.",
    values: { refine: false, baselineWarning: true, salvageQualities: tiersFrom(QUALITY_TIERS - 1) },
  },
  // ⚠️ Everything off, INCLUDING the Standard-Issue warning. Offered because a player who has
  // understood the system should not be nagged forever, and because the Quartermaster makes the
  // underlying situation recoverable (a free replacement is always in stock). It is the explicit,
  // clearly-labelled end of the scale rather than somewhere a player slides into by accident.
  allOff: {
    label: "Stop asking",
    blurb: "No confirmations at all, including the warning before salvaging Standard-Issue gear. The Quartermaster stocks free replacements.",
    values: { refine: false, baselineWarning: false, salvageQualities: [] },
  },
};

// Display order, top (safest) to bottom. ⚠️ Derived from the Record's key order rather than a second
// hand-written list: two lists of the same rungs is how a new rung ends up missing from the
// dropdown while compiling perfectly.
export const CONFIRMATION_PRESET_ORDER = Object.keys(CONFIRMATION_PRESETS) as ConfirmationPresetId[];

// Order-insensitive comparison of the managed values.
//
// ⚠️ The quality list is compared as a SET. The UI appends tiers in click order, so [5,3] and [3,5]
// are the same setting; comparing arrays positionally would report Custom for a state that exactly
// matches a rung, which is the stale-label bug in the other direction.
export function settingsMatch(a: ConfirmationSettings, b: ConfirmationSettings): boolean {
  if (a.refine !== b.refine || a.baselineWarning !== b.baselineWarning) return false;
  if (a.salvageQualities.length !== b.salvageQualities.length) return false;
  const set = new Set(a.salvageQualities);
  return b.salvageQualities.every((t) => set.has(t));
}

// Which rung the live settings ARE, or "custom" when they match none.
//
// This is the single authority for the dropdown's displayed value, so the label can never claim a
// preset the player has edited away from: there is nowhere for a stale value to live.
export function resolveConfirmationLevel(settings: ConfirmationSettings): ConfirmationLevel {
  for (const id of CONFIRMATION_PRESET_ORDER) {
    if (settingsMatch(settings, CONFIRMATION_PRESETS[id].values)) return id;
  }
  return "custom";
}

// Does switching to `target` from `current` risk losing hand-tuned settings?
//
// ⚠️ THIS IS REQUIREMENT 5, AND IT IS THE ONE WORTH GETTING RIGHT. Only a CUSTOM state holds work
// that a preset would destroy; a clean rung is reproducible in one click, so confirming there
// trains players to click through the dialog and makes it useless on the day it matters.
export function presetOverwriteNeedsConfirm(
  settings: ConfirmationSettings,
  target: ConfirmationPresetId,
): boolean {
  if (resolveConfirmationLevel(settings) !== "custom") return false;
  // Nothing to lose if the target happens to equal what is already set (unreachable while the state
  // is Custom, but cheap to state rather than to reason about).
  return !settingsMatch(settings, CONFIRMATION_PRESETS[target].values);
}

// How many confirmations a settings state asks for. Used by the ladder-monotonicity test, and by
// the panel's summary line so the player sees the effect of a rung as a number.
export function confirmationCount(settings: ConfirmationSettings): number {
  return (
    (settings.refine ? 1 : 0) + (settings.baselineWarning ? 1 : 0) + settings.salvageQualities.length
  );
}
