import { describe, it, expect } from "vitest";
import { COMBO_SEQUENCE, COMBO_LENGTH, comboKeyForCode, comboActionForKey, advanceCombo, type ComboKey } from "./combo";

describe("comboKeyForCode", () => {
  it("maps the twelve-press keys by event.code", () => {
    expect(comboKeyForCode("ArrowUp")).toBe("up");
    expect(comboKeyForCode("ArrowDown")).toBe("down");
    expect(comboKeyForCode("ArrowLeft")).toBe("left");
    expect(comboKeyForCode("ArrowRight")).toBe("right");
    expect(comboKeyForCode("KeyB")).toBe("b");
    expect(comboKeyForCode("KeyA")).toBe("a");
    expect(comboKeyForCode("ShiftRight")).toBe("select");
    expect(comboKeyForCode("Enter")).toBe("start");
  });

  it("the number pad Enter is not Start, and any other key clears", () => {
    expect(comboKeyForCode("NumpadEnter")).toBe("other");
    expect(comboKeyForCode("KeyX")).toBe("other");
    expect(comboKeyForCode("Space")).toBe("other");
  });

  it("Left Shift neither counts nor clears, and held-key repeats are ignored", () => {
    expect(comboKeyForCode("ShiftLeft")).toBe("ignore");
    expect(comboKeyForCode("ArrowUp", true)).toBe("ignore");
    expect(comboKeyForCode("KeyX", true)).toBe("ignore");
  });
});

describe("advanceCombo", () => {
  it("has the twelve presses in order", () => {
    expect(COMBO_LENGTH).toBe(12);
    expect(COMBO_SEQUENCE).toEqual(["up", "up", "down", "down", "left", "right", "left", "right", "b", "a", "select", "start"]);
  });

  it("completes on the full sequence", () => {
    let pos = 0;
    for (const k of COMBO_SEQUENCE) pos = advanceCombo(pos, k);
    expect(pos).toBe(12);
  });

  it("a wrong press clears, and a wrong press of Up counts as a fresh first press", () => {
    expect(advanceCombo(5, "b")).toBe(0);
    expect(advanceCombo(3, "up")).toBe(1);
    expect(advanceCombo(1, "up")).toBe(2);
    expect(advanceCombo(2, "up")).toBe(1);
  });

  it("a slip anywhere means starting over, and a fresh start right after a slip works", () => {
    let pos = 0;
    for (const k of ["up", "up", "down", "left"] as ComboKey[]) pos = advanceCombo(pos, k);
    expect(pos).toBe(0);
    for (const k of COMBO_SEQUENCE) pos = advanceCombo(pos, k);
    expect(pos).toBe(12);
  });
});

describe("comboActionForKey", () => {
  it("lets keyboard users move focus and press pad buttons without clearing", () => {
    expect(comboActionForKey("Tab", false, false)).toBe("ignore");
    expect(comboActionForKey("Space", false, true)).toBe("ignore");
    expect(comboActionForKey("Space", false, false)).toBe("other");
    expect(comboActionForKey("Enter", false, true)).toBe("start");
    expect(comboActionForKey("NumpadEnter", false, true)).toBe("other");
    expect(comboActionForKey("ArrowUp", true, false)).toBe("ignore");
  });
});
