// ============================================================================
// TRANSIT BERTHS
// Infrastructure 0.13.4, Phase 3. Design section 5, and especially 5.5 (THE ESCAPE VALVE).
//
// ⚠️ THE THREE HAZARD TESTS (H1, H2, H3) ARE THE POINT OF THIS FILE. "You cannot unload
// without a free transit berth" has the same shape as the 0.11.1 docks bug that bricked saves
// and shipped an emergency fix. berths.ts carries the structural proof in prose; these are the
// proof's teeth. If one of them ever fails, the softlock is back, and the correct response is
// to revert the change, never to relax the test.
//
//   H1 the berth count can never reach 0, so nobody waits forever
//   H2 an occupant can never fail to clear, so a berth always frees
//   H3 occupancy can never leak, so a berth is never lost to bookkeeping
//
// ⚠️ PARITY CASES LIVE HERE TOO, so this file joins the parity exclusion list alongside
// craftQueue / salvage / patrolEndReason. The 101 baseline counts the UNTOUCHED cases.
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  MISSIONS,
  MISSION_PHASE_LABEL,
  TRANSIT_BERTH_BASE,
  TRANSIT_BERTH_RUNGS,
  type GameState,
  type CaptainMissionState,
} from "./model";
import {
  missionPhaseStatus,
  transitBerthCount,
  transitBerthsOccupied,
  transitBerthsFree,
  captainsAwaitingBerth,
  berthQueuePosition,
  berthEtaTicks,
  worstCaseBerthWaitTicks,
} from "./berths";
import {
  economyTick,
  tick,
  canUpgradeTransitBerths,
  startTransitBerthExpansion,
  dispatchCaptainOnMission,
} from "./tick";

const RNG = () => 0.5;
const MISSION_KEY = "shortOreRun";

// A fleet with `n` captains, each with a ship, fuel and credits topped up so nothing else
// confounds a berth measurement.
function fleetOf(n: number): GameState {
  const base = freshState();
  const captains = Array.from({ length: n }, (_, i) => ({
    ...base.captains[0],
    id: i + 1,
    label: `C${i + 1}`,
    mission: null,
  }));
  const ships = Array.from({ length: n }, (_, i) => ({
    id: `ship-${i + 1}`,
    typeKey: "generalFreighter" as const,
    assignedCaptainId: i + 1,
  }));
  return {
    ...base,
    captains,
    ships,
    fuel: new Decimal(100000),
    credits: new Decimal(100000),
    shipStorageCapacity: Math.max(base.shipStorageCapacity, n),
    // The berth rungs cost structuralAssembly (the same component the docks track and hull
    // builds use), which a fresh save does not stock. Without this the upgrade-track cases
    // fail their MATERIAL gate and report "start refused" rather than what they are testing.
    inventory: {
      ...base.inventory,
      structuralAssembly: [new Decimal(500), new Decimal(0), new Decimal(0), new Decimal(0), new Decimal(0), new Decimal(0)],
    } as never,
    discovered: { ...(base.discovered ?? {}), structuralAssembly: true } as never,
  };
}

// Put `n` captains into the UNLOADING phase, which is what occupies a berth.
function withUnloading(state: GameState, n: number): GameState {
  let placed = 0;
  return {
    ...state,
    captains: state.captains.map((c) => {
      if (placed >= n) return c;
      placed += 1;
      const mission: CaptainMissionState = {
        kind: "extraction",
        missionKey: MISSION_KEY,
        phase: "unloading",
        phaseProgressTicks: 0,
        cargo: {} as never,
        recalled: false,
      } as CaptainMissionState;
      return { ...c, mission };
    }),
  };
}

// Put `n` captains at the very END of their return leg, i.e. HELD waiting for a berth. This is
// the banked state the hold in tick.ts leaves behind: progress at the phase requirement, phase
// still transitBack.
function withHeldAtReturn(state: GameState, n: number): GameState {
  const def = MISSIONS[MISSION_KEY];
  let placed = 0;
  return {
    ...state,
    captains: state.captains.map((c) => {
      if (placed >= n) return c;
      placed += 1;
      const mission: CaptainMissionState = {
        kind: "extraction",
        missionKey: MISSION_KEY,
        phase: "transitBack",
        // The generalFreighter has transitSpeedMult 1, so the effective requirement equals the
        // raw one. Using the raw value keeps this fixture readable; the +1 guarantees the
        // "banked at or past the requirement" condition regardless of rounding.
        phaseProgressTicks: def.transitBackTicks + 1,
        cargo: {} as never,
        recalled: false,
      } as CaptainMissionState;
      return { ...c, mission };
    }),
  };
}

describe("transitBerthCount: the derived capacity", () => {
  it("a fresh game starts on the base", () => {
    expect(transitBerthCount(freshState())).toBe(TRANSIT_BERTH_BASE);
  });

  it("each rung level adds exactly one berth, up to the track ceiling of 10", () => {
    for (let level = 0; level <= TRANSIT_BERTH_RUNGS.length; level++) {
      expect(transitBerthCount({ ...freshState(), transitBerthCapacity: level })).toBe(TRANSIT_BERTH_BASE + level);
    }
    // The user's chosen ceiling (design 17.1 Q2: "base 2, and up to 10"), asserted as a literal
    // so a retune of RUNG_COUNT is a deliberate decision rather than a silent drift.
    expect(TRANSIT_BERTH_BASE + TRANSIT_BERTH_RUNGS.length).toBe(10);
  });
});

// ============================================================================
// H1: THE COUNT CAN NEVER REACH 0
// Mirrors ship-repair.test.ts's never-fewer-bays proof.
// ============================================================================
describe("H1: the berth count has a floor nothing can lower", () => {
  it("never reports fewer than the base, at every reachable level", () => {
    for (let level = 0; level <= TRANSIT_BERTH_RUNGS.length; level++) {
      expect(transitBerthCount({ ...freshState(), transitBerthCapacity: level })).toBeGreaterThanOrEqual(
        TRANSIT_BERTH_BASE,
      );
    }
  });

  it("falls through to the base for a missing, malformed or negative stored level", () => {
    // Every one of these is reachable: an absent field on a pre-v45 save, a hand-edited save, a
    // corrupted import. NONE of them may produce zero berths, because zero berths is the
    // softlock.
    const hostile: unknown[] = [undefined, null, NaN, Infinity, -Infinity, -5, "3", {}, []];
    for (const level of hostile) {
      const state = { ...freshState(), transitBerthCapacity: level } as unknown as GameState;
      expect(transitBerthCount(state)).toBeGreaterThanOrEqual(TRANSIT_BERTH_BASE);
    }
  });

  it("clamps a level past the last rung to the real ceiling rather than inventing berths", () => {
    const absurd = { ...freshState(), transitBerthCapacity: 9999 };
    expect(transitBerthCount(absurd)).toBe(TRANSIT_BERTH_BASE + TRANSIT_BERTH_RUNGS.length);
  });

  it("reports 0 FREE rather than a negative when more ships are docked than there are berths", () => {
    // Only reachable by a hand-edited save or a future base retune while ships are docked. A
    // negative here would underflow the `berthsAvailable < 1` comparison in the engine.
    const over = withUnloading(fleetOf(5), 5);
    expect(transitBerthsOccupied(over)).toBe(5);
    expect(transitBerthsFree(over)).toBe(0);
    expect(transitBerthsFree(over)).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// H2: AN OCCUPANT CAN NEVER FAIL TO CLEAR
// The unloading advance is gated on NOTHING, so occupancy is time-bounded.
// ============================================================================
describe("H2: an occupant always clears, so a berth always frees", () => {
  it("a docked ship completes its unload and releases its berth even with EVERY cap full", () => {
    // ⚠️ THE HAZARD: if unloading could stall on a full warehouse, the occupant would hold its
    // berth forever and H2 would fail. It cannot: the phase advance reads no cap, and the cargo
    // deposit clamps and DISCARDS overflow later, in economyTick, rather than stalling.
    const base = withUnloading(fleetOf(1), 1);
    // Fill every discovered material stack to something enormous so any cap is exceeded.
    const stuffed: GameState = {
      ...base,
      inventory: Object.fromEntries(
        Object.keys(base.inventory).map((k) => [k, (base.inventory as never as Record<string, Decimal[]>)[k].map(() => new Decimal("1e30"))]),
      ) as never,
    };
    expect(transitBerthsOccupied(stuffed)).toBe(1);
    const unloadTicks = MISSIONS[MISSION_KEY].unloadTicks;
    const after = economyTick(stuffed, unloadTicks + 2, RNG);
    // The berth is free again: the occupant cleared regardless of the caps.
    expect(transitBerthsOccupied(after)).toBe(0);
  });

  it("clears within unloadTicks, which is what makes the wait TIME-bounded", () => {
    const state = withUnloading(fleetOf(1), 1);
    const unloadTicks = MISSIONS[MISSION_KEY].unloadTicks;
    // One tick short: still docked, so the bound is tight rather than generous.
    expect(transitBerthsOccupied(economyTick(state, unloadTicks - 1, RNG))).toBe(1);
    // At the bound: cleared.
    expect(transitBerthsOccupied(economyTick(state, unloadTicks + 1, RNG))).toBe(0);
  });

  it("the worst-case wait is a computable DELAY, never a lock", () => {
    // The ceiling the softlock proof promises, asserted as arithmetic rather than argued in prose.
    const state = freshState();
    expect(worstCaseBerthWaitTicks(state, 0)).toBe(0);
    // ⚠️ 4 CONCURRENT RETURNS IS TODAY'S REAL CEILING, not the 5 the design's prose assumed:
    // MAX_UNLOCKABLE_CAPTAINS is 4 (1 plus three unlockCaptainSlot nodes). The expression is
    // derived rather than hardcoded so this tracks when unlock nodes are added.
    const worst = worstCaseBerthWaitTicks(state, 4);
    expect(worst).toBeGreaterThan(0);
    expect(Number.isFinite(worst)).toBe(true);
    // Buying the track out drives it DOWN, which is the reachable, affordable fix the design
    // offers in place of a bypass.
    const maxed = { ...state, transitBerthCapacity: TRANSIT_BERTH_RUNGS.length };
    expect(worstCaseBerthWaitTicks(maxed, 4)).toBeLessThanOrEqual(worst);
  });
});

// ============================================================================
// H3: OCCUPANCY CAN NEVER LEAK
// Nothing is stored, so a captain that stops unloading always releases.
// ============================================================================
describe("H3: occupancy is derived, so it cannot leak", () => {
  it("a captain going idle mid-unload releases its berth immediately", () => {
    const docked = withUnloading(fleetOf(2), 2);
    expect(transitBerthsOccupied(docked)).toBe(2);
    // Drop one captain to idle, exactly as a recall or the retired-key guard would.
    const oneIdled: GameState = {
      ...docked,
      captains: docked.captains.map((c) => (c.id === 1 ? { ...c, mission: null } : c)),
    };
    // ⚠️ NO CLEANUP STEP RAN. The berth is free purely because occupancy is a question asked of
    // the phase. A stored berthId would still be pointing at captain 1 here, which is exactly
    // the stranded-resource class that made 0.11.1 an emergency.
    expect(transitBerthsOccupied(oneIdled)).toBe(1);
    expect(transitBerthsFree(oneIdled)).toBe(transitBerthCount(oneIdled) - 1);
  });

  it("a captain removed from the roster entirely leaves no trace", () => {
    const docked = withUnloading(fleetOf(2), 2);
    const removed: GameState = { ...docked, captains: docked.captains.filter((c) => c.id !== 1) };
    expect(transitBerthsOccupied(removed)).toBe(1);
  });

  it("a PATROL never occupies a berth, at any phase", () => {
    // Design 5.4 / 17.3 Q4: patrols award loot per won wave and have no unloading phase, so
    // there is no cargo for a berth to gate. A patrol counted here would consume berths a
    // returning freighter needs.
    const base = fleetOf(1);
    const patrolling: GameState = {
      ...base,
      captains: base.captains.map((c) => ({
        ...c,
        mission: { kind: "patrol", patrolKey: "crimsonReaverSweep", phase: "unloading" } as never,
      })),
    };
    expect(transitBerthsOccupied(patrolling)).toBe(0);
  });
});

describe("the berth queue: order, position and ETA", () => {
  it("queues held captains in state.captains order, which is captain-id insertion order", () => {
    // Determinism: the same ordering processShipRepairs uses. Sorting by anything derived would
    // make the queue reorder itself between ticks, which cannot be explained to a player and
    // cannot be held byte-identical offline.
    const held = withHeldAtReturn(fleetOf(4), 4);
    expect(captainsAwaitingBerth(held)).toEqual([1, 2, 3, 4]);
  });

  it("reports a 1-based position, and null for a captain that is not waiting", () => {
    const held = withHeldAtReturn(fleetOf(3), 3);
    expect(berthQueuePosition(held, 1)).toBe(1);
    expect(berthQueuePosition(held, 3)).toBe(3);
    // A captain with no mission at all is not in the queue.
    const idle = { ...held, captains: held.captains.map((c) => (c.id === 2 ? { ...c, mission: null } : c)) };
    expect(berthQueuePosition(idle, 2)).toBeNull();
  });

  it("reports an ETA of 0 while a berth is already free for that captain", () => {
    // Position within the free count means the next advance claims one, so there is nothing to
    // wait for and the readout must not invent a delay.
    const held = withHeldAtReturn(fleetOf(2), 2);
    expect(transitBerthsFree(held)).toBe(TRANSIT_BERTH_BASE);
    expect(berthEtaTicks(held, 1)).toBe(0);
  });

  it("reports a positive ETA for a captain past the free count, and null when not waiting", () => {
    // Three held captains against two base berths: the third genuinely waits.
    const held = withHeldAtReturn(fleetOf(3), 3);
    expect(berthEtaTicks(held, 3)).toBeGreaterThan(0);
    expect(berthEtaTicks(freshState(), 1)).toBeNull();
  });
});

describe("the hold itself, through the real engine", () => {
  it("holds the extras when more ships return than there are berths, and does not lose them", () => {
    // Three captains all banked at the end of their return leg, two berths. Two dock, one holds.
    const held = withHeldAtReturn(fleetOf(3), 3);
    const after = economyTick(held, 1, RNG);
    expect(transitBerthsOccupied(after)).toBe(TRANSIT_BERTH_BASE);
    // The third is still there, still waiting: held, never dropped.
    expect(captainsAwaitingBerth(after).length).toBe(1);
    expect(after.captains.every((c) => c.mission !== null)).toBe(true);
  });

  it("the held ship docks once a berth frees, so the wait is a DELAY and not a loss", () => {
    // The end-to-end softlock disproof: run long enough for the first two to unload and the
    // third to claim a freed berth and finish too.
    const held = withHeldAtReturn(fleetOf(3), 3);
    const unloadTicks = MISSIONS[MISSION_KEY].unloadTicks;
    // ⚠️ STEPPED, NOT ONE BIG CALL, AND THE REASON IS WORTH KNOWING. economyTick takes its
    // shared budgets (fuel, credits, and now berths) as a PER-CALL SNAPSHOT, and it advances
    // each captain through its whole span before looking at the next one. So in a single huge
    // call, a berth freed by captain 1 partway through cannot be seen by captain 3, which was
    // already refused at the top of that same call. That asymmetry is PRE-EXISTING (fuel
    // behaves identically: fuelBudgetRemaining is snapshotted from state.fuel once per call)
    // and it does not affect the game, because the real offline path steps ONE WHOLE TICK at a
    // time through tick(). The parity block below asserts that actual invariant.
    let after = held;
    for (let i = 0; i < unloadTicks * 3 + 6; i++) after = economyTick(after, 1, RNG);
    // Nobody is left waiting: every ship got its berth eventually.
    expect(captainsAwaitingBerth(after)).toEqual([]);
  });

  it("changes NOTHING when fewer ships return than there are berths", () => {
    // The normal case for a small fleet, and the reason the base value matters: an existing
    // player's missions must not get slower on update day.
    const held = withHeldAtReturn(fleetOf(2), 2);
    const after = economyTick(held, 1, RNG);
    expect(captainsAwaitingBerth(after)).toEqual([]);
    expect(transitBerthsOccupied(after)).toBe(2);
  });

  it("buying a rung lets one more ship dock at once", () => {
    // Agency: the upgrade track IS the fix, which is why no bypass ships.
    const held = { ...withHeldAtReturn(fleetOf(3), 3), transitBerthCapacity: 1 };
    expect(transitBerthCount(held)).toBe(TRANSIT_BERTH_BASE + 1);
    const after = economyTick(held, 1, RNG);
    expect(transitBerthsOccupied(after)).toBe(3);
    expect(captainsAwaitingBerth(after)).toEqual([]);
  });
});

describe("offline-equals-live parity for the berth hold", () => {
  it("parity: one big call agrees with many single ticks when berths are CONTENDED", () => {
    // ⚠️ THE CASE THE HOLD COULD HAVE BROKEN. The break-on-refusal is what makes this hold: a
    // berth can only free through another captain's progress, which a single tickCaptainMission
    // call cannot observe, so no amount of remaining budget could change the answer.
    const span = MISSIONS[MISSION_KEY].unloadTicks * 3 + 6;
    const start = withHeldAtReturn(fleetOf(3), 3);
    // ⚠️ THE OFFLINE SIDE GOES THROUGH tick(), NOT THROUGH ONE BIG economyTick CALL, because
    // tick() is what a player actually hits after a closed laptop and it steps one whole tick at
    // a time. Comparing a single huge economyTick call instead would assert something the engine
    // has never guaranteed for CONTENDED shared resources: its budgets are per-call snapshots
    // and each captain advances its full span before the next is considered, which fuel has
    // done since long before berths existed. Asserting the stronger claim would be testing a
    // property the game does not rely on and does not have.
    // (tick takes deltaSeconds FIRST and state SECOND.)
    const offline = tick(span * start.tickDurationSeconds, start, RNG);
    let live = start;
    for (let i = 0; i < span; i++) live = economyTick(live, 1, RNG);
    expect(transitBerthsOccupied(offline)).toBe(transitBerthsOccupied(live));
    expect(captainsAwaitingBerth(offline)).toEqual(captainsAwaitingBerth(live));
    expect(offline.captains.map((c) => c.mission?.phase ?? null)).toEqual(
      live.captains.map((c) => c.mission?.phase ?? null),
    );
  });

  it("parity: an UNCONTENDED fleet is unaffected either way", () => {
    const span = MISSIONS[MISSION_KEY].unloadTicks + 4;
    const start = withHeldAtReturn(fleetOf(2), 2);
    const offline = tick(span * start.tickDurationSeconds, start, RNG);
    let live = start;
    for (let i = 0; i < span; i++) live = economyTick(live, 1, RNG);
    expect(offline.captains.map((c) => c.mission?.phase ?? null)).toEqual(
      live.captains.map((c) => c.mission?.phase ?? null),
    );
  });
});

describe("the upgrade track", () => {
  it("refuses at the ceiling, with a reason", () => {
    const maxed = { ...fleetOf(1), transitBerthCapacity: TRANSIT_BERTH_RUNGS.length };
    const check = canUpgradeTransitBerths(maxed);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("fully expanded");
  });

  it("refuses a second expansion while one is in flight", () => {
    const rich = fleetOf(1);
    const started = startTransitBerthExpansion(rich);
    expect(started.started).toBe(true);
    expect(canUpgradeTransitBerths(started.next).ok).toBe(false);
  });

  it("refuses without credits, and is a same-reference no-op on a failed gate", () => {
    const broke = { ...fleetOf(1), credits: new Decimal(0) };
    expect(canUpgradeTransitBerths(broke).ok).toBe(false);
    const out = startTransitBerthExpansion(broke);
    expect(out.started).toBe(false);
    expect(out.next).toBe(broke);
  });

  it("raises the LEVEL by one on completion, and the count follows", () => {
    const started = startTransitBerthExpansion(fleetOf(1));
    const rung = TRANSIT_BERTH_RUNGS[0];
    const done = economyTick(started.next, rung.durationTicks + 1, RNG);
    expect(done.transitBerthCapacity).toBe(1);
    expect(transitBerthCount(done)).toBe(TRANSIT_BERTH_BASE + 1);
  });

  it("parity: the expansion lands the identical level offline and live", () => {
    const rung = TRANSIT_BERTH_RUNGS[0];
    const span = rung.durationTicks + 1;
    const start = startTransitBerthExpansion(fleetOf(1)).next;
    const offline = tick(span * start.tickDurationSeconds, start, RNG);
    let live = start;
    for (let i = 0; i < span; i++) live = economyTick(live, 1, RNG);
    expect(offline.transitBerthCapacity).toBe(live.transitBerthCapacity);
  });

  it("a dispatched mission still reaches its berth after an expansion completes", () => {
    // A smoke test that the two systems compose: the track is not just a number that moves.
    const state = fleetOf(1);
    const out = dispatchCaptainOnMission(state, 1, MISSION_KEY);
    expect(out.success).toBe(true);
    expect(transitBerthsFree(out.next)).toBeGreaterThan(0);
  });
});

// ============================================================================
// THE PLAYER-FACING STATUS (Phase 4 Unit 4.1)
//
// ⚠️ ONE SOURCE, TWO SURFACES. missionPhaseStatus is what both the captain card and the Home
// In Progress row render, so these cases cover both at once. That is the point of the shared
// function: this release twice shipped a one-site fix while the same bug survived elsewhere.
// ============================================================================
describe("missionPhaseStatus: the held ship is NAMED, not silently slower", () => {
  it("names the wait and the queue position for a held captain", () => {
    // Three held captains, two base berths: the third is genuinely waiting.
    const held = withHeldAtReturn(fleetOf(3), 3);
    const after = economyTick(held, 1, RNG);
    const waiting = captainsAwaitingBerth(after);
    expect(waiting).toHaveLength(1);
    const captain = after.captains.find((c) => c.id === waiting[0])!;
    const status = missionPhaseStatus(after, captain);
    // ⚠️ "my missions got slower" with no explanation is the failure mode the user named by
    // name. The status must say WHAT is happening and WHERE in the queue.
    expect(status.toLowerCase()).toContain("waiting for a docking bay");
    expect(status).toMatch(/\d+(st|nd|rd|th) in line/);
  });

  it("reads EXACTLY as before for a captain that is not held", () => {
    // The regression guard for the whole phase: an uncontended fleet must render character for
    // character what it rendered before 0.13.4, on both surfaces.
    const docked = withUnloading(fleetOf(1), 1);
    expect(missionPhaseStatus(docked, docked.captains[0])).toBe(MISSION_PHASE_LABEL.unloading);
    const held = withHeldAtReturn(fleetOf(1), 1);
    // One captain, two berths: not contended, so it reads as an ordinary return leg.
    expect(missionPhaseStatus(held, held.captains[0])).toBe(MISSION_PHASE_LABEL.transitBack);
  });

  it("returns empty for an idle captain and for a PATROL, rather than mislabelling either", () => {
    // A patrol has its own phase vocabulary and never occupies a berth, so this function has
    // nothing to add and must not index the extraction label table with a patrol phase.
    const idle = fleetOf(1);
    expect(missionPhaseStatus(idle, idle.captains[0])).toBe("");
    const patrolling: GameState = {
      ...idle,
      captains: idle.captains.map((c) => ({
        ...c,
        mission: { kind: "patrol", patrolKey: "crimsonReaverSweep", phase: "engaging" } as never,
      })),
    };
    expect(missionPhaseStatus(patrolling, patrolling.captains[0])).toBe("");
  });

  it("uses correct English ordinals, including the teens", () => {
    // 11th, not 11st. Reachable once the captain roster grows past ten, which the roster
    // already advertises as coming.
    const held = withHeldAtReturn(fleetOf(13), 13);
    const after = economyTick(held, 1, RNG);
    const statuses = after.captains
      .filter((c) => captainsAwaitingBerth(after).includes(c.id))
      .map((c) => missionPhaseStatus(after, c));
    const joined = statuses.join(" | ");
    expect(joined).not.toContain("11st");
    expect(joined).not.toContain("12nd");
    expect(joined).not.toContain("13rd");
    expect(joined).toContain("11th");
  });
});
