// RARITY READINESS RR-8 (docs/plans/2026-10-23-rarity-readiness-plan.md): the wiring registry close-out. Every entry the
// rarity readiness slices added is LIVE with a probe and a context (or a named notApplicable reference row), except the
// rows that are honestly not live yet, each with an owner OUTSIDE these slices; and no entry anywhere is left pending on
// an RR slice.

import { describe, expect, it } from "vitest";
import { WIRING_REGISTRY } from "./wiring/registry";
import { RR_ADDED_ENTRY_IDS } from "./rarityRegistry.fixture";

// The added rows that are not live, and why (each owner is a later patch or another slice, never RR-0 to RR-8).
// (WR-7 took ship:audit:rrCrewModuleExtras live: OC-D3, the crew module lines scale the module.)
const NOT_LIVE: Readonly<Record<string, { kind: "pending" | "deferred"; owner: RegExp }>> = {
  "crew:CREW_RARITY_MULTIPLIER:radiant": { kind: "deferred", owner: /raises CREW_RARITY_CAP/ },
  "crew:CREW_RARITY_MULTIPLIER:luminous": { kind: "deferred", owner: /raises CREW_RARITY_CAP/ },
  "crew:CREW_RARITY_MULTIPLIER:constellar": { kind: "deferred", owner: /raises CREW_RARITY_CAP/ },
};

describe("RR-8: the wiring registry close-out", () => {
  const added = WIRING_REGISTRY.filter((e) => RR_ADDED_ENTRY_IDS.has(e.id));

  it("covers every catalog the slices added", () => {
    const catalogs = new Set(added.map((e) => e.source.catalog));
    for (const c of ["RARITY_PROFILES", "ASCENSION_BUDGET_MULT", "LUMINOUS_AFFIXES", "MODULE_RARITY_FACTOR", "GEAR_SETS", "CREW_RARITY_MULTIPLIER", "AUDIT"]) {
      expect(catalogs.has(c), c).toBe(true);
    }
    expect(added.length).toBeGreaterThan(40);
  });

  it("every added row is live with a probe and a context, or a named reference row", () => {
    for (const e of added) {
      if (NOT_LIVE[e.id]) continue;
      expect(e.status.kind, e.id).toBe("live");
      if (e.notApplicable) continue;
      expect(e.probe, e.id).toBeDefined();
      expect(e.contexts.length, e.id).toBeGreaterThan(0);
    }
  });

  it("the rows that are not live carry an owner outside the rarity readiness slices", () => {
    for (const [id, want] of Object.entries(NOT_LIVE)) {
      const e = WIRING_REGISTRY.find((x) => x.id === id);
      expect(e, id).toBeDefined();
      expect(e!.status.kind, id).toBe(want.kind);
      const owner = e!.status.kind === "pending" || e!.status.kind === "deferred" ? e!.status.owner : "";
      expect(owner, id).toMatch(want.owner);
    }
  });

  it("no entry anywhere is left pending or deferred on an RR slice", () => {
    const stale = WIRING_REGISTRY.filter((e) => (e.status.kind === "pending" || e.status.kind === "deferred") && /\bRR-[0-8]\b/.test(e.status.owner)).map((e) => e.id);
    expect(stale).toEqual([]);
  });
});
