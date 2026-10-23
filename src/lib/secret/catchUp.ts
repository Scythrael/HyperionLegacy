// catchUp.ts: bringing the secret game up to "now" (0.13.11).
//
// ONE step function (engine.stepMut) for everything. Live play is simply advanceTo(Date.now())
// called about once a second, so a live second and a caught-up second are the same code.
//
// User decision (builder check Q2, "Exact short, fair long"):
//   - Gaps up to EXACT_BOUND_SECONDS (6 hours) run as whole 1-second steps, exactly as live play
//     does, so they match live bit for bit (catchUp.test.ts compares serialized states).
//   - Longer gaps run as coarse steps (at most MAX_COARSE_STEPS of them, never shorter than
//     MIN_COARSE_DT) and then a COARSE_TAIL_SECONDS tail of 1-second steps, so the generators and
//     Overclock re-settle at the end. After any automatic prestige inside a coarse step, the next
//     COARSE_TAIL_SECONDS run as 1-second steps too (the post-reset ramp is where big steps drift),
//     within POST_PRESTIGE_FINE_BUDGET. Coarse steps produce COARSE_GENEROSITY longer than the time
//     they book; the run clock, peaks and prestige checks stay on real time. catchUp.test.ts proves
//     a long gap never pays less than live, and never more than live would reach by staying open
//     longer (twice the gap up to 10 hours, half again the gap beyond).
//   - The step count is bounded, and the runtime runs a long catch-up as a time-sliced job (about
//     8 ms per slice), so even a 30-day absence never blocks the main game (measured in the tests).
// No offline cap (answer 6, "Always runs").
//
// lastTickAt advances by WHOLE seconds only; the fraction carries to the next call. A clock that
// behind the stamp pays nothing and keeps the stamp (0.13.11.1: never re-anchored, so a clock set
// back can never be paid twice; the shared trustedTime.ts clock never goes back in the first place).

import { stepMut } from "./engine";
import { cloneSecret, type SecretState } from "./state";
import { SERVER_TOLERANCE_MS } from "../trustedTime";

export const EXACT_BOUND_SECONDS = 6 * 3600;
export const MAX_COARSE_STEPS = 130000;
export const MIN_COARSE_DT = 2;
export const COARSE_TAIL_SECONDS = 120;
// Each coarse step produces this much longer than the time it books (4%). Coarse steps already track
// live closely; the margin is what turns "about the same" into "never less" (catchUp.test.ts).
export const COARSE_GENEROSITY = 0.04;
// After an automatic prestige inside a coarse step, the next COARSE_TAIL_SECONDS run as 1-second
// steps, up to this many such steps per catch-up (so the step count stays bounded).
export const POST_PRESTIGE_FINE_BUDGET = 40000;
export const MAX_CATCHUP_STEPS = Math.max(EXACT_BOUND_SECONDS, MAX_COARSE_STEPS + POST_PRESTIGE_FINE_BUDGET + COARSE_TAIL_SECONDS);

export interface AdvanceResult {
  state: SecretState;
  steps: number;
  mode: "none" | "exact" | "coarse";
  seconds: number;
}

// A catch-up as a sliceable job: the runtime runs it a few milliseconds at a time so a long
// absence never blocks the main game's thread. Running a job to completion in any number of
// slices gives exactly the same state as advanceTo (the same steps in the same order).
export interface CatchUpJob {
  // Runs up to maxSteps more steps; returns true once finished.
  run(maxSteps: number): boolean;
  // Runs steps until about budgetMs milliseconds have passed; returns true once finished.
  runFor(budgetMs: number, now?: () => number): boolean;
  // Seconds of the gap already paid.
  elapsedSeconds(): number;
  result(): AdvanceResult;
}

// The game always uses the defaults. The pacing simulation's six-month stretch passes a longer
// minCoarseDt (and no exact window) so half a year of check-ins runs in seconds (sim.ts).
export interface CatchUpOptions {
  exactBoundSeconds?: number;
  minCoarseDt?: number;
}

const prestigeCount = (x: SecretState): number => x.captainCount + x.fleetTotal + x.pcCount;

export function createCatchUp(s: SecretState, nowMs: number, opts: CatchUpOptions = {}): CatchUpJob {
  const done = (r: AdvanceResult): CatchUpJob => ({ run: () => true, runFor: () => true, elapsedSeconds: () => r.seconds, result: () => r });
  if (!Number.isFinite(nowMs)) return done({ state: s, steps: 0, mode: "none", seconds: 0 });
  // A clock a little behind the state's own stamp pays nothing and moves nothing: the stamp is a
  // high-water mark (0.13.11.1 clock protection; the old re-anchor let a clock set back be paid
  // twice). The trusted clock never runs backward on its own, so a stamp far AHEAD of it is a save
  // written while a device clock was ahead, or the trusted clock stepped down to the server's: the
  // stamp moves to now and nothing is paid, so the minigame never freezes (review M1).
  if (nowMs < s.lastTickAt) {
    if (s.lastTickAt - nowMs <= SERVER_TOLERANCE_MS) return done({ state: s, steps: 0, mode: "none", seconds: 0 });
    const rebased = cloneSecret(s);
    rebased.lastTickAt = nowMs;
    return done({ state: rebased, steps: 0, mode: "none", seconds: 0 });
  }
  const seconds = Math.floor((nowMs - s.lastTickAt) / 1000);
  if (seconds <= 0) return done({ state: s, steps: 0, mode: "none", seconds: 0 });

  const start = s.lastTickAt;
  const next = cloneSecret(s);
  const exact = seconds <= (opts.exactBoundSeconds ?? EXACT_BOUND_SECONDS);
  const tail = exact ? 0 : Math.min(COARSE_TAIL_SECONDS, seconds);
  const coarseSeconds = exact ? 0 : seconds - tail;
  const n = exact ? 0 : Math.max(1, Math.min(MAX_COARSE_STEPS, Math.ceil(coarseSeconds / (opts.minCoarseDt ?? MIN_COARSE_DT))));
  const dt = exact ? 0 : coarseSeconds / n;

  let steps = 0;
  let elapsed = 0; // seconds booked so far
  let fineLeft = 0; // 1-second steps still owed after an automatic prestige
  let fineBudget = POST_PRESTIGE_FINE_BUDGET;
  const finished = (): boolean => elapsed >= seconds - 1e-9;
  // Right after a reset the stack ramps up fast and automatic resets can come seconds apart; follow
  // that stretch in live-sized steps (bounded by the budget, so the step count stays bounded).
  const followRamp = (): void => {
    const add = Math.min(COARSE_TAIL_SECONDS - fineLeft, fineBudget);
    if (add <= 0) return;
    fineLeft += add;
    fineBudget -= add;
  };

  const one = (): void => {
    if (exact) {
      elapsed += 1;
      stepMut(next, 1, start + elapsed * 1000);
    } else if (elapsed < coarseSeconds - 1e-9 && fineLeft === 0) {
      // A coarse step; never past the coarse span, so the closing tail stays whole seconds.
      const d = Math.min(dt, coarseSeconds - elapsed);
      const before = prestigeCount(next);
      elapsed += d;
      stepMut(next, d, start + Math.round(elapsed * 1000), d * (1 + COARSE_GENEROSITY));
      if (prestigeCount(next) !== before) followRamp();
    } else {
      const d = Math.min(1, seconds - elapsed);
      const before = prestigeCount(next);
      elapsed += d;
      if (fineLeft > 0) fineLeft -= 1;
      stepMut(next, d, start + Math.round(elapsed * 1000));
      // A reset inside the fine window extends it: a run of quick automatic resets is followed live.
      if (fineLeft > 0 && prestigeCount(next) !== before) followRamp();
    }
    steps += 1;
  };

  const finish = (): boolean => {
    if (finished()) next.lastTickAt = start + seconds * 1000;
    return finished();
  };

  return {
    run(maxSteps: number): boolean {
      for (let k = 0; k < maxSteps && !finished(); k++) one();
      return finish();
    },
    runFor(budgetMs: number, now: () => number = () => performance.now()): boolean {
      const until = now() + budgetMs;
      while (!finished()) {
        for (let k = 0; k < 32 && !finished(); k++) one();
        if (now() >= until) break;
      }
      return finish();
    },
    elapsedSeconds(): number {
      return elapsed;
    },
    result(): AdvanceResult {
      return { state: next, steps, mode: exact ? "exact" : "coarse", seconds };
    },
  };
}

export function advanceTo(s: SecretState, nowMs: number, opts: CatchUpOptions = {}): AdvanceResult {
  const job = createCatchUp(s, nowMs, opts);
  job.run(Infinity);
  return job.result();
}
