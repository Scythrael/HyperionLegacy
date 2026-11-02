// Crew 0.14.0 (Phase 0): PURE, side-effect-free bucket primitives for the crew data model.
//
// These are the mechanical building blocks the later crew phases compose: adding and removing
// counts, moving counts between bucket lists (pool <-> ship complement), coalescing duplicate
// signatures, totalling headcount, and the rollup SIGNATURE that will feed ship stats. NOTHING
// here is wired into the tick, and NO gameplay CONTENT lives here: the concrete contribution
// catalog (what each signature actually buffs) and the seeded name/race/gender generator arrive
// in Phase 0.5. Everything below is content-agnostic on purpose, which is why the rollup is a
// higher-order function that takes the contribution mapping as a parameter rather than hardcoding
// any numbers. See docs/plans/2026-09-22-crew-0.14.0-plan.md ("Data model", Phase 0).
//
// Every function is pure: it reads its inputs and returns fresh values, never mutating an input
// list or bucket in place. That keeps these safe to call from the tick (live and offline share
// one path) and trivial to unit-test.

import type { CrewBucket, CrewRace, CrewSignature, NotableCrewMember } from "./model";
import { getCrewBuffById } from "./crewBuffs";
import { CREW_RACES, CREW_GENDERS } from "./crewRaces";
import { crewRarityMultiplier } from "./crewRarity";
import { rankMagnitudeFactor } from "./crewRank";
import { makeRng } from "./combat/rng";

// A stable, order-independent key for a signature. Two buckets share a key IFF they contribute
// identically to every rollup (same profession, rarity, rank, race, and BOTH rolled buffs). The
// separator is a character that cannot appear in any of the enum/string fields we join, so the
// key round-trips uniquely. `count` is deliberately NOT part of the key (it is the value, not the
// identity). buff2Id is optional (null at low ranks); the empty string is a safe sentinel for null
// because a real buff id is never empty, so a null-buff2 bucket never collides with a real-buff2 one.
// Wiring WR-9 (OC-E12): a third buff joins the key only when present, so every key of a two-buff signature (every
// bucket rolled before WR-9) is exactly what it was (its manifest names included).
export function signatureKey(sig: CrewSignature): string {
  const parts = [sig.profession, sig.rarity, String(sig.rank), sig.race, sig.buff1Id, sig.buff2Id ?? ""];
  if (sig.buff3Id !== undefined) parts.push(sig.buff3Id);
  return parts.join("|");
}

// The signature a notable crew member carries (the bucket it graduated from). A notable assigned to a ship holds ONE
// complement slot of exactly this signature (its rank and division) on top of the fungible bulk. Pure.
export function notableSignature(n: NotableCrewMember): CrewSignature {
  return { profession: n.profession, rarity: n.rarity, rank: n.rank, race: n.race, buff1Id: n.buff1Id, buff2Id: n.buff2Id, ...(n.buff3Id !== undefined ? { buff3Id: n.buff3Id } : {}) };
}

// Returns true when two signatures are the same bucket identity.
function sameSignature(a: CrewSignature, b: CrewSignature): boolean {
  return signatureKey(a) === signatureKey(b);
}

// Copies the pure-signature fields off any bucket/signature into a fresh signature object, so a
// returned bucket never aliases a caller's input.
function signatureOf(sig: CrewSignature): CrewSignature {
  return {
    profession: sig.profession,
    rarity: sig.rarity,
    rank: sig.rank,
    race: sig.race,
    buff1Id: sig.buff1Id,
    buff2Id: sig.buff2Id,
    ...(sig.buff3Id !== undefined ? { buff3Id: sig.buff3Id } : {}),
  };
}

// Returns a NEW list with `count` crew of `sig` added: merged into an existing same-signature
// bucket, or appended as a new bucket if none exists. A count of zero or less is a no-op (returns
// a shallow copy so callers can rely on getting a fresh list). Never mutates `list` or its buckets.
export function addToBucketList(list: CrewBucket[], sig: CrewSignature, count: number): CrewBucket[] {
  if (count <= 0) return list.map((b) => ({ ...b }));
  let merged = false;
  const next = list.map((b) => {
    if (!merged && sameSignature(b, sig)) {
      merged = true;
      return { ...b, count: b.count + count };
    }
    return { ...b };
  });
  if (!merged) next.push({ ...signatureOf(sig), count });
  return next;
}

// Returns a NEW list with `count` crew of `sig` removed. Clamps so a bucket's count never goes
// below zero (removing more than present empties it, never negative), and PRUNES any bucket that
// hits zero. A count of zero or less is a no-op copy. Never mutates `list` or its buckets.
export function removeFromBucketList(list: CrewBucket[], sig: CrewSignature, count: number): CrewBucket[] {
  if (count <= 0) return list.map((b) => ({ ...b }));
  const next: CrewBucket[] = [];
  let removed = false;
  for (const b of list) {
    if (!removed && sameSignature(b, sig)) {
      removed = true;
      const remaining = b.count - count; // clamp at zero below
      if (remaining > 0) next.push({ ...b, count: remaining });
      // remaining <= 0: bucket pruned (dropped from the output)
      continue;
    }
    next.push({ ...b });
  }
  return next;
}

// Moves at most what `from` holds: transfers min(count, available in `from`) crew of `sig` out of
// `from` and into `to`. Returns fresh {from, to} lists; never mutates either input. The moved
// amount is exactly what left `from`, so no crew are created or destroyed.
export function moveBetweenBucketLists(
  from: CrewBucket[],
  to: CrewBucket[],
  sig: CrewSignature,
  count: number,
): { from: CrewBucket[]; to: CrewBucket[] } {
  if (count <= 0) {
    return { from: from.map((b) => ({ ...b })), to: to.map((b) => ({ ...b })) };
  }
  const available = from
    .filter((b) => sameSignature(b, sig))
    .reduce((sum, b) => sum + b.count, 0);
  const moved = Math.min(count, available);
  if (moved <= 0) {
    return { from: from.map((b) => ({ ...b })), to: to.map((b) => ({ ...b })) };
  }
  return {
    from: removeFromBucketList(from, sig, moved),
    to: addToBucketList(to, sig, moved),
  };
}

// Merges duplicate-signature buckets into one and drops any bucket whose total is zero or less.
// Returns a NEW list; never mutates the input. Order follows first appearance of each signature.
export function coalesceBuckets(list: CrewBucket[]): CrewBucket[] {
  const order: string[] = [];
  const byKey = new Map<string, CrewBucket>();
  for (const b of list) {
    const key = signatureKey(b);
    const existing = byKey.get(key);
    if (existing) {
      existing.count += b.count;
    } else {
      order.push(key);
      byKey.set(key, { ...signatureOf(b), count: b.count });
    }
  }
  const out: CrewBucket[] = [];
  for (const key of order) {
    const b = byKey.get(key)!;
    if (b.count > 0) out.push(b);
  }
  return out;
}

// Total headcount across a bucket list (sum of counts). O(distinct buckets), not O(headcount).
export function totalCrew(list: CrewBucket[]): number {
  return list.reduce((sum, b) => sum + b.count, 0);
}

// The rollup SIGNATURE: sum contributionForSignature(sig) * count across every bucket into one
// modifier map. This is the shape that will feed ship stats. It is HIGHER-ORDER on purpose: the
// real per-signature contribution mapping is Phase 0.5 content, so it is passed in rather than
// hardcoded here. Each contribution is a { statKey: number } map; the rollup multiplies each of a
// signature's contributions by that bucket's count and accumulates by stat key. Returns a fresh
// map; never mutates inputs. An empty list (or contributions with no keys) yields {}.
export function rollupBuckets(
  buckets: CrewBucket[],
  contributionForSignature: (sig: CrewSignature) => Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of buckets) {
    if (b.count <= 0) continue;
    const contribution = contributionForSignature(b);
    for (const key of Object.keys(contribution)) {
      out[key] = (out[key] ?? 0) + contribution[key] * b.count;
    }
  }
  return out;
}

// ============================================================================
// Phase 0.5 CONTENT: the real per-signature contribution + the inclusive name generator.
// These wire the Phase 0.5 catalog modules (crewBuffs / crewRaces / crewRarity / crewRank) into the
// content-agnostic primitives above. Still fully PURE and DORMANT: nothing here is wired into
// shipDerivedStats, the tick, or the UI. A later phase applies the rollup output as a ship-stat
// overlay (plan "Engine seams", seam 1).
// ============================================================================

// The real per-signature contribution: the { statKey: number } map ONE crewmember of this signature
// adds to a ship. It sums the crewmember's buff1 + (if present) buff2 effects, PLUS its racial
// per-head (complement) magnitude, each scaled MULTIPLICATIVELY by the rarity multiplier and a
// modest rank factor. Multiplicative, never additive: a 0.20 base buff at stellar (x1.35) rolls to
// ~0.27, not 5.20. `rollupBuckets(buckets, contributionForSignature)` multiplies this by each
// bucket's `count` to produce the ship-level modifier map. Pure: reads only static catalogs.
export function contributionForSignature(sig: CrewSignature): Record<string, number> {
  const scale = crewRarityMultiplier(sig.rarity) * rankMagnitudeFactor(sig.rank);
  const out: Record<string, number> = {};

  const applyBuff = (buffId: string | null): void => {
    if (buffId === null) return;
    const def = getCrewBuffById(buffId);
    if (!def) return; // unknown id contributes nothing (defensive; content is closed today)
    out[def.statKey] = (out[def.statKey] ?? 0) + def.magnitude * scale;
  };
  applyBuff(sig.buff1Id);
  applyBuff(sig.buff2Id);
  applyBuff(sig.buff3Id ?? null); // WR-9 (OC-E12): a top rank's third buff

  // Racial per-head (complement) magnitude, scaled the same way.
  const raceDef = CREW_RACES[sig.race];
  if (raceDef) {
    const rb = raceDef.racialBonus;
    out[rb.statKey] = (out[rb.statKey] ?? 0) + rb.complement * scale;
  }

  return out;
}

// A generated, purely cosmetic crew identity (name + gender). Deterministic in (race, seed, index):
// the same three inputs always yield the same identity, so a manifest view is stable across renders
// without persisting anything. Uses the shared Mulberry32 PRNG seeded from a mix of `seed` and
// `index` so distinct rows in the same manifest decorrelate. Pulls names from the race's own pools
// (humans share one diverse pool; species use coined pools) and gender from the global set. NEVER
// persisted; flavor only.
export function generateCrewIdentity(race: CrewRace, seed: number, index: number): { name: string; gender: string } {
  const raceDef = CREW_RACES[race];
  // Mix seed + index into one uint32 so row `index` gives an independent draw off the same `seed`.
  const mixed = (Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ ((index + 1) >>> 0)) >>> 0;
  const rng = makeRng(mixed);
  const given = raceDef.names.given[rng.nextInt(raceDef.names.given.length)];
  const family = raceDef.names.family[rng.nextInt(raceDef.names.family.length)];
  const gender = CREW_GENDERS[rng.nextInt(CREW_GENDERS.length)];
  return { name: `${given} ${family}`, gender };
}
