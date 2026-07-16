// Research feature -- Task R1 (docs/plans/2026-07-15-research-{design,plan}.md).
// The BLUEPRINT DATA MODEL only: the BLUEPRINTS registry + BlueprintDef shape, the
// GameState.researchedBlueprints unlocked-keys field, and the two pure availability
// helpers (blueprintUnlocked / blueprintResearchable). The Research facility (R2),
// the research-project engine (R3), the canResearch gate (R4), and the UI (R5) are
// LATER tasks -- nothing here exercises them.
//
// These tests are the R1 contract:
//   1. Every BLUEPRINTS entry is well-formed: tier >= 1, positive duration + credit
//      cost, an outputItem + every recipe input key resolving to a REAL ITEMS entry,
//      positive outputQty + input amounts.
//   2. The proposed first-pass set exists at the expected tiers (tier-1 components +
//      a tier-2 major component) so the tier gate has something real to gate.
//   3. A fresh state seeds researchedBlueprints as [].
//   4. blueprintUnlocked is false on a fresh state, true once a key is added.
//   5. blueprintResearchable gates on the research-facility LEVEL: a tier-1 blueprint
//      is researchable once the facility is level >= 1 (R2 seeds it there), a tier-2
//      one is NOT until level >= 2; an already-unlocked blueprint is not researchable.

import { describe, it, expect } from "vitest";
import {
  freshState,
  BLUEPRINTS,
  ITEMS,
  blueprintUnlocked,
  blueprintResearchable,
  RESEARCH_FACILITY_KEY,
} from "./model";
import type { GameState } from "./model";

describe("Research R1 — BLUEPRINTS registry is well-formed", () => {
  it("is non-empty", () => {
    expect(Object.keys(BLUEPRINTS).length).toBeGreaterThan(0);
  });

  it("every entry: key matches its map key, tier >= 1, positive duration + credit cost", () => {
    for (const [key, bp] of Object.entries(BLUEPRINTS)) {
      expect(bp.key).toBe(key); // the `key` field mirrors the registry key (no drift)
      expect(typeof bp.label).toBe("string");
      expect(bp.label.length).toBeGreaterThan(0);
      expect(Number.isInteger(bp.tier)).toBe(true);
      expect(bp.tier).toBeGreaterThanOrEqual(1);
      expect(bp.researchDurationTicks).toBeGreaterThan(0);
      expect(bp.researchCreditCost).toBeGreaterThan(0);
    }
  });

  it("every recipe resolves to REAL ITEMS keys, with positive quantities", () => {
    for (const [key, bp] of Object.entries(BLUEPRINTS)) {
      // outputItem must be a real registry item, output quantity positive.
      expect(ITEMS[bp.recipe.outputItem], `${key} outputItem`).toBeDefined();
      expect(bp.recipe.outputQty).toBeGreaterThan(0);
      // Every recipe INPUT key must be a real registry item with a positive amount.
      const inputKeys = Object.keys(bp.recipe.inputs);
      expect(inputKeys.length, `${key} has >=1 input`).toBeGreaterThan(0);
      for (const inputKey of inputKeys) {
        expect(ITEMS[inputKey], `${key} input ${inputKey}`).toBeDefined();
        expect(bp.recipe.inputs[inputKey]).toBeGreaterThan(0);
      }
    }
  });

  it("seeds the proposed first-pass set at the expected tiers", () => {
    // Tier 1 -- basic components (minorComponent items).
    expect(BLUEPRINTS.frameSegmentBp).toBeDefined();
    expect(BLUEPRINTS.frameSegmentBp.tier).toBe(1);
    expect(BLUEPRINTS.frameSegmentBp.recipe.outputItem).toBe("frameSegment");

    expect(BLUEPRINTS.powerCouplingBp).toBeDefined();
    expect(BLUEPRINTS.powerCouplingBp.tier).toBe(1);
    expect(BLUEPRINTS.powerCouplingBp.recipe.outputItem).toBe("powerCoupling");

    // Tier 2 -- a major component built from tier-1 minor components + refined mats.
    expect(BLUEPRINTS.structuralAssemblyBp).toBeDefined();
    expect(BLUEPRINTS.structuralAssemblyBp.tier).toBe(2);
    expect(BLUEPRINTS.structuralAssemblyBp.recipe.outputItem).toBe("structuralAssembly");
  });
});

describe("Research R1 — GameState.researchedBlueprints seed", () => {
  it("fresh state seeds researchedBlueprints as an empty array", () => {
    expect(freshState().researchedBlueprints).toEqual([]);
  });
});

describe("Research R1 — blueprintUnlocked", () => {
  it("is false for every blueprint on a fresh state", () => {
    const state = freshState();
    for (const key of Object.keys(BLUEPRINTS)) {
      expect(blueprintUnlocked(state, key)).toBe(false);
    }
  });

  it("is true once a key is present in researchedBlueprints", () => {
    const state = freshState();
    state.researchedBlueprints = ["frameSegmentBp"];
    expect(blueprintUnlocked(state, "frameSegmentBp")).toBe(true);
    expect(blueprintUnlocked(state, "powerCouplingBp")).toBe(false);
  });

  it("is false for an unknown key", () => {
    expect(blueprintUnlocked(freshState(), "notABlueprint")).toBe(false);
  });
});

describe("Research R1 — blueprintResearchable (tier gated by research-facility level)", () => {
  // Helper: a fresh state with the research facility seeded at a chosen level. R2 will
  // add FACILITIES.research + seed it at level 1 in freshState; R1 has no facility yet,
  // so we inject the level directly here to prove the tier-gate logic works the moment
  // that level exists. RESEARCH_FACILITY_KEY is the single source of truth for the key.
  function stateWithResearchLevel(level: number): GameState {
    const state = freshState();
    state.facilities[RESEARCH_FACILITY_KEY] = { level };
    return state;
  }

  it("is FALSE for a tier-1 blueprint when the facility is absent (level 0 default)", () => {
    // Fresh R1 state has NO research facility -> defensive level read is 0 -> tier 1 > 0.
    expect(blueprintResearchable(freshState(), "frameSegmentBp")).toBe(false);
  });

  it("is TRUE for a tier-1 blueprint once the facility is level >= 1", () => {
    const state = stateWithResearchLevel(1);
    expect(blueprintResearchable(state, "frameSegmentBp")).toBe(true);
    expect(blueprintResearchable(state, "powerCouplingBp")).toBe(true);
  });

  it("is FALSE for a tier-2 blueprint at facility level 1, TRUE at level 2", () => {
    expect(blueprintResearchable(stateWithResearchLevel(1), "structuralAssemblyBp")).toBe(false);
    expect(blueprintResearchable(stateWithResearchLevel(2), "structuralAssemblyBp")).toBe(true);
  });

  it("is FALSE for an already-researched blueprint even when tier-available", () => {
    const state = stateWithResearchLevel(1);
    state.researchedBlueprints = ["frameSegmentBp"];
    expect(blueprintResearchable(state, "frameSegmentBp")).toBe(false);
  });

  it("is FALSE for an unknown blueprint key", () => {
    expect(blueprintResearchable(stateWithResearchLevel(5), "notABlueprint")).toBe(false);
  });
});
