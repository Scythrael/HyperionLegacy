// RARITY READINESS RR-0 (docs/plans/2026-10-23-rarity-readiness-plan.md): the goldens captured on the engine BEFORE any
// rarity engine edit. LIVE pins (Standard to Radiant, ascension "none", the real inspect mint and the craft preview)
// may never move in any rarity readiness slice; RESERVED pins (Derelict, Luminous, Constellar, Nova, Celestial) move
// only in the slice the fixture header names, with the move explained in that commit. See rarityGoldens.fixture.ts.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { BLUEPRINTS, EQUIPMENT_RARITY_LADDER } from "./model";
import { WEAPON_DEFS } from "./combat/weapons";
import { ROLE_TEMPLATE } from "./combat/drones";
import {
  LIVE_BANDS,
  RARITY_GOLDENS_LIVE,
  RARITY_GOLDENS_RESERVED,
  RESERVED_BANDS,
  computeLivePins,
  computeReservedPins,
  gearBlueprintKeys,
  liveSlots,
} from "./rarityGoldens.fixture";

// RR_CAPTURE = an output path: record every pin instead of asserting (the GW_CAPTURE pattern).
const CAPTURE = Boolean(import.meta.env.RR_CAPTURE);

describe("rarity readiness goldens (RR-0, captured before any rarity engine edit)", () => {
  it("covers the whole ladder, every live slot, weapon, drone role and gear blueprint (vacuity guard)", () => {
    expect([...LIVE_BANDS, ...RESERVED_BANDS].sort()).toEqual([...EQUIPMENT_RARITY_LADDER].sort());
    expect(liveSlots().length).toBeGreaterThanOrEqual(13);
    expect(Object.keys(WEAPON_DEFS).length).toBeGreaterThan(0);
    expect(Object.keys(ROLE_TEMPLATE).length).toBe(3);
    const gear = gearBlueprintKeys();
    expect(gear.length).toBeGreaterThan(50);
    for (const k of gear) expect(BLUEPRINTS[k]).toBeDefined();
  });

  if (CAPTURE) {
    it("captures", () => {
      writeFileSync(String(import.meta.env.RR_CAPTURE), JSON.stringify({ live: computeLivePins(), reserved: computeReservedPins() }, null, 2));
    });
    return;
  }

  it("LIVE: Standard to Radiant, the inspect mint and the craft preview are byte-identical", () => {
    const pins = computeLivePins();
    expect(Object.keys(pins).sort()).toEqual(Object.keys(RARITY_GOLDENS_LIVE).sort());
    for (const [k, v] of Object.entries(pins)) expect(v, k).toBe(RARITY_GOLDENS_LIVE[k]);
  });

  it("RESERVED: Derelict, Luminous, Constellar, Nova and Celestial (moved only by the slice that names them)", () => {
    const pins = computeReservedPins();
    expect(Object.keys(pins).sort()).toEqual(Object.keys(RARITY_GOLDENS_RESERVED).sort());
    for (const [k, v] of Object.entries(pins)) expect(v, k).toBe(RARITY_GOLDENS_RESERVED[k]);
  });
});
