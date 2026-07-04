import { describe, it, expect } from "vitest";
import { tick, tickCaptainStack, prestige, captainPrestige } from "./tick";
import { freshState, freshCaptains } from "./model";

describe("tickCaptainStack — closed-form requirement (single captain)", () => {
  it("one big jump equals many small ticks, with modules, research, AND a specialization all active", () => {
    const base = freshCaptains()[0];
    base.modules.miner = 5;
    base.modules.refinery = 2;
    base.modules.fabricator = 1;
    base.research.alloySynthesis.started = true;
    base.captainPoints = 3;
    base.specialization = "mining"; // exercises specMult alongside fleetMult/capMult

    const fleetMult = 1.4; // arbitrary fixed fleet multiplier for this test

    const bigJump = tickCaptainStack(3600, base, fleetMult);

    let stepped = base;
    for (let i = 0; i < 36000; i++) {
      stepped = tickCaptainStack(0.1, stepped, fleetMult);
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
    const base = freshCaptains()[0];
    base.modules.miner = 3;
    const result = tickCaptainStack(0, base, 1);
    expect(result).toBe(base);
  });

  it("specialization gives a +25% boost only to its matching resource", () => {
    const base = freshCaptains()[0];
    base.modules.miner = 1;
    base.modules.refinery = 1;

    const unspecialized = tickCaptainStack(10, { ...base, specialization: null }, 1);
    const specialized = tickCaptainStack(10, { ...base, specialization: "mining" }, 1);

    expect(specialized.resources.ore).toBeCloseTo(unspecialized.resources.ore * 1.25, 6);
    expect(specialized.resources.ingots).toBeCloseTo(unspecialized.resources.ingots, 6); // unaffected
  });

  it("captainPoints scale that captain's production the same way augmentPoints scale the fleet", () => {
    const base = freshCaptains()[0];
    base.modules.miner = 1;

    const noPoints = tickCaptainStack(10, { ...base, captainPoints: 0 }, 1);
    const withPoints = tickCaptainStack(10, { ...base, captainPoints: 10 }, 1); // captainMult = 2x

    expect(withPoints.resources.ore).toBeCloseTo(noPoints.resources.ore * 2, 6);
  });
});

describe("tick — loops tickCaptainStack over every captain, advances fleet gameTimeSeconds once", () => {
  it("applies the same deltaSeconds to every captain independently", () => {
    const state = freshState();
    state.captains[0].modules.miner = 2;
    state.captains[1].modules.miner = 5; // different loadout, must not affect captain 0's math

    const result = tick(10, state);

    expect(result.captains[0].resources.ore).toBeCloseTo(2 * 10, 6);
    expect(result.captains[1].resources.ore).toBeCloseTo(5 * 10, 6);
  });

  it("advances fleet-wide gameTimeSeconds by deltaSeconds exactly once (not once per captain)", () => {
    const state = freshState(); // 2 captains
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
    state.captains[0].modules.miner = 1;
    state.captains[1].modules.miner = 1;
    state.augmentPoints = 10; // fleetMult = 2x

    const result = tick(10, state);
    expect(result.captains[0].resources.ore).toBeCloseTo(1 * 10 * 2, 6);
    expect(result.captains[1].resources.ore).toBeCloseTo(1 * 10 * 2, 6);
  });
});

describe("captainPrestige — per-captain reset", () => {
  it("resets only the target captain's stack, leaves the other captain untouched", () => {
    const state = freshState();
    state.captains[0].lifetimeComponents = 100; // sqrt(100) = 10 captainPoints
    state.captains[0].modules.miner = 50;
    state.captains[1].modules.miner = 7; // must survive untouched

    const { next, gained } = captainPrestige(state, 1, "mining");
    expect(gained).toBe(10);
    expect(next.captains[0].modules.miner).toBe(1); // reset to the 1-free-miner baseline
    expect(next.captains[0].lifetimeComponents).toBe(0);
    expect(next.captains[0].captainPoints).toBe(10);
    expect(next.captains[0].captainPrestigeCount).toBe(1);
    expect(next.captains[0].specialization).toBe("mining");
    expect(next.captains[1].modules.miner).toBe(7); // untouched
  });

  it("does nothing if gained <= 0", () => {
    const state = freshState(); // lifetimeComponents 0 for both captains
    const { next, gained } = captainPrestige(state, 1, "mining");
    expect(gained).toBe(0);
    expect(next).toBe(state);
  });

  it("accumulates captainPoints across repeated prestiges and allows respeccing", () => {
    const state = freshState();
    state.captains[0].lifetimeComponents = 100; // +10 points

    const { next: afterFirst } = captainPrestige(state, 1, "mining");
    afterFirst.captains[0].lifetimeComponents = 400; // +20 points

    const { next: afterSecond } = captainPrestige(afterFirst, 1, "refining");
    expect(afterSecond.captains[0].captainPoints).toBe(30); // 10 + 20
    expect(afterSecond.captains[0].captainPrestigeCount).toBe(2);
    expect(afterSecond.captains[0].specialization).toBe("refining"); // respecced
  });
});

describe("prestige — fleet-wide reset (extended for multi-captain)", () => {
  it("gates on the SUM of lifetimeComponents across all captains", () => {
    const state = freshState();
    state.captains[0].lifetimeComponents = 36; // sqrt(36) = 6
    state.captains[1].lifetimeComponents = 64; // sqrt(64) = 8, but combined: sqrt(100) = 10

    const { gained } = prestige(state);
    expect(gained).toBe(10);
  });

  it("collapses the whole captains array back to the starting 2-captain shape", () => {
    const state = freshState();
    state.captains[0].lifetimeComponents = 100;
    state.captains[0].captainPoints = 999;
    state.captains[0].specialization = "mining";
    state.captains[1].modules.miner = 42;

    const { next } = prestige(state);
    expect(next.captains).toHaveLength(2);
    expect(next.captains[0].captainPoints).toBe(0);
    expect(next.captains[0].specialization).toBe(null);
    expect(next.captains[0].modules.miner).toBe(1); // back to Captain 1's head start
    expect(next.captains[1].modules.miner).toBe(0); // back to Captain 2's empty start
  });

  it("carries augmentPoints/prestigeCount/gameTimeSeconds forward, does nothing if gained <= 0", () => {
    const state = freshState();
    state.gameTimeSeconds = 500;
    const { next, gained } = prestige(state);
    expect(gained).toBe(0);
    expect(next).toBe(state);
  });

  it("yields nothing on a second immediate prestige with no new components produced", () => {
    const state = freshState();
    state.captains[0].lifetimeComponents = 100;

    const { next: afterFirst } = prestige(state);
    const { gained: secondGain } = prestige(afterFirst);
    expect(secondGain).toBe(0);
  });
});
