// ============================================================================
// relicBlanks.ts: Relics v2 R2-2 (docs/plans/2026-10-17-relics-v2-plan.md section 4 R2-2): BLANKS BY TIER, SOURCES,
// HOOKS. Engine only.
//
// A relic arrives as an unidentified BLANK with a rarity (the vault token's `tier` field) and, from R2-2, the REGION
// TIER it was found at and the CULTURE of the body it came from. This module owns:
//   - the per-tier blank rarity table (RELIC_BLANK_WEIGHTS): Tier I is today's relic roll table exactly, each tier
//     above it shifts weight up the table by the same shift the approved band odds use (user call 13 "Better rarity
//     only": the relic CHANCE and the haul multiplier are untouched; the tier only reshapes the rarity draw);
//   - the blank stamp a flagged run writes (Expedition.relicBlanks): its tier and the body's culture, derived with no
//     draw on any shared stream (a fresh keyed stream per body);
//   - the read-time defaults of a vault token (tier I, a culture derived from the token id, source "expedition");
//   - THREE HOOKS other slices call: the short-range relic drop (G1-5 wires it; user, short-range plan call 11: "rare,
//     per hour, Tier I 0.08x and Tier II 0.15x of the expedition rate"), the planet 100% completion bonus roll (G7 calls
//     it; user call 15 "Relics owns the roll": one extra blank, one rarity step up), and the general pick a blank with
//     no site identifies through until R2-3's identification v2 (a short-range, completion or grant blank has no set);
//   - the site bias weights (user call 17: a blank's source site doubles the weight of its old set's types).
// Pure functions only; every draw is an integer draw on a makeRng stream keyed by a fresh odd salt (salts.test.ts).
// ============================================================================

import { RELIC_DEFAULT_SEED, type EquipmentRarity, type Expedition, type GameState, type RegionTier, type RelicSetId, type RelicVaultToken } from "./model";
import { CULTURE_ROSTER, RELIC_BAND_ODDS, RELIC_BANDS, RELIC_SITE_BIAS_MULT, relicBandOf, relicSetForPoi, relicTypesInBand, type RelicBand } from "./relics";
import { makeRng, type Rng } from "./combat/rng";

// The flag a new run carries (Expedition.relicBlanks.version).
export const RELIC_BLANKS_VERSION = 1;

// Salts (odd, 32-bit, distinct; registered in salts.test.ts).
export const RELIC_CULTURE_SALT = 0x2f1b7c35;
export const RELIC_SHORT_RANGE_SALT = 0x58c3a1e7;
export const RELIC_COMPLETION_SALT = 0x7d4e9b13;

// ============================================================================
// The blank rarity table per region tier
// ============================================================================

// One rarity row of a blank table: the salvage rarity ladder entry (rarity name, weight, quality bucket).
export interface RelicBlankRow {
  tier: EquipmentRarity;
  weight: number;
  quality: number;
}

// The relic roll's Tier I table. RARITY READINESS RR-7 (answer 10, "Decouple them"): its OWN frozen table, no longer
// SALVAGE_LOOT_POOLS.intactReactorCore, so a legendary salvage tier added later neither creates a legendary relic blank
// nor reshapes (flattens) the blank odds. The rows are exactly the four the relic roll has always read (standard 1000
// q0 / augmented 300 q1 / stellar 40 q3 / radiant 5 q4), so every blank rolls bit for bit as before.
export const RELIC_BLANK_LADDER_I: readonly RelicBlankRow[] = [
  { tier: "standard", weight: 1000, quality: 0 },
  { tier: "augmented", weight: 300, quality: 1 },
  { tier: "stellar", weight: 40, quality: 3 },
  { tier: "radiant", weight: 5, quality: 4 },
];
const TIER_I_LADDER = RELIC_BLANK_LADDER_I;

// [PROVISIONAL] (plan R2-2 "Tier II and up pick rarity from the OC-13 table"; no row was given for the blank itself): the
// band-odds row whose shift the blank table shares. Each tier's blank weight for a rarity is Tier I's weight times how
// much that tier's row of RELIC_BAND_ODDS for a STANDARD blank grew that rarity's band over Tier I (Tier IV standard
// row 40/35/18/7 over Tier I 60/30/9/1), rounded to an integer. So the blank odds move exactly as the approved band
// anchors move: Tier IV reads 667 / 350 / 80 / 35, Tier VII 333 / 350 / 124 / 85.
export const RELIC_BLANK_SHIFT_BAND: RelicBand = "standard";

const REGION_TIERS: readonly RegionTier[] = [1, 2, 3, 4, 5, 6, 7];

// RELIC_BLANK_WEIGHTS[tier]: the rarity ladder a blank of that region tier rolls on, in ladder order. Tier I is the
// ladder itself (the same rows, so the draw is today's bit for bit).
export const RELIC_BLANK_WEIGHTS: Readonly<Record<RegionTier, readonly RelicBlankRow[]>> = (() => {
  const out = {} as Record<RegionTier, RelicBlankRow[]>;
  const base = RELIC_BAND_ODDS[1][RELIC_BLANK_SHIFT_BAND];
  for (const tier of REGION_TIERS) {
    const row = RELIC_BAND_ODDS[tier][RELIC_BLANK_SHIFT_BAND];
    out[tier] = TIER_I_LADDER.map((r) => {
      if (tier === 1) return { tier: r.tier, weight: r.weight, quality: r.quality };
      const band = relicBandOf(r.tier);
      const grown = base[band] > 0 ? Math.round((r.weight * row[band]) / base[band]) : r.weight;
      return { tier: r.tier, weight: Math.max(1, grown), quality: r.quality };
    });
  }
  return out;
})();

// The blank table of a region tier (Tier I for anything unknown). Pure.
export function relicBlankTable(tier: RegionTier | undefined): readonly RelicBlankRow[] {
  return RELIC_BLANK_WEIGHTS[tier ?? 1] ?? RELIC_BLANK_WEIGHTS[1];
}

// The highest ladder index a find can reach: the hazard's share of the ladder plus a whole-tier lift (Relic Hunter),
// never past the top. THE one formula (gambit.ts relicTierCeiling reads it). Pure.
export function relicBlankCeiling(hazard: number, tierLift?: number): number {
  const lift = tierLift !== undefined && Number.isFinite(tierLift) ? Math.max(0, Math.floor(tierLift)) : 0;
  return Math.min(TIER_I_LADDER.length - 1, Math.max(0, Math.round(hazard * (TIER_I_LADDER.length - 1))) + lift);
}

// ONE integer draw over the rows' total weight (the same device as gambit.ts pickWeighted). Returns the row's index.
function pickIndex(rng: Rng, rows: readonly { weight: number }[]): number {
  let total = 0;
  for (const r of rows) total += r.weight;
  let roll = rng.nextInt(Math.max(1, total));
  for (let i = 0; i < rows.length; i++) {
    roll -= rows[i].weight;
    if (roll < 0) return i;
  }
  return rows.length - 1;
}

// Roll a blank's rarity row: the tier's table up to `ceiling`, ONE draw. Tier I with the same ceiling and stream is the
// pre-R2-2 relic roll exactly. Pure in (rng position, tier, ceiling).
export function rollBlankRarity(rng: Rng, tier: RegionTier | undefined, ceiling: number): RelicBlankRow {
  const eligible = relicBlankTable(tier).slice(0, Math.max(0, ceiling) + 1);
  return eligible[pickIndex(rng, eligible)];
}

// ============================================================================
// The blank stamp (tier + culture) and a vault token's read-time defaults
// ============================================================================

export interface RelicBlankStamp {
  tier: RegionTier;
  cultureId: string;
}

// A run's region tier: its G2-2 region stamp, else its risk profile's tier, else Tier I. Pure.
export function expeditionRegionTier(exp: Pick<Expedition, "region" | "risk">): RegionTier {
  return exp.region?.tier ?? exp.risk?.tier ?? 1;
}

// The culture of body `bodyIndex` of the run seeded `expSeed` at `tier` (user call 9 "Tied to source planet"): one of
// the tier's roster, on a fresh keyed stream (RELIC_CULTURE_SALT), so it costs no draw on any shared stream and is the
// same however and whenever it is asked. Pure.
export function cultureForBody(expSeed: number, bodyIndex: number, tier: RegionTier): string {
  const roster = CULTURE_ROSTER[tier] ?? CULTURE_ROSTER[1];
  const rng = makeRng((expSeed ^ RELIC_CULTURE_SALT ^ Math.imul(bodyIndex + 1, 0x9e3779b9)) >>> 0);
  return roster[rng.nextInt(roster.length)];
}

// The blank stamp a run writes on a relic from body `bodyIndex`, or undefined for a run without the R2-2 flag (it keeps
// rolling and storing its tokens exactly as before). Pure.
export function relicBlankStamp(exp: Pick<Expedition, "seed" | "region" | "risk" | "relicBlanks">, bodyIndex: number): RelicBlankStamp | undefined {
  if (!exp.relicBlanks) return undefined;
  const tier = expeditionRegionTier(exp);
  return { tier, cultureId: cultureForBody(exp.seed, Math.max(0, bodyIndex), tier) };
}

// The culture of a token minted before R2-2 (no stamp), derived from its id (plan 3.4: a pure hash with
// RELIC_CULTURE_SALT, no stream draw), so it never needs storing. Pure.
export function legacyTokenCultureId(relicSeed: number, tokenId: string, tier: RegionTier = 1): string {
  let h = ((relicSeed >>> 0) ^ RELIC_CULTURE_SALT) >>> 0;
  for (let i = 0; i < tokenId.length; i++) h = Math.imul(h ^ tokenId.charCodeAt(i), 0x01000193) >>> 0;
  const roster = CULTURE_ROSTER[tier] ?? CULTURE_ROSTER[1];
  return roster[makeRng(h).nextInt(roster.length)];
}

// A vault token's region tier (absent = Tier I). Pure.
export function vaultTokenRegionTier(token: Pick<RelicVaultToken, "regionTier">): RegionTier {
  return token.regionTier ?? 1;
}

// A vault token's source (absent = an expedition find). Pure.
export function vaultTokenSource(token: Pick<RelicVaultToken, "source">): NonNullable<RelicVaultToken["source"]> {
  return token.source ?? "expedition";
}

// A vault token's culture: its stamp, else derived from its id. Pure.
export function vaultTokenCultureId(state: Pick<GameState, "relicSeed">, token: Pick<RelicVaultToken, "id" | "cultureId" | "regionTier">): string {
  return token.cultureId ?? legacyTokenCultureId(state.relicSeed ?? RELIC_DEFAULT_SEED, token.id, vaultTokenRegionTier(token));
}

// The vault with `tokens` appended (the deposit a hook's caller makes). The SAME state for none. Pure.
export function withRelicBlanks(state: GameState, tokens: readonly RelicVaultToken[]): GameState {
  if (tokens.length === 0) return state;
  return { ...state, relicVault: [...(state.relicVault ?? []), ...tokens] };
}

// ============================================================================
// Hook 1: short-range relic drops (G1-5 wires it into a delivered cycle)
// ============================================================================

// [PROVISIONAL] (measured 2026-10-21, not a user number): the expedition relic rate the short-range rate is a fraction of,
// in blanks per hour of run time. Tier I runs from launch to home: a rank 6 crew on an Orion or an Aurora finds 0.53 to
// 0.57 an hour, a full board crew on an Eir 0.39 (runs that stall on an objective read far lower).
export const EXPEDITION_RELIC_BLANKS_PER_HOUR = 0.5;

// User (short-range plan call 11, "Rare, per hour (Recommended)"): a short-range mission's relic chance per hour of
// mission time, as a fraction of the expedition rate, by short-range tier.
export const SHORT_RANGE_RELIC_RATE_MULT: Readonly<Record<1 | 2, number>> = { 1: 0.08, 2: 0.15 };

// [PROVISIONAL] (call 11 "lowest-tier unidentified relics"): a short-range blank is a Tier I blank of the lowest rarity
// (ladder index 0, standard). Its region tier is Tier I at either short-range tier.
export const SHORT_RANGE_RELIC_CEILING = 0;

// Expected short-range blanks per hour, in millionths (an integer, so the roll is integer draws only). Pure.
export function shortRangeRelicMicrosPerHour(tier: 1 | 2): number {
  return Math.round(1_000_000 * EXPEDITION_RELIC_BLANKS_PER_HOUR * (SHORT_RANGE_RELIC_RATE_MULT[tier] ?? 0));
}

// HOOK (G1-5): the relic blanks one delivered short-range cycle of `missionSeconds` earns. The expected count is the
// per-hour rate times the hours exactly (a whole part, then one chance for the remainder), so a short run repeated fast
// earns no more per hour than a long one. Draw order, fixed and always taken: the remainder chance, the destination's
// culture, then one rarity draw per blank. `seed` is the caller's cycle seed (G1 keys it); the hook salts it with
// RELIC_SHORT_RANGE_SALT. Ids are `<idPrefix>-relic-<n>`. Each blank: Tier I, the lowest rarity, source "shortRange", no
// site (so no set). Pure.
export function rollShortRangeRelicBlanks(seed: number, tier: 1 | 2, missionSeconds: number, idPrefix: string): RelicVaultToken[] {
  const rng = makeRng((seed ^ RELIC_SHORT_RANGE_SALT) >>> 0);
  const seconds = Number.isFinite(missionSeconds) ? Math.max(0, Math.floor(missionSeconds)) : 0;
  const micros = Math.round((shortRangeRelicMicrosPerHour(tier) * seconds) / 3600);
  const count = Math.floor(micros / 1_000_000) + (rng.chance(micros % 1_000_000, 1_000_000) ? 1 : 0);
  const roster = CULTURE_ROSTER[1];
  const cultureId = roster[rng.nextInt(roster.length)];
  const out: RelicVaultToken[] = [];
  for (let n = 0; n < count; n++) {
    const row = rollBlankRarity(rng, 1, SHORT_RANGE_RELIC_CEILING);
    out.push({ id: `${idPrefix}-relic-${n}`, tier: row.tier, quality: row.quality, regionTier: 1, cultureId, source: "shortRange" });
  }
  return out;
}

// ============================================================================
// Hook 2: the planet 100% completion bonus roll (G7 calls it)
// ============================================================================

// HOOK (G7; user call 15 "Relics owns the roll": one extra blank, one rarity step up): the bonus blank for finishing a
// planet. The rarity is the tier's blank roll on the body's hazard ceiling (exactly as a find on that body rolls), then
// ONE step up the ladder (radiant stays radiant: the top of the ladder relics roll on). ONE draw on a stream keyed by
// RELIC_COMPLETION_SALT. Source "completion", no site. Pure.
export function rollCompletionRelicBlank(seed: number, tier: RegionTier, hazard: number, id: string, cultureId: string): RelicVaultToken {
  const rng = makeRng((seed ^ RELIC_COMPLETION_SALT) >>> 0);
  const table = relicBlankTable(tier);
  const rolled = rollBlankRarity(rng, tier, relicBlankCeiling(hazard));
  const row = table[Math.min(table.length - 1, table.indexOf(rolled) + 1)];
  return { id, tier: row.tier, quality: row.quality, regionTier: tier, cultureId, source: "completion" };
}

// The completion blank for body `bodyIndex` of `exp` (the G7 call): seeded by the run and the body, at the run's region
// tier, on the body's hazard, with the body's culture. Id `<expeditionId>-relic-complete-<bodyId>`. Pure.
export function planetCompletionRelicBlank(exp: Pick<Expedition, "id" | "seed" | "region" | "risk" | "bodies">, bodyIndex: number): RelicVaultToken | null {
  const body = exp.bodies[bodyIndex];
  if (!body) return null;
  const tier = expeditionRegionTier(exp);
  const seed = (exp.seed ^ Math.imul(bodyIndex + 1, 0x85ebca6b)) >>> 0;
  return rollCompletionRelicBlank(seed, tier, body.hazard, `${exp.id}-relic-complete-${body.id}`, cultureForBody(exp.seed, bodyIndex, tier));
}

// ============================================================================
// Site bias, and the general pick for a blank with no set
// ============================================================================

// User call 17 ("Every set + site bias"): a general type's in-band weight for a blank from `siteSet` (the old set its
// source PoI sources), doubled for that set's own types. No site = every type its plain weight. Pure.
export function generalTypeWeight(type: { weight: number; siteSet: RelicSetId }, siteSet: RelicSetId | null): number {
  return siteSet !== null && type.siteSet === siteSet ? type.weight * RELIC_SITE_BIAS_MULT : type.weight;
}

// The general type a blank reveals over the GENERAL POOL (no set): the band from RELIC_BAND_ODDS[region tier][the
// blank's band], then a type inside the band weighted by generalTypeWeight. Two draws, in that order, on one makeRng
// stream. A pure function of its inputs (offline == live by construction). Until R2-3's identification v2 this is the
// study of a blank that has no set (a short-range, completion or grant blank); R2-3 builds on the same pick. Returns the
// type id.
export function identifyGeneralRelic(regionTier: RegionTier, rarity: EquipmentRarity, poiId: string | undefined, seed: number): string {
  const rng = makeRng(seed >>> 0);
  const odds = RELIC_BAND_ODDS[regionTier] ?? RELIC_BAND_ODDS[1];
  const row = odds[relicBandOf(rarity)];
  const bands = RELIC_BANDS.map((band) => ({ band, weight: row[band] })).filter((b) => b.weight > 0);
  const band = bands[pickIndex(rng, bands)].band;
  const site = relicSetForPoi(poiId);
  const types = relicTypesInBand(band).map((t) => ({ id: t.id, weight: generalTypeWeight(t, site) }));
  return types[pickIndex(rng, types)].id;
}
