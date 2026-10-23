// trustedTime.test.ts: clock protection for the whole game (0.13.11.1, user: "you can't jump from
// 1970 to 2099"). A simulated device clock and monotonic clock drive the pure rules.
import { describe, it, expect, afterEach } from "vitest";
import {
  readTrusted,
  initTrustState,
  withServerTime,
  freshTrustState,
  SERVER_TOLERANCE_MS,
  UNVERIFIED_ALLOWANCE_MS,
  syncServerTime,
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
    let stored = { floorMs: REAL0, verifiedMs: REAL0 as number | null };
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
      stored = { floorMs: r.state.floorMs, verifiedMs: r.state.verifiedMs };
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
