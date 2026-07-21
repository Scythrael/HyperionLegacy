import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { loadSalvageConfirmQualities, saveSalvageConfirmQualities, salvageNeedsConfirm } from "./salvageConfirmPreference";

describe("salvageConfirmPreference", () => {
  // This project has no test-DOM environment configured (vite.config.ts registers
  // no vitest `environment`, so tests run under the default `node` environment, and
  // neither jsdom nor happy-dom is installed), so the global `localStorage` these
  // functions read/write is simply not defined. Rather than pull in a whole DOM env
  // for a handful of tests, install a minimal in-memory localStorage shim on
  // globalThis for THIS block only, then remove it afterward so no global leaks into
  // any later test/file. This mirrors the identical shim in src/lib/game/save.test.ts
  // (getItem returns null for a missing key; values are coerced to string).
  let restoreLocalStorage: (() => void) | null = null;
  beforeAll(() => {
    const store = new Map<string, string>();
    const hadLocalStorage = "localStorage" in globalThis;
    const previous = (globalThis as any).localStorage;
    (globalThis as any).localStorage = {
      getItem: (key: string): string | null => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string): void => {
        store.set(key, String(value));
      },
      removeItem: (key: string): void => {
        store.delete(key);
      },
      clear: (): void => {
        store.clear();
      },
    };
    restoreLocalStorage = () => {
      if (hadLocalStorage) (globalThis as any).localStorage = previous;
      else delete (globalThis as any).localStorage;
    };
  });
  afterAll(() => {
    restoreLocalStorage?.();
    restoreLocalStorage = null;
  });

  beforeEach(() => localStorage.clear());

  it("defaults to confirming ALL quality tiers when unset (safe default)", () => {
    expect(loadSalvageConfirmQualities()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("persists and reloads the selected set", () => {
    saveSalvageConfirmQualities([3, 4, 5]);
    expect(loadSalvageConfirmQualities()).toEqual([3, 4, 5]);
  });

  it("salvageNeedsConfirm is true only for a quality in the selected set", () => {
    saveSalvageConfirmQualities([4, 5]);
    expect(salvageNeedsConfirm(2)).toBe(false);
    expect(salvageNeedsConfirm(5)).toBe(true);
  });

  it("falls back to the safe default on a corrupt stored value", () => {
    localStorage.setItem("fleet_admiral_salvage_confirm_qualities", "not json");
    expect(loadSalvageConfirmQualities()).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
