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
import { freshState, BLUEPRINTS, FACILITIES, FABRICATOR_FACILITY_KEY, type GameState } from "./model";
import {
  fabricateSlotCount,
  canFabricate,
  startFabricateJob,
  // The single standing-order model (startFabricateOrder/stopFabricateOrder + its
  // processFabricateOrder engine) is fully RETIRED as of Task C4, the per-slot line
  // engine replaces it, and its offline parity is proven by craft-lines.test.ts. The
  // Fabricator FACILITY / startFabricateJob / canFabricate tests (F1/F2/F3) below are
  // UNCHANGED (those functions are not retired).
  economyTick,
} from "./tick";

describe("Fabricator F1, BLUEPRINTS craftDurationTicks", () => {
  it("every blueprint has a positive, finite craftDurationTicks", () => {
    for (const key of Object.keys(BLUEPRINTS)) {
      const bp = BLUEPRINTS[key];
      expect(Number.isFinite(bp.craftDurationTicks)).toBe(true);
      expect(bp.craftDurationTicks).toBeGreaterThan(0);
    }
  });
});

describe("Fabricator F1, FACILITIES.fabricator (tier + slot upgrade track)", () => {
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

describe("Fabricator F1, fabricateSlotCount + fresh-state seed", () => {
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
    // asserted against the rung data rather than a hard-coded 2, retuning a rung's
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
// level 1, and NOTHING researched, so the fixture explicitly grants the blueprint.
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
  };
}

// Runs economyTick(state, 1) `n` times, the SAME per-tick stepping tick()'s offline
// catch-up loop performs. Mirrors refine-order.test.ts's `stepTicks`.
function stepTicks(state: GameState, n: number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = economyTick(s, 1);
  return s;
}

describe("Fabricator F2, startFabricateJob (atomic deduct + timed craft push)", () => {
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
    expect(r.next).toBe(s); // same reference, nothing deducted, no process pushed
  });

  it("blocks (same-ref no-op) when the blueprint's tier exceeds the fabricator level", () => {
    // structuralAssemblyBp is tier 2; a level-1 fabricator cannot craft it even with
    // materials researched. Tier is gated ahead of affordability, so the missing
    // powerCoupling never matters, tierLocked returns first.
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
    expect(second.next).toBe(first.next); // same reference, slot cap held
  });
});

describe("Fabricator F2, completion adds output + increments itemsCrafted (idempotent)", () => {
  it("stepping a craft to done adds outputQty, bumps itemsCrafted, and never double-counts", () => {
    const started = startFabricateJob(fabState({ titaniumIngot: 4 }), "frameSegmentBp");
    expect(started.started).toBe(true);

    // Step past the 120-tick craft (completes at tick 121). No standing order, so
    // nothing new starts after, the one job resolves exactly once.
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
    // Admiral XP, it is EXCLUDED from resolveProcesses' lump award, mirroring
    // researchProject/fuelRefineJob (blueprint-gated, long-duration automated economies
    // that must not perturb the tuned FA-XP curve), NOT the tiny-duration Phase-1
    // refineJob which keeps its award. The idle captain earns none either, so FA XP/level
    // stay at their fresh values through the whole craft. Flip this (and the exclusion in
    // resolveProcesses) together if fabrication should feed FA XP.
    expect(done.fleetAdminXp.toString()).toBe("0");
    expect(done.fleetAdminLevel).toBe(1);
  });
});

// The startFabricateOrder / stopFabricateOrder (pure set/clear) describe block was
// REMOVED in Task C4: those setters are retired with the single-order model. The
// per-slot line setters (startLine/cancelLine) are covered in craft-lines.test.ts.

// NOTE (Task C2): the "count-N order produces exactly N", "mid-run shortfall pauses",
// and "offline == live parity" describe blocks that lived here tested the RETIRED
// processFabricateOrder engine (driven through economyTick). That engine is gone --
// replaced by the per-slot line engine (processFabricateLines), so those blocks were
// removed. The equivalent behavior (batch produces exactly N then the line clears;
// concurrent lines; the ⚠️ multi-line offline==live parity, NON-VACUOUS) is now covered
// in craft-lines.test.ts. The startFabricateJob completion + F3 canFabricate tests below
// are UNCHANGED (those functions are not retired).

// ============================================================================
// Task F3 (AVAILABILITY GATE): canFabricate is the single consolidated fabricate
// gate, a pure predicate mirroring canResearch. It folds F2's inline
// startFabricateJob guards into one typed-reason result the F4 UI can switch on.
// These tests parallel research.test.ts's canResearch block against the SAME
// frameSegmentBp fixture (titaniumIngot x4 -> frameSegment x1; frameSegment is a
// tier-1 item, warehouse cap 1,000,000). They pin:
//   - each FabricateBlockReason for its own unmet condition (notFound /
//     notResearched / tierLocked / noSlot / materials / storageFull);
//   - { ok: true } when every gate passes;
//   - GATE-ORDER precedence (notResearched -> tierLocked -> ... -> materials ->
//     storageFull), especially the materials-before-storageFull nuance the plan calls
//     out (both fail at once -> "materials" surfaces);
//   - startFabricateJob now DELEGATES to canFabricate: same-ref no-op + the reason on
//     each block, and the UNCHANGED F2 deduct/start path (reason undefined) on ok.
// ============================================================================

describe("Fabricator F3, canFabricate returns each reason for its unmet condition", () => {
  it("notFound, no blueprint has that key (defensive)", () => {
    expect(canFabricate(fabState({ titaniumIngot: 100 }), "notARealBlueprint")).toEqual({
      ok: false,
      reason: "notFound",
    });
  });

  it("notResearched, the blueprint is not in researchedBlueprints", () => {
    const s = fabState({ titaniumIngot: 100, researched: [] });
    expect(canFabricate(s, "frameSegmentBp")).toEqual({ ok: false, reason: "notResearched" });
  });

  it("tierLocked, the blueprint's tier exceeds the fabricator level", () => {
    // structuralAssemblyBp is tier 2; a researched tier-2 blueprint on a level-1
    // fabricator is tier-locked even with ample materials.
    const s = fabState({
      titaniumIngot: 100,
      frameSegment: 100,
      researched: ["structuralAssemblyBp"],
      fabricatorLevel: 1,
    });
    expect(canFabricate(s, "structuralAssemblyBp")).toEqual({ ok: false, reason: "tierLocked" });
  });

  it("noSlot, every fabricate slot is busy (active jobs >= fabricateSlotCount)", () => {
    // 1 slot on a fresh level-1 fabricator. Start one job to fill it, then the next
    // gate check sees no free slot (materials still ample, output not at cap).
    const s0 = fabState({ titaniumIngot: 100 });
    const busy = startFabricateJob(s0, "frameSegmentBp");
    expect(busy.started).toBe(true);
    expect(canFabricate(busy.next, "frameSegmentBp")).toEqual({ ok: false, reason: "noSlot" });
  });

  it("materials, a recipe input is unaffordable (on-hand < required)", () => {
    // frameSegmentBp needs titaniumIngot x4; on-hand 3 is short.
    const s = fabState({ titaniumIngot: 3 });
    expect(canFabricate(s, "frameSegmentBp")).toEqual({ ok: false, reason: "materials" });
  });

  it("storageFull, the output component is at its warehouse cap", () => {
    // frameSegment (tier 1) cap is 1,000,000 at warehouse level 0; AT the cap counts
    // as full (materialAtCap uses >=). Inputs ample so only the cap gate fails.
    const s = fabState({ titaniumIngot: 100, frameSegment: 1_000_000 });
    expect(canFabricate(s, "frameSegmentBp")).toEqual({ ok: false, reason: "storageFull" });
  });

  it("{ ok: true } when every gate passes", () => {
    expect(canFabricate(fabState({ titaniumIngot: 100 }), "frameSegmentBp")).toEqual({ ok: true });
  });
});

describe("Fabricator F3, gate-order precedence (which reason surfaces when several fail)", () => {
  it("notResearched wins over materials + storageFull when all three fail", () => {
    // Not researched AND no materials AND output at cap -> the most-fundamental
    // (identity/ownership) reason surfaces first.
    const s = fabState({ titaniumIngot: 0, frameSegment: 1_000_000, researched: [] });
    expect(canFabricate(s, "frameSegmentBp")).toEqual({ ok: false, reason: "notResearched" });
  });

  it("tierLocked wins over materials when both fail", () => {
    // Researched tier-2 blueprint, level-1 fabricator, zero of its inputs -> tier
    // gate (checked before materials) surfaces.
    const s = fabState({
      titaniumIngot: 0,
      frameSegment: 0,
      researched: ["structuralAssemblyBp"],
      fabricatorLevel: 1,
    });
    expect(canFabricate(s, "structuralAssemblyBp")).toEqual({ ok: false, reason: "tierLocked" });
  });

  it("materials wins over storageFull when both fail (the plan's ordering nuance)", () => {
    // Inputs short AND output at cap: "materials" is checked BEFORE "storageFull", so
    // the affordability reason surfaces, the explicit-before-startProcess ordering
    // F3 requires (mirrors canResearch checking credits before the process gate).
    const s = fabState({ titaniumIngot: 3, frameSegment: 1_000_000 });
    expect(canFabricate(s, "frameSegmentBp")).toEqual({ ok: false, reason: "materials" });
  });
});

describe("Fabricator F3, startFabricateJob delegates to canFabricate (reason + unchanged ok path)", () => {
  it("on ok: still deducts inputs + pushes ONE job, reason undefined (F2 path unchanged)", () => {
    const s = fabState({ titaniumIngot: 10 });
    const r = startFabricateJob(s, "frameSegmentBp");
    expect(r.started).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.next.inventory.titaniumIngot.toString()).toBe("6"); // 10 - 4 atomic deduct
    expect(r.next.activeProcesses.filter((p) => p.kind === "fabricateJob")).toHaveLength(1);
  });

  it("notFound block: same-ref no-op with reason 'notFound'", () => {
    const s = fabState({ titaniumIngot: 100 });
    const r = startFabricateJob(s, "notARealBlueprint");
    expect(r.started).toBe(false);
    expect(r.reason).toBe("notFound");
    expect(r.next).toBe(s);
  });

  it("notResearched block: same-ref no-op with reason 'notResearched'", () => {
    const s = fabState({ titaniumIngot: 100, researched: [] });
    const r = startFabricateJob(s, "frameSegmentBp");
    expect(r.started).toBe(false);
    expect(r.reason).toBe("notResearched");
    expect(r.next).toBe(s);
  });

  it("tierLocked block: same-ref no-op with reason 'tierLocked'", () => {
    const s = fabState({
      titaniumIngot: 100,
      frameSegment: 100,
      researched: ["structuralAssemblyBp"],
      fabricatorLevel: 1,
    });
    const r = startFabricateJob(s, "structuralAssemblyBp");
    expect(r.started).toBe(false);
    expect(r.reason).toBe("tierLocked");
    expect(r.next).toBe(s);
  });

  it("noSlot block: same-ref no-op with reason 'noSlot'", () => {
    const busy = startFabricateJob(fabState({ titaniumIngot: 100 }), "frameSegmentBp");
    const r = startFabricateJob(busy.next, "frameSegmentBp");
    expect(r.started).toBe(false);
    expect(r.reason).toBe("noSlot");
    expect(r.next).toBe(busy.next);
  });

  it("materials block: same-ref no-op with reason 'materials'", () => {
    const s = fabState({ titaniumIngot: 3 });
    const r = startFabricateJob(s, "frameSegmentBp");
    expect(r.started).toBe(false);
    expect(r.reason).toBe("materials");
    expect(r.next).toBe(s);
  });

  it("storageFull block: same-ref no-op with reason 'storageFull'", () => {
    const s = fabState({ titaniumIngot: 100, frameSegment: 1_000_000 });
    const r = startFabricateJob(s, "frameSegmentBp");
    expect(r.started).toBe(false);
    expect(r.reason).toBe("storageFull");
    expect(r.next).toBe(s);
  });
});
