import { describe, it, expect } from "vitest";
import {
  signatureKey,
  addToBucketList,
  removeFromBucketList,
  moveBetweenBucketLists,
  coalesceBuckets,
  totalCrew,
  rollupBuckets,
} from "./crew";
import type { CrewBucket, CrewSignature } from "./model";

// A couple of stable signature fixtures. Content-free: the race/bonus strings are arbitrary
// placeholders (Phase 0.5 owns the real vocabularies), which is exactly what these primitives are
// designed to tolerate.
const sigA: CrewSignature = { profession: "security", rarity: "standard", rank: 1, race: "raceA", bonusId: "b1" };
const sigB: CrewSignature = { profession: "engineering", rarity: "stellar", rank: 3, race: "raceB", bonusId: "b2" };
// Same identity as sigA but constructed independently (proves keying is by value, not reference).
const sigAClone: CrewSignature = { profession: "security", rarity: "standard", rank: 1, race: "raceA", bonusId: "b1" };
// Differs from sigA only in rank -> a DISTINCT bucket.
const sigARank2: CrewSignature = { ...sigA, rank: 2 };

describe("crew primitives: signatureKey", () => {
  it("is stable and equal for value-equal signatures, ignoring count", () => {
    expect(signatureKey(sigA)).toBe(signatureKey(sigAClone));
    expect(signatureKey({ ...sigA } as CrewBucket & { count: number })).toBe(signatureKey(sigA));
  });

  it("differs when ANY signature field differs", () => {
    expect(signatureKey(sigA)).not.toBe(signatureKey(sigARank2)); // rank
    expect(signatureKey(sigA)).not.toBe(signatureKey({ ...sigA, profession: "medical" }));
    expect(signatureKey(sigA)).not.toBe(signatureKey({ ...sigA, rarity: "radiant" }));
    expect(signatureKey(sigA)).not.toBe(signatureKey({ ...sigA, race: "raceZ" }));
    expect(signatureKey(sigA)).not.toBe(signatureKey({ ...sigA, bonusId: "bX" }));
  });
});

describe("crew primitives: addToBucketList", () => {
  it("appends a new bucket when no matching signature exists", () => {
    const out = addToBucketList([], sigA, 5);
    expect(out).toEqual([{ ...sigA, count: 5 }]);
  });

  it("merges into an existing same-signature bucket (matched by value, not reference)", () => {
    const start = [{ ...sigA, count: 5 }];
    const out = addToBucketList(start, sigAClone, 3);
    expect(out).toEqual([{ ...sigA, count: 8 }]);
  });

  it("keeps distinct signatures in separate buckets", () => {
    const out = addToBucketList(addToBucketList([], sigA, 5), sigARank2, 2);
    expect(out).toEqual([
      { ...sigA, count: 5 },
      { ...sigARank2, count: 2 },
    ]);
  });

  it("treats count <= 0 as a no-op (returns a fresh copy, does not mutate input)", () => {
    const start = [{ ...sigA, count: 5 }];
    const out = addToBucketList(start, sigB, 0);
    expect(out).toEqual(start);
    expect(out).not.toBe(start);
    const outNeg = addToBucketList(start, sigA, -3);
    expect(outNeg).toEqual(start);
  });

  it("does not mutate the input list or its buckets", () => {
    const start = [{ ...sigA, count: 5 }];
    addToBucketList(start, sigA, 4);
    expect(start).toEqual([{ ...sigA, count: 5 }]);
  });
});

describe("crew primitives: removeFromBucketList", () => {
  it("subtracts a partial count", () => {
    const start = [{ ...sigA, count: 5 }];
    expect(removeFromBucketList(start, sigA, 2)).toEqual([{ ...sigA, count: 3 }]);
  });

  it("prunes a bucket that reaches exactly zero", () => {
    const start = [{ ...sigA, count: 5 }, { ...sigB, count: 2 }];
    expect(removeFromBucketList(start, sigA, 5)).toEqual([{ ...sigB, count: 2 }]);
  });

  it("clamps at zero (removing more than present prunes the bucket, never goes negative)", () => {
    const start = [{ ...sigA, count: 5 }];
    expect(removeFromBucketList(start, sigA, 99)).toEqual([]);
  });

  it("is a no-op for a signature not present", () => {
    const start = [{ ...sigA, count: 5 }];
    expect(removeFromBucketList(start, sigB, 3)).toEqual(start);
  });

  it("treats count <= 0 as a no-op copy and never mutates the input", () => {
    const start = [{ ...sigA, count: 5 }];
    const out = removeFromBucketList(start, sigA, 0);
    expect(out).toEqual(start);
    expect(out).not.toBe(start);
    removeFromBucketList(start, sigA, 3);
    expect(start).toEqual([{ ...sigA, count: 5 }]);
  });
});

describe("crew primitives: moveBetweenBucketLists", () => {
  it("moves the requested count when the source holds enough", () => {
    const from = [{ ...sigA, count: 10 }];
    const to: CrewBucket[] = [];
    const res = moveBetweenBucketLists(from, to, sigA, 4);
    expect(res.from).toEqual([{ ...sigA, count: 6 }]);
    expect(res.to).toEqual([{ ...sigA, count: 4 }]);
  });

  it("caps the move at what the source holds (never creates crew)", () => {
    const from = [{ ...sigA, count: 3 }];
    const to = [{ ...sigA, count: 1 }];
    const res = moveBetweenBucketLists(from, to, sigA, 99);
    expect(res.from).toEqual([]); // source fully drained + pruned
    expect(res.to).toEqual([{ ...sigA, count: 4 }]); // merged: 1 + 3 moved
  });

  it("is a no-op on both lists when the signature is absent from the source", () => {
    const from = [{ ...sigA, count: 5 }];
    const to = [{ ...sigB, count: 2 }];
    const res = moveBetweenBucketLists(from, to, sigB, 3);
    expect(res.from).toEqual(from);
    expect(res.to).toEqual(to);
  });

  it("conserves total headcount across the two lists", () => {
    const from = [{ ...sigA, count: 7 }, { ...sigB, count: 2 }];
    const to = [{ ...sigA, count: 1 }];
    const before = totalCrew(from) + totalCrew(to);
    const res = moveBetweenBucketLists(from, to, sigA, 5);
    expect(totalCrew(res.from) + totalCrew(res.to)).toBe(before);
  });

  it("does not mutate either input list (count <= 0 included)", () => {
    const from = [{ ...sigA, count: 5 }];
    const to = [{ ...sigB, count: 2 }];
    moveBetweenBucketLists(from, to, sigA, 3);
    moveBetweenBucketLists(from, to, sigA, 0);
    expect(from).toEqual([{ ...sigA, count: 5 }]);
    expect(to).toEqual([{ ...sigB, count: 2 }]);
  });
});

describe("crew primitives: coalesceBuckets", () => {
  it("merges duplicate signatures into one, preserving first-appearance order", () => {
    const list = [
      { ...sigA, count: 2 },
      { ...sigB, count: 1 },
      { ...sigAClone, count: 3 },
    ];
    expect(coalesceBuckets(list)).toEqual([
      { ...sigA, count: 5 },
      { ...sigB, count: 1 },
    ]);
  });

  it("drops buckets whose merged total is zero or less", () => {
    const list = [
      { ...sigA, count: 0 },
      { ...sigB, count: 4 },
    ];
    expect(coalesceBuckets(list)).toEqual([{ ...sigB, count: 4 }]);
  });

  it("returns a fresh list and does not mutate the input buckets", () => {
    const list = [{ ...sigA, count: 2 }, { ...sigAClone, count: 3 }];
    const out = coalesceBuckets(list);
    expect(out).not.toBe(list);
    expect(list).toEqual([{ ...sigA, count: 2 }, { ...sigAClone, count: 3 }]);
  });

  it("returns [] for an empty list", () => {
    expect(coalesceBuckets([])).toEqual([]);
  });
});

describe("crew primitives: totalCrew", () => {
  it("sums counts across buckets", () => {
    expect(totalCrew([{ ...sigA, count: 5 }, { ...sigB, count: 12 }])).toBe(17);
  });

  it("is zero for an empty list", () => {
    expect(totalCrew([])).toBe(0);
  });
});

describe("crew primitives: rollupBuckets", () => {
  // A FAKE, content-free contribution function so the test never depends on Phase 0.5 numbers:
  // each crew of profession "security" contributes 2 to "hull"; "engineering" contributes 1 to
  // "hull" and 3 to "power". Everything else contributes nothing.
  const fakeContribution = (sig: CrewSignature): Record<string, number> => {
    if (sig.profession === "security") return { hull: 2 };
    if (sig.profession === "engineering") return { hull: 1, power: 3 };
    return {};
  };

  it("sums contribution(sig) * count across buckets, grouped by stat key", () => {
    const buckets = [
      { ...sigA, count: 5 }, // security -> hull: 2 * 5 = 10
      { ...sigB, count: 4 }, // engineering -> hull: 1 * 4 = 4, power: 3 * 4 = 12
    ];
    expect(rollupBuckets(buckets, fakeContribution)).toEqual({ hull: 14, power: 12 });
  });

  it("multiplies by count, not headcount iterated (O(distinct buckets))", () => {
    expect(rollupBuckets([{ ...sigA, count: 1000 }], fakeContribution)).toEqual({ hull: 2000 });
  });

  it("skips buckets with count <= 0 and contributions with no keys", () => {
    const buckets: CrewBucket[] = [
      { ...sigA, count: 0 }, // skipped by count guard
      { profession: "medical", rarity: "standard", rank: 1, race: "raceA", bonusId: "b1", count: 9 }, // contributes {}
    ];
    expect(rollupBuckets(buckets, fakeContribution)).toEqual({});
  });

  it("returns {} for an empty bucket list", () => {
    expect(rollupBuckets([], fakeContribution)).toEqual({});
  });
});
