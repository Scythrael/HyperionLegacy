// ============================================================================
// patrol-dispatch.test.ts : Combat 0.13.0, Phase 9b.5a
//
// Locks the PATROL dispatch foundation: the canDispatchPatrol gate, the
// dispatchCaptainOnPatrol action (state seeding + fuel spend + master-seed counter),
// recall on a patrol, and the economyTick kind-routing (a dispatched patrol is a no-op
// stub this unit and must NOT crash the economy tick or perturb extraction captains).
// No player-facing path dispatches a patrol yet (UI is 9b.5c), so these code-level tests
// are the only coverage of the seam until then.
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  freshCaptains,
  SHIP_TYPES,
  PATROLS,
  type GameState,
  type CaptainState,
  type PatrolMissionState,
  type ShipTypeKey,
} from "./model";
import {
  canDispatchPatrol,
  dispatchCaptainOnPatrol,
  dispatchCaptainOnMission,
  recallCaptain,
  economyTick,
  patrolWaveParams,
} from "./tick";
import { planWaveSchedule } from "./combat/waveSchedule";

const PATROL_KEY = "crimsonReaverSweep";

// A fresh state whose one starting captain (id 1) flies the given hull instead of the
// default General Freighter. Retypes ship-1 in place (its Standard-Issue equipment is
// stat-neutral, so the fold is unaffected). The tank starts full (freshState grant).
function stateWithHull(typeKey: ShipTypeKey): GameState {
  const base = freshState();
  return { ...base, ships: base.ships.map((s) => (s.id === "ship-1" ? { ...s, typeKey } : s)) };
}

describe("canDispatchPatrol gates (Combat 0.13.0 §S14)", () => {
  it("blocks a non-combat hull (freighter) with notCombatHull", () => {
    const state = freshState(); // default captain flies a General Freighter
    const gate = canDispatchPatrol(state, 1, PATROL_KEY);
    expect(gate).toEqual({ ok: false, reason: "notCombatHull" });
  });

  it("allows a combat hull (destroyer) with a full tank", () => {
    const state = stateWithHull("destroyer");
    expect(canDispatchPatrol(state, 1, PATROL_KEY)).toEqual({ ok: true });
  });

  it("blocks an unknown captain id with noCaptain", () => {
    const state = stateWithHull("destroyer");
    expect(canDispatchPatrol(state, 999, PATROL_KEY)).toEqual({ ok: false, reason: "noCaptain" });
  });

  it("blocks a captain already on an EXTRACTION mission with busy", () => {
    const state = stateWithHull("destroyer");
    // A destroyer can still be dispatched on an extraction mission for this precondition.
    const onMission = dispatchCaptainOnMission(state, 1, "shortOreRun");
    expect(onMission.success).toBe(true);
    expect(canDispatchPatrol(onMission.next, 1, PATROL_KEY)).toEqual({ ok: false, reason: "busy" });
  });

  it("blocks a captain already on a PATROL with busy", () => {
    const state = stateWithHull("destroyer");
    const onPatrol = dispatchCaptainOnPatrol(state, 1, PATROL_KEY, "balanced", false);
    expect(onPatrol.success).toBe(true);
    expect(canDispatchPatrol(onPatrol.next, 1, PATROL_KEY)).toEqual({ ok: false, reason: "busy" });
  });

  it("blocks a captain with no assigned ship with noShip", () => {
    const base = stateWithHull("destroyer");
    // Park ship-1 (assignedCaptainId null): captain 1 now flies nothing.
    const state = { ...base, ships: base.ships.map((s) => ({ ...s, assignedCaptainId: null })) };
    expect(canDispatchPatrol(state, 1, PATROL_KEY)).toEqual({ ok: false, reason: "noShip" });
  });

  it("blocks with fuelEmpty when the tank is short AND the shortfall is unaffordable", () => {
    const base = stateWithHull("destroyer");
    const state = { ...base, fuel: new Decimal(0), credits: new Decimal(0) };
    expect(canDispatchPatrol(state, 1, PATROL_KEY)).toEqual({ ok: false, reason: "fuelEmpty" });
  });
});

describe("dispatchCaptainOnPatrol action (Combat 0.13.0 §S14)", () => {
  it("seeds a correct PatrolMissionState, spends fuel, and increments nextPatrolSeed", () => {
    const state = stateWithHull("destroyer");
    const seedBefore = state.nextPatrolSeed;
    const fuelBefore = state.fuel;
    const result = dispatchCaptainOnPatrol(state, 1, PATROL_KEY, "aggressive", true);

    expect(result.success).toBe(true);
    const mission = result.next.captains[0].mission as PatrolMissionState;
    expect(mission.kind).toBe("patrol");
    expect(mission.patrolKey).toBe(PATROL_KEY);
    expect(mission.factionId).toBe(PATROLS[PATROL_KEY].factionId);
    expect(mission.stance).toBe("aggressive");
    expect(mission.masterSeed).toBe(seedBefore);
    expect(mission.phase).toBe("transitOut");
    expect(mission.progressTicks).toBe(0);
    expect(mission.nextWaveIndex).toBe(0);
    expect(mission.wavesWon).toBe(0);
    expect(mission.wavesLost).toBe(0);
    expect(mission.recalled).toBe(false);
    expect(mission.repeatDispatch).toBe(true);
    // Carry-state seeded to the hull's FULL combat pools; a destroyer fields no drones.
    expect(mission.playerHull).toBe(SHIP_TYPES.destroyer.hullIntegrity);
    expect(mission.playerShield).toBe(SHIP_TYPES.destroyer.shieldCapacity);
    expect(mission.playerDrones).toEqual([]);
    // The wave schedule is the deterministic plan for THIS master seed (wave-plan-now).
    expect(mission.waveTicks).toEqual(planWaveSchedule(seedBefore, patrolWaveParams(PATROLS[PATROL_KEY])));

    // Counter advanced (never reused); fuel drawn from the tank; no credits spent (tank covered it).
    expect(result.next.nextPatrolSeed).toBe(seedBefore + 1);
    expect(result.next.fuel.lt(fuelBefore)).toBe(true);
    expect(result.next.credits.equals(state.credits)).toBe(true);
  });

  it("seeds a carrier's default drone screen into the patrol carry-state", () => {
    const state = stateWithHull("carrier");
    const result = dispatchCaptainOnPatrol(state, 1, PATROL_KEY, "balanced", false);
    expect(result.success).toBe(true);
    const mission = result.next.captains[0].mission as PatrolMissionState;
    // Carrier default loadout fields exactly one Attack squadron (COMBAT_DEFAULT_LOADOUT).
    expect(mission.playerDrones.length).toBe(1);
    expect(mission.playerDrones[0].role).toBe("attack");
    expect(mission.playerHull).toBe(SHIP_TYPES.carrier.hullIntegrity);
  });

  it("a blocked dispatch is a same-ref no-op carrying the block reason", () => {
    const state = freshState(); // freighter -> notCombatHull
    const result = dispatchCaptainOnPatrol(state, 1, PATROL_KEY, "balanced", false);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("notCombatHull");
    expect(result.next).toBe(state); // exact same reference, nothing mutated
  });

  it("two distinct patrols draw DIFFERENT, monotonic master seeds", () => {
    // A captain becomes busy after one dispatch, so prove distinctness DIRECTLY with a
    // SECOND combat-hull captain: dispatch both and assert their seeds differ and the
    // counter advanced exactly twice (never reusing a seed).
    const base = stateWithHull("destroyer"); // captain 1 flies a destroyer
    const captain2: CaptainState = { ...freshCaptains(1)[0], id: 2, label: "Captain 2" };
    const state: GameState = {
      ...base,
      captains: [...base.captains, captain2],
      ships: [...base.ships, { id: "ship-2", typeKey: "destroyer", assignedCaptainId: 2 }],
      nextCaptainId: 3,
      nextShipId: 3,
    };
    const seedStart = state.nextPatrolSeed;

    const afterFirst = dispatchCaptainOnPatrol(state, 1, PATROL_KEY, "balanced", false).next;
    const afterSecond = dispatchCaptainOnPatrol(afterFirst, 2, PATROL_KEY, "balanced", false).next;

    const seed1 = (afterSecond.captains.find((c) => c.id === 1)!.mission as PatrolMissionState).masterSeed;
    const seed2 = (afterSecond.captains.find((c) => c.id === 2)!.mission as PatrolMissionState).masterSeed;

    expect(seed1).toBe(seedStart);       // first patrol took the starting seed
    expect(seed2).toBe(seedStart + 1);   // second took the next
    expect(seed1).not.toBe(seed2);       // DISTINCT, proven directly
    expect(afterSecond.nextPatrolSeed).toBe(seedStart + 2); // counter advanced twice, no reuse
  });
});

describe("recallCaptain on a patrol (Combat 0.13.0 §S14)", () => {
  it("flags recalled on the patrol arm without disturbing its other fields", () => {
    const state = stateWithHull("destroyer");
    const dispatched = dispatchCaptainOnPatrol(state, 1, PATROL_KEY, "standoff", false).next;
    const recalled = recallCaptain(dispatched, 1);
    expect(recalled.success).toBe(true);
    const mission = recalled.next.captains[0].mission as PatrolMissionState;
    expect(mission.kind).toBe("patrol");
    expect(mission.recalled).toBe(true);
    expect(mission.stance).toBe("standoff"); // untouched
    expect(mission.masterSeed).toBe((dispatched.captains[0].mission as PatrolMissionState).masterSeed);
  });
});

describe("economyTick kind routing (Combat 0.13.0 §S14)", () => {
  // A two-captain state: captain 1 flies a destroyer (for a patrol), captain 2 flies a
  // freighter (for an extraction run). Built by hand (freshState ships one captain).
  function twoCaptainState(): GameState {
    const base = stateWithHull("destroyer");
    const captain2: CaptainState = {
      ...freshCaptains(1)[0],
      id: 2,
      label: "Captain 2",
    };
    return {
      ...base,
      captains: [...base.captains, captain2],
      ships: [...base.ships, { id: "ship-2", typeKey: "generalFreighter", assignedCaptainId: 2 }],
      nextCaptainId: 3,
      nextShipId: 3,
    };
  }

  it("a captain on a patrol does NOT crash economyTick and stays on the patrol un-advanced", () => {
    const dispatched = dispatchCaptainOnPatrol(stateWithHull("destroyer"), 1, PATROL_KEY, "balanced", false).next;
    const after = economyTick(dispatched, 1); // must not throw
    const mission = after.captains[0].mission as PatrolMissionState;
    expect(mission.kind).toBe("patrol");
    // 9b.5a stub: the patrol does not advance (9b.5b fills the loop).
    expect(mission.progressTicks).toBe(0);
    expect(mission.nextWaveIndex).toBe(0);
  });

  it("an extraction captain ticks normally alongside a patrol captain, unperturbed by it", () => {
    const twoBoth = twoCaptainState();
    // Captain 1 -> patrol, captain 2 -> extraction.
    const s1 = dispatchCaptainOnPatrol(twoBoth, 1, PATROL_KEY, "balanced", false).next;
    const s2 = dispatchCaptainOnMission(s1, 2, "shortOreRun").next;
    const afterBoth = economyTick(s2, 3);

    // CONTROL: the SAME two-captain state but captain 1 stays IDLE (no patrol). Captain 2's
    // extraction outcome must be identical, proving the patrol captain's presence does not
    // perturb the extraction economy (the patrol is a no-op that spends nothing during a tick).
    const control = dispatchCaptainOnMission(twoCaptainState(), 2, "shortOreRun").next;
    const afterControl = economyTick(control, 3);

    const c2Both = afterBoth.captains.find((c) => c.id === 2)!.mission as import("./model").CaptainMissionState;
    const c2Ctrl = afterControl.captains.find((c) => c.id === 2)!.mission as import("./model").CaptainMissionState;
    expect(c2Both.kind).toBe("extraction");
    expect(c2Both.phase).toBe(c2Ctrl.phase);
    expect(c2Both.phaseProgressTicks).toBe(c2Ctrl.phaseProgressTicks);
    expect(c2Both.missionKey).toBe(c2Ctrl.missionKey);
    // And the extraction actually PROGRESSED (not a no-op): 3 ticks in, it has moved past
    // the 1-tick ordersReceived phase.
    expect(c2Both.phase).not.toBe("ordersReceived");
  });
});
