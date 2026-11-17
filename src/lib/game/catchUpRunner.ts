// catchUpRunner.ts: the ASYNCHRONOUS catch-up (HOTFIX 0.13.11.4).
//
// THE PROBLEM. A long absence is paid by tick(), one economyTick call per game second, up to the
// offline cap (4 days, 345,600 calls). With several Repeat combat patrols each call costs tens of
// microseconds, so the old single synchronous call froze the page for tens of seconds on a desktop
// and minutes on a phone: the game looked hung.
//
// THE FIX. The SAME job tick() runs (tick.ts beginTickJob / advanceTickJob: the same economyTick
// calls, in the same order, with the same arguments), made in time-sliced batches of about
// CATCH_UP_SLICE_MS of work that yield to the browser between slices, behind a progress overlay.
// The result is identical to the synchronous call BY CONSTRUCTION: only the moments between calls
// change, and nothing touches the job's state between them.
//
// WHEN. Every catch-up starts with one synchronous probe slice (CATCH_UP_PROBE_MS). A catch-up that
// finishes inside it, or that the probe's measured rate says will finish within CATCH_UP_SYNC_MAX_MS
// in all, is simply finished synchronously, exactly as before and with no overlay (a short gap
// costs no more than it always did, and the overlay never flashes). Only a catch-up long enough to
// notice goes asynchronous, with the overlay up.
//
// ONE AT A TIME. The controller is busy from the moment a run goes asynchronous until it is applied.
// While busy, App.svelte's game loop, saves and away recaps all hold (see App.svelte); `pay` refuses
// a second job outright, so nothing can start a second catch-up or tick the state concurrently.
//
// The yield is a MessageChannel message (a macrotask the browser may paint between), NOT
// requestAnimationFrame: rAF stops in hidden tabs, and a return from a long sleep can start a
// catch-up while the tab is still hidden. Timers are not used either, since background tabs throttle
// them to once a second or slower.

import { advanceTickJob, tickJobDone, type TickJob } from "./tick";

// About one frame's worth of work per slice, leaving the browser time to paint and take input.
export const CATCH_UP_SLICE_MS = 14;
// The first, synchronous slice, which also measures the rate.
export const CATCH_UP_PROBE_MS = 50;
// A catch-up the probe says will finish within this many milliseconds IN ALL is finished synchronously
// (no overlay). Anything longer is noticeable, so it goes asynchronous with the overlay up.
export const CATCH_UP_SYNC_MAX_MS = 1000;

// Make the job's calls, one at a time, until it is done or `budgetMs` has passed since the start.
// At least one call is made (when any remain), so every slice makes progress. Returns the calls made.
// A job that makes no call when asked (never expected: beginTickJob only builds jobs that can) ends the
// slice at once with 0, rather than spinning for the whole budget.
export function runCatchUpSlice(job: TickJob, budgetMs: number, now: () => number): number {
  if (tickJobDone(job)) return 0;
  const t0 = now();
  let made = 0;
  do {
    const step = advanceTickJob(job, 1);
    if (step === 0) break;
    made += step;
  } while (!tickJobDone(job) && now() - t0 < budgetMs);
  return made;
}

// After the probe slice: true when the rest is short enough to finish synchronously (the whole
// catch-up then takes at most about syncMaxMs, as it would have before this hotfix for a short gap).
export function finishesQuickly(job: TickJob, probeCalls: number, probeMs: number, syncMaxMs: number = CATCH_UP_SYNC_MAX_MS): boolean {
  if (tickJobDone(job)) return true;
  const perCallMs = probeMs / Math.max(1, probeCalls);
  return probeMs + (job.callsTotal - job.callsDone) * perCallMs <= syncMaxMs;
}

// Yield to the browser: resolves on a fresh macrotask (see the header for why not rAF or a timer).
export function yieldToBrowser(): Promise<void> {
  if (typeof MessageChannel === "undefined") return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

// What the overlay shows while a run is in flight.
export interface CatchUpView {
  // One short line saying what is being caught up ("You were away ~4d. ...").
  detail: string;
  // economyTick calls made so far, and in all.
  done: number;
  total: number;
}

// Whole percent for the overlay, never 100 until the run is really done.
export function catchUpPercent(view: Pick<CatchUpView, "done" | "total">): number {
  if (view.total <= 0) return 100;
  if (view.done >= view.total) return 100;
  return Math.min(99, Math.floor((view.done / view.total) * 100));
}

export interface CatchUpControllerOptions {
  // The overlay model: a view while a run is in flight, null otherwise.
  onView: (view: CatchUpView | null) => void;
  now?: () => number;
  yieldToBrowser?: () => Promise<void>;
  sliceMs?: number;
  probeMs?: number;
  syncMaxMs?: number;
  // A run that threw (a bug in the economy, never expected). The run is dropped, the overlay closes.
  onError?: (error: unknown) => void;
}

export class CatchUpController {
  private running = false;
  private disposed = false;
  private deferred: (() => void)[] = [];
  private readonly opts: Required<Omit<CatchUpControllerOptions, "onError">> & Pick<CatchUpControllerOptions, "onError">;

  constructor(options: CatchUpControllerOptions) {
    this.opts = {
      now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
      yieldToBrowser,
      sliceMs: CATCH_UP_SLICE_MS,
      probeMs: CATCH_UP_PROBE_MS,
      syncMaxMs: CATCH_UP_SYNC_MAX_MS,
      ...options,
    };
  }

  // True while an asynchronous run is in flight (from going async until its result is applied).
  get busy(): boolean {
    return this.running;
  }

  // Pay `job` and hand it to `apply` once done. Returns true when it finished synchronously (apply has
  // already run when this returns), false when it went asynchronous (apply runs later, then every
  // callback deferred with whenIdle). Throws if a run is already in flight: there is only ever one.
  pay(job: TickJob, detail: string, apply: (job: TickJob) => void, failed?: (error: unknown) => void): boolean {
    if (this.running) throw new Error("catch-up already running");
    const { now, probeMs, syncMaxMs } = this.opts;
    const t0 = now();
    const probeCalls = runCatchUpSlice(job, probeMs, now);
    if (finishesQuickly(job, probeCalls, now() - t0, syncMaxMs)) {
      advanceTickJob(job, Infinity);
      apply(job);
      return true;
    }
    this.running = true;
    this.opts.onView({ detail, done: job.callsDone, total: job.callsTotal });
    void this.runAsync(job, detail, apply, failed);
    return false;
  }

  // Run `fn` now when no run is in flight, else right after the run's result is applied.
  whenIdle(fn: () => void): void {
    if (this.running) this.deferred.push(fn);
    else fn();
  }

  // Stop any run in flight for good (the page is going away). Its result is never applied.
  dispose(): void {
    this.disposed = true;
  }

  private async runAsync(job: TickJob, detail: string, apply: (job: TickJob) => void, failed?: (error: unknown) => void): Promise<void> {
    const { now, sliceMs, onView } = this.opts;
    try {
      while (!tickJobDone(job)) {
        await this.opts.yieldToBrowser();
        if (this.disposed) return;
        // A slice that makes no call (never expected) ends the run with what it has, as tick() would
        // return it, so the overlay can never hang.
        if (runCatchUpSlice(job, sliceMs, now) === 0) break;
        onView({ detail, done: job.callsDone, total: job.callsTotal });
      }
    } catch (error) {
      // The run is dropped and the overlay closes. The deferred callbacks still run (the away recap of
      // what was paid before the run), so nothing queued behind a failed run is lost.
      this.running = false;
      onView(null);
      this.opts.onError?.(error);
      failed?.(error);
      this.flushDeferred();
      return;
    }
    if (this.disposed) return;
    // Apply and release in one synchronous pass: nothing can run between the result landing and the
    // deferred callbacks (the away recap) reading it.
    this.running = false;
    onView(null);
    apply(job);
    this.flushDeferred();
  }

  // Run every deferred callback once, in order. One that starts a new run defers the rest behind it.
  private flushDeferred(): void {
    const deferred = this.deferred;
    this.deferred = [];
    for (let i = 0; i < deferred.length; i++) {
      if (this.running) {
        this.deferred.push(...deferred.slice(i));
        return;
      }
      deferred[i]();
    }
  }
}
