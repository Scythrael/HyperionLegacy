// combo.ts: the twelve-press combo behind the Enter Code window (0.13.11).
//
// Pure data and two pure functions so every rule is unit tested; the Svelte component only calls
// these. Keys are matched by KeyboardEvent.code (the physical key), not .key, so a keyboard layout
// or Caps Lock cannot change what a press means.
//   Select is Right Shift only. Start is the main Enter only (NumpadEnter is a different code and
//   does not count). Left Shift neither counts nor clears, so a player reaching for a capital
//   letter by habit loses nothing. Held-key auto repeats are ignored so holding Up is one press.
//   Any other key clears the slots silently (no error text: the secret stays a secret).
// The window never shows the sequence; this file is the only place it is written down.

export type ComboKey = "up" | "down" | "left" | "right" | "b" | "a" | "select" | "start";

export const COMBO_SEQUENCE: readonly ComboKey[] = [
  "up", "up", "down", "down", "left", "right", "left", "right", "b", "a", "select", "start",
];
export const COMBO_LENGTH = COMBO_SEQUENCE.length;

const CODE_TO_KEY: Readonly<Record<string, ComboKey>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyB: "b",
  KeyA: "a",
  ShiftRight: "select",
  Enter: "start",
};

// What a physical key press means to the combo pad.
export function comboKeyForCode(code: string, repeat = false): ComboKey | "ignore" | "other" {
  if (repeat || code === "ShiftLeft") return "ignore";
  return CODE_TO_KEY[code] ?? "other";
}

// The next position after one press. A correct press lights the next slot; a wrong press clears,
// except that a wrong press of Up counts as a fresh first press (it may be the start of a retry).
// Position COMBO_LENGTH means complete.
export function advanceCombo(pos: number, key: ComboKey): number {
  if (pos >= 0 && pos < COMBO_LENGTH && COMBO_SEQUENCE[pos] === key) return pos + 1;
  return key === COMBO_SEQUENCE[0] ? 1 : 0;
}

// What a key press does while the combo area is open, given where focus is. Keyboard and screen
// reader friendliness on top of the raw mapping: Tab and Shift+Tab move focus without clearing,
// and Space on a focused pad button presses that button (its click does the work) rather than
// counting as a stray key.
export function comboActionForKey(code: string, repeat: boolean, targetIsButton: boolean): ComboKey | "ignore" | "other" {
  if (code === "Tab") return "ignore";
  if (code === "Space" && targetIsButton) return "ignore";
  return comboKeyForCode(code, repeat);
}
