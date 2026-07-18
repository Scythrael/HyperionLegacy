// ============================================================================
// Quality-bucketed inventory helpers (Equipment 0.11.0, Phase 4, Task 9a).
//
// Author: Claude (Opus 4.8) | Date: 2026-07-17
// Plan: docs/plans/2026-07-17-equipment-0.11.0-plan.md (Task 9a)
//
// PURPOSE
//   GameState.inventory changed SHAPE from `Record<string, Decimal>` (one balance
//   per item) to `Record<string, Decimal[]>` (a per-item array of QUALITY-TIER
//   buckets, array index = quality tier 0..5). A material's TOTAL on-hand is the
//   SUM of its buckets. This module is the single seam every read/write routes
//   through so the economy behaves IDENTICALLY to the pre-refactor scalar shape.
//
//   THIS IS A PURE SHAPE REFACTOR. Nothing in the game rolls or stores a quality
//   above 0 yet: every deposit lands in bucket 0 (quality tier 0), every consume
//   drains lowest-first (which, while all stock is q0, only ever touches bucket 0).
//   Actual quality ROLLS / gating / UI are a LATER task, not this one. The bucketed
//   shape exists now so that later work needs no second storage migration.
//
// ARRAY-LENGTH POLICY (documented decision): buckets grow LAZILY. An item's array
//   is only as long as the highest quality tier it has ever held (commonly length 1,
//   just bucket 0). A read of a bucket the array does not reach returns 0 (see
//   getBucket / itemTotal). A write to a higher tier grows the array, zero-filling
//   the gap (see addItemQuality). We do NOT eagerly allocate length-6 arrays: an
//   all-q0 world would then carry five wasted `Decimal(0)` entries per item on every
//   save. Lazy-grow keeps the persisted shape minimal and is what freshState seeds
//   (each baseline key at `[Decimal(0)]`, a single zero bucket).
//
// IMMUTABILITY: every mutator (addItemQuality / removeItemQuality /
//   removeItemLowestFirst / ensureItem) returns a NEW inventory object with a NEW
//   bucket array for the touched item; it never mutates its input. This matches how
//   the rest of the engine does immutable updates (e.g. tick.ts's addToInventory
//   spread-then-write, startProcess's `{ ...state.inventory }` clone). The pure
//   READERS (itemTotal / getBucket) allocate nothing and mutate nothing.
// ============================================================================

import Decimal from "break_infinity.js";

// The number of quality tiers an item can occupy: tiers 0..5 inclusive, so a
// full bucket array is length 6. A single source of truth for the valid quality
// range; helpers clamp / validate against it rather than hard-coding 6 at each
// site. (Nothing writes a tier above 0 in this refactor; the constant documents
// the ceiling the LATER quality-roll task will fill in.)
export const QUALITY_TIERS = 6;

// Sum of `item`'s buckets = its total on-hand. Absent item (no key) or an empty
// bucket array yields Decimal(0). PURE: reads only, allocates a running Decimal.
// This is the read every "how much of X do I have" call site uses in place of the
// old scalar `inventory[item] ?? new Decimal(0)`.
export function itemTotal(inv: Record<string, Decimal[]>, item: string): Decimal {
  const buckets = inv[item];
  if (!buckets) return new Decimal(0); // absent key -> 0 held (grow-on-demand contract)
  let total = new Decimal(0);
  for (const bucket of buckets) {
    total = total.plus(bucket);
  }
  return total;
}

// The amount held at ONE quality tier of `item`. A quality the array does not
// reach (or an absent item) reads as 0, the same grow-on-demand posture itemTotal
// takes. Out-of-range quality (< 0 or >= QUALITY_TIERS) also reads 0 rather than
// throwing, mirroring the fail-open lookups the rest of the engine uses on these
// forward-loose maps. PURE.
export function getBucket(inv: Record<string, Decimal[]>, item: string, quality: number): Decimal {
  if (quality < 0 || quality >= QUALITY_TIERS) return new Decimal(0);
  const buckets = inv[item];
  if (!buckets) return new Decimal(0);
  return buckets[quality] ?? new Decimal(0); // bucket beyond the array's length -> 0
}

// Guarantees `item` is PRESENT in the inventory, seeded to a single zero bucket
// (`[Decimal(0)]`) if it was absent. Returns the SAME inventory reference when the
// item already exists (no needless clone), else a NEW inventory with the seeded
// key. Used by freshState's baseline seeding and as a small building block; a
// consumer that just wants to read should use itemTotal (which already treats
// absent as 0) rather than ensureItem. PURE (never mutates the input map).
export function ensureItem(inv: Record<string, Decimal[]>, item: string): Record<string, Decimal[]> {
  if (inv[item]) return inv; // already present -> no change, no clone
  return { ...inv, [item]: [new Decimal(0)] };
}

// Grows a COPY of `buckets` so index `quality` is addressable, zero-filling any
// gap, and returns the new array. A private helper for the mutators below so the
// grow-and-clone step lives in exactly one place. `buckets` may be undefined (the
// item was absent) -> treated as an empty array. Never mutates its input.
function growBuckets(buckets: Decimal[] | undefined, quality: number): Decimal[] {
  const next = buckets ? [...buckets] : [];
  while (next.length <= quality) {
    next.push(new Decimal(0)); // zero-fill the gap up to and including `quality`
  }
  return next;
}

// Adds `amount` to `item`'s `quality` bucket, returning a NEW inventory. `amount`
// may be negative (the capped-add seam in tick.ts, addToInventory, uses that to
// clamp a total DOWN to a warehouse cap by adding a negative delta); this helper
// applies it verbatim with no floor, callers own any non-negative invariant. The
// bucket array is grown + zero-filled if `quality` is beyond its current length.
// PURE: clones the touched item's array and the inventory object; input untouched.
export function addItemQuality(
  inv: Record<string, Decimal[]>,
  item: string,
  amount: Decimal,
  quality: number
): Record<string, Decimal[]> {
  const nextBuckets = growBuckets(inv[item], quality);
  nextBuckets[quality] = nextBuckets[quality].plus(amount);
  return { ...inv, [item]: nextBuckets };
}

// Subtracts `amount` from `item`'s `quality` bucket, returning a NEW inventory.
// The targeted bucket is grown + zero-filled first (so removing from a not-yet-
// present tier yields a negative bucket only if the caller passes an unmet amount;
// callers gate affordability before calling, exactly as the old scalar deduct did).
// PURE: clones the touched array + the inventory object; input untouched.
export function removeItemQuality(
  inv: Record<string, Decimal[]>,
  item: string,
  amount: Decimal,
  quality: number
): Record<string, Decimal[]> {
  const nextBuckets = growBuckets(inv[item], quality);
  nextBuckets[quality] = nextBuckets[quality].minus(amount);
  return { ...inv, [item]: nextBuckets };
}

// Consumes `amount` of `item` from the LOWEST quality bucket first, spilling up
// into higher tiers only when a lower bucket is exhausted. Returns a NEW inventory.
// This is the DOCUMENTED consume policy for the later quality feature (cheap stock
// is spent before valuable stock). While all stock is quality 0 it only ever
// touches bucket 0, so it is behavior-identical to the old scalar `.minus()` deduct
// today; it is written lowest-first now so the consume seam needs no change later.
//
// AFFORDABILITY IS THE CALLER'S JOB (unchanged from the scalar model): callers gate
// on itemTotal >= amount BEFORE calling (startProcess's affordability check does
// this). If `amount` exceeds the total on hand, the shortfall is applied to the
// HIGHEST touched bucket as a negative balance, mirroring the old code's
// `(have ?? 0).minus(amount)` going negative on an over-deduct. In practice the gate
// prevents that; the behavior is documented for parity, not relied upon.
// PURE: builds a fresh bucket array; input untouched.
export function removeItemLowestFirst(
  inv: Record<string, Decimal[]>,
  item: string,
  amount: Decimal
): Record<string, Decimal[]> {
  const source = inv[item];
  // Absent item: nothing to draw from. Deducting still produces a single negative
  // bucket so the shortfall is visible, matching the old `(undefined ?? 0).minus()`.
  // (The affordability gate prevents this path for a real consume.)
  const nextBuckets = source ? [...source] : [new Decimal(0)];

  let remaining = amount;
  for (let quality = 0; quality < nextBuckets.length; quality++) {
    if (remaining.lte(0)) break; // fully satisfied from lower tiers
    const available = nextBuckets[quality];
    if (available.lte(0)) continue; // empty bucket, skip to the next tier
    if (available.gte(remaining)) {
      // This bucket covers the rest of the draw.
      nextBuckets[quality] = available.minus(remaining);
      remaining = new Decimal(0);
      break;
    }
    // Drain this bucket fully and carry the shortfall up to the next tier.
    nextBuckets[quality] = new Decimal(0);
    remaining = remaining.minus(available);
  }

  // Any leftover `remaining` means the draw exceeded total stock (only reachable if
  // the caller skipped its affordability gate). Charge it to the LOWEST bucket as a
  // negative, so the total reflects the over-deduct exactly like the scalar model's
  // single negative balance did. Bucket 0 always exists (seeded above).
  if (remaining.gt(0)) {
    nextBuckets[0] = nextBuckets[0].minus(remaining);
  }

  return { ...inv, [item]: nextBuckets };
}
