// Ground Operations GO-6 (GO-5 review b): hazard resist readouts show the EFFECTIVE resist (relics.ts
// effectiveHazardResist, the curve toward the 75% cap), never the raw sum, and say it diminishes.

import { describe, it, expect } from "vitest";
import type { EquipmentInstance, EquipmentSlotType } from "../game/model";
import { effectiveHazardResist } from "../game/relics";
import { PATHFINDER_SUITE_KEY, pathfinderEffect } from "../game/utilityGear";
import { GEAR_POINT_BUMP } from "../game/awayTeam";
import { hazardResistEffectText, pieceHazardResist, pieceHazardResistText } from "./hazardResistText";

function piece(slotType: EquipmentSlotType, moduleVariant: string | undefined, implicitStats: Record<string, number>, rolledStats: Record<string, number> = {}): EquipmentInstance {
  return {
    id: "equip-1",
    slotType,
    ...(moduleVariant !== undefined ? { moduleVariant } : {}),
    rarity: "standard",
    ascension: "none",
    quality: 2,
    iLevel: 10,
    blueprintKey: "bp-test",
    implicitStats,
    rolledStats,
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    durability: 100,
    fittedToShipId: null,
  };
}

const NO_DASH = /\u2014|-{2}/;

describe("hazardResistEffectText (GO-6 display fix)", () => {
  it("shows the effective resist, and the raw value only where the curve moved it", () => {
    expect(effectiveHazardResist(0.3)).toBeCloseTo(0.285, 3);
    expect(hazardResistEffectText(0.3)).toBe("28.5% (diminishing from 30.0%)");
    expect(hazardResistEffectText(0.3, true)).toBe("+28.5% (diminishing from +30.0%)");
    // A small resist barely moves on the curve: same one-decimal number, no "from".
    expect(hazardResistEffectText(0.01)).toBe("1.0% (diminishing)");
    // Never the cap, however big the raw sum.
    expect(hazardResistEffectText(5)).toBe("75.0% (diminishing from 500.0%)");
    expect(effectiveHazardResist(5)).toBeLessThan(0.75);
  });

  it("no resist reads 0%", () => {
    expect(hazardResistEffectText(0)).toBe("0%");
    expect(hazardResistEffectText(Number.NaN, true)).toBe("+0%");
  });

  it("carries no em dash or double hyphen", () => {
    for (const raw of [0, 0.01, 0.3, 1.5]) expect(NO_DASH.test(hazardResistEffectText(raw, true))).toBe(false);
  });
});

describe("pieceHazardResist / pieceHazardResistText (the item tooltip)", () => {
  it("a Pathfinder Suite's hazard line reads through its curve, then the effective curve", () => {
    const p = piece("specUtility", PATHFINDER_SUITE_KEY, { hazardResist: 12, sensors: 4 }, { hazardResist: 3 });
    const raw = pathfinderEffect([p]).hazardResist;
    expect(raw).toBeGreaterThan(0);
    expect(pieceHazardResist(p)).toBe(raw);
    expect(pieceHazardResistText(p)).toBe(`Hazard resist ${hazardResistEffectText(raw)}`);
  });

  it("a member piece's groundHazardResist converts like the snapshot does (Assault Hardsuit, Hazard Suit)", () => {
    const p = piece("memberArmor", "assaultHardsuit", { groundHazardResist: 20 }, { groundArmor: 5 });
    expect(pieceHazardResist(p)).toBeCloseTo(20 * GEAR_POINT_BUMP.hazardResist, 12);
    expect(pieceHazardResistText(p)).toBe(`Hazard resist ${hazardResistEffectText(20 * GEAR_POINT_BUMP.hazardResist)}`);
  });

  it("a piece with no hazard line has no readout", () => {
    expect(pieceHazardResistText(piece("memberWeapon", "pulseRifle", { groundPower: 10 }))).toBeNull();
    expect(pieceHazardResistText(piece("ftlDrive", undefined, { transitSpeedMult: 4 }))).toBeNull();
    // A hazardResist line on anything but a Pathfinder Suite does nothing in a run, so it reads nothing.
    expect(pieceHazardResistText(piece("specUtility", "damageControlSuite", { hazardResist: 9 }))).toBeNull();
  });
});
