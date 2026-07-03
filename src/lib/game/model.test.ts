import { describe, it, expect } from "vitest";
import { freshState } from "./model";

describe("freshState — tick duration default", () => {
  it("defaults tickDurationSeconds to 10", () => {
    const state = freshState();
    expect(state.tickDurationSeconds).toBe(10);
  });
});
