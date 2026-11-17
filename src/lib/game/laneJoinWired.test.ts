// ============================================================================
// FR-C lane 1 I3 (user 2026-11-15, "Wire it in 0.14.0 (Recommended)": a free lane joins the running order).
//
// The 0.13.4 join pass existed but no production code ever created a CraftOrder, so a free lane never joined
// anything. Now every BATCH line the player starts (or the queue promotes) runs under its own order, and a free
// lane at that facility joins it and pulls units from the same pool. The joined lane is BORROWED capacity (the
// Auto-Salvage Terminal's borrowed-bay rule): the player's next line or queued order claims it back as soon as it
// finishes the unit it is on, so wiring the join never costs the player a free line.
//
// The parity case at the end steps the production path (startLine, then the tick), offline against live.
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, FACILITIES, REFINE_RECIPES, type GameState } from "./model";
import { allocatedItem, freeItemForState } from "./allocation";
import { canStartLine, cancelLine, economyTick, enqueueOrder, refineSlotCount, startLine, tick } from "./tick";
import { getBucket, itemTotal } from "./inventory";
import { buildAllCraftQueues, orderTimeLeft } from "./craftQueue";
import { buildHomeDashboard } from "./homeDashboard";
import { withLaneJoinOff } from "./laneJoinSwitch.fixture";
import { withAnswersOff } from "./fixRoundAnswersSwitch.fixture";

const RNG = () => 0.5;
const RECIPE = "refineCommonOre";
const INPUT = Object.keys(REFINE_RECIPES[RECIPE].input)[0];
const PER = REFINE_RECIPES[RECIPE].input[INPUT].toNumber();
const OUTPUT = REFINE_RECIPES[RECIPE].output.itemId;
const OTHER_RECIPE = Object.keys(REFINE_RECIPES).find(
  (k) => k !== RECIPE && Object.keys(REFINE_RECIPES[k].input).every((id) => id === INPUT || id === "uncommonMaterial"),
);

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

function threeLaneRefinery(): GameState {
  const base = freshState();
  return {
    ...base,
    facilities: { ...base.facilities, refinery: { level: refineryLevelFor(3) } },
    inventory: {
      ...base.inventory,
      [INPUT]: [new Decimal(200_000)],
      uncommonMaterial: [new Decimal(200_000)],
    },
  };
}

const lanes = (s: GameState) => s.refineLines ?? [];
const inFlight = (s: GameState) => s.activeProcesses.filter((p) => p.kind === "refineJob").length;

describe("a started batch runs under an order, and free lanes join it", () => {
  it("startLine opens an order for a batch (the lane is attached); a continuous line stays unattached", () => {
    const s = threeLaneRefinery();
    const batch = startLine(s, "refine", RECIPE, { kind: "batch", remaining: 30 });
    expect(batch.started).toBe(true);
    const order = (batch.next.craftOrders ?? [])[0];
    expect(order).toMatchObject({ facility: "refinery", kind: "refine", recipeKey: RECIPE, remaining: 30 });
    expect(lanes(batch.next)[0].orderId).toBe(order.id);
    expect(batch.next.nextCraftOrderId).toBe((s.nextCraftOrderId ?? 1) + 1);
    // Reserved once, exactly the batch.
    expect(allocatedItem(lanes(batch.next), [], INPUT, batch.next.craftOrders).toNumber()).toBe(30 * PER);

    const cont = startLine(s, "refine", RECIPE, { kind: "continuous" });
    expect(lanes(cont.next)[0].orderId).toBeUndefined();
    expect(cont.next.craftOrders ?? []).toEqual([]);
  });

  it("the free lanes join, the batch finishes in about a third of the time, every unit lands once, and ONE log entry records it", () => {
    let s = startLine(threeLaneRefinery(), "refine", RECIPE, { kind: "batch", remaining: 30 }).next;
    const before = itemTotal(s.inventory, INPUT).toNumber();
    const duration = REFINE_RECIPES[RECIPE].durationTicks;
    let peak = 0;
    let ticks = 0;
    while ((lanes(s).length > 0 || inFlight(s) > 0) && ticks < 30 * duration * 2) {
      s = economyTick(s, 1, RNG);
      ticks += 1;
      peak = Math.max(peak, lanes(s).length);
      expect(inFlight(s)).toBeLessThanOrEqual(refineSlotCount(s));
    }
    expect(peak).toBe(3);
    expect(ticks).toBeLessThan(30 * duration * 0.5);
    expect(itemTotal(s.inventory, OUTPUT).toNumber()).toBe(30);
    expect(before - itemTotal(s.inventory, INPUT).toNumber()).toBe(30 * PER);
    // The order is swept once no lane holds it, and the run is logged ONCE for all 30 units.
    expect(s.craftOrders ?? []).toEqual([]);
    expect(s.openJobBatches ?? []).toEqual([]);
    const runs = (s.completionLog ?? []).filter((e) => e.kind === "refineJob");
    expect(runs).toHaveLength(1);
    expect(runs[0].iterations).toBe(30);
  });
});

describe("a joined lane is borrowed: the player's next work claims it back after its current unit", () => {
  function joinedRun(): GameState {
    let s = startLine(threeLaneRefinery(), "refine", RECIPE, { kind: "batch", remaining: 300 }).next;
    for (let i = 0; i < 3; i++) s = economyTick(s, 1, RNG);
    expect(lanes(s)).toHaveLength(3);
    return s;
  }

  it("Start stays open while borrowed lanes run, and the new line starts as soon as one finishes its unit", () => {
    expect(OTHER_RECIPE).toBeDefined();
    let s = joinedRun();
    expect(canStartLine(s, "refine", OTHER_RECIPE!, 5)).toEqual({ ok: true });
    s = startLine(s, "refine", OTHER_RECIPE!, { kind: "batch", remaining: 5 }).next;
    const mine = lanes(s)[lanes(s).length - 1];
    const duration = REFINE_RECIPES[RECIPE].durationTicks;
    let startedAt = -1;
    for (let t = 0; t < duration + 2 && startedAt < 0; t++) {
      s = economyTick(s, 1, RNG);
      expect(inFlight(s)).toBeLessThanOrEqual(refineSlotCount(s));
      if (s.activeProcesses.some((p) => p.lineId === mine.id)) startedAt = t;
    }
    expect(startedAt).toBeGreaterThanOrEqual(0);
    // Back to one lane per slot once the borrow is handed back.
    expect(lanes(s).length).toBeLessThanOrEqual(refineSlotCount(s));
  });

  it("a queued order promotes while borrowed lanes run", () => {
    let s = joinedRun();
    const q = enqueueOrder(s, "refinery", { type: "craftLine", kind: "refine", recipeKey: OTHER_RECIPE!, mode: { kind: "batch", remaining: 5 } });
    s = q.next;
    expect((s.processQueue ?? []).length).toBe(1);
    s = economyTick(s, 1, RNG);
    expect((s.processQueue ?? []).length).toBe(0);
    expect(lanes(s).some((l) => l.recipeKey === OTHER_RECIPE)).toBe(true);
  });

  // Fix round answers Q7 (2026-11-17, "Release only that lane") narrowed this to the order's own lane; a helper lane's
  // Cancel releases just that lane (laneRelease.test.ts). The pin runs both: the own lane now, a helper with Q7 off.
  it("Cancel on the order's own lane (any lane, before Q7) stops the whole order and releases its reservation", () => {
    for (const pick of ["own", "helperBeforeQ7"] as const) {
      let s = joinedRun();
      const lane = pick === "own" ? lanes(s)[0] : lanes(s)[2];
      expect(lane.joined === true).toBe(pick !== "own");
      s = pick === "own" ? cancelLine(s, lane.id, 1_000) : withAnswersOff(["helperCancelReleases"], () => cancelLine(s, lane.id, 1_000));
      expect(freeItemForState(s, INPUT).toNumber()).toBe(itemTotal(s.inventory, INPUT).toNumber());
      for (let t = 0; t < REFINE_RECIPES[RECIPE].durationTicks + 2; t++) s = economyTick(s, 1, RNG);
      expect(lanes(s)).toEqual([]);
      expect(s.craftOrders ?? []).toEqual([]);
      expect(s.openJobBatches ?? []).toEqual([]);
    }
  });
});

describe("offline equals live for a joined order started the production way", () => {
  it("one tick() call lands byte-identical to 1 s steps (lanes, orders, stock, log)", () => {
    const start = startLine(threeLaneRefinery(), "refine", RECIPE, { kind: "batch", remaining: 25 }).next;
    const span = 200;
    const offline = tick(span * start.tickDurationSeconds, start, RNG);
    let live = start;
    for (let i = 0; i < span; i++) live = economyTick(live, 1, RNG);
    expect(offline.refineLines).toEqual(live.refineLines);
    expect(offline.craftOrders).toEqual(live.craftOrders);
    expect(offline.inventory).toEqual(live.inventory);
    expect(offline.completionLog).toEqual(live.completionLog);
    expect(offline.openJobBatches).toEqual(live.openJobBatches);
  });
});

// THE MOVE, TRACED (laneJoinSwitch.fixture.ts). The pre-fix golden files (materialLinesGoldens, materialQualityGoldens,
// materialLinesMl2) run with the switch off and stay green, which proves the borrowed-lane rules and the order sweep are
// inert without an order. Here the same kind of run (a batch through completion, at one slot and at three, refine and
// fabricate) is taken both ways: with ONE slot nothing can join, so the two runs differ ONLY by the order bookkeeping
// (the lane's orderId, the order list and its id counter); every unit, stock, log entry and rng draw is identical. With
// three slots the joined run lands the same output, stock and one log entry, sooner.
describe("the move, traced (the lane-join switch off reproduces the pre-fix game)", () => {
  function counted(): { rng: () => number; draws: () => number } {
    let n = 0;
    let x = 0x51f >>> 0;
    return {
      rng: () => {
        n += 1;
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
        return x / 4294967296;
      },
      draws: () => n,
    };
  }
  function run(base: GameState, kind: "refine" | "fabricate", key: string, count: number, ticks: number, off: boolean) {
    const go = () => {
      const r = counted();
      let s = startLine(base, kind, key, { kind: "batch", remaining: count }).next;
      for (let i = 0; i < ticks; i++) s = economyTick(s, 1, r.rng);
      return { s, draws: r.draws() };
    };
    return off ? withLaneJoinOff(go) : go();
  }
  const bookkeepingFree = (s: GameState) => {
    const { craftOrders: _o, nextCraftOrderId: _n, ...rest } = s;
    return {
      ...rest,
      refineLines: rest.refineLines.map(({ orderId: _x, ...l }) => l),
      fabricateLines: rest.fabricateLines.map(({ orderId: _x, ...l }) => l),
    };
  };

  it("one slot: the refine and fabricate runs differ only by the order bookkeeping", () => {
    const oneSlot = (): GameState => {
      const base = freshState();
      return {
        ...base,
        facilities: { ...base.facilities, refinery: { level: 1 }, fabricator: { level: 1 } },
        researchedBlueprints: [...base.researchedBlueprints, "frameSegmentBp"],
        inventory: { ...base.inventory, commonOre: [new Decimal(500)], titaniumIngot: [new Decimal(60)] },
      };
    };
    for (const [kind, key, count, ticks] of [["refine", RECIPE, 3, 80], ["fabricate", "frameSegmentBp", 2, 300]] as const) {
      const on = run(oneSlot(), kind, key, count, ticks, false);
      const off = run(oneSlot(), kind, key, count, ticks, true);
      expect(on.draws, key).toBe(off.draws);
      expect(bookkeepingFree(on.s), key).toEqual(bookkeepingFree(off.s));
      expect(on.s.craftOrders ?? [], key).toEqual([]);
      expect((on.s.completionLog ?? []).length, key).toBe(1);
    }
  });

  it("three slots: the joined run lands the same output, stock and one log entry as the unjoined one, sooner", () => {
    const on = run(threeLaneRefinery(), "refine", RECIPE, 12, 400, false);
    const off = run(threeLaneRefinery(), "refine", RECIPE, 12, 400, true);
    expect(itemTotal(on.s.inventory, OUTPUT)).toEqual(itemTotal(off.s.inventory, OUTPUT));
    expect(itemTotal(on.s.inventory, INPUT)).toEqual(itemTotal(off.s.inventory, INPUT));
    const runs = (s: GameState) => (s.completionLog ?? []).filter((e) => e.kind === "refineJob");
    expect(runs(on.s).map((e) => e.iterations)).toEqual(runs(off.s).map((e) => e.iterations));
    // Sooner: the joined batch is done by a third of the unjoined run's length (12 units x the recipe at one lane).
    const shortRun = run(threeLaneRefinery(), "refine", RECIPE, 12, Math.ceil((12 * REFINE_RECIPES[RECIPE].durationTicks) / 2), false);
    expect(itemTotal(shortRun.s.inventory, OUTPUT).toNumber()).toBe(12);
    const shortOff = run(threeLaneRefinery(), "refine", RECIPE, 12, Math.ceil((12 * REFINE_RECIPES[RECIPE].durationTicks) / 2), true);
    expect(itemTotal(shortOff.s.inventory, OUTPUT).toNumber()).toBeLessThan(12);
  });
});

// FR-C fix pass: the joined lanes of ONE order read as one order everywhere (the same units left on every lane, on the
// consoles and on Home), and the order's total never reads below its time left.
describe("joined lanes read one order", () => {
  function joined(): GameState {
    let s = startLine(threeLaneRefinery(), "refine", RECIPE, { kind: "batch", remaining: 30 }).next;
    for (let i = 0; i < 3; i++) s = economyTick(s, 1, RNG);
    expect(inFlight(s)).toBe(3);
    return s;
  }

  it("every running row of the order shows the order's unstarted units and the same mode label", () => {
    const s = joined();
    const order = (s.craftOrders ?? [])[0];
    const rows = buildAllCraftQueues(s).find((v) => v.facility === "refinery")!.running;
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.remaining))).toEqual(new Set([order.remaining]));
    expect(new Set(rows.map((r) => r.modeLabel))).toEqual(new Set([`batch ${order.remaining}`]));
  });

  it("Home's units-left line reads the same number on every lane: the unstarted pool plus the units in flight", () => {
    const s = joined();
    const order = (s.craftOrders ?? [])[0];
    const lines = buildHomeDashboard(s).inProgress.filter((r) => r.secondaryLabel?.endsWith("to refine")).map((r) => r.secondaryLabel);
    expect(lines).toHaveLength(3);
    expect(new Set(lines)).toEqual(new Set([`${order.remaining + 3} to refine`]));
  });

  it("the order total never reads below the time left (two lanes, one unit waiting)", () => {
    // The old total, ceil((unstarted + 1) x duration / lanes), read 10 here while the time left read 15.
    expect(orderTimeLeft(10, 10, 1, 2)).toEqual({ etaTicks: 15, totalTicks: 15 });
    for (const [rem, dur, unstarted, lanes] of [[3, 10, 1, 2], [10, 10, 7, 3], [1, 20, 0, 2], [20, 20, 5, 4]]) {
      const t = orderTimeLeft(rem, dur, unstarted, lanes);
      expect(t.totalTicks).toBeGreaterThanOrEqual(t.etaTicks);
    }
    const s = joined();
    for (const row of buildAllCraftQueues(s).find((v) => v.facility === "refinery")!.running) {
      expect(row.orderTotalTicks!).toBeGreaterThanOrEqual(row.etaTicks!);
    }
  });
});

// FR-C fix pass (live pin for the ML-4 goldens that run with the join off): a joined lane spends best-first too, so
// the batch's whole output carries the good stock's quality.
describe("a joined lane honors Use best materials", () => {
  it("every unit of a joined best-first batch lands at the good stock's quality", () => {
    const base = threeLaneRefinery();
    const s0: GameState = { ...base, inventory: { ...base.inventory, [INPUT]: [new Decimal(600), new Decimal(0), new Decimal(12 * PER)] } };
    const r = startLine(s0, "refine", RECIPE, { kind: "batch", remaining: 12 }, "best");
    expect(r.started).toBe(true);
    let s = r.next;
    let peak = 0;
    const noRoll = () => 0.999999;
    for (let i = 0; i < 12 * REFINE_RECIPES[RECIPE].durationTicks; i++) {
      s = economyTick(s, 1, noRoll);
      peak = Math.max(peak, lanes(s).length);
    }
    expect(peak).toBe(3);
    expect(itemTotal(s.inventory, OUTPUT).toNumber()).toBe(12);
    expect(getBucket(s.inventory, OUTPUT, 2).toNumber()).toBe(12);
    expect(getBucket(s.inventory, INPUT, 2).toNumber()).toBe(0);
  });
});
