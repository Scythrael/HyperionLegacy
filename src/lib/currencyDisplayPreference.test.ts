import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { loadCurrencyDisplay, saveCurrencyDisplay, MAX_HEADER_CURRENCIES } from "./currencyDisplayPreference";

describe("currencyDisplayPreference", () => {
  // vitest runs under the node environment (no jsdom), so localStorage is not defined.
  // Install a minimal in-memory shim for this block only, mirroring combatLogPreference.test.ts.
  let restoreLocalStorage: (() => void) | null = null;
  beforeAll(() => {
    const store = new Map<string, string>();
    const hadLocalStorage = "localStorage" in globalThis;
    const previous = (globalThis as any).localStorage;
    (globalThis as any).localStorage = {
      getItem: (key: string): string | null => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string): void => { store.set(key, String(value)); },
      removeItem: (key: string): void => { store.delete(key); },
      clear: (): void => { store.clear(); },
    };
    restoreLocalStorage = () => {
      if (hadLocalStorage) (globalThis as any).localStorage = previous;
      else delete (globalThis as any).localStorage;
    };
  });
  afterAll(() => { restoreLocalStorage?.(); restoreLocalStorage = null; });
  beforeEach(() => localStorage.clear());

  it("defaults to null (never set) so the caller can show all currencies", () => {
    expect(loadCurrencyDisplay()).toBeNull();
  });

  it("round-trips an explicit ordered selection", () => {
    saveCurrencyDisplay(["adminPoints", "credits"]);
    expect(loadCurrencyDisplay()).toEqual(["adminPoints", "credits"]);
  });

  it("preserves an explicit EMPTY choice as [] (distinct from null)", () => {
    saveCurrencyDisplay([]);
    expect(loadCurrencyDisplay()).toEqual([]);
  });

  it("caps the stored selection at MAX_HEADER_CURRENCIES", () => {
    saveCurrencyDisplay(["a", "b", "c", "d", "e", "f"]);
    expect(loadCurrencyDisplay()).toEqual(["a", "b", "c", "d"]);
    expect(MAX_HEADER_CURRENCIES).toBe(4);
  });

  it("treats a malformed stored value as never-set (null) rather than throwing", () => {
    localStorage.setItem("fleet_admiral_header_currencies", "{not json");
    expect(loadCurrencyDisplay()).toBeNull();
    localStorage.setItem("fleet_admiral_header_currencies", '"a string not an array"');
    expect(loadCurrencyDisplay()).toBeNull();
  });
});
