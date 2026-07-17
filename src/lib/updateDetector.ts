// updateDetector.ts -- client-side "a newer build is deployed" detector.
//
// WHAT: exposes a `updateAvailable` svelte store that flips to true when the build
// currently DEPLOYED (its id read from /version.json, emitted at build time by
// vite.config.ts) differs from the build this client actually BOOTED with
// (__BUILD_ID__, inlined at build time). A UI banner subscribes to the store and
// prompts a reload. Includes a dismiss-snooze so a user who isn't ready to reload
// isn't nagged again for ~3 hours.
//
// WHY a poll + focus check instead of websockets/SSE: this is a static-hosted idle
// game (Vercel). There is no server push channel, so the only portable way to learn
// a fresh deploy landed is to periodically re-fetch the tiny version.json and
// compare. Polling every few minutes plus a check on tab refocus keeps latency low
// without meaningful cost (version.json is a few bytes, cache-busted, no-store).
//
// See src/lib/buildId.ts (id resolution) and vite.config.ts (define + emit).
import { writable } from "svelte/store";

// The banner's single source of truth. Starts false; only ever set true when a
// genuinely newer deployed id is observed (and we're not snoozed).
export const updateAvailable = writable(false);

// How often to re-check for a fresh deploy while the tab is open. 3 minutes is a
// balance: responsive enough that an active player sees a deploy quickly, cheap
// enough that the request volume is negligible for a tiny cache-busted asset.
const POLL_MS = 3 * 60 * 1000; // 3 minutes

// How long a dismiss suppresses the banner before it re-raises. Long enough not to
// pester, short enough that a dismissed-and-forgotten update resurfaces same-session.
const SNOOZE_MS = 3 * 60 * 60 * 1000; // 3 hours

// --- module singletons -------------------------------------------------------
// These persist for the life of the loaded module (one client session). They are
// module-scoped rather than instance state because there is exactly one running
// client and one banner; a class/instance would add ceremony for no benefit.

// Guards startUpdatePolling against double-wiring (duplicate interval + duplicate
// event listeners) if it is ever called more than once.
let started = false;

// True while a dismiss is in effect. While snoozed, polling checks must NOT re-raise
// the banner -- the user already said "not now".
let snoozed = false;

// Handle for the pending snooze timer so it can be cleared on reset. Null when no
// snooze is active.
let snoozeTimeout: ReturnType<typeof setTimeout> | null = null;

// Handle for the recurring poll so it can be cleared on reset. Null when not polling.
let pollInterval: ReturnType<typeof setInterval> | null = null;

// --- pure comparison ---------------------------------------------------------

/**
 * isNewer -- PURE decision: does the fetched (deployed) id represent a build newer
 * than the one we booted with?
 *
 * Returns true ONLY when BOTH ids are non-empty AND they differ. A null / undefined
 * / empty fetchedId (offline, a dev 404, or HTML returned by a misconfigured rewrite
 * that we failed to parse as a build id) MUST return false: we never nag the user on
 * a bad or ambiguous fetch. An empty bootId (should never happen -- buildId.ts
 * guarantees non-empty -- but defended anyway) also returns false.
 *
 * Note: "newer" here means "different". Deploy ids only move forward (a new deploy
 * never serves a previously-booted id), so difference is a sound proxy for newer and
 * avoids needing any ordering/comparison of opaque ids.
 */
export function isNewer(
  bootId: string | null | undefined,
  fetchedId: string | null | undefined,
): boolean {
  if (!bootId) return false; // empty/nullish boot id -> cannot make a claim
  if (!fetchedId) return false; // empty/nullish fetched id -> bad fetch, never nag
  return bootId !== fetchedId;
}

// --- fetch + check -----------------------------------------------------------

/**
 * fetchDeployedBuildId -- read the currently-deployed build id from version.json,
 * or return null on ANY failure (offline, non-2xx, unparseable body, non-string
 * buildId). Errors are swallowed intentionally: a failed version check is a normal,
 * expected event (the user may be offline) and must never spam the console or nag.
 */
async function fetchDeployedBuildId(): Promise<string | null> {
  try {
    // Cache-bust with a timestamp query AND no-store: version.json must reflect the
    // LIVE deploy, not a stale cached copy, or the whole compare is meaningless.
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null; // 404 in dev / bad rewrite -> treat as "no info"
    const data = await res.json();
    const id = (data as { buildId?: unknown })?.buildId;
    // Guard the shape: only a non-empty string is a usable id. Anything else (missing
    // field, HTML parsed oddly, number) is treated as "no info" so isNewer won't nag.
    return typeof id === "string" ? id : null;
  } catch {
    // Network error, JSON parse error, etc. Expected offline; stay silent.
    return null;
  }
}

/**
 * checkForUpdate -- one poll cycle: if snoozed, do nothing (respect the user's
 * dismiss -- and skip the fetch entirely to avoid pointless network cost). Otherwise
 * fetch the deployed id and, if it is genuinely newer, raise the banner.
 */
async function checkForUpdate(bootId: string): Promise<void> {
  if (snoozed) return; // dismiss in effect -> never re-raise until the snooze elapses
  const deployedId = await fetchDeployedBuildId();
  if (isNewer(bootId, deployedId)) {
    updateAvailable.set(true);
  }
}

// --- public API --------------------------------------------------------------

/**
 * startUpdatePolling -- begin watching for fresh deploys. Wires:
 *   1. an immediate check (so a deploy that landed before load is caught at once),
 *   2. a recurring poll every POLL_MS,
 *   3. a check on tab refocus (visibilitychange -> visible, and window focus),
 *      because setInterval is throttled/paused in backgrounded tabs, so a returning
 *      user should get an immediate, fresh check rather than waiting out a stale timer.
 *
 * Idempotent: a second call is a no-op (the `started` guard prevents duplicate
 * intervals and duplicate listeners).
 *
 * bootId defaults to __BUILD_ID__ (the build-time constant this client booted with).
 * It is a parameter so tests can inject a known id without relying on the vite define.
 */
export function startUpdatePolling(bootId: string = __BUILD_ID__): void {
  if (started) return; // already wired -> do not double-wire
  started = true;

  // Immediate check: catch a deploy that shipped between build-time and this load.
  void checkForUpdate(bootId);

  // Recurring poll for deploys that land while the tab stays open and focused.
  pollInterval = setInterval(() => void checkForUpdate(bootId), POLL_MS);

  // Tab-refocus checks. Guarded by typeof so the module is safe to import in a
  // non-DOM context (SSR, or the node test env) where document/window are absent.
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void checkForUpdate(bootId);
    });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("focus", () => void checkForUpdate(bootId));
  }
}

/**
 * dismissUpdate -- user chose "not now". Hide the banner and suppress it for
 * SNOOZE_MS, then re-raise it DIRECTLY (no re-fetch).
 *
 * Re-raising without re-fetching is deliberate and correct: once a newer build is
 * deployed, the served id never reverts to the booted id, so availability is still
 * true after the snooze. Re-raising directly keeps the snooze path free of network
 * and timing coupling (it can't be defeated by an offline blip at the wrong moment).
 */
export function dismissUpdate(): void {
  updateAvailable.set(false);
  snoozed = true;

  // Replace any existing snooze so repeated dismisses don't stack timers.
  if (snoozeTimeout !== null) clearTimeout(snoozeTimeout);
  snoozeTimeout = setTimeout(() => {
    snoozed = false;
    snoozeTimeout = null;
    updateAvailable.set(true); // still-newer build -> re-raise, no fetch needed
  }, SNOOZE_MS);
}

/**
 * resetUpdateDetectorForTests -- TEST-ONLY. Clears every module singleton (the
 * started guard, the snooze flag, the pending snooze timer, the poll interval) and
 * resets the store to false.
 *
 * WHY it exists: the state above is a module singleton that vitest keeps alive across
 * the cases in a file. Without a reset, the `started` guard from one test would make
 * startUpdatePolling a no-op in the next, and a leaked interval/timer would fire into
 * later tests. Do NOT call this from application code.
 */
export function resetUpdateDetectorForTests(): void {
  started = false;
  snoozed = false;
  if (snoozeTimeout !== null) {
    clearTimeout(snoozeTimeout);
    snoozeTimeout = null;
  }
  if (pollInterval !== null) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  updateAvailable.set(false);
}
