// catchUp.ts: bringing the secret game up to "now" (0.13.11).
//
// ONE step function (engine.stepMut) for everything. Live play is simply advanceTo(Date.now())
// called about once a second, so a live second and a caught-up second are the same code.
//
// User decision (builder check Q2, "Exact short, fair long"):
//   - Gaps up to EXACT_BOUND_SECONDS (6 hours) run as whole 1-second steps, exactly as live play
//     does, so they match live bit for bit (catchUp.test.ts compares serialized states).
//   - Longer gaps run as equal coarse steps (at most MAX_COARSE_STEPS of them, never shorter than
//     MIN_COARSE_DT) and then a COARSE_TAIL_SECONDS tail of 1-second steps, so the generators and
//     Overclock re-settle at the end. The engine's clock is step-size neutral by design (Overclock
//     is priced in seconds of income, the cascade integrates exactly), and catchUp.test.ts proves
//     a long gap never pays less than live would have and stays within a sane bound above it.
//     Each coarse step also carries a small COARSE_GENEROSITY margin of extra simulated time.
//   - The step count is bounded, so a 30-day absence still loads quickly (measured in the tests).
// No offline cap (answer 6, "Always runs").
//
// lastTickAt advances by WHOLE seconds only; the fraction carries to the next call. A clock that
// jumped backwards simply re-anchors (no time passed, nothing paid, nothing lost).

import { stepMut } from "./engine";
import { cloneSecret, type SecretState } from "./state";

export const EXACT_BOUND_SECONDS = 6 * 3600;
export const MAX_COARSE_STEPS = 20000;
export const MIN_COARSE_DT = 5;
export const COARSE_TAIL_SECONDS = 120;
// Each coarse step simulates this much extra time (1%). Coarse steps already track live closely;
// the margin is what turns "about the same" into "never less" (catchUp.test.ts).
export const COARSE_GENEROSITY = 0.03;
export const MAX_CATCHUP_STEPS = Math.max(EXACT_BOUND_SECONDS, MAX_COARSE_STEPS + COARSE_TAIL_SECONDS);

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
  result(): AdvanceResult;
}

export function createCatchUp(s: SecretState, nowMs: number, opts: { exactBoundSeconds?: number } = {}): CatchUpJob {
  const done = (r: AdvanceResult): CatchUpJob => ({ run: () => true, result: () => r });
  if (!Number.isFinite(nowMs)) return done({ state: s, steps: 0, mode: "none", seconds: 0 });
  if (nowMs < s.lastTickAt) {
    const re = cloneSecret(s);
    re.lastTickAt = nowMs;
    return done({ state: re, steps: 0, mode: "none", seconds: 0 });
  }
  const seconds = Math.floor((nowMs - s.lastTickAt) / 1000);
  if (seconds <= 0) return done({ state: s, steps: 0, mode: "none", seconds: 0 });

  const start = s.lastTickAt;
  const next = cloneSecret(s);
  const exact = seconds <= (opts.exactBoundSeconds ?? EXACT_BOUND_SECONDS);
  const tail = exact ? 0 : Math.min(COARSE_TAIL_SECONDS, seconds);
  const coarseSeconds = exact ? 0 : seconds - tail;
  const n = exact ? 0 : Math.max(1, Math.min(MAX_COARSE_STEPS, Math.ceil(coarseSeconds / MIN_COARSE_DT)));
  const dt = exact ? 0 : coarseSeconds / n;
  const total = exact ? seconds : n + tail;
  let i = 0; // steps taken so far

  const one = (): void => {
    if (exact) {
      stepMut(next, 1, start + (i + 1) * 1000);
    } else if (i < n) {
      stepMut(next, dt * (1 + COARSE_GENEROSITY), start + Math.round((i + 1) * dt * 1000));
    } else {
      stepMut(next, 1, start + (coarseSeconds + (i - n) + 1) * 1000);
    }
    i += 1;
  };

  return {
    run(maxSteps: number): boolean {
      const stop = Math.min(total, i + Math.max(0, Math.floor(maxSteps)));
      while (i < stop) one();
      if (i >= total) next.lastTickAt = start + seconds * 1000;
      return i >= total;
    },
    result(): AdvanceResult {
      return { state: next, steps: i, mode: exact ? "exact" : "coarse", seconds };
    },
  };
}

export function advanceTo(s: SecretState, nowMs: number, opts: { exactBoundSeconds?: number } = {}): AdvanceResult {
  const job = createCatchUp(s, nowMs, opts);
  job.run(Infinity);
  return job.result();
}
