import { describe, it, expect } from "vitest";
import {
  freshState,
  freshCaptains,
  freshCaptainStack,
  isModuleUnlocked,
  isResourceUnlocked,
  captainMultiplier,
  specializationMultiplier,
  fleetLifetimeComponents,
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

  it("Captain 2 has id 2, label 'Captain 2', and gets the SAME 1-miner head start as Captain 1", () => {
    // Regression test: Captain 2 previously started with 0 miners, which is
    // an unrecoverable softlock -- every module (including the miner itself)
    // costs ore, and only a miner produces ore, so 0 miners means 0 ore
    // forever, means nothing is ever affordable. Confirmed live in
    // production. Both captains must share the same playable floor.
    const state = freshState();
    const c2 = state.captains[1];
    expect(c2.id).toBe(2);
    expect(c2.label).toBe("Captain 2");
    expect(c2.modules.miner).toBe(1);
    expect(c2.modules.refinery).toBe(0);
    expect(c2.modules.fabricator).toBe(0);
    expect(c2.modules.synthesizer).toBe(0);
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

describe("SPECIALIZATIONS — launch set", () => {
  it("has exactly 3 entries, one per base resource, alloys excluded", () => {
    const keys = Object.keys(SPECIALIZATIONS);
    expect(keys).toHaveLength(3);
    const resources = keys.map((k) => SPECIALIZATIONS[k as keyof typeof SPECIALIZATIONS].resource);
    expect(resources.sort()).toEqual(["components", "ingots", "ore"]);
  });
});

describe("fleetLifetimeComponents — shared by prestige()'s gate and the UI preview", () => {
  it("sums lifetimeComponents across every captain", () => {
    const state = freshState();
    state.captains[0].lifetimeComponents = 36;
    state.captains[1].lifetimeComponents = 64;
    expect(fleetLifetimeComponents(state)).toBe(100);
  });

  it("is 0 for a fresh state", () => {
    expect(fleetLifetimeComponents(freshState())).toBe(0);
  });
});
