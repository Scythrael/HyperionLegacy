// Crew 0.14.0 ("CREW GOES LIVE") tests: the crew -> ship-stat overlay + the per-tick crew engine, and
// the PARAMOUNT offline==live parity of the crew mutations wired into the economy tick.
//
// These cover: applyCrewOverlay (additive-neutral + each mapped stat), shipCrewContribution (complement
// rollup + officer bonuses/racial, dormant keys excluded), effectiveShipStats (== pure fold with no
// crew), the effectiveMissionDef unload scaling (neutral with no crew, faster with crew), resolveCrew
// (transports delivered + PASSIVE ships auto-crewed, ACTIVE left alone, same-ref no-op when idle),
// foldOfficerMissionCompletions, and the whole-loop parity: one big offline catch-up == many small live
// ticks for crewPool, complements, officer missionsCompleted, and crew-boosted ship stats.

import { describe, it, expect } from "vitest";
import {
  applyCrewOverlay,
  shipCrewContribution,
  effectiveShipStats,
  resolveCrew,
  foldOfficerMissionCompletions,
} from "./crewOverlay";
import {
  freshState,
  shipDerivedStats,
  effectiveMissionDef,
  MISSIONS,
  type GameState,
  type ShipInstance,
  type CrewBucket,
  type SeniorStaffOfficer,
  type MissionDef,
} from "./model";
import { CREW_STAT_KEYS } from "./crewBuffs";
import { totalCrew } from "./crew";
import { TRANSPORT_WINDOW_SECONDS } from "./transports";
import { tick, economyTick, dispatchCaptainOnMission } from "./tick";

// --- fixture builders --------------------------------------------------------

function bucket(overrides: Partial<CrewBucket> & Pick<CrewBucket, "buff1Id">): CrewBucket {
  return {
    profession: "operations",
    rarity: "standard", // x1.0
    rank: 1, // x1.0
    race: "earthBorn", // racial crew.crewEffectiveness (a DORMANT key), so it never perturbs a mapped stat
    buff2Id: null,
    count: 1,
    ...overrides, // includes the required buff1Id
  };
}

function officer(overrides: Partial<SeniorStaffOfficer> = {}): SeniorStaffOfficer {
  return {
    id: "officer-1",
    seat: "operations",
    name: "Test Officer",
    race: "earthBorn",
    gender: "nonbinary",
    rank: "ensign",
    bonuses: [
      { id: "ops.cargoExpand", magnitude: 0.08 }, // officer.effectiveCargoMult -> crew.effectiveCargo
      { id: "ops.unloadSurge", magnitude: 0.1 }, // officer.unloadTimeCut -> crew.unloadSpeed
    ],
    missionsCompleted: 0,
    assignedShipId: "ship-1",
    ...overrides,
  };
}

const shortOre: MissionDef = MISSIONS.shortOreRun;

// ============================================================================
describe("applyCrewOverlay", () => {
  const base = shipDerivedStats(freshState().ships[0]);

  it("is additive-neutral (same reference) with an empty crew map", () => {
    expect(applyCrewOverlay(base, {})).toBe(base);
  });

  it("is a no-op (same reference) when only DORMANT keys are present", () => {
    // crewEffectiveness / surveyAptitude / boardingDefense etc. map to nothing yet.
    const dormant = {
      [CREW_STAT_KEYS.crewEffectiveness]: 0.5,
      [CREW_STAT_KEYS.surveyAptitude]: 0.5,
      [CREW_STAT_KEYS.boardingDefense]: 0.5,
      [CREW_STAT_KEYS.hullRepairRate]: 0.5,
    };
    expect(applyCrewOverlay(base, dormant)).toBe(base);
  });

  it("scales cargo, transit (both legs), extraction, and adds range; sets unloadSpeedMult", () => {
    const crew = {
      [CREW_STAT_KEYS.effectiveCargo]: 0.1,
      [CREW_STAT_KEYS.transitOutSpeed]: 0.02,
      [CREW_STAT_KEYS.transitBackSpeed]: 0.03, // summed with transitOut -> +0.05 transit
      [CREW_STAT_KEYS.extractionYield]: 0.2,
      [CREW_STAT_KEYS.rangeEfficiency]: 0.04,
      [CREW_STAT_KEYS.fuelEfficiency]: 0.01, // summed with range -> +0.05 additive to engineEfficiency
      [CREW_STAT_KEYS.unloadSpeed]: 0.25,
    };
    const out = applyCrewOverlay(base, crew);
    expect(out.cargoCapacity).toBeCloseTo(base.cargoCapacity * 1.1, 9);
    expect(out.transitSpeedMult).toBeCloseTo(base.transitSpeedMult * 1.05, 9);
    expect(out.extractionYieldMult).toBeCloseTo(base.extractionYieldMult * 1.2, 9);
    expect(out.engineEfficiency).toBeCloseTo(base.engineEfficiency + 0.05, 9);
    expect(out.unloadSpeedMult).toBeCloseTo(1.25, 9);
    // The input base is never mutated.
    expect(base.unloadSpeedMult).toBeUndefined();
  });
});

// ============================================================================
describe("shipCrewContribution", () => {
  function stateWith(buckets: CrewBucket[], officers: SeniorStaffOfficer[]): GameState {
    const s = freshState();
    s.ships = s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, complement: { buckets, mode: "passive" } } : sh));
    s.officers = officers;
    return s;
  }
  const ship = (s: GameState): ShipInstance => s.ships.find((sh) => sh.id === "ship-1")!;

  it("rolls up a complement into crew.* keys (buff + racial)", () => {
    const s = stateWith([bucket({ buff1Id: "ops.unloadSpeed", count: 100 })], []);
    const contrib = shipCrewContribution(s, ship(s));
    // ops.unloadSpeed magnitude 0.002 * 100 = 0.2 (standard x1, rank1 x1).
    expect(contrib[CREW_STAT_KEYS.unloadSpeed]).toBeCloseTo(0.2, 9);
    // earthBorn racial crew.crewEffectiveness complement 0.0004 * 100 = 0.04 (dormant, still summed).
    expect(contrib[CREW_STAT_KEYS.crewEffectiveness]).toBeCloseTo(0.04, 9);
  });

  it("folds an assigned officer's MAPPED bonuses + racial, skipping dormant/unassigned officers", () => {
    const s = stateWith([], [officer()]);
    const contrib = shipCrewContribution(s, ship(s));
    // ops.cargoExpand (officer.effectiveCargoMult) -> crew.effectiveCargo 0.08 (magnitude used AS-IS).
    expect(contrib[CREW_STAT_KEYS.effectiveCargo]).toBeCloseTo(0.08, 9);
    // ops.unloadSurge (officer.unloadTimeCut) -> crew.unloadSpeed 0.1.
    expect(contrib[CREW_STAT_KEYS.unloadSpeed]).toBeCloseTo(0.1, 9);
    // earthBorn racial (seniorStaff magnitude 0.04) -> crew.crewEffectiveness.
    expect(contrib[CREW_STAT_KEYS.crewEffectiveness]).toBeCloseTo(0.04, 9);
  });

  it("excludes an officer assigned to a DIFFERENT ship", () => {
    const s = stateWith([], [officer({ assignedShipId: "ship-999" })]);
    expect(shipCrewContribution(s, ship(s))).toEqual({});
  });

  it("drops officer bonuses with no ship-stat consumer (dormant, e.g. tactical weapon command)", () => {
    const s = stateWith(
      [],
      [
        officer({
          seat: "tactical",
          bonuses: [
            { id: "tac.weaponCommand", magnitude: 0.1 }, // officer.weaponEffectivenessMult -> null
            { id: "tac.shieldCommand", magnitude: 0.1 }, // officer.shieldEffectivenessMult -> null
          ],
        }),
      ],
    );
    const contrib = shipCrewContribution(s, ship(s));
    // Only the racial survives; both combat bonuses are dormant.
    expect(contrib[CREW_STAT_KEYS.effectiveCargo]).toBeUndefined();
    expect(contrib[CREW_STAT_KEYS.crewEffectiveness]).toBeCloseTo(0.04, 9);
  });
});

// ============================================================================
describe("effectiveShipStats", () => {
  it("equals the pure hull+equipment fold when the ship has no crew", () => {
    const s = freshState();
    const ship = s.ships[0];
    expect(effectiveShipStats(s, ship)).toEqual(shipDerivedStats(ship, []));
  });

  it("applies the crew overlay when the ship has a complement", () => {
    const s = freshState();
    s.ships = s.ships.map((sh) =>
      sh.id === "ship-1"
        ? { ...sh, complement: { buckets: [bucket({ buff1Id: "ops.effectiveCargo", count: 100 })], mode: "passive" } }
        : sh,
    );
    const ship = s.ships.find((sh) => sh.id === "ship-1")!;
    const boosted = effectiveShipStats(s, ship);
    const bare = shipDerivedStats(ship, []);
    // ops.effectiveCargo 0.0015 * 100 = 0.15 -> +15% cargo.
    expect(boosted.cargoCapacity).toBeCloseTo(bare.cargoCapacity * 1.15, 6);
  });
});

// ============================================================================
describe("effectiveMissionDef unload scaling (crew only)", () => {
  it("is byte-identical when the ship carries no crew (unloadSpeedMult undefined -> 1)", () => {
    const bare = shipDerivedStats(freshState().ships[0]);
    expect(effectiveMissionDef(shortOre, bare).unloadTicks).toBe(shortOre.unloadTicks);
  });

  it("shortens unloadTicks by the crew unloadSpeed multiplier", () => {
    const stats = { ...shipDerivedStats(freshState().ships[0]), unloadSpeedMult: 2 };
    const eff = effectiveMissionDef(shortOre, stats);
    expect(eff.unloadTicks).toBe(Math.max(1, Math.ceil(shortOre.unloadTicks / 2)));
    expect(eff.unloadTicks).toBeLessThanOrEqual(shortOre.unloadTicks);
  });
});

// ============================================================================
describe("resolveCrew (per-tick crew engine)", () => {
  it("is a same-reference no-op when no transport window is due and the pool is empty", () => {
    const s = freshState(); // gameTimeSeconds 0, lastTransportWindow 0, crewPool []
    expect(resolveCrew(s)).toBe(s);
  });

  it("delivers due transports into the pool and auto-crews PASSIVE ships within caps", () => {
    const s = freshState();
    s.gameTimeSeconds = 3 * TRANSPORT_WINDOW_SECONDS; // 3 windows due
    const out = resolveCrew(s);
    expect(out).not.toBe(s);
    expect(out.lastTransportWindow).toBe(3);
    // 3 batches delivered; every head is either pooled or staffed onto the passive ship (conservation).
    const staffed = totalCrew(out.ships.find((sh) => sh.id === "ship-1")!.complement!.buckets);
    const pooled = totalCrew(out.crewPool);
    expect(staffed + pooled).toBeGreaterThan(0);
    expect(staffed).toBeGreaterThan(0); // the passive ship pulled at least some crew
  });

  it("leaves ACTIVE-mode ships unstaffed (active assignment is a later phase)", () => {
    const s = freshState();
    s.gameTimeSeconds = 3 * TRANSPORT_WINDOW_SECONDS;
    s.ships = s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, complement: { buckets: [], mode: "active" } } : sh));
    const out = resolveCrew(s);
    // The active ship's complement stays empty; all delivered crew sits in the pool.
    expect(totalCrew(out.ships.find((sh) => sh.id === "ship-1")!.complement!.buckets)).toBe(0);
    expect(totalCrew(out.crewPool)).toBeGreaterThan(0);
  });
});

// ============================================================================
describe("foldOfficerMissionCompletions", () => {
  it("increments only officers assigned to a completing ship", () => {
    const officers = [
      officer({ id: "officer-1", assignedShipId: "ship-1", missionsCompleted: 5 }),
      officer({ id: "officer-2", assignedShipId: "ship-2", missionsCompleted: 5 }),
      officer({ id: "officer-3", assignedShipId: null, missionsCompleted: 5 }),
    ];
    const out = foldOfficerMissionCompletions(officers, new Map([["ship-1", 3]]));
    expect(out[0].missionsCompleted).toBe(8);
    expect(out[1].missionsCompleted).toBe(5);
    expect(out[2].missionsCompleted).toBe(5);
  });

  it("returns the same reference when nothing completed", () => {
    const officers = [officer()];
    expect(foldOfficerMissionCompletions(officers, new Map())).toBe(officers);
  });
});

// ============================================================================
describe("CREW GOES LIVE parity: one big offline catch-up == many small live ticks", () => {
  // A span crossing MULTIPLE transport windows AND completing mission cycles, with an officer aboard,
  // so transports, auto-crew, crew-boosted stats, and officer missionsCompleted are ALL exercised.
  const SPAN_SECONDS = 5 * TRANSPORT_WINDOW_SECONDS + 137; // 9137 ticks (dt=1), well under the 2-day cap

  function setup(): GameState {
    let s = freshState(); // ship-1 (generalFreighter, captain 1, empty passive complement)
    s = { ...s, officers: [officer({ assignedShipId: "ship-1" })], nextOfficerId: 2 };
    // Put the captain on a mission so cycles complete over the span.
    const dispatched = dispatchCaptainOnMission(s, 1, "shortOreRun");
    expect(dispatched.success).toBe(true);
    return dispatched.next;
  }

  // A deterministic rng so loot draws stay identical across both runs (crew fields are rng-independent,
  // but keeping it fixed makes the whole comparison total).
  function seededRng(): () => number {
    let x = 0x12345678;
    return () => {
      x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) ^ 0x9e3779b9) >>> 0;
      return (x >>> 8) / (1 << 24);
    };
  }

  it("crewPool, complements, officer missionsCompleted, and crew-boosted stats are identical", () => {
    const base = setup();

    // OFFLINE: one big catch-up.
    const big = tick(SPAN_SECONDS, base, seededRng());

    // LIVE: the same span stepped one whole tick at a time.
    let small = base;
    const rng = seededRng();
    for (let i = 0; i < SPAN_SECONDS; i += 1) small = tick(base.tickDurationSeconds, small, rng);
    // Guard: an integer span stepped by 1s ticks lands on the same elapsed game time.
    expect(big.gameTimeSeconds).toBe(small.gameTimeSeconds);

    // The crew mutations must match exactly.
    expect(big.crewPool).toEqual(small.crewPool);
    expect(big.lastTransportWindow).toBe(small.lastTransportWindow);
    for (const bigShip of big.ships) {
      const smallShip = small.ships.find((sh) => sh.id === bigShip.id)!;
      expect(bigShip.complement).toEqual(smallShip.complement);
      // And the derived, crew-boosted stats agree (the invariant the whole idle model rests on).
      expect(effectiveShipStats(big, bigShip)).toEqual(effectiveShipStats(small, smallShip));
    }
    expect(big.officers.map((o) => o.missionsCompleted)).toEqual(small.officers.map((o) => o.missionsCompleted));

    // And the run was non-trivial: crew actually accrued and the officer earned mission credit.
    const bigStaffed = totalCrew(big.ships.find((sh) => sh.id === "ship-1")!.complement!.buckets);
    expect(bigStaffed + totalCrew(big.crewPool)).toBeGreaterThan(0);
    expect(big.officers[0].missionsCompleted).toBeGreaterThan(0);
  });
});
