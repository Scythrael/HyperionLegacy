// Gas Giant Study GG-1: every canister wears an SVG glyph from the shared registry (never emoji), the five gases share
// the cylinder and the antimatter cell has its own container; any other item has none here.

import { describe, expect, it } from "vitest";
import { ICON_PATHS } from "./icons";
import { ICON_SEMANTICS } from "./iconPacks";
import { GAS_CANISTER_ICON, gasCanisterIcon } from "./gasStudyIcons";
import { GAS_CANISTER_IDS } from "../game/gasGiantContent";

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
});
