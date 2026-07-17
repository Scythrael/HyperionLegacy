// Refinery slot + refine-completion tests — Phase 1, Task 11 (S4 update)
// (docs/plans/2026-07-11-facility-framework-refinery-design.md §6).
//
// Covers the still-live Task 11 pieces, all built on the Task 8 timed-process
// engine (startProcess / resolveProcesses, tick.ts) and the Task 10 FACILITIES table:
//   - refineSlotCount(state): how many parallel refine jobs the refinery can run,
//     derived by summing the `addRefineSlots` effects across every upgrade LEVEL
//     the facility has actually reached (level 0 = unbuilt = 0 slots).
//   - the itemsRefined lifetime hook in resolveProcesses: completing a refineJob
//     (and ONLY a refineJob) also increments lifetimeStats.itemsRefined[itemId].
//
// S4 RETIREMENT: startRefineJob (the one-shot manual "start a single refine job"
// action) and its slot/afford-gate tests were REMOVED in S4 -- the per-slot
// production LINE engine (startLine + stepCraftLine, which calls startProcess
// DIRECTLY) drives refining now. The completion-hook tests below therefore build
// their "refineJob" process via startProcess directly -- the SAME seam the line
// engine uses -- rather than through the retired startRefineJob wrapper.

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { refineSlotCount, startProcess, resolveProcesses } from "./tick";
import { freshState, REFINE_RECIPES, FACILITIES, type TimedProcess } from "./model";

// Build a "refineJob" TimedProcess for the launch recipe the SAME way the line
// engine does -- startProcess("refineJob", inputs, duration, addItem effect) --
// so the completion-hook tests below exercise the real deduct-at-start + process
// push without depending on the retired startRefineJob wrapper.
function startRefineCommonOre(state: ReturnType<typeof freshState>) {
  const recipe = REFINE_RECIPES.refineCommonOre;
  return startProcess(state, "refineJob", recipe.input, recipe.durationTicks, {
    type: "addItem",
    itemId: recipe.output.itemId,
    amount: recipe.output.amount,
  });
}

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

// (The "startRefineJob — single manual job (slot + afford gates)" describe was
//  REMOVED in S4 with the startRefineJob wrapper it exercised. Its slot gate is
//  now covered by refineSlotCount above + the line engine's own tests; the
//  atomic deduct-at-start + affordability guard it delegated to is covered by
//  startProcess's own tests. The completion-hook tests below build the refineJob
//  process via startProcess directly, the same seam the line engine uses.)

describe("refineJob completion grants output + lifetime itemsRefined", () => {
  it("completes past durationTicks: refinedMaterial +1, discovered, itemsRefined +1, FA XP += 10, process removed", () => {
    const state = stateWith({ inventory: { commonOre: 100 }, refineryLevel: 1 });
    const { next: started } = startRefineCommonOre(state);
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

describe("refineJob completion — CLOSED-FORM parity for the itemsRefined hook", () => {
  it("one big resolve == many small: refinedMaterial, itemsRefined, and FA XP all match", () => {
    const state = stateWith({ inventory: { commonOre: 100 }, refineryLevel: 1 });
    const { next: started } = startRefineCommonOre(state);

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
