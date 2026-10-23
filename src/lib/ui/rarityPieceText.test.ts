// RARITY READINESS RR-8: the two tooltip lines a legendary piece gains (its Luminous legendary affix, its Constellar set).

import { describe, expect, it } from "vitest";
import { EQUIPMENT_SLOTS, type EquipmentInstance } from "../game/model";
import { generateEquipment } from "../game/itemgen";
import { pieceLegendaryAffixText, pieceSetText } from "./rarityPieceText";
import tooltipSource from "../EquipmentTooltip.svelte?raw";

function cargo(over: Partial<EquipmentInstance>): EquipmentInstance {
  const p = generateEquipment({ slotType: "cargoBay", varietyKey: EQUIPMENT_SLOTS.cargoBay.varieties[0].key, blueprintKey: null, iLevel: 20, quality: 3, rarity: "radiant", ascension: "none", rng: () => 0.5, allocateId: () => "e" });
  return { ...p, ...over };
}

describe("RR-8: the legendary affix line", () => {
  it("names a Luminous piece's affix; nothing for any other piece or an unknown id", () => {
    const lum = generateEquipment({ slotType: "cargoBay", varietyKey: EQUIPMENT_SLOTS.cargoBay.varieties[0].key, blueprintKey: null, iLevel: 20, quality: 3, rarity: "luminous", ascension: "none", rng: () => 0.5, allocateId: () => "e" });
    expect(pieceLegendaryAffixText(lum)).toBe("Legendary affix: Bottomless Hold");
    expect(pieceLegendaryAffixText(cargo({}))).toBeNull();
    expect(pieceLegendaryAffixText(cargo({ legendaryAffixId: "noSuchAffix" }))).toBeNull();
  });
});

describe("RR-8: the set line", () => {
  it("names a Constellar set piece's set and its thresholds", () => {
    expect(pieceSetText(cargo({ rarity: "constellar", setId: "testSetSurvey" }))).toBe("Set: Survey Cadre (2 / 3 / 5 pieces)");
  });
  it("a Celestial set piece says it lowers every threshold by one", () => {
    expect(pieceSetText(cargo({ rarity: "constellar", ascension: "celestial", setId: "testSetSurvey" }))).toBe(
      "Set: Survey Cadre (2 / 3 / 5 pieces, one fewer each with this Celestial piece)",
    );
  });
  it("nothing for a piece that counts toward no set", () => {
    expect(pieceSetText(cargo({}))).toBeNull();
    expect(pieceSetText(cargo({ rarity: "radiant", setId: "testSetSurvey" }))).toBeNull(); // only Constellar carries a set
    expect(pieceSetText(cargo({ rarity: "constellar", setId: "testSetField" }))).toBeNull(); // not a cargo bay set
  });
});

describe("RR-8: the tooltip shows both lines on a finished piece", () => {
  it("EquipmentTooltip builds them from the piece and renders each as one detail line", () => {
    expect(tooltipSource).toContain("legendaryAffix: pieceLegendaryAffixText(p),");
    expect(tooltipSource).toContain("setLine: pieceSetText(p),");
    expect(tooltipSource).toMatch(/\{#if view\.legendaryAffix\}\s*<div class="et-detail">\{view\.legendaryAffix\}<\/div>/);
    expect(tooltipSource).toMatch(/\{#if view\.setLine\}\s*<div class="et-detail">\{view\.setLine\}<\/div>/);
  });
});
