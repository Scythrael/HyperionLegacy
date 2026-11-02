// Crew 0.14.0 (Phase 2): the passive AUTO-CREW filler (pure, DORMANT).
//
// The passive default (plan "Assignment"): a ship's complement auto-fills from the unassigned pool
// TOP-RANK-DOWN, silently, up to the hull's command-structure caps, with zero micromanagement.
// autoCrewShip is the PURE function that does exactly that: it moves crew counts from the pool into a
// ship's complement, filling the highest-rank slots first and cascading to the lowest, backfilling the
// remainder, and NEVER breaching the total / division / inclusive-rank caps.
//
// WHY TOP-RANK-DOWN MATCHES THE INCLUSIVE CAPS: a rank-R crewmember counts toward the inclusive cap at
// every threshold <= R, so if the lower ranks filled first they could exhaust the shared capacity a
// higher rank needs. Filling from rank 8 downward lets each rank claim its inclusive headroom before
// the ranks beneath it, so the scarce high-rank capacity is used for actual high-rank crew and
// whatever is left cascades down. remainingCapacityForSignature (commandStructure.ts) already folds
// all three caps together, so the filler just moves min(available, remaining) per bucket.
//
// DETERMINISTIC: no RNG. The result depends only on the pool's bucket ORDER (which the crew.ts
// primitives keep stable) and the caps, so a given (pool, hull, complement) always fills the same way.
// PURE + DORMANT: nothing here is wired into the tick or ship stats. The later "crew goes live" phase
// calls this as ships come online. See docs/plans/2026-09-22-crew-0.14.0-plan.md ("Engine seams" 5).

import type { CrewBucket, ShipComplement, ShipTypeKey } from "./model";
import { CREW_RANK_ORDER } from "./crewRank";
import { moveBetweenBucketLists } from "./crew";
import { remainingCapacityForSignature } from "./commandStructure";

// Auto-fill a ship's complement from the pool, TOP-RANK-DOWN, within the hull's caps.
//
// Returns { pool, complement }: the pool with the moved crew removed and the ship's complement with
// them added. The complement's `mode` is preserved from `existingComplement` (auto-crew fills whatever
// is there; it does not change the passive/active toggle). `bonusCapacity` is the future crew-quarters
// module hook (raises the total cap), defaulting to 0.
//
// Never mutates either input. No crew are created or destroyed: every head added to the complement
// left the pool (moveBetweenBucketLists moves exactly what it removes).
export function autoCrewShip(
  complementPool: CrewBucket[],
  hullType: ShipTypeKey,
  existingComplement: ShipComplement | undefined,
  bonusCapacity = 0,
): { pool: CrewBucket[]; complement: ShipComplement } {
  const mode = existingComplement?.mode ?? "passive";
  let pool = complementPool.map((b) => ({ ...b }));
  let buckets = (existingComplement?.buckets ?? []).map((b) => ({ ...b }));

  // Iterate ranks from the TOP (8, Lt Commander) down to the bottom (1, Crewman). Within each rank,
  // walk the pool buckets in their stable order and pull as many as the caps allow. We re-scan the
  // pool per rank because moves above have shrunk it; that keeps the loop simple and correct.
  for (let i = CREW_RANK_ORDER.length - 1; i >= 0; i -= 1) {
    const rank = CREW_RANK_ORDER[i];
    // Snapshot the pool bucket signatures at this rank; moves mutate `pool`'s reference below.
    const atRank = pool.filter((b) => b.rank === rank);
    for (const bucket of atRank) {
      const complement: ShipComplement = { buckets, mode };
      const room = remainingCapacityForSignature(complement, hullType, bucket, bonusCapacity);
      if (room <= 0) continue;
      // How many of THIS signature are still in the pool (a move above may have taken some).
      const available = pool
        .filter(
          (b) =>
            b.profession === bucket.profession &&
            b.rarity === bucket.rarity &&
            b.rank === bucket.rank &&
            b.race === bucket.race &&
            b.buff1Id === bucket.buff1Id &&
            (b.buff2Id ?? null) === (bucket.buff2Id ?? null) &&
            (b.buff3Id ?? null) === (bucket.buff3Id ?? null),
        )
        .reduce((sum, b) => sum + b.count, 0);
      const moveCount = Math.min(room, available);
      if (moveCount <= 0) continue;
      const moved = moveBetweenBucketLists(pool, buckets, bucket, moveCount);
      pool = moved.from;
      buckets = moved.to;
    }
  }

  return { pool, complement: { buckets, mode } };
}
