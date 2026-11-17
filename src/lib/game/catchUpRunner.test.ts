// HOTFIX 0.13.11.4: the asynchronous catch-up (catchUpRunner.ts, tick.ts beginTickJob / advanceTickJob) lands on the
// very state the synchronous tick() returns, pays each second once across an interrupted run and a reload, and never
// runs two catch-ups at once. App.svelte's wiring of it is checked against the real source (this repo has no Svelte
// component harness; the same technique as src/lib/secret/wiring.test.ts).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameState } from "./model";
import { beginTickJob, advanceTickJob, tick, tickJobDone } from "./tick";
import {
  asyncCatchUpSave,
  beginPollCatchUp,
  finishPollCatchUp,
  paidRealSeconds,
  planPoll,
  runPollEconomy,
  startLoopClock,
  tallyAwayPoll,
  type AdvancePlan,
  type AwayTally,
  type LoopClock,
} from "./loopClock";
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
  // 0.14.0 port: line endings normalized, so the multi-line anchors below hold on a CRLF checkout too.
  const APP = readFileSync("src/App.svelte", "utf-8").replace(/\r\n/g, "\n");
  const OVERLAY = readFileSync("src/lib/CatchUpOverlay.svelte", "utf-8");

  function block(start: string, from = 0): string {
    const at = APP.indexOf(start, from);
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
    expect(save.indexOf("if (catchUp.busy) return;")).toBeLessThan(save.indexOf("writeSave("));
    // The one writer: doSave and the async-start save both go through it.
    expect(block("function writeSave(saveState: GameState, paidThroughStampMs: number) {")).toContain(
      "saveToLocalStorage(saveState, createdAt, paidThroughStampMs)",
    );
  });

  it("the game loop does nothing while a catch-up is in flight (or after one failed), not even planPoll", () => {
    const poll = block("const pollGameLoop = () => {");
    expect(poll.indexOf("if (catchUp.busy || catchUpFailed) return;")).toBeGreaterThan(0);
    expect(poll.indexOf("if (catchUp.busy || catchUpFailed) return;")).toBeLessThan(poll.indexOf("planPoll("));
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

  it("the away recap waits for a catch-up in flight, by running finish again once it lands", () => {
    // 0.14.0 port: App.svelte has another `const finish` (the refugee toast), so the search starts at the visibility one.
    const finish = block("const finish = () => {", APP.indexOf("// HOTFIX 0.13.11.4: when the poll above (or this one) started an asynchronous catch-up"));
    expect(finish).toContain("if (catchUp.busy) return catchUp.whenIdle(finish);");
    expect(finish.indexOf("if (catchUp.busy) return catchUp.whenIdle(finish);")).toBeLessThan(finish.indexOf("pollGameLoop();"));
    expect(finish.indexOf("pollGameLoop();")).toBeLessThan(finish.indexOf("catchUp.whenIdle(recapAway);"));
    expect(APP).not.toContain("catchUp.whenIdle(recapAway);\n          pollGameLoop");
  });

  it("the game is inert under the overlay, which sits outside it", () => {
    expect(APP).toContain('<div class="root" inert={catchUpView !== null || catchUpFailed ? true : undefined}>');
    const overlayAt = APP.indexOf("<CatchUpOverlay view={catchUpView} failed={catchUpFailed} />");
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
    // Focus is trapped in the window (Escape does nothing: there is nothing to close).
    expect(OVERLAY).toContain("use:focusTrap={() => {}}");
    expect(OVERLAY).not.toMatch(/\p{Extended_Pictographic}/u);
    // Theme tokens only: no hard-coded text or accent colors.
    expect(OVERLAY).toContain("var(--color-accent)");
    expect(OVERLAY).not.toMatch(/color:\s*#/);
  });

  it("a poll that goes asynchronous writes ONE save first: the pre-poll state, paid through the pre-poll clock", () => {
    const poll = block("const pollGameLoop = () => {");
    // Captured before planPoll and before the poll's fleet-clock bump.
    const preState = poll.indexOf("const prePollState = state;");
    const preClock = poll.indexOf("const prePollClock = loopClock;");
    expect(preState).toBeGreaterThan(0);
    expect(preClock).toBeGreaterThan(0);
    expect(preState).toBeLessThan(poll.indexOf("planPoll("));
    expect(preClock).toBeLessThan(poll.indexOf("planPoll("));
    // 0.14.0 port: the fleet clock this poll ends on is computed here and applied after the economy (liveClockSeconds).
    expect(preState).toBeLessThan(poll.indexOf("const liveClockSeconds = state.gameTimeSeconds + plan.realElapsedSeconds * speed;"));
    // Written right after pay() goes asynchronous (pay returned false), through the one writer.
    const pay = poll.indexOf("const wentAsync = !catchUp.pay(");
    const save = poll.indexOf("if (wentAsync && !suppressSave) {");
    expect(pay).toBeGreaterThan(0);
    expect(save).toBeGreaterThan(pay);
    expect(poll.slice(save, save + 200)).toContain("asyncCatchUpSave(prePollState, prePollClock, now)");
    expect(poll.slice(save, save + 300)).toContain("writeSave(snapshot.state, snapshot.paidThroughMs)");
    // A failed poll run stops saving.
    expect(poll.slice(pay, save)).toContain("onCatchUpFailed,");
  });

  it("a failed run never starts the game, stops saving and keeps the overlay up asking for a reload", () => {
    const failed = block("function onCatchUpFailed(): void {");
    expect(failed).toContain("suppressSave = true;");
    expect(failed).toContain("catchUpFailed = true;");
    // The reload path's failure callback calls only that: no startGame, so no loop and no autosave.
    const load = APP.slice(APP.indexOf("const wentAsync = !catchUp.pay(\n          job,\n          catchUpDetail(loadPaidSeconds),"));
    const failCb = load.slice(load.indexOf("() => {"), load.indexOf("loadCatchUpAsync = wentAsync;"));
    expect(failCb).toContain("onCatchUpFailed();");
    expect(failCb).not.toContain("startGame()");
    expect(OVERLAY).toContain("Catching up failed. Reload to try again.");
    expect(OVERLAY).toContain("window.location.reload()");
  });

  it("the windows portaled to <body> go inert while the overlay blocks the game; the minigame layers do not", () => {
    expect(APP).toContain("$: catchUpBlocking.set(catchUpView !== null || catchUpFailed);");
    const modal = readFileSync("src/lib/ActionModal.svelte", "utf-8");
    expect(modal).toContain('<div class="am-backdrop" use:portal on:click|self={onClose} inert={$catchUpBlocking ? true : undefined}>');
    const multi = readFileSync("src/lib/MultiSelect.svelte", "utf-8");
    expect(multi).toContain("inert={$catchUpBlocking ? true : undefined}");
    // 0.14.0 port review: the talent web's portaled tooltip has a Learn button that writes state.
    const web = readFileSync("src/lib/RadialWeb.svelte", "utf-8").replace(/\r\n/g, "\n");
    expect(web).toContain('class="web-tooltip-backdrop"\n    use:portal\n    on:pointerup|self={closeTooltip}\n    inert={$catchUpBlocking ? true : undefined}');
    // The animated background pauses behind the overlay so its frames do not compete with the catch-up slices.
    expect(APP).toContain("paused={backgroundConfigureOpen || catchUpView !== null}");
    for (const path of ["src/lib/SecretGameOverlay.svelte", "src/lib/HeaderButtons.svelte", "src/lib/AchievementToasts.svelte"]) {
      expect(readFileSync(path, "utf-8"), path).not.toContain("catchUpBlocking");
    }
    // The locked layering: the overlay at 1850, under the Minigames list (1900), the minigame (2000), the toasts (2100).
    expect(OVERLAY).toContain("z-index: 1850;");
  });

  it("main-game writes from outside the inert game wait for the run or are refused", () => {
    // A gift code is refused (with a message) while a run is in flight or after one failed.
    const redeem = block("function doRedeemCode(raw: string): RedeemOutcome {");
    expect(redeem.indexOf('if (catchUp.busy || catchUpFailed) return { kind: "busy" };')).toBeGreaterThan(0);
    expect(redeem.indexOf('if (catchUp.busy || catchUpFailed) return { kind: "busy" };')).toBeLessThan(redeem.indexOf("redeemGift("));
    expect(readFileSync("src/lib/EnterCodeModal.svelte", "utf-8")).toContain('case "busy":');
    // The Starfall unlock mirrored from the minigame waits for the run to land.
    expect(APP).toContain("$: if (accountReady && !suppressSave && catchUpView === null && $secretGame.milestones.starfall !== undefined");
  });

  it("an asynchronous reload shows the player's own theme behind the overlay", () => {
    const load = APP.slice(APP.indexOf("      if (offlineSeconds > 5) {\n        // The screen behind the overlay"));
    const pay = load.indexOf("catchUp.pay(");
    expect(load.indexOf("accountReady = true;")).toBeGreaterThan(0);
    expect(load.indexOf("accountReady = true;")).toBeLessThan(pay);
    expect(load.indexOf("lookPrefs = loadLookPrefs(currentTheme);")).toBeLessThan(pay);
  });

  it("the Debug simulated absence runs through the controller (so the overlay can be QA-tested)", () => {
    const sim = block("function simulateOffline(hours: number) {");
    // 0.14.0 port: 0.14.0 anchors the simulated absence on the trusted clock, as the real paths do.
    expect(sim).toContain("beginTickJob(secondsAway, before, Math.random, trustedNow())");
    expect(sim).toContain("catchUp.pay(");
    expect(sim).not.toMatch(/\btick\(secondsAway/);
  });

  it("the hotfix's App.svelte lines carry no double dash and no em dash", () => {
    expect(APP).not.toContain("per-captain-cycle loop --");
    expect(OVERLAY).not.toMatch(/\u2014/);
  });

  // 0.14.0 port of the hotfix: the 0.14.0-only paths that write the game from outside the inert .root.
  it("0.14.0: the background unlock mirror waits for the run like the Starfall one", () => {
    expect(APP).toContain("$: if (accountReady && !suppressSave && catchUpView === null) {\n    for (const id of backgroundsFromMilestones(");
  });

  it("0.14.0: the Armory tooltip card (its Overtime button writes the game) is outside .root and goes inert itself", () => {
    const at = APP.indexOf('<div class="frow-tip-card armory-tip-card"');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(APP.indexOf('<div class="root"'));
    expect(APP.slice(at, APP.indexOf(">", at))).toContain("inert={catchUpView !== null || catchUpFailed ? true : undefined}");
  });

  it("0.14.0: the poll's fleet clock lands with the economy, after it, on both the synchronous and the asynchronous path", () => {
    const poll = block("const pollGameLoop = () => {");
    // A synchronous poll applies it at the very end (as 0.14.0 always did); an asynchronous one when its result lands.
    expect(poll).toContain("if (!economyLandsLater) applyLiveClock();");
    expect(poll.lastIndexOf("if (!economyLandsLater) applyLiveClock();")).toBeGreaterThan(poll.indexOf("barCompletedFrame = true;"));
    const landed = poll.slice(poll.indexOf("afterPollEconomy(finishPollCatchUp(beforeEconomy, done));"));
    expect(landed.indexOf("if (economyLandsLater) applyLiveClock();")).toBeGreaterThan(0);
    expect(landed.indexOf("if (economyLandsLater) applyLiveClock();")).toBeLessThan(landed.indexOf("onCatchUpFailed,"));
    expect(poll).toContain("economyLandsLater = wentAsync;");
    // The clock is never bumped before the economy (crew transports key on it).
    expect(poll).not.toContain("state = { ...state, gameTimeSeconds: state.gameTimeSeconds + plan.realElapsedSeconds * speed };");
  });

  it("0.14.0: the shoutout watch never announces the loaded save's own sets while the run is in flight", () => {
    const load = APP.slice(APP.indexOf("      // The loaded save shows (inert, under the overlay) while an asynchronous run is in flight."));
    expect(load.indexOf("state = beforeSnapshot;")).toBeLessThan(load.indexOf("shoutoutBasis = state;"));
    expect(load.indexOf("shoutoutBasis = state;")).toBeLessThan(load.indexOf("catchUp.pay("));
    expect(block("const startGame = () => {")).toContain("shoutoutBasis = state;");
  });
});

// Finding 1 of the 0.13.11.4 review: a purchase made after the last autosave, then a long hidden stretch whose
// return poll goes asynchronous, then the tab closed mid-run. The model below is App.svelte's poll in miniature
// (planPoll, the fleet-clock bump, beginPollCatchUp, catchUp.pay, then asyncCatchUpSave when it went async).
describe("an asynchronous poll keeps the player's last actions and pays the gap once", () => {
  it("action before hide, async poll, close mid-run, reload: the action is kept and the absence paid exactly once", { timeout: SLOW }, async () => {
    const S0 = patrolFleet({ patrols: 2, spares: 20 });
    const T0 = END_MS;
    // The last autosave: S0 paid through T0.
    let saved = { state: S0, lastSavedAt: T0 };
    let state = S0;
    let clock: LoopClock = startLoopClock(T0);
    const rng = lcg(0x21);
    // Live play, one poll a second for ten seconds (each a single "step" cycle, as in production).
    for (let k = 1; k <= 10; k++) {
      const now = T0 + k * 1000;
      const polled = planPoll(clock, now, state.tickDurationSeconds, 1);
      clock = polled.clock;
      const plan = polled.plan as AdvancePlan;
      expect(plan.mode).toBe("step");
      state = { ...state, gameTimeSeconds: state.gameTimeSeconds + plan.realElapsedSeconds };
      state = runPollEconomy(state, plan, rng, now);
    }
    // The purchase, 10.5 s in: well inside the 30 s autosave, so the autosave never saw it. Then the phone locks.
    const SALE = 12345;
    state = { ...state, credits: state.credits.add(SALE) };
    const withAction = state;

    // Two hours later the tab is shown: the return poll owes a gap and goes asynchronous.
    const T1 = T0 + 10_000 + 2 * HOUR * 1000;
    const prePollState = state;
    const prePollClock = clock;
    const polled = planPoll(clock, T1, state.tickDurationSeconds, 1);
    clock = polled.clock;
    const plan = polled.plan as AdvancePlan;
    expect(plan.mode).toBe("catchUp");
    const beforeEconomy = { ...state, gameTimeSeconds: state.gameTimeSeconds + plan.realElapsedSeconds };
    const c1 = new CatchUpController({ onView: () => {}, now: fakeClock(1), yieldToBrowser: () => Promise.resolve() });
    const wentAsync = !c1.pay(beginPollCatchUp(beforeEconomy, plan, lcg(5), T1), "x", (done) => (state = finishPollCatchUp(beforeEconomy, done)));
    expect(wentAsync).toBe(true);
    // THE FIX: one save, now, of the pre-poll state paid through the pre-poll clock.
    const snapshot = asyncCatchUpSave(prePollState, prePollClock, T1);
    saved = { state: snapshot.state, lastSavedAt: snapshot.paidThroughMs };
    expect(saved.state).toBe(withAction);
    expect(saved.lastSavedAt).toBe(T0 + 10_000);
    // The overlay says closing is safe; the player closes the tab mid-run.
    for (let i = 0; i < 100; i++) await Promise.resolve();
    expect(c1.busy).toBe(true);
    c1.dispose();

    // Reload an hour later, from that save.
    const T2 = T1 + HOUR * 1000;
    const c2 = new CatchUpController({ onView: () => {}, now: fakeClock(1), yieldToBrowser: () => Promise.resolve() });
    let reloaded: GameState | null = null;
    c2.pay(beginTickJob((T2 - saved.lastSavedAt) / 1000, saved.state, lcg(9), T2), "x", (d) => (reloaded = d.state));
    await settle(c2);
    // The action is kept...
    expectSameState(reloaded!, tick((T2 - (T0 + 10_000)) / 1000, withAction, lcg(9), T2), "reload from the async-start save");
    // ...and every second from T0 to T2 is paid exactly once: ten live seconds, then the reload's span.
    expect(reloaded!.gameTimeSeconds).toBe(S0.gameTimeSeconds + (T2 - T0) / 1000);
    // Without the fix the save would still be S0: the reload would pay T0..T2 from it and the purchase would be gone.
    const withoutFix = tick((T2 - T0) / 1000, S0, lcg(9), T2);
    expect(JSON.stringify(withoutFix)).not.toBe(JSON.stringify(reloaded));
  });

  it("the reload path has no such gap: the state it runs from IS the save on disk", () => {
    // Nothing can act during an asynchronous reload run (the game is inert and the loop has not started), and the
    // run starts from loadedSave.state, so the save on disk already holds everything the run would hold.
    // 0.14.0 port: the run starts from the save minus only its one-shot fuel refund note (WR-4), never from any
    // state the player could have changed.
    const APP = readFileSync("src/App.svelte", "utf-8").replace(/\r\n/g, "\n");
    expect(APP).toContain("const { fuelRefundCredits: _fuelRefundNote, ...loadedState } = loadedSave.state;");
    expect(APP).toContain("const beforeSnapshot: GameState = loadedState;");
    expect(APP).toContain("beginTickJob(offlineSeconds, beforeSnapshot, Math.random, returnedAtMs)");
  });
});

// Finding 3 and 5 of the 0.13.11.4 review: error paths and a job that cannot progress.
describe("a failed or stuck run never hangs and never strands queued work", () => {
  it("a run that throws closes the overlay, reports the failure, and still runs the deferred callbacks", async () => {
    const s0 = patrolFleet({ patrols: 1, spares: 0 });
    const views: (CatchUpView | null)[] = [];
    const order: string[] = [];
    let throwAt = 50;
    let t = 0;
    const controller = new CatchUpController({
      onView: (v) => views.push(v),
      now: () => {
        if (--throwAt === 0) throw new Error("boom");
        return (t += 1);
      },
      yieldToBrowser: () => Promise.resolve(),
      syncMaxMs: 0,
      probeMs: 5,
      onError: () => order.push("onError"),
    });
    const wentAsync = !controller.pay(beginTickJob(HOUR, s0, lcg(1)), "x", () => order.push("applied"), () => order.push("failed"));
    expect(wentAsync).toBe(true);
    controller.whenIdle(() => order.push("recap"));
    await settle(controller);
    expect(controller.busy).toBe(false);
    expect(order).toEqual(["onError", "failed", "recap"]);
    expect(views[views.length - 1]).toBeNull();
  });

  it("a span that is not a finite positive tick count is the no-op job (and tick() returns the input)", () => {
    const s0 = patrolFleet({ patrols: 1, spares: 0 });
    for (const bad of [{ ...s0, tickDurationSeconds: 0 }, { ...s0, tickDurationSeconds: Number.NaN }]) {
      const job = beginTickJob(HOUR, bad);
      expect(job.callsTotal).toBe(0);
      expect(tickJobDone(job)).toBe(true);
      expect(tick(HOUR, bad)).toBe(bad);
    }
    const nanSpan = beginTickJob(Number.NaN, s0);
    expect(nanSpan.callsTotal).toBe(0);
    expect(tick(Number.NaN, s0)).toBe(s0);
  });

  it("a job whose slice makes no call ends the run with what it has, so the overlay cannot hang", async () => {
    const s0 = patrolFleet({ patrols: 1, spares: 0 });
    // A job that claims calls it cannot make (never built by beginTickJob, which now refuses such spans).
    const stuck = { ...beginTickJob(10, s0, lcg(1)), callsTotal: 5, wholeSteps: 0, frac: 0 };
    expect(advanceTickJob(stuck, 1)).toBe(0);
    expect(runCatchUpSlice(stuck, 1_000_000, fakeClock(1))).toBe(0);
    const views: (CatchUpView | null)[] = [];
    const controller = new CatchUpController({ onView: (v) => views.push(v), now: fakeClock(1), yieldToBrowser: () => Promise.resolve(), syncMaxMs: 0 });
    let applied: GameState | null = null;
    expect(controller.pay(stuck, "x", (d) => (applied = d.state))).toBe(false);
    await settle(controller);
    expect(controller.busy).toBe(false);
    expect(applied).toBe(s0);
    expect(views[views.length - 1]).toBeNull();
  });
});

// Finding 4 of the 0.13.11.4 review: a visibility return whose poll goes asynchronous raises ONE recap, covering
// the absence AND the run's own time. The model is App.svelte's onVisibilityChange / finish / recapAway in
// miniature: the away tally is open while hidden, finish defers itself while the run is in flight, then polls
// (paying the run's own time into the same tally) and recaps once.
describe("a return whose poll goes asynchronous recaps once", () => {
  it("one recap line covering the absence plus the run's own time", { timeout: SLOW }, async () => {
    const T0 = END_MS;
    let state = patrolFleet({ patrols: 2, spares: 20 });
    let clock: LoopClock = startLoopClock(T0);
    let away: (AwayTally & { atMs: number }) | null = null;
    const recaps: number[] = [];
    let wall = T0;
    const controller = new CatchUpController({ onView: () => {}, now: fakeClock(1), yieldToBrowser: () => Promise.resolve() });

    const poll = () => {
      if (controller.busy) return;
      const polled = planPoll(clock, wall, state.tickDurationSeconds, 1);
      clock = polled.clock;
      const plan = polled.plan as AdvancePlan;
      if (plan.mode === "none") return;
      const before = { ...state, gameTimeSeconds: state.gameTimeSeconds + plan.realElapsedSeconds };
      const after = (paid: GameState) => {
        state = paid;
        const pollPaid = paidRealSeconds(plan, before);
        if (away !== null) away = { ...away, ...tallyAwayPoll(away, pollPaid, null) };
        else if (plan.mode === "catchUp" && pollPaid >= 120) recaps.push(pollPaid); // welcomeBack's visible-gap line
      };
      if (plan.mode === "catchUp") {
        controller.pay(beginPollCatchUp(before, plan, lcg(3), wall), "x", (done) => after(finishPollCatchUp(before, done)));
      } else {
        after(runPollEconomy(before, plan, lcg(3), wall));
      }
    };
    const recapAway = () => {
      const a = away;
      away = null;
      if (a !== null && a.paidSeconds >= 120) recaps.push(a.paidSeconds);
    };
    const finish = (): void => {
      if (controller.busy) return controller.whenIdle(finish);
      poll();
      controller.whenIdle(recapAway);
    };

    // Hidden for three hours.
    away = { atMs: T0, paidSeconds: 0, awaySeconds: 0, cappedAwaySeconds: null };
    wall = T0 + 3 * HOUR * 1000;
    // Shown: the return poll goes asynchronous; finish defers itself behind it.
    poll();
    expect(controller.busy).toBe(true);
    finish();
    // The run takes 40 s of real time on a slow phone.
    wall += 40_000;
    await settle(controller);
    // Every later 100 ms poll: nothing more is owed, and nothing more is recapped.
    for (let i = 0; i < 5; i++) {
      wall += 100;
      poll();
    }
    expect(recaps).toEqual([3 * HOUR + 40]);
  });
});

