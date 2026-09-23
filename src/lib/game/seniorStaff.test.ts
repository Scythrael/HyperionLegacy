// Crew 0.14.0 (Phase 1): tests for the DORMANT Senior Staff officer engine (seniorStaff.ts).
// Covers: roster determinism (same window+seed => same candidates; window/seed changes), seat-type
// matching enforced on assign, hire/fire/assign/unassign state transitions (pure, no input
// mutation), the 5-rank Cadet -> Commander promotion gate logic + bonus strengthening, and cadet
// start. Nothing here exercises the tick or ship stats (the engine is not wired in yet).

import { describe, it, expect } from "vitest";
import { freshState, SENIOR_STAFF_ROSTER_BASE } from "./model";
import type { GameState, SeniorStaffOfficer } from "./model";
import {
  SENIOR_STAFF_SEATS,
  OFFICER_RANK_ORDER,
  OFFICER_ROSTER_WINDOW_SECONDS,
  PROMOTION_GATES,
  officerRankLabel,
  officerRankMagnitudeFactor,
  nextOfficerRank,
  canPromote,
  promoteOfficer,
  officerRacialBonus,
  officerRosterWindowIndex,
  seniorStaffCandidates,
  hireOfficer,
  fireOfficer,
  assignOfficerToShip,
  unassignOfficer,
  officerInSeat,
} from "./seniorStaff";
import { getSeniorStaffBonusById } from "./seniorStaffBonuses";

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

describe("promotion gate logic (5-rank ladder)", () => {
  it("PROMOTION_GATES pins the first-pass thresholds", () => {
    expect(PROMOTION_GATES.cadet).toEqual({ to: "ensign", missionsRequired: 10, requiresPersonnelAchievement: false });
    expect(PROMOTION_GATES.ensign).toEqual({ to: "lieutenant", missionsRequired: 30, requiresPersonnelAchievement: false });
    expect(PROMOTION_GATES.lieutenant).toEqual({ to: "lieutenantCommander", missionsRequired: 75, requiresPersonnelAchievement: false });
    expect(PROMOTION_GATES.lieutenantCommander).toEqual({ to: "commander", missionsRequired: 150, requiresPersonnelAchievement: true });
    expect(PROMOTION_GATES.commander).toBeUndefined(); // top rank, no gate
  });

  it("canPromote is false below the mission threshold and true at/above it", () => {
    expect(canPromote(officer({ rank: "cadet", missionsCompleted: 9 }))).toBe(false);
    expect(canPromote(officer({ rank: "cadet", missionsCompleted: 10 }))).toBe(true);
    expect(canPromote(officer({ rank: "ensign", missionsCompleted: 29 }))).toBe(false);
    expect(canPromote(officer({ rank: "ensign", missionsCompleted: 30 }))).toBe(true);
    expect(canPromote(officer({ rank: "lieutenant", missionsCompleted: 74 }))).toBe(false);
    expect(canPromote(officer({ rank: "lieutenant", missionsCompleted: 75 }))).toBe(true);
  });

  it("the top rung also needs the (stubbed) Personnel achievement", () => {
    const ltc = officer({ rank: "lieutenantCommander", missionsCompleted: 150 });
    // default hook is false: the achievement tier is not built yet, so the rung cannot be earned
    expect(canPromote(ltc)).toBe(false);
    expect(canPromote(ltc, { personnelAchievementUnlocked: false })).toBe(false);
    // hook true: gate opens
    expect(canPromote(ltc, { personnelAchievementUnlocked: true })).toBe(true);
    // still needs the mission count even with the achievement
    expect(canPromote(officer({ rank: "lieutenantCommander", missionsCompleted: 149 }), { personnelAchievementUnlocked: true })).toBe(false);
  });

  it("commander cannot be promoted further", () => {
    expect(canPromote(officer({ rank: "commander", missionsCompleted: 9999 }), { personnelAchievementUnlocked: true })).toBe(false);
  });

  it("promoteOfficer advances one rank and strengthens both bonuses off the catalog base", () => {
    const cadet = officer({
      rank: "cadet",
      missionsCompleted: 10,
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

  it("promoteOfficer is a no-op fresh copy when the gate is not met", () => {
    const cadet = officer({ rank: "cadet", missionsCompleted: 5 });
    const result = promoteOfficer(cadet);
    expect(result.rank).toBe("cadet");
    expect(result).not.toBe(cadet); // fresh copy, not the same reference
    expect(result.bonuses).toEqual(cadet.bonuses);
  });

  it("promoteOfficer is a no-op at commander (top rank)", () => {
    const cmdr = officer({ rank: "commander", missionsCompleted: 9999 });
    expect(promoteOfficer(cmdr, { personnelAchievementUnlocked: true }).rank).toBe("commander");
  });

  it("walks the FULL ladder cadet -> commander given the gates, strengthening at each step", () => {
    let o = officer({ rank: "cadet", missionsCompleted: 150 });
    const startMag = o.bonuses[0].magnitude;
    const ctx = { personnelAchievementUnlocked: true };

    o = promoteOfficer(o, ctx);
    expect(o.rank).toBe("ensign");
    o = promoteOfficer(o, ctx);
    expect(o.rank).toBe("lieutenant");
    o = promoteOfficer(o, ctx);
    expect(o.rank).toBe("lieutenantCommander");
    o = promoteOfficer(o, ctx);
    expect(o.rank).toBe("commander");

    // at the top: no further promotion
    expect(nextOfficerRank(o.rank)).toBe(null);
    expect(canPromote(o, ctx)).toBe(false);
    // commander magnitude is well above the starting magnitude
    expect(o.bonuses[0].magnitude).toBeGreaterThan(startMag);
    expect(o.bonuses[0].magnitude).toBeCloseTo(0.08 * officerRankMagnitudeFactor("commander"), 10);
  });

  it("strengthenBonus falls back to a proportional scale for an unknown (non-catalog) bonus id", () => {
    const o = officer({
      rank: "cadet",
      missionsCompleted: 10,
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
