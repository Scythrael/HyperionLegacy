import { describe, it, expect } from "vitest";
import { ICON_NAMES, ICON_PATHS } from "../ui/icons";
import { ICON_SEMANTICS } from "../ui/iconPacks";

describe("the secret game's glyphs", () => {
  it("exist as SVG paths and carry a semantic class", () => {
    const needed = ["arrowUp", "arrowDown", "arrowLeft", "arrowRight", "star", "circle", "controller", "help", "gear", "chart"] as const;
    for (const name of needed) {
      expect(ICON_NAMES).toContain(name);
      expect((ICON_PATHS as Record<string, readonly string[]>)[name].length).toBeGreaterThan(0);
      expect((ICON_SEMANTICS as Record<string, string>)[name]).toBeDefined();
    }
  });
});
