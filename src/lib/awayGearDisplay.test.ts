// E-CREW Task 10: the away-team gear display helpers (slot labels, piece naming, spare grouping, gear
// categories, the member compare rows).

import { describe, it, expect } from "vitest";
import { BLUEPRINTS, EQUIPMENT_SLOTS, MEMBER_SLOT_TYPES } from "./game/model";
import type { EquipmentInstance, EquipmentSlotType } from "./game/model";
import { ICON_NAMES } from "./ui/icons";
import {
  MEMBER_SLOT_META,
  MEMBER_GEAR_CELLS,
  memberSlotIcon,
  memberPieceName,
  memberWearersText,
  groupMemberSpares,
  gearCategoryOfSlot,
  blueprintGearCategory,
  pieceStatTotals,
  memberCompareRows,
  fmtGearStat,
} from "./awayGearDisplay";

function piece(
  id: string,
  slotType: EquipmentSlotType,
  moduleVariant: string | undefined,
  overrides: Partial<EquipmentInstance> = {}
): EquipmentInstance {
  return {
    id,
    slotType,
    ...(moduleVariant !== undefined ? { moduleVariant } : {}),
    rarity: "standard",
    ascension: "none",
    quality: 2,
    iLevel: 10,
    blueprintKey: "bp-test",
    implicitStats: {},
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    durability: 100,
    fittedToShipId: null,
    ...overrides,
  };
}

describe("awayGearDisplay: slot labels", () => {
  it("labels every member slot with a real glyph, and the card draws the three singletons in mockup order", () => {
    for (const slot of MEMBER_SLOT_TYPES) {
      const meta = MEMBER_SLOT_META[slot];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.plural.length).toBeGreaterThan(0);
      expect(ICON_NAMES).toContain(meta.icon);
    }
    expect(MEMBER_GEAR_CELLS).toEqual(["memberArmor", "memberWeapon", "memberTool"]);
    expect(memberSlotIcon("implant")).toBe("implant");
    expect(memberSlotIcon("cargoBay")).toBeNull();
  });
});

describe("awayGearDisplay: memberPieceName", () => {
  it("names a crafted piece by its variety and a Standard-Issue piece with the variety after the prefix", () => {
    expect(memberPieceName(piece("a", "memberWeapon", "pulseRifle"))).toBe("Pulse Rifle");
    expect(memberPieceName(piece("b", "memberWeapon", "pulseRifle", { blueprintKey: null }))).toBe(
      "Standard-Issue Pulse Rifle"
    );
    expect(memberPieceName(piece("c", "implant", "dermalWeave"))).toBe("Dermal Weave");
  });

  it("falls back to the slot label when the variety does not resolve", () => {
    expect(memberPieceName(piece("d", "memberTool", undefined))).toBe(EQUIPMENT_SLOTS.memberTool.label);
    expect(memberPieceName(piece("e", "memberTool", "retiredKey", { blueprintKey: null }))).toBe(
      `Standard-Issue ${EQUIPMENT_SLOTS.memberTool.label}`
    );
  });

  it("a crafted piece's name matches its blueprint's name", () => {
    for (const bp of Object.values(BLUEPRINTS)) {
      const out = bp.equipmentOutput;
      if (!out || !MEMBER_SLOT_TYPES.includes(out.slotType as (typeof MEMBER_SLOT_TYPES)[number])) continue;
      expect(memberPieceName(piece("x", out.slotType, out.varietyKey))).toBe(bp.label.replace(/ Blueprint$/, ""));
    }
  });
});

describe("awayGearDisplay: memberWearersText", () => {
  it("names the one squad a piece is for", () => {
    expect(memberWearersText(piece("a", "memberWeapon", "pulseRifle"))).toBe("Security only");
    expect(memberWearersText(piece("b", "memberWeapon", "sidearm"))).toBe("Science only");
    expect(memberWearersText(piece("c", "cargoBay", undefined))).toBe("");
  });
});

describe("awayGearDisplay: groupMemberSpares", () => {
  it("groups member pieces by slot in Armor, Weapon, Tool, Implant order, drops ship pieces and empty groups", () => {
    const pool = [
      piece("1", "implant", "dermalWeave"),
      piece("2", "cargoBay", undefined),
      piece("3", "memberWeapon", "pulseRifle"),
      piece("4", "memberArmor", "fieldSuit"),
    ];
    const groups = groupMemberSpares(pool);
    expect(groups.map((g) => g.slot)).toEqual(["memberArmor", "memberWeapon", "implant"]);
    expect(groups.map((g) => g.label)).toEqual(["Armor", "Weapons", "Implants"]);
  });

  it("sorts favorites to the top of their group and keeps pool order otherwise", () => {
    const pool = [
      piece("1", "memberTool", "medKit"),
      piece("2", "memberTool", "medKit", { favorite: true }),
      piece("3", "memberTool", "medKit"),
    ];
    expect(groupMemberSpares(pool)[0].pieces.map((p) => p.id)).toEqual(["2", "1", "3"]);
  });
});

describe("awayGearDisplay: gear categories", () => {
  it("files ship slots, member gear and implants apart", () => {
    expect(gearCategoryOfSlot("cargoBay")).toBe("ship");
    expect(gearCategoryOfSlot("weapon")).toBe("ship");
    expect(gearCategoryOfSlot("memberWeapon")).toBe("awayTeam");
    expect(gearCategoryOfSlot("implant")).toBe("implant");
  });

  it("files every gear blueprint and leaves materials and unlock-only blueprints out", () => {
    let member = 0;
    let implant = 0;
    for (const bp of Object.values(BLUEPRINTS)) {
      const cat = blueprintGearCategory(bp);
      if (bp.unlockOnly || (!bp.weaponOutput && !bp.droneOutput && !bp.equipmentOutput)) {
        expect(cat).toBeNull();
        continue;
      }
      expect(cat).not.toBeNull();
      if (cat === "awayTeam") member++;
      if (cat === "implant") implant++;
    }
    expect(member).toBeGreaterThan(0);
    expect(implant).toBeGreaterThan(0);
  });
});

describe("awayGearDisplay: memberCompareRows", () => {
  it("sums implicit and rolled lines per stat", () => {
    expect(
      pieceStatTotals(piece("a", "memberWeapon", "pulseRifle", { implicitStats: { groundPower: 4 }, rolledStats: { groundPower: 1, groundAccuracy: 2 } }))
    ).toEqual([
      ["groundPower", 5],
      ["groundAccuracy", 2],
    ]);
  });

  it("compares against an empty slot as zero", () => {
    const cand = piece("a", "memberWeapon", "pulseRifle", { implicitStats: { groundPower: 4 } });
    expect(memberCompareRows(null, cand)).toEqual([{ key: "groundPower", current: 0, candidate: 4, delta: 4 }]);
  });

  it("lists the candidate's stats first, then a stat only the current piece carries", () => {
    const cur = piece("a", "memberArmor", "fieldSuit", { implicitStats: { groundArmor: 3 }, rolledStats: { groundFieldwork: 2 } });
    const cand = piece("b", "memberArmor", "fieldSuit", { implicitStats: { groundArmor: 5 } });
    expect(memberCompareRows(cur, cand)).toEqual([
      { key: "groundArmor", current: 3, candidate: 5, delta: 2 },
      { key: "groundFieldwork", current: 2, candidate: 0, delta: -2 },
    ]);
  });

  it("formats magnitudes the way the tooltip does", () => {
    expect(fmtGearStat(4)).toBe("+4");
    expect(fmtGearStat(3.26)).toBe("+3.3");
    expect(fmtGearStat(-2)).toBe("-2");
  });
});
