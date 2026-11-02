import { describe, it, expect } from "vitest";
import { CREW_RANKS, CREW_RANK_ORDER, buffCountForRank, crewRankLabel, rankMagnitudeFactor } from "./crewRank";
import type { CrewRank } from "./model";

describe("crewRank: ladder", () => {
  it("has all 8 tiers with the LOCKED labels in order", () => {
    expect(CREW_RANK_ORDER).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(CREW_RANK_ORDER.map((r) => CREW_RANKS[r].label)).toEqual([
      "Crewman",
      "Petty Officer",
      "Chief",
      "Master Chief",
      "Cadet",
      "Ensign",
      "Lieutenant",
      "Lieutenant Commander",
    ]);
  });

  // Wiring WR-9 (OC-E11): the never-read `enlisted` flag is deleted (identity only).
  it("carries no enlisted flag (OC-E11: deleted)", () => {
    for (const r of CREW_RANK_ORDER) expect("enlisted" in CREW_RANKS[r]).toBe(false);
  });

  it("keys each def to its own id", () => {
    for (const r of CREW_RANK_ORDER) expect(CREW_RANKS[r].id).toBe(r);
  });
});

describe("crewRank: buffCountForRank", () => {
  it("matches the first-pass count table (1,1,2,2,2,2,3,3)", () => {
    const counts = CREW_RANK_ORDER.map((r) => buffCountForRank(r));
    expect(counts).toEqual([1, 1, 2, 2, 2, 2, 3, 3]);
  });

  it("is non-decreasing up the ladder", () => {
    for (let i = 1; i < CREW_RANK_ORDER.length; i++) {
      expect(buffCountForRank(CREW_RANK_ORDER[i])).toBeGreaterThanOrEqual(
        buffCountForRank(CREW_RANK_ORDER[i - 1]),
      );
    }
  });
});

describe("crewRank: rankMagnitudeFactor", () => {
  it("is 1.0 at rank 1 and grows a modest 5% per tier", () => {
    expect(rankMagnitudeFactor(1)).toBeCloseTo(1.0, 10);
    expect(rankMagnitudeFactor(2)).toBeCloseTo(1.05, 10);
    expect(rankMagnitudeFactor(8)).toBeCloseTo(1.35, 10);
  });

  it("is strictly increasing across the ladder", () => {
    for (let i = 1; i < CREW_RANK_ORDER.length; i++) {
      expect(rankMagnitudeFactor(CREW_RANK_ORDER[i] as CrewRank)).toBeGreaterThan(
        rankMagnitudeFactor(CREW_RANK_ORDER[i - 1] as CrewRank),
      );
    }
  });
});

describe("crewRankLabel (GO-12 review minor: a rank label never throws)", () => {
  it("names every ladder rank as CREW_RANKS does", () => {
    for (const r of CREW_RANK_ORDER) expect(crewRankLabel(r)).toBe(CREW_RANKS[r].label);
  });
  it("a whole rank past either end reads as that end; anything else reads Crewman", () => {
    expect(crewRankLabel(10)).toBe("Lieutenant Commander");
    expect(crewRankLabel(0)).toBe("Crewman");
    expect(crewRankLabel(-3)).toBe("Crewman");
    expect(crewRankLabel(Number.NaN)).toBe("Crewman");
    expect(crewRankLabel(2.5)).toBe("Crewman");
    expect(crewRankLabel(undefined)).toBe("Crewman");
    expect(crewRankLabel(null)).toBe("Crewman");
  });
});
