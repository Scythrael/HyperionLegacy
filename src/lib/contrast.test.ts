// ============================================================================
// CONTRAST GUARD
// 0.13.5 Phase 1 (the token layer). Design: 2026-09-11-presentation-0.13.5-design.md section 1.5.
//
// ⚠️ WHY THIS TEST EXISTS, AND WHY IT PARSES THE CSS RATHER THAN TESTING A FUNCTION.
//
// The accessibility pass found that --color-text-dim failed WCAG AA on EVERY ONE of the six
// themes (worst: blue at 3.39:1 against a 4.5 requirement). Fixing :root alone would have fixed
// it for nobody, because each [data-theme] block overrides the token with its own re-hued value.
// That is exactly the kind of thing a person cannot hold in their head while adding a seventh
// theme, so it is pinned mechanically.
//
// It reads src/app.css directly because THE CSS IS THE SOURCE OF TRUTH. A test over a TypeScript
// copy of the palette would pass happily while the real stylesheet drifted, which is the same
// shape as the update-detector test that passed for a module nothing called.
//
// ⚠️ ADDING A THEME WITHOUT CHECKING ITS CONTRAST IS NOW A FAILING TEST, not a discovery a
// colour-blind player makes six months later.
// ============================================================================

import { describe, it, expect } from "vitest";

// ⚠️ READING THE FILE, WITH A LOCAL TYPE DECLARATION, AND BOTH HALVES OF THAT ARE DELIBERATE.
//
// Vite's `?raw` import was tried first and REVERTED: it satisfies `npm run check` but resolves to
// an EMPTY STRING under vitest's transform, so every assertion below passed while checking
// nothing. That is precisely the vacuous-test failure this file exists to prevent, and it is why
// the first case asserts the parse found something before any contrast is measured.
//
// node:fs works at runtime but this project's app tsconfig carries no node types, so the import
// fails `npm run check`. The one function used is declared in src/lib/fs-for-tests.d.ts, which
// explains why that is a standalone .d.ts rather than "node" added to the app's types array.
//
// The path is relative to the project root because vitest runs from there.
import { readFileSync } from "node:fs";

const CSS: string = readFileSync("src/app.css", "utf-8");

// WCAG 2.1 relative luminance and contrast ratio. Standard formulas, no library, because
// pulling a dependency in for twelve lines of arithmetic is not worth the supply chain.
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ⚠️ THE BACKGROUND TEXT IS ACTUALLY DRAWN ON, not --color-bg-deep.
// --color-panel-bg is rgba(20, 40, 60, 0.32) composited over --color-bg-deep (#060a12), which
// resolves to #0a141e. Panels are where essentially all text lives, and the composite is DARKER
// than the raw panel colour, so testing against the panel is the stricter of the two. Measuring
// against bg-deep alone would let a token pass here and fail on screen.
const PANEL_BG = "#0a141e";

// WCAG AA for NORMAL text. The large-text exemption (3.0) starts at 18.66px bold or 24px, and
// this app's text runs 9px to 15px almost everywhere, so 4.5 is the honest bar for all of it.
const AA_NORMAL = 4.5;

// Pull every declaration of a token, wherever it appears: :root and each [data-theme] block.
function valuesOf(token: string): { value: string; index: number }[] {
  const out: { value: string; index: number }[] = [];
  const re = new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(CSS)) !== null) out.push({ value: m[1], index: m.index });
  return out;
}

// Which block an offset falls in, so a failure names the CULPRIT rather than a byte offset.
//
// ⚠️ It matches the accessibility-mode blocks too, not just [data-theme]. Without that, a failure
// inside :root[data-high-contrast="on"] would be blamed on whichever theme happened to be declared
// above it (currently "gray"), sending the next reader to the wrong place entirely.
function themeAt(index: number): string {
  const before = CSS.slice(0, index);
  const matches = [...before.matchAll(/\[data-(?:theme|high-contrast|dyslexia-font|reduced-motion)="([\w-]+)"\]/g)];
  if (matches.length === 0) return ":root";
  const last = matches[matches.length - 1];
  // Name the ATTRIBUTE for a mode block, since "on" alone would not say which mode.
  return last[0].includes("data-theme") ? last[1] : last[0];
}

const TEXT_TOKENS = ["--color-text-primary", "--color-text-secondary", "--color-text-dim"];

describe("every text colour clears WCAG AA, in every theme", () => {
  it("finds all six themes plus :root, so the sweep is not silently partial", () => {
    // Non-vacuous guard. If the regex stops matching (a refactor to SCSS, a rename), this test
    // would otherwise "pass" by checking nothing at all.
    const dims = valuesOf("--color-text-dim");
    expect(dims.length).toBeGreaterThanOrEqual(7);
    const themes = new Set(dims.map((d) => themeAt(d.index)));
    expect(themes.has(":root")).toBe(true);
    for (const t of ["cyan", "green", "blue", "red", "white", "gray"]) {
      expect(themes.has(t)).toBe(true);
    }
  });

  for (const token of TEXT_TOKENS) {
    it(`${token} passes 4.5:1 on the panel background in every theme`, () => {
      const declarations = valuesOf(token);
      expect(declarations.length).toBeGreaterThan(0);
      const failures = declarations
        .map((d) => ({ theme: themeAt(d.index), value: d.value, ratio: contrast(d.value, PANEL_BG) }))
        .filter((r) => r.ratio < AA_NORMAL);
      // Named failures rather than a bare boolean, so the message says WHICH theme and by how much.
      expect(failures.map((f) => `${f.theme} ${f.value} = ${f.ratio.toFixed(2)}:1`)).toEqual([]);
    });
  }

  it("the disabled-text token clears AA too", () => {
    // ⚠️ Disabled controls were the OTHER half of the UX review's contrast finding: labels were
    // drawn at accent 0.4 alpha, which resolves to 3.01:1. The token is now 0.6. Alpha over the
    // panel is composited here the same way the browser does it.
    const m = CSS.match(/--color-text-disabled:\s*rgba\(var\(--color-accent-rgb\),\s*([0-9.]+)\)/);
    expect(m).not.toBeNull();
    const alpha = Number(m![1]);
    // Worst case across themes is whichever accent is darkest against the panel. Checked against
    // the :root cyan accent, which the original 3.01 measurement used.
    const accent = "#67e8f9";
    const composite = (fg: string, a: number, bg: string): string => {
      const f = fg.replace("#", "");
      const b = bg.replace("#", "");
      const mix = (i: number) =>
        Math.round(parseInt(f.slice(i, i + 2), 16) * a + parseInt(b.slice(i, i + 2), 16) * (1 - a));
      return `#${[0, 2, 4].map((i) => mix(i).toString(16).padStart(2, "0")).join("")}`;
    };
    expect(contrast(composite(accent, alpha, PANEL_BG), PANEL_BG)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe("the type scale is present and scalable", () => {
  it("defines --ui-scale so the accessibility text-size control has one hook", () => {
    expect(CSS).toMatch(/--ui-scale:\s*1;/);
  });

  it("expresses every step against --ui-scale, so one variable rescales the whole interface", () => {
    const steps = [...CSS.matchAll(/--text-(3xs|2xs|xs|sm|md|lg|xl|2xl|3xl):\s*([^;]+);/g)];
    expect(steps.length).toBe(9);
    for (const [, name, value] of steps) {
      expect(value, `--text-${name} must scale with --ui-scale`).toContain("var(--ui-scale)");
    }
  });

  it("⚠️ has NO 8px step, so nothing can adopt it while converting", () => {
    // Three sites still use a literal 8px and are bumped when their screen is converted in
    // phase 5. Not offering a token for it is what stops the floor being re-adopted.
    const steps = [...CSS.matchAll(/--text-[0-9a-z]+:\s*calc\((\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(9);
  });
});
