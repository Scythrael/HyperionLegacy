// Crew 0.14.0 (Phase 2): the per-hull COMMAND STRUCTURE template + pure cap readers.
//
// A hull's command structure is the nested cap system the complement fills into: a ship TOTAL
// complement cap -> per-DIVISION (profession) caps -> per-RANK caps, all ABSOLUTE counts,
// ROLE-WEIGHTED by the hull's spec. It is derived sensibly from each hull's SHIP_TYPES spec + tier
// (bigger/better hulls carry more crew; a combat hull weights Security/Engineering/Flight-Deck, a
// prospector weights Operations/Engineering/Science, a support hull weights Medical/Science, and the
// future explorer hull weights Science/Engineering/Medical atop a much larger total).
//
// RANK CAPS ARE INCLUSIVE / CASCADING FROM THE TOP: the cap at a rank bounds everyone at that rank OR
// HIGHER, so unused high-rank capacity rolls down to the lower ranks. Concretely a template with
// allocations {LtCmdr 1, Lt 2, Ensign 4} yields inclusive caps {>=LtCmdr 1, >=Lt 3, >=Ensign 7}, so
// with no LtCmdr/Lt crew you may still field up to 7 Ensigns. The lowest rank is bounded only by the
// division total (its inclusive cap == the sum of all the division's allocations).
//
// Everything here is PURE and DORMANT: nothing is wired into tick.ts, shipDerivedStats, or the UI.
// The auto-crew filler (autoCrew.ts) and the later "crew goes live" overlay read these caps. ALL
// numbers are FIRST-PASS + TUNABLE launch placeholders, the same posture as SHIP_TYPES' other stats.
// The crew-quarters module (not built yet) will later RAISE the total via a bonusCapacity hook (the
// reserved `crewStations` stat, model.ts RESERVED_STAT_KEYS); every total-cap reader already accepts
// it, defaulting to 0. See docs/plans/2026-09-22-crew-0.14.0-plan.md ("Rank ladder + command
// structure", Phase 2).

import type {
  CrewProfession,
  CrewRank,
  CrewSignature,
  CrewBucket,
  ShipComplement,
  ShipSpec,
  ShipTypeKey,
} from "./model";
import { SHIP_TYPES } from "./model";
import { CREW_RANK_ORDER } from "./crewRank";

// The six complement divisions in a fixed canonical order (matches the CrewProfession union). Used
// to distribute a hull's total cap across divisions and to iterate templates deterministically.
export const CREW_PROFESSIONS: readonly CrewProfession[] = [
  "security",
  "engineering",
  "science",
  "medical",
  "operations",
  "flightDeck",
];

// Per-SPEC base TOTAL complement cap at tier 1 (FIRST-PASS + TUNABLE). Scaled up by tier below.
// Lands each spec in the plan's stated bands (prospector 50-200, combat 50-500, explorer 1000s):
//   general    : a modest balanced hauler crew.
//   prospector : a small mining crew.
//   tactician  : a larger combat crew (grows sharply with the capital tiers).
//   explorer   : a very large crew (the future explorer hull; no SHIP_TYPES entry uses this spec yet,
//                but the template is ready for when that hull lands).
const SPEC_BASE_TOTAL: Record<ShipSpec, number> = {
  general: 30,
  prospector: 50,
  tactician: 80,
  explorer: 500,
};

// Tier multiplier on the base total: tier 1 == x1, and each higher tier adds +50% (tier 2 == x1.5,
// tier 3 == x2.0). So a tier-3 capital warship carries twice the crew of a tier-1 hull of the same
// spec. FIRST-PASS + TUNABLE.
function tierMultiplier(tier: number): number {
  return 1 + Math.max(0, tier - 1) * 0.5;
}

// ROLE WEIGHTS: how each spec splits its total cap across the six divisions (each row sums to ~1.0).
// This is where the hull's role shows up in the crew mix. FIRST-PASS + TUNABLE.
const SPEC_DIVISION_WEIGHTS: Record<ShipSpec, Record<CrewProfession, number>> = {
  // Balanced hauler: leans Operations (cargo/logistics) + Flight-Deck.
  general: { security: 0.1, engineering: 0.15, science: 0.1, medical: 0.1, operations: 0.3, flightDeck: 0.25 },
  // Mining crew: Operations + Engineering + Science do the work.
  prospector: { security: 0.1, engineering: 0.25, science: 0.25, medical: 0.1, operations: 0.2, flightDeck: 0.1 },
  // Warship: Security (boarding) + Engineering (damage control) + Flight-Deck (drones).
  tactician: { security: 0.3, engineering: 0.25, science: 0.05, medical: 0.1, operations: 0.1, flightDeck: 0.2 },
  // Explorer: Science + Engineering + Medical, with a big total (future hull).
  explorer: { security: 0.1, engineering: 0.25, science: 0.3, medical: 0.2, operations: 0.1, flightDeck: 0.05 },
};

// RANK PYRAMID: the fraction of a division's cap ALLOCATED at each rank (a strict pyramid, many low
// ranks and few high). Applied to each division cap, then floored, with the rounding remainder handed
// to the LOWEST ranks first so the sum lands EXACTLY on the division cap and the shape stays
// pyramidal. Indexed by CrewRank (1 Crewman .. 8 Lt Commander). Sums to 1.0. FIRST-PASS + TUNABLE.
const RANK_PYRAMID: Record<CrewRank, number> = {
  1: 0.34, // Crewman
  2: 0.24, // Petty Officer
  3: 0.15, // Chief
  4: 0.1, // Master Chief
  5: 0.07, // Cadet
  6: 0.05, // Ensign
  7: 0.03, // Lieutenant
  8: 0.02, // Lieutenant Commander
};

// One division's slice of the template: its absolute cap + the per-rank ALLOCATIONS (NOT inclusive;
// inclusiveRankCap sums these from the top).
export interface DivisionTemplate {
  cap: number;
  rankAllocations: Record<CrewRank, number>; // sums to `cap`
}

// A hull's full command-structure template: the total cap (before any module bonus) + a template per
// division. Derived purely from the hull's static SHIP_TYPES entry.
export interface CommandStructure {
  hullType: ShipTypeKey;
  total: number;
  divisions: Record<CrewProfession, DivisionTemplate>;
}

// Distribute a division cap across the 8 ranks by the pyramid: floor each share, then hand the
// leftover (cap - sum of floors, always < 8) to the LOWEST ranks one at a time. Guarantees a
// non-negative allocation per rank whose total is EXACTLY `cap`. Pure.
function allocateRanks(divisionCap: number): Record<CrewRank, number> {
  const alloc = {} as Record<CrewRank, number>;
  let assigned = 0;
  for (const rank of CREW_RANK_ORDER) {
    const n = Math.floor(divisionCap * RANK_PYRAMID[rank]);
    alloc[rank] = n;
    assigned += n;
  }
  let remainder = divisionCap - assigned;
  // Hand the remainder to the lowest ranks first (rank 1 upward), preserving the pyramid shape.
  for (const rank of CREW_RANK_ORDER) {
    if (remainder <= 0) break;
    alloc[rank] += 1;
    remainder -= 1;
  }
  return alloc;
}

// Memoized per-hull template (bonus-free). Depends ONLY on static SHIP_TYPES data + the constants
// above, so caching is safe and keeps the readers cheap; the module-scoped cache is never mutated
// after a first compute per hull. The quarters-module capacity bonus is applied at READ time (see
// complementTotalCap), never baked into the cached base.
const STRUCTURE_CACHE = new Map<ShipTypeKey, CommandStructure>();

// Build (or fetch the cached) command structure for a hull. Total = the spec base scaled by tier;
// division caps = round(weight * total); per-rank allocations = the pyramid within each division cap.
// Because division caps are rounded independently, their sum can land marginally above `total`, which
// simply makes the ship-total cap the (mild) binding ceiling: you cannot fill every division to its
// rounded cap at once. Pure (returns the shared cached instance; callers must not mutate it).
export function commandStructureForHull(hullType: ShipTypeKey): CommandStructure {
  const cached = STRUCTURE_CACHE.get(hullType);
  if (cached) return cached;

  const def = SHIP_TYPES[hullType];
  const total = Math.max(0, Math.round(SPEC_BASE_TOTAL[def.spec] * tierMultiplier(def.tier)));
  const weights = SPEC_DIVISION_WEIGHTS[def.spec];

  const divisions = {} as Record<CrewProfession, DivisionTemplate>;
  for (const profession of CREW_PROFESSIONS) {
    const cap = Math.max(0, Math.round(total * weights[profession]));
    divisions[profession] = { cap, rankAllocations: allocateRanks(cap) };
  }

  const structure: CommandStructure = { hullType, total, divisions };
  STRUCTURE_CACHE.set(hullType, structure);
  return structure;
}

// ============================================================================
// Pure cap readers
// ============================================================================

// The ship TOTAL complement cap for a hull, plus any module capacity bonus (the future crew-quarters
// module hook; the reserved `crewStations` stat). bonusCapacity defaults to 0 (no module), so today
// this returns the pure hull base. Pure.
export function complementTotalCap(hullType: ShipTypeKey, bonusCapacity = 0): number {
  return commandStructureForHull(hullType).total + Math.max(0, bonusCapacity);
}

// A division's absolute cap on a hull. Pure.
export function divisionCap(hullType: ShipTypeKey, profession: CrewProfession): number {
  return commandStructureForHull(hullType).divisions[profession].cap;
}

// A division's raw (non-inclusive) allocation AT exactly `rank`. Pure.
export function rankAllocation(hullType: ShipTypeKey, profession: CrewProfession, rank: CrewRank): number {
  return commandStructureForHull(hullType).divisions[profession].rankAllocations[rank];
}

// The INCLUSIVE per-rank cap: the maximum crew a division may hold at `rank` OR HIGHER = the sum of
// the division's allocations for every rank >= `rank`. This is the cascading cap: high-rank capacity
// unused by high ranks rolls down to the lower ranks. At the lowest rank it equals the division total.
// Pure.
export function inclusiveRankCap(hullType: ShipTypeKey, profession: CrewProfession, rank: CrewRank): number {
  const alloc = commandStructureForHull(hullType).divisions[profession].rankAllocations;
  let sum = 0;
  for (const r of CREW_RANK_ORDER) {
    if (r >= rank) sum += alloc[r];
  }
  return sum;
}

// ============================================================================
// Occupancy counters (pure reads over a complement's buckets)
// ============================================================================

// Total headcount currently in a division across a complement's buckets. Pure.
export function countInDivision(buckets: CrewBucket[], profession: CrewProfession): number {
  let n = 0;
  for (const b of buckets) if (b.profession === profession) n += b.count;
  return n;
}

// Headcount in a division at `rank` OR HIGHER (the quantity the inclusive rank cap bounds). Pure.
export function countAtRankOrHigher(buckets: CrewBucket[], profession: CrewProfession, rank: CrewRank): number {
  let n = 0;
  for (const b of buckets) if (b.profession === profession && b.rank >= rank) n += b.count;
  return n;
}

// ============================================================================
// Remaining-capacity readers + the add gate
// ============================================================================

// Total headcount across a complement (all divisions). Small local sum so this module has no import
// cycle with crew.ts; identical to crew.ts totalCrew. Pure.
function totalHeadcount(buckets: CrewBucket[]): number {
  let n = 0;
  for (const b of buckets) n += b.count;
  return n;
}

// How many MORE crew of any kind the ship can hold before hitting the TOTAL cap. Never negative.
export function remainingTotalCapacity(complement: ShipComplement, hullType: ShipTypeKey, bonusCapacity = 0): number {
  return Math.max(0, complementTotalCap(hullType, bonusCapacity) - totalHeadcount(complement.buckets));
}

// How many MORE crew a division can hold before hitting its DIVISION cap. Never negative.
export function remainingDivisionCapacity(
  complement: ShipComplement,
  hullType: ShipTypeKey,
  profession: CrewProfession,
): number {
  return Math.max(0, divisionCap(hullType, profession) - countInDivision(complement.buckets, profession));
}

// How many MORE crew of exactly `rank` (in `profession`) the INCLUSIVE rank caps permit. Because a
// rank-R crewmember counts toward the cap at every threshold T in [1..R], the answer is the TIGHTEST
// of those thresholds: min over T<=R of (inclusiveRankCap(T) - countAtRankOrHigher(T)). Never
// negative. Ignores the division/total ceilings (remainingCapacityForSignature folds those in). Pure.
export function remainingRankCapacity(
  complement: ShipComplement,
  hullType: ShipTypeKey,
  profession: CrewProfession,
  rank: CrewRank,
): number {
  let limit = Infinity;
  for (const t of CREW_RANK_ORDER) {
    if (t > rank) continue; // a rank-R crewmember only counts toward thresholds T <= R
    const room = inclusiveRankCap(hullType, profession, t) - countAtRankOrHigher(complement.buckets, profession, t);
    if (room < limit) limit = room;
  }
  return Math.max(0, limit === Infinity ? 0 : limit);
}

// The single workhorse: how many crew of `signature` can be added to `complement` on `hullType` right
// now, respecting the TOTAL, DIVISION, and INCLUSIVE-RANK caps together (the tightest wins). Never
// negative. autoCrew and canAddToComplement are built on this. Pure.
export function remainingCapacityForSignature(
  complement: ShipComplement,
  hullType: ShipTypeKey,
  signature: CrewSignature,
  bonusCapacity = 0,
): number {
  return Math.min(
    remainingTotalCapacity(complement, hullType, bonusCapacity),
    remainingDivisionCapacity(complement, hullType, signature.profession),
    remainingRankCapacity(complement, hullType, signature.profession, signature.rank),
  );
}

// Whether `count` crew of `signature` may be added to `complement` on `hullType` without breaching the
// total, division, or inclusive-rank caps. Defaults to a single crewmember. A count of zero or less is
// vacuously allowed (adding nothing never breaches a cap). Pure.
export function canAddToComplement(
  complement: ShipComplement,
  hullType: ShipTypeKey,
  signature: CrewSignature,
  count = 1,
  bonusCapacity = 0,
): boolean {
  if (count <= 0) return true;
  return remainingCapacityForSignature(complement, hullType, signature, bonusCapacity) >= count;
}
