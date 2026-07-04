import { describe, it, expect } from "vitest";
import {
  freshState,
  freshCaptains,
  freshCaptainStack,
  isModuleUnlocked,
  isResourceUnlocked,
  captainMultiplier,
  specializationMultiplier,
  SPECIALIZATIONS,
} from "./model";

describe("freshState — captain roster shape", () => {
  it("starts with exactly 2 captains", () => {
    const state = freshState();
    expect(state.captains).toHaveLength(2);
  });

  it("Captain 1 has id 1, label 'Captain 1', shipType resourcer, and a 1-miner head start", () => {
    const state = freshState();
    const c1 = state.captains[0];
    expect(c1.id).toBe(1);
    expect(c1.label).toBe("Captain 1");
    expect(c1.shipType).toBe("resourcer");
    expect(c1.modules.miner).toBe(1);
    expect(c1.modules.refinery).toBe(0);
    expect(c1.modules.fabricator).toBe(0);
    expect(c1.modules.synthesizer).toBe(0);
  });

  it("Captain 2 has id 2, label 'Captain 2', and starts completely empty (no head start)", () => {
    const state = freshState();
    const c2 = state.captains[1];
    expect(c2.id).toBe(2);
    expect(c2.label).toBe("Captain 2");
    expect(c2.modules.miner).toBe(0);
  });

  it("both captains start with 0 resources, 0 captainPoints, 0 captainPrestigeCount, null specialization", () => {
    const state = freshState();
    for (const c of state.captains) {
      expect(c.resources).toEqual({ ore: 0, ingots: 0, components: 0, alloys: 0 });
      expect(c.lifetimeComponents).toBe(0);
      expect(c.tickDurationSeconds).toBe(10);
      expect(c.captainPoints).toBe(0);
      expect(c.captainPrestigeCount).toBe(0);
      expect(c.specialization).toBe(null);
      expect(c.research.alloySynthesis).toEqual({ started: false, progressSeconds: 0, completed: false });
    }
  });

  it("fleet-wide fields default to 0", () => {
    const state = freshState();
    expect(state.augmentPoints).toBe(0);
    expect(state.prestigeCount).toBe(0);
    expect(state.gameTimeSeconds).toBe(0);
  });
});

describe("freshCaptainStack — shared reset baseline", () => {
  it("returns the 1-free-miner baseline used by both prestige tiers", () => {
    const stack = freshCaptainStack();
    expect(stack.modules.miner).toBe(1);
    expect(stack.modules.refinery).toBe(0);
    expect(stack.resources).toEqual({ ore: 0, ingots: 0, components: 0, alloys: 0 });
    expect(stack.lifetimeComponents).toBe(0);
    expect(stack.tickDurationSeconds).toBe(10);
    expect(stack.research.alloySynthesis).toEqual({ started: false, progressSeconds: 0, completed: false });
  });
});

describe("isModuleUnlocked (per-captain)", () => {
  it("miner, refinery, and fabricator are always unlocked", () => {
    const captain = freshCaptains()[0];
    expect(isModuleUnlocked("miner", captain)).toBe(true);
    expect(isModuleUnlocked("refinery", captain)).toBe(true);
    expect(isModuleUnlocked("fabricator", captain)).toBe(true);
  });

  it("synthesizer is locked until THIS captain's alloySynthesis research completes", () => {
    const captain = freshCaptains()[0];
    expect(isModuleUnlocked("synthesizer", captain)).toBe(false);

    const completed = {
      ...captain,
      research: { ...captain.research, alloySynthesis: { ...captain.research.alloySynthesis, completed: true } },
    };
    expect(isModuleUnlocked("synthesizer", completed)).toBe(true);
  });
});

describe("isResourceUnlocked (per-captain)", () => {
  it("ore, ingots, and components are always unlocked", () => {
    const captain = freshCaptains()[0];
    expect(isResourceUnlocked("ore", captain)).toBe(true);
    expect(isResourceUnlocked("ingots", captain)).toBe(true);
    expect(isResourceUnlocked("components", captain)).toBe(true);
  });

  it("alloys is locked until THIS captain's alloySynthesis research completes", () => {
    const captain = freshCaptains()[0];
    expect(isResourceUnlocked("alloys", captain)).toBe(false);

    const completed = {
      ...captain,
      research: { ...captain.research, alloySynthesis: { ...captain.research.alloySynthesis, completed: true } },
    };
    expect(isResourceUnlocked("alloys", completed)).toBe(true);
  });
});

describe("captainMultiplier", () => {
  it("is 1 with 0 captainPoints", () => {
    const captain = { ...freshCaptains()[0], captainPoints: 0 };
    expect(captainMultiplier(captain)).toBe(1);
  });

  it("is 1 + points * 0.1", () => {
    const captain = { ...freshCaptains()[0], captainPoints: 20 };
    expect(captainMultiplier(captain)).toBeCloseTo(3, 6);
  });
});

describe("specializationMultiplier", () => {
  it("is 1 for every resource when specialization is null", () => {
    const captain = { ...freshCaptains()[0], specialization: null };
    expect(specializationMultiplier(captain, "ore")).toBe(1);
    expect(specializationMultiplier(captain, "ingots")).toBe(1);
  });

  it("is 1 + bonusMult for the matching resource, 1 for others", () => {
    const captain = { ...freshCaptains()[0], specialization: "mining" as const };
    expect(specializationMultiplier(captain, "ore")).toBeCloseTo(1 + SPECIALIZATIONS.mining.bonusMult, 6);
    expect(specializationMultiplier(captain, "ingots")).toBe(1);
    expect(specializationMultiplier(captain, "components")).toBe(1);
  });
});
