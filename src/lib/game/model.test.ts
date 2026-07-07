import { describe, it, expect } from "vitest";
import {
  freshState,
  freshCaptains,
  freshCaptainStack,
  requiredTicksForPhase,
  rollLootTable,
  MISSIONS,
  RECIPES,
  xpForNextLevel,
  CAPTAIN_TALENTS,
  HOMEWORLD_TALENTS,
} from "./model";

describe("freshState — captain roster shape", () => {
  it("starts with exactly 1 captain (Command branch is how the roster grows now)", () => {
    const state = freshState();
    expect(state.captains).toHaveLength(1);
  });

  it("Captain 1 has id 1, label 'Captain 1', shipType resourcer", () => {
    const state = freshState();
    const c1 = state.captains[0];
    expect(c1.id).toBe(1);
    expect(c1.label).toBe("Captain 1");
    expect(c1.shipType).toBe("resourcer");
  });

  it("starts with tickDurationSeconds 10 and xp:0, level:1, statPoints:0", () => {
    const state = freshState();
    for (const c of state.captains) {
      expect(c.tickDurationSeconds).toBe(10);
      expect(c.xp).toBe(0);
      expect(c.level).toBe(1);
      expect(c.statPoints).toBe(0);
    }
  });

  it("fleet-wide fields default to 0", () => {
    const state = freshState();
    expect(state.gameTimeSeconds).toBe(0);
  });
});

describe("freshCaptains(count) — parameterized roster generation", () => {
  it("generates exactly `count` captains with sequential ids/labels, all sharing the fresh baseline", () => {
    const captains = freshCaptains(3);
    expect(captains).toHaveLength(3);
    expect(captains.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(captains.map((c) => c.label)).toEqual(["Captain 1", "Captain 2", "Captain 3"]);
    for (const c of captains) {
      expect(c.shipType).toBe("resourcer");
      expect(c.xp).toBe(0);
      expect(c.level).toBe(1);
      expect(c.statPoints).toBe(0);
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
  it("returns the baseline a brand-new captain slot starts with", () => {
    const stack = freshCaptainStack();
    expect(stack.tickDurationSeconds).toBe(10);
    expect(stack.mission).toBe(null);
    expect(stack.xp).toBe(0);
    expect(stack.level).toBe(1);
    expect(stack.statPoints).toBe(0);
  });
});

describe("freshState / freshCaptainStack — mission and Home Planet fields", () => {
  it("a fresh captain starts with no active mission", () => {
    const captain = freshCaptains(1)[0];
    expect(captain.mission).toBe(null);
  });

  it("freshState's homePlanet storage starts at 0 for every material, including the crafted-good tiers", () => {
    const state = freshState();
    expect(state.homePlanet.storage).toEqual({
      commonOre: 0,
      uncommonMaterial: 0,
      rareMaterial: 0,
      refinedMaterial: 0,
      components: 0,
    });
  });

  it("freshCaptainStack's mission field is null (a brand-new/unlocked captain slot starts idle)", () => {
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

describe("RECIPES — launch set", () => {
  it("has exactly 2 recipes with well-formed inputs/output", () => {
    expect(Object.keys(RECIPES)).toHaveLength(2);
    for (const recipe of Object.values(RECIPES)) {
      expect(Object.keys(recipe.inputs).length).toBeGreaterThan(0);
      expect(recipe.output.amount).toBeGreaterThan(0);
    }
  });
});

describe("xpForNextLevel", () => {
  it("grows with level (100 at level 1, 200 at level 2)", () => {
    expect(xpForNextLevel(1)).toBe(100);
    expect(xpForNextLevel(2)).toBe(200);
  });
});

describe("CAPTAIN_TALENTS — launch set", () => {
  it("Command and Resourcefulness have real nodes; Tactical/Science/Diplomacy are empty", () => {
    const branches = Object.values(CAPTAIN_TALENTS).map((t) => t.branch);
    expect(branches.filter((b) => b === "command").length).toBeGreaterThan(0);
    expect(branches.filter((b) => b === "resourcefulness").length).toBeGreaterThan(0);
    expect(branches.filter((b) => b === "tactical").length).toBe(0);
    expect(branches.filter((b) => b === "science").length).toBe(0);
    expect(branches.filter((b) => b === "diplomacy").length).toBe(0);
  });
});

describe("HOMEWORLD_TALENTS — launch set", () => {
  it("Fleet Logistics, Industry, Economy have real nodes; Homeland Defense/Citizenry are empty", () => {
    const branches = Object.values(HOMEWORLD_TALENTS).map((t) => t.branch);
    expect(branches.filter((b) => b === "fleetLogistics").length).toBeGreaterThan(0);
    expect(branches.filter((b) => b === "industry").length).toBeGreaterThan(0);
    expect(branches.filter((b) => b === "economy").length).toBeGreaterThan(0);
    expect(branches.filter((b) => b === "homelandDefense").length).toBe(0);
    expect(branches.filter((b) => b === "citizenry").length).toBe(0);
  });

  it("Fleet Logistics has exactly 3 unlockCaptainSlot nodes, matching today's CAPTAIN_SLOT_UNLOCKS count", () => {
    const slotNodes = Object.values(HOMEWORLD_TALENTS).filter((t) => t.effect.type === "unlockCaptainSlot");
    expect(slotNodes).toHaveLength(3);
  });
});

describe("freshState / freshCaptainStack — talent and Fleet Admiral fields", () => {
  it("a fresh captain has no unlocked talents", () => {
    expect(freshCaptains(1)[0].unlockedCaptainTalents).toEqual([]);
  });

  it("freshState starts Fleet Admiral at level 1, 0 xp, 0 adminPoints, no unlocked Homeworld talents", () => {
    const state = freshState();
    expect(state.fleetAdminXp).toBe(0);
    expect(state.fleetAdminLevel).toBe(1);
    expect(state.adminPoints).toBe(0);
    expect(state.unlockedHomeworldTalents).toEqual([]);
  });
});
