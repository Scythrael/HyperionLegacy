// wiring.test.ts: App.svelte's few touches of the secret game, checked against the real source
// (the same technique uiScale.test.ts uses; this repo has no Svelte component harness).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const APP = readFileSync("src/App.svelte", "utf-8");

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

describe("App wiring for 0.13.11", () => {
  it("reads the real file", () => {
    expect(APP.length).toBeGreaterThan(100000);
  });

  it("OPTIONS_TABS has a Codes entry after Save Data", () => {
    const saveData = APP.indexOf('{ key: "saveData", label: "Save Data" }');
    const codes = APP.indexOf('key: "codes", label: "Codes"');
    expect(saveData).toBeGreaterThan(0);
    expect(codes).toBeGreaterThan(saveData);
    expect(APP).toContain('type OptionsTab = "ui" | "gameplay" | "confirmations" | "saveData" | "codes";');
  });

  it("resetSave wipes the secret save (Delete Save and Debug Reset both run resetSave)", () => {
    expect(functionBody("resetSave")).toContain("wipeSecretGame()");
    expect(functionBody("confirmDelete")).toContain("resetSave()");
    expect(APP).toContain('on:click={resetSave}>Reset save</button>');
  });

  it("the Debug fast-forward lives inside the DEV_MODE debug block", () => {
    const debug = APP.indexOf('{#if DEV_MODE && activeSystemSubTab === "debug"}');
    const ff = APP.indexOf("devFastForwardSecret(3600)");
    expect(debug).toBeGreaterThan(0);
    expect(ff).toBeGreaterThan(debug);
    const close = APP.indexOf("{/if}", APP.indexOf("[DEV] Save warning", debug));
    expect(ff).toBeLessThan(close);
  });

  it("mounts the Enter Code window and the overlay, and starts the secret runtime", () => {
    expect(APP).toContain("<EnterCodeModal");
    expect(APP).toContain("<SecretGameOverlay");
    expect(APP).toContain("startSecretRuntime()");
  });

  it("0.13.11.1: the header block replaces the gear, in the same grid area", () => {
    expect(APP).not.toContain('class="top-bar-gear"');
    expect(APP).toContain('<div class="top-bar-buttons">');
    expect(APP).toMatch(/<HeaderButtons[\s\S]*?found=\{\$secretGame\.found\}[\s\S]*?onHelp=\{openHelpCenter\}[\s\S]*?onSettings=\{openSystemModal\}[\s\S]*?onPlay=\{openSecretGame\}/);
    expect(APP).toContain(".top-bar-header .top-bar-buttons { grid-area: gear;");
    expect(functionBody("openHelpCenter")).toContain('activeHomeTab = "help"');
    const hb = readFileSync("src/lib/HeaderButtons.svelte", "utf-8");
    for (const label of ['aria-label="Help"', 'aria-label="Minigames"', 'aria-label="Open settings"', "aria-expanded={menuOpen}"]) expect(hb).toContain(label);
    expect(hb).toMatch(/\{#if found\}[\s\S]*hb-minigames/);
  });

  it("0.13.11.1: credits and unlocks go through do* handlers (pure fn, same-ref guard, state = next, log, save)", () => {
    const redeem = functionBody("doRedeemCode");
    for (const part of ["redeemGift(state", "if (r.next !== state)", "state = r.next", "pushLog(", "doSave()"]) expect(redeem).toContain(part);
    const unlock = functionBody("doUnlockThemeStyle");
    for (const part of ["unlockThemeStyle(state", "if (next === state) return", "state = next", "pushLog(", "doSave()"]) expect(unlock).toContain(part);
    // the Starfall mirror waits for the real save to load and never writes over a corrupt one
    expect(APP).toContain("$: if (accountReady && !suppressSave && $secretGame.milestones.starfall !== undefined");
  });

  it("0.13.11.1: Delete Save and Debug Reset still rebuild from freshState, which carries none of the new fields", () => {
    expect(functionBody("resetSave")).toContain("freshState()");
  });

  it("0.13.11.1: theme presets and styles come from the unlocks, and the Debug tools are dev-only", () => {
    expect(APP).toContain("{#each presetChoices as preset}");
    expect(APP).toContain("{#each styleChoices as style}");
    expect(APP).toContain("$: presetChoices = availablePresets(unlockedThemeStyles);");
    expect(APP).toContain("$: styleChoices = availableStyles(unlockedThemeStyles);");
    expect(APP).toContain("$: applyLook(look);");
    expect(APP).toMatch(/disabled=\{!isGradient\(look\.style\)\}/);
    const debug = APP.indexOf('{#if DEV_MODE && activeSystemSubTab === "debug"}');
    const end = APP.indexOf("{/if}", APP.indexOf("[DEV] Save warning", debug));
    for (const hook of ["on:click={devGrantStarfall}", 'devSecret("found")', 'devSecret("skills")', 'devSecret("e1m")', 'devSecret("e10m")']) {
      const at = APP.indexOf(hook);
      expect(at, hook).toBeGreaterThan(debug);
      expect(at, hook).toBeLessThan(end);
    }
    const dev = functionBody("devSecret");
    expect(dev).toContain("if (!DEV_MODE) return;");
    expect(dev).toContain('await import("./lib/secret/devTools")');
    expect(APP).not.toMatch(/import [^;]*from "\.\/lib\/secret\/devTools"/);
  });

  it("0.13.11.1: the main game reads the ONE trusted clock for loop, load, save and recaps", () => {
    const loopStart = APP.indexOf("const pollGameLoop = () => {");
    const loop = APP.slice(loopStart, APP.indexOf("const welcomeBack = ", loopStart));
    expect(loop).toContain("const now = trustedNow();");
    expect(loop).toContain("clampCatchUp(plan, heldReleaseBudgetSeconds)");
    expect(functionBody("doSave")).toContain("paidThroughMs(loopClock, trustedNow())");
    expect(APP).toContain("const returnedAtMs = trustedNow();");
    expect(APP).toContain("initTrustedTime([loadedSave?.lastSavedAt, peekSecretLastTick()]);");
    // No progress path reads the raw device clock any more.
    for (const raw of ["paidThroughMs(loopClock, Date.now())", "const returnedAtMs = Date.now()", "atMs: Date.now(), snapshot"]) expect(APP).not.toContain(raw);
    const runtime = readFileSync("src/lib/secret/runtime.ts", "utf-8");
    expect(runtime).not.toMatch(/Date\.now\(\)/);
  });

  it("0.13.11.1: one achievement popup mount, after the overlay", () => {
    expect(APP.split("<AchievementToasts").length - 1).toBe(1);
    expect(APP.indexOf("<AchievementToasts")).toBeGreaterThan(APP.indexOf("<SecretGameOverlay"));
  });

  it("the main loop and the main economy never mention the secret game", () => {
    const loopStart = APP.indexOf("const pollGameLoop = () => {");
    const loopEnd = APP.indexOf("const welcomeBack = ", loopStart);
    const loop = APP.slice(loopStart, loopEnd);
    expect(loop.length).toBeGreaterThan(500);
    expect(loop).not.toMatch(/secret/i);
    const tick = readFileSync("src/lib/game/tick.ts", "utf-8");
    const save = readFileSync("src/lib/game/save.ts", "utf-8");
    expect(tick).not.toMatch(/secret/i);
    expect(save).not.toMatch(/secret/i);
  });
});
