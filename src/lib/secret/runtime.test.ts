import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import {
  secretGame,
  secretCatchingUp,
  startSecretRuntime,
  secretAct,
  wipeSecretGame,
  devFastForwardSecret,
  codesTabSeen,
  markCodesTabSeen,
  CODES_SEEN_KEY,
} from "./runtime";
import { SECRET_SAVE_KEY, deserializeSecret, freshSecretState, serializeSecret } from "./state";
import { buyTier } from "./engine";
import { installMemoryStorage, installBlockedStorage, restoreStorage } from "./testStorage";

let stop: (() => void) | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T18:00:00Z"));
});
afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  restoreStorage();
});

describe("secret runtime", () => {
  it("ticks once a second on its own clock", () => {
    installMemoryStorage();
    stop = startSecretRuntime();
    secretAct((s) => buyTier(s, 0, "one"));
    const before = get(secretGame).ore;
    vi.advanceTimersByTime(5000);
    expect(get(secretGame).ore.gt(before)).toBe(true);
    expect(Date.now() - get(secretGame).lastTickAt).toBeLessThan(1000);
  });

  it("secretAct applies and persists", () => {
    const data = installMemoryStorage();
    stop = startSecretRuntime();
    secretAct((s) => buyTier(s, 0, "one"));
    expect(get(secretGame).bought[0]).toBe(1);
    expect(deserializeSecret(data.get(SECRET_SAVE_KEY) ?? null, 0)?.bought[0]).toBe(1);
  });

  it("loads an existing save and pays the time away, sliced", () => {
    const data = installMemoryStorage();
    const old = buyTier(freshSecretState(Date.now() - 3 * 3600 * 1000), 0, "one");
    data.set(SECRET_SAVE_KEY, serializeSecret(old));
    stop = startSecretRuntime();
    expect(get(secretCatchingUp)).toBe(true);
    vi.advanceTimersByTime(100);
    expect(get(secretCatchingUp)).toBe(false);
    expect(Date.now() - get(secretGame).lastTickAt).toBeLessThan(1000);
    expect(get(secretGame).ore.gt(1000)).toBe(true);
  });

  it("wipe clears the key and resets the store to a fresh game", () => {
    const data = installMemoryStorage();
    data.set("fleet_admiral_save", "main");
    stop = startSecretRuntime();
    secretAct((s) => buyTier(s, 0, "one"));
    expect(data.has(SECRET_SAVE_KEY)).toBe(true);
    wipeSecretGame();
    expect(data.has(SECRET_SAVE_KEY)).toBe(false);
    expect(data.get("fleet_admiral_save")).toBe("main");
    expect(get(secretGame).bought[0]).toBe(0);
  });

  it("dev fast-forward moves the clock back and pays the gap", () => {
    installMemoryStorage();
    stop = startSecretRuntime();
    secretAct((s) => buyTier(s, 0, "one"));
    const before = get(secretGame).ore;
    devFastForwardSecret(3600);
    vi.advanceTimersByTime(50);
    expect(get(secretGame).ore.gt(before.mul(100))).toBe(true);
    expect(Date.now() - get(secretGame).lastTickAt).toBeLessThan(1000);
  });

  it("blocked storage still runs", () => {
    installBlockedStorage();
    stop = startSecretRuntime();
    secretAct((s) => buyTier(s, 0, "one"));
    vi.advanceTimersByTime(3000);
    expect(get(secretGame).bought[0]).toBe(1);
  });
});

describe("the NEW tag flag", () => {
  it("is not seen until marked, and survives blocked storage as not seen", () => {
    const data = installMemoryStorage();
    expect(codesTabSeen()).toBe(false);
    markCodesTabSeen();
    expect(codesTabSeen()).toBe(true);
    expect(data.get(CODES_SEEN_KEY)).toBe("1");
    restoreStorage();
    installBlockedStorage();
    expect(codesTabSeen()).toBe(false);
    expect(() => markCodesTabSeen()).not.toThrow();
  });
});
