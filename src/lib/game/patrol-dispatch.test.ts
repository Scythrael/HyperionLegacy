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
  type EquipmentInstance,
} from "./model";
import {
  canDispatchPatrol,
  dispatchCaptainOnPatrol,
  dispatchCaptainOnMission,
  recallCaptain,
  economyTick,
  patrolWaveParams,
  installMissingCombatBaselines,
} from "./tick";
import { planWaveSchedule } from "./combat/waveSchedule";
import { defaultDronesForHull, squadronFromPod } from "./combat/bridge";

const PATROL_KEY = "crimsonReaverSweep";

// A fresh state whose one starting captain (id 1) flies the given hull instead of the
// default General Freighter. Retypes ship-1 in place (its Standard-Issue equipment is
// stat-neutral, so the fold is unaffected). The tank starts full (freshState grant).
// Combat 1.0 (Unit 1.3): the retype skips the combat baseline a real build installs, so
// re-establish the never-empty combat invariant via installMissingCombatBaselines. Since
// "every hull is combat-capable", this now seeds the WEAK combat set for an economy hull too
// (no longer a no-op), so any retyped hull ends up dispatchable exactly like a real build/migration.
function stateWithHull(typeKey: ShipTypeKey): GameState {
  const base = freshState();
  return installMissingCombatBaselines({
    ...base,
    ships: base.ships.map((s) => (s.id === "ship-1" ? { ...s, typeKey } : s)),
  });
}

describe("canDispatchPatrol gates (Combat 0.13.0 §S14)", () => {
  it("allows an economy hull (freighter) now that every hull is combat-capable", () => {
    // "Every hull is combat-capable" (user decision): an economy hull carrying its weak Standard-
    // Issue combat set (stateWithHull seeds it via installMissingCombatBaselines) is DISPATCHABLE,
    // no longer blocked as a non-combat hull. Its inferiority to a warship is a BALANCE property
    // (the weak loadout -> low win bands, patrol-balance.test.ts owns that), not a dispatch gate.
    const state = stateWithHull("generalFreighter");
    expect(canDispatchPatrol(state, 1, PATROL_KEY)).toEqual({ ok: true });
  });

  it("still blocks a BARE economy hull (no combat gear installed) with the required-slot guard", () => {
    // A raw freshState() freighter is NOT combat-seeded (freshState seeds only the economy Standard-
    // Issue; the real new-game path wraps it with installMissingCombatBaselines, and a live save is
    // seeded by the migration). With its required combat slots empty it trips the SAME required-slot
    // guard a stripped combat hull would: noWeapon. This is the "a stripped hull cannot launch" floor.
    const state = freshState();
    expect(canDispatchPatrol(state, 1, PATROL_KEY)).toEqual({ ok: false, reason: "noWeapon" });
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

  // Combat 1.0 (Unit 1.3): the empty-required-slot dispatch blocker. A combat hull is born with the
  // Standard-Issue combat set (stateWithHull seeds it), so the ALLOW case is the default; stripping
  // a required slot (the only way to reach the block, once the install UI lands) surfaces its reason.
  it("allows a combat hull carrying all three required combat slots (the born-with-baseline default)", () => {
    // ship-1 is a destroyer seeded with weapon + shield emitter + hull plating -> dispatchable.
    expect(canDispatchPatrol(stateWithHull("destroyer"), 1, PATROL_KEY)).toEqual({ ok: true });
  });

  it("blocks with noWeapon when the weapon slot is stripped bare", () => {
    const base = stateWithHull("destroyer");
    // Uninstall (remove from the pool) the ship-1 weapon baseline, leaving the hardpoint empty.
    const state = { ...base, equipment: base.equipment.filter((e) => !(e.fittedToShipId === "ship-1" && e.slotType === "weapon")) };
    expect(canDispatchPatrol(state, 1, PATROL_KEY)).toEqual({ ok: false, reason: "noWeapon" });
  });

  it("blocks with noShieldEmitter when the shield emitter slot is stripped bare", () => {
    const base = stateWithHull("destroyer");
    const state = { ...base, equipment: base.equipment.filter((e) => !(e.fittedToShipId === "ship-1" && e.slotType === "shieldEmitters")) };
    expect(canDispatchPatrol(state, 1, PATROL_KEY)).toEqual({ ok: false, reason: "noShieldEmitter" });
  });

  it("blocks with noHullPlating when the hull plating slot is stripped bare", () => {
    const base = stateWithHull("destroyer");
    const state = { ...base, equipment: base.equipment.filter((e) => !(e.fittedToShipId === "ship-1" && e.slotType === "hullPlating")) };
    expect(canDispatchPatrol(state, 1, PATROL_KEY)).toEqual({ ok: false, reason: "noHullPlating" });
  });

  it("surfaces noWeapon FIRST when multiple required slots are stripped (gate order: weapon -> shield -> plating)", () => {
    const base = stateWithHull("destroyer");
    // Strip ALL three: the weapon reason surfaces first (cheapest-first gate order).
    const state = { ...base, equipment: base.equipment.filter((e) => !(e.fittedToShipId === "ship-1" && (e.slotType === "weapon" || e.slotType === "shieldEmitters" || e.slotType === "hullPlating"))) };
    expect(canDispatchPatrol(state, 1, PATROL_KEY)).toEqual({ ok: false, reason: "noWeapon" });
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
    const seedBefore = state.nextPatrolSeed; // the master seed this dispatch will draw (drone id prefix)
    const result = dispatchCaptainOnPatrol(state, 1, PATROL_KEY, "balanced", false);
    expect(result.success).toBe(true);
    const mission = result.next.captains[0].mission as PatrolMissionState;
    // Carrier default loadout fields exactly one Attack squadron (COMBAT_DEFAULT_LOADOUT).
    expect(mission.playerDrones.length).toBe(1);
    expect(mission.playerDrones[0].role).toBe("attack");
    expect(mission.playerHull).toBe(SHIP_TYPES.carrier.hullIntegrity);
    // Combat 1.0 (Unit 2.3b): a Standard-Issue carrier now seeds its carry-state from its INSTALLED
    // attack pod, which must be BYTE-IDENTICAL to the old hull-default seed (defaultDronesForHull), so
    // no patrol-outcome fixture moves. The id prefix is keyed to the drawn master seed.
    expect(mission.playerDrones).toEqual(defaultDronesForHull("carrier", `patrol-${seedBefore}-p`));
  });

  it("Unit 2.3b: a CRAFTED defense pod installed on a carrier reaches the patrol carry-state", () => {
    // Start from a Standard-Issue carrier (one fitted attack droneBay pod), then REPLACE that pod with a
    // crafted DEFENSE pod in the same bay: a bigger (quality 2) screen with a +droneHp affix. This is the
    // capability 2.3b unlocks: before, the dispatch seed came from defaultDronesForHull (always the hull's
    // ATTACK default), so a crafted pod never reached a real patrol; now the seed reads the installed pod.
    const base = stateWithHull("carrier");
    const attackPod = base.equipment.find(
      (e) => e.fittedToShipId === "ship-1" && e.slotType === "droneBay",
    )!;
    const craftedDefense: EquipmentInstance = {
      ...attackPod,
      droneRole: "defense",
      quality: 2,
      implicitStats: { ...attackPod.implicitStats },
      rolledStats: { ...attackPod.rolledStats, droneHp: 10 },
    };
    const state: GameState = {
      ...base,
      equipment: base.equipment.map((e) => (e.id === attackPod.id ? craftedDefense : e)),
    };

    const seedBefore = state.nextPatrolSeed;
    const result = dispatchCaptainOnPatrol(state, 1, PATROL_KEY, "balanced", false);
    expect(result.success).toBe(true);
    const mission = result.next.captains[0].mission as PatrolMissionState;

    // The patrol now carries a DEFENSE squadron (not the hull-default attack screen): the crafted pod
    // reached the field.
    expect(mission.playerDrones.length).toBe(1);
    expect(mission.playerDrones[0].role).toBe("defense");
    // And it is the EXACT reconstruction the combat bridge produces from that pod (one source of truth),
    // keyed to the patrol's master seed, so the live seed and the display replay stay byte-identical.
    expect(mission.playerDrones[0]).toEqual(
      squadronFromPod(craftedDefense, `patrol-${seedBefore}-p-defense0`),
    );
    // It is NOT the old default attack screen (proving the installed pod, not the hull default, drove it).
    expect(mission.playerDrones).not.toEqual(defaultDronesForHull("carrier", `patrol-${seedBefore}-p`));
  });

  it("a blocked dispatch is a same-ref no-op carrying the block reason", () => {
    // A raw freshState() freighter is combat-BARE (freshState seeds no combat gear), so dispatch is
    // blocked by the required-slot guard (noWeapon), not by a hull-capability gate anymore. The point
    // of THIS test is the same-ref no-op convention on ANY blocked dispatch, which still holds.
    const state = freshState();
    const result = dispatchCaptainOnPatrol(state, 1, PATROL_KEY, "balanced", false);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("noWeapon");
    expect(result.next).toBe(state); // exact same reference, nothing mutated
  });

  it("two distinct patrols draw DIFFERENT, monotonic master seeds", () => {
    // A captain becomes busy after one dispatch, so prove distinctness DIRECTLY with a
    // SECOND combat-hull captain: dispatch both and assert their seeds differ and the
    // counter advanced exactly twice (never reusing a seed).
    const base = stateWithHull("destroyer"); // captain 1 flies a destroyer
    const captain2: CaptainState = { ...freshCaptains(1)[0], id: 2, label: "Captain 2" };
    // Combat 1.0 (Unit 1.3): ship-2 is a SECOND combat hull added inline, so seed its combat
    // baseline too (installMissingCombatBaselines only touches the newly-added, still-bare ship-2).
    const state: GameState = installMissingCombatBaselines({
      ...base,
      captains: [...base.captains, captain2],
      ships: [...base.ships, { id: "ship-2", typeKey: "destroyer", assignedCaptainId: 2 }],
      nextCaptainId: 3,
      nextShipId: 3,
    });
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

  it("a captain on a patrol ticks without crashing and ADVANCES along its route (9b.5c)", () => {
    const dispatched = dispatchCaptainOnPatrol(stateWithHull("destroyer"), 1, PATROL_KEY, "balanced", false).next;
    const after = economyTick(dispatched, 1); // must not throw
    const mission = after.captains[0].mission as PatrolMissionState;
    expect(mission.kind).toBe("patrol");
    // 9b.5c REPLACED the 9b.5a no-op stub with the real loop: one tick advances the route by
    // one whole route tick (still in the initial transitOut leg, no wave yet at tick 1).
    expect(mission.progressTicks).toBe(1);
    expect(mission.phase).toBe("transitOut");
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

// ============================================================================
// EVERY HULL IS COMBAT-CAPABLE: economy hulls seed a WEAK combat set + are dispatchable.
//
// The user decision made concrete at the dispatch seam: each economy hull, once it carries
// its Standard-Issue combat set (a fresh build / a migrated save / the seeder here install
// it), holds a NON-EMPTY combat set (>= 1 weapon + a shield emitter + hull plating) so its
// three required combat slots are fillable, and canDispatchPatrol clears it for launch. The
// STRICT-INFERIORITY balance promise (its weak loadout -> low win bands) is a separate,
// machine-checked contract in patrol-balance.test.ts; here we only lock DISPATCHABILITY.
// ============================================================================
describe("EVERY HULL IS COMBAT-CAPABLE: economy hulls seed a weak combat set and dispatch", () => {
  const ECONOMY_HULLS: ShipTypeKey[] = [
    "generalFreighter",
    "prospectorHauler",
    "prospectorRunner",
    "prospectorMiner",
  ];

  for (const hull of ECONOMY_HULLS) {
    it(`${hull} seeds a non-empty combat set (weapon + shield + plating) and is dispatchable`, () => {
      const state = stateWithHull(hull);
      const fitted = state.equipment.filter((e) => e.fittedToShipId === "ship-1");
      // A NON-EMPTY combat set: at least one weapon, plus the shield emitter + hull plating that the
      // required-slot dispatch guard checks. (Economy hulls get NO drone bay: drones stay carrier-only.)
      expect(fitted.some((e) => e.slotType === "weapon")).toBe(true);
      expect(fitted.some((e) => e.slotType === "shieldEmitters")).toBe(true);
      expect(fitted.some((e) => e.slotType === "hullPlating")).toBe(true);
      expect(fitted.some((e) => e.slotType === "droneBay")).toBe(false);
      // Its three required combat slots filled + a full tank => canDispatchPatrol clears it.
      expect(canDispatchPatrol(state, 1, PATROL_KEY)).toEqual({ ok: true });
    });
  }
});
