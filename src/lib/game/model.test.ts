import { describe, it, expect } from "vitest";
import { freshState, isModuleUnlocked, isResourceUnlocked } from "./model";

describe("freshState — tick duration default", () => {
  it("defaults tickDurationSeconds to 10", () => {
    const state = freshState();
    expect(state.tickDurationSeconds).toBe(10);
  });
});

describe("freshState — alloys/synthesizer/research defaults", () => {
  it("starts with 0 alloys and 0 synthesizers", () => {
    const state = freshState();
    expect(state.resources.alloys).toBe(0);
    expect(state.modules.synthesizer).toBe(0);
  });

  it("starts with alloySynthesis research not started/not completed", () => {
    const state = freshState();
    expect(state.research.alloySynthesis).toEqual({
      started: false,
      progressSeconds: 0,
      completed: false,
    });
  });
});

describe("isModuleUnlocked", () => {
  it("miner, refinery, and fabricator are always unlocked", () => {
    const state = freshState();
    expect(isModuleUnlocked("miner", state)).toBe(true);
    expect(isModuleUnlocked("refinery", state)).toBe(true);
    expect(isModuleUnlocked("fabricator", state)).toBe(true);
  });

  it("synthesizer is locked until alloySynthesis research completes", () => {
    const state = freshState();
    expect(isModuleUnlocked("synthesizer", state)).toBe(false);

    const completed = {
      ...state,
      research: { ...state.research, alloySynthesis: { ...state.research.alloySynthesis, completed: true } },
    };
    expect(isModuleUnlocked("synthesizer", completed)).toBe(true);
  });
});

describe("isResourceUnlocked", () => {
  it("ore, ingots, and components are always unlocked", () => {
    const state = freshState();
    expect(isResourceUnlocked("ore", state)).toBe(true);
    expect(isResourceUnlocked("ingots", state)).toBe(true);
    expect(isResourceUnlocked("components", state)).toBe(true);
  });

  it("alloys is locked until alloySynthesis research completes", () => {
    const state = freshState();
    expect(isResourceUnlocked("alloys", state)).toBe(false);

    const completed = {
      ...state,
      research: { ...state.research, alloySynthesis: { ...state.research.alloySynthesis, completed: true } },
    };
    expect(isResourceUnlocked("alloys", completed)).toBe(true);
  });
});
