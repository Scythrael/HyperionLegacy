import { describe, it, expect, afterEach } from "vitest";
import { safeGetItem, safeSetItem, safeRemoveItem } from "./safeStorage";
import { loadTheme, DEFAULT_THEME } from "./theme";
import { loadTickBarEnabled } from "./tickBarPreference";
import { loadShowTickCounts } from "./tickReadoutPreference";
import { loadSalvageConfirmQualities } from "./salvageConfirmPreference";
import { QUALITY_TIERS } from "./game/inventory";

// ============================================================================
// safeStorage.test.ts: the guarded localStorage wrapper degrades to "no
// persistence" instead of throwing when the store is unreachable, and every
// preference loader routed through it falls back to its documented DEFAULT.
//
// This project runs vitest under the default `node` environment (no jsdom), so
// `localStorage` is not defined. Each test installs its own shim on globalThis and
// tears it down afterward, mirroring the shim pattern in combatLogPreference.test.ts
// and salvageConfirmPreference.test.ts.
// ============================================================================

// Restore globalThis.localStorage to its pre-test state after every case so a
// throwing/absent shim from one test never leaks into another.
let hadLocalStorage = false;
let previous: unknown;
function installLocalStorage(value: unknown): void {
  hadLocalStorage = "localStorage" in globalThis;
  previous = (globalThis as any).localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    // A plain data property covers the "methods throw" shims. The "property access
    // itself throws" case (blocked site data) is installed separately below via a
    // throwing getter.
    value,
    writable: true,
  });
}
// A store whose very ACCESS throws, modeling a browser with site data blocked where
// reading `window.localStorage` raises SecurityError before any method is called.
function installThrowingAccessor(): void {
  hadLocalStorage = "localStorage" in globalThis;
  previous = (globalThis as any).localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError: access to localStorage is blocked");
    },
  });
}
afterEach(() => {
  if (hadLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previous,
      writable: true,
    });
  } else {
    delete (globalThis as any).localStorage;
  }
});

describe("safeStorage: guards a store whose methods throw", () => {
  // A shim whose every method throws, modeling Safari private mode (setItem quota) and
  // a store that rejects reads.
  const throwingStore = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("QuotaExceeded");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };

  it("safeGetItem returns null instead of throwing", () => {
    installLocalStorage(throwingStore);
    expect(safeGetItem("any_key")).toBeNull();
  });

  it("safeSetItem returns false instead of throwing", () => {
    installLocalStorage(throwingStore);
    expect(safeSetItem("any_key", "value")).toBe(false);
  });

  it("safeRemoveItem is a silent no-op instead of throwing", () => {
    installLocalStorage(throwingStore);
    expect(() => safeRemoveItem("any_key")).not.toThrow();
  });
});

describe("safeStorage: guards a store whose ACCESS throws (blocked site data)", () => {
  it("safeGetItem returns null when reading `localStorage` itself throws", () => {
    installThrowingAccessor();
    expect(safeGetItem("any_key")).toBeNull();
  });

  it("safeSetItem returns false when reading `localStorage` itself throws", () => {
    installThrowingAccessor();
    expect(safeSetItem("any_key", "value")).toBe(false);
  });
});

describe("safeStorage: a working store round-trips normally", () => {
  it("safeSetItem returns true and safeGetItem reads the value back", () => {
    const store = new Map<string, string>();
    installLocalStorage({
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
    expect(safeSetItem("k", "v")).toBe(true);
    expect(safeGetItem("k")).toBe("v");
    safeRemoveItem("k");
    expect(safeGetItem("k")).toBeNull();
  });
});

// The load-bearing assertion for FIX 1: when the wrapper's getItem returns null
// (a blocked/unreachable store), each preference loader returns its DOCUMENTED
// DEFAULT rather than crashing. A throwing accessor makes safeGetItem yield null.
describe("preference loaders return their default when the wrapper's getItem returns null", () => {
  it("loadTheme falls back to DEFAULT_THEME", () => {
    installThrowingAccessor();
    expect(loadTheme()).toBe(DEFAULT_THEME);
  });

  it("loadTickBarEnabled falls back to true (ON default)", () => {
    installThrowingAccessor();
    expect(loadTickBarEnabled()).toBe(true);
  });

  it("loadShowTickCounts falls back to false (OFF default)", () => {
    installThrowingAccessor();
    expect(loadShowTickCounts()).toBe(false);
  });

  it("loadSalvageConfirmQualities falls back to confirm-every-tier", () => {
    installThrowingAccessor();
    // The safe default is the full tier set [0..QUALITY_TIERS).
    expect(loadSalvageConfirmQualities()).toEqual(
      Array.from({ length: QUALITY_TIERS }, (_, i) => i)
    );
  });
});
