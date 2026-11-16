// FR-C R5 (QA 2026-11-14 R5-2): the Refinery's line configurator offers the continuous run the engine always supported
// (CraftLineMode "continuous"), beside the batch quantity, and both Start and Add to queue submit the chosen mode. The
// engine half (a continuous line refines until cancelled, reserving one run) is covered by craft-lines.test.ts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import Decimal from "break_infinity.js";
import { freshState } from "./game/model";
import { startLine } from "./game/tick";

const app = readFileSync("src/App.svelte", "utf8");

describe("the Refinery configurator offers a continuous run", () => {
  it("has a Run select with Batch and Continuous, and Start / Add to queue submit the chosen mode", () => {
    expect(app).toContain('<select class="modal-input" bind:value={cfgRunMode} aria-label="Run mode">');
    expect(app).toContain('<option value="continuous">Continuous</option>');
    expect(app).toContain('doStartLine("refine", cfgRecipeKey, cfgRefineMode, cfgBestMaterials)');
    expect(app).toContain('doEnqueueLine("refinery", "refine", cfgRecipeKey, cfgRefineMode, cfgBestMaterials)');
  });

  it("a continuous refine line starts from the same call the configurator makes", () => {
    const base = freshState();
    const s = { ...base, facilities: { ...base.facilities, refinery: { level: 1 } } };
    s.inventory = { ...s.inventory, commonOre: [new Decimal(100)] };
    const r = startLine(s, "refine", "refineCommonOre", { kind: "continuous" });
    expect(r.started).toBe(true);
    expect(r.next.refineLines[0].mode).toEqual({ kind: "continuous" });
  });
});
