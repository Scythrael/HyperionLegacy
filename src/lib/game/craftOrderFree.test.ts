// ============================================================================
// Fix round answers fix pass (review SHOULD-FIX, user 2026-11-17 "Fix it now"): the Refinery / Fabricator Free and the
// Start gate count a running order's pool ONCE, however many lanes work it.
//
// A batch line runs under an order and free lanes join it (FR-C lane 1 I3). Its pool is reserved once (allocatedItem
// with the orders); every reader that left the orders out instead summed each lane's own count, so a batch joined by
// two helper lanes reserved its pool three times: Start (maxAffordableIterations, canStartLine) and the configurator's
// Free refused materials that Add to queue (canReserveOrder) correctly saw as free. All three now read the one
// chokepoint (allocation.ts freeItemForState). The configurator (App.svelte) reads freeItemForState too.
// ============================================================================
import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, FACILITIES, REFINE_RECIPES, type GameState } from "./model";
import { canReserveOrder, freeItem, freeItemForState } from "./allocation";
import { canStartLine, economyTick, enqueueOrder, maxAffordableIterations, startLine } from "./tick";
import { withAnswersOff } from "./fixRoundAnswersSwitch.fixture";

const RNG = () => 0.5;
const RECIPE = "refineCommonOre";
const INPUT = Object.keys(REFINE_RECIPES[RECIPE].input)[0];
const PER = REFINE_RECIPES[RECIPE].input[INPUT].toNumber();

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

// The review's scenario: a 3-slot Refinery, a 30-unit refineCommonOre batch (20 ore a unit) joined by 2 helper lanes.
function joinedBatch(): GameState {
  const base = freshState();
  const s: GameState = {
    ...base,
    facilities: { ...base.facilities, refinery: { level: refineryLevelFor(3) } },
    inventory: { ...base.inventory, [INPUT]: [new Decimal(2000)] },
  };
  let out = startLine(s, "refine", RECIPE, { kind: "batch", remaining: 30 }).next;
  for (let i = 0; i < 3; i++) out = economyTick(out, 1, RNG);
  return out;
}

describe("a running order's pool is reserved once by Free, Start and Add to queue alike", () => {
  it("the scenario: two helper lanes joined the batch", () => {
    const s = joinedBatch();
    expect(PER).toBe(20);
    expect(s.refineLines ?? []).toHaveLength(3);
    expect((s.refineLines ?? []).filter((l) => l.joined === true)).toHaveLength(2);
    expect(new Set((s.refineLines ?? []).map((l) => l.orderId)).size).toBe(1);
  });

  it("Free, the affordable count, Start and Add to queue agree", () => {
    const s = joinedBatch();
    const free = freeItemForState(s, INPUT).toNumber();
    expect(free).toBe(1400);
    const runs = free / PER;
    expect(maxAffordableIterations(s, "refine", RECIPE)).toBe(runs);
    expect(canStartLine(s, "refine", RECIPE, runs)).toEqual({ ok: true });
    expect(canStartLine(s, "refine", RECIPE, runs + 1)).toEqual({ ok: false, reason: "materials" });
    const order = (n: number) => ({ type: "craftLine" as const, kind: "refine" as const, recipeKey: RECIPE, mode: { kind: "batch" as const, remaining: n } });
    expect(canReserveOrder(s, order(runs))).toEqual({ ok: true });
    expect(canReserveOrder(s, order(runs + 1))).toEqual({ ok: false, reason: "materials" });
    expect(startLine(s, "refine", RECIPE, { kind: "batch", remaining: runs }).started).toBe(true);
    expect(enqueueOrder(s, "refinery", order(runs)).queued).toBe(true);
  });

  it("before the fix (the lanes' own counts, CRAFT_ORDER_FREE_SWITCH off): 260 free, 13 runs, Start refused 20", () => {
    const s = joinedBatch();
    // The configurator's old read (freeItem without the orders).
    expect(freeItem(s.inventory, s.refineLines ?? [], s.processQueue ?? [], INPUT).toNumber()).toBe(260);
    withAnswersOff(["craftOrderFree"], () => {
      expect(maxAffordableIterations(s, "refine", RECIPE)).toBe(13);
      expect(canStartLine(s, "refine", RECIPE, 20)).toEqual({ ok: false, reason: "materials" });
    });
  });
});
