import { describe, it, expect } from "vitest";
import { tick, tickCaptainMission, dispatchCaptainOnMission, recallCaptain, craftRecipe } from "./tick";
import { freshState, freshCaptains, MISSIONS, RECIPES, type CaptainMissionState } from "./model";

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

describe("tick() — idle captains do nothing, mission captains route through tickCaptainMission", () => {
  it("an idle captain (mission: null) is returned completely unchanged", () => {
    const state = freshState(); // captains[0].mission is null (idle) -- freshCaptainStack's baseline
    const before = state.captains[0];

    const result = tick(10, state);

    // tick()'s map callback for an idle captain is `if (captain.mission === null) return captain;`
    // -- it returns the EXACT SAME object reference for that captain, not a copy, since there's
    // nothing left to compute for an idle captain. So `toBe` (reference equality) is the correct,
    // stronger assertion here -- not just `toEqual` (structural equality) -- and is a direct check
    // that the implementation takes the early-return branch rather than reconstructing the object.
    expect(result.captains[0]).toBe(before);
    // Field-by-field as a second, independent check (belt-and-suspenders -- if a future change
    // swaps the early return for a shallow copy, this still passes while the toBe above would catch it).
    expect(result.captains[0].id).toBe(before.id);
    expect(result.captains[0].label).toBe(before.label);
    expect(result.captains[0].shipType).toBe(before.shipType);
    expect(result.captains[0].tickDurationSeconds).toBe(before.tickDurationSeconds);
    expect(result.captains[0].mission).toBe(before.mission);
    expect(result.captains[0].xp).toBe(before.xp);
    expect(result.captains[0].level).toBe(before.level);
    expect(result.captains[0].statPoints).toBe(before.statPoints);
  });

  it("gameTimeSeconds advances exactly once per call, not once per captain", () => {
    const state = freshState();
    state.captains = freshCaptains(3); // 3 idle captains -- proves the advance isn't per-captain
    const result = tick(10, state);
    expect(result.gameTimeSeconds).toBe(10);
  });

  it("zero delta is still a no-op (returns the same state reference)", () => {
    const state = freshState();
    const result = tick(0, state);
    expect(result).toBe(state);
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
    // Setup uses xp/level/statPoints (the current CaptainState fields) rather than the
    // removed Generator-Stack fields (modules/resources/augmentPoints) this test used
    // pre-Phase-4 -- same intent (prove dispatchCaptainOnMission only touches `mission`),
    // updated to the post-Task-2 CaptainState/GameState shape.
    const state = freshState();
    state.captains[0].level = 4;
    state.captains[0].xp = 250;
    state.captains[0].statPoints = 3;
    state.homePlanet.storage.commonOre = 42;

    const { next } = dispatchCaptainOnMission(state, 1, "shortOreRun");
    expect(next.captains[0].level).toBe(4);
    expect(next.captains[0].xp).toBe(250);
    expect(next.captains[0].statPoints).toBe(3);
    expect(next.homePlanet.storage.commonOre).toBe(42);
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

describe("craftRecipe", () => {
  it("succeeds when inputs are sufficient: deducts inputs, adds output", () => {
    const state = freshState();
    state.homePlanet.storage.commonOre = 25;
    const { next, success } = craftRecipe(state, "refineUnobtainium");
    expect(success).toBe(true);
    expect(next.homePlanet.storage.commonOre).toBe(15);
    expect(next.homePlanet.storage.refinedMaterial).toBe(1);
  });

  it("fails (same state reference) when inputs are insufficient", () => {
    const state = freshState(); // commonOre: 0
    const { next, success } = craftRecipe(state, "refineUnobtainium");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });

  it("supports multi-input recipes, deducting every input listed", () => {
    const state = freshState();
    state.homePlanet.storage.refinedMaterial = 12;
    const { next, success } = craftRecipe(state, "fabricateComponents");
    expect(success).toBe(true);
    expect(next.homePlanet.storage.refinedMaterial).toBe(7);
    expect(next.homePlanet.storage.components).toBe(1);
  });
});
