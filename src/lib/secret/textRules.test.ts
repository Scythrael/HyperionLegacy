// textRules.test.ts: the project's text, glyph and accessibility rules on every 0.13.11 file.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const FILES = [
  "src/lib/secret/format.ts",
  "src/lib/secret/combo.ts",
  "src/lib/secret/codes.ts",
  "src/lib/secret/config.ts",
  "src/lib/secret/state.ts",
  "src/lib/secret/engine.ts",
  "src/lib/secret/catchUp.ts",
  "src/lib/secret/sim.ts",
  "src/lib/secret/runtime.ts",
  "src/lib/secret/testStates.ts",
  "src/lib/secret/testStorage.ts",
  "src/lib/secret/testReport.ts",
  "src/lib/secret/simReport.ts",
  "src/lib/secret/overlayKeys.ts",
  "src/lib/EnterCodeModal.svelte",
  "src/lib/SecretGameOverlay.svelte",
  "docs/plans/2026-10-22-hotfix-0.13.11-secret-generator-plan.md",
  // 0.13.11.1
  "src/lib/secret/sha256.ts",
  "src/lib/accountExtras.ts",
  "src/lib/achievements.ts",
  "src/lib/themeStyle.ts",
  "src/lib/AchievementToasts.svelte",
  "src/lib/HeaderButtons.svelte",
  "src/lib/secret/devTools.ts",
  "docs/plans/2026-10-23-hotfix-0.13.11.1-plan.md",
  "src/lib/trustedTime.ts",
  "src/lib/trustedTime.test.ts",
  "src/lib/secret/simTargets.test.ts",
  "src/lib/secret/simTargetsHigh.test.ts",
  "src/lib/secret/simSpam.test.ts",
].map((path) => ({ path, src: readFileSync(path, "utf-8") }));

// 0.13.11.1 additions inside files that predate the text rules, checked as slices.
function slice(path: string, from: string, to: string): { path: string; src: string } {
  const all = readFileSync(path, "utf-8");
  const a = all.indexOf(from);
  const b = all.indexOf(to, a + from.length);
  expect(a, `${path}: ${from}`).toBeGreaterThanOrEqual(0);
  expect(b, `${path}: ${to}`).toBeGreaterThan(a);
  return { path: `${path} [${from}]`, src: all.slice(a, b) };
}
const SLICES = () => [
  slice("src/app.css", "THEME STYLES (0.13.11.1", "/* REDUCED MOTION"),
  slice("src/App.svelte", "// 0.13.11.1: the combo only UNLOCKS.", "// The modal's top-tab list"),
  slice("src/App.svelte", "<!-- 0.13.11.1 HEADER BUTTON BLOCK", '<main class="tab-body">'),
  slice("src/App.svelte", "<!-- 0.13.11.1 THEME (user", "<!-- HEADER CURRENCIES"),
  slice("src/App.svelte", "// The look: preset + manual picks", "// [DEV] grant the Starfall"),
  slice("src/lib/patchNotes.ts", 'version: "0.13.11.1"', 'version: "0.13.11"'),
  slice("src/lib/game/model.ts", "0.13.11.1 ACCOUNT-LEVEL EXTRAS", "unlockedThemeStyles?: string[];"),
  slice("src/lib/game/loopClock.ts", "export function clampCatchUp", "\n}"),
];

const COMPONENTS = FILES.filter((f) => f.path.endsWith(".svelte"));

describe("0.13.11 text rules", () => {
  it("reads real files", () => {
    for (const f of FILES) expect(f.src.length, f.path).toBeGreaterThan(200);
  });

  it("has no em or en dashes and no double-hyphen dash substitutes", () => {
    for (const f of [...FILES, ...SLICES()]) {
      expect(/[–—]/.test(f.src), `${f.path} has an em or en dash`).toBe(false);
      expect(/(^|\s)--(\s|$)/m.test(f.src), `${f.path} has a "--" dash`).toBe(false);
    }
  });

  it("uses SVG glyphs, never emoji", () => {
    for (const f of [...FILES, ...SLICES()]) expect(/\p{Extended_Pictographic}/u.test(f.src), `${f.path} has an emoji`).toBe(false);
  });

  it("says install, never fit, and objective, never task", () => {
    for (const f of [...FILES, ...SLICES()].filter((x) => !x.path.endsWith(".md"))) {
      expect(/\bfit(s|ting|ted|ment)?\b/i.test(f.src), `${f.path} says fit`).toBe(false);
      expect(/\btasks?\b/i.test(f.src), `${f.path} says task`).toBe(false);
    }
  });

  it("sizes every font on the scale so the text-size control reaches it", () => {
    for (const c of COMPONENTS) {
      for (const m of c.src.matchAll(/font-size:\s*([^;}]+)[;}]/g)) {
        expect(m[1].includes("var(--text-") || m[1].includes("var(--ui-scale)"), `${c.path}: ${m[0]}`).toBe(true);
      }
    }
  });

  it("only animates the overlay when the player has not asked for reduced motion", () => {
    const overlay = COMPONENTS.find((c) => c.path.endsWith("SecretGameOverlay.svelte"))!.src;
    const guard = overlay.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(guard).toBeGreaterThan(0);
    const animations = [...overlay.matchAll(/animation:/g)].map((m) => m.index!);
    expect(animations.length).toBeGreaterThan(0);
    for (const at of animations) expect(at).toBeGreaterThan(guard);
    const enter = COMPONENTS.find((c) => c.path.endsWith("EnterCodeModal.svelte"))!.src;
    expect(enter).not.toMatch(/animation:|transition:/);
  });

  it("gives every combo pad button an accessible name", () => {
    const enter = COMPONENTS.find((c) => c.path.endsWith("EnterCodeModal.svelte"))!.src;
    const pad = [...enter.matchAll(/<button[^>]*class="ec-btn (?:ec-dir|ec-small|ec-round)[^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(pad.length).toBe(8);
    for (const b of pad) expect(b, b).toMatch(/aria-label="[^"]+"/);
  });

  it("never names the combo or the secret in player-facing Settings or Help text", () => {
    const app = readFileSync("src/App.svelte", "utf-8");
    const codesPanel = app.slice(app.indexOf('{#if activeOptionsTab === "codes"}'), app.indexOf("{/if}", app.indexOf('{#if activeOptionsTab === "codes"}')));
    expect(codesPanel).not.toMatch(/combo|konami|secret|v0\.0000001a/i);
    const help = readFileSync("src/lib/helpTopics.ts", "utf-8");
    expect(help).not.toMatch(/combo|konami|v0\.0000001a|Prestigeception/i);
  });
});
