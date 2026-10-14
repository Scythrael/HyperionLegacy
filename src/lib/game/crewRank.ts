// Crew 0.14.0 (Phase 0.5): the 8-tier complement RANK ladder (pure data + pure readers).
//
// Rank is locked at crew generation and does three things: it names the tier, it gates how many
// BUFFS a crewmember carries (buffCountForRank), and it scales buff magnitude modestly
// (rankMagnitudeFactor). Complement crew never level individually; you improve a ship by acquiring
// a better POOL (see the plan's "Progression" section). Commander is deliberately NOT here: it is
// a Senior-Staff-only officer rank (model.ts OfficerRank), crowning the same continuum.
//
// All magnitudes/counts here are FIRST-PASS + TUNABLE. Nothing is wired into the tick or UI.
// See docs/plans/2026-09-22-crew-0.14.0-plan.md ("Rank ladder + command structure", Phase 0.5).

import type { CrewRank } from "./model";

export interface CrewRankDef {
  id: CrewRank;
  label: string;
  enlisted: boolean; // true for ranks 1-4 (enlisted), false for the officer track 5-8
}

// The ladder, in ascending order. 1-4 enlisted, 5-8 officer track. Labels are user-facing display
// strings (US English). Commander (Senior Staff) sits above rank 8 and is not in this table.
export const CREW_RANKS: Record<CrewRank, CrewRankDef> = {
  1: { id: 1, label: "Crewman", enlisted: true },
  2: { id: 2, label: "Petty Officer", enlisted: true },
  3: { id: 3, label: "Chief", enlisted: true },
  4: { id: 4, label: "Master Chief", enlisted: true },
  5: { id: 5, label: "Cadet", enlisted: false },
  6: { id: 6, label: "Ensign", enlisted: false },
  7: { id: 7, label: "Lieutenant", enlisted: false },
  8: { id: 8, label: "Lieutenant Commander", enlisted: false },
};

// A rank's display label that never throws (GO-12 review minor): a whole rank past the ladder reads as the
// nearest end of it (a rank 10 reads "Lieutenant Commander", a rank 0 "Crewman"); anything else (NaN, a
// fraction, a missing field) reads "Crewman". Every UI label goes through here instead of CREW_RANKS[r].label.
export function crewRankLabel(rank: number | null | undefined): string {
  if (typeof rank !== "number" || !Number.isInteger(rank)) return CREW_RANKS[1].label;
  const clamped = Math.max(1, Math.min(8, rank)) as CrewRank;
  return CREW_RANKS[clamped].label;
}

// The ranks in ascending order, handy for iteration / caps tables.
export const CREW_RANK_ORDER: readonly CrewRank[] = [1, 2, 3, 4, 5, 6, 7, 8];

// How many buffs a crewmember of this rank carries. FIRST-PASS (from the plan's rank table):
// Crewman 1, Petty Officer 1, Chief 2, Master Chief 2, Cadet 2, Ensign 2, Lieutenant 3, Lt Cmdr 3.
// A count of 1 means buff1 only (buff2Id null); 2+ means buff2 is present. (Only buff1/buff2 are
// modeled on a bucket today; a "3" reads as "eligible for the exclusive pool as the 2nd buff" until
// a later phase widens the signature. Tunable.)
const BUFF_COUNT_BY_RANK: Record<CrewRank, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 2,
  5: 2,
  6: 2,
  7: 3,
  8: 3,
};

export function buffCountForRank(rank: CrewRank): number {
  return BUFF_COUNT_BY_RANK[rank];
}

// A modest multiplicative factor that scales a crewmember's buff magnitude by rank. FIRST-PASS:
// 1.0 at Crewman (rank 1), +5% per tier, so a Lt Commander (rank 8) contributes ~1.35x a Crewman's
// per-buff magnitude. Deliberately gentle (rank is a count gate first, a magnitude nudge second).
// Tunable.
export function rankMagnitudeFactor(rank: CrewRank): number {
  return 1 + (rank - 1) * 0.05;
}
