// backgroundStyle.test.ts: 0.14.0 Slice 5b, the background visualization track (signed-off mockup v2,
// docs/plans/2026-10-29-background-settings-mockup.html). Settings state, locked hints, unlock wiring from
// the milestone reward hook, colors that follow the theme, and reduced-motion Still.
import { describe, it, expect, afterEach } from "vitest";
import {
  BACKGROUNDS,
  FTL_DEFAULTS,
  DEFAULT_BACKGROUND_PREFS,
  LOCKED_HINT,
  LOCKED_OPTION,
  WHITE_STREAK,
  availableBackgroundPresets,
  availableBackgrounds,
  lockedBackgroundCount,
  backgroundUnlocked,
  resolveBackground,
  shownBackgroundPreset,
  effectiveStill,
  backgroundsFromMilestones,
  streakPalette,
  paletteAt,
  sanitizeFtl,
  loadBackgroundPrefs,
  saveBackgroundPreset,
  saveBackgroundManual,
  applyBackground,
  type BackgroundPrefs,
} from "./backgroundStyle";
import { resolveLook, DEFAULT_LOOK_PREFS, STARFALL, GRADIENT_STOPS } from "./themeStyle";
import { MILESTONES } from "./secret/config";
import { doCaptain, doFleet, doPrestigeception } from "./secret/engine";
import { pastStarfallState } from "./secret/testStates";
import { installMemoryStorage, installBlockedStorage, restoreStorage } from "./secret/testStorage";

afterEach(() => restoreStorage());

const prefs = (p: Partial<BackgroundPrefs>): BackgroundPrefs => ({ ...DEFAULT_BACKGROUND_PREFS, ...p });
const FTL = ["fasterThanLight"];

describe("backgrounds are data", () => {
  it("Default is everyone's; Faster Than Light is its own unlock", () => {
    expect(BACKGROUNDS.map((b) => [b.id, b.label, b.unlock])).toEqual([
      ["default", "Default", null],
      ["fasterThanLight", "Faster Than Light", "fasterThanLight"],
    ]);
    expect(backgroundUnlocked("default", [])).toBe(true);
    expect(backgroundUnlocked("fasterThanLight", [])).toBe(false);
    expect(backgroundUnlocked("fasterThanLight", FTL)).toBe(true);
    // a theme style unlock never unlocks a background (the prizes are kept separate)
    expect(backgroundUnlocked("fasterThanLight", ["washShine"])).toBe(false);
  });

  it("each unlocked background brings a preset; Manual offers Default plus the unlocked ones", () => {
    expect(availableBackgroundPresets([])).toEqual([]);
    expect(availableBackgroundPresets(FTL).map((b) => b.id)).toEqual(["fasterThanLight"]);
    expect(availableBackgrounds([]).map((b) => b.id)).toEqual(["default"]);
    expect(availableBackgrounds(FTL).map((b) => b.id)).toEqual(["default", "fasterThanLight"]);
  });

  it("the mockup's defaults: sliders 6 / 6 / 5 / 6, theme colors on, Jump on, not Still", () => {
    expect(FTL_DEFAULTS).toEqual({ speed: 6, streakLength: 6, stars: 5, brightness: 6, ignoreThemeColors: false, jumpOnStart: true, still: false });
    expect(DEFAULT_BACKGROUND_PREFS.preset).toBe("default");
  });
});

describe("locked entries hint at their source, never at the prize", () => {
  it("one generic locked entry per locked background, none once unlocked", () => {
    expect(lockedBackgroundCount([])).toBe(1);
    expect(lockedBackgroundCount(FTL)).toBe(0);
    expect(LOCKED_HINT).toBe("Unlocked by completing an achievement");
    expect(LOCKED_OPTION).toBe("Locked: unlocked by completing an achievement");
  });

  it("the hint names no background, milestone or number", () => {
    for (const text of [LOCKED_HINT, LOCKED_OPTION]) {
      expect(text).not.toMatch(/Faster|Light|warp|e25|25,000,000|\d/i);
      expect(text.includes(String.fromCharCode(0x2013)) || text.includes(String.fromCharCode(0x2014))).toBe(false);
    }
  });
});

describe("resolveBackground: what actually plays", () => {
  it("Default plays today's background whatever is unlocked", () => {
    expect(resolveBackground(prefs({ preset: "default" }), []).id).toBe("default");
    expect(resolveBackground(prefs({ preset: "default" }), FTL).id).toBe("default");
  });

  it("the Faster Than Light preset plays the defaults (theme colors, never white) once unlocked", () => {
    const manual = { ...FTL_DEFAULTS, speed: 2, ignoreThemeColors: true };
    const r = resolveBackground(prefs({ preset: "fasterThanLight", ftl: manual }), FTL);
    expect(r.id).toBe("fasterThanLight");
    expect(r.ftl).toEqual(FTL_DEFAULTS);
    expect(r.ftl.ignoreThemeColors).toBe(false);
  });

  it("a preset or Manual pick whose unlock is gone (Delete Save) plays, and shows, Default", () => {
    expect(resolveBackground(prefs({ preset: "fasterThanLight" }), []).id).toBe("default");
    expect(shownBackgroundPreset(prefs({ preset: "fasterThanLight" }), [])).toBe("default");
    expect(shownBackgroundPreset(prefs({ preset: "fasterThanLight" }), FTL)).toBe("fasterThanLight");
    expect(resolveBackground(prefs({ preset: "manual", manualBackground: "fasterThanLight" }), []).id).toBe("default");
    expect(shownBackgroundPreset(prefs({ preset: "manual" }), [])).toBe("manual");
  });

  it("Manual plays the picked background with the player's own settings", () => {
    const mine = { ...FTL_DEFAULTS, speed: 10, stars: 1, ignoreThemeColors: true, still: true };
    const r = resolveBackground(prefs({ preset: "manual", manualBackground: "fasterThanLight", ftl: mine }), FTL);
    expect(r).toEqual({ id: "fasterThanLight", ftl: mine });
    expect(resolveBackground(prefs({ preset: "manual", manualBackground: "default", ftl: mine }), FTL).id).toBe("default");
  });
});

describe("Still: automatic with reduced motion", () => {
  it("reduced motion forces Still whatever the switch says; otherwise the switch decides", () => {
    expect(effectiveStill(FTL_DEFAULTS, true)).toBe(true);
    expect(effectiveStill({ ...FTL_DEFAULTS, still: false }, true)).toBe(true);
    expect(effectiveStill(FTL_DEFAULTS, false)).toBe(false);
    expect(effectiveStill({ ...FTL_DEFAULTS, still: true }, false)).toBe(true);
  });
});

describe("the unlock: the e25,000,000 milestone's reward hook", () => {
  const hookId = MILESTONES.find((m) => m.rewardHook === "fasterThanLight")!.id;

  it("the hook sits on the secret e25,000,000 milestone and only it", () => {
    expect(hookId).toBe("e25m");
    expect(MILESTONES.filter((m) => m.rewardHook !== undefined).map((m) => m.id)).toEqual(["e25m"]);
  });

  it("reaching it awards Faster Than Light; nothing else does", () => {
    expect(backgroundsFromMilestones({})).toEqual([]);
    expect(backgroundsFromMilestones({ starfall: 1, e20m: 2, finale: 3 })).toEqual([]);
    expect(backgroundsFromMilestones({ e25m: 4 })).toEqual(["fasterThanLight"]);
  });

  it("survives every minigame prestige (the milestone stays reached through Captain, Fleet and Prestigeception)", () => {
    const s = pastStarfallState();
    s.milestones.e25m = 1;
    let fired = 0;
    for (const reset of [doCaptain, doFleet, doPrestigeception]) {
      const next = reset(s, s.lastTickAt + 1000);
      if (next !== s) fired += 1;
      expect(next.milestones.e25m).toBe(1);
      expect(backgroundsFromMilestones(next.milestones)).toEqual(["fasterThanLight"]);
    }
    expect(fired).toBeGreaterThan(0);
  });
});

describe("streak colors follow the theme", () => {
  it("one color: the Flat accent", () => {
    const look = resolveLook({ ...DEFAULT_LOOK_PREFS, preset: "default" }, [], "pink");
    expect(streakPalette(look, false)).toEqual([[249, 120, 196]]);
  });

  it("a gradient style: its two stops (Starfall: cyan into purple), washed along the streaks", () => {
    const look = resolveLook({ ...DEFAULT_LOOK_PREFS, preset: "starfall" }, ["washShine"], "red");
    expect(look.stops).toEqual(STARFALL.stops);
    const p = streakPalette(look, false);
    expect(p).toEqual([[103, 232, 249], [160, 32, 240]]);
    expect(paletteAt(p, 0)).toEqual([103, 232, 249]);
    expect(paletteAt(p, 1)).toEqual([160, 32, 240]);
    expect(paletteAt(p, 0.5)).toEqual([132, 132, 245]);
    const manual = resolveLook({ ...DEFAULT_LOOK_PREFS, preset: "manual", manualStyle: "washShine", color1: "green", color2: "red" }, ["washShine"], "cyan");
    expect(streakPalette(manual, false).map((c) => c.join(", "))).toEqual([GRADIENT_STOPS.green, GRADIENT_STOPS.red]);
  });

  it("three colors wipe across all three", () => {
    const p = [[0, 0, 0], [100, 100, 100], [200, 0, 0]] as const;
    expect(paletteAt(p, 0.25)).toEqual([50, 50, 50]);
    expect(paletteAt(p, 0.75)).toEqual([150, 50, 50]);
  });

  it("Ignore theme colors: classic white streaks whatever the look", () => {
    const look = resolveLook({ ...DEFAULT_LOOK_PREFS, preset: "starfall" }, ["washShine"], "red");
    expect(streakPalette(look, true)).toEqual([WHITE_STREAK]);
  });
});

describe("device-side preferences", () => {
  it("nothing stored (every device before 0.14.0): Default, and the mockup's defaults", () => {
    installMemoryStorage();
    expect(loadBackgroundPrefs()).toEqual(DEFAULT_BACKGROUND_PREFS);
  });

  it("the preset, the Manual pick and every setting round-trip", () => {
    installMemoryStorage();
    const mine = { speed: 9, streakLength: 2, stars: 10, brightness: 3, ignoreThemeColors: true, jumpOnStart: false, still: true };
    saveBackgroundPreset("manual");
    saveBackgroundManual({ manualBackground: "fasterThanLight", ftl: mine });
    expect(loadBackgroundPrefs()).toEqual({ preset: "manual", manualBackground: "fasterThanLight", ftl: mine });
    saveBackgroundPreset("fasterThanLight");
    expect(loadBackgroundPrefs().preset).toBe("fasterThanLight");
  });

  it("damaged or unknown values take their defaults, sliders clamp to 1 to 10", () => {
    const store = installMemoryStorage();
    store.set("fleet_admiral_background_preset", "hyperdrive");
    store.set("fleet_admiral_background_manual", "{not json");
    expect(loadBackgroundPrefs()).toEqual(DEFAULT_BACKGROUND_PREFS);
    store.set("fleet_admiral_background_manual", JSON.stringify({ background: "plaid", settings: { fasterThanLight: { speed: 99, streakLength: -4, stars: "lots", brightness: 4.6, ignoreThemeColors: "yes", still: 1 } } }));
    expect(loadBackgroundPrefs()).toEqual({ ...DEFAULT_BACKGROUND_PREFS, ftl: { ...FTL_DEFAULTS, speed: 10, streakLength: 1, brightness: 5 } });
    expect(sanitizeFtl(null)).toEqual(FTL_DEFAULTS);
  });

  it("blocked storage never throws and plays Default", () => {
    installBlockedStorage();
    expect(() => saveBackgroundPreset("fasterThanLight")).not.toThrow();
    expect(loadBackgroundPrefs()).toEqual(DEFAULT_BACKGROUND_PREFS);
  });
});

describe("applyBackground is the one writer to the root", () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it("Default writes nothing (today's look untouched); a visualization sets data-background", () => {
    const root = { dataset: {} as Record<string, string> };
    (globalThis as { document?: unknown }).document = { documentElement: root };
    applyBackground("default");
    expect("background" in root.dataset).toBe(false);
    applyBackground("fasterThanLight");
    expect(root.dataset.background).toBe("fasterThanLight");
    applyBackground("default");
    expect("background" in root.dataset).toBe(false);
  });
});
