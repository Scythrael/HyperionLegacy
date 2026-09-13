// ============================================================================
// uiScale.test.ts
// 0.13.5. Guards for TWO BUGS THE USER FOUND BY LOOKING AT THE SCREEN, both of which passed every
// gate we had at the time. They are grouped because they share a root cause worth naming: a feature
// was declared done on the strength of the MECHANISM existing, without anything checking that the
// mechanism actually reached the pixels.
//
//   D3: "Doesn't seem to increase the font size of the entire interface. Seemingly only in very
//       specific spots." The --ui-scale token existed, the control wrote it, and 229 of 234
//       font sizes in the app were hardcoded px that could not see it.
//   D5: "Reduce motion doesn't make the bar step. The bar just stays full." Reduced motion had TWO
//       entry points and only one of them carried the progress-fill exception.
//
// These parse the real CSS, like contrast.test.ts, so they constrain the shipped stylesheets rather
// than a copy of the intent.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Repo-root-relative, exactly like contrast.test.ts, and for the same reason: the node:fs shim in
// fs-for-tests.d.ts declares ONE function on purpose, so pulling in node:path (or __dirname) to
// compute a path would mean widening a surface that is deliberately narrow. Vitest runs from the
// repo root, so these resolve.
const read = (p: string) => readFileSync(p, "utf-8");

const APP_CSS = read("src/app.css");
const COMPONENTS = [
  "src/App.svelte",
  "src/lib/CombatView.svelte",
  "src/lib/ShipSystemsPanel.svelte",
  "src/lib/EquipmentTooltip.svelte",
  "src/lib/Panel.svelte",
  "src/lib/SettingRow.svelte",
  "src/lib/SubTabs.svelte",
].map((p) => ({ path: p, src: read(p) }));

describe("D3: the text-size control reaches the whole interface", () => {
  it("reads real files, so the sweep below is not checking an empty string", () => {
    // The vacuity guard this suite learned to write the hard way: a ?raw import once made a whole
    // contrast test pass while reading nothing at all.
    expect(APP_CSS.length).toBeGreaterThan(1000);
    for (const c of COMPONENTS) {
      expect(c.src.length, `${c.path} is empty`).toBeGreaterThan(100);
    }
  });

  it("defines --ui-scale and expresses every type step against it", () => {
    expect(APP_CSS).toMatch(/--ui-scale:\s*1;/);
    const steps = [...APP_CSS.matchAll(/--text-(?:3xs|2xs|xs|sm|md|lg|xl|2xl|3xl):\s*([^;]+);/g)];
    expect(steps.length).toBe(9);
    for (const [, value] of steps) expect(value).toContain("var(--ui-scale)");
  });

  it("⚠️ NO component declares a font-size in raw px, because raw px cannot scale", () => {
    // THIS IS THE CASE THAT WOULD HAVE CAUGHT D3. A raw `font-size: 12px` is invisible to
    // --ui-scale, so every one of them is a piece of the interface the size control silently does
    // not reach. The fix swept 234 of them; this stops the 235th from arriving.
    //
    // Two spellings are legal, and both scale:
    //   font-size: var(--text-sm)                  <- on the scale, preferred
    //   font-size: calc(14px * var(--ui-scale))    <- off the scale, still scales
    // The second exists because four sizes in use (8/14/16/24) sit between the scale's steps, and
    // snapping them during a bug fix would have moved real text. Phase 5's re-tune folds them in.
    const offenders: string[] = [];
    for (const c of COMPONENTS) {
      for (const m of c.src.matchAll(/font-size:\s*(\d+(?:\.\d+)?)(px|rem|em)\s*[;}]/g)) {
        offenders.push(`${c.path}: ${m[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every font-size that is not a scale token is still multiplied by --ui-scale", () => {
    // Belt and braces for the calc() spelling: a `calc(14px * 2)` would pass the case above while
    // being just as unreachable by the control.
    const bad: string[] = [];
    for (const c of COMPONENTS) {
      for (const m of c.src.matchAll(/font-size:\s*calc\(([^;}]*)\)/g)) {
        if (!m[1].includes("var(--ui-scale)")) bad.push(`${c.path}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("D5: reduced motion steps the progress bars instead of pinning them", () => {
  it("⚠️ the blunt animation-killer carries a PROGRESS FILL EXCEPTION", () => {
    // THE CASE THAT WOULD HAVE CAUGHT D5. `animation-duration: 0.001ms !important` is right for
    // decoration and WRONG for a `forwards` progress animation: it runs the bar to completion
    // instantly and holds it at 100% for the whole tick, so a player who asked for less motion gets
    // a broken gauge instead. Killing the animation by NAME lets the polled inline width take over,
    // and the bar steps.
    expect(APP_CSS).toMatch(/:root\[data-reduced-motion="on"\][^{]*\.tick-bar-fill/);
    const rule = APP_CSS.slice(APP_CSS.indexOf('[data-reduced-motion="on"] .tick-bar-fill'));
    expect(rule).toMatch(/animation-name:\s*none\s*!important/);
  });

  it("⚠️ covers the tick bar AND the shared research fill, the two animated gauges", () => {
    const block = APP_CSS.slice(APP_CSS.indexOf('[data-reduced-motion="on"] .tick-bar-fill'));
    expect(block).toContain(".research-bar-fill");
  });

  it("⚠️ the IN-GAME setting is covered, not only the OS media query", () => {
    // The actual shape of D5: reduced motion has two entry points, and the exception lived only on
    // the media-query path. So it worked for a player whose OS was configured for it and broke for
    // a player who used the setting this release added. The attribute selector is the in-game path,
    // and this asserts the exception is on THAT one, where it was missing.
    const attrIndex = APP_CSS.indexOf('[data-reduced-motion="on"] .tick-bar-fill');
    expect(attrIndex).toBeGreaterThan(-1);
  });
});
