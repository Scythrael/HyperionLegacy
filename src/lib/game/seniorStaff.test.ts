// Crew 0.14.0 (Phase 1): tests for the DORMANT Senior Staff officer engine (seniorStaff.ts).
// Covers: roster determinism (same window+seed => same candidates; window/seed changes), seat-type
// matching enforced on assign, hire/fire/assign/unassign state transitions (pure, no input
// mutation), the 5-rank Cadet -> Commander OBJECTIVE-SET promotion checklist (progress/met, all-
// objectives gating, LIVE-vs-dormant counters, per-seat flavor) + bonus strengthening, and cadet
// start. Nothing here exercises the tick or ship stats (the engine is not wired in yet).

import { describe, it, expect } from "vitest";
import { freshState, SENIOR_STAFF_ROSTER_BASE } from "./model";
import type { GameState, SeniorStaffOfficer, OfficerStats } from "./model";
import {
  SENIOR_STAFF_SEATS,
  OFFICER_RANK_ORDER,
  OFFICER_ROSTER_WINDOW_SECONDS,
  PROMOTION_OBJECTIVE_SETS,
  officerRankLabel,
  officerRankMagnitudeFactor,
  nextOfficerRank,
  officerPromotionObjectiveSet,
  officerPromotionObjectives,
  officerPromotionCounter,
  canPromoteOfficer,
  promoteOfficer,
  officerRacialBonus,
  officerRosterWindowIndex,
  seniorStaffCandidates,
  hireOfficer,
  fireOfficer,
  assignOfficerToShip,
  unassignOfficer,
  toggleOfficerFavorite,
  officerInSeat,
  NEUTRAL_OFFICER_STATS,
  officerStatSeed,
  rollOfficerStats,
  officerStats,
  OFFICER_STAT_KEYS,
  OFFICER_STAT_ROLL_MAX,
  OFFICER_PROMOTION_STAT_POINTS,
  applyPromotionStatPoints,
} from "./seniorStaff";
import { getSeniorStaffBonusById, seniorStaffBonusesForSeat, bonusRollWeight } from "./seniorStaffBonuses";

// --- fixtures ---------------------------------------------------------------

// A base state with a given seed / roster size, plus a set of ships with known ids (copies of the
// starting hull re-ided). Officers default to empty; callers pass their own.
function stateWith(opts: {
  officers?: SeniorStaffOfficer[];
  shipIds?: string[];
  seed?: number;
  rosterSize?: number;
  gameTimeSeconds?: number;
} = {}): GameState {
  const base = freshState();
  const shipIds = opts.shipIds ?? ["ship-1"];
  const ships = shipIds.map((id) => ({ ...base.ships[0], id }));
  return {
    ...base,
    officers: opts.officers ?? [],
    ships,
    seniorStaffSeed: opts.seed ?? base.seniorStaffSeed,
    seniorStaffRosterSize: opts.rosterSize ?? base.seniorStaffRosterSize,
    gameTimeSeconds: opts.gameTimeSeconds ?? 0,
  };
}

function officer(overrides: Partial<SeniorStaffOfficer> = {}): SeniorStaffOfficer {
  return {
    id: "officer-1",
    seat: "pilot",
    name: "Test Officer",
    race: "earthBorn",
    gender: "female",
    rank: "cadet",
    bonuses: [
      { id: "pilot.transitCut", magnitude: 0.08 },
      { id: "pilot.evasion", magnitude: 0.1 },
    ],
    missionsCompleted: 0,
    assignedShipId: null,
    ...overrides,
  };
}

// ============================================================================
// Rank ladder
// ============================================================================

describe("senior staff rank ladder (5 tiers, Cadet -> Commander)", () => {
  it("OFFICER_RANK_ORDER is the 5-tier cadet-start ladder", () => {
    expect(OFFICER_RANK_ORDER).toEqual([
      "cadet",
      "ensign",
      "lieutenant",
      "lieutenantCommander",
      "commander",
    ]);
  });

  it("nextOfficerRank walks up the ladder and returns null at the top", () => {
    expect(nextOfficerRank("cadet")).toBe("ensign");
    expect(nextOfficerRank("ensign")).toBe("lieutenant");
    expect(nextOfficerRank("lieutenant")).toBe("lieutenantCommander");
    expect(nextOfficerRank("lieutenantCommander")).toBe("commander");
    expect(nextOfficerRank("commander")).toBe(null);
  });

  it("officerRankLabel gives US-English display names", () => {
    expect(officerRankLabel("cadet")).toBe("Cadet");
    expect(officerRankLabel("lieutenantCommander")).toBe("Lieutenant Commander");
    expect(officerRankLabel("commander")).toBe("Commander");
  });

  it("the rank magnitude factor rises monotonically with rank (ensign == 1.0 base tier)", () => {
    expect(officerRankMagnitudeFactor("ensign")).toBe(1.0);
    expect(officerRankMagnitudeFactor("cadet")).toBeLessThan(officerRankMagnitudeFactor("ensign"));
    expect(officerRankMagnitudeFactor("lieutenant")).toBeGreaterThan(officerRankMagnitudeFactor("ensign"));
    expect(officerRankMagnitudeFactor("lieutenantCommander")).toBeGreaterThan(officerRankMagnitudeFactor("lieutenant"));
    expect(officerRankMagnitudeFactor("commander")).toBeGreaterThan(officerRankMagnitudeFactor("lieutenantCommander"));
  });
});

// ============================================================================
// Candidate roster determinism
// ============================================================================

describe("seniorStaffCandidates determinism + shape", () => {
  it("is deterministic: the same window + seed yields identical candidates", () => {
    const a = seniorStaffCandidates(stateWith({ seed: 12345, gameTimeSeconds: 100 }));
    const b = seniorStaffCandidates(stateWith({ seed: 12345, gameTimeSeconds: 100 }));
    expect(a).toEqual(b);
  });

  it("is stable across gameTimeSeconds WITHIN one window, and changes when the window steps", () => {
    // Two times inside window 0 give the identical roster.
    const early = seniorStaffCandidates(stateWith({ seed: 7, gameTimeSeconds: 0 }));
    const lateSameWindow = seniorStaffCandidates(
      stateWith({ seed: 7, gameTimeSeconds: OFFICER_ROSTER_WINDOW_SECONDS - 1 }),
    );
    expect(lateSameWindow).toEqual(early);

    // Crossing into window 1 regenerates the roster (candidate ids embed the window index).
    const nextWindow = seniorStaffCandidates(
      stateWith({ seed: 7, gameTimeSeconds: OFFICER_ROSTER_WINDOW_SECONDS }),
    );
    expect(nextWindow.map((c) => c.id)).not.toEqual(early.map((c) => c.id));
    expect(JSON.stringify(nextWindow)).not.toEqual(JSON.stringify(early));
  });

  it("different per-save seeds roll different candidates", () => {
    const a = seniorStaffCandidates(stateWith({ seed: 1, gameTimeSeconds: 0 }));
    const b = seniorStaffCandidates(stateWith({ seed: 2, gameTimeSeconds: 0 }));
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
  });

  it("respects seniorStaffRosterSize (base 10, and an expanded size)", () => {
    expect(seniorStaffCandidates(stateWith({})).length).toBe(SENIOR_STAFF_ROSTER_BASE);
    expect(seniorStaffCandidates(stateWith({ rosterSize: 3 })).length).toBe(3);
    expect(seniorStaffCandidates(stateWith({ rosterSize: 15 })).length).toBe(15);
  });

  it("officerRosterWindowIndex is floor(gameTimeSeconds / window)", () => {
    expect(officerRosterWindowIndex(stateWith({ gameTimeSeconds: 0 }))).toBe(0);
    expect(officerRosterWindowIndex(stateWith({ gameTimeSeconds: OFFICER_ROSTER_WINDOW_SECONDS - 1 }))).toBe(0);
    expect(officerRosterWindowIndex(stateWith({ gameTimeSeconds: OFFICER_ROSTER_WINDOW_SECONDS * 3 + 5 }))).toBe(3);
  });

  it("every candidate is a cadet, unassigned, with two DISTINCT seat-appropriate bonuses", () => {
    const roster = seniorStaffCandidates(stateWith({ rosterSize: 10, gameTimeSeconds: 500 }));
    for (const c of roster) {
      expect(c.rank).toBe("cadet"); // cadet start
      expect(c.missionsCompleted).toBe(0);
      expect(c.assignedShipId).toBe(null);
      expect(SENIOR_STAFF_SEATS).toContain(c.seat);
      // two bonuses, distinct ids
      expect(c.bonuses).toHaveLength(2);
      expect(c.bonuses[0].id).not.toBe(c.bonuses[1].id);
      // both bonuses are rollable for this seat (its own pool + the "any" sweeping bonuses)
      for (const b of c.bonuses) {
        const def = getSeniorStaffBonusById(b.id);
        expect(def).toBeDefined();
        expect(def!.seat === c.seat || def!.seat === "any").toBe(true);
        // magnitude scaled to the cadet tier off the catalog base
        expect(b.magnitude).toBeCloseTo(def!.magnitude * officerRankMagnitudeFactor("cadet"), 10);
      }
      // candidate ids are distinct from a hired officer's "officer-N" id space
      expect(c.id.startsWith("officer-candidate-")).toBe(true);
    }
  });
});

// ============================================================================
// Hire / fire
// ============================================================================

describe("hireOfficer / fireOfficer", () => {
  it("hires a roster candidate into officers with a fresh officer id, unassigned, cadet", () => {
    const state = stateWith({});
    const candidate = seniorStaffCandidates(state)[0];
    const next = hireOfficer(state, candidate.id);

    expect(next.officers).toHaveLength(1);
    const hired = next.officers[0];
    expect(hired.id).toBe("officer-1"); // allocated from nextOfficerId
    expect(next.nextOfficerId).toBe(2);
    expect(hired.assignedShipId).toBe(null);
    expect(hired.rank).toBe("cadet");
    expect(hired.seat).toBe(candidate.seat);
    expect(hired.bonuses).toEqual(candidate.bonuses);

    // purity: original state untouched
    expect(state.officers).toHaveLength(0);
    expect(state.nextOfficerId).toBe(1);
  });

  it("refuses to hire an unknown candidate id (state unchanged)", () => {
    const state = stateWith({});
    const next = hireOfficer(state, "officer-candidate-999-999");
    expect(next).toBe(state);
  });

  it("fires an officer by id, leaving the rest, without mutating the input", () => {
    const state = stateWith({ officers: [officer({ id: "officer-1" }), officer({ id: "officer-2", seat: "science" })] });
    const next = fireOfficer(state, "officer-1");
    expect(next.officers.map((o) => o.id)).toEqual(["officer-2"]);
    expect(state.officers).toHaveLength(2); // input untouched
  });

  it("firing an unknown id keeps every officer (fresh array)", () => {
    const state = stateWith({ officers: [officer({ id: "officer-1" })] });
    const next = fireOfficer(state, "officer-nope");
    expect(next.officers).toHaveLength(1);
    expect(next.officers).not.toBe(state.officers);
  });
});

// ============================================================================
// Assignment (seat-type matching)
// ============================================================================

describe("assignOfficerToShip seat-type matching", () => {
  it("assigns an officer into its matching seat on an existing ship", () => {
    const state = stateWith({ officers: [officer({ id: "officer-1", seat: "pilot" })], shipIds: ["ship-1"] });
    const next = assignOfficerToShip(state, "officer-1", "ship-1");
    expect(next.officers[0].assignedShipId).toBe("ship-1");
    // purity: original officer object unchanged
    expect(state.officers[0].assignedShipId).toBe(null);
  });

  it("refuses to stack a second officer of the SAME seat type on one ship (occupied seat)", () => {
    const state = stateWith({
      officers: [
        officer({ id: "officer-1", seat: "pilot", assignedShipId: "ship-1" }),
        officer({ id: "officer-2", seat: "pilot" }),
      ],
      shipIds: ["ship-1"],
    });
    const next = assignOfficerToShip(state, "officer-2", "ship-1");
    expect(next).toBe(state); // refused, state unchanged
  });

  it("allows a DIFFERENT seat type on the same ship (typed seats, one of each)", () => {
    const state = stateWith({
      officers: [
        officer({ id: "officer-1", seat: "pilot", assignedShipId: "ship-1" }),
        officer({ id: "officer-2", seat: "tactical" }),
      ],
      shipIds: ["ship-1"],
    });
    const next = assignOfficerToShip(state, "officer-2", "ship-1");
    expect(next.officers.find((o) => o.id === "officer-2")!.assignedShipId).toBe("ship-1");
  });

  it("lets the SAME occupant re-assign to the same ship (occupied check excludes self)", () => {
    const state = stateWith({ officers: [officer({ id: "officer-1", seat: "pilot", assignedShipId: "ship-1" })], shipIds: ["ship-1"] });
    const next = assignOfficerToShip(state, "officer-1", "ship-1");
    expect(next.officers[0].assignedShipId).toBe("ship-1");
  });

  it("refuses an unknown officer or an unknown ship (state unchanged)", () => {
    const state = stateWith({ officers: [officer({ id: "officer-1", seat: "pilot" })], shipIds: ["ship-1"] });
    expect(assignOfficerToShip(state, "officer-nope", "ship-1")).toBe(state);
    expect(assignOfficerToShip(state, "officer-1", "ship-nope")).toBe(state);
  });

  it("unassignOfficer clears the ship, and the same seat then reads empty", () => {
    const state = stateWith({ officers: [officer({ id: "officer-1", seat: "pilot", assignedShipId: "ship-1" })], shipIds: ["ship-1"] });
    expect(officerInSeat(state, "ship-1", "pilot")!.id).toBe("officer-1");
    const next = unassignOfficer(state, "officer-1");
    expect(next.officers[0].assignedShipId).toBe(null);
    expect(officerInSeat(next, "ship-1", "pilot")).toBeUndefined();
    // purity
    expect(state.officers[0].assignedShipId).toBe("ship-1");
  });

  it("officerInSeat finds only the matching ship + seat", () => {
    const state = stateWith({
      officers: [
        officer({ id: "officer-1", seat: "pilot", assignedShipId: "ship-1" }),
        officer({ id: "officer-2", seat: "science", assignedShipId: "ship-1" }),
        officer({ id: "officer-3", seat: "pilot", assignedShipId: "ship-2" }),
      ],
      shipIds: ["ship-1", "ship-2"],
    });
    expect(officerInSeat(state, "ship-1", "pilot")!.id).toBe("officer-1");
    expect(officerInSeat(state, "ship-1", "science")!.id).toBe("officer-2");
    expect(officerInSeat(state, "ship-2", "pilot")!.id).toBe("officer-3");
    expect(officerInSeat(state, "ship-1", "tactical")).toBeUndefined();
    expect(officerInSeat(state, "ship-2", "science")).toBeUndefined();
  });
});

// ============================================================================
// Promotion gates + bonus strengthening
// ============================================================================

describe("promotion objective SETS (checklist, 5-rank ladder)", () => {
  it("PROMOTION_OBJECTIVE_SETS exists per promotable rank with Commander having none", () => {
    expect(PROMOTION_OBJECTIVE_SETS.cadet).toBeDefined();
    expect(PROMOTION_OBJECTIVE_SETS.ensign).toBeDefined();
    expect(PROMOTION_OBJECTIVE_SETS.lieutenant).toBeDefined();
    expect(PROMOTION_OBJECTIVE_SETS.lieutenantCommander).toBeDefined();
    expect(PROMOTION_OBJECTIVE_SETS.commander).toBeUndefined(); // top rank, no set

    // each set is a MULTI-row checklist (mockup parity: >= 2 rows)
    for (const rank of ["cadet", "ensign", "lieutenant", "lieutenantCommander"] as const) {
      expect(PROMOTION_OBJECTIVE_SETS[rank]!.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("preserves the old single-gate mission thresholds as the missionsCompleted objective (10/30/75/150)", () => {
    const missionTarget = (rank: "cadet" | "ensign" | "lieutenant" | "lieutenantCommander"): number =>
      PROMOTION_OBJECTIVE_SETS[rank]!.find((o) => o.kind === "missionsCompleted")!.target;
    expect(missionTarget("cadet")).toBe(10);
    expect(missionTarget("ensign")).toBe(30);
    expect(missionTarget("lieutenant")).toBe(75);
    expect(missionTarget("lieutenantCommander")).toBe(150);
  });

  it("keeps the top rung's Personnel achievement requirement", () => {
    expect(PROMOTION_OBJECTIVE_SETS.lieutenantCommander!.some((o) => o.kind === "personnelAchievement")).toBe(true);
  });

  it("officerPromotionObjectiveSet is empty at commander (top rank)", () => {
    expect(officerPromotionObjectiveSet(officer({ rank: "commander" }))).toEqual([]);
  });

  it("a tactical officer's set leans on shipsDestroyed (heavier target than a non-signature seat)", () => {
    const tactical = officerPromotionObjectiveSet(officer({ rank: "ensign", seat: "tactical" }));
    const pilot = officerPromotionObjectiveSet(officer({ rank: "ensign", seat: "pilot" }));
    const tacticalKills = tactical.find((o) => o.kind === "shipsDestroyed")!.target;
    const pilotKills = pilot.find((o) => o.kind === "shipsDestroyed")!.target;
    // non-signature seat keeps the shared base
    expect(pilotKills).toBe(PROMOTION_OBJECTIVE_SETS.ensign!.find((o) => o.kind === "shipsDestroyed")!.target);
    // tactical (signature = shipsDestroyed) leans heavier
    expect(tacticalKills).toBeGreaterThan(pilotKills);
  });
});

describe("promotion progress + counters (LIVE vs dormant-stubbed)", () => {
  it("officerPromotionCounter reads missionsCompleted LIVE and other kinds from promotionCounters (default 0)", () => {
    const o = officer({ missionsCompleted: 12, promotionCounters: { shipsDestroyed: 3 } });
    expect(officerPromotionCounter(o, "missionsCompleted")).toBe(12); // LIVE (folded) counter
    expect(officerPromotionCounter(o, "shipsDestroyed")).toBe(3); // dormant per-officer counter
    expect(officerPromotionCounter(o, "crewHours")).toBe(0); // missing entry -> 0
    expect(officerPromotionCounter(officer({}), "shipsDestroyed")).toBe(0); // no promotionCounters at all -> 0
  });

  it("officerPromotionObjectives reports per-row current/met, the missionsCompleted row reflecting the LIVE counter", () => {
    const o = officer({ rank: "cadet", missionsCompleted: 10, promotionCounters: { crewHours: 20 } });
    const rows = officerPromotionObjectives(o);
    const missions = rows.find((r) => r.objective.kind === "missionsCompleted")!;
    const crewHours = rows.find((r) => r.objective.kind === "crewHours")!;
    expect(missions.current).toBe(10); // the live folded counter is surfaced as-is
    expect(missions.met).toBe(true); // 10 >= 10
    expect(crewHours.current).toBe(20);
    expect(crewHours.met).toBe(false); // 20 < 50
  });
});

describe("canPromoteOfficer (checklist gating) + promoteOfficer", () => {
  it("is true ONLY when EVERY objective in the current-rank set is met", () => {
    // cadet set = missionsCompleted 10 + crewHours 50
    // missions alone (the OLD single gate) is no longer enough:
    expect(canPromoteOfficer(officer({ rank: "cadet", missionsCompleted: 10 }))).toBe(false);
    // crewHours alone, missions short: false
    expect(canPromoteOfficer(officer({ rank: "cadet", missionsCompleted: 9, promotionCounters: { crewHours: 50 } }))).toBe(false);
    // both met: true
    expect(canPromoteOfficer(officer({ rank: "cadet", missionsCompleted: 10, promotionCounters: { crewHours: 50 } }))).toBe(true);
  });

  it("the missionsCompleted objective gates off the LIVE counter", () => {
    // crewHours satisfied via the dormant counter, promotion still hinges on the live mission count
    expect(canPromoteOfficer(officer({ rank: "cadet", missionsCompleted: 9, promotionCounters: { crewHours: 50 } }))).toBe(false);
    expect(canPromoteOfficer(officer({ rank: "cadet", missionsCompleted: 10, promotionCounters: { crewHours: 50 } }))).toBe(true);
  });

  it("the top rung also needs the (dormant-stubbed) Personnel achievement counter", () => {
    // LtCommander set = missionsCompleted 150 + shipsDestroyed 50 + personnelAchievement 1
    // missions + kills but NO achievement counter: false (the achievement system is not wired yet)
    expect(canPromoteOfficer(officer({ rank: "lieutenantCommander", missionsCompleted: 150, promotionCounters: { shipsDestroyed: 50 } }))).toBe(false);
    // all three met: true
    expect(canPromoteOfficer(officer({ rank: "lieutenantCommander", missionsCompleted: 150, promotionCounters: { shipsDestroyed: 50, personnelAchievement: 1 } }))).toBe(true);
    // achievement + kills but mission count short: false
    expect(canPromoteOfficer(officer({ rank: "lieutenantCommander", missionsCompleted: 149, promotionCounters: { shipsDestroyed: 50, personnelAchievement: 1 } }))).toBe(false);
  });

  it("commander cannot be promoted further (empty objective set)", () => {
    expect(
      canPromoteOfficer(
        officer({ rank: "commander", missionsCompleted: 9999, promotionCounters: { shipsDestroyed: 9999, crewHours: 9999, personnelAchievement: 9 } }),
      ),
    ).toBe(false);
  });

  it("promoteOfficer advances one rank and strengthens both bonuses off the catalog base", () => {
    const cadet = officer({
      rank: "cadet",
      missionsCompleted: 10,
      promotionCounters: { crewHours: 50 }, // clear the whole cadet checklist
      bonuses: [
        { id: "pilot.transitCut", magnitude: 0.08 * officerRankMagnitudeFactor("cadet") },
        { id: "pilot.evasion", magnitude: 0.1 * officerRankMagnitudeFactor("cadet") },
      ],
    });
    const ensign = promoteOfficer(cadet);
    expect(ensign.rank).toBe("ensign");
    // base (catalog) * ensign factor (1.0)
    expect(ensign.bonuses[0].magnitude).toBeCloseTo(0.08 * officerRankMagnitudeFactor("ensign"), 10);
    expect(ensign.bonuses[1].magnitude).toBeCloseTo(0.1 * officerRankMagnitudeFactor("ensign"), 10);
    // each bonus got STRONGER than at cadet
    expect(ensign.bonuses[0].magnitude).toBeGreaterThan(cadet.bonuses[0].magnitude);
    // purity: input untouched
    expect(cadet.rank).toBe("cadet");
  });

  it("promoteOfficer is a no-op fresh copy when the checklist is not met", () => {
    const cadet = officer({ rank: "cadet", missionsCompleted: 5 });
    const result = promoteOfficer(cadet);
    expect(result.rank).toBe("cadet");
    expect(result).not.toBe(cadet); // fresh copy, not the same reference
    expect(result.bonuses).toEqual(cadet.bonuses);
  });

  it("promoteOfficer is a no-op at commander (top rank)", () => {
    const cmdr = officer({ rank: "commander", missionsCompleted: 9999, promotionCounters: { shipsDestroyed: 9999, crewHours: 9999, personnelAchievement: 9 } });
    expect(promoteOfficer(cmdr).rank).toBe("commander");
  });

  it("walks the FULL ladder cadet -> commander when every rank's checklist is met, strengthening at each step", () => {
    // counters generous enough to clear every rank's set (missions >= 150, kills/hours huge, achievement earned)
    let o = officer({
      rank: "cadet",
      missionsCompleted: 150,
      promotionCounters: { shipsDestroyed: 999, crewHours: 999, personnelAchievement: 1 },
    });
    const startMag = o.bonuses[0].magnitude;

    o = promoteOfficer(o);
    expect(o.rank).toBe("ensign");
    o = promoteOfficer(o);
    expect(o.rank).toBe("lieutenant");
    o = promoteOfficer(o);
    expect(o.rank).toBe("lieutenantCommander");
    o = promoteOfficer(o);
    expect(o.rank).toBe("commander");

    // at the top: no further promotion
    expect(nextOfficerRank(o.rank)).toBe(null);
    expect(canPromoteOfficer(o)).toBe(false);
    // commander magnitude is well above the starting magnitude
    expect(o.bonuses[0].magnitude).toBeGreaterThan(startMag);
    expect(o.bonuses[0].magnitude).toBeCloseTo(0.08 * officerRankMagnitudeFactor("commander"), 10);
  });

  it("strengthenBonus falls back to a proportional scale for an unknown (non-catalog) bonus id", () => {
    const o = officer({
      rank: "cadet",
      missionsCompleted: 10,
      promotionCounters: { crewHours: 50 },
      bonuses: [
        { id: "not.a.real.bonus", magnitude: 1.0 },
        { id: "pilot.evasion", magnitude: 0.5 },
      ],
    });
    const promoted = promoteOfficer(o);
    // unknown id: scaled by the factor RATIO (ensign / cadet)
    const ratio = officerRankMagnitudeFactor("ensign") / officerRankMagnitudeFactor("cadet");
    expect(promoted.bonuses[0].magnitude).toBeCloseTo(1.0 * ratio, 10);
  });
});

// ============================================================================
// Racial inheritance
// ============================================================================

describe("officerRacialBonus", () => {
  it("inherits the STRONG senior-staff racial magnitude from the officer's race", () => {
    const vaelSci = officer({ race: "vael", seat: "science" });
    const racial = officerRacialBonus(vaelSci);
    expect(racial.statKey).toBe("crew.surveyAptitude"); // vael racial stat key
    expect(racial.magnitude).toBe(0.06); // the strong seniorStaff magnitude (not the tiny complement one)
  });

  it("uses each race's own racial (earth-born vs martian differ)", () => {
    expect(officerRacialBonus(officer({ race: "earthBorn" })).statKey).toBe("crew.crewEffectiveness");
    expect(officerRacialBonus(officer({ race: "martian" })).statKey).toBe("crew.powerEfficiency");
  });
});

// ============================================================================
// Favoriting (Crew 0.14.0 GL): toggleOfficerFavorite
// ============================================================================

describe("toggleOfficerFavorite", () => {
  it("flips an officer's favorite on then off (absent reads as false)", () => {
    const s0 = stateWith({ officers: [officer({ id: "officer-1" })] });
    expect(s0.officers[0].favorite).toBeUndefined();

    const s1 = toggleOfficerFavorite(s0, "officer-1");
    expect(s1).not.toBe(s0); // fresh state
    expect(s1.officers[0].favorite).toBe(true);

    const s2 = toggleOfficerFavorite(s1, "officer-1");
    expect(s2.officers[0].favorite).toBe(false);

    // Pure: the input state/officer is never mutated.
    expect(s0.officers[0].favorite).toBeUndefined();
  });

  it("is a same-ref no-op on an unknown officer id", () => {
    const s0 = stateWith({ officers: [officer({ id: "officer-1" })] });
    expect(toggleOfficerFavorite(s0, "officer-404")).toBe(s0);
  });
});

// ===== E-CREW Task 2: officer stat seed + the (stub) stat roll =====
describe("officerStatSeed / rollOfficerStats (E-CREW data model)", () => {
  it("officerStatSeed is a deterministic uint32 of (baseSeed, officerId)", () => {
    const a = officerStatSeed(0x9e3779b9, "officer-1");
    expect(officerStatSeed(0x9e3779b9, "officer-1")).toBe(a);
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
  });

  it("officerStatSeed differs across officer ids and across base seeds", () => {
    const ids = ["officer-1", "officer-2", "officer-3", "officer-10", "officer-11"];
    const seeds = new Set(ids.map((id) => officerStatSeed(12345, id)));
    expect(seeds.size).toBe(ids.length);
    expect(officerStatSeed(1, "officer-1")).not.toBe(officerStatSeed(2, "officer-1"));
  });

  it("NEUTRAL_OFFICER_STATS is the all-10 line", () => {
    expect(NEUTRAL_OFFICER_STATS).toEqual({ strength: 10, integrity: 10, cunning: 10, constitution: 10 });
  });
});

// ===== E-CREW Task 19: the real officer stat roll, promotion points, weighted bonus rolls =====
const statSum = (s: OfficerStats): number => s.strength + s.integrity + s.cunning + s.constitution;

describe("rollOfficerStats (Task 19 real roll)", () => {
  it("is deterministic in (seed, rank) and returns a fresh object", () => {
    const seed = officerStatSeed(7, "officer-1");
    const a = rollOfficerStats(seed, "cadet");
    const b = rollOfficerStats(seed, "cadet");
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("rolls each cadet stat in 1..20 and is not the neutral stub", () => {
    let anyNonNeutral = false;
    for (let i = 1; i <= 50; i += 1) {
      const s = rollOfficerStats(officerStatSeed(12345, `officer-${i}`), "cadet");
      for (const k of OFFICER_STAT_KEYS) {
        expect(Number.isInteger(s[k])).toBe(true);
        expect(s[k]).toBeGreaterThanOrEqual(1);
        expect(s[k]).toBeLessThanOrEqual(OFFICER_STAT_ROLL_MAX);
      }
      if (JSON.stringify(s) !== JSON.stringify(NEUTRAL_OFFICER_STATS)) anyNonNeutral = true;
    }
    expect(anyNonNeutral).toBe(true);
  });

  it("different officer ids roll different stat lines", () => {
    const lines = new Set(
      ["officer-1", "officer-2", "officer-3", "officer-4", "officer-5"].map((id) =>
        JSON.stringify(rollOfficerStats(officerStatSeed(99, id), "cadet")),
      ),
    );
    expect(lines.size).toBeGreaterThan(1);
  });

  it("a higher rank carries the promotion points it would have earned from cadet", () => {
    const seed = officerStatSeed(4242, "officer-3");
    let expected = rollOfficerStats(seed, "cadet");
    for (const rank of ["ensign", "lieutenant", "lieutenantCommander", "commander"] as const) {
      expected = applyPromotionStatPoints(expected);
      expect(rollOfficerStats(seed, rank)).toEqual(expected);
    }
    // Four promotions, each adding the points to two stats.
    expect(statSum(rollOfficerStats(seed, "commander"))).toBe(
      statSum(rollOfficerStats(seed, "cadet")) + 4 * 2 * OFFICER_PROMOTION_STAT_POINTS,
    );
  });

  it("officerStats falls back to the neutral line for an officer without stats", () => {
    expect(officerStats(officer())).toEqual(NEUTRAL_OFFICER_STATS);
    const own = { strength: 3, integrity: 18, cunning: 9, constitution: 12 };
    expect(officerStats(officer({ stats: own }))).toEqual(own);
  });
});

describe("applyPromotionStatPoints", () => {
  it("adds the promotion points to the two highest stats", () => {
    const s = { strength: 5, integrity: 17, cunning: 12, constitution: 9 };
    expect(applyPromotionStatPoints(s)).toEqual({ strength: 5, integrity: 19, cunning: 14, constitution: 9 });
    expect(s).toEqual({ strength: 5, integrity: 17, cunning: 12, constitution: 9 }); // input untouched
  });

  it("breaks ties in stat order (strength, integrity, cunning, constitution)", () => {
    expect(applyPromotionStatPoints({ strength: 10, integrity: 10, cunning: 10, constitution: 10 })).toEqual({
      strength: 12, integrity: 12, cunning: 10, constitution: 10,
    });
    expect(applyPromotionStatPoints({ strength: 4, integrity: 8, cunning: 15, constitution: 8 })).toEqual({
      strength: 4, integrity: 10, cunning: 17, constitution: 8,
    });
  });
});

describe("promoteOfficer raises stats (Task 19)", () => {
  const ready = { missionsCompleted: 10, promotionCounters: { crewHours: 50 } };

  it("a promotion adds the promotion points to the officer's two highest stats", () => {
    const stats = { strength: 6, integrity: 14, cunning: 11, constitution: 15 };
    const promoted = promoteOfficer(officer({ ...ready, stats }));
    expect(promoted.rank).toBe("ensign");
    expect(promoted.stats).toEqual({ strength: 6, integrity: 16, cunning: 11, constitution: 17 });
    expect(stats).toEqual({ strength: 6, integrity: 14, cunning: 11, constitution: 15 }); // input untouched
  });

  it("a refused promotion leaves the stats alone", () => {
    const stats = { strength: 6, integrity: 14, cunning: 11, constitution: 15 };
    expect(promoteOfficer(officer({ missionsCompleted: 0, stats })).stats).toEqual(stats);
  });

  it("an officer without stats stays without stats (readers fall back to neutral)", () => {
    const promoted = promoteOfficer(officer(ready));
    expect(promoted.rank).toBe("ensign");
    expect(promoted.stats).toBeUndefined();
  });
});

describe("candidate stats + weighted bonus rolls (Task 19)", () => {
  it("every candidate carries a deterministic 1..20 stat line", () => {
    const a = seniorStaffCandidates(stateWith({ seed: 777, rosterSize: 12, gameTimeSeconds: 0 }));
    const b = seniorStaffCandidates(stateWith({ seed: 777, rosterSize: 12, gameTimeSeconds: 0 }));
    for (let i = 0; i < a.length; i += 1) {
      const s = a[i].stats!;
      expect(s).toBeDefined();
      for (const k of OFFICER_STAT_KEYS) {
        expect(s[k]).toBeGreaterThanOrEqual(1);
        expect(s[k]).toBeLessThanOrEqual(OFFICER_STAT_ROLL_MAX);
      }
      expect(b[i].stats).toEqual(s);
    }
  });

  it("the stat draws come AFTER every existing draw: seat, race and identity are unchanged for a fixed seed", () => {
    // Captured from the pre-Task-19 engine (seed 12345, window 0). Only the bonus PICKS changed (the
    // uniform pick became weighted, still one draw each); the seat, race and identity are identical.
    // Pre-Task-19 bonus picks, for the record: [inspiringLeader, shieldCommand], [inspiringLeader,
    // veteranInstincts], [weaponCommand, veteranInstincts], [inspiringLeader, transitCut],
    // [veteranInstincts, evasion], [fleetTriage, inspiringLeader]. Hired officers keep the bonuses
    // they were hired with; only the ephemeral board rolls differently.
    const before = [
      { seat: "tactical", race: "stheni", name: "Kirra Ssovann", gender: "male" },
      { seat: "pilot", race: "stationBorn", name: "Oscar Mwangi", gender: "nonbinary" },
      { seat: "tactical", race: "stheni", name: "Kirra Nirriss", gender: "nonbinary" },
      { seat: "pilot", race: "ossir", name: "Grokk Dragga", gender: "female" },
      { seat: "pilot", race: "outerColony", name: "Oscar Silva", gender: "female" },
      { seat: "medical", race: "stationBorn", name: "Rafael Dubois", gender: "male" },
    ];
    const now = seniorStaffCandidates(stateWith({ seed: 12345, rosterSize: 6, gameTimeSeconds: 0 }));
    expect(now.map((c) => ({ seat: c.seat, race: c.race, name: c.name, gender: c.gender }))).toEqual(before);
    expect(now.map((c) => c.bonuses.map((b) => b.id))).toEqual(WEIGHTED_PICKS_SEED_12345);
  });

  it("weighted picks: a very rare bonus rolls far less often than a common one", () => {
    // Pilot pool: Ace Navigator (common 6), Evasive Command (uncommon 3), Veteran Instincts (rare 2),
    // Inspiring Leader (very rare 1). Count first + second picks across many windows.
    const counts: Record<string, number> = {};
    let pilots = 0;
    for (let w = 0; w < 400; w += 1) {
      const roster = seniorStaffCandidates(
        stateWith({ seed: 31337, rosterSize: 10, gameTimeSeconds: w * OFFICER_ROSTER_WINDOW_SECONDS }),
      );
      for (const c of roster) {
        if (c.seat !== "pilot") continue;
        pilots += 1;
        for (const b of c.bonuses) counts[b.id] = (counts[b.id] ?? 0) + 1;
      }
    }
    expect(pilots).toBeGreaterThan(300);
    expect(counts["pilot.transitCut"]).toBeGreaterThan(counts["pilot.evasion"]);
    expect(counts["pilot.evasion"]).toBeGreaterThan(counts["any.veteranInstincts"]);
    expect(counts["any.veteranInstincts"]).toBeGreaterThan(counts["any.inspiringLeader"]);
    expect(counts["pilot.transitCut"]).toBeGreaterThan(3 * counts["any.inspiringLeader"]);
    // Every seat pool is fully weighted (no zero-weight entry that could never roll).
    for (const seat of SENIOR_STAFF_SEATS) {
      for (const def of seniorStaffBonusesForSeat(seat)) expect(bonusRollWeight(def)).toBeGreaterThan(0);
    }
  });

  it("hireOfficer copies the candidate's rolled stats onto the hired officer", () => {
    const state = stateWith({ seed: 2024 });
    const candidate = seniorStaffCandidates(state)[0];
    const hired = hireOfficer(state, candidate.id).officers[0];
    expect(hired.stats).toEqual(candidate.stats);
    expect(hired.stats).not.toBe(candidate.stats); // a copy, never shared
  });

  it("a hired officer keeps its bonuses and stats when the board re-rolls", () => {
    const state = stateWith({ seed: 2024 });
    const hiredState = hireOfficer(state, seniorStaffCandidates(state)[0].id);
    const before = JSON.stringify(hiredState.officers[0]);
    const later = { ...hiredState, gameTimeSeconds: OFFICER_ROSTER_WINDOW_SECONDS * 5 };
    expect(seniorStaffCandidates(later)[0].id).not.toBe(seniorStaffCandidates(hiredState)[0].id);
    expect(JSON.stringify(later.officers[0])).toBe(before);
  });
});

// The Task 19 weighted picks for seed 12345, window 0, slots 0..5 (pinned so a change to the weights or
// the pick order is a deliberate, visible test edit).
const WEIGHTED_PICKS_SEED_12345: string[][] = [
  ["tac.shieldCommand", "tac.weaponCommand"],
  ["pilot.evasion", "any.inspiringLeader"],
  ["tac.weaponCommand", "any.veteranInstincts"],
  ["pilot.evasion", "pilot.transitCut"],
  ["any.veteranInstincts", "pilot.transitCut"],
  ["med.fleetTriage", "any.inspiringLeader"],
];
