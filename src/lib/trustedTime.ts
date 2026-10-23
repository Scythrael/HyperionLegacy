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
//      Date header), trusted time is at most server time + SERVER_TOLERANCE_MS. When it is not
//      (offline, or the request failed), at most the last VERIFIED time + UNVERIFIED_ALLOWANCE_MS
//      (2 days, the main game's own offline cap). Anything the device claims beyond that is HELD:
//      it is not paid now, and it is not lost either, because every system pays from its own
//      stamp, which stays where it was paid to; the rest is paid as real time catches up or as
//      soon as a server check confirms the device.
//   3. HONEST CLOCKS SEE NO CHANGE. A device clock that only moves forward and agrees with the
//      server to within the tolerance is returned exactly (trustedNow() === Date.now()), so the main
//      game's offline catch-up, its goldens and offline == live parity are byte-identical. A small
//      correction backward (a few minutes) just keeps counting from the monotonic clock until the
//      device catches up; a small correction forward is within the tolerance. Daylight saving
//      changes the displayed time only, never the epoch milliseconds read here.
//
// The rules are a pure function (readTrusted) so every case is tested without a browser.

import { safeGetItem, safeSetItem } from "./safeStorage";

export const SERVER_TOLERANCE_MS = 10 * 60 * 1000;
export const UNVERIFIED_ALLOWANCE_MS = 2 * 24 * 60 * 60 * 1000;

export interface TrustState {
  floorMs: number; // the high-water mark (0: nothing known yet)
  lastTrustedMs: number; // the last trusted reading
  lastPerfMs: number; // performance.now() at that reading
  verifiedMs: number | null; // the latest trusted time confirmed against the server (persisted)
  server: { serverMs: number; perfMs: number } | null; // this session's server anchor
}

export function freshTrustState(perfMs: number): TrustState {
  return { floorMs: 0, lastTrustedMs: 0, lastPerfMs: perfMs, verifiedMs: null, server: null };
}

// Start a session: the stored mark and verification, raised by every save stamp the caller knows.
export function initTrustState(stored: { floorMs: number; verifiedMs: number | null } | null, stamps: readonly (number | null | undefined)[], perfMs: number): TrustState {
  const known = stamps.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const floorMs = Math.max(stored?.floorMs ?? 0, ...known, 0);
  return { floorMs, lastTrustedMs: floorMs, lastPerfMs: perfMs, verifiedMs: stored?.verifiedMs ?? null, server: null };
}

// The latest time trusted time may reach right now.
function ceiling(st: TrustState, deviceMs: number, perfMs: number): number {
  if (st.server) return st.server.serverMs + (perfMs - st.server.perfMs) + SERVER_TOLERANCE_MS;
  const base = st.verifiedMs ?? (st.floorMs > 0 ? st.floorMs : deviceMs);
  return base + UNVERIFIED_ALLOWANCE_MS;
}

export function readTrusted(st: TrustState, deviceMs: number, perfMs: number): { state: TrustState; nowMs: number; heldMs: number } {
  const mono = st.lastTrustedMs + Math.max(0, perfMs - st.lastPerfMs);
  // Never backward, and an open session always keeps real speed (mono) even while unverified.
  const cap = Math.max(ceiling(st, deviceMs, perfMs), mono, st.lastTrustedMs);
  const nowMs = deviceMs >= st.lastTrustedMs ? Math.min(deviceMs, cap) : Math.min(Math.max(mono, st.lastTrustedMs), cap);
  // Online, every reading is verified. Offline, the base stays where it was last verified (on a
  // brand new device, its first reading), so the allowance is a one-time loan, never repeatable.
  const verifiedMs = st.server ? Math.max(st.verifiedMs ?? 0, nowMs) : st.verifiedMs ?? nowMs;
  return {
    state: { ...st, floorMs: Math.max(st.floorMs, nowMs), lastTrustedMs: nowMs, lastPerfMs: perfMs, verifiedMs },
    nowMs,
    heldMs: Math.max(0, deviceMs - nowMs),
  };
}

// Anchor the session to the server's clock (the request's midpoint absorbs the round trip).
export function withServerTime(st: TrustState, serverMs: number, perfMs: number): TrustState {
  return Number.isFinite(serverMs) ? { ...st, server: { serverMs, perfMs } } : st;
}

// ---------------------------------------------------------------------------
// The session singleton
// ---------------------------------------------------------------------------

const KEY = "hl_trusted_time";

function perfNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function loadStored(): { floorMs: number; verifiedMs: number | null } | null {
  try {
    const raw = JSON.parse(safeGetItem(KEY) ?? "null") as { floorMs?: unknown; verifiedMs?: unknown } | null;
    if (!raw || typeof raw.floorMs !== "number" || !Number.isFinite(raw.floorMs)) return null;
    return { floorMs: raw.floorMs, verifiedMs: typeof raw.verifiedMs === "number" && Number.isFinite(raw.verifiedMs) ? raw.verifiedMs : null };
  } catch {
    return null;
  }
}

let session: TrustState | null = null;
let lastHeldMs = 0;
let lastPersistedFloor = -1;

function current(): TrustState {
  if (session === null) session = initTrustState(loadStored(), [], perfNow());
  return session;
}

// Start (or restart) the session with every save stamp known. Safe to call more than once: the mark
// only ever rises.
export function initTrustedTime(stamps: readonly (number | null | undefined)[]): void {
  const before = session;
  const fresh = initTrustState(loadStored(), [...stamps, before?.floorMs], perfNow());
  session = before ? { ...fresh, lastTrustedMs: Math.max(before.lastTrustedMs, fresh.floorMs), server: before.server, verifiedMs: before.verifiedMs ?? fresh.verifiedMs } : fresh;
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
  if (r.state.floorMs - lastPersistedFloor > 5000) persistTrustedTime();
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
  const st = current();
  lastPersistedFloor = st.floorMs;
  safeSetItem(KEY, JSON.stringify({ floorMs: st.floorMs, verifiedMs: st.verifiedMs }));
}

// Ask the server what time it is. Same origin, no-store, HEAD: only the Date header is read. Any
// failure (offline, an error status, no header) leaves the unverified rules in place.
export async function syncServerTime(fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch): Promise<boolean> {
  try {
    if (typeof location === "undefined") return false;
    const t0 = perfNow();
    const res = await fetcher(`${location.origin}/`, { method: "HEAD", cache: "no-store" });
    const t1 = perfNow();
    const date = res.headers.get("date");
    if (!res.ok || !date) return false;
    const serverMs = Date.parse(date);
    if (!Number.isFinite(serverMs)) return false;
    // The header has whole seconds: take the midpoint of the request and half a second.
    session = withServerTime(current(), serverMs + 500, (t0 + t1) / 2);
    persistTrustedTime();
    return true;
  } catch {
    return false;
  }
}

// Tests only.
export function resetTrustedTimeForTests(): void {
  session = null;
  lastHeldMs = 0;
  lastPersistedFloor = -1;
}
