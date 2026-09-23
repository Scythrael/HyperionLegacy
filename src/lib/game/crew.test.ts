import { describe, it, expect } from "vitest";
import {
  signatureKey,
  addToBucketList,
  removeFromBucketList,
  moveBetweenBucketLists,
  coalesceBuckets,
  totalCrew,
  rollupBuckets,
  contributionForSignature,
  generateCrewIdentity,
} from "./crew";
import type { CrewBucket, CrewSignature } from "./model";
import { CREW_PROFESSION_BUFFS, SECOND_LEVEL_EXCLUSIVE, getCrewBuffById } from "./crewBuffs";
import { CREW_RACES, CREW_GENDERS, CREW_RACE_IDS } from "./crewRaces";
import { CREW_RARITY_MULTIPLIER } from "./crewRarity";
import { rankMagnitudeFactor } from "./crewRank";

// A couple of stable signature fixtures. These now use the real Phase 0.5 vocabularies (valid
// races, ranks 1-8, and real buff ids), since the signature types are now strict unions.
const sigA: CrewSignature = { profession: "security", rarity: "standard", rank: 1, race: "earthBorn", buff1Id: "sec.boarding", buff2Id: null };
const sigB: CrewSignature = { profession: "engineering", rarity: "stellar", rank: 3, race: "martian", buff1Id: "eng.range", buff2Id: "eng.power" };
// Same identity as sigA but constructed independently (proves keying is by value, not reference).
const sigAClone: CrewSignature = { profession: "security", rarity: "standard", rank: 1, race: "earthBorn", buff1Id: "sec.boarding", buff2Id: null };
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
    expect(signatureKey(sigA)).not.toBe(signatureKey({ ...sigA, race: "belter" }));
    expect(signatureKey(sigA)).not.toBe(signatureKey({ ...sigA, buff1Id: "sec.awayTeam" }));
  });

  it("folds buff2Id into the key: null vs a real 2nd buff are DISTINCT buckets", () => {
    expect(signatureKey(sigA)).not.toBe(signatureKey({ ...sigA, buff2Id: "excl.crewOutputMult" }));
    // Two different 2nd buffs are distinct.
    expect(signatureKey({ ...sigA, buff2Id: "sec.counterInfiltration" })).not.toBe(
      signatureKey({ ...sigA, buff2Id: "sec.awayTeam" }),
    );
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
      { profession: "medical", rarity: "standard", rank: 1, race: "earthBorn", buff1Id: "med.triage", buff2Id: null, count: 9 }, // contributes {}
    ];
    expect(rollupBuckets(buckets, fakeContribution)).toEqual({});
  });

  it("returns {} for an empty bucket list", () => {
    expect(rollupBuckets([], fakeContribution)).toEqual({});
  });
});

describe("crew content: contributionForSignature", () => {
  // A standard-rarity, rank-1 signature has scale == 1.0 (rarity x1.0 * rank factor 1.0), so its
  // contribution is the RAW catalog magnitudes. Race earthBorn targets crewEffectiveness; the
  // security buff targets a different key, so they never collide in this fixture.
  const opsBuff = getCrewBuffById("ops.unloadSpeed")!;

  it("sums buff1 + racial-complement magnitude at base scale (standard, rank 1)", () => {
    const sig: CrewSignature = { profession: "operations", rarity: "standard", rank: 1, race: "earthBorn", buff1Id: opsBuff.id, buff2Id: null };
    const out = contributionForSignature(sig);
    const race = CREW_RACES.earthBorn.racialBonus;
    // buff1 lands on the ops unload key at raw magnitude; racial lands on its own key at raw magnitude.
    expect(out[opsBuff.statKey]).toBeCloseTo(opsBuff.magnitude, 10);
    expect(out[race.statKey]).toBeCloseTo(race.complement, 10);
  });

  it("applies rarity MULTIPLICATIVELY, not additively (stellar x1.35 on the base, not +something huge)", () => {
    const base: CrewSignature = { profession: "operations", rarity: "standard", rank: 1, race: "earthBorn", buff1Id: opsBuff.id, buff2Id: null };
    const stellar: CrewSignature = { ...base, rarity: "stellar" };
    const mult = CREW_RARITY_MULTIPLIER.stellar!; // 1.35
    const outStellar = contributionForSignature(stellar);
    // Multiplicative: base * 1.35, NOT base + 1.35 and nowhere near it.
    expect(outStellar[opsBuff.statKey]).toBeCloseTo(opsBuff.magnitude * mult, 10);
    expect(outStellar[opsBuff.statKey]).toBeLessThan(opsBuff.magnitude + 0.01);
    // The "0.20 -> ~0.27" invariant, demonstrated on a scaled magnitude directly.
    expect(0.2 * mult).toBeCloseTo(0.27, 10);
  });

  it("scales by rank factor multiplicatively (rank 8 > rank 1 by exactly the rank factor)", () => {
    const r1: CrewSignature = { profession: "operations", rarity: "standard", rank: 1, race: "earthBorn", buff1Id: opsBuff.id, buff2Id: null };
    const r8: CrewSignature = { ...r1, rank: 8 };
    const out1 = contributionForSignature(r1);
    const out8 = contributionForSignature(r8);
    expect(out8[opsBuff.statKey]).toBeCloseTo(out1[opsBuff.statKey] * rankMagnitudeFactor(8), 10);
  });

  it("only adds buff2 when it is present (null buff2 contributes nothing extra)", () => {
    const buff2 = getCrewBuffById("excl.crewOutputMult")!;
    const withNull: CrewSignature = { profession: "operations", rarity: "standard", rank: 7, race: "earthBorn", buff1Id: opsBuff.id, buff2Id: null };
    const withBuff2: CrewSignature = { ...withNull, buff2Id: buff2.id };
    const outNull = contributionForSignature(withNull);
    const outBuff2 = contributionForSignature(withBuff2);
    // buff2's stat key is absent when null, present (and correctly scaled) when set.
    expect(outNull[buff2.statKey]).toBeUndefined();
    expect(outBuff2[buff2.statKey]).toBeCloseTo(buff2.magnitude * rankMagnitudeFactor(7), 10);
  });

  it("stacks a 2nd buff on the SAME stat key when both target it", () => {
    // Two operations buffs on distinct keys stay separate; a buff1/buff2 pair on one key sums.
    const a = getCrewBuffById("sec.boarding")!;
    const sig: CrewSignature = { profession: "security", rarity: "standard", rank: 3, race: "vael", buff1Id: a.id, buff2Id: a.id };
    const out = contributionForSignature(sig);
    expect(out[a.statKey]).toBeCloseTo(a.magnitude * 2 * rankMagnitudeFactor(3), 10);
  });
});

describe("crew content: generateCrewIdentity", () => {
  it("is deterministic in (race, seed, index)", () => {
    const first = generateCrewIdentity("martian", 12345, 7);
    const again = generateCrewIdentity("martian", 12345, 7);
    expect(again).toEqual(first);
  });

  it("varies by index and by seed (decorrelated rows)", () => {
    const a = generateCrewIdentity("earthBorn", 999, 0);
    const b = generateCrewIdentity("earthBorn", 999, 1);
    const c = generateCrewIdentity("earthBorn", 1000, 0);
    // Not a hard guarantee of inequality, but with these pools the odds of a collision are tiny;
    // at least one of the two comparisons should differ.
    expect(a.name !== b.name || a.gender !== b.gender || c.name !== a.name).toBe(true);
  });

  it("every race yields a VALID identity: name drawn from that race's pools + an inclusive gender", () => {
    for (const race of CREW_RACE_IDS) {
      const id = generateCrewIdentity(race, 42, 3);
      const [given, family] = id.name.split(" ");
      const pools = CREW_RACES[race].names;
      expect(pools.given).toContain(given);
      expect(pools.family).toContain(family);
      expect(CREW_GENDERS).toContain(id.gender);
    }
  });

  it("humans share ONE diverse name pool (no ethnicity->stat linkage): all 6 origins draw from the same arrays", () => {
    const humanOrigins = CREW_RACE_IDS.filter((r) => CREW_RACES[r].species === "human");
    const firstGiven = CREW_RACES[humanOrigins[0]].names.given;
    for (const origin of humanOrigins) {
      expect(CREW_RACES[origin].names.given).toBe(firstGiven); // same array reference
    }
    expect(SECOND_LEVEL_EXCLUSIVE.length).toBeGreaterThan(0); // sanity: exclusive pool exists
    expect(Object.keys(CREW_PROFESSION_BUFFS)).toHaveLength(6); // sanity: all professions have a pool
  });
});
