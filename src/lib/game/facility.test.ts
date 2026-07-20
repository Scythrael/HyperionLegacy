// Facility framework tests, Phase 1, Task 10
// (docs/plans/2026-07-11-facility-framework-refinery-design.md §5, §6).
//
// Covers the two facility functions in tick.ts:
//   - canBuildFacilityUpgrade(state, facilityKey): pure predicate over the NEXT
//     upgrade rung (FACILITIES[key].upgrades[currentLevel]), material + prereq
//     gates, with a reason string for the first failing gate.
//   - startFacilityUpgrade(state, facilityKey): the action, on an OK gate it
//     hands the rung's materials/duration/level-up effect to the Task 8
//     startProcess engine (atomic deduct-at-start); on a failed gate it is a
//     same-reference no-op.
//
// These exercise the REAL FACILITIES table (the refinery's finite 4-level track),
// not a synthetic def, so the gate assertions double as a guard on that table's
// shape. The FA-level / talent gates live on the LATER rungs (the level 0->1
// build is intentionally ungated so a fresh save can build the refinery), so the
// gate tests set state.facilities.refinery.level to the rung whose gate they
// exercise, that is deliberate, not a workaround.

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { canBuildFacilityUpgrade, startFacilityUpgrade, resolveProcesses } from "./tick";
import { freshState, FACILITIES, type HomeworldTalentKey } from "./model";
import { itemTotal } from "./inventory";
import type { CraftLine } from "./allocation";

// Quality-bucketed inventory (Task 9a): storage is Record<string, Decimal[]> now. The
// stateWith helper wraps each seeded count into a single quality-0 bucket, and reads go
// through itemTotal (sum across buckets). Assertions are unchanged in MEANING (a total
// of "0"/"100"/"750" is still asserted), only the storage shape differs.

// A refine line reserving `remaining` iterations of refineCommonOre (100 commonOre
// each). Used by the reservation-aware upgrade tests below to reserve the SAME
// commonOre a facility upgrade costs, proving the upgrade gate now reads `free`.
function refineCommonOreLine(id: string, remaining: number): CraftLine {
  return { id, kind: "refine", recipeKey: "refineCommonOre", remaining, mode: { kind: "batch", remaining } };
}

// A fresh state with a specific inventory + optional refinery level + FA level,
// so the gates are exercised against known numbers rather than freshState's
// all-zero / level-0 / FA-1 seed.
function stateWith(opts: {
  inventory?: Record<string, number>;
  refineryLevel?: number;
  fleetAdminLevel?: number;
  unlockedHomeworldTalents?: HomeworldTalentKey[];
}) {
  const s = freshState();
  const inventory: Record<string, Decimal[]> = { ...s.inventory };
  for (const key of Object.keys(opts.inventory ?? {})) {
    // Wrap each seeded count into a single quality-0 bucket (Task 9a bucketed shape).
    inventory[key] = [new Decimal(opts.inventory![key])];
  }
  return {
    ...s,
    inventory,
    facilities: { refinery: { level: opts.refineryLevel ?? 0 } },
    fleetAdminLevel: opts.fleetAdminLevel ?? s.fleetAdminLevel,
    unlockedHomeworldTalents: opts.unlockedHomeworldTalents ?? s.unlockedHomeworldTalents,
  };
}

describe("canBuildFacilityUpgrade, fresh refinery (level 0, the build/unlock rung)", () => {
  it("is buildable with enough materials (level-0 build is ungated beyond its cost)", () => {
    // upgrades[0] = { materials: { commonOre: 100 }, ... } with no requires* gates.
    const state = stateWith({ inventory: { commonOre: 100 } });
    const result = canBuildFacilityUpgrade(state, "refinery");
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("is NOT buildable when materials are short, with a reason naming the material", () => {
    const state = stateWith({ inventory: { commonOre: 99 } }); // needs 100
    const result = canBuildFacilityUpgrade(state, "refinery");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Titanium Ore/); // ITEMS.commonOre.label (restructure reverted F1's "Deuterium Ice")
    expect(result.reason).toMatch(/100/); // the needed amount
  });
});

describe("canBuildFacilityUpgrade, prerequisite gates on the later rungs", () => {
  it("blocks when below requiresFleetAdminLevel (rung 1 requires FA level 2)", () => {
    // Refinery at level 1 -> next rung is upgrades[1], which gates on FA level 2.
    // Materials are satisfied so the FA gate is unambiguously the failing one.
    const state = stateWith({
      inventory: { commonOre: 750 },
      refineryLevel: 1,
      fleetAdminLevel: 1, // below the required 2
    });
    const result = canBuildFacilityUpgrade(state, "refinery");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Fleet Admiral level 2/);
  });

  it("passes the FA gate once fleetAdminLevel is high enough (rung 1)", () => {
    const state = stateWith({
      inventory: { commonOre: 750 },
      refineryLevel: 1,
      fleetAdminLevel: 2, // meets the required 2
    });
    expect(canBuildFacilityUpgrade(state, "refinery").ok).toBe(true);
  });

  it("blocks when a required Homeworld Talent is missing (rung 2 requires industryHub)", () => {
    // Refinery at level 2 -> next rung is upgrades[2]: FA level 5 + industryHub.
    // FA level + materials satisfied, so the missing talent is the failing gate.
    const state = stateWith({
      inventory: { commonOre: 3000, titaniumIngot: 25 },
      refineryLevel: 2,
      fleetAdminLevel: 5,
      unlockedHomeworldTalents: [], // industryHub NOT unlocked
    });
    const result = canBuildFacilityUpgrade(state, "refinery");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Homeworld Talent/);
  });

  it("passes rung 2 once FA level, talent, AND materials are all satisfied", () => {
    const state = stateWith({
      inventory: { commonOre: 3000, titaniumIngot: 25 },
      refineryLevel: 2,
      fleetAdminLevel: 5,
      unlockedHomeworldTalents: ["industryHub"],
    });
    expect(canBuildFacilityUpgrade(state, "refinery").ok).toBe(true);
  });
});

describe("canBuildFacilityUpgrade, maxed track", () => {
  it("is NOT buildable once the level equals upgrades.length (no next rung)", () => {
    const maxLevel = FACILITIES.refinery.upgrades.length; // 4
    // Give it a mountain of every material, being maxed must override affordability.
    const state = stateWith({
      inventory: { commonOre: 1e9, titaniumIngot: 1e9 },
      refineryLevel: maxLevel,
      fleetAdminLevel: 999,
      unlockedHomeworldTalents: ["industryHub"],
    });
    const result = canBuildFacilityUpgrade(state, "refinery");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/fully upgraded/);
  });

  it("returns a clear reason for an unknown facility key", () => {
    const state = stateWith({});
    const result = canBuildFacilityUpgrade(state, "warehouse"); // not in FACILITIES yet
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Unknown facility/);
  });
});

describe("startFacilityUpgrade, delegates to startProcess (atomic deduct-at-start)", () => {
  it("pushes a facilityUpgrade process, deducts materials atomically, and completes to level+1", () => {
    const state = stateWith({ inventory: { commonOre: 100 } });
    const started = startFacilityUpgrade(state, "refinery");

    expect(started.started).toBe(true);
    // Materials deducted AT START (not at completion), inventory already 0.
    expect(itemTotal(started.next.inventory, "commonOre").toString()).toBe("0");
    expect(started.next.activeProcesses).toHaveLength(1);
    const proc = started.next.activeProcesses[0];
    expect(proc.kind).toBe("facilityUpgrade");
    expect(proc.durationTicks).toBe(20); // upgrades[0].durationTicks
    expect(proc.remainingTicks).toBe(20);
    expect(proc.effect).toEqual({ type: "facilityLevelUp", facility: "refinery" });
    // Level is still 0 mid-flight, it only bumps at completion.
    expect(started.next.facilities.refinery.level).toBe(0);

    // Resolve PAST the duration -> the upgrade completes and the level increments.
    const resolved = resolveProcesses(started.next, 20);
    expect(resolved.next.facilities.refinery.level).toBe(1); // 0 -> 1
    expect(resolved.next.activeProcesses).toHaveLength(0); // process removed on completion
    expect(resolved.fleetAdminXpDelta).toBe(20); // lump FA XP = durationTicks
  });

  it("is a same-reference no-op when the gate fails (materials short)", () => {
    const state = stateWith({ inventory: { commonOre: 50 } }); // needs 100
    const result = startFacilityUpgrade(state, "refinery");
    expect(result.started).toBe(false);
    expect(result.next).toBe(state); // literally the same object, no clone on reject
    expect(itemTotal(state.inventory, "commonOre").toString()).toBe("50"); // untouched
    expect(state.activeProcesses).toEqual([]);
  });
});

describe("canBuildFacilityUpgrade, sequential-per-facility gate (one upgrade in flight at a time)", () => {
  it("blocks a second upgrade of the SAME facility while one is in flight, then re-opens after it completes", () => {
    // Enough ore for TWO level-0->1 builds (100 each). Without the sequential gate,
    // both would start (level only bumps at completion, so canBuild keeps reading
    // rung 0) and the fleet would reach level 2 while paying only the cheap rung 0
    // twice, skipping rung 1's higher cost + FA-level gate. The gate must prevent
    // the SECOND start.
    const state = stateWith({ inventory: { commonOre: 200 } });

    const first = startFacilityUpgrade(state, "refinery");
    expect(first.started).toBe(true);
    expect(first.next.activeProcesses).toHaveLength(1);
    expect(itemTotal(first.next.inventory, "commonOre").toString()).toBe("100"); // one build's cost deducted

    // The refinery now has an in-flight upgrade -> canBuild is blocked even though
    // 100 more ore is on hand and the rung is otherwise satisfiable.
    const blocked = canBuildFacilityUpgrade(first.next, "refinery");
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe("Upgrade already in progress");

    // ...and startFacilityUpgrade inherits the gate: a same-reference no-op, no
    // second process, no second deduct.
    const second = startFacilityUpgrade(first.next, "refinery");
    expect(second.started).toBe(false);
    expect(second.next).toBe(first.next);
    expect(second.next.activeProcesses).toHaveLength(1); // still just the first
    expect(itemTotal(second.next.inventory, "commonOre").toString()).toBe("100"); // not double-deducted

    // Complete the in-flight build -> level 0 -> 1, process removed. The NEXT rung
    // (upgrades[1]) is now the target. It requires FA level 2, so at fresh FA level
    // 1 canBuild reports the FA gate, NOT "already in progress" (proving the
    // in-flight block cleared on completion), and NOT the old rung 0.
    const resolved = resolveProcesses(first.next, 20);
    expect(resolved.next.facilities.refinery.level).toBe(1);
    expect(resolved.next.activeProcesses).toHaveLength(0);
    const afterComplete = canBuildFacilityUpgrade(resolved.next, "refinery");
    expect(afterComplete.ok).toBe(false);
    expect(afterComplete.reason).toMatch(/Fleet Admiral level 2/); // rung 1's gate, not "in progress"

    // Raise FA level to 2 AND top up ore to rung 1's cost (750; only 100 is left
    // after the first build's deduct) -> the next rung is buildable again,
    // confirming the sequential gate only pauses the track, never closes it.
    const readyForRung1 = {
      ...resolved.next,
      fleetAdminLevel: 2,
      inventory: { ...resolved.next.inventory, commonOre: [new Decimal(750)] },
    };
    expect(canBuildFacilityUpgrade(readyForRung1, "refinery").ok).toBe(true);
  });

});

// ── Reservation-aware material gate (Shipyard Task S2) ───────────────────────
// The leak S2 closes: canBuildFacilityUpgrade / startFacilityUpgrade used to gate
// on RAW state.inventory, so a facility upgrade could spend ore/components a craft
// LINE had already reserved (KNOWN_ISSUES). They now gate on `freeItem` (inventory
// MINUS active-line reservations). Because free <= raw, this is a STRICT tightening:
// identical behavior when nothing is reserved (free == raw), harder only when a line
// holds the material. refineCommonOre reserves commonOre; the refinery 0->1 rung
// COSTS commonOre (100), so a single 1-iteration refine line (100 reserved) exactly
// overlaps the upgrade cost, the cleanest possible leak repro.
describe("canBuildFacilityUpgrade, reservation-aware (gates on craft-line `free`, not raw inventory)", () => {
  it("BLOCKS an upgrade whose material a craft line has reserved (was affordable on raw -> leak closed)", () => {
    // 100 commonOre on hand = exactly the refinery 0->1 cost. With NO reservation the
    // raw inventory covers it, so the upgrade is affordable...
    const base = stateWith({ inventory: { commonOre: 100 } });
    expect(canBuildFacilityUpgrade(base, "refinery").ok).toBe(true); // raw == free here

    // ...but a refine line reserving all 100 (1 iteration x 100) drops free to 0,
    // so the SAME upgrade is now blocked with the material reason.
    const reserved = { ...base, refineLines: [refineCommonOreLine("line-1", 1)] };
    const result = canBuildFacilityUpgrade(reserved, "refinery");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Titanium Ore/); // ITEMS.commonOre.label
  });

  it("RE-ALLOWS the same upgrade once the reserving line is cancelled (reservation released)", () => {
    const reserved = {
      ...stateWith({ inventory: { commonOre: 100 } }),
      refineLines: [refineCommonOreLine("line-1", 1)],
    };
    expect(canBuildFacilityUpgrade(reserved, "refinery").ok).toBe(false); // reserved -> blocked

    // Cancelling the line removes the reservation (allocation is derived from the
    // live lines array), so free returns to 100 and the upgrade is buildable again.
    const released = { ...reserved, refineLines: [] };
    expect(canBuildFacilityUpgrade(released, "refinery").ok).toBe(true);
  });

  it("is UNAFFECTED when the reserved material does not overlap the upgrade cost (free == raw)", () => {
    // A fabricate line reserving structuralAssembly inputs (frameSegment/powerCoupling/
    // titaniumIngot) touches NO commonOre, so the commonOre-costed refinery upgrade sees
    // free == raw and stays buildable, proving the change is inert without overlap.
    const line: CraftLine = {
      id: "fab-1",
      kind: "fabricate",
      recipeKey: "structuralAssemblyBp",
      remaining: 3,
      mode: { kind: "batch", remaining: 3 },
    };
    const state = { ...stateWith({ inventory: { commonOre: 100 } }), fabricateLines: [line] };
    expect(canBuildFacilityUpgrade(state, "refinery").ok).toBe(true);
  });

  it("startFacilityUpgrade inherits the tightened gate: same-ref no-op when the cost is reserved", () => {
    const reserved = {
      ...stateWith({ inventory: { commonOre: 100 } }),
      refineLines: [refineCommonOreLine("line-1", 1)],
    };
    const result = startFacilityUpgrade(reserved, "refinery");
    expect(result.started).toBe(false);
    expect(result.next).toBe(reserved); // same reference, rejected before any clone
    // The reserved ore is untouched, it stays available for the line's iteration.
    expect(itemTotal(reserved.inventory, "commonOre").toString()).toBe("100");
    expect(reserved.activeProcesses).toEqual([]);
  });

  it("starts normally once the reservation is released (deduct still hits physical inventory)", () => {
    // With the line gone, free == raw == 100 -> the upgrade starts and deducts the
    // 100 commonOre from PHYSICAL inventory exactly as before (the deduct path is
    // unchanged; only the affordability GATE moved to free).
    const state = stateWith({ inventory: { commonOre: 100 } });
    const started = startFacilityUpgrade(state, "refinery");
    expect(started.started).toBe(true);
    expect(itemTotal(started.next.inventory, "commonOre").toString()).toBe("0"); // physical deduct
    expect(started.next.activeProcesses).toHaveLength(1);
  });
});

describe("canBuildFacilityUpgrade, distinct-facility concurrency (unchanged by S2)", () => {
  it("does NOT block a facility when a DIFFERENT facility has an upgrade in flight (distinct-facility concurrency preserved)", () => {
    // An in-flight upgrade whose effect targets some OTHER facility ("warehouse")
    // must not block the refinery, the gate keys strictly on effect.facility.
    const base = stateWith({ inventory: { commonOre: 100 } });
    const otherFacilityUpgrade = {
      id: "proc-99",
      kind: "facilityUpgrade" as const,
      remainingTicks: 30,
      durationTicks: 30,
      effect: { type: "facilityLevelUp" as const, facility: "warehouse" },
    };
    const state = { ...base, activeProcesses: [otherFacilityUpgrade] };

    // Refinery is still buildable despite the warehouse upgrade running.
    expect(canBuildFacilityUpgrade(state, "refinery").ok).toBe(true);
    const started = startFacilityUpgrade(state, "refinery");
    expect(started.started).toBe(true);
    expect(started.next.activeProcesses).toHaveLength(2); // warehouse's + the new refinery one
  });
});
