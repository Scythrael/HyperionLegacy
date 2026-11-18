// Version label (user, 2026-11-18): staging shows the version it is building toward (0.14.0, not prod's 0.13.11.4)
// and says it is a development build; the production build never carries that label.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { versionLabel } from "./buildInfo";
import { APP_VERSION } from "./patchNotes";

const read = (p: string) => readFileSync(p, "utf8");

describe("versionLabel", () => {
  it("marks a development build and leaves a production build plain", () => {
    expect(versionLabel("0.14.0", true)).toBe("0.14.0 (development build)");
    expect(versionLabel("0.14.0", false)).toBe("0.14.0");
  });

  it("the feature branch carries the version it will ship as", () => {
    expect(APP_VERSION).toBe("0.14.0");
  });

  it("every place that prints the version uses the label", () => {
    expect(read("src/App.svelte")).toContain("Version {versionLabel(APP_VERSION, DEV_MODE)}");
    expect(read("src/Landing.svelte")).toContain("prototype build v{versionLabel(APP_VERSION, IS_DEV_BUILD)}");
    const page = read("src/PatchNotesPage.svelte");
    expect(page).toContain(`v{versionLabel(APP_VERSION, IS_DEV_BUILD)}</span>`);
    expect(page).toContain("prototype build v{versionLabel(APP_VERSION, IS_DEV_BUILD)}");
  });
});
