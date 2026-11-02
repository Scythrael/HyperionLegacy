// loopClock.ts: the live game loop's clock, extracted out of App.svelte (HOTFIX 0.13.10).
//
// ⚠️ THE BUG THIS FIXES. The live poll is a 100 ms setInterval. It used to grant exactly ONE bar
// cycle whenever a cycle had completed, however much real time had passed, and then reset the
// cycle start to `now`, discarding the overshoot. Browsers throttle timers in background tabs
// (about 1 Hz, then once a minute after five minutes hidden), laptops sleep and mobile tabs
// freeze, so a hidden player lost roughly a third of ten minutes and nearly all of an hour, a
// one-hour sleep paid a single tick, and even a visible tab lost a few percent to timer jitter.
// The hidden tab also kept autosaving, which stamped the save as current, so the reload-time
// offline catch-up never recovered the lost time either.
//
// THE FIX, in three pure pieces App.svelte calls in order:
//   1. advanceCycle counts WHOLE cycles from real elapsed time and carries the leftover forward
//      (newStartMs = startMs + cycles * barMs). Nothing is ever thrown away.
//   2. planPoll wraps that with the pause rules and the speed rule, and decides HOW to pay the
//      cycles: a normal poll (a cycle or two) steps them live exactly as before, a large gap
//      becomes one offline-style catch-up through tick(), with its offline cap (4 days by default).
//   3. runPollEconomy executes that plan against the state.
//
// Kept free of the DOM and of Date.now() so every schedule (jitter, throttling, sleep, pause) is
// unit tested directly; see loopClock.test.ts.

import type { GameState } from "./model";
import { economyTick, offlineCapTicks, tick } from "./tick";

// A poll that owes at most this many cycles is paid by stepping them live, the steady path. At
// production speed one poll owes exactly one cycle, so the steady case is the old behavior
// unchanged. Anything larger is a gap (throttled tab, sleep, frozen tab) and is paid by tick(),
// the same catch-up a reload runs.
export const LIVE_STEP_MAX_CYCLES = 2;

// Whole bar cycles completed between `startMs` and `nowMs`, plus the next cycle's start with the
// leftover carried forward. A clock that moved backwards (the system time was changed) rebases
// to `nowMs` rather than stalling the game until the clock catches back up.
export function advanceCycle(startMs: number, nowMs: number, barMs: number): { cycles: number; newStartMs: number } {
  if (!(barMs > 0)) return { cycles: 0, newStartMs: startMs };
  if (nowMs < startMs) return { cycles: 0, newStartMs: nowMs };
  const cycles = Math.floor((nowMs - startMs) / barMs);
  return { cycles, newStartMs: startMs + cycles * barMs };
}

// Real seconds per bar cycle. Floored at one real second so fast dev speeds never make the bar
// flicker unreadably; several game ticks then batch into one visual cycle instead.
export function barSecondsFor(tickDurationSeconds: number, speed: number): number {
  return Math.max(1, tickDurationSeconds / speed);
}

// The loop's own bookkeeping between polls.
export interface LoopClock {
  cycleStartMs: number; // when the current bar cycle began (leftover from the last one included)
  lastPollMs: number; // the previous poll, for the continuous fleet clock (gameTimeSeconds)
  paused: boolean; // true while speed is 0
}

export type AdvancePlan = {
  kind: "advance";
  realElapsedSeconds: number; // real time since the previous poll, for the fleet clock
  mode: "none" | "step" | "catchUp";
  cycles: number; // whole bar cycles owed by this poll
  barSeconds: number;
  ticksPerCycle: number; // game ticks one bar cycle is worth at this speed
  gameSeconds: number; // cycles * barSeconds * speed, the span a catch-up hands to tick()
};

export type PollPlan = { kind: "paused" } | { kind: "resumed" } | AdvancePlan;

// Plan one poll. Pause semantics are the old ones exactly: while speed is 0 nothing advances and
// the poll clock is frozen; the first poll after a pause discards the whole paused gap (cycle and
// fleet clock both restart at `nowMs`) so unpausing never pays out unearned time.
export function planPoll(
  clock: LoopClock,
  nowMs: number,
  tickDurationSeconds: number,
  speed: number
): { clock: LoopClock; plan: PollPlan } {
  if (speed === 0) {
    return { clock: { ...clock, lastPollMs: nowMs, paused: true }, plan: { kind: "paused" } };
  }
  if (clock.paused) {
    return { clock: { cycleStartMs: nowMs, lastPollMs: nowMs, paused: false }, plan: { kind: "resumed" } };
  }

  const realElapsedSeconds = (nowMs - clock.lastPollMs) / 1000;
  const barSeconds = barSecondsFor(tickDurationSeconds, speed);
  const { cycles, newStartMs } = advanceCycle(clock.cycleStartMs, nowMs, barSeconds * 1000);
  const ticksPerCycle = (barSeconds * speed) / tickDurationSeconds;
  const mode = cycles <= 0 ? "none" : cycles <= LIVE_STEP_MAX_CYCLES ? "step" : "catchUp";
  return {
    clock: { cycleStartMs: newStartMs, lastPollMs: nowMs, paused: false },
    plan: {
      kind: "advance",
      realElapsedSeconds,
      mode,
      cycles,
      barSeconds,
      ticksPerCycle,
      gameSeconds: cycles * barSeconds * speed,
    },
  };
}

// Pay a planned poll into the economy. Returns the new state with the INPUT's gameTimeSeconds:
// the live loop advances that display clock continuously off real time on every poll, and both
// economyTick and tick() also bump it, so keeping theirs would double count it.
//
// "step": each owed cycle runs the per-tick stepping the live loop always ran (whole ticks of
// economyTick(state, 1), then any fractional remainder), so caps and refine refills are checked
// every tick exactly like offline catch-up. Every step is stamped with the one `nowMs`.
//
// "catchUp": a single tick(gameSeconds, ...) call, the very function the reload-time offline
// catch-up uses, so a long gap is paid identically to closing and reopening the game, offline
// cap included. `nowMs` anchors its reconstructed completion schedule.
export function runPollEconomy(state: GameState, plan: AdvancePlan, rng: () => number, nowMs: number): GameState {
  if (plan.mode === "none" || plan.cycles <= 0 || !(plan.ticksPerCycle > 0)) return state;

  let next = state;
  if (plan.mode === "catchUp") {
    next = tick(plan.gameSeconds, state, rng, nowMs);
  } else {
    const wholeSteps = Math.floor(plan.ticksPerCycle);
    const frac = plan.ticksPerCycle - wholeSteps;
    for (let c = 0; c < plan.cycles; c++) {
      for (let i = 0; i < wholeSteps; i++) {
        next = economyTick(next, 1, rng, nowMs);
      }
      if (frac > 0) {
        next = economyTick(next, frac, rng, nowMs);
      }
    }
  }
  return { ...next, gameTimeSeconds: state.gameTimeSeconds };
}

// The moment a save should stamp as last_saved_at: how far the economy is actually PAID. The
// reload-time offline catch-up pays (reopen - last_saved_at), so stamping the paid-through time
// instead of the write time means a hidden tab closed between throttled polls, or the leftover
// under one bar cycle, is paid on the next load rather than lost. Never ahead of now. While
// paused it is now: a paused span is never owed, exactly as before.
export function paidThroughMs(clock: LoopClock, nowMs: number): number {
  return clock.paused ? nowMs : Math.min(nowMs, clock.cycleStartMs);
}

// The span a return-from-away recap should cover. With no recap open it is just this absence.
// With one still open (the player never pressed Continue), the new recap must not replace it, so
// it starts from the OPEN recap's snapshot and spans everything since: the open recap's span, the
// live play between it being shown and this absence starting, and what this absence PAID. The
// before/after diff then sums both sets of gains.
//
// HOTFIX 0.13.11.3, TRUTHFUL LABELS: `paidSeconds` is what this absence actually paid (a capped or
// budget-cut catch-up pays less than the raw gap), never the raw gap, and the open recap is
// extended up to `awayStartMs`, not to now, so the raw gap is never added back in by the back
// door. `cappedAwaySeconds` is the full length of an absence that ran past the offline cap (null:
// the cap was not reached); an open recap's note survives an extension that did not hit the cap.
export interface AwayRecapSpan {
  before: GameState;
  secondsAway: number;
  cappedAwaySeconds: number | null;
}

export function awayRecapSpan(
  open: { before: GameState; secondsAway: number; shownAtMs: number; cappedAwaySeconds?: number | null } | null,
  before: GameState,
  paidSeconds: number,
  awayStartMs: number,
  cappedAwaySeconds: number | null = null
): AwayRecapSpan {
  if (open === null) return { before, secondsAway: paidSeconds, cappedAwaySeconds };
  return {
    before: open.before,
    secondsAway: open.secondsAway + Math.max(0, awayStartMs - open.shownAtMs) / 1000 + paidSeconds,
    cappedAwaySeconds: cappedAwaySeconds ?? open.cappedAwaySeconds ?? null,
  };
}

// 0.13.11.1 clock protection. A reload whose catch-up had part of its absence HELD (the device
// clock was ahead of what trustedTime.ts trusts) pays the rest later, once the clock is confirmed,
// as a live catch-up. The absence's offline cap still covers BOTH payments together: the release may
// pay at most budgetSeconds of game time (the cap minus what the reload already paid), so an honest
// player gets exactly what one uninterrupted reload would have paid, never a second cap. Pure.
//
// The game seconds one cycle is worth: barSeconds of real time at this poll's speed.
function gameSecondsPerCycle(plan: AdvancePlan): number {
  return plan.cycles > 0 ? plan.gameSeconds / plan.cycles : plan.barSeconds;
}

// Cut a catch-up down to at most budgetSeconds of game time (whole cycles).
export function clampCatchUp(plan: AdvancePlan, budgetSeconds: number): AdvancePlan {
  if (plan.mode !== "catchUp" || plan.cycles <= 0) return plan;
  const perCycle = gameSecondsPerCycle(plan);
  const cycles = Math.max(0, Math.min(plan.cycles, Math.floor(budgetSeconds / perCycle + 1e-9)));
  if (cycles === plan.cycles) return plan;
  return { ...plan, cycles, gameSeconds: perCycle * cycles, mode: cycles === 0 ? "none" : cycles <= LIVE_STEP_MAX_CYCLES ? "step" : "catchUp" };
}

// The armed release: what the held absence may still pay (game seconds) and how much was held
// (real seconds) at the last poll.
export interface HeldRelease {
  budgetSeconds: number;
  heldSeconds: number;
}

// One poll against an armed release. Only the part of this catch-up that the hold RELEASED (the
// drop in held time since the last poll) is limited by the budget; the rest of the poll, an honest
// background gap for instance, is paid in full. The budget falls by what the release was paid, and
// the release disarms (null) once nothing is held any more.
// `capped` (HOTFIX 0.13.11.3) is true when the budget cut the release, i.e. the absence ran past
// its offline cap, so the recap can say so.
export function releaseHeld(
  plan: AdvancePlan,
  arm: HeldRelease | null,
  heldNowSeconds: number
): { plan: AdvancePlan; arm: HeldRelease | null; capped: boolean } {
  if (arm === null) return { plan, arm, capped: false };
  const held = Math.max(0, heldNowSeconds);
  let next = plan;
  let budget = arm.budgetSeconds;
  let capped = false;
  if (plan.mode === "catchUp" && plan.cycles > 0) {
    const speed = plan.gameSeconds / (plan.cycles * plan.barSeconds);
    const planGame = plan.gameSeconds;
    const releasedGame = Math.min(planGame, Math.max(0, arm.heldSeconds - held) * speed);
    const releasedPaid = Math.min(releasedGame, Math.max(0, budget));
    next = clampCatchUp(plan, planGame - releasedGame + releasedPaid);
    budget -= releasedPaid;
    capped = releasedPaid < releasedGame;
  }
  return { plan: next, arm: held <= 0 ? null : { budgetSeconds: budget, heldSeconds: held }, capped };
}

// Game ticks a planned poll actually pays: a catch-up beyond the offline cap pays only the cap.
export function paidTicks(plan: AdvancePlan, state: GameState): number {
  const raw = plan.cycles * plan.ticksPerCycle;
  return plan.mode === "catchUp" ? Math.min(raw, offlineCapTicks(state)) : raw;
}

// HOTFIX 0.13.11.3: the REAL seconds a planned poll actually pays (what a recap may claim), from
// the paid ticks, so a catch-up past the offline cap or a release cut by its budget is labeled
// with what it paid, never with the raw gap. A step pays cycles x barSeconds exactly.
export function paidRealSeconds(plan: AdvancePlan, state: GameState): number {
  if (plan.mode === "none" || plan.cycles <= 0 || !(plan.ticksPerCycle > 0)) return 0;
  return (paidTicks(plan, state) / plan.ticksPerCycle) * plan.barSeconds;
}

// An absence of `awaySeconds` (paid plus held) that ran past the cap: its length for the recap's
// "cap reached" line, else null. A minute of slack keeps clock drift at the edge from raising it.
export const CAP_NOTE_SLACK_SECONDS = 60;
export function cappedAbsence(awaySeconds: number, capSeconds: number): number | null {
  return awaySeconds > capSeconds + CAP_NOTE_SLACK_SECONDS ? awaySeconds : null;
}

// HOTFIX 0.13.11.3: the running totals of a hidden-tab absence, one poll at a time. `paidSeconds`
// sums what every poll paid; `awaySeconds` sums the SAME polls' spans (a poll past the cap counts
// its full absence, any other poll what it paid), so the "You were away" figure covers exactly the
// span the paid figure covers and is never smaller. `cappedAwaySeconds` is that total once any
// poll ran past the cap, else null.
export interface AwayTally {
  paidSeconds: number;
  awaySeconds: number;
  cappedAwaySeconds: number | null;
}

export function tallyAwayPoll(tally: AwayTally, pollPaidSeconds: number, pollCappedAwaySeconds: number | null): AwayTally {
  const paidSeconds = tally.paidSeconds + pollPaidSeconds;
  const awaySeconds = tally.awaySeconds + Math.max(pollPaidSeconds, pollCappedAwaySeconds ?? 0);
  const capped = pollCappedAwaySeconds !== null || tally.cappedAwaySeconds !== null;
  return { paidSeconds, awaySeconds, cappedAwaySeconds: capped ? awaySeconds : null };
}

// True when a planned catch-up asks for more than the offline cap (tick() discards the excess).
export function exceedsOfflineCap(plan: AdvancePlan, state: GameState): boolean {
  return plan.mode === "catchUp" && plan.cycles * plan.ticksPerCycle > offlineCapTicks(state);
}

// The fuel-runway EMA blend, weighted. Live play takes one sample per bar cycle, so a poll that
// pays several cycles counts as that many samples of its average rate: blending once with
// 1 - (1 - alpha)^weight equals blending `weight` times with the same value. Weight 1 is the old
// single-sample blend exactly (special-cased so the steady path stays bit-identical). The first
// sample ever seeds the EMA directly.
export function blendRunwayEma(prev: number, inst: number, samplesSoFar: number, weight: number, alpha: number): number {
  if (samplesSoFar === 0) return inst;
  const a = weight === 1 ? alpha : 1 - Math.pow(1 - alpha, weight);
  return a * inst + (1 - a) * prev;
}

// A fresh loop clock starting at `paidThroughMs`. After a reload this must be the moment the
// offline catch-up paid THROUGH (its returnedAtMs), not the moment the loop happens to start: the
// catch-up itself takes real time to compute, and starting later would leave those seconds
// unpaid forever. Starting exactly there pays them once, on the first poll, and no earlier span
// is ever paid twice. With no save to catch up, it is simply now.
export function startLoopClock(paidThroughMs: number): LoopClock {
  return { cycleStartMs: paidThroughMs, lastPollMs: paidThroughMs, paused: false };
}
