import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  loadAutoSalvageBaselineWarningEnabled,
  saveAutoSalvageBaselineWarningEnabled,
} from "./autoSalvageBaselineWarningPreference";

describe("autoSalvageBaselineWarningPreference", () => {
  // Same in-memory localStorage shim, and for the same reason, as
  // salvageConfirmPreference.test.ts: this project runs vitest under the default `node`
  // environment with no DOM, so the global these functions read is simply not defined.
  // Installed for THIS block only and removed afterward so nothing leaks into a later file.
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

  it("defaults to SHOWING the warning when unset (the safe direction)", () => {
    expect(loadAutoSalvageBaselineWarningEnabled()).toBe(true);
  });

  it("round-trips both settings", () => {
    saveAutoSalvageBaselineWarningEnabled(false);
    expect(loadAutoSalvageBaselineWarningEnabled()).toBe(false);
    saveAutoSalvageBaselineWarningEnabled(true);
    expect(loadAutoSalvageBaselineWarningEnabled()).toBe(true);
  });

  it("only the exact string \"false\" switches the warning off", () => {
    // A garbled value must not silently suppress a warning about an irreversible destruction,
    // so anything unrecognized reads as ON.
    for (const bad of ["", "0", "no", "FALSE", "{}"]) {
      localStorage.setItem("fleet_admiral_auto_salvage_baseline_warning_enabled", bad);
      expect(loadAutoSalvageBaselineWarningEnabled(), `"${bad}" must read as ON`).toBe(true);
    }
    localStorage.setItem("fleet_admiral_auto_salvage_baseline_warning_enabled", "false");
    expect(loadAutoSalvageBaselineWarningEnabled()).toBe(false);
  });
});
