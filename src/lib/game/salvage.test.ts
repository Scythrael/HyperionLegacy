/// <reference types="vite/client" />
// ============================================================================
// Equipment recycle-salvage, 0.11.0 Storage/Salvage Task C1.
// (docs/plans/2026-07-18-storage-salvage-0.11.0-design.md §2;
//  docs/plans/2026-07-18-0.11.0-completion-plan.md Task C1.)
//
// salvageEquipment is a LIVE-ONLY, player-initiated INSTANT action: it consumes a
// SPARE CRAFTED ship system and returns a fraction of its blueprint's crafting
// inputs to inventory at quality tier 0 (crude recovery), freeing a storage slot.
//
// PARITY BOUNDARY (the whole reason this needs no offline-parity test): the action
// uses Math.random and NEVER runs inside economyTick / offline tick() /
// resolveProcesses. This suite proves the reward math, the reject cases, the
// quality-scaled yield, the softlock relief at cap, and (by source grep) that the
// function is not wired into any economy-tick path.
// ============================================================================
import { describe, it, expect } from "vitest";
// tick.ts loaded as a RAW STRING (Vite's ?raw) for the live-only source grep below.
// ?raw keeps this a pure Vite/Vitest concern with no Node type dependency (the app
// tsconfig deliberately excludes @types/node), so `npm run check` stays clean.
import tickSource from "./tick.ts?raw";
// Crafting 0.13.3 (Unit 2.3): salvage.ts's own source, for the no-import-cycle half of
// the rewritten guard below (tick.ts may depend on salvage.ts; the reverse must not hold).
import salvageSource from "./salvage.ts?raw";
// Crafting 0.13.3 (Unit 2.3): the economy seam salvage now runs inside. resolveProcesses
// resolves a completed salvageJob; economyTick + tick are the two chunkings the
// offline==live parity suite at the bottom of this file compares.
// Crafting 0.13.3 (Phase 5 Unit 5.1): the auto-salvage TICK pass, plus the queue plumbing
// its budget is built on (queueDepth, enqueueOrder) and promoteQueuedOrders for the "an
// auto-added order promotes the SAME tick" case.
import {
  resolveProcesses,
  economyTick,
  tick,
  autoSalvageOrders,
  promoteQueuedOrders,
  enqueueOrder,
  queueDepth,
  AUTO_SALVAGE_MANUAL_HEADROOM,
  // 0.13.3 batch-salvage follow-up: the enqueue gate the batch bound lives behind, and the
  // remover the "cancelling a batch releases all of it" cases exercise.
  canEnqueueOrder,
  removeQueuedOrder,
} from "./tick";
import {
  salvageEquipment,
  salvageSalvagedMaterial,
  salvageShip,
  salvageTalentBonus,
  // Crafting 0.13.3 (Phase 5 Unit 5.1): the PURE auto-salvage rule evaluator.
  selectAutoSalvageTargets,
  SALVAGE_FRACTION_MIN,
  SALVAGE_FRACTION_MAX,
  SALVAGE_QUALITY_BONUS_PER_TIER,
  SALVAGE_CEILING_THRESHOLDS,
  // Crafting 0.13.3 (Phase 2 Unit 2.1): the DERIVED reservation helpers. Imported from
  // "./salvage" ON PURPOSE even though reservation.ts implements them, because that is
  // the surface the build plan promised callers; importing them here also keeps the
  // re-export line in salvage.ts covered.
  salvageReservations,
  salvageReservedInstanceIds,
  salvageReservedShipIds,
  salvageReservedMaterialCount,
  isDuplicateSalvageTarget,
  // 0.13.3 batch-salvage follow-up: the ONE interpretation of a queued salvage order's unit
  // count, and the enqueue-time bound on it. Imported from "./salvage" for the same reason
  // the five above are: that is the surface callers were promised, and it keeps the
  // re-export line covered.
  salvageOrderUnits,
  exceedsFreeSalvageUnits,
  type QueuedSalvageOrder,
} from "./salvage";
import {
  freshState,
  generateStandardIssue,
  spareEquipmentCount,
  equipmentAtCap,
  equipmentStorageCap,
  BLUEPRINTS,
  ITEMS,
  SHIP_TYPES,
  SALVAGE_LOOT_POOLS,
  HOMEWORLD_TALENTS,
  SALVAGE_TALENT_YIELD_BONUS,
  SALVAGE_TALENT_CEILING_BONUS,
  type GameState,
  type EquipmentInstance,
  type EquipmentSlotType,
  type CaptainMissionState,
  type QueuedJob,
  type QueuedOrder,
  type SalvageTargetRef,
  // Crafting 0.13.3 (Phase 5 Unit 5.1): the auto-salvage depth fixtures learn real
  // queue-depth talent nodes, so the key union is needed to type them.
  type HomeworldTalentKey,
  // Crafting 0.13.3 (Phase 2 Unit 2.2): the in-flight process shape + the pure duration
  // math the Salvage Bay will size its jobs with.
  type TimedProcess,
  salvageDurationTicks,
  SALVAGE_BASE_TICKS,
  SALVAGE_TICKS_PER_ILEVEL,
  SALVAGE_TICKS_PER_QUALITY,
  SALVAGE_MATERIAL_TICKS,
  SALVAGE_SHIP_BUILD_DIVISOR,
  // Crafting 0.13.3 (salvage-duration SEAM): the material arm's own factors, all
  // NEUTRAL today, plus the shared ceiling every arm now clamps to.
  SALVAGE_MATERIAL_TICKS_PER_QUALITY,
  SALVAGE_MATERIAL_RARITY_MULTIPLIER,
  SALVAGE_MATERIAL_TIER_MULTIPLIER_PER_TIER,
  SALVAGE_MAX_TICKS,
  type ItemRarity,
  // Crafting 0.13.3 (salvage-duration SEAM, equipment arm): the equipment arm's own
  // categorical factors, also all NEUTRAL today. Its rarity table is over
  // EquipmentRarity, a DIFFERENT union from the material arm's ItemRarity (zero shared
  // members), which is exactly why there are two tables and two imported types here.
  SALVAGE_EQUIPMENT_RARITY_MULTIPLIER,
  SALVAGE_EQUIPMENT_TIER_MULTIPLIER_PER_TIER,
  type EquipmentRarity,
} from "./model";
import Decimal from "break_infinity.js";
import { getBucket, itemTotal } from "./inventory";

// The equipment blueprint the salvage fixtures recycle. Its recipe inputs
// ({ frameSegment: 2, titaniumIngot: 3 }) are the exact amounts the reward math is
// asserted against, so the test reads them straight off BLUEPRINTS (no hard-coded
// duplicate that could drift from the data).
const SALVAGE_BP = "prospectorHoldBp";
const SALVAGE_BP_INPUTS = BLUEPRINTS[SALVAGE_BP].recipe.inputs;

// Build ONE EquipmentInstance with a chosen fitment / crafted-nature / quality, by
// starting from a real Standard-Issue baseline (so every other field is valid) and
// overriding ONLY the fields salvage reads: fittedToShipId (null = spare), blueprintKey
// (non-null = crafted; null = Standard-Issue baseline), and quality (drives the bonus).
function makePiece(opts: {
  slotType: EquipmentSlotType;
  fitted: boolean;
  crafted: boolean;
  quality: number;
  id: string;
}): EquipmentInstance {
  const base = generateStandardIssue({
    slotType: opts.slotType,
    fittedToShipId: opts.fitted ? "ship-1" : null,
    allocateId: () => opts.id,
  });
  return {
    ...base,
    fittedToShipId: opts.fitted ? "ship-1" : null,
    blueprintKey: opts.crafted ? SALVAGE_BP : null,
    quality: opts.quality,
  };
}

// A fresh state whose equipment pool is exactly the supplied pieces (freshState seeds
// ship-1's four FITTED baselines, which are 0 spare-crafted, so a supplied pool is
// the whole spare picture). Inventory starts empty of the recipe inputs so a deposit
// is observable against a known zero baseline.
function stateWith(pieces: EquipmentInstance[]): GameState {
  return { ...freshState(), equipment: pieces };
}

// The exact fraction the implementation computes, recomputed here from the exported
// consts so the test pins the FORMULA, not a magic number. rng() is stubbed to a
// fixed value in every case so the band roll is deterministic.
function expectedFraction(rngValue: number, quality: number): number {
  const band = SALVAGE_FRACTION_MIN + rngValue * (SALVAGE_FRACTION_MAX - SALVAGE_FRACTION_MIN);
  return band + quality * SALVAGE_QUALITY_BONUS_PER_TIER;
}

describe("salvageEquipment: recovers floored inputs at quality 0 and consumes the piece (Task C1)", () => {
  it("deposits floor(qty * fraction) of each recipe input into the quality-0 bucket and removes the piece", () => {
    const quality = 3;
    const rngValue = 0.5; // pins the band mid-range; fraction = 0.30 + 0.05 + 0.06 = 0.41
    const piece = makePiece({ slotType: "cargoBay", fitted: false, crafted: true, quality, id: "sp-1" });
    const state = stateWith([piece]);

    const result = salvageEquipment(state, "sp-1", () => rngValue);
    expect("recovered" in result).toBe(true);
    if (!("recovered" in result)) return; // narrow for the type checker

    const fraction = expectedFraction(rngValue, quality);
    // Every recipe input is reported with its floored recovered amount (including 0),
    // and every positive amount lands in the QUALITY-0 bucket specifically.
    for (const [itemId, qty] of Object.entries(SALVAGE_BP_INPUTS)) {
      const expected = Math.floor(qty * fraction);
      expect(result.recovered[itemId]).toBe(expected);
      expect(getBucket(result.next.inventory, itemId, 0).toNumber()).toBe(expected);
    }
    // At least one input recovered a non-zero amount, so the deposit is real.
    expect(Object.values(result.recovered).some((n) => n > 0)).toBe(true);

    // The piece is consumed (gone from the pool), and the input state is untouched.
    expect(result.next.equipment.find((e) => e.id === "sp-1")).toBeUndefined();
    expect(state.equipment.find((e) => e.id === "sp-1")).toBeDefined(); // immutability: original intact
  });

  it("deposits recovered scrap at quality tier 0 (crude recovery), never a higher tier", () => {
    const piece = makePiece({ slotType: "cargoBay", fitted: false, crafted: true, quality: 5, id: "sp-2" });
    const result = salvageEquipment(stateWith([piece]), "sp-2", () => 0.99);
    if (!("recovered" in result)) throw new Error("expected success");
    for (const itemId of Object.keys(SALVAGE_BP_INPUTS)) {
      // Bucket 0 holds the recovery; bucket 1 stays empty (no high-tier scrap).
      expect(getBucket(result.next.inventory, itemId, 1).toNumber()).toBe(0);
    }
  });
});

describe("salvageEquipment: rejects non-salvageable targets as a same-ref no-op + reason (Task C1)", () => {
  it("rejects a missing id (same-ref state, reason)", () => {
    const state = stateWith([]);
    const result = salvageEquipment(state, "nope", () => 0.5);
    expect("reason" in result).toBe(true);
    expect(result.next).toBe(state); // SAME reference: no state change
  });

  it("rejects a FITTED crafted system (only a SPARE can be salvaged)", () => {
    const piece = makePiece({ slotType: "cargoBay", fitted: true, crafted: true, quality: 2, id: "fit-1" });
    const state = stateWith([piece]);
    const result = salvageEquipment(state, "fit-1", () => 0.5);
    expect("reason" in result).toBe(true);
    expect(result.next).toBe(state);
    // The fitted piece is still present (not consumed).
    expect(result.next.equipment.find((e) => e.id === "fit-1")).toBeDefined();
  });

  it("REFUSES a recipe-less NON-baseline spare (dev-shaped radiant, blueprintKey null) instead of destroying/crashing (AUDIT-2)", () => {
    // A dev-granted radiant spare is blueprintKey null but NOT a standard-rarity floor. The old
    // `blueprintKey===null -> destroy` silently deleted it; the naive one-line fix would crash the
    // materials read (BLUEPRINTS[null].recipe). Correct behavior: REFUSE with reason noRecipe, leaving
    // the valuable item in the pool.
    const devRadiant: EquipmentInstance = {
      ...makePiece({ slotType: "cargoBay", fitted: false, crafted: false, quality: 5, id: "dev-1" }),
      rarity: "radiant",
    };
    const state = stateWith([devRadiant]);
    const result = salvageEquipment(state, "dev-1", () => 0.5);
    expect("reason" in result).toBe(true);
    if ("reason" in result) expect(result.reason).toBe("noRecipe");
    expect(result.next).toBe(state); // same-ref no-op: NOT destroyed
    expect(result.next.equipment.find((e) => e.id === "dev-1")).toBeDefined(); // still in the pool, recoverable
  });

});

describe("salvageEquipment: a spare Standard-Issue baseline salvages as a zero-reward declutter (2026-07-21)", () => {
  it("removes the baseline and recovers NOTHING (no reject, no materials, inventory untouched)", () => {
    const piece = makePiece({ slotType: "cargoBay", fitted: false, crafted: false, quality: 0, id: "base-1" });
    const state = stateWith([piece]);
    const result = salvageEquipment(state, "base-1", () => 0.5);
    // Succeeds as a declutter, it is NOT a reject.
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a successful declutter");
    // The baseline is gone from the spare pool.
    expect(result.next.equipment.find((e) => e.id === "base-1")).toBeUndefined();
    // Zero reward: an empty recovered map and the inventory reference is unchanged
    // (deliberate, so a free baseline can never be a farmable material source).
    expect(Object.keys(result.recovered)).toHaveLength(0);
    expect(result.next.inventory).toBe(state.inventory);
  });
});

// Build ONE spare COMBAT piece (weapon / shieldEmitters / hullPlating). generateStandardIssue
// throws for a combat slot (it mints economy baselines only), so we start from a valid economy
// Standard-Issue baseline and override ONLY the two fields the salvage path reads: slotType (a
// combat slot) and blueprintKey (null = Standard-Issue baseline; a real key = crafted). Always a
// SPARE (fittedToShipId null) so the notFound / fitted guards pass and the baseline-vs-crafted
// branch is what is exercised.
function makeCombatPiece(opts: {
  slotType: EquipmentSlotType;
  crafted: boolean;
  id: string;
}): EquipmentInstance {
  const base = generateStandardIssue({
    slotType: "cargoBay",
    fittedToShipId: null,
    allocateId: () => opts.id,
  });
  return {
    ...base,
    slotType: opts.slotType,
    blueprintKey: opts.crafted ? SALVAGE_BP : null,
    fittedToShipId: null,
  };
}

describe("salvageEquipment: a spare Standard-Issue COMBAT baseline is DESTROYABLE with zero reward (storage escape valve)", () => {
  // The three REQUIRED combat slots. A spare baseline in any of them can be DESTROYED (removed for
  // nothing) so a spare pool that fills with un-removable Standard-Issue gear can never softlock;
  // the earlier guard that BLOCKED this reintroduced exactly that storage-fill softlock.
  const combatSlots: EquipmentSlotType[] = ["weapon", "shieldEmitters", "hullPlating"];

  it("removes the combat baseline and recovers NOTHING (destroy path, NOT a reject)", () => {
    for (const slotType of combatSlots) {
      const piece = makeCombatPiece({ slotType, crafted: false, id: `sib-${slotType}` });
      const state = stateWith([piece]);

      const result = salvageEquipment(state, piece.id, () => 0.5);
      // It succeeds as a declutter (it is NOT refused): the storage escape valve is available.
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected the combat baseline to be destroyable");
      // Gone from the pool (space cleared), zero materials recovered, inventory untouched (a free
      // baseline can never be a farmable material source).
      expect(result.next.equipment.find((e) => e.id === piece.id)).toBeUndefined();
      expect(Object.keys(result.recovered)).toHaveLength(0);
      expect(result.next.inventory).toBe(state.inventory);
    }
  });

  it("a CRAFTED combat piece (blueprintKey set) still SALVAGES for components and is consumed", () => {
    const crafted = makeCombatPiece({ slotType: "weapon", crafted: true, id: "cc-weapon" });
    const state = stateWith([crafted]);

    const result = salvageEquipment(state, "cc-weapon", () => 0.5);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the crafted combat piece to salvage");
    // Consumed from the pool (the recycle path removed it) AND it returned components (a crafted
    // piece refunds a fraction of its recipe inputs, unlike a baseline's zero-reward destroy).
    expect(result.next.equipment.find((e) => e.id === "cc-weapon")).toBeUndefined();
    expect(Object.values(result.recovered).some((amount) => amount > 0)).toBe(true);
  });
});

describe("salvageEquipment: higher-quality systems recover more (Task C1)", () => {
  it("a quality-5 system recovers at least as much, and strictly more of some input, than a quality-0 system on the SAME rng", () => {
    const rng = () => 0; // band pinned to the minimum so only the quality bonus varies
    const low = makePiece({ slotType: "cargoBay", fitted: false, crafted: true, quality: 0, id: "q0" });
    const high = makePiece({ slotType: "cargoBay", fitted: false, crafted: true, quality: 5, id: "q5" });

    const lowRes = salvageEquipment(stateWith([low]), "q0", rng);
    const highRes = salvageEquipment(stateWith([high]), "q5", rng);
    if (!("recovered" in lowRes) || !("recovered" in highRes)) throw new Error("expected success");

    // Total recovered scrap is strictly greater for the higher-quality system.
    const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
    expect(sum(highRes.recovered)).toBeGreaterThan(sum(lowRes.recovered));
  });
});

describe("salvageEquipment: SOFTLOCK RELIEF, salvage works AT the storage cap (Task C1)", () => {
  it("salvaging a spare with the pool at cap succeeds and drops the spare count below cap (cap is never consulted)", () => {
    const cap = equipmentStorageCap(freshState());
    // Fill the spare pool to EXACTLY the cap with crafted spares.
    const pool: EquipmentInstance[] = [];
    for (let i = 0; i < cap; i++) {
      pool.push(makePiece({ slotType: "cargoBay", fitted: false, crafted: true, quality: 1, id: `cap-${i}` }));
    }
    const state = stateWith(pool);
    expect(equipmentAtCap(state)).toBe(true); // precondition: the store is FULL
    expect(spareEquipmentCount(state)).toBe(cap);

    // Salvage still succeeds at cap: salvage never checks equipmentAtCap, so a full
    // store is always relievable (the guarantee deferred from Task B1).
    const result = salvageEquipment(state, "cap-0", () => 0.5);
    expect("recovered" in result).toBe(true);
    expect(spareEquipmentCount(result.next)).toBe(cap - 1);
    expect(equipmentAtCap(result.next)).toBe(false);
  });
});

// ============================================================================
// THE REWRITTEN SOURCE GUARD (Crafting 0.13.3, Phase 2 Unit 2.3, design section 7.5)
// ============================================================================
// ⚠️ WHAT THIS GUARD DEFENDS, IN ONE SENTENCE:
//
//     SALVAGE MUST NEVER ROLL ON AN UNSEEDED STREAM INSIDE THE ECONOMY SEAM.
//
// Read that before touching anything below, because the guard that used to live here
// asserted something else and this is the second version of it.
//
// VERSION 1 (0.11.0 - 0.13.2) asserted a PROXY: the strings "salvageEquipment",
// "salvageSalvagedMaterial", "salvageShip" and "./salvage" never appeared in tick.ts at
// all. That was a perfectly good proxy while salvage was a live-only instant action,
// because the only way for salvage to reach the tick was to be named there.
//
// VERSION 2 (this one) exists because 0.13.3 made salvage a TIMED, queued process. The
// proxy is now FALSE BY DESIGN: resolveProcesses calls all three functions. The
// invariant, however, is unchanged and MORE load-bearing than before, because salvage
// rolls now happen inside the offline-catch-up seam where an unseeded draw would make a
// long offline span recover different materials than the identical span played live.
//
// So the proxy was REPLACED, not deleted, by three assertions on the real thing:
//   1. every salvage call site in tick.ts passes the threaded `rng` (the count of calls
//      that pass it equals the total count of calls, and that count is not zero);
//   2. tick.ts never CALLS Math.random: every occurrence in its code is the injectable
//      `rng` parameter's DEFAULT, never a direct draw;
//   3. salvage.ts still imports nothing from tick.ts, so the dependency direction is
//      one-way and no import cycle exists.
//
// ASSERTIONS 1 AND 2 COMPOSE, AND NEITHER IS SUFFICIENT ALONE. Assertion 1 catches a call
// that simply forgot its argument (the parameter has a Math.random default, so a dropped
// argument compiles cleanly and fails silently at runtime, which is the nastiest shape
// this bug has). Assertion 2 catches the other direction: an unseeded source handed IN,
// including through the intermediate helper the branch calls, which assertion 1 cannot
// see because the helper's own name is not a salvage function's. Both mutations were
// tried against this guard before it was committed, and each is caught by exactly one of
// the two, which is why both are here.
//
// IF YOU ARE HERE BECAUSE THIS FAILED: do not relax the assertion. A failure means either
// a salvage call in the tick path forgot its rng argument (offline and live will diverge
// silently, and the player who was away all night gets different loot than the player who
// watched it), or something in tick.ts started drawing bare randomness. Fix the call, not
// the guard. The behavioral proof that backs these greps is the offline==live parity
// suite at the bottom of this file; the greps exist because a grep fails on the LINE that
// broke, while the parity test fails somewhere far downstream.
// ============================================================================

// Strip comments before grepping, so PROSE mentioning a salvage function or Math.random
// cannot satisfy (or break) an assertion about CODE. This is the reason version 1's own
// comment had to warn future authors not to name the functions in tick.ts's comments; the
// guard now handles that itself instead of constraining how the source may be written.
// Deliberately simple (block comments, then line comments to end of line): tick.ts holds
// no string literal containing "//" or "/*", and even if one appeared the only effect
// would be to hide code from the grep, which the non-zero call-count assertion catches.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// Every CALL of a salvage function (the name followed by an open paren). The import
// statement lists the same three names without parens, so it is correctly not a call.
const SALVAGE_CALL = /\bsalvage(?:Equipment|SalvagedMaterial|Ship)\s*\(/g;
// The same call WITH `rng` somewhere in its argument list. `[^)]*` cannot span a nested
// paren, which is fine and intentional: every tick-path salvage call passes plain
// identifiers, and a call complex enough to nest parens deserves to be looked at by hand.
const SALVAGE_CALL_WITH_RNG = /\bsalvage(?:Equipment|SalvagedMaterial|Ship)\s*\([^)]*\brng\b[^)]*\)/g;

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

describe("⚠️ GUARD: salvage in the tick path is rng-THREADED, never unseeded (0.13.3 Unit 2.3)", () => {
  it("EVERY salvage call in tick.ts passes the threaded rng, and there is at least one", () => {
    const code = stripComments(tickSource);
    const calls = countMatches(code, SALVAGE_CALL);
    const threaded = countMatches(code, SALVAGE_CALL_WITH_RNG);

    // NON-VACUITY FIRST. Without this, deleting the salvage wiring entirely would make
    // 0 === 0 and the guard would pass while defending nothing. Three arms, three calls.
    expect(calls).toBeGreaterThanOrEqual(3);
    // THE INVARIANT: not "some call passes rng" but "the ones that pass it are ALL of
    // them". A single forgotten argument makes these two numbers differ.
    expect(threaded).toBe(calls);
  });

  it("tick.ts never CALLS Math.random: every occurrence is an injectable rng parameter's default", () => {
    const code = stripComments(tickSource);
    const total = countMatches(code, /Math\.random/g);
    // `= Math.random` is the default-parameter form (`rng: () => number = Math.random`).
    // Anything else, and specifically the call form `Math.random()`, is a direct draw.
    const asDefault = countMatches(code, /=\s*Math\.random/g);

    // Non-vacuous: the injectable-with-default pattern really is in use here.
    expect(total).toBeGreaterThan(0);
    // The invariant: no direct draws. A new `Math.random()` anywhere in tick.ts breaks
    // the seeded stream for everything downstream of it, salvage included.
    expect(asDefault).toBe(total);
    expect(code).not.toContain("Math.random()");
  });

  it("salvage.ts imports nothing from tick.ts, so the dependency direction stays one-way", () => {
    // tick.ts -> salvage.ts is now a real edge. The reverse edge would close a cycle, and
    // a cycle between the economy resolver and a reward module is the kind of thing that
    // works in Vite and explodes in a different bundler at a module-init order change.
    // reservation.ts exists precisely so neither side needs the other (see its header).
    const code = stripComments(salvageSource);
    expect(code).not.toContain("./tick");
  });
});

// ============================================================================
// salvageSalvagedMaterial (Task C2/C3): the tiered, progression-gated loot roll.
// ============================================================================

// The salvaged material every loot-roll fixture salvages. Its id is deliberately the
// legacy `intactReactorCore` (the Damaged Reactor Housing), reclassified to
// `salvagedMaterial` in Task A3, so the tests read the id straight off the data.
const HOUSING = "intactReactorCore";

// A stub rng that returns a FIXED sequence of values, one per call, then repeats the
// last value (so a caller that draws more than expected still gets a defined value
// instead of NaN). salvageSalvagedMaterial makes exactly two draws (tier, then item),
// so a two-element sequence pins one exact roll.
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i++;
    return v;
  };
}

// A fresh state that holds `count` of the Damaged Reactor Housing at quality 0, and a
// chosen Fleet Admiral level (drives the progression ceiling). freshState seeds no
// Housing, so this is the whole picture.
function stateWithHousing(count: number, fleetAdminLevel: number): GameState {
  const base = freshState();
  return {
    ...base,
    fleetAdminLevel,
    inventory: { ...base.inventory, [HOUSING]: [new Decimal(count)] },
  };
}

// A deterministic PRNG (mulberry32) for the STATISTICAL balance/gating tests, so "over
// many rolls" is reproducible run to run (no reliance on Math.random).
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

// FA level that unlocks the FULL ladder (>= the highest threshold), for tests that need
// the top tier reachable. Read off the data so it can never drift from the thresholds.
const MAX_CEILING_LEVEL = Math.max(...SALVAGE_CEILING_THRESHOLDS.map((t) => t.minFleetAdminLevel));

describe("salvageSalvagedMaterial: a seeded roll deposits the expected tier+item and consumes one unit (Task C2)", () => {
  it("rng [0,0] rolls the LOW tier's staple at that tier's quality and consumes one Housing", () => {
    const state = stateWithHousing(3, 1); // fresh FA level: only the standard tier eligible
    const lowTier = SALVAGE_LOOT_POOLS[HOUSING][0];
    const staple = lowTier.drops[0]; // first drop = the reliable staple

    // rng()=0 picks the first eligible tier, then the first drop in it.
    const result = salvageSalvagedMaterial(state, HOUSING, seqRng([0, 0]));
    expect("rolled" in result).toBe(true);
    if (!("rolled" in result) || !result.rolled) throw new Error("expected a roll");

    // The rolled item is the low tier's staple, deposited at the tier's quality bucket.
    expect(result.rolled.itemId).toBe(staple.itemId);
    expect(result.rolled.tier).toBe(lowTier.tier);
    expect(result.rolled.quality).toBe(lowTier.quality);
    expect(getBucket(result.next.inventory, staple.itemId, lowTier.quality).toNumber()).toBe(1);
    expect(result.recovered[staple.itemId]).toBe(1);

    // Exactly ONE Housing consumed (3 -> 2), and the input state is untouched.
    expect(itemTotal(result.next.inventory, HOUSING).toNumber()).toBe(2);
    expect(itemTotal(state.inventory, HOUSING).toNumber()).toBe(3); // immutability
  });

  it("rng near 1 on the tier draw, with the full ladder unlocked, rolls the TOP tier's first exotic", () => {
    const state = stateWithHousing(1, MAX_CEILING_LEVEL);
    const pool = SALVAGE_LOOT_POOLS[HOUSING];
    const topTier = pool[pool.length - 1]; // radiant this patch
    const topDrop = topTier.drops[0];

    // 0.999999 on the tier draw walks past every lower tier to the last eligible one;
    // 0 on the item draw picks that tier's first drop (an exclusive exotic).
    const result = salvageSalvagedMaterial(state, HOUSING, seqRng([0.999999, 0]));
    if (!("rolled" in result) || !result.rolled) throw new Error("expected a roll");

    expect(result.rolled.tier).toBe(topTier.tier);
    expect(result.rolled.itemId).toBe(topDrop.itemId);
    expect(result.rolled.quality).toBe(topTier.quality);
    expect(getBucket(result.next.inventory, topDrop.itemId, topTier.quality).toNumber()).toBe(1);
  });
});

describe("salvageSalvagedMaterial: the Damaged Weapon System salvages into weapon build materials (Combat 1.0, Unit 1.7)", () => {
  // The weapon-crafting-loot drop wired in Unit 1.7. It reuses the Damaged Reactor
  // Housing idiom EXACTLY (a salvagedMaterial item with a SALVAGE_LOOT_POOLS entry), so
  // the existing salvageSalvagedMaterial path strips it for parts with no new code.
  const WEAPON_SYSTEM = "damagedWeaponSystem";

  it("is a real salvagedMaterial ITEM with its own loot pool (the crafting-loot idiom is wired, not gear)", () => {
    // It must be a MATERIAL you strip, never installable gear (design S12, no gear from wrecks).
    expect(ITEMS[WEAPON_SYSTEM]?.category).toBe("salvagedMaterial");
    // ...and it MUST carry a loot pool, or salvageSalvagedMaterial would reject it.
    expect(SALVAGE_LOOT_POOLS[WEAPON_SYSTEM]?.length).toBeGreaterThan(0);
  });

  it("rng [0,0] strips it into the low tier's weapon-material staple and consumes one unit", () => {
    const base = freshState();
    const state: GameState = {
      ...base,
      fleetAdminLevel: 1, // fresh FA level: only the standard tier is eligible
      inventory: { ...base.inventory, [WEAPON_SYSTEM]: [new Decimal(2)] },
    };
    const lowTier = SALVAGE_LOOT_POOLS[WEAPON_SYSTEM][0];
    const staple = lowTier.drops[0]; // the reliable weapon-feedstock staple

    // rng()=0 picks the first eligible tier, then its first drop (the staple).
    const result = salvageSalvagedMaterial(state, WEAPON_SYSTEM, seqRng([0, 0]));
    if (!("rolled" in result) || !result.rolled) throw new Error("expected a roll");

    // The drop is the staple, deposited at the tier's quality, and it is itself a BUILD
    // MATERIAL (refined/component), i.e. weapon feedstock, never functional gear.
    expect(result.rolled.itemId).toBe(staple.itemId);
    expect(["raw", "refined", "minorComponent", "majorComponent"]).toContain(
      ITEMS[result.rolled.itemId].category,
    );
    expect(getBucket(result.next.inventory, staple.itemId, lowTier.quality).toNumber()).toBe(1);
    expect(result.recovered[staple.itemId]).toBe(1);

    // Exactly ONE Weapon System consumed (2 -> 1), input state untouched (immutability).
    expect(itemTotal(result.next.inventory, WEAPON_SYSTEM).toNumber()).toBe(1);
    expect(itemTotal(state.inventory, WEAPON_SYSTEM).toNumber()).toBe(2);
  });
});

describe("salvageSalvagedMaterial: rejects invalid targets as a same-ref no-op + reason (Task C2)", () => {
  it("rejects a NON-salvagedMaterial item id", () => {
    const state = stateWithHousing(1, 1);
    // scrapAlloy is a raw item, not a salvaged material: no loot pool, not salvageable.
    const result = salvageSalvagedMaterial(state, "scrapAlloy", seqRng([0, 0]));
    expect("reason" in result).toBe(true);
    if (!("reason" in result)) return;
    expect(result.reason).toBe("notSalvagedMaterial");
    expect(result.next).toBe(state); // SAME reference: no state change
  });

  it("rejects when the player holds ZERO of the salvaged material", () => {
    const state = stateWithHousing(0, 1); // Housing present as a key but at 0
    const result = salvageSalvagedMaterial(state, HOUSING, seqRng([0, 0]));
    expect("reason" in result).toBe(true);
    if (!("reason" in result)) return;
    expect(result.reason).toBe("noneHeld");
    expect(result.next).toBe(state);
  });
});

describe("salvageSalvagedMaterial: progression gates the rarity ceiling (Task C2)", () => {
  it("at a LOW FA level, only the low tier rolls, the high-tier exclusive exotic is UNREACHABLE", () => {
    const state = stateWithHousing(2000, 1); // fresh FA level: ceiling = index 0
    const rng = mulberry32(12345);
    const lowTierQuality = SALVAGE_LOOT_POOLS[HOUSING][0].quality;

    // The stellar tier's first drop is the first exclusive exotic (anomalousAlloy). At a
    // fresh FA level that tier is out of reach, so it must NEVER be deposited, and no
    // drop should ever land above the low tier's quality bucket.
    const exoticId = SALVAGE_LOOT_POOLS[HOUSING][2].drops[0].itemId;
    let next = state;
    for (let i = 0; i < 2000; i++) {
      const r = salvageSalvagedMaterial(next, HOUSING, rng);
      if (!("rolled" in r) || !r.rolled) throw new Error("expected a roll");
      // No roll ever exceeds the low tier's quality (nothing above the ceiling rolled).
      expect(r.rolled.quality).toBeLessThanOrEqual(lowTierQuality);
      next = r.next;
    }
    // The exclusive exotic never entered inventory at all.
    expect(itemTotal(next.inventory, exoticId).toNumber()).toBe(0);
  });

  it("a ceilingBonus lifts the ceiling so the top tier becomes reachable (the FA-talent hook)", () => {
    const state = stateWithHousing(1, 1); // fresh FA level, but...
    const pool = SALVAGE_LOOT_POOLS[HOUSING];
    const topTier = pool[pool.length - 1];
    // ...a ceilingBonus large enough to unlock the whole ladder. rng near 1 forces the
    // top eligible tier, proving the bonus (not FA level) opened it.
    const result = salvageSalvagedMaterial(state, HOUSING, seqRng([0.999999, 0]), pool.length);
    if (!("rolled" in result) || !result.rolled) throw new Error("expected a roll");
    expect(result.rolled.tier).toBe(topTier.tier);
  });
});

describe("salvageSalvagedMaterial: balance, exotics dominate the high tiers, refined/components are super-rare (Task C3)", () => {
  it("over many top-ceiling rolls, exclusive exotics vastly outnumber plain refined/components", () => {
    const state = stateWithHousing(20000, MAX_CEILING_LEVEL); // full ladder unlocked
    const rng = mulberry32(99);

    // The exclusive salvage-only exotics (from A3) vs the plain refined/fabricated items
    // that may appear only at super-rare weights.
    const exotics = new Set(["anomalousAlloy", "precursorCircuit", "intactDataCore"]);
    const plainRefinedComponents = new Set(["titaniumIngot", "frameSegment", "powerCoupling"]);

    let exoticCount = 0;
    let refinedComponentCount = 0;
    let total = 0;
    let next = state;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const r = salvageSalvagedMaterial(next, HOUSING, rng);
      if (!("rolled" in r) || !r.rolled) throw new Error("expected a roll");
      if (exotics.has(r.rolled.itemId)) exoticCount++;
      if (plainRefinedComponents.has(r.rolled.itemId)) refinedComponentCount++;
      total++;
      next = r.next;
    }

    // Exotics dominate over plain refined/components (steep-but-reachable high tiers vs
    // super-rare guardrail weights): a wide margin, asserted as a ratio so the exact
    // seed does not make the test brittle.
    expect(exoticCount).toBeGreaterThan(refinedComponentCount * 3);
    // Plain refined/components stay genuinely RARE overall (< 2% of all rolls): salvage
    // must never become a sensible way to source them.
    expect(refinedComponentCount / total).toBeLessThan(0.02);
    // Sanity: the common outcome is still the modest low-tier staple (the majority).
    expect(exoticCount / total).toBeLessThan(0.5);
  });
});

describe("SALVAGE_LOOT_POOLS: the pool data is well-formed (Task C3)", () => {
  it("every referenced drop item exists in ITEMS, tiers ascend in quality, and exotics sit at the top", () => {
    for (const [materialId, tiers] of Object.entries(SALVAGE_LOOT_POOLS)) {
      // The keyed salvaged material itself is a real, salvagedMaterial-category item.
      expect(ITEMS[materialId]?.category).toBe("salvagedMaterial");
      expect(tiers.length).toBeGreaterThan(0);

      let prevQuality = -1;
      for (const tier of tiers) {
        expect(tier.weight).toBeGreaterThan(0);
        // Quality is a valid 0..5 rung and ascends (weakly) with tier index.
        expect(tier.quality).toBeGreaterThanOrEqual(0);
        expect(tier.quality).toBeLessThanOrEqual(5);
        expect(tier.quality).toBeGreaterThanOrEqual(prevQuality);
        prevQuality = tier.quality;
        expect(tier.drops.length).toBeGreaterThan(0);
        for (const drop of tier.drops) {
          expect(ITEMS[drop.itemId]).toBeDefined(); // no dangling item reference
          expect(drop.weight).toBeGreaterThan(0);
        }
      }

      // The exclusive exotics appear ONLY in the upper half of the ladder, never the
      // lowest tier (they are the high-tier payoff, not a common drop).
      const exotics = new Set(["anomalousAlloy", "precursorCircuit", "intactDataCore"]);
      const lowestTierItems = new Set(tiers[0].drops.map((d) => d.itemId));
      for (const id of exotics) {
        expect(lowestTierItems.has(id)).toBe(false);
      }
    }
  });
});

// ============================================================================
// The combined Fleet-Admiral salvage talent (Task C4)
// ============================================================================
// ONE Homeworld talent (fleetLogisticsSalvage) that improves BOTH salvage models:
// it raises the equipment recycle YIELD and lifts the salvaged-material loot CEILING.
// salvageTalentBonus(state) reads it from state.unlockedHomeworldTalents, and BOTH
// salvage functions fold that bonus in INTERNALLY, so the talent applies automatically
// in real play (no UI caller has to pass anything). These tests pin: the helper's
// zero/bump contract, the auto-applied recycle-yield increase, the auto-applied
// ceiling lift, and the talent's presence + shape in the tree.

// A state with the salvage talent learned (injected straight into the unlocked list,
// bypassing the graph buy-gating the UI enforces, which is irrelevant to the effect read).
function withSalvageTalent(state: GameState): GameState {
  return { ...state, unlockedHomeworldTalents: [...state.unlockedHomeworldTalents, "fleetLogisticsSalvage"] };
}

describe("salvageTalentBonus: zero without the talent, the tuned bumps with it (Task C4)", () => {
  it("returns {0, 0} when the salvage talent is not learned", () => {
    const bonus = salvageTalentBonus(freshState()); // freshState has no unlocked talents
    expect(bonus.yieldBonus).toBe(0);
    expect(bonus.ceilingBonus).toBe(0);
  });

  it("returns the SALVAGE_TALENT_* consts when the salvage talent is learned", () => {
    const bonus = salvageTalentBonus(withSalvageTalent(freshState()));
    expect(bonus.yieldBonus).toBe(SALVAGE_TALENT_YIELD_BONUS);
    expect(bonus.ceilingBonus).toBe(SALVAGE_TALENT_CEILING_BONUS);
  });
});

describe("salvageEquipment: the learned talent auto-raises recycle yield (Task C4)", () => {
  it("with the talent learned, the same piece + same rng recovers strictly MORE", () => {
    // rng()=0 pins the band at its MIN, quality 0 removes the quality bonus, so the
    // ONLY difference between the two runs is the auto-applied talent yield bonus.
    // titaniumIngot (input qty 3) floors to 0 at the base fraction but crosses to >=1
    // once the +yieldBonus is folded in, so the total recovered strictly increases.
    const piece = makePiece({ slotType: "cargoBay", fitted: false, crafted: true, quality: 0, id: "c4-eq" });
    const baseState = stateWith([piece]);

    const without = salvageEquipment(baseState, "c4-eq", () => 0);
    const withT = salvageEquipment(withSalvageTalent(baseState), "c4-eq", () => 0);
    if (!("recovered" in without) || !("recovered" in withT)) throw new Error("expected successful salvages");

    const sum = (rec: Record<string, number>) => Object.values(rec).reduce((a, b) => a + b, 0);
    expect(sum(withT.recovered)).toBeGreaterThan(sum(without.recovered));
  });
});

describe("salvageSalvagedMaterial: the learned talent auto-lifts the loot ceiling (Task C4)", () => {
  it("at an FA level whose base ceiling stops short of the top, the talent makes the top tier reachable", () => {
    // FA level 10 reaches base ceiling index 2 (stellar), NOT the index-3 top tier
    // (radiant) per SALVAGE_CEILING_THRESHOLDS. rng near 1 forces the highest ELIGIBLE
    // tier, so the rolled tier is a direct read of the current ceiling.
    const pool = SALVAGE_LOOT_POOLS[HOUSING];
    const topTier = pool[pool.length - 1];
    const stellarTier = pool[2];
    const level = 10;

    // Without the talent: the ceiling caps at stellar, the top tier is unreachable.
    const without = salvageSalvagedMaterial(stateWithHousing(1, level), HOUSING, seqRng([0.999999, 0]));
    if (!("rolled" in without) || !without.rolled) throw new Error("expected a roll");
    expect(without.rolled.tier).toBe(stellarTier.tier);

    // With the talent learned: +ceilingBonus lifts the ceiling to the top tier, and the
    // bump is applied AUTOMATICALLY (no ceilingBonus argument is passed here).
    const withT = salvageSalvagedMaterial(withSalvageTalent(stateWithHousing(1, level)), HOUSING, seqRng([0.999999, 0]));
    if (!("rolled" in withT) || !withT.rolled) throw new Error("expected a roll");
    expect(withT.rolled.tier).toBe(topTier.tier);
  });
});

describe("HOMEWORLD_TALENTS: the combined salvage talent exists with valid shape (Task C4)", () => {
  it("fleetLogisticsSalvage is a fleetLogistics node with a positive cost and the tuned salvageBoost effect", () => {
    const node = HOMEWORLD_TALENTS.fleetLogisticsSalvage;
    expect(node).toBeDefined();
    expect(node.branch).toBe("fleetLogistics");
    expect(node.cost).toBeGreaterThan(0);
    expect(node.isHub ?? false).toBe(false); // a content node, not the branch seed
    expect(node.flavor.length).toBeGreaterThan(0);
    // The effect carries BOTH bumps, sourced from the tunable consts (single source of truth).
    expect(node.effect).toEqual({
      type: "salvageBoost",
      yieldBonus: SALVAGE_TALENT_YIELD_BONUS,
      ceilingBonus: SALVAGE_TALENT_CEILING_BONUS,
    });
    // Graph integrity: it neighbors Fleet Requisitions, and that adjacency is symmetric
    // (the model.test.ts graph-integrity suite proves this table-wide; pinned here too
    // because this node is the one Task C4 adds).
    expect(node.neighbors).toContain("fleetLogisticsYield");
    expect(HOMEWORLD_TALENTS.fleetLogisticsYield.neighbors).toContain("fleetLogisticsSalvage");
  });
});

// ============================================================================
// salvageShip (ship-salvage): break down a whole hull for a fraction of its
// build cost. LIVE-ONLY, INSTANT this patch (a future task makes it a timed
// teardown). Mirrors salvageEquipment's band + same-ref-reject shape, adds a
// credit refund, returns crafted systems to spares, discards baselines, and
// unassigns the captain.
// ============================================================================

// The starting hull's build recipe, read straight off SHIP_TYPES so the reward
// math is pinned to the DATA (no hard-coded duplicate that could drift). freshState
// seeds ship-1 as a generalFreighter assigned to captain 1.
const FREIGHTER_RECIPE = SHIP_TYPES.generalFreighter.buildRecipe;

// A minimal active mission, enough to make onMissionLock treat the captain as "out
// flying" (mission !== null is the only thing the lock reads). cargo's required-key
// Record is satisfied with an empty object via a cast, this fixture never reads it.
function activeMission(): CaptainMissionState {
  return {
    kind: "extraction",
    missionKey: "shortOreRun",
    phase: "transitOut",
    phaseProgressTicks: 0,
    cargo: {} as CaptainMissionState["cargo"],
    recalled: false,
  };
}

// A fresh state whose one seeded hull (ship-1, captain 1) carries a KNOWN equipment
// set: one CRAFTED system fitted to it (survives salvage as a spare), one Standard-Issue
// BASELINE fitted to it (discarded by salvage), and one unrelated SPARE crafted system
// (must be left untouched). `captainMission` puts captain 1 on a mission when supplied
// (to exercise the on-mission reject); default idle.
function shipSalvageState(captainMission: CaptainMissionState | null = null): GameState {
  const base = freshState();
  const captains = base.captains.map((c) =>
    c.id === 1 ? { ...c, mission: captainMission } : c
  );
  const equipment: EquipmentInstance[] = [
    makePiece({ slotType: "cargoBay", fitted: true, crafted: true, quality: 2, id: "cr-1" }),
    makePiece({ slotType: "ftlDrive", fitted: true, crafted: false, quality: 0, id: "bl-1" }),
    makePiece({ slotType: "reactorCore", fitted: false, crafted: true, quality: 0, id: "sp-x" }),
  ];
  return { ...base, captains, equipment };
}

describe("salvageShip: breaks down an idle hull (Task ship-salvage)", () => {
  it("removes the ship, returns crafted systems as spares, discards baselines, deposits ~% components at quality 0, refunds ~% credits, and unassigns the captain", () => {
    const rngValue = 0.5; // fraction = 0.30 + 0.5*0.10 = 0.35 (band only, no quality/talent for a hull)
    // TWO hulls: the last-ship guard refuses salvaging the fleet's ONLY ship, so a successful
    // teardown needs a spare hull present. ship-2 is a bare idle freighter (no captain, no
    // equipment) that the assertions below never inspect, so it only satisfies length > 1.
    const base = shipSalvageState();
    const state: GameState = {
      ...base,
      ships: [...base.ships, { id: "ship-2", typeKey: "generalFreighter", assignedCaptainId: null }],
    };
    const startCredits = state.credits.toNumber();

    const result = salvageShip(state, "ship-1", () => rngValue);
    expect(result.ok).toBe(true);
    if (!result.ok) return; // narrow for the type checker

    const fraction = SALVAGE_FRACTION_MIN + rngValue * (SALVAGE_FRACTION_MAX - SALVAGE_FRACTION_MIN);

    // The hull is gone (frees a docks slot immediately), and the input state is untouched.
    expect(result.next.ships.find((s) => s.id === "ship-1")).toBeUndefined();
    expect(state.ships.find((s) => s.id === "ship-1")).toBeDefined(); // immutability

    // Crafted system fitted to the hull SURVIVES as a spare (fittedToShipId nulled).
    const craftedAfter = result.next.equipment.find((e) => e.id === "cr-1");
    expect(craftedAfter).toBeDefined();
    expect(craftedAfter?.fittedToShipId).toBeNull();
    // Standard-Issue baseline fitted to the hull is DISCARDED.
    expect(result.next.equipment.find((e) => e.id === "bl-1")).toBeUndefined();
    // The unrelated spare crafted system is UNTOUCHED.
    expect(result.next.equipment.find((e) => e.id === "sp-x")).toBeDefined();

    // Each build component is reported with its floored recovered amount and deposited into
    // the QUALITY-0 bucket specifically.
    for (const [itemId, count] of Object.entries(FREIGHTER_RECIPE.components)) {
      const expected = Math.floor(count * fraction);
      expect(result.recovered[itemId]).toBe(expected);
      expect(getBucket(result.next.inventory, itemId, 0).toNumber()).toBe(expected);
    }
    // At least one component recovered a positive amount, so the deposit is real.
    expect(Object.values(result.recovered).some((n) => n > 0)).toBe(true);

    // Credits refund: floor(recipe.credits * fraction), added onto the balance.
    const expectedCredits = Math.floor(FREIGHTER_RECIPE.credits * fraction);
    expect(result.creditsRecovered).toBe(expectedCredits);
    expect(result.next.credits.toNumber()).toBe(startCredits + expectedCredits);

    // Captain 1 still exists but no ship points at it any more (ship->captain link severed
    // with the hull; there is no captain->ship field to leave dangling).
    expect(result.next.captains.find((c) => c.id === 1)).toBeDefined();
    expect(result.next.ships.some((s) => s.assignedCaptainId === 1)).toBe(false);
  });
});

describe("salvageShip: rejects invalid targets as a same-ref no-op + reason (Task ship-salvage)", () => {
  it("rejects an on-mission ship (its captain is out flying) without touching state", () => {
    const state = shipSalvageState(activeMission());
    const result = salvageShip(state, "ship-1", () => 0.5);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("shipOnMission");
    expect(result.next).toBe(state); // SAME reference: no state change
    // The hull is still present (not torn down).
    expect(result.next.ships.find((s) => s.id === "ship-1")).toBeDefined();
  });

  it("rejects a missing ship id (same-ref state, reason)", () => {
    const state = shipSalvageState();
    const result = salvageShip(state, "ship-nope", () => 0.5);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("shipNotFound");
    expect(result.next).toBe(state);
  });
});

// The last-hull softlock guard: salvaging the fleet's ONLY ship would strand the player with no
// hull, no mission income, and a costly Shipyard re-founding, a practical softlock. salvageShip
// refuses it outright as a same-ref no-op (nothing destroyed or mutated). freshState seeds exactly
// one hull, so the default fixture already reproduces the length===1 condition.
describe("salvageShip: refuses to break down the fleet's only hull (last-ship softlock guard)", () => {
  it("returns the lastShip reason as a same-ref, byte-identical no-op when state.ships.length === 1", () => {
    const state = shipSalvageState(); // freshState seeds a single hull, ship-1
    expect(state.ships.length).toBe(1); // precondition: this IS the last ship

    const result = salvageShip(state, "ship-1", () => 0.5);
    expect(result.ok).toBe(false);
    if (result.ok) return; // narrow for the type checker
    expect(result.reason).toBe("lastShip");
    // SAME reference: the strongest form of "state left byte-identical", nothing was rebuilt.
    expect(result.next).toBe(state);
    // The hull is still present (not torn down) and the fleet is not emptied.
    expect(result.next.ships.find((s) => s.id === "ship-1")).toBeDefined();
    expect(result.next.ships.length).toBe(1);
  });

  it("still allows salvaging when a second hull is present (guard is length-based, not identity-based)", () => {
    const base = shipSalvageState();
    const state: GameState = {
      ...base,
      ships: [...base.ships, { id: "ship-2", typeKey: "generalFreighter", assignedCaptainId: null }],
    };
    const result = salvageShip(state, "ship-1", () => 0.5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // ship-1 torn down, ship-2 remains as the fleet's surviving hull.
    expect(result.next.ships.find((s) => s.id === "ship-1")).toBeUndefined();
    expect(result.next.ships.find((s) => s.id === "ship-2")).toBeDefined();
  });
});

// ============================================================================
// DERIVED SALVAGE RESERVATIONS (Crafting 0.13.3, Phase 2 Units 2.1 + 2.2)
// (design 2026-09-01-crafting-0.13.3-design.md section 7.3.)
//
// Salvage is the one process that consumes its target at COMPLETION rather than at
// start, so the thing that closes the double-spend window is not a deduction, it is a
// reservation DERIVED from state on every read. These cases pin that derivation:
// what it contains, what it deliberately does NOT contain, and that it dedupes.
//
// TWO SOURCES, asserted separately and together (Unit 2.2 added the second):
//   QUEUED    a "salvage" order sitting in state.processQueue
//   IN FLIGHT a "salvageJob" in state.activeProcesses carrying a salvageResolve effect
// The pair matters more than either alone. Promotion moves a target from the first list
// to the second, so if only one source were scanned the handoff would flash a window
// where the target read as free, and salvage has no start-time deduction to catch that.
// ============================================================================

// Wrap loose orders into the QueuedJob rows GameState actually stores. Ids mirror the
// engine's own "q-N" minting so a fixture reads like a real save.
function queuedJobs(...orders: { facility: QueuedJob["facility"]; order: QueuedOrder }[]): QueuedJob[] {
  return orders.map((entry, i) => ({ id: `q-${i + 1}`, facility: entry.facility, order: entry.order }));
}

// A fresh state holding exactly these salvage-bay orders. Nothing else is touched: the
// reservation is a pure function of processQueue, so the rest of the save is noise.
function stateWithSalvageQueue(...targets: SalvageTargetRef[]): GameState {
  return {
    ...freshState(),
    processQueue: queuedJobs(
      ...targets.map((target) => ({
        facility: "salvageBay" as const,
        // One unit per order: the pre-batch shape, so every reservation case built on this
        // fixture keeps asserting exactly what it asserted before batches existed.
        order: { type: "salvage" as const, target, mode: { kind: "batch" as const, remaining: 1 } },
      }))
    ),
  };
}

// Wrap loose targets into the RUNNING "salvageJob" processes GameState actually stores.
// Ids mirror the engine's own "proc-N" minting so a fixture reads like a real save. The
// durations are arbitrary here: the reservation derivation reads only the effect's
// target and never the countdown, which is exactly the decoupling being asserted.
function salvageJobs(...targets: SalvageTargetRef[]): TimedProcess[] {
  return targets.map((target, i) => ({
    id: `proc-${i + 1}`,
    kind: "salvageJob" as const,
    remainingTicks: 5,
    durationTicks: 5,
    effect: { type: "salvageResolve" as const, target },
  }));
}

// A fresh state with these salvage jobs already IN FLIGHT and nothing queued. The mirror
// image of stateWithSalvageQueue, so the two sources can be asserted to behave the same.
function stateWithSalvageInFlight(...targets: SalvageTargetRef[]): GameState {
  return { ...freshState(), activeProcesses: salvageJobs(...targets) };
}

describe("salvageReservations: the derived set is exactly what the queue names (0.13.3 Unit 2.1)", () => {
  it("is empty in every bin for a queue with nothing in it", () => {
    const reserved = salvageReservations(freshState());
    expect(reserved.instanceIds.size).toBe(0);
    expect(reserved.shipIds.size).toBe(0);
    expect(reserved.materialCounts.size).toBe(0);
  });

  it("bins all three SalvageTargetRef arms into their own container", () => {
    const state = stateWithSalvageQueue(
      { kind: "equipment", instanceId: "eq-7" },
      { kind: "ship", shipId: "ship-4" },
      { kind: "material", itemId: HOUSING }
    );
    const reserved = salvageReservations(state);
    expect([...reserved.instanceIds]).toEqual(["eq-7"]);
    expect([...reserved.shipIds]).toEqual(["ship-4"]);
    expect(reserved.materialCounts.get(HOUSING)).toBe(1);
    // Bins never bleed into one another: a hull id is not an instance id.
    expect(reserved.instanceIds.has("ship-4")).toBe(false);
    expect(reserved.shipIds.has("eq-7")).toBe(false);
  });

  it("dedupes UNIQUE targets and ACCUMULATES fungible ones", () => {
    // Two orders on one instance and two on one hull (only reachable through a
    // hand-edited save, since canEnqueueOrder refuses the duplicate) still count once:
    // a unique thing is either spoken for or it is not.
    const state = stateWithSalvageQueue(
      { kind: "equipment", instanceId: "eq-7" },
      { kind: "equipment", instanceId: "eq-7" },
      { kind: "ship", shipId: "ship-4" },
      { kind: "ship", shipId: "ship-4" },
      // A salvaged material is FUNGIBLE, so three queued orders reserve three UNITS.
      // That count is what makes the console's "Held: N (M queued)" honest.
      { kind: "material", itemId: HOUSING },
      { kind: "material", itemId: HOUSING },
      { kind: "material", itemId: HOUSING }
    );
    const reserved = salvageReservations(state);
    expect(reserved.instanceIds.size).toBe(1);
    expect(reserved.shipIds.size).toBe(1);
    expect(reserved.materialCounts.get(HOUSING)).toBe(3);
  });

  it("reserves NOTHING for a queued craft line (design section 5.3: a queued order reserves nothing)", () => {
    const state: GameState = {
      ...freshState(),
      processQueue: queuedJobs(
        { facility: "refinery", order: { type: "craftLine", kind: "refine", recipeKey: "refineCommonOre", mode: { kind: "batch", remaining: 5 } } },
        { facility: "fabricator", order: { type: "craftLine", kind: "fabricate", recipeKey: "frameSegmentBp", mode: { kind: "continuous" } } }
      ),
    };
    const reserved = salvageReservations(state);
    expect(reserved.instanceIds.size).toBe(0);
    expect(reserved.shipIds.size).toBe(0);
    expect(reserved.materialCounts.size).toBe(0);
  });

  it("treats a save with no processQueue at all as an empty queue, never a throw", () => {
    // The `?? []` every other processQueue reader uses. The cast is the point of the
    // case: an older fixture (or a save built before SAVE_VERSION 40) can legitimately
    // arrive without the field, and a reservation read must not be the thing that dies.
    const legacy = { ...freshState(), processQueue: undefined as unknown as QueuedJob[] };
    expect(salvageReservations(legacy).instanceIds.size).toBe(0);
    expect(salvageReservedMaterialCount(legacy, HOUSING)).toBe(0);
  });

  it("hands each accessor the same answer the single pass gives", () => {
    const state = stateWithSalvageQueue(
      { kind: "equipment", instanceId: "eq-7" },
      { kind: "ship", shipId: "ship-4" },
      { kind: "material", itemId: HOUSING },
      { kind: "material", itemId: HOUSING }
    );
    expect([...salvageReservedInstanceIds(state)]).toEqual(["eq-7"]);
    expect([...salvageReservedShipIds(state)]).toEqual(["ship-4"]);
    expect(salvageReservedMaterialCount(state, HOUSING)).toBe(2);
    // An item nobody queued reads 0, not undefined, so a UI can subtract it blind.
    expect(salvageReservedMaterialCount(state, "titaniumIngot")).toBe(0);
  });

  it("allocates fresh containers per call (no shared mutable state between reads)", () => {
    const state = stateWithSalvageQueue({ kind: "equipment", instanceId: "eq-7" });
    const first = salvageReservations(state);
    first.instanceIds.add("eq-tampered");
    // A second read is unaffected: nothing is cached and nothing is handed out twice.
    expect(salvageReservations(state).instanceIds.has("eq-tampered")).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// The IN-FLIGHT arm (Unit 2.2). Same derivation, second source.
// ----------------------------------------------------------------------------
// The queued arm above proves the reservation reads the QUEUE. These prove it reads
// RUNNING JOBS too, and, more importantly, that the two sources agree: a target must be
// equally protected before and after promotion, because promotion is exactly the moment
// a naive single-source implementation would drop the reservation for one tick.
describe("salvageReservations: in-flight salvageJobs reserve identically to queued orders (0.13.3 Unit 2.2)", () => {
  it("bins all three target arms off a running job's salvageResolve effect", () => {
    const state = stateWithSalvageInFlight(
      { kind: "equipment", instanceId: "eq-7" },
      { kind: "ship", shipId: "ship-4" },
      { kind: "material", itemId: HOUSING }
    );
    const reserved = salvageReservations(state);
    expect([...reserved.instanceIds]).toEqual(["eq-7"]);
    expect([...reserved.shipIds]).toEqual(["ship-4"]);
    expect(reserved.materialCounts.get(HOUSING)).toBe(1);
  });

  it("produces the EXACT same reservation whether a target is queued or in flight", () => {
    // The core promise. If these two ever diverge, the promotion handoff has a hole.
    const targets: SalvageTargetRef[] = [
      { kind: "equipment", instanceId: "eq-7" },
      { kind: "ship", shipId: "ship-4" },
      { kind: "material", itemId: HOUSING },
    ];
    const queued = salvageReservations(stateWithSalvageQueue(...targets));
    const inFlight = salvageReservations(stateWithSalvageInFlight(...targets));
    expect([...inFlight.instanceIds]).toEqual([...queued.instanceIds]);
    expect([...inFlight.shipIds]).toEqual([...queued.shipIds]);
    expect([...inFlight.materialCounts]).toEqual([...queued.materialCounts]);
  });

  it("DEDUPES a unique target that is both queued and in flight", () => {
    // The overlap window itself: an order that has just been promoted can legitimately
    // still be visible in one list while already present in the other (or a save can be
    // hand-edited into that shape). A hull is one hull and a piece is one piece however
    // many rows point at it, so the unique bins count it ONCE.
    const state: GameState = {
      ...stateWithSalvageQueue(
        { kind: "equipment", instanceId: "eq-7" },
        { kind: "ship", shipId: "ship-4" }
      ),
      activeProcesses: salvageJobs(
        { kind: "equipment", instanceId: "eq-7" },
        { kind: "ship", shipId: "ship-4" }
      ),
    };
    const reserved = salvageReservations(state);
    expect(reserved.instanceIds.size).toBe(1);
    expect(reserved.shipIds.size).toBe(1);
    expect(salvageReservedInstanceIds(state).has("eq-7")).toBe(true);
    expect(salvageReservedShipIds(state).has("ship-4")).toBe(true);
  });

  it("ACCUMULATES a fungible material across the two sources, because units are not identities", () => {
    // The deliberate asymmetry with the case above. One unit being torn down right now
    // plus two more units queued really is THREE units spoken for; collapsing them would
    // make "Held: N (M queued)" under-report and let the player over-commit their stock.
    const state: GameState = {
      ...stateWithSalvageQueue(
        { kind: "material", itemId: HOUSING },
        { kind: "material", itemId: HOUSING }
      ),
      activeProcesses: salvageJobs({ kind: "material", itemId: HOUSING }),
    };
    expect(salvageReservedMaterialCount(state, HOUSING)).toBe(3);
  });

  it("reserves NOTHING for a running process that is not a salvage", () => {
    // The narrowing has to be on the EFFECT, not on "there is a process". Every other
    // in-flight job in the game (a refine, an upgrade, a repair) must pass through this
    // loop untouched, or the reservation would start blocking unrelated actions.
    const state: GameState = {
      ...freshState(),
      activeProcesses: [
        { id: "proc-1", kind: "refineJob", remainingTicks: 3, durationTicks: 3, effect: { type: "addItem", itemId: "titaniumIngot", amount: new Decimal(1) } },
        { id: "proc-2", kind: "shipRepair", remainingTicks: 9, durationTicks: 9, effect: { type: "clearShipDamage", shipId: "ship-4" } },
        { id: "proc-3", kind: "facilityUpgrade", remainingTicks: 2, durationTicks: 2, effect: { type: "facilityLevelUp", facility: "refinery" } },
      ],
    };
    const reserved = salvageReservations(state);
    expect(reserved.instanceIds.size).toBe(0);
    // A repair names a shipId too. It must NOT land in the hull bin, or repairing a ship
    // would make it look like it was queued for teardown.
    expect(reserved.shipIds.size).toBe(0);
    expect(reserved.materialCounts.size).toBe(0);
  });

  it("treats a save with no activeProcesses at all as nothing in flight, never a throw", () => {
    // Same defensive posture the processQueue arm has. A hand-built fixture can arrive
    // without the field and a reservation read must not be the thing that dies.
    const legacy = { ...freshState(), activeProcesses: undefined as unknown as TimedProcess[] };
    expect(salvageReservations(legacy).instanceIds.size).toBe(0);
    expect(salvageReservedMaterialCount(legacy, HOUSING)).toBe(0);
  });

  it("refuses a duplicate order against an IN-FLIGHT unique target, not just a queued one", () => {
    // A piece being torn down right now is the last thing that should accept a second
    // order: the second could only ever resolve as a stale no-op holding a depth slot.
    const state = stateWithSalvageInFlight(
      { kind: "equipment", instanceId: "eq-7" },
      { kind: "ship", shipId: "ship-4" }
    );
    expect(isDuplicateSalvageTarget(state, { kind: "equipment", instanceId: "eq-7" })).toBe(true);
    expect(isDuplicateSalvageTarget(state, { kind: "ship", shipId: "ship-4" })).toBe(true);
    // Untouched targets still clear, and a fungible material still never blocks.
    expect(isDuplicateSalvageTarget(state, { kind: "equipment", instanceId: "eq-8" })).toBe(false);
    expect(isDuplicateSalvageTarget(state, { kind: "material", itemId: HOUSING })).toBe(false);
  });
});

// ============================================================================
// SALVAGE DURATION (Crafting 0.13.3, Phase 2 Unit 2.2)
// (design section 7.2.)
//
// How long a promoted salvage takes. Pure arithmetic over numbers the caller already
// holds, so it is pinned here on its own, one unit before anything can create a job.
//
// ⚠️ THESE CASES ASSERT THE SHAPE, NOT THE BALANCE. Every constant is a first-pass
// tunable, so each expectation is DERIVED from the exported constants rather than
// hard-coding a tick count. Retuning a coefficient should move the game, not break the
// suite; changing the FORMULA should break it.
// ============================================================================
// ============================================================================
// THE BEHAVIOUR-NEUTRALITY PIN (Crafting 0.13.3 salvage-duration SEAM)
// ============================================================================
// ⚠️ THE ONE BLOCK IN THIS FILE THAT HARD-CODES TICK COUNTS, AND IT DOES SO ON PURPOSE.
// Every other duration case above derives its expectation from the exported constants, so
// that retuning a coefficient retunes the suite with it. That is right for balance, and
// exactly WRONG for this block, whose entire job is to notice a change nobody intended.
//
// WHY IT IS LOAD-BEARING: the salvage-duration factor model was widened (the material arm
// gained tier / rarity / consumed-bucket quality, every arm gained a shared ceiling) with
// EVERY new factor set to its identity value, so that the shape could land with proof of
// no behavior change and the balance pass that follows is a pure numbers edit. Durations
// size TimedProcesses, so they sit on the live-versus-offline parity path: a duration that
// silently moved would desynchronize the two paths for anyone mid-salvage across a reload.
// These literals are the proof that nothing moved.
//
// IF A LITERAL HERE FAILS: that is either the intended balance pass (update the numbers
// deliberately, in the same commit as the constant that moved) or an accidental behavior
// change smuggled in behind a "shape only" edit. It is never noise.
describe("salvageDurationTicks: TODAY'S durations are pinned, arm by arm, as literals", () => {
  it("equipment: pinned across an iLevel / quality spread", () => {
    // 60 base + 0.5/iLevel + 2/quality, rounded up. The rarity and blueprint-tier
    // multipliers the arm gained are BOTH 1.0, so these literals are unchanged from
    // before the widening; that is precisely the claim being pinned.
    const cases: Array<[number, number, number]> = [
      // iLevel, quality, expected ticks
      [0, 0, 60],   // the bare floor
      [1, 0, 61],   // an ODD iLevel: the .5 rounds UP, never truncates
      [10, 1, 67],  // 60 + 5 + 2
      [20, 5, 80],  // the current per-tier iLevel cap with a top-quality roll
      [30, 2, 79],  // 60 + 15 + 4
      [37, 3, 85],  // 60 + 18.5 + 6 = 84.5, rounded up
      [5000, 5, 2570], // the "set iLevel" future the salvage notes describe: still bounded
    ];
    for (const [iLevel, quality, expected] of cases) {
      // Held at the ladder's floor band + T1 so this case is exactly the old formula.
      expect(
        salvageDurationTicks({ kind: "equipment", iLevel, quality, rarity: "derelict", tier: 1 })
      ).toBe(expected);
    }
  });

  it("equipment: the SAME literals hold for EVERY rarity band and EVERY blueprint tier", () => {
    // ⚠️ THE LOAD-BEARING HALF OF THE EQUIPMENT PIN. The case above proves the formula
    // did not move at one point on the two new categorical axes; this proves the axes
    // themselves are still inert, which is the whole claim of a behaviour-neutral
    // widening. Swept over the REAL EquipmentRarity ladder and the REAL BLUEPRINTS table
    // rather than a sample, so a band or a blueprint tier added later cannot slip past.
    const rarities: EquipmentRarity[] = [
      "derelict", "standard", "augmented", "stellar", "radiant", "luminous", "constellar",
    ];
    // Every tier the blueprint table actually contains, plus the two unresolvable
    // readings a call site can hand over (a Standard-Issue baseline and a retired key
    // both arrive as 0), so the neutral-floor clamp is pinned alongside the real data.
    const tiers = [0, ...new Set(Object.values(BLUEPRINTS).map((bp) => bp.tier))];
    // iLevel, quality, the duration that must not move.
    const cases: Array<[number, number, number]> = [
      [0, 0, 60],
      [10, 1, 67],
      [20, 5, 80],
      [37, 3, 85],
    ];
    for (const rarity of rarities) {
      for (const tier of tiers) {
        for (const [iLevel, quality, expected] of cases) {
          const ticks = salvageDurationTicks({ kind: "equipment", iLevel, quality, rarity, tier });
          // rarity/tier in the message so a failure names the axis that moved.
          expect(`${rarity}/T${tier}/iL${iLevel}/q${quality}=${ticks}`).toBe(
            `${rarity}/T${tier}/iL${iLevel}/q${quality}=${expected}`
          );
        }
      }
    }
  });

  it("material: still exactly 60 for EVERY item in the registry, at EVERY quality rung", () => {
    // The precise claim the widening had to preserve: a common ore roll and a rare
    // Damaged Reactor Housing still cost the identical 60 ticks today. Swept over the
    // REAL ITEMS table rather than a sample, so an item added with a new rarity or a
    // higher tier cannot slip past this pin.
    for (const [itemId, def] of Object.entries(ITEMS)) {
      for (let quality = 0; quality < 6; quality++) {
        const ticks = salvageDurationTicks({
          kind: "material",
          tier: def.tier,
          rarity: def.rarity,
          quality,
        });
        // itemId in the message so a failure names the item that moved.
        expect(`${itemId}@q${quality}=${ticks}`).toBe(`${itemId}@q${quality}=60`);
      }
    }
  });

  it("ship: pinned across every hull's real build time, plus the fallbacks", () => {
    // ceil(buildDurationTicks / 3), with anything unusable falling back to the 60 floor.
    const cases: Array<[number, number]> = [
      [300, 100],   // scout-class hull
      [450, 150],
      [550, 184],   // 183.33, rounded UP
      [600, 200],
      [700, 234],   // 233.33, rounded UP
      [1150, 384],  // 383.33, rounded UP
      [1200, 400],  // the longest teardown the game can currently produce
      [1, 1],       // never rounds down to 0, which would complete on its own start tick
      [4, 2],
      [0, 60],      // fallbacks: an unknown hull still takes a moment
      [-10, 60],
      [NaN, 60],
    ];
    for (const [build, expected] of cases) {
      expect(salvageDurationTicks({ kind: "ship", buildDurationTicks: build })).toBe(expected);
    }
  });

  it("every real hull's teardown is pinned through SHIP_TYPES itself, not a copied number", () => {
    // Belt and braces on the arm the parity gate cares most about: reads the live table,
    // so a hull whose build time is retuned shows up here as a duration change rather
    // than sliding through on a stale literal.
    for (const [typeKey, def] of Object.entries(SHIP_TYPES)) {
      const ticks = salvageDurationTicks({
        kind: "ship",
        buildDurationTicks: def.buildRecipe.durationTicks,
      });
      expect(`${typeKey}=${ticks}`).toBe(
        `${typeKey}=${Math.ceil(def.buildRecipe.durationTicks / 3)}`
      );
      // Non-vacuous, and comfortably inside the safety ceiling.
      expect(ticks).toBeGreaterThan(1);
      expect(ticks).toBeLessThan(SALVAGE_MAX_TICKS);
    }
  });
});

describe("salvageDurationTicks: deterministic whole-tick durations for every target kind", () => {
  it("returns a positive INTEGER for every arm", () => {
    // Load-bearing, not cosmetic: remainingTicks is decremented in whole ticks, so a
    // fractional duration would never land exactly on 0 and a 0 duration would complete
    // on its own start tick. Either one is a Salvage Bay slot that misbehaves.
    const durations = [
      salvageDurationTicks({ kind: "equipment", iLevel: 37, quality: 3, rarity: "stellar", tier: 2 }),
      salvageDurationTicks({ kind: "material", tier: 1, rarity: "rare", quality: 2 }),
      salvageDurationTicks({ kind: "ship", buildDurationTicks: 400 }),
    ];
    for (const d of durations) {
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBeGreaterThan(0);
    }
  });

  it("is a pure function: the same spec always yields the same answer", () => {
    // No rng, no state, no clock. This is what lets the live path and the offline path
    // size the identical job.
    const spec = {
      kind: "equipment" as const,
      iLevel: 22,
      quality: 4,
      rarity: "radiant" as const,
      tier: 2,
    };
    expect(salvageDurationTicks(spec)).toBe(salvageDurationTicks(spec));
    expect(salvageDurationTicks(spec)).toBe(salvageDurationTicks({ ...spec }));
  });

  it("equipment: the numeric span, scaled by the piece's own factors, ALL NEUTRAL today", () => {
    // The equipment half of the seam, asserted at its identity point. The arm now carries
    // the piece's rarity band and its blueprint's tier on top of the two numeric axes,
    // but both multipliers are 1.0, so the answer is still exactly the old span. Derived
    // from the constants on purpose: retuning one SHOULD move this, and that is the
    // signal the balance pass has actually landed.
    const iLevel = 30;
    const quality = 2;
    const span =
      SALVAGE_BASE_TICKS + iLevel * SALVAGE_TICKS_PER_ILEVEL + quality * SALVAGE_TICKS_PER_QUALITY;
    const tierMult = 1 + (2 - 1) * SALVAGE_EQUIPMENT_TIER_MULTIPLIER_PER_TIER;
    expect(
      salvageDurationTicks({ kind: "equipment", iLevel, quality, rarity: "stellar", tier: 2 })
    ).toBe(Math.ceil(span * SALVAGE_EQUIPMENT_RARITY_MULTIPLIER.stellar * tierMult));
  });

  it("equipment: every rarity multiplier is a usable positive number, and the map is total", () => {
    // The stuck-bay guard at the DATA level, the equipment twin of the material table's
    // case below. An undefined or non-positive entry would multiply a duration to NaN or
    // 0, so this asserts the table itself stays sane through any future retune, not just
    // today's all-1.0 values.
    const rarities: EquipmentRarity[] = [
      "derelict", "standard", "augmented", "stellar", "radiant", "luminous", "constellar",
    ];
    for (const rarity of rarities) {
      const mult = SALVAGE_EQUIPMENT_RARITY_MULTIPLIER[rarity];
      expect(Number.isFinite(mult)).toBe(true);
      expect(mult).toBeGreaterThan(0);
    }
    // Total map: no extra keys either, so the table and the union cannot drift apart.
    expect(Object.keys(SALVAGE_EQUIPMENT_RARITY_MULTIPLIER).sort()).toEqual([...rarities].sort());
  });

  it("the two rarity tables are over DIFFERENT unions and are deliberately not merged", () => {
    // ⚠️ THE REASON THERE ARE TWO TABLES. EquipmentRarity (gear bands) and ItemRarity
    // (warehouse item bands) are separate content ladders that happen to share the word
    // "rarity": different lengths, and as of this patch ZERO members in common. Asserting
    // the disjointness here means that if someone later renames a band into a collision,
    // this test says so out loud rather than the two ladders quietly looking mergeable.
    // Either way the TYPES stay separate, so adding a band to one union is a compile error
    // in that union's own table and cannot mistune the other ladder.
    const equipmentKeys = Object.keys(SALVAGE_EQUIPMENT_RARITY_MULTIPLIER);
    const materialKeys = Object.keys(SALVAGE_MATERIAL_RARITY_MULTIPLIER);
    expect(equipmentKeys.filter((k) => materialKeys.includes(k))).toEqual([]);
  });

  it("equipment: a bare Q0 iLevel-0 piece costs exactly the floor", () => {
    expect(
      salvageDurationTicks({ kind: "equipment", iLevel: 0, quality: 0, rarity: "standard", tier: 1 })
    ).toBe(SALVAGE_BASE_TICKS);
  });

  it("equipment: duration rises with BOTH iLevel and quality, never falls", () => {
    // The monotonicity is the design intent (a better piece takes longer to break down).
    // Asserted as a relation so it survives any retune of the coefficients. Rarity and
    // tier are held FIXED so this stays a statement about the two numeric axes alone.
    const at = (iLevel: number, quality: number) =>
      salvageDurationTicks({ kind: "equipment", iLevel, quality, rarity: "standard", tier: 1 });
    const base = at(10, 1);
    expect(at(40, 1)).toBeGreaterThan(base);
    expect(at(10, 5)).toBeGreaterThan(base);
  });

  it("equipment: a fractional iLevel term is rounded UP, never truncated", () => {
    // iLevel contributes a half tick per point on purpose, so an ODD iLevel produces a
    // .5 that must round up. Truncating instead would let a duration drift below the
    // curve and, at the extreme, toward 0.
    const odd = salvageDurationTicks({
      kind: "equipment", iLevel: 1, quality: 0, rarity: "standard", tier: 1,
    });
    expect(odd).toBe(Math.ceil(SALVAGE_BASE_TICKS + SALVAGE_TICKS_PER_ILEVEL));
    expect(odd).toBeGreaterThan(SALVAGE_BASE_TICKS);
  });

  it("equipment: survives a garbage tier, rarity, iLevel or quality with the base duration", () => {
    // Same hazard as the material arm's garbage case: a hand-edited save, a piece minted
    // before iLevel existed, or a Standard-Issue baseline whose blueprint does not exist
    // at all reaches here, and a NaN duration is a bay occupied forever.
    const garbage = [
      salvageDurationTicks({
        kind: "equipment", iLevel: NaN, quality: NaN, rarity: "standard", tier: NaN,
      }),
      salvageDurationTicks({
        kind: "equipment", iLevel: -50, quality: -3, rarity: "standard", tier: -4,
      }),
      // The exact shape a STANDARD-ISSUE BASELINE produces at the call site: no blueprint
      // at all, so the tier reads 0 and must clamp to the neutral T1.
      salvageDurationTicks({
        kind: "equipment", iLevel: 0, quality: 0, rarity: "standard", tier: 0,
      }),
      salvageDurationTicks({
        kind: "equipment",
        iLevel: undefined as unknown as number,
        quality: undefined as unknown as number,
        rarity: undefined as unknown as EquipmentRarity,
        tier: undefined as unknown as number,
      }),
      // A rarity string outside the union, which a hand-edited save or a retired band can
      // present. It would index the multiplier table to undefined if left unguarded.
      salvageDurationTicks({
        kind: "equipment",
        iLevel: 0,
        quality: 0,
        rarity: "mythic" as unknown as EquipmentRarity,
        tier: 1,
      }),
    ];
    for (const d of garbage) {
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBe(SALVAGE_BASE_TICKS);
    }
  });

  it("material: the base, scaled by the item's own factors, which are ALL NEUTRAL today", () => {
    // The seam, asserted at its identity point. The arm now carries tier / rarity /
    // consumed-bucket quality, but every weight is 0 and every multiplier is 1.0, so the
    // answer is still exactly the base. Derived from the constants on purpose: retuning
    // one SHOULD move this, and that is the signal the balance pass has actually landed.
    const span = SALVAGE_MATERIAL_TICKS + 3 * SALVAGE_MATERIAL_TICKS_PER_QUALITY;
    const tierMult = 1 + (2 - 1) * SALVAGE_MATERIAL_TIER_MULTIPLIER_PER_TIER;
    expect(salvageDurationTicks({ kind: "material", tier: 2, rarity: "epic", quality: 3 })).toBe(
      Math.ceil(span * SALVAGE_MATERIAL_RARITY_MULTIPLIER.epic * tierMult)
    );
  });

  it("material: every rarity multiplier is a usable positive number, and the map is total", () => {
    // The stuck-bay guard at the DATA level. An undefined or non-positive entry would
    // multiply a duration to NaN or 0, so this asserts the table itself stays sane
    // through any future retune, not just today's all-1.0 values.
    const rarities: ItemRarity[] = ["common", "uncommon", "rare", "epic", "legendary"];
    for (const rarity of rarities) {
      const mult = SALVAGE_MATERIAL_RARITY_MULTIPLIER[rarity];
      expect(Number.isFinite(mult)).toBe(true);
      expect(mult).toBeGreaterThan(0);
    }
    // Total map: no extra keys either, so the table and the union cannot drift apart.
    expect(Object.keys(SALVAGE_MATERIAL_RARITY_MULTIPLIER).sort()).toEqual([...rarities].sort());
  });

  it("material: survives a garbage tier, rarity or quality with the base duration", () => {
    // Same hazard as the equipment arm's garbage case: a hand-edited save or an id with
    // no ITEMS entry reaches here, and a NaN duration is a bay occupied forever.
    const garbage = [
      salvageDurationTicks({ kind: "material", tier: NaN, rarity: "common", quality: NaN }),
      salvageDurationTicks({ kind: "material", tier: -4, rarity: "common", quality: -9 }),
      salvageDurationTicks({ kind: "material", tier: 0, rarity: "common", quality: 0 }),
      salvageDurationTicks({
        kind: "material",
        tier: undefined as unknown as number,
        rarity: undefined as unknown as ItemRarity,
        quality: undefined as unknown as number,
      }),
      // The specific shape a legacy / removed item produces: a rarity string outside the
      // union, which would index the multiplier table to undefined if left unguarded.
      salvageDurationTicks({
        kind: "material",
        tier: 1,
        rarity: "mythic" as unknown as ItemRarity,
        quality: 0,
      }),
    ];
    for (const d of garbage) {
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBe(SALVAGE_MATERIAL_TICKS);
    }
  });

  it("no arm can ever exceed the SALVAGE_MAX_TICKS ceiling", () => {
    // The safety rail against a future retune minting a bay locked for days. Driven
    // through the one input that can reach absurd magnitudes today (a hull build time),
    // which proves the clamp is really wired into the arms rather than merely exported.
    expect(salvageDurationTicks({ kind: "ship", buildDurationTicks: 1e9 })).toBe(SALVAGE_MAX_TICKS);
    expect(
      salvageDurationTicks({ kind: "equipment", iLevel: 1e9, quality: 5, rarity: "radiant", tier: 2 })
    ).toBe(SALVAGE_MAX_TICKS);
    // And it sits far above everything real, so it cannot be binding on live durations.
    expect(SALVAGE_MAX_TICKS).toBeGreaterThan(salvageDurationTicks({ kind: "ship", buildDurationTicks: 1200 }) * 10);
  });

  it("ship: a share of the hull's own build time, so a bigger hull takes longer", () => {
    const build = 600;
    expect(salvageDurationTicks({ kind: "ship", buildDurationTicks: build })).toBe(
      Math.ceil(build / SALVAGE_SHIP_BUILD_DIVISOR)
    );
    // Derived from the build, so the relation holds across hull types with no second table.
    expect(salvageDurationTicks({ kind: "ship", buildDurationTicks: 1200 })).toBeGreaterThan(
      salvageDurationTicks({ kind: "ship", buildDurationTicks: 600 })
    );
  });

  it("ship: a build duration that is not divisible rounds UP rather than down", () => {
    expect(salvageDurationTicks({ kind: "ship", buildDurationTicks: SALVAGE_SHIP_BUILD_DIVISOR + 1 })).toBe(2);
  });

  it("survives garbage inputs with the base duration instead of NaN or 0", () => {
    // The stuck-countdown hazard. A NaN or 0 duration is a slot occupied forever with no
    // player action that can clear it, so every nonsense input clamps to something sane.
    const garbage = [
      salvageDurationTicks({
        kind: "equipment", iLevel: NaN, quality: NaN, rarity: "standard", tier: 1,
      }),
      salvageDurationTicks({
        kind: "equipment", iLevel: -50, quality: -3, rarity: "standard", tier: 1,
      }),
      salvageDurationTicks({
        kind: "equipment",
        iLevel: undefined as unknown as number,
        quality: undefined as unknown as number,
        rarity: "standard",
        tier: 1,
      }),
      salvageDurationTicks({ kind: "ship", buildDurationTicks: NaN }),
      salvageDurationTicks({ kind: "ship", buildDurationTicks: 0 }),
      salvageDurationTicks({ kind: "ship", buildDurationTicks: -10 }),
    ];
    for (const d of garbage) {
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBe(SALVAGE_BASE_TICKS);
    }
  });

  it("carries NO Decimal anywhere in a salvageResolve effect, so save hydration needs no branch", () => {
    // The same verification Unit 1.1 did for the queue schema. hydrateDecimals (save.ts)
    // revives an effect only when it has an "amount" key; a Decimal smuggled onto this
    // effect would therefore load back as a bare string and throw on first arithmetic.
    // Asserting the shape here is cheaper than discovering it after a save round-trip.
    const [job] = salvageJobs({ kind: "equipment", instanceId: "eq-7" });
    expect("amount" in job.effect).toBe(false);
    const roundTripped = JSON.parse(JSON.stringify(job)) as TimedProcess;
    expect(roundTripped).toEqual(job);
  });
});

describe("isDuplicateSalvageTarget: unique targets refuse a second order, fungible ones do not", () => {
  it("reports a queued equipment instance and a queued hull as duplicates", () => {
    const state = stateWithSalvageQueue(
      { kind: "equipment", instanceId: "eq-7" },
      { kind: "ship", shipId: "ship-4" }
    );
    expect(isDuplicateSalvageTarget(state, { kind: "equipment", instanceId: "eq-7" })).toBe(true);
    expect(isDuplicateSalvageTarget(state, { kind: "ship", shipId: "ship-4" })).toBe(true);
  });

  it("clears an unqueued target of either unique kind", () => {
    const state = stateWithSalvageQueue({ kind: "equipment", instanceId: "eq-7" });
    expect(isDuplicateSalvageTarget(state, { kind: "equipment", instanceId: "eq-8" })).toBe(false);
    expect(isDuplicateSalvageTarget(state, { kind: "ship", shipId: "ship-4" })).toBe(false);
  });

  it("NEVER calls a salvaged material a duplicate, however many are queued", () => {
    // Deliberate: queueing more salvages than you hold is the "queue work you cannot
    // afford yet" case the queue exists for, and it is bounded at PROMOTION (noneHeld),
    // never at enqueue. Blocking it here would be an affordability gate in disguise.
    const state = stateWithSalvageQueue(
      { kind: "material", itemId: HOUSING },
      { kind: "material", itemId: HOUSING }
    );
    expect(isDuplicateSalvageTarget(state, { kind: "material", itemId: HOUSING })).toBe(false);
  });
});

// ============================================================================
// TIMED SALVAGE: resolution inside the tick, on the seeded stream
// (Crafting 0.13.3, Phase 2 Unit 2.3; design sections 7.3 + 7.4)
// ============================================================================
// A salvageJob's completion is the ONE place salvage consumes its target and grants its
// reward, and it is the first salvage that ever happens inside the offline-catch-up seam.
// Two separate things therefore need proving, and they are proved separately below:
//
//   CORRECTNESS  each of the three target arms resolves through the process path to
//                EXACTLY what the live instant path produces from the same draws, because
//                both call the same unchanged function (the reward math is untouched by
//                this unit, Omega 15a). Plus: a stale target is a fail-safe no-op, and a
//                completing job releases its reservation.
//   DETERMINISM  a salvage completing inside one long offline span produces a byte-
//                identical result to the same span stepped one tick at a time. That is
//                the whole reason the rng had to move onto resolveProcesses' threaded
//                stream, and it is the last suite in this file.
// ============================================================================

// One in-flight salvageJob with a CHOSEN countdown, so a fixture can stagger several
// completions across a span (the shared salvageJobs helper above fixes every job at 5
// ticks, which is right for the reservation tests and useless for ordering ones).
// remainingTicks === durationTicks: a job that has not been advanced yet.
function salvageJobAt(target: SalvageTargetRef, ticks: number, id = "proc-1"): TimedProcess {
  return {
    id,
    kind: "salvageJob",
    remainingTicks: ticks,
    durationTicks: ticks,
    effect: { type: "salvageResolve", target },
  };
}

// A strict scripted rng: returns `values` in order and THROWS on overrun. The throw is a
// deliberate tripwire, not a convenience: these tests assert the DRAW COUNT of each arm
// (1 / 2 / 1, the counts salvage.ts's header calls load-bearing), and a silent undefined
// would read as 0 and mask exactly the divergence being tested for.
function strictRng(values: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= values.length) {
      throw new Error(`scripted rng overrun: asked for draw ${i + 1} of only ${values.length}`);
    }
    return values[i++];
  };
}

// Forwards to `inner` and counts the draws taken, so a test can assert that two chunkings
// consumed the SAME number of values from the stream (a draw-count divergence is how a
// stream desynchronizes even when a single completion looks correct).
function countingRng(inner: () => number): { rng: () => number; draws: () => number } {
  let n = 0;
  return {
    rng: () => {
      n += 1;
      return inner();
    },
    draws: () => n,
  };
}

// The state every timed-salvage test starts from. Deliberately rich enough that all three
// arms have a real target and that a wrong answer is visible:
//   sp-1   a spare CRAFTED system (quality 3), the equipment arm's target
//   cr-2   a CRAFTED system installed on ship-2, must come BACK as a spare on teardown
//   bl-2   a Standard-Issue baseline installed on ship-2, must be DISCARDED on teardown
//   ship-2 an idle second hull, the ship arm's target (the last-hull guard needs two)
//   3x the Damaged Reactor Housing, the material arm's target, with two left over
// Fleet Admiral level is the top of the ladder so the loot roll has SEVERAL eligible
// tiers: at level 1 only one tier is reachable and the tier draw would be degenerate,
// which would quietly weaken every determinism assertion built on it.
// freshState's own ship-1 baselines stay in the pool as untouched bystanders.
function timedSalvageState(): GameState {
  const base = freshState();
  const spare = makePiece({ slotType: "cargoBay", fitted: false, crafted: true, quality: 3, id: "sp-1" });
  const onShipCrafted: EquipmentInstance = {
    ...makePiece({ slotType: "cargoBay", fitted: true, crafted: true, quality: 1, id: "cr-2" }),
    fittedToShipId: "ship-2",
  };
  const onShipBaseline: EquipmentInstance = {
    ...makePiece({ slotType: "ftlDrive", fitted: true, crafted: false, quality: 0, id: "bl-2" }),
    fittedToShipId: "ship-2",
  };
  return {
    ...base,
    fleetAdminLevel: MAX_CEILING_LEVEL,
    ships: [...base.ships, { id: "ship-2", typeKey: "generalFreighter", assignedCaptainId: null }],
    equipment: [...base.equipment, spare, onShipCrafted, onShipBaseline],
    inventory: { ...base.inventory, [HOUSING]: [new Decimal(3)] },
  };
}

// Everything a salvage can touch, flattened into one plain comparable object. This is what
// the parity assertions deep-compare, and it covers every accumulator the salvageResolve
// branch writes plus the bookkeeping around it:
//   inventory   PER QUALITY BUCKET, not just totals. The bucket split is what a divergent
//               stream corrupts first (a loot roll deposits at its TIER'S quality), so
//               comparing totals alone would miss the exact failure this suite exists for.
//   equipment   consumed spares, systems returned from a torn-down hull, ids intact
//   ships       the hull the teardown removed
//   credits     the teardown's credit refund (Decimal to string: exact, no float compare)
//   processes   completed jobs dropped, survivors kept in order with their countdowns
//   ids         nextEquipmentId / nextShipId, so no minting drifted between the paths
function salvageFingerprint(state: GameState) {
  const inventory: Record<string, string[]> = {};
  for (const itemId of Object.keys(state.inventory).sort()) {
    inventory[itemId] = (state.inventory[itemId] ?? []).map((d) => d.toString());
  }
  return {
    inventory,
    equipment: state.equipment,
    ships: state.ships,
    credits: state.credits.toString(),
    activeProcesses: state.activeProcesses,
    processQueue: state.processQueue,
    nextEquipmentId: state.nextEquipmentId,
    nextShipId: state.nextShipId,
  };
}

describe("salvageResolve: each target arm resolves through the process path (0.13.3 Unit 2.3)", () => {
  it("the EQUIPMENT arm recycles the spare exactly as the live instant path does, off the passed rng", () => {
    const state = timedSalvageState();
    const jobState: GameState = {
      ...state,
      activeProcesses: [salvageJobAt({ kind: "equipment", instanceId: "sp-1" }, 1)],
    };

    // The SAME single scripted draw down both paths. If the resolver reimplemented the
    // reward math (or drew a different number of times), these two would not agree.
    const viaTick = resolveProcesses(jobState, 1, strictRng([0.5])).next;
    const viaLive = salvageEquipment(state, "sp-1", strictRng([0.5]));
    if (!viaLive.ok) throw new Error("expected the live salvage to succeed");

    expect(salvageFingerprint(viaTick).inventory).toEqual(salvageFingerprint(viaLive.next).inventory);
    expect(viaTick.equipment).toEqual(viaLive.next.equipment);
    // NON-VACUOUS: the spare is really gone and real scrap really landed.
    expect(viaTick.equipment.find((e) => e.id === "sp-1")).toBeUndefined();
    expect(Object.keys(SALVAGE_BP_INPUTS).some((id) => itemTotal(viaTick.inventory, id).gt(0))).toBe(true);
    // The job resolved exactly once and was dropped.
    expect(viaTick.activeProcesses).toEqual([]);
  });

  it("the MATERIAL arm rolls the loot pool exactly as the live instant path does, on TWO draws", () => {
    const state = timedSalvageState();
    const jobState: GameState = {
      ...state,
      activeProcesses: [salvageJobAt({ kind: "material", itemId: HOUSING }, 1)],
    };

    // Exactly two scripted values: the tier draw then the item draw. strictRng throws on a
    // third, so this also pins the documented draw COUNT of this arm.
    const viaTick = resolveProcesses(jobState, 1, strictRng([0.2, 0.7])).next;
    const viaLive = salvageSalvagedMaterial(state, HOUSING, strictRng([0.2, 0.7]));
    if (!viaLive.ok) throw new Error("expected the live salvage to succeed");

    expect(salvageFingerprint(viaTick).inventory).toEqual(salvageFingerprint(viaLive.next).inventory);
    // NON-VACUOUS: one Housing consumed (3 to 2) and the rolled drop deposited at its
    // tier's QUALITY bucket, the bucket-level detail a totals-only check would miss.
    expect(itemTotal(viaTick.inventory, HOUSING).toString()).toBe("2");
    const rolled = viaLive.rolled;
    if (rolled === undefined) throw new Error("expected the live roll to report its drop");
    expect(getBucket(viaTick.inventory, rolled.itemId, rolled.quality).toNumber()).toBe(1);
    expect(viaTick.activeProcesses).toEqual([]);
  });

  it("the SHIP arm tears the hull down exactly as the live instant path does, returning crafted systems and credits", () => {
    const state = timedSalvageState();
    const jobState: GameState = {
      ...state,
      activeProcesses: [salvageJobAt({ kind: "ship", shipId: "ship-2" }, 1)],
    };

    const viaTick = resolveProcesses(jobState, 1, strictRng([0.5])).next;
    const viaLive = salvageShip(state, "ship-2", strictRng([0.5]));
    if (!viaLive.ok) throw new Error("expected the live salvage to succeed");

    expect(salvageFingerprint(viaTick).inventory).toEqual(salvageFingerprint(viaLive.next).inventory);
    expect(viaTick.equipment).toEqual(viaLive.next.equipment);
    expect(viaTick.ships).toEqual(viaLive.next.ships);
    expect(viaTick.credits.toString()).toBe(viaLive.next.credits.toString());
    // NON-VACUOUS, and specifically the three hull-teardown rules: the hull is gone, its
    // CRAFTED system came back as a spare, its BASELINE was discarded, credits were paid.
    expect(viaTick.ships.find((s) => s.id === "ship-2")).toBeUndefined();
    expect(viaTick.equipment.find((e) => e.id === "cr-2")?.fittedToShipId).toBeNull();
    expect(viaTick.equipment.find((e) => e.id === "bl-2")).toBeUndefined();
    expect(viaTick.credits.gt(state.credits)).toBe(true);
    expect(viaTick.activeProcesses).toEqual([]);
  });

  it("resolves SEVERAL salvages completing in one call cumulatively, never discarding an earlier one", () => {
    // The accumulator hazard, asserted directly. Each salvage function takes a whole state
    // and returns a whole state, so a resolver that handed each one the UNTOUCHED incoming
    // state would silently keep only the last result. Three arms complete in one call here.
    const state = timedSalvageState();
    const jobState: GameState = {
      ...state,
      activeProcesses: [
        salvageJobAt({ kind: "equipment", instanceId: "sp-1" }, 1, "proc-1"),
        salvageJobAt({ kind: "material", itemId: HOUSING }, 1, "proc-2"),
        salvageJobAt({ kind: "ship", shipId: "ship-2" }, 1, "proc-3"),
      ],
    };
    const out = resolveProcesses(jobState, 1, mulberry32(11)).next;

    // ALL THREE effects are present in the ONE returned state.
    expect(out.equipment.find((e) => e.id === "sp-1")).toBeUndefined(); // equipment arm
    expect(itemTotal(out.inventory, HOUSING).toString()).toBe("2");     // material arm
    expect(out.ships.find((s) => s.id === "ship-2")).toBeUndefined();   // ship arm
    expect(out.credits.gt(state.credits)).toBe(true);                   // the ship arm's refund
    expect(out.activeProcesses).toEqual([]);
  });
});

describe("salvageResolve: a stale target is a fail-safe no-op (0.13.3 Unit 2.3)", () => {
  // The design's rule (section 7.3) and the clearShipDamage precedent: a target that no
  // longer exists must drop its process WITHOUT throwing and WITHOUT touching state. Each
  // case below uses a counting rng to also prove the stream is untouched, because a
  // rejected salvage that still drew would desynchronize every completion after it.
  const staleCases: { label: string; target: SalvageTargetRef; prepare?: (s: GameState) => GameState }[] = [
    {
      label: "an equipment instance that no longer exists (already salvaged)",
      target: { kind: "equipment", instanceId: "ghost-1" },
    },
    {
      label: "an equipment instance that has since been INSTALLED on a ship",
      target: { kind: "equipment", instanceId: "sp-1" },
      prepare: (s) => ({
        ...s,
        equipment: s.equipment.map((e) => (e.id === "sp-1" ? { ...e, fittedToShipId: "ship-1" } : e)),
      }),
    },
    { label: "a hull that is already gone", target: { kind: "ship", shipId: "ship-gone" } },
    {
      label: "the fleet's LAST hull (the softlock guard now fires)",
      target: { kind: "ship", shipId: "ship-1" },
      prepare: (s) => ({ ...s, ships: s.ships.filter((ship) => ship.id === "ship-1") }),
    },
    {
      label: "a salvaged material the player no longer holds",
      target: { kind: "material", itemId: HOUSING },
      prepare: (s) => ({ ...s, inventory: { ...s.inventory, [HOUSING]: [new Decimal(0)] } }),
    },
    {
      label: "an item id that is not a salvaged material at all",
      target: { kind: "material", itemId: "commonOre" },
    },
  ];

  for (const testCase of staleCases) {
    it(`drops the process, changes nothing and draws nothing for ${testCase.label}`, () => {
      const base = testCase.prepare ? testCase.prepare(timedSalvageState()) : timedSalvageState();
      const jobState: GameState = { ...base, activeProcesses: [salvageJobAt(testCase.target, 1)] };

      // strictRng([]) throws on the FIRST draw: reaching for the stream at all fails here.
      const counted = countingRng(strictRng([]));
      const out = resolveProcesses(jobState, 1, counted.rng).next;

      // The process is dropped (no slot held forever by a target that can never resolve).
      expect(out.activeProcesses).toEqual([]);
      // Nothing else moved: the fingerprint matches the input state with the job removed.
      expect(salvageFingerprint(out)).toEqual(salvageFingerprint({ ...base, activeProcesses: [] }));
      // And the seeded stream is exactly where it was.
      expect(counted.draws()).toBe(0);
    });
  }

  it("never throws, even on a hand-edited save naming three impossible targets at once", () => {
    const base = timedSalvageState();
    const jobState: GameState = {
      ...base,
      activeProcesses: [
        salvageJobAt({ kind: "equipment", instanceId: "ghost-1" }, 1, "proc-1"),
        salvageJobAt({ kind: "material", itemId: "notAnItemAtAll" }, 1, "proc-2"),
        salvageJobAt({ kind: "ship", shipId: "ghost-hull" }, 1, "proc-3"),
      ],
    };
    expect(() => resolveProcesses(jobState, 1, strictRng([]))).not.toThrow();
    const out = resolveProcesses(jobState, 1, strictRng([])).next;
    expect(salvageFingerprint(out)).toEqual(salvageFingerprint({ ...base, activeProcesses: [] }));
  });
});

describe("salvageResolve: completing a job RELEASES its derived reservation (0.13.3 Unit 2.3)", () => {
  it("a target reserved while in flight is free again the moment its job resolves", () => {
    const base = timedSalvageState();
    const jobState: GameState = {
      ...base,
      activeProcesses: [
        salvageJobAt({ kind: "equipment", instanceId: "sp-1" }, 3, "proc-1"),
        salvageJobAt({ kind: "ship", shipId: "ship-2" }, 3, "proc-2"),
      ],
    };
    // BEFORE: both unique targets are spoken for, so nothing else can install or requeue them.
    expect(salvageReservedInstanceIds(jobState).has("sp-1")).toBe(true);
    expect(salvageReservedShipIds(jobState).has("ship-2")).toBe(true);

    // PART WAY: still in flight, so still reserved. The reservation is not a completion
    // side effect, it is derived from the process existing at all.
    const midway = resolveProcesses(jobState, 1, mulberry32(3)).next;
    expect(salvageReservedInstanceIds(midway).has("sp-1")).toBe(true);
    expect(salvageReservedShipIds(midway).has("ship-2")).toBe(true);

    // COMPLETE: the processes are dropped, so the derivation stops seeing them. No unwind
    // step exists or is needed, which is the whole point of deriving instead of storing.
    const done = resolveProcesses(midway, 5, mulberry32(3)).next;
    expect(done.activeProcesses).toEqual([]);
    expect(salvageReservedInstanceIds(done).size).toBe(0);
    expect(salvageReservedShipIds(done).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⚠️ THE POINT OF THE WHOLE UNIT: offline == live PARITY for timed salvage
// ---------------------------------------------------------------------------
// Salvage draws randomly, and as of this unit it draws INSIDE the economy seam. So a
// player who closes the tab for a long span and a player who watches the same span tick by
// must receive the IDENTICAL salvage results. That holds only because the salvage
// functions draw through resolveProcesses' threaded seeded rng instead of a bare
// Math.random of their own, which is exactly what these tests catch: each path runs its
// OWN fresh generator over the SAME seed, so any unseeded draw anywhere in the chain makes
// the two results differ and fails the deep compare.
//
// Chunkings compared (the two real shapes the shipped game uses):
//   OFFLINE  one tick(span) call, which internally steps economyTick(_,1) per whole tick
//   LIVE     a hand-stepped economyTick(_,1) loop, the App.svelte poll shape
describe("⚠️ offline==live parity for timed salvage (tick(span) == looping economyTick(_,1))", () => {
  // tickDurationSeconds is 1, so a span in seconds is a span in whole ticks, no remainder.
  //
  // ⚠️ DERIVED, NOT A LITERAL, AND THIS ONE MATTERS MORE THAN IT LOOKS. This was a hardcoded
  // 20, sized when a salvage took 5 ticks. Raising the base duration to 60 (2026-09-04) did
  // NOT fail this case, it made it VACUOUS: nothing completes inside 20 ticks any more, so
  // both chunkings sat on an identical un-finished job and the deep compare passed while
  // proving nothing. A parity case that silently stops exercising a completion is worse than
  // one that breaks, because nothing tells you. Sized off the real duration so it always
  // outlives the work it measures.
  const SPAN = SALVAGE_MATERIAL_TICKS * 2 + 10;
  const SEED = 909;

  // Three jobs completing at DIFFERENT ticks inside the span (4, 7 and 11), one per arm.
  // Staggered on purpose: identical countdowns would complete in one batch and could not
  // detect an ordering divergence, and the interleaving is what makes the shared stream's
  // position meaningful (the material arm's TWO draws sit between the other two arms'
  // single draws).
  function spanState(): GameState {
    const base = timedSalvageState();
    return {
      ...base,
      activeProcesses: [
        salvageJobAt({ kind: "equipment", instanceId: "sp-1" }, 4, "proc-1"),
        salvageJobAt({ kind: "material", itemId: HOUSING }, 7, "proc-2"),
        salvageJobAt({ kind: "ship", shipId: "ship-2" }, 11, "proc-3"),
      ],
    };
  }

  it("a salvage job completing inside ONE long offline span lands byte-identically to the span stepped one tick at a time", () => {
    const jumped = tick(SPAN, spanState(), mulberry32(SEED));
    let stepped = spanState();
    const liveRng = mulberry32(SEED);
    for (let i = 0; i < SPAN; i++) stepped = economyTick(stepped, 1, liveRng);

    // THE PARITY ASSERTION: everything a salvage can touch, deep-equal, including the
    // per-QUALITY-BUCKET inventory split (a loot roll deposits at its tier's quality, so
    // the buckets are where a divergent stream shows up first), the equipment pool, the
    // fleet, the credit balance, the surviving processes and the id counters.
    expect(salvageFingerprint(jumped)).toEqual(salvageFingerprint(stepped));

    // NON-VACUITY: all three salvages really did resolve inside the span. Without this the
    // assertion above could pass by comparing two untouched states.
    expect(jumped.equipment.find((e) => e.id === "sp-1")).toBeUndefined(); // equipment arm ran
    expect(itemTotal(jumped.inventory, HOUSING).toString()).toBe("2");     // material arm ran
    expect(jumped.ships.find((s) => s.id === "ship-2")).toBeUndefined();   // ship arm ran
    expect(jumped.credits.gt(0)).toBe(true);                               // the refund landed
    expect(jumped.activeProcesses).toEqual([]);                            // all three dropped
    expect(Object.keys(SALVAGE_BP_INPUTS).some((id) => itemTotal(jumped.inventory, id).gt(0))).toBe(true);
  });

  it("both chunkings consume the SAME number of draws (4: equipment 1 + material 2 + ship 1)", () => {
    // A deep-equal result could in principle be reached while consuming the stream
    // differently (two draws that happen to floor to the same amounts). Counting the draws
    // pins the stream POSITION too, which is what every completion AFTER a salvage
    // depends on. The expected total is the three arms' documented counts summed.
    const jumpedCount = countingRng(mulberry32(SEED));
    tick(SPAN, spanState(), jumpedCount.rng);

    const steppedCount = countingRng(mulberry32(SEED));
    let stepped = spanState();
    for (let i = 0; i < SPAN; i++) stepped = economyTick(stepped, 1, steppedCount.rng);

    expect(jumpedCount.draws()).toBe(steppedCount.draws());
    expect(jumpedCount.draws()).toBe(4);
  });

  it("is NOT comparing two constants: a different seed produces a different result", () => {
    // The control. Every parity test risks passing because the outcome does not depend on
    // the rng at all, in which case it proves nothing. Changing only the seed must change
    // what was recovered, which shows the compared value really is stream-driven.
    const seedA = tick(SPAN, spanState(), mulberry32(SEED));
    const seedB = tick(SPAN, spanState(), mulberry32(SEED + 1));
    expect(salvageFingerprint(seedA)).not.toEqual(salvageFingerprint(seedB));
  });

  it("parity holds when the span is chunked UNEVENLY around the completions", () => {
    // A third chunking for good measure: one 9-tick run (past completions 1 and 2) then an
    // 11-tick run (past completion 3), on ONE continuous stream. The countdown arithmetic
    // is closed-form and the draws stay in order, so this must land where the other two did.
    const rng = mulberry32(SEED);
    let split = spanState();
    for (let i = 0; i < 9; i++) split = economyTick(split, 1, rng);
    for (let i = 0; i < SPAN - 9; i++) split = economyTick(split, 1, rng);

    const jumped = tick(SPAN, spanState(), mulberry32(SEED));
    expect(salvageFingerprint(split)).toEqual(salvageFingerprint(jumped));
  });
});

// ============================================================================
// AUTO-SALVAGE RULES (Crafting 0.13.3, Phase 5 Unit 5.1)
// Design: docs/plans/2026-09-01-crafting-0.13.3-design.md section 7.6
//
// Two layers, tested separately because they fail differently:
//   selectAutoSalvageTargets  the PURE rule evaluator (salvage.ts). Every rule and every
//                             safety filter is proven here, with no tick in sight.
//   autoSalvageOrders         the TICK pass (tick.ts). The depth budget, the manual
//                             headroom, the per-tick bound and the enqueue path.
// Closed by the offline==live parity case at the very bottom, which is the one that
// matters most: the rules run inside the offline catch-up seam, so a long span away must
// queue and resolve exactly what the same span at the keyboard would have.
//
// âš ï¸ THE DEFAULT SAVE CANNOT AUTO-SALVAGE ANYTHING, and that is correct, not a bug in
// these fixtures. freshState seeds salvageConfirmQualities with EVERY quality tier (the
// player is asked about all of them until they opt a tier out), and a confirm-ON tier can
// never be auto-salvaged. So every fixture below that expects a selection must clear that
// array explicitly, which is itself the shape of the most important safety test here.
// ============================================================================

// One spare crafted piece with the fields the rules actually rank on. Built on makePiece
// (a real Standard-Issue baseline underneath, so every unrelated field is valid) with
// iLevel and rarity overridable, which makePiece does not expose.
function autoPiece(opts: {
  id: string;
  quality?: number;
  iLevel?: number;
  slotType?: EquipmentSlotType;
  blueprintKey?: string | null;
  rarity?: EquipmentInstance["rarity"];
  fittedToShipId?: string | null;
}): EquipmentInstance {
  const base = makePiece({
    slotType: opts.slotType ?? "cargoBay",
    fitted: false,
    crafted: true,
    quality: opts.quality ?? 0,
    id: opts.id,
  });
  return {
    ...base,
    iLevel: opts.iLevel ?? 10,
    rarity: opts.rarity ?? base.rarity,
    // `undefined` means "leave it crafted"; an explicit null makes it a baseline.
    blueprintKey: opts.blueprintKey === undefined ? base.blueprintKey : opts.blueprintKey,
    fittedToShipId: opts.fittedToShipId ?? null,
  };
}

// A state with the given spare pool, the rules ON as specified, and NOTHING confirm-
// protected (see the section header). freshState's own four FITTED ship-1 baselines are
// kept as deliberate bystanders: they are installed AND baselines, so any test that ends
// up selecting one has broken two safety filters at once.
function autoState(
  pieces: EquipmentInstance[],
  rules: Partial<GameState["autoSalvage"]> = {}
): GameState {
  const base = freshState();
  return {
    ...base,
    equipment: [...base.equipment, ...pieces],
    salvageConfirmQualities: [], // nothing protected, so the RULES are what is under test
    autoSalvage: { enabled: true, maxQuality: null, duplicates: false, keepPerVariety: 1, ...rules },
  };
}

// The instance ids a selection names, in the order it returned them.
function selectedIds(targets: SalvageTargetRef[]): string[] {
  return targets.map((t) => (t.kind === "equipment" ? t.instanceId : `NOT-EQUIPMENT:${t.kind}`));
}

// A generous limit for the tests that are about the RULES rather than the bound.
const NO_BOUND = 999;

describe("selectAutoSalvageTargets: the MAX-QUALITY rule (0.13.3 Unit 5.1)", () => {
  it("selects every spare at or BELOW the chosen tier and nothing above it", () => {
    const state = autoState(
      [
        autoPiece({ id: "eq-a", quality: 0 }),
        autoPiece({ id: "eq-b", quality: 1 }),
        autoPiece({ id: "eq-c", quality: 2 }),
        autoPiece({ id: "eq-d", quality: 5 }),
      ],
      { maxQuality: 1 }
    );
    // "at or below" is inclusive on purpose: maxQuality 1 takes Q0 AND Q1.
    expect(selectedIds(selectAutoSalvageTargets(state, NO_BOUND))).toEqual(["eq-a", "eq-b"]);
  });

  it("maxQuality 0 is a REAL setting and is not confused with the rule being off", () => {
    // null means "rule off"; 0 means "Q0 and below". A truthiness check on maxQuality
    // would collapse the two and silently disable the most useful setting there is.
    const pieces = [autoPiece({ id: "eq-a", quality: 0 }), autoPiece({ id: "eq-b", quality: 1 })];
    expect(selectedIds(selectAutoSalvageTargets(autoState(pieces, { maxQuality: 0 }), NO_BOUND))).toEqual(["eq-a"]);
    expect(selectAutoSalvageTargets(autoState(pieces, { maxQuality: null }), NO_BOUND)).toEqual([]);
  });

  it("takes the ONLY copy of a variety when its tier qualifies (the rule is about worth, not about duplicates)", () => {
    const state = autoState([autoPiece({ id: "eq-only", quality: 0 })], { maxQuality: 0 });
    expect(selectedIds(selectAutoSalvageTargets(state, NO_BOUND))).toEqual(["eq-only"]);
  });
});

describe("selectAutoSalvageTargets: the DUPLICATES rule keeps the BEST (0.13.3 Unit 5.1)", () => {
  it("keeps the highest iLevel of a blueprint+slot group and queues the rest", () => {
    const state = autoState(
      [
        autoPiece({ id: "eq-a", iLevel: 10 }),
        autoPiece({ id: "eq-b", iLevel: 40 }), // the keeper
        autoPiece({ id: "eq-c", iLevel: 25 }),
      ],
      { duplicates: true }
    );
    expect(selectedIds(selectAutoSalvageTargets(state, NO_BOUND))).toEqual(["eq-a", "eq-c"]);
  });

  it("breaks an iLevel tie on QUALITY, then on RARITY, in that order", () => {
    const byQuality = autoState(
      [
        autoPiece({ id: "eq-a", iLevel: 20, quality: 1 }),
        autoPiece({ id: "eq-b", iLevel: 20, quality: 4 }), // same iLevel, better quality -> keeper
      ],
      { duplicates: true }
    );
    expect(selectedIds(selectAutoSalvageTargets(byQuality, NO_BOUND))).toEqual(["eq-a"]);

    const byRarity = autoState(
      [
        autoPiece({ id: "eq-a", iLevel: 20, quality: 2, rarity: "standard" }),
        autoPiece({ id: "eq-b", iLevel: 20, quality: 2, rarity: "radiant" }), // rarity breaks it
      ],
      { duplicates: true }
    );
    expect(selectedIds(selectAutoSalvageTargets(byRarity, NO_BOUND))).toEqual(["eq-a"]);
  });

  it("groups by blueprint AND slot: different blueprints and different slots are not duplicates", () => {
    const state = autoState(
      [
        autoPiece({ id: "eq-a", slotType: "cargoBay", blueprintKey: "bp-one" }),
        autoPiece({ id: "eq-b", slotType: "cargoBay", blueprintKey: "bp-two" }),
        autoPiece({ id: "eq-c", slotType: "ftlDrive", blueprintKey: "bp-one" }),
      ],
      { duplicates: true }
    );
    // Three groups of one. Nothing is a duplicate of anything, so nothing is selected.
    expect(selectAutoSalvageTargets(state, NO_BOUND)).toEqual([]);
  });

  it("an INSTALLED piece does not count toward its variety's keep quota", () => {
    // A player with one installed Capacitor Bank and one spare must NOT lose the spare.
    // Counting installed gear toward the quota would make the rule far more aggressive
    // than the panel's plain-language summary promises.
    const state = autoState(
      [
        autoPiece({ id: "eq-installed", fittedToShipId: "ship-1", iLevel: 50 }),
        autoPiece({ id: "eq-spare", iLevel: 10 }),
      ],
      { duplicates: true }
    );
    expect(selectAutoSalvageTargets(state, NO_BOUND)).toEqual([]);
  });

  it("keepPerVariety is read from the rules, not hardcoded (a future panel can raise it)", () => {
    const pieces = [
      autoPiece({ id: "eq-a", iLevel: 10 }),
      autoPiece({ id: "eq-b", iLevel: 20 }),
      autoPiece({ id: "eq-c", iLevel: 30 }),
    ];
    expect(
      selectedIds(selectAutoSalvageTargets(autoState(pieces, { duplicates: true, keepPerVariety: 2 }), NO_BOUND))
    ).toEqual(["eq-a"]); // keeps eq-c and eq-b, the two best
  });

  it("UNIONS with the max-quality rule rather than double-counting a piece both rules point at", () => {
    const state = autoState(
      [
        autoPiece({ id: "eq-a", iLevel: 10, quality: 0 }), // both rules want this one
        autoPiece({ id: "eq-b", iLevel: 40, quality: 3 }), // the duplicates keeper
      ],
      { duplicates: true, maxQuality: 0 }
    );
    expect(selectedIds(selectAutoSalvageTargets(state, NO_BOUND))).toEqual(["eq-a"]);
  });
});

describe("âš ï¸ selectAutoSalvageTargets: the HARD SAFETY FILTERS (0.13.3 Unit 5.1)", () => {
  it("âš ï¸ NEVER selects a quality tier whose CONFIRM flag is ON, even when both rules point at it", () => {
    // THE MOST IMPORTANT CASE IN THIS FILE. The player asked to be ASKED about that tier;
    // an automation rule must not answer the question for them. This is the guard that
    // prevents the "it silently ate my Q4 drop" outcome, and it is the whole reason the
    // preference was migrated out of localStorage and into the save (the offline resolver
    // can read the save and nothing else).
    const base = autoState(
      [
        autoPiece({ id: "eq-protected", quality: 4, iLevel: 10 }),
        autoPiece({ id: "eq-open", quality: 2, iLevel: 10 }),
        autoPiece({ id: "eq-keeper", quality: 2, iLevel: 90 }),
      ],
      { duplicates: true, maxQuality: 5 } // both rules select as widely as possible
    );

    // Control: with nothing protected, all three are taken (maxQuality 5 covers them all).
    expect([...selectedIds(selectAutoSalvageTargets(base, NO_BOUND))].sort()).toEqual([
      "eq-keeper",
      "eq-open",
      "eq-protected",
    ]);

    // Protect Q4 only. eq-protected survives; the unprotected tiers are unaffected.
    const guarded: GameState = { ...base, salvageConfirmQualities: [4] };
    const picked = selectedIds(selectAutoSalvageTargets(guarded, NO_BOUND));
    expect(picked).not.toContain("eq-protected");
    expect([...picked].sort()).toEqual(["eq-keeper", "eq-open"]);
  });

  it("âš ï¸ the DEFAULT save protects every tier, so enabling the rules alone destroys nothing", () => {
    // freshState seeds salvageConfirmQualities with every tier. A player who flips the
    // master switch without opting a tier out must lose exactly nothing.
    const state: GameState = {
      ...autoState([autoPiece({ id: "eq-a", quality: 0 }), autoPiece({ id: "eq-b", quality: 0 })], {
        duplicates: true,
        maxQuality: 5,
      }),
      salvageConfirmQualities: freshState().salvageConfirmQualities,
    };
    expect(selectAutoSalvageTargets(state, NO_BOUND)).toEqual([]);
  });

  it("âš ï¸ a MISSING confirm preference fails SAFE (protect everything), never open", () => {
    // A hand-edited save or a partial fixture must not be read as "nothing is protected".
    // Salvage is irreversible, so the undefined case has to err toward keeping items.
    const broken = {
      ...autoState([autoPiece({ id: "eq-a", quality: 0 })], { maxQuality: 5 }),
      salvageConfirmQualities: undefined,
    } as unknown as GameState;
    expect(selectAutoSalvageTargets(broken, NO_BOUND)).toEqual([]);
  });

  it("NEVER selects a Standard-Issue baseline (a baseline DESTROYS for zero reward)", () => {
    const state = autoState(
      [
        autoPiece({ id: "eq-baseline", blueprintKey: null, quality: 0 }), // standard rarity + no blueprint
        autoPiece({ id: "eq-crafted", quality: 0 }),
      ],
      { duplicates: true, maxQuality: 5 }
    );
    expect(selectedIds(selectAutoSalvageTargets(state, NO_BOUND))).toEqual(["eq-crafted"]);
  });

  it("NEVER selects INSTALLED gear, whatever the rules say", () => {
    const state = autoState(
      [
        autoPiece({ id: "eq-fitted", fittedToShipId: "ship-1", quality: 0 }),
        autoPiece({ id: "eq-spare", quality: 0 }),
      ],
      { maxQuality: 5 }
    );
    // Exactly one selection: the spare. freshState's own four fitted ship-1 baselines are
    // bystanders and must be untouched too, which the length assertion covers.
    expect(selectedIds(selectAutoSalvageTargets(state, NO_BOUND))).toEqual(["eq-spare"]);
  });

  it("NEVER selects a target a QUEUED salvage order already owns", () => {
    const base = autoState([autoPiece({ id: "eq-a", quality: 0 }), autoPiece({ id: "eq-b", quality: 0 })], {
      maxQuality: 5,
    });
    const queuedJob: QueuedJob = {
      id: "q-1",
      facility: "salvageBay",
      order: { type: "salvage", target: { kind: "equipment", instanceId: "eq-a" }, mode: { kind: "batch", remaining: 1 } },
    };
    const state: GameState = { ...base, processQueue: [queuedJob] };
    expect(selectedIds(selectAutoSalvageTargets(state, NO_BOUND))).toEqual(["eq-b"]);
  });

  it("NEVER selects a target an IN-FLIGHT salvage job already owns", () => {
    const base = autoState([autoPiece({ id: "eq-a", quality: 0 }), autoPiece({ id: "eq-b", quality: 0 })], {
      maxQuality: 5,
    });
    const state: GameState = {
      ...base,
      activeProcesses: [salvageJobAt({ kind: "equipment", instanceId: "eq-a" }, 3)],
    };
    expect(selectedIds(selectAutoSalvageTargets(state, NO_BOUND))).toEqual(["eq-b"]);
  });

  it("a RESERVED piece does not hold the duplicates keeper slot (so the last free copy survives)", () => {
    // eq-best is already queued for salvage, so it is on its way OUT of the pool. If it
    // were allowed to be the group's keeper, the rule would queue the last remaining free
    // copy and the player would end up with NEITHER.
    const base = autoState(
      [autoPiece({ id: "eq-best", iLevel: 90 }), autoPiece({ id: "eq-rest", iLevel: 10 })],
      { duplicates: true }
    );
    const state: GameState = {
      ...base,
      processQueue: [
        {
          id: "q-1",
          facility: "salvageBay",
          order: { type: "salvage", target: { kind: "equipment", instanceId: "eq-best" }, mode: { kind: "batch", remaining: 1 } },
        },
      ],
    };
    expect(selectAutoSalvageTargets(state, NO_BOUND)).toEqual([]);
  });

  it("never selects a SHIP or a SALVAGED MATERIAL: the rules are scoped to spare systems", () => {
    const base = autoState([autoPiece({ id: "eq-a", quality: 0 })], { duplicates: true, maxQuality: 5 });
    const state: GameState = {
      ...base,
      fleetAdminLevel: MAX_CEILING_LEVEL,
      ships: [...base.ships, { id: "ship-2", typeKey: "generalFreighter", assignedCaptainId: null }],
      inventory: { ...base.inventory, [HOUSING]: [new Decimal(5)] },
    };
    expect(selectAutoSalvageTargets(state, NO_BOUND).every((t) => t.kind === "equipment")).toBe(true);
  });
});

describe("selectAutoSalvageTargets: DISABLED rules do nothing (0.13.3 Unit 5.1)", () => {
  const pieces = [autoPiece({ id: "eq-a", quality: 0 }), autoPiece({ id: "eq-b", quality: 0 })];

  it("the master switch off selects nothing, however the individual rules are set", () => {
    const state = autoState(pieces, { enabled: false, duplicates: true, maxQuality: 5 });
    expect(selectAutoSalvageTargets(state, NO_BOUND)).toEqual([]);
  });

  it("enabled but with BOTH rules off selects nothing", () => {
    expect(selectAutoSalvageTargets(autoState(pieces, { maxQuality: null, duplicates: false }), NO_BOUND)).toEqual([]);
  });

  it("a zero or negative limit selects nothing (the caller has no room)", () => {
    const state = autoState(pieces, { maxQuality: 5 });
    expect(selectAutoSalvageTargets(state, 0)).toEqual([]);
    expect(selectAutoSalvageTargets(state, -3)).toEqual([]);
  });
});

describe("selectAutoSalvageTargets: DETERMINISTIC order and the per-call BOUND (0.13.3 Unit 5.1)", () => {
  it("returns candidates in a stable id order that does NOT depend on the equipment array's order", () => {
    // The parity argument in one test: the same pool stored in a different sequence must
    // produce the same answer, because the selector sorts before it selects.
    const pieces = [
      autoPiece({ id: "eq-1", quality: 0 }),
      autoPiece({ id: "eq-2", quality: 0 }),
      autoPiece({ id: "eq-3", quality: 0 }),
      autoPiece({ id: "eq-4", quality: 0 }),
    ];
    const forward = autoState(pieces, { maxQuality: 5 });
    const reversed = autoState([...pieces].reverse(), { maxQuality: 5 });
    expect(selectedIds(selectAutoSalvageTargets(forward, NO_BOUND))).toEqual(["eq-1", "eq-2", "eq-3", "eq-4"]);
    expect(selectedIds(selectAutoSalvageTargets(reversed, NO_BOUND))).toEqual(
      selectedIds(selectAutoSalvageTargets(forward, NO_BOUND))
    );
  });

  it("truncates to `limit` from the SAME end every time, so a bound cannot make it nondeterministic", () => {
    const pieces = Array.from({ length: 50 }, (_, i) =>
      autoPiece({ id: `eq-${String(i).padStart(3, "0")}`, quality: 0 })
    );
    const state = autoState(pieces, { maxQuality: 5 });
    expect(selectedIds(selectAutoSalvageTargets(state, 3))).toEqual(["eq-000", "eq-001", "eq-002"]);
    // Same call, same answer. Idempotent because nothing here is stateful.
    expect(selectedIds(selectAutoSalvageTargets(state, 3))).toEqual(["eq-000", "eq-001", "eq-002"]);
  });

  it("is PURE: it does not mutate the state it is handed", () => {
    const state = autoState([autoPiece({ id: "eq-b" }), autoPiece({ id: "eq-a" })], { maxQuality: 5 });
    const before = state.equipment.map((e) => e.id);
    selectAutoSalvageTargets(state, NO_BOUND);
    expect(state.equipment.map((e) => e.id)).toEqual(before); // the sort took a copy
  });
});

describe("autoSalvageOrders: the TICK pass, its BUDGET and its DEPTH interaction (0.13.3 Unit 5.1)", () => {
  // A pool big enough that an unbounded pass would enqueue dozens.
  function bigPoolState(
    rules: Partial<GameState["autoSalvage"]> = {},
    talents: HomeworldTalentKey[] = []
  ): GameState {
    const pieces = Array.from({ length: 40 }, (_, i) =>
      autoPiece({ id: `eq-${String(i).padStart(3, "0")}`, quality: 0 })
    );
    const base = autoState(pieces, { maxQuality: 5, ...rules });
    return { ...base, unlockedHomeworldTalents: [...base.unlockedHomeworldTalents, ...talents] };
  }

  it("is a same-REFERENCE no-op when the rules are off, so an untouched save is unperturbed", () => {
    const state = bigPoolState({ enabled: false });
    expect(autoSalvageOrders(state)).toBe(state);
  });

  it("âš ï¸ BOUNDED PER TICK: a 40-piece pool does not enqueue everything at once", () => {
    // At base depth 1 the pass may add exactly one order per tick. The pool size is
    // irrelevant to how much work one tick does, which is the Omega 14 property.
    const state = bigPoolState();
    expect(queueDepth(state)).toBe(1);
    const after = autoSalvageOrders(state);
    expect(after.processQueue.length).toBe(1);
    // And a second pass on the RESULT adds nothing, because the queue is now full.
    expect(autoSalvageOrders(after).processQueue.length).toBe(1);
  });

  it("âš ï¸ leaves the player ONE depth slot so auto-salvage cannot starve manual queueing", () => {
    // Depth 3 (base 1 + two talent rungs): the rules take 2 and leave 1 for the player.
    const state = bigPoolState({}, ["fleetLogisticsQueue1", "fleetLogisticsQueue2"]);
    expect(queueDepth(state)).toBe(3);
    const after = autoSalvageOrders(state);
    expect(after.processQueue.length).toBe(3 - AUTO_SALVAGE_MANUAL_HEADROOM);
    // The player's own order still fits, which is the point of the headroom.
    const manual = enqueueOrder(after, "salvageBay", {
      type: "salvage",
      target: { kind: "equipment", instanceId: "eq-039" },
      mode: { kind: "batch", remaining: 1 },
    });
    expect(manual.queued).toBe(true);
    expect(manual.next.processQueue.length).toBe(3);
  });

  it("stops at the depth cap and NEVER evicts or reorders a manual order", () => {
    const state = bigPoolState({}, ["fleetLogisticsQueue1", "fleetLogisticsQueue2"]);
    // The player has queued two of their own, which already fill the auto budget.
    const manual: QueuedJob[] = [
      {
        id: "q-90",
        facility: "salvageBay",
        order: { type: "salvage", target: { kind: "equipment", instanceId: "eq-030" }, mode: { kind: "batch", remaining: 1 } },
      },
      {
        id: "q-91",
        facility: "salvageBay",
        order: { type: "salvage", target: { kind: "equipment", instanceId: "eq-031" }, mode: { kind: "batch", remaining: 1 } },
      },
    ];
    const withManual: GameState = { ...state, processQueue: manual };
    const after = autoSalvageOrders(withManual);
    // budget = 3 - 1 headroom = 2, already held by the player -> nothing added, same ref.
    expect(after).toBe(withManual);
    expect(after.processQueue.map((j) => j.id)).toEqual(["q-90", "q-91"]);
  });

  it("enqueues through enqueueOrder, so a target already queued is refused rather than duplicated", () => {
    const state = bigPoolState({}, ["fleetLogisticsQueue1", "fleetLogisticsQueue2"]);
    const after = autoSalvageOrders(state);
    const ids = after.processQueue.map((j) =>
      j.order.type === "salvage" && j.order.target.kind === "equipment" ? j.order.target.instanceId : "?"
    );
    expect(new Set(ids).size).toBe(ids.length); // no target queued twice
    // The minted ids come from nextQueueId through the normal path.
    expect(after.nextQueueId).toBe(state.nextQueueId + after.processQueue.length);
  });

  it("âš ï¸ THE ESCAPE VALVE SURVIVES: a spare pool OVER the equipment cap still auto-salvages", () => {
    // Salvage is the always-available relief for a full pool (0.11.1's softlock fix). If
    // auto-salvage consulted equipmentStorageCap it would switch itself off at exactly the
    // moment it is most needed. Anyone adding a cap check re-opens a shipped softlock.
    const state = bigPoolState();
    expect(spareEquipmentCount(state)).toBeGreaterThan(equipmentStorageCap(state));
    expect(equipmentAtCap(state)).toBe(true);
    expect(autoSalvageOrders(state).processQueue.length).toBe(1);
  });

  it("an order the rules add is PROMOTED the same tick, not one tick later", () => {
    // The rules run at the head of promoteQueuedOrders, before the promotion scan, so a
    // piece the player never touched starts salvaging on the very tick the rule fires.
    const state = bigPoolState();
    const after = promoteQueuedOrders(state);
    expect(after.activeProcesses.filter((p) => p.kind === "salvageJob").length).toBe(1);
    expect(after.processQueue.length).toBe(0); // the added order was consumed by the promotion
  });
});

// ---------------------------------------------------------------------------
// âš ï¸ OFFLINE == LIVE PARITY FOR THE AUTO-SALVAGE RULES
// ---------------------------------------------------------------------------
// The rules are evaluated INSIDE the tick, which means inside the offline catch-up seam.
// A player who closes the tab for a long span and a player who watches every tick of it
// must end up with the IDENTICAL queue, the identical spare pool and the identical
// recovered materials. That holds only because the evaluation is a pure function of the
// SAVE (no clock, no localStorage, no rng, no unordered iteration), which is exactly what
// this compares: two independent runs over the same seed, one jumped, one stepped.
describe("âš ï¸ offline==live parity for AUTO-SALVAGE rules (0.13.3 Unit 5.1)", () => {
  // Long enough for several rule firings AND several job completions, which is the whole
  // point of this case: rules fire, jobs complete, freed slots let more rules fire.
  //
  // ⚠️ DERIVED, NOT A LITERAL. This was a hardcoded 60, sized when a salvage took 5 ticks so
  // the span covered a dozen completions. Raising the base duration to 60 (2026-09-04) cut it
  // to barely ONE completion and the case failed, correctly: it was no longer testing the
  // interleaving it describes. Sized off the real duration so future tuning cannot quietly
  // hollow it out.
  const SPAN = SALVAGE_BASE_TICKS * 4 + 20;
  const SEED = 4242;

  // Rules ON, nothing confirm-protected, a deep queue (all three talent rungs) and a pool
  // of twelve spares of ONE variety, so both rules have plenty to chew on across the span.
  function autoParityState(): GameState {
    const pieces = Array.from({ length: 12 }, (_, i) =>
      autoPiece({ id: `eq-${String(i).padStart(3, "0")}`, quality: i % 3, iLevel: 10 + i })
    );
    const base = autoState(pieces, { maxQuality: 1, duplicates: true });
    return {
      ...base,
      unlockedHomeworldTalents: [
        ...base.unlockedHomeworldTalents,
        "fleetLogisticsQueue1",
        "fleetLogisticsQueue2",
        "fleetLogisticsQueue3",
      ],
    };
  }

  it("parity: a long offline span with auto-salvage ON lands byte-identically to the span stepped one tick at a time", () => {
    const jumped = tick(SPAN, autoParityState(), mulberry32(SEED));
    let stepped = autoParityState();
    const liveRng = mulberry32(SEED);
    for (let i = 0; i < SPAN; i++) stepped = economyTick(stepped, 1, liveRng);

    // Everything the rules plus their resolutions can touch: the pool, the queue, the
    // in-flight jobs and the per-quality-bucket inventory the recoveries landed in.
    expect(salvageFingerprint(jumped)).toEqual(salvageFingerprint(stepped));
    // The queue-id counter too, so no order was minted on one path and not the other.
    expect(jumped.nextQueueId).toBe(stepped.nextQueueId);

    // NON-VACUITY: the rules really fired and really resolved during the span. Without
    // this the deep-equal above could pass by comparing two untouched states.
    expect(jumped.nextQueueId).toBeGreaterThan(autoParityState().nextQueueId);
    expect(jumped.equipment.length).toBeLessThan(autoParityState().equipment.length);
    expect(Object.keys(SALVAGE_BP_INPUTS).some((id) => itemTotal(jumped.inventory, id).gt(0))).toBe(true);
  });

  it("parity holds when the span is chunked UNEVENLY across rule firings", () => {
    const rng = mulberry32(SEED);
    let split = autoParityState();
    for (let i = 0; i < 17; i++) split = economyTick(split, 1, rng);
    for (let i = 0; i < SPAN - 17; i++) split = economyTick(split, 1, rng);
    expect(salvageFingerprint(split)).toEqual(salvageFingerprint(tick(SPAN, autoParityState(), mulberry32(SEED))));
  });

  it("parity is not vacuous: the SAME span with the rules OFF leaves the pool untouched", () => {
    // The control. If the fixture were not actually driving auto-salvage, the run above
    // would be comparing two idle states and would prove nothing.
    const base = autoParityState();
    const off: GameState = { ...base, autoSalvage: { ...base.autoSalvage, enabled: false } };
    const after = tick(SPAN, off, mulberry32(SEED));
    expect(after.equipment.length).toBe(off.equipment.length);
    expect(after.processQueue).toEqual([]);
  });
});

// ============================================================================
// BATCH SALVAGE (0.13.3 batch-salvage follow-up, 2026-09-04)
// A queued salvage order for a FUNGIBLE material carries a batch count, exactly as a
// queued craft order does. Design section 8.7's New list asked for a "batch select to
// queue"; section 5.1's "for salvage the unit is genuinely one target" holds for the two
// UNIQUE arms and not for this one.
//
// FOUR LAYERS, TESTED SEPARATELY BECAUSE THEY FAIL DIFFERENTLY:
//   salvageOrderUnits         the single interpretation of the count, including its clamps
//   salvageReservations       the count scaling the DERIVED reservation
//   canEnqueueOrder           the bound: never queue more units than are free
//   promoteQueuedOrders       one unit per job, the residual, and the parity resting on it
// Closed by the offline==live parity block at the very bottom, which is the one that
// matters most: a batch drains inside the tick, so a long span away must resolve exactly
// what the same span at the keyboard would, draw for draw.
// ============================================================================

// A queued salvage order for `units` of the Damaged Reactor Housing. Written out rather than
// reusing an existing helper because the COUNT is the whole subject here and it should be
// visible at every call site.
function housingBatch(units: number, id = "q-1"): QueuedJob {
  return {
    id,
    facility: "salvageBay",
    order: {
      type: "salvage",
      target: { kind: "material", itemId: HOUSING },
      mode: { kind: "batch", remaining: units },
    },
  };
}

// A state holding `held` housings with `queue` parked at the bay. FA level is the top of the
// ladder for the same reason timedSalvageState uses it: several loot tiers are then reachable,
// so the tier draw is not degenerate and every determinism assertion built on it means
// something.
function batchState(held: number, queue: QueuedJob[] = []): GameState {
  const base = freshState();
  return {
    ...base,
    fleetAdminLevel: MAX_CEILING_LEVEL,
    inventory: { ...base.inventory, [HOUSING]: [new Decimal(held)] },
    processQueue: queue,
  };
}

describe("salvageOrderUnits: ONE interpretation of a queued salvage order's count", () => {
  it("reads a material batch's count, and reads a single-unit order as 1", () => {
    expect(salvageOrderUnits(housingBatch(7).order as QueuedSalvageOrder)).toBe(7);
    expect(salvageOrderUnits(housingBatch(1).order as QueuedSalvageOrder)).toBe(1);
  });

  it("clamps the two UNIQUE arms to 1 however the field is set", () => {
    // A count against one equipment instance or one hull is a category error, not a
    // quantity: the first unit consumes the object and the rest could only resolve as
    // stale no-ops. Clamping here is what makes a hand-edited save harmless.
    const eq: QueuedSalvageOrder = {
      type: "salvage",
      target: { kind: "equipment", instanceId: "eq-1" },
      mode: { kind: "batch", remaining: 99 },
    };
    const ship: QueuedSalvageOrder = {
      type: "salvage",
      target: { kind: "ship", shipId: "ship-2" },
      mode: { kind: "batch", remaining: 99 },
    };
    expect(salvageOrderUnits(eq)).toBe(1);
    expect(salvageOrderUnits(ship)).toBe(1);
  });

  it("normalizes a malformed count DOWNWARD, never upward", () => {
    // Every bad shape a form field or a hand-edited save can present. All of them read as
    // ONE, which is the pre-batch behavior: a normalization here can only ever under-claim.
    const bad = (remaining: unknown): QueuedSalvageOrder => ({
      type: "salvage",
      target: { kind: "material", itemId: HOUSING },
      mode: { kind: "batch", remaining } as never,
    });
    expect(salvageOrderUnits(bad(0))).toBe(1);
    expect(salvageOrderUnits(bad(-5))).toBe(1);
    expect(salvageOrderUnits(bad(NaN))).toBe(1);
    expect(salvageOrderUnits(bad(undefined))).toBe(1);
    // A fraction FLOORS: 2.9 units is two units, never three.
    expect(salvageOrderUnits(bad(2.9))).toBe(2);
  });

  it("survives an order carrying no mode at all (a hand-edited or pre-migration entry)", () => {
    const legacy = {
      type: "salvage",
      target: { kind: "material", itemId: HOUSING },
    } as unknown as QueuedSalvageOrder;
    expect(salvageOrderUnits(legacy)).toBe(1);
  });
});

describe("salvageReservations: a BATCH reserves every one of its units", () => {
  it("reserves N units for a batch of N, not one", () => {
    const state = batchState(10, [housingBatch(4)]);
    expect(salvageReservedMaterialCount(state, HOUSING)).toBe(4);
  });

  it("sums two batches, and sums a batch beside a single-unit order", () => {
    const state = batchState(10, [housingBatch(4, "q-1"), housingBatch(3, "q-2"), housingBatch(1, "q-3")]);
    expect(salvageReservedMaterialCount(state, HOUSING)).toBe(8);
  });

  it("counts the IN-FLIGHT unit beside the residual, so the total never dips at the handoff", () => {
    // The moment a batch promotes is the moment a naive implementation loses a unit: the
    // entry shrinks by one and the job has to make up the difference. Both halves are read
    // by the SAME derivation, so this is the property that keeps `free = held - queued`
    // honest for the whole life of a batch.
    const before = batchState(5, [housingBatch(3)]);
    expect(salvageReservedMaterialCount(before, HOUSING)).toBe(3);
    const after = promoteQueuedOrders(before);
    expect(after.activeProcesses).toHaveLength(1);
    expect(after.processQueue).toHaveLength(1);
    expect(salvageReservedMaterialCount(after, HOUSING)).toBe(3);
  });

  it("a batch of 1 reserves exactly what a pre-batch order reserved", () => {
    // The regression guard on every existing single-target case: the new field must not have
    // changed the old number.
    expect(salvageReservedMaterialCount(batchState(5, [housingBatch(1)]), HOUSING)).toBe(1);
  });
});

describe("canEnqueueOrder: a salvage batch can never claim more units than are FREE", () => {
  // The full talent chain, so a queueFull refusal can never be what these cases are actually
  // observing.
  const CHAIN: HomeworldTalentKey[] = ["fleetLogisticsQueue1", "fleetLogisticsQueue2", "fleetLogisticsQueue3"];
  function deepState(held: number, queue: QueuedJob[] = []): GameState {
    return { ...batchState(held, queue), unlockedHomeworldTalents: CHAIN };
  }
  const batchOrder = (units: number): QueuedOrder => housingBatch(units).order;

  it("accepts a batch exactly the size of the free stock", () => {
    const state = deepState(500);
    expect(canEnqueueOrder(state, "salvageBay", batchOrder(500))).toEqual({ ok: true });
    expect(enqueueOrder(state, "salvageBay", batchOrder(500)).queued).toBe(true);
  });

  it("refuses one unit more than is held, with notEnoughHeld", () => {
    const state = deepState(500);
    expect(canEnqueueOrder(state, "salvageBay", batchOrder(501))).toEqual({
      ok: false,
      reason: "notEnoughHeld",
    });
    const rejected = enqueueOrder(state, "salvageBay", batchOrder(501));
    expect(rejected.queued).toBe(false);
    expect(rejected.reason).toBe("notEnoughHeld");
    // A refusal is a same-ref no-op and does NOT consume an id (enqueueOrder's contract).
    expect(rejected.next).toBe(state);
    expect(rejected.next.nextQueueId).toBe(state.nextQueueId);
  });

  it("counts what is ALREADY queued, so two batches cannot both claim the same units", () => {
    // This is the case a raw held-vs-requested check would get wrong, and it is the one that
    // matters: the second order is asked about what is LEFT, not about the stock.
    const state = enqueueOrder(deepState(500), "salvageBay", batchOrder(300)).next;
    expect(salvageReservedMaterialCount(state, HOUSING)).toBe(300);
    expect(enqueueOrder(state, "salvageBay", batchOrder(201)).reason).toBe("notEnoughHeld");
    expect(enqueueOrder(state, "salvageBay", batchOrder(200)).queued).toBe(true);
  });

  it("counts the IN-FLIGHT unit too, so a promoted batch does not free a phantom unit", () => {
    const queued = enqueueOrder(deepState(3), "salvageBay", batchOrder(3)).next;
    const running = promoteQueuedOrders(queued);
    expect(running.activeProcesses).toHaveLength(1); // one unit is in the bay
    // 2 waiting + 1 in flight = 3 spoken for, so there is no room for a fourth.
    expect(enqueueOrder(running, "salvageBay", batchOrder(1)).reason).toBe("notEnoughHeld");
  });

  it("holding NOTHING refuses even a single unit, and holding one still accepts one", () => {
    expect(enqueueOrder(deepState(0), "salvageBay", batchOrder(1)).reason).toBe("notEnoughHeld");
    expect(enqueueOrder(deepState(1), "salvageBay", batchOrder(1)).queued).toBe(true);
  });

  it("leaves the two UNIQUE arms completely alone: the quantity gate is fungible-only", () => {
    // A spare piece is queueable with no held-count question at all, and the predicate says
    // so directly. The quantity rule must never leak into the arm the duplicate rule owns.
    const spare = makePiece({ slotType: "cargoBay", fitted: false, crafted: true, quality: 2, id: "sp-9" });
    const base = deepState(0);
    const state: GameState = { ...base, equipment: [...base.equipment, spare] };
    const order: QueuedOrder = {
      type: "salvage",
      target: { kind: "equipment", instanceId: "sp-9" },
      mode: { kind: "batch", remaining: 1 },
    };
    expect(exceedsFreeSalvageUnits(state, order as QueuedSalvageOrder)).toBe(false);
    expect(enqueueOrder(state, "salvageBay", order).queued).toBe(true);
  });
});

describe("removeQueuedOrder: removing a BATCH releases every unit still waiting", () => {
  it("releases all of it at once, and the units are queueable again immediately", () => {
    const start: GameState = { ...batchState(500), unlockedHomeworldTalents: ["fleetLogisticsQueue1"] };
    const queued = enqueueOrder(start, "salvageBay", housingBatch(500).order).next;
    expect(salvageReservedMaterialCount(queued, HOUSING)).toBe(500);

    const cleared = removeQueuedOrder(queued, queued.processQueue[0].id);
    expect(cleared.processQueue).toEqual([]);
    // Derived, not stored: dropping the entry IS the release, with no unwind step.
    expect(salvageReservedMaterialCount(cleared, HOUSING)).toBe(0);
    // And the freed units are immediately claimable again, which is what "released" has to
    // mean to be worth anything.
    expect(enqueueOrder(cleared, "salvageBay", housingBatch(500).order).queued).toBe(true);
  });

  it("releases only the units still WAITING: the one already in the bay keeps its own", () => {
    // Removing a partly-drained batch cannot un-start the unit that is already running, and it
    // must not pretend to: that unit stays reserved by its job until the job resolves.
    const running = promoteQueuedOrders(batchState(5, [housingBatch(3)]));
    const cleared = removeQueuedOrder(running, "q-1");
    expect(cleared.processQueue).toEqual([]);
    expect(cleared.activeProcesses).toHaveLength(1);
    expect(salvageReservedMaterialCount(cleared, HOUSING)).toBe(1);
  });
});

describe("promoteQueuedOrders: a BATCH consumes ONE unit per job, leaving a residual in place", () => {
  it("starts a single-unit job and leaves N-1 behind, keeping the entry's id", () => {
    const promoted = promoteQueuedOrders(batchState(5, [housingBatch(3)]));
    // Exactly one job, sized as ONE material salvage. The batch did not collapse into one
    // long job, which is the shape the whole parity argument depends on.
    expect(promoted.activeProcesses).toHaveLength(1);
    expect(promoted.activeProcesses[0].durationTicks).toBe(SALVAGE_MATERIAL_TICKS);
    expect(promoted.activeProcesses[0].effect).toEqual({
      type: "salvageResolve",
      target: { kind: "material", itemId: HOUSING },
    });
    // The residual keeps the SAME id (so the Remove button still points at it) and the same
    // target, one unit lighter.
    expect(promoted.processQueue).toHaveLength(1);
    expect(promoted.processQueue[0].id).toBe("q-1");
    expect(salvageOrderUnits(promoted.processQueue[0].order as QueuedSalvageOrder)).toBe(2);
  });

  it("drops the entry entirely on the LAST unit", () => {
    const last = promoteQueuedOrders(batchState(5, [housingBatch(1)]));
    expect(last.processQueue).toEqual([]);
    expect(last.activeProcesses).toHaveLength(1);
  });

  it("keeps the residual's QUEUE POSITION, so a long batch never drifts to the back", () => {
    // Property 4 of the promotion pass: the array is never reordered. Appending the residual
    // instead of replacing it in place would push a 5000-unit batch behind every other order
    // five thousand times, silently rewriting the player's ordering.
    const spare = makePiece({ slotType: "cargoBay", fitted: false, crafted: true, quality: 2, id: "sp-9" });
    const base = batchState(5);
    const state: GameState = {
      ...base,
      equipment: [...base.equipment, spare],
      unlockedHomeworldTalents: ["fleetLogisticsQueue1"],
      processQueue: [
        housingBatch(3, "q-1"),
        {
          id: "q-2",
          facility: "salvageBay",
          order: {
            type: "salvage",
            target: { kind: "equipment", instanceId: "sp-9" },
            mode: { kind: "batch", remaining: 1 },
          },
        },
      ],
    };
    const promoted = promoteQueuedOrders(state);
    expect(promoted.processQueue.map((j) => j.id)).toEqual(["q-1", "q-2"]);
  });

  it("promotes at most ONE unit per pass, even with the queue and the stock wide open", () => {
    // SALVAGE_SLOT_COUNT is 1, so the second unit cannot start until the first completes.
    // Asserted rather than assumed, because "one unit per job duration" is exactly the
    // property that keeps the per-unit rng draw pattern identical to the single-unit path.
    let s = batchState(50, [housingBatch(50)]);
    s = promoteQueuedOrders(s);
    s = promoteQueuedOrders(s);
    s = promoteQueuedOrders(s);
    expect(s.activeProcesses).toHaveLength(1);
    expect(salvageOrderUnits(s.processQueue[0].order as QueuedSalvageOrder)).toBe(49);
  });

  it("drains one unit per SALVAGE_MATERIAL_TICKS through the real tick, not faster", () => {
    // The end-to-end timing claim, measured against the clock rather than asserted about the
    // code. A unit costs its job duration plus the tick that promotes the next one, so three
    // units cannot possibly finish inside two units' worth of ticks.
    const start = batchState(5, [housingBatch(3)]);
    const tooSoon = tick(2 * SALVAGE_MATERIAL_TICKS, start, mulberry32(11));
    expect(itemTotal(tooSoon.inventory, HOUSING).toNumber()).toBeGreaterThan(2);

    const done = tick(4 * (SALVAGE_MATERIAL_TICKS + 2), start, mulberry32(11));
    // All three units consumed, the entry gone, the bay idle.
    expect(itemTotal(done.inventory, HOUSING).toNumber()).toBe(2);
    expect(done.processQueue).toEqual([]);
    expect(done.activeProcesses).toEqual([]);
  });

  it("stops mid-batch when the stock runs out, and waits rather than consuming nothing", () => {
    // A batch that outlives its stock (an over-cap clamp, a consumer spending raw inventory)
    // must NOT resolve into nothing. canStartSalvage's noneHeld bound is the backstop, and it
    // is deliberately unchanged by the batch work.
    const starved: GameState = {
      ...batchState(1, [housingBatch(3)]),
      inventory: { [HOUSING]: [new Decimal(0)] },
    };
    const after = promoteQueuedOrders(starved);
    expect(after.activeProcesses).toEqual([]); // nothing started
    expect(after.processQueue).toHaveLength(1); // the order simply waits
    // and it did not shrink: no unit was spent to learn it could not run
    expect(salvageOrderUnits(after.processQueue[0].order as QueuedSalvageOrder)).toBe(3);
  });
});

describe("autoSalvageOrders: the manual slot stays free, and the rules never mint a batch", () => {
  // A pool big enough that an unbounded pass would enqueue dozens. A local twin of the
  // bigPoolState fixture the Unit 5.1 block defines inside its own describe: rebuilt here
  // rather than hoisted, because hoisting a fixture out of a passing suite to reach it from a
  // new one is a change to working code for the new code's convenience (Omega 15a).
  function batchPoolState(talents: HomeworldTalentKey[] = []): GameState {
    const pieces = Array.from({ length: 40 }, (_, i) =>
      autoPiece({ id: `bp-${String(i).padStart(3, "0")}`, quality: 0 })
    );
    const base = autoState(pieces, { maxQuality: 5 });
    return { ...base, unlockedHomeworldTalents: [...base.unlockedHomeworldTalents, ...talents] };
  }

  it("leaves a depth slot the player can fill with a BATCH order", () => {
    // The manual-headroom guarantee, re-asserted against the new order shape: the rules never
    // take the last slot, and what the player puts in it may now be a batch.
    const pool = batchPoolState(["fleetLogisticsQueue1", "fleetLogisticsQueue2"]);
    const state: GameState = {
      ...pool,
      fleetAdminLevel: MAX_CEILING_LEVEL,
      inventory: { ...pool.inventory, [HOUSING]: [new Decimal(400)] },
    };
    expect(queueDepth(state)).toBe(3);
    const after = autoSalvageOrders(state);
    expect(after.processQueue.length).toBe(3 - AUTO_SALVAGE_MANUAL_HEADROOM);
    const manual = enqueueOrder(after, "salvageBay", housingBatch(400).order);
    expect(manual.queued).toBe(true);
    expect(manual.next.processQueue.length).toBe(3);
  });

  it("never mints a multi-unit order of its own", () => {
    // An automation that destroys items must not acquire a multiplier. Every order the rules
    // add names ONE unique spare, so every one of them reads as exactly one unit.
    const after = autoSalvageOrders(batchPoolState(["fleetLogisticsQueue1", "fleetLogisticsQueue2"]));
    expect(after.processQueue.length).toBeGreaterThan(0);
    for (const job of after.processQueue) {
      expect(salvageOrderUnits(job.order as QueuedSalvageOrder)).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// THE POINT OF THE WHOLE FOLLOW-UP: offline == live PARITY for a BATCH
// ---------------------------------------------------------------------------
// A batch drains INSIDE the economy seam, one unit per job, and every unit draws TWICE from
// the threaded seeded stream (loot tier, then item). So the property that has to hold is not
// merely "the same materials came out": it is that the two chunkings consume the stream in the
// SAME ORDER and to the SAME DEPTH, because everything that completes after the batch depends
// on where the stream was left. Each path runs its OWN fresh generator over the SAME seed, so
// any unseeded draw, any reordering, and any batched-up resolution makes the two results
// differ and fails the deep compare.
describe("offline==live parity for a BATCH salvage (tick(span) == looping economyTick(_,1))", () => {
  const UNITS = 4;
  // Generous enough that every unit promotes AND completes inside the span, with the bay idle
  // at the end: a span that cut a batch short would still be a valid parity case, but it would
  // not prove the interesting half (that the LAST unit lands identically too).
  const SPAN = UNITS * (SALVAGE_MATERIAL_TICKS + 2) + 5;
  const SEED = 4242;

  function batchSpanState(): GameState {
    return batchState(10, [housingBatch(UNITS)]);
  }

  it("a 4-unit batch draining across ONE long offline span lands byte-identically to the span stepped tick by tick", () => {
    const jumped = tick(SPAN, batchSpanState(), mulberry32(SEED));
    let stepped = batchSpanState();
    const liveRng = mulberry32(SEED);
    for (let i = 0; i < SPAN; i++) stepped = economyTick(stepped, 1, liveRng);

    expect(salvageFingerprint(jumped)).toEqual(salvageFingerprint(stepped));

    // NON-VACUITY: the batch really did drain, all four units, inside the span. Without this
    // the assertion above could pass by comparing two untouched states.
    expect(itemTotal(jumped.inventory, HOUSING).toNumber()).toBe(10 - UNITS);
    expect(jumped.processQueue).toEqual([]);
    expect(jumped.activeProcesses).toEqual([]);
  });

  it("both chunkings consume the SAME number of draws, and it is exactly 2 PER UNIT", () => {
    // THE DRAW-ORDER PROOF. A deep-equal result could in principle be reached while consuming
    // the stream differently, and a batch is precisely where that could happen: resolving four
    // units in one completion would take the same eight draws in a different ORDER, and
    // batching the tier draws would take them in a different SHAPE. Pinning the count at
    // 2 x UNITS pins that each unit was resolved on its own, in sequence, exactly as four
    // separately queued single-unit orders would have been.
    const jumpedCount = countingRng(mulberry32(SEED));
    tick(SPAN, batchSpanState(), jumpedCount.rng);

    const steppedCount = countingRng(mulberry32(SEED));
    let stepped = batchSpanState();
    for (let i = 0; i < SPAN; i++) stepped = economyTick(stepped, 1, steppedCount.rng);

    expect(jumpedCount.draws()).toBe(steppedCount.draws());
    expect(jumpedCount.draws()).toBe(2 * UNITS);
  });

  it("a BATCH of N is indistinguishable from N single-unit orders, draw for draw", () => {
    // THE CLOSED-FORM PROPERTY, STATED AS A TEST. The batch is a QUEUE convenience and nothing
    // else: it must not change what the engine does, only how much of it the player had to
    // click. So the same span, the same seed and the same stock must land in the same place
    // whether the four units arrived as one batch or as four separate orders. If this ever
    // fails, the batch has grown behavior of its own.
    const asBatch = tick(SPAN, batchState(10, [housingBatch(UNITS)]), mulberry32(SEED));
    const asSingles = tick(
      SPAN,
      batchState(10, [housingBatch(1, "q-1"), housingBatch(1, "q-2"), housingBatch(1, "q-3"), housingBatch(1, "q-4")]),
      mulberry32(SEED)
    );
    // Both end with an EMPTY queue, which is asserted directly; the fingerprint's own
    // processQueue field is then trivially equal, so the whole fingerprint can be compared.
    expect(asBatch.processQueue).toEqual([]);
    expect(asSingles.processQueue).toEqual([]);
    expect(salvageFingerprint(asBatch)).toEqual(salvageFingerprint(asSingles));
  });

  it("is NOT comparing two constants: the seed really does drive the result", () => {
    // THE CONTROL. A parity test that passes because the outcome does not depend on the rng
    // at all proves nothing, so this shows the compared value IS stream-driven.
    //
    // ⚠️ ASSERTED OVER A RUN OF SEEDS, NOT OVER ONE PAIR, and that is a correctness fix
    // rather than a stylistic one. A batch of four takes only eight draws against a weighted
    // loot table whose top tiers are deliberately rare, so two neighbouring seeds landing on
    // the identical four drops is an ordinary coincidence, not a bug: a single-pair control
    // would be flaky for a reason that has nothing to do with what it is testing. Requiring
    // MORE THAN ONE distinct outcome across a run of seeds is the same claim without the
    // coin flip.
    const outcomes = new Set(
      Array.from({ length: 8 }, (_, i) =>
        JSON.stringify(salvageFingerprint(tick(SPAN, batchSpanState(), mulberry32(SEED + i))))
      )
    );
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it("parity holds when the span is chunked UNEVENLY across the unit boundaries", () => {
    // A third chunking, deliberately cutting mid-unit rather than between units, on ONE
    // continuous stream. The countdown arithmetic is closed-form and the draws stay in order,
    // so this must land exactly where the other two did.
    const rng = mulberry32(SEED);
    let split = batchSpanState();
    const first = SALVAGE_MATERIAL_TICKS + 3; // partway into the second unit
    for (let i = 0; i < first; i++) split = economyTick(split, 1, rng);
    for (let i = 0; i < SPAN - first; i++) split = economyTick(split, 1, rng);

    expect(salvageFingerprint(split)).toEqual(salvageFingerprint(tick(SPAN, batchSpanState(), mulberry32(SEED))));
  });
});
