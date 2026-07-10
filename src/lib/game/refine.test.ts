// Single refine-job tests — Phase 1, Task 11
// (docs/plans/2026-07-11-facility-framework-refinery-design.md §6).
//
// Covers the three Task 11 pieces, all built on the Task 8 timed-process engine
// (startProcess / resolveProcesses, tick.ts) and the Task 10 FACILITIES table:
//   - refineSlotCount(state): how many parallel refine jobs the refinery can run,
//     derived by summing the `addRefineSlots` effects across every upgrade LEVEL
//     the facility has actually reached (level 0 = unbuilt = 0 slots).
//   - startRefineJob(state, recipeKey): start one manual refine job IF a slot is
//     free AND the recipe inputs are affordable -- otherwise a same-reference
//     no-op. Delegates the atomic input deduct + process push to startProcess.
//   - the itemsRefined lifetime hook in resolveProcesses: completing a refineJob
//     (and ONLY a refineJob) also increments lifetimeStats.itemsRefined[itemId].
//
// SCOPE: single manual jobs ONLY. Batch count-N / continuous auto-repeat is a
// DEFERRED fast-follow (see SUGGESTIONS.md + the startRefineJob header comment) --
// deliberately not exercised here because it does not exist yet.

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { refineSlotCount, startRefineJob, resolveProcesses } from "./tick";
import { freshState, REFINE_RECIPES, FACILITIES, type TimedProcess } from "./model";

// A fresh state with a specific inventory + refinery level, so the slot/afford
// gates are exercised against known numbers rather than freshState's all-zero,
// level-0 seed. Mirrors facility.test.ts's own stateWith helper.
function stateWith(opts: { inventory?: Record<string, number>; refineryLevel?: number }) {
  const s = freshState();
  const inventory: Record<string, Decimal> = { ...s.inventory };
  for (const key of Object.keys(opts.inventory ?? {})) {
    inventory[key] = new Decimal(opts.inventory![key]);
  }
  return {
    ...s,
    inventory,
    facilities: { refinery: { level: opts.refineryLevel ?? 0 } },
  };
}

describe("refineSlotCount — sums addRefineSlots across levels reached", () => {
  it("level 0 (unbuilt refinery) grants 0 slots", () => {
    expect(refineSlotCount(stateWith({ refineryLevel: 0 }))).toBe(0);
  });

  it("level 1 (after the 0->1 build) grants 1 slot", () => {
    // upgrades[0].effect = { addRefineSlots: 1 }.
    expect(refineSlotCount(stateWith({ refineryLevel: 1 }))).toBe(1);
  });

  it("level 2 grants 2 slots (upgrades[0] + upgrades[1], each +1)", () => {
    expect(refineSlotCount(stateWith({ refineryLevel: 2 }))).toBe(2);
  });

  it("level 3 grants 3 slots (upgrades[0..2], each +1)", () => {
    expect(refineSlotCount(stateWith({ refineryLevel: 3 }))).toBe(3);
  });

  it("level 4 STILL grants 3 slots — the 3->4 rung is refineSpeedMult, not a slot", () => {
    // Guards the derivation against the mixed-effect track: upgrades[3] is a
    // refineSpeedMult, so reaching level 4 must NOT add a 4th slot.
    expect(refineSlotCount(stateWith({ refineryLevel: 4 }))).toBe(3);
  });
});

describe("startRefineJob — single manual job (slot + afford gates)", () => {
  it("starts a job with a free slot and affordable inputs: deducts inputs, pushes a refineJob process", () => {
    // Level 1 => 1 slot; 100 commonOre => exactly enough for refineCommonOre.
    const state = stateWith({ inventory: { commonOre: 100 }, refineryLevel: 1 });
    const result = startRefineJob(state, "refineCommonOre");

    expect(result.started).toBe(true);
    // Inputs deducted AT START (atomic, via startProcess) -- 100 -> 0.
    expect(result.next.inventory.commonOre.toString()).toBe("0");
    expect(result.next.activeProcesses).toHaveLength(1);
    const proc = result.next.activeProcesses[0];
    expect(proc.kind).toBe("refineJob");
    expect(proc.durationTicks).toBe(10); // REFINE_RECIPES.refineCommonOre.durationTicks
    expect(proc.remainingTicks).toBe(10);
    expect(proc.effect).toMatchObject({ type: "addItem", itemId: "refinedMaterial" });
    // Original state untouched (immutability).
    expect(state.inventory.commonOre.toString()).toBe("100");
    expect(state.activeProcesses).toEqual([]);
  });

  it("is blocked with 0 slots (unbuilt refinery), even with materials on hand", () => {
    const state = stateWith({ inventory: { commonOre: 100 }, refineryLevel: 0 });
    const result = startRefineJob(state, "refineCommonOre");
    expect(result.started).toBe(false);
    expect(result.next).toBe(state); // same-reference no-op
    expect(state.inventory.commonOre.toString()).toBe("100"); // nothing deducted
  });

  it("is blocked when every slot is already occupied (1 active job, 1 slot)", () => {
    // Level 1 => 1 slot; 200 ore so affordability is NOT the blocker.
    const state = stateWith({ inventory: { commonOre: 200 }, refineryLevel: 1 });
    const first = startRefineJob(state, "refineCommonOre");
    expect(first.started).toBe(true);
    expect(first.next.inventory.commonOre.toString()).toBe("100"); // 200 - 100

    // The one slot is now full -> the second start is refused (100 ore still on hand).
    const second = startRefineJob(first.next, "refineCommonOre");
    expect(second.started).toBe(false);
    expect(second.next).toBe(first.next); // same-reference no-op
    expect(second.next.activeProcesses).toHaveLength(1); // still just the first
    expect(second.next.inventory.commonOre.toString()).toBe("100"); // not double-deducted
  });

  it("is blocked when the inputs are unaffordable (99 < 100 commonOre), free slot notwithstanding", () => {
    const state = stateWith({ inventory: { commonOre: 99 }, refineryLevel: 1 });
    const result = startRefineJob(state, "refineCommonOre");
    expect(result.started).toBe(false);
    expect(result.next).toBe(state); // startProcess returns the same ref on an afford failure
    expect(state.inventory.commonOre.toString()).toBe("99"); // untouched
    expect(state.activeProcesses).toEqual([]);
  });

  it("is a same-reference no-op for an unknown recipe key", () => {
    const state = stateWith({ inventory: { commonOre: 1000 }, refineryLevel: 3 });
    const result = startRefineJob(state, "notARealRecipe");
    expect(result.started).toBe(false);
    expect(result.next).toBe(state);
  });
});

describe("startRefineJob — completion grants output + lifetime itemsRefined", () => {
  it("completes past durationTicks: refinedMaterial +1, discovered, itemsRefined +1, FA XP += 10, process removed", () => {
    const state = stateWith({ inventory: { commonOre: 100 }, refineryLevel: 1 });
    const { next: started } = startRefineJob(state, "refineCommonOre");
    expect(started.activeProcesses).toHaveLength(1);

    const { next, fleetAdminXpDelta } = resolveProcesses(started, 10); // exactly reaches 0

    expect(next.inventory.refinedMaterial.toString()).toBe("1"); // output granted
    expect(next.discovered).toContain("refinedMaterial"); // via the addToInventory seam
    expect(next.activeProcesses).toEqual([]); // completed process removed
    expect(fleetAdminXpDelta).toBe(10); // lump FA XP = durationTicks
    // The Task 11 lifetime hook: itemsRefined accrues the refined output.
    expect(next.lifetimeStats.itemsRefined.refinedMaterial.toString()).toBe("1");
    // The other lifetime maps stay untouched (only refine jobs feed itemsRefined).
    expect(next.lifetimeStats.itemsCrafted).toEqual({});
  });

  it("does NOT feed itemsRefined for a facilityUpgrade completion (only refineJob does)", () => {
    // A facilityLevelUp process completing must leave itemsRefined empty -- the
    // hook is guarded on kind === 'refineJob'.
    const base = freshState();
    const upgrade: TimedProcess = {
      id: "proc-1",
      kind: "facilityUpgrade",
      remainingTicks: 20,
      durationTicks: 20,
      effect: { type: "facilityLevelUp", facility: "refinery" },
    };
    const state = { ...base, activeProcesses: [upgrade], nextProcessId: 2 };
    const { next } = resolveProcesses(state, 20);
    expect(next.facilities.refinery.level).toBe(1);
    expect(next.lifetimeStats.itemsRefined).toEqual({}); // untouched
  });
});

describe("startRefineJob — CLOSED-FORM parity for the itemsRefined hook", () => {
  it("one big resolve == many small: refinedMaterial, itemsRefined, and FA XP all match", () => {
    const state = stateWith({ inventory: { commonOre: 100 }, refineryLevel: 1 });
    const { next: started } = startRefineJob(state, "refineCommonOre");

    // Path A: one big jump past the 10-tick duration.
    const jumped = resolveProcesses(started, 40);

    // Path B: 40 single-tick steps, summing the FA XP the way tick() folds it.
    let stepped = started;
    let steppedFaXp = 0;
    for (let i = 0; i < 40; i++) {
      const r = resolveProcesses(stepped, 1);
      stepped = r.next;
      steppedFaXp += r.fleetAdminXpDelta;
    }

    // Inventory output identical.
    expect(jumped.next.inventory.refinedMaterial.toString()).toBe("1");
    expect(stepped.inventory.refinedMaterial.toString()).toBe("1");
    // Lifetime itemsRefined identical (the completion fires exactly once either way).
    expect(jumped.next.lifetimeStats.itemsRefined.refinedMaterial.toString()).toBe("1");
    expect(stepped.lifetimeStats.itemsRefined.refinedMaterial.toString()).toBe("1");
    // FA XP identical.
    expect(jumped.fleetAdminXpDelta).toBe(10);
    expect(steppedFaXp).toBe(10);
    // Process removed in both paths.
    expect(jumped.next.activeProcesses).toEqual([]);
    expect(stepped.activeProcesses).toEqual([]);
  });
});

describe("REFINE_RECIPES table shape (launch placeholder)", () => {
  it("seeds the one Phase 1 recipe: commonOre x100 -> refinedMaterial x1 over 10 ticks", () => {
    const recipe = REFINE_RECIPES.refineCommonOre;
    expect(recipe.input.commonOre.toString()).toBe("100");
    expect(recipe.output.itemId).toBe("refinedMaterial");
    expect(recipe.output.amount.toString()).toBe("1");
    expect(recipe.durationTicks).toBe(10);
  });

  it("upgrades[0] of the refinery grants the first refine slot (keeps refineSlotCount honest)", () => {
    // Guards the coupling refineSlotCount depends on: the build rung IS a slot grant.
    const effect = FACILITIES.refinery.upgrades[0].effect;
    expect("addRefineSlots" in effect && effect.addRefineSlots).toBe(1);
  });
});
