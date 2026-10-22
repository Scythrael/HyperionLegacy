// runtime.ts: keeps the secret game running inside the app (0.13.11).
//
// NOTE: ITS OWN TICKER, ITS OWN STATE. This never touches the main GameState, never runs inside
// economyTick or pollGameLoop, and never pauses, throttles or blocks the main loop. It is a plain
// 1-second interval that advances the secret state to the wall clock (catchUp.advanceTo), so a
// throttled background tab or a sleeping laptop simply means a bigger gap next time, paid by the
// same catch-up rules as a closed browser.
//
// Gaps over a minute (app load after an absence, waking from sleep, the overlay opening) run as a
// TIME-SLICED catch-up job, about 8 ms of work per macrotask, so the main game's own timers and the
// UI keep running while the secret game catches up. While a job runs, player actions are refused
// (the overlay disables its controls) rather than forcing the rest of the job through at once.
//
// NOTE: NOTHING HERE MAY THROW INTO THE APP. Every entry point is guarded; on an error the job is
// dropped, the last good state is kept (and re-advanced on the next tick), so a secret-game bug can
// never break the main game or leave "catching up" stuck on.
//
// Saves go to the secret game's own key every 30 seconds, when the tab is hidden and on unload.
// A save written by a NEWER version of the game is never overwritten (this session runs on a fresh
// game without saving); a corrupt one is kept under the backup key before anything overwrites it.

import { writable, type Readable } from "svelte/store";
import { freshSecretState, inspectSecretSave, saveSecret, clearSecretSave, type SecretState } from "./state";
import { advanceTo, createCatchUp, type CatchUpJob } from "./catchUp";
import { safeGetItem, safeSetItem, safeRemoveItem } from "../safeStorage";

const TICK_MS = 1000;
const SAVE_MS = 30000;
const SLICE_MS = 8;
// Gaps up to this many seconds are paid inline on the tick (at most 60 one-second steps).
const INLINE_SECONDS = 60;

let state: SecretState = freshSecretState(Date.now());
let lastGood: SecretState = state;
let readOnly = false; // a newer version's save is on disk: never overwrite it
const store = writable<SecretState>(state);
const catching = writable<boolean>(false);

// The live secret game state. Read-only to components: change it through secretAct.
export const secretGame: Readable<SecretState> = { subscribe: store.subscribe };
// True while a sliced catch-up is running (the overlay says so and holds its controls).
export const secretCatchingUp: Readable<boolean> = { subscribe: catching.subscribe };

let job: CatchUpJob | null = null;
let jobTimer: ReturnType<typeof setTimeout> | null = null;

function publish(next: SecretState): void {
  state = next;
  lastGood = next;
  store.set(next);
}

function persist(): void {
  if (readOnly) return;
  try {
    saveSecret(state);
  } catch {
    // An unsavable state is not worth breaking anything for; the next good state saves.
  }
}

function stopJob(): void {
  if (jobTimer !== null) clearTimeout(jobTimer);
  jobTimer = null;
  job = null;
  catching.set(false);
}

// Something in the secret game threw: drop any job and keep the last good state.
function recover(): void {
  stopJob();
  state = lastGood;
  store.set(lastGood);
}

function runSlice(): void {
  jobTimer = null;
  if (!job) return;
  try {
    if (job.runFor(SLICE_MS)) {
      const done = job.result().state;
      stopJob();
      publish(done);
      persist();
      return;
    }
    jobTimer = setTimeout(runSlice, 0);
  } catch {
    recover();
  }
}

// Brings the state up to now: inline for a short gap, sliced for a long one.
function advance(nowMs: number): void {
  if (job) return; // a sliced catch-up is already on its way
  try {
    const gap = (nowMs - state.lastTickAt) / 1000;
    if (gap <= INLINE_SECONDS) {
      const r = advanceTo(state, nowMs);
      if (r.state !== state) publish(r.state);
      return;
    }
    job = createCatchUp(state, nowMs);
    catching.set(true);
    jobTimer = setTimeout(runSlice, 0);
  } catch {
    recover();
  }
}

export function catchUpSecretNow(): void {
  advance(Date.now());
}

// Applies a player action (buy, prestige, skill, setting) to the current state and saves it.
// Refused (returns false) while a sliced catch-up is still running.
export function secretAct(fn: (s: SecretState, nowMs: number) => SecretState): boolean {
  if (job) return false;
  try {
    const nowMs = Date.now();
    const caught = advanceTo(state, nowMs).state;
    publish(fn(caught, nowMs));
    persist();
    return true;
  } catch {
    recover();
    return false;
  }
}

// Delete Save and Debug "Reset save" call this: the secret save goes too, so recorded milestones
// never carry into a fresh game (user, builder check Q3).
export function wipeSecretGame(): void {
  stopJob();
  readOnly = false;
  clearSecretSave();
  publish(freshSecretState(Date.now()));
}

// Dev only (Debug tab): pretend the secret game was away for `seconds` and pay it through the real
// catch-up path (sliced, like any long absence).
export function devFastForwardSecret(seconds: number): void {
  if (job) return;
  publish({ ...state, lastTickAt: state.lastTickAt - seconds * 1000 });
  advance(Date.now());
}

let running = false;

export function startSecretRuntime(): () => void {
  if (running) return () => {};
  running = true;
  try {
    const loaded = inspectSecretSave(Date.now());
    readOnly = loaded.status === "future";
    publish(loaded.state);
  } catch {
    publish(freshSecretState(Date.now()));
  }
  advance(Date.now());
  const tick = setInterval(() => advance(Date.now()), TICK_MS);
  const save = setInterval(() => {
    if (!job) persist();
  }, SAVE_MS);
  const hasDom = typeof document !== "undefined" && typeof window !== "undefined";
  // A job's state is only published when it finishes, so the state on hand is always a good,
  // consistent one: saving it (with its older lastTickAt) simply means the next load pays the rest.
  const onVisibility = () => {
    try {
      if (document.hidden) persist();
      else advance(Date.now());
    } catch {
      recover();
    }
  };
  const onUnload = () => persist();
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
    stopJob();
    persist();
    running = false;
  };
}

// ---------------------------------------------------------------------------
// The "NEW" tag on Settings > Codes: device-side, shown until the sub-tab is opened once.
// Design section 3: blocked storage HIDES the tag (it could never be dismissed there).
// ---------------------------------------------------------------------------

export const CODES_SEEN_KEY = "hl_codes_tab_seen";
const STORAGE_PROBE_KEY = "hl_codes_tab_probe";

function storageWritable(): boolean {
  if (!safeSetItem(STORAGE_PROBE_KEY, "1")) return false;
  safeRemoveItem(STORAGE_PROBE_KEY);
  return true;
}

export function codesTabSeen(): boolean {
  if (safeGetItem(CODES_SEEN_KEY) === "1") return true;
  return !storageWritable();
}

export function markCodesTabSeen(): void {
  safeSetItem(CODES_SEEN_KEY, "1");
}
