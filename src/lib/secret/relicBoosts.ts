// relicBoosts.ts: the main game's relics, read as the secret game's relic boosts (0.14.0, Relics v2 R2-10).
//
// PURE and ONE-WAY. It reads the main save's Museum v2 record and returns plain numbers; it never writes
// the main state, and nothing in the main game reads it back (two-way stays "Only via milestones", user
// 2026-10-22). The engine never imports this file: the runtime passes the result in as a snapshot
// (SecretState.relicBoosts), so live play, offline catch-up and the pacing sim all read the same input.
//
// Per relic type (config.ts RELIC_BOOSTS, the user's table): every identified copy in every region tier
// counts, LIVE counts (not the frozen soft-cap snapshot). A copy past its tier's RELIC_SOFT_CAP (relics.ts,
// 1,000 per tier) counts RELIC_PAST_CAP_WEIGHT (5x). Which copies are past the cap is read off the tier's
// snapshot, which holds exactly the record at the cap (withSoftCapSnapshot): regular = the snapshot's count,
// past = live minus that. A tier with no snapshot has nothing past the cap (the main game reads it the
// same way). Then boost = 1 + perCopy x diminishing(weighted, knee): the shared D23 curve, no cap, no
// compounding. Exceptional pieces map to no lever (the table names the 17 general types only).

import type { MuseumV2, RegionTierKey } from "../game/model";
import { diminishing } from "../game/diminishing";
import { RELIC_BOOSTS, RELIC_PAST_CAP_WEIGHT, type RelicBoosts, type RelicLever } from "./config";

const TIER_KEYS: readonly RegionTierKey[] = ["1", "2", "3", "4", "5", "6", "7"];

function count(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// Weighted copies per relic type id: regular copies plus RELIC_PAST_CAP_WEIGHT x copies past each
// tier's soft cap, summed over the region tiers. Types with no copies are left out. Pure.
export function relicWeightedCopies(museum: MuseumV2 | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!museum) return out;
  for (const key of TIER_KEYS) {
    const live = museum.general?.[key];
    if (!live) continue;
    const frozen = museum.frozen?.[key];
    for (const def of RELIC_BOOSTS) {
      const n = count(live[def.relicId]);
      if (n === 0) continue;
      const regular = frozen ? Math.min(n, count(frozen[def.relicId])) : n;
      out[def.relicId] = (out[def.relicId] ?? 0) + regular + RELIC_PAST_CAP_WEIGHT * (n - regular);
    }
  }
  return out;
}

// One lever's boost from its weighted copies. Exactly 1 at none. Pure.
export function relicBoostFor(lever: RelicLever, weighted: number): number {
  const def = RELIC_BOOSTS.find((d) => d.lever === lever)!;
  return weighted > 0 ? 1 + def.perCopy * diminishing(weighted, def.knee) : 1;
}

// The snapshot the secret runtime takes: one multiplier per lever with any copies, or undefined when the
// Museum holds none of the 17 types (so a relic-free minigame carries no field at all). Pure.
export function relicBoostsFromWeighted(weighted: Readonly<Record<string, number>>): RelicBoosts | undefined {
  const out: Partial<Record<RelicLever, number>> = {};
  let any = false;
  for (const def of RELIC_BOOSTS) {
    const w = weighted[def.relicId] ?? 0;
    if (!(w > 0)) continue;
    out[def.lever] = relicBoostFor(def.lever, w);
    any = true;
  }
  return any ? out : undefined;
}

export function relicBoostsFromMuseum(museum: MuseumV2 | undefined): RelicBoosts | undefined {
  return relicBoostsFromWeighted(relicWeightedCopies(museum));
}

// Two snapshots hold the same multipliers (the runtime keeps its old one then, so nothing republishes).
export function sameRelicBoosts(a: RelicBoosts | undefined, b: RelicBoosts | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return RELIC_BOOSTS.every((d) => a[d.lever] === b[d.lever]);
}
