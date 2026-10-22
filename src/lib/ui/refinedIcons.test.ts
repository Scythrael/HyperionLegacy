// ML-2 recipe realism: the two new refined goods wear SVG glyphs from the shared registry (never emoji); any other
// item has none here and keeps its category glyph.

import { describe, expect, it } from "vitest";
import { ICON_PATHS } from "./icons";
import { ICON_SEMANTICS } from "./iconPacks";
import { REFINED_ITEM_ICON, refinedItemIcon } from "./refinedIcons";
import { ITEMS } from "../game/model";

describe("refined good glyphs", () => {
  it("Biofiber and Resin Distillate each map to their own registered, classified SVG icon", () => {
    expect(Object.keys(REFINED_ITEM_ICON).sort()).toEqual(["biofiber", "resinDistillate"]);
    for (const [id, name] of Object.entries(REFINED_ITEM_ICON)) {
      expect(ITEMS[id]?.category, id).toBe("refined");
      expect(refinedItemIcon(id), id).toBe(name);
      expect(ICON_PATHS[name].length, id).toBeGreaterThan(0);
      expect(ICON_SEMANTICS[name], id).toBe("subject");
    }
    expect(new Set(Object.values(REFINED_ITEM_ICON)).size).toBe(2);
  });

  it("any other item has no refined glyph here", () => {
    expect(refinedItemIcon("titaniumIngot")).toBeNull();
    expect(refinedItemIcon("purifiedBiomass")).toBeNull();
    expect(refinedItemIcon("toString")).toBeNull();
  });
});
