// ============================================================================
// Fix round answers Q7 (user 2026-11-17, "Release only that lane"): Cancel on a helper (joined) lane releases just that
// lane; the order carries on in its own lane. Cancel on the order's own lane still stops the whole order. A unit the
// helper already started lands as usual (the way Cancel treats a unit in flight everywhere) and is logged with its
// order; the freed lane stays free (the order takes no helper again). The button, its tooltip and its note say which.
// ============================================================================
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, FACILITIES, REFINE_RECIPES, type GameState } from "./model";
import { allocatedItem } from "./allocation";
import { cancelLine, cancelLineScope, canStartLine, economyTick, refineSlotCount, startLine, tick } from "./tick";
import { itemTotal } from "./inventory";
import { buildAllCraftQueues, cancelLineText } from "./craftQueue";
import { HELP_TOPICS } from "../helpTopics";

const RNG = () => 0.5;
const RECIPE = "refineCommonOre";
const INPUT = Object.keys(REFINE_RECIPES[RECIPE].input)[0];
const PER = REFINE_RECIPES[RECIPE].input[INPUT].toNumber();
const OUTPUT = REFINE_RECIPES[RECIPE].output.itemId;
const DURATION = REFINE_RECIPES[RECIPE].durationTicks;

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
    inventory: { ...base.inventory, [INPUT]: [new Decimal(200_000)], uncommonMaterial: [new Decimal(200_000)] },
  };
}

const lanes = (s: GameState) => s.refineLines ?? [];
const UNITS = 30;

// A 30-unit batch with both free lanes joined, a unit in flight on every lane.
function joinedRun(): GameState {
  let s = startLine(threeLaneRefinery(), "refine", RECIPE, { kind: "batch", remaining: UNITS }).next;
  for (let i = 0; i < 3; i++) s = economyTick(s, 1, RNG);
  expect(lanes(s)).toHaveLength(3);
  expect(lanes(s).filter((l) => l.joined === true)).toHaveLength(2);
  return s;
}

function runOut(s: GameState, cap = UNITS * DURATION * 2): GameState {
  let out = s;
  for (let t = 0; t < cap && (lanes(out).length > 0 || out.activeProcesses.some((p) => p.kind === "refineJob")); t++) out = economyTick(out, 1, RNG);
  return out;
}

describe("Q7: Cancel on a helper lane releases just that lane", () => {
  it("a busy helper finishes its unit, then leaves; the order keeps its pool and reservation and carries on", () => {
    const s0 = joinedRun();
    const helper = lanes(s0)[2];
    const order = (s0.craftOrders ?? [])[0];
    const reservedBefore = allocatedItem(lanes(s0), [], INPUT, s0.craftOrders).toNumber();
    expect(s0.activeProcesses.some((p) => p.lineId === helper.id)).toBe(true);
    const s1 = cancelLine(s0, helper.id, 1_000);
    // The order is untouched but for joinClosed; its reservation stays.
    const after = (s1.craftOrders ?? [])[0];
    expect(after).toEqual({ ...order, joinClosed: true });
    expect(allocatedItem(lanes(s1), [], INPUT, s1.craftOrders).toNumber()).toBe(reservedBefore);
    // The helper stays only to land its unit, released.
    expect(lanes(s1).find((l) => l.id === helper.id)).toMatchObject({ released: true, remaining: 0 });
    // Its unit lands, then it leaves and nobody takes its bay.
    let s = s1;
    for (let t = 0; t < DURATION + 1; t++) s = economyTick(s, 1, RNG);
    expect(lanes(s).some((l) => l.id === helper.id)).toBe(false);
    expect(lanes(s)).toHaveLength(2);
    for (let t = 0; t < DURATION * 3; t++) {
      s = economyTick(s, 1, RNG);
      expect(lanes(s).length).toBeLessThanOrEqual(2);
    }
    // The player's next line can take the freed bay at once.
    expect(canStartLine(s, "refine", RECIPE, 1)).toEqual({ ok: true });
    // The order finishes every unit, logged once.
    const before = itemTotal(s0.inventory, OUTPUT).toNumber();
    const end = runOut(s);
    expect(itemTotal(end.inventory, OUTPUT).toNumber() - before).toBe(UNITS);
    expect(itemTotal(threeLaneRefinery().inventory, INPUT).toNumber() - itemTotal(end.inventory, INPUT).toNumber()).toBe(UNITS * PER);
    expect(end.craftOrders ?? []).toEqual([]);
    const runs = (end.completionLog ?? []).filter((e) => e.kind === "refineJob");
    expect(runs).toHaveLength(1);
    expect(runs[0].iterations).toBe(UNITS);
  });

  it("an idle helper leaves at once", () => {
    let s = joinedRun();
    // Land the in-flight units so the helpers sit between units for one moment: cancel a helper with nothing in flight.
    const helper = lanes(s)[2];
    s = { ...s, activeProcesses: s.activeProcesses.filter((p) => p.lineId !== helper.id) };
    const s1 = cancelLine(s, helper.id, 1_000);
    expect(lanes(s1).some((l) => l.id === helper.id)).toBe(false);
    expect((s1.craftOrders ?? [])[0].joinClosed).toBe(true);
    expect((s1.craftOrders ?? [])[0].remaining).toBe((s.craftOrders ?? [])[0].remaining);
  });

  it("Cancel on the own lane still stops the whole order", () => {
    let s = joinedRun();
    s = cancelLine(s, lanes(s)[0].id, 1_000);
    expect((s.craftOrders ?? [])[0]?.remaining ?? 0).toBe(0);
    s = runOut(s, DURATION + 2);
    expect(lanes(s)).toEqual([]);
    expect(s.craftOrders ?? []).toEqual([]);
  });

  it("a second Cancel on a released lane is a no-op", () => {
    const s0 = joinedRun();
    const s1 = cancelLine(s0, lanes(s0)[2].id, 1_000);
    expect(cancelLine(s1, lanes(s0)[2].id, 1_000)).toBe(s1);
  });

  it("offline equals live after a release: one tick() call equals 1 s steps", () => {
    const s0 = joinedRun();
    const start = cancelLine(s0, lanes(s0)[2].id, 1_000);
    const span = DURATION * 4;
    const offline = tick(span * start.tickDurationSeconds, start, RNG);
    let live = start;
    for (let i = 0; i < span; i++) live = economyTick(live, 1, RNG);
    expect(JSON.stringify([offline.refineLines, offline.craftOrders, offline.activeProcesses, offline.inventory[OUTPUT]])).toBe(
      JSON.stringify([live.refineLines, live.craftOrders, live.activeProcesses, live.inventory[OUTPUT]]),
    );
  });

  it("the button, tooltip and note say what Cancel does on each lane", () => {
    const s = joinedRun();
    const [own, , helper] = lanes(s);
    expect(cancelLineScope(s, own.id)).toBe("order");
    expect(cancelLineScope(s, helper.id)).toBe("release");
    expect(cancelLineText(s, helper.id)).toEqual({
      button: "Release",
      title: "Releases just this line: a unit it already started still lands, then its bay is free. The order carries on in its own line.",
      note: "Release frees just this line; the order carries on in its own line.",
    });
    expect(cancelLineText(s, own.id)).toEqual({
      button: "Cancel",
      title: "Stops the whole batch, its joined lines included; a unit already started still lands.",
      note: "Cancel on this line stops the whole batch, its joined lines included.",
    });
    const alone = startLine(threeLaneRefinery(), "refine", RECIPE, { kind: "continuous" }).next;
    expect(cancelLineText(alone, lanes(alone)[0].id)).toEqual({ button: "Cancel", title: "Stops this line; a unit already started still lands.", note: null });
  });

  it("Home counts a released lane as finishing its unit, not working the pool", () => {
    const s0 = joinedRun();
    const s1 = cancelLine(s0, lanes(s0)[2].id, 1_000);
    const rows = buildAllCraftQueues(s1).find((q) => q.facility === "refinery")!.running;
    const released = rows.find((r) => r.id === lanes(s0)[2].id)!;
    expect(released.remaining).toBe(0);
    expect(released.modeLabel).toBe("finishing current run");
    const own = rows.find((r) => r.id === lanes(s0)[0].id)!;
    expect(own.lanesAttached).toBe(2);
    expect(refineSlotCount(s1)).toBe(3);
  });

  it("the Help states the rule", () => {
    const body = HELP_TOPICS.map((t) => t.body).join("\n");
    expect(body).toContain("Cancel on the batch's own line stops the whole batch, its joined lines included. A joined line's button reads Release instead: it frees just that line (a unit it already started still lands first), and the batch carries on in its own line without taking another helper.");
    expect(body).not.toContain("Cancel on any line of a shared batch stops the whole batch.");
  });
});
