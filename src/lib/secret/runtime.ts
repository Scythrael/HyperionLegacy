// runtime.ts: keeps the secret game running inside the app (0.13.11).
//
// NOTE: ITS OWN TICKER, ITS OWN STATE. This never touches the main GameState, never runs inside
// economyTick or pollGameLoop, and never pauses, throttles or blocks the main loop. It is a plain
// 1-second interval that advances the secret state to the wall clock (catchUp.advanceTo), so a
// throttled background tab or a sleeping laptop simply means a bigger gap next time, paid by the
// same catch-up rules as a closed browser.
//
// Large gaps (app load after an absence, waking from sleep, the overlay opening) run as a SLICED
// catch-up job: a few thousand steps per macrotask, so the main game's own timers and the UI keep
// running while the secret game catches up. Saves go to the secret game's own key every 30 seconds,
// when the tab is hidden and on unload.

import { writable, type Readable } from "svelte/store";
import { freshSecretState, loadSecret, saveSecret, clearSecretSave, type SecretState } from "./state";
import { advanceTo, createCatchUp, type CatchUpJob } from "./catchUp";
import { safeGetItem, safeSetItem } from "../safeStorage";

const TICK_MS = 1000;
const SAVE_MS = 30000;
const SLICE_STEPS = 1500;
// Gaps up to this many seconds are paid inline on the tick; anything longer runs sliced.
const INLINE_SECONDS = 60;

let state: SecretState = freshSecretState(Date.now());
const store = writable<SecretState>(state);
const catching = writable<boolean>(false);

// The live secret game state. Read-only to components: change it through secretAct.
export const secretGame: Readable<SecretState> = { subscribe: store.subscribe };
// True while a sliced catch-up is still running (the overlay says so and holds its buttons).
export const secretCatchingUp: Readable<boolean> = { subscribe: catching.subscribe };

let job: CatchUpJob | null = null;
let jobTimer: ReturnType<typeof setTimeout> | null = null;

function publish(next: SecretState): void {
  state = next;
  store.set(next);
}

function persist(): void {
  saveSecret(state);
}

function finishJob(): void {
  if (!job) return;
  job.run(Infinity);
  publish(job.result().state);
  stopJob();
  persist();
}

function stopJob(): void {
  if (jobTimer !== null) clearTimeout(jobTimer);
  jobTimer = null;
  job = null;
  catching.set(false);
}

function runSlice(): void {
  jobTimer = null;
  if (!job) return;
  if (job.run(SLICE_STEPS)) {
    publish(job.result().state);
    stopJob();
    persist();
    return;
  }
  jobTimer = setTimeout(runSlice, 0);
}

// Brings the state up to now: inline for a short gap, sliced for a long one.
function advance(nowMs: number): void {
  if (job) return; // a sliced catch-up is already on its way
  const gap = (nowMs - state.lastTickAt) / 1000;
  if (gap <= INLINE_SECONDS) {
    const r = advanceTo(state, nowMs);
    if (r.state !== state) publish(r.state);
    return;
  }
  job = createCatchUp(state, nowMs);
  catching.set(true);
  jobTimer = setTimeout(runSlice, 0);
}

export function catchUpSecretNow(): void {
  advance(Date.now());
}

// Applies a player action (buy, prestige, skill, setting) to the current state and saves it.
export function secretAct(fn: (s: SecretState, nowMs: number) => SecretState): void {
  finishJob();
  const nowMs = Date.now();
  const caught = advanceTo(state, nowMs).state;
  publish(fn(caught, nowMs));
  persist();
}

// Delete Save and Debug "Reset save" call this: the secret save goes too, so recorded milestones
// never carry into a fresh game (user, builder check Q3).
export function wipeSecretGame(): void {
  stopJob();
  clearSecretSave();
  publish(freshSecretState(Date.now()));
}

// Dev only (Debug tab): pretend the secret game was away for `seconds` and pay it through the real
// catch-up path.
export function devFastForwardSecret(seconds: number): void {
  finishJob();
  publish({ ...state, lastTickAt: state.lastTickAt - seconds * 1000 });
  advance(Date.now());
}

let running = false;

export function startSecretRuntime(): () => void {
  if (running) return () => {};
  running = true;
  publish(loadSecret(Date.now()));
  advance(Date.now());
  const tick = setInterval(() => advance(Date.now()), TICK_MS);
  const save = setInterval(() => {
    if (!job) persist();
  }, SAVE_MS);
  const hasDom = typeof document !== "undefined" && typeof window !== "undefined";
  const onVisibility = () => {
    if (document.hidden) {
      if (!job) persist();
    } else {
      advance(Date.now());
    }
  };
  const onUnload = () => {
    if (job) finishJob();
    else persist();
  };
  if (hasDom) {
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onUnload);
  }
  return () => {
    clearInterval(tick);
    clearInterval(save);
    if (hasDom) {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onUnload);
    }
    if (job) finishJob();
    else persist();
    running = false;
  };
}

// ---------------------------------------------------------------------------
// The "NEW" tag on Settings > Codes: device-side, shown until the sub-tab is opened once.
// Blocked storage reads as "not seen" and the write is a silent no-op (the tag just stays).
// ---------------------------------------------------------------------------

export const CODES_SEEN_KEY = "hl_codes_tab_seen";

export function codesTabSeen(): boolean {
  return safeGetItem(CODES_SEEN_KEY) === "1";
}

export function markCodesTabSeen(): void {
  safeSetItem(CODES_SEEN_KEY, "1");
}
