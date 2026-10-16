import { describe, it, expect, vi, afterEach } from "vitest";
import Decimal from "break_infinity.js";
import {
  advanceCycle,
  barSecondsFor,
  planPoll,
  runPollEconomy,
  LIVE_STEP_MAX_CYCLES,
  type LoopClock,
} from "./loopClock";
import { tick, UNKNOWN_COMPLETION_TIME_MS } from "./tick";
import { freshState, type CaptainMissionState, type GameState } from "./model";

// ===========================================================================
// HOTFIX 0.13.10: the live loop lost time whenever its timer fired late.
//
// The old poll granted exactly ONE bar cycle per completion and then set the cycle start to
// `now`, discarding the overshoot. Browsers throttle background timers (1 Hz, then once a
// minute after five minutes hidden), devices sleep and mobile tabs freeze, so a hidden or
// asleep player lost most of their time, and even a visible tab lost a few percent to jitter.
// These tests pin the replacement: whole cycles are counted from real elapsed time and the
// leftover is carried forward, never thrown away.
// ===========================================================================

// A small seeded PRNG so every jittered schedule is reproducible run to run.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Callback times for a timer of `intervalMs` with uniform +/- `jitterMs` jitter over `spanMs`.
function jitteredSchedule(startMs: number, intervalMs: number, jitterMs: number, spanMs: number, seed: number): number[] {
  const rand = mulberry32(seed);
  const out: number[] = [];
  let t = startMs;
  for (;;) {
    t += intervalMs + (rand() * 2 - 1) * jitterMs;
    if (t > startMs + spanMs) break;
    out.push(t);
  }
  return out;
}

// The OLD gate, reproduced so each schedule can prove it actually lost time: one cycle per
// completion, and the start snaps to `now`, dropping the overshoot.
function oldGate(startMs: number, nowMs: number, barMs: number): { cycles: number; newStartMs: number } {
  return nowMs - startMs >= barMs ? { cycles: 1, newStartMs: nowMs } : { cycles: 0, newStartMs: startMs };
}

function totalCycles(
  gate: (s: number, n: number, b: number) => { cycles: number; newStartMs: number },
  startMs: number,
  times: number[],
  barMs: number
): number {
  let start = startMs;
  let total = 0;
  for (const now of times) {
    const r = gate(start, now, barMs);
    total += r.cycles;
    start = r.newStartMs;
  }
  return total;
}

const T0 = 1_700_000_000_000;
const BAR_MS = 1000;

describe("advanceCycle: whole cycles from real time, leftover carried forward", () => {
  it("counts whole cycles and carries the remainder into the next start", () => {
    expect(advanceCycle(T0, T0 + 999, BAR_MS)).toEqual({ cycles: 0, newStartMs: T0 });
    expect(advanceCycle(T0, T0 + 1000, BAR_MS)).toEqual({ cycles: 1, newStartMs: T0 + 1000 });
    expect(advanceCycle(T0, T0 + 2750, BAR_MS)).toEqual({ cycles: 2, newStartMs: T0 + 2000 });
  });

  it("a clock that moved backwards rebases to now instead of stalling", () => {
    expect(advanceCycle(T0, T0 - 5000, BAR_MS)).toEqual({ cycles: 0, newStartMs: T0 - 5000 });
  });

  const schedules: { name: string; times: () => number[] }[] = [
    { name: "100 ms timer with +/-2 ms jitter for 600 s", times: () => jitteredSchedule(T0, 100, 2, 600_000, 1) },
    { name: "1000 ms timer with +/-2 ms jitter for 600 s", times: () => jitteredSchedule(T0, 1000, 2, 600_000, 2) },
    {
      name: "5 minutes at 1 Hz, then one callback per minute, for an hour",
      times: () => {
        const out: number[] = [];
        for (let t = 1000; t <= 300_000; t += 1000) out.push(T0 + t);
        for (let t = 360_000; t <= 3_600_000; t += 60_000) out.push(T0 + t);
        return out;
      },
    },
    { name: "a single 3600 s gap (sleep or frozen tab)", times: () => [T0 + 3_600_000] },
  ];

  for (const sch of schedules) {
    it(`${sch.name}: totals floor(wall / bar) within 1, where the old gate fell short`, () => {
      const times = sch.times();
      const wall = times[times.length - 1] - T0;
      const expected = Math.floor(wall / BAR_MS);
      const fixed = totalCycles(advanceCycle, T0, times, BAR_MS);
      const old = totalCycles(oldGate, T0, times, BAR_MS);
      expect(Math.abs(fixed - expected)).toBeLessThanOrEqual(1);
      // The old logic loses more than a cycle on every one of these schedules.
      expect(expected - old).toBeGreaterThan(1);
    });
  }
});

describe("barSecondsFor: the bar length rule is unchanged", () => {
  it("is the tick duration over the speed, floored at one real second", () => {
    expect(barSecondsFor(1, 1)).toBe(1);
    expect(barSecondsFor(3, 1)).toBe(3);
    expect(barSecondsFor(1, 10)).toBe(1);
    expect(barSecondsFor(20, 10)).toBe(2);
  });
});

function clockAt(ms: number): LoopClock {
  return { cycleStartMs: ms, lastPollMs: ms, paused: false };
}

describe("planPoll: steady, gap, pause and resume", () => {
  it("a steady 1 s cycle plans one live step of one tick", () => {
    const { clock, plan } = planPoll(clockAt(T0), T0 + 1050, 1, 1);
    expect(plan).toMatchObject({ kind: "advance", mode: "step", cycles: 1, ticksPerCycle: 1, realElapsedSeconds: 1.05 });
    expect(clock.cycleStartMs).toBe(T0 + 1000); // the 50 ms overshoot is kept
    expect(clock.lastPollMs).toBe(T0 + 1050);
  });

  it("no completed cycle plans nothing but still advances the poll clock", () => {
    const { clock, plan } = planPoll(clockAt(T0), T0 + 100, 1, 1);
    expect(plan).toMatchObject({ kind: "advance", mode: "none", cycles: 0 });
    expect(clock.cycleStartMs).toBe(T0);
    expect(clock.lastPollMs).toBe(T0 + 100);
  });

  it(`up to ${LIVE_STEP_MAX_CYCLES} cycles step live; more becomes a catch-up of the whole span`, () => {
    expect(planPoll(clockAt(T0), T0 + 2000, 1, 1).plan).toMatchObject({ mode: "step", cycles: 2 });
    const big = planPoll(clockAt(T0), T0 + 3_600_000, 1, 1).plan;
    expect(big).toMatchObject({ kind: "advance", mode: "catchUp", cycles: 3600, gameSeconds: 3600 });
  });

  it("respects the game speed exactly as before (bar floored at 1 s, more ticks per cycle)", () => {
    const { plan } = planPoll(clockAt(T0), T0 + 1000, 1, 10);
    expect(plan).toMatchObject({ mode: "step", cycles: 1, barSeconds: 1, ticksPerCycle: 10 });
    const gap = planPoll(clockAt(T0), T0 + 60_000, 1, 10).plan;
    expect(gap).toMatchObject({ mode: "catchUp", cycles: 60, gameSeconds: 600 });
  });

  it("pause freezes the clock and resume discards the paused gap", () => {
    const paused = planPoll(clockAt(T0), T0 + 500, 1, 0);
    expect(paused.plan.kind).toBe("paused");
    expect(paused.clock).toEqual({ cycleStartMs: T0, lastPollMs: T0 + 500, paused: true });

    // An hour later the player unpauses: nothing is granted for the paused hour.
    const resumed = planPoll(paused.clock, T0 + 3_600_000, 1, 1);
    expect(resumed.plan.kind).toBe("resumed");
    expect(resumed.clock).toEqual({ cycleStartMs: T0 + 3_600_000, lastPollMs: T0 + 3_600_000, paused: false });

    const next = planPoll(resumed.clock, T0 + 3_600_100, 1, 1);
    expect(next.plan).toMatchObject({ kind: "advance", mode: "none", cycles: 0 });
  });
});

describe("fake timers: a 100 ms interval driving planPoll", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("600 s of polling grants 600 cycles, and a sleep is caught up on the next poll", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    let clock = clockAt(Date.now());
    let cycles = 0;
    const plans: string[] = [];
    const handle = setInterval(() => {
      const r = planPoll(clock, Date.now(), 1, 1);
      clock = r.clock;
      if (r.plan.kind === "advance" && r.plan.mode !== "none") {
        cycles += r.plan.cycles;
        plans.push(r.plan.mode);
      }
    }, 100);
    vi.advanceTimersByTime(600_000);
    expect(cycles).toBe(600);
    expect(plans.every((m) => m === "step")).toBe(true);

    // The device sleeps for an hour: the wall clock jumps, no timer fires in between.
    vi.setSystemTime(Date.now() + 3_600_000);
    vi.advanceTimersByTime(100);
    expect(cycles).toBe(600 + 3600);
    expect(plans[plans.length - 1]).toBe("catchUp");
    clearInterval(handle);
  });
});

// ===========================================================================
// ECONOMY PARITY: live stepping, throttled polling and a sleep all land exactly where offline
// catch-up (tick) does for the same span. A constant rng keeps loot bit-identical.
// ===========================================================================

function missionState(): GameState {
  const s = freshState();
  const mission: CaptainMissionState = {
    kind: "extraction",
    missionKey: "shortOreRun",
    phase: "ordersReceived",
    phaseProgressTicks: 0,
    cargo: { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) },
    recalled: false,
  };
  s.captains[0].mission = mission;
  s.fuel = new Decimal(1_000_000);
  return s;
}

const ZERO_RNG = () => 0;

// Drive the live poll over a list of callback times, exactly as App.svelte does.
function driveLive(start: GameState, times: number[], speed = 1): GameState {
  let state = start;
  let clock = clockAt(T0);
  for (const now of times) {
    const r = planPoll(clock, now, state.tickDurationSeconds, speed);
    clock = r.clock;
    if (r.plan.kind === "advance" && r.plan.mode !== "none") {
      state = runPollEconomy(state, r.plan, ZERO_RNG, UNKNOWN_COMPLETION_TIME_MS);
    }
  }
  return state;
}

// gameTimeSeconds is the live loop's own display clock (advanced separately each poll), so
// parity is the full state apart from that one field.
function withoutClock(s: GameState): Omit<GameState, "gameTimeSeconds"> {
  const { gameTimeSeconds: _ignored, ...rest } = s;
  return rest;
}

describe("runPollEconomy: live play matches offline catch-up", () => {
  const offlineHour = () => tick(3600, missionState(), ZERO_RNG);

  it("live-style 100 ms polling for an hour yields the same economy as tick(3600)", () => {
    const times: number[] = [];
    for (let t = 100; t <= 3_600_000; t += 100) times.push(T0 + t);
    const live = driveLive(missionState(), times);
    expect(withoutClock(live)).toEqual(withoutClock(offlineHour()));
    expect(live.credits.gt(0)).toBe(true); // the span really produced something
  });

  it("a single 3600 s gap yields the same economy as tick(3600)", () => {
    const live = driveLive(missionState(), [T0 + 3_600_000]);
    expect(withoutClock(live)).toEqual(withoutClock(offlineHour()));
  });

  it("a throttled hidden hour (1 Hz, then once a minute) yields the same economy as tick(3600)", () => {
    const times: number[] = [];
    for (let t = 1000; t <= 300_000; t += 1000) times.push(T0 + t);
    for (let t = 360_000; t <= 3_600_000; t += 60_000) times.push(T0 + t);
    const live = driveLive(missionState(), times);
    expect(withoutClock(live)).toEqual(withoutClock(offlineHour()));
  });

  it("keeps the caller's gameTimeSeconds (the live loop owns that clock)", () => {
    const s = missionState();
    s.gameTimeSeconds = 42;
    const { plan } = planPoll(clockAt(T0), T0 + 3_600_000, 1, 1);
    if (plan.kind !== "advance") throw new Error("expected an advance plan");
    expect(runPollEconomy(s, plan, ZERO_RNG, UNKNOWN_COMPLETION_TIME_MS).gameTimeSeconds).toBe(42);
  });

  it("a catch-up honors the offline cap, exactly like a reload would", () => {
    const s = missionState();
    s.tickDurationSeconds = 86_400; // cap = 2 ticks, keeps this cheap
    const fiveDays = 5 * 86_400 * 1000;
    const { plan } = planPoll(clockAt(T0), T0 + fiveDays, s.tickDurationSeconds, 1);
    if (plan.kind !== "advance") throw new Error("expected an advance plan");
    expect(plan.mode).toBe("catchUp");
    const live = runPollEconomy(s, plan, ZERO_RNG, UNKNOWN_COMPLETION_TIME_MS);
    expect(withoutClock(live)).toEqual(withoutClock(tick(5 * 86_400, s, ZERO_RNG)));
    expect(live.captains[0].xp.equals(2)).toBe(true);
  });
});
