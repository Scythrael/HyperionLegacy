// trustedTime.test.ts: clock protection for the whole game (0.13.11.1, user: "you can't jump from
// 1970 to 2099"). A simulated device clock and monotonic clock drive the pure rules.
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  readTrusted,
  initTrustState,
  withServerTime,
  freshTrustState,
  SERVER_TOLERANCE_MS,
  UNVERIFIED_ALLOWANCE_MS,
  syncServerTime,
  syncServerTimeIfDue,
  confirmTrustedTime,
  trustedHeldMs,
  trustedNow,
  initTrustedTime,
  resetTrustedTimeForTests,
  type TrustState,
} from "./trustedTime";
import { installMemoryStorage, restoreStorage } from "./secret/testStorage";

const MIN = 60 * 1000;
const H = 60 * MIN;
const D = 24 * H;
const REAL0 = Date.UTC(2026, 9, 23, 12);
const Y1970 = Date.UTC(1970, 0, 1);
const Y2099 = Date.UTC(2099, 0, 1);

// A device: real time runs on its own; the device clock is real time plus whatever offset the
// player set; performance.now() is real time since the page opened.
class Device {
  real = REAL0;
  offset = 0;
  pageOpenedAt = REAL0;
  get device() {
    return this.real + this.offset;
  }
  get perf() {
    return this.real - this.pageOpenedAt;
  }
  reload() {
    this.pageOpenedAt = this.real;
  }
}

function read(st: TrustState, d: Device) {
  return readTrusted(st, d.device, d.perf);
}

describe("an honest clock is returned exactly", () => {
  it("every reading equals the device clock, online and offline", () => {
    const d = new Device();
    let st = initTrustState(null, [REAL0 - 3 * H], d.perf);
    for (let i = 0; i < 500; i++) {
      d.real += 997;
      const r = read(st, d);
      expect(r.nowMs).toBe(d.device);
      expect(r.heldMs).toBe(0);
      st = r.state;
    }
    st = withServerTime(st, d.real, d.perf);
    for (let i = 0; i < 500; i++) {
      d.real += 1003;
      const r = read(st, d);
      expect(r.nowMs).toBe(d.device);
      st = r.state;
    }
  });

  it("a returning player within two days is paid every second at load, before any server check", () => {
    const d = new Device();
    const stamp = REAL0;
    d.real += 47 * H;
    d.reload();
    const st = initTrustState({ floorMs: stamp, verifiedMs: stamp - 5 * MIN }, [stamp], d.perf);
    expect(read(st, d).nowMs).toBe(d.device);
  });
});

describe("small corrections and daylight saving", () => {
  it("a few minutes back: nothing held, nothing lost, nothing paid twice", () => {
    const d = new Device();
    let st = initTrustState(null, [REAL0], d.perf);
    st = read(st, d).state;
    d.real += 10 * MIN;
    st = read(st, d).state;
    d.offset = -3 * MIN; // NTP pulls the clock back
    const seen: number[] = [];
    for (let i = 0; i < 20 * 60; i++) {
      d.real += 1000;
      const r = read(st, d);
      expect(r.heldMs).toBe(0);
      seen.push(r.nowMs);
      st = r.state;
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    // trusted time advanced exactly as much real time as passed (no loss, no extra)
    expect(seen[seen.length - 1] - (REAL0 + 10 * MIN)).toBe(20 * MIN);
  });

  it("a few minutes forward (online): accepted at once, nothing held", () => {
    const d = new Device();
    let st = withServerTime(initTrustState(null, [REAL0], d.perf), d.real, d.perf);
    d.offset = 4 * MIN;
    const r = read(st, d);
    expect(r.nowMs).toBe(d.device);
    expect(r.heldMs).toBe(0);
    st = r.state;
  });

  it("daylight saving moves the displayed hour, not the epoch: nothing changes", () => {
    const d = new Device();
    let st = initTrustState(null, [REAL0], d.perf);
    for (let i = 0; i < 100; i++) {
      d.real += 36 * 1000;
      const r = read(st, d);
      expect(r.nowMs).toBe(d.real);
      st = r.state;
    }
  });
});

describe("1970 and 2099", () => {
  it("1970: time never goes backward and play keeps real speed", () => {
    const d = new Device();
    let st = read(initTrustState(null, [REAL0], d.perf), d).state;
    d.offset = Y1970 - REAL0;
    d.real += 5 * MIN;
    const r = read(st, d);
    expect(r.nowMs).toBe(REAL0 + 5 * MIN);
    st = r.state;
  });

  it("2099 online: paid only up to server time, the rest held", () => {
    const d = new Device();
    let st = withServerTime(read(initTrustState(null, [REAL0], d.perf), d).state, d.real, d.perf);
    d.offset = Y2099 - REAL0;
    const r = read(st, d);
    expect(r.nowMs).toBeLessThanOrEqual(d.real + SERVER_TOLERANCE_MS);
    expect(r.heldMs).toBeGreaterThan(70 * 365 * D);
  });

  it("2099 offline: at most the unverified allowance past the last verified time", () => {
    const d = new Device();
    d.reload();
    const st = initTrustState({ floorMs: REAL0, verifiedMs: REAL0 }, [REAL0], d.perf);
    d.offset = Y2099 - REAL0;
    const r = read(st, d);
    expect(r.nowMs).toBe(REAL0 + UNVERIFIED_ALLOWANCE_MS);
  });
});

describe("farming loops pay no more than real time (plus the allowance once, offline)", () => {
  // One session after another; each reload pays (trusted now - stamp), then stamps trusted now.
  function farm(online: boolean, cap: number | null) {
    const d = new Device();
    let stored = { floorMs: REAL0, verifiedMs: REAL0 as number | null, anchorMs: null as number | null };
    let stamp = REAL0;
    let paid = 0;
    for (let round = 0; round < 12; round++) {
      d.real += 10 * MIN; // ten real minutes per round
      d.offset = round % 2 === 0 ? 7 * D : 0; // forward a week, then back, again and again
      d.reload();
      let st = initTrustState(stored, [stamp], d.perf);
      if (online) st = withServerTime(st, d.real, d.perf);
      const r = read(st, d);
      const owed = Math.max(0, r.nowMs - stamp);
      paid += cap === null ? owed : Math.min(owed, cap);
      stamp = Math.max(stamp, r.nowMs);
      stored = { floorMs: r.state.floorMs, verifiedMs: r.state.verifiedMs, anchorMs: r.state.anchorMs };
    }
    return { paid, real: d.real - REAL0 };
  }

  it("main game (2-day cap) and minigame (no cap), online: never more than real time plus the tolerance", () => {
    for (const cap of [2 * D, null]) {
      const r = farm(true, cap);
      expect(r.paid).toBeLessThanOrEqual(r.real + SERVER_TOLERANCE_MS);
    }
  });

  it("offline: the allowance is a one-time loan, never a repeatable farm", () => {
    for (const cap of [2 * D, null]) {
      const r = farm(false, cap);
      expect(r.paid).toBeLessThanOrEqual(r.real + UNVERIFIED_ALLOWANCE_MS);
    }
  });

  it("the held time is delayed, not lost: an honest week away offline is paid in full once verified", () => {
    const d = new Device();
    const stamp = REAL0;
    d.real += 7 * D;
    d.reload();
    let st = initTrustState({ floorMs: stamp, verifiedMs: stamp }, [stamp], d.perf);
    const first = read(st, d);
    expect(first.nowMs - stamp).toBe(UNVERIFIED_ALLOWANCE_MS);
    expect(first.heldMs).toBe(5 * D);
    st = withServerTime(first.state, d.real, d.perf); // the network comes back
    d.real += 1000;
    const later = read(st, d);
    expect(later.nowMs).toBe(d.device);
    expect(later.heldMs).toBe(0);
  });
});

describe("the server check", () => {
  afterEach(() => {
    restoreStorage();
    resetTrustedTimeForTests();
    delete (globalThis as { location?: unknown }).location;
  });

  it("a failing request (offline, error status, no Date header) leaves the unverified rules in place", async () => {
    installMemoryStorage();
    (globalThis as { location?: unknown }).location = { origin: "https://hl.test" };
    const failing = [
      () => Promise.reject(new TypeError("offline")),
      () => Promise.resolve(new Response(null, { status: 503, headers: { date: new Date().toUTCString() } })),
      () => Promise.resolve(new Response(null, { status: 200 })),
    ];
    for (const f of failing) expect(await syncServerTime(f)).toBe(false);
  });

  it("a good response anchors the session (HEAD, no-store, same origin)", async () => {
    installMemoryStorage();
    (globalThis as { location?: unknown }).location = { origin: "https://hl.test" };
    initTrustedTime([Date.now() - 1000]);
    let seen: { url: string; init: RequestInit } | null = null;
    const ok = await syncServerTime((url, init) => {
      seen = { url, init };
      return Promise.resolve(new Response(null, { status: 200, headers: { date: new Date().toUTCString() } }));
    });
    expect(ok).toBe(true);
    expect(seen!.url).toBe("https://hl.test/");
    expect(seen!.init).toEqual({ method: "HEAD", cache: "no-store" });
    const t = trustedNow();
    expect(Math.abs(t - Date.now())).toBeLessThan(2000);
  });

  it("the mark persists across sessions", () => {
    const data = installMemoryStorage();
    initTrustedTime([Date.now() + 3 * D]); // a save stamped three days ahead (a past clock jump)
    const t = trustedNow();
    expect(t).toBeGreaterThanOrEqual(Date.now() + 3 * D - 10);
    expect(JSON.parse(data.get("hl_trusted_time")!).floorMs).toBeGreaterThanOrEqual(t);
    resetTrustedTimeForTests();
    initTrustedTime([]);
    expect(trustedNow()).toBeGreaterThanOrEqual(t);
  });
});

describe("a brand new device", () => {
  it("with nothing stored, the device clock is trusted (nothing to protect yet)", () => {
    const st = freshTrustState(0);
    expect(readTrusted(st, REAL0, 0).nowMs).toBe(REAL0);
  });
});

// ---------------------------------------------------------------------------
// Review fixes (2026-10-23, "approve with fixes")
// ---------------------------------------------------------------------------

describe("review C1: only the server's own time is ever recorded as verified", () => {
  it("device parked at 2099, online: N reloads pay at most one allowance in all", () => {
    const d = new Device();
    d.offset = Y2099 - REAL0;
    let stored: { floorMs: number; verifiedMs: number | null; anchorMs: number | null } = { floorMs: REAL0, verifiedMs: REAL0, anchorMs: null };
    let stamp = REAL0;
    let paid = 0;
    for (let round = 0; round < 10; round++) {
      d.real += MIN;
      d.reload();
      let st = initTrustState(stored, [stamp], d.perf);
      // the reload's catch-up runs before the server answers
      const atLoad = read(st, d);
      paid += Math.max(0, atLoad.nowMs - stamp);
      stamp = Math.max(stamp, atLoad.nowMs);
      st = withServerTime(atLoad.state, d.real, d.perf);
      d.real += 30 * 1000;
      const later = read(st, d);
      paid += Math.max(0, later.nowMs - stamp);
      stamp = Math.max(stamp, later.nowMs);
      expect(later.state.verifiedMs).toBeLessThanOrEqual(d.real);
      stored = { floorMs: later.state.floorMs, verifiedMs: later.state.verifiedMs, anchorMs: later.state.anchorMs };
    }
    expect(paid).toBeLessThanOrEqual(UNVERIFIED_ALLOWANCE_MS + (d.real - REAL0) + SERVER_TOLERANCE_MS);
  });
});

describe("review H1: nothing read before the clock starts can become the mark", () => {
  afterEach(() => {
    vi.useRealTimers();
    restoreStorage();
    resetTrustedTimeForTests();
  });

  it("a device 30 days ahead on an existing player's first load pays at most the allowance past the newest save", () => {
    const data = installMemoryStorage();
    vi.useFakeTimers({ toFake: ["Date"] });
    const save = Date.UTC(2026, 9, 23, 12);
    vi.setSystemTime(save + 30 * D);
    trustedNow(); // a module-level read before the main game starts the clock
    expect(data.has("hl_trusted_time")).toBe(false);
    initTrustedTime([save, save - H]);
    const t = trustedNow();
    expect(t).toBeLessThanOrEqual(save + UNVERIFIED_ALLOWANCE_MS + 1000);
    expect(trustedHeldMs()).toBeGreaterThan(27 * D);
    // and the next load does not get a second allowance from the first one's reading
    resetTrustedTimeForTests();
    initTrustedTime([t]);
    expect(trustedNow()).toBeLessThanOrEqual(save + UNVERIFIED_ALLOWANCE_MS + 1000);
  });
});

describe("review H2: a suspended device (performance.now() stopped) is paid in full", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    restoreStorage();
    resetTrustedTimeForTests();
    delete (globalThis as { location?: unknown }).location;
  });

  it("pure rules: an 8-hour sleep with the monotonic clock frozen is held, then paid once the server answers", () => {
    const st = withServerTime(initTrustState(null, [REAL0], 1000), REAL0, 1000);
    const asleep = readTrusted(st, REAL0 + 8 * H, 1000); // perf did not move during the sleep
    expect(asleep.nowMs).toBe(REAL0 + SERVER_TOLERANCE_MS);
    const confirmed = readTrusted(withServerTime(asleep.state, REAL0 + 8 * H, 1000), REAL0 + 8 * H, 1000);
    expect(confirmed.nowMs).toBe(REAL0 + 8 * H);
    expect(confirmed.heldMs).toBe(0);
  });

  it("the return from away waits for the server, so the recap covers the whole honest absence", async () => {
    installMemoryStorage();
    (globalThis as { location?: unknown }).location = { origin: "https://hl.test" };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.spyOn(performance, "now").mockReturnValue(5000); // frozen for the whole test
    vi.setSystemTime(REAL0);
    initTrustedTime([REAL0 - MIN]);
    const at = (ms: number) => () => Promise.resolve(new Response(null, { status: 200, headers: { date: new Date(ms).toUTCString() } }));
    await syncServerTime(at(REAL0));
    const awayFrom = trustedNow();
    vi.setSystemTime(REAL0 + 8 * H); // the laptop slept eight hours
    const first = trustedNow();
    expect(first - awayFrom).toBeLessThanOrEqual(SERVER_TOLERANCE_MS + 1000);
    expect(trustedHeldMs()).toBeGreaterThan(SERVER_TOLERANCE_MS);
    await confirmTrustedTime(3000, at(REAL0 + 8 * H));
    const back = trustedNow();
    expect(back - awayFrom).toBeGreaterThanOrEqual(8 * H - 2000);
    expect(trustedHeldMs()).toBe(0);
  });

  it("confirmTrustedTime gives up after its timeout when the server never answers", async () => {
    installMemoryStorage();
    (globalThis as { location?: unknown }).location = { origin: "https://hl.test" };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    initTrustedTime([Date.now() - 3 * D]);
    trustedNow();
    expect(trustedHeldMs()).toBeGreaterThan(SERVER_TOLERANCE_MS);
    const pending = confirmTrustedTime(3000, () => new Promise<Response>(() => {}));
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toBeUndefined();
  });

  it("App waits for the confirmation before its recap, and keeps the away clock set meanwhile", async () => {
    const { readFileSync } = await import("node:fs");
    const app = readFileSync("src/App.svelte", "utf-8");
    const handler = app.slice(app.indexOf("const onVisibilityChange = () => {"), app.indexOf('document.addEventListener("visibilitychange", onVisibilityChange);'));
    expect(handler).toMatch(/if \(trustedHeldMs\(\) > SERVER_TOLERANCE_MS\) \{\s*void confirmTrustedTime\(3000\)\.then\(finish\);\s*return;/);
    expect(handler.indexOf("awayFrom = null")).toBeGreaterThan(handler.indexOf("const finish = () => {"));
    expect(handler).not.toMatch(/await /);
  });
});

describe("review M1: a mark far in the future heals once the server answers", () => {
  it("trusted time 30 days ahead of the server steps down to it; a later absence is paid again", () => {
    // A save stamped 30 days ahead (a 0.13.11 save written while the clock was ahead).
    const st = initTrustState(null, [REAL0 + 30 * D], 0);
    const frozen = readTrusted(st, REAL0, 0);
    expect(frozen.nowMs).toBe(REAL0 + 30 * D); // offline: held at the mark, nothing paid
    const healed = withServerTime(frozen.state, REAL0, 0);
    expect(readTrusted(healed, REAL0, 0).nowMs).toBe(REAL0);
    // three days later (a new session, the server not answered yet): paid, not frozen
    const later = initTrustState({ floorMs: REAL0, verifiedMs: REAL0, anchorMs: null }, [REAL0], 0);
    expect(readTrusted(later, REAL0 + 3 * D, 0).nowMs - REAL0).toBe(UNVERIFIED_ALLOWANCE_MS);
  });

  it("a mark within the allowance is left alone (an honest player is never stepped back)", () => {
    const st = readTrusted(initTrustState(null, [REAL0 + D], 0), REAL0, 0).state;
    expect(withServerTime(st, REAL0, 0).floorMs).toBe(REAL0 + D);
  });
});

describe("review M3 and the request itself", () => {
  afterEach(() => {
    vi.useRealTimers();
    restoreStorage();
    resetTrustedTimeForTests();
    delete (globalThis as { location?: unknown }).location;
  });

  it("a cached answer's Age is added to its Date", async () => {
    const data = installMemoryStorage();
    (globalThis as { location?: unknown }).location = { origin: "https://hl.test" };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(REAL0);
    initTrustedTime([REAL0 - MIN]);
    const dated = REAL0 - 120 * 1000; // the edge made this copy two minutes ago
    await syncServerTime(() => Promise.resolve(new Response(null, { status: 200, headers: { date: new Date(dated).toUTCString(), age: "120" } })));
    const verified = JSON.parse(data.get("hl_trusted_time")!).verifiedMs as number;
    expect(Math.abs(verified - REAL0)).toBeLessThanOrEqual(1500);
  });

  it("no fetch at all is a failed check, never a throw", async () => {
    installMemoryStorage();
    (globalThis as { location?: unknown }).location = { origin: "https://hl.test" };
    const saved = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = undefined;
    try {
      await expect(syncServerTime()).resolves.toBe(false);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = saved;
    }
  });

  it("returning to the tab checks at most every 30 seconds while nothing is held", async () => {
    installMemoryStorage();
    (globalThis as { location?: unknown }).location = { origin: "https://hl.test" };
    initTrustedTime([Date.now() - 1000]);
    let calls = 0;
    const f = () => {
      calls += 1;
      return Promise.resolve(new Response(null, { status: 200, headers: { date: new Date().toUTCString() } }));
    };
    await syncServerTimeIfDue(f);
    await syncServerTimeIfDue(f);
    await syncServerTimeIfDue(f);
    expect(calls).toBe(1);
  });

  it("the mark is written at most every 30 seconds between saves", () => {
    const data = installMemoryStorage();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(REAL0);
    initTrustedTime([REAL0 - 1000]);
    trustedNow();
    const first = JSON.parse(data.get("hl_trusted_time")!).floorMs as number;
    vi.setSystemTime(REAL0 + 10 * 1000);
    trustedNow();
    expect(JSON.parse(data.get("hl_trusted_time")!).floorMs).toBe(first);
    vi.setSystemTime(REAL0 + 31 * 1000);
    trustedNow();
    expect(JSON.parse(data.get("hl_trusted_time")!).floorMs).toBeGreaterThan(first);
  });
});
