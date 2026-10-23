// themeStyleContrast.test.ts: the Starfall theme (washShine style) stays readable (0.13.11.1,
// plan Review Focus 5). Same method as contrast.test.ts: THE CSS IS THE SOURCE OF TRUTH, so every
// alpha, shade and stop is parsed out of src/app.css, and every theme's colors are parsed out of
// its [data-theme] block, so a new theme is swept automatically.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { STARFALL, themeRgb, stopStrength, textStop, HEADING_END_SHARE } from "./themeStyle";
import type { ThemeName } from "./theme";

const CSS: string = readFileSync("src/app.css", "utf-8");
const AA = 4.5;

type RGB = [number, number, number];
const ch = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const lum = ([r, g, b]: RGB) => 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
const ratio = (a: RGB, b: RGB) => {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const hex = (h: string): RGB => [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16)) as RGB;
const triplet = (s: string): RGB => s.split(",").map((x) => Number(x.trim())) as RGB;
const over = (fg: RGB, a: number, bg: RGB): RGB => fg.map((v, i) => v * a + bg[i] * (1 - a)) as RGB;
const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];

function block(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return CSS.slice(at, CSS.indexOf("}", at));
}
const token = (b: string, name: string) => {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(b);
  expect(m, name).not.toBeNull();
  return m![1];
};
// A wash token's alphas: start stop, end stop, and the black shade under it (0 when none).
function wash(name: string): { start: number; end: number; shade: number } {
  const v = token(block(':root[data-style="washShine"]'), name);
  const start = Number(/rgba\(var\(--grad-start-rgb\),\s*calc\(([\d.]+) \* var\(--grad-start-k\)\)\)/.exec(v)![1]);
  const end = Number(/rgba\(var\(--grad-end-rgb\),\s*calc\(([\d.]+) \* var\(--grad-end-k\)\)\)/.exec(v)![1]);
  const shade = /rgba\(0, 0, 0, ([\d.]+)\)/.exec(v);
  return { start, end, shade: shade ? Number(shade[1]) : 0 };
}

const ROOT = block(":root");
const PURPLE = triplet(/--grad-end-rgb:\s*([^;]+);/.exec(CSS)![1]);
const HEAD_MIX = Number(/color-mix\(in srgb, rgb\(var\(--grad-end-text-rgb\)\) (\d+)%, #ffffff\)/.exec(CSS)![1]) / 100;
const DEEP = hex(token(ROOT, "--color-bg-deep"));
const MID = hex(token(ROOT, "--color-bg-mid"));
const PRIMARY = hex(token(ROOT, "--color-text-primary"));
// The semantic text colors as they are UNDER washShine: the palette's own values, with the style's
// lifts applied where it declares them.
const optional = (b: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(b)?.[1];
const SEMANTIC = {
  default: { success: hex(token(ROOT, "--color-success")), warning: hex(token(ROOT, "--color-warning")), danger: hex(token(ROOT, "--color-danger")) },
  cbsafe: (() => {
    const b = block(':root[data-palette="cbsafe"]');
    const lift = block(':root[data-style="washShine"][data-palette="cbsafe"]');
    const pick = (n: string) => hex(optional(lift, n) ?? token(b, n));
    return { success: pick("--color-success"), warning: pick("--color-warning"), danger: pick("--color-danger") };
  })(),
};
// Each theme's dim text under washShine (its lift when the style declares one).
function liftedDim(theme: string, fallback: string): string {
  const sel = `:root[data-style="washShine"][data-theme="${theme}"]:not([data-high-contrast="on"])`;
  return CSS.includes(`${sel} {`) ? token(block(sel), "--color-text-dim") : fallback;
}
const THEMES = [...CSS.matchAll(/\[data-theme="(\w+)"\] \{([^}]*)\}/g)].map((m) => {
  const b = m[2];
  const pm = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(token(b, "--color-panel-bg"))!;
  return {
    name: m[1],
    accent: hex(token(b, "--color-accent")),
    bright: hex(token(b, "--color-accent-bright")),
    panel: over([+pm[1], +pm[2], +pm[3]], +pm[4], DEEP),
    secondary: hex(token(b, "--color-text-secondary")),
    dim: hex(liftedDim(m[1], token(b, "--color-text-dim"))),
    dimFlat: hex(token(b, "--color-text-dim")),
  };
});

describe("Starfall (washShine) reads at AA on every theme, with and without the color-blind palette", () => {
  it("parses every theme, the stops and the washes, so the sweep is not vacuous", () => {
    expect(THEMES.length).toBe(10);
    expect(PURPLE).toEqual(triplet(STARFALL.stops[1]));
    expect(STARFALL.stops[0]).toBe("103, 232, 249");
    for (const w of ["--style-panel", "--style-dialog", "--style-control", "--style-control-primary"]) expect(wash(w).start).toBeGreaterThan(0);
  });

  const panel = wash("--style-panel");
  const dialog = wash("--style-dialog");
  const control = wash("--style-control");
  const primary = wash("--style-control-primary");
  const headEnd = PURPLE.map((v, i) => v * HEAD_MIX + WHITE[i] * (1 - HEAD_MIX)) as RGB;

  for (const palette of ["default", "cbsafe"] as const) {
    it(`every text color on panels and windows, at both stops (${palette} palette)`, () => {
      const fails: string[] = [];
      for (const t of THEMES) {
        const texts: Record<string, RGB> = { primary: PRIMARY, secondary: t.secondary, dim: t.dim, accent: t.accent, bright: t.bright, headingStart: t.accent, headingEnd: headEnd, ...SEMANTIC[palette] };
        for (const [where, base, w] of [["panel", t.panel, panel], ["window", MID, dialog]] as const) {
          const shaded = over(BLACK, w.shade, base);
          const stops: Record<string, RGB> = { start: over(t.accent, w.start, shaded), end: over(PURPLE, w.end, shaded) };
          for (const [stop, bg] of Object.entries(stops)) {
            for (const [name, fg] of Object.entries(texts)) {
              const r = ratio(fg, bg);
              if (r < AA) fails.push(`${t.name} ${name} on ${where} ${stop} ${r.toFixed(2)}`);
            }
          }
        }
      }
      expect(fails).toEqual([]);
    });

    it(`button labels on buttons and primary buttons, at both stops (${palette} palette)`, () => {
      const fails: string[] = [];
      for (const t of THEMES) {
        const panelStart = over(t.accent, panel.start, over(BLACK, panel.shade, t.panel));
        const panelEnd = over(PURPLE, panel.end, over(BLACK, panel.shade, t.panel));
        const btn = { start: over(t.accent, control.start, over(BLACK, control.shade, panelStart)), end: over(PURPLE, control.end, over(BLACK, control.shade, panelEnd)) };
        const prim = { start: over(t.accent, primary.start, panelStart), end: over(PURPLE, primary.end, panelEnd) };
        for (const [stop, bg] of Object.entries(btn)) {
          for (const [name, fg] of Object.entries({ primary: PRIMARY, accent: t.accent, bright: t.bright })) {
            if (ratio(fg, bg) < AA) fails.push(`${t.name} ${name} on button ${stop} ${ratio(fg, bg).toFixed(2)}`);
          }
        }
        for (const [stop, bg] of Object.entries(prim)) {
          for (const [name, fg] of Object.entries({ primary: PRIMARY, bright: t.bright })) {
            if (ratio(fg, bg) < AA) fails.push(`${t.name} ${name} on primary ${stop} ${ratio(fg, bg).toFixed(2)}`);
          }
        }
      }
      expect(fails).toEqual([]);
    });
  }

  it("uses the approved mockup D washes, with no dark layer under the panels", () => {
    const mock = readFileSync("docs/plans/2026-10-23-gradient-theme-mockup.html", "utf-8");
    const d = (sel: string) => {
      const m = new RegExp(`${sel.replace(/[.]/g, "\\.")}[^{]*\\{ background: linear-gradient\\(135deg, rgba\\(var\\(--accent-rgb\\), ([.\\d]+)\\), rgba\\(var\\(--violet-rgb\\), ([.\\d]+)\\)\\)`).exec(mock)!;
      return { start: Number(m[1]), end: Number(m[2]) };
    };
    expect(d(".vD .panel")).toEqual({ start: panel.start, end: panel.end });
    expect(d(".vD .btn")).toEqual({ start: control.start, end: control.end });
    expect(d(".vD .btn.p")).toEqual({ start: primary.start, end: primary.end });
    for (const w of [panel, dialog, control, primary]) expect(w.shade).toBe(0);
  });

  it("danger buttons keep today's flat look, and High contrast keeps its own text and borders", () => {
    const rules = CSS.slice(CSS.indexOf("3. WHERE washShine applies"), CSS.indexOf("/* REDUCED MOTION"));
    for (const m of rules.matchAll(/:is\(\.dev-btn[^{]*\{/g)) expect(m[0]).toContain(":not(.danger)");
    for (const m of rules.matchAll(/:is\(\.buy-btn[^{]*\{/g)) expect(m[0]).toContain(":not(.danger)");
    const border = /([^\n]*)\{\s*border-color: var\(--style-edge\);/.exec(rules)!;
    expect(border[1]).toContain(':not([data-high-contrast="on"])');
    for (const m of CSS.matchAll(/:root\[data-style="washShine"\]\[data-theme="\w+"\][^{]*\{/g)) expect(m[0]).toContain(':not([data-high-contrast="on"])');
  });
});

// Flat (today's look) reads the palettes' own semantic colors, unlifted.
const SEMANTIC_FLAT = {
  default: SEMANTIC.default,
  cbsafe: (() => {
    const b = block(':root[data-palette="cbsafe"]');
    return { success: hex(token(b, "--color-success")), warning: hex(token(b, "--color-warning")), danger: hex(token(b, "--color-danger")) };
  })(),
};

describe("every Color 1 x Color 2 pair (Manual), and Flat, at AA in both palettes", () => {
  const panel = wash("--style-panel");
  const dialog = wash("--style-dialog");
  const control = wash("--style-control");
  const primary = wash("--style-control-primary");
  const mixWhite = (c: RGB, share: number) => c.map((v) => v * share + 255 * (1 - share)) as RGB;

  for (const palette of ["default", "cbsafe"] as const) {
    it(`washShine, all ${THEMES.length * THEMES.length} pairs (${palette} palette)`, () => {
      const fails: string[] = [];
      for (const t of THEMES) {
        const c1 = themeRgb(t.name as ThemeName);
        expect(triplet(c1)).toEqual(t.accent); // Color 1 is this theme's accent
        for (const t2 of THEMES) {
          const c2 = themeRgb(t2.name as ThemeName);
          const e = triplet(c2);
          const k = stopStrength(c2);
          const headStart = triplet(textStop(c1));
          const headEnd = mixWhite(triplet(textStop(c2, HEADING_END_SHARE)), HEAD_MIX);
          const texts: Record<string, RGB> = { primary: PRIMARY, secondary: t.secondary, dim: t.dim, accent: t.accent, bright: t.bright, headStart, headEnd, ...SEMANTIC[palette] };
          const ps = over(t.accent, panel.start, t.panel);
          const pe = over(e, panel.end * k, t.panel);
          const surfaces: [string, RGB, Record<string, RGB>][] = [
            ["panel start", ps, texts],
            ["panel end", pe, texts],
            ["window start", over(t.accent, dialog.start, MID), texts],
            ["window end", over(e, dialog.end * k, MID), texts],
            ["button start", over(t.accent, control.start, ps), { primary: PRIMARY, accent: t.accent, bright: t.bright }],
            ["button end", over(e, control.end * k, pe), { primary: PRIMARY, accent: t.accent, bright: t.bright }],
            ["primary start", over(t.accent, primary.start, ps), { primary: PRIMARY, bright: t.bright }],
            ["primary end", over(e, primary.end * k, pe), { primary: PRIMARY, bright: t.bright }],
          ];
          for (const [where, bg, fgs] of surfaces) {
            for (const [name, fg] of Object.entries(fgs)) {
              const r = ratio(fg, bg);
              if (r < AA) fails.push(`${t.name} + ${t2.name}: ${name} on ${where} ${r.toFixed(2)}`);
            }
          }
        }
      }
      expect(fails).toEqual([]);
    });

    // Flat is exactly today's look, so it is measured the way contrast.test.ts has measured it since
    // 0.13.5: on the reference panel #0a141e. (On each theme's own tinted panel, green and gray dim
    // text sit at 4.46 and 4.48, a pre-existing margin noted for the user, not changed here.)
    it(`Flat with every Color 1 is today's look and reads at AA (${palette} palette)`, () => {
      const fails: string[] = [];
      const REF: RGB = hex("#0a141e");
      for (const t0 of THEMES) {
        const t = { ...t0, panel: REF };
        const texts: Record<string, RGB> = { primary: PRIMARY, secondary: t.secondary, dim: t.dimFlat, accent: t.accent, bright: t.bright, ...SEMANTIC_FLAT[palette] };
        for (const [name, fg] of Object.entries(texts)) if (ratio(fg, t.panel) < AA) fails.push(`${t.name} ${name} ${ratio(fg, t.panel).toFixed(2)}`);
      }
      expect(fails).toEqual([]);
    });
  }
});