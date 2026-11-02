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
// A crew-quarters module RAISES the total via the bonusCapacity hook (crewModules.ts quartersCapacityBonus: the
// module's own berths plus its Crew Stations line); since WR-7 (OC-D7) the bonus also spreads across the division and
// rank caps by the hull's role weights (commandStructureWithBonus). Every reader defaults it to 0. CP-5 (Task 24): a hull
// may carry its own total and division mix (SHIP_TYPES complementCap / complementDivisionWeights; the Eir's 900 berths and
// the leans), and a complement over any cap keeps its crew and takes no more (complementOverCap reads that state). See
// docs/plans/2026-09-22-crew-0.14.0-plan.md ("Rank ladder + command structure", Phase 2).

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
// CP-5: keyed by the hull AND the per-hull caps switch (below), so a test that turns the switch off never reads a template
// cached with it on (and the reverse).
const STRUCTURE_CACHE = new Map<string, CommandStructure>();

// Complement plan CP-5 (per-hull crew caps; user 2026-10-16 OC-5 "Eir 900, Orion/Aurora 750 (Recommended)" and the
// division leans, OC-6 "Never evict (Recommended)"): a hull's own SHIP_TYPES complementCap / complementDivisionWeights
// replace the spec template's total / role weights. `live` is a test seam only (the golden files' *Switch.fixture.ts
// turn it off to prove what CP-5 moved); the game never writes it.
export const HULL_CREW_CAPS_SWITCH = { live: true };

// The hull's TOTAL berths before any quarters module: its own complementCap (CP-5), else the spec base x tier. Pure.
function hullBaseTotal(hullType: ShipTypeKey): number {
  const def = SHIP_TYPES[hullType];
  if (HULL_CREW_CAPS_SWITCH.live && def.complementCap !== undefined) return Math.max(0, Math.round(def.complementCap));
  return specBaseTotal(hullType);
}

// The spec template's total before any quarters module: the spec base x tier (the pre-CP-5 total). Pure.
function specBaseTotal(hullType: ShipTypeKey): number {
  const def = SHIP_TYPES[hullType];
  return Math.max(0, Math.round(SPEC_BASE_TOTAL[def.spec] * tierMultiplier(def.tier)));
}

// The hull's division mix: its own complementDivisionWeights (CP-5), else the spec's role weights. Pure.
function hullDivisionWeights(hullType: ShipTypeKey): Record<CrewProfession, number> {
  const def = SHIP_TYPES[hullType];
  if (HULL_CREW_CAPS_SWITCH.live && def.complementDivisionWeights !== undefined) return def.complementDivisionWeights;
  return SPEC_DIVISION_WEIGHTS[def.spec];
}

const capsKey = (hullType: ShipTypeKey): string => `${hullType}|${HULL_CREW_CAPS_SWITCH.live ? 1 : 0}`;

// Build (or fetch the cached) command structure for a hull. Total = the spec base scaled by tier;
// division caps = round(weight * total); per-rank allocations = the pyramid within each division cap.
// Because division caps are rounded independently, their sum can land marginally above `total`, which
// simply makes the ship-total cap the (mild) binding ceiling: you cannot fill every division to its
// rounded cap at once. Pure (returns the shared cached instance; callers must not mutate it).
export function commandStructureForHull(hullType: ShipTypeKey): CommandStructure {
  const key = capsKey(hullType);
  const cached = STRUCTURE_CACHE.get(key);
  if (cached) return cached;
  const structure = buildStructure(hullType, 0);
  STRUCTURE_CACHE.set(key, structure);
  return structure;
}

// The template on `total` = the hull base + `bonus`: the division caps are the role weights of that total, each split
// into ranks by the pyramid. Pure.
// CP-5: the hull's own total and division mix when SHIP_TYPES gives them (hullBaseTotal / hullDivisionWeights).
// CP-5 review (user 2026-11-02, "No division ever shrinks (Recommended)"): a hull with its own caps also keeps, in every
// division and at every rank, at least the seats the spec template gives it at the same quarters bonus, so no existing
// ship turns over cap from the new caps (with a quarters module installed too). The lean comes only from where the
// extra seats go.
function buildStructure(hullType: ShipTypeKey, bonus: number, hullCaps: boolean = HULL_CREW_CAPS_SWITCH.live): CommandStructure {
  const def = SHIP_TYPES[hullType];
  const own = hullCaps && (def.complementCap !== undefined || def.complementDivisionWeights !== undefined);
  const total = (own ? hullBaseTotal(hullType) : specBaseTotal(hullType)) + bonus;
  const weights = own ? hullDivisionWeights(hullType) : SPEC_DIVISION_WEIGHTS[def.spec];

  // WR-7 review (OC-D7): the pyramid's floors are not monotone in the cap (a bigger cap can floor a high rank lower),
  // so a bonus template keeps, at every rank, at least the seats the hull's own template has (never fewer).
  const base = bonus > 0 ? (hullCaps === HULL_CREW_CAPS_SWITCH.live ? commandStructureForHull(hullType) : buildStructure(hullType, 0, hullCaps)) : null;
  const spec = own ? buildStructure(hullType, bonus, false) : null;
  const divisions = {} as Record<CrewProfession, DivisionTemplate>;
  for (const profession of CREW_PROFESSIONS) {
    let alloc = allocateRanks(Math.max(0, Math.round(total * weights[profession])));
    if (base) alloc = atLeastInclusive(alloc, base.divisions[profession].rankAllocations);
    if (spec) alloc = atLeastInclusive(alloc, spec.divisions[profession].rankAllocations);
    let cap = 0;
    for (const r of CREW_RANK_ORDER) cap += alloc[r];
    divisions[profession] = { cap, rankAllocations: alloc };
  }
  return { hullType, total, divisions };
}

// WR-7 review (OC-D7, "installing quarters never removes a seat"): allocations whose INCLUSIVE caps (seats at a rank or
// higher) are, rank by rank, the larger of `alloc`'s and `floor`'s. The max of two non-increasing inclusive ladders is
// non-increasing, and its bottom is the larger total, so the result is a valid allocation summing to max(totals). Pure.
function atLeastInclusive(alloc: Record<CrewRank, number>, floor: Record<CrewRank, number>): Record<CrewRank, number> {
  const top = [...CREW_RANK_ORDER].reverse();
  const inclusive = new Map<CrewRank, number>();
  let a = 0;
  let f = 0;
  for (const r of top) {
    a += alloc[r];
    f += floor[r];
    inclusive.set(r, Math.max(a, f));
  }
  const out = {} as Record<CrewRank, number>;
  let above = 0;
  for (const r of top) {
    out[r] = inclusive.get(r)! - above;
    above = inclusive.get(r)!;
  }
  return out;
}

// WR-7 (OC-D7, user 2026-10-15 "Spread across divisions"; B22 fixed): the command structure of a hull whose quarters
// module adds `bonusCapacity` berths. The bonus raises the total AND spreads across the division caps by the hull's
// role weights (the division and rank caps are the template on the larger total), so a quarters module's berths can
// actually be filled (before WR-7 only the total rose and the division caps still bound: +0 or +1 berth). A bonus of
// 0 or less is the hull's own cached template (byte-identical for every ship without a quarters module). Cached per
// (hull, bonus). Pure (returns a shared instance; callers must not mutate it).
const BONUS_STRUCTURE_CACHE = new Map<string, CommandStructure>();
export function commandStructureWithBonus(hullType: ShipTypeKey, bonusCapacity = 0): CommandStructure {
  const bonus = Math.max(0, Math.round(Number.isFinite(bonusCapacity) ? bonusCapacity : 0));
  if (bonus === 0) return commandStructureForHull(hullType);
  const key = `${capsKey(hullType)}:${bonus}`;
  const cached = BONUS_STRUCTURE_CACHE.get(key);
  if (cached) return cached;
  const structure = buildStructure(hullType, bonus);
  BONUS_STRUCTURE_CACHE.set(key, structure);
  return structure;
}

// ============================================================================
// Pure cap readers
// ============================================================================

// The ship TOTAL complement cap for a hull, plus any quarters module capacity bonus (crewModules.ts
// quartersCapacityBonus). bonusCapacity defaults to 0 (no module): the pure hull base. Pure.
export function complementTotalCap(hullType: ShipTypeKey, bonusCapacity = 0): number {
  return commandStructureForHull(hullType).total + Math.max(0, bonusCapacity);
}

// A division's absolute cap on a hull (WR-7: with a quarters bonus spread by the role weights). Pure.
export function divisionCap(hullType: ShipTypeKey, profession: CrewProfession, bonusCapacity = 0): number {
  return commandStructureWithBonus(hullType, bonusCapacity).divisions[profession].cap;
}

// A division's raw (non-inclusive) allocation AT exactly `rank` (WR-7: with a quarters bonus). Pure.
export function rankAllocation(hullType: ShipTypeKey, profession: CrewProfession, rank: CrewRank, bonusCapacity = 0): number {
  return commandStructureWithBonus(hullType, bonusCapacity).divisions[profession].rankAllocations[rank];
}

// The INCLUSIVE per-rank cap: the maximum crew a division may hold at `rank` OR HIGHER = the sum of
// the division's allocations for every rank >= `rank`. This is the cascading cap: high-rank capacity
// unused by high ranks rolls down to the lower ranks. At the lowest rank it equals the division total.
// WR-7: with a quarters bonus spread by the role weights. Pure.
export function inclusiveRankCap(hullType: ShipTypeKey, profession: CrewProfession, rank: CrewRank, bonusCapacity = 0): number {
  const alloc = commandStructureWithBonus(hullType, bonusCapacity).divisions[profession].rankAllocations;
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

// How many MORE crew a division can hold before hitting its DIVISION cap (WR-7: with the quarters bonus spread across
// the divisions). Never negative.
export function remainingDivisionCapacity(
  complement: ShipComplement,
  hullType: ShipTypeKey,
  profession: CrewProfession,
  bonusCapacity = 0,
): number {
  return Math.max(0, divisionCap(hullType, profession, bonusCapacity) - countInDivision(complement.buckets, profession));
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
  bonusCapacity = 0,
): number {
  let limit = Infinity;
  for (const t of CREW_RANK_ORDER) {
    if (t > rank) continue; // a rank-R crewmember only counts toward thresholds T <= R
    const room = inclusiveRankCap(hullType, profession, t, bonusCapacity) - countAtRankOrHigher(complement.buckets, profession, t);
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
    remainingDivisionCapacity(complement, hullType, signature.profession, bonusCapacity),
    remainingRankCapacity(complement, hullType, signature.profession, signature.rank, bonusCapacity),
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

// ============================================================================
// Over cap (CP-5, OC-6 "Never evict")
// ============================================================================

// How far a complement sits over its caps. Nothing in the game removes crew for being over: a cap only stops the fill
// (auto-crew, transfer, rosters), so a complement can be over after a quarters module comes off (or is swapped for one
// with fewer berths), and it stays over until crew leave by the player's hand. The CP-5 hull caps never shrink a seat
// (buildStructure floors them to the spec template), so they put no ship over.
//   totalOver     : headcount past the ship's total berths (0 when within).
//   divisions[p]  : the division's excess, the larger of its headcount past the division cap and its worst inclusive
//                   rank threshold (crew at a rank or higher past that threshold's cap); 0 when within.
//   divisionOver[p]: just the headcount past the division cap (so a reader can tell a full division from a rank).
export interface ComplementOverCap {
  totalOver: number;
  divisions: Record<CrewProfession, number>;
  divisionOver: Record<CrewProfession, number>;
  any: boolean;
}

// The over-cap reading for `buckets` on `hullType` with a quarters bonus. Callers pass the ship's OCCUPANCY (its bulk
// plus every notable assigned to it, the fill rule). Pure.
export function complementOverCap(buckets: CrewBucket[], hullType: ShipTypeKey, bonusCapacity = 0): ComplementOverCap {
  const totalOver = Math.max(0, totalHeadcount(buckets) - complementTotalCap(hullType, bonusCapacity));
  const divisions = {} as Record<CrewProfession, number>;
  const divisionOver = {} as Record<CrewProfession, number>;
  let any = totalOver > 0;
  for (const p of CREW_PROFESSIONS) {
    const over = Math.max(0, countInDivision(buckets, p) - divisionCap(hullType, p, bonusCapacity));
    let worst = over;
    for (const r of CREW_RANK_ORDER) {
      const rankOver = countAtRankOrHigher(buckets, p, r) - inclusiveRankCap(hullType, p, r, bonusCapacity);
      if (rankOver > worst) worst = rankOver;
    }
    divisions[p] = worst;
    divisionOver[p] = over;
    if (worst > 0) any = true;
  }
  return { totalOver, divisions, divisionOver, any };
}
