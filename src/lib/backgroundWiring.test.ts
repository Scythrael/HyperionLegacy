// backgroundWiring.test.ts: 0.14.0 Slice 5b, App.svelte's wiring of the background track, checked against the
// real source (this repo has no Svelte component harness; the same technique as secret/wiring.test.ts).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Line endings normalized (the working tree may check out CRLF).
const read = (path: string): string => readFileSync(path, "utf-8").split("\r\n").join("\n");
const APP = read("src/App.svelte");
const BG = read("src/lib/Background.svelte");
const FTL = read("src/lib/FasterThanLight.svelte");
const CFG = read("src/lib/BackgroundConfigure.svelte");
const STARFIELD = read("src/lib/Starfield.svelte");
const CSS = read("src/app.css");

function functionBody(name: string): string {
  const start = APP.indexOf(`function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThan(0);
  const open = APP.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < APP.length; i++) {
    if (APP[i] === "{") depth++;
    if (APP[i] === "}" && --depth === 0) return APP.slice(open, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

function section(from: string, to: string): string {
  const a = APP.indexOf(from);
  const b = APP.indexOf(to, a);
  expect(a, from).toBeGreaterThan(0);
  expect(b, to).toBeGreaterThan(a);
  return APP.slice(a, b);
}

describe("Default renders today's background unchanged", () => {
  it("the game root mounts Background where the Starfield was, behind the frame", () => {
    // HOTFIX 0.13.11.4: the root carries the catch-up inert attribute, so the anchor stops before its closing bracket.
    const root = APP.indexOf('<div class="root"');
    expect(root).toBeGreaterThan(0);
    const bg = APP.indexOf("<Background id={background.id}", root);
    const frame = APP.indexOf('<div class="frame">', root);
    expect(bg).toBeGreaterThan(root);
    expect(frame).toBeGreaterThan(bg);
    expect(APP).not.toContain("<Starfield />");
  });

  it("Background's Default branch is the Starfield component itself, with no wrapper or guard", () => {
    expect(BG).toMatch(/\{#if id === "fasterThanLight"\}[\s\S]*\{:else\}\s*<Starfield \/>\s*\{\/if\}/);
    expect(BG).toContain('import Starfield from "./Starfield.svelte";');
  });

  it("the Starfield itself is today's markup: 80 drifting stars in the theme's starfield tint", () => {
    expect(STARFIELD).toContain("Array.from({ length: 80 }");
    expect(STARFIELD).toContain("background: var(--color-starfield);");
    expect(STARFIELD).toContain("animation-name: drift;");
  });

  it("the readability guard only exists while a visualization plays (Default sets no data-background)", () => {
    expect(CSS).toContain(":root[data-background] {");
    expect(CSS).toMatch(/:root\[data-background\] \{\s*--color-panel-bg: rgba\(13, 24, 40, 0\.84\);\s*\}/);
    expect(APP).toContain("$: applyBackground(background.id);");
  });
});

describe("settings mirror the theme preset", () => {
  const panel = section("<!-- 0.14.0 BACKGROUND (Slice 5b", "<!-- HEADER CURRENCIES");

  it("one Background preset dropdown: Default, the unlocked presets, the locked hints, Manual", () => {
    expect(panel).toContain('<div class="panel-title">BACKGROUND</div>');
    expect(panel).toContain('label="Background preset"');
    const def = panel.indexOf('<option value="default">Default</option>');
    const presets = panel.indexOf("{#each backgroundPresetChoices as bg (bg.id)}");
    const locked = panel.indexOf("{LOCKED_OPTION}");
    const manual = panel.indexOf('<option value="manual">Manual</option>');
    expect(def).toBeGreaterThan(0);
    expect(presets).toBeGreaterThan(def);
    expect(locked).toBeGreaterThan(presets);
    expect(manual).toBeGreaterThan(locked);
    expect(panel).toContain('<option disabled value="">{LOCKED_OPTION}</option>');
  });

  it("Manual reveals Background style plus Configure, which opens the Configure window", () => {
    const manual = panel.slice(panel.indexOf('{:else if shownBackgroundChoice === "manual"}'));
    expect(manual).toContain('label="Background style"');
    expect(manual).toContain("{#each backgroundStyleChoices as bg (bg.id)}");
    expect(manual).toContain("on:click={() => (backgroundConfigureOpen = true)}>Configure</button>");
    expect(panel).toMatch(/\{#if backgroundConfigureOpen\}\s*<BackgroundConfigure/);
  });

  it("the BACKGROUND section sits right under UI THEME", () => {
    const theme = APP.indexOf('<div class="panel-title">UI THEME</div>');
    const bg = APP.indexOf('<div class="panel-title">BACKGROUND</div>');
    const currencies = APP.indexOf("<!-- HEADER CURRENCIES");
    expect(bg).toBeGreaterThan(theme);
    expect(currencies).toBeGreaterThan(bg);
  });

  it("never names the prize's milestone anywhere the minigame shows ???", () => {
    for (const src of [panel, CFG, BG, FTL]) expect(src).not.toMatch(/e25|25,000,000|The Sky Is Showing Off/);
  });

  it("the Configure window: every background on top (locked with the hint), preview, per-background controls, Reset and Done", () => {
    const vis = CFG.indexOf('class="bc-vis"');
    const preview = CFG.indexOf('class="bc-preview"');
    const controls = CFG.indexOf("{#each SLIDERS as s (s.key)}");
    expect(vis).toBeGreaterThan(0);
    expect(preview).toBeGreaterThan(vis);
    expect(controls).toBeGreaterThan(preview);
    expect(CFG).toContain("{#each BACKGROUNDS as bg (bg.id)}");
    expect(CFG).toContain("Locked<small>{LOCKED_HINT}</small>");
    for (const label of ["Speed", "Streak length", "Stars", "Brightness", "Ignore theme colors (classic white streaks)", "Jump to warp when it turns on", "Still (no motion). On automatically when your system asks for reduced motion.", "Reset to default", "Done", "The classic backdrop has nothing to tune."]) {
      expect(CFG, label).toContain(label);
    }
  });
});

describe("the unlock and the reward hook", () => {
  it("the milestone mirror waits for the real save and never writes over a corrupt one (like Starfall)", () => {
    // HOTFIX 0.13.11.4 (0.14.0 port): it also waits for a catch-up in flight (catchUpView), like the Starfall mirror.
    expect(APP).toContain("$: if (accountReady && !suppressSave && catchUpView === null) {\n    for (const id of backgroundsFromMilestones($secretGame.milestones)) if (!hasBackground(state, id)) doUnlockBackground(id);");
    const unlock = functionBody("doUnlockBackground");
    for (const part of ["unlockBackground(state", "if (next === state) return", "state = next", "pushLog(", "doSave()"]) expect(unlock).toContain(part);
  });

  it("the unlocks come from the main save's own field, and the Debug grant is dev-only", () => {
    expect(APP).toContain("$: unlockedBackgrounds = Array.isArray(state.unlockedBackgrounds) ? state.unlockedBackgrounds : [];");
    expect(functionBody("devGrantFasterThanLight")).toContain("if (!DEV_MODE) return;");
    const debug = APP.indexOf('{#if DEV_MODE && activeSystemSubTab === "debug"}');
    const end = APP.indexOf("{/if}", APP.indexOf("[DEV] Save warning", debug));
    const at = APP.indexOf("on:click={devGrantFasterThanLight}");
    expect(at).toBeGreaterThan(debug);
    expect(at).toBeLessThan(end);
  });

  it("the device-side choice loads with the look", () => {
    // HOTFIX 0.13.11.4 (0.14.0 port): read in startGame, and before an asynchronous reload catch-up so the player's own
    // look shows behind the overlay.
    expect(APP).toContain("      lookPrefs = loadLookPrefs(currentTheme);\n      backgroundPrefs = loadBackgroundPrefs();");
    expect(APP).toContain("        lookPrefs = loadLookPrefs(currentTheme);\n        backgroundPrefs = loadBackgroundPrefs();\n        const job = beginTickJob(");
  });
});

describe("accessibility and peace", () => {
  it("Still follows reduced motion (the game's setting, which defaults to the system's)", () => {
    expect(APP).toContain("$: backgroundStill = effectiveStill(background.ftl, reducedMotion);");
    expect(APP).toContain("still={backgroundStill}");
    expect(CFG).toContain("disabled={reducedMotion}");
  });

  it("pauses while the tab is hidden and while the Configure window plays its own preview", () => {
    expect(FTL).toContain('document.addEventListener("visibilitychange", onVisibility);');
    expect(FTL).toContain('document.removeEventListener("visibilitychange", onVisibility);');
    expect(FTL).toContain("if (paused || hidden) renderer.stop();");
    expect(APP).toContain("paused={backgroundConfigureOpen}");
  });

  it("the canvas caps its pixel ratio and is decoration for assistive tech", () => {
    expect(FTL).toContain("cappedDpr(window.devicePixelRatio || 1)");
    expect(FTL).toContain('aria-hidden="true"');
    expect(BG).toContain('aria-hidden="true"');
  });
});
