import { describe, it, expect } from "vitest";
import {
  tick,
  tickCaptainMission,
  dispatchCaptainOnMission,
  recallCaptain,
  craftRecipe,
  buyCaptainTalent,
  buyHomeworldTalent,
  recomputeFleetAdmin,
  captainExtractionYieldMult,
  captainRareLootChanceMult,
  fleetExtractionYieldMult,
} from "./tick";
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

  it("omitting the bonuses arg behaves exactly as before (defaults to no bonus)", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    const { captain } = tickCaptainMission(1, base, ALWAYS_COMMON_ORE); // no 4th arg at all
    expect(captain.mission!.cargo.commonOre).toBe(10); // unmodified extractionRatePerTick
  });

  it("extractionYieldMult scales the per-roll amount added, not the roll count", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // 1 tick = 1 roll; rate 10 * (1 + 0.25) = 12.5 per roll.
    const { captain } = tickCaptainMission(1, base, ALWAYS_COMMON_ORE, { extractionYieldMult: 0.25 });
    expect(captain.mission!.cargo.commonOre).toBe(12.5);
  });

  it("rareLootChanceMult shifts the SAME rng roll from commonOre to a non-common tier", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain("longOreRun"), phase: "extracting", phaseProgressTicks: 0 };
    // longOreRun weights: commonOre 900, uncommonMaterial 80, rareMaterial 20 (total 1000).
    // A fixed rng() of 0.85: with NO bonus, roll = 0.85 * 1000 = 850, which is < commonOre's
    // cumulative weight of 900 -> commonOre. With rareLootChanceMult: 1 (+100%), only the
    // non-common weights double (uncommon 80->160, rare 20->40; commonOre stays 900), giving a
    // new total of 1100 -- the SAME rng() of 0.85 now rolls 0.85 * 1100 = 935, which is past
    // commonOre's still-900 cumulative but under uncommonMaterial's new cumulative of
    // 900+160=1060 -> uncommonMaterial. Same roll, different outcome, purely because the
    // bonus made commonOre a smaller share of a larger total.
    const fixedRoll = () => 0.85;
    const unboosted = tickCaptainMission(1, base, fixedRoll);
    expect(unboosted.captain.mission!.cargo.commonOre).toBe(10);

    const boosted = tickCaptainMission(1, base, fixedRoll, { rareLootChanceMult: 1 });
    expect(boosted.captain.mission!.cargo.uncommonMaterial).toBe(10);
    expect(boosted.captain.mission!.cargo.commonOre).toBe(0);
  });

  it("rareLootChanceMult of 0 (default) leaves the loot table completely unmodified", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain("longOreRun"), phase: "extracting", phaseProgressTicks: 0 };
    // roll = 0.9 * 1000 (unmodified total) = 900, NOT < 900 (commonOre's cumulative) -> falls into uncommonMaterial.
    const rollAt900of1000 = () => 0.9;
    const { captain } = tickCaptainMission(1, base, rollAt900of1000, { rareLootChanceMult: 0 });
    expect(captain.mission!.cargo.uncommonMaterial).toBe(10);
    expect(captain.mission!.cargo.commonOre).toBe(0);
  });
});

describe("captainExtractionYieldMult / captainRareLootChanceMult / fleetExtractionYieldMult", () => {
  it("captainExtractionYieldMult is 0 for a captain with no unlocked talents", () => {
    const captain = freshCaptains(1)[0];
    expect(captainExtractionYieldMult(captain)).toBe(0);
  });

  it("captainExtractionYieldMult stacks additively across multiple unlocked tiers", () => {
    const captain = freshCaptains(1)[0];
    captain.unlockedCaptainTalents = ["commandExtractionI", "commandExtractionII"];
    expect(captainExtractionYieldMult(captain)).toBeCloseTo(0.25, 6); // 0.10 + 0.15
  });

  it("captainExtractionYieldMult ignores unlocked talents of the OTHER effect type", () => {
    const captain = freshCaptains(1)[0];
    captain.unlockedCaptainTalents = ["resourcefulnessRareChanceI"];
    expect(captainExtractionYieldMult(captain)).toBe(0);
  });

  it("captainRareLootChanceMult stacks additively across multiple unlocked tiers", () => {
    const captain = freshCaptains(1)[0];
    captain.unlockedCaptainTalents = ["resourcefulnessRareChanceI", "resourcefulnessRareChanceII"];
    expect(captainRareLootChanceMult(captain)).toBeCloseTo(0.75, 6); // 0.25 + 0.5
  });

  it("fleetExtractionYieldMult is 0 with no unlocked Homeworld Talents", () => {
    const state = freshState();
    expect(fleetExtractionYieldMult(state)).toBe(0);
  });

  it("fleetExtractionYieldMult reads fleetLogisticsYield's mult when unlocked", () => {
    const state = freshState();
    state.unlockedHomeworldTalents = ["fleetLogisticsYield"];
    expect(fleetExtractionYieldMult(state)).toBeCloseTo(0.05, 6);
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

describe("tickCaptainMission — awards XP on cycle completion", () => {
  it("awards no XP when no cycle completes", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain(); // mid-cycle, phaseProgressTicks 0, far from completing
    const { captain } = tickCaptainMission(0.5, base, ALWAYS_COMMON_ORE);
    expect(captain.xp).toBe(0);
    expect(captain.level).toBe(1);
  });

  it("awards XP once when exactly one cycle completes", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "unloading", phaseProgressTicks: 0 };
    const { captain } = tickCaptainMission(1, base, ALWAYS_COMMON_ORE); // 1 tick completes unloadTicks=1
    expect(captain.xp).toBe(50);
    expect(captain.level).toBe(1); // 50 < xpForNextLevel(1)=100, no level-up yet
  });

  it("levels up and grants a stat point when accumulated XP crosses the threshold", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "unloading", phaseProgressTicks: 0 };
    base.xp = 60; // + this cycle's 50 = 110, crosses xpForNextLevel(1)=100
    const { captain } = tickCaptainMission(1, base, ALWAYS_COMMON_ORE);
    expect(captain.level).toBe(2);
    expect(captain.xp).toBe(10); // 110 - 100
    expect(captain.statPoints).toBe(1);
  });

  it("a big jump completing multiple cycles awards XP for EACH cycle, resolving multiple level-ups if crossed", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain(); // shortOreRun, 18 ticks/cycle
    const { captain } = tickCaptainMission(36, base, ALWAYS_COMMON_ORE); // exactly 2 full cycles -> 2 * 50 = 100 XP
    expect(captain.xp).toBe(0); // 100 XP exactly hits xpForNextLevel(1)=100 -> levels to 2 with 0 leftover
    expect(captain.level).toBe(2);
    expect(captain.statPoints).toBe(1);
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
    // Captain 0: phase "extracting", phaseProgressTicks: 0. state.tickDurationSeconds=10, deltaSeconds=10
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
    // Full 5-key shape (Task 5 widened homePlanet.storage to include the crafted-good
    // tiers) since tick() spreads the existing storage forward untouched -- a 3-key
    // expected literal would fail toEqual's strict key-set comparison against the
    // actual 5-key result, even though every value is still correctly 0.
    expect(result.homePlanet.storage).toEqual({
      commonOre: 0,
      uncommonMaterial: 0,
      rareMaterial: 0,
      refinedMaterial: 0,
      components: 0,
    });
  });

  it("delivers cargo to state.homePlanet.storage, added to existing totals, when a mission's cycle completes this tick", () => {
    // Hand-traced: phase "unloading" with unloadTicks=1 (shortOreRun), phaseProgressTicks: 0.
    // deltaSeconds=10, state.tickDurationSeconds=10 -> ticksElapsed=1. requiredTicks("unloading")=1.
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
    state.homePlanet.storage = { commonOre: 5, uncommonMaterial: 1, rareMaterial: 0, refinedMaterial: 0, components: 0 };
    state.captains[0].mission = {
      missionKey: "shortOreRun",
      phase: "unloading",
      phaseProgressTicks: 0,
      cargo: { commonOre: 70, uncommonMaterial: 20, rareMaterial: 10 },
      recalled: false,
    };

    const result = tick(10, state);

    expect(result.homePlanet.storage).toEqual({
      commonOre: 75,
      uncommonMaterial: 21,
      rareMaterial: 10,
      refinedMaterial: 0,
      components: 0,
    });
    expect(result.captains[0].mission!.phase).toBe("ordersReceived"); // auto-repeated
    expect(result.captains[0].mission!.phaseProgressTicks).toBe(0);
    expect(result.captains[0].mission!.cargo).toEqual({ commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 });
  });
});

describe("tick() — Homeworld/Captain Talent effects wired into extraction and passive production", () => {
  it("fleetExtractionYieldMult (Homeworld Talent) boosts a mission captain's extraction via tick()", () => {
    const state = freshState();
    state.unlockedHomeworldTalents = ["fleetLogisticsYield"]; // +0.05 fleetExtractionYieldMult
    state.captains[0].mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };

    const result = tick(10, state); // tickDurationSeconds=10 -> ticksElapsed=1 -> 1 roll

    // extractionRatePerTick 10 * (1 + 0.05) = 10.5. Loot roll uses real Math.random
    // (tick() doesn't accept an rng override), so assert on the material-agnostic TOTAL
    // rather than which specific tier it landed in.
    const totalDelivered =
      result.captains[0].mission!.cargo.commonOre +
      result.captains[0].mission!.cargo.uncommonMaterial +
      result.captains[0].mission!.cargo.rareMaterial;
    expect(totalDelivered).toBeCloseTo(10.5, 6);
  });

  it("captainExtractionYieldMult (Captain Talent) and fleetExtractionYieldMult (Homeworld Talent) stack additively via tick()", () => {
    const state = freshState();
    state.unlockedHomeworldTalents = ["fleetLogisticsYield"]; // +0.05
    state.captains[0].unlockedCaptainTalents = ["commandExtractionI"]; // +0.10
    state.captains[0].mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };

    const result = tick(10, state);

    // extractionRatePerTick 10 * (1 + 0.05 + 0.10) = 11.5
    const totalDelivered =
      result.captains[0].mission!.cargo.commonOre +
      result.captains[0].mission!.cargo.uncommonMaterial +
      result.captains[0].mission!.cargo.rareMaterial;
    expect(totalDelivered).toBeCloseTo(11.5, 6);
  });

  it("passiveTrickle (Homeworld Talent economyTrickle) adds material even with every captain idle", () => {
    const state = freshState();
    state.unlockedHomeworldTalents = ["economyTrickle"]; // commonOre, perTick: 1
    // freshState's single captain is idle (mission: null) by default -- no mission math
    // should run at all, isolating this test to the passive-trickle path.

    const result = tick(10, state); // ticksElapsed = 10/10 = 1 -> 1 * perTick(1) = 1

    expect(result.homePlanet.storage.commonOre).toBe(1);
  });

  it("passiveTrickle scales linearly with ticksElapsed (closed-form, not a per-tick loop)", () => {
    const state = freshState();
    state.unlockedHomeworldTalents = ["economyTrickle"];

    const result = tick(35, state); // ticksElapsed = 35/10 = 3.5 -> 3.5 * 1 = 3.5

    expect(result.homePlanet.storage.commonOre).toBeCloseTo(3.5, 6);
  });

  it("with no unlocked Homeworld Talents, extraction and passive production are unaffected (regression guard)", () => {
    const state = freshState();
    state.captains[0].mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };

    const result = tick(10, state);

    const totalDelivered =
      result.captains[0].mission!.cargo.commonOre +
      result.captains[0].mission!.cargo.uncommonMaterial +
      result.captains[0].mission!.cargo.rareMaterial;
    expect(totalDelivered).toBe(10); // unmodified extractionRatePerTick, exactly one roll
    expect(result.homePlanet.storage.commonOre).toBe(0); // no passive trickle
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

  it("recipeBonusOutput (Homeworld Talent) adds a FLAT bonus to the matching recipe's output, not a multiplier", () => {
    const state = freshState();
    state.unlockedHomeworldTalents = ["industryBonusOutput"]; // recipeKey: fabricateComponents, bonus: 1
    state.homePlanet.storage.refinedMaterial = 5;
    const { next, success } = craftRecipe(state, "fabricateComponents");
    expect(success).toBe(true);
    expect(next.homePlanet.storage.components).toBe(2); // base output 1 + flat bonus 1
  });

  it("recipeBonusOutput does NOT apply to a different recipe than the one it names", () => {
    const state = freshState();
    state.unlockedHomeworldTalents = ["industryBonusOutput"]; // targets fabricateComponents only
    state.homePlanet.storage.commonOre = 10;
    const { next, success } = craftRecipe(state, "refineUnobtainium");
    expect(success).toBe(true);
    expect(next.homePlanet.storage.refinedMaterial).toBe(1); // unmodified base output
  });
});

describe("buyCaptainTalent", () => {
  it("succeeds when affordable and prerequisite met, deducts statPoints, records the unlock", () => {
    const state = freshState();
    state.captains[0].statPoints = 2;
    const { next, success } = buyCaptainTalent(state, 1, "commandExtractionI");
    expect(success).toBe(true);
    expect(next.captains[0].statPoints).toBe(0);
    expect(next.captains[0].unlockedCaptainTalents).toEqual(["commandExtractionI"]);
  });

  it("fails (same state reference) if already unlocked", () => {
    const state = freshState();
    state.captains[0].statPoints = 10;
    const { next: dispatched } = buyCaptainTalent(state, 1, "commandExtractionI");
    const { next, success } = buyCaptainTalent(dispatched, 1, "commandExtractionI");
    expect(success).toBe(false);
    expect(next).toBe(dispatched);
  });

  it("fails if the prerequisite isn't unlocked yet", () => {
    const state = freshState();
    state.captains[0].statPoints = 10;
    const { next, success } = buyCaptainTalent(state, 1, "commandExtractionII");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });

  it("fails if statPoints are insufficient", () => {
    const state = freshState();
    state.captains[0].statPoints = 1; // costs 2
    const { next, success } = buyCaptainTalent(state, 1, "commandExtractionI");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });
});

describe("buyHomeworldTalent", () => {
  it("succeeds for a non-slot node: deducts adminPoints, records the unlock", () => {
    const state = freshState();
    state.adminPoints = 4;
    const { next, success } = buyHomeworldTalent(state, "industryBonusOutput");
    expect(success).toBe(true);
    expect(next.adminPoints).toBe(0);
    expect(next.unlockedHomeworldTalents).toEqual(["industryBonusOutput"]);
  });

  it("succeeds for an unlockCaptainSlot node: also appends a new captain", () => {
    const state = freshState();
    state.adminPoints = 3;
    const { next, success } = buyHomeworldTalent(state, "fleetLogisticsSlot1");
    expect(success).toBe(true);
    expect(next.captains).toHaveLength(2);
    expect(next.captains[1].id).toBe(2);
  });

  it("fails if adminPoints are insufficient", () => {
    const state = freshState();
    state.adminPoints = 2; // costs 3
    const { next, success } = buyHomeworldTalent(state, "fleetLogisticsSlot1");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });

  it("fails (same state reference) if already unlocked", () => {
    const state = freshState();
    state.adminPoints = 10;
    const { next: dispatched } = buyHomeworldTalent(state, "industryBonusOutput");
    const { next, success } = buyHomeworldTalent(dispatched, "industryBonusOutput");
    expect(success).toBe(false);
    expect(next).toBe(dispatched);
  });

  it("fails if the prerequisite isn't unlocked yet", () => {
    const state = freshState();
    state.adminPoints = 10;
    const { next, success } = buyHomeworldTalent(state, "fleetLogisticsSlot2"); // requires fleetLogisticsSlot1
    expect(success).toBe(false);
    expect(next).toBe(state);
  });
});

describe("recomputeFleetAdmin", () => {
  it("no-op when the aggregate captain-level sum hasn't changed", () => {
    const state = freshState();
    state.captains[0].level = 5;
    state.fleetAdminXp = 0;
    // First call establishes the baseline sum; calling again with no captain
    // level change must not re-award XP for the same sum twice.
    const once = recomputeFleetAdmin(state);
    const twice = recomputeFleetAdmin(once);
    expect(twice).toBe(once); // recomputeFleetAdmin's own no-op branch returns the SAME reference
    expect(twice.fleetAdminXp).toBe(once.fleetAdminXp);
    expect(twice.fleetAdminLevel).toBe(once.fleetAdminLevel);
  });

  it("awards Fleet Admiral XP proportional to the SUM of captain levels, with a much steeper curve", () => {
    // Hand-traced against xpForNextFleetAdminLevel(level) = 500 * level * level:
    // captain levels 10 + 5 = targetXp 15. fleetAdminXp starts at 0 (freshState
    // default), so 15 !== 0 -- proceeds past the no-op guard. xp=15, level=1,
    // adminPoints=0. Loop check: 15 >= xpForNextFleetAdminLevel(1)=500? No --
    // loop body never runs. Result: fleetAdminXp=15 (the raw sum, unconsumed),
    // fleetAdminLevel stays 1, adminPoints stays 0.
    const state = freshState();
    state.captains = freshCaptains(2);
    state.captains[0].level = 10;
    state.captains[1].level = 5;
    const result = recomputeFleetAdmin(state);
    expect(result.fleetAdminXp).toBe(15);
    expect(result.fleetAdminLevel).toBe(1);
    expect(result.adminPoints).toBe(0);
  });

  it("a big jump in aggregate captain levels resolves every Fleet Admiral level-up crossed, not just one", () => {
    // NOTE: the plan's original draft used 3 captains at level 50 (sum 150),
    // but under this formula xpForNextFleetAdminLevel(1) = 500 -- a sum of
    // 150 never crosses even the FIRST Fleet Admiral level-up (confirmed by
    // hand-trace, see this task's session report for the full analysis: with
    // today's 4-captain fleet cap, no realistic captain-level sum reaches the
    // design doc's own "level 3-4 Admiral" framing under this formula). That
    // assertion would have been false, not just weak, so the scenario below
    // uses artificially high test-only levels (same convention the removed
    // unlockCaptainSlot test used to establish via `state.captains[0].level =
    // 999`, before that test was deleted in Task 4 of
    // docs/plans/2026-07-07-captain-homeworld-talent-trees-plan.md) purely to
    // exercise the "resolve every level-up in one pass" branch.
    //
    // Hand-traced against the ACTUAL implementation -- recomputeFleetAdmin
    // does NOT decrement `xp` per level crossed (unlike tickCaptainMission's
    // `xp -= xpForNextLevel(level)`); it MUST keep xp as the raw target sum,
    // since the no-op guard at the top (`targetXp === state.fleetAdminXp`)
    // only works if fleetAdminXp always equals the freshly recomputed sum --
    // decrementing it would make that guard misfire on the very next call
    // with an unchanged fleet. sum = 900*3 = 2700, unchanged throughout.
    // xpForNextFleetAdminLevel(1)=500 (2700>=500, crossed, level->2,
    // adminPoints->1); xpForNextFleetAdminLevel(2)=2000 (2700>=2000, crossed,
    // level->3, adminPoints->2); xpForNextFleetAdminLevel(3)=4500
    // (2700<4500, loop stops). Final: fleetAdminLevel=3, adminPoints=2,
    // fleetAdminXp=2700 (the unchanged raw sum).
    const state = freshState();
    state.captains = freshCaptains(3);
    state.captains[0].level = 900;
    state.captains[1].level = 900;
    state.captains[2].level = 900;
    const result = recomputeFleetAdmin(state);
    expect(result.fleetAdminLevel).toBe(3);
    expect(result.adminPoints).toBe(2);
    expect(result.fleetAdminXp).toBe(2700);
    expect(result.fleetAdminLevel).toBeGreaterThan(1); // preserves the plan's original intent-check
    expect(result.adminPoints).toBeGreaterThan(0);
  });
});
