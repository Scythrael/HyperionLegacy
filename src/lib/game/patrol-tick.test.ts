// ============================================================================
// patrol-tick.test.ts : Combat 0.13.0, Phase 9b.5c
//
// Locks the PATROL TICK LOOP (tickCaptainPatrol, wired into economyTick's switch(kind)):
// advancing a dispatched patrol along its route, fighting a resolveBattle at each
// scheduled wave, carrying hull/shield/drones between waves (attrition), and resolving
// the patrol (success/relaunch, defeat, recall). NO rewards/XP here (Phase 10); NO UI
// (9b.5d). The FLAGSHIP test is the closed-form PARITY GATE: one big economyTick(state, N)
// must land a byte-identical result to N successive economyTick(state, 1) calls, the
// offline==live invariant the whole combat design rests on.
//
// Seeds used (discovered empirically, deterministic once pinned):
//   masterSeed 3 => a destroyer WINS a 3-wave route (waves at ticks [4,6,10]) with clear
//                   hull attrition (600 -> 505 -> 424 -> 77) and completes at route end.
//   A carry-state hull override (playerHull 5, playerShield 0) => a GUARANTEED defeat
//                   regardless of enemy tuning (robust against a future S20 balance pass).
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  freshCaptains,
  SHIP_TYPES,
  type GameState,
  type CaptainState,
  type ShipTypeKey,
  type PatrolMissionState,
  type CaptainMissionState,
} from "./model";
import {
  dispatchCaptainOnPatrol,
  dispatchCaptainOnMission,
  recallCaptain,
  economyTick,
  deriveWaveSeed,
  patrolPhaseFor,
} from "./tick";
import { PATROLS } from "./model";

const PATROL_KEY = "crimsonReaverSweep";
const DEF = PATROLS[PATROL_KEY];
const ROUTE_LEN = DEF.transitOutTicks + DEF.rollWindowTicks + DEF.transitBackTicks; // 14
// A constant rng so any incidental economyTick draw is identical across compared paths
// (a patrol-only fleet makes zero draws, but this removes Math.random from every test).
const RNG = () => 0.5;

// A fresh state whose one starting captain (id 1) flies `typeKey` and whose patrol master
// seed counter starts at `seed`, so the NEXT dispatch pins that master seed. Tank topped
// up so fuel never gates a relaunch (relaunch fuel is proven separately; here it must not
// confound the combat-state assertions).
function patrolState(typeKey: ShipTypeKey, seed: number): GameState {
  const base = freshState();
  return {
    ...base,
    nextPatrolSeed: seed,
    fuel: new Decimal(100000),
    credits: new Decimal(100000),
    ships: base.ships.map((s) => (s.id === "ship-1" ? { ...s, typeKey } : s)),
  };
}

function dispatch(state: GameState, repeat: boolean): GameState {
  const r = dispatchCaptainOnPatrol(state, 1, PATROL_KEY, "balanced", repeat);
  expect(r.success).toBe(true);
  return r.next;
}

function patrolOf(state: GameState): PatrolMissionState | null {
  return state.captains[0].mission as PatrolMissionState | null;
}

// Advance a state N ticks as ONE big call vs N single-tick calls (the parity comparison).
function big(state: GameState, n: number): GameState {
  return economyTick(state, n, RNG);
}
function stepped(state: GameState, n: number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = economyTick(s, 1, RNG);
  return s;
}

// ---------------------------------------------------------------------------
// THE PARITY GATE (offline == live).
// ---------------------------------------------------------------------------
describe("closed-form parity: one big call == many small calls (THE GATE)", () => {
  // Several master seeds spanning a WIN route (3) and a LOSS route (1: a wave of two
  // marauders beats a lone destroyer), each for Dispatch Once AND Dispatch Repeatedly.
  for (const seed of [1, 3, 5, 7, 11]) {
    for (const repeat of [false, true]) {
      it(`is byte-identical for masterSeed=${seed}, repeat=${repeat} (destroyer)`, () => {
        const dispatched = dispatch(patrolState("destroyer", seed), repeat);
        // N=40 > ROUTE_LEN so a repeat patrol relaunches multiple times (exercises the
        // relaunch seed-threading + carry-state reset under batching).
        const N = 40;
        const b = big(dispatched, N);
        const s = stepped(dispatched, N);

        // The WHOLE resulting state must match: mission carry-state, the ship damaged flag,
        // the relaunch seed counter, and the shared tank/credits (fuel spent on relaunches).
        expect(b.captains).toEqual(s.captains);
        expect(b.ships).toEqual(s.ships);
        expect(b.nextPatrolSeed).toBe(s.nextPatrolSeed);
        expect(b.fuel.toString()).toBe(s.fuel.toString());
        expect(b.credits.toString()).toBe(s.credits.toString());
      });
    }
  }

  it("is byte-identical for a carrier (drone carry-state) across a full route", () => {
    const dispatched = dispatch(patrolState("carrier", 1), true);
    const N = 40;
    const b = big(dispatched, N);
    const s = stepped(dispatched, N);
    expect(b.captains).toEqual(s.captains);
    expect(b.ships).toEqual(s.ships);
    expect(b.nextPatrolSeed).toBe(s.nextPatrolSeed);
  });

  it("also matches when driven as whole ticks + a fractional remainder (production cadence)", () => {
    // tick() drives economyTick as 1,1,...,1 then ONE fractional call. A fractional
    // sub-tick must bank into progressTicks and cross NO route boundary, so 14 whole ticks
    // == 14 whole ticks + one 0.5 sub-tick (the residue is carried, not a lost/extra wave).
    const dispatched = dispatch(patrolState("destroyer", 3), false);
    const whole = stepped(dispatched, 6); // 6 < ROUTE_LEN so the patrol is still mid-route
    const withFrac = economyTick(economyTick(dispatched, 5.5, RNG), 0.5, RNG); // 5.5 + 0.5 == 6.0
    expect(withFrac.captains).toEqual(whole.captains);
  });
});

// ---------------------------------------------------------------------------
// A patrol runs and resolves + attrition.
// ---------------------------------------------------------------------------
describe("a patrol runs, fights its waves, and resolves", () => {
  it("wins its waves with hull attrition, then ends in SUCCESS (mission null, ship intact)", () => {
    const dispatched = dispatch(patrolState("destroyer", 3), false); // Dispatch Once, winning route

    // Mid-route (past all 3 waves at ticks [4,6,10], before route end at 14): waves cleared
    // and the hull has ATTRITED below full (design S14). Shields are a partial pool (regenning).
    const mid = stepped(dispatched, 12);
    const m = patrolOf(mid)!;
    expect(m).not.toBeNull();
    expect(m.wavesWon).toBe(3);
    expect(m.wavesLost).toBe(0);
    expect(m.playerHull).toBeLessThan(SHIP_TYPES.destroyer.hullIntegrity); // attrition
    expect(m.playerHull).toBeGreaterThan(0); // still alive
    expect(m.nextWaveIndex).toBe(3); // all waves consumed

    // Run to route end: SUCCESS ends the patrol (mission null), ship NOT damaged (a win
    // never flags damaged), and Dispatch Once does NOT relaunch.
    const done = stepped(dispatched, ROUTE_LEN + 4);
    expect(patrolOf(done)).toBeNull();
    expect(done.ships[0].damaged).toBeUndefined();
  });

  it("carry-state (playerHull) monotonically decreases across successive waves", () => {
    const dispatched = dispatch(patrolState("destroyer", 3), false);
    const afterW1 = patrolOf(stepped(dispatched, 4))!.playerHull; // wave at tick 4
    const afterW2 = patrolOf(stepped(dispatched, 6))!.playerHull; // wave at tick 6
    const afterW3 = patrolOf(stepped(dispatched, 10))!.playerHull; // wave at tick 10
    expect(afterW1).toBeLessThan(SHIP_TYPES.destroyer.hullIntegrity);
    expect(afterW2).toBeLessThanOrEqual(afterW1);
    expect(afterW3).toBeLessThanOrEqual(afterW2); // hull only ever falls (no regen)
  });
});

// ---------------------------------------------------------------------------
// Determinism (same masterSeed => same outcome/carry-state).
// ---------------------------------------------------------------------------
describe("determinism", () => {
  it("same masterSeed reproduces the identical mid-route carry-state", () => {
    const a = stepped(dispatch(patrolState("destroyer", 3), false), 12);
    const b = stepped(dispatch(patrolState("destroyer", 3), false), 12);
    expect(patrolOf(a)).toEqual(patrolOf(b));
  });

  it("a different masterSeed yields a different wave schedule", () => {
    // Compare the schedules pinned AT DISPATCH (always present, seed-derived) rather than
    // mid-route state, which can already be null for a seed whose patrol ended early.
    const a = patrolOf(dispatch(patrolState("destroyer", 3), false))!;
    const b = patrolOf(dispatch(patrolState("destroyer", 4), false))!;
    expect(a.waveTicks).not.toEqual(b.waveTicks);
  });
});

// ---------------------------------------------------------------------------
// Defeat flags the ship damaged and ends the patrol (no auto-repeat).
// ---------------------------------------------------------------------------
describe("defeat handling", () => {
  it("a lost wave ends the patrol, flags ship.damaged, and does NOT relaunch (even on repeat)", () => {
    // Dispatch REPEATEDLY, then force a guaranteed loss by seeding the carry-state to a
    // sliver of hull with no shield. Proves a DEFEAT never auto-repeats despite repeat=true.
    const dispatched = dispatch(patrolState("destroyer", 3), true);
    const cap = dispatched.captains[0];
    const m = cap.mission as PatrolMissionState;
    const seedAtDispatch = dispatched.nextPatrolSeed;
    const wounded: GameState = {
      ...dispatched,
      captains: [{ ...cap, mission: { ...m, playerHull: 5, playerShield: 0 } }],
    };

    const done = stepped(wounded, ROUTE_LEN + 4);
    expect(patrolOf(done)).toBeNull(); // ended
    expect(done.ships[0].damaged).toBe(true); // flagged for the P11 repair seam
    // NO relaunch consumed a seed (a defeat is terminal), so the counter is unchanged.
    expect(done.nextPatrolSeed).toBe(seedAtDispatch);
  });
});

// ---------------------------------------------------------------------------
// Repeat-dispatch relaunches (new seed + reset carry-state); Dispatch Once ends.
// ---------------------------------------------------------------------------
describe("repeat-dispatch vs dispatch-once on SUCCESS", () => {
  it("Dispatch Repeatedly relaunches a fresh patrol with a new masterSeed + reset carry-state", () => {
    const dispatched = dispatch(patrolState("destroyer", 3), true);
    const originalSeed = patrolOf(dispatched)!.masterSeed;
    const seedCounterAtDispatch = dispatched.nextPatrolSeed;

    // Run just past ONE full route (14) so exactly one relaunch has fired.
    const after = stepped(dispatched, ROUTE_LEN + 2);
    const m = patrolOf(after);
    expect(m).not.toBeNull(); // still on patrol (relaunched, not idled)
    expect(m!.masterSeed).not.toBe(originalSeed); // a FRESH master seed
    expect(m!.masterSeed).toBe(seedCounterAtDispatch); // drawn from nextPatrolSeed
    expect(after.nextPatrolSeed).toBe(seedCounterAtDispatch + 1); // counter advanced once
    // Carry-state reset to a fresh cycle: full hull, waves zeroed, early in the route.
    expect(m!.playerHull).toBe(SHIP_TYPES.destroyer.hullIntegrity);
    expect(m!.wavesWon).toBe(0);
    expect(m!.wavesLost).toBe(0);
    expect(m!.progressTicks).toBeLessThan(ROUTE_LEN);
  });

  it("Dispatch Once ends (mission null) at route completion", () => {
    const dispatched = dispatch(patrolState("destroyer", 3), false);
    const after = stepped(dispatched, ROUTE_LEN + 2);
    expect(patrolOf(after)).toBeNull();
    expect(after.ships[0].damaged).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Recall ends the patrol without relaunch.
// ---------------------------------------------------------------------------
describe("recall", () => {
  it("a recalled (repeat) patrol finishes its route then ENDS, never relaunching", () => {
    const dispatched = dispatch(patrolState("destroyer", 3), true); // would normally relaunch
    const seedAtDispatch = dispatched.nextPatrolSeed;
    const recalled = recallCaptain(dispatched, 1);
    expect(recalled.success).toBe(true);

    const after = stepped(recalled.next, ROUTE_LEN + 4);
    expect(patrolOf(after)).toBeNull(); // ended at cycle end (recall honored), not relaunched
    expect(after.ships[0].damaged).toBeUndefined(); // a clean win, not a defeat
    expect(after.nextPatrolSeed).toBe(seedAtDispatch); // no relaunch => no seed consumed
  });
});

// ---------------------------------------------------------------------------
// Anti-regression: an extraction captain ticks identically with/without a patrol captain.
// ---------------------------------------------------------------------------
describe("anti-regression: extraction is unperturbed by a patrol captain", () => {
  function twoCaptainBase(): GameState {
    const base = freshState();
    const withHull: GameState = {
      ...base,
      fuel: new Decimal(100000),
      ships: base.ships.map((s) => (s.id === "ship-1" ? { ...s, typeKey: "destroyer" as ShipTypeKey } : s)),
    };
    const captain2: CaptainState = { ...freshCaptains(1)[0], id: 2, label: "Captain 2" };
    return {
      ...withHull,
      captains: [...withHull.captains, captain2],
      ships: [...withHull.ships, { id: "ship-2", typeKey: "generalFreighter", assignedCaptainId: 2 }],
      nextCaptainId: 3,
      nextShipId: 3,
    };
  }

  it("captain 2's extraction outcome is identical whether or not captain 1 flies a patrol", () => {
    // WITH a patrol captain 1 (fights waves over these 10 ticks) + extraction captain 2.
    const s1 = dispatchCaptainOnPatrol(twoCaptainBase(), 1, PATROL_KEY, "balanced", false).next;
    const s2 = dispatchCaptainOnMission(s1, 2, "shortOreRun").next;
    const withPatrol = economyTick(s2, 10, RNG);

    // CONTROL: same state but captain 1 stays IDLE (no patrol). Extraction must match.
    const control = dispatchCaptainOnMission(twoCaptainBase(), 2, "shortOreRun").next;
    const afterControl = economyTick(control, 10, RNG);

    const c2With = withPatrol.captains.find((c) => c.id === 2)!.mission as CaptainMissionState;
    const c2Ctrl = afterControl.captains.find((c) => c.id === 2)!.mission as CaptainMissionState;
    expect(c2With).toEqual(c2Ctrl); // byte-identical extraction mission state
    // Sanity: the extraction actually progressed (not a frozen no-op).
    expect(c2With.phase).not.toBe("ordersReceived");
  });
});

// ---------------------------------------------------------------------------
// Between-wave recovery: shields regen toward max; hull does not.
// ---------------------------------------------------------------------------
describe("between-wave recovery", () => {
  it("shields regen by shieldRecharge on a no-wave tick while hull stays flat", () => {
    // masterSeed 5 schedules waves at [5,7]; tick 6 is a no-wave tick between them.
    const dispatched = dispatch(patrolState("destroyer", 5), false);
    const afterWave = patrolOf(stepped(dispatched, 5))!; // just fought wave at tick 5
    const afterRegen = patrolOf(stepped(dispatched, 6))!; // one no-wave tick later
    // Shield climbed toward capacity by exactly the hull's per-tick recharge (capped).
    const expectedShield = Math.min(
      SHIP_TYPES.destroyer.shieldCapacity,
      afterWave.playerShield + SHIP_TYPES.destroyer.shieldRecharge,
    );
    expect(afterRegen.playerShield).toBe(expectedShield);
    expect(afterRegen.playerShield).toBeGreaterThan(afterWave.playerShield);
    // Hull does NOT regen between waves (design S14 attrition).
    expect(afterRegen.playerHull).toBe(afterWave.playerHull);
  });
});

// ---------------------------------------------------------------------------
// Drones: carrier carries + replenishes; non-carrier stays empty.
// ---------------------------------------------------------------------------
describe("drone carry-state", () => {
  it("a non-carrier (destroyer) keeps playerDrones empty throughout", () => {
    const dispatched = dispatch(patrolState("destroyer", 3), false);
    const mid = patrolOf(stepped(dispatched, 8));
    expect(mid!.playerDrones).toEqual([]);
  });

  it("a carrier carries its drone squadron across a fought wave", () => {
    const dispatched = dispatch(patrolState("carrier", 1), false);
    const before = patrolOf(dispatched)!;
    expect(before.playerDrones.length).toBe(1);
    expect(before.playerDrones[0].role).toBe("attack");
    // After advancing through at least the first wave, the squadron still rides on the
    // carry-state (not reset to a fresh empty screen each wave).
    const mid = patrolOf(stepped(dispatched, 8))!;
    expect(mid.playerDrones.length).toBe(1);
    expect(mid.playerDrones[0].role).toBe("attack");
  });

  it("a destroyed carrier drone REFABRICATES on a between-wave tick (replenishDrones runs)", () => {
    // Seed the carry-state with a DESTROYED drone, then advance one no-wave route tick and
    // assert its refab progress advanced (the between-wave replenish path fired).
    const dispatched = dispatch(patrolState("carrier", 1), false);
    const cap = dispatched.captains[0];
    const m = cap.mission as PatrolMissionState;
    const squad = m.playerDrones[0];
    const killedDrones = squad.drones.map((d, i) =>
      i === 0 ? { ...d, hp: 0, alive: false, status: "refabricating" as const, refabProgress: 0 } : d,
    );
    const seeded: GameState = {
      ...dispatched,
      captains: [
        { ...cap, mission: { ...m, playerDrones: [{ ...squad, drones: killedDrones }] } },
      ],
    };
    // Tick 1 is a transitOut (no-wave) tick, so between-wave recovery runs.
    const after = patrolOf(economyTick(seeded, 1, RNG))!;
    const droneAfter = after.playerDrones[0].drones[0];
    // Either it advanced its refab progress or (if the rate >= 100) came back online; both
    // prove replenishDrones ran on the carry-state.
    const recovered = droneAfter.refabProgress > 0 || droneAfter.alive === true;
    expect(recovered).toBe(true);
    // The input state was NOT mutated (purity): its drone is still fully destroyed at 0.
    expect((seeded.captains[0].mission as PatrolMissionState).playerDrones[0].drones[0].refabProgress).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pure helpers (deriveWaveSeed / patrolPhaseFor).
// ---------------------------------------------------------------------------
describe("pure helpers", () => {
  it("deriveWaveSeed is a pure uint32 function, distinct per (waveIndex, salt)", () => {
    const s0 = deriveWaveSeed(42, 0, 0x1b873593);
    const s1 = deriveWaveSeed(42, 1, 0x1b873593);
    const sBattle = deriveWaveSeed(42, 0, 0xcc9e2d51);
    expect(deriveWaveSeed(42, 0, 0x1b873593)).toBe(s0); // pure / reproducible
    expect(s1).not.toBe(s0); // adjacent waves decorrelate
    expect(sBattle).not.toBe(s0); // enemy salt vs battle salt decorrelate
    expect(Number.isInteger(s0)).toBe(true);
    expect(s0).toBeGreaterThanOrEqual(0);
    expect(s0).toBeLessThanOrEqual(0xffffffff); // uint32
  });

  it("patrolPhaseFor derives the coarse phase from route position", () => {
    // transitOut [0,3) -> engaging [3,11) -> transitBack [11,14) for the sweep def.
    expect(patrolPhaseFor(DEF, 0)).toBe("transitOut");
    expect(patrolPhaseFor(DEF, 2.9)).toBe("transitOut");
    expect(patrolPhaseFor(DEF, DEF.transitOutTicks)).toBe("engaging");
    expect(patrolPhaseFor(DEF, DEF.transitOutTicks + DEF.rollWindowTicks - 1)).toBe("engaging");
    expect(patrolPhaseFor(DEF, DEF.transitOutTicks + DEF.rollWindowTicks)).toBe("transitBack");
  });
});
