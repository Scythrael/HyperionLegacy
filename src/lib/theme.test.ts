import { describe, it, expect } from "vitest";
import { isValidTheme, THEME_NAMES, DEFAULT_THEME } from "./theme";

describe("isValidTheme", () => {
  it("accepts every name in THEME_NAMES", () => {
    for (const name of THEME_NAMES) {
      expect(isValidTheme(name)).toBe(true);
    }
  });

  it("rejects an unknown theme name", () => {
    expect(isValidTheme("purple")).toBe(false);
  });

  it("rejects null", () => {
    expect(isValidTheme(null)).toBe(false);
  });

  it("DEFAULT_THEME is itself a valid theme name", () => {
    expect(isValidTheme(DEFAULT_THEME)).toBe(true);
  });
});
