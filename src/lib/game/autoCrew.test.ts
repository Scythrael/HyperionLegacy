// Crew 0.14.0 (Phase 2): tests for the DORMANT passive auto-crew filler (autoCrew.ts).
// Covers: TOP-RANK-DOWN fill order, NEVER breaching the total / division / inclusive-rank caps,
// conservation (every head added left the pool), leftover crew staying in the pool, mode preservation,
// no input mutation, and a defaulted (undefined) existing complement. Nothing here touches the tick.

import { describe, it, expect } from "vitest";
import type { CrewBucket, CrewProfession, CrewSignature, ShipComplement, ShipTypeKey } from "./model";
import { autoCrewShip } from "./autoCrew";
import { totalCrew } from "./crew";
import { CREW_RANK_ORDER } from "./crewRank";
import {
  CREW_PROFESSIONS,
  complementTotalCap,
  divisionCap,
  inclusiveRankCap,
  countInDivision,
  countAtRankOrHigher,
} from "./commandStructure";

function sig(profession: CrewProfession, rank: CrewSignature["rank"]): CrewSignature {
  return { profession, rarity: "standard", rank, race: "earthBorn", buff1Id: `${profession}.b`, buff2Id: null };
}

// Assert a complement breaches no cap on the given hull.
function expectWithinCaps(complement: ShipComplement, hull: ShipTypeKey): void {
  expect(totalCrew(complement.buckets)).toBeLessThanOrEqual(complementTotalCap(hull));
  for (const p of CREW_PROFESSIONS) {
    expect(countInDivision(complement.buckets, p)).toBeLessThanOrEqual(divisionCap(hull, p));
    for (const r of CREW_RANK_ORDER) {
      expect(countAtRankOrHigher(complement.buckets, p, r)).toBeLessThanOrEqual(inclusiveRankCap(hull, p, r));
    }
  }
}

describe("auto-crew - fill order + caps", () => {
  it("fills TOP-RANK-DOWN: senior seats claim their inclusive headroom before juniors cascade in", () => {
    // battleship security template (first-pass): allocations by rank 1..8 = [17,12,8,5,3,2,1,0].
    // So inclusive caps: >=Lt(7) == 1, >=Ensign(6) == 3. A pool oversupplied at every rank must seat
    // the 1 Lieutenant FIRST (top-down), then only 2 Ensigns (3 total at rank>=6), then Crewmen fill
    // the division to its cap of 48.
    const hull: ShipTypeKey = "battleship";
    const pool: CrewBucket[] = [
      { ...sig("security", 8), count: 4 }, // no rank-8 seats on this hull -> stay in pool
      { ...sig("security", 7), count: 5 },
      { ...sig("security", 6), count: 20 },
      { ...sig("security", 1), count: 200 },
    ];
    const { pool: nextPool, complement } = autoCrewShip(pool, hull, undefined);

    expect(countAtRankOrHigher(complement.buckets, "security", 7)).toBe(1); // the single Lt seat, filled first
    expect(countAtRankOrHigher(complement.buckets, "security", 6)).toBe(3); // Lt + 2 Ensigns == inclusive(6)
    expect(countInDivision(complement.buckets, "security")).toBe(divisionCap(hull, "security"));
    expectWithinCaps(complement, hull);

    // Conservation: nothing created or destroyed.
    expect(totalCrew(nextPool) + totalCrew(complement.buckets)).toBe(totalCrew(pool));
    // The rank-8 crew had no seats and stay in the pool; excess juniors stay too.
    expect(countAtRankOrHigher(nextPool, "security", 8)).toBe(4);
  });

  it("never breaches any cap even when the pool floods every division", () => {
    const hull: ShipTypeKey = "destroyer";
    const pool: CrewBucket[] = [];
    for (const p of CREW_PROFESSIONS) {
      for (const r of CREW_RANK_ORDER) pool.push({ ...sig(p, r), count: 50 });
    }
    const { pool: nextPool, complement } = autoCrewShip(pool, hull, undefined);
    expectWithinCaps(complement, hull);
    expect(totalCrew(nextPool) + totalCrew(complement.buckets)).toBe(totalCrew(pool));
    // A flooded pool fills the ship to its total cap (there is more than enough to max every division).
    expect(totalCrew(complement.buckets)).toBe(complementTotalCap(hull));
  });

  it("pulls from the pool: the moved crew are removed from the pool exactly", () => {
    const hull: ShipTypeKey = "prospectorMiner";
    const pool: CrewBucket[] = [
      { ...sig("engineering", 1), count: 30 },
      { ...sig("science", 1), count: 30 },
    ];
    const poolTotalBefore = totalCrew(pool);
    const { pool: nextPool, complement } = autoCrewShip(pool, hull, undefined);
    const seated = totalCrew(complement.buckets);
    expect(totalCrew(nextPool)).toBe(poolTotalBefore - seated);
    expect(seated).toBeGreaterThan(0);
  });
});

describe("auto-crew - purity + defaults", () => {
  it("preserves the complement mode and appends to an existing complement", () => {
    const hull: ShipTypeKey = "destroyer";
    const existing: ShipComplement = { buckets: [{ ...sig("engineering", 1), count: 3 }], mode: "active" };
    const pool: CrewBucket[] = [{ ...sig("engineering", 1), count: 10 }];
    const { complement } = autoCrewShip(pool, hull, existing);
    expect(complement.mode).toBe("active"); // toggle untouched
    expect(countInDivision(complement.buckets, "engineering")).toBeGreaterThanOrEqual(3);
  });

  it("does not mutate its inputs", () => {
    const hull: ShipTypeKey = "destroyer";
    const pool: CrewBucket[] = [{ ...sig("operations", 1), count: 10 }];
    const existing: ShipComplement = { buckets: [], mode: "passive" };
    const poolSnapshot = JSON.stringify(pool);
    const existingSnapshot = JSON.stringify(existing);
    autoCrewShip(pool, hull, existing);
    expect(JSON.stringify(pool)).toBe(poolSnapshot);
    expect(JSON.stringify(existing)).toBe(existingSnapshot);
  });

  it("treats an undefined existing complement as an empty passive complement", () => {
    const hull: ShipTypeKey = "destroyer";
    const pool: CrewBucket[] = [{ ...sig("operations", 1), count: 5 }];
    const { complement } = autoCrewShip(pool, hull, undefined);
    expect(complement.mode).toBe("passive");
    expect(totalCrew(complement.buckets)).toBeGreaterThan(0);
  });

  it("is a no-op on an empty pool", () => {
    const hull: ShipTypeKey = "destroyer";
    const { pool, complement } = autoCrewShip([], hull, undefined);
    expect(pool).toEqual([]);
    expect(complement.buckets).toEqual([]);
  });
});
