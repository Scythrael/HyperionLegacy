// ============================================================================
// Quality-bucketed inventory helper tests (Equipment 0.11.0, Phase 4, Task 9a).
//
// Covers the pure helpers in inventory.ts (the single seam every inventory
// read/write routes through) AND the v25 -> v26 save migration (MIGRATIONS[25],
// save.ts) that converts an old scalar `Record<string, Decimal>` inventory into
// the bucketed `Record<string, Decimal[]>` shape.
//
// The load-bearing guarantees under test:
//   1. itemTotal sums buckets (absent -> 0); getBucket reads one tier (out-of-range
//      / absent -> 0), the grow-on-demand contract every call site relies on.
//   2. The mutators (addItemQuality / removeItemQuality / removeItemLowestFirst /
//      ensureItem) are IMMUTABLE (never touch the input) and grow buckets lazily.
//   3. removeItemLowestFirst drains the LOWEST quality bucket first (the documented
//      consume policy), spilling up only when a lower bucket is exhausted.
//   4. MIGRATION PARITY: a real pre-refactor (v25 scalar) save migrates to the
//      bucketed shape with IDENTICAL totals, each old count landing in quality 0,
//      and hydrates back into live Decimal instances.
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  itemTotal,
  getBucket,
  ensureItem,
  addItemQuality,
  removeItemQuality,
  removeItemLowestFirst,
  QUALITY_TIERS,
} from "./inventory";
import { migrate, type SaveFile } from "./save";
import { freshState } from "./model";

// A bucketed inventory literal builder for readability in the tests below: each
// number becomes a quality-tier bucket in order (index 0 = quality 0).
const buckets = (...counts: number[]): Decimal[] => counts.map((n) => new Decimal(n));

describe("itemTotal, sum of an item's quality buckets", () => {
  it("returns 0 for an absent item (grow-on-demand: never held -> 0)", () => {
    expect(itemTotal({}, "commonOre").toNumber()).toBe(0);
  });

  it("returns the single bucket value for an all-quality-0 item", () => {
    expect(itemTotal({ commonOre: buckets(100) }, "commonOre").toNumber()).toBe(100);
  });

  it("SUMS across multiple quality buckets", () => {
    // 100 at q0 + 30 at q1 + 5 at q2 = 135 total.
    expect(itemTotal({ commonOre: buckets(100, 30, 5) }, "commonOre").toNumber()).toBe(135);
  });

  it("treats an empty bucket array as 0", () => {
    expect(itemTotal({ commonOre: [] }, "commonOre").toNumber()).toBe(0);
  });
});

describe("getBucket, the amount held at one quality tier", () => {
  it("reads the value at an in-range quality", () => {
    const inv = { commonOre: buckets(100, 30, 5) };
    expect(getBucket(inv, "commonOre", 0).toNumber()).toBe(100);
    expect(getBucket(inv, "commonOre", 1).toNumber()).toBe(30);
    expect(getBucket(inv, "commonOre", 2).toNumber()).toBe(5);
  });

  it("returns 0 for a tier beyond the array's length (lazy-grow: unfilled -> 0)", () => {
    expect(getBucket({ commonOre: buckets(100) }, "commonOre", 3).toNumber()).toBe(0);
  });

  it("returns 0 for an absent item and for out-of-range quality (fail-open)", () => {
    expect(getBucket({}, "commonOre", 0).toNumber()).toBe(0);
    expect(getBucket({ commonOre: buckets(100) }, "commonOre", -1).toNumber()).toBe(0);
    expect(getBucket({ commonOre: buckets(100) }, "commonOre", QUALITY_TIERS).toNumber()).toBe(0);
  });
});

describe("ensureItem, guarantees an item key exists (seeded to a zero q0 bucket)", () => {
  it("seeds an absent item to a single zero bucket", () => {
    const next = ensureItem({}, "commonOre");
    expect(next.commonOre).toEqual([new Decimal(0)]);
    expect(itemTotal(next, "commonOre").toNumber()).toBe(0);
  });

  it("returns the SAME reference (no clone) when the item already exists", () => {
    const inv = { commonOre: buckets(100) };
    expect(ensureItem(inv, "commonOre")).toBe(inv); // untouched, same object
  });
});

describe("addItemQuality, deposit into a quality bucket (immutable)", () => {
  it("adds to the quality-0 bucket of an existing item", () => {
    const inv = { commonOre: buckets(100) };
    const next = addItemQuality(inv, "commonOre", new Decimal(50), 0);
    expect(itemTotal(next, "commonOre").toNumber()).toBe(150);
    // Input untouched (immutability).
    expect(itemTotal(inv, "commonOre").toNumber()).toBe(100);
  });

  it("creates an absent item's bucket 0 on first deposit", () => {
    const next = addItemQuality({}, "commonOre", new Decimal(25), 0);
    expect(next.commonOre).toEqual([new Decimal(25)]);
  });

  it("grows + zero-fills the array to reach a higher quality tier", () => {
    // Deposit at quality 3 on an item that only has bucket 0 -> array becomes length 4,
    // buckets 1 and 2 zero-filled, the deposit at index 3.
    const next = addItemQuality({ commonOre: buckets(100) }, "commonOre", new Decimal(7), 3);
    expect(next.commonOre.map((b) => b.toNumber())).toEqual([100, 0, 0, 7]);
    expect(itemTotal(next, "commonOre").toNumber()).toBe(107);
  });

  it("applies a NEGATIVE amount verbatim (the capped-add seam uses this to clamp down)", () => {
    const next = addItemQuality({ commonOre: buckets(100) }, "commonOre", new Decimal(-40), 0);
    expect(itemTotal(next, "commonOre").toNumber()).toBe(60);
  });
});

describe("removeItemQuality, subtract from a specific quality bucket (immutable)", () => {
  it("subtracts from the targeted bucket, leaving others untouched", () => {
    const inv = { commonOre: buckets(100, 30) };
    const next = removeItemQuality(inv, "commonOre", new Decimal(20), 1);
    expect(next.commonOre.map((b) => b.toNumber())).toEqual([100, 10]);
    // Input untouched.
    expect(inv.commonOre.map((b) => b.toNumber())).toEqual([100, 30]);
  });
});

describe("removeItemLowestFirst, the documented consume policy (drain low quality first)", () => {
  it("drains the quality-0 bucket while it covers the draw (all-q0 case == old scalar deduct)", () => {
    const next = removeItemLowestFirst({ commonOre: buckets(100) }, "commonOre", new Decimal(30));
    expect(next.commonOre.map((b) => b.toNumber())).toEqual([70]);
  });

  it("spills UP into higher tiers only once a lower bucket is exhausted", () => {
    // 40 at q0 + 40 at q1. Draw 50: empty q0 (40), take 10 from q1 -> [0, 30].
    const next = removeItemLowestFirst({ commonOre: buckets(40, 40) }, "commonOre", new Decimal(50));
    expect(next.commonOre.map((b) => b.toNumber())).toEqual([0, 30]);
    expect(itemTotal(next, "commonOre").toNumber()).toBe(30);
  });

  it("is immutable (input inventory untouched)", () => {
    const inv = { commonOre: buckets(100) };
    removeItemLowestFirst(inv, "commonOre", new Decimal(30));
    expect(inv.commonOre.map((b) => b.toNumber())).toEqual([100]);
  });

  it("charges an over-draw (past total stock) to the lowest bucket as a negative (parity with the old scalar model)", () => {
    // Only reachable if a caller skips its affordability gate; documented for parity.
    const next = removeItemLowestFirst({ commonOre: buckets(30) }, "commonOre", new Decimal(50));
    expect(itemTotal(next, "commonOre").toNumber()).toBe(-20);
  });
});

describe("v25 -> v26 migration, scalar inventory converts to bucketed with IDENTICAL totals", () => {
  it("drops each old count into quality 0 and preserves the total exactly, hydrated to live Decimals", () => {
    // A realistic pre-refactor (v25) save: inventory is the OLD scalar shape
    // (Record<string, Decimal|number>). Values are written as strings/numbers exactly
    // as a serialized save carries them (JSON.parse never rebuilds Decimals).
    const fresh = freshState();
    const oldInventory: Record<string, string> = {
      commonOre: "750",
      uncommonMaterial: "3",
      rareMaterial: "8",
      refinedMaterial: "20",
      components: "2",
      deuteriumIce: "1000",
    };
    const v25Save: SaveFile = {
      version: 25,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 0,
      state: { ...fresh, inventory: oldInventory as any },
    };

    const migrated = migrate(v25Save);

    // NOTE: migrate() runs the FULL chain, not just v25->v26. By the v28->v29 step
    // (item-catalog reconciliation, 0.11.0 Tasks A1/A2/A3) the retired `refinedMaterial`
    // is folded into `titaniumIngot` and the removed `components` is dropped, so assert
    // the POST-chain shape: each SURVIVING scalar item lands in a single hydrated quality-0
    // bucket, titaniumIngot carries the merged refinedMaterial total (20), and the two
    // retired keys are GONE. (The pre-migration `oldInventory` fixture is kept as-is: it
    // documents a real legacy save that still held the retired keys.)
    const survivors: Record<string, string> = {
      commonOre: "750",
      uncommonMaterial: "3",
      rareMaterial: "8",
      deuteriumIce: "1000",
      titaniumIngot: "20", // A1: merged from the old refinedMaterial bucket
    };
    for (const [key, expected] of Object.entries(survivors)) {
      // Total is byte-identical to the old scalar count (titaniumIngot == old refinedMaterial).
      expect(itemTotal(migrated.inventory, key).toString()).toBe(expected);
      // Stored as a single quality-0 bucket, hydrated to a live Decimal instance.
      const bucketArray = (migrated.inventory as any)[key] as Decimal[];
      expect(Array.isArray(bucketArray)).toBe(true);
      expect(bucketArray.length).toBe(1);
      expect(bucketArray[0] instanceof Decimal).toBe(true);
      // All higher quality tiers read as 0 (lazy-grow: nothing rolled above q0).
      expect(getBucket(migrated.inventory, key, 1).toNumber()).toBe(0);
    }
    // A1/A2: the retired keys no longer exist in the reconciled inventory.
    expect((migrated.inventory as any).refinedMaterial).toBeUndefined();
    expect((migrated.inventory as any).components).toBeUndefined();
  });

  it("re-running the migration on an already-bucketed inventory is a no-op (idempotent pass-through)", () => {
    // A chained / already-v26 inventory (arrays) must NOT be re-wrapped into [[...]].
    const fresh = freshState();
    const alreadyBucketed = { ...fresh, inventory: { commonOre: [new Decimal(500)] } };
    const save: SaveFile = {
      version: 25, // force MIGRATIONS[25] to run against an already-array value
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 0,
      state: alreadyBucketed as any,
    };
    const migrated = migrate(save);
    expect(itemTotal(migrated.inventory, "commonOre").toNumber()).toBe(500);
    expect((migrated.inventory as any).commonOre.length).toBe(1); // not nested into [[500]]
  });
});
