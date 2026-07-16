// ============================================================================
// Fabricator (Phase 4) tests
//
// Task F1 (DATA MODEL): the Fabricator facility mirrors the Research Lab exactly
// (FACILITIES.research / researchSlotCount / the level-1 fresh seed). These tests
// pin down:
//   - every BLUEPRINTS entry carries a positive-finite craftDurationTicks (the
//     Fabricator's time cost, the analog of researchDurationTicks);
//   - FACILITIES.fabricator exists with a FINITE upgrade track whose rung COUNT
//     equals the number of blueprint tiers (each level unlocks the next tier, the
//     SAME level-derived tier gate the Research Lab uses) and whose chosen rungs
//     carry an { addFabricateSlots } grant;
//   - fabricateSlotCount derives 1 slot on a fresh (level-1) save and rises per the
//     rung data once the facility reaches level 2;
//   - freshState seeds the facility at level 1.
//
// Deliberately parallels research.test.ts's R2 block. Assertions on the level-2
// slot count are computed FROM the rung data (not a magic literal) so retuning a
// rung's addFabricateSlots keeps the test honest.
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, BLUEPRINTS, FACILITIES, FABRICATOR_FACILITY_KEY, type GameState, type FabricateOrder } from "./model";
import {
  fabricateSlotCount,
  startFabricateJob,
  startFabricateOrder,
  stopFabricateOrder,
  processFabricateOrder,
  economyTick,
  tick,
} from "./tick";

describe("Fabricator F1 — BLUEPRINTS craftDurationTicks", () => {
  it("every blueprint has a positive, finite craftDurationTicks", () => {
    for (const key of Object.keys(BLUEPRINTS)) {
      const bp = BLUEPRINTS[key];
      expect(Number.isFinite(bp.craftDurationTicks)).toBe(true);
      expect(bp.craftDurationTicks).toBeGreaterThan(0);
    }
  });
});

describe("Fabricator F1 — FACILITIES.fabricator (tier + slot upgrade track)", () => {
  it("exists, is labelled 'Fabricator', with a FINITE track (one rung per blueprint tier)", () => {
    const fab = FACILITIES.fabricator;
    expect(fab).toBeDefined();
    expect(fab.label).toBe("Fabricator");

    // Level-derived tier gate (like the Research Lab): the track has exactly one
    // rung per blueprint tier, so reaching level L unlocks fabrication of tier L.
    const maxTier = Math.max(...Object.values(BLUEPRINTS).map((bp) => bp.tier));
    expect(fab.upgrades.length).toBe(maxTier);
    expect(maxTier).toBe(2); // real content today: tiers 1-2 only (finite, no placeholder rungs)
  });

  it("the founding rung (0->1) grants the first fabricate slot, ungated + zero-cost", () => {
    const founding = FACILITIES.fabricator.upgrades[0];
    expect(founding.effect).toEqual({ addFabricateSlots: 1 });
    expect(founding.durationTicks).toBe(0);
    expect(founding.credits).toBeUndefined();
  });

  it("the level 1->2 rung unlocks tier 2, adds a slot, and is CREDITS-gated (no materials)", () => {
    const rung = FACILITIES.fabricator.upgrades[1];
    expect(rung.effect).toEqual({ addFabricateSlots: 1 }); // +1 slot on this chosen rung
    expect(rung.materials).toEqual({});                    // materials are the CRAFT cost, not the upgrade cost
    expect(rung.credits).toBeDefined();                    // upgrades cost credits, like every other facility
  });

  it("FABRICATOR_FACILITY_KEY resolves to the FACILITIES entry", () => {
    expect(FABRICATOR_FACILITY_KEY).toBe("fabricator");
    expect(FACILITIES[FABRICATOR_FACILITY_KEY]).toBe(FACILITIES.fabricator);
  });
});

describe("Fabricator F1 — fabricateSlotCount + fresh-state seed", () => {
  it("freshState seeds the fabricator facility at level 1", () => {
    expect(freshState().facilities[FABRICATOR_FACILITY_KEY]).toEqual({ level: 1 });
  });

  it("fabricateSlotCount is 1 on a fresh state (level 1 = one slot)", () => {
    expect(fabricateSlotCount(freshState())).toBe(1);
  });

  it("fabricateSlotCount rises per the rung data once the facility reaches level 2", () => {
    const state = freshState();
    state.facilities[FABRICATOR_FACILITY_KEY] = { level: 2 };

    // Expected = SUM of addFabricateSlots across the reached rungs (upgrades[0..1]),
    // asserted against the rung data rather than a hard-coded 2 -- retuning a rung's
    // slot grant keeps this test in sync automatically.
    const expected = FACILITIES.fabricator.upgrades
      .slice(0, 2)
      .reduce((sum, u) => sum + ("addFabricateSlots" in u.effect ? u.effect.addFabricateSlots : 0), 0);

    expect(fabricateSlotCount(state)).toBe(expected);
  });

  it("fabricateSlotCount is 0 when the facility is absent (defensive level-0 read)", () => {
    const state = freshState();
    delete state.facilities[FABRICATOR_FACILITY_KEY];
    expect(fabricateSlotCount(state)).toBe(0);
  });
});

// ============================================================================
// Task F2 (FABRICATE ENGINE): the fabricate-order engine is a LINE-FOR-LINE clone of
// the Refinery's refine-order engine (startRefineJob / startRefineOrder /
// stopRefineOrder / processRefineOrder, tick.ts), swapping REFINE_RECIPES for
// BLUEPRINTS[key].recipe and adding the research/tier gates a blueprint carries. These
// tests parallel refine-order.test.ts's blocks against the frameSegmentBp fixture
// (titaniumIngot x4 -> frameSegment x1 over craftDurationTicks=120), the SAME
// known-numbers style. freshState seeds the fabricator at level 1 (1 slot), research
// level 1, and NOTHING researched -- so the fixture explicitly grants the blueprint.
// ============================================================================

// A fresh state with a chosen fabricator level, researched-blueprint set, inventory,
// and standing fabricate order, so the slot / research / tier / afford / cap gates are
// exercised against known numbers. Mirrors refine-order.test.ts's `orderState`, reading
// the fabricator's inputs (titaniumIngot) + output (frameSegment). The captain stays
// IDLE (freshState's captain has mission: null), so no mission economy / rng runs --
// these tests isolate the fabricate engine, exactly as the refine-order tests isolate
// the refine engine.
function fabState(opts: {
  titaniumIngot?: number;
  frameSegment?: number;
  fabricatorLevel?: number;
  researched?: string[];
  order?: FabricateOrder | null;
}): GameState {
  const s = freshState();
  const inventory: Record<string, Decimal> = { ...s.inventory };
  if (opts.titaniumIngot !== undefined) inventory.titaniumIngot = new Decimal(opts.titaniumIngot);
  if (opts.frameSegment !== undefined) inventory.frameSegment = new Decimal(opts.frameSegment);
  return {
    ...s,
    inventory,
    facilities: { ...s.facilities, fabricator: { level: opts.fabricatorLevel ?? 1 } },
    // Default: the tier-1 Frame Segment blueprint is researched so the happy-path gates
    // pass. A test that wants the not-researched block passes `researched: []`.
    researchedBlueprints: opts.researched ?? ["frameSegmentBp"],
    fabricateOrder: opts.order ?? null,
  };
}

// Runs economyTick(state, 1) `n` times -- the SAME per-tick stepping tick()'s offline
// catch-up loop performs. Mirrors refine-order.test.ts's `stepTicks`.
function stepTicks(state: GameState, n: number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = economyTick(s, 1);
  return s;
}

// A comparable snapshot of the fabricate-order-relevant state, for the offline==stepped
// parity assertion. Decimals -> strings; processes -> their scalar fields (order is
// stable per resolveProcesses' rebuild); fabricateOrder is a plain object (no Decimal).
// Mirrors refine-order.test.ts's `orderSnapshot`.
function fabSnapshot(state: GameState) {
  return {
    titaniumIngot: (state.inventory.titaniumIngot ?? new Decimal(0)).toString(),
    frameSegment: (state.inventory.frameSegment ?? new Decimal(0)).toString(),
    processes: state.activeProcesses.map((p) => ({
      id: p.id,
      kind: p.kind,
      remainingTicks: p.remainingTicks,
      durationTicks: p.durationTicks,
    })),
    fabricateOrder: state.fabricateOrder,
  };
}

describe("Fabricator F2 — startFabricateJob (atomic deduct + timed craft push)", () => {
  it("deducts the recipe inputs once and pushes ONE fabricateJob on a valid craft", () => {
    const result = startFabricateJob(fabState({ titaniumIngot: 10 }), "frameSegmentBp");
    expect(result.started).toBe(true);
    expect(result.next.inventory.titaniumIngot.toString()).toBe("6"); // 10 - 4 (atomic deduct)

    const jobs = result.next.activeProcesses.filter((p) => p.kind === "fabricateJob");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].durationTicks).toBe(120); // === BLUEPRINTS.frameSegmentBp.craftDurationTicks
    expect(jobs[0].remainingTicks).toBe(120); // countdown starts full
    // Completion effect reuses the shared addItem effect (no new resolveProcesses branch).
    expect(jobs[0].effect.type).toBe("addItem");
    expect((jobs[0].effect as { itemId: string }).itemId).toBe("frameSegment");
    expect((jobs[0].effect as { amount: Decimal }).amount.toString()).toBe("1"); // recipe.outputQty
  });

  it("blocks (same-ref no-op) when the blueprint is NOT researched", () => {
    const s = fabState({ titaniumIngot: 20, researched: [] });
    const r = startFabricateJob(s, "frameSegmentBp");
    expect(r.started).toBe(false);
    expect(r.next).toBe(s); // same reference -- nothing deducted, no process pushed
  });

  it("blocks (same-ref no-op) when the blueprint's tier exceeds the fabricator level", () => {
    // structuralAssemblyBp is tier 2; a level-1 fabricator cannot craft it even with
    // materials researched. Tier is gated ahead of affordability, so the missing
    // powerCoupling never matters -- tierLocked returns first.
    const s = fabState({
      titaniumIngot: 100,
      frameSegment: 100,
      researched: ["structuralAssemblyBp"],
      fabricatorLevel: 1,
    });
    const r = startFabricateJob(s, "structuralAssemblyBp");
    expect(r.started).toBe(false);
    expect(r.next).toBe(s);
  });

  it("blocks a further start (same-ref) once every fabricate slot is busy", () => {
    // fabricateSlotCount is 1 on a fresh (level-1) fabricator: the first start fills the
    // one slot, the second is rejected same-ref.
    const s0 = fabState({ titaniumIngot: 20 });
    expect(fabricateSlotCount(s0)).toBe(1);

    const first = startFabricateJob(s0, "frameSegmentBp");
    expect(first.started).toBe(true);

    const second = startFabricateJob(first.next, "frameSegmentBp");
    expect(second.started).toBe(false);
    expect(second.next).toBe(first.next); // same reference -- slot cap held
  });
});

describe("Fabricator F2 — completion adds output + increments itemsCrafted (idempotent)", () => {
  it("stepping a craft to done adds outputQty, bumps itemsCrafted, and never double-counts", () => {
    const started = startFabricateJob(fabState({ titaniumIngot: 4 }), "frameSegmentBp");
    expect(started.started).toBe(true);

    // Step past the 120-tick craft (completes at tick 121). No standing order, so
    // nothing new starts after -- the one job resolves exactly once.
    const done = stepTicks(started.next, 121);
    expect(done.inventory.frameSegment.toString()).toBe("1"); // recipe.outputQty granted
    expect(done.discovered).toContain("frameSegment"); // shared addItem discovery seam
    expect(done.lifetimeStats.itemsCrafted.frameSegment.toString()).toBe("1"); // mirror of itemsRefined
    expect(done.activeProcesses).toHaveLength(0); // completed process dropped

    // Idempotent: stepping far past completion never re-applies the effect.
    const later = stepTicks(done, 200);
    expect(later.inventory.frameSegment.toString()).toBe("1");
    expect(later.lifetimeStats.itemsCrafted.frameSegment.toString()).toBe("1");

    // DESIGN DECISION (flagged to controller): a completed fabricateJob awards NO Fleet
    // Admiral XP -- it is EXCLUDED from resolveProcesses' lump award, mirroring
    // researchProject/fuelRefineJob (blueprint-gated, long-duration automated economies
    // that must not perturb the tuned FA-XP curve), NOT the tiny-duration Phase-1
    // refineJob which keeps its award. The idle captain earns none either, so FA XP/level
    // stay at their fresh values through the whole craft. Flip this (and the exclusion in
    // resolveProcesses) together if fabrication should feed FA XP.
    expect(done.fleetAdminXp.toString()).toBe("0");
    expect(done.fleetAdminLevel).toBe(1);
  });
});

describe("Fabricator F2 — startFabricateOrder / stopFabricateOrder (pure set / clear)", () => {
  it("sets a batch order (running, no pausedReason) without mutating the input", () => {
    const state = fabState({});
    const next = startFabricateOrder(state, "frameSegmentBp", { kind: "batch", remaining: 5 });
    expect(next.fabricateOrder).toEqual({ blueprintKey: "frameSegmentBp", mode: { kind: "batch", remaining: 5 } });
    expect(next.fabricateOrder?.pausedReason).toBeUndefined();
    expect(state.fabricateOrder).toBeNull(); // input untouched (immutability)
  });

  it("is a same-reference no-op for an unknown blueprint key", () => {
    const state = fabState({});
    const next = startFabricateOrder(state, "notARealBlueprint", { kind: "continuous" });
    expect(next).toBe(state);
    expect(next.fabricateOrder).toBeNull();
  });

  it("stopFabricateOrder clears an active order; is a same-reference no-op when none is set", () => {
    const withOrder = startFabricateOrder(fabState({}), "frameSegmentBp", { kind: "continuous" });
    expect(stopFabricateOrder(withOrder).fabricateOrder).toBeNull();

    const none = fabState({});
    expect(stopFabricateOrder(none)).toBe(none);
  });
});

describe("Fabricator F2 — count-N order produces exactly N then idles", () => {
  it("a batch of 3 on a single-slot fabricator crafts 3 components, consumes 3x inputs, then clears", () => {
    // 1 slot => sequential crafts, 120 ticks each. Batch of 3, titaniumIngot for exactly
    // 3 crafts (12). Step well past the 3rd craft's completion (~361).
    const state = fabState({
      titaniumIngot: 12,
      order: { blueprintKey: "frameSegmentBp", mode: { kind: "batch", remaining: 3 } },
    });
    const done = stepTicks(state, 400);

    expect(done.inventory.frameSegment.toString()).toBe("3"); // exactly N
    expect(done.inventory.titaniumIngot.toString()).toBe("0"); // 12 - 3*4 consumed
    expect(done.activeProcesses).toHaveLength(0);
    expect(done.fabricateOrder).toBeNull(); // batch cleared at remaining 0
    expect(done.lifetimeStats.itemsCrafted.frameSegment.toString()).toBe("3");
  });

  it("a batch never over-produces: exactly N even after many extra ticks", () => {
    const state = fabState({
      titaniumIngot: 40, // ample -- proves the batch COUNT is the stop, not the material
      order: { blueprintKey: "frameSegmentBp", mode: { kind: "batch", remaining: 2 } },
    });
    const done = stepTicks(state, 600);
    expect(done.inventory.frameSegment.toString()).toBe("2"); // never a 3rd
    expect(done.fabricateOrder).toBeNull();
    expect(done.activeProcesses).toHaveLength(0);
  });
});

describe("Fabricator F2 — mid-run material shortfall pauses (noInput) and auto-resumes", () => {
  it("crafts what it can afford, pauses noInput with the remaining count, then resumes when inputs return", () => {
    // Batch of 5 but material for only 1 craft (titaniumIngot 4). 1 slot. After the one
    // affordable craft completes and the slot frees, the next iteration is unaffordable
    // -> pause noInput with 4 remaining.
    const state = fabState({
      titaniumIngot: 4,
      order: { blueprintKey: "frameSegmentBp", mode: { kind: "batch", remaining: 5 } },
    });
    const paused = stepTicks(state, 130); // past the first craft's completion (tick 121)
    expect(paused.inventory.frameSegment.toString()).toBe("1"); // one craft done
    expect(paused.inventory.titaniumIngot.toString()).toBe("0"); // consumed
    expect(paused.activeProcesses).toHaveLength(0); // job finished, none started (unaffordable)
    expect(paused.fabricateOrder).toEqual({
      blueprintKey: "frameSegmentBp",
      mode: { kind: "batch", remaining: 4 }, // 5 - 1 started
      pausedReason: "noInput",
    });

    // Materials land (a refinery run delivers titanium ingots) -> next tick resumes: one
    // craft starts (1 slot), 4 deducted, remaining 4 -> 3, pause clears.
    const refuelled: GameState = {
      ...paused,
      inventory: { ...paused.inventory, titaniumIngot: new Decimal(8) },
    };
    const resumed = economyTick(refuelled, 1);
    expect(resumed.activeProcesses.filter((p) => p.kind === "fabricateJob")).toHaveLength(1);
    expect(resumed.inventory.titaniumIngot.toString()).toBe("4"); // 8 - 4
    expect(resumed.fabricateOrder).toEqual({
      blueprintKey: "frameSegmentBp",
      mode: { kind: "batch", remaining: 3 }, // 4 - 1 started
    });
    expect(resumed.fabricateOrder?.pausedReason).toBeUndefined(); // auto-resumed
  });
});

describe("Fabricator F2 — offline == live parity (the high-risk seam)", () => {
  it("tick(bigSpan) equals looping economyTick(_,1) for inventory, processes, and fabricateOrder — NON-VACUOUS", () => {
    // A continuous order with titaniumIngot for exactly 3 crafts (12) on a 1-slot
    // fabricator, captain idle (no mission rng), tickDurationSeconds 1 so seconds ==
    // ticks. Over SPAN=250 ticks: craft1 done@121, craft2 done@241 (starts craft3,
    // draining the last 4 ingots), craft3 still in flight at 250 -> a craft completes
    // MID-SPAN and one is in flight, exercising both the resolve seam and the order refill.
    const base = fabState({
      titaniumIngot: 12,
      order: { blueprintKey: "frameSegmentBp", mode: { kind: "continuous" } },
    });
    const SPAN = 250;

    // Path A: one offline catch-up call (tick() internally steps economyTick(_,1) per
    // whole tick). Path B: hand-stepped economyTick, one tick at a time.
    const jumped = tick(SPAN, base);
    const stepped = stepTicks(base, SPAN);

    expect(fabSnapshot(jumped)).toEqual(fabSnapshot(stepped));

    // NON-VACUITY (the parity would pass trivially if nothing happened): assert real work
    // occurred across the span -- components PRODUCED, inputs CONSUMED, processes RESOLVED,
    // and one still in flight.
    expect(jumped.inventory.frameSegment.toString()).toBe("2"); // 2 crafts completed (produced)
    expect(jumped.lifetimeStats.itemsCrafted.frameSegment.toString()).toBe("2"); // 2 processes resolved
    expect(jumped.inventory.titaniumIngot.toString()).toBe("0"); // 12 consumed (3 crafts' inputs)
    expect(jumped.activeProcesses.filter((p) => p.kind === "fabricateJob")).toHaveLength(1); // craft3 in flight
    expect(jumped.fabricateOrder).toEqual({ blueprintKey: "frameSegmentBp", mode: { kind: "continuous" } }); // still running
  });
});
