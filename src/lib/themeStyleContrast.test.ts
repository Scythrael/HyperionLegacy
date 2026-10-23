// themeStyleContrast.test.ts: every look stays readable (0.13.11.1, plan Review Focus 5). Same method
// as contrast.test.ts: THE CSS IS THE SOURCE OF TRUTH, so every alpha, lift and label is parsed out of
// src/app.css, and every theme's colors out of its [data-theme] block, so a new theme is swept too.
// The washes always run at full strength (the guards may only touch text), so this sweeps every
// Color 1 x Color 2 pair of gradient stops (themeStyle.ts) at the full mockup D alphas.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { STARFALL, GRADIENT_STOPS, themeRgb, stopRgb, textStop, HEADING_END_SHARE } from "./themeStyle";
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
const hex = (h: string): RGB => [0, 2, 4].map((i) => parseInt(h.trim().replace("#", "").slice(i, i + 2), 16)) as RGB;
const triplet = (s: string): RGB => s.split(",").map((x) => Number(x.trim())) as RGB;
const over = (fg: RGB, a: number, bg: RGB): RGB => fg.map((v, i) => v * a + bg[i] * (1 - a)) as RGB;
const mixWhite = (c: RGB, share: number) => c.map((v) => v * share + 255 * (1 - share)) as RGB;

function block(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return CSS.slice(at, CSS.indexOf("}", at));
}
const optional = (b: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(b)?.[1];
const token = (b: string, name: string) => {
  const v = optional(b, name);
  expect(v, name).toBeDefined();
  return v!;
};
// A wash token's alphas: start stop, end stop, and any black shade under it.
function wash(name: string): { start: number; end: number; shade: number } {
  const v = token(block(':root[data-style="washShine"]'), name);
  const start = Number(/rgba\(var\(--grad-start-rgb\),\s*([\d.]+)\)/.exec(v)![1]);
  const end = Number(/rgba\(var\(--grad-end-rgb\),\s*([\d.]+)\)/.exec(v)![1]);
  const shade = /rgba\(0, 0, 0, ([\d.]+)\)/.exec(v);
  return { start, end, shade: shade ? Number(shade[1]) : 0 };
}

const ROOT = block(":root");
const HEAD_MIX = Number(/color-mix\(in srgb, rgb\(var\(--grad-end-text-rgb\)\) (\d+)%, #ffffff\)/.exec(CSS)![1]) / 100;
const DEEP = hex(token(ROOT, "--color-bg-deep"));
const MID = hex(token(ROOT, "--color-bg-mid"));
const PRIMARY = hex(token(ROOT, "--color-text-primary"));
const CB = block(':root[data-palette="cbsafe"]');
const CB_LIFT = block(':root[data-style="washShine"][data-palette="cbsafe"]');
const flatSemantic = {
  default: { success: hex(token(ROOT, "--color-success")), warning: hex(token(ROOT, "--color-warning")), danger: hex(token(ROOT, "--color-danger")) },
  cbsafe: { success: hex(token(CB, "--color-success")), warning: hex(token(CB, "--color-warning")), danger: hex(token(CB, "--color-danger")) },
};
const styledSemantic = {
  default: flatSemantic.default,
  cbsafe: {
    success: hex(optional(CB_LIFT, "--color-success") ?? token(CB, "--color-success")),
    warning: hex(optional(CB_LIFT, "--color-warning") ?? token(CB, "--color-warning")),
    danger: hex(optional(CB_LIFT, "--color-danger") ?? token(CB, "--color-danger")),
  },
};
function styled(theme: string, name: string, fallback: string, hcExcluded: boolean): string {
  const sel = `:root[data-style="washShine"][data-theme="${theme}"]${hcExcluded ? ':not([data-high-contrast="on"])' : ""}`;
  const at = CSS.indexOf(`${sel} {`);
  if (at < 0) return fallback;
  return optional(CSS.slice(at, CSS.indexOf("}", at)), name) ?? fallback;
}
const THEMES = [...CSS.matchAll(/^\[data-theme="(\w+)"\] \{([^}]*)\}/gm)].map((m) => {
  const b = m[2];
  const pm = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(token(b, "--color-panel-bg"))!;
  const accentHex = token(b, "--color-accent");
  return {
    name: m[1] as ThemeName,
    accent: hex(accentHex),
    bright: hex(token(b, "--color-accent-bright")),
    panel: over([+pm[1], +pm[2], +pm[3]], +pm[4], DEEP),
    secondary: hex(token(b, "--color-text-secondary")),
    dimFlat: hex(token(b, "--color-text-dim")),
    dim: hex(styled(m[1], "--color-text-dim", token(b, "--color-text-dim"), true)),
    label: hex(styled(m[1], "--style-label", accentHex, false)),
  };
});

const panel = wash("--style-panel");
const dialog = wash("--style-dialog");
const control = wash("--style-control");
const primary = wash("--style-control-primary");

describe("the washes and where they apply", () => {
  it("parses every theme, every stop and the washes, so the sweeps are not vacuous", () => {
    expect(THEMES.length).toBe(10);
    for (const t of THEMES) expect(GRADIENT_STOPS[t.name]).toBeDefined();
    expect(triplet(STARFALL.stops[0])).toEqual(triplet(stopRgb("cyan")));
    expect(triplet(STARFALL.stops[1])).toEqual([160, 32, 240]);
  });

  it("uses the approved mockup D washes at full strength, with no dark layer and no weakening", () => {
    const mock = readFileSync("docs/plans/2026-10-23-gradient-theme-mockup.html", "utf-8");
    const d = (sel: string) => {
      const m = new RegExp(`${sel.replace(/[.]/g, "\\.")}[^{]*\\{ background: linear-gradient\\(135deg, rgba\\(var\\(--accent-rgb\\), ([.\\d]+)\\), rgba\\(var\\(--violet-rgb\\), ([.\\d]+)\\)\\)`).exec(mock)!;
      return { start: Number(m[1]), end: Number(m[2]) };
    };
    expect(d(".vD .panel")).toEqual({ start: panel.start, end: panel.end });
    expect(d(".vD .btn")).toEqual({ start: control.start, end: control.end });
    expect(d(".vD .btn.p")).toEqual({ start: primary.start, end: primary.end });
    for (const w of [panel, dialog, control, primary]) expect(w.shade).toBe(0);
    expect(CSS).not.toMatch(/--grad-(start|end)-k/);
  });

  it("danger buttons keep today's flat look, and High contrast keeps its own text and borders", () => {
    const rules = CSS.slice(CSS.indexOf("3. WHERE washShine applies"), CSS.indexOf("/* REDUCED MOTION"));
    for (const m of rules.matchAll(/:is\(\.(dev|buy)-btn[^{]*\{/g)) expect(m[0]).toContain(":not(.danger)");
    const border = /([^\n]*)\{\s*border-color: var\(--style-edge\);/.exec(rules)!;
    expect(border[1]).toContain(':not([data-high-contrast="on"])');
    for (const m of CSS.matchAll(/:root\[data-style="washShine"\]\[data-theme="\w+"\][^{]*\{ --color-text-dim/g)) expect(m[0]).toContain(':not([data-high-contrast="on"])');
  });
});

describe("every Color 1 x Color 2 pair on Wash plus shine, at AA in both palettes", () => {
  for (const palette of ["default", "cbsafe"] as const) {
    it(`all ${THEMES.length * THEMES.length} pairs, Starfall (Cyan + Purple) among them (${palette} palette)`, () => {
      const fails: string[] = [];
      for (const t of THEMES) {
        const s1 = triplet(stopRgb(t.name));
        expect(triplet(themeRgb(t.name))).toEqual(t.accent); // Color 1's accent is this theme's
        for (const t2 of THEMES) {
          const s2 = triplet(stopRgb(t2.name));
          const headStart = triplet(textStop(themeRgb(t.name)));
          const headEnd = mixWhite(triplet(textStop(stopRgb(t2.name), HEADING_END_SHARE)), HEAD_MIX);
          const texts: Record<string, RGB> = { primary: PRIMARY, secondary: t.secondary, dim: t.dim, accent: t.accent, bright: t.bright, headStart, headEnd, ...styledSemantic[palette] };
          const ps = over(s1, panel.start, t.panel);
          const pe = over(s2, panel.end, t.panel);
          const surfaces: [string, RGB, Record<string, RGB>][] = [
            ["panel start", ps, texts],
            ["panel end", pe, texts],
            ["window start", over(s1, dialog.start, MID), texts],
            ["window end", over(s2, dialog.end, MID), texts],
            ["button start", over(s1, control.start, ps), { label: t.label }],
            ["button end", over(s2, control.end, pe), { label: t.label }],
            ["primary start", over(s1, primary.start, ps), { primary: PRIMARY }],
            ["primary end", over(s2, primary.end, pe), { primary: PRIMARY }],
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
  }
});

describe("Flat (Default and Manual Flat) is today's look, at AA on each theme's own panel", () => {
  for (const palette of ["default", "cbsafe"] as const) {
    it(`every text color, every theme (${palette} palette)`, () => {
      const fails: string[] = [];
      for (const t of THEMES) {
        const texts: Record<string, RGB> = { primary: PRIMARY, secondary: t.secondary, dim: t.dimFlat, accent: t.accent, bright: t.bright, ...flatSemantic[palette] };
        for (const [name, fg] of Object.entries(texts)) if (ratio(fg, t.panel) < AA) fails.push(`${t.name} ${name} ${ratio(fg, t.panel).toFixed(3)}`);
      }
      expect(fails).toEqual([]);
    });
  }
});
