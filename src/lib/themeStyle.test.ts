import { describe, it, expect, afterEach } from "vitest";
import { STARFALL, THEME_PRESETS, DEFAULT_PRESET_ID, availablePresets, effectivePreset, loadThemePreset, saveThemePreset, applyThemePreset, stopValue } from "./themeStyle";
import { installMemoryStorage, installBlockedStorage, restoreStorage } from "./secret/testStorage";

afterEach(() => restoreStorage());

describe("presets are data", () => {
  it("Starfall is the washShine style with the accent into purple", () => {
    expect(STARFALL).toEqual({ id: "starfall", label: "Starfall", style: "washShine", stops: ["accent", { rgb: "160, 32, 240" }] });
    expect(THEME_PRESETS).toContain(STARFALL);
    expect(stopValue("accent")).toBe("var(--color-accent-rgb)");
    expect(stopValue({ rgb: "1, 2, 3" })).toBe("1, 2, 3");
  });
});

describe("the style only applies while unlocked", () => {
  it("nothing to pick and the default look until washShine is unlocked", () => {
    expect(availablePresets([])).toEqual([]);
    expect(effectivePreset("starfall", [])).toBeNull();
    expect(availablePresets(["washShine"])).toEqual([STARFALL]);
    expect(effectivePreset("starfall", ["washShine"])).toBe(STARFALL);
    expect(effectivePreset(DEFAULT_PRESET_ID, ["washShine"])).toBeNull();
    expect(effectivePreset("nonsense", ["washShine"])).toBeNull();
  });
});

describe("the device-side preference", () => {
  it("remembers a known preset and ignores anything else", () => {
    installMemoryStorage();
    expect(loadThemePreset()).toBe(DEFAULT_PRESET_ID);
    saveThemePreset("starfall");
    expect(loadThemePreset()).toBe("starfall");
    saveThemePreset("bogus");
    expect(loadThemePreset()).toBe("starfall");
  });
  it("blocked storage falls back to the default", () => {
    installBlockedStorage();
    expect(loadThemePreset()).toBe(DEFAULT_PRESET_ID);
    expect(() => saveThemePreset("starfall")).not.toThrow();
  });
});

describe("applyThemePreset is the one writer to the root", () => {
  function fakeRoot() {
    const props = new Map<string, string>();
    const root = {
      dataset: {} as Record<string, string>,
      style: { setProperty: (k: string, v: string) => props.set(k, v), removeProperty: (k: string) => props.delete(k) },
    };
    (globalThis as { document?: unknown }).document = { documentElement: root };
    return { root, props };
  }
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it("writes the style attribute and both stop tokens, and null removes them all", () => {
    const { root, props } = fakeRoot();
    applyThemePreset(STARFALL);
    expect(root.dataset.style).toBe("washShine");
    expect(props.get("--grad-start-rgb")).toBe("var(--color-accent-rgb)");
    expect(props.get("--grad-end-rgb")).toBe("160, 32, 240");
    applyThemePreset(null);
    expect(root.dataset.style).toBeUndefined();
    expect(props.size).toBe(0);
  });
});
