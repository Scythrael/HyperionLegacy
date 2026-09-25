// Crew 0.14.0 (Phase C-3b): tests for the captain RETIREMENT + XO SUCCESSION loop -- the canRetire
// guards (each fail path + the happy path), the retireCaptain mini-prestige reset + XO consumption +
// identity transfer, the 5-retirement lock, the fleet-wide retirementExpMultiplier math, and the
// additive-neutrality of wiring that multiplier into captain XP accrual (x1 == byte-identical, and a
// nonzero multiplier scales the award).

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  freshCaptains,
  type GameState,
  type CaptainState,
  type CaptainMissionState,
  type SeniorStaffOfficer,
} from "./model";
import {
  canRetireCaptain,
  retireCaptain,
  retirementExpMultiplier,
  seatedExecutiveOfficerFor,
  RETIRE_LEVEL_GATE,
  MAX_CAPTAIN_RETIREMENTS,
  RETIREMENT_EXP_PER,
} from "./captainRetirement";
import { tickCaptainMission } from "./tick";

// A constant rng (matches tick.test.ts's ALWAYS_MIN_ROLL posture): behaves the same on every call, so
// the closed-form "one big jump == many small ticks" guarantee is unaffected.
const CONST_RNG = () => 0;

// A minimal extraction mission (mirrors tick.test.ts's missionCaptain), so a captain accrues XP.
function extractionMission(): CaptainMissionState {
  return {
    kind: "extraction",
    missionKey: "shortOreRun",
    phase: "ordersReceived",
    phaseProgressTicks: 0,
    cargo: {
      commonOre: new Decimal(0),
      uncommonMaterial: new Decimal(0),
      rareMaterial: new Decimal(0),
    },
    recalled: false,
  };
}

// A seated Executive officer aboard `shipId`, with a chosen identity (name + race), for the succession.
function executiveOfficer(id: string, shipId: string, name: string, race: SeniorStaffOfficer["race"]): SeniorStaffOfficer {
  return {
    id,
    seat: "executive",
    name,
    race,
    gender: "nonbinary",
    rank: "commander",
    bonuses: [
      { id: "bonusA", magnitude: 1 },
      { id: "bonusB", magnitude: 1 },
    ],
    missionsCompleted: 0,
    assignedShipId: shipId,
  };
}

// A retire-READY state: freshState's one captain (id 1, ship-1) at the level gate, idle, with a seated
// Executive officer aboard ship-1. `mutate` tweaks the captain for a specific fail-path.
function retireReadyState(mutate: (c: CaptainState) => CaptainState = (c) => c): GameState {
  const base = freshState();
  const captain: CaptainState = mutate({
    ...base.captains[0],
    level: RETIRE_LEVEL_GATE,
    mission: null,
    // Give the captain some spent base progression + secondary state so the reset + persistence are visible.
    xp: new Decimal(120),
    statPoints: 7,
    unlockedCaptainTalents: ["someTalent" as any],
    spec: "combat" as any,
    secondaryPoints: 0,
    unlockedSecondaryTalents: ["extraction1" as any, "extraction2" as any],
    retirements: 0,
  });
  return {
    ...base,
    captains: [captain, ...base.captains.slice(1)],
    officers: [executiveOfficer("officer-xo", "ship-1", "Kira Nerys", "vael")],
    nextOfficerId: 2,
  };
}

// ============================================================================
// canRetireCaptain guards
// ============================================================================
describe("canRetireCaptain", () => {
  it("allows retirement when all guards pass (happy path)", () => {
    expect(canRetireCaptain(retireReadyState(), 1)).toBe(true);
  });

  it("refuses an unknown captain id", () => {
    expect(canRetireCaptain(retireReadyState(), 999)).toBe(false);
  });

  it("refuses below the level gate", () => {
    const s = retireReadyState((c) => ({ ...c, level: RETIRE_LEVEL_GATE - 1 }));
    expect(canRetireCaptain(s, 1)).toBe(false);
  });

  it("refuses at the retirement cap (5, locked in)", () => {
    const s = retireReadyState((c) => ({ ...c, retirements: MAX_CAPTAIN_RETIREMENTS }));
    expect(canRetireCaptain(s, 1)).toBe(false);
  });

  it("refuses when no Executive officer is seated on the captain's ship", () => {
    const s = retireReadyState();
    expect(canRetireCaptain({ ...s, officers: [] }, 1)).toBe(false);
  });

  it("refuses when the seated officer is a NON-executive seat", () => {
    const s = retireReadyState();
    const pilot: SeniorStaffOfficer = { ...s.officers[0], seat: "pilot" };
    expect(canRetireCaptain({ ...s, officers: [pilot] }, 1)).toBe(false);
  });

  it("refuses when the captain is mid-mission (idle-only safety)", () => {
    const s = retireReadyState((c) => ({ ...c, mission: extractionMission() }));
    expect(canRetireCaptain(s, 1)).toBe(false);
  });

  it("refuses when the Executive is seated on a DIFFERENT ship (not the captain's)", () => {
    const s = retireReadyState();
    const elsewhere: SeniorStaffOfficer = { ...s.officers[0], assignedShipId: "ship-2" };
    expect(canRetireCaptain({ ...s, officers: [elsewhere] }, 1)).toBe(false);
  });
});

// ============================================================================
// seatedExecutiveOfficerFor (the successor lookup)
// ============================================================================
describe("seatedExecutiveOfficerFor", () => {
  it("returns the seated Executive on the captain's ship", () => {
    const s = retireReadyState();
    expect(seatedExecutiveOfficerFor(s, 1)?.id).toBe("officer-xo");
  });

  it("returns undefined when the captain has no ship", () => {
    const s = retireReadyState();
    // Detach ship-1 from captain 1.
    const ships = s.ships.map((sh) => (sh.assignedCaptainId === 1 ? { ...sh, assignedCaptainId: null } : sh));
    expect(seatedExecutiveOfficerFor({ ...s, ships }, 1)).toBeUndefined();
  });
});

// ============================================================================
// retireCaptain: mini-prestige reset + XO succession
// ============================================================================
describe("retireCaptain", () => {
  it("is a same-reference no-op when retirement is illegal", () => {
    const s = retireReadyState((c) => ({ ...c, level: 1 })); // below the gate
    expect(retireCaptain(s, 1)).toBe(s);
  });

  it("does not mutate the input state", () => {
    const s = retireReadyState();
    const beforeOfficers = s.officers.length;
    const beforeRetirements = s.captains[0].retirements;
    retireCaptain(s, 1);
    expect(s.officers.length).toBe(beforeOfficers);
    expect(s.captains[0].retirements).toBe(beforeRetirements);
    expect(s.captains[0].level).toBe(RETIRE_LEVEL_GATE);
  });

  it("resets the base progression (level/xp/statPoints/talents/spec) to the fresh baseline", () => {
    const after = retireCaptain(retireReadyState(), 1);
    const c = after.captains.find((x) => x.id === 1)!;
    const baseline = freshCaptains(1)[0];
    expect(c.level).toBe(1);
    expect(c.xp.equals(0)).toBe(true);
    expect(c.statPoints).toBe(baseline.statPoints); // level-1 baseline (0)
    expect(c.unlockedCaptainTalents).toEqual([]);
    expect(c.spec).toBeNull();
  });

  it("PERSISTS the secondary tree and grants +1 secondaryPoint + increments retirements", () => {
    const after = retireCaptain(retireReadyState(), 1);
    const c = after.captains.find((x) => x.id === 1)!;
    expect(c.unlockedSecondaryTalents).toEqual(["extraction1", "extraction2"]); // untouched
    expect(c.secondaryPoints).toBe(1); // 0 + 1
    expect(c.retirements).toBe(1); // 0 + 1
  });

  it("CONSUMES the seated Executive officer (removed from state.officers, seat emptied)", () => {
    const after = retireCaptain(retireReadyState(), 1);
    expect(after.officers.find((o) => o.id === "officer-xo")).toBeUndefined();
    expect(after.officers).toHaveLength(0);
    // The Executive seat on ship-1 is now empty.
    expect(seatedExecutiveOfficerFor(after, 1)).toBeUndefined();
  });

  it("transfers the XO's IDENTITY (name -> label, race) to the captaincy", () => {
    const after = retireCaptain(retireReadyState(), 1);
    const c = after.captains.find((x) => x.id === 1)!;
    expect(c.label).toBe("Kira Nerys");
    expect(c.race).toBe("vael");
  });

  it("supports repeated retirements up to the cap, then LOCKS IN at 5", () => {
    let s = retireReadyState();
    // Retire five times, re-seating a fresh Executive + re-qualifying the captain between each.
    for (let i = 1; i <= MAX_CAPTAIN_RETIREMENTS; i++) {
      expect(canRetireCaptain(s, 1)).toBe(true);
      s = retireCaptain(s, 1);
      expect(s.captains.find((c) => c.id === 1)!.retirements).toBe(i);
      // Re-qualify: back to the level gate, and re-seat a new Executive on ship-1.
      s = {
        ...s,
        captains: s.captains.map((c) => (c.id === 1 ? { ...c, level: RETIRE_LEVEL_GATE } : c)),
        officers: [executiveOfficer(`officer-xo-${i}`, "ship-1", `Successor ${i}`, "ossir")],
      };
    }
    const c = s.captains.find((x) => x.id === 1)!;
    expect(c.retirements).toBe(MAX_CAPTAIN_RETIREMENTS);
    expect(c.secondaryPoints).toBe(MAX_CAPTAIN_RETIREMENTS); // one point per retirement
    // Locked in: even fully re-qualified, a 6th retirement is refused.
    expect(canRetireCaptain(s, 1)).toBe(false);
    expect(retireCaptain(s, 1)).toBe(s); // no-op
  });
});

// ============================================================================
// retirementExpMultiplier math
// ============================================================================
describe("retirementExpMultiplier", () => {
  it("is EXACTLY 1 when no captain has retired (every existing save)", () => {
    expect(retirementExpMultiplier(freshState())).toBe(1);
  });

  it("adds RETIREMENT_EXP_PER per retirement of a single captain", () => {
    const s = retireReadyState((c) => ({ ...c, retirements: 3 }));
    expect(retirementExpMultiplier(s)).toBeCloseTo(1 + RETIREMENT_EXP_PER * 3, 12);
  });

  it("SUMS retirements across every captain", () => {
    const base = freshState();
    const captains = [
      { ...base.captains[0], retirements: 2 },
      { ...freshCaptains(1)[0], id: 2, retirements: 3 },
    ];
    const s: GameState = { ...base, captains };
    expect(retirementExpMultiplier(s)).toBeCloseTo(1 + RETIREMENT_EXP_PER * 5, 12);
  });
});

// ============================================================================
// Additive-neutrality + scaling of the captain-XP accrual wiring
// ============================================================================
describe("captain XP accrual retirement multiplier (tickCaptainMission)", () => {
  // 100 whole ticks of rate-1 XP = 100 XP, below xpForNextLevel(1)=300, so no level-up: the leftover
  // xp equals the award exactly, which makes the multiplier's effect directly readable.
  function baseOnMission(): CaptainState {
    const c = freshCaptains(1)[0]; // xp 0, level 1, statPoints 0
    return { ...c, mission: extractionMission() };
  }

  it("omitting the multiplier == passing 1 (byte-identical): 100 ticks -> 100 XP, no level-up", () => {
    const base = baseOnMission();
    const noArg = tickCaptainMission(100, base, CONST_RNG);
    const explicitOne = tickCaptainMission(100, base, CONST_RNG, {}, null, Infinity, 0, Infinity, undefined, Infinity, 1);
    expect(noArg.captain.xp.equals(100)).toBe(true);
    expect(noArg.captain.level).toBe(1);
    expect(noArg.captain.statPoints).toBe(0);
    // The default path and the explicit-1 path land the same xp/level/statPoints.
    expect(explicitOne.captain.xp.equals(noArg.captain.xp)).toBe(true);
    expect(explicitOne.captain.level).toBe(noArg.captain.level);
    expect(explicitOne.captain.statPoints).toBe(noArg.captain.statPoints);
  });

  it("a >1 multiplier scales the per-call award proportionally", () => {
    const base = baseOnMission();
    const x1_5 = tickCaptainMission(100, base, CONST_RNG, {}, null, Infinity, 0, Infinity, undefined, Infinity, 1.5);
    const x2 = tickCaptainMission(100, base, CONST_RNG, {}, null, Infinity, 0, Infinity, undefined, Infinity, 2);
    expect(x1_5.captain.xp.equals(150)).toBe(true); // 100 * 1.5
    expect(x2.captain.xp.equals(200)).toBe(true); // 100 * 2
    // Still below xpForNextLevel(1)=300, so no level-up on either.
    expect(x1_5.captain.level).toBe(1);
    expect(x2.captain.level).toBe(1);
  });
});
