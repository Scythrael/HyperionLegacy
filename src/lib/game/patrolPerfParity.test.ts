// PATROL CATCH-UP PERFORMANCE (0.14.0 release blocker): the patrol optimizations (tick.ts PATROL_PERF_SWITCH: the
// relaunch-only inputs read lazily, the FR-E projections as probes that keep no record and stop at their answer, a
// cycle's setup computed once per cycle; resolveBattle.ts's allocation-free damage-source reads) change only the work,
// never a result. Two proofs:
//   1. the BASE build: each pinned run's whole state, hashed, equals the hash the same fixture code gave at c4c1d89c
//      (the commit before the optimizations), so every optimization (the switch's and the battle's) is checked against
//      the code that came before it;
//   2. the switch: the same span with the switch on (the game) and off (patrolPerfSwitch.fixture.ts), compared whole as
//      JSON, in production tick() 1 s steps, in one economyTick call and in 997 s chunks.
// The fleets:
//   fleet     : the 11-ship fleet with five Repeat combat patrols that made a 4-day catch-up take minutes;
//   mixed     : the same fleet plus a Dispatch Once defeat, an extraction mission, and the first patrol leaving worn
//               (a repair pause), with an Overtime step bought in the middle of the pause;
//   beside    : a Repeat patrol flown beside a short-range run, and beside an expedition;
//   gear edit : ship-1's combat pieces replaced mid-cycle (same ids, doubled lines) after the setup was cached.

import { describe, expect, it } from "vitest";
import type { EquipmentInstance, GameState, PatrolMissionState } from "./model";
import { pausedPatrolOf } from "./gearWearEngine";
import { cp16ExpeditionDispatch, cp16ShortRangeStart } from "./cp16Goldens.fixture";
import {
  PATROL_PERF_CASES,
  chunks,
  mixedFleet,
  oneCall,
  patrolFleet,
  steps,
  wholeStateHash,
  withRepeatPatrol,
} from "./patrolPerf.fixture";
import { withPatrolPerfOff } from "./patrolPerfSwitch.fixture";
import { fixRoundAnswersOffForThisFile } from "./fixRoundAnswersSwitch.fixture";

// Fix round answers Q6 (2026-11-17, "Price the actual pause": a repair pause's Overtime is priced by the repair the
// pause has left) moves this file's base hashes (the mixed fleet buys Overtime mid-pause, so its credits differ). They
// predate it, so the file runs with it off (fixRoundAnswersSwitch.fixture.ts). Q6's own pins: pauseOvertimePrice.test.ts.
fixRoundAnswersOffForThisFile("pauseOvertimeRemaining");

const HOUR = 3600;
// Long cases: the unoptimized side alone takes seconds (that is the bug).
const SLOW = 180_000;

// Captured at c4c1d89c (the base, before every optimization): `git archive c4c1d89c` exported to a temp folder, this
// branch's patrolPerf.fixture.ts copied in, each PATROL_PERF_CASES run hashed there (wholeStateHash) under the main
// checkout's vitest. A pin that moves means an optimization changed a result.
const BASE_HASHES: Record<string, string> = {
  "fleet 1 h steps": "a946f7283521fe54",
  "fleet 6 h one call": "5dbadb627f2998a2",
  "fleet 6 h chunks": "ef50ba71a6467285",
  "mixed 1 h steps": "03ce3263eb9f32c3",
  "mixed 1 h one call": "fb661db1dba9d6b5",
  "mixed 6 h one call": "2fb7fc01dc678c89",
  "mixed 6 h chunks": "b2cf304074b32e88",
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

// `run` (a pure function of its fresh input) with the optimizations on and off, compared whole; returns the on state.
function bothWays(what: string, run: () => GameState): GameState {
  const on = run();
  const off = withPatrolPerfOff(run);
  expectSameState(on, off, what);
  return on;
}

// A pinned case: on equals off whole, and on equals the base build (its pinned hash).
function pinned(what: keyof typeof BASE_HASHES): GameState {
  const on = bothWays(what, PATROL_PERF_CASES[what]);
  expect(wholeStateHash(on), `${what} vs c4c1d89c`).toBe(BASE_HASHES[what]);
  return on;
}

const patrolsOut = (s: GameState): number => s.captains.filter((c) => c.mission?.kind === "patrol").length;
const routesFlown = (s: GameState): number =>
  s.captains.reduce((n, c) => n + (c.mission?.kind === "patrol" ? ((c.mission as PatrolMissionState).routesCompletedThisRun ?? 0) : 0), 0);

describe("patrol catch-up performance: the optimized patrol arm equals the unoptimized one, whole state", () => {
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

  it("a mixed fleet (a defeat, an extraction, a repair pause with Overtime bought mid-pause), every cut", { timeout: SLOW }, () => {
    // Ship-1 leaves worn, so its Repeat run starts with a repair pause (300 s in, an Overtime step is bought).
    expect(pausedPatrolOf(mixedFleet(), "ship-1")).not.toBeNull();
    const s = pinned("mixed 1 h steps");
    // Not vacuous: the defeated freighter limped home (its patrol ended in defeat), the paused run went back out.
    expect(s.captains.find((c) => c.id === 6)!.mission).toBeNull();
    expect(s.captains.find((c) => c.id === 6)!.lastStopReason).toBe("defeat");
    const run1 = s.captains.find((c) => c.id === 1)!.mission as PatrolMissionState;
    expect(run1.kind).toBe("patrol");
    expect(run1.routesCompletedThisRun ?? 0).toBeGreaterThan(0);
    expect(run1.repairPausesThisRun ?? 0).toBeGreaterThan(0);
    expect(s.equipment.some((e) => e.fittedToShipId !== null && e.condition !== undefined)).toBe(true);
    pinned("mixed 1 h one call");
    pinned("mixed 6 h chunks");
    // Base only (the unoptimized side of a 6 h call adds nothing the cuts above do not check).
    expect(wholeStateHash(PATROL_PERF_CASES["mixed 6 h one call"]()), "mixed 6 h one call vs c4c1d89c").toBe(BASE_HASHES["mixed 6 h one call"]);
  });

  it("a Repeat patrol beside a short-range run and beside an expedition", { timeout: SLOW }, () => {
    const shortRange = withRepeatPatrol(cp16ShortRangeStart(0));
    bothWays("short-range 30 min steps", () => steps(shortRange, HOUR / 2));
    bothWays("short-range 2 h chunks", () => chunks(shortRange, 2 * HOUR));
    const expedition = withRepeatPatrol(cp16ExpeditionDispatch("cand-2-0"));
    bothWays("expedition 30 min steps", () => steps(expedition, HOUR / 2));
    bothWays("expedition 2 h one call", () => oneCall(expedition, 2 * HOUR));
  });

  it("a gear edit mid-cycle (same piece ids, new objects) after the setup was cached misses the cache", { timeout: SLOW }, () => {
    const s1 = steps(patrolFleet(), 120);
    // Warm the cache on s1's cycles (the switch is on here).
    steps(s1, 5);
    const doubled = (lines: Record<string, number>): Record<string, number> =>
      Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, v * 2]));
    const edited = (p: EquipmentInstance): EquipmentInstance => ({ ...p, implicitStats: doubled(p.implicitStats), rolledStats: doubled(p.rolledStats) });
    const EDITED = new Set(["weapon", "hullPlating", "shieldEmitters"]);
    const s1e: GameState = {
      ...s1,
      equipment: s1.equipment.map((p) => (p.fittedToShipId === "ship-1" && EDITED.has(p.slotType) ? edited(p) : p)),
    };
    expect([...new Set(s1e.equipment.filter((p, i) => p !== s1.equipment[i]).map((p) => p.slotType))].sort()).toEqual([...EDITED].sort());
    // The optimized arm (its cache warm on s1's records) equals the unoptimized one on the edited state.
    const on = steps(s1e, 900);
    const off = withPatrolPerfOff(() => steps(s1e, 900));
    expectSameState(on, off, "gear edit 900 s");
    // Not vacuous: the edit changes ship-1's patrol.
    const mission1 = (s: GameState) => JSON.stringify(s.captains.find((c) => c.id === 1)!.mission);
    expect(mission1(off)).not.toBe(mission1(withPatrolPerfOff(() => steps(s1, 900))));
  });
});
