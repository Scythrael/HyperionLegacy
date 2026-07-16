// ============================================================================
// Fabricator (Phase 4) tests
//
// Task F1 (DATA MODEL): the Fabricator facility mirrors the Research Lab exactly
// (FACILITIES.research / researchSlotCount / the level-1 fresh seed). These tests
// pin down:
//   - every BLUEPRINTS entry carries a positive-finite craftDurationTicks (the
//     Fabricator's time cost, the analog of researchDurationTicks);
//   - FACILITIES.fabricator exists with a FINITE upgrade track whose rung COUNT
//     equals the number of blueprint tiers (each level unlocks the next tier, the
//     SAME level-derived tier gate the Research Lab uses) and whose chosen rungs
//     carry an { addFabricateSlots } grant;
//   - fabricateSlotCount derives 1 slot on a fresh (level-1) save and rises per the
//     rung data once the facility reaches level 2;
//   - freshState seeds the facility at level 1.
//
// Deliberately parallels research.test.ts's R2 block. Assertions on the level-2
// slot count are computed FROM the rung data (not a magic literal) so retuning a
// rung's addFabricateSlots keeps the test honest.
// ============================================================================

import { describe, it, expect } from "vitest";
import { freshState, BLUEPRINTS, FACILITIES, FABRICATOR_FACILITY_KEY } from "./model";
import { fabricateSlotCount } from "./tick";

describe("Fabricator F1 — BLUEPRINTS craftDurationTicks", () => {
  it("every blueprint has a positive, finite craftDurationTicks", () => {
    for (const key of Object.keys(BLUEPRINTS)) {
      const bp = BLUEPRINTS[key];
      expect(Number.isFinite(bp.craftDurationTicks)).toBe(true);
      expect(bp.craftDurationTicks).toBeGreaterThan(0);
    }
  });
});

describe("Fabricator F1 — FACILITIES.fabricator (tier + slot upgrade track)", () => {
  it("exists, is labelled 'Fabricator', with a FINITE track (one rung per blueprint tier)", () => {
    const fab = FACILITIES.fabricator;
    expect(fab).toBeDefined();
    expect(fab.label).toBe("Fabricator");

    // Level-derived tier gate (like the Research Lab): the track has exactly one
    // rung per blueprint tier, so reaching level L unlocks fabrication of tier L.
    const maxTier = Math.max(...Object.values(BLUEPRINTS).map((bp) => bp.tier));
    expect(fab.upgrades.length).toBe(maxTier);
    expect(maxTier).toBe(2); // real content today: tiers 1-2 only (finite, no placeholder rungs)
  });

  it("the founding rung (0->1) grants the first fabricate slot, ungated + zero-cost", () => {
    const founding = FACILITIES.fabricator.upgrades[0];
    expect(founding.effect).toEqual({ addFabricateSlots: 1 });
    expect(founding.durationTicks).toBe(0);
    expect(founding.credits).toBeUndefined();
  });

  it("the level 1->2 rung unlocks tier 2, adds a slot, and is CREDITS-gated (no materials)", () => {
    const rung = FACILITIES.fabricator.upgrades[1];
    expect(rung.effect).toEqual({ addFabricateSlots: 1 }); // +1 slot on this chosen rung
    expect(rung.materials).toEqual({});                    // materials are the CRAFT cost, not the upgrade cost
    expect(rung.credits).toBeDefined();                    // upgrades cost credits, like every other facility
  });

  it("FABRICATOR_FACILITY_KEY resolves to the FACILITIES entry", () => {
    expect(FABRICATOR_FACILITY_KEY).toBe("fabricator");
    expect(FACILITIES[FABRICATOR_FACILITY_KEY]).toBe(FACILITIES.fabricator);
  });
});

describe("Fabricator F1 — fabricateSlotCount + fresh-state seed", () => {
  it("freshState seeds the fabricator facility at level 1", () => {
    expect(freshState().facilities[FABRICATOR_FACILITY_KEY]).toEqual({ level: 1 });
  });

  it("fabricateSlotCount is 1 on a fresh state (level 1 = one slot)", () => {
    expect(fabricateSlotCount(freshState())).toBe(1);
  });

  it("fabricateSlotCount rises per the rung data once the facility reaches level 2", () => {
    const state = freshState();
    state.facilities[FABRICATOR_FACILITY_KEY] = { level: 2 };

    // Expected = SUM of addFabricateSlots across the reached rungs (upgrades[0..1]),
    // asserted against the rung data rather than a hard-coded 2 -- retuning a rung's
    // slot grant keeps this test in sync automatically.
    const expected = FACILITIES.fabricator.upgrades
      .slice(0, 2)
      .reduce((sum, u) => sum + ("addFabricateSlots" in u.effect ? u.effect.addFabricateSlots : 0), 0);

    expect(fabricateSlotCount(state)).toBe(expected);
  });

  it("fabricateSlotCount is 0 when the facility is absent (defensive level-0 read)", () => {
    const state = freshState();
    delete state.facilities[FABRICATOR_FACILITY_KEY];
    expect(fabricateSlotCount(state)).toBe(0);
  });
});
