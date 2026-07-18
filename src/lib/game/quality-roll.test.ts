// ============================================================================
// Quality rolls at production tests (Equipment 0.11.0, Phase 4, Task 9b)
// (docs/plans/2026-07-17-equipment-0.11.0-plan.md, Task 9b).
//
// Covers the quality ROLL added at every production deposit:
//   - rollQuality(rng): the pure compounding roll (model.ts). Determinism at a seed,
//     the 0..QUALITY_TIERS-1 bound (never exceeds the top bucket), the compounding
//     shape (all-success -> max tier, immediate-fail -> tier 0, k successes -> tier k),
//     the bounded draw count, and a statistical check that the first step's odds are
//     honored (not 0, not 1).
//   - Production deposits land in the ROLLED bucket, not always bucket 0: a completing
//     refineJob deposits its whole output into the tier rollQuality returned.
//   - ⚠️ CRITICAL offline==live PARITY at the BUCKET level: a big offline catch-up
//     (tick(span), which internally steps economyTick(_,1) per whole tick) distributes
//     produced material across quality buckets IDENTICALLY to many small live steps
//     (hand-stepped economyTick(_,1)), off the SAME seeded stream. Modeled on the
//     multi-line parity test in craft-lines.test.ts and the fuel/XP offline-parity tests.
//
// WHY THE PARITY IS STRUCTURAL (see the report): the shipped economy ALWAYS advances one
// whole tick at a time on BOTH paths (tick() offline + App.svelte live both loop
// economyTick(_,1)), so there is no closed-form N-iteration bulk resolve to diverge from;
// the sequence of production deposits, and thus of quality rolls off the shared rng, is
// identical regardless of how the elapsed span was chunked. These tests pin that.
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { economyTick, tick, resolveProcesses } from "./tick";
import { getBucket, itemTotal, QUALITY_TIERS } from "./inventory";
import {
  rollQuality,
  QUALITY_STEP_CHANCE,
  freshState,
  type GameState,
  type TimedProcess,
  type ProcessEffect,
} from "./model";
import type { CraftLine } from "./allocation";

// --- test rng helpers -------------------------------------------------------

// mulberry32: a tiny, well-distributed seeded PRNG (the SAME one itemgen.test.ts uses).
// A fresh instance per seed replays an identical stream, which is what lets both parity
// paths draw the exact same sequence.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A scripted rng that returns `values` in order, then THROWS on overrun. The throw is a
// deliberate tripwire: the parity paths must consume EXACTLY the scripted draws in the
// same order, so an unexpected extra draw (a draw-count divergence) fails loudly here
// rather than silently returning undefined (which would read as tier 0 and mask the bug).
function makeScriptedRng(values: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= values.length) {
      throw new Error(`scripted rng overrun: asked for draw ${i + 1} of only ${values.length}`);
    }
    return values[i++];
  };
}

// A counting rng wrapper: forwards to `inner` and records how many draws were taken, so a
// test can assert rollQuality's bounded draw count directly.
function countingRng(inner: () => number): { rng: () => number; count: () => number } {
  let n = 0;
  return {
    rng: () => {
      n += 1;
      return inner();
    },
    count: () => n,
  };
}

// The item's raw bucket array as strings, the shape the parity assertion deep-equals. Reads
// the persisted array (lazily grown, so its length is the highest tier ever written + 1).
function bucketStrings(state: GameState, item: string): string[] {
  const buckets = state.inventory[item] ?? [];
  return buckets.map((d) => d.toString());
}

// A crafting-only state: an IDLE captain (freshState seeds mission: null) so NO mission
// loot / passiveTrickle rng runs, and a single batch REFINE line. The ONLY rng draws in
// economyTick are therefore the quality rolls at refine-job completions, which makes the
// scripted-draw parity test exact and hand-traceable. Mirrors craft-lines.test.ts.
//   refineCommonOre = commonOre x100 -> refinedMaterial x1 over 10 ticks, refinery level 1
//   (1 slot). commonOre = 100 * iterations funds exactly `iterations` jobs and no more.
function refineOnlyState(iterations: number): GameState {
  const s = freshState();
  const inventory: Record<string, Decimal[]> = { ...s.inventory };
  inventory.commonOre = [new Decimal(100 * iterations)];
  const line: CraftLine = {
    id: "craft-1",
    kind: "refine",
    recipeKey: "refineCommonOre",
    remaining: iterations,
    mode: { kind: "batch", remaining: iterations },
  };
  return {
    ...s,
    inventory,
    facilities: { ...s.facilities, refinery: { level: 1 } },
    refineLines: [line],
    nextCraftLineId: 2,
  };
}

// ---------------------------------------------------------------------------
// rollQuality: the pure compounding roll
// ---------------------------------------------------------------------------
describe("rollQuality, the pure compounding quality roll", () => {
  it("all-success rng (0) climbs to the MAX tier (QUALITY_TIERS-1) and never beyond", () => {
    // rng()=0 passes every `< chance` gate, so every step succeeds -> the ceiling.
    expect(rollQuality(() => 0)).toBe(QUALITY_TIERS - 1);
    expect(rollQuality(() => 0)).toBe(5); // concrete ceiling for the current 6-tier range
  });

  it("all-fail rng (1) never climbs: tier 0", () => {
    // rng()=1 fails every `< chance` gate (chance < 1), so the first step already stops.
    expect(rollQuality(() => 1)).toBe(0);
  });

  it("boundary: rng exactly AT the step chance does NOT advance (strict `<`)", () => {
    // Returning exactly QUALITY_STEP_CHANCE[0] must FAIL the `< chance` gate -> tier 0,
    // matching every other rng gate in the engine (rollExtractionTick uses strict `<`).
    expect(rollQuality(() => QUALITY_STEP_CHANCE[0])).toBe(0);
  });

  it("k consecutive successes then a failure yields exactly tier k (compounding)", () => {
    // Two successes (0.0005 < 0.001) then a failure (0.9) -> stops at tier 2.
    expect(rollQuality(makeScriptedRng([0.0005, 0.0005, 0.9]))).toBe(2);
    // Three successes then a failure -> tier 3.
    expect(rollQuality(makeScriptedRng([0.0005, 0.0005, 0.0005, 0.9]))).toBe(3);
  });

  it("draw count is BOUNDED: <= QUALITY_STEP_CHANCE.length draws even on all-success", () => {
    // All-success must stop DRAWING once the ceiling is reached (no infinite / over-length
    // draw), so it consumes exactly QUALITY_STEP_CHANCE.length draws, not one more.
    const c = countingRng(() => 0); // always success
    const tier = rollQuality(c.rng);
    expect(tier).toBe(QUALITY_TIERS - 1);
    expect(c.count()).toBe(QUALITY_STEP_CHANCE.length); // == 5, never a 6th draw at the cap
  });

  it("immediate failure consumes exactly ONE draw", () => {
    const c = countingRng(() => 1); // fails the first gate
    expect(rollQuality(c.rng)).toBe(0);
    expect(c.count()).toBe(1);
  });

  it("deterministic at a seed: the same stream yields the same tier sequence", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 200 }, () => rollQuality(a));
    const seqB = Array.from({ length: 200 }, () => rollQuality(b));
    expect(seqA).toEqual(seqB);
  });

  it("statistical: tiers stay in [0, QUALITY_TIERS-1] and the first-step odds are honored", () => {
    // A large seeded sample: assert the roll NEVER exceeds the ceiling, tier 0 dominates,
    // and the observed tier>=1 rate brackets the tunable first-step chance (proving it is
    // neither 0 nor 1). Loose band so the test is not flaky at ~0.1% odds.
    const rng = mulberry32(2024);
    const N = 200_000;
    let atLeast1 = 0;
    let atLeast2 = 0;
    let maxTier = 0;
    for (let i = 0; i < N; i++) {
      const t = rollQuality(rng);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(QUALITY_TIERS - 1); // never above the top bucket
      if (t > maxTier) maxTier = t;
      if (t >= 1) atLeast1 += 1;
      if (t >= 2) atLeast2 += 1;
    }
    const rate1 = atLeast1 / N;
    // Expected ~0.001; band [0.0004, 0.002] is generous vs the ~14-count std at this N.
    expect(rate1).toBeGreaterThan(0.0004);
    expect(rate1).toBeLessThan(0.002);
    // Each higher tier is ~1000x rarer, so tier>=2 must be far below tier>=1 (compounding).
    expect(atLeast2).toBeLessThan(atLeast1);
    expect(maxTier).toBeLessThanOrEqual(QUALITY_TIERS - 1);
  });
});

// ---------------------------------------------------------------------------
// Production deposits land in the ROLLED bucket (not always bucket 0)
// ---------------------------------------------------------------------------
describe("production deposit lands in the rolled quality bucket (resolveProcesses)", () => {
  // Build a completing refineJob and resolve it with a CONSTANT rng so the rolled tier is
  // known: rng=0 -> tier 5, rng=0.9 -> tier 0. Asserts the WHOLE output lands in that one
  // bucket and the others stay empty.
  const addItem = (itemId: string, amount: number): ProcessEffect => ({
    type: "addItem",
    itemId,
    amount: new Decimal(amount),
  });
  function withRefineJob(amount: number): GameState {
    const base = freshState();
    const process: TimedProcess = {
      id: "proc-1",
      kind: "refineJob",
      remainingTicks: 10,
      durationTicks: 10,
      effect: addItem("refinedMaterial", amount),
    };
    return { ...base, activeProcesses: [process], nextProcessId: 2 };
  }

  it("rng=0 rolls the max tier: the full output lands in bucket 5, bucket 0 stays empty", () => {
    const { next } = resolveProcesses(withRefineJob(3), 10, () => 0);
    expect(getBucket(next.inventory, "refinedMaterial", 5).toString()).toBe("3"); // rolled tier
    expect(getBucket(next.inventory, "refinedMaterial", 0).toString()).toBe("0"); // NOT bucket 0
    expect(itemTotal(next.inventory, "refinedMaterial").toString()).toBe("3"); // total preserved
  });

  it("rng=0.9 rolls tier 0: the output lands in bucket 0 (byte-identical to pre-9b)", () => {
    const { next } = resolveProcesses(withRefineJob(3), 10, () => 0.9);
    expect(getBucket(next.inventory, "refinedMaterial", 0).toString()).toBe("3");
    expect(getBucket(next.inventory, "refinedMaterial", 5).toString()).toBe("0");
    expect(itemTotal(next.inventory, "refinedMaterial").toString()).toBe("3");
  });
});

// ---------------------------------------------------------------------------
// ⚠️ CRITICAL offline == live PARITY at the BUCKET level
// ---------------------------------------------------------------------------
describe("⚠️ offline==live quality-bucket parity (tick(span) == looping economyTick(_,1))", () => {
  it("a 4-iteration offline batch distributes output across buckets IDENTICALLY to 4 live steps, NON-VACUOUS", () => {
    // A SCRIPTED rng engineered so the 4 refine completions roll tiers [0, 1, 3, 5], in
    // that order (completions happen one-at-a-time at ticks 11/21/31/41, so completion
    // order == draw order on BOTH paths). Draw pattern per completion (compounding, strict
    // `<` on 0.001 odds): fail=0.9 (1 draw), 1-success=0.0005 then fail (2), 3-success then
    // fail (4), 5-success (5, hits the cap). 1+2+4+5 = 12 scripted draws total.
    const VALUES = [
      0.9, //                                       completion 1 -> tier 0 (immediate fail)
      0.0005, 0.9, //                               completion 2 -> tier 1
      0.0005, 0.0005, 0.0005, 0.9, //               completion 3 -> tier 3
      0.0005, 0.0005, 0.0005, 0.0005, 0.0005, //    completion 4 -> tier 5 (all steps hit)
    ];
    const SPAN = 50; // > tick 41, so all 4 jobs complete; commonOre=400 caps it at 4 anyway

    // Path A: ONE offline catch-up call. tick() internally steps economyTick(_,1) per whole
    // tick. Path B: hand-stepped economyTick, one tick at a time (the live poll shape). Each
    // path gets its OWN fresh scripted rng over the SAME values, so both replay the same 12
    // draws in the same order.
    const jumped = tick(SPAN, refineOnlyState(4), makeScriptedRng([...VALUES]));
    let stepped = refineOnlyState(4);
    const liveRng = makeScriptedRng([...VALUES]);
    for (let i = 0; i < SPAN; i++) stepped = economyTick(stepped, 1, liveRng);

    // THE PARITY ASSERTION: the per-BUCKET split is identical across the two chunkings, not
    // merely the total. This is the whole point of Task 9b's parity requirement.
    expect(bucketStrings(jumped, "refinedMaterial")).toEqual(bucketStrings(stepped, "refinedMaterial"));

    // NON-VACUITY + CORRECTNESS: the 4 outputs landed in the ROLLED tiers [0,1,3,5], one
    // unit each. Tier 5 populated forces the array to full length 6 (zero-filled gaps).
    expect(bucketStrings(jumped, "refinedMaterial")).toEqual(["1", "1", "0", "1", "0", "1"]);

    // Totals still exact and quality-agnostic: sum of buckets == units produced == 4.
    expect(itemTotal(jumped.inventory, "refinedMaterial").toString()).toBe("4");
    expect(itemTotal(stepped.inventory, "refinedMaterial").toString()).toBe("4");
    expect(itemTotal(jumped.inventory, "commonOre").toString()).toBe("0"); // 400 consumed (4 x 100)
  });

  it("parity holds under a SEEDED (non-constant) rng too: buckets deep-equal, totals exact", () => {
    // A second parity pass driven by mulberry32 (a realistic non-constant stream) rather than
    // a hand-scripted one, so the parity is not an artifact of the scripted draw pattern. At
    // ~0.1% odds these 4 completions will almost certainly all be tier 0, so this pass proves
    // parity (deep-equal) + totals, not a multi-bucket spread (the scripted test above owns
    // the multi-bucket non-vacuity).
    const SPAN = 50;
    const jumped = tick(SPAN, refineOnlyState(4), mulberry32(777));
    let stepped = refineOnlyState(4);
    const liveRng = mulberry32(777);
    for (let i = 0; i < SPAN; i++) stepped = economyTick(stepped, 1, liveRng);

    expect(bucketStrings(jumped, "refinedMaterial")).toEqual(bucketStrings(stepped, "refinedMaterial"));
    expect(itemTotal(jumped.inventory, "refinedMaterial").toString()).toBe("4");
    expect(itemTotal(stepped.inventory, "refinedMaterial").toString()).toBe("4");
  });
});
