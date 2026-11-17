// HOTFIX 0.13.11.4: the asynchronous catch-up (catchUpRunner.ts, tick.ts beginTickJob / advanceTickJob) lands on the
// very state the synchronous tick() returns, pays each second once across an interrupted run and a reload, and never
// runs two catch-ups at once. App.svelte's wiring of it is checked against the real source (this repo has no Svelte
// component harness; the same technique as src/lib/secret/wiring.test.ts).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameState } from "./model";
import { beginTickJob, advanceTickJob, tick, tickJobDone } from "./tick";
import { beginPollCatchUp, finishPollCatchUp, planPoll, runPollEconomy, startLoopClock, type AdvancePlan } from "./loopClock";
import { CatchUpController, catchUpPercent, finishesQuickly, runCatchUpSlice, type CatchUpView } from "./catchUpRunner";
import { lcg, mixedFleet, patrolFleet } from "./patrolPerf.fixture";

const SLOW = 240_000;
const HOUR = 3600;
const END_MS = 1_800_000_000_000; // a fixed wall clock for the completion stamps

// A fake clock: every read advances it, so a slice of `sliceMs` makes about sliceMs / step calls and a long job is
// forced through many asynchronous slices.
function fakeClock(stepMs: number): () => number {
  let t = 0;
  return () => (t += stepMs);
}

// Drive a controller run to its end: yields are resolved promises, so awaiting them settles the run.
async function settle(controller: CatchUpController): Promise<void> {
  for (let i = 0; i < 1_000_000 && controller.busy; i++) await Promise.resolve();
}

function expectSameState(a: GameState, b: GameState, what: string): void {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x === y) return;
  let i = 0;
  while (i < x.length && x[i] === y[i]) i++;
  expect(`${what}: ...${x.slice(Math.max(0, i - 200), i + 200)}`).toBe(`${what}: ...${y.slice(Math.max(0, i - 200), i + 200)}`);
}

describe("the catch-up job is tick(), call for call", () => {
  it("run to the end it equals tick() (whole span, fractional span, over the cap, empty span)", () => {
    const s0 = patrolFleet();
    for (const seconds of [600, 600.4, 0, -5]) {
      const job = beginTickJob(seconds, s0, lcg(7), END_MS);
      advanceTickJob(job, Infinity);
      expectSameState(job.state, tick(seconds, s0, lcg(7), END_MS), `span ${seconds}`);
    }
    // Empty spans hand back the input itself, as tick() does.
    expect(beginTickJob(0, s0).state).toBe(s0);
    expect(tick(0, s0)).toBe(s0);
    // A fractional span is its whole ticks plus one trailing call.
    expect(beginTickJob(600.4, s0).callsTotal).toBe(601);
    // Past the offline cap the job is clamped exactly like tick().
    const capped = beginTickJob(10 * 86400, s0);
    expect(capped.callsTotal).toBe(4 * 86400);
  });

  it("stopped and resumed at arbitrary points it still equals tick()", () => {
    const s0 = mixedFleet();
    const job = beginTickJob(1800.25, s0, lcg(9), END_MS);
    const cuts = [1, 7, 500, 3, 1, 1000, 10_000];
    for (const n of cuts) advanceTickJob(job, n);
    expect(tickJobDone(job)).toBe(true);
    expectSameState(job.state, tick(1800.25, s0, lcg(9), END_MS), "resumed");
  });
});

describe("an asynchronous catch-up lands on the synchronous result", () => {
  it("the five-patrol fleet, 12 hours away, in many slices, equals tick() whole", { timeout: SLOW }, async () => {
    const s0 = patrolFleet();
    const views: (CatchUpView | null)[] = [];
    const controller = new CatchUpController({
      onView: (v) => views.push(v),
      now: fakeClock(1), // 1 ms per call: a 14 ms slice makes about 14 calls
      yieldToBrowser: () => Promise.resolve(),
    });
    const job = beginTickJob(12 * HOUR, s0, lcg(0x15), END_MS);
    let applied: GameState | null = null;
    const sync = controller.pay(job, "You were away ~12h. Your fleet is catching up.", (done) => (applied = done.state));
    expect(sync).toBe(false);
    expect(controller.busy).toBe(true);
    expect(applied).toBeNull();
    await settle(controller);
    expect(controller.busy).toBe(false);
    expect(applied).not.toBeNull();
    expectSameState(applied!, tick(12 * HOUR, s0, lcg(0x15), END_MS), "async vs sync");
    // Not vacuous: it really ran in slices, reported rising progress, and closed the overlay at the end.
    const shown = views.filter((v): v is CatchUpView => v !== null);
    expect(shown.length).toBeGreaterThan(1000);
    for (let i = 1; i < shown.length; i++) expect(shown[i].done).toBeGreaterThanOrEqual(shown[i - 1].done);
    expect(shown[shown.length - 1].done).toBe(12 * HOUR);
    expect(views[views.length - 1]).toBeNull();
  });

  it("a hidden-tab poll catch-up, sliced, equals runPollEconomy's synchronous one", { timeout: SLOW }, async () => {
    const s0 = mixedFleet();
    const startMs = END_MS - 6 * HOUR * 1000;
    const { plan } = planPoll(startLoopClock(startMs), END_MS, s0.tickDurationSeconds, 1);
    expect(plan.kind === "advance" && plan.mode).toBe("catchUp");
    const p = plan as AdvancePlan;
    const syncResult = runPollEconomy(s0, p, lcg(3), END_MS);
    const controller = new CatchUpController({ onView: () => {}, now: fakeClock(2), yieldToBrowser: () => Promise.resolve() });
    let applied: GameState | null = null;
    controller.pay(beginPollCatchUp(s0, p, lcg(3), END_MS), "away", (done) => (applied = finishPollCatchUp(s0, done)));
    await settle(controller);
    expectSameState(applied!, syncResult, "poll async vs sync");
    expect(applied!.gameTimeSeconds).toBe(s0.gameTimeSeconds);
  });
});

describe("short catch-ups stay synchronous, long ones go asynchronous", () => {
  it("a short catch-up finishes inside pay(), with no overlay", () => {
    const s0 = patrolFleet();
    const views: (CatchUpView | null)[] = [];
    const controller = new CatchUpController({ onView: (v) => views.push(v), now: fakeClock(0.001) });
    let applied: GameState | null = null;
    expect(controller.pay(beginTickJob(120, s0, lcg(1)), "x", (d) => (applied = d.state))).toBe(true);
    expect(applied).not.toBeNull();
    expect(views).toEqual([]);
    expect(controller.busy).toBe(false);
  });

  it("the probe's rate decides: finishing within the sync budget stays synchronous", () => {
    const job = beginTickJob(1200, patrolFleet());
    const made = runCatchUpSlice(job, 5, fakeClock(1));
    expect(made).toBeGreaterThan(0);
    // 1200 calls at 1 ms each is 1.2 s in all: past the 1 s budget, so asynchronous.
    expect(finishesQuickly(job, made, made, 1000)).toBe(false);
    // The same at 0.1 ms each (0.12 s) is well inside it.
    expect(finishesQuickly(job, made, made / 10, 1000)).toBe(true);
  });

  it("percent is whole, rises, and reads 100 only when done", () => {
    expect(catchUpPercent({ done: 0, total: 345600 })).toBe(0);
    expect(catchUpPercent({ done: 172800, total: 345600 })).toBe(50);
    expect(catchUpPercent({ done: 345599, total: 345600 })).toBe(99);
    expect(catchUpPercent({ done: 345600, total: 345600 })).toBe(100);
  });
});

describe("one catch-up at a time, each second paid once", () => {
  it("a second catch-up cannot start while one is in flight, and deferred work waits for the result", async () => {
    const s0 = patrolFleet();
    const controller = new CatchUpController({ onView: () => {}, now: fakeClock(1), yieldToBrowser: () => Promise.resolve() });
    const order: string[] = [];
    controller.pay(beginTickJob(HOUR, s0, lcg(1)), "a", () => order.push("applied"));
    expect(controller.busy).toBe(true);
    expect(() => controller.pay(beginTickJob(HOUR, s0, lcg(1)), "b", () => order.push("second"))).toThrow(/already running/);
    controller.whenIdle(() => order.push("recap"));
    expect(order).toEqual([]);
    await settle(controller);
    expect(order).toEqual(["applied", "recap"]);
    // Idle again: work runs at once.
    controller.whenIdle(() => order.push("now"));
    expect(order).toEqual(["applied", "recap", "now"]);
  });

  it("interrupted mid-run (the tab closed), then reloaded: the whole absence is paid exactly once", { timeout: SLOW }, async () => {
    // The device's save: state S0, paid through T0. App.svelte saves only while no catch-up is in flight (doSave
    // returns while catchUp.busy), modeled here by `autosave`.
    const S0 = patrolFleet();
    const T0 = END_MS;
    let saved = { state: S0, lastSavedAt: T0 };
    const live = { state: S0 };
    const autosave = (controller: CatchUpController, nowMs: number) => {
      if (!controller.busy) saved = { state: live.state, lastSavedAt: nowMs };
    };

    // Reload 1, six hours later: the catch-up goes asynchronous; autosave and the unload save fire mid-run.
    const T1 = T0 + 6 * HOUR * 1000;
    const c1 = new CatchUpController({ onView: () => {}, now: fakeClock(1), yieldToBrowser: () => Promise.resolve() });
    const job1 = beginTickJob((T1 - saved.lastSavedAt) / 1000, saved.state, lcg(5), T1);
    c1.pay(job1, "x", (d) => (live.state = d.state));
    for (let i = 0; i < 200; i++) await Promise.resolve();
    expect(c1.busy).toBe(true);
    expect(job1.callsDone).toBeGreaterThan(0);
    expect(tickJobDone(job1)).toBe(false);
    autosave(c1, T1 + 5_000);
    autosave(c1, T1 + 9_000); // beforeunload
    c1.dispose(); // the page goes away; the run is never applied
    for (let i = 0; i < 200; i++) await Promise.resolve();
    expect(saved.state).toBe(S0);
    expect(saved.lastSavedAt).toBe(T0);

    // Reload 2, an hour after that: it pays from the untouched save, the whole seven hours, once.
    const T2 = T1 + HOUR * 1000;
    const c2 = new CatchUpController({ onView: () => {}, now: fakeClock(1), yieldToBrowser: () => Promise.resolve() });
    c2.pay(beginTickJob((T2 - saved.lastSavedAt) / 1000, saved.state, lcg(5), T2), "x", (d) => (live.state = d.state));
    await settle(c2);
    expectSameState(live.state, tick(7 * HOUR, S0, lcg(5), T2), "paid once");
    // And it now saves, stamped with what it paid through.
    autosave(c2, T2);
    expect(saved.state).toBe(live.state);
    expect(saved.state.gameTimeSeconds).toBe(S0.gameTimeSeconds + 7 * HOUR);
  });
});

describe("App.svelte wiring (checked against the source)", () => {
  const APP = readFileSync("src/App.svelte", "utf-8");
  const OVERLAY = readFileSync("src/lib/CatchUpOverlay.svelte", "utf-8");

  function block(start: string): string {
    const at = APP.indexOf(start);
    expect(at, `${start} not found`).toBeGreaterThan(0);
    const open = APP.indexOf("{", at + start.length - 1);
    let depth = 0;
    for (let i = open; i < APP.length; i++) {
      if (APP[i] === "{") depth++;
      if (APP[i] === "}" && --depth === 0) return APP.slice(open, i + 1);
    }
    throw new Error(`unbalanced ${start}`);
  }

  it("never saves while a catch-up is in flight", () => {
    const save = block("function doSave() {");
    expect(save).toContain("if (catchUp.busy) return;");
    expect(save.indexOf("if (catchUp.busy) return;")).toBeLessThan(save.indexOf("saveToLocalStorage("));
  });

  it("the game loop does nothing while a catch-up is in flight, not even planPoll", () => {
    const poll = block("const pollGameLoop = () => {");
    expect(poll.indexOf("if (catchUp.busy) return;")).toBeGreaterThan(0);
    expect(poll.indexOf("if (catchUp.busy) return;")).toBeLessThan(poll.indexOf("planPoll("));
    // A gap is paid through the controller, as the job runPollEconomy runs.
    expect(poll).toContain("beginPollCatchUp(beforeEconomy, plan, Math.random, completionClockMs)");
    expect(poll).toContain("finishPollCatchUp(beforeEconomy, done)");
  });

  it("the reload catch-up is the tick() job, paid by the controller, and the game starts after it", () => {
    expect(APP).toContain("beginTickJob(offlineSeconds, beforeSnapshot, Math.random, returnedAtMs)");
    expect(APP).not.toMatch(/state = offlineSeconds > 5 \? tick\(/);
    expect(APP).toContain("if (!loadCatchUpAsync) startGame();");
    expect(APP).toContain("if (loadCatchUpAsync) startGame();");
  });

  it("the away recap waits for a catch-up in flight", () => {
    expect(APP).toContain("if (catchUp.busy) return catchUp.whenIdle(recapAway);");
    expect(APP).toContain("catchUp.whenIdle(recapAway);");
  });

  it("the game is inert under the overlay, which sits outside it", () => {
    expect(APP).toContain('<div class="root" inert={catchUpView !== null ? true : undefined}>');
    const overlayAt = APP.indexOf("<CatchUpOverlay view={catchUpView} />");
    expect(overlayAt).toBeGreaterThan(APP.lastIndexOf('<div class="root"'));
    expect(overlayAt).toBeLessThan(APP.indexOf("<style>"));
  });

  it("the overlay is an accessible modal with a real progress bar and no emoji", () => {
    expect(OVERLAY).toContain('role="dialog"');
    expect(OVERLAY).toContain('aria-modal="true"');
    expect(OVERLAY).toContain('role="progressbar"');
    expect(OVERLAY).toContain('aria-label="Catch-up progress"');
    expect(OVERLAY).toContain("aria-valuemin={0}");
    expect(OVERLAY).toContain("aria-valuemax={100}");
    expect(OVERLAY).toContain("aria-valuenow={percent}");
    expect(OVERLAY).toContain('<Icon name="clock"');
    expect(OVERLAY).toContain("Catching up");
    expect(OVERLAY).not.toMatch(/\p{Extended_Pictographic}/u);
    // Theme tokens only: no hard-coded text or accent colors.
    expect(OVERLAY).toContain("var(--color-accent)");
    expect(OVERLAY).not.toMatch(/color:\s*#/);
  });
});
