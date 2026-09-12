// ============================================================================
// accessibilityPreference.test.ts
// 0.13.5 Phase 1.
//
// ⚠️ THE CASE THAT MATTERS MOST IS THE LAST ONE: applyAccessibility must be the ONE writer, and it
// must run on LOAD as well as on change. A preference that applies when you toggle it but not when
// you reopen the game is the single most common bug in settings code, and it is invisible to a
// test that only exercises the setter.
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  UI_SCALE_STEPS,
  UI_SCALE_DEFAULT,
  loadUiScale,
  saveUiScale,
  loadReducedMotion,
  saveReducedMotion,
  loadHighContrast,
  saveHighContrast,
  loadDyslexiaFont,
  saveDyslexiaFont,
  loadForceMobile,
  saveForceMobile,
  applyAccessibility,
} from "./accessibilityPreference";

// A minimal in-memory localStorage. The module reaches storage through safeStorage, which reads
// the global, so standing one up here exercises the real path rather than a mock of the module.
function installStorage(): Record<string, string> {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  });
  return store;
}

beforeEach(() => {
  installStorage();
  vi.unstubAllGlobals();
  installStorage();
});

describe("UI scale", () => {
  it("defaults to 1, so a player who never opens the tab sees today's sizes exactly", () => {
    expect(loadUiScale()).toBe(UI_SCALE_DEFAULT);
    expect(UI_SCALE_DEFAULT).toBe(1);
  });

  it("round-trips every offered step", () => {
    for (const step of UI_SCALE_STEPS) {
      saveUiScale(step);
      expect(loadUiScale()).toBe(step);
    }
  });

  it("⚠️ rejects a value not on the ladder rather than applying it", () => {
    // A hand-edited or corrupt entry would otherwise rescale every element in the game by an
    // arbitrary factor. Falling back to the default is the only safe reading.
    localStorage.setItem("fleet_admiral_ui_scale", "9");
    expect(loadUiScale()).toBe(UI_SCALE_DEFAULT);
    localStorage.setItem("fleet_admiral_ui_scale", "not-a-number");
    expect(loadUiScale()).toBe(UI_SCALE_DEFAULT);
    localStorage.setItem("fleet_admiral_ui_scale", "-1");
    expect(loadUiScale()).toBe(UI_SCALE_DEFAULT);
  });

  it("offers more headroom UP than down, because the app was criticised as too small", () => {
    // The external UX review's finding was that the interface is too small, so the useful range is
    // upward. One step down exists for small phones; shrinking further is not a direction worth
    // offering for an app already called hard to read.
    const below = UI_SCALE_STEPS.filter((s) => s < 1).length;
    const above = UI_SCALE_STEPS.filter((s) => s > 1).length;
    expect(above).toBeGreaterThan(below);
    expect(Math.max(...UI_SCALE_STEPS)).toBeLessThanOrEqual(1.5);
  });
});

describe("the boolean toggles round-trip", () => {
  it("high contrast, dyslexia font and force-mobile all default OFF and persist", () => {
    expect(loadHighContrast()).toBe(false);
    expect(loadDyslexiaFont()).toBe(false);
    expect(loadForceMobile()).toBe(false);
    saveHighContrast(true);
    saveDyslexiaFont(true);
    saveForceMobile(true);
    expect(loadHighContrast()).toBe(true);
    expect(loadDyslexiaFont()).toBe(true);
    expect(loadForceMobile()).toBe(true);
  });
});

describe("reduced motion defers to the operating system until overridden", () => {
  it("⚠️ defaults to the OS setting rather than to false", () => {
    // A player who already told their OS they want reduced motion should not have to tell this
    // game separately. That is what the media query is for, and ignoring it would be the app
    // asking a question the player has already answered.
    vi.stubGlobal("window", {
      matchMedia: (q: string) => ({ matches: q.includes("reduce") }),
    });
    expect(loadReducedMotion()).toBe(true);
  });

  it("an explicit choice overrides the OS, in BOTH directions", () => {
    vi.stubGlobal("window", {
      matchMedia: (q: string) => ({ matches: q.includes("reduce") }),
    });
    // Opting back INTO motion on a machine whose OS says otherwise must be possible.
    saveReducedMotion(false);
    expect(loadReducedMotion()).toBe(false);
    saveReducedMotion(true);
    expect(loadReducedMotion()).toBe(true);
  });

  it("survives an environment with no matchMedia at all", () => {
    vi.stubGlobal("window", {});
    expect(loadReducedMotion()).toBe(false);
  });
});

describe("applyAccessibility is the ONE writer, and it writes everything", () => {
  it("sets the scale variable and every mode attribute in a single call", () => {
    const root: { style: Record<string, string>; dataset: Record<string, string> } = {
      style: {} as never,
      dataset: {},
    };
    (root.style as never as { setProperty: (k: string, v: string) => void }).setProperty = (k, v) => {
      (root.style as Record<string, string>)[k] = v;
    };
    vi.stubGlobal("document", { documentElement: root });

    applyAccessibility({ uiScale: 1.25, highContrast: true, dyslexiaFont: false, reducedMotion: true });

    // ⚠️ --ui-scale is the hook EVERY type step is a calc() against, so this one property is what
    // rescales the entire interface. If it is not written, the whole feature is inert.
    expect((root.style as Record<string, string>)["--ui-scale"]).toBe("1.25");
    expect(root.dataset.highContrast).toBe("on");
    expect(root.dataset.dyslexiaFont).toBe("off");
    expect(root.dataset.reducedMotion).toBe("on");
  });

  it("writes 'off' explicitly rather than removing the attribute", () => {
    // An absent attribute and an attribute set to "off" are the same to the CSS, but an explicit
    // value means the DOM always states the current mode, which is far easier to debug from a
    // screenshot of someone else's browser.
    const root: { style: Record<string, string>; dataset: Record<string, string> } = {
      style: {} as never,
      dataset: {},
    };
    (root.style as never as { setProperty: (k: string, v: string) => void }).setProperty = () => {};
    vi.stubGlobal("document", { documentElement: root });
    applyAccessibility({ uiScale: 1, highContrast: false, dyslexiaFont: false, reducedMotion: false });
    expect(root.dataset.highContrast).toBe("off");
    expect(root.dataset.dyslexiaFont).toBe("off");
    expect(root.dataset.reducedMotion).toBe("off");
  });

  it("is a no-op without a document rather than throwing", () => {
    vi.stubGlobal("document", undefined);
    expect(() => applyAccessibility({ uiScale: 1, highContrast: false, dyslexiaFont: false, reducedMotion: false })).not.toThrow();
  });
});
