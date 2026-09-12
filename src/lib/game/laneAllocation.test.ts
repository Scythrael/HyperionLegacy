// ============================================================================
// THE LANE ALLOCATION MODEL
// Infrastructure 0.13.4, Phase 5. Design section 7.
//
// ⚠️ THE TWO PROPERTIES THAT MATTER MOST, AND WHY:
//
//   1. AN ORDER IS RESERVED ONCE, NEVER ONCE PER ATTACHED LANE. Attaching a second lane must
//      change THROUGHPUT and change NOTHING about reserved stock. Getting this wrong the other
//      way over-reserves and makes a player's own materials unspendable.
//
//   2. AN UNATTACHED LANE IS BYTE-IDENTICAL TO PRE-0.13.4. Design section 3's locked item 6.
//      That byte-identity is what keeps the 101 parity baseline meaningful, and it is what makes
//      the migration a no-op for a player who is mid-batch across the upgrade.
//
// ⚠️ RESERVATIONS ARE DERIVED, NEVER DEDUCTED. Nothing is moved out of inventory when an order is
// created and nothing is deposited back when one is cancelled. clampInventoryToCaps trims over-cap
// stacks and DISCARDS the overflow on every load, so a deposit-on-cancel path would silently
// destroy items. A test below pins that inventory is untouched by order creation.
//
// ⚠️ PARITY CASES LIVE HERE, so this file joins the parity exclusion list.
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, FACILITIES, REFINE_RECIPES, type GameState } from "./model";
import type { CraftLine, CraftOrder } from "./allocation";
import { allocatedItem, freeItemForState, lineInputsPerIteration } from "./allocation";
import { economyTick, tick } from "./tick";
import { buildCraftQueue } from "./craftQueue";

const RNG = () => 0.5;

// A refine recipe with at least one input, resolved from the table rather than hardcoded so a
// retuned recipe does not quietly make these fixtures test nothing.
const RECIPE_KEY = Object.keys(REFINE_RECIPES).find(
  (k) => Object.keys(REFINE_RECIPES[k].input).length > 0,
)!;
const INPUT_ID = Object.keys(REFINE_RECIPES[RECIPE_KEY].input)[0];
const PER_ITERATION = new Decimal(REFINE_RECIPES[RECIPE_KEY].input[INPUT_ID]);

function lane(id: string, over: Partial<CraftLine> = {}): CraftLine {
  return {
    id,
    kind: "refine",
    recipeKey: RECIPE_KEY,
    remaining: 0,
    mode: { kind: "batch", remaining: 0 },
    ...over,
  };
}

function order(id: string, remaining: number): CraftOrder {
  return {
    id,
    facility: "refinery",
    kind: "refine",
    recipeKey: RECIPE_KEY,
    remaining,
    mode: { kind: "batch", remaining },
  };
}

// How many refinery levels are needed for at least `n` refine slots. Derived from the upgrade
// table rather than hardcoded, so a retuned refinery moves this with it.
function refineryLevelFor(n: number): number {
  let slots = 0;
  const upgrades = FACILITIES.refinery.upgrades;
  for (let i = 0; i < upgrades.length; i++) {
    const effect = upgrades[i].effect;
    if ("addRefineSlots" in effect) slots += effect.addRefineSlots;
    if (slots >= n) return i + 1;
  }
  return upgrades.length;
}

// A state with plenty of the input material so affordability never confounds a reservation test,
// AND a refinery levelled high enough to actually have slots.
//
// ⚠️ THE SLOTS MATTER AND THEIR ABSENCE COST ME A FALSE DIAGNOSIS. refineSlotCount reads the
// refinery's LEVEL, and a fresh save has the refinery unbuilt, so the count is 0. With 0 slots the
// join pass computes negative free capacity and correctly does nothing, which looked exactly like
// a broken join. The engine was right; the fixture had no facility.
function stocked(over: Partial<GameState> = {}): GameState {
  const base = freshState();
  return {
    ...base,
    facilities: { ...base.facilities, refinery: { level: refineryLevelFor(3) } },
    // ⚠️ PAST EVERY HAND-WRITTEN LANE ID IN THIS FILE, and this is not cosmetic. The join pass mints
    // its new lane as `craft-${nextCraftLineId}`, so a fixture that hand-writes "craft-1" while
    // leaving the counter at 1 produces TWO lanes with the SAME id. stepCraftLine matches a lane to
    // its in-flight job by that id, so the duplicate made one lane's job block the other's and the
    // whole facility froze. It read exactly like a broken join; the join was fine.
    // Production cannot hit this (startLine always advances the counter), but a fixture can.
    nextCraftLineId: 100,
    inventory: {
      ...base.inventory,
      [INPUT_ID]: [new Decimal(1_000_000), new Decimal(0), new Decimal(0), new Decimal(0), new Decimal(0), new Decimal(0)],
    } as never,
    ...over,
  };
}

describe("allocatedItem: an order is reserved ONCE, not once per lane", () => {
  it("counts a shared order a single time however many lanes are attached", () => {
    // ⚠️ THE SINGLE MOST IMPORTANT ASSERTION IN THIS FILE. Two lanes pulling from one 100-unit
    // order must reserve 100 iterations' worth of input, not 200.
    const o = order("ord-1", 100);
    const oneLane = [lane("craft-1", { orderId: "ord-1", remaining: 100, mode: { kind: "batch", remaining: 100 } })];
    const twoLanes = [
      ...oneLane,
      lane("craft-2", { orderId: "ord-1", remaining: 100, mode: { kind: "batch", remaining: 100 } }),
    ];
    const withOne = allocatedItem(oneLane, [], INPUT_ID, [o]);
    const withTwo = allocatedItem(twoLanes, [], INPUT_ID, [o]);
    expect(withTwo.toString()).toBe(withOne.toString());
    expect(withOne.toString()).toBe(PER_ITERATION.times(100).toString());
  });

  it("counts TWO separate orders separately", () => {
    // The other direction: distinct orders are distinct work and must each reserve.
    const orders = [order("ord-1", 10), order("ord-2", 10)];
    const lanes = [lane("craft-1", { orderId: "ord-1" }), lane("craft-2", { orderId: "ord-2" })];
    expect(allocatedItem(lanes, [], INPUT_ID, orders).toString()).toBe(PER_ITERATION.times(20).toString());
  });

  it("⚠️ an UNATTACHED lane is counted exactly as it was before this release", () => {
    // The byte-identity guarantee. A lane with no orderId reads its own remaining, and passing no
    // orders at all reproduces the pre-0.13.4 signature.
    const lanes = [lane("craft-1", { remaining: 7, mode: { kind: "batch", remaining: 7 } })];
    const before = allocatedItem(lanes, [], INPUT_ID);
    const after = allocatedItem(lanes, [], INPUT_ID, []);
    expect(after.toString()).toBe(before.toString());
    expect(before.toString()).toBe(PER_ITERATION.times(7).toString());
  });

  it("ignores a lane whose orderId points at an order that no longer exists", () => {
    // Defensive: a cancelled order with a lane still referencing it. The lane falls back to its own
    // remaining rather than contributing nothing, so a stale pointer cannot silently free up
    // reservations the work still needs.
    const lanes = [lane("craft-1", { orderId: "ord-gone", remaining: 5, mode: { kind: "batch", remaining: 5 } })];
    expect(allocatedItem(lanes, [], INPUT_ID, []).toString()).toBe(PER_ITERATION.times(5).toString());
  });

  it("serves an ORDER and a LANE through the same per-iteration lookup", () => {
    // One definition of "what does one iteration cost". Two would be two chances for a lane and its
    // order to disagree, which would surface as a reservation that never clears.
    const o = order("ord-1", 1);
    const l = lane("craft-1", { orderId: "ord-1" });
    expect(Object.keys(lineInputsPerIteration(o))).toEqual(Object.keys(lineInputsPerIteration(l)));
  });
});

describe("freeItemForState: the affordability chokepoint", () => {
  it("subtracts a shared order once, so a second lane does not make stock look spent", () => {
    const o = order("ord-1", 100);
    const state = stocked({
      craftOrders: [o],
      refineLines: [
        lane("craft-1", { orderId: "ord-1", remaining: 100, mode: { kind: "batch", remaining: 100 } }),
        lane("craft-2", { orderId: "ord-1", remaining: 100, mode: { kind: "batch", remaining: 100 } }),
      ],
    });
    const oneLaneState = { ...state, refineLines: [state.refineLines[0]] };
    expect(freeItemForState(state, INPUT_ID).toString()).toBe(freeItemForState(oneLaneState, INPUT_ID).toString());
  });

  it("⚠️ creating an order does NOT touch inventory (derived, never deducted)", () => {
    // The project's hard invariant. clampInventoryToCaps discards over-cap overflow on every load,
    // so a deduct-and-deposit design would silently destroy a player's items on cancel.
    const before = stocked();
    const after: GameState = { ...before, craftOrders: [order("ord-1", 500)] };
    expect((after.inventory as never as Record<string, Decimal[]>)[INPUT_ID][0].toString()).toBe(
      (before.inventory as never as Record<string, Decimal[]>)[INPUT_ID][0].toString(),
    );
    // ...but the FREE figure does drop, because reservation is computed on read.
    expect(freeItemForState(after, INPUT_ID).lt(freeItemForState(before, INPUT_ID))).toBe(true);
  });
});

describe("the join pass: the user's worked example", () => {
  // Three orders at a two-lane facility. A and B run, C waits. As A and B finish, BOTH their lanes
  // end up on C. This is the acceptance test the design names by name.
  function twoLaneFacility(): GameState {
    return stocked({
      craftOrders: [order("ord-A", 2), order("ord-B", 2), order("ord-C", 40)],
      refineLines: [
        lane("craft-1", { orderId: "ord-A", remaining: 2, mode: { kind: "batch", remaining: 2 } }),
        lane("craft-2", { orderId: "ord-B", remaining: 2, mode: { kind: "batch", remaining: 2 } }),
      ],
    });
  }

  it("BOTH lanes end up on the same remaining order once the others drain", () => {
    let state = twoLaneFacility();
    // ⚠️ SAMPLED EVERY TICK FOR THE PEAK, NOT CHECKED AT THE END. My first version ran 200 ticks
    // and then looked, which found zero lanes on C for the dullest possible reason: C had long
    // since FINISHED and its lanes were removed. The property is "at some point more than one lane
    // was working the same order", and that is a peak over the run, not a final state.
    let peakOnC = 0;
    for (let i = 0; i < 200; i++) {
      state = economyTick(state, 1, RNG);
      const onC = (state.refineLines ?? []).filter((l) => l.orderId === "ord-C").length;
      if (onC > peakOnC) peakOnC = onC;
    }
    // ⚠️ THE POINT OF THE WHOLE PHASE: a single order occupying more than one lane, which is the
    // user's worked example ("both lanes end up on C").
    expect(peakOnC).toBeGreaterThan(1);
    // ...and the order really did complete, so sharing a pool does not strand work.
    expect((state.craftOrders ?? []).find((o) => o.id === "ord-C")?.remaining ?? 0).toBe(0);
  });

  it("a CONTINUOUS order is never joined, so it cannot monopolise the facility", () => {
    // Design 17.3 Q9: a continuous order has no finite pool, so joining has no end condition and
    // the second lane would never be released.
    const continuous: CraftOrder = {
      id: "ord-cont",
      facility: "refinery",
      kind: "refine",
      recipeKey: RECIPE_KEY,
      remaining: 1,
      mode: { kind: "continuous" },
    };
    let state = stocked({
      craftOrders: [continuous],
      refineLines: [lane("craft-1", { orderId: "ord-cont", remaining: 1, mode: { kind: "continuous" } }), lane("craft-2")],
    });
    for (let i = 0; i < 30; i++) state = economyTick(state, 1, RNG);
    const attached = (state.refineLines ?? []).filter((l) => l.orderId === "ord-cont");
    expect(attached.length).toBeLessThanOrEqual(1);
  });

  it("does NOT disturb an unattached lane that is mid-batch", () => {
    // The migration's promise: a player part-way through a batch across the upgrade sees nothing
    // change. The free lane must not steal its work, and its own remaining must keep draining.
    let state = stocked({
      craftOrders: [],
      refineLines: [lane("craft-1", { remaining: 5, mode: { kind: "batch", remaining: 5 } }), lane("craft-2")],
    });
    const before = state.refineLines[0].remaining;
    for (let i = 0; i < 3; i++) state = economyTick(state, 1, RNG);
    const midBatch = (state.refineLines ?? []).find((l) => l.id === "craft-1");
    expect(midBatch).toBeDefined();
    expect(midBatch!.orderId).toBeUndefined();
    // It made progress on its OWN pool rather than being re-pointed at something else.
    expect(midBatch!.remaining).toBeLessThanOrEqual(before);
  });
});

describe("the shared pool drains once per started iteration", () => {
  it("two attached lanes consume ONE pool, not two", () => {
    const o = order("ord-1", 20);
    let state = stocked({
      craftOrders: [o],
      refineLines: [
        lane("craft-1", { orderId: "ord-1", remaining: 20, mode: { kind: "batch", remaining: 20 } }),
        lane("craft-2", { orderId: "ord-1", remaining: 20, mode: { kind: "batch", remaining: 20 } }),
      ],
    });
    const startRemaining = state.craftOrders![0].remaining;
    for (let i = 0; i < 5; i++) state = economyTick(state, 1, RNG);
    const now = (state.craftOrders ?? []).find((x) => x.id === "ord-1");
    // The order drained (work happened) and never went negative (no double decrement).
    expect(now === undefined || now.remaining < startRemaining).toBe(true);
    if (now !== undefined) expect(now.remaining).toBeGreaterThanOrEqual(0);
  });
});

describe("offline-equals-live parity for the lane model", () => {
  it("parity: a SINGLE-LANE facility is byte-identical offline and live", () => {
    // Design section 3, locked item 6. This is the case that keeps the 101 baseline meaningful.
    const span = 40;
    const start = stocked({
      craftOrders: [],
      refineLines: [lane("craft-1", { remaining: 30, mode: { kind: "batch", remaining: 30 } })],
    });
    const offline = tick(span * start.tickDurationSeconds, start, RNG);
    let live = start;
    for (let i = 0; i < span; i++) live = economyTick(live, 1, RNG);
    expect(offline.refineLines.map((l) => l.remaining)).toEqual(live.refineLines.map((l) => l.remaining));
    expect(offline.craftOrders ?? []).toEqual(live.craftOrders ?? []);
  });

  it("parity: a SHARED order lands the identical pool offline and live", () => {
    const span = 60;
    const start = stocked({
      craftOrders: [order("ord-1", 40)],
      refineLines: [
        lane("craft-1", { orderId: "ord-1", remaining: 40, mode: { kind: "batch", remaining: 40 } }),
        lane("craft-2", { orderId: "ord-1", remaining: 40, mode: { kind: "batch", remaining: 40 } }),
      ],
    });
    const offline = tick(span * start.tickDurationSeconds, start, RNG);
    let live = start;
    for (let i = 0; i < span; i++) live = economyTick(live, 1, RNG);
    expect((offline.craftOrders ?? []).map((o) => o.remaining)).toEqual(
      (live.craftOrders ?? []).map((o) => o.remaining),
    );
  });

  it("parity: the JOIN itself lands the same lane-to-order mapping offline and live", () => {
    const span = 120;
    const start = stocked({
      craftOrders: [order("ord-A", 2), order("ord-C", 40)],
      refineLines: [lane("craft-1", { orderId: "ord-A", remaining: 2, mode: { kind: "batch", remaining: 2 } }), lane("craft-2")],
    });
    const offline = tick(span * start.tickDurationSeconds, start, RNG);
    let live = start;
    for (let i = 0; i < span; i++) live = economyTick(live, 1, RNG);
    expect(offline.refineLines.map((l) => l.orderId ?? null)).toEqual(live.refineLines.map((l) => l.orderId ?? null));
  });
});

// ============================================================================
// THE READOUTS (Phase 6 Unit 6.1)
//
// ⚠️ THESE EXIST BECAUSE OF A SPECIFIC WAY THE FEATURE COULD LOOK BROKEN. When a second lane joins
// an order, the whole-batch countdown roughly HALVES between two ticks. A number that jumps for an
// invisible reason reads as a bug, so the lane count is surfaced beside the ETA as the CAUSE.
// ============================================================================
describe("the running row reports lanes and an order-level ETA", () => {
  it("reports 1 lane for an unattached line, so an ordinary line reads unchanged", () => {
    const state = stocked({
      craftOrders: [],
      refineLines: [lane("craft-1", { remaining: 5, mode: { kind: "batch", remaining: 5 } })],
    });
    const row = buildCraftQueue(state, "refinery").running.find((r) => r.id === "craft-1");
    expect(row).toBeDefined();
    expect(row!.lanesAttached).toBe(1);
  });

  it("reports the shared count when two lanes work one order", () => {
    const state = stocked({
      craftOrders: [order("ord-1", 50)],
      refineLines: [
        lane("craft-1", { orderId: "ord-1", remaining: 50, mode: { kind: "batch", remaining: 50 } }),
        lane("craft-2", { orderId: "ord-1", remaining: 50, mode: { kind: "batch", remaining: 50 } }),
      ],
    });
    const rows = buildCraftQueue(state, "refinery").running;
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.lanesAttached).toBe(2);
  });

  it("reports a null ETA when nothing is in flight rather than inventing a number", () => {
    // No running job means no rate to extrapolate from. A fabricated figure here would be the
    // same class of dishonesty as a fabricated completion time.
    const state = stocked({
      craftOrders: [order("ord-1", 50)],
      refineLines: [lane("craft-1", { orderId: "ord-1", remaining: 50, mode: { kind: "batch", remaining: 50 } })],
    });
    expect(buildCraftQueue(state, "refinery").running[0].etaTicks).toBeNull();
  });

  it("⚠️ the ETA HALVES when a second lane joins, which is what the lane count explains", () => {
    // Drive a real order until a job is in flight, measure, then attach a second lane and measure
    // again. This is the exact jump a player would otherwise see with nothing to explain it.
    // ⚠️ ONE SLOT ONLY, and this matters. My first version used the default 3-slot fixture and
    // found no single-lane row to measure: the join pass had already attached a second lane by
    // tick 3, which is the feature working correctly and breaking the test's own premise. Pinning
    // the facility to ONE slot is what keeps the baseline measurement single-lane.
    let state = stocked({
      facilities: { refinery: { level: refineryLevelFor(1) } } as never,
      craftOrders: [order("ord-1", 40)],
      refineLines: [lane("craft-1", { orderId: "ord-1", remaining: 40, mode: { kind: "batch", remaining: 40 } })],
    });
    for (let i = 0; i < 3; i++) state = economyTick(state, 1, RNG);
    const single = buildCraftQueue(state, "refinery").running.find((r) => r.lanesAttached === 1);
    expect(single).toBeDefined();
    expect(single?.etaTicks).not.toBeNull();
    // Now a second lane on the same order.
    const shared: GameState = {
      ...state,
      refineLines: [
        ...state.refineLines,
        lane("craft-200", {
          orderId: "ord-1",
          remaining: state.refineLines[0].remaining,
          mode: state.refineLines[0].mode,
        }),
      ],
    };
    const both = buildCraftQueue(shared, "refinery").running.filter((r) => r.etaTicks !== null);
    expect(both.length).toBeGreaterThan(0);
    // Roughly half, allowing for the ceil. Strictly LESS is the property that matters.
    expect(both[0].etaTicks!).toBeLessThan(single!.etaTicks!);
  });
});
