// Crew 0.14.0 (Phase 2): the deterministic COMPLEMENT crew generator (pure, DORMANT).
//
// Where the Senior Staff engine rolls a handful of named officers, this rolls the hundreds-scale
// COMPLEMENT: anonymous bucket crew whose whole mechanical identity is a CrewSignature (profession,
// rarity, rank, race, buff1, optional buff2). generateComplementCrew(seed, index, opts) rolls ONE
// signature deterministically, so the transport influx (transports.ts) can mint a reproducible batch
// and offline == live agrees. Everything here is PURE and DORMANT: nothing is wired into tick.ts,
// shipDerivedStats, or the UI.
//
// The roll obeys the LOCKED model (docs/plans/2026-09-22-crew-0.14.0-plan.md, Phase 0.5 + Phase 2):
//   - rarity is CAPPED AT STELLAR (clampCrewRarity / CREW_RARITY_CAP); the generator never mints
//     radiant+ crew even though the rarity ladder continues.
//   - rank follows a pyramid (many low ranks, few high), locked at generation (no leveling).
//   - buff COUNT follows buffCountForRank(rank): 1 buff -> buff2Id null; 2 buffs -> a 2nd DISTINCT
//     profession buff; 3-eligible ranks (Lieutenant / Lt Commander) may instead draw the 2nd buff
//     from the sweeping SECOND_LEVEL_EXCLUSIVE pool.
//
// The PRNG is the shared combat mulberry32 (combat/rng.ts), never Math.random (which would break the
// offline == live determinism the transport accumulator relies on). Buffs are drawn from the Phase
// 0.5 catalogs (crewBuffs.ts); races from crewRaces.ts. All distributions are FIRST-PASS + TUNABLE.

import type { CrewProfession, CrewRank, CrewRarity, CrewRace, CrewSignature, EquipmentRarity } from "./model";
import { makeRng, type Rng } from "./combat/rng";
import { CREW_PROFESSION_BUFFS, SECOND_LEVEL_EXCLUSIVE } from "./crewBuffs";
import { CREW_RACE_IDS } from "./crewRaces";
import { clampCrewRarity } from "./crewRarity";
import { buffCountForRank } from "./crewRank";
import { CREW_PROFESSIONS } from "./commandStructure";

// The rarities the generator can mint, in ascending order, ALL at or below the crew cap (stellar).
// A parallel weight table biases the roll toward the common tiers. FIRST-PASS + TUNABLE.
const GEN_RARITIES: readonly EquipmentRarity[] = ["derelict", "standard", "augmented", "stellar"];
const GEN_RARITY_WEIGHTS: readonly number[] = [15, 55, 22, 8]; // sums to 100

// Rank roll weights (rank 1 Crewman .. rank 8 Lt Commander), a pyramid mirroring the command
// structure's shape: most crew are junior, a Lt Commander is rare. FIRST-PASS + TUNABLE.
const GEN_RANK_WEIGHTS: Record<CrewRank, number> = {
  1: 34,
  2: 24,
  3: 15,
  4: 10,
  5: 7,
  6: 5,
  7: 3,
  8: 2,
};

// The chance (out of 100) that a 3-buff-eligible rank (Lieutenant / Lt Commander) draws its 2nd buff
// from the sweeping SECOND_LEVEL_EXCLUSIVE pool instead of a 2nd profession buff. FIRST-PASS + TUNABLE.
const EXCLUSIVE_SECOND_BUFF_CHANCE = 35;

// Options for a single roll. `profession` pins the division (used when a batch wants a specific mix);
// omitted, it is rolled uniformly over the six professions.
export interface GenerateComplementOptions {
  profession?: CrewProfession;
}

// Weighted pick from `items` by parallel `weights` (same length, non-negative, positive sum), decided
// by a single integer draw so it stays exact and reproducible. Pure w.r.t. the passed rng's state.
function weightedPick<T>(rng: Rng, items: readonly T[], weights: readonly number[]): T {
  let total = 0;
  for (const w of weights) total += w;
  // roll in [0, total); walk the cumulative weights.
  let roll = rng.nextInt(total);
  for (let i = 0; i < items.length; i += 1) {
    roll -= weights[i];
    if (roll < 0) return items[i];
  }
  return items[items.length - 1]; // unreachable given a positive weight sum; defensive
}

// Mix a base seed + a row index into one uint32 PRNG seed, so row `index` gives an independent draw
// off the same `seed` (distinct rows in a batch decorrelate; same inputs => same seed). Same mixing
// shape the crew identity generator uses. Pure.
function crewSeed(seed: number, index: number): number {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ ((index + 1) >>> 0), 0x85ebca6b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

// Roll ONE complement crew SIGNATURE deterministically from (seed, index[, opts]). The draw order is
// FIXED (profession, rarity, rank, race, buff1, buff2) so the sequence is stable across engines; the
// same inputs always yield the same signature. Rarity is clamped to stellar defensively (the weight
// table already stops there). Pure.
export function generateComplementCrew(
  seed: number,
  index: number,
  opts: GenerateComplementOptions = {},
): CrewSignature {
  const rng = makeRng(crewSeed(seed, index));

  const profession: CrewProfession = opts.profession ?? CREW_PROFESSIONS[rng.nextInt(CREW_PROFESSIONS.length)];
  const rarity: CrewRarity = clampCrewRarity(weightedPick(rng, GEN_RARITIES, GEN_RARITY_WEIGHTS));
  const rank = weightedPick(
    rng,
    [1, 2, 3, 4, 5, 6, 7, 8] as CrewRank[],
    [1, 2, 3, 4, 5, 6, 7, 8].map((r) => GEN_RANK_WEIGHTS[r as CrewRank]),
  );
  const race: CrewRace = CREW_RACE_IDS[rng.nextInt(CREW_RACE_IDS.length)];

  // buff1: always present, from the profession's own pool.
  const pool = CREW_PROFESSION_BUFFS[profession];
  const buff1Id = pool[rng.nextInt(pool.length)].id;

  // buff2: only when the rank carries 2+ buffs. A 3-buff-eligible rank may draw the sweeping
  // exclusive pool; otherwise the 2nd buff is a DISTINCT draw from the same profession pool.
  const buffCount = buffCountForRank(rank);
  let buff2Id: string | null = null;
  if (buffCount >= 2) {
    if (buffCount >= 3 && rng.chance(EXCLUSIVE_SECOND_BUFF_CHANCE, 100)) {
      buff2Id = SECOND_LEVEL_EXCLUSIVE[rng.nextInt(SECOND_LEVEL_EXCLUSIVE.length)].id;
    } else if (pool.length >= 2) {
      // Pick a distinct index != buff1's within the profession pool.
      const firstIdx = pool.findIndex((b) => b.id === buff1Id);
      let secondIdx = rng.nextInt(pool.length - 1);
      if (secondIdx >= firstIdx) secondIdx += 1; // shift past buff1 so the 2nd pick differs
      buff2Id = pool[secondIdx].id;
    } else {
      // A single-entry profession pool cannot supply a distinct 2nd profession buff; fall back to the
      // exclusive pool so a 2-buff rank still carries its second buff. (No pool is this small today.)
      buff2Id = SECOND_LEVEL_EXCLUSIVE[rng.nextInt(SECOND_LEVEL_EXCLUSIVE.length)].id;
    }
  }

  return { profession, rarity, rank, race, buff1Id, buff2Id };
}
