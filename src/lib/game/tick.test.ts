import { describe, it, expect } from "vitest";
import { tick, tickCaptainStack, prestige, captainPrestige, buySkillNode } from "./tick";
import { freshState, freshCaptains } from "./model";

const NO_RESEARCH_BUFFS = { alloySynthesis: 1 };

describe("tickCaptainStack — closed-form requirement (single captain)", () => {
  it("one big jump equals many small ticks, with modules, research, a specialization, AND a research-speed buff all active", () => {
    const base = freshCaptains(1)[0];
    base.modules.miner = 5;
    base.modules.refinery = 2;
    base.modules.fabricator = 1;
    base.research.alloySynthesis.started = true;
    base.captainPoints = 3;
    base.specialization = "mining";

    const fleetMult = 1.4;
    const researchMults = { alloySynthesis: 0.75 }; // exercises the 4th multiplier alongside the other 3

    const bigJump = tickCaptainStack(3600, base, fleetMult, researchMults);

    let stepped = base;
    for (let i = 0; i < 36000; i++) {
      stepped = tickCaptainStack(0.1, stepped, fleetMult, researchMults);
    }

    expect(bigJump.resources.ore).toBeCloseTo(stepped.resources.ore, 6);
    expect(bigJump.resources.ingots).toBeCloseTo(stepped.resources.ingots, 6);
    expect(bigJump.resources.components).toBeCloseTo(stepped.resources.components, 6);
    expect(bigJump.research.alloySynthesis.progressSeconds).toBeCloseTo(
      stepped.research.alloySynthesis.progressSeconds,
      6
    );
  });

  it("zero delta is a no-op", () => {
    const base = freshCaptains(1)[0];
    base.modules.miner = 3;
    const result = tickCaptainStack(0, base, 1, NO_RESEARCH_BUFFS);
    expect(result).toBe(base);
  });

  it("specialization gives a +25% boost only to its matching resource", () => {
    const base = freshCaptains(1)[0];
    base.modules.miner = 1;
    base.modules.refinery = 1;

    const unspecialized = tickCaptainStack(10, { ...base, specialization: null }, 1, NO_RESEARCH_BUFFS);
    const specialized = tickCaptainStack(10, { ...base, specialization: "mining" }, 1, NO_RESEARCH_BUFFS);

    expect(specialized.resources.ore).toBeCloseTo(unspecialized.resources.ore * 1.25, 6);
    expect(specialized.resources.ingots).toBeCloseTo(unspecialized.resources.ingots, 6);
  });

  it("captainPoints scale that captain's production the same way augmentPoints scale the fleet", () => {
    const base = freshCaptains(1)[0];
    base.modules.miner = 1;

    const noPoints = tickCaptainStack(10, { ...base, captainPoints: 0 }, 1, NO_RESEARCH_BUFFS);
    const withPoints = tickCaptainStack(10, { ...base, captainPoints: 10 }, 1, NO_RESEARCH_BUFFS);

    expect(withPoints.resources.ore).toBeCloseTo(noPoints.resources.ore * 2, 6);
  });

  it("advances progressSeconds for a started, incomplete project", () => {
    const base = freshCaptains(1)[0];
    base.research.alloySynthesis.started = true;

    const result = tickCaptainStack(90, base, 1, NO_RESEARCH_BUFFS);
    expect(result.research.alloySynthesis.progressSeconds).toBe(90);
    expect(result.research.alloySynthesis.completed).toBe(false);
  });

  it("completes exactly at the project's duration", () => {
    const base = freshCaptains(1)[0];
    base.research.alloySynthesis.started = true;

    const result = tickCaptainStack(180, base, 1, NO_RESEARCH_BUFFS);
    expect(result.research.alloySynthesis.progressSeconds).toBe(180);
    expect(result.research.alloySynthesis.completed).toBe(true);
  });

  it("caps progressSeconds at duration, never overshoots", () => {
    const base = freshCaptains(1)[0];
    base.research.alloySynthesis.started = true;

    const result = tickCaptainStack(500, base, 1, NO_RESEARCH_BUFFS);
    expect(result.research.alloySynthesis.progressSeconds).toBe(180);
    expect(result.research.alloySynthesis.completed).toBe(true);
  });

  it("never advances an unstarted project", () => {
    const base = freshCaptains(1)[0];
    const result = tickCaptainStack(1000, base, 1, NO_RESEARCH_BUFFS);
    expect(result.research.alloySynthesis.progressSeconds).toBe(0);
    expect(result.research.alloySynthesis.completed).toBe(false);
  });

  it("a research-speed buff shortens the effective duration (completes sooner, at the scaled duration)", () => {
    const base = freshCaptains(1)[0];
    base.research.alloySynthesis.started = true;

    // 180s * 0.75 = 135s effective duration
    const result = tickCaptainStack(135, base, 1, { alloySynthesis: 0.75 });
    expect(result.research.alloySynthesis.progressSeconds).toBe(135);
    expect(result.research.alloySynthesis.completed).toBe(true);
  });

  it("with no buff (mult 1), duration is unchanged from the base 180s", () => {
    const base = freshCaptains(1)[0];
    base.research.alloySynthesis.started = true;

    const result = tickCaptainStack(135, base, 1, NO_RESEARCH_BUFFS);
    expect(result.research.alloySynthesis.progressSeconds).toBe(135);
    expect(result.research.alloySynthesis.completed).toBe(false); // 135 < 180, not done yet
  });
});

describe("tick — loops tickCaptainStack over every captain, advances fleet gameTimeSeconds once", () => {
  it("applies the same deltaSeconds to every captain independently", () => {
    const state = freshState();
    state.captains = freshCaptains(2);
    state.captains[0].modules.miner = 2;
    state.captains[1].modules.miner = 5;

    const result = tick(10, state);

    expect(result.captains[0].resources.ore).toBeCloseTo(2 * 10, 6);
    expect(result.captains[1].resources.ore).toBeCloseTo(5 * 10, 6);
  });

  it("advances fleet-wide gameTimeSeconds by deltaSeconds exactly once (not once per captain)", () => {
    const state = freshState();
    state.captains = freshCaptains(2);
    const result = tick(10, state);
    expect(result.gameTimeSeconds).toBe(10);
  });

  it("zero delta is a no-op", () => {
    const state = freshState();
    const result = tick(0, state);
    expect(result).toBe(state);
  });

  it("fleet multiplier (augmentPoints) applies equally to every captain", () => {
    const state = freshState();
    state.captains = freshCaptains(2);
    state.captains[0].modules.miner = 1;
    state.captains[1].modules.miner = 1;
    state.augmentPoints = 10;

    const result = tick(10, state);
    expect(result.captains[0].resources.ore).toBeCloseTo(1 * 10 * 2, 6);
    expect(result.captains[1].resources.ore).toBeCloseTo(1 * 10 * 2, 6);
  });

  it("applies an unlocked research-speed node's buff to every captain's matching research", () => {
    const state = freshState();
    state.unlockedSkillNodes = ["researchAlloySynthesisSpeed"];
    state.captains[0].research.alloySynthesis.started = true;

    const result = tick(135, state); // 180 * 0.75 = 135
    expect(result.captains[0].research.alloySynthesis.completed).toBe(true);
  });
});

describe("captainPrestige — per-captain reset (unaffected by this task, re-verify no regression)", () => {
  it("resets only the target captain's stack, leaves other captains untouched", () => {
    const state = freshState();
    state.captains = freshCaptains(2);
    state.captains[0].lifetimeComponents = 100;
    state.captains[0].modules.miner = 50;
    state.captains[1].modules.miner = 7;

    const { next, gained } = captainPrestige(state, 1, "mining");
    expect(gained).toBe(10);
    expect(next.captains[0].modules.miner).toBe(1);
    expect(next.captains[1].modules.miner).toBe(7);
  });

  it("does nothing if gained <= 0", () => {
    const state = freshState();
    const { next, gained } = captainPrestige(state, 1, "mining");
    expect(gained).toBe(0);
    expect(next).toBe(state);
  });
});

describe("prestige — fleet-wide reset now uses earned slot count, grants a Skill Point", () => {
  it("gates on the SUM of lifetimeComponents across all captains", () => {
    const state = freshState();
    state.captains = freshCaptains(2);
    state.captains[0].lifetimeComponents = 36;
    state.captains[1].lifetimeComponents = 64;

    const { gained } = prestige(state);
    expect(gained).toBe(10);
  });

  it("rebuilds the roster at captainSlotCount(state), NOT a hardcoded 2", () => {
    const state = freshState();
    state.unlockedSkillNodes = ["commandRank1", "commandRank2"]; // slot count = 3
    state.captains = freshCaptains(3);
    state.captains[0].lifetimeComponents = 100;
    state.captains[1].modules.miner = 42;
    state.captains[2].modules.miner = 99;

    const { next } = prestige(state);
    expect(next.captains).toHaveLength(3); // NOT 2 -- this is the KNOWN_ISSUES.md fix
    for (const c of next.captains) {
      expect(c.modules.miner).toBe(1); // all reset to the shared floor
    }
  });

  it("grants +1 skillPoints and does NOT reset unlockedSkillNodes/skillPoints", () => {
    const state = freshState();
    state.captains[0].lifetimeComponents = 100;
    state.skillPoints = 2;
    state.unlockedSkillNodes = ["commandRank1"];

    const { next } = prestige(state);
    expect(next.skillPoints).toBe(3); // 2 + 1 earned
    expect(next.unlockedSkillNodes).toEqual(["commandRank1"]); // survives, unlike captain stacks
  });

  it("does nothing if gained <= 0 (skillPoints/unlockedSkillNodes untouched, same object returned)", () => {
    const state = freshState();
    state.skillPoints = 5;
    const { next, gained } = prestige(state);
    expect(gained).toBe(0);
    expect(next).toBe(state);
  });
});

describe("buySkillNode", () => {
  it("buys a node with no prerequisite, deducts cost, unlocks it", () => {
    const state = freshState();
    state.skillPoints = 1;

    const { next, success } = buySkillNode(state, "researchAlloySynthesisSpeed");
    expect(success).toBe(true);
    expect(next.skillPoints).toBe(0);
    expect(next.unlockedSkillNodes).toEqual(["researchAlloySynthesisSpeed"]);
  });

  it("buying a Command node appends exactly one new captain, seeded with the 1-free-miner floor", () => {
    const state = freshState(); // 1 captain
    state.skillPoints = 1;

    const { next, success } = buySkillNode(state, "commandRank1");
    expect(success).toBe(true);
    expect(next.captains).toHaveLength(2);
    expect(next.captains[1].id).toBe(2);
    expect(next.captains[1].label).toBe("Captain 2");
    expect(next.captains[1].modules.miner).toBe(1); // never a repeat of the softlock
  });

  it("fails if the node's prerequisite is not yet unlocked", () => {
    const state = freshState();
    state.skillPoints = 10; // plenty of points, but no prerequisite

    const { next, success } = buySkillNode(state, "commandRank2");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });

  it("succeeds for rank 2 once rank 1 is already unlocked", () => {
    const state = freshState();
    state.skillPoints = 2;
    state.unlockedSkillNodes = ["commandRank1"];
    state.captains = freshCaptains(2); // roster already reflects rank 1

    const { next, success } = buySkillNode(state, "commandRank2");
    expect(success).toBe(true);
    expect(next.captains).toHaveLength(3);
    expect(next.unlockedSkillNodes).toEqual(["commandRank1", "commandRank2"]);
  });

  it("fails if not enough skillPoints", () => {
    const state = freshState();
    state.skillPoints = 0;

    const { next, success } = buySkillNode(state, "researchAlloySynthesisSpeed");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });

  it("fails if the node is already unlocked (no double-purchase)", () => {
    const state = freshState();
    state.skillPoints = 5;
    state.unlockedSkillNodes = ["researchAlloySynthesisSpeed"];

    const { next, success } = buySkillNode(state, "researchAlloySynthesisSpeed");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });
});
