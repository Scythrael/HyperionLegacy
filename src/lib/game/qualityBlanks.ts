// Material Lines ML-5 Quality blanks (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md "ML-5 Quality
// blanks (call L7 a)"; USER ANSWERS 2026-10-19 "L7 crafted gear inherits quality: Yes, gear too (Recommended): quality
// blanks"). A crafted blank keeps the quality its job carried (ML-4's stamp, L6 "Weighted average + climb"), so the
// blank store is QUALITY-BUCKETED like the inventory: `blanks[blueprintKey]` is a Decimal[] indexed by quality (Q0 to
// Q5), grown lazily (a Q0-only blank is `[n]`). Inspecting takes the HIGHEST quality first and passes it to the mint
// (carry + the usual roll, craftOutputQuality). Pure helpers; the seams that read them live in tick.ts (startProcess,
// resolveProcesses, inspectBlank) and processSpeed.ts (grant).

import Decimal from "break_infinity.js";
import { QUALITY_TIERS, addItemQuality, itemTotal } from "./inventory";

export type BlankStore = Record<string, Decimal[]>;

// The test-only switch golden files use to prove what ML-5 moved (the PERSONNEL_ROSTERS_TRACK_SWITCH precedent;
// ml5Switch.fixture.ts). Live in the game, always. Off: a fabricate job stamps nothing on its blank (every blank lands
// at Q0, the pre-ML-5 game), so inspect carries nothing.
export const QUALITY_BLANKS_SWITCH = { live: true };

// Every blank of `key` held, all qualities together. Absent key: 0. Pure.
export function blankTotal(blanks: BlankStore, key: string): Decimal {
  return itemTotal(blanks, key);
}

// A quality as a bucket index: a whole number from Q0 to Q5 (anything else, Q0). Pure.
function bucketOf(quality: number | undefined): number {
  if (quality === undefined || !Number.isFinite(quality)) return 0;
  return Math.max(0, Math.min(QUALITY_TIERS - 1, Math.floor(quality)));
}

// `count` blanks of `key` added at `quality`. Returns a NEW store. Pure.
export function depositBlanks(blanks: BlankStore, key: string, count: Decimal | number, quality?: number): BlankStore {
  return addItemQuality(blanks, key, new Decimal(count), bucketOf(quality));
}

// The highest quality holding at least one whole blank of `key`, or null when none is held. Pure.
export function highestBlankQuality(blanks: BlankStore, key: string): number | null {
  const buckets = blanks[key];
  if (!buckets) return null;
  for (let q = buckets.length - 1; q >= 0; q--) {
    if (buckets[q].gte(1)) return q;
  }
  return null;
}

// One blank of `key` taken from `quality`. Returns a NEW store: the key goes when nothing is left (the pre-ML-5
// inspect's rule), and empty buckets above the highest held quality are trimmed, so a store never carries a
// trailing zero. Pure.
export function takeBlank(blanks: BlankStore, key: string, quality: number): BlankStore {
  const next = [...(blanks[key] ?? [])];
  next[quality] = (next[quality] ?? new Decimal(0)).minus(1);
  while (next.length > 1 && next[next.length - 1].lte(0)) next.pop();
  const out = { ...blanks };
  if (next.every((b) => b.lte(0))) delete out[key];
  else out[key] = next;
  return out;
}
