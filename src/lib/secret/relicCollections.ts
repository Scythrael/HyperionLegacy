// relicCollections.ts: realistic 0.14.0 relic collections for the R2-10 pacing pins and goldens. Test-only.
//
// Copies per type come from the real drop tables: a blank's rarity from RELIC_BLANK_WEIGHTS[tier], the
// revealed band from RELIC_BAND_ODDS[tier][blank band], then an even split over the band's types (the
// site bias favors each site's own types, so over many sites it averages out). Deposits go through the
// real museumDepositGeneral, interleaved, so a tier that crosses its 1,000 soft cap snapshots a fair mix.
//
// TYPICAL (the first few weeks of 0.14.0): three weeks with one explorer out about 16 hours a day at
// EXPEDITION_RELIC_BLANKS_PER_HOUR (0.5 an hour: 168 blanks), plus two Tier I short-range missions around
// the clock at their rate (0.08x: 0.04 an hour each, about 40 standard blanks): about 208 Tier I relics.
// HEAVY (a dedicated player months in): Tier I 2,000 identified (1,000 past its cap, each counting 5x),
// Tier II 1,000 (just at its cap) and Tier III 300.
import { emptyMuseumV2, type MuseumV2, type RegionTier } from "../game/model";
import { RELIC_BANDS, RELIC_BAND_ODDS, RELIC_TYPES, relicBandOf, museumDepositGeneral, type RelicBand } from "../game/relics";
import { RELIC_BLANK_WEIGHTS, EXPEDITION_RELIC_BLANKS_PER_HOUR, SHORT_RANGE_RELIC_RATE_MULT } from "../game/relicBlanks";
import { relicBoostsFromMuseum } from "./relicBoosts";
import type { RelicBoosts } from "./config";

export const TYPICAL_DAYS = 21;
export const TYPICAL_EXPEDITION_HOURS_PER_DAY = 16;
export const TYPICAL_SHORT_RANGE_MISSIONS = 2;

// Tier I blanks of a typical collection, by source.
export function typicalTierOneBlanks(): { expedition: number; shortRange: number } {
  return {
    expedition: Math.round(TYPICAL_DAYS * TYPICAL_EXPEDITION_HOURS_PER_DAY * EXPEDITION_RELIC_BLANKS_PER_HOUR),
    shortRange: Math.round(TYPICAL_DAYS * 24 * TYPICAL_SHORT_RANGE_MISSIONS * EXPEDITION_RELIC_BLANKS_PER_HOUR * SHORT_RANGE_RELIC_RATE_MULT[1]),
  };
}

// The share of each revealed band for a blank of `tier`, from the full ladder (or standard blanks only).
function bandShares(tier: RegionTier, standardOnly: boolean): Record<RelicBand, number> {
  const out: Record<RelicBand, number> = { standard: 0, augmented: 0, stellar: 0, radiant: 0 };
  const rows = RELIC_BLANK_WEIGHTS[tier].filter((r) => !standardOnly || relicBandOf(r.tier) === "standard");
  const total = rows.reduce((a, r) => a + r.weight, 0);
  for (const r of rows) {
    const odds = RELIC_BAND_ODDS[tier][relicBandOf(r.tier)];
    const sum = RELIC_BANDS.reduce((a, b) => a + odds[b], 0);
    for (const b of RELIC_BANDS) out[b] += (r.weight / total) * (odds[b] / sum);
  }
  return out;
}

// Expected copies per type id for `blanks` identified blanks of `tier`, rounded to whole copies.
export function expectedCopies(tier: RegionTier, blanks: number, standardOnly = false): Record<string, number> {
  const shares = bandShares(tier, standardOnly);
  const out: Record<string, number> = {};
  for (const band of RELIC_BANDS) {
    const types = RELIC_TYPES.filter((t) => t.band === band);
    for (const t of types) out[t.id] = (out[t.id] ?? 0) + (blanks * shares[band]) / types.length;
  }
  for (const id of Object.keys(out)) out[id] = Math.round(out[id]);
  return out;
}

// Deposits per type, interleaved over many small rounds (the order relics really arrive in).
export function depositInterleaved(museum: MuseumV2, tier: RegionTier, copies: Readonly<Record<string, number>>, rounds = 50): MuseumV2 {
  let m = museum;
  for (let r = 0; r < rounds; r++) {
    for (const [id, n] of Object.entries(copies)) {
      const k = Math.floor(((r + 1) * n) / rounds) - Math.floor((r * n) / rounds);
      if (k > 0) m = museumDepositGeneral(m, tier, id, k);
    }
  }
  return m;
}

function sum(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}

export function typicalMuseum(): MuseumV2 {
  const blanks = typicalTierOneBlanks();
  return depositInterleaved(emptyMuseumV2(), 1, sum(expectedCopies(1, blanks.expedition), expectedCopies(1, blanks.shortRange, true)));
}

export function heavyMuseum(): MuseumV2 {
  let m = depositInterleaved(emptyMuseumV2(), 1, expectedCopies(1, 2000));
  m = depositInterleaved(m, 2, expectedCopies(2, 1000));
  return depositInterleaved(m, 3, expectedCopies(3, 300));
}

export function typicalBoosts(): RelicBoosts {
  return relicBoostsFromMuseum(typicalMuseum())!;
}

export function heavyBoosts(): RelicBoosts {
  return relicBoostsFromMuseum(heavyMuseum())!;
}
