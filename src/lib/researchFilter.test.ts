// Research tab search and filter (0.14.0, user 2026-11-17 "Research screen cleanup"): the pure filter over the Research
// list's tier groups. Display only: every verdict here is read off the engine's own predicates (blueprintUnlocked,
// canResearch, blueprintRelicLocked, the research queue), never re-derived.
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { BLUEPRINTS, RESEARCH_FACILITY_KEY, freshState, type BlueprintDef, type GameState } from "./game/model";
import { startResearch } from "./game/tick";
import { researchFamilyOf } from "./game/dataStudy";
import { RESEARCH_SECTION_LABEL, RESEARCH_SECTION_ORDER, researchSectionOf } from "./awayGearDisplay";
import {
  DEFAULT_RESEARCH_FILTER_VIEW,
  filterBlueprintTierGroups,
  researchCategoryOptions,
  researchHiddenCountText,
  researchSearchText,
  researchStatusOf,
  researchStatusOptions,
  researchTierOptions,
  type ResearchFilterView,
} from "./researchFilter";

// The Research list's own grouping (App.svelte blueprintTierGroups): tiers ascending, each with its shelves in
// RESEARCH_SECTION_ORDER, empty shelves dropped.
function tierGroups() {
  const byTier = new Map<number, BlueprintDef[]>();
  for (const bp of Object.values(BLUEPRINTS)) byTier.set(bp.tier, [...(byTier.get(bp.tier) ?? []), bp]);
  return [...byTier.keys()]
    .sort((a, b) => a - b)
    .map((tier) => {
      const blueprints = byTier.get(tier) ?? [];
      const sections = RESEARCH_SECTION_ORDER.map((key) => ({
        key,
        label: RESEARCH_SECTION_LABEL[key],
        blueprints: blueprints.filter((bp) => researchSectionOf(bp) === key),
      })).filter((s) => s.blueprints.length > 0);
      return { tier, blueprints, sections };
    });
}

// A Research Lab at level 1 with credits to spare and nothing researched (craftQueue.test.ts researchLabState).
function labState(over: Partial<GameState> = {}): GameState {
  const s = freshState(1);
  return {
    ...s,
    facilities: { ...s.facilities, [RESEARCH_FACILITY_KEY]: { level: 1 } },
    credits: new Decimal(1_000_000),
    researchedBlueprints: [],
    ...over,
  };
}

function view(over: Partial<ResearchFilterView> = {}): ResearchFilterView {
  return { ...DEFAULT_RESEARCH_FILTER_VIEW, ...over };
}

function keysOf(groups: ReturnType<typeof tierGroups>): string[] {
  return groups.flatMap((g) => g.sections.flatMap((s) => s.blueprints.map((bp) => bp.key)));
}

// A discovery-gated blueprint whose relic a fresh save has not found: the catalog masks its card.
const MASKED_KEY = "pathfinderSuiteBp";

describe("researchFilter", () => {
  it("matches a name and a recipe material case-insensitively with trimmed search", () => {
    const s = labState();
    const groups = tierGroups();
    const byMaterial = keysOf(filterBlueprintTierGroups(s, groups, view({ search: "  TITANIUM " }), false).groups);
    const lower = keysOf(filterBlueprintTierGroups(s, groups, view({ search: "titanium" }), false).groups);
    expect(byMaterial).toEqual(lower);
    expect(byMaterial).toContain("frameSegmentBp"); // Titanium Ingot is its only input
    expect(byMaterial).not.toContain("stunGrenadeBp"); // Polysilicate Wafer + Power Coupling, no Titanium
    const byName = keysOf(filterBlueprintTierGroups(s, groups, view({ search: "Class iii drive" }), false).groups);
    expect(byName).toEqual(["classIIIDriveBp"]);
    // An unlock-only blueprint is found by the hull it unlocks; a material blueprint by its output.
    expect(researchSearchText(s, BLUEPRINTS.orionHullBp)).toContain("orion");
    expect(researchSearchText(s, BLUEPRINTS.frameSegmentBp)).toContain("frame segment");
    // A blank or all-space search matches everything.
    const all = filterBlueprintTierGroups(s, groups, view({ search: "   " }), false);
    expect(all.matched).toBe(Object.keys(BLUEPRINTS).length);
  });

  it("masked relic blueprint matches only its mask text and counts as locked", () => {
    const s = labState();
    expect(BLUEPRINTS[MASKED_KEY].requiresRelicDiscovery).toBeDefined();
    const groups = tierGroups();
    const text = researchSearchText(s, BLUEPRINTS[MASKED_KEY]);
    expect(text).not.toContain("pathfinder");
    expect(text).not.toContain("titanium");
    expect(text).toContain("undiscovered research");
    for (const q of ["pathfinder", "titanium", "frame segment"]) {
      expect(keysOf(filterBlueprintTierGroups(s, groups, view({ search: q }), false).groups)).not.toContain(MASKED_KEY);
    }
    expect(keysOf(filterBlueprintTierGroups(s, groups, view({ search: "undiscovered" }), false).groups)).toContain(MASKED_KEY);
    expect(researchStatusOf(s, MASKED_KEY)).toBe("locked");
    expect(keysOf(filterBlueprintTierGroups(s, groups, view({ status: "locked" }), false).groups)).toContain(MASKED_KEY);
    // Its family is hidden too: a masked card shows only under Category All, never under its real family.
    const family = researchFamilyOf(BLUEPRINTS[MASKED_KEY]);
    expect(keysOf(filterBlueprintTierGroups(s, groups, view({ family }), false).groups)).not.toContain(MASKED_KEY);
    // Once the relic is found the card is a normal card again, searchable by its name.
    const found = labState({ relicDiscovered: [BLUEPRINTS[MASKED_KEY].requiresRelicDiscovery!] });
    expect(researchSearchText(found, BLUEPRINTS[MASKED_KEY])).toContain("pathfinder");
    expect(keysOf(filterBlueprintTierGroups(found, groups, view({ family }), false).groups)).toContain(MASKED_KEY);
  });

  it("reads each status off the engine: researched, in progress or queued, can research, locked", () => {
    let s = labState({ researchedBlueprints: ["frameSegmentBp"] });
    expect(researchStatusOf(s, "frameSegmentBp")).toBe("researched");
    expect(researchStatusOf(s, "powerCouplingBp")).toBe("canResearch");
    expect(researchStatusOf(s, "structuralAssemblyBp")).toBe("locked"); // tier II over a level 1 lab
    const started = startResearch(s, "powerCouplingBp");
    expect(started.started).toBe(true);
    s = started.next;
    expect(researchStatusOf(s, "powerCouplingBp")).toBe("inProgress");
    const queued: GameState = {
      ...s,
      processQueue: [...(s.processQueue ?? []), { id: "q-x", facility: "researchLab", order: { type: "research", blueprintKey: "sprintDriveBp" } }],
    };
    expect(researchStatusOf(queued, "sprintDriveBp")).toBe("inProgress");
  });

  it("status, family and tier combine (AND)", () => {
    const s = labState({ researchedBlueprints: ["sprintDriveBp"] });
    const groups = tierGroups();
    const out = filterBlueprintTierGroups(s, groups, view({ status: "canResearch", family: "propulsion", tier: 1 }), true);
    const keys = keysOf(out.groups);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(researchStatusOf(s, k)).toBe("canResearch");
      expect(researchFamilyOf(BLUEPRINTS[k])).toBe("propulsion");
      expect(BLUEPRINTS[k].tier).toBe(1);
    }
    expect(keys).toContain("economyDriveBp");
    expect(keys).not.toContain("sprintDriveBp"); // researched
    expect(keys).not.toContain("classIIDriveBp"); // tier II
    expect(out.matched).toBe(keys.length);
    // Every tier I propulsion blueprint that is researchable is there, in the list's own order.
    const expected = Object.values(BLUEPRINTS)
      .filter((bp) => bp.tier === 1 && researchFamilyOf(bp) === "propulsion" && researchStatusOf(s, bp.key) === "canResearch")
      .map((bp) => bp.key);
    expect(keys).toEqual(expected);
  });

  it("showCompleted false hides researched and counts them", () => {
    const researched = ["frameSegmentBp", "powerCouplingBp", "sprintDriveBp"];
    const s = labState({ researchedBlueprints: researched });
    const groups = tierGroups();
    const hidden = filterBlueprintTierGroups(s, groups, view(), false);
    for (const k of researched) expect(keysOf(hidden.groups)).not.toContain(k);
    expect(hidden.hiddenResearched).toBe(3);
    expect(hidden.matched).toBe(Object.keys(BLUEPRINTS).length - 3);
    // The count follows the other filters: only researched blueprints the view would otherwise show.
    expect(filterBlueprintTierGroups(s, groups, view({ family: "propulsion" }), false).hiddenResearched).toBe(1);
    expect(filterBlueprintTierGroups(s, groups, view({ status: "canResearch" }), false).hiddenResearched).toBe(0);
    // A stored Researched status behaves as All while completed research is hidden.
    expect(keysOf(filterBlueprintTierGroups(s, groups, view({ status: "researched" }), false).groups)).toEqual(keysOf(hidden.groups));
    // Shown: they come back, and Researched narrows to exactly them.
    const shown = filterBlueprintTierGroups(s, groups, view(), true);
    expect(shown.hiddenResearched).toBe(0);
    expect(shown.matched).toBe(Object.keys(BLUEPRINTS).length);
    expect(keysOf(filterBlueprintTierGroups(s, groups, view({ status: "researched" }), true).groups)).toEqual(researched);
  });

  it("empty sections and tiers are dropped and order is preserved", () => {
    const s = labState();
    const groups = tierGroups();
    const out = filterBlueprintTierGroups(s, groups, view({ family: "field" }), false);
    for (const g of out.groups) {
      expect(g.sections.length).toBeGreaterThan(0);
      for (const sec of g.sections) expect(sec.blueprints.length).toBeGreaterThan(0);
      // The tier's flat list keeps exactly the shelves' blueprints, in the unfiltered tier's order.
      const inShelves = new Set(g.sections.flatMap((sec) => sec.blueprints.map((bp) => bp.key)));
      const source = groups.find((x) => x.tier === g.tier)!;
      expect(g.blueprints.map((bp) => bp.key)).toEqual(source.blueprints.map((bp) => bp.key).filter((k) => inShelves.has(k)));
    }
    // Field gear has no tier above II, so later tiers drop out entirely.
    expect(out.groups.map((g) => g.tier)).toEqual([1, 2]);
    // Order inside a shelf is the unfiltered order with the misses removed.
    const full = groups.flatMap((g) => g.sections.flatMap((sec) => sec.blueprints.map((bp) => bp.key)));
    const kept = keysOf(out.groups);
    expect(kept).toEqual(full.filter((k) => kept.includes(k)));
    // Shelf labels and keys are untouched.
    const t1 = groups[0].sections.map((sec) => sec.key);
    for (const sec of out.groups[0].sections) expect(t1).toContain(sec.key);
    // Nothing matching gives no groups at all.
    const none = filterBlueprintTierGroups(s, groups, view({ search: "no such blueprint anywhere" }), false);
    expect(none.groups).toEqual([]);
    expect(none.matched).toBe(0);
  });

  it("chip options: statuses (Researched only when shown), the families and tiers present", () => {
    expect(researchStatusOptions(false).map((o) => o.label)).toEqual(["All", "Can research", "In progress or queued", "Locked"]);
    expect(researchStatusOptions(true).map((o) => o.label)).toEqual(["All", "Can research", "In progress or queued", "Locked", "Researched"]);
    const s = labState();
    const groups = tierGroups();
    const cats = researchCategoryOptions(s, groups);
    expect(cats[0]).toEqual({ key: "all", label: "All" });
    expect(cats.map((c) => c.label)).toContain("Hull Design");
    expect(cats.map((c) => c.label)).toContain("Propulsion");
    const tiers = researchTierOptions(groups);
    expect(tiers[0]).toEqual({ key: "all", label: "All" });
    expect(tiers.slice(1).map((t) => t.label)).toEqual(groups.map((g) => ["I", "II", "III", "IV", "V", "VI", "VII"][g.tier - 1]));
  });

  it("hidden-count line names the count and points at Settings", () => {
    expect(researchHiddenCountText(12)).toBe("12 researched blueprints hidden (Settings > Show completed research)");
    expect(researchHiddenCountText(1)).toBe("1 researched blueprint hidden (Settings > Show completed research)");
  });
});
