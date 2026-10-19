// Field Kits FKR-3: the kit, bone line and enemy rank glyphs (fieldKitIcons.ts) are real registry SVGs, classified,
// exhaustive, and never shared between two meanings.

import { describe, it, expect } from "vitest";
import { ICON_NAMES, ICON_PATHS, type IconName } from "./icons";
import { ICON_SEMANTICS } from "./iconPacks";
import { BONE_CONDITION_ICON, ENEMY_RANK_ICON, FIELD_KIT_ICON, fieldKitBlueprintIcon, fieldKitIcon } from "./fieldKitIcons";
import { CONDITION_LINES, FIELD_KIT_BLUEPRINT, FIELD_KIT_IDS } from "../game/fieldKits";
import { ENEMY_RANK_IDS } from "../game/enemyRanks";
import { BLUEPRINTS, ITEMS } from "../game/model";

const ALL: IconName[] = [...Object.values(FIELD_KIT_ICON), ...Object.values(BONE_CONDITION_ICON), ...Object.values(ENEMY_RANK_ICON)];

describe("field kit glyphs (FKR-3)", () => {
  it("every kit has a glyph, every bone rank has one, every enemy rank has one", () => {
    expect(Object.keys(FIELD_KIT_ICON).sort()).toEqual([...FIELD_KIT_IDS].sort());
    expect(Object.keys(BONE_CONDITION_ICON)).toEqual(CONDITION_LINES.bone.map((r) => r.id));
    expect(Object.keys(ENEMY_RANK_ICON)).toEqual([...ENEMY_RANK_IDS]);
  });

  it("each is a registry glyph, used for one meaning only", () => {
    for (const name of ALL) expect(ICON_NAMES).toContain(name);
    expect(new Set(ALL).size).toBe(ALL.length);
    const drawings = ALL.map((n) => (ICON_PATHS[n] as readonly string[]).join("|"));
    expect(new Set(drawings).size).toBe(drawings.length);
  });

  it("kits are subjects; the bone line and the rank chips are alerts", () => {
    for (const n of Object.values(FIELD_KIT_ICON)) expect(ICON_SEMANTICS[n]).toBe("subject");
    for (const n of Object.values(BONE_CONDITION_ICON)) expect(ICON_SEMANTICS[n]).toBe("alert");
    for (const n of Object.values(ENEMY_RANK_ICON)) expect(ICON_SEMANTICS[n]).toBe("alert");
  });

  it("an item key resolves to its kit's glyph; any other item has none", () => {
    for (const id of FIELD_KIT_IDS) expect(fieldKitIcon(id)).toBe(FIELD_KIT_ICON[id]);
    for (const id of Object.keys(ITEMS)) if (ITEMS[id].category !== "fieldKit") expect(fieldKitIcon(id), id).toBeNull();
    expect(fieldKitIcon("notAnItem")).toBeNull();
  });

  it("a kit blueprint resolves to its kit's glyph; any other blueprint has none", () => {
    for (const id of FIELD_KIT_IDS) expect(fieldKitBlueprintIcon(FIELD_KIT_BLUEPRINT[id])).toBe(FIELD_KIT_ICON[id]);
    const kitKeys = new Set(Object.values(FIELD_KIT_BLUEPRINT));
    for (const key of Object.keys(BLUEPRINTS)) if (!kitKeys.has(key)) expect(fieldKitBlueprintIcon(key), key).toBeNull();
    expect(fieldKitBlueprintIcon("notABlueprint")).toBeNull();
  });
});
