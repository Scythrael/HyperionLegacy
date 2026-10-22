// ============================================================================
// relicIdentify.ts: Relics v2 R2-3 (docs/plans/2026-10-17-relics-v2-plan.md section 4 R2-3): IDENTIFICATION v2 and the
// relic-study LANES. Engine only (the queue and the chain live in tick.ts beside the other timed processes).
//
// User answers this module follows (plan "USER ANSWERS (2026-10-19)" and docs/plans/2026-10-19-merge-batch-answers.md):
//   - call 12 "Free, queued, lanes by Lab": 10 minutes times the blank's rarity (relics.ts relicStudyDurationTicks:
//     standard 10, augmented 15, stellar 20, radiant 30), free, a queue, lanes by Research Lab level (I 1, III 2, V 3,
//     VII 4), no Lab gate per tier: any Lab level identifies any tier's blank.
//   - call 6 exceptional odds (EXCEPTIONAL_PER_100K: Tier I 0.25% to 1.5% by blank rarity, x1.25 per tier up).
//   - call 7 "Prefer missing pieces": the reveal prefers a piece of the tier the Museum lacks; once every piece is held,
//     a duplicate adds no stat but still counts toward the tier's total.
//   - call 8 "Type on identify, name via culture": identification reveals the general TYPE (and its stat); the
//     culture study names it later (R2-6). An exceptional relic is named on reveal (its catalog piece).
//   - call 9 "Tied to source planet": +1 study point and a find per identified general relic, on the blank's culture.
//   - call 17 site bias: the source site doubles its old set's types (relicBlanks.ts generalTypeWeight).
//   - "Only one boost" (2026-10-21): the rarer blank IS the tier boost, so identification reads the band odds of the
//     blank's OWN rarity (the Tier I row, today's v1 skew) at every tier; the tier's band odds are never applied a second
//     time. (The blank roll, relicBlanks.ts RELIC_BLANK_WEIGHTS, is where the tier acts.)
//
// THE ROLL is keyed off (relicSeed, RELIC_IDENTIFY_V2_SALT, studyIndex, tokenId) and draws EXACTLY three integers, in
// this order: (1) the exceptional check out of 100,000; (2) the band (general) or the piece (exceptional); (3) the type
// inside the band (general) or an unused draw (exceptional), taken anyway so the count never varies. Pure: the outcome
// is a function of stored values (the save's fixed seed, the study's stamped index, the token, and the Museum's
// exceptional copies at completion), so one big offline resolve equals live steps once completions run in time order
// (tick.ts resolveRelicStudies).
// ============================================================================

import {
  RELIC_DEFAULT_SEED,
  emptyMuseumV2,
  type EquipmentRarity,
  type MuseumV2,
  type RegionTier,
  type RelicSetId,
  type RelicVaultToken,
} from "./model";
import {
  EXCEPTIONAL_PER_100K,
  RELIC_BAND_ODDS,
  RELIC_BANDS,
  exceptionalSetsOfTier,
  getExceptionalSetById,
  museumDepositExceptional,
  museumDepositGeneral,
  relicBandOf,
  relicSetForPoi,
  relicTypesInBand,
  type RelicBand,
} from "./relics";
import { generalTypeWeight, vaultTokenRegionTier } from "./relicBlanks";
import { makeRng, type Rng } from "./combat/rng";

// The flag a v2 study carries (the identifyRelic effect's `v`; its PRESENCE marks the study, plan section 3.2).
export const RELIC_STUDY_VERSION = 2 as const;

// Salt (odd, 32-bit, distinct; registered in salts.test.ts).
export const RELIC_IDENTIFY_V2_SALT = 0x4b1d9e2f;

// The exceptional check's denominator (EXCEPTIONAL_PER_100K is "per 100,000").
export const EXCEPTIONAL_CHECK_DENOMINATOR = 100_000;

// "Only one boost": the region tier whose band-odds row identification reads for every blank (the blank's own rarity
// row of Tier I, which is today's v1 skew: a standard blank 60/30/9/1 ... a radiant blank 10/20/40/30).
export const RELIC_IDENTIFY_BAND_TIER: RegionTier = 1;

// ============================================================================
// Lanes by Research Lab level (call 12)
// ============================================================================

// The Research Lab level at which each relic-study lane opens: Lab I 1 lane, III 2, V 3, VII 4.
export const RELIC_STUDY_LANES_BY_LAB: readonly { level: number; lanes: number }[] = [
  { level: 1, lanes: 1 },
  { level: 3, lanes: 2 },
  { level: 5, lanes: 3 },
  { level: 7, lanes: 4 },
];

// The relic-study lanes a Lab of `level` runs (the level model.ts labTier reads, OC-15's tiers I to VII): the last rung
// reached in RELIC_STUDY_LANES_BY_LAB, 0 below Lab I. Pure.
export function relicStudyLanesAt(level: number): number {
  let lanes = 0;
  for (const rung of RELIC_STUDY_LANES_BY_LAB) if (level >= rung.level) lanes = rung.lanes;
  return lanes;
}

// ============================================================================
// The v2 roll
// ============================================================================

// What a v2 study reveals.
export type RelicIdentification =
  | { kind: "general"; tier: RegionTier; typeId: string }
  | { kind: "exceptional"; tier: RegionTier; pieceId: string; setId: string; duplicate: boolean };

// The id the reveal names (the general type id or the exceptional piece id): the completion record's subject and the
// first-find registry entry. Pure.
export function relicIdentificationId(outcome: RelicIdentification): string {
  return outcome.kind === "general" ? outcome.typeId : outcome.pieceId;
}

// The v2 study seed: the v1 mix (relicStudySeed) on its own salt, so a v2 roll never reuses a v1 stream. Pure uint32.
export function relicStudyV2Seed(relicSeed: number, studyIndex: number, tokenId: string): number {
  let h = ((relicSeed >>> 0) ^ RELIC_IDENTIFY_V2_SALT ^ Math.imul(studyIndex >>> 0, 0x9e3779b9)) >>> 0;
  for (let i = 0; i < tokenId.length; i++) h = Math.imul(h ^ tokenId.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

// The band odds identification reads for a blank of `rarity` ("Only one boost": the blank's own rarity row). Pure.
export function identificationBandRow(rarity: EquipmentRarity): Readonly<Record<RelicBand, number>> {
  return RELIC_BAND_ODDS[RELIC_IDENTIFY_BAND_TIER][relicBandOf(rarity)];
}

// ONE integer draw over the rows' total weight; returns the row's index (rows are non-empty, weights positive).
function pickWeighted(rng: Rng, rows: readonly { weight: number }[]): number {
  let total = 0;
  for (const r of rows) total += r.weight;
  let roll = rng.nextInt(Math.max(1, total));
  for (let i = 0; i < rows.length; i++) {
    roll -= rows[i].weight;
    if (roll < 0) return i;
  }
  return rows.length - 1;
}

export interface RelicIdentificationInput {
  regionTier: RegionTier;
  rarity: EquipmentRarity; // the blank's rarity
  siteSet: RelicSetId | null; // the old set its source site sources (call 17), null for no site
  heldExceptional: Readonly<Record<string, number>>; // the Museum's exceptional copies at completion (call 7)
}

// THE v2 roll on `rng`: exactly three integer draws (see the header). Pure in (rng position, input).
export function rollRelicIdentification(rng: Rng, input: RelicIdentificationInput): RelicIdentification {
  const tier = input.regionTier;
  const band = relicBandOf(input.rarity);
  const chance = EXCEPTIONAL_PER_100K[tier]?.[band] ?? 0;
  // Draw 1: the exceptional check.
  const check = rng.nextInt(EXCEPTIONAL_CHECK_DENOMINATOR);
  const pieces = exceptionalSetsOfTier(tier).flatMap((s) => s.pieces);
  if (check < chance && pieces.length > 0) {
    // Draw 2: the piece, preferring the ones the Museum lacks (call 7); all held = any piece (a duplicate).
    const missing = pieces.filter((p) => !((input.heldExceptional[p.id] ?? 0) > 0));
    const pool = missing.length > 0 ? missing : pieces;
    const piece = pool[rng.nextInt(pool.length)];
    // Draw 3: unused, taken so the draw count never varies.
    rng.nextInt(EXCEPTIONAL_CHECK_DENOMINATOR);
    return { kind: "exceptional", tier, pieceId: piece.id, setId: piece.setId, duplicate: missing.length === 0 };
  }
  // Draw 2: the band, on the blank's own rarity row ("Only one boost").
  const row = identificationBandRow(input.rarity);
  const bands = RELIC_BANDS.map((b) => ({ band: b, weight: row[b] })).filter((b) => b.weight > 0);
  const picked = bands[pickWeighted(rng, bands)].band;
  // Draw 3: the type inside the band, with the site bias.
  const types = relicTypesInBand(picked).map((t) => ({ id: t.id, weight: generalTypeWeight(t, input.siteSet) }));
  return { kind: "general", tier, typeId: types[pickWeighted(rng, types)].id };
}

// The site a token's types are biased toward: its routed set, else its PoI's set, else none. Pure.
export function relicTokenSiteSet(token: Pick<RelicVaultToken, "setId" | "poiId">): RelicSetId | null {
  return token.setId ?? relicSetForPoi(token.poiId);
}

// What a v2 study of `token` (stamped `studyIndex`) reveals against a Museum holding `museum`. Pure.
export function identifyRelicV2(
  relicSeed: number | undefined,
  museum: Pick<MuseumV2, "exceptional"> | undefined,
  token: RelicVaultToken,
  studyIndex: number
): RelicIdentification {
  const rng = makeRng(relicStudyV2Seed(relicSeed ?? RELIC_DEFAULT_SEED, studyIndex, token.id));
  return rollRelicIdentification(rng, {
    regionTier: vaultTokenRegionTier(token),
    rarity: token.tier,
    siteSet: relicTokenSiteSet(token),
    heldExceptional: museum?.exceptional ?? {},
  });
}

// ============================================================================
// The deposit
// ============================================================================

// The Museum and first-find registry after one identification lands. A general relic: one copy at its region tier,
// +1 study point and one find on `cultureId` (call 9), its first find. An exceptional piece: one copy (duplicates
// counted, call 7), its first find, and its set appended to setsCompleted once every piece is held (the ledger event
// is R2-5's). Key positions of existing records are kept (spreads over existing keys). R2-4: both go through the Museum
// v2 deposits (relics.ts museumDepositGeneral / museumDepositExceptional), which snapshot a tier reaching the soft cap.
// Pure.
export function applyRelicIdentification(
  museum: MuseumV2 | undefined,
  discovered: readonly string[],
  outcome: RelicIdentification,
  cultureId: string | null
): { museum: MuseumV2; discovered: string[] } {
  const base = museum ?? emptyMuseumV2();
  const id = relicIdentificationId(outcome);
  const nextDiscovered = discovered.includes(id) ? [...discovered] : [...discovered, id];
  if (outcome.kind === "general") {
    let next: MuseumV2 = museumDepositGeneral(base, outcome.tier, id, 1);
    if (cultureId !== null) {
      const c = base.cultures[cultureId] ?? { points: 0, finds: {} };
      next = { ...next, cultures: { ...base.cultures, [cultureId]: { points: c.points + 1, finds: { ...c.finds, [id]: (c.finds[id] ?? 0) + 1 } } } };
    }
    return { museum: next, discovered: nextDiscovered };
  }
  let next: MuseumV2 = museumDepositExceptional(base, id);
  const exceptional = next.exceptional;
  const set = getExceptionalSetById(outcome.setId);
  if (set && !base.setsCompleted.includes(set.id) && set.pieces.every((p) => (exceptional[p.id] ?? 0) > 0)) {
    next = { ...next, setsCompleted: [...base.setsCompleted, set.id] };
  }
  return { museum: next, discovered: nextDiscovered };
}
