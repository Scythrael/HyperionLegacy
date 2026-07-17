// ============================================================================
// Per-slot production LINE engine tests — Crafting Allocation Redesign, Task C2
// (docs/plans/2026-07-16-crafting-allocation-redesign-design.md §2).
//
// Covers the per-slot line data model + engine that REPLACES the retired single-order
// engine (processRefineOrder/processFabricateOrder, removed in C2):
//   - startLine : append a line to a facility (mints a monotonic "craft-N" id); slot
//                 cap + unknown-recipe + zero-batch guards.
//   - cancelLine: remove a line -> its UNSTARTED reservation releases (allocated drops);
//                 any IN-FLIGHT job it started is left to COMPLETE normally (no refund).
//   - processRefineLines / processFabricateLines : the per-tick engine, one in-flight
//                 job per line, driven through economyTick.
//   - ⚠️ MULTI-LINE offline == live parity (the high-risk seam the controller re-verifies):
//                 tick(bigSpan) == looping economyTick(_,1) across TWO lines of DIFFERENT
//                 recipes, one finishing mid-span + another in flight. NON-VACUOUS.
//
// Known-numbers fixtures (real registry keys):
//   - refineCommonOre  : commonOre x100 -> refinedMaterial x1 over 10 ticks (1 refine slot @ refinery level 1).
//   - frameSegmentBp   : titaniumIngot x4 -> frameSegment x1 over 120 ticks (1 fabricate slot @ fabricator level 1).
// The captain stays IDLE (freshState's captain has mission: null), so no mission
// economy / rng runs -- these tests isolate the line engine.
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  startLine,
  cancelLine,
  canStartLine,
  maxAffordableIterations,
  processRefineLines,
  processFabricateLines,
  economyTick,
  tick,
  refineSlotCount,
} from "./tick";
import { allocatedItem, freeItem, type CraftLine } from "./allocation";
import { freshState, type GameState } from "./model";

// A fresh state with chosen facility levels + inventory + seeded lines, so the slot /
// afford / cap gates run against known numbers. Refinery level 1 => 1 refine slot;
// fabricator level 1 => 1 fabricate slot (freshState seeds refinery at level 0, so we
// MUST bump it for any refine line to start). frameSegmentBp is researched by default
// (realistic; the C2 line engine itself does not gate on research -- that is C3).
function linesState(opts: {
  commonOre?: number;
  refinedMaterial?: number;
  titaniumIngot?: number;
  frameSegment?: number;
  refineryLevel?: number;
  fabricatorLevel?: number;
  refineLines?: CraftLine[];
  fabricateLines?: CraftLine[];
  nextCraftLineId?: number;
}): GameState {
  const s = freshState();
  const inventory: Record<string, Decimal> = { ...s.inventory };
  if (opts.commonOre !== undefined) inventory.commonOre = new Decimal(opts.commonOre);
  if (opts.refinedMaterial !== undefined) inventory.refinedMaterial = new Decimal(opts.refinedMaterial);
  if (opts.titaniumIngot !== undefined) inventory.titaniumIngot = new Decimal(opts.titaniumIngot);
  if (opts.frameSegment !== undefined) inventory.frameSegment = new Decimal(opts.frameSegment);
  return {
    ...s,
    inventory,
    facilities: {
      ...s.facilities,
      refinery: { level: opts.refineryLevel ?? 1 },
      fabricator: { level: opts.fabricatorLevel ?? 1 },
    },
    researchedBlueprints: ["frameSegmentBp"],
    refineLines: opts.refineLines ?? [],
    fabricateLines: opts.fabricateLines ?? [],
    nextCraftLineId: opts.nextCraftLineId ?? 1,
  };
}

// Runs economyTick(state, 1) `n` times -- the SAME per-tick stepping tick()'s offline
// catch-up loop performs.
function stepTicks(state: GameState, n: number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = economyTick(s, 1);
  return s;
}

// A comparable snapshot for the offline==stepped parity assertion. Decimals -> strings;
// processes -> their scalar fields PLUS lineId (proving the job<->line tie survives both
// paths identically); the line arrays are plain objects (no Decimal), compared as-is.
function lineSnapshot(state: GameState) {
  return {
    commonOre: (state.inventory.commonOre ?? new Decimal(0)).toString(),
    refinedMaterial: (state.inventory.refinedMaterial ?? new Decimal(0)).toString(),
    titaniumIngot: (state.inventory.titaniumIngot ?? new Decimal(0)).toString(),
    frameSegment: (state.inventory.frameSegment ?? new Decimal(0)).toString(),
    processes: state.activeProcesses.map((p) => ({
      id: p.id,
      kind: p.kind,
      remainingTicks: p.remainingTicks,
      durationTicks: p.durationTicks,
      lineId: p.lineId,
    })),
    refineLines: state.refineLines,
    fabricateLines: state.fabricateLines,
  };
}

// --- startLine ---------------------------------------------------------------
describe("startLine — appends a line + mints a monotonic id", () => {
  it("appends a batch refine line, mints craft-1, bumps nextCraftLineId, does not mutate the input", () => {
    const state = linesState({ commonOre: 1000 });
    // C3: startLine now returns { next, started, reason? }; destructure the resulting state.
    const { next } = startLine(state, "refine", "refineCommonOre", { kind: "batch", remaining: 5 });

    expect(next.refineLines).toHaveLength(1);
    expect(next.refineLines[0]).toEqual({
      id: "craft-1",
      kind: "refine",
      recipeKey: "refineCommonOre",
      remaining: 5, // batch count = allocation basis
      mode: { kind: "batch", remaining: 5 },
    });
    expect(next.nextCraftLineId).toBe(2);
    expect(state.refineLines).toHaveLength(0); // input untouched (immutability)
  });

  it("a continuous line reserves exactly ONE queued iteration (remaining held at 1)", () => {
    const { next } = startLine(linesState({ commonOre: 1000 }), "refine", "refineCommonOre", { kind: "continuous" });
    expect(next.refineLines[0].remaining).toBe(1);
    expect(next.refineLines[0].mode).toEqual({ kind: "continuous" });
  });

  it("appends a fabricate line to fabricateLines (not refineLines)", () => {
    const { next } = startLine(linesState({ titaniumIngot: 40 }), "fabricate", "frameSegmentBp", { kind: "batch", remaining: 3 });
    expect(next.refineLines).toHaveLength(0);
    expect(next.fabricateLines).toHaveLength(1);
    expect(next.fabricateLines[0].id).toBe("craft-1");
    expect(next.fabricateLines[0].recipeKey).toBe("frameSegmentBp");
  });

  it("mints sequential ids across successive lines", () => {
    let s = linesState({ commonOre: 1000, titaniumIngot: 40, refineryLevel: 3 });
    s = startLine(s, "refine", "refineCommonOre", { kind: "continuous" }).next;
    s = startLine(s, "fabricate", "frameSegmentBp", { kind: "continuous" }).next;
    expect(s.refineLines[0].id).toBe("craft-1");
    expect(s.fabricateLines[0].id).toBe("craft-2");
    expect(s.nextCraftLineId).toBe(3);
  });

  it("is a same-reference no-op when every slot is occupied (array length >= slot count)", () => {
    // Refinery level 1 => 1 refine slot. One line already fills it; a second is rejected.
    const existing: CraftLine = { id: "craft-1", kind: "refine", recipeKey: "refineCommonOre", remaining: 1, mode: { kind: "continuous" } };
    const state = linesState({ commonOre: 1000, refineryLevel: 1, refineLines: [existing], nextCraftLineId: 2 });
    expect(refineSlotCount(state)).toBe(1);
    // C3: on a block startLine returns the SAME state ref, started:false, and a typed reason.
    const res = startLine(state, "refine", "refineCommonOre", { kind: "continuous" });
    expect(res.next).toBe(state); // same reference -- slot cap held
    expect(res.started).toBe(false);
    expect(res.reason).toBe("noSlot");
  });

  it("is a same-reference no-op for an unknown recipe key", () => {
    const state = linesState({ commonOre: 1000 });
    expect(startLine(state, "refine", "notARealRecipe", { kind: "continuous" }).next).toBe(state);
    expect(startLine(state, "fabricate", "notARealBlueprint", { kind: "continuous" }).next).toBe(state);
  });

  it("is a same-reference no-op for a batch count <= 0", () => {
    const state = linesState({ commonOre: 1000 });
    const res = startLine(state, "refine", "refineCommonOre", { kind: "batch", remaining: 0 });
    expect(res.next).toBe(state);
    expect(res.started).toBe(false);
    expect(res.reason).toBe("invalidCount");
  });
});

// --- cancelLine --------------------------------------------------------------
describe("cancelLine — removes the line, releasing its unstarted reservation", () => {
  it("removing a line drops allocated back to 0 / free back to full stock (derived, no ledger)", () => {
    // A batch line of 10 reserves 10 x 100 = 1000 commonOre.
    const line: CraftLine = { id: "craft-1", kind: "refine", recipeKey: "refineCommonOre", remaining: 10, mode: { kind: "batch", remaining: 10 } };
    const state = linesState({ commonOre: 1000, refineLines: [line], nextCraftLineId: 2 });

    expect(allocatedItem(state.refineLines, "commonOre").toNumber()).toBe(1000);
    expect(freeItem(state.inventory, state.refineLines, "commonOre").toNumber()).toBe(0);

    const cancelled = cancelLine(state, "craft-1");
    expect(cancelled.refineLines).toHaveLength(0);
    expect(allocatedItem(cancelled.refineLines, "commonOre").toNumber()).toBe(0);
    expect(freeItem(cancelled.inventory, cancelled.refineLines, "commonOre").toNumber()).toBe(1000);
  });

  it("removes a fabricate line by id, leaving refine lines untouched", () => {
    const rl: CraftLine = { id: "craft-1", kind: "refine", recipeKey: "refineCommonOre", remaining: 3, mode: { kind: "batch", remaining: 3 } };
    const fl: CraftLine = { id: "craft-2", kind: "fabricate", recipeKey: "frameSegmentBp", remaining: 2, mode: { kind: "batch", remaining: 2 } };
    const state = linesState({ commonOre: 1000, titaniumIngot: 40, refineLines: [rl], fabricateLines: [fl], nextCraftLineId: 3 });

    const cancelled = cancelLine(state, "craft-2");
    expect(cancelled.fabricateLines).toHaveLength(0);
    expect(cancelled.refineLines).toEqual([rl]); // the refine line survives
  });

  it("leaves an IN-FLIGHT job to complete normally (no refund of the started iteration)", () => {
    // Batch of 5, 1 slot, ample ore. Step ONE tick so the first job starts (in flight);
    // then cancel. The committed job must finish (1 output), and NO further job starts.
    let s = linesState({ commonOre: 2000, refineLines: [] });
    s = startLine(s, "refine", "refineCommonOre", { kind: "batch", remaining: 5 }).next;
    const lineId = s.refineLines[0].id;

    const afterOneTick = economyTick(s, 1);
    expect(afterOneTick.activeProcesses.filter((p) => p.kind === "refineJob")).toHaveLength(1);
    expect(afterOneTick.activeProcesses[0].lineId).toBe(lineId); // job tied to its line
    expect(afterOneTick.inventory.commonOre.toString()).toBe("1900"); // 2000 - 100 (one iteration started)

    const cancelled = cancelLine(afterOneTick, lineId);
    expect(cancelled.refineLines).toHaveLength(0); // line gone
    expect(cancelled.activeProcesses.filter((p) => p.kind === "refineJob")).toHaveLength(1); // job still committed

    const settled = stepTicks(cancelled, 30); // well past the committed job's completion
    expect(settled.inventory.refinedMaterial.toString()).toBe("1"); // exactly the committed job -- no 2nd
    expect(settled.inventory.commonOre.toString()).toBe("1900"); // no further ore consumed (reservation released)
    expect(settled.activeProcesses).toHaveLength(0);
    expect(settled.refineLines).toHaveLength(0);
  });

  it("is a same-reference no-op for an unknown line id", () => {
    const state = linesState({ commonOre: 1000 });
    expect(cancelLine(state, "craft-999")).toBe(state);
  });
});

// --- batch line lifecycle ----------------------------------------------------
describe("processRefineLines — a batch line produces exactly N, then the line clears", () => {
  it("a batch of 3 on a single-slot refinery completes 3 jobs across ticks, then removes the line", () => {
    const line: CraftLine = { id: "craft-1", kind: "refine", recipeKey: "refineCommonOre", remaining: 3, mode: { kind: "batch", remaining: 3 } };
    const state = linesState({ commonOre: 1000, refineLines: [line], nextCraftLineId: 2 });

    const done = stepTicks(state, 40); // past 3 sequential 10-tick jobs (job3 done@31)
    expect(done.inventory.refinedMaterial.toString()).toBe("3"); // exactly N
    expect(done.inventory.commonOre.toString()).toBe("700"); // 1000 - 3*100
    expect(done.activeProcesses).toHaveLength(0);
    expect(done.refineLines).toHaveLength(0); // line removed once remaining 0 + last job done
    expect(done.lifetimeStats.itemsRefined.refinedMaterial.toString()).toBe("3");
  });

  it("a batch never over-produces: exactly N even after many extra ticks", () => {
    const line: CraftLine = { id: "craft-1", kind: "refine", recipeKey: "refineCommonOre", remaining: 2, mode: { kind: "batch", remaining: 2 } };
    const state = linesState({ commonOre: 1000, refineLines: [line], nextCraftLineId: 2 });
    const done = stepTicks(state, 200);
    expect(done.inventory.refinedMaterial.toString()).toBe("2"); // never a 3rd
    expect(done.refineLines).toHaveLength(0);
    expect(done.activeProcesses).toHaveLength(0);
  });
});

// --- concurrent independent lines --------------------------------------------
describe("two concurrent lines (different recipes) progress independently", () => {
  it("a continuous refine line and a continuous fabricate line each run their own slot in parallel", () => {
    const rl: CraftLine = { id: "craft-1", kind: "refine", recipeKey: "refineCommonOre", remaining: 1, mode: { kind: "continuous" } };
    const fl: CraftLine = { id: "craft-2", kind: "fabricate", recipeKey: "frameSegmentBp", remaining: 1, mode: { kind: "continuous" } };
    const state = linesState({ commonOre: 100000, titaniumIngot: 100000, refineLines: [rl], fabricateLines: [fl], nextCraftLineId: 3 });

    const run = stepTicks(state, 130);

    // BOTH lines produced (independent progress): refine (10-tick) completes many times,
    // fabricate (120-tick) completes once by tick 130.
    expect(run.inventory.refinedMaterial.gt(0)).toBe(true);
    expect(run.inventory.frameSegment.toString()).toBe("1");

    // BOTH lines still present (continuous never clears) and EACH owns exactly one
    // in-flight job tied to it by lineId -- one slot per line, no cross-blocking.
    expect(run.refineLines).toHaveLength(1);
    expect(run.fabricateLines).toHaveLength(1);
    const refineJobs = run.activeProcesses.filter((p) => p.lineId === "craft-1");
    const fabJobs = run.activeProcesses.filter((p) => p.lineId === "craft-2");
    expect(refineJobs).toHaveLength(1);
    expect(refineJobs[0].kind).toBe("refineJob");
    expect(fabJobs).toHaveLength(1);
    expect(fabJobs[0].kind).toBe("fabricateJob");
  });
});

// --- processFabricateLines no-op guard ---------------------------------------
describe("line processors are same-reference no-ops with no lines", () => {
  it("processRefineLines / processFabricateLines return the same state when their array is empty", () => {
    const state = linesState({ commonOre: 1000, titaniumIngot: 40 });
    expect(processRefineLines(state)).toBe(state);
    expect(processFabricateLines(state)).toBe(state);
  });
});

// --- ⚠️ MULTI-LINE offline == live parity (the high-risk seam) ----------------
describe("⚠️ multi-line offline == live parity (controller re-verifies)", () => {
  it("tick(bigSpan) equals looping economyTick(_,1) across TWO different-recipe lines — NON-VACUOUS", () => {
    // Line A (REFINE, batch 2): commonOre 200 = exactly 2 jobs. It FINISHES mid-span
    // (both jobs done @11/@21, then the line is removed) -- proves a line completing
    // mid-span parity-matches.
    // Line B (FABRICATE, continuous): titaniumIngot 12 = exactly 3 crafts. craft1 done
    // @121, craft2 done @241, craft3 STILL IN FLIGHT at 250 -- proves an in-flight job +
    // a mid-span completion parity-match. Two DIFFERENT recipes on two facilities,
    // exercising BOTH processRefineLines and processFabricateLines.
    const refineLine: CraftLine = { id: "craft-1", kind: "refine", recipeKey: "refineCommonOre", remaining: 2, mode: { kind: "batch", remaining: 2 } };
    const fabLine: CraftLine = { id: "craft-2", kind: "fabricate", recipeKey: "frameSegmentBp", remaining: 1, mode: { kind: "continuous" } };
    const base = linesState({
      commonOre: 200,
      titaniumIngot: 12,
      refineLines: [refineLine],
      fabricateLines: [fabLine],
      nextCraftLineId: 3,
    });
    const SPAN = 250;

    // Path A: one offline catch-up call (tick() internally steps economyTick(_,1) per
    // whole tick). Path B: hand-stepped economyTick, one tick at a time.
    const jumped = tick(SPAN, base);
    const stepped = stepTicks(base, SPAN);

    expect(lineSnapshot(jumped)).toEqual(lineSnapshot(stepped));

    // NON-VACUITY: assert real, DIFFERENTIATED work happened on each line across the span.
    // Refine line (finished mid-span):
    expect(jumped.inventory.refinedMaterial.toString()).toBe("2"); // 2 refine jobs produced
    expect(jumped.inventory.commonOre.toString()).toBe("0"); // 200 consumed (2 x 100)
    expect(jumped.refineLines).toHaveLength(0); // batch line CLEARED mid-span
    // Fabricate line (mid-span completion + one in flight):
    expect(jumped.inventory.frameSegment.toString()).toBe("2"); // 2 crafts completed
    expect(jumped.lifetimeStats.itemsCrafted.frameSegment.toString()).toBe("2"); // 2 processes resolved
    expect(jumped.inventory.titaniumIngot.toString()).toBe("0"); // 12 consumed (3 crafts' inputs)
    expect(jumped.fabricateLines).toHaveLength(1); // continuous line still running
    const inFlight = jumped.activeProcesses.filter((p) => p.kind === "fabricateJob");
    expect(inFlight).toHaveLength(1); // craft3 in flight
    expect(inFlight[0].lineId).toBe("craft-2"); // tied to its line
    expect(jumped.activeProcesses).toHaveLength(1); // ONLY the in-flight fab craft remains
  });
});

// --- maxAffordableIterations — the affordable-NOW quantity cap (Task C3) ------
// The largest whole iteration count reservable from FREE stock right now =
//   min over inputs of floor(free[item] / perIteration[item]).
// The KEY allocation property: it reads FREE (inventory - already-reserved), NOT raw stock,
// so a second line cannot double-book units an existing line already reserved.
describe("maxAffordableIterations — affordable-now cap reads FREE, not raw stock", () => {
  it("with NO lines, the cap is floor(rawStock / perIteration)", () => {
    // refineCommonOre = commonOre x100 -> 1. 1000 / 100 = 10.
    const state = linesState({ commonOre: 1000 });
    expect(maxAffordableIterations(state, "refine", "refineCommonOre")).toBe(10);
  });

  it("an existing line's reservation LOWERS the cap for a second line on the same input (FREE not raw)", () => {
    // A batch line reserving 6 iterations locks 6 x 100 = 600 commonOre. Raw stock is still
    // 1000, but FREE is 1000 - 600 = 400, so the affordable-now cap is floor(400/100) = 4,
    // NOT the raw-stock 10. THIS is the double-spend guard the whole redesign exists for.
    const existing: CraftLine = {
      id: "craft-1", kind: "refine", recipeKey: "refineCommonOre",
      remaining: 6, mode: { kind: "batch", remaining: 6 },
    };
    const state = linesState({ commonOre: 1000, refineLines: [existing], nextCraftLineId: 2 });
    // Same raw stock, but the reservation cut the reservable pool from 10 down to 4.
    expect(maxAffordableIterations(state, "refine", "refineCommonOre")).toBe(4);
  });

  it("a multi-input recipe is bounded by its SCARCEST input", () => {
    // structuralAssemblyBp inputs: frameSegment x2, powerCoupling x1, titaniumIngot x2.
    // frameSegment 10 -> floor(10/2)=5 ; powerCoupling 3 -> floor(3/1)=3 ; titaniumIngot 20 ->
    // floor(20/2)=10. min = 3 (powerCoupling is the wall).
    const base = linesState({ titaniumIngot: 20 });
    const state: GameState = {
      ...base,
      inventory: {
        ...base.inventory,
        frameSegment: new Decimal(10),
        powerCoupling: new Decimal(3),
      },
    };
    expect(maxAffordableIterations(state, "fabricate", "structuralAssemblyBp")).toBe(3);
  });

  it("returns 0 when an input's free is below one iteration", () => {
    // 50 commonOre < 100 needed for one iteration -> floor(50/100) = 0.
    const state = linesState({ commonOre: 50 });
    expect(maxAffordableIterations(state, "refine", "refineCommonOre")).toBe(0);
  });

  it("returns 0 for an unknown recipe (no inputs to reserve against)", () => {
    const state = linesState({ commonOre: 1000 });
    expect(maxAffordableIterations(state, "refine", "notARealRecipe")).toBe(0);
    expect(maxAffordableIterations(state, "fabricate", "notARealBlueprint")).toBe(0);
  });
});

// --- canStartLine — the typed-reason line-start gate (Task C3) ----------------
// Mirrors canFabricate: a pure predicate returning { ok:true } or { ok:false, reason }.
// Gate order: notFound -> notResearched(fabricate) -> tierLocked(fabricate) -> noSlot ->
// invalidCount -> materials -> storageFull.
describe("canStartLine — typed-reason gate (each reason + ok)", () => {
  it("notFound: the key names no recipe/blueprint in the kind's registry", () => {
    const state = linesState({ commonOre: 1000 });
    expect(canStartLine(state, "refine", "notARealRecipe", 1)).toEqual({ ok: false, reason: "notFound" });
    expect(canStartLine(state, "fabricate", "notARealBlueprint", 1)).toEqual({ ok: false, reason: "notFound" });
  });

  it("notResearched (fabricate only): a real blueprint that is not unlocked", () => {
    // powerCouplingBp exists but linesState researches ONLY frameSegmentBp.
    const state = linesState({ titaniumIngot: 40 });
    expect(canStartLine(state, "fabricate", "powerCouplingBp", 1)).toEqual({ ok: false, reason: "notResearched" });
  });

  it("tierLocked (fabricate only): a researched blueprint whose tier exceeds the fabricator level", () => {
    // structuralAssemblyBp is tier 2; fabricator level 1. Researched so the notResearched
    // gate passes and tierLocked is the surfaced reason.
    const base = linesState({ titaniumIngot: 40, fabricatorLevel: 1 });
    const state: GameState = { ...base, researchedBlueprints: ["structuralAssemblyBp"] };
    expect(canStartLine(state, "fabricate", "structuralAssemblyBp", 1)).toEqual({ ok: false, reason: "tierLocked" });
  });

  it("a REFINE line SKIPS the research + tier reasons (they are a fabricate-only subset)", () => {
    // refineCommonOre carries no research/tier gate; with a free slot + affordable stock it
    // is OK even though no blueprint is researched for it.
    const state = linesState({ commonOre: 1000 });
    expect(canStartLine(state, "refine", "refineCommonOre", 1)).toEqual({ ok: true });
  });

  it("noSlot: the kind's lines array already fills its slot count", () => {
    const existing: CraftLine = {
      id: "craft-1", kind: "refine", recipeKey: "refineCommonOre",
      remaining: 1, mode: { kind: "continuous" },
    };
    const state = linesState({ commonOre: 1000, refineryLevel: 1, refineLines: [existing], nextCraftLineId: 2 });
    expect(refineSlotCount(state)).toBe(1);
    expect(canStartLine(state, "refine", "refineCommonOre", 1)).toEqual({ ok: false, reason: "noSlot" });
  });

  it("invalidCount: count <= 0 or a non-integer", () => {
    const state = linesState({ commonOre: 1000 });
    expect(canStartLine(state, "refine", "refineCommonOre", 0)).toEqual({ ok: false, reason: "invalidCount" });
    expect(canStartLine(state, "refine", "refineCommonOre", -3)).toEqual({ ok: false, reason: "invalidCount" });
    expect(canStartLine(state, "refine", "refineCommonOre", 1.5)).toEqual({ ok: false, reason: "invalidCount" });
  });

  it("materials: count exceeds maxAffordableIterations (can't reserve that many from free)", () => {
    // 250 commonOre -> cap 2. Asking for 3 is unaffordable now; 2 is OK.
    const state = linesState({ commonOre: 250 });
    expect(maxAffordableIterations(state, "refine", "refineCommonOre")).toBe(2);
    expect(canStartLine(state, "refine", "refineCommonOre", 3)).toEqual({ ok: false, reason: "materials" });
    expect(canStartLine(state, "refine", "refineCommonOre", 2)).toEqual({ ok: true });
  });

  it("storageFull: the OUTPUT item is at its warehouse cap (checked after materials)", () => {
    // Inputs are affordable (commonOre 1000, count 1), but refinedMaterial (the output) is
    // pinned way above its cap, so materialAtCap fires -> storageFull.
    const state = linesState({ commonOre: 1000, refinedMaterial: 1e9 });
    expect(canStartLine(state, "refine", "refineCommonOre", 1)).toEqual({ ok: false, reason: "storageFull" });
  });

  it("ok: all gates pass (researched, tier-available, free slot, valid count, affordable, output room)", () => {
    const state = linesState({ titaniumIngot: 40 }); // frameSegmentBp researched, tier 1, level 1
    expect(canStartLine(state, "fabricate", "frameSegmentBp", 3)).toEqual({ ok: true });
  });
});

// --- startLine delegation to canStartLine (Task C3) ---------------------------
describe("startLine delegates to canStartLine — appends on ok, same-ref + reason on block", () => {
  it("appends the line and reports started:true on ok", () => {
    const state = linesState({ commonOre: 1000 });
    const res = startLine(state, "refine", "refineCommonOre", { kind: "batch", remaining: 5 });
    expect(res.started).toBe(true);
    expect(res.reason).toBeUndefined();
    expect(res.next.refineLines).toHaveLength(1);
    expect(res.next.refineLines[0].remaining).toBe(5);
    expect(state.refineLines).toHaveLength(0); // input untouched
  });

  it("blocks with started:false + the SAME state ref + the materials reason when unaffordable", () => {
    // 150 commonOre -> cap 1. A batch of 5 is unaffordable now.
    const state = linesState({ commonOre: 150 });
    const res = startLine(state, "refine", "refineCommonOre", { kind: "batch", remaining: 5 });
    expect(res.started).toBe(false);
    expect(res.reason).toBe("materials");
    expect(res.next).toBe(state); // same reference -- true no-op
  });

  it("blocks a fabricate line with notResearched (delegated fabricate-only reason)", () => {
    const state = linesState({ titaniumIngot: 40 });
    const res = startLine(state, "fabricate", "powerCouplingBp", { kind: "continuous" });
    expect(res.started).toBe(false);
    expect(res.reason).toBe("notResearched");
    expect(res.next).toBe(state);
  });
});
