// Refinery slot + refine-completion tests, Phase 1, Task 11 (S4 update)
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
// action) and its slot/afford-gate tests were REMOVED in S4, the per-slot
// production LINE engine (startLine + stepCraftLine, which calls startProcess
// DIRECTLY) drives refining now. The completion-hook tests below therefore build
// their "refineJob" process via startProcess directly, the SAME seam the line
// engine uses, rather than through the retired startRefineJob wrapper.

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  refineSlotCount,
  refineSpeedMult,
  refineJobDurationTicks,
  startProcess,
  resolveProcesses,
  startLine,
  processRefineLines,
} from "./tick";
import { itemTotal } from "./inventory"; // Task 9a: read item TOTAL across quality buckets
import { freshState, REFINE_RECIPES, FACILITIES, type TimedProcess } from "./model";
import { craftingXpAwardForProcess, craftingXpPerTick } from "./craftingProgress";

// Build a "refineJob" TimedProcess for the launch recipe the SAME way the line
// engine does, startProcess("refineJob", inputs, duration, addItem effect), so the
// completion-hook tests below exercise the real deduct-at-start + process
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
  const inventory: Record<string, Decimal[]> = { ...s.inventory };
  for (const key of Object.keys(opts.inventory ?? {})) {
    inventory[key] = [new Decimal(opts.inventory![key])];
  }
  return {
    ...s,
    inventory,
    facilities: { refinery: { level: opts.refineryLevel ?? 0 } },
  };
}

describe("refineSlotCount, sums addRefineSlots across levels reached", () => {
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

  it("level 4 STILL grants 3 slots, the 3->4 rung is refineSpeedMult, not a slot", () => {
    // Guards the derivation against the mixed-effect track: upgrades[3] is a
    // refineSpeedMult, so reaching level 4 must NOT add a 4th slot.
    expect(refineSlotCount(stateWith({ refineryLevel: 4 }))).toBe(3);
  });
});

// ============================================================================
// Crafting 0.13.3, Unit 3.1b FIX A: the refineSpeedMult rung is LIVE
// ============================================================================
//
// ⚠️ WHAT THIS FIXES. FACILITIES.refinery's level 3 -> 4 rung has always carried
// `effect: { refineSpeedMult: 1.5 }`, and the Foundry Upgrades tab has always
// ADVERTISED it as "1.5x refine speed", but until 0.13.3 no engine code read the
// value. A player could pay 8,000 Titanium Ore + 75 Titanium Ingots behind an FA-8
// gate for an upgrade that changed nothing. Unit 3.1's craftingProgress.test.ts
// found it; these tests are the fix's proof.
//
// The engine side is two functions in tick.ts: refineSpeedMult(state) (the reached-
// rungs PRODUCT, cloned from shipBuildSpeedMult) and refineJobDurationTicks(state,
// base) (base DIVIDED by that multiplier, ceil-rounded to a whole tick). lineJobSpec
// calls the second at job start, which is the ONE place a refine job's duration is
// decided now that startRefineJob is retired.

const MAXED_REFINERY_LEVEL = FACILITIES.refinery.upgrades.length; // 4 today

// A refineJob TimedProcess at an arbitrary duration, for pricing its crafting XP.
// Only kind / durationTicks / effect are read by craftingXpAwardForProcess.
function refineProcessOf(recipeKey: string, durationTicks: number): TimedProcess {
  const recipe = REFINE_RECIPES[recipeKey];
  return {
    id: "p-speed",
    kind: "refineJob",
    remainingTicks: durationTicks,
    durationTicks,
    effect: { type: "addItem", itemId: recipe.output.itemId, amount: recipe.output.amount },
  };
}

describe("refineSpeedMult, products refineSpeedMult across levels reached", () => {
  it("is the empty product 1.0 at every level below the speed rung", () => {
    // Levels 0..3 reach only the three addRefineSlots rungs, so nothing multiplies in.
    // This is why the fix is byte-identical for every save that has not bought level 4.
    for (const level of [0, 1, 2, 3]) {
      expect(refineSpeedMult(stateWith({ refineryLevel: level })), `level ${level}`).toBe(1);
    }
  });

  it("is 1.5 once the level 3 -> 4 rung is reached, matching what the Upgrades tab advertises", () => {
    expect(refineSpeedMult(stateWith({ refineryLevel: 4 }))).toBe(1.5);
    // Read straight off the content row, so a retune of the rung moves the test with it.
    const speedRung = FACILITIES.refinery.upgrades[3].effect;
    expect("refineSpeedMult" in speedRung && speedRung.refineSpeedMult).toBe(1.5);
  });
});

describe("refineJobDurationTicks, faster means FEWER ticks", () => {
  it("returns the recipe's base duration unchanged below level 4", () => {
    const state = stateWith({ refineryLevel: 3 });
    expect(refineJobDurationTicks(state, 12)).toBe(12);
    expect(refineJobDurationTicks(state, 20)).toBe(20);
  });

  it("DIVIDES at level 4: the 12-tick ore recipe runs in 8 ticks, the 20-tick wafer in 14", () => {
    const state = stateWith({ refineryLevel: MAXED_REFINERY_LEVEL });
    // 12 / 1.5 = 8 exactly. 20 / 1.5 = 13.333..., which CEILS to 14 (rounding up is the
    // conservative direction: the rung never over-delivers on what it advertises).
    expect(refineJobDurationTicks(state, REFINE_RECIPES.refineCommonOre.durationTicks)).toBe(8);
    expect(refineJobDurationTicks(state, REFINE_RECIPES.refinePolysilicateWafer.durationTicks)).toBe(14);
  });

  it("never yields a fractional or zero-tick job, at any base duration or reachable level", () => {
    // A 0-tick refine job would be a slot that either completes instantly (minting free
    // output every tick) or never counts down. Neither is a real behaviour, so the
    // rounding has to structurally exclude it rather than merely happen to avoid it.
    for (const level of [0, 1, 2, 3, 4]) {
      const state = stateWith({ refineryLevel: level });
      for (let base = 1; base <= 300; base++) {
        const ticks = refineJobDurationTicks(state, base);
        expect(Number.isInteger(ticks), `level ${level}, base ${base}`).toBe(true);
        expect(ticks, `level ${level}, base ${base}`).toBeGreaterThanOrEqual(1);
        expect(ticks, `level ${level}, base ${base}`).toBeLessThanOrEqual(base);
      }
    }
  });

  it("degrades safely on nonsense input rather than storing a NaN countdown", () => {
    const state = stateWith({ refineryLevel: MAXED_REFINERY_LEVEL });
    // A zero-duration recipe stays zero-duration: this scales a duration, it does not
    // invent one. Non-finite input passes straight through instead of becoming NaN math.
    expect(refineJobDurationTicks(state, 0)).toBe(0);
    expect(refineJobDurationTicks(state, Number.NaN)).toBeNaN();
    expect(refineJobDurationTicks(state, -5)).toBe(-5);
  });
});

describe("the speed rung reaches an actual refine job through the line engine", () => {
  it("a level-4 refinery starts an 8-tick job where a level-3 refinery starts a 12-tick one", () => {
    // End to end through the real seam: startLine -> processRefineLines -> stepCraftLine
    // -> lineJobSpec -> startProcess. This is what makes the upgrade non-inert.
    for (const [level, expectedTicks] of [[3, 12], [4, 8]] as const) {
      const state = stateWith({ inventory: { commonOre: 1000 }, refineryLevel: level });
      const { next: withLine, started } = startLine(state, "refine", "refineCommonOre", {
        kind: "batch",
        remaining: 3,
      });
      expect(started, `level ${level}`).toBe(true);

      const stepped = processRefineLines(withLine);
      const job = stepped.activeProcesses.find((p) => p.kind === "refineJob");
      expect(job, `level ${level}`).toBeDefined();
      expect(job!.durationTicks, `level ${level}`).toBe(expectedTicks);
      // remainingTicks is SEEDED from durationTicks, so the countdown is short too.
      expect(job!.remainingTicks, `level ${level}`).toBe(expectedTicks);
    }
  });

  it("the sped-up job really does complete sooner, in whole ticks", () => {
    const state = stateWith({ inventory: { commonOre: 1000 }, refineryLevel: MAXED_REFINERY_LEVEL });
    const withLine = startLine(state, "refine", "refineCommonOre", { kind: "batch", remaining: 1 }).next;
    const stepped = processRefineLines(withLine);

    // 7 ticks: still running. 8 ticks: done, output granted.
    expect(resolveProcesses(stepped, 7).next.activeProcesses).toHaveLength(1);
    const done = resolveProcesses(stepped, 8).next;
    expect(done.activeProcesses).toEqual([]);
    expect(itemTotal(done.inventory, "titaniumIngot").toString()).toBe("1");
  });
});

describe("⚠️ the speed rung buys THROUGHPUT, never crafting XP per unit time", () => {
  // ⚠️ THE INVARIANT UNIT 3.1 ASKED FOR. Crafting XP is
  //     floor(durationTicks * CRAFTING_XP_PER_DURATION_TICK * weightNum / DENOM),
  // i.e. proportional to DURATION. Making a refine job shorter therefore pays LESS XP
  // per job while leaving XP per TICK untouched: the player runs proportionally more
  // jobs in the same wall time and lands in the same place. That is exactly why Unit
  // 3.1's bulk-refining conclusion (design 6.4) is INDEPENDENT of this fix: Route A's
  // rate is slots x XP-per-tick, and this changes neither factor.
  //
  // These tests exist so a future retune cannot quietly turn a SPEED upgrade into an XP
  // upgrade, which would reopen the exact failure mode the whole weight model prevents.

  it("XP per tick is IDENTICAL sped up and not, for every shipped refine recipe", () => {
    const base = stateWith({ refineryLevel: 3 });
    const maxed = stateWith({ refineryLevel: MAXED_REFINERY_LEVEL });

    for (const [key, recipe] of Object.entries(REFINE_RECIPES)) {
      const baseTicks = refineJobDurationTicks(base, recipe.durationTicks);
      const spedTicks = refineJobDurationTicks(maxed, recipe.durationTicks);
      expect(spedTicks, key).toBeLessThan(baseTicks); // the upgrade does something

      const baseAward = craftingXpAwardForProcess(refineProcessOf(key, baseTicks));
      const spedAward = craftingXpAwardForProcess(refineProcessOf(key, spedTicks));

      expect(spedAward, key).toBeLessThan(baseAward);              // less XP per JOB
      expect(spedAward / spedTicks, key).toBe(baseAward / baseTicks); // same XP per TICK
      expect(spedAward / spedTicks, key).toBe(craftingXpPerTick({ kind: "refine", recipe }));
    }
  });

  it("no reachable refinery level can push XP per tick ABOVE the recipe's nominal rate", () => {
    // The general guard, stated as a CEILING rather than as an equality, because the
    // award's single floor() can shave a fraction off an odd-length job. What must never
    // happen is the other direction: a speed rung paying MORE XP per tick than the
    // unsped recipe's nominal weight allows.
    const recipe = REFINE_RECIPES.refineCommonOre;
    const nominal = craftingXpPerTick({ kind: "refine", recipe }); // 0.5 XP per tick
    for (const level of [0, 1, 2, 3, 4]) {
      const state = stateWith({ refineryLevel: level });
      for (let baseTicks = 1; baseTicks <= 300; baseTicks++) {
        const ticks = refineJobDurationTicks(state, baseTicks);
        const award = craftingXpAwardForProcess(refineProcessOf("refineCommonOre", ticks));
        expect(award / ticks, `level ${level}, base ${baseTicks}`).toBeLessThanOrEqual(nominal);
      }
    }
  });
});

// (The "startRefineJob, single manual job (slot + afford gates)" describe was
//  REMOVED in S4 with the startRefineJob wrapper it exercised. Its slot gate is
//  now covered by refineSlotCount above + the line engine's own tests; the
//  atomic deduct-at-start + affordability guard it delegated to is covered by
//  startProcess's own tests. The completion-hook tests below build the refineJob
//  process via startProcess directly, the same seam the line engine uses.)

describe("refineJob completion grants output + lifetime itemsRefined", () => {
  it("completes past durationTicks: titaniumIngot +1, discovered, itemsRefined +1, FA XP += 12, process removed", () => {
    const state = stateWith({ inventory: { commonOre: 100 }, refineryLevel: 1 });
    const { next: started } = startRefineCommonOre(state);
    expect(started.activeProcesses).toHaveLength(1);

    // 0.11.0 recipe-collapse: refineCommonOre is now the 20:1 / 12-tick recipe, so 12 ticks
    // (not the old 10) is the exact completion boundary; 0.12.1 FA XP =
    // FLEET_ADMIN_XP_PER_DURATION_TICK(5) * durationTicks 12 = 60.
    const { next, fleetAdminXpDelta } = resolveProcesses(started, 12); // exactly reaches 0

    expect(itemTotal(next.inventory, "titaniumIngot").toString()).toBe("1"); // output granted
    expect(next.discovered).toContain("titaniumIngot"); // via the addToInventory seam
    expect(next.activeProcesses).toEqual([]); // completed process removed
    expect(fleetAdminXpDelta).toBe(60); // 0.12.1 lump FA XP = FLEET_ADMIN_XP_PER_DURATION_TICK(5) * durationTicks 12
    // The Task 11 lifetime hook: itemsRefined accrues the refined output.
    expect(next.lifetimeStats.itemsRefined.titaniumIngot.toString()).toBe("1");
    // The other lifetime maps stay untouched (only refine jobs feed itemsRefined).
    expect(next.lifetimeStats.itemsCrafted).toEqual({});
  });

  it("does NOT feed itemsRefined for a facilityUpgrade completion (only refineJob does)", () => {
    // A facilityLevelUp process completing must leave itemsRefined empty, the
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

describe("refineJob completion, CLOSED-FORM parity for the itemsRefined hook", () => {
  it("one big resolve == many small: titaniumIngot, itemsRefined, and FA XP all match", () => {
    const state = stateWith({ inventory: { commonOre: 100 }, refineryLevel: 1 });
    const { next: started } = startRefineCommonOre(state);

    // Path A: one big jump past the 12-tick duration (refineCommonOre, post-collapse).
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
    expect(itemTotal(jumped.next.inventory, "titaniumIngot").toString()).toBe("1");
    expect(itemTotal(stepped.inventory, "titaniumIngot").toString()).toBe("1");
    // Lifetime itemsRefined identical (the completion fires exactly once either way).
    expect(jumped.next.lifetimeStats.itemsRefined.titaniumIngot.toString()).toBe("1");
    expect(stepped.lifetimeStats.itemsRefined.titaniumIngot.toString()).toBe("1");
    // FA XP identical (0.12.1 lump FA XP = FLEET_ADMIN_XP_PER_DURATION_TICK(5) *
    // durationTicks 12 = 60; the 12-tick duration is post-0.11.0-collapse).
    expect(jumped.fleetAdminXpDelta).toBe(60);
    expect(steppedFaXp).toBe(60);
    // Process removed in both paths.
    expect(jumped.next.activeProcesses).toEqual([]);
    expect(stepped.activeProcesses).toEqual([]);
  });
});

describe("REFINE_RECIPES table shape (launch placeholder)", () => {
  it("seeds the refineCommonOre recipe: commonOre x20 -> titaniumIngot x1 over 12 ticks", () => {
    // 0.11.0 recipe-collapse: refineCommonOre now carries the player-friendly 20:1 / 12-tick
    // numbers (the wasteful 100:1 / 10-tick twin was retired).
    const recipe = REFINE_RECIPES.refineCommonOre;
    expect(recipe.input.commonOre.toString()).toBe("20");
    expect(recipe.output.itemId).toBe("titaniumIngot");
    expect(recipe.output.amount.toString()).toBe("1");
    expect(recipe.durationTicks).toBe(12);
  });

  it("upgrades[0] of the refinery grants the first refine slot (keeps refineSlotCount honest)", () => {
    // Guards the coupling refineSlotCount depends on: the build rung IS a slot grant.
    const effect = FACILITIES.refinery.upgrades[0].effect;
    expect("addRefineSlots" in effect && effect.addRefineSlots).toBe(1);
  });
});
