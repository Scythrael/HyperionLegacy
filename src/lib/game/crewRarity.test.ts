import { describe, it, expect } from "vitest";
import {
  CREW_RARITY_MULTIPLIER,
  CREW_RARITY_CAP,
  clampCrewRarity,
  crewRarityMultiplier,
} from "./crewRarity";
import type { EquipmentRarity } from "./model";

describe("crewRarity: multiplier table", () => {
  it("covers the crew-usable band with the first-pass values", () => {
    expect(CREW_RARITY_MULTIPLIER.derelict).toBeCloseTo(0.9, 10);
    expect(CREW_RARITY_MULTIPLIER.standard).toBeCloseTo(1.0, 10);
    expect(CREW_RARITY_MULTIPLIER.augmented).toBeCloseTo(1.15, 10);
    expect(CREW_RARITY_MULTIPLIER.stellar).toBeCloseTo(1.35, 10);
  });

  // Rarity readiness RR-7 (answer 7) REPLACED the old "no rows above the cap" rule on purpose: every band now has a row
  // (so raising the cap can never make a higher band weaker), and the cap still clamps them (rarityTraps.test.ts).
  it("defines a row for every band above the cap, never weaker than Stellar (rarity readiness RR-7)", () => {
    expect(CREW_RARITY_MULTIPLIER.radiant).toBeGreaterThan(CREW_RARITY_MULTIPLIER.stellar);
    expect(CREW_RARITY_MULTIPLIER.luminous).toBeGreaterThanOrEqual(CREW_RARITY_MULTIPLIER.radiant);
    expect(CREW_RARITY_MULTIPLIER.constellar).toBe(CREW_RARITY_MULTIPLIER.luminous);
  });

  it("caps at stellar", () => {
    expect(CREW_RARITY_CAP).toBe("stellar");
  });
});

describe("crewRarity: clampCrewRarity", () => {
  it("passes through anything at or below the cap unchanged", () => {
    for (const r of ["derelict", "standard", "augmented", "stellar"] as EquipmentRarity[]) {
      expect(clampCrewRarity(r)).toBe(r);
    }
  });

  it("clamps anything above the cap down to stellar", () => {
    for (const r of ["radiant", "luminous", "constellar"] as EquipmentRarity[]) {
      expect(clampCrewRarity(r)).toBe("stellar");
    }
  });
});

describe("crewRarity: crewRarityMultiplier", () => {
  it("reads the table for in-band rarities", () => {
    expect(crewRarityMultiplier("standard")).toBeCloseTo(1.0, 10);
    expect(crewRarityMultiplier("stellar")).toBeCloseTo(1.35, 10);
  });

  it("clamps an over-cap rarity to the stellar multiplier rather than returning undefined", () => {
    expect(crewRarityMultiplier("constellar")).toBeCloseTo(1.35, 10);
  });
});
