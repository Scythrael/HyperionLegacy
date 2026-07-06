import { describe, it, expect } from "vitest";
import {
  tick,
  tickCaptainStack,
  prestige,
  captainPrestige,
  buySkillNode,
  tickCaptainMission,
  dispatchCaptainOnMission,
  recallCaptain,
} from "./tick";
import { freshState, freshCaptains, MISSIONS, type CaptainMissionState } from "./model";

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

function missionCaptain(missionKey: "shortOreRun" | "longOreRun" = "shortOreRun"): CaptainMissionState {
  return {
    missionKey,
    phase: "ordersReceived",
    phaseProgressTicks: 0,
    cargo: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 },
    recalled: false,
  };
}

const ALWAYS_COMMON_ORE = () => 0; // lands on the first (commonOre) bucket every time -- see rollLootTable

describe("tickCaptainMission — closed-form requirement", () => {
  it("one big jump equals many small ticks, across multiple phase transitions", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain("shortOreRun");
    // shortOreRun total ticks per cycle: 1 (orders) + 3 (out) + 10 (extract) + 3 (back) + 1 (unload) = 18.
    // 40 ticksElapsed crosses more than one full cycle (auto-repeat).
    const bigJump = tickCaptainMission(40, base, ALWAYS_COMMON_ORE);

    let steppedCaptain = base;
    const steppedDelta = { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 };
    for (let i = 0; i < 400; i++) {
      const result = tickCaptainMission(0.1, steppedCaptain, ALWAYS_COMMON_ORE);
      steppedCaptain = result.captain;
      steppedDelta.commonOre += result.homePlanetDelta.commonOre;
      steppedDelta.uncommonMaterial += result.homePlanetDelta.uncommonMaterial;
      steppedDelta.rareMaterial += result.homePlanetDelta.rareMaterial;
    }

    expect(bigJump.captain.mission).toEqual(steppedCaptain.mission);
    expect(bigJump.homePlanetDelta).toEqual(steppedDelta);
  });

  it("zero or negative ticksElapsed is a no-op", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain();
    const result = tickCaptainMission(0, base, ALWAYS_COMMON_ORE);
    expect(result.captain).toBe(base);
    expect(result.homePlanetDelta).toEqual({ commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 });
  });

  it("a captain with no active mission is returned unchanged", () => {
    const base = freshCaptains(1)[0]; // mission: null
    const result = tickCaptainMission(100, base, ALWAYS_COMMON_ORE);
    expect(result.captain).toBe(base);
  });
});

describe("tickCaptainMission — phase progression", () => {
  it("advances phaseProgressTicks within ordersReceived without completing it", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain();
    const { captain } = tickCaptainMission(0.5, base, ALWAYS_COMMON_ORE);
    expect(captain.mission!.phase).toBe("ordersReceived");
    expect(captain.mission!.phaseProgressTicks).toBeCloseTo(0.5, 6);
  });

  it("completes ordersReceived (1 tick) and moves into transitOut", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain();
    const { captain } = tickCaptainMission(1, base, ALWAYS_COMMON_ORE);
    expect(captain.mission!.phase).toBe("transitOut");
    expect(captain.mission!.phaseProgressTicks).toBe(0);
  });

  it("carries leftover ticks into the next phase in the same call", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain();
    // 1.5 ticks: completes the 1-tick ordersReceived phase, carries 0.5 into transitOut.
    const { captain } = tickCaptainMission(1.5, base, ALWAYS_COMMON_ORE);
    expect(captain.mission!.phase).toBe("transitOut");
    expect(captain.mission!.phaseProgressTicks).toBeCloseTo(0.5, 6);
  });

  it("advances all the way through extracting, transitBack, and unloading in one big call", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain(); // shortOreRun: 1+3+10+3+1 = 18 ticks for one full cycle
    const { captain, homePlanetDelta } = tickCaptainMission(17.9, base, ALWAYS_COMMON_ORE);
    expect(captain.mission!.phase).toBe("unloading");
    expect(captain.mission!.phaseProgressTicks).toBeCloseTo(0.9, 6);
    expect(homePlanetDelta).toEqual({ commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 }); // not unloaded yet
  });
});

describe("tickCaptainMission — extraction loot rolls", () => {
  it("rolls loot once per whole tick crossed during extracting, adding extractionRatePerTick units each time", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // 3.5 ticks of extracting crosses whole boundaries 1, 2, 3 -- 3 rolls, all commonOre (rate 10 each).
    const { captain } = tickCaptainMission(3.5, base, ALWAYS_COMMON_ORE);
    expect(captain.mission!.cargo.commonOre).toBe(30);
    expect(captain.mission!.phaseProgressTicks).toBeCloseTo(3.5, 6);
  });

  it("a large jump resolves every extraction tick's loot roll, not just the last one", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // Exactly 10 ticks completes extracting (cargoCapacity 100 / rate 10).
    const { captain } = tickCaptainMission(10, base, ALWAYS_COMMON_ORE);
    expect(captain.mission!.cargo.commonOre).toBe(100);
    expect(captain.mission!.phase).toBe("transitBack"); // extracting completed, advanced
  });

  it("respects the injected rng for a non-common tier", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    const ALWAYS_RARE = () => 0.9999; // lands in the last bucket (rareMaterial) -- see rollLootTable
    const { captain } = tickCaptainMission(1, base, ALWAYS_RARE);
    expect(captain.mission!.cargo.rareMaterial).toBe(10);
    expect(captain.mission!.cargo.commonOre).toBe(0);
  });
});

describe("tickCaptainMission — cycle completion, auto-repeat, and recall", () => {
  it("completing a full cycle (not recalled) delivers cargo to homePlanetDelta and restarts at ordersReceived", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "unloading", phaseProgressTicks: 0 };
    base.mission.cargo = { commonOre: 90, uncommonMaterial: 8, rareMaterial: 2 };
    const { captain, homePlanetDelta } = tickCaptainMission(1, base, ALWAYS_COMMON_ORE); // 1 tick completes unloadTicks=1

    expect(homePlanetDelta).toEqual({ commonOre: 90, uncommonMaterial: 8, rareMaterial: 2 });
    expect(captain.mission!.phase).toBe("ordersReceived"); // auto-repeated
    expect(captain.mission!.phaseProgressTicks).toBe(0);
    expect(captain.mission!.cargo).toEqual({ commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 }); // reset
    expect(captain.mission!.recalled).toBe(false);
  });

  it("completing a full cycle WHILE recalled ends the mission (mission becomes null)", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "unloading", phaseProgressTicks: 0, recalled: true };
    base.mission.cargo = { commonOre: 50, uncommonMaterial: 0, rareMaterial: 0 };
    const { captain, homePlanetDelta } = tickCaptainMission(1, base, ALWAYS_COMMON_ORE);

    expect(homePlanetDelta).toEqual({ commonOre: 50, uncommonMaterial: 0, rareMaterial: 0 });
    expect(captain.mission).toBe(null);
  });

  it("a big jump can complete multiple full auto-repeat cycles, accumulating homePlanetDelta across all of them", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain(); // shortOreRun, 18 ticks/cycle
    const { captain, homePlanetDelta } = tickCaptainMission(36, base, ALWAYS_COMMON_ORE); // exactly 2 full cycles

    // Each cycle extracts 100 commonOre (10 ticks * 10/tick, always-common rng); 2 cycles = 200.
    expect(homePlanetDelta).toEqual({ commonOre: 200, uncommonMaterial: 0, rareMaterial: 0 });
    expect(captain.mission!.phase).toBe("ordersReceived"); // mid-3rd-cycle-start, not recalled
    expect(captain.mission!.phaseProgressTicks).toBe(0);
  });

  it("recall takes effect at the end of the CURRENT cycle, not immediately", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 5, recalled: true };
    // 3 more ticks: still mid-extraction, far from completing the cycle -- recalled flag is inert until unloading finishes.
    const { captain } = tickCaptainMission(3, base, ALWAYS_COMMON_ORE);
    expect(captain.mission).not.toBe(null);
    expect(captain.mission!.phase).toBe("extracting");
    expect(captain.mission!.phaseProgressTicks).toBeCloseTo(8, 6);
  });
});

describe("tick() — routes captains on a mission through tickCaptainMission instead of production", () => {
  it("a captain on a mission produces NOTHING via their normal Generator Stack this tick", () => {
    const state = freshState();
    state.captains[0].modules.miner = 5; // would normally produce 5 ore/s * fleetMult * capMult * specMult
    state.captains[0].mission = {
      missionKey: "shortOreRun",
      phase: "transitOut",
      phaseProgressTicks: 0,
      cargo: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 },
      recalled: false,
    };

    // tickDurationSeconds defaults to 10 (freshCaptainStack) -> 100s / 10 = 10 mission ticks.
    // tick() branches on captain.mission !== null BEFORE ever calling tickCaptainStack for this
    // captain, so resources.ore must stay at its freshState() starting value of 0 regardless of
    // what tickCaptainMission does internally with those 10 ticks.
    const result = tick(100, state);
    expect(result.captains[0].resources.ore).toBe(0);
  });

  it("a captain with no mission still produces normally (no regression)", () => {
    const state = freshState();
    state.captains[0].modules.miner = 1;
    // mission is null (freshCaptainStack's baseline) -- this captain must go through
    // tickCaptainStack exactly as tickCaptainStack's own describe block already verifies:
    // baseRate 1 * count 1 * fleetMult 1 * capMult 1 * specMult 1 * deltaSeconds 10 = 10.
    const result = tick(10, state);
    expect(result.captains[0].resources.ore).toBeCloseTo(10, 6);
  });

  it("gameTimeSeconds still advances by deltaSeconds exactly once, even with mission captains present", () => {
    const state = freshState();
    state.captains = freshCaptains(2);
    state.captains[0].mission = {
      missionKey: "shortOreRun",
      phase: "ordersReceived",
      phaseProgressTicks: 0,
      cargo: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 },
      recalled: false,
    };
    const result = tick(10, state);
    expect(result.gameTimeSeconds).toBe(10);
  });

  it("mission loot aggregates across all captains on missions into state.homePlanet.storage in one tick() call", () => {
    // Hand-traced against tickCaptainMission's CURRENT implementation (tick.ts):
    //
    // Captain 0: phase "extracting", phaseProgressTicks: 0. tickDurationSeconds=10, deltaSeconds=10
    // -> ticksElapsed = 1. requiredTicks for "extracting" (shortOreRun) = ceil(100/10) = 10.
    // ticksLeftInPhase = 10 - 0 = 10; ticksToApply = min(1, 10) = 1. Epsilon-snap check:
    // |0 + 1 - 10| = 9, not < 1e-9, so ticksToApply stays 1. fromWhole = floor(0) = 0,
    // toWhole = floor(0+1) = 1 -> 1 loot roll, cargo gains 10 units (some tier, rng-dependent).
    // phaseProgressTicks becomes 1, remaining becomes 0. 1 < 10, so phase does NOT complete this
    // tick -- captain 0 stays in "extracting", nothing delivered to homePlanetDelta.
    //
    // Captain 1: phase "extracting", phaseProgressTicks: 9, cargo.commonOre: 90 (pre-seeded, as if
    // 9 prior whole-tick rolls all landed commonOre). Same ticksElapsed = 1. ticksLeftInPhase =
    // 10 - 9 = 1; ticksToApply = min(1, 1) = 1. Epsilon-snap check: |9 + 1 - 10| = 0 < 1e-9 -- true,
    // so ticksToApply recomputed as 10 - 9 = 1 (unchanged, no drift here since these are whole
    // numbers). fromWhole = floor(9) = 9, toWhole = floor(9+1) = 10 -> 1 loot roll, cargo.commonOre
    // becomes 100. phaseProgressTicks becomes 10, which equals requiredTicks (10) -- extracting
    // phase COMPLETES. MISSION_PHASE_ORDER.indexOf("extracting") = 2, nextIndex = 3 ->
    // "transitBack" (not the last phase, "unloading"), so captain 1 advances to "transitBack" with
    // phaseProgressTicks reset to 0. Still no delivery to homePlanetDelta -- that only happens when
    // "unloading" itself completes, which neither captain reaches this tick.
    //
    // So: state.homePlanet.storage must be UNCHANGED (still all zero) after this single tick() call,
    // even though both captains' onboard cargo grew. This is the "in transit, not yet delivered"
    // distinction the design doc draws between a captain's own mission.cargo and homePlanet.storage.
    const state = freshState();
    state.captains = freshCaptains(2);
    state.captains[0].mission = {
      missionKey: "shortOreRun",
      phase: "extracting",
      phaseProgressTicks: 0,
      cargo: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 },
      recalled: false,
    };
    state.captains[1].mission = {
      missionKey: "shortOreRun",
      phase: "extracting",
      phaseProgressTicks: 9,
      cargo: { commonOre: 90, uncommonMaterial: 0, rareMaterial: 0 },
      recalled: false,
    };

    const result = tick(10, state);

    // Captain 0 gained exactly 1 roll's worth (10 units, tier rng-dependent) of onboard cargo.
    const cap0CargoTotal =
      result.captains[0].mission!.cargo.commonOre +
      result.captains[0].mission!.cargo.uncommonMaterial +
      result.captains[0].mission!.cargo.rareMaterial;
    expect(cap0CargoTotal).toBe(10);
    expect(result.captains[0].mission!.phase).toBe("extracting");

    // Captain 1 completed extracting (10/10 ticks), advanced to transitBack, final cargo 100 --
    // asserted as a tier-agnostic total since the final roll's tier is rng-dependent (unmocked
    // Math.random here, same reasoning as captain 0's total check above).
    const cap1CargoTotal =
      result.captains[1].mission!.cargo.commonOre +
      result.captains[1].mission!.cargo.uncommonMaterial +
      result.captains[1].mission!.cargo.rareMaterial;
    expect(cap1CargoTotal).toBe(100);
    expect(result.captains[1].mission!.phase).toBe("transitBack");
    expect(result.captains[1].mission!.phaseProgressTicks).toBe(0);

    // Neither captain reached "unloading" this tick -- nothing delivered home yet.
    expect(result.homePlanet.storage).toEqual({ commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 });
  });

  it("delivers cargo to state.homePlanet.storage, added to existing totals, when a mission's cycle completes this tick", () => {
    // Hand-traced: phase "unloading" with unloadTicks=1 (shortOreRun), phaseProgressTicks: 0.
    // deltaSeconds=10, tickDurationSeconds=10 -> ticksElapsed=1. requiredTicks("unloading")=1.
    // ticksLeftInPhase = 1 - 0 = 1; ticksToApply = min(1,1) = 1. Not "extracting", so no loot roll
    // in this step. phaseProgressTicks becomes 1, remaining becomes 0. 1 >= requiredTicks(1) ->
    // phase completes. MISSION_PHASE_ORDER.indexOf("unloading") = 4 (last), nextIndex = 5 >=
    // length(5) -- cycle complete: cargo {commonOre:70, uncommonMaterial:20, rareMaterial:10} is
    // added to homePlanetDelta, then (recalled: false) mission auto-repeats to "ordersReceived"
    // with phaseProgressTicks 0 and fresh empty cargo.
    //
    // state.homePlanet.storage starts pre-seeded at {commonOre:5, uncommonMaterial:1, rareMaterial:0}
    // (simulating a PRIOR delivery already sitting in storage) to prove this tick's delta is ADDED
    // to existing totals, not overwriting them: expected result = {75, 21, 10}.
    const state = freshState();
    state.homePlanet.storage = { commonOre: 5, uncommonMaterial: 1, rareMaterial: 0 };
    state.captains[0].mission = {
      missionKey: "shortOreRun",
      phase: "unloading",
      phaseProgressTicks: 0,
      cargo: { commonOre: 70, uncommonMaterial: 20, rareMaterial: 10 },
      recalled: false,
    };

    const result = tick(10, state);

    expect(result.homePlanet.storage).toEqual({ commonOre: 75, uncommonMaterial: 21, rareMaterial: 10 });
    expect(result.captains[0].mission!.phase).toBe("ordersReceived"); // auto-repeated
    expect(result.captains[0].mission!.phaseProgressTicks).toBe(0);
    expect(result.captains[0].mission!.cargo).toEqual({ commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 });
  });
});

describe("dispatchCaptainOnMission", () => {
  it("dispatches an idle captain, setting their initial mission state exactly", () => {
    const state = freshState(); // captains[0].mission is null (idle)
    const { next, success } = dispatchCaptainOnMission(state, 1, "shortOreRun");

    expect(success).toBe(true);
    expect(next.captains[0].mission).toEqual({
      missionKey: "shortOreRun",
      phase: "ordersReceived",
      phaseProgressTicks: 0,
      cargo: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 },
      recalled: false,
    });
  });

  it("leaves the rest of the captain and the rest of state untouched", () => {
    const state = freshState();
    state.captains[0].modules.miner = 7;
    state.captains[0].resources.ore = 123;
    state.augmentPoints = 4;

    const { next } = dispatchCaptainOnMission(state, 1, "shortOreRun");
    expect(next.captains[0].modules.miner).toBe(7);
    expect(next.captains[0].resources.ore).toBe(123);
    expect(next.augmentPoints).toBe(4);
  });

  it("fails if the captain is already on a mission (same state reference, unchanged)", () => {
    const state = freshState();
    const { next: dispatched } = dispatchCaptainOnMission(state, 1, "shortOreRun");

    const { next, success } = dispatchCaptainOnMission(dispatched, 1, "longOreRun");
    expect(success).toBe(false);
    expect(next).toBe(dispatched); // same reference, not a fresh copy
    expect(next.captains[0].mission!.missionKey).toBe("shortOreRun"); // unchanged, not overwritten
  });

  it("fails if no captain has the given id, rather than throwing (same state reference, unchanged)", () => {
    const state = freshState();
    const { next, success } = dispatchCaptainOnMission(state, 999, "shortOreRun");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });
});

describe("recallCaptain", () => {
  it("sets recalled: true on the EXISTING mission object without resetting phase/progress/cargo", () => {
    const state = freshState();
    state.captains[0].mission = {
      missionKey: "shortOreRun",
      phase: "extracting",
      phaseProgressTicks: 4.5,
      cargo: { commonOre: 40, uncommonMaterial: 5, rareMaterial: 0 },
      recalled: false,
    };

    const { next, success } = recallCaptain(state, 1);
    expect(success).toBe(true);
    expect(next.captains[0].mission).toEqual({
      missionKey: "shortOreRun",
      phase: "extracting",
      phaseProgressTicks: 4.5,
      cargo: { commonOre: 40, uncommonMaterial: 5, rareMaterial: 0 },
      recalled: true, // only this field flips
    });
  });

  it("fails if the captain has no active mission (same state reference, unchanged)", () => {
    const state = freshState(); // mission: null
    const { next, success } = recallCaptain(state, 1);
    expect(success).toBe(false);
    expect(next).toBe(state);
  });

  it("fails if no captain has the given id, rather than throwing", () => {
    const state = freshState();
    const { next, success } = recallCaptain(state, 999);
    expect(success).toBe(false);
    expect(next).toBe(state);
  });
});

describe("captainPrestige and prestige cancel an active mission (falls out of freshCaptainStack's mission: null)", () => {
  it("captainPrestige resets the prestiged captain's mission to null", () => {
    const state = freshState();
    state.captains[0].lifetimeComponents = 100; // gate: floor(sqrt(100)) = 10, gained > 0
    const { next: dispatched } = dispatchCaptainOnMission(state, 1, "shortOreRun");
    // dispatchCaptainOnMission only touches `mission` on captain 0 -- lifetimeComponents survives
    // via the shallow spread, so no need to re-apply it. Confirm that assumption directly:
    expect(dispatched.captains[0].lifetimeComponents).toBe(100);

    const { next, gained } = captainPrestige(dispatched, 1, "mining");
    expect(gained).toBe(10);
    expect(next.captains[0].mission).toBe(null);
  });

  it("captainPrestige does NOT touch other captains' active missions", () => {
    const state = freshState();
    state.captains = freshCaptains(2);
    state.captains[0].lifetimeComponents = 100;
    const { next: dispatched } = dispatchCaptainOnMission(state, 2, "longOreRun");

    const { next } = captainPrestige(dispatched, 1, "mining");
    expect(next.captains[0].mission).toBe(null); // captain 1 had no mission; still null
    expect(next.captains[1].mission!.missionKey).toBe("longOreRun"); // untouched
  });

  it("Fleet Prestige (prestige()) resets every captain's mission to null (fresh roster has none)", () => {
    const state = freshState();
    state.captains[0].lifetimeComponents = 100; // gate: floor(sqrt(100)) = 10, gained > 0
    const { next: dispatched } = dispatchCaptainOnMission(state, 1, "shortOreRun");
    expect(dispatched.captains[0].lifetimeComponents).toBe(100); // survives the dispatch's shallow spread

    const { next, gained } = prestige(dispatched);
    expect(gained).toBe(10);
    expect(next.captains[0].mission).toBe(null);
  });
});
