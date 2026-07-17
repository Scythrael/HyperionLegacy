// Fuel Depot pipeline tests -- Fuel Economy v2 F2
// (docs/plans/2026-07-14-fuel-economy-v2-design.md §2).
//
// Covers the Fuel Depot's continuous Deuterium-Ice -> fuel refining, built ON the
// Phase-1 timed-process engine (startProcess/resolveProcesses) reused with a new
// completion effect (addFuel) that targets the GameState.fuel TANK instead of inventory:
//   - The facility relabel (key kept `fuelStorage`, label "Fuel Depot") + the new tunable
//     constants + the derive-on-read helpers (fuelPipelineCount/fuelBatchOutput/Input).
//   - processFuelPipelines: fills free pipeline slots with fuel-refine batches while the
//     tank has room + ice, auto-stops at tank-full / ice-out (no ice stranded), and
//     auto-resumes (structurally) when a block lifts.
//   - economyTick integration: batches consume 50 ice -> produce 100 fuel over 10 ticks,
//     repeating; more pipelines -> more fuel/time; fuel refining awards NO Fleet Admiral XP.
//   - offline == live parity (the coupled-offline proof): tick(bigSpan) == looping
//     economyTick(_,1) across BOTH pause conditions (ice-out and tank-full).
//
// Level-0 depot values (the F2 constants): 1 pipeline, 50 ice -> 100 fuel over 10 ticks,
// tank cap FUEL_TANK_BASE_CAP (500). Upgrade rungs (buildFuelDepotUpgrades, model.ts):
// levels 1-3 = pure cap doublings; level 4 = +1 pipeline; level 5 = yield x1.5 (100->150);
// level 6 = input x0.7 (50->35). Every fixture below is built off those known numbers.

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  economyTick,
  tick,
  fuelCap,
  fuelPipelineCount,
  fuelBatchOutput,
  fuelBatchInput,
  processFuelPipelines,
} from "./tick";
import {
  freshState,
  FACILITIES,
  FUEL_REFINE_INPUT,
  FUEL_REFINE_OUTPUT,
  FUEL_REFINE_DURATION_TICKS,
  FUEL_DEPOT_BASE_PIPELINES,
  FUEL_TANK_BASE_CAP,
  type GameState,
} from "./model";

// A fresh state with a chosen Fuel Depot (fuelStorage) level, ice, and starting fuel, so
// the pipeline / cap / ice gates are exercised against known numbers. freshState's single
// captain stays IDLE (mission: null), so NO mission economy / fuel spend / rng runs --
// these tests isolate the fuel-refining pipelines.
function depotState(opts: { deuteriumIce?: number; fuel?: number; fuelStorageLevel?: number }): GameState {
  const s = freshState();
  const inventory: Record<string, Decimal> = { ...s.inventory };
  if (opts.deuteriumIce !== undefined) inventory.deuteriumIce = new Decimal(opts.deuteriumIce);
  return {
    ...s,
    inventory,
    fuel: new Decimal(opts.fuel ?? 0),
    facilities: { ...s.facilities, fuelStorage: { level: opts.fuelStorageLevel ?? 0 } },
  };
}

// Runs economyTick(state, 1) `n` times (the same per-tick stepping tick()'s offline
// catch-up loop performs). rng is unused by these idle-captain states but passed constant
// for determinism.
function stepTicks(state: GameState, n: number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = economyTick(s, 1, () => 0);
  return s;
}

// A comparable snapshot for the offline==stepped parity assertion. Decimals -> strings;
// fuel batches -> their scalar countdown fields (order stable per resolveProcesses' rebuild).
function fuelSnapshot(state: GameState) {
  return {
    fuel: state.fuel.toString(),
    deuteriumIce: (state.inventory.deuteriumIce ?? new Decimal(0)).toString(),
    processes: state.activeProcesses.map((p) => ({
      id: p.id,
      kind: p.kind,
      remainingTicks: p.remainingTicks,
      durationTicks: p.durationTicks,
    })),
  };
}

const fuelJobs = (s: GameState) => s.activeProcesses.filter((p) => p.kind === "fuelRefineJob");

describe("F2 constants + facility relabel", () => {
  it("exposes the first-pass tunable fuel-refine constants (50 ice -> 100 fuel over 10 ticks, 1 pipeline)", () => {
    expect(FUEL_REFINE_INPUT).toBe(50);
    expect(FUEL_REFINE_OUTPUT).toBe(100);
    expect(FUEL_REFINE_DURATION_TICKS).toBe(10);
    expect(FUEL_DEPOT_BASE_PIPELINES).toBe(1);
  });

  it("relabels the facility to 'Fuel Depot' while KEEPING the internal key `fuelStorage`", () => {
    expect(FACILITIES.fuelStorage).toBeDefined();
    expect(FACILITIES.fuelStorage.label).toBe("Fuel Depot");
    // freshState still seeds the depot under the `fuelStorage` key at level 0 (no key migration).
    expect(freshState().facilities.fuelStorage).toEqual({ level: 0 });
  });
});

describe("derive-on-read helpers (pipelines / yield / input)", () => {
  it("fuelPipelineCount: base 1 at level 0, +1 after the pipeline rung (level 4)", () => {
    expect(fuelPipelineCount(depotState({ fuelStorageLevel: 0 }))).toBe(1);
    expect(fuelPipelineCount(depotState({ fuelStorageLevel: 4 }))).toBe(2);
  });

  it("fuelPipelineCount: 0 when there is NO Fuel Depot record (defensive isolation guard)", () => {
    const s = freshState();
    // A hand-built facilities map that omits fuelStorage (as the refine-order tests do)
    // runs NO pipelines -- the honest reading of "no Fuel Depot".
    const noDepot: GameState = { ...s, facilities: { refinery: { level: 1 } } };
    expect(fuelPipelineCount(noDepot)).toBe(0);
    expect(processFuelPipelines(noDepot)).toBe(noDepot); // same-reference no-op
  });

  it("fuelBatchOutput / fuelBatchInput: base 100 / 50, then 150 / 35 after the yield + input rungs (level 6)", () => {
    expect(fuelBatchOutput(depotState({ fuelStorageLevel: 0 })).toString()).toBe("100");
    expect(fuelBatchInput(depotState({ fuelStorageLevel: 0 })).toString()).toBe("50");
    // Level 6 has reached the yield (x1.5) and input (x0.7) rungs.
    expect(fuelBatchOutput(depotState({ fuelStorageLevel: 6 })).toString()).toBe("150");
    expect(fuelBatchInput(depotState({ fuelStorageLevel: 6 })).toString()).toBe("35");
  });

  it("ANTI-REGRESSION: fuelCap still doubles per level (processing rungs do not disturb the cap)", () => {
    // fuel.test.ts pins levels 1 and 3; re-assert here + a level past the processing rungs.
    expect(fuelCap(depotState({ fuelStorageLevel: 1 })).eq(FUEL_TANK_BASE_CAP * 2)).toBe(true);
    expect(fuelCap(depotState({ fuelStorageLevel: 3 })).eq(FUEL_TANK_BASE_CAP * 8)).toBe(true);
    // Levels 4-6 are processing rungs (no cap change), so the cap stays 8x = 4000.
    expect(fuelCap(depotState({ fuelStorageLevel: 6 })).eq(FUEL_TANK_BASE_CAP * 8)).toBe(true);
  });
});

describe("processFuelPipelines / economyTick -- a batch refines 50 ice -> 100 fuel over durationTicks", () => {
  it("consumes 50 ice at start, deposits 100 fuel on completion (tank space available)", () => {
    const state = depotState({ deuteriumIce: 100, fuel: 0, fuelStorageLevel: 0 });

    // Tick 1: one batch starts -- ice deducted AT START (100 -> 50), fuel not yet added.
    const afterOne = economyTick(state, 1, () => 0);
    expect(fuelJobs(afterOne)).toHaveLength(1);
    expect(afterOne.inventory.deuteriumIce.toString()).toBe("50"); // 50 consumed at start
    expect(afterOne.fuel.toString()).toBe("0"); // batch in flight -- no fuel yet

    // Midway (tick 5): still in flight, still no fuel.
    const midway = stepTicks(state, 5);
    expect(fuelJobs(midway)).toHaveLength(1);
    expect(midway.fuel.toString()).toBe("0");

    // Tick 11: the batch (started tick 1, 10-tick duration) completes -> +100 fuel. With
    // 50 ice left, a SECOND batch starts the same tick (slot freed by completion),
    // consuming the last 50 ice. (Completion is tick 11, not 10: the batch is created
    // AFTER resolveProcesses on its start tick, so it needs 10 later decrements -- the
    // same "done @ start+10" timing the refine-order tests document.)
    const afterDone = stepTicks(state, 11);
    expect(afterDone.fuel.toString()).toBe("100"); // 100 fuel deposited
    expect(afterDone.inventory.deuteriumIce.toString()).toBe("0"); // 100 - 50 - 50 (2nd batch started)
    expect(fuelJobs(afterDone)).toHaveLength(1); // the 2nd batch is now in flight
  });
});

describe("auto-stop -- tank full (fuel >= fuelCap)", () => {
  it("pauses (starts no batch, consumes no ice) when the tank is already at cap", () => {
    // fuel exactly at the level-0 cap (500), ample ice.
    const state = depotState({ deuteriumIce: 500, fuel: FUEL_TANK_BASE_CAP, fuelStorageLevel: 0 });
    const after = economyTick(state, 1, () => 0);
    expect(fuelJobs(after)).toHaveLength(0); // no batch started -- tank full
    expect(after.inventory.deuteriumIce.toString()).toBe("500"); // no ice consumed
    expect(after.fuel.toString()).toBe(String(FUEL_TANK_BASE_CAP)); // unchanged
  });

  it("RESUMES the instant tank room reappears (structural auto-resume)", () => {
    // Start full -> paused. Drop the tank below cap -> a batch starts next tick.
    const paused = economyTick(
      depotState({ deuteriumIce: 500, fuel: FUEL_TANK_BASE_CAP, fuelStorageLevel: 0 }),
      1,
      () => 0
    );
    const roomFreed: GameState = { ...paused, fuel: new Decimal(FUEL_TANK_BASE_CAP - 200) };
    const resumed = economyTick(roomFreed, 1, () => 0);
    expect(fuelJobs(resumed)).toHaveLength(1); // batch started -- room returned
    expect(resumed.inventory.deuteriumIce.toString()).toBe("450"); // 500 - 50
  });
});

describe("auto-stop -- ice out (Deuterium Ice < batch input); no ice stranded", () => {
  it("pauses (starts no batch) when ice < the batch input, leaving the ice UNTOUCHED (not stranded)", () => {
    // 49 ice, batch needs 50 -> no batch can start; the 49 must remain (gate BEFORE consuming).
    const state = depotState({ deuteriumIce: 49, fuel: 0, fuelStorageLevel: 0 });
    const after = economyTick(state, 1, () => 0);
    expect(fuelJobs(after)).toHaveLength(0); // no batch -- not enough ice
    expect(after.inventory.deuteriumIce.toString()).toBe("49"); // NOT stranded -- untouched
    expect(after.fuel.toString()).toBe("0");
  });

  it("RESUMES when ice is replenished", () => {
    const paused = economyTick(depotState({ deuteriumIce: 49, fuel: 0, fuelStorageLevel: 0 }), 1, () => 0);
    const refuelled: GameState = { ...paused, inventory: { ...paused.inventory, deuteriumIce: new Decimal(60) } };
    const resumed = economyTick(refuelled, 1, () => 0);
    expect(fuelJobs(resumed)).toHaveLength(1); // batch started -- ice arrived
    expect(resumed.inventory.deuteriumIce.toString()).toBe("10"); // 60 - 50
  });
});

describe("more pipelines -> more fuel per unit time", () => {
  it("a 2-pipeline depot (level 4) refines TWO batches concurrently: +200 fuel in 10 ticks", () => {
    const state = depotState({ deuteriumIce: 200, fuel: 0, fuelStorageLevel: 4 });
    expect(fuelPipelineCount(state)).toBe(2);

    // Tick 1: BOTH pipelines start a batch -- 2 * 50 = 100 ice consumed at once.
    const afterOne = economyTick(state, 1, () => 0);
    expect(fuelJobs(afterOne)).toHaveLength(2);
    expect(afterOne.inventory.deuteriumIce.toString()).toBe("100"); // 200 - 2*50

    // Tick 11: both complete -> +200 fuel (vs. +100 for a single pipeline). The remaining
    // 100 ice starts 2 more batches the same tick.
    const afterDone = stepTicks(state, 11);
    expect(afterDone.fuel.toString()).toBe("200"); // 2 batches * 100
    expect(afterDone.inventory.deuteriumIce.toString()).toBe("0"); // 200 - 4*50
  });

  it("upgraded yield + reduced input (level 6): a batch consumes 35 ice and yields 150 fuel", () => {
    // 35 ice affords exactly one batch on this 2-pipeline depot; proves both the -input
    // (35 consumed) and +yield (150 produced) upgrades apply to real production.
    const state = depotState({ deuteriumIce: 35, fuel: 0, fuelStorageLevel: 6 });
    const afterDone = stepTicks(state, 11); // batch started tick 1 completes tick 11
    expect(afterDone.fuel.toString()).toBe("150"); // yield x1.5
    expect(afterDone.inventory.deuteriumIce.toString()).toBe("0"); // input 35 consumed
  });
});

describe("fuel refining awards NO Fleet Admiral XP (additive economy, curve untouched)", () => {
  it("completing fuel batches leaves fleetAdminXp / fleetAdminLevel unchanged", () => {
    const state = depotState({ deuteriumIce: 100, fuel: 0, fuelStorageLevel: 0 });
    expect(state.fleetAdminXp.eq(0)).toBe(true);
    // Step past two full batches (each 10 ticks) so completions definitely fire.
    const after = stepTicks(state, 25);
    expect(after.fuel.gt(0)).toBe(true); // non-vacuous: fuel WAS produced
    expect(after.fleetAdminXp.eq(0)).toBe(true); // ...but no FA XP awarded
    expect(after.fleetAdminLevel).toBe(1);
  });
});

describe("⚠️ offline == live PARITY (tick(bigSpan) == looping economyTick(_,1))", () => {
  it("ICE-OUT mid-span: fuel, ice, and in-flight batches all match", () => {
    // 175 ice on a 1-pipeline depot = exactly 3 batches (150 ice), then 25 left < 50 (ice-out).
    // Batches complete @10/@20/@30 -> 300 fuel (well under the 500 cap, so ONLY ice-out fires).
    const make = () => depotState({ deuteriumIce: 175, fuel: 0, fuelStorageLevel: 0 });
    const SPAN = 45;

    const offline = tick(SPAN, make(), () => 0); // internally steps economyTick(_,1) per tick
    const live = stepTicks(make(), SPAN);

    expect(fuelSnapshot(offline)).toEqual(fuelSnapshot(live));
    // Concrete + non-vacuous: 3 batches ran, 300 fuel, 25 ice stranded-but-untouched, none in flight.
    expect(offline.fuel.toString()).toBe("300");
    expect(offline.inventory.deuteriumIce.toString()).toBe("25");
    expect(fuelJobs(offline)).toHaveLength(0);
  });

  it("TANK-FULL mid-span: fuel, ice, and in-flight batches all match", () => {
    // 400 ice on a 1-pipeline depot, cap 500. Batches complete @10..@50 -> fuel hits 500 at
    // tick 50 (5 batches, 250 ice), then TANK-FULL pauses (150 ice remains, never consumed).
    const make = () => depotState({ deuteriumIce: 400, fuel: 0, fuelStorageLevel: 0 });
    const SPAN = 70;

    const offline = tick(SPAN, make(), () => 0);
    const live = stepTicks(make(), SPAN);

    expect(fuelSnapshot(offline)).toEqual(fuelSnapshot(live));
    // Non-vacuous: tank filled to cap, extra ice left unconsumed, no batch in flight.
    expect(offline.fuel.toString()).toBe(String(FUEL_TANK_BASE_CAP)); // 500 -- at cap
    expect(offline.inventory.deuteriumIce.toString()).toBe("150"); // 400 - 5*50
    expect(fuelJobs(offline)).toHaveLength(0);
  });
});
