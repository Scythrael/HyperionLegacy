import { describe, it, expect } from "vitest";
import { resolveBuildId } from "./buildId";

describe("resolveBuildId", () => {
  it("uses the sha when present", () => {
    expect(resolveBuildId("abc123", 999)).toBe("abc123");
  });
  it("falls back to the timestamp when sha is undefined", () => {
    expect(resolveBuildId(undefined, 999)).toBe("999");
  });
  it("falls back to the timestamp when sha is empty", () => {
    expect(resolveBuildId("", 999)).toBe("999");
  });
});
