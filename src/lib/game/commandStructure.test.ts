// Crew 0.14.0 (Phase 2): tests for the DORMANT per-hull command structure (commandStructure.ts).
// Covers: bigger/better hulls carry bigger caps, role weighting differs by hull SPEC, the INCLUSIVE /
// CASCADING per-rank cap (the doc's "1 LtCmdr + 2 Lt + 4 Ensign -> up to 7 Ensigns" mechanic), and the
// canAddToComplement gate enforcing total + division + inclusive-rank together. Nothing here touches
// the tick or ship stats (the engine is not wired in yet).

import { describe, it, expect } from "vitest";
import type { CrewBucket, CrewSignature, ShipComplement } from "./model";
import {
  CREW_PROFESSIONS,
  commandStructureForHull,
  complementTotalCap,
  divisionCap,
  rankAllocation,
  inclusiveRankCap,
  remainingTotalCapacity,
  remainingDivisionCapacity,
  remainingRankCapacity,
  remainingCapacityForSignature,
  canAddToComplement,
  countInDivision,
  countAtRankOrHigher,
} from "./commandStructure";
import { CREW_RANK_ORDER } from "./crewRank";

// A security signature at a given rank (buffs are irrelevant to caps; caps read only profession/rank).
function sec(rank: CrewSignature["rank"]): CrewSignature {
  return { profession: "security", rarity: "standard", rank, race: "earthBorn", buff1Id: "sec.boarding", buff2Id: null };
}

function complementOf(buckets: CrewBucket[]): ShipComplement {
  return { buckets, mode: "passive" };
}

const EMPTY: ShipComplement = { buckets: [], mode: "passive" };

describe("command structure - totals + role weighting", () => {
  it("bigger / higher-tier hulls carry bigger total caps", () => {
    // generalFreighter (general t1) < destroyer (tactician t2) < battleship (tactician t3).
    expect(complementTotalCap("generalFreighter")).toBeLessThan(complementTotalCap("destroyer"));
    expect(complementTotalCap("destroyer")).toBeLessThan(complementTotalCap("battleship"));
  });

  it("the bonusCapacity hook (future crew-quarters module) raises the total cap additively", () => {
    const base = complementTotalCap("destroyer");
    expect(complementTotalCap("destroyer", 25)).toBe(base + 25);
    // A negative/zero bonus never lowers the base.
    expect(complementTotalCap("destroyer", 0)).toBe(base);
    expect(complementTotalCap("destroyer", -10)).toBe(base);
  });

  it("division caps sum to (about) the total and never exceed it per division", () => {
    const total = complementTotalCap("battleship");
    let sum = 0;
    for (const p of CREW_PROFESSIONS) {
      const cap = divisionCap("battleship", p);
      expect(cap).toBeLessThanOrEqual(total);
      sum += cap;
    }
    // Independent rounding of each division can push the sum marginally above the total, which is why
    // the total cap is the real ceiling. Allow a small rounding band around the total.
    expect(Math.abs(sum - total)).toBeLessThanOrEqual(CREW_PROFESSIONS.length);
  });

  it("role weighting differs by hull spec (a warship weights Security; a prospector weights Science)", () => {
    // Tactician warship: Security is a top division, and out-weights Science.
    expect(divisionCap("battleship", "security")).toBeGreaterThan(divisionCap("battleship", "science"));
    // Prospector: Science / Engineering lead, Security is a minor division.
    expect(divisionCap("prospectorMiner", "science")).toBeGreaterThan(divisionCap("prospectorMiner", "security"));
    expect(divisionCap("prospectorMiner", "engineering")).toBeGreaterThan(divisionCap("prospectorMiner", "security"));
    // The SAME division is weighted differently across specs (the templates are not just scaled copies).
    const battleshipSecurityShare = divisionCap("battleship", "security") / complementTotalCap("battleship");
    const prospectorSecurityShare = divisionCap("prospectorMiner", "security") / complementTotalCap("prospectorMiner");
    expect(battleshipSecurityShare).toBeGreaterThan(prospectorSecurityShare);
  });

  it("per-division rank allocations sum EXACTLY to the division cap", () => {
    for (const p of CREW_PROFESSIONS) {
      const cap = divisionCap("battleship", p);
      let sum = 0;
      for (const r of CREW_RANK_ORDER) sum += rankAllocation("battleship", p, r);
      expect(sum).toBe(cap);
    }
  });
});

describe("command structure - inclusive / cascading rank caps", () => {
  it("inclusiveRankCap is the cumulative sum from the top, monotonic, and equals the division cap at the lowest rank", () => {
    const p = "security";
    // Cumulative-from-the-top identity: inclusive(rank) == sum of allocations at rank..8.
    for (const r of CREW_RANK_ORDER) {
      let expected = 0;
      for (const rr of CREW_RANK_ORDER) if (rr >= r) expected += rankAllocation("battleship", p, rr);
      expect(inclusiveRankCap("battleship", p, r)).toBe(expected);
    }
    // Monotonic decreasing as the rank rises (higher rank => tighter cap).
    for (let i = 1; i < CREW_RANK_ORDER.length; i += 1) {
      const lower = inclusiveRankCap("battleship", p, CREW_RANK_ORDER[i - 1]);
      const higher = inclusiveRankCap("battleship", p, CREW_RANK_ORDER[i]);
      expect(higher).toBeLessThanOrEqual(lower);
    }
    // The lowest rank is bounded only by the division total.
    expect(inclusiveRankCap("battleship", p, 1)).toBe(divisionCap("battleship", p));
  });

  it("unused high-rank capacity rolls DOWN to the lower ranks (the 1 LtCmdr + 2 Lt + 4 Ensign -> 7 Ensigns mechanic)", () => {
    // Generalized form of the doc example on a real hull: with an EMPTY complement, the room for the
    // Ensign rank (6) equals the SUM of the allocations at Ensign OR HIGHER (6+7+8), because none of
    // that senior capacity is being used, so it all cascades down to Ensigns.
    const p = "security";
    const a6 = rankAllocation("battleship", p, 6);
    const a7 = rankAllocation("battleship", p, 7);
    const a8 = rankAllocation("battleship", p, 8);
    expect(remainingRankCapacity(EMPTY, "battleship", p, 6)).toBe(a6 + a7 + a8);

    // Now seat crew AT the higher ranks (7 and 8) up to their allocations; the Ensign room must drop
    // by exactly that many (the senior seats no longer cascade down).
    const seniorBuckets: CrewBucket[] = [];
    if (a7 > 0) seniorBuckets.push({ ...sec(7), count: a7 });
    if (a8 > 0) seniorBuckets.push({ ...sec(8), count: a8 });
    const withSeniors = complementOf(seniorBuckets);
    expect(remainingRankCapacity(withSeniors, "battleship", p, 6)).toBe(a6);
  });

  it("the lowest rank is bounded only by the division total, not by any per-rank slice", () => {
    const p = "engineering";
    // A Crewman (rank 1) can fill the entire division cap when nothing else is aboard.
    expect(remainingRankCapacity(EMPTY, "battleship", p, 1)).toBe(divisionCap("battleship", p));
  });
});

describe("command structure - remaining capacity + the add gate", () => {
  it("remainingCapacityForSignature is the tightest of total / division / inclusive-rank", () => {
    const room = remainingCapacityForSignature(EMPTY, "battleship", sec(6));
    expect(room).toBe(
      Math.min(
        remainingTotalCapacity(EMPTY, "battleship"),
        remainingDivisionCapacity(EMPTY, "battleship", "security"),
        remainingRankCapacity(EMPTY, "battleship", "security", 6),
      ),
    );
  });

  it("canAddToComplement enforces the inclusive-rank cap", () => {
    const p = "security";
    const rank = 6;
    const cap = inclusiveRankCap("battleship", p, rank); // ensign-or-higher inclusive cap
    // Exactly at the cap is allowed; one over is refused.
    expect(canAddToComplement(EMPTY, "battleship", sec(rank), cap)).toBe(true);
    expect(canAddToComplement(EMPTY, "battleship", sec(rank), cap + 1)).toBe(false);
  });

  it("canAddToComplement enforces the division cap", () => {
    const p = "science";
    const cap = divisionCap("battleship", p);
    const sig: CrewSignature = { profession: p, rarity: "standard", rank: 1, race: "vael", buff1Id: "sci.survey", buff2Id: null };
    // rank-1 is bounded only by the division total, so the division cap is the binding constraint.
    expect(canAddToComplement(EMPTY, "battleship", sig, cap)).toBe(true);
    expect(canAddToComplement(EMPTY, "battleship", sig, cap + 1)).toBe(false);
  });

  it("a zero-or-negative count is vacuously allowed", () => {
    expect(canAddToComplement(EMPTY, "battleship", sec(1), 0)).toBe(true);
    expect(canAddToComplement(EMPTY, "battleship", sec(1), -5)).toBe(true);
  });

  it("occupancy counters read a complement correctly", () => {
    const buckets: CrewBucket[] = [
      { ...sec(7), count: 1 },
      { ...sec(6), count: 3 },
      { ...sec(1), count: 10 },
      { profession: "science", rarity: "standard", rank: 4, race: "vael", buff1Id: "sci.survey", buff2Id: null, count: 5 },
    ];
    expect(countInDivision(buckets, "security")).toBe(14);
    expect(countInDivision(buckets, "science")).toBe(5);
    expect(countAtRankOrHigher(buckets, "security", 6)).toBe(4); // the rank-7 + rank-6 crew
    expect(countAtRankOrHigher(buckets, "security", 8)).toBe(0);
  });

  it("commandStructureForHull returns a stable (cached) structure with all six divisions", () => {
    const a = commandStructureForHull("destroyer");
    const b = commandStructureForHull("destroyer");
    expect(a).toBe(b); // memoized: same instance
    for (const p of CREW_PROFESSIONS) expect(a.divisions[p]).toBeDefined();
  });
});
