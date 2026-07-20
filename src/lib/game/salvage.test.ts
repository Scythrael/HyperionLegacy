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
import {
  salvageEquipment,
  SALVAGE_FRACTION_MIN,
  SALVAGE_FRACTION_MAX,
  SALVAGE_QUALITY_BONUS_PER_TIER,
} from "./salvage";
import {
  freshState,
  generateStandardIssue,
  spareEquipmentCount,
  equipmentAtCap,
  equipmentStorageCap,
  BLUEPRINTS,
  type GameState,
  type EquipmentInstance,
  type EquipmentSlotType,
} from "./model";
import { getBucket } from "./inventory";

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

  it("rejects a Standard-Issue baseline (blueprintKey null: free/craftless, nothing to recover)", () => {
    const piece = makePiece({ slotType: "cargoBay", fitted: false, crafted: false, quality: 0, id: "base-1" });
    const state = stateWith([piece]);
    const result = salvageEquipment(state, "base-1", () => 0.5);
    expect("reason" in result).toBe(true);
    expect(result.next).toBe(state);
    expect(result.next.equipment.find((e) => e.id === "base-1")).toBeDefined();
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

describe("salvageEquipment: LIVE-ONLY, never wired into an economy-tick path (Task C1)", () => {
  it("is not referenced anywhere in tick.ts (economyTick / tick / resolveProcesses live there)", () => {
    // GUARD: salvage is a discrete live action, not a timed/offline process. tick.ts
    // owns economyTick, the offline tick(), and resolveProcesses; if salvageEquipment
    // ever appears there, the parity boundary has been breached. A source grep is the
    // most direct, maintainable proof of the negative.
    expect(tickSource).not.toContain("salvageEquipment");
    expect(tickSource).not.toContain("./salvage");
  });
});
