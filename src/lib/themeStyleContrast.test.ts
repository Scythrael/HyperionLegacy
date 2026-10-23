// themeStyleContrast.test.ts: the Starfall theme (washShine style) stays readable (0.13.11.1,
// plan Review Focus 5). Same method as contrast.test.ts: THE CSS IS THE SOURCE OF TRUTH, so every
// alpha, shade and stop is parsed out of src/app.css, and every theme's colors are parsed out of
// its [data-theme] block, so a new theme is swept automatically.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { STARFALL } from "./themeStyle";

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
  const start = Number(/rgba\(var\(--grad-start-rgb\),\s*([\d.]+)\)/.exec(v)![1]);
  const end = Number(/rgba\(var\(--grad-end-rgb\),\s*([\d.]+)\)/.exec(v)![1]);
  const shade = /rgba\(0, 0, 0, ([\d.]+)\)/.exec(v);
  return { start, end, shade: shade ? Number(shade[1]) : 0 };
}

const ROOT = block(":root");
const PURPLE = triplet(/--grad-end-rgb:\s*([^;]+);/.exec(CSS)![1]);
const HEAD_MIX = Number(/color-mix\(in srgb, rgb\(var\(--grad-end-rgb\)\) (\d+)%, #ffffff\)/.exec(CSS)![1]) / 100;
const DEEP = hex(token(ROOT, "--color-bg-deep"));
const MID = hex(token(ROOT, "--color-bg-mid"));
const PRIMARY = hex(token(ROOT, "--color-text-primary"));
const SEMANTIC = {
  default: { success: hex(token(ROOT, "--color-success")), warning: hex(token(ROOT, "--color-warning")), danger: hex(token(ROOT, "--color-danger")) },
  cbsafe: (() => {
    const b = block(':root[data-palette="cbsafe"]');
    return { success: hex(token(b, "--color-success")), warning: hex(token(b, "--color-warning")), danger: hex(token(b, "--color-danger")) };
  })(),
};
const THEMES = [...CSS.matchAll(/\[data-theme="(\w+)"\] \{([^}]*)\}/g)].map((m) => {
  const b = m[2];
  const pm = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(token(b, "--color-panel-bg"))!;
  return {
    name: m[1],
    accent: hex(token(b, "--color-accent")),
    bright: hex(token(b, "--color-accent-bright")),
    panel: over([+pm[1], +pm[2], +pm[3]], +pm[4], DEEP),
    secondary: hex(token(b, "--color-text-secondary")),
    dim: hex(token(b, "--color-text-dim")),
  };
});

describe("Starfall (washShine) reads at AA on every theme, with and without the color-blind palette", () => {
  it("parses every theme, the stops and the washes, so the sweep is not vacuous", () => {
    expect(THEMES.length).toBe(10);
    expect(PURPLE).toEqual(triplet((STARFALL.stops[1] as { rgb: string }).rgb));
    expect(STARFALL.stops[0]).toBe("accent");
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
          // Danger labels (Delete Save, Reset) sit on buttons too. Today's flat button already
          // misses AA for some of them; the style must never make one worse than today.
          const today = over(t.accent, 0.08, t.panel);
          const danger = SEMANTIC[palette].danger;
          if (ratio(danger, bg) < Math.min(AA, ratio(danger, today)) - 1e-9) fails.push(`${t.name} danger on button ${stop} worse than today`);
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
});
