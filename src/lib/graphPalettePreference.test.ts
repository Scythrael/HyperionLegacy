import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { get } from "svelte/store";
import { applyAccessibility, COLORBLIND_PALETTES } from "./accessibilityPreference";
import {
  COLORBLIND_STEP_LOW_BELOW,
  COLORBLIND_STEP_FULL_ABOVE,
  colorblindStep,
  effectiveGraphPaletteStore,
  resolveGraphPalette,
  GRAPH_PALETTE_IDS,
  graphPalette,
  graphPaletteStore,
  graphUtilFill,
  loadGraphPalette,
  saveGraphPalette,
  setGraphPalette,
  utilBaseRgb,
  OKABE_ITO_LOW,
  OKABE_ITO_MID,
  OKABE_ITO_FULL,
  MONO_LOW,
  MONO_FULL,
} from "./graphPalettePreference";

const KEY = "fleet_admiral_graph_palette_complement";

// WCAG relative luminance and contrast ratio, for the graph-on-panel checks below.
function lum([r, g, b]: [number, number, number]): number {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function hex(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

describe("graphPalettePreference: storage", () => {
  // vitest runs under node (no jsdom): a minimal in-memory shim, mirroring currencyDisplayPreference.test.ts.
  let restore: (() => void) | null = null;
  let throwing = false;
  beforeAll(() => {
    const store = new Map<string, string>();
    const had = "localStorage" in globalThis;
    const previous = (globalThis as any).localStorage;
    (globalThis as any).localStorage = {
      getItem: (k: string): string | null => {
        if (throwing) throw new Error("SecurityError");
        return store.has(k) ? store.get(k)! : null;
      },
      setItem: (k: string, v: string): void => {
        if (throwing) throw new Error("QuotaExceededError");
        store.set(k, String(v));
      },
      removeItem: (k: string): void => void store.delete(k),
      clear: (): void => store.clear(),
    };
    restore = () => {
      if (had) (globalThis as any).localStorage = previous;
      else delete (globalThis as any).localStorage;
    };
  });
  afterAll(() => {
    restore?.();
    restore = null;
  });
  beforeEach(() => {
    throwing = false;
    localStorage.clear();
  });

  it("defaults to Default when never set", () => {
    expect(loadGraphPalette("complement")).toBe("default");
  });

  it("round-trips every preset", () => {
    for (const id of GRAPH_PALETTE_IDS) {
      saveGraphPalette("complement", id);
      expect(localStorage.getItem(KEY)).toBe(id);
      expect(loadGraphPalette("complement")).toBe(id);
    }
  });

  it("falls back to Default on a junk value", () => {
    localStorage.setItem(KEY, "rainbow");
    expect(loadGraphPalette("complement")).toBe("default");
    localStorage.setItem(KEY, "");
    expect(loadGraphPalette("complement")).toBe("default");
  });

  it("falls back to Default when storage throws, and a save does not throw", () => {
    saveGraphPalette("complement", "mono");
    throwing = true;
    expect(loadGraphPalette("complement")).toBe("default");
    expect(() => saveGraphPalette("complement", "colorblind")).not.toThrow();
    expect(() => setGraphPalette("complement", "colorblind")).not.toThrow();
  });

  it("setGraphPalette persists and publishes; an unknown id changes nothing", () => {
    const live = graphPaletteStore("complement");
    setGraphPalette("complement", "mono");
    expect(get(live)).toBe("mono");
    expect(loadGraphPalette("complement")).toBe("mono");
    setGraphPalette("complement", "nonsense");
    expect(get(live)).toBe("mono");
    expect(loadGraphPalette("complement")).toBe("mono");
    setGraphPalette("complement", "default");
    expect(get(live)).toBe("default");
  });
});

describe("graphPalettePreference: palette mapping", () => {
  it("Default is byte-identical to the pre-CP-20 ComplementPanel strings", () => {
    const pre = (pct: number) => {
      const h = Math.max(0, Math.min(1, pct)) * 120;
      return `linear-gradient(180deg, hsl(${h}, 80%, 62%), hsla(${h}, 72%, 42%, 0.4))`;
    };
    for (const pct of [-1, 0, 0.1, 1 / 3, 0.5, 0.6, 0.999, 1, 2]) expect(graphUtilFill("default", pct)).toBe(pre(pct));
    expect(graphUtilFill("default", 0.5)).toBe("linear-gradient(180deg, hsl(60, 80%, 62%), hsla(60, 72%, 42%, 0.4))");
    const p = graphPalette("default");
    expect(p.cap).toBe("linear-gradient(180deg, #4c5666, #333b48)");
    expect(p.capUncapped).toBe("repeating-linear-gradient(180deg, #4a5568, #4a5568 3px, transparent 3px, transparent 5px)");
    expect(p.keyCap).toBe("linear-gradient(180deg, #4c5666, #333b48)");
    expect(p.keyUtil).toBe("linear-gradient(90deg, hsl(0, 80%, 55%), hsl(60, 80%, 55%), hsl(120, 60%, 45%))");
  });

  it("Color-blind safe is three fixed Okabe-Ito steps: orange below 1/3, amber 1/3 to 2/3 inclusive, green above", () => {
    expect(COLORBLIND_STEP_LOW_BELOW).toBe(1 / 3);
    expect(COLORBLIND_STEP_FULL_ABOVE).toBe(2 / 3);
    // Below a third: orange (Okabe-Ito vermillion #d55e00). Clamped, so below 0 is orange too.
    for (const p of [-3, 0, 0.1, 0.25, 0.3333]) expect(utilBaseRgb("colorblind", p)).toEqual(hex(OKABE_ITO_LOW));
    // Exactly a third through exactly two thirds: amber (Okabe-Ito orange #e69f00).
    for (const p of [1 / 3, 0.34, 0.5, 0.6, 2 / 3]) expect(utilBaseRgb("colorblind", p)).toEqual(hex(OKABE_ITO_MID));
    // Above two thirds: bluish green #009e73. Clamped, so above 1 is green too.
    for (const p of [0.6667, 0.75, 0.999, 1, 9]) expect(utilBaseRgb("colorblind", p)).toEqual(hex(OKABE_ITO_FULL));
    // The panel's fill is current / cap; integer ratios equal to a third or two thirds land exactly on the boundary.
    expect(colorblindStep(2 / 6)).toBe(1);
    expect(colorblindStep(3 / 9)).toBe(1);
    expect(colorblindStep(4 / 6)).toBe(1);
    expect(colorblindStep(8 / 12)).toBe(1);
    expect(colorblindStep(1 / 4)).toBe(0);
    expect(colorblindStep(3 / 4)).toBe(2);
    expect(graphUtilFill("colorblind", 0)).toBe("linear-gradient(180deg, rgb(213, 94, 0), rgba(213, 94, 0, 0.45))");
    expect(graphUtilFill("colorblind", 0.5)).toBe("linear-gradient(180deg, rgb(230, 159, 0), rgba(230, 159, 0, 0.45))");
    expect(graphUtilFill("colorblind", 1)).toBe("linear-gradient(180deg, rgb(0, 158, 115), rgba(0, 158, 115, 0.45))");
  });

  it("Color-blind safe never blends: every fill fraction paints one of exactly three colors", () => {
    const seen = new Set<string>();
    for (let i = 0; i <= 600; i++) seen.add(utilBaseRgb("colorblind", i / 600).join(","));
    expect([...seen].sort()).toEqual([OKABE_ITO_LOW, OKABE_ITO_MID, OKABE_ITO_FULL].map((h) => hex(h).join(",")).sort());
    // The key swatch shows the same three hard bands, a third each.
    expect(graphPalette("colorblind").keyUtil).toBe(
      "linear-gradient(90deg, #d55e00 0%, #d55e00 33.33%, #e69f00 33.33%, #e69f00 66.67%, #009e73 66.67%, #009e73 100%)",
    );
  });

  it("Monochrome has no hue and gets lighter as the rank fills", () => {
    let prev = -1;
    for (let i = 0; i <= 10; i++) {
      const [r, g, b] = utilBaseRgb("mono", i / 10);
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(12); // gray, not a hue
      const l = lum([r, g, b]);
      expect(l).toBeGreaterThan(prev);
      prev = l;
    }
    expect(utilBaseRgb("mono", 0)).toEqual(hex(MONO_LOW));
    expect(utilBaseRgb("mono", 1)).toEqual(hex(MONO_FULL));
    // The cap is a hatch, so cap and fill differ by pattern, not only lightness.
    expect(graphPalette("mono").cap).toContain("repeating-linear-gradient(135deg");
  });

  it("an unknown id paints as Default", () => {
    expect(graphPalette("rainbow" as never)).toEqual(graphPalette("default"));
  });

  it("every Color-blind and Monochrome fill clears 3:1 against all three dark panel surfaces", () => {
    // The game's surfaces are all dark: the deep background and the resolved panel tint.
    const surfaces: [number, number, number][] = [hex("#060a12"), hex("#0a141e"), hex("#0a1120")];
    for (const id of ["colorblind", "mono"] as const) {
      for (let i = 0; i <= 20; i++) {
        const c = utilBaseRgb(id, i / 20);
        for (const s of surfaces) expect(contrast(c, s)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("graphPalettePreference: Default follows the global Color-blind palette toggle", () => {
  it("resolveGraphPalette: Monochrome if chosen, else Color-blind safe if chosen or the toggle is on, else Default", () => {
    expect(resolveGraphPalette("default", "off")).toBe("default");
    expect(resolveGraphPalette("default", "cbsafe")).toBe("colorblind");
    expect(resolveGraphPalette("colorblind", "off")).toBe("colorblind");
    expect(resolveGraphPalette("colorblind", "cbsafe")).toBe("colorblind");
    expect(resolveGraphPalette("mono", "off")).toBe("mono");
    expect(resolveGraphPalette("mono", "cbsafe")).toBe("mono");
    // Every combination resolves to a known preset.
    for (const chosen of GRAPH_PALETTE_IDS)
      for (const cb of COLORBLIND_PALETTES) expect(GRAPH_PALETTE_IDS).toContain(resolveGraphPalette(chosen, cb));
  });

  it("Default with the toggle off still paints byte-identical to pre-CP-20", () => {
    const resolved = resolveGraphPalette("default", "off");
    expect(graphUtilFill(resolved, 0.5)).toBe("linear-gradient(180deg, hsl(60, 80%, 62%), hsla(60, 72%, 42%, 0.4))");
    expect(graphPalette(resolved).keyUtil).toBe("linear-gradient(90deg, hsl(0, 80%, 55%), hsl(60, 80%, 55%), hsl(120, 60%, 45%))");
  });

  it("the effective store repaints live when either the preset or the toggle changes", () => {
    const off = { uiScale: 1, highContrast: false, dyslexiaFont: false, reducedMotion: false, colorBlindPalette: "off" as const };
    const on = { ...off, colorBlindPalette: "cbsafe" as const };
    const seen: string[] = [];
    const unsub = effectiveGraphPaletteStore("complement").subscribe((v) => seen.push(v));
    try {
      setGraphPalette("complement", "default");
      applyAccessibility(off);
      expect(seen.at(-1)).toBe("default");
      applyAccessibility(on); // the toggle turns on: Default follows it
      expect(seen.at(-1)).toBe("colorblind");
      setGraphPalette("complement", "mono"); // Monochrome overrides the toggle
      expect(seen.at(-1)).toBe("mono");
      setGraphPalette("complement", "default");
      expect(seen.at(-1)).toBe("colorblind");
      applyAccessibility(off); // the toggle turns off: back to Default
      expect(seen.at(-1)).toBe("default");
      setGraphPalette("complement", "colorblind"); // chosen directly, independent of the toggle
      expect(seen.at(-1)).toBe("colorblind");
    } finally {
      unsub();
      setGraphPalette("complement", "default");
      applyAccessibility(off);
    }
  });

  it("ComplementPanel.svelte draws from the resolved store, not the raw preset", () => {
    const src = readFileSync(new URL("./ComplementPanel.svelte", import.meta.url), "utf8");
    expect(src).toMatch(/import\s*\{[^}]*effectiveGraphPaletteStore[^}]*\}\s*from\s*"\.\/graphPalettePreference"/);
    expect(src).toContain('effectiveGraphPaletteStore("complement")');
    expect(src).toContain("graphUtilFill($complementPaletteId");
    expect(src).toContain("graphPalette($complementPaletteId)");
    expect(src).not.toContain('graphPaletteStore("complement")');
  });
});
