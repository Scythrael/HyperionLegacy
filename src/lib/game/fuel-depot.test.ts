// Fuel Depot pipeline tests, Fuel Economy v2 F2
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
//   ⚠️ 0.13.9 hotfix: the pipelines are RETIRED (processFuelPipelines starts nothing), so the
//   engine suites below now assert NO start plus in-flight completion; see the banner there.
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
import { itemTotal } from "./inventory"; // Task 9a: read item TOTAL across quality buckets
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
  const inventory: Record<string, Decimal[]> = { ...s.inventory };
  if (opts.deuteriumIce !== undefined) inventory.deuteriumIce = [new Decimal(opts.deuteriumIce)];
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
    deuteriumIce: itemTotal(state.inventory, "deuteriumIce").toString(),
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
    // runs NO pipelines, the honest reading of "no Fuel Depot".
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

// ============================================================================
// 0.13.9 hotfix: THE PIPELINES ARE RETIRED (processFuelPipelines starts nothing).
//
// Fuel-to-reach (0.13.6) made fuel a STAT, but the hidden Fuel Depot kept auto-refining a
// player's leftover Deuterium Ice (sellable at the Quartermaster) into an unused tank. The
// suites below REPLACE the old "a batch starts / auto-stops / auto-resumes / more pipelines
// refine more" coverage, which described behavior the hotfix deliberately removed. What is
// still asserted, and why each matters:
//   - NO START, in every condition the old gates covered (tank room, tank full, plenty of ice,
//     short ice, a 2-pipeline depot): ice is never consumed and no batch appears.
//   - AN IN-FLIGHT BATCH FROM AN OLDER SAVE STILL COMPLETES (deposit clamped at the cap, no FA
//     XP), so the retirement strands nothing; the old deposit-clamp and no-FA-XP guards now run
//     against a seeded batch instead of one the engine started.
//   - offline == live parity still holds with a batch in flight.
// ============================================================================

// One in-flight fuel batch as an older save would carry it (the shape startProcess minted).
function inFlightBatch(amount: number, remainingTicks: number, id = "proc-legacy-1") {
  return {
    id,
    kind: "fuelRefineJob" as const,
    remainingTicks,
    durationTicks: FUEL_REFINE_DURATION_TICKS,
    effect: { type: "addFuel" as const, amount: new Decimal(amount) },
  };
}

describe("RETIRED (0.13.9): the Fuel Depot starts no batch and consumes no Deuterium Ice", () => {
  it("processFuelPipelines is a same-reference no-op even with tank room, ice, and pipelines", () => {
    const state = depotState({ deuteriumIce: 500, fuel: 0, fuelStorageLevel: 4 });
    expect(fuelPipelineCount(state)).toBe(2); // non-vacuous: the depot WOULD have run 2 pipelines
    expect(processFuelPipelines(state)).toBe(state);
  });

  const cases: { label: string; opts: { deuteriumIce: number; fuel: number; fuelStorageLevel: number } }[] = [
    { label: "an empty tank with ample ice (the old 'batch starts' case)", opts: { deuteriumIce: 100, fuel: 0, fuelStorageLevel: 0 } },
    { label: "a full tank (the old tank-full pause)", opts: { deuteriumIce: 500, fuel: FUEL_TANK_BASE_CAP, fuelStorageLevel: 0 } },
    { label: "too little ice for a batch (the old ice-out pause)", opts: { deuteriumIce: 49, fuel: 0, fuelStorageLevel: 0 } },
    { label: "a 2-pipeline, upgraded depot (the old 'more pipelines' case)", opts: { deuteriumIce: 200, fuel: 0, fuelStorageLevel: 6 } },
  ];
  for (const c of cases) {
    it(`over many ticks: no batch, ice untouched, tank unchanged, for ${c.label}`, () => {
      const state = depotState(c.opts);
      const after = stepTicks(state, 25);
      expect(fuelJobs(after)).toHaveLength(0);
      expect(itemTotal(after.inventory, "deuteriumIce").toString()).toBe(String(c.opts.deuteriumIce));
      expect(after.fuel.toString()).toBe(String(c.opts.fuel));
    });
  }
});

describe("RETIRED (0.13.9): a batch already in flight in a save still completes (nothing stranded)", () => {
  it("deposits its fuel on completion and starts no follow-up batch from the remaining ice", () => {
    const base = depotState({ deuteriumIce: 100, fuel: 0, fuelStorageLevel: 0 });
    const state: GameState = { ...base, activeProcesses: [inFlightBatch(FUEL_REFINE_OUTPUT, 3)] };
    const after = stepTicks(state, 5);
    expect(after.fuel.toString()).toBe(String(FUEL_REFINE_OUTPUT)); // the in-flight batch landed
    expect(fuelJobs(after)).toHaveLength(0); // and no new batch replaced it
    expect(itemTotal(after.inventory, "deuteriumIce").toString()).toBe("100"); // ice untouched
  });

  it("ANTI-REGRESSION (deposit clamp): a completing batch still tops up to EXACTLY the cap (450 + 100 -> 500)", () => {
    const base = depotState({ fuel: 450, fuelStorageLevel: 0 });
    const after = stepTicks({ ...base, activeProcesses: [inFlightBatch(100, 2)] }, 3);
    expect(after.fuel.toString()).toBe(String(FUEL_TANK_BASE_CAP)); // 500, clamped (not 550)
    expect(after.fuel.lte(fuelCap(after))).toBe(true);
  });

  it("completing a batch awards NO Fleet Admiral XP", () => {
    const base = depotState({ fuel: 0, fuelStorageLevel: 0 });
    const after = stepTicks({ ...base, activeProcesses: [inFlightBatch(100, 2)] }, 3);
    expect(after.fuel.gt(0)).toBe(true); // non-vacuous: the batch did complete
    expect(after.fleetAdminXp.eq(0)).toBe(true);
    expect(after.fleetAdminLevel).toBe(1);
  });
});

describe("⚠️ offline == live PARITY (tick(bigSpan) == looping economyTick(_,1)), pipelines retired", () => {
  it("an in-flight batch plus leftover ice: fuel, ice, and processes all match", () => {
    const make = (): GameState => ({
      ...depotState({ deuteriumIce: 175, fuel: 0, fuelStorageLevel: 4 }),
      activeProcesses: [inFlightBatch(100, 7, "proc-legacy-a"), inFlightBatch(100, 12, "proc-legacy-b")],
    });
    const SPAN = 45;
    const offline = tick(SPAN, make(), () => 0);
    const live = stepTicks(make(), SPAN);
    expect(fuelSnapshot(offline)).toEqual(fuelSnapshot(live));
    // Non-vacuous: both legacy batches landed, no new one started, the ice is untouched.
    expect(offline.fuel.toString()).toBe("200");
    expect(itemTotal(offline.inventory, "deuteriumIce").toString()).toBe("175");
    expect(fuelJobs(offline)).toHaveLength(0);
  });
});
