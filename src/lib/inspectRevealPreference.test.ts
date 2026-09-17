import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { loadInspectReveal, saveInspectReveal } from "./inspectRevealPreference";

describe("inspectRevealPreference", () => {
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

  it("defaults to ON when unset", () => {
    expect(loadInspectReveal()).toBe(true);
  });

  it("persists and reloads OFF (the mass-roll choice)", () => {
    saveInspectReveal(false);
    expect(loadInspectReveal()).toBe(false);
  });

  it("round-trips back ON", () => {
    saveInspectReveal(false);
    saveInspectReveal(true);
    expect(loadInspectReveal()).toBe(true);
  });
});
