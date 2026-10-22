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
