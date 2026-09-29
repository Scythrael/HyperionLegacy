// ============================================================================
// Over-cap reconciliation (fix/warehouse-overcap-reconcile, 2026-07-24).
//
// THE BUG (legit prod player): the Warehouse showed a stack ABOVE its cap
// ("1.52M / 1.5M" ore). Root cause: the deposit clamp in addToInventory only fires ON a
// deposit, and the materialAtCap auto-stop idles a producer the instant its output is AT
// cap, so a stack that is ALREADY over cap never receives another deposit and is never
// re-clamped, it sits stuck over the cap. Such a stack arises from stock deposited BEFORE
// the 2026-07-16 deposit-clamp fix, a live salvage payout (writes raw), or a lowered cap.
//
// THE FIX: clampInventoryToCaps(state) trims every over-cap stack back to EXACTLY its cap,
// draining overflow lowest-quality-first. It runs at LOAD (save.ts migrate), unconditionally
// and idempotently, so it needs NO SAVE_VERSION bump (a value normalization, not a schema
// migration) and self-heals a save already at the head version.
//
// These tests cover: (1) an over-cap stack trims to EXACTLY the cap; (2) an at/under-cap
// stack is untouched (same reference); (3) an uncapped (sentinel) item is never trimmed;
// (4) multi-bucket overflow drains lowest-quality-first, keeping the higher tier; (5) the
// operation is idempotent; (6) INTEGRATION, migrate() at the CURRENT SAVE_VERSION clamps an
// over-cap ore stack through a real serialize -> deserialize -> migrate round trip (proving
// the load path fixes a head-version save with no bump).
// ============================================================================
import { describe, it, expect } from "vitest";
import { clampInventoryToCaps, reconcileDiscovered, itemCap, tierCap } from "./tick";
import { serialize, deserialize, migrate, SAVE_VERSION, type SaveFile } from "./save";
import { freshState } from "./model";
import { itemTotal, getBucket } from "./inventory";
import Decimal from "break_infinity.js";

describe("clampInventoryToCaps, over-cap stacks are trimmed back to their warehouse cap", () => {
  // (1) The core fix: a stack sitting over the cap is trimmed to EXACTLY the cap.
  it("trims an over-cap commonOre stack to exactly the cap (overflow discarded)", () => {
    const state = freshState();
    const cap = itemCap(state, "commonOre"); // tier-1 cap, 1,000,000 at warehouse level 0
    // The reported shape: 1.52M against a 1.5M-class cap. Seed 1.52x the cap so the stack
    // genuinely exceeds it regardless of the exact cap calibration.
    const over = cap.times(1.52);
    state.inventory = { ...state.inventory, commonOre: [over] };

    const next = clampInventoryToCaps(state);
    expect(itemTotal(next.inventory, "commonOre").equals(cap)).toBe(true);
    expect(itemTotal(next.inventory, "commonOre").gt(cap)).toBe(false);
  });

  // (2) A stack at OR under the cap is left completely alone, and when NOTHING is over cap
  //     the SAME state reference is returned (no needless clone), proving normal play is
  //     untouched (this runs on every load).
  it("leaves an at/under-cap inventory untouched and returns the same reference", () => {
    const state = freshState();
    const cap = itemCap(state, "commonOre");
    state.inventory = { ...state.inventory, commonOre: [cap.minus(1)], titaniumIngot: [new Decimal(50)] };

    const next = clampInventoryToCaps(state);
    expect(next).toBe(state); // same reference, nothing was over cap
    expect(itemTotal(next.inventory, "commonOre").equals(cap.minus(1))).toBe(true);
  });

  // (3) An UNCAPPED item (unknown id -> itemCap sentinel 1e1000) is never trimmed: no
  //     reachable quantity approaches the sentinel, so the clamp is a no-op for it.
  it("never trims an uncapped (sentinel-cap) item", () => {
    const state = freshState();
    // An id with no ITEMS entry fails open to the uncapped sentinel in itemCap.
    state.inventory = { ...state.inventory, totallyUnknownItemXYZ: [new Decimal("1e50")] };

    const next = clampInventoryToCaps(state);
    expect(itemTotal(next.inventory, "totallyUnknownItemXYZ").equals(new Decimal("1e50"))).toBe(true);
  });

  // (4) Multi-bucket: overflow drains LOWEST-quality-first, so the player keeps their BEST
  //     stock. Total lands exactly at cap; the high-quality bucket is preserved intact.
  it("drains overflow lowest-quality-first across quality buckets, keeping the higher tier", () => {
    const state = freshState();
    const cap = itemCap(state, "commonOre"); // 1,000,000
    // q0 = 600k, q1 = 600k -> total 1.2M, over by 200k. Lowest-first should trim q0 to 400k
    // and leave q1 at 600k. Total = 1,000,000 = cap.
    state.inventory = { ...state.inventory, commonOre: [cap.times(0.6), cap.times(0.6)] };

    const next = clampInventoryToCaps(state);
    expect(itemTotal(next.inventory, "commonOre").equals(cap)).toBe(true);
    expect(getBucket(next.inventory, "commonOre", 1).equals(cap.times(0.6))).toBe(true); // q1 preserved
    expect(getBucket(next.inventory, "commonOre", 0).equals(cap.times(0.4))).toBe(true); // q0 trimmed
  });

  // (5) Idempotent: clamping an already-clamped state changes nothing (and returns the same
  //     reference the second time, since nothing is over cap anymore).
  it("is idempotent, clamping twice equals clamping once", () => {
    const state = freshState();
    const cap = itemCap(state, "commonOre");
    state.inventory = { ...state.inventory, commonOre: [cap.times(2)] };

    const once = clampInventoryToCaps(state);
    const twice = clampInventoryToCaps(once);
    expect(twice).toBe(once); // second pass finds nothing over cap -> same reference
    expect(itemTotal(twice.inventory, "commonOre").equals(cap)).toBe(true);
  });
});

describe("migrate, a head-version save with an over-cap ore stack is clamped on load (no bump)", () => {
  // (6) INTEGRATION proof. A save at the CURRENT SAVE_VERSION (so NO versioned migration
  //     runs) that holds over-cap ore is nonetheless trimmed to cap by the load path, which
  //     is exactly what un-sticks the reported legit save without a SAVE_VERSION bump.
  it("clamps 1.52M ore to the cap through serialize -> deserialize -> migrate", () => {
    const state = freshState();
    const cap = tierCap(state, 1); // commonOre is tier 1
    state.inventory = { ...state.inventory, commonOre: [cap.times(1.52)] };

    const raw = serialize(state, Date.now());
    const save = deserialize(raw) as SaveFile;
    expect(save.version).toBe(SAVE_VERSION); // fresh serialize writes the head version

    const migrated = migrate(save);
    expect(itemTotal(migrated.inventory, "commonOre").equals(cap)).toBe(true);
    expect(itemTotal(migrated.inventory, "commonOre").gt(cap)).toBe(false);
  });
});

// ============================================================================
// Discovery reconciliation (hotfix: salvage-only drops invisible in the Warehouse).
//
// THE BUG (reported by a player): a salvage-EXCLUSIVE exotic (intactDataCore and its two
// siblings, never gathered/refined/fabricated) never appeared in the Warehouse even when held.
// Root cause: salvage deposits via addItemQuality, which bypasses addToInventory's discovery
// seam, so the drop stayed OUT of state.discovered and the tile rendered as a masked, count-less
// "❓ undiscovered" (the count block is gated on `discovered`), i.e. held but invisible.
//
// THE FIX has two halves: the salvage apply site now marks discovery going forward (covered in
// salvage.test.ts), and reconcileDiscovered(state) reveals any held item on LOAD, the SAME
// idempotent, no-bump, every-load normalization clampInventoryToCaps is. These tests cover the
// reconcile: (1) a held-but-undiscovered item is revealed and nothing already discovered is lost;
// (2) a key held at zero is NOT revealed; (3) a non-catalog key is skipped; (4) idempotent
// same-reference; (5) INTEGRATION through migrate() at the head version (no bump).
// ============================================================================
describe("reconcileDiscovered, a held-but-undiscovered item is revealed on load", () => {
  const EXOTIC = "intactDataCore"; // a salvage-ONLY exotic: never gathered, refined or fabricated

  it("reveals an item held (count > 0) but missing from the discovered set, additively", () => {
    const state = freshState();
    expect(state.discovered).not.toContain(EXOTIC); // precondition: the bug's shape
    state.inventory = { ...state.inventory, [EXOTIC]: [new Decimal(3)] };

    const next = reconcileDiscovered(state);
    expect(next.discovered).toContain(EXOTIC);
    // Purely additive: every previously-discovered id survives.
    for (const id of state.discovered) expect(next.discovered).toContain(id);
  });

  it("does NOT reveal an item present as a key but held at zero", () => {
    const state = freshState();
    state.inventory = { ...state.inventory, [EXOTIC]: [new Decimal(0)] };
    expect(reconcileDiscovered(state).discovered).not.toContain(EXOTIC);
  });

  it("skips an inventory key with no ITEMS entry (it can never render a tile)", () => {
    const state = freshState();
    state.inventory = { ...state.inventory, totallyUnknownItemXYZ: [new Decimal(5)] };
    expect(reconcileDiscovered(state).discovered).not.toContain("totallyUnknownItemXYZ");
  });

  it("is idempotent, a fully-reconciled state returns the same reference", () => {
    const state = freshState();
    state.inventory = { ...state.inventory, [EXOTIC]: [new Decimal(2)] };
    const once = reconcileDiscovered(state);
    const twice = reconcileDiscovered(once);
    expect(twice).toBe(once); // nothing left to reveal -> same reference
  });
});

describe("migrate, a head-version save's held-but-undiscovered exotic is revealed on load (no bump)", () => {
  it("reveals a salvage-only exotic through serialize -> deserialize -> migrate", () => {
    const EXOTIC = "intactDataCore";
    const state = freshState();
    state.inventory = { ...state.inventory, [EXOTIC]: [new Decimal(1)] };
    // Model the bug precisely: held but not discovered.
    state.discovered = state.discovered.filter((id) => id !== EXOTIC);

    const raw = serialize(state, Date.now());
    const save = deserialize(raw) as SaveFile;
    expect(save.version).toBe(SAVE_VERSION); // fresh serialize writes the head version (no migration runs)

    const migrated = migrate(save);
    expect(itemTotal(migrated.inventory, EXOTIC).gt(0)).toBe(true); // still held
    expect(migrated.discovered).toContain(EXOTIC); // and now revealed
  });
});
