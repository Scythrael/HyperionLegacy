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
  OfficerStats,
  CaptainState,
} from "./model";
import { CAPTAIN_RACIAL_SCALE, SENIOR_STAFF_ROSTER_BASE } from "./model";
import { seniorStaffBonusesForSeat, getSeniorStaffBonusById, bonusRollWeight } from "./seniorStaffBonuses";
import type { SeniorStaffBonusDef } from "./seniorStaffBonuses";
import { CREW_RACES, CREW_RACE_IDS } from "./crewRaces";
import { generateCrewIdentity } from "./crew";
// CP-6: the one crew lock. crewLock.ts is a leaf (equipment.ts + model types), so no import cycle.
import { shipCrewLocked } from "./crewLock";
import { makeRng, weightedPick, type Rng } from "./combat/rng";
// WR-5c: the board size (the stored size x the best Recruiter captain, rounded up; pure, imports only model.ts).
import { candidateBoardSize } from "./captainExplorerEffects";

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
// keeps its `personnelAchievement` requirement. Every row is a live counter since WR-4 (see
// officerPromotionCounter below for what feeds each); the targets stay first-pass. "commander" is absent
// (top rank, no set).
export const PROMOTION_OBJECTIVE_SETS: Partial<Record<OfficerRank, readonly PromotionObjective[]>> = {
  cadet: [
    { kind: "missionsCompleted", target: 10, label: "Complete 10 missions" },
    { kind: "crewHours", target: 50, label: "Command 50 hours on runs" },
  ],
  ensign: [
    { kind: "missionsCompleted", target: 30, label: "Complete 30 missions" },
    { kind: "shipsDestroyed", target: 5, label: "Destroy 5 hostile ships" },
    { kind: "crewHours", target: 200, label: "Command 200 hours on runs" },
  ],
  lieutenant: [
    { kind: "missionsCompleted", target: 75, label: "Complete 75 missions" },
    { kind: "shipsDestroyed", target: 20, label: "Destroy 20 hostile ships" },
    { kind: "crewHours", target: 600, label: "Command 600 hours on runs" },
  ],
  lieutenantCommander: [
    { kind: "missionsCompleted", target: 150, label: "Complete 150 missions" },
    { kind: "shipsDestroyed", target: 50, label: "Destroy 50 hostile ships" },
    { kind: "personnelAchievement", target: 1, label: "The ship's squads complete 1 objective" },
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

// An officer's CURRENT value for one objective kind. `missionsCompleted` reads the officer's own folded
// counter (crewOverlay.foldOfficerMissionCompletions, from the mission cycles and patrol routes). The OTHER
// kinds read the optional per-officer `promotionCounters` map (absent = 0), fed since WR-4 (B4; user OC-E10
// "Count the objectives", counters start at 0 with no backfill) by crewOverlay.foldOfficerPromotionCounters:
//   crewHours            : the hours the officer's ship spends out on any run (missions, patrols, expeditions),
//                          accrued live by economyTick;
//   shipsDestroyed       : the enemy ships its patrols destroy (economyTick) and the ship battles its expeditions
//                          win (at the claim);
//   personnelAchievement : the objectives the ship's squads complete on an expedition (at the claim). Pure.
export function officerPromotionCounter(officer: SeniorStaffOfficer, kind: PromotionObjectiveKind): number {
  if (kind === "missionsCompleted") return officer.missionsCompleted;
  return officer.promotionCounters?.[kind] ?? 0;
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

// Promote an officer one rank up, strengthening both bonuses a step and adding promotion points to
// its two highest stats (E-CREW Task 19). Returns a NEW officer; the
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
    // E-CREW Task 19: promotion points (+2 on the two highest stats). An officer WITHOUT stats keeps
    // none: readers already treat that as neutral, and the load migration fills it, so materializing a
    // "promoted neutral" line here would only stop the v65 -> v66 re-roll from recognizing the stub.
    ...(officer.stats ? { stats: applyPromotionStatPoints(officerStats(officer)) } : {}),
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

// WR-6 (0.14.0, OC-A43, user 2026-10-19 "Same as an officer"): a captain carries its race's racial on the ship it
// commands, at the officer magnitude x CAPTAIN_RACIAL_SCALE. A captain gains a race when its Executive officer
// succeeds it (captainRetirement.ts); null without one, so a captain with no race changes nothing. Pure.
export function captainRacialBonus(captain: Pick<CaptainState, "race"> | undefined | null): { statKey: string; magnitude: number } | null {
  if (!captain?.race) return null;
  const rb = CREW_RACES[captain.race]?.racialBonus;
  if (!rb) return null;
  const magnitude = rb.seniorStaff * CAPTAIN_RACIAL_SCALE;
  return magnitude === 0 ? null : { statKey: rb.statKey, magnitude };
}

// ============================================================================
// Officer stats (E-CREW D13, design section 7)
// ============================================================================

// The NEUTRAL stat line: what every officer carries until the real roll lands. Shared constant, so
// callers must copy it (rollOfficerStats does) rather than hand it out by reference.
export const NEUTRAL_OFFICER_STATS: OfficerStats = { strength: 10, integrity: 10, cunning: 10, constitution: 10 };

// Mix a per-save seed + an officer id into one uint32 PRNG seed for that officer's stat roll. Keying on
// the officer's own id (not its array position) means a roster reorder or a fire can never reshuffle
// another officer's stats. Same inputs => same seed. A small FNV-style string mix over the
// candidateSeed-style keyed base, with its own salt so it stays decorrelated from the roster seeds. Pure.
// Exported (Ground Ops GO-5) only so salts.test.ts can check it against every other engine salt.
export const OFFICER_STAT_SEED_SALT = 0x3c6ef372;
export function officerStatSeed(baseSeed: number, officerId: string): number {
  let h = Math.imul(((baseSeed >>> 0) ^ OFFICER_STAT_SEED_SALT) >>> 0, 0x85ebca6b) >>> 0;
  for (let i = 0; i < officerId.length; i++) {
    h = Math.imul(h ^ officerId.charCodeAt(i), 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

// The four stat keys in their FIXED order. The order is load-bearing twice: it is the draw order of a
// stat roll (strength first), and it is the tie-break when a promotion picks the two highest stats.
export const OFFICER_STAT_KEYS: readonly (keyof OfficerStats)[] = ["strength", "integrity", "cunning", "constitution"];

// A fresh stat rolls 1..OFFICER_STAT_ROLL_MAX (design section 7, mockup 7b). FIRST-PASS + TUNABLE.
export const OFFICER_STAT_ROLL_MAX = 20;

// Player-facing naming for the four stats (US English): the display label, a short abbreviation for
// compact rows, the one-word facet (mockup 7b subtitle), and what it does for the department the officer
// heads (design section 7). Shared by the Senior Staff panel tooltips and the coming Help topic so the
// wording lives in one place. E-CREW Task 21: every facet is LIVE (officerStats.ts), so each effect line
// states the final mechanic (1% per point above 10; see officerStats.ts for the per-department detail the
// panel appends).
export const OFFICER_STAT_INFO: Readonly<
  Record<keyof OfficerStats, { label: string; abbr: string; facet: string; effect: string }>
> = {
  strength: {
    label: "Strength",
    abbr: "STR",
    facet: "How hard the department works",
    effect: "Each point above 10 makes every crew buff in the department 1% stronger.",
  },
  integrity: {
    label: "Integrity",
    // "ITG", not "INT": INT reads as Intelligence (display only).
    abbr: "ITG",
    facet: "Bravery",
    effect: "Steady under pressure: each point above 10 makes the department about 1% stronger when its trigger hits.",
  },
  cunning: {
    label: "Cunning",
    abbr: "CUN",
    facet: "Finds the edge",
    effect: "Each point above 10 adds a 1% chance per mission that the department over-delivers.",
  },
  constitution: {
    label: "Constitution",
    abbr: "CON",
    facet: "Endurance",
    effect:
      "Each point above 10 adds about 1% to the department's long-haul effect; an effect that ramps grows with each hour out, each hour adding a little less after the first 5.",
  },
};

// Each promotion adds OFFICER_PROMOTION_STAT_POINTS to the officer's OFFICER_PROMOTION_STATS_RAISED
// highest stats (plan Task 19, first-pass), so the Cadet -> Commander climb grows the stats as well as
// the two bonuses. Four promotions take a 20 to 28 at most. FIRST-PASS + TUNABLE.
export const OFFICER_PROMOTION_STAT_POINTS = 2;
export const OFFICER_PROMOTION_STATS_RAISED = 2;

// An officer's stats as a COMPLETE line: starts from the NEUTRAL line and takes only the keys the
// officer carries as finite numbers, so an absent, partial or corrupt stats object (an old fixture, a save
// between the v65 stub and the v66 re-roll, a hand-edited save) can never surface `undefined` or NaN. Every
// reader goes through here so "no stat" always means "neutral", never "zero". Returns a fresh copy. Pure.
export function officerStats(officer: SeniorStaffOfficer): OfficerStats {
  const out: OfficerStats = { ...NEUTRAL_OFFICER_STATS };
  const raw: unknown = officer.stats;
  if (raw && typeof raw === "object") {
    for (const k of OFFICER_STAT_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
  }
  return out;
}

// True only when `stats` is an object whose four keys are ALL finite numbers. The v65 -> v66 migration
// treats anything else as a stub and re-rolls it. Pure.
export function isCompleteOfficerStats(stats: unknown): stats is OfficerStats {
  if (!stats || typeof stats !== "object") return false;
  return OFFICER_STAT_KEYS.every((k) => {
    const v = (stats as Record<string, unknown>)[k];
    return typeof v === "number" && Number.isFinite(v);
  });
}

// True when a stat line is exactly the neutral 10/10/10/10 (the Task 2 stub's output). The v65 -> v66
// migration re-rolls such a line; a genuine all-10 roll is vanishingly rare and harmless to re-roll
// because the re-roll is deterministic. Pure.
export function isNeutralOfficerStats(stats: OfficerStats): boolean {
  return OFFICER_STAT_KEYS.every((k) => stats[k] === NEUTRAL_OFFICER_STATS[k]);
}

// Draw one fresh stat line from `rng`: four `1 + nextInt(OFFICER_STAT_ROLL_MAX)` draws in
// OFFICER_STAT_KEYS order. Exactly FOUR draws, always, so a caller that appends this to an existing
// stream knows how far it advances.
function drawOfficerStatLine(rng: { nextInt(maxExclusive: number): number }): OfficerStats {
  const strength = 1 + rng.nextInt(OFFICER_STAT_ROLL_MAX);
  const integrity = 1 + rng.nextInt(OFFICER_STAT_ROLL_MAX);
  const cunning = 1 + rng.nextInt(OFFICER_STAT_ROLL_MAX);
  const constitution = 1 + rng.nextInt(OFFICER_STAT_ROLL_MAX);
  return { strength, integrity, cunning, constitution };
}

// One promotion's stat growth: OFFICER_PROMOTION_STAT_POINTS onto the OFFICER_PROMOTION_STATS_RAISED
// highest stats, ties broken in OFFICER_STAT_KEYS order (a stable sort keeps the key order among equal
// values). Returns a NEW stat line; the input is never mutated. Pure.
export function applyPromotionStatPoints(stats: OfficerStats): OfficerStats {
  const ranked = [...OFFICER_STAT_KEYS].sort((a, b) => stats[b] - stats[a]);
  const next: OfficerStats = { ...stats };
  for (const k of ranked.slice(0, OFFICER_PROMOTION_STATS_RAISED)) next[k] += OFFICER_PROMOTION_STAT_POINTS;
  return next;
}

// Roll an officer's four stats from its stat seed and rank (E-CREW Task 19; it replaced the Task 2
// neutral stub behind the same signature). A cadet-level line (four 1..20 draws from makeRng(seed)),
// then one applyPromotionStatPoints per rank step above cadet, so an officer that predates stats gets
// the line a cadet hired with this roll and promoted to its rank would carry. Used by the save
// migrations (keyed on officerStatSeed(seniorStaffSeed, officer id)); a NEWLY hired officer instead
// keeps the stats its candidate rolled (rollCandidate). An unknown rank reads as cadet. Pure.
export function rollOfficerStats(seed: number, rank: OfficerRank): OfficerStats {
  let stats = drawOfficerStatLine(makeRng(seed >>> 0));
  const steps = Math.max(0, OFFICER_RANK_ORDER.indexOf(rank));
  for (let i = 0; i < steps; i += 1) stats = applyPromotionStatPoints(stats);
  return stats;
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
// sweeping bonuses, weighted by roll tier) scaled to the cadet tier, plus a rolled 1..20 stat line.
// No officer rarity tier (rarity is complement-only; the roll tiers are odds only). Deterministic
// in (baseSeed, windowIndex, slot). Pure.
function rollCandidate(baseSeed: number, windowIndex: number, slot: number): SeniorStaffOfficer {
  const seed = candidateSeed(baseSeed, windowIndex, slot);
  const rng = makeRng(seed);

  const seat = SENIOR_STAFF_SEATS[rng.nextInt(SENIOR_STAFF_SEATS.length)];
  const race: CrewRace = CREW_RACE_IDS[rng.nextInt(CREW_RACE_IDS.length)];

  // Two DISTINCT bonuses from the seat's rollable pool (>= 4 entries: 2 seat-specific + 2 "any").
  // E-CREW Task 19 (S4-C03): each pick is WEIGHTED by the bonus's roll tier (common 6 .. very rare 1),
  // replacing the old uniform pick. Still exactly ONE draw per pick, so the draw count (and the stat
  // draws appended below) is unchanged. This changes which bonuses FUTURE board candidates show (the
  // board is ephemeral), never a hired officer's stored bonuses.
  const pool = seniorStaffBonusesForSeat(seat);
  const i1 = pickWeightedBonusIndex(pool, rng, -1);
  const i2 = pickWeightedBonusIndex(pool, rng, i1); // excludes i1, so the second pick always differs
  const cadetFactor = officerRankMagnitudeFactor("cadet");
  const bonuses: [OfficerBonus, OfficerBonus] = [
    { id: pool[i1].id, magnitude: pool[i1].magnitude * cadetFactor },
    { id: pool[i2].id, magnitude: pool[i2].magnitude * cadetFactor },
  ];

  // E-CREW Task 19: the four stat draws come AFTER every existing draw (seat, race, both bonus picks),
  // so appending them could not move any earlier roll. Never insert a draw above this line.
  const stats = drawOfficerStatLine(rng);

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
    stats,
  };
}

// One WEIGHTED pick from a bonus pool (E-CREW Task 19), through the shared single-draw `weightedPick`
// (combat/rng.ts): the pool's roll weights, with the excluded index (pass -1 for none) weighted 0 so it can
// never be picked. A zero weight leaves the total and the walk exactly as if the entry were skipped, so this
// is byte-identical to the local walk it replaced (the pinned seed-12345 picks prove it). Exactly one draw.
function pickWeightedBonusIndex(
  pool: readonly SeniorStaffBonusDef[],
  rng: Rng,
  excludeIndex: number,
): number {
  const indices = pool.map((_, i) => i);
  const weights = pool.map((def, i) => (i === excludeIndex ? 0 : bonusRollWeight(def)));
  return weightedPick(rng, indices, weights);
}

// The current candidate roster: `seniorStaffRosterSize` fully-rolled candidates, deterministic from
// the current window index + the per-save seed. Regenerates identically whenever the window steps
// (live and offline agree). Ephemeral (never persisted); hiring copies a candidate into
// GameState.officers. Pure; returns a fresh array of fresh officer objects.
export function seniorStaffCandidates(state: GameState): SeniorStaffOfficer[] {
  const windowIndex = officerRosterWindowIndex(state);
  // WR-5c: the stored size x the best Recruiter captain's factor, rounded up (captainExplorerEffects.ts candidateBoardSize).
  const size = candidateBoardSize(state);
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
// (assignedShipId null), and keeps its rolled seat/identity/rank/bonuses/stats. Refuses (returns the
// state unchanged) if no candidate with `candidateId` is in the current roster. Pure.
export function hireOfficer(state: GameState, candidateIdToHire: string): GameState {
  const candidate = seniorStaffCandidates(state).find((c) => c.id === candidateIdToHire);
  if (!candidate) return state;
  const hired: SeniorStaffOfficer = {
    ...candidate,
    id: `officer-${state.nextOfficerId}`,
    assignedShipId: null,
    bonuses: [{ ...candidate.bonuses[0] }, { ...candidate.bonuses[1] }],
    // E-CREW Task 19: the officer keeps the stats its candidate rolled (a copy, never shared), so no
    // hired officer is ever missing them.
    stats: officerStats(candidate),
  };
  return {
    ...state,
    officers: [...state.officers, hired],
    nextOfficerId: state.nextOfficerId + 1,
  };
}

// CP-6: every officer allocation change (hire-to-seat, assign, unassign, dismiss) refuses while a ship it
// touches is crew-locked (crewLock.ts shipCrewLocked: a captain mission, or an expedition until it is
// claimed). The gate pattern of awayTeam.ts: each can* answers "would this go through, and if not, why?" so
// the Senior Staff pane shows a disabled control with its reason, and each action calls its gate and returns
// the SAME state on refusal. Promotion and favoriting are not gated (they change no allocation).
//   noCandidate: the candidate is not on the current board
//   noOfficer:   no hired officer with that id
//   noShip:      the target ship does not exist
//   seatTaken:   the ship's seat of the officer's type is held by a DIFFERENT officer
//   onMission:   a ship involved is crew-locked (crewLock.ts crewLockText gives the accurate words)
export type OfficerBlockReason = "noCandidate" | "noOfficer" | "noShip" | "seatTaken" | "onMission";
export type OfficerGate = { ok: true } | { ok: false; reason: OfficerBlockReason };

// The player-facing line for a refusal (US English). EXHAUSTIVE with no default on purpose. Pure.
export function officerBlockText(reason: OfficerBlockReason): string {
  switch (reason) {
    case "noCandidate":
      return "No longer on the board";
    case "noOfficer":
      return "No longer in the fleet";
    case "noShip":
      return "That ship is no longer in the fleet";
    case "seatTaken":
      return "That seat is already filled";
    case "onMission":
      return "Ship is out on a mission";
  }
}

// The seat half of a gate: the ship exists, is not crew-locked, and its seat of `seat` is free of any
// officer other than `officerId` (null for a hire, so any occupant blocks). Pure.
function seatGate(state: GameState, shipId: string, seat: SeniorStaffSeat, officerId: string | null): OfficerGate {
  if (!state.ships.some((s) => s.id === shipId)) return { ok: false, reason: "noShip" };
  if (shipCrewLocked(state, shipId)) return { ok: false, reason: "onMission" };
  const taken = state.officers.some((o) => o.id !== officerId && o.assignedShipId === shipId && o.seat === seat);
  return taken ? { ok: false, reason: "seatTaken" } : { ok: true };
}

// The lock on the ship an officer sits on now (an unassigned officer is never locked). Pure.
function officerShipLocked(state: GameState, officer: SeniorStaffOfficer): boolean {
  return officer.assignedShipId !== null && shipCrewLocked(state, officer.assignedShipId);
}

// Can this board candidate be hired straight into `shipId`'s matching seat? noCandidate, noShip,
// onMission, seatTaken. Pure.
export function canHireOfficerToSeat(state: GameState, candidateIdToHire: string, shipId: string): OfficerGate {
  const candidate = seniorStaffCandidates(state).find((c) => c.id === candidateIdToHire);
  if (!candidate) return { ok: false, reason: "noCandidate" };
  return seatGate(state, shipId, candidate.seat, null);
}

// Hire a candidate AND seat it on `shipId` in one atomic step (the Senior Staff pane's Hire). Refuses (the
// SAME state) whenever canHireOfficerToSeat does, so a refused seat never leaves a stray unassigned hire
// behind. The new officer is hireOfficer's appended entry, re-ided "officer-N". Pure.
export function hireOfficerToSeat(state: GameState, candidateIdToHire: string, shipId: string): GameState {
  if (!canHireOfficerToSeat(state, candidateIdToHire, shipId).ok) return state;
  const hired = hireOfficer(state, candidateIdToHire);
  const officer = hired.officers[hired.officers.length - 1];
  return {
    ...hired,
    officers: hired.officers.map((o) => (o.id === officer.id ? { ...o, assignedShipId: shipId } : o)),
  };
}

// Can this officer be dismissed? noOfficer, onMission (its ship is crew-locked). Pure.
export function canFireOfficer(state: GameState, officerId: string): OfficerGate {
  const officer = state.officers.find((o) => o.id === officerId);
  if (!officer) return { ok: false, reason: "noOfficer" };
  if (officerShipLocked(state, officer)) return { ok: false, reason: "onMission" };
  return { ok: true };
}

// Dismiss a hired officer by id. Refuses (the SAME state) whenever canFireOfficer does: an unknown id, or
// an officer whose ship is out. Captain retirement consumes its XO through here; retirement itself refuses
// while that ship is locked (captainRetirement.ts), so the two never disagree. Pure.
export function fireOfficer(state: GameState, officerId: string): GameState {
  if (!canFireOfficer(state, officerId).ok) return state;
  return { ...state, officers: state.officers.filter((o) => o.id !== officerId) };
}

// Can this officer take `shipId`'s matching seat? noOfficer, then onMission for the ship it LEAVES, then
// noShip, onMission (the ship it joins) and seatTaken. Re-assigning an officer to the seat it already holds
// stays an allowed no-op-style success on a free ship (the seat check excludes the officer itself). Pure.
export function canAssignOfficer(state: GameState, officerId: string, shipId: string): OfficerGate {
  const officer = state.officers.find((o) => o.id === officerId);
  if (!officer) return { ok: false, reason: "noOfficer" };
  if (officerShipLocked(state, officer)) return { ok: false, reason: "onMission" };
  return seatGate(state, shipId, officer.seat, officerId);
}

// Assign an officer to a ship's matching seat (an officer's seat type is intrinsic, so the assignment
// always targets its matching seat; you cannot stack two of one seat type on a hull). Refuses (the SAME
// state) whenever canAssignOfficer does. Pure.
export function assignOfficerToShip(state: GameState, officerId: string, shipId: string): GameState {
  if (!canAssignOfficer(state, officerId, shipId).ok) return state;
  return {
    ...state,
    officers: state.officers.map((o) => (o.id === officerId ? { ...o, assignedShipId: shipId } : o)),
  };
}

// Can this officer leave its seat? noOfficer, onMission (its ship is crew-locked). An unassigned officer
// passes (unassigning it changes nothing but is harmless). Pure.
export function canUnassignOfficer(state: GameState, officerId: string): OfficerGate {
  return canFireOfficer(state, officerId);
}

// Unassign an officer from whatever ship it sits on (assignedShipId -> null). Refuses (the SAME state)
// whenever canUnassignOfficer does. Pure.
export function unassignOfficer(state: GameState, officerId: string): GameState {
  if (!canUnassignOfficer(state, officerId).ok) return state;
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
