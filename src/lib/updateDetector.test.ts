// updateDetector.test.ts, unit tests for the update-detector store + poller.
//
// ENV NOTE: these run under the DEFAULT (node) vitest env, NOT a DOM env. jsdom is
// not a project dependency (not in package.json, not in node_modules) and there is
// no vitest config selecting a DOM environment, so a per-file environment directive
// pointing at jsdom would fail to resolve the environment package (and is also why
// no such directive appears above, vitest scans comments for that token, so even
// naming it verbatim here would wrongly trip environment selection). The module
// under test guards all document/window access behind `typeof` checks (also correct
// for SSR), so the behavior these tests exercise, the immediate fetch-compare
// check, the snooze, and idempotency, runs cleanly under node. The visibilitychange
// and focus listeners are simply skipped when document/window are absent (the node
// case here).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { get } from "svelte/store";
import {
  updateAvailable,
  isNewer,
  startUpdatePolling,
  dismissUpdate,
  resetUpdateDetectorForTests,
} from "./updateDetector";

// SNOOZE_MS is not exported (implementation detail); mirror the value here so the
// timer-advance math in the snooze test is self-documenting. Kept in one const so
// a future change to the window only needs updating in two obvious places.
const SNOOZE_MS = 3 * 60 * 60 * 1000; // 3 hours

// Drain the microtask queue. Under fake timers the microtask queue is NOT faked,
// so awaiting resolved promises still settles the fetch -> json -> set chain kicked
// off by the immediate check (a floating, non-timer promise). Looping a handful of
// turns covers the few awaits in that chain deterministically.
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe("isNewer (pure)", () => {
  it("equal non-empty ids -> false", () => {
    expect(isNewer("abc", "abc")).toBe(false);
  });
  it("different non-empty ids -> true", () => {
    expect(isNewer("boot", "new")).toBe(true);
  });
  it("null fetched id -> false (never nag on a bad fetch)", () => {
    expect(isNewer("boot", null)).toBe(false);
  });
  it("undefined fetched id -> false", () => {
    expect(isNewer("boot", undefined)).toBe(false);
  });
  it("empty-string fetched id -> false", () => {
    expect(isNewer("boot", "")).toBe(false);
  });
  it("empty boot id -> false", () => {
    expect(isNewer("", "new")).toBe(false);
  });
});

describe("update poller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    // The started-guard, snooze flag, and timers are module singletons, wipe them
    // so each case starts clean. Restore mocks + real timers so nothing leaks out.
    resetUpdateDetectorForTests();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("raises updateAvailable when the deployed id differs from the booted id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ buildId: "new" }) })),
    );
    startUpdatePolling("boot");
    await flushMicrotasks(); // settle the immediate check's fetch chain
    expect(get(updateAvailable)).toBe(true);
  });

  it("never nags when the fetch rejects (offline)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    startUpdatePolling("boot");
    await flushMicrotasks();
    expect(get(updateAvailable)).toBe(false);
  });

  it("never nags on a non-ok response (404 / bad rewrite)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    startUpdatePolling("boot");
    await flushMicrotasks();
    expect(get(updateAvailable)).toBe(false);
  });

  it("is idempotent: calling start twice does not double-wire", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ buildId: "new" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    startUpdatePolling("boot");
    startUpdatePolling("boot"); // second call must be a no-op
    await flushMicrotasks();
    // Only the first start's immediate check ran -> exactly one fetch so far.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(get(updateAvailable)).toBe(true);
  });

  it("dismiss snoozes, then re-raises after SNOOZE_MS WITHOUT a re-fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ buildId: "new" }) })),
    );
    startUpdatePolling("boot");
    await flushMicrotasks();
    expect(get(updateAvailable)).toBe(true);

    dismissUpdate();
    expect(get(updateAvailable)).toBe(false);

    // Still inside the snooze window -> stays dismissed.
    await vi.advanceTimersByTimeAsync(SNOOZE_MS - 1);
    expect(get(updateAvailable)).toBe(false);

    // Cross the snooze boundary -> re-raises directly from the snooze timeout.
    await vi.advanceTimersByTimeAsync(1);
    expect(get(updateAvailable)).toBe(true);
  });

  it("a fetch in flight when the user dismisses must NOT re-raise (TOCTOU)", async () => {
    // Regression guard for a time-of-check/time-of-use race: a poll (or focus/
    // visibilitychange) fetch launched while NOT snoozed can resolve AFTER the user
    // clicks dismiss. If the snooze guard is only read before the await, that late
    // resolution wrongly re-raises the banner the user just dismissed. The check must
    // therefore be re-read AFTER the await, before setting the store.

    // Deferred (externally-resolvable) fetch: we hold its resolution so we can wedge a
    // dismiss in between "fetch launched" and "fetch resolved".
    let resolveFetch!: (value: {
      ok: boolean;
      json: () => Promise<{ buildId: string }>;
    }) => void;
    const inFlight = new Promise<{
      ok: boolean;
      json: () => Promise<{ buildId: string }>;
    }>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => inFlight));

    startUpdatePolling("boot"); // immediate check launches the fetch (snoozed === false)

    // User dismisses WHILE the fetch is still in flight -> snoozed becomes true.
    dismissUpdate();
    expect(get(updateAvailable)).toBe(false);

    // Now the in-flight fetch resolves with a genuinely newer build id.
    resolveFetch({ ok: true, json: async () => ({ buildId: "new" }) });
    await flushMicrotasks();

    // The snooze must hold: the late resolution must not re-raise the banner.
    expect(get(updateAvailable)).toBe(false);
  });
});
