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
  captainSlotCount,
  researchDurationMult,
  requiredTicksForPhase,
  rollLootTable,
  SPECIALIZATIONS,
  SKILL_TREE,
  MISSIONS,
} from "./model";

describe("freshState — captain roster shape", () => {
  it("starts with exactly 1 captain (Command branch is how the roster grows now)", () => {
    const state = freshState();
    expect(state.captains).toHaveLength(1);
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

  it("starts with 0 resources, 0 captainPoints, 0 captainPrestigeCount, null specialization", () => {
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

  it("fleet-wide fields default to 0, including the new skill tree fields", () => {
    const state = freshState();
    expect(state.augmentPoints).toBe(0);
    expect(state.prestigeCount).toBe(0);
    expect(state.gameTimeSeconds).toBe(0);
    expect(state.skillPoints).toBe(0);
    expect(state.unlockedSkillNodes).toEqual([]);
  });
});

describe("freshCaptains(count) — parameterized roster generation", () => {
  it("generates exactly `count` captains with sequential ids/labels, all sharing the 1-miner floor", () => {
    const captains = freshCaptains(3);
    expect(captains).toHaveLength(3);
    expect(captains.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(captains.map((c) => c.label)).toEqual(["Captain 1", "Captain 2", "Captain 3"]);
    for (const c of captains) {
      expect(c.modules.miner).toBe(1); // regression: every captain, however generated, needs this floor
      expect(c.shipType).toBe("resourcer");
      expect(c.captainPoints).toBe(0);
      expect(c.specialization).toBe(null);
    }
  });

  it("generates a single captain when count is 1", () => {
    const captains = freshCaptains(1);
    expect(captains).toHaveLength(1);
    expect(captains[0].id).toBe(1);
    expect(captains[0].label).toBe("Captain 1");
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
    const captain = freshCaptains(1)[0];
    expect(isModuleUnlocked("miner", captain)).toBe(true);
    expect(isModuleUnlocked("refinery", captain)).toBe(true);
    expect(isModuleUnlocked("fabricator", captain)).toBe(true);
  });

  it("synthesizer is locked until THIS captain's alloySynthesis research completes", () => {
    const captain = freshCaptains(1)[0];
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
    const captain = freshCaptains(1)[0];
    expect(isResourceUnlocked("ore", captain)).toBe(true);
    expect(isResourceUnlocked("ingots", captain)).toBe(true);
    expect(isResourceUnlocked("components", captain)).toBe(true);
  });

  it("alloys is locked until THIS captain's alloySynthesis research completes", () => {
    const captain = freshCaptains(1)[0];
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
    const captain = { ...freshCaptains(1)[0], captainPoints: 0 };
    expect(captainMultiplier(captain)).toBe(1);
  });

  it("is 1 + points * 0.1", () => {
    const captain = { ...freshCaptains(1)[0], captainPoints: 20 };
    expect(captainMultiplier(captain)).toBeCloseTo(3, 6);
  });
});

describe("specializationMultiplier", () => {
  it("is 1 for every resource when specialization is null", () => {
    const captain = { ...freshCaptains(1)[0], specialization: null };
    expect(specializationMultiplier(captain, "ore")).toBe(1);
    expect(specializationMultiplier(captain, "ingots")).toBe(1);
  });

  it("is 1 + bonusMult for the matching resource, 1 for others", () => {
    const captain = { ...freshCaptains(1)[0], specialization: "mining" as const };
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

describe("SKILL_TREE — launch set", () => {
  it("has 3 Command ranks with a linear prerequisite chain and increasing cost", () => {
    expect(SKILL_TREE.commandRank1.branch).toBe("command");
    expect(SKILL_TREE.commandRank1.requires).toBe(null);
    expect(SKILL_TREE.commandRank1.costSkillPoints).toBe(1);
    expect(SKILL_TREE.commandRank1.effect).toEqual({ type: "unlockCaptainSlot" });

    expect(SKILL_TREE.commandRank2.requires).toBe("commandRank1");
    expect(SKILL_TREE.commandRank2.costSkillPoints).toBe(2);

    expect(SKILL_TREE.commandRank3.requires).toBe("commandRank2");
    expect(SKILL_TREE.commandRank3.costSkillPoints).toBe(3);
  });

  it("has 1 Research node reducing Alloy Synthesis duration by 25%, no prerequisite", () => {
    expect(SKILL_TREE.researchAlloySynthesisSpeed.branch).toBe("research");
    expect(SKILL_TREE.researchAlloySynthesisSpeed.requires).toBe(null);
    expect(SKILL_TREE.researchAlloySynthesisSpeed.costSkillPoints).toBe(1);
    expect(SKILL_TREE.researchAlloySynthesisSpeed.effect).toEqual({
      type: "researchSpeedMult",
      researchKey: "alloySynthesis",
      mult: 0.75,
    });
  });
});

describe("captainSlotCount", () => {
  it("is 1 with no unlocked Command nodes", () => {
    const state = freshState();
    expect(captainSlotCount(state)).toBe(1);
  });

  it("is 1 + N with N unlocked Command nodes", () => {
    const state = freshState();
    state.unlockedSkillNodes = ["commandRank1", "commandRank2"];
    expect(captainSlotCount(state)).toBe(3);
  });

  it("does not count the Research node toward slot count", () => {
    const state = freshState();
    state.unlockedSkillNodes = ["commandRank1", "researchAlloySynthesisSpeed"];
    expect(captainSlotCount(state)).toBe(2);
  });
});

describe("researchDurationMult", () => {
  it("is 1 for a research project with no matching unlocked node", () => {
    const state = freshState();
    expect(researchDurationMult(state, "alloySynthesis")).toBe(1);
  });

  it("is the node's mult once unlocked", () => {
    const state = freshState();
    state.unlockedSkillNodes = ["researchAlloySynthesisSpeed"];
    expect(researchDurationMult(state, "alloySynthesis")).toBeCloseTo(0.75, 6);
  });
});

describe("fleetLifetimeComponents — shared by prestige()'s gate and the UI preview", () => {
  it("sums lifetimeComponents across every captain", () => {
    const state = freshState();
    state.captains = freshCaptains(2); // exercise the "every captain" sum with more than the 1-captain freshState() default
    state.captains[0].lifetimeComponents = 36;
    state.captains[1].lifetimeComponents = 64;
    expect(fleetLifetimeComponents(state)).toBe(100);
  });

  it("is 0 for a fresh state", () => {
    expect(fleetLifetimeComponents(freshState())).toBe(0);
  });
});

describe("freshState / freshCaptainStack — mission and Home Planet fields", () => {
  it("a fresh captain starts with no active mission", () => {
    const captain = freshCaptains(1)[0];
    expect(captain.mission).toBe(null);
  });

  it("freshState's homePlanet storage starts at 0 for every material", () => {
    const state = freshState();
    expect(state.homePlanet.storage).toEqual({ commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 });
  });

  it("freshCaptainStack resets mission to null (both prestige tiers cancel an active mission)", () => {
    expect(freshCaptainStack().mission).toBe(null);
  });
});

describe("MISSIONS — launch set", () => {
  it("has exactly 2 missions with the specified tick counts and cargo/extraction values", () => {
    expect(MISSIONS.shortOreRun.transitOutTicks).toBe(3);
    expect(MISSIONS.shortOreRun.transitBackTicks).toBe(3);
    expect(MISSIONS.shortOreRun.unloadTicks).toBe(1);
    expect(MISSIONS.shortOreRun.extractionRatePerTick).toBe(10);
    expect(MISSIONS.shortOreRun.cargoCapacity).toBe(100);

    expect(MISSIONS.longOreRun.transitOutTicks).toBe(8);
    expect(MISSIONS.longOreRun.transitBackTicks).toBe(8);
    expect(MISSIONS.longOreRun.cargoCapacity).toBe(100);
  });

  it("each mission's loot table weights sum to 999 or 1000 (sanity check against typos)", () => {
    for (const key of Object.keys(MISSIONS) as (keyof typeof MISSIONS)[]) {
      const total = MISSIONS[key].lootTable.reduce((sum, entry) => sum + entry.weight, 0);
      expect(total).toBeGreaterThanOrEqual(999);
      expect(total).toBeLessThanOrEqual(1000);
    }
  });

  it("longOreRun has better rare-material odds than shortOreRun", () => {
    const shortRareWeight = MISSIONS.shortOreRun.lootTable.find((e) => e.material === "rareMaterial")!.weight;
    const longRareWeight = MISSIONS.longOreRun.lootTable.find((e) => e.material === "rareMaterial")!.weight;
    expect(longRareWeight).toBeGreaterThan(shortRareWeight);
  });
});

describe("requiredTicksForPhase", () => {
  it("ordersReceived is always exactly 1 tick", () => {
    expect(requiredTicksForPhase("ordersReceived", MISSIONS.shortOreRun)).toBe(1);
  });

  it("transitOut/transitBack/unloading match the mission definition directly", () => {
    expect(requiredTicksForPhase("transitOut", MISSIONS.shortOreRun)).toBe(3);
    expect(requiredTicksForPhase("transitBack", MISSIONS.shortOreRun)).toBe(3);
    expect(requiredTicksForPhase("unloading", MISSIONS.shortOreRun)).toBe(1);
  });

  it("extracting is cargoCapacity / extractionRatePerTick, rounded up", () => {
    // 100 / 10 = exactly 10 -- this plan's launch content is deliberately
    // chosen to divide evenly, sidestepping a partial-final-tick edge case
    // (see this task's Step 3 comment on requiredTicksForPhase for why).
    expect(requiredTicksForPhase("extracting", MISSIONS.shortOreRun)).toBe(10);
  });
});

describe("rollLootTable", () => {
  it("with an rng that always returns 0, always picks the FIRST table entry", () => {
    const material = rollLootTable(MISSIONS.shortOreRun.lootTable, () => 0);
    expect(material).toBe(MISSIONS.shortOreRun.lootTable[0].material); // commonOre
  });

  it("with an rng that always returns just under 1, always picks the LAST table entry", () => {
    const material = rollLootTable(MISSIONS.shortOreRun.lootTable, () => 0.999999);
    const lastEntry = MISSIONS.shortOreRun.lootTable[MISSIONS.shortOreRun.lootTable.length - 1];
    expect(material).toBe(lastEntry.material); // rareMaterial
  });

  it("with an rng landing exactly on the boundary between two entries, picks the SECOND of the two", () => {
    // shortOreRun weights: commonOre 980, uncommonMaterial 19, rareMaterial 1
    // (total 1000). rng() * 1000 = 980.0 lands exactly on the commonOre/
    // uncommonMaterial boundary -- rollLootTable's cumulative-weight walk
    // must use a strict `<` comparison (not `<=`) so a value exactly AT a
    // cumulative boundary falls into the NEXT bucket, not the one that just
    // ended, keeping each bucket's actual probability mass equal to its
    // stated weight (a `<=` comparison would silently make commonOre's
    // effective range 981/1000 instead of 980/1000).
    const material = rollLootTable(MISSIONS.shortOreRun.lootTable, () => 980 / 1000);
    expect(material).toBe("uncommonMaterial");
  });
});
