// ============================================================================
// ship-repair.test.ts : Combat 0.13.0, Phase 11 (design S13)
//
// Locks the LOSS -> LIMP-HOME -> SHIPYARD-REPAIR -> RE-DISPATCH-GATE loop:
//   1. A patrol DEFEAT does not end instantly, the wreck enters the "limpingHome" phase
//      (captain stays busy) for 2x the return leg, and only THEN is the ship flagged
//      damaged + its repair-damage stamped.
//   2. A DAMAGED hull cannot be re-dispatched (patrol OR extraction) until repaired; the
//      escape valve is swapping the captain to a healthy hull.
//   3. Repair is a deterministic timed process (shipRepair) whose duration scales with the
//      damage taken; it auto-starts into a shared build/repair bay and, on completion, clears
//      the damage so the hull is dispatchable again. Repair grants NO XP.
//   4. Shared build/repair BAYS (Phase 11b): bays serve both build and repair from one pool;
//      damaged hulls repair CONCURRENTLY up to the free-bay count, the excess WAITS in
//      deterministic monotonic ship-id order, and the reservation keeps >= 1 bay always
//      repair-reachable so no damaged hull is ever permanently stranded (soft-lock invariant).
//
// DETERMINISM NOTE: offline==live holds because BOTH paths step economyTick ONE tick at a
// time (tick() offline, App.svelte live). The auto-start passes (processShipRepairs, like
// processFuelPipelines) run once per economyTick, so a big economyTick(_,N) call is NOT
// expected to equal N stepped calls for the auto-start timing (that is true of the fuel
// pipelines too). The limp COUNTDOWN itself lives in the closed-form mission loop, so it IS
// big==stepped (tested below), and the full loop's reproducibility is proven by stepping it
// twice and comparing.
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  SHIP_TYPES,
  PATROLS,
  REPAIR_BASE_TICKS,
  REPAIR_TICKS_PER_HULL,
  SHIPYARD_BAY_BASE,
  BUILD_CONCURRENCY_CAP,
  type GameState,
  type ShipInstance,
  type ShipTypeKey,
  type PatrolMissionState,
  type TimedProcess,
  type EquipmentInstance,
  seedStandardIssueForShip,
} from "./model";
import { foldedPlayerDefense } from "./combat/bridge"; // folded-hull-fallback consistency check
import {
  dispatchCaptainOnPatrol,
  dispatchCaptainOnMission,
  canDispatchPatrol,
  canDispatch,
  assignShipToCaptain,
  economyTick,
  processShipRepairs,
  shipRepairDurationTicks,
  shipyardBayCount,
  shipBuildSlotCount,
  resolveProcesses,
  installMissingCombatBaselines,
} from "./tick";

const PATROL_KEY = "crimsonReaverSweep";
const DEF = PATROLS[PATROL_KEY];
const ROUTE_LEN = DEF.transitOutTicks + DEF.rollWindowTicks + DEF.transitBackTicks; // 14
const LIMP_TICKS = 2 * DEF.transitBackTicks; // 6
const RNG = () => 0.5; // constant rng: a patrol/repair-only fleet makes no outcome-affecting draws

// A fresh state whose one starting captain (id 1) flies `typeKey`, patrol seed pinned, tank
// topped up so fuel never confounds the combat-state assertions (mirrors patrol-tick.test.ts).
function patrolState(typeKey: ShipTypeKey, seed: number): GameState {
  const base = freshState();
  // Combat 1.0 (Unit 1.3): seed the combat baseline the retype skipped so a fabricated combat hull
  // clears the new empty-required-slot dispatch blocker (economy hull -> no-op).
  return installMissingCombatBaselines({
    ...base,
    nextPatrolSeed: seed,
    fuel: new Decimal(100000),
    credits: new Decimal(100000),
    ships: base.ships.map((s) => (s.id === "ship-1" ? { ...s, typeKey } : s)),
  });
}

function dispatch(state: GameState, repeat: boolean): GameState {
  const r = dispatchCaptainOnPatrol(state, 1, PATROL_KEY, "balanced", repeat);
  expect(r.success).toBe(true);
  return r.next;
}

function patrolOf(state: GameState): PatrolMissionState | null {
  return state.captains[0].mission as PatrolMissionState | null;
}

function shipOf(state: GameState, id = "ship-1"): ShipInstance {
  const s = state.ships.find((x) => x.id === id);
  expect(s).toBeDefined();
  return s!;
}

function stepped(state: GameState, n: number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = economyTick(s, 1, RNG);
  return s;
}

// Dispatch a REPEAT patrol on a destroyer, then wound the carry-state to a guaranteed loss
// (sliver hull, no shield) so the NEXT wave it fights is a certain defeat (robust against any
// future S20 balance pass). Returns the state poised to lose its first wave.
function dispatchedIntoCertainLoss(seed = 3): GameState {
  const dispatched = dispatch(patrolState("destroyer", seed), true);
  const cap = dispatched.captains[0];
  const m = cap.mission as PatrolMissionState;
  return {
    ...dispatched,
    captains: [{ ...cap, mission: { ...m, playerHull: 5, playerShield: 0 } }],
  };
}

// ---------------------------------------------------------------------------
// 1. Limp-home: a defeat enters limpingHome, keeps the captain busy, flags the
//    ship only when the wreck reaches base (after 2x the return leg).
// ---------------------------------------------------------------------------
describe("limp-home (defeat does not end instantly)", () => {
  it("a real defeat enters limpingHome + seeds the countdown WITHOUT instantly flagging the ship", () => {
    // Step to EXACTLY the first scheduled wave (seed-derived, so deterministic): the wounded
    // hull loses it, so the patrol transitions into limpingHome this very tick. The ship is
    // NOT flagged yet (it flags only when the limp completes), the captain stays busy (a
    // defeat does not free them instantly), and the limp counter is seeded but not yet ticked.
    const wounded = dispatchedIntoCertainLoss();
    const firstWaveTick = patrolOf(wounded)!.waveTicks[0];
    const atLoss = stepped(wounded, firstWaveTick);
    const p = patrolOf(atLoss);
    expect(p).not.toBeNull();
    expect(p!.phase).toBe("limpingHome");
    expect(p!.limpTicksRemaining).toBe(LIMP_TICKS); // seeded at the defeat instant, not yet decremented
    expect(shipOf(atLoss).damaged).toBeUndefined();
  });

  it("the limp countdown flags the ship damaged + stamps repairDamage when it reaches base", () => {
    // Construct a mission ALREADY in limpingHome so the countdown timing is exact and does
    // not depend on which route tick the wave fired. limpDamage 300 (arbitrary, < full hull).
    const dispatched = dispatch(patrolState("destroyer", 3), true);
    const cap = dispatched.captains[0];
    const m = cap.mission as PatrolMissionState;
    const limping: GameState = {
      ...dispatched,
      captains: [
        {
          ...cap,
          mission: {
            ...m,
            phase: "limpingHome",
            progressTicks: 5, // mid-route; the limp keys off phase + counter, not this
            limpTicksRemaining: LIMP_TICKS,
            limpDamage: 300,
          },
        },
      ],
    };

    // One tick BEFORE arrival: still limping, ship not yet damaged.
    const almost = stepped(limping, LIMP_TICKS - 1);
    expect(patrolOf(almost)).not.toBeNull();
    expect(patrolOf(almost)!.phase).toBe("limpingHome");
    expect(shipOf(almost).damaged).toBeUndefined();

    // The arrival tick: mission ends (captain idles), ship flagged damaged with the carried
    // repair-damage, and NO relaunch (a defeat is terminal even on a repeat patrol).
    const arrived = stepped(limping, LIMP_TICKS);
    expect(patrolOf(arrived)).toBeNull();
    const ship = shipOf(arrived);
    expect(ship.damaged).toBe(true);
    expect(ship.repairDamage).toBe(300);
  });

  it("end-to-end: a certain defeat eventually flags the ship with ~full-hull damage", () => {
    // Step generously past the wave + the 6-tick limp. A destroyer loses its full hull on a
    // defeat (carry-state hull hits 0), so repairDamage is the hull's full integrity.
    const done = stepped(dispatchedIntoCertainLoss(), ROUTE_LEN + LIMP_TICKS + 4);
    expect(patrolOf(done)).toBeNull();
    const ship = shipOf(done);
    expect(ship.damaged).toBe(true);
    expect(ship.repairDamage).toBe(SHIP_TYPES.destroyer.hullIntegrity);
  });

  it("the limp COUNTDOWN is closed-form (big call == stepped) before the ship is flagged", () => {
    // A limpingHome mission with plenty of counter left; step 3 (< LIMP_TICKS) both ways so
    // neither path flags the ship (no repair auto-start diverges). The mission loop's limp
    // decrement must be identical big-call vs stepped, the closed-form property.
    const dispatched = dispatch(patrolState("destroyer", 3), false);
    const cap = dispatched.captains[0];
    const m = cap.mission as PatrolMissionState;
    const limping: GameState = {
      ...dispatched,
      captains: [
        { ...cap, mission: { ...m, phase: "limpingHome", progressTicks: 2, limpTicksRemaining: LIMP_TICKS, limpDamage: 100 } },
      ],
    };
    const big = economyTick(limping, 3, RNG);
    const small = stepped(limping, 3);
    expect(big.captains).toEqual(small.captains);
    expect(big.ships).toEqual(small.ships);
    expect(patrolOf(big)!.limpTicksRemaining).toBe(LIMP_TICKS - 3);
  });
});

// ---------------------------------------------------------------------------
// 2. A damaged hull blocks re-dispatch (patrol + extraction); swapping is allowed.
// ---------------------------------------------------------------------------
describe("damaged hull blocks re-dispatch", () => {
  // A fresh state whose destroyer (ship-1, captain 1) is DAMAGED and idle (no mission).
  function damagedIdle(): GameState {
    const base = patrolState("destroyer", 3);
    return {
      ...base,
      ships: base.ships.map((s) => (s.id === "ship-1" ? { ...s, damaged: true, repairDamage: 200 } : s)),
    };
  }

  it("canDispatchPatrol returns needsRepair for a damaged hull", () => {
    const r = canDispatchPatrol(damagedIdle(), 1, PATROL_KEY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("needsRepair");
  });

  it("canDispatch (extraction) also returns needsRepair for a damaged hull", () => {
    // localFuelRun is an always-unlocked ore run at a fresh save.
    const r = canDispatch(damagedIdle(), 1, "localFuelRun");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("needsRepair");
  });

  it("dispatchCaptainOnPatrol is a same-ref no-op with the needsRepair reason", () => {
    const state = damagedIdle();
    const r = dispatchCaptainOnPatrol(state, 1, PATROL_KEY, "balanced", false);
    expect(r.success).toBe(false);
    expect(r.reason).toBe("needsRepair");
    expect(r.next).toBe(state); // untouched
  });

  it("swapping the captain to a HEALTHY hull lets them dispatch again", () => {
    // Add a second, healthy, parked destroyer (ship-2) and reassign the captain to it.
    const base = damagedIdle();
    // Combat 1.0 (Unit 1.3): ship-2 is a healthy combat hull added inline. It needs BOTH its economy
    // Standard-Issue (seedStandardIssueForShip -> includes the reactorCore the new Unit 3 noReactor
    // block requires) AND its combat baseline (installMissingCombatBaselines), exactly as a real built
    // ship gets both, else the swapped-to hull would fail the dispatch gate on the missing reactor.
    const ship2Economy = seedStandardIssueForShip("ship-2", base.nextEquipmentId);
    const withSpare: GameState = installMissingCombatBaselines({
      ...base,
      ships: [...base.ships, { id: "ship-2", typeKey: "destroyer", assignedCaptainId: null }],
      equipment: [...base.equipment, ...ship2Economy.pieces],
      nextEquipmentId: ship2Economy.nextId,
    });
    const swapped = assignShipToCaptain(withSpare, 1, "ship-2");
    expect(swapped.success).toBe(true);
    // The healthy hull passes the gate (the damaged ship-1 is now parked, no longer flown).
    expect(canDispatchPatrol(swapped.next, 1, PATROL_KEY).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Repair as a timed process: duration formula, auto-start, completion, no XP.
// ---------------------------------------------------------------------------
describe("ship repair timed process", () => {
  // A fresh state with a damaged destroyer (repairDamage `dmg`), captain idle.
  function damagedShipState(dmg: number): GameState {
    const base = patrolState("destroyer", 3);
    return {
      ...base,
      ships: base.ships.map((s) => (s.id === "ship-1" ? { ...s, damaged: true, repairDamage: dmg } : s)),
    };
  }

  it("shipRepairDurationTicks scales with damage taken (deterministic formula)", () => {
    const ship: ShipInstance = { id: "ship-1", typeKey: "destroyer", assignedCaptainId: null, damaged: true, repairDamage: 100 };
    expect(shipRepairDurationTicks(ship)).toBe(REPAIR_BASE_TICKS + Math.ceil(100 * REPAIR_TICKS_PER_HULL));
    // A heavier-damaged hull repairs strictly longer.
    const heavier: ShipInstance = { ...ship, repairDamage: 400 };
    expect(shipRepairDurationTicks(heavier)).toBeGreaterThan(shipRepairDurationTicks(ship));
  });

  it("shipRepairDurationTicks falls back to full hull integrity when repairDamage is absent (no gear known)", () => {
    // Defensive: a `damaged` ship with no capture (a hand-edited/legacy save) is still repairable.
    // With NO installed gear passed (the pure ship-only overload), the fallback keeps the authored
    // hullIntegrity, byte-identical to before the folded-fallback fix.
    const ship: ShipInstance = { id: "ship-1", typeKey: "destroyer", assignedCaptainId: null, damaged: true };
    expect(shipRepairDurationTicks(ship)).toBe(
      REPAIR_BASE_TICKS + Math.ceil(SHIP_TYPES.destroyer.hullIntegrity * REPAIR_TICKS_PER_HULL),
    );
  });

  it("shipRepairDurationTicks fallback folds INSTALLED plating (upgraded hull -> longer repair)", () => {
    // fix (2026-08-27): repairDamage is captured from the FOLDED hull max (foldedPlayerDefense),
    // so its no-capture fallback must fold installed plating too when the gear is known (as
    // processShipRepairs now passes it). An UPGRADED hull-plating piece raises hullMax above the
    // authored hullIntegrity, so the fallback repair-time scales to the real, bigger hull.
    const plating: EquipmentInstance = {
      id: "big-plate-1",
      slotType: "hullPlating",
      rarity: "standard",
      ascension: "none",
      quality: 0,
      iLevel: 1,
      blueprintKey: null,
      implicitStats: {},
      rolledStats: { hullStrength: 300 }, // >> SI plating (100), so folded hullMax > hullIntegrity
      mass: 0,
      powerDraw: 0,
      durabilityMax: 100,
      durability: 100,
      fittedToShipId: "ship-1",
    };
    const ship: ShipInstance = { id: "ship-1", typeKey: "destroyer", assignedCaptainId: null, damaged: true }; // NO capture
    const foldedMax = foldedPlayerDefense(SHIP_TYPES.destroyer, [plating]).hullMax;
    expect(foldedMax).toBeGreaterThan(SHIP_TYPES.destroyer.hullIntegrity); // upgraded plating => bigger hull
    // The fallback sizes to the FOLDED max, not the smaller authored hullIntegrity.
    expect(shipRepairDurationTicks(ship, [plating])).toBe(
      REPAIR_BASE_TICKS + Math.ceil(foldedMax * REPAIR_TICKS_PER_HULL),
    );
    // Strictly longer than the unfolded (authored-hull) fallback the pure overload still gives.
    expect(shipRepairDurationTicks(ship, [plating])).toBeGreaterThan(shipRepairDurationTicks(ship));
  });

  it("processShipRepairs auto-starts ONE shipRepair job for a damaged hull, sized to the damage", () => {
    const state = damagedShipState(100);
    const after = processShipRepairs(state);
    const repairs = after.activeProcesses.filter((p) => p.kind === "shipRepair");
    expect(repairs.length).toBe(1);
    const job = repairs[0];
    expect(job.durationTicks).toBe(REPAIR_BASE_TICKS + Math.ceil(100 * REPAIR_TICKS_PER_HULL));
    expect(job.effect).toEqual({ type: "clearShipDamage", shipId: "ship-1" });
    // Idempotent: running the pass again does not double-start (the hull is already in a bay).
    expect(processShipRepairs(after).activeProcesses.filter((p) => p.kind === "shipRepair").length).toBe(1);
  });

  it("a completing shipRepair clears damaged + repairDamage (resolveProcesses)", () => {
    const state = damagedShipState(10);
    const job: TimedProcess = {
      id: "proc-1",
      kind: "shipRepair",
      remainingTicks: 1,
      durationTicks: 25,
      effect: { type: "clearShipDamage", shipId: "ship-1" },
    };
    const withJob: GameState = { ...state, activeProcesses: [job] };
    const resolved = resolveProcesses(withJob, 1); // completes the job
    const ship = shipOf(resolved.next);
    expect(ship.damaged).toBeUndefined();
    expect(ship.repairDamage).toBeUndefined();
    // Repair awards NEITHER FA nor crafting XP (a consequence, not an achievement).
    expect(resolved.fleetAdminXpDelta).toBe(0);
    expect(resolved.craftingXpDelta).toBe(0);
  });

  it("full loop via economyTick: a damaged hull auto-repairs and becomes dispatchable again", () => {
    // Small damage so the repair is short (fast test). duration = 20 + ceil(4*0.5) = 22 ticks.
    const dmg = 4;
    const duration = REPAIR_BASE_TICKS + Math.ceil(dmg * REPAIR_TICKS_PER_HULL);
    const state = damagedShipState(dmg);

    // Blocked while damaged.
    expect(canDispatchPatrol(state, 1, PATROL_KEY).ok).toBe(false);

    // One tick auto-starts the repair (it begins advancing the NEXT tick, like a fuel batch).
    const t1 = stepped(state, 1);
    expect(t1.activeProcesses.filter((p) => p.kind === "shipRepair").length).toBe(1);
    expect(shipOf(t1).damaged).toBe(true); // still damaged mid-repair

    // Step through the whole repair (+ the 1-tick start offset + slack).
    const done = stepped(state, duration + 3);
    const ship = shipOf(done);
    expect(ship.damaged).toBeUndefined();
    expect(ship.repairDamage).toBeUndefined();
    expect(done.activeProcesses.filter((p) => p.kind === "shipRepair").length).toBe(0);
    // Dispatchable again.
    expect(canDispatchPatrol(done, 1, PATROL_KEY).ok).toBe(true);
  });

  it("the full loop is REPRODUCIBLE (stepped twice == identical, the offline==live guarantee)", () => {
    const dmg = 4;
    const duration = REPAIR_BASE_TICKS + Math.ceil(dmg * REPAIR_TICKS_PER_HULL);
    const state = {
      ...patrolState("destroyer", 3),
      ships: patrolState("destroyer", 3).ships.map((s) =>
        s.id === "ship-1" ? { ...s, damaged: true, repairDamage: dmg } : s,
      ),
    };
    const a = stepped(state, duration + 3);
    const b = stepped(state, duration + 3);
    expect(a.ships).toEqual(b.ships);
    expect(a.activeProcesses).toEqual(b.activeProcesses);
  });
});

// ---------------------------------------------------------------------------
// 4. Shared build/repair BAYS (Combat 0.13.0, Phase 11b, design S13 item 4).
//    Bays serve BOTH build and repair from one pool: multiple hulls repair
//    CONCURRENTLY up to the free-bay count, the excess WAITS in monotonic ship-id
//    order and claims bays as they free, and the reservation keeps >= 1 bay always
//    repair-reachable so no damaged hull is ever permanently stranded.
// ---------------------------------------------------------------------------

// A state whose shipyard sits at `level` (0 unfounded .. 3 max), for bay-count scaling +
// reservation assertions. Only the facility level matters to shipyardBayCount, so a shallow
// override of the shipyard FacilityState is enough.
function withShipyardLevel(state: GameState, level: number): GameState {
  return { ...state, facilities: { ...state.facilities, shipyard: { level } } };
}

// A minimal in-flight shipBuild process to occupy a shared bay in reservation tests, without
// standing up a full build (materials/blueprint/credits). processShipRepairs only COUNTS
// `kind === "shipBuild"` against the shared pool, so this stub is sufficient + honest.
function buildProcess(remaining = 50): TimedProcess {
  return {
    id: "proc-build-stub",
    kind: "shipBuild",
    remainingTicks: remaining,
    durationTicks: remaining,
    effect: { type: "addShip", typeKey: "destroyer" },
  };
}

// N damaged destroyers as ship-1..ship-N (monotonic id order), each lightly damaged (small,
// equal repairDamage so durations match and the ONLY variable under test is bay contention).
function damagedFleet(n: number, repairDamage = 4): GameState {
  const base = patrolState("destroyer", 3);
  const ships: ShipInstance[] = [];
  for (let i = 1; i <= n; i++) {
    ships.push({ id: `ship-${i}`, typeKey: "destroyer", assignedCaptainId: null, damaged: true, repairDamage });
  }
  return { ...base, ships };
}

describe("shipyardBayCount (base + scaling)", () => {
  it("returns the base floor at every pre-upgrade level, including level 0 (unfounded)", () => {
    // The base is the soft-lock invariant FLOOR: it must hold even at level 0 so a damaged hull
    // is never stranded before the yard is founded. Founding (level 1) carries no build-speed
    // rung, so it adds no bay either -> still the base.
    const fresh = freshState();
    expect(shipyardBayCount(withShipyardLevel(fresh, 0))).toBe(SHIPYARD_BAY_BASE);
    expect(shipyardBayCount(withShipyardLevel(fresh, 1))).toBe(SHIPYARD_BAY_BASE);
  });

  it("adds +1 bay per reached build-speed upgrade rung (level 2 -> +1, level 3 -> +2)", () => {
    const fresh = freshState();
    expect(shipyardBayCount(withShipyardLevel(fresh, 2))).toBe(SHIPYARD_BAY_BASE + 1);
    expect(shipyardBayCount(withShipyardLevel(fresh, 3))).toBe(SHIPYARD_BAY_BASE + 2);
  });
});

describe("shipBuildSlotCount reservation (build cap held at 1, all-but-one bay)", () => {
  it("stays at BUILD_CONCURRENCY_CAP (1) at every shipyard level (multi-build deliberately off)", () => {
    const fresh = freshState();
    for (const level of [0, 1, 2, 3]) {
      expect(shipBuildSlotCount(withShipyardLevel(fresh, level))).toBe(BUILD_CONCURRENCY_CAP);
    }
  });

  it("never lets builds occupy the last bay: slot count <= bayCount - 1 at every level", () => {
    // The structural repair reservation: builds use all-but-one bay so >= 1 is always free for
    // repair. This is what enforces the soft-lock invariant on the BUILD side.
    const fresh = freshState();
    for (const level of [0, 1, 2, 3]) {
      const s = withShipyardLevel(fresh, level);
      expect(shipBuildSlotCount(s)).toBeLessThanOrEqual(shipyardBayCount(s) - 1);
    }
  });
});

describe("shared bays: concurrent repair up to free bays + deterministic queue overflow", () => {
  it("repairs run CONCURRENTLY up to the free-bay count (base 2 -> two at once)", () => {
    // Three damaged hulls, base 2 bays, no build running -> exactly 2 repair concurrently and
    // the 3rd (highest id) waits. Proves idle build capacity flexes into a second repair.
    const after = processShipRepairs(damagedFleet(3));
    const repairs = after.activeProcesses.filter((p) => p.kind === "shipRepair");
    expect(repairs.length).toBe(SHIPYARD_BAY_BASE); // 2 bays -> 2 concurrent repairs
    // The two LOWEST ids (ship-1, ship-2) claimed the bays; ship-3 waits (monotonic order).
    const repairing = repairs.map((p) => (p.effect.type === "clearShipDamage" ? p.effect.shipId : "")).sort();
    expect(repairing).toEqual(["ship-1", "ship-2"]);
  });

  it("the waiting hull claims a bay as one frees, and ALL end repaired", () => {
    // Four damaged hulls through 2 bays: two serial rounds. Step generously past both rounds.
    const done = stepped(damagedFleet(4, 4), (REPAIR_BASE_TICKS + 2) * 2 + 10);
    for (let i = 1; i <= 4; i++) expect(shipOf(done, `ship-${i}`).damaged).toBeUndefined();
    expect(done.activeProcesses.filter((p) => p.kind === "shipRepair").length).toBe(0);
  });
});

describe("repair-favored reservation (a build cannot starve repair)", () => {
  it("with a build occupying a bay, a repair STILL gets the reserved free bay", () => {
    // Base 2 bays, one build already running, two damaged hulls. free = 2 - 1 build - 0 repairs
    // = 1, so exactly ONE repair starts (the lowest id) and the other waits. The build consumed
    // a bay but could NOT take the last one repair needs: >= 1 repair always proceeds.
    const base = damagedFleet(2);
    const withBuild: GameState = { ...base, activeProcesses: [buildProcess()] };
    const after = processShipRepairs(withBuild);
    const repairs = after.activeProcesses.filter((p) => p.kind === "shipRepair");
    expect(repairs.length).toBe(1); // 2 bays - 1 build = 1 free -> exactly one repair
    expect(repairs[0].effect).toEqual({ type: "clearShipDamage", shipId: "ship-1" });
    // The build is untouched (still occupying its bay).
    expect(after.activeProcesses.filter((p) => p.kind === "shipBuild").length).toBe(1);
  });
});

describe("SOFT-LOCK INVARIANT: no reachable state strands a damaged hull", () => {
  // Sweep assorted adversarial states (min shipyard level, a build hogging a bay, many damaged
  // hulls) and assert EVERY damaged hull eventually clears. A permanent lock would show as a
  // still-damaged hull after generous stepping. This is the enforcement of the P11 warning.
  const scenarios: Array<{ name: string; state: GameState }> = [
    { name: "min level (0), 3 damaged", state: withShipyardLevel(damagedFleet(3), 0) },
    { name: "min level (0), 5 damaged", state: withShipyardLevel(damagedFleet(5), 0) },
    {
      name: "min level (0), build hogging a bay, 4 damaged",
      state: { ...withShipyardLevel(damagedFleet(4), 0), activeProcesses: [buildProcess(30)] },
    },
    { name: "max level (3), 6 damaged", state: withShipyardLevel(damagedFleet(6), 3) },
  ];

  for (const { name, state } of scenarios) {
    it(`clears every damaged hull: ${name}`, () => {
      const damagedCount = state.ships.filter((s) => s.damaged).length;
      // Worst case is fully serial through ONE reserved bay (the invariant's floor guarantee),
      // so bound the steps by damagedCount serial repairs plus slack. A stranded hull would
      // survive this bound still damaged.
      const done = stepped(state, damagedCount * (REPAIR_BASE_TICKS + 4) + 40);
      const stillDamaged = done.ships.filter((s) => s.damaged);
      expect(stillDamaged).toEqual([]); // zero stranded hulls
    });
  }
});

describe("determinism: same state + ticks => same repair schedule + queue order", () => {
  it("stepping the same damaged fleet twice yields identical repair progress + order", () => {
    const start = damagedFleet(5, 6);
    const runA = stepped(start, REPAIR_BASE_TICKS + 5);
    const runB = stepped(start, REPAIR_BASE_TICKS + 5);
    // Same set of in-flight repairs (same ship ids, same countdowns) => identical schedule.
    const schedule = (s: GameState) =>
      s.activeProcesses
        .filter((p) => p.kind === "shipRepair")
        .map((p) => `${p.effect.type === "clearShipDamage" ? p.effect.shipId : ""}:${p.remainingTicks}`)
        .sort();
    expect(schedule(runA)).toEqual(schedule(runB));
    // And the same damaged/healed partition of the fleet.
    const damagedIds = (s: GameState) => s.ships.filter((x) => x.damaged).map((x) => x.id).sort();
    expect(damagedIds(runA)).toEqual(damagedIds(runB));
  });
});
