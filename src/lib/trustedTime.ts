// trustedTime.ts: the ONE wall clock every progress system reads (0.13.11.1).
//
// User, 2026-10-23: "Make sure this is the case across the board for everything in the game.
// Imperative that this is the case so you can't jump from 1970 to 2099 and so forth."
// Everything that pays progress for elapsed time (the main game's live poll, its reload catch-up
// and save stamps, the minigame's ticker and catch-up) reads trustedNow() instead of Date.now().
//
// THE RULES
//   1. HIGH-WATER MARK. Trusted time never goes backward. The mark (`floorMs`) is persisted and also
//      raised from every save's own stamp, so a span already paid is never paid again. While the
//      device clock is behind the mark (the clock was set back), the session keeps advancing from
//      performance.now() deltas, so open play works at real speed; nothing is re-anchored.
//   2. FORWARD JUMPS. When the server's time is known (a same-origin no-store HEAD request, read the
//      Date header; never the Age header, see syncServerTime), trusted time is at most server time +
//      SERVER_TOLERANCE_MS. When it is not (offline, or the request failed), at most a fixed base +
//      UNVERIFIED_ALLOWANCE_MS (2 days, the main game's own offline cap). The base is the last time
//      the SERVER confirmed (`verifiedMs`, never a device reading), or, before any server reading,
//      a one-time anchor (`anchorMs`: the newest save stamp, or a brand-new device's first reading).
//      Neither moves with reloads, so the allowance is paid once, never per reload. Anything the
//      device claims beyond that is HELD: not paid now, not lost either (every system pays from its
//      own stamp, which stays where it was paid to); it is paid as real time catches up or as soon
//      as a server check confirms the device.
//   3. HONEST CLOCKS SEE NO CHANGE. A device clock that only moves forward and agrees with the
//      server to within the tolerance is returned exactly (trustedNow() === Date.now()), so the main
//      game's offline catch-up, its goldens and offline == live parity are byte-identical. A small
//      correction backward (a few minutes) just keeps counting from the monotonic clock until the
//      device catches up; a small correction forward is within the tolerance. Daylight saving
//      changes the displayed time only, never the epoch milliseconds read here.
//   4. SELF-HEAL. When a server reading proves trusted time is more than the allowance AHEAD of the
//      server (a save stamped while a clock was far ahead, or a tester's 2099 run), trusted time
//      steps down to server time once. The main loop rebases on a backward clock (advanceCycle) and
//      the minigame rebases a stamp that is ahead (catchUp), so neither freezes and nothing is paid.
//   5. A SUSPENDED DEVICE. performance.now() stops during system sleep on many phones and laptops,
//      so after a sleep the session anchor alone would pay only the tolerance. Whenever time is
//      held while anchored, trustedNow() asks the server again (at most every 30 s), and the main
//      game's return-from-away waits briefly for that answer before its recap (confirmTrustedTime).
//
// The rules are pure functions (readTrusted, withServerTime) so every case is tested without a
// browser.

import { safeGetItem, safeSetItem } from "./safeStorage";

export const SERVER_TOLERANCE_MS = 10 * 60 * 1000;
export const UNVERIFIED_ALLOWANCE_MS = 2 * 24 * 60 * 60 * 1000;
const SYNC_MIN_GAP_MS = 30 * 1000;
// While time is held the checks back off: 30 s, 1 min, 2 min ... up to 10 min (final re-check), so a
// device clock left fast does not send a HEAD every 30 seconds forever.
const HELD_GAP_MAX_MS = 10 * 60 * 1000;
const PERSIST_EVERY_MS = 30 * 1000;

export interface StoredTrust {
  floorMs: number;
  verifiedMs: number | null;
  anchorMs?: number | null;
}

export interface TrustState {
  floorMs: number; // the high-water mark (0: nothing known yet)
  lastTrustedMs: number; // the last trusted reading
  lastPerfMs: number; // performance.now() at that reading
  verifiedMs: number | null; // the latest time the SERVER confirmed (persisted; never a device reading)
  anchorMs: number | null; // the unverified base before any server reading (persisted, set once)
  server: { serverMs: number; perfMs: number } | null; // this session's server anchor
}

export function freshTrustState(perfMs: number): TrustState {
  return { floorMs: 0, lastTrustedMs: 0, lastPerfMs: perfMs, verifiedMs: null, anchorMs: null, server: null };
}

// Start a session: the stored mark and bases, raised by every save stamp the caller knows. With no
// stored base, the newest save stamp is the anchor (an existing player's first load).
export function initTrustState(stored: StoredTrust | null, stamps: readonly (number | null | undefined)[], perfMs: number): TrustState {
  const known = stamps.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const floorMs = Math.max(stored?.floorMs ?? 0, ...known, 0);
  const verifiedMs = stored?.verifiedMs ?? null;
  const anchorMs = stored?.anchorMs ?? (verifiedMs === null && known.length > 0 ? Math.max(...known) : null);
  return { floorMs, lastTrustedMs: floorMs, lastPerfMs: perfMs, verifiedMs, anchorMs, server: null };
}

const serverNowOf = (st: TrustState, perfMs: number): number | null => (st.server ? st.server.serverMs + (perfMs - st.server.perfMs) : null);

// The latest time trusted time may reach right now.
function ceiling(st: TrustState, deviceMs: number, perfMs: number): number {
  const serverNow = serverNowOf(st, perfMs);
  if (serverNow !== null) return serverNow + SERVER_TOLERANCE_MS;
  return (st.verifiedMs ?? st.anchorMs ?? deviceMs) + UNVERIFIED_ALLOWANCE_MS;
}

export function readTrusted(st: TrustState, deviceMs: number, perfMs: number): { state: TrustState; nowMs: number; heldMs: number } {
  const mono = st.lastTrustedMs + Math.max(0, perfMs - st.lastPerfMs);
  // Never backward, and an open session always keeps real speed (mono) even while unverified.
  const cap = Math.max(ceiling(st, deviceMs, perfMs), mono, st.lastTrustedMs);
  const nowMs = deviceMs >= st.lastTrustedMs ? Math.min(deviceMs, cap) : Math.min(Math.max(mono, st.lastTrustedMs), cap);
  // Only the server's own time is ever recorded as verified (no tolerance, no device reading).
  const serverNow = serverNowOf(st, perfMs);
  const verifiedMs = serverNow !== null ? Math.max(st.verifiedMs ?? -Infinity, serverNow) : st.verifiedMs;
  // Before any server reading, the first reading of a brand-new device is its one-time anchor.
  const anchorMs = st.anchorMs ?? (verifiedMs === null ? nowMs : null);
  return {
    state: { ...st, floorMs: Math.max(st.floorMs, nowMs), lastTrustedMs: nowMs, lastPerfMs: perfMs, verifiedMs, anchorMs },
    nowMs,
    heldMs: Math.max(0, deviceMs - nowMs),
  };
}

// Anchor the session to the server's clock (serverMs read at perfMs). Records the server's time as
// verified, and steps trusted time down to it when trusted time is more than the allowance ahead.
export function withServerTime(st: TrustState, serverMs: number, perfMs: number): TrustState {
  if (!Number.isFinite(serverMs)) return st;
  const next: TrustState = { ...st, server: { serverMs, perfMs }, verifiedMs: Math.max(st.verifiedMs ?? -Infinity, serverMs) };
  if (Math.max(st.floorMs, st.lastTrustedMs) > serverMs + UNVERIFIED_ALLOWANCE_MS) {
    return { ...next, floorMs: serverMs, lastTrustedMs: serverMs, lastPerfMs: perfMs };
  }
  return next;
}

// ---------------------------------------------------------------------------
// The session singleton
// ---------------------------------------------------------------------------

const KEY = "hl_trusted_time";

function perfNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

const finiteOrNull = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

function loadStored(): StoredTrust | null {
  try {
    const raw = JSON.parse(safeGetItem(KEY) ?? "null") as { floorMs?: unknown; verifiedMs?: unknown; anchorMs?: unknown } | null;
    if (!raw || typeof raw.floorMs !== "number" || !Number.isFinite(raw.floorMs)) return null;
    return { floorMs: raw.floorMs, verifiedMs: finiteOrNull(raw.verifiedMs), anchorMs: finiteOrNull(raw.anchorMs) };
  } catch {
    return null;
  }
}

let session: TrustState | null = null;
let lastHeldMs = 0;
let lastPersistedFloor = -Infinity;
let lastSyncAttemptMs = -Infinity; // device time of the last server check (rate limiting only)
let heldGapMs = SYNC_MIN_GAP_MS; // the current back-off while time is held
let testFetcher: Fetcher | undefined; // tests only

// A check while time is held, at most once per back-off gap; each one doubles the gap.
function heldSyncDue(): boolean {
  if (Date.now() - lastSyncAttemptMs < heldGapMs) return false;
  heldGapMs = Math.min(heldGapMs * 2, HELD_GAP_MAX_MS);
  return true;
}
// Nothing is written before initTrustedTime: a reading taken earlier must never reach storage.
let initialized = false;

function current(): TrustState {
  if (session === null) session = initTrustState(loadStored(), [], perfNow());
  return session;
}

// Start (or restart) the session with every save stamp known. Built from storage and the stamps
// only: a reading taken before this call (a module-level default, say) must never become the mark
// or the base, or a device clock far ahead would be adopted. A server anchor already taken is kept.
export function initTrustedTime(stamps: readonly (number | null | undefined)[]): void {
  const before = session;
  const fresh = initTrustState(loadStored(), stamps, perfNow());
  session = before?.server ? withServerTime(fresh, before.server.serverMs, before.server.perfMs) : fresh;
  initialized = true;
}

// Raise the mark from a stamp read later (the minigame's own save).
export function raiseTrustedFloor(stampMs: number | null | undefined): void {
  if (typeof stampMs !== "number" || !Number.isFinite(stampMs)) return;
  const st = current();
  if (stampMs > st.floorMs) session = { ...st, floorMs: stampMs, lastTrustedMs: Math.max(st.lastTrustedMs, stampMs) };
}

export function trustedNow(): number {
  const r = readTrusted(current(), Date.now(), perfNow());
  session = r.state;
  lastHeldMs = r.heldMs;
  if (r.state.floorMs - lastPersistedFloor >= PERSIST_EVERY_MS) persistTrustedTime();
  // Rule 5: anchored but holding more than the tolerance (a suspended device, most likely): ask again.
  if (r.heldMs <= SERVER_TOLERANCE_MS) heldGapMs = SYNC_MIN_GAP_MS;
  else if (r.state.server && heldSyncDue()) void syncServerTime();
  return r.nowMs;
}

// Where trusted time comes from right now. User, 2026-10-23: the game will be online and run on the
// server's clock; this module already treats the server as the source of truth and the device as a
// stopgap fallback, so 0.14.1 can make trustedNow() the server clock with no gameplay change.
export type TrustedTimeSource = "server" | "device";
export function trustedTimeSource(): TrustedTimeSource {
  return current().server ? "server" : "device";
}

// How much the device clock is ahead of what is trusted (0 for an honest clock).
export function trustedHeldMs(): number {
  return lastHeldMs;
}

export function persistTrustedTime(): void {
  if (!initialized) return;
  const st = current();
  lastPersistedFloor = st.floorMs;
  safeSetItem(KEY, JSON.stringify({ floorMs: st.floorMs, verifiedMs: st.verifiedMs, anchorMs: st.anchorMs }));
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

// Ask the server what time it is. Same origin, no-store, HEAD: only the Date header is
// read. Any failure (offline, no fetch at all, an error status, no Date header) leaves the
// unverified rules in place.
async function requestServerTime(fetcher?: Fetcher): Promise<boolean> {
  try {
    lastSyncAttemptMs = Date.now();
    const f: Fetcher | undefined = fetcher ?? testFetcher ?? (typeof fetch === "function" ? fetch : undefined);
    if (!f || typeof location === "undefined") return false;
    const t0 = perfNow();
    const res = await f(`${location.origin}/`, { method: "HEAD", cache: "no-store" });
    const t1 = perfNow();
    const date = res.headers.get("date");
    if (!res.ok || !date) return false;
    const parsed = Date.parse(date);
    if (!Number.isFinite(parsed)) return false;
    // The Date header alone. Never Age: Vercel's edge stamps Date at response time even on a cache hit,
    // and that hit also carries an Age (seen: 116002 s, 32 hours, with no-cache request headers), so
    // adding it would read the server 32 hours ahead and growing (final re-check H1).
    // The header has whole seconds: take the midpoint of the request and half a second.
    session = withServerTime(current(), parsed + 500, (t0 + t1) / 2);
    persistTrustedTime();
    return true;
  } catch {
    return false;
  }
}

// One check at a time: a second caller (the return from away) waits on the one already asking.
let inflight: Promise<boolean> | null = null;
export function syncServerTime(fetcher?: Fetcher): Promise<boolean> {
  if (inflight && !fetcher) return inflight;
  const p = requestServerTime(fetcher).finally(() => {
    if (inflight === p) inflight = null;
  });
  inflight = p;
  return p;
}

// A server check unless one ran in the last 30 seconds and nothing is held (tab returns).
export function syncServerTimeIfDue(fetcher?: Fetcher): Promise<boolean> {
  if (lastHeldMs <= SERVER_TOLERANCE_MS ? Date.now() - lastSyncAttemptMs < SYNC_MIN_GAP_MS : !heldSyncDue()) return Promise.resolve(false);
  return syncServerTime(fetcher);
}

// When more than the tolerance is held, wait (at most timeoutMs) for the server to confirm the
// clock, so a return from a sleep is paid and recapped in full. Resolves either way.
export async function confirmTrustedTime(timeoutMs = 3000, fetcher?: Fetcher): Promise<void> {
  if (lastHeldMs <= SERVER_TOLERANCE_MS) return;
  // A check already on its way (trustedNow starts one when time is held) is waited for; otherwise a
  // return long after the last check (a sleep) asks, and quick returns follow the back-off.
  const asking = inflight ?? (heldSyncDue() ? syncServerTime(fetcher) : null);
  if (asking === null) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([asking.then(() => undefined), timeout]);
  if (timer !== undefined) clearTimeout(timer);
  trustedNow();
}

// Tests only: the request the automatic checks make.
export function setTrustedFetcherForTests(f: Fetcher | undefined): void {
  testFetcher = f;
}

// Tests only.
export function resetTrustedTimeForTests(): void {
  session = null;
  lastHeldMs = 0;
  lastPersistedFloor = -Infinity;
  lastSyncAttemptMs = -Infinity;
  heldGapMs = SYNC_MIN_GAP_MS;
  testFetcher = undefined;
  inflight = null;
  initialized = false;
}
