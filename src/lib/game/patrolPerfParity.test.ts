// HOTFIX 0.13.11.4 (catch-up speed): the patrol speedups (tick.ts PATROL_PERF_SWITCH: a patrol cycle's setup computed
// once per cycle, the patrol gear view filtered once per equipment list; bridge.ts sumFamilyResist's keys built once)
// change only the work, never a result. Two proofs:
//   1. the BASE build: each pinned run's whole state, hashed, equals the hash the same fixture code gave at eaf1fb80
//      (PROD 0.13.11.3, before the speedup), so every speedup (the switch's and the resist keys) is checked against the
//      code that came before it;
//   2. the switch: the same span with the switch on (the game) and off (patrolPerfSwitch.fixture.ts), compared whole as
//      JSON, in production tick() 1 s steps, in one economyTick call and in 997 s chunks.
// The fleets:
//   fleet     : the 11-ship fleet with five Repeat combat patrols whose 4-day catch-up froze the page;
//   mixed     : the same fleet plus a Dispatch Once defeat (it limps home and is repaired) and an extraction run;
//   gear edit : ship-1's combat pieces replaced mid-cycle (same ids, doubled lines) after the setup was cached;
//   uninstall : ship-2's drone pod moved off the ship mid-cycle (a new equipment list).

import { describe, expect, it } from "vitest";
import type { EquipmentInstance, GameState, PatrolMissionState } from "./model";
import { PATROL_PERF_CASES, chunks, mixedFleet, oneCall, patrolFleet, steps, wholeStateHash } from "./patrolPerf.fixture";
import { withPatrolPerfOff } from "./patrolPerfSwitch.fixture";

// Long cases: the unoptimized side alone takes seconds.
const SLOW = 240_000;

// Captured at eaf1fb80 (PROD 0.13.11.3, before the speedup): `git archive eaf1fb80 src` exported to a temp folder, this
// branch's patrolPerf.fixture.ts copied in, each PATROL_PERF_CASES run hashed there (wholeStateHash). A pin that moves
// means a speedup changed a result: fix the speedup, never re-pin.
const BASE_HASHES: Record<string, string> = {
  "fleet 1 h steps": "c65c8e304cf8c926",
  "fleet 6 h one call": "f4292c6752cbb4df",
  "fleet 6 h chunks": "f4292c6752cbb4df",
  "mixed 6 h steps": "8747105c4ada16ce",
  "mixed 6 h one call": "0af31a4a1abaa62c",
  "mixed 6 h chunks": "fe66a36149a60aa5",
};

// The whole state as JSON; on a mismatch, the first place the two differ (a full diff would be megabytes).
function expectSameState(on: GameState, off: GameState, what: string): void {
  const a = JSON.stringify(on);
  const b = JSON.stringify(off);
  if (a === b) return;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  expect(`${what}: ...${a.slice(Math.max(0, i - 200), i + 200)}`).toBe(`${what}: ...${b.slice(Math.max(0, i - 200), i + 200)}`);
}

// `run` (a pure function of its fresh input) with the speedup on and off, compared whole; returns the on state.
function bothWays(what: string, run: () => GameState): GameState {
  const on = run();
  const off = withPatrolPerfOff(run);
  expectSameState(on, off, what);
  return on;
}

// A pinned case: on equals off whole, and on equals the base build (its pinned hash).
function pinned(what: keyof typeof BASE_HASHES): GameState {
  const on = bothWays(what, PATROL_PERF_CASES[what]);
  expect(wholeStateHash(on), `${what} vs eaf1fb80`).toBe(BASE_HASHES[what]);
  return on;
}

const patrolsOut = (s: GameState): number => s.captains.filter((c) => c.mission?.kind === "patrol").length;
const routesFlown = (s: GameState): number =>
  s.captains.reduce((n, c) => n + (c.mission?.kind === "patrol" ? ((c.mission as PatrolMissionState).routesCompletedThisRun ?? 0) : 0), 0);
const mission = (s: GameState, id: number): string => JSON.stringify(s.captains.find((c) => c.id === id)!.mission);

describe("catch-up speed: the cached patrol arm equals the uncached one and the base build, whole state", () => {
  it("every pinned case has a base hash", () => {
    expect(Object.keys(BASE_HASHES).sort()).toEqual(Object.keys(PATROL_PERF_CASES).sort());
  });

  it("the five-patrol fleet, one hour in production tick() 1 s steps", { timeout: SLOW }, () => {
    const s = pinned("fleet 1 h steps");
    // Not vacuous: every patrol is still out and has relaunched many times.
    expect(patrolsOut(s)).toBe(5);
    expect(routesFlown(s)).toBeGreaterThan(20);
  });

  it("the five-patrol fleet, six hours in one economyTick call and in 997 s chunks", { timeout: SLOW }, () => {
    pinned("fleet 6 h one call");
    pinned("fleet 6 h chunks");
  });

  it("a mixed fleet (a defeat that limps home and is repaired, an extraction run), every cut", { timeout: SLOW }, () => {
    const s = pinned("mixed 6 h steps");
    // Not vacuous: the defeated freighter limped home and its patrol ended in defeat; its repair finished.
    const defeated = s.captains.find((c) => c.id === 6)!;
    expect(defeated.mission).toBeNull();
    expect(defeated.lastStopReason).toBe("defeat");
    expect(s.ships.find((x) => x.id === "ship-6")!.damaged).toBeFalsy();
    expect(s.captains.find((c) => c.id === 7)!.mission?.kind).toBe("extraction");
    expect(patrolsOut(s)).toBe(5);
    pinned("mixed 6 h one call");
    pinned("mixed 6 h chunks");
  });

  it("a gear edit mid-cycle (same piece ids, new objects) after the setup was cached misses the cache", { timeout: SLOW }, () => {
    const s1 = steps(patrolFleet(), 120);
    // Warm the cache on s1's cycles (the switch is on here).
    steps(s1, 5);
    const doubled = (lines: Record<string, number>): Record<string, number> =>
      Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, v * 2]));
    const edited = (p: EquipmentInstance): EquipmentInstance => ({ ...p, implicitStats: doubled(p.implicitStats), rolledStats: doubled(p.rolledStats) });
    const EDITED = new Set(["weapon", "hullPlating", "shieldEmitters", "ftlDrive"]);
    const s1e: GameState = {
      ...s1,
      equipment: s1.equipment.map((p) => (p.fittedToShipId === "ship-1" && EDITED.has(p.slotType) ? edited(p) : p)),
    };
    // The optimized arm (its cache warm on s1's records) equals the unoptimized one on the edited state.
    const on = steps(s1e, 900);
    const off = withPatrolPerfOff(() => steps(s1e, 900));
    expectSameState(on, off, "gear edit 900 s");
    // Not vacuous: the edit changes ship-1's patrol.
    expect(mission(off, 1)).not.toBe(mission(withPatrolPerfOff(() => steps(s1, 900)), 1));
  });

  it("an uninstall mid-cycle (a new equipment list without the piece) misses the gear view and the setup", { timeout: SLOW }, () => {
    const s1 = steps(patrolFleet(), 120);
    steps(s1, 5);
    const pod = s1.equipment.find((p) => p.fittedToShipId === "ship-2" && p.slotType === "droneBay");
    expect(pod).toBeDefined();
    const s1u: GameState = { ...s1, equipment: s1.equipment.map((p) => (p === pod ? { ...p, fittedToShipId: null } : p)) };
    const on = steps(s1u, 900);
    const off = withPatrolPerfOff(() => steps(s1u, 900));
    expectSameState(on, off, "uninstall 900 s");
    expect(mission(off, 2)).not.toBe(mission(withPatrolPerfOff(() => steps(s1, 900)), 2));
  });

  it("the same input state run twice with the cache warm gives the same result (no state leaks between runs)", { timeout: SLOW }, () => {
    const s0 = patrolFleet();
    const a = chunks(s0, 3 * 3600);
    const b = chunks(s0, 3 * 3600);
    expectSameState(a, b, "warm rerun");
    expectSameState(oneCall(s0, 1800), withPatrolPerfOff(() => oneCall(s0, 1800)), "warm one call");
    // The input was not touched.
    expect(wholeStateHash(s0)).toBe(wholeStateHash(patrolFleet()));
  });

  it("mixed fleet, one hour in 1 s steps, cache on equals off", { timeout: SLOW }, () => {
    bothWays("mixed 1 h steps", () => steps(mixedFleet(), 3600));
  });
});
