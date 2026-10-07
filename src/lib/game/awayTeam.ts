// E-CREW "Crew Made Real": the AWAY TEAM engine (pure, DORMANT).
//
// Each ship fields a persistent roster of NAMED away-team members (model.ts AwayMember), stored flat in
// GameState.awayMembers and keyed to a ship by assignedShipId, exactly like Senior Staff officers.
// Squads are typed (D2): Security fights, Science does fieldwork, Prospecting is WIRED ONLY (every hull
// lists it with count 0, so no ship fields one). Squad sizes come from SHIP_TYPES[typeKey].awayTeams
// (design section 5.2), never from a hard-coded per-type switch, so a future hull can list two Security
// details with no engine change (S4-I19).
//
// Every function is pure: it reads its inputs and returns fresh values, never mutating an input in place.
// Task 12 adds the ROSTER SNAPSHOT (snapshotAwayRoster): startExpedition freezes the ship's ready members,
// their converted gear stats, traits, implants and programs onto the Expedition at dispatch, so the
// expedition resolver reads the stored snapshot and never this module's live readers.
// See docs/plans/2026-10-02-crew-made-real-e-crew-design.md sections 4 and 5.

import type {
  AwayMember,
  AwayMemberSpec,
  AwayRosterSnapshot,
  AwayTeamType,
  AwayTraitId,
  CrewRace,
  CrewRank,
  EquipmentInstance,
  GambitProgram,
  GambitStatusId,
  GameState,
  MemberGroundEffect,
  MemberGroundStatKey,
  ShipInstance,
  ShipTypeKey,
  SnapshotGearPiece,
  SnapshotMember,
} from "./model";
import {
  DEFAULT_MEMBER_GAMBIT,
  MEMBER_GROUND_STAT_KEYS,
  SENIOR_STAFF_ROSTER_BASE,
  SHIP_TYPES,
  isMemberSlotType,
  memberVariety,
  startAutoSalvageGrace,
} from "./model";
import { awayTraitsForTeam, getAwayTrait } from "./awayTraits";
import { buffCountForRank, CREW_RANK_ORDER, rankMagnitudeFactor } from "./crewRank";
import { CREW_RACE_IDS } from "./crewRaces";
import { generateCrewIdentity } from "./crew";
import { OFFICER_ROSTER_WINDOW_SECONDS, officerRosterWindowIndex } from "./seniorStaff";
import { makeRng, weightedPick, type Rng } from "./combat/rng";
import { onMissionLock } from "./equipment";

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
// Member stats, traits, implants, specs (design sections 2, 5.1 and 5.3)
// ============================================================================

// A member stat that traits, gear and implants can raise, each bump a FRACTION of the member's own value
// (0.05 = +5%). The Security stats match the member card's HP / PWR / ARM / ACC line; the Science ones
// its FIELD / RELIC / HAZ line, plus statusChance for the Debuff spec's afflictions.
// STACKING RULE: every same-stat bump from traits, gear and implants ADDS (two +5% accuracy sources make
// +10%, never 1.05 * 1.05), the codebase's additive-within-a-layer convention. The member-power task
// (design section 5.3) applies the summed bump once to the member's base value.
export type AwayMemberStat =
  | "hp"
  | "power"
  | "armor"
  | "accuracy"
  | "statusChance"
  | "fieldwork"
  | "relicFind"
  | "hazardResist";

// E-CREW 0.14.0 (Task 7): which member stat each GROUND gear line raises. Member gear rolls its own stat
// vocabulary (model.ts MEMBER_GROUND_STAT_KEYS, `ground`-prefixed so it can never collide with a ship
// stat), and the member-power layer (design section 5.3) reads a worn piece's lines through THIS map.
// null = a line with no member card stat to raise (see the contract below). Total Record, so a new ground
// key is a compile error here until it is mapped.
//
// CONVERSION CONTRACT (who turns gear POINTS into game magnitudes):
//   - A gear line is raw budget POINTS (generateEquipment's split), so it scales with the piece's iLevel,
//     quality and rarity. Points are SUMMED per member across every worn piece (armor + weapon + tool +
//     implants), additively per the STACKING RULE above, and converted ONCE per member.
//   - Member power (the eight mapped card stats: hp / power / armor / accuracy / fieldwork / relicFind /
//     hazardResist / statusChance): the roster SNAPSHOT at dispatch (Task 12) converts the summed points
//     through convertGroundPoints (below, the ONE conversion; its coefficients are GEAR_POINT_BUMP).
//   - Battle stats + resists (power / armor / accuracy / hp / statusChance, and groundStatusResist): the
//     Security battle (Task 13) consumes the snapshot's converted values (and converts groundStatusResist).
//   - Fieldwork yields + relic odds + hazard (fieldwork / relicFind / hazardResist, and the two yield
//     lines): fieldwork (Task 15).
//   - The three null keys: groundStatusResist becomes the member's chance to resist the statuses listed
//     by its `resistStatus` pieces (Task 13); groundOrganicsYield / groundVaultYield become fieldwork
//     yield multipliers toward organics / vault finds (Task 15).
// THE STATUS-CHANCE RULE: a piece's groundStatusChance ALWAYS folds into the member-wide statusChance (it
// maps there like any other line), and an `inflict` piece applies its listed status with chance = that
// member's statusChance. There is no separate per-piece chance read.
export const GROUND_STAT_MEMBER_STAT: Record<MemberGroundStatKey, AwayMemberStat | null> = {
  groundHp: "hp",
  groundPower: "power",
  groundArmor: "armor",
  groundAccuracy: "accuracy",
  groundStatusChance: "statusChance",
  groundStatusResist: null,
  groundFieldwork: "fieldwork",
  groundRelicFind: "relicFind",
  groundHazardResist: "hazardResist",
  groundOrganicsYield: null,
  groundVaultYield: null,
};

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

// The squads a recruit can roll, 50/50. Prospecting is deliberately absent (wired only, D2). Every type
// listed here MUST have a non-empty specsFor set (rollAwayCandidate checks it); add specs for a type
// before making it recruitable.
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

// Roll one rank 1..8 from RECRUIT_RANK_WEIGHTS with the shared single-draw weightedPick (exact odds,
// one step of the stream).
function rollRecruitRank(rng: Rng): CrewRank {
  return weightedPick(rng, CREW_RANK_ORDER, RECRUIT_RANK_WEIGHTS);
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
  // A programming error, not a player state: RECRUITABLE_TEAM_TYPES only lists types with specs. Fail
  // loud (the board tests roll thousands of candidates, so this can never ship silently).
  if (specs.length === 0) throw new Error(`awayTeam: recruitable team type "${teamType}" has no specs`);
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
// size), deterministic from the current window + awayRecruitSeed. Ephemeral (never persisted). A
// candidate a current member was hired from (AwayMember.hiredFrom) is left off, so a hired recruit
// leaves the board and cannot be hired twice; every other slot is unaffected (slots roll independently).
// A FIRED recruit therefore REAPPEARS on the board if their window is still open (no member carries their
// hiredFrom any more). That acts as an undo for a misclicked fire and is harmless, since hiring is free.
// Open for the user to revisit. Pure; returns a fresh array of fresh member objects.
export function awayRecruitCandidates(state: GameState): AwayMember[] {
  const windowIndex = officerRosterWindowIndex(state);
  const size = Math.max(0, state.seniorStaffRosterSize ?? SENIOR_STAFF_ROSTER_BASE);
  const baseSeed = state.awayRecruitSeed >>> 0;
  const hired = new Set(state.awayMembers.map((m) => m.hiredFrom).filter((id) => id !== undefined));
  const out: AwayMember[] = [];
  for (let slot = 0; slot < size; slot += 1) {
    if (hired.has(awayCandidateId(windowIndex, slot))) continue;
    out.push(rollAwayCandidate(baseSeed, windowIndex, slot));
  }
  return out;
}

// Seconds until the board rolls over to its next window (the officer board's window, so both refresh
// together). Always in (0, OFFICER_ROSTER_WINDOW_SECONDS]. Pure.
export function awayBoardSecondsToRefresh(state: GameState): number {
  return (officerRosterWindowIndex(state) + 1) * OFFICER_ROSTER_WINDOW_SECONDS - state.gameTimeSeconds;
}

// ============================================================================
// Actions (each returns a NEW GameState; inputs are never mutated; a refusal returns the SAME ref)
// ============================================================================

// Whether a ship's crew is LOCKED right now (design section 5.6, S1-62): no hire, fire or reassign
// touches a ship that is out. Two sources, both existing state, nothing reinvented:
//   - the captain is on a mission or patrol: equipment.ts onMissionLock, the SAME guard that locks gear
//     installs and ship salvage (one source of truth for "this hull is in flight");
//   - the ship is on an expedition: onMissionLock does not see those (an expedition lives in
//     state.expeditions, not on captain.mission), yet that is exactly when the away team is deployed and
//     its members are snapshotted, and claim later applies injuries to the live members. The test is the
//     same "one expedition per ship" check startExpedition uses; it holds until the run is claimed.
// A ship that does not exist is not locked (there is nothing in flight to protect), so a member left
// pointing at a removed hull can still be fired or reassigned. Task 27 routes every crew action
// (officers, complement, rosters) through this one helper. Pure.
export function shipCrewLocked(state: GameState, shipId: string): boolean {
  const lock = onMissionLock(state, shipId);
  if (!lock.ok && lock.reason === "onMission") return true;
  return state.expeditions.some((e) => e.shipId === shipId);
}

// Why a crew action is refused, the gate pattern of equipment.ts canFitEquipment / EquipFitBlockReason:
// each can* gate answers "would this go through, and if not, why?" so the UI can show a disabled control
// with its reason, and each action calls its gate and returns the SAME state on refusal.
//   noCandidate:  the candidate is not on the current board (never was, or already hired)
//   noMember:     no member with that id
//   noShip:       the target ship does not exist
//   onMission:    a ship involved is crew-locked (shipCrewLocked); Task 27 unifies every crew lock on it
//   noSquad:      the target hull fields no squad of the member's team type at all (0 slots), so the
//                 player is never told "Squad is full" about a squad that does not exist
//   squadFull:    the target squad of the member's team type has no open slot
//   alreadyThere: a reassign to where the member already is (same ship, or benching a benched member)
export type AwayCrewBlockReason =
  | "noCandidate"
  | "noMember"
  | "noShip"
  | "onMission"
  | "noSquad"
  | "squadFull"
  | "alreadyThere";

export type AwayCrewGate = { ok: true } | { ok: false; reason: AwayCrewBlockReason };

// The player-facing line for a block reason (US English), shown on a disabled control. EXHAUSTIVE with
// no default on purpose (the requisitionBlockText pattern): a new AwayCrewBlockReason is a compile error
// here until it has text. Pure.
export function awayCrewBlockText(reason: AwayCrewBlockReason): string {
  switch (reason) {
    case "noCandidate":
      return "No longer on the board";
    case "noMember":
      return "No longer in the fleet";
    case "noShip":
      return "That ship is no longer in the fleet";
    case "onMission":
      return "Ship is out on a mission";
    case "noSquad":
      return "This ship fields no such squad";
    case "squadFull":
      return "Squad is full";
    case "alreadyThere":
      return "Already on this ship";
  }
}

// The squad half of a hire / move gate: noShip, noSquad (the hull fields none of this type), squadFull,
// or ok. The caller has already checked the crew lock. Pure.
function squadGate(state: GameState, shipId: string, teamType: AwayTeamType): AwayCrewGate {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return { ok: false, reason: "noShip" };
  if (squadSlots(ship.typeKey, teamType) === 0) return { ok: false, reason: "noSquad" };
  if (!squadHasRoom(state, shipId, teamType)) return { ok: false, reason: "squadFull" };
  return { ok: true };
}

// The board candidate with this id, or undefined when it is not on the current board. Builds the board
// once; every hire path below calls it once per public call and then reuses the result. Pure.
function boardCandidate(state: GameState, candidateId: string): AwayMember | undefined {
  return awayRecruitCandidates(state).find((c) => c.id === candidateId);
}

// The hire gate for an already-looked-up candidate (undefined = not on the board), so canHireAwayMember,
// hireTargetsFor and hireAwayMember share ONE board build per call (the UI calls these on render, and
// hireTargetsFor would otherwise rebuild the board once per ship). Pure.
function hireGateFor(state: GameState, candidate: AwayMember | undefined, shipId: string): AwayCrewGate {
  if (!candidate) return { ok: false, reason: "noCandidate" };
  if (!state.ships.some((s) => s.id === shipId)) return { ok: false, reason: "noShip" };
  if (shipCrewLocked(state, shipId)) return { ok: false, reason: "onMission" };
  return squadGate(state, shipId, candidate.teamType);
}

// Can this board candidate be hired into `shipId`'s squad of the candidate's team type? Checked in order:
// noCandidate, noShip, onMission, noSquad, squadFull. Pure.
export function canHireAwayMember(state: GameState, candidateId: string, shipId: string): AwayCrewGate {
  return hireGateFor(state, boardCandidate(state, candidateId), shipId);
}

// Every ship as a hire target for this candidate, in fleet order, with whether the hire would go through
// and why not, so the UI can list each ship and show the blocked ones disabled with their reason. A
// candidate not on the board marks every ship noCandidate. The board is built once for the whole list.
// Pure.
export function hireTargetsFor(
  state: GameState,
  candidateId: string,
): { shipId: string; ok: boolean; reason?: AwayCrewBlockReason }[] {
  return hireTargetsForCandidate(state, boardCandidate(state, candidateId));
}

// hireTargetsFor for a candidate the caller ALREADY holds (from one awayRecruitCandidates call), so a
// UI listing the whole board builds it once in total rather than once per candidate. Pass a candidate
// taken from the current board; undefined marks every ship noCandidate, like an unknown id. Pure.
export function hireTargetsForCandidate(
  state: GameState,
  candidate: AwayMember | undefined,
): { shipId: string; ok: boolean; reason?: AwayCrewBlockReason }[] {
  return state.ships.map((ship) => {
    const gate = hireGateFor(state, candidate, ship.id);
    return gate.ok ? { shipId: ship.id, ok: true } : { shipId: ship.id, ok: false, reason: gate.reason };
  });
}

// Hire a candidate from the CURRENT board into `shipId`'s squad of the candidate's team type. Refuses
// (returns the SAME state) whenever canHireAwayMember does. The hire is re-ided to "member-N" from
// nextAwayMemberId (mirroring hireOfficer), records the candidate id in hiredFrom, and keeps its rolled
// squad / spec / identity / rank / traits. Builds the board once. Pure.
export function hireAwayMember(state: GameState, candidateId: string, shipId: string): GameState {
  const candidate = boardCandidate(state, candidateId);
  if (!candidate || !hireGateFor(state, candidate, shipId).ok) return state;
  const hired: AwayMember = {
    ...candidate,
    id: `member-${state.nextAwayMemberId}`,
    traits: [...candidate.traits],
    assignedShipId: shipId,
    hiredFrom: candidate.id,
  };
  return {
    ...state,
    awayMembers: [...state.awayMembers, hired],
    nextAwayMemberId: state.nextAwayMemberId + 1,
  };
}

// Can this member be fired? noMember for an unknown id, onMission while the member's ship is
// crew-locked (an unassigned member is never locked). Pure.
export function canFireAwayMember(state: GameState, memberId: string): AwayCrewGate {
  const target = state.awayMembers.find((m) => m.id === memberId);
  if (!target) return { ok: false, reason: "noMember" };
  if (target.assignedShipId !== null && shipCrewLocked(state, target.assignedShipId)) {
    return { ok: false, reason: "onMission" };
  }
  return { ok: true };
}

// Fire a member. Refuses (returns the SAME state) whenever canFireAwayMember does. Otherwise it FIRST
// returns everything the member wears to storage (every piece with fittedToMemberId === memberId gets
// null, which makes it spare again through isSparePiece: armor, weapon, tool and implants alike), THEN
// removes the member, so no piece is ever left pointing at a member who no longer exists. Every returned
// piece gets its auto-salvage grace restarted (startAutoSalvageGrace, model.ts), like every other uninstall
// route (equipment.ts, memberEquipment.ts): worn gear is never an auto-salvage candidate, so without the
// stamp a fired member's kit would be exposed the instant it reached storage. Pure.
export function fireAwayMember(state: GameState, memberId: string): GameState {
  if (!canFireAwayMember(state, memberId).ok) return state;
  return {
    ...state,
    equipment: state.equipment.map((e) =>
      e.fittedToMemberId === memberId
        ? startAutoSalvageGrace({ ...e, fittedToMemberId: null }, state.gameTimeSeconds)
        : e
    ),
    awayMembers: state.awayMembers.filter((m) => m.id !== memberId),
  };
}

// Can this member move to `shipId`'s squad of their own team type, or be benched (shipId null)? Checked
// in order: noMember, alreadyThere, onMission (the ship they leave), then for a real target noShip,
// onMission (the ship they join), noSquad and squadFull. Pure.
export function canReassignAwayMember(state: GameState, memberId: string, shipId: string | null): AwayCrewGate {
  const target = state.awayMembers.find((m) => m.id === memberId);
  if (!target) return { ok: false, reason: "noMember" };
  if (target.assignedShipId === shipId) return { ok: false, reason: "alreadyThere" };
  if (target.assignedShipId !== null && shipCrewLocked(state, target.assignedShipId)) {
    return { ok: false, reason: "onMission" };
  }
  if (shipId !== null) {
    if (!state.ships.some((s) => s.id === shipId)) return { ok: false, reason: "noShip" };
    if (shipCrewLocked(state, shipId)) return { ok: false, reason: "onMission" };
    return squadGate(state, shipId, target.teamType);
  }
  return { ok: true };
}

// Move a member to another ship's squad of the member's own team type, or bench them (shipId null =
// unassigned). Refuses (returns the SAME state) whenever canReassignAwayMember does, which includes the
// same-ref no-op of moving a member to where they already are. Gear travels with the member (it is
// keyed to the member, not the ship). Pure.
export function reassignAwayMember(state: GameState, memberId: string, shipId: string | null): GameState {
  if (!canReassignAwayMember(state, memberId, shipId).ok) return state;
  return {
    ...state,
    awayMembers: state.awayMembers.map((m) => (m.id === memberId ? { ...m, assignedShipId: shipId } : m)),
  };
}

// ============================================================================
// Member power: the gear POINT conversion (design section 5.3, the CONVERSION CONTRACT above)
// ============================================================================
//
// A worn piece's ground lines are raw budget POINTS (itemgen.ts computeBudget: iLevel * 2 * quality and
// rarity multipliers), so they already scale with the piece's iLevel. The snapshot SUMS every worn
// piece's lines per member and converts them ONCE, here, into member stat bumps:
//
//   bump(stat) = summedPoints(stat line) * GEAR_POINT_BUMP[stat]
//
// For hp / power / armor / accuracy / fieldwork / relicFind / hazardResist the bump is a FRACTION of the
// member's own base value (0.01 = +1%), ADDED to every other same-stat bump (traits), the STACKING RULE.
// statusChance and the status resist are CHANCES with no base value worth scaling, so their bump IS the
// chance, in absolute terms (0.005 per point: 20 points = 10 percentage points).
// A Standard-Issue baseline carries every line at 0 (model.ts STANDARD_ISSUE_IMPLICIT_MAGNITUDE), so it
// converts to no bump at all.
// FIRST-PASS TUNABLE: every coefficient. Reference point: an iLevel 10 Standard-rarity quality 0 piece
// has a 20 point budget, so a crafted rifle carries about 10 power points (+10% power).
export const GEAR_POINT_BUMP: Readonly<Record<AwayMemberStat, number>> = {
  hp: 0.01,
  power: 0.01,
  armor: 0.025, // base armor is small (a flat damage cut), so each point moves it a little more
  accuracy: 0.004, // base accuracy is already high and the battle caps it
  statusChance: 0.005, // absolute chance per point
  fieldwork: 0.01,
  relicFind: 0.01,
  hazardResist: 0.01,
};

// groundStatusResist has no member card stat (GROUND_STAT_MEMBER_STAT maps it to null): it converts to the
// member's absolute chance to resist the statuses its resistStatus pieces list. FIRST-PASS TUNABLE.
export const STATUS_RESIST_PER_POINT = 0.01;

// The most any one status resist can reach, so no member is ever fully immune. FIRST-PASS TUNABLE.
export const STATUS_RESIST_CAP = 0.9;

// The eight member stats in a fixed order (the keys every SnapshotMember.groundStats carries).
const AWAY_MEMBER_STATS: readonly AwayMemberStat[] = [
  "hp",
  "power",
  "armor",
  "accuracy",
  "statusChance",
  "fieldwork",
  "relicFind",
  "hazardResist",
];

// THE conversion: summed ground line points (any subset of MEMBER_GROUND_STAT_KEYS) -> the member stat
// bumps (every AwayMemberStat key present, 0 when nothing feeds it) and the status-resist chance.
// groundOrganicsYield / groundVaultYield are fieldwork yields (Task 15) and are not converted here. Pure.
export function convertGroundPoints(points: Partial<Record<MemberGroundStatKey, number>>): {
  stats: Record<AwayMemberStat, number>;
  statusResist: number;
} {
  const stats = {} as Record<AwayMemberStat, number>;
  for (const stat of AWAY_MEMBER_STATS) stats[stat] = 0;
  for (const key of MEMBER_GROUND_STAT_KEYS) {
    const stat = GROUND_STAT_MEMBER_STAT[key];
    if (stat === null) continue;
    stats[stat] += (points[key] ?? 0) * GEAR_POINT_BUMP[stat];
  }
  return { stats, statusResist: (points.groundStatusResist ?? 0) * STATUS_RESIST_PER_POINT };
}

// One piece's ground lines (implicit + rolled), summed per ground key. Ship keys are ignored. Pure.
export function pieceGroundPoints(
  piece: Pick<EquipmentInstance, "implicitStats" | "rolledStats">
): Partial<Record<MemberGroundStatKey, number>> {
  const out: Partial<Record<MemberGroundStatKey, number>> = {};
  for (const key of MEMBER_GROUND_STAT_KEYS) {
    const v = (piece.implicitStats[key] ?? 0) + (piece.rolledStats[key] ?? 0);
    if (v !== 0) out[key] = v;
  }
  return out;
}

// A piece's total ground points across every line: the magnitude a gear EFFECT scales with. Pure.
function pieceTotalPoints(piece: Pick<EquipmentInstance, "implicitStats" | "rolledStats">): number {
  let total = 0;
  for (const v of Object.values(pieceGroundPoints(piece))) total += v ?? 0;
  return total;
}

// ============================================================================
// The roster snapshot at dispatch (Task 12, design section 5.5)
// ============================================================================

// Is a member ready to deploy right now? Injured members (D9) sit out until injuredUntilSeconds. Pure.
export function isMemberReady(member: Pick<AwayMember, "injuredUntilSeconds">, gameTimeSeconds: number): boolean {
  return member.injuredUntilSeconds === undefined || member.injuredUntilSeconds <= gameTimeSeconds;
}

// The trailing number of an id ("member-12" -> 12, "equip-7" -> 7), Infinity when there is none. The
// deterministic HIRE order (members) and MINT order (pieces). Equal keys keep input order (stable sort).
function idNumber(id: string): number {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

function byIdNumber<T extends { id: string }>(a: T, b: T): number {
  const x = idNumber(a.id);
  const y = idNumber(b.id);
  return x === y ? 0 : x - y;
}

// The members of `ship`'s `teamType` squad who DEPLOY: ready ones only, in hire order, capped at the hull's
// squadSlots. An injured member, or one past the cap (possible only if a hull's squad size ever shrank),
// stays aboard. Pure.
export function deployableMembers(state: GameState, ship: ShipInstance, teamType: AwayTeamType): AwayMember[] {
  const cap = squadSlots(ship.typeKey, teamType);
  return membersInSquad(state, ship.id, teamType)
    .filter((m) => isMemberReady(m, state.gameTimeSeconds))
    .sort(byIdNumber)
    .slice(0, cap);
}

// Deep-copy a program so the snapshot never aliases live state (the editor mutates its working copy).
function cloneProgram(program: GambitProgram): GambitProgram {
  return program.map((r) => ({ ...r, params: r.params ? { ...r.params } : undefined }));
}

// Freeze ONE member: convert their worn gear, fold in their traits, normalize every effect. `worn` is the
// member's worn pieces in mint order. A Security member without their own program gets the built-in
// DEFAULT_MEMBER_GAMBIT (D19), never the account-level program. Pure.
export function snapshotMember(member: AwayMember, worn: readonly EquipmentInstance[]): SnapshotMember {
  // 1) Gear: sum every worn piece's lines, convert once (the CONVERSION CONTRACT). Each piece's fixed
  // groundEffect normalizes into the effect list, carrying the piece's own points as its magnitude.
  const summed: Partial<Record<MemberGroundStatKey, number>> = {};
  const gear: SnapshotGearPiece[] = [];
  const effects: MemberGroundEffect[] = [];
  const gearResistStatuses = new Set<GambitStatusId>();
  for (const piece of worn) {
    if (!isMemberSlotType(piece.slotType)) continue; // defensive: only member gear is ever worn
    const lines = pieceGroundPoints(piece);
    for (const key of Object.keys(lines) as MemberGroundStatKey[]) {
      summed[key] = (summed[key] ?? 0) + (lines[key] ?? 0);
    }
    const points = pieceTotalPoints(piece);
    const varietyKey = piece.moduleVariant ?? "";
    gear.push({ pieceId: piece.id, slotType: piece.slotType, varietyKey, points });
    const effect = memberVariety(piece.slotType, varietyKey)?.member.groundEffect;
    if (!effect) continue;
    switch (effect.kind) {
      case "groupHit":
        effects.push({ kind: "groupHit", points });
        break;
      case "inflict":
        effects.push({ kind: "inflict", status: effect.status, points });
        break;
      case "heal":
        effects.push({ kind: "heal", points });
        break;
      case "revive":
        effects.push({ kind: "revive", chance: effect.chance, hpFraction: effect.hpFraction, points });
        break;
      case "resistStatus":
        for (const status of effect.statuses) gearResistStatuses.add(status);
        break;
    }
  }
  const converted = convertGroundPoints(summed);

  // 2) Traits: stat bumps ADD to the gear bumps (the STACKING RULE); the rest normalize into effects or
  // resists. An id the catalog no longer carries is skipped.
  const groundStats: Record<string, number> = { ...converted.stats };
  const resists: Partial<Record<GambitStatusId, number>> = {};
  for (const id of member.traits) {
    const trait = getAwayTrait(id);
    if (!trait) continue;
    for (const e of trait.effects) {
      switch (e.kind) {
        case "stat":
          groundStats[e.stat] = (groundStats[e.stat] ?? 0) + e.value;
          break;
        case "resistStatus":
          resists[e.status] = (resists[e.status] ?? 0) + e.value;
          break;
        case "medic":
          effects.push({ kind: "medic" });
          break;
        case "firstStrike":
          effects.push({ kind: "firstStrike" });
          break;
        case "guard":
          effects.push({ kind: "guard", allyHpBelow: e.allyHpBelow });
          break;
        case "poiYield":
          effects.push({ kind: "poiYield", pois: [...e.pois], value: e.value });
          break;
      }
    }
  }
  // 3) Gear resists: the member's converted statusResist applies to EVERY status any of its resistStatus
  // pieces list (the contract's rule), once per status, on top of trait resists. Then cap each one so no
  // member is ever immune.
  if (converted.statusResist > 0) {
    for (const status of gearResistStatuses) resists[status] = (resists[status] ?? 0) + converted.statusResist;
  }
  for (const status of Object.keys(resists) as GambitStatusId[]) {
    resists[status] = Math.min(STATUS_RESIST_CAP, resists[status] ?? 0);
  }

  return {
    memberId: member.id,
    teamType: member.teamType,
    spec: member.spec,
    rank: member.rank,
    rankFactor: rankMagnitudeFactor(member.rank),
    traits: [...member.traits],
    groundStats,
    resists,
    implants: gear.filter((g) => g.slotType === "implant").map((g) => g.varietyKey),
    gear,
    // Security runs its own program, else the built-in default (D19). Science carries its own (or none)
    // INERTLY: Science never enters a battle (design D2), so nothing executes it.
    gambit: cloneProgram(member.gambit ?? (member.teamType === "security" ? DEFAULT_MEMBER_GAMBIT : [])),
    effects,
  };
}

// The ship's away-team ROSTER SNAPSHOT at dispatch: each squad's deployable members (ready, hire order,
// capped), frozen with their converted gear, traits, implants and programs. An empty squad is []. Pure:
// reads state.awayMembers and state.equipment (fittedToMemberId, the member-gear authority); returns fresh
// data with no live references. D19: it never reads state.gambitPrograms.
export function snapshotAwayRoster(state: GameState, ship: ShipInstance): AwayRosterSnapshot {
  const worn = new Map<string, EquipmentInstance[]>();
  for (const e of state.equipment) {
    if (!e.fittedToMemberId) continue;
    const list = worn.get(e.fittedToMemberId);
    if (list) list.push(e);
    else worn.set(e.fittedToMemberId, [e]);
  }
  for (const list of worn.values()) list.sort(byIdNumber);
  const squad = (teamType: AwayTeamType): SnapshotMember[] =>
    deployableMembers(state, ship, teamType).map((m) => snapshotMember(m, worn.get(m.id) ?? []));
  return { security: squad("security"), science: squad("science") };
}
