import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
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

  it("Color-blind safe hits the Okabe-Ito stops at 0%, 50% and 100%, clamped outside", () => {
    expect(utilBaseRgb("colorblind", 0)).toEqual(hex(OKABE_ITO_LOW));
    expect(utilBaseRgb("colorblind", 0.5)).toEqual(hex(OKABE_ITO_MID));
    expect(utilBaseRgb("colorblind", 1)).toEqual(hex(OKABE_ITO_FULL));
    expect(utilBaseRgb("colorblind", -3)).toEqual(hex(OKABE_ITO_LOW));
    expect(utilBaseRgb("colorblind", 9)).toEqual(hex(OKABE_ITO_FULL));
    expect(graphUtilFill("colorblind", 0)).toBe("linear-gradient(180deg, rgb(213, 94, 0), rgba(213, 94, 0, 0.45))");
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

  it("every Color-blind and Monochrome fill clears 3:1 against the darkest and lightest panel surfaces", () => {
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
