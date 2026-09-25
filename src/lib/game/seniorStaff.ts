// Crew 0.14.0 (Phase 1): the SENIOR STAFF officer engine (pure, DORMANT).
//
// The few named bridge-seat officers (model.ts SeniorStaffOfficer) are the hand-curated,
// individually-promoted counterpart to the hundreds-scale complement. This module is the pure
// LOGIC + STATE layer for them: a deterministic candidate roster, hire/fire, seat-typed assignment,
// and the 5-rank Cadet -> Commander promotion ladder with first-pass gates. It is DORMANT on
// purpose (mirrors Phase 0 / 0.5): NOTHING here is wired into tick.ts, shipDerivedStats, or the UI.
// Folding officer contributions into ship stats is a deliberately separate later "crew goes live"
// phase (the parity-sensitive overlay). Every function is pure: it reads its inputs and returns
// fresh values, never mutating an input state/officer/array in place.
//
// KEY MECHANICS (from docs/plans/2026-09-22-crew-0.14.0-plan.md, "Phase 1 refinements + SEAT-
// MATCHING", user 2026-09-23):
//   - Seats are TYPED. Each hull has ONE of each of the 7 SeniorStaffSeat types. An officer carries
//     a seat type and can ONLY fill its matching seat; you cannot stack two of the same type on one
//     ship.
//   - Ranks are 5 tiers starting at CADET. New officers start at "cadet".
//   - The candidate roster is regenerated DETERMINISTICALLY from a gameTimeSeconds WINDOW index +
//     the per-save seed (never Date.now()), so it is identical live vs offline and needs no catch-up.
//
// Reuses the Phase 0.5 catalogs: SENIOR_STAFF_BONUSES / seniorStaffBonusesForSeat
// (seniorStaffBonuses.ts), CREW_RACES / CREW_RACE_IDS (crewRaces.ts), and generateCrewIdentity
// (crew.ts). The deterministic PRNG is the shared combat mulberry32 (combat/rng.ts), never
// Math.random (which would break offline==live determinism).

import type {
  GameState,
  OfficerBonus,
  OfficerRank,
  PromotionObjectiveKind,
  SeniorStaffOfficer,
  SeniorStaffSeat,
  CrewRace,
} from "./model";
import { SENIOR_STAFF_ROSTER_BASE } from "./model";
import { seniorStaffBonusesForSeat, getSeniorStaffBonusById } from "./seniorStaffBonuses";
import { CREW_RACES, CREW_RACE_IDS } from "./crewRaces";
import { generateCrewIdentity } from "./crew";
import { makeRng } from "./combat/rng";

// The 7 typed bridge seats, in a fixed order (matches the SeniorStaffSeat union). Exported for
// iteration (rolling a candidate seat, enumerating a hull's seats). One of each per hull.
export const SENIOR_STAFF_SEATS: readonly SeniorStaffSeat[] = [
  "executive",
  "pilot",
  "operations",
  "science",
  "tactical",
  "medical",
  "engineering",
];

// ============================================================================
// Rank ladder (5 tiers, Cadet -> Commander)
// ============================================================================

// The promotion ladder in ascending order. A new officer starts at OFFICER_RANK_ORDER[0] ("cadet");
// "commander" is the top (no rank above it). Stable keys; display labels are officerRankLabel.
export const OFFICER_RANK_ORDER: readonly OfficerRank[] = [
  "cadet",
  "ensign",
  "lieutenant",
  "lieutenantCommander",
  "commander",
];

const OFFICER_RANK_LABELS: Record<OfficerRank, string> = {
  cadet: "Cadet",
  ensign: "Ensign",
  lieutenant: "Lieutenant",
  lieutenantCommander: "Lieutenant Commander",
  commander: "Commander",
};

// The user-facing display name for an officer rank (US English).
export function officerRankLabel(rank: OfficerRank): string {
  return OFFICER_RANK_LABELS[rank];
}

// A modest multiplicative factor that scales an officer's bonus magnitude by rank. The catalog
// magnitudes (seniorStaffBonuses.ts) are Ensign-tier BASES, so ensign == 1.0; a cadet contributes
// a little less and each promotion strengthens the bonuses a step. FIRST-PASS + TUNABLE.
const OFFICER_RANK_MAGNITUDE_FACTOR: Record<OfficerRank, number> = {
  cadet: 0.85,
  ensign: 1.0,
  lieutenant: 1.2,
  lieutenantCommander: 1.45,
  commander: 1.75,
};

// The rank magnitude factor (pure reader). Exposed so the later overlay phase and tests can scale a
// bonus the same way the engine does.
export function officerRankMagnitudeFactor(rank: OfficerRank): number {
  return OFFICER_RANK_MAGNITUDE_FACTOR[rank];
}

// The next rank up the ladder, or null when already at the top ("commander").
export function nextOfficerRank(rank: OfficerRank): OfficerRank | null {
  const i = OFFICER_RANK_ORDER.indexOf(rank);
  if (i < 0 || i >= OFFICER_RANK_ORDER.length - 1) return null;
  return OFFICER_RANK_ORDER[i + 1];
}

// ============================================================================
// Promotion objectives (first-pass, TUNABLE) -- an OBJECTIVE-SET checklist
// ============================================================================
//
// Promotion (Crew 0.14.0 C-1, from the crew-UI review) is no longer a single mission-count gate: an
// officer promotes only when it clears a SET OF OBJECTIVES for its current rank, a CHECKLIST the ship's
// Senior Staff detail renders (the mechanic's home is on the ship, surfaced in a later UI phase). The
// full objective catalog is a dedicated BALANCING job (docs/plans/2026-09-22-crew-0.14.0-plan.md,
// "Senior Staff PROMOTION = objective-gated"), so 0.14.0 ships WORKING PLACEHOLDER criteria in the same
// "first-pass, tunable" posture as the rest of crew: the mechanic is real + testable now, the real sets
// come in balancing. PromotionObjectiveKind (model.ts) is a CLOSED union so a new kind is a compile
// decision.

// One row of an officer's promotion checklist: reach `target` of `kind`. `label` is the US-English
// display string. FIRST-PASS + TUNABLE.
export interface PromotionObjective {
  kind: PromotionObjectiveKind;
  target: number;
  label: string;
}

// FIRST-PASS + TUNABLE promotion OBJECTIVE SETS, keyed by the officer's CURRENT rank (the rank being
// promoted OUT of). Promoting is a CHECKLIST: EVERY objective in the set must be met (canPromoteOfficer).
// The `missionsCompleted` rows PRESERVE the old single-gate thresholds (Cadet->Ensign @10,
// Ensign->Lieutenant @30, Lieutenant->LtCommander @75, LtCommander->Commander @150) and the top rung
// keeps its `personnelAchievement` requirement; the extra shipsDestroyed / crewHours rows are placeholder
// flavor so the checklist has multiple rows like the mockup. "commander" is absent (top rank, no set).
export const PROMOTION_OBJECTIVE_SETS: Partial<Record<OfficerRank, readonly PromotionObjective[]>> = {
  cadet: [
    { kind: "missionsCompleted", target: 10, label: "Complete 10 missions" },
    { kind: "crewHours", target: 50, label: "Command 50 crew-hours" },
  ],
  ensign: [
    { kind: "missionsCompleted", target: 30, label: "Complete 30 missions" },
    { kind: "shipsDestroyed", target: 5, label: "Destroy 5 hostile ships" },
    { kind: "crewHours", target: 200, label: "Command 200 crew-hours" },
  ],
  lieutenant: [
    { kind: "missionsCompleted", target: 75, label: "Complete 75 missions" },
    { kind: "shipsDestroyed", target: 20, label: "Destroy 20 hostile ships" },
    { kind: "crewHours", target: 600, label: "Command 600 crew-hours" },
  ],
  lieutenantCommander: [
    { kind: "missionsCompleted", target: 150, label: "Complete 150 missions" },
    { kind: "shipsDestroyed", target: 50, label: "Destroy 50 hostile ships" },
    { kind: "personnelAchievement", target: 1, label: "Earn a Personnel commendation" },
  ],
};

// Per-SEAT flavor: a seat's SIGNATURE objective kind is weighted heavier for that seat, so e.g. a
// tactical officer's checklist leans on ship kills. FIRST-PASS + TUNABLE; only `tactical` carries a
// signature today (every other seat falls back to the shared set unchanged). A small closed map so a
// seat with no entry is simply the shared set.
const SEAT_SIGNATURE_OBJECTIVE: Partial<Record<SeniorStaffSeat, PromotionObjectiveKind>> = {
  tactical: "shipsDestroyed",
};

// How much heavier a seat's signature objective target is versus the shared base. FIRST-PASS + TUNABLE.
const SEAT_SIGNATURE_TARGET_FACTOR = 1.5;

// The objective set an officer must clear to promote OUT of its CURRENT rank, with the per-seat flavor
// applied (its signature kind's target scaled where that kind appears in the set). Empty at "commander"
// (top rank) or an unknown rank. Pure: returns fresh objective objects only when flavor changes a
// target, otherwise the shared rows.
export function officerPromotionObjectiveSet(officer: SeniorStaffOfficer): readonly PromotionObjective[] {
  const base = PROMOTION_OBJECTIVE_SETS[officer.rank];
  if (!base) return []; // commander (or unknown rank): nothing to promote into
  const signature = SEAT_SIGNATURE_OBJECTIVE[officer.seat];
  if (!signature) return base;
  return base.map((o) =>
    o.kind === signature ? { ...o, target: Math.round(o.target * SEAT_SIGNATURE_TARGET_FACTOR) } : o,
  );
}

// An officer's CURRENT value for one objective kind. `missionsCompleted` is the ONE LIVE kind: it reads
// the officer's real, folded counter (crewOverlay.foldOfficerMissionCompletions folds it from the
// mission cycle counts). Every OTHER kind is DORMANT-STUBBED: it reads the optional additive per-officer
// `promotionCounters` map, defaulting to 0. Incrementing those counters (shipsDestroyed / crewHours /
// personnelAchievement) is a LATER WIRING PHASE, exactly as the old mission gate was dormant until the
// mission-completion fold landed; we never fake an increment here. Pure.
export function officerPromotionCounter(officer: SeniorStaffOfficer, kind: PromotionObjectiveKind): number {
  if (kind === "missionsCompleted") return officer.missionsCompleted; // LIVE (folded)
  return officer.promotionCounters?.[kind] ?? 0; // DORMANT until a later wiring phase increments it
}

// One checklist row's live progress: the objective, the officer's `current` value, and whether it is `met`.
export interface PromotionObjectiveProgress {
  objective: PromotionObjective;
  current: number;
  met: boolean;
}

// The officer's current-rank promotion checklist with live progress per row. Empty at commander (top
// rank: nothing to promote into). Pure.
export function officerPromotionObjectives(officer: SeniorStaffOfficer): PromotionObjectiveProgress[] {
  return officerPromotionObjectiveSet(officer).map((objective) => {
    const current = officerPromotionCounter(officer, objective.kind);
    return { objective, current, met: current >= objective.target };
  });
}

// Whether an officer currently meets EVERY objective in its current-rank set (the full checklist). False
// at the top rank (empty set: no promotion) and whenever ANY objective is unmet. Pure.
export function canPromoteOfficer(officer: SeniorStaffOfficer): boolean {
  const rows = officerPromotionObjectives(officer);
  if (rows.length === 0) return false; // commander (or unknown rank): nothing to promote into
  return rows.every((r) => r.met);
}

// Recompute a bonus's magnitude at a new rank: base (catalog, Ensign-tier) * the rank factor. Falls
// back to scaling the current magnitude by the factor RATIO if the id is somehow not in the catalog
// (defensive; today the generator only rolls catalog bonuses). Pure.
function strengthenBonus(bonus: OfficerBonus, fromRank: OfficerRank, toRank: OfficerRank): OfficerBonus {
  const def = getSeniorStaffBonusById(bonus.id);
  if (def) {
    return { id: bonus.id, magnitude: def.magnitude * officerRankMagnitudeFactor(toRank) };
  }
  const ratio = officerRankMagnitudeFactor(toRank) / officerRankMagnitudeFactor(fromRank);
  return { id: bonus.id, magnitude: bonus.magnitude * ratio };
}

// Promote an officer one rank up, strengthening both bonuses a step. Returns a NEW officer; the
// input is never mutated. A no-op FRESH COPY when the objective checklist is not met (or already at the
// top), so callers can always treat the result as the officer's current state. Pure.
export function promoteOfficer(officer: SeniorStaffOfficer): SeniorStaffOfficer {
  if (!canPromoteOfficer(officer)) {
    return { ...officer, bonuses: [{ ...officer.bonuses[0] }, { ...officer.bonuses[1] }] };
  }
  const next = nextOfficerRank(officer.rank);
  // canPromote already guaranteed a gate exists, so `next` is non-null here; guard for the types.
  if (next === null) {
    return { ...officer, bonuses: [{ ...officer.bonuses[0] }, { ...officer.bonuses[1] }] };
  }
  return {
    ...officer,
    rank: next,
    bonuses: [
      strengthenBonus(officer.bonuses[0], officer.rank, next),
      strengthenBonus(officer.bonuses[1], officer.rank, next),
    ],
  };
}

// The strong-magnitude racial an officer inherits from its race (CREW_RACES[race].racialBonus with
// the seniorStaff, not the per-head complement, magnitude). Derived from `race`, not stored, so the
// persisted officer shape stays lean. The later overlay phase reads this alongside the two bonuses.
// Pure.
export function officerRacialBonus(officer: SeniorStaffOfficer): { statKey: string; magnitude: number } {
  const raceDef = CREW_RACES[officer.race];
  const rb = raceDef.racialBonus;
  return { statKey: rb.statKey, magnitude: rb.seniorStaff };
}

// ============================================================================
// Deterministic candidate roster
// ============================================================================

// The roster refresh window, in gameTimeSeconds. Models "roughly once per real hour" as a game-time
// window so the roster is a pure function of the window index (no Date.now(), no offline catch-up
// loop). FIRST-PASS ~3600s; TUNABLE.
export const OFFICER_ROSTER_WINDOW_SECONDS = 3600;

// The current roster window index: floor(gameTimeSeconds / OFFICER_ROSTER_WINDOW_SECONDS). The
// roster is regenerated whenever this steps. Pure.
export function officerRosterWindowIndex(state: GameState): number {
  return Math.floor(state.gameTimeSeconds / OFFICER_ROSTER_WINDOW_SECONDS);
}

// Mix a per-save seed + window index + roster slot index into one uint32 PRNG seed. Distinct slots
// in one window, and the same slot across windows, decorrelate. Same three inputs => same seed, so
// the whole roster is deterministic. (The constants are common integer-hash mixing constants; only
// their fixedness matters.)
function candidateSeed(baseSeed: number, windowIndex: number, slot: number): number {
  let h = (baseSeed >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ ((windowIndex + 1) >>> 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ ((slot + 1) >>> 0), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

// A stable id for a candidate at (windowIndex, slot). Distinct from a HIRED officer's id (which is
// allocated from nextOfficerId as "officer-N"), so the two id spaces never collide. hireOfficer
// re-ids a candidate to a real officer id on hire.
function candidateId(windowIndex: number, slot: number): string {
  return `officer-candidate-${windowIndex}-${slot}`;
}

// Roll ONE fully-formed candidate officer for (windowIndex, slot): a rolled seat-type, an inclusive
// identity (name/gender via generateCrewIdentity), a race (its strong racial is inherited via
// `race`), cadet rank, and TWO distinct seat-appropriate bonuses (the seat's own pool + the "any"
// sweeping bonuses) scaled to the cadet tier. No rarity (rarity is complement-only). Deterministic
// in (baseSeed, windowIndex, slot). Pure.
function rollCandidate(baseSeed: number, windowIndex: number, slot: number): SeniorStaffOfficer {
  const seed = candidateSeed(baseSeed, windowIndex, slot);
  const rng = makeRng(seed);

  const seat = SENIOR_STAFF_SEATS[rng.nextInt(SENIOR_STAFF_SEATS.length)];
  const race: CrewRace = CREW_RACE_IDS[rng.nextInt(CREW_RACE_IDS.length)];

  // Two DISTINCT bonuses from the seat's rollable pool (>= 4 entries: 2 seat-specific + 2 "any").
  const pool = seniorStaffBonusesForSeat(seat);
  const i1 = rng.nextInt(pool.length);
  let i2 = rng.nextInt(pool.length - 1);
  if (i2 >= i1) i2 += 1; // shift past i1 so the second pick is always different
  const cadetFactor = officerRankMagnitudeFactor("cadet");
  const bonuses: [OfficerBonus, OfficerBonus] = [
    { id: pool[i1].id, magnitude: pool[i1].magnitude * cadetFactor },
    { id: pool[i2].id, magnitude: pool[i2].magnitude * cadetFactor },
  ];

  // Identity draws from a SEPARATE rng instance inside generateCrewIdentity, so it never perturbs
  // the seat/race/bonus rolls above. Seed it with the same per-candidate seed for reproducibility.
  const identity = generateCrewIdentity(race, seed, slot);

  return {
    id: candidateId(windowIndex, slot),
    seat,
    name: identity.name,
    race,
    gender: identity.gender,
    rank: "cadet",
    bonuses,
    missionsCompleted: 0,
    assignedShipId: null,
  };
}

// The current candidate roster: `seniorStaffRosterSize` fully-rolled candidates, deterministic from
// the current window index + the per-save seed. Regenerates identically whenever the window steps
// (live and offline agree). Ephemeral (never persisted); hiring copies a candidate into
// GameState.officers. Pure; returns a fresh array of fresh officer objects.
export function seniorStaffCandidates(state: GameState): SeniorStaffOfficer[] {
  const windowIndex = officerRosterWindowIndex(state);
  const size = Math.max(0, state.seniorStaffRosterSize ?? SENIOR_STAFF_ROSTER_BASE);
  const baseSeed = state.seniorStaffSeed >>> 0;
  const out: SeniorStaffOfficer[] = [];
  for (let slot = 0; slot < size; slot += 1) {
    out.push(rollCandidate(baseSeed, windowIndex, slot));
  }
  return out;
}

// ============================================================================
// Actions (each returns a NEW GameState; inputs are never mutated)
// ============================================================================

// Hire a candidate from the CURRENT roster into GameState.officers. The candidate is re-ided to a
// real officer id ("officer-N" from nextOfficerId, mirroring nextShipId), starts UNASSIGNED
// (assignedShipId null), and keeps its rolled seat/identity/rank/bonuses. Refuses (returns the
// state unchanged) if no candidate with `candidateId` is in the current roster. Pure.
export function hireOfficer(state: GameState, candidateIdToHire: string): GameState {
  const candidate = seniorStaffCandidates(state).find((c) => c.id === candidateIdToHire);
  if (!candidate) return state;
  const hired: SeniorStaffOfficer = {
    ...candidate,
    id: `officer-${state.nextOfficerId}`,
    assignedShipId: null,
    bonuses: [{ ...candidate.bonuses[0] }, { ...candidate.bonuses[1] }],
  };
  return {
    ...state,
    officers: [...state.officers, hired],
    nextOfficerId: state.nextOfficerId + 1,
  };
}

// Dismiss a hired officer by id. Returns a NEW state with a fresh officers array (unchanged, apart
// from the identity of the array, when no officer matches). Pure.
export function fireOfficer(state: GameState, officerId: string): GameState {
  return { ...state, officers: state.officers.filter((o) => o.id !== officerId) };
}

// Assign an officer to a ship's matching seat. Validates (and REFUSES, returning the state
// unchanged, otherwise):
//   - the officer exists,
//   - the ship exists,
//   - the ship's matching seat (the officer's own seat TYPE) is not already occupied by a DIFFERENT
//     officer (you cannot stack two of the same seat type on one hull).
// An officer's seat type is intrinsic, so the assignment always targets its matching seat. Re-
// assigning the same officer to the same ship is an allowed no-op-style success (the occupied check
// excludes the officer itself). Pure.
export function assignOfficerToShip(state: GameState, officerId: string, shipId: string): GameState {
  const officer = state.officers.find((o) => o.id === officerId);
  if (!officer) return state;
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return state;
  const seatOccupied = state.officers.some(
    (o) => o.id !== officerId && o.assignedShipId === shipId && o.seat === officer.seat,
  );
  if (seatOccupied) return state;
  return {
    ...state,
    officers: state.officers.map((o) => (o.id === officerId ? { ...o, assignedShipId: shipId } : o)),
  };
}

// Unassign an officer from whatever ship it sits on (assignedShipId -> null). Returns a NEW state;
// unchanged (apart from a fresh officers array) when no officer matches. Pure.
export function unassignOfficer(state: GameState, officerId: string): GameState {
  return {
    ...state,
    officers: state.officers.map((o) => (o.id === officerId ? { ...o, assignedShipId: null } : o)),
  };
}

// Flip an officer's optional `favorite` curation flag (an absent value reads as false, so the first
// toggle sets it true). SAME-REF NO-OP when the id is unknown, so a caller can skip the save/log on
// state === next. Pure UI/curation flag: nothing mechanical reads it (it drives sorting/pinning
// affordances + the roster builder). Returns a NEW state; the input is never mutated.
export function toggleOfficerFavorite(state: GameState, officerId: string): GameState {
  if (!state.officers.some((o) => o.id === officerId)) return state; // unknown: same-ref no-op
  return {
    ...state,
    officers: state.officers.map((o) => (o.id === officerId ? { ...o, favorite: !o.favorite } : o)),
  };
}

// The officer sitting a given seat on a given ship, or undefined. Because seats are typed and one
// per hull, at most one officer matches. Pure read.
export function officerInSeat(
  state: GameState,
  shipId: string,
  seat: SeniorStaffSeat,
): SeniorStaffOfficer | undefined {
  return state.officers.find((o) => o.assignedShipId === shipId && o.seat === seat);
}
