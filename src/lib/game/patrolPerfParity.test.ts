// PATROL CATCH-UP PERFORMANCE (0.14.0 release blocker): the patrol optimizations (tick.ts PATROL_PERF_SWITCH: the
// relaunch-only inputs read lazily, the FR-E projections as probes that keep no record and stop at their answer, a
// cycle's setup computed once per cycle) change only the work, never a result. Every case here runs the same span with
// the switch on (the game) and off (the unoptimized code, patrolPerfSwitch.fixture.ts) and compares the WHOLE state as
// JSON, in production tick() 1 s steps, in one economyTick call and in 997 s chunks:
//   fleet     : the 11-ship fleet with five Repeat combat patrols that made a 4-day catch-up take minutes;
//   mixed     : the same fleet plus a Dispatch Once defeat, an extraction mission, and the first patrol leaving worn
//               (a repair pause), with an Overtime step bought in the middle of the pause;
//   beside    : a Repeat patrol flown beside a short-range run, and beside an expedition.

import { describe, expect, it } from "vitest";
import type { GameState, PatrolMissionState } from "./model";
import { economyTick, tick } from "./tick";
import { buyGearRepairOvertime } from "./processSpeed";
import { pausedPatrolOf } from "./gearWearEngine";
import { cp16ExpeditionDispatch, cp16ShortRangeStart } from "./cp16Goldens.fixture";
import { lcg, patrolFleet, withRepeatPatrol } from "./patrolPerf.fixture";
import { withPatrolPerfOff } from "./patrolPerfSwitch.fixture";

const HOUR = 3600;
// Long cases: the unoptimized side alone takes seconds (that is the bug).
const SLOW = 180_000;

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

function steps(s0: GameState, seconds: number, seed = 0x15): GameState {
  return tick(seconds, s0, lcg(seed));
}
function oneCall(s0: GameState, seconds: number, seed = 0x15): GameState {
  return economyTick(s0, seconds, lcg(seed));
}
function chunks(s0: GameState, seconds: number, chunk = 997, seed = 0x15): GameState {
  const rng = lcg(seed);
  let s = s0;
  for (let left = seconds; left > 0; left -= chunk) s = economyTick(s, Math.min(chunk, left), rng);
  return s;
}

const patrolsOut = (s: GameState): number => s.captains.filter((c) => c.mission?.kind === "patrol").length;
const routesFlown = (s: GameState): number =>
  s.captains.reduce((n, c) => n + (c.mission?.kind === "patrol" ? ((c.mission as PatrolMissionState).routesCompletedThisRun ?? 0) : 0), 0);

describe("patrol catch-up performance: the optimized patrol arm equals the unoptimized one, whole state", () => {
  const fleet = patrolFleet();

  it("the five-patrol fleet, one hour in production tick() 1 s steps", { timeout: SLOW }, () => {
    const s = bothWays("fleet 1 h steps", () => steps(fleet, HOUR));
    // Not vacuous: every patrol is still out and has relaunched many times.
    expect(patrolsOut(s)).toBe(5);
    expect(routesFlown(s)).toBeGreaterThan(20);
  });

  it("the five-patrol fleet, six hours in one economyTick call and in 997 s chunks", { timeout: SLOW }, () => {
    bothWays("fleet 6 h one call", () => oneCall(fleet, 6 * HOUR));
    bothWays("fleet 6 h chunks", () => chunks(fleet, 6 * HOUR));
  });

  it("a mixed fleet (a defeat, an extraction, a repair pause with Overtime bought mid-pause), every cut", { timeout: SLOW }, () => {
    const mixed = patrolFleet({ defeat: true, extraction: true, wornShip1: 100 });
    // Ship-1 leaves worn, so its Repeat run starts with a repair pause.
    expect(pausedPatrolOf(mixed, "ship-1")).not.toBeNull();
    // 300 s into the pause an Overtime step is bought; then the span runs on.
    const withOvertime = (advance: (s: GameState, n: number) => GameState): GameState => {
      const mid = advance(mixed, 300);
      expect(pausedPatrolOf(mid, "ship-1")).not.toBeNull();
      const r = buyGearRepairOvertime(mid, "ship-1");
      expect(r.bought).toBe(true);
      return advance(r.next, HOUR - 300);
    };
    const s = bothWays("mixed 1 h steps", () => withOvertime((x, n) => steps(x, n)));
    // Not vacuous: the defeated freighter limped home (its patrol ended in defeat), the paused run went back out.
    expect(s.captains.find((c) => c.id === 6)!.mission).toBeNull();
    expect(s.captains.find((c) => c.id === 6)!.lastStopReason).toBe("defeat");
    const run1 = s.captains.find((c) => c.id === 1)!.mission as PatrolMissionState;
    expect(run1.kind).toBe("patrol");
    expect(run1.routesCompletedThisRun ?? 0).toBeGreaterThan(0);
    expect(run1.repairPausesThisRun ?? 0).toBeGreaterThan(0);
    expect(s.equipment.some((e) => e.fittedToShipId !== null && e.condition !== undefined)).toBe(true);
    bothWays("mixed 1 h one call", () => withOvertime((x, n) => oneCall(x, n)));
    bothWays("mixed 6 h chunks", () => chunks(mixed, 6 * HOUR));
  });

  it("a Repeat patrol beside a short-range run and beside an expedition", { timeout: SLOW }, () => {
    const shortRange = withRepeatPatrol(cp16ShortRangeStart(0));
    bothWays("short-range 30 min steps", () => steps(shortRange, HOUR / 2));
    bothWays("short-range 2 h chunks", () => chunks(shortRange, 2 * HOUR));
    const expedition = withRepeatPatrol(cp16ExpeditionDispatch("cand-2-0"));
    bothWays("expedition 30 min steps", () => steps(expedition, HOUR / 2));
    bothWays("expedition 2 h one call", () => oneCall(expedition, 2 * HOUR));
  });
});
