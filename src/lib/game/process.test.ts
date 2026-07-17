// Timed-process engine tests — Phase 1, Task 8
// (docs/plans/2026-07-11-facility-framework-refinery-design.md §3, §4).
//
// Covers the two engine functions (startProcess / resolveProcesses, both in
// tick.ts) plus the save-hydration of a persisted addItem effect (save.ts).
// The engine backs refine jobs AND facility upgrades (same deterministic
// fixed-duration shape); these tests exercise it directly, decoupled from the
// later Refinery UI / mission economy.
//
// The load-bearing guarantees under test:
//   1. ATOMIC deduct-at-start — inputs leave inventory in the SAME transition
//      that creates the process (design §4), so there is no checked-but-not-yet-
//      consumed window for a second concurrent start to exploit.
//   2. CLOSED-FORM resolve — one resolveProcesses(state, N) is byte-identical to
//      N resolveProcesses(state, 1) for inventory, facilities, activeProcesses,
//      AND the summed Fleet Admiral XP. This is the offline-catch-up == live-loop
//      guarantee the whole engine exists to provide.
//   3. LUMP FA XP on completion — a completed process awards its durationTicks of
//      Fleet Admiral XP exactly once, regardless of how the elapsed ticks chunked.

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { startProcess, resolveProcesses } from "./tick";
import { freshState, type TimedProcess, type ProcessEffect } from "./model";
import { serialize, deserialize, migrate } from "./save";

// A fresh state whose inventory we can pre-load with specific balances, so the
// affordability gates and deducts are exercised against known numbers rather
// than freshState's all-zero seed.
function stateWith(inventory: Record<string, number>) {
  const s = freshState();
  const inv: Record<string, Decimal> = { ...s.inventory };
  for (const key of Object.keys(inventory)) {
    inv[key] = new Decimal(inventory[key]);
  }
  return { ...s, inventory: inv };
}

// Normalizes a state's process-relevant fields to plain, Decimal-free values so
// two states can be compared with a stable deep-equal that does not depend on
// break_infinity Decimal instance internals. Inventory + any addItem amount are
// stringified; facilities/activeProcesses scalars are plain numbers already.
function snapshot(state: ReturnType<typeof freshState>) {
  const inventory: Record<string, string> = {};
  for (const key of Object.keys(state.inventory)) {
    inventory[key] = state.inventory[key].toString();
  }
  const activeProcesses = state.activeProcesses.map((p) => ({
    id: p.id,
    kind: p.kind,
    remainingTicks: p.remainingTicks,
    durationTicks: p.durationTicks,
    effect:
      p.effect.type === "addItem"
        ? { type: p.effect.type, itemId: p.effect.itemId, amount: p.effect.amount.toString() }
        : p.effect.type === "addFuel"
          ? { type: p.effect.type, amount: p.effect.amount.toString() } // Fuel Economy v2 (F2): fuelRefineJob effect
          : p.effect.type === "facilityLevelUp"
            ? { type: p.effect.type, facility: p.effect.facility }
            : p.effect.type === "unlockBlueprint"
              ? { type: p.effect.type, key: p.effect.key } // Research (R3): unlockBlueprint effect
              : { type: p.effect.type, typeKey: p.effect.typeKey }, // Shipyard (S3): addShip effect
  }));
  return {
    inventory,
    facilities: state.facilities,
    activeProcesses,
    discovered: [...state.discovered].sort(),
    nextProcessId: state.nextProcessId,
  };
}

const addItem = (itemId: string, amount: number): ProcessEffect => ({
  type: "addItem",
  itemId,
  amount: new Decimal(amount),
});
const levelUp = (facility: string): ProcessEffect => ({ type: "facilityLevelUp", facility });

describe("startProcess — atomic deduct-at-start (Task 8)", () => {
  it("rejects a start the inventory cannot afford, returning the SAME state reference unchanged", () => {
    const state = stateWith({ commonOre: 5 });
    const result = startProcess(
      state,
      "refineJob",
      { commonOre: new Decimal(10) }, // needs 10, only 5 on hand
      10,
      addItem("refinedMaterial", 1)
    );
    expect(result.started).toBe(false);
    expect(result.next).toBe(state); // literally the same object -- no clone on the reject path
    expect(state.inventory.commonOre.toString()).toBe("5"); // untouched
    expect(state.activeProcesses).toEqual([]);
    expect(state.nextProcessId).toBe(1);
  });

  it("deducts inputs immediately, pushes the process, and bumps nextProcessId on an affordable start", () => {
    const state = stateWith({ commonOre: 30 });
    const result = startProcess(
      state,
      "refineJob",
      { commonOre: new Decimal(10) },
      10,
      addItem("refinedMaterial", 1)
    );
    expect(result.started).toBe(true);
    // Deducted at START (not at completion) -- inventory already reflects the reservation.
    expect(result.next.inventory.commonOre.toString()).toBe("20");
    expect(result.next.activeProcesses).toHaveLength(1);
    const proc = result.next.activeProcesses[0];
    expect(proc).toMatchObject({
      id: "proc-1",
      kind: "refineJob",
      remainingTicks: 10, // seeded from durationTicks
      durationTicks: 10,
    });
    expect(proc.effect).toMatchObject({ type: "addItem", itemId: "refinedMaterial" });
    expect(result.next.nextProcessId).toBe(2); // monotonic bump
    // Immutability: the original state is untouched.
    expect(state.inventory.commonOre.toString()).toBe("30");
    expect(state.activeProcesses).toEqual([]);
  });

  it("gates on EVERY input -- a multi-input start with one affordable and one short is rejected", () => {
    const state = stateWith({ commonOre: 100, rareMaterial: 1 });
    const result = startProcess(
      state,
      "facilityUpgrade",
      { commonOre: new Decimal(50), rareMaterial: new Decimal(5) }, // rare is short (1 < 5)
      25,
      levelUp("refinery")
    );
    expect(result.started).toBe(false);
    expect(result.next).toBe(state);
    // Neither input was touched -- the whole start is atomic, no partial deduct.
    expect(state.inventory.commonOre.toString()).toBe("100");
    expect(state.inventory.rareMaterial.toString()).toBe("1");
  });
});

describe("startProcess — double-consume guard (design §4)", () => {
  it("the SECOND of two concurrent starts fails once the first has deducted the shared materials", () => {
    // Only enough ore for ONE job. Under a naive check-now/consume-later design
    // both starts would see 10 and both begin, over-drawing to -10. Atomic
    // deduct-at-start makes that structurally impossible: the first start removes
    // the ore, so the second's gate reads the already-drawn-down balance.
    const state = stateWith({ commonOre: 10 });
    const first = startProcess(state, "refineJob", { commonOre: new Decimal(10) }, 10, addItem("refinedMaterial", 1));
    expect(first.started).toBe(true);
    expect(first.next.inventory.commonOre.toString()).toBe("0");

    const second = startProcess(
      first.next, // threaded forward from the first start's result
      "refineJob",
      { commonOre: new Decimal(10) },
      10,
      addItem("refinedMaterial", 1)
    );
    expect(second.started).toBe(false);
    expect(second.next).toBe(first.next); // rejected -- inventory never goes negative
    expect(second.next.inventory.commonOre.toString()).toBe("0");
    expect(second.next.activeProcesses).toHaveLength(1); // still just the first job
  });
});

describe("resolveProcesses — completion applies effects, lumps FA XP, removes the process (Task 8)", () => {
  it("completes an addItem process: output added via the shared seam (marks discovered), FA XP = durationTicks, process removed", () => {
    const base = freshState();
    const process: TimedProcess = {
      id: "proc-1",
      kind: "refineJob",
      remainingTicks: 10,
      durationTicks: 10,
      effect: addItem("refinedMaterial", 3),
    };
    const state = { ...base, activeProcesses: [process], nextProcessId: 2 };

    const { next, fleetAdminXpDelta } = resolveProcesses(state, 10); // exactly reaches 0

    expect(next.inventory.refinedMaterial.toString()).toBe("3"); // output granted
    expect(next.discovered).toContain("refinedMaterial"); // routed through addToInventory -> discovered
    expect(next.activeProcesses).toEqual([]); // completed process removed
    expect(fleetAdminXpDelta).toBe(10); // lump FA XP == durationTicks, once
  });

  it("completes a facilityLevelUp process: bumps the facility level, FA XP = durationTicks, process removed", () => {
    const base = freshState();
    const process: TimedProcess = {
      id: "proc-1",
      kind: "facilityUpgrade",
      remainingTicks: 25,
      durationTicks: 25,
      effect: levelUp("refinery"),
    };
    const state = { ...base, activeProcesses: [process], nextProcessId: 2 };

    const { next, fleetAdminXpDelta } = resolveProcesses(state, 30); // overshoots -- still completes once

    expect(next.facilities.refinery.level).toBe(1); // 0 -> 1
    expect(next.activeProcesses).toEqual([]);
    expect(fleetAdminXpDelta).toBe(25);
  });

  it("leaves a not-yet-done process in place with a decremented remainingTicks and zero FA XP", () => {
    const base = freshState();
    const process: TimedProcess = {
      id: "proc-1",
      kind: "refineJob",
      remainingTicks: 60,
      durationTicks: 60,
      effect: addItem("components", 2),
    };
    const state = { ...base, activeProcesses: [process], nextProcessId: 2 };

    const { next, fleetAdminXpDelta } = resolveProcesses(state, 20);

    expect(next.activeProcesses).toHaveLength(1);
    expect(next.activeProcesses[0].remainingTicks).toBe(40); // 60 - 20
    expect(next.inventory.components.toString()).toBe("0"); // NOT granted yet
    expect(fleetAdminXpDelta).toBe(0);
  });

  it("no-ops (same state reference) when there are no active processes", () => {
    const state = freshState();
    const { next, fleetAdminXpDelta } = resolveProcesses(state, 1000);
    expect(next).toBe(state);
    expect(fleetAdminXpDelta).toBe(0);
  });
});

describe("resolveProcesses — CLOSED-FORM parity (critical): one big resolve == many small (Task 8)", () => {
  it("a set of varied-remaining processes resolves identically whether stepped 1x320 or jumped once by 320", () => {
    // Varied remaining ticks + varied effects (two addItem to the SAME item to
    // exercise accumulation, one to a second item, one facility upgrade, and one
    // long-runner that does NOT complete within the window so it must SURVIVE
    // identically in both paths).
    const processes: TimedProcess[] = [
      { id: "proc-1", kind: "refineJob", remainingTicks: 1, durationTicks: 1, effect: addItem("refinedMaterial", 5) },
      { id: "proc-2", kind: "refineJob", remainingTicks: 10, durationTicks: 10, effect: addItem("refinedMaterial", 3) },
      { id: "proc-3", kind: "facilityUpgrade", remainingTicks: 25, durationTicks: 25, effect: levelUp("refinery") },
      { id: "proc-4", kind: "refineJob", remainingTicks: 60, durationTicks: 60, effect: addItem("components", 2) },
      { id: "proc-5", kind: "refineJob", remainingTicks: 500, durationTicks: 500, effect: addItem("refinedMaterial", 7) },
    ];
    const base = { ...freshState(), activeProcesses: processes, nextProcessId: 6 };

    // Path A: one big jump.
    const jumped = resolveProcesses(base, 320);

    // Path B: 320 single-tick steps, summing the FA XP deltas the same way Task 9
    // will fold each call's delta.
    let stepped = base;
    let steppedFaXp = 0;
    for (let i = 0; i < 320; i++) {
      const r = resolveProcesses(stepped, 1);
      stepped = r.next;
      steppedFaXp += r.fleetAdminXpDelta;
    }

    // Identical final state (inventory / facilities / surviving processes / discovered).
    expect(snapshot(stepped)).toEqual(snapshot(jumped.next));

    // Identical summed Fleet Admiral XP: 1 + 10 + 25 + 60 == 96 (proc-5 never
    // completes within 320, so its 500 is NOT counted in either path).
    expect(steppedFaXp).toBe(96);
    expect(jumped.fleetAdminXpDelta).toBe(96);

    // Spot-check the concrete outcome so a silent double-count/omission is caught:
    // refinedMaterial += 5 + 3 (proc-5's +7 excluded), components += 2, refinery 0->1,
    // proc-5 survives with 500 - 320 == 180 remaining.
    expect(jumped.next.inventory.refinedMaterial.toString()).toBe("8");
    expect(jumped.next.inventory.components.toString()).toBe("2");
    expect(jumped.next.facilities.refinery.level).toBe(1);
    expect(jumped.next.activeProcesses).toHaveLength(1);
    expect(jumped.next.activeProcesses[0].id).toBe("proc-5");
    expect(jumped.next.activeProcesses[0].remainingTicks).toBe(180);
  });
});

describe("save round-trip — a persisted addItem process revives effect.amount as a Decimal (Task 8)", () => {
  it("serializes a mid-process save and rehydrates effect.amount from its JSON string back into a Decimal", () => {
    const base = freshState();
    const process: TimedProcess = {
      id: "proc-1",
      kind: "refineJob",
      remainingTicks: 7,
      durationTicks: 10,
      effect: addItem("refinedMaterial", 42),
    };
    const state = { ...base, activeProcesses: [process], nextProcessId: 2 };

    // Full round-trip: serialize (Decimal -> JSON string), deserialize, migrate
    // (which runs hydrateDecimals since the save is already at SAVE_VERSION).
    const raw = serialize(state, 0);
    const save = deserialize(raw);
    expect(save).not.toBeNull();
    const revived = migrate(save!);

    const revivedProc = revived.activeProcesses[0];
    expect(revivedProc.effect.type).toBe("addItem");
    // The load-bearing assertion: amount came back as a real Decimal (has .plus),
    // not a bare string -- so the resolver's addToInventory .plus() won't throw.
    if (revivedProc.effect.type === "addItem") {
      expect(revivedProc.effect.amount).toBeInstanceOf(Decimal);
      expect(revivedProc.effect.amount.toString()).toBe("42");
    }
    // The non-Decimal scalars ride through untouched.
    expect(revivedProc.remainingTicks).toBe(7);
    expect(revivedProc.durationTicks).toBe(10);
  });
});
