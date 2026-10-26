import { describe, it, expect, afterEach } from "vitest";
import {
  STARFALL,
  THEME_PRESETS,
  THEME_STYLES,
  VIOLET_RGB,
  themeRgb,
  styleUnlocked,
  availablePresets,
  availableStyles,
  resolveLook,
  stopRgb,
  GRADIENT_STOPS,
  textStop,
  loadLookPrefs,
  hasManualPrefs,
  savePreset,
  saveManual,
  applyLook,
  DEFAULT_LOOK_PREFS,
  type LookPrefs,
} from "./themeStyle";
import { THEME_NAMES } from "./theme";
import { installMemoryStorage, installBlockedStorage, restoreStorage } from "./secret/testStorage";

afterEach(() => restoreStorage());

const prefs = (p: Partial<LookPrefs>): LookPrefs => ({ ...DEFAULT_LOOK_PREFS, ...p });
const UNLOCKED = ["washShine"];

describe("presets and styles are data", () => {
  it("Starfall is a preset record: washShine with FIXED cyan into purple, on the cyan theme", () => {
    expect(STARFALL).toEqual({ id: "starfall", label: "Starfall", style: "washShine", theme: "cyan", stops: ["103, 232, 249", "160, 32, 240"] });
    expect(THEME_PRESETS).toContain(STARFALL);
    expect(VIOLET_RGB).toBe("160, 32, 240");
    expect(THEME_STYLES.map((s) => s.id)).toEqual(["flat", "washShine"]);
    expect(THEME_STYLES.find((s) => s.id === "flat")!.gradient).toBe(false);
    expect(themeRgb("cyan")).toBe("103, 232, 249");
  });

  it("Flat is everyone's; Wash plus shine only once unlocked", () => {
    expect(styleUnlocked("flat", [])).toBe(true);
    expect(styleUnlocked("washShine", [])).toBe(false);
    expect(styleUnlocked("washShine", UNLOCKED)).toBe(true);
    expect(availableStyles([]).map((s) => s.id)).toEqual(["flat"]);
    expect(availableStyles(UNLOCKED).map((s) => s.id)).toEqual(["flat", "washShine"]);
    expect(availablePresets([])).toEqual([]);
    expect(availablePresets(UNLOCKED)).toEqual([STARFALL]);
  });
});

describe("resolveLook: what the screen actually shows", () => {
  it("Default is today's look exactly: flat, the player's own color theme", () => {
    for (const t of THEME_NAMES) expect(resolveLook(prefs({ preset: "default" }), UNLOCKED, t)).toEqual({ theme: t, style: "flat", stops: null });
  });

  it("Starfall is the reference look whatever the color theme says", () => {
    for (const t of THEME_NAMES) {
      expect(resolveLook(prefs({ preset: "starfall" }), UNLOCKED, t)).toEqual({ theme: "cyan", style: "washShine", stops: ["103, 232, 249", "160, 32, 240"] });
    }
  });

  it("Manual: Color 1 is the accent, Color 2 the end stop; Flat + Color 1 is exactly a color theme", () => {
    expect(resolveLook(prefs({ preset: "manual", manualStyle: "washShine", color1: "green", color2: "pink" }), UNLOCKED, "cyan")).toEqual({
      theme: "green",
      style: "washShine",
      stops: [stopRgb("green"), stopRgb("pink")],
    });
    expect(resolveLook(prefs({ preset: "manual", manualStyle: "flat", color1: "red", color2: "pink" }), UNLOCKED, "cyan")).toEqual({ theme: "red", style: "flat", stops: null });
  });

  it("a missing unlock (Delete Save) falls back: Starfall to Default, a locked Manual style to Flat", () => {
    expect(resolveLook(prefs({ preset: "starfall" }), [], "blue")).toEqual({ theme: "blue", style: "flat", stops: null });
    expect(resolveLook(prefs({ preset: "manual", manualStyle: "washShine", color1: "red", color2: "white" }), [], "blue")).toEqual({ theme: "red", style: "flat", stops: null });
  });
});

describe("Manual Cyan + Purple with Wash plus shine IS Starfall", () => {
  function tokens(look: ReturnType<typeof resolveLook>) {
    const props = new Map<string, string>();
    const root = { dataset: {} as Record<string, string>, style: { setProperty: (k: string, v: string) => props.set(k, v), removeProperty: (k: string) => props.delete(k) } };
    (globalThis as { document?: unknown }).document = { documentElement: root };
    applyLook(look);
    delete (globalThis as { document?: unknown }).document;
    return { dataset: root.dataset, props: Object.fromEntries(props) };
  }
  it("renders identically: same theme, style and every token", () => {
    const starfall = resolveLook(prefs({ preset: "starfall" }), UNLOCKED, "red");
    const manual = resolveLook(prefs({ preset: "manual", manualStyle: "washShine", color1: "cyan", color2: "purple" }), UNLOCKED, "red");
    expect(manual).toEqual(starfall);
    expect(tokens(manual)).toEqual(tokens(starfall));
    expect(tokens(manual).props["--grad-end-rgb"]).toBe("160, 32, 240");
  });

  it("every color has a gradient stop; the accents (text, Flat) are unchanged", () => {
    for (const name of THEME_NAMES) expect(GRADIENT_STOPS[name]).toMatch(/^\d+, \d+, \d+$/);
    expect(stopRgb("purple")).toBe(VIOLET_RGB);
    expect(stopRgb("cyan")).toBe(themeRgb("cyan"));
    expect(themeRgb("purple")).toBe("166, 120, 249");
  });
});

describe("readability guards", () => {
  it("a very dark color never colors text: headings switch to a light gray", () => {
    expect(textStop("4, 4, 8")).toBe("200, 204, 212");
    expect(textStop(themeRgb("cyan"))).toBe(themeRgb("cyan"));
    expect(textStop(VIOLET_RGB, 0.55)).toBe(VIOLET_RGB);
  });
});

describe("device-side preferences", () => {
  it("default when nothing is stored; a staging Starfall choice still loads", () => {
    const data = installMemoryStorage();
    expect(loadLookPrefs("purple")).toEqual({ preset: "default", manualStyle: "flat", color1: "purple", color2: "purple" });
    data.set("fleet_admiral_theme_preset", "starfall");
    expect(loadLookPrefs("cyan").preset).toBe("starfall");
  });

  it("remembers the preset and the manual picks, and ignores garbage", () => {
    const data = installMemoryStorage();
    expect(hasManualPrefs()).toBe(false);
    savePreset("manual");
    saveManual({ manualStyle: "washShine", color1: "green", color2: "white" });
    expect(hasManualPrefs()).toBe(true);
    expect(loadLookPrefs("cyan")).toEqual({ preset: "manual", manualStyle: "washShine", color1: "green", color2: "white" });
    data.set("fleet_admiral_theme_manual", "{nope");
    data.set("fleet_admiral_theme_preset", "bogus");
    expect(loadLookPrefs("red")).toEqual({ preset: "default", manualStyle: "flat", color1: "red", color2: "purple" });
  });

  it("blocked storage falls back to Default", () => {
    installBlockedStorage();
    expect(loadLookPrefs("gray").preset).toBe("default");
    expect(() => savePreset("starfall")).not.toThrow();
  });
});

describe("applyLook is the one writer to the root", () => {
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

  it("writes the theme, the style and the stop tokens; Flat removes the style and tokens", () => {
    const { root, props } = fakeRoot();
    applyLook({ theme: "cyan", style: "washShine", stops: ["103, 232, 249", "160, 32, 240"] });
    expect(root.dataset.theme).toBe("cyan");
    expect(root.dataset.style).toBe("washShine");
    expect(props.get("--grad-start-rgb")).toBe("103, 232, 249");
    expect(props.get("--grad-end-rgb")).toBe("160, 32, 240");
    expect(props.get("--grad-end-text-rgb")).toBe("160, 32, 240");
    applyLook({ theme: "red", style: "flat", stops: null });
    expect(root.dataset.theme).toBe("red");
    expect(root.dataset.style).toBeUndefined();
    expect(props.size).toBe(0);
  });
});
