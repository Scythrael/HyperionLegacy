// FR-C R6-3 (user 2026-11-13/14, "Remember them (Recommended)"): the Ships roster's sort, view and search persist across
// reloads, the way favorites do. Per-device localStorage, never the save.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_SHIP_ROSTER_VIEW, loadShipRosterView, saveShipRosterView } from "./shipRosterViewPreference";

const KEY = "fleet_admiral_ship_roster_view";

describe("shipRosterViewPreference", () => {
  // No test DOM in this project: a minimal in-memory localStorage shim for this block only (salvageConfirmPreference's).
  let restore: (() => void) | null = null;
  beforeAll(() => {
    const store = new Map<string, string>();
    const had = "localStorage" in globalThis;
    const previous = (globalThis as any).localStorage;
    (globalThis as any).localStorage = {
      getItem: (k: string): string | null => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string): void => void store.set(k, String(v)),
      removeItem: (k: string): void => void store.delete(k),
      clear: (): void => store.clear(),
    };
    restore = () => {
      if (had) (globalThis as any).localStorage = previous;
      else delete (globalThis as any).localStorage;
    };
  });
  afterAll(() => restore?.());
  beforeEach(() => localStorage.clear());

  it("defaults to Attention, every ship, no search, when nothing is stored", () => {
    expect(loadShipRosterView()).toEqual(DEFAULT_SHIP_ROSTER_VIEW);
  });

  it("a saved sort, view and search come back after a reload", () => {
    saveShipRosterView({ sortKey: "name", filterKey: "byClass", search: "Aurora" });
    expect(loadShipRosterView()).toEqual({ sortKey: "name", filterKey: "byClass", search: "Aurora" });
  });

  it("an unknown or malformed field falls back on its own, keeping the others", () => {
    localStorage.setItem(KEY, JSON.stringify({ sortKey: "bogus", filterKey: "needsOrders", search: 7 }));
    expect(loadShipRosterView()).toEqual({ sortKey: "attention", filterKey: "needsOrders", search: "" });
    localStorage.setItem(KEY, "{not json");
    expect(loadShipRosterView()).toEqual(DEFAULT_SHIP_ROSTER_VIEW);
  });

  it("the Ships tab loads the stored view and saves every change", () => {
    const app = readFileSync("src/App.svelte", "utf8");
    expect(app).toContain("loadShipRosterView()");
    expect(app).toMatch(/saveShipRosterView\(\{ sortKey: shipSortKey, filterKey: shipFilterKey, search: shipSearch \}\)/);
  });
});
