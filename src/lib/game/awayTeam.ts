// E-CREW "Crew Made Real": the AWAY TEAM engine (pure, DORMANT).
//
// Each ship fields a persistent roster of NAMED away-team members (model.ts AwayMember), stored flat in
// GameState.awayMembers and keyed to a ship by assignedShipId, exactly like Senior Staff officers.
// Squads are typed (D2): Security fights, Science does fieldwork, Prospecting is WIRED ONLY (every hull
// lists it with count 0, so no ship fields one). Squad sizes come from SHIP_TYPES[typeKey].awayTeams
// (design section 5.2), never from a hard-coded per-type switch, so a future hull can list two Security
// details with no engine change (S4-I19).
//
// DORMANT on purpose: nothing in tick.ts, the expedition resolver, or the UI reads this module yet. Every
// function is pure: it reads its inputs and returns fresh values, never mutating an input in place.
// See docs/plans/2026-10-02-crew-made-real-e-crew-design.md sections 4 and 5.

import type {
  AwayMember,
  AwayMemberSpec,
  AwayTeamType,
  AwayTraitId,
  CrewRace,
  CrewRank,
  GameState,
  ShipTypeKey,
} from "./model";
import { SENIOR_STAFF_ROSTER_BASE, SHIP_TYPES } from "./model";
import { awayTraitsForTeam } from "./awayTraits";
import { buffCountForRank, CREW_RANK_ORDER } from "./crewRank";
import { CREW_RACE_IDS } from "./crewRaces";
import { generateCrewIdentity } from "./crew";
import { officerRosterWindowIndex } from "./seniorStaff";
import { makeRng } from "./combat/rng";

// ============================================================================
// Squad sizes (design section 5.2)
// ============================================================================

// How many members a hull's squads of `teamType` hold in total: size * count, summed over every entry
// of that type (a hull may list more than one squad of a type). 0 when the hull lists no such squad,
// has no awayTeams data at all, or the type key is unknown. Pure.
export function squadSlots(typeKey: ShipTypeKey, teamType: AwayTeamType): number {
  const teams = SHIP_TYPES[typeKey]?.awayTeams ?? [];
  let slots = 0;
  for (const t of teams) {
    if (t.teamType === teamType) slots += t.size * t.count;
  }
  return slots;
}

// The members currently on `shipId`'s `teamType` squad, in roster order. Pure read (fresh array).
export function membersInSquad(state: GameState, shipId: string, teamType: AwayTeamType): AwayMember[] {
  return state.awayMembers.filter((m) => m.assignedShipId === shipId && m.teamType === teamType);
}

// Whether `shipId`'s `teamType` squad has an open slot. False for a ship that does not exist and for any
// squad type the hull does not field (Prospecting today). Pure.
export function squadHasRoom(state: GameState, shipId: string, teamType: AwayTeamType): boolean {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return false;
  return membersInSquad(state, shipId, teamType).length < squadSlots(ship.typeKey, teamType);
}

// ============================================================================
// Member traits, implants, specs (design sections 2 and 5.1)
// ============================================================================

// How many traits a member of this rank carries: the complement's buff-count ladder, reused as-is so
// the two rank systems can never drift (D6: rank gates trait count like it gates complement buffs).
export function traitCountForRank(rank: CrewRank): number {
  return buffCountForRank(rank);
}

// The races with AUGMENT AFFINITY (D8, proposal accepted with the design): they get a second implant
// slot. Martian + Stheni both lean engineering, so neither is already the best pick for either squad.
// The balance pass watches for an always-hire-race-X meta.
export const AUGMENT_AFFINITY_RACES: ReadonlySet<CrewRace> = new Set<CrewRace>(["martian", "stheni"]);

// A member's implant slot count: 2 with augment affinity, else 1. Derived from race, never stored. Pure.
export function implantSlotsFor(member: Pick<AwayMember, "race">): number {
  return AUGMENT_AFFINITY_RACES.has(member.race) ? 2 : 1;
}

const SPECS_BY_TEAM: Record<AwayTeamType, readonly AwayMemberSpec[]> = {
  security: ["offense", "defense", "debuff"],
  science: ["archaeology", "xenobiology", "geology", "cryptography"],
  prospecting: [], // spec set still undecided (wired-only squad)
};

// The specs a member of `teamType` can hold, in a fixed order (the recruit roll indexes into it). A
// fresh array, so a caller can never edit the table. Pure.
export function specsFor(teamType: AwayTeamType): AwayMemberSpec[] {
  return [...SPECS_BY_TEAM[teamType]];
}

// ============================================================================
// Deterministic recruit board (design section 5.1)
// ============================================================================
//
// Mirrors seniorStaff.ts seniorStaffCandidates EXACTLY in structure: the board is a pure function of
// (awayRecruitSeed, roster window index, slot), regenerated identically live and offline, and NEVER
// persisted. It shares the officer board's refresh window (officerRosterWindowIndex) and its size
// (seniorStaffRosterSize: one expansion upgrade grows both boards). Hiring copies a candidate into
// GameState.awayMembers (hireAwayMember below).

// The squads a recruit can roll, 50/50. Prospecting is deliberately absent (wired only, D2).
const RECRUITABLE_TEAM_TYPES: readonly AwayTeamType[] = ["security", "science"];

// FIRST-PASS + TUNABLE rank weights for ranks 1..8 (CREW_RANK_ORDER), weighted toward low ranks so a
// Lieutenant Commander recruit is a rare find worth hiring on sight. They sum to 100.
const RECRUIT_RANK_WEIGHTS: readonly number[] = [30, 24, 18, 12, 7, 5, 3, 1];

// Mix the away recruit seed + window index + slot into one uint32 PRNG seed. Same shape as the officer
// board's candidateSeed but with its OWN starting constant, so the two boards stay decorrelated even if
// a later change ever fed them the same base seed. Same three inputs => same seed. Pure.
function awayCandidateSeed(baseSeed: number, windowIndex: number, slot: number): number {
  let h = (baseSeed >>> 0) ^ 0x7f4a7c15;
  h = Math.imul(h ^ ((windowIndex + 1) >>> 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ ((slot + 1) >>> 0), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

// A stable id for a candidate at (windowIndex, slot). Distinct from a hired member's "member-N" id, so
// the two id spaces never collide; hireAwayMember re-ids on hire.
function awayCandidateId(windowIndex: number, slot: number): string {
  return `away-candidate-${windowIndex}-${slot}`;
}

// Roll one rank 1..8 from RECRUIT_RANK_WEIGHTS with a single integer draw (exact odds, one step).
function rollRecruitRank(rng: ReturnType<typeof makeRng>): CrewRank {
  const total = RECRUIT_RANK_WEIGHTS.reduce((a, b) => a + b, 0);
  let roll = rng.nextInt(total);
  for (let i = 0; i < RECRUIT_RANK_WEIGHTS.length; i += 1) {
    roll -= RECRUIT_RANK_WEIGHTS[i];
    if (roll < 0) return CREW_RANK_ORDER[i];
  }
  return CREW_RANK_ORDER[0]; // unreachable (roll < total); keeps the types total
}

// Roll ONE fully-formed candidate for (windowIndex, slot). One PRNG per candidate, drawn in a fixed
// order: squad, spec, race, rank, then distinct traits (a partial Fisher-Yates over the squad's trait
// pool, so no trait repeats). Identity comes from generateCrewIdentity's own separate stream, exactly as
// the officer board does, so it never perturbs the rolls above. Deterministic in its inputs. Pure.
function rollAwayCandidate(baseSeed: number, windowIndex: number, slot: number): AwayMember {
  const seed = awayCandidateSeed(baseSeed, windowIndex, slot);
  const rng = makeRng(seed);

  const teamType = RECRUITABLE_TEAM_TYPES[rng.nextInt(RECRUITABLE_TEAM_TYPES.length)];
  const specs = specsFor(teamType);
  const spec = specs[rng.nextInt(specs.length)];
  const race: CrewRace = CREW_RACE_IDS[rng.nextInt(CREW_RACE_IDS.length)];
  const rank = rollRecruitRank(rng);

  const pool = awayTraitsForTeam(teamType).map((t) => t.id);
  const count = Math.min(traitCountForRank(rank), pool.length);
  const traits: AwayTraitId[] = [];
  for (let i = 0; i < count; i += 1) {
    const j = i + rng.nextInt(pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
    traits.push(pool[i]);
  }

  const identity = generateCrewIdentity(race, seed, slot);

  return {
    id: awayCandidateId(windowIndex, slot),
    teamType,
    spec,
    name: identity.name,
    race,
    gender: identity.gender,
    rank,
    traits,
    assignedShipId: null,
  };
}

// The current recruit board: one candidate per slot, `seniorStaffRosterSize` slots (the shared board
// size), deterministic from the current window + awayRecruitSeed. Ephemeral (never persisted). Pure;
// returns a fresh array of fresh member objects.
export function awayRecruitCandidates(state: GameState): AwayMember[] {
  const windowIndex = officerRosterWindowIndex(state);
  const size = Math.max(0, state.seniorStaffRosterSize ?? SENIOR_STAFF_ROSTER_BASE);
  const baseSeed = state.awayRecruitSeed >>> 0;
  const out: AwayMember[] = [];
  for (let slot = 0; slot < size; slot += 1) {
    out.push(rollAwayCandidate(baseSeed, windowIndex, slot));
  }
  return out;
}
