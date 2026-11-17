// HOTFIX 0.13.11.4 PORTED TO 0.14.0: the asynchronous catch-up (catchUpRunner.ts over tick.ts beginTickJob /
// advanceTickJob, loopClock.ts beginPollCatchUp / finishPollCatchUp) lands on the very state 0.14.0's own tick() and
// runPollEconomy return, for 0.14.0 fleets: Repeat combat patrols, a Dispatch Once defeat, an extraction run, gear worn
// into a repair pause, an expedition in flight, a short-range run, and the crew transports a multi-hour span delivers.
// Each run is compared WHOLE (the state's JSON), after many asynchronous slices.

import { describe, expect, it } from "vitest";
import type { GameState, PatrolMissionState } from "./model";
import { advanceTickJob, beginTickJob, tick, tickJobDone } from "./tick";
import { beginPollCatchUp, finishPollCatchUp, planPoll, runPollEconomy, startLoopClock, type AdvancePlan } from "./loopClock";
import { CatchUpController } from "./catchUpRunner";
import { cp16ExpeditionDispatch, cp16ShortRangeStart } from "./cp16Goldens.fixture";
import { lcg, mixedFleet, withRepeatPatrol } from "./patrolPerf.fixture";
import { transportWindowIndex } from "./transports";

const SLOW = 300_000;
const HOUR = 3600;
const END_MS = 1_800_000_000_000;

function fakeClock(stepMs: number): () => number {
  let t = 0;
  return () => (t += stepMs);
}

async function settle(controller: CatchUpController): Promise<void> {
  for (let i = 0; i < 2_000_000 && controller.busy; i++) await Promise.resolve();
}

function expectSameState(a: GameState, b: GameState, what: string): void {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x === y) return;
  let i = 0;
  while (i < x.length && x[i] === y[i]) i++;
  expect(`${what}: ...${x.slice(Math.max(0, i - 200), i + 200)}`).toBe(`${what}: ...${y.slice(Math.max(0, i - 200), i + 200)}`);
}

// `seconds` of `s0` paid through the controller in many asynchronous slices (1 ms per clock read: a 14 ms slice makes
// about 14 economyTick calls). Returns the applied state and how many slices reported progress.
async function sliced(s0: GameState, seconds: number, seed: number): Promise<{ state: GameState; slices: number }> {
  let slices = 0;
  const controller = new CatchUpController({
    onView: (v) => {
      if (v !== null) slices++;
    },
    now: fakeClock(1),
    yieldToBrowser: () => Promise.resolve(),
  });
  let applied: GameState | null = null;
  const sync = controller.pay(beginTickJob(seconds, s0, lcg(seed), END_MS), "x", (done) => (applied = done.state));
  expect(sync).toBe(false);
  await settle(controller);
  expect(controller.busy).toBe(false);
  expect(applied).not.toBeNull();
  return { state: applied!, slices };
}

const shortRangeFleet = (): GameState => withRepeatPatrol(cp16ShortRangeStart(0));
const expeditionFleet = (): GameState => withRepeatPatrol(cp16ExpeditionDispatch("cand-2-0"));
const transportsDelivered = (from: GameState, to: GameState): number => to.lastTransportWindow - from.lastTransportWindow;

describe("0.14.0: the sliced catch-up job equals tick(), whole state", () => {
  it("the mixed fleet (Repeat patrols, a defeat, an extraction, gear worn into a repair pause), 3 hours", { timeout: SLOW }, async () => {
    const s0 = mixedFleet();
    const sync = tick(3 * HOUR, s0, lcg(0x31), END_MS);
    const run = await sliced(s0, 3 * HOUR, 0x31);
    expectSameState(run.state, sync, "mixed 3 h");
    // Not vacuous: many slices; the Repeat runs relaunched, ship-1 went through its repair pause, gear wore, the
    // defeat ended, and the crew transports of the span were delivered.
    expect(run.slices).toBeGreaterThan(500);
    const run1 = sync.captains.find((c) => c.id === 1)!.mission as PatrolMissionState;
    expect(run1.kind).toBe("patrol");
    expect(run1.repairPausesThisRun ?? 0).toBeGreaterThan(0);
    expect(sync.captains.filter((c) => c.mission?.kind === "patrol").length).toBeGreaterThanOrEqual(4);
    expect(sync.captains.find((c) => c.id === 6)!.lastStopReason).toBe("defeat");
    expect(sync.equipment.some((e) => e.fittedToShipId !== null && e.condition !== undefined)).toBe(true);
    expect(transportsDelivered(s0, sync)).toBeGreaterThanOrEqual(3);
  });

  it("a Repeat patrol beside a short-range run, 2 hours", { timeout: SLOW }, async () => {
    const s0 = shortRangeFleet();
    expect(s0.captains.some((c) => c.mission?.kind === "shortRange")).toBe(true);
    const sync = tick(2 * HOUR, s0, lcg(0x32), END_MS);
    const run = await sliced(s0, 2 * HOUR, 0x32);
    expectSameState(run.state, sync, "short-range 2 h");
    expect(run.slices).toBeGreaterThan(300);
    expect(transportsDelivered(s0, sync)).toBeGreaterThanOrEqual(3);
  });

  it("a Repeat patrol beside an expedition in flight, 2 hours", { timeout: SLOW }, async () => {
    const s0 = expeditionFleet();
    expect(JSON.stringify(s0)).not.toBe(JSON.stringify(tick(1, s0, lcg(1))));
    const sync = tick(2 * HOUR, s0, lcg(0x33), END_MS);
    const run = await sliced(s0, 2 * HOUR, 0x33);
    expectSameState(run.state, sync, "expedition 2 h");
    expect(run.slices).toBeGreaterThan(300);
    expect(transportsDelivered(s0, sync)).toBeGreaterThanOrEqual(3);
  });

  it("stopped and resumed at arbitrary cuts, with a fractional tail, it still equals tick()", { timeout: SLOW }, () => {
    const s0 = expeditionFleet();
    const job = beginTickJob(HOUR + 0.6, s0, lcg(0x34), END_MS);
    expect(job.callsTotal).toBe(HOUR + 1);
    for (const n of [1, 13, 997, 2, 1800, 1, 50_000]) advanceTickJob(job, n);
    expect(tickJobDone(job)).toBe(true);
    expectSameState(job.state, tick(HOUR + 0.6, s0, lcg(0x34), END_MS), "resumed");
  });
});

describe("0.14.0: a sliced poll catch-up equals runPollEconomy", () => {
  // App.svelte's 0.14.0 poll order: the economy is paid from the PRE-poll fleet clock (crew transports key on it), and
  // the poll's own clock lands after it, on both the synchronous and the asynchronous path.
  for (const [name, fleet] of [
    ["the mixed fleet", mixedFleet],
    ["a Repeat patrol beside a short-range run", shortRangeFleet],
    ["a Repeat patrol beside an expedition", expeditionFleet],
  ] as const) {
    it(`${name}, a two-hour hidden-tab gap`, { timeout: SLOW }, async () => {
      const s0 = fleet();
      const startMs = END_MS - 2 * HOUR * 1000;
      const { plan } = planPoll(startLoopClock(startMs), END_MS, s0.tickDurationSeconds, 1);
      expect(plan.kind === "advance" && plan.mode).toBe("catchUp");
      const p = plan as AdvancePlan;
      const liveClockSeconds = s0.gameTimeSeconds + p.realElapsedSeconds;
      const syncPoll = { ...runPollEconomy(s0, p, lcg(0x41), END_MS), gameTimeSeconds: liveClockSeconds };

      const controller = new CatchUpController({ onView: () => {}, now: fakeClock(1), yieldToBrowser: () => Promise.resolve() });
      let landed: GameState | null = null;
      const wentAsync = !controller.pay(beginPollCatchUp(s0, p, lcg(0x41), END_MS), "away", (done) => {
        landed = { ...finishPollCatchUp(s0, done), gameTimeSeconds: liveClockSeconds };
      });
      expect(wentAsync).toBe(true);
      await settle(controller);
      expectSameState(landed!, syncPoll, `${name} poll`);
      // The poll paid the gap's transports from the pre-poll clock, as offline tick() does.
      expect(transportWindowIndex(landed!.gameTimeSeconds)).toBeGreaterThan(transportWindowIndex(s0.gameTimeSeconds));
      expect(landed!.lastTransportWindow).toBeGreaterThan(s0.lastTransportWindow);
    });
  }
});
