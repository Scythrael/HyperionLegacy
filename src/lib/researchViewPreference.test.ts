// Research tab filters (0.14.0, user 2026-11-17): the search and chip choices persist across reloads like the Ships
// roster's view, and "Show completed research" is a per-device setting, default off. Per-device localStorage, never the
// save.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DEFAULT_RESEARCH_FILTER_VIEW } from "./researchFilter";
import {
  loadResearchFilterView,
  loadShowCompletedResearch,
  saveResearchFilterView,
  saveShowCompletedResearch,
} from "./researchViewPreference";

const VIEW_KEY = "fleet_admiral_research_filter_view";
const SHOW_KEY = "fleet_admiral_show_completed_research";

describe("researchViewPreference", () => {
  // No test DOM in this project: a minimal in-memory localStorage shim for this block only (shipRosterViewPreference's).
  let restore: (() => void) | null = null;
  let blocked = false;
  beforeAll(() => {
    const store = new Map<string, string>();
    const had = "localStorage" in globalThis;
    const previous = (globalThis as any).localStorage;
    const guard = () => {
      if (blocked) throw new Error("SecurityError");
    };
    (globalThis as any).localStorage = {
      getItem: (k: string): string | null => (guard(), store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string): void => (guard(), void store.set(k, String(v))),
      removeItem: (k: string): void => void store.delete(k),
      clear: (): void => store.clear(),
    };
    restore = () => {
      if (had) (globalThis as any).localStorage = previous;
      else delete (globalThis as any).localStorage;
    };
  });
  afterAll(() => restore?.());
  beforeEach(() => {
    blocked = false;
    localStorage.clear();
  });

  it("defaults to no search and every chip on All when nothing is stored", () => {
    expect(loadResearchFilterView()).toEqual(DEFAULT_RESEARCH_FILTER_VIEW);
  });

  it("a saved view comes back after a reload", () => {
    const v = { search: "titanium", status: "canResearch" as const, family: "propulsion" as const, tier: 2 };
    saveResearchFilterView(v);
    expect(loadResearchFilterView()).toEqual(v);
    saveResearchFilterView({ ...v, status: "researched", tier: "all" });
    expect(loadResearchFilterView()).toEqual({ ...v, status: "researched", tier: "all" });
  });

  it("an unknown family, tier or status, or a non-string search, falls back on its own, keeping the others", () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ search: 7, status: "canResearch", family: "warpCore", tier: 2 }));
    expect(loadResearchFilterView()).toEqual({ search: "", status: "canResearch", family: "all", tier: 2 });
    localStorage.setItem(VIEW_KEY, JSON.stringify({ search: "drive", status: "bogus", family: "sensors", tier: 99 }));
    expect(loadResearchFilterView()).toEqual({ search: "drive", status: "all", family: "sensors", tier: "all" });
    localStorage.setItem(VIEW_KEY, JSON.stringify({ search: "drive", status: "locked", family: "field", tier: "2" }));
    expect(loadResearchFilterView()).toEqual({ search: "drive", status: "locked", family: "field", tier: "all" });
  });

  it("malformed JSON or a non-object gives the defaults", () => {
    localStorage.setItem(VIEW_KEY, "{not json");
    expect(loadResearchFilterView()).toEqual(DEFAULT_RESEARCH_FILTER_VIEW);
    localStorage.setItem(VIEW_KEY, "null");
    expect(loadResearchFilterView()).toEqual(DEFAULT_RESEARCH_FILTER_VIEW);
    localStorage.setItem(VIEW_KEY, "[1,2]");
    expect(loadResearchFilterView()).toEqual(DEFAULT_RESEARCH_FILTER_VIEW);
  });

  it("blocked storage gives the defaults and a save never throws", () => {
    saveResearchFilterView({ search: "x", status: "locked", family: "field", tier: 1 });
    saveShowCompletedResearch(true);
    blocked = true;
    expect(loadResearchFilterView()).toEqual(DEFAULT_RESEARCH_FILTER_VIEW);
    expect(loadShowCompletedResearch()).toBe(false);
    expect(() => saveResearchFilterView(DEFAULT_RESEARCH_FILTER_VIEW)).not.toThrow();
    expect(() => saveShowCompletedResearch(false)).not.toThrow();
  });

  it("Show completed research defaults off and round-trips", () => {
    expect(loadShowCompletedResearch()).toBe(false);
    saveShowCompletedResearch(true);
    expect(localStorage.getItem(SHOW_KEY)).toBe("true");
    expect(loadShowCompletedResearch()).toBe(true);
    saveShowCompletedResearch(false);
    expect(loadShowCompletedResearch()).toBe(false);
  });
});
