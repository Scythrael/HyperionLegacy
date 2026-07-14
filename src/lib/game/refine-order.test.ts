// Refine-ORDER engine tests — Phase 2, Task D1
// (docs/plans/2026-07-13-phase-2-warehouse-refine-economy-design.md §4).
//
// Covers the standing refine-order layer built ON TOP of Phase 1's single-job
// startRefineJob:
//   - startRefineOrder / stopRefineOrder: set/replace/clear the standing order (pure).
//   - processRefineOrder: the per-tick engine that fills free refine slots with jobs
//     while unblocked, pauses with a reason when blocked (input-exhausted /
//     output-full), auto-resumes when unblocked, decrements a batch's remaining, and
//     clears a batch at 0.
//   - economyTick integration: the order rides the SAME economyTick seam as the Task
//     B3 auto-stop, so it behaves identically live and in the offline per-tick loop
//     (the big-jump == stepped parity test at the bottom is the coupled-offline proof).
//
// The refinery's single Phase-1 recipe (REFINE_RECIPES.refineCommonOre) is
// commonOre x100 -> refinedMaterial x1 over 10 ticks; T1 warehouse cap at level 0 is
// 1,000,000 (design §3.3). Every fixture below is built off those known numbers.

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  startRefineOrder,
  stopRefineOrder,
  processRefineOrder,
  economyTick,
  tick,
  refineSlotCount,
  materialAtCap,
} from "./tick";
import { freshState, type GameState, type RefineOrder } from "./model";

// A fresh state with a chosen refinery level, warehouse-T1 level, and inventory, so
// the slot / afford / cap gates are exercised against known numbers rather than
// freshState's all-zero, level-0 seed. Mirrors refine.test.ts's stateWith helper,
// extended with the warehouse level (which sets the output cap via tierCap) and the
// refineOrder seed. The captain stays IDLE (freshState's captain has mission: null),
// so no mission economy / rng runs -- these tests isolate the order engine.
function orderState(opts: {
  commonOre?: number;
  refinedMaterial?: number;
  refineryLevel?: number;
  warehouseT1Level?: number;
  order?: RefineOrder | null;
}): GameState {
  const s = freshState();
  const inventory: Record<string, Decimal> = { ...s.inventory };
  if (opts.commonOre !== undefined) inventory.commonOre = new Decimal(opts.commonOre);
  if (opts.refinedMaterial !== undefined) inventory.refinedMaterial = new Decimal(opts.refinedMaterial);
  return {
    ...s,
    inventory,
    facilities: {
      refinery: { level: opts.refineryLevel ?? 1 }, // level 1 => 1 refine slot
      warehouseT1: { level: opts.warehouseT1Level ?? 0 },
      warehouseT2: { level: 0 },
    },
    refineOrder: opts.order ?? null,
  };
}

// Runs economyTick(state, 1) `n` times, returning the final state. The tests use this
// to drive the order through real ticks (jobs start, count down, complete, refill) --
// the same per-tick stepping tick()'s offline catch-up loop performs.
function stepTicks(state: GameState, n: number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = economyTick(s, 1);
  return s;
}

// A comparable snapshot of the order-relevant state, for the offline==stepped parity
// assertion. Decimals -> strings; processes -> their scalar fields (order is stable
// per resolveProcesses' rebuild); refineOrder is a plain object (no Decimal), compared
// as-is.
function orderSnapshot(state: GameState) {
  return {
    commonOre: state.inventory.commonOre.toString(),
    refinedMaterial: (state.inventory.refinedMaterial ?? new Decimal(0)).toString(),
    processes: state.activeProcesses.map((p) => ({
      id: p.id,
      kind: p.kind,
      remainingTicks: p.remainingTicks,
      durationTicks: p.durationTicks,
    })),
    refineOrder: state.refineOrder,
  };
}

describe("startRefineOrder / stopRefineOrder — set, replace, clear (pure)", () => {
  it("sets a batch order (running, no pausedReason) without mutating the input", () => {
    const state = orderState({});
    const next = startRefineOrder(state, "refineCommonOre", { kind: "batch", remaining: 5 });
    expect(next.refineOrder).toEqual({ recipeKey: "refineCommonOre", mode: { kind: "batch", remaining: 5 } });
    expect(next.refineOrder?.pausedReason).toBeUndefined(); // fresh order is running
    expect(state.refineOrder).toBeNull(); // input untouched (immutability)
  });

  it("sets a continuous order", () => {
    const next = startRefineOrder(orderState({}), "refineCommonOre", { kind: "continuous" });
    expect(next.refineOrder).toEqual({ recipeKey: "refineCommonOre", mode: { kind: "continuous" } });
  });

  it("REPLACES an existing order wholesale (last write wins)", () => {
    const withBatch = startRefineOrder(orderState({}), "refineCommonOre", { kind: "batch", remaining: 3 });
    const replaced = startRefineOrder(withBatch, "refineCommonOre", { kind: "continuous" });
    expect(replaced.refineOrder).toEqual({ recipeKey: "refineCommonOre", mode: { kind: "continuous" } });
  });

  it("is a same-reference no-op for an unknown recipe key (never installs an unrunnable order)", () => {
    const state = orderState({});
    const next = startRefineOrder(state, "notARealRecipe", { kind: "continuous" });
    expect(next).toBe(state); // same reference
    expect(next.refineOrder).toBeNull();
  });

  it("stopRefineOrder clears an active order; is a same-reference no-op when none is set", () => {
    const withOrder = startRefineOrder(orderState({}), "refineCommonOre", { kind: "continuous" });
    const stopped = stopRefineOrder(withOrder);
    expect(stopped.refineOrder).toBeNull();

    const none = orderState({});
    expect(stopRefineOrder(none)).toBe(none); // idempotent same-ref no-op
  });
});

describe("processRefineOrder — batch N with inputs for K < N (pauses noInput, auto-resumes)", () => {
  it("starts K jobs, pauses noInput with (N-K) remaining, then resumes when input arrives", () => {
    // 3 slots so multiple jobs can start in ONE processRefineOrder call; input for
    // exactly 2 jobs (250 ore, recipe costs 100 each -> 2 affordable, 50 left over);
    // batch of 5. Expect: 2 jobs started, 200 ore deducted, paused noInput, remaining 3.
    const state = orderState({
      commonOre: 250,
      refineryLevel: 3, // 3 refine slots
      order: { recipeKey: "refineCommonOre", mode: { kind: "batch", remaining: 5 } },
    });
    expect(refineSlotCount(state)).toBe(3);

    const paused = processRefineOrder(state);
    const refineJobs = paused.activeProcesses.filter((p) => p.kind === "refineJob");
    expect(refineJobs).toHaveLength(2); // K = 2 jobs started (only 2 affordable)
    expect(paused.inventory.commonOre.toString()).toBe("50"); // 250 - 2*100
    expect(paused.refineOrder).toEqual({
      recipeKey: "refineCommonOre",
      mode: { kind: "batch", remaining: 3 }, // N - K = 5 - 2
      pausedReason: "noInput",
    });

    // A farming captain lands more ore -> next processRefineOrder resumes it. Add 150
    // (total 200 -> 2 more jobs affordable), but only 1 free slot remains (2 of 3
    // busy), so exactly ONE more job starts this call; pausedReason clears.
    const refuelled: GameState = {
      ...paused,
      inventory: { ...paused.inventory, commonOre: new Decimal(200) },
    };
    const resumed = processRefineOrder(refuelled);
    expect(resumed.activeProcesses.filter((p) => p.kind === "refineJob")).toHaveLength(3); // slots now full
    expect(resumed.inventory.commonOre.toString()).toBe("100"); // 200 - 1*100
    expect(resumed.refineOrder).toEqual({
      recipeKey: "refineCommonOre",
      mode: { kind: "batch", remaining: 2 }, // 3 - 1 started
    });
    expect(resumed.refineOrder?.pausedReason).toBeUndefined(); // auto-resumed
  });
});

describe("processRefineOrder — output-full pause + auto-resume (design §3.4 / §4.2)", () => {
  it("pauses outputFull when the output is at its warehouse cap; resumes when the cap clears", () => {
    // refinedMaterial at exactly the T1 cap (1,000,000) => materialAtCap true.
    const atCap = orderState({
      commonOre: 1000,
      refinedMaterial: 1_000_000,
      refineryLevel: 1,
      order: { recipeKey: "refineCommonOre", mode: { kind: "continuous" } },
    });
    expect(materialAtCap(atCap, "refinedMaterial")).toBe(true);

    const paused = processRefineOrder(atCap);
    expect(paused.activeProcesses).toHaveLength(0); // no job started -- output is full
    expect(paused.inventory.commonOre.toString()).toBe("1000"); // no input deducted
    expect(paused.refineOrder?.pausedReason).toBe("outputFull");

    // Cap clears (some refinedMaterial consumed / spent) -> the order resumes.
    const cleared: GameState = {
      ...paused,
      inventory: { ...paused.inventory, refinedMaterial: new Decimal(500_000) },
    };
    const resumed = processRefineOrder(cleared);
    expect(resumed.activeProcesses.filter((p) => p.kind === "refineJob")).toHaveLength(1); // job started
    expect(resumed.inventory.commonOre.toString()).toBe("900"); // 1000 - 100
    expect(resumed.refineOrder?.pausedReason).toBeUndefined(); // auto-resumed
  });

  it("output-full is reported ahead of no-input when BOTH would block (more specific storage block)", () => {
    // Output at cap AND no input (0 commonOre): the reason is outputFull, not noInput.
    const state = orderState({
      commonOre: 0,
      refinedMaterial: 1_000_000,
      refineryLevel: 1,
      order: { recipeKey: "refineCommonOre", mode: { kind: "continuous" } },
    });
    expect(processRefineOrder(state).refineOrder?.pausedReason).toBe("outputFull");
  });
});

describe("processRefineOrder — slot cap (fills up to refineSlotCount, not more)", () => {
  it("a continuous order with ample input fills EXACTLY refineSlotCount slots in one call", () => {
    const state = orderState({
      commonOre: 1000, // enough for 10 jobs
      refineryLevel: 3, // 3 slots
      order: { recipeKey: "refineCommonOre", mode: { kind: "continuous" } },
    });
    const filled = processRefineOrder(state);
    expect(filled.activeProcesses.filter((p) => p.kind === "refineJob")).toHaveLength(3); // 3, not 4+
    expect(filled.inventory.commonOre.toString()).toBe("700"); // 1000 - 3*100
    expect(filled.refineOrder?.pausedReason).toBeUndefined(); // slots busy is NOT a pause
  });

  it("does not start any job at 0 slots (unbuilt refinery), and does not pause (slot-busy is not a block)", () => {
    const state = orderState({
      commonOre: 1000,
      refineryLevel: 0, // 0 slots
      order: { recipeKey: "refineCommonOre", mode: { kind: "continuous" } },
    });
    const result = processRefineOrder(state);
    expect(result.activeProcesses).toHaveLength(0);
    expect(result.inventory.commonOre.toString()).toBe("1000"); // nothing deducted
    expect(result.refineOrder?.pausedReason).toBeUndefined();
  });

  it("is a same-reference no-op when there is no order", () => {
    const state = orderState({ commonOre: 1000, refineryLevel: 3 });
    expect(processRefineOrder(state)).toBe(state);
  });
});

describe("economyTick integration — batch drains one iteration at a time, then clears", () => {
  it("a batch of 3 on a single-slot refinery completes 3 jobs across ticks, then clears the order", () => {
    // 1 slot => jobs run sequentially. Each takes 10 ticks. Batch of 3, 1000 ore.
    const state = orderState({
      commonOre: 1000,
      refineryLevel: 1,
      order: { recipeKey: "refineCommonOre", mode: { kind: "batch", remaining: 3 } },
    });

    // Step well past 3 full 10-tick jobs (job3 STARTS at tick 21 -> order clears then;
    // job3 COMPLETES at tick 31). 40 ticks is comfortably past.
    const done = stepTicks(state, 40);

    expect(done.inventory.refinedMaterial.toString()).toBe("3"); // 3 jobs completed
    expect(done.inventory.commonOre.toString()).toBe("700"); // 1000 - 3*100
    expect(done.activeProcesses).toHaveLength(0); // all jobs finished
    expect(done.refineOrder).toBeNull(); // batch cleared at remaining 0
    // Discovery + lifetime accrual flow through the normal refineJob completion seam.
    expect(done.discovered).toContain("refinedMaterial");
    expect(done.lifetimeStats.itemsRefined.refinedMaterial.toString()).toBe("3");
  });

  it("a batch never over-produces: exactly N outputs even after many extra ticks", () => {
    const state = orderState({
      commonOre: 1000,
      refineryLevel: 1,
      order: { recipeKey: "refineCommonOre", mode: { kind: "batch", remaining: 2 } },
    });
    const done = stepTicks(state, 100); // far past the 2 jobs' completion
    expect(done.inventory.refinedMaterial.toString()).toBe("2"); // never a 3rd
    expect(done.refineOrder).toBeNull();
    expect(done.activeProcesses).toHaveLength(0);
  });
});

describe("economyTick integration — continuous runs until stopped", () => {
  it("keeps starting jobs while unblocked, and STOPS starting new ones after stopRefineOrder (in-flight job commits)", () => {
    const state = orderState({
      commonOre: 1000,
      refineryLevel: 1,
      order: { recipeKey: "refineCommonOre", mode: { kind: "continuous" } },
    });

    // 25 ticks: jobs complete at tick 11 and 21 (refinedMaterial 2), with a 3rd in
    // flight -- proof it keeps going with no batch counter.
    const running = stepTicks(state, 25);
    expect(running.inventory.refinedMaterial.toString()).toBe("2");
    expect(running.activeProcesses.filter((p) => p.kind === "refineJob")).toHaveLength(1); // 3rd in flight
    expect(running.refineOrder).toEqual({ recipeKey: "refineCommonOre", mode: { kind: "continuous" } });

    // Stop the order: the in-flight iteration commits (it is a started process), but no
    // NEW job starts afterward. Step well past when the committed job completes.
    const stopped = stopRefineOrder(running);
    const settled = stepTicks(stopped, 30);
    expect(settled.refineOrder).toBeNull();
    expect(settled.inventory.refinedMaterial.toString()).toBe("3"); // the committed 3rd job finished; no 4th
    expect(settled.activeProcesses).toHaveLength(0); // nothing new started after stop
  });
});

describe("D2 cancellation semantics — stopping a batch commits the in-flight job, drops the rest", () => {
  it("a batch of 100 stopped after the first job starts yields exactly 1 (design §4.3 'stop after the first → you get 1')", () => {
    // 1 slot => one job at a time; a batch of 100 with ample ore. This is the exact
    // scenario the Stop button drives: stopRefineOrder clears the queued ORDER but
    // never the active TimedProcess, so the one job already in flight commits and
    // completes normally, and no 2nd job ever starts.
    const state = orderState({
      commonOre: 20_000, // enough for 100 jobs -- proves the CAP is the stop, not the ore
      refineryLevel: 1,
      order: { recipeKey: "refineCommonOre", mode: { kind: "batch", remaining: 100 } },
    });

    // One tick: the first job starts (100 ore deducted), batch decremented to 99,
    // job in flight (10-tick duration) -- nothing completed yet.
    const afterOneTick = economyTick(state, 1);
    expect(afterOneTick.activeProcesses.filter((p) => p.kind === "refineJob")).toHaveLength(1);
    expect(afterOneTick.inventory.commonOre.toString()).toBe("19900"); // 20000 - 100
    expect(afterOneTick.refineOrder).toEqual({
      recipeKey: "refineCommonOre",
      mode: { kind: "batch", remaining: 99 },
    });

    // Stop the order (the Stop button's exact call): the queue is dropped, but the
    // in-flight job is a committed process and is untouched.
    const stopped = stopRefineOrder(afterOneTick);
    expect(stopped.refineOrder).toBeNull();
    expect(stopped.activeProcesses.filter((p) => p.kind === "refineJob")).toHaveLength(1); // still committed

    // Step well past the committed job's completion: it finishes (1 output), and
    // because the order is gone, NO further job starts -- exactly 1, not 100.
    const settled = stepTicks(stopped, 30);
    expect(settled.inventory.refinedMaterial.toString()).toBe("1"); // only the committed job
    expect(settled.inventory.commonOre.toString()).toBe("19900"); // no further ore consumed
    expect(settled.activeProcesses).toHaveLength(0); // nothing new started after stop
    expect(settled.refineOrder).toBeNull();
  });
});

describe("offline == stepped — an order rides the economyTick seam identically (coupled-offline proof)", () => {
  it("tick(bigSpan) equals looping economyTick(_,1): commonOre, refinedMaterial, processes, and refineOrder all match", () => {
    // A continuous order with 350 ore (exactly 3 jobs, then noInput) on a 1-slot
    // refinery, captain idle (no mission rng), tickDurationSeconds 1 so seconds == ticks.
    const base = orderState({
      commonOre: 350,
      refineryLevel: 1,
      order: { recipeKey: "refineCommonOre", mode: { kind: "continuous" } },
    });
    const SPAN = 40; // ticks (job1 done@11, job2@21, job3@31, then noInput with 50 ore left)

    // Path A: one offline catch-up call over the whole span (tick() internally steps
    // economyTick(_,1) per whole tick -- this is the offline per-tick loop, Task B3).
    const jumped = tick(SPAN, base);

    // Path B: hand-stepped economyTick, one tick at a time.
    const stepped = stepTicks(base, SPAN);

    expect(orderSnapshot(jumped)).toEqual(orderSnapshot(stepped));

    // And the concrete end state is what we expect: 3 refined, 50 ore left, no jobs in
    // flight, order paused noInput (350 - 300 = 50 < the 100 a 4th job needs).
    expect(jumped.inventory.refinedMaterial.toString()).toBe("3");
    expect(jumped.inventory.commonOre.toString()).toBe("50");
    expect(jumped.activeProcesses).toHaveLength(0);
    expect(jumped.refineOrder).toEqual({
      recipeKey: "refineCommonOre",
      mode: { kind: "continuous" },
      pausedReason: "noInput",
    });
  });
});
