// Gas Giant Study GG-1: every canister wears an SVG glyph from the shared registry (never emoji), the five gases share
// the cylinder and the antimatter cell has its own container; any other item has none here.

import { describe, expect, it } from "vitest";
import { ICON_PATHS } from "./icons";
import { ICON_SEMANTICS } from "./iconPacks";
import { GAS_CANISTER_ICON, gasCanisterIcon, researchDataIcon } from "./gasStudyIcons";
import { ANCIENT_DATA_FRAGMENT_ID, GAS_CANISTER_IDS, RESEARCH_DATA_ITEM, RESEARCH_FAMILIES } from "../game/gasGiantContent";

describe("gas study glyphs", () => {
  it("every canister maps to a registered, classified SVG icon", () => {
    for (const id of GAS_CANISTER_IDS) {
      const name = gasCanisterIcon(id);
      expect(name, id).toBe(GAS_CANISTER_ICON[id]);
      expect(ICON_PATHS[name!].length, id).toBeGreaterThan(0);
      expect(ICON_SEMANTICS[name!], id).toBe("subject");
    }
  });

  it("the gases share the cylinder; the antimatter cell is its own container", () => {
    expect(new Set(GAS_CANISTER_IDS.filter((id) => id !== "antimatterCell").map((id) => GAS_CANISTER_ICON[id]))).toEqual(new Set(["gasCanister"]));
    expect(GAS_CANISTER_ICON.antimatterCell).toBe("antimatterCell");
  });

  it("any other item has no canister glyph", () => {
    expect(gasCanisterIcon("commonOre")).toBeNull();
    expect(gasCanisterIcon("propulsionData")).toBeNull();
    expect(gasCanisterIcon("firstAidKit")).toBeNull();
  });

  // GG-6: the research data glyphs arrive with the Data study tab.
  it("every research data item wears the data crystal, the fragment its torn page; nothing else has one", () => {
    for (const f of RESEARCH_FAMILIES) {
      const name = researchDataIcon(RESEARCH_DATA_ITEM[f]);
      expect(name, f).toBe("researchData");
      expect(ICON_SEMANTICS[name!]).toBe("subject");
    }
    expect(researchDataIcon(ANCIENT_DATA_FRAGMENT_ID)).toBe("ancientFragment");
    expect(ICON_SEMANTICS.ancientFragment).toBe("subject");
    expect(researchDataIcon("hydrogenCanister")).toBeNull();
    expect(researchDataIcon("commonOre")).toBeNull();
  });
});
