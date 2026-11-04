// E-CREW Task 10: the away-team gear display helpers (slot labels, piece naming, spare grouping, gear
// categories, the member compare rows).

import { describe, it, expect } from "vitest";
import { BLUEPRINTS, EQUIPMENT_SLOTS, ITEMS, MEMBER_SLOT_TYPES, MODULE_BLUEPRINTS, freshState, shipDisplayLabel } from "./game/model";
import { FIELD_KIT_BLUEPRINT } from "./game/fieldKits";
import type { AwayMember, AwayTeamType, EquipmentInstance, EquipmentSlotType, GameState } from "./game/model";
import { memberFitBlockText } from "./game/memberEquipment";
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
  isFieldKitBlueprint,
  fabricatorGroupOf,
  fabricateKeyGroups,
  FABRICATOR_GROUP_LABEL,
  FABRICATOR_GROUP_ORDER,
  researchSectionOf,
  RESEARCH_SECTION_ORDER,
  RESEARCH_SECTION_LABEL,
  pieceStatTotals,
  memberCompareRows,
  fmtGearStat,
  memberGradeText,
  isUniqueEquippedPiece,
  uniqueWearerLabel,
  memberFitReasonText,
  UNIQUE_SELF_TEXT_PICKER,
  UNIQUE_SELF_TEXT_GEAR_MODAL,
  NEEDS_MEDICAL_TRAINING_TEXT,
  UNTRAINED_MED_KIT_TEXT,
  pieceNeedsMedicalTraining,
  untrainedGearNote,
} from "./awayGearDisplay";
import { hasMedicalTraining } from "./game/awayTraits";
import { REQUISITION_ENTRIES } from "./game/quartermaster";

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

describe("awayGearDisplay: the Fabricator and Research shelves (Field Kits FKR-3)", () => {
  const kitKeys = Object.values(FIELD_KIT_BLUEPRINT);

  it("a field kit blueprint is a material blueprint whose output is a fieldKit item, and nothing else is", () => {
    for (const bp of Object.values(BLUEPRINTS)) {
      const isKit = kitKeys.includes(bp.key);
      expect(isFieldKitBlueprint(bp), bp.key).toBe(isKit);
      if (isKit) expect(ITEMS[bp.recipe.outputItem ?? ""].category).toBe("fieldKit");
    }
  });

  it("files kit blueprints under Field Kits; every other shelf is unchanged", () => {
    for (const bp of Object.values(BLUEPRINTS)) {
      const g = fabricatorGroupOf(bp);
      if (kitKeys.includes(bp.key)) expect(g, bp.key).toBe("fieldKit");
      // E-MOD EM-10: a universal module craft files under its own "Modules" shelf.
      else if (bp.equipmentOutput?.slotType === "module") expect(g, bp.key).toBe("module");
      // Complement CP-12: a bridge or quarters module craft files under its own "Crew Modules" shelf.
      else if (bp.equipmentOutput?.slotType === "bridge" || bp.equipmentOutput?.slotType === "quarters") expect(g, bp.key).toBe("crewModule");
      else expect(g, bp.key).toBe(blueprintGearCategory(bp) ?? "material");
    }
    expect(FABRICATOR_GROUP_LABEL.module).toBe("Modules");
    expect(FABRICATOR_GROUP_ORDER.indexOf("module")).toBe(FABRICATOR_GROUP_ORDER.indexOf("ship") + 1);
    expect(FABRICATOR_GROUP_LABEL.crewModule).toBe("Crew Modules");
    expect(FABRICATOR_GROUP_ORDER.indexOf("crewModule")).toBe(FABRICATOR_GROUP_ORDER.indexOf("module") + 1);
    expect(Object.values(MODULE_BLUEPRINTS).every((bp) => fabricatorGroupOf(bp) === "module")).toBe(true);
    expect(FABRICATOR_GROUP_LABEL.fieldKit).toBe("Field Kits");
    expect(FABRICATOR_GROUP_LABEL.material).toBe("Materials");
    expect(FABRICATOR_GROUP_ORDER[FABRICATOR_GROUP_ORDER.length - 1]).toBe("fieldKit");
  });

  it("the Item dropdown's groups for a tier: labeled shelves in order, Field Kits last, each in BLUEPRINTS order", () => {
    const all = Object.values(BLUEPRINTS);
    const groups = fabricateKeyGroups(all, 1);
    expect(groups.map((g) => g.key)).toEqual(FABRICATOR_GROUP_ORDER.filter((k) => groups.some((g) => g.key === k)));
    const kits = groups.find((g) => g.key === "fieldKit");
    expect(kits?.label).toBe("Field Kits");
    expect(kits?.keys).toEqual(["firstAidKitBp", "antitoxinBp", "splintBp"]);
    const tier2Kits = fabricateKeyGroups(all, 2).find((g) => g.key === "fieldKit");
    expect(tier2Kits?.keys).toEqual(["combatStimBp", "traumaKitBp", "injuryKitBp"]);
    const keys = groups.flatMap((g) => g.keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(all.filter((bp) => bp.tier === 1).map((bp) => bp.key).sort());
  });

  it("a tier holding one kind lists plain options (one unlabeled group), as before", () => {
    const only = [BLUEPRINTS.firstAidKitBp, BLUEPRINTS.splintBp];
    expect(fabricateKeyGroups(only, 1)).toEqual([{ key: "fieldKit", label: null, keys: ["firstAidKitBp", "splintBp"] }]);
    expect(fabricateKeyGroups([BLUEPRINTS.frameSegmentBp], 1)).toEqual([{ key: "material", label: null, keys: ["frameSegmentBp"] }]);
    expect(fabricateKeyGroups(only, 2)).toEqual([]);
  });

  it("the Research list files kit blueprints into a trailing Field Kits section", () => {
    for (const bp of Object.values(BLUEPRINTS)) {
      const sec = researchSectionOf(bp);
      if (kitKeys.includes(bp.key)) expect(sec).toBe("fieldKit");
      // Complement CP-12 fix round: a bridge or quarters blueprint files under its own "Crew Modules" section.
      else if (!bp.unlockOnly && (bp.equipmentOutput?.slotType === "bridge" || bp.equipmentOutput?.slotType === "quarters")) expect(sec, bp.key).toBe("crewModule");
      else {
        const c = blueprintGearCategory(bp);
        expect(sec).toBe(c === "awayTeam" || c === "implant" ? c : "main");
      }
    }
    expect(RESEARCH_SECTION_ORDER).toEqual(["main", "crewModule", "awayTeam", "implant", "fieldKit"]);
    expect(RESEARCH_SECTION_LABEL).toEqual({ main: null, crewModule: "Crew Modules", awayTeam: "Away-Team Gear", implant: "Implants", fieldKit: "Field Kits" });
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
    // Never a signed zero, and a value that rounds to a whole number prints whole.
    expect(fmtGearStat(-0.04)).toBe("+0");
    expect(fmtGearStat(0.04)).toBe("+0");
    expect(fmtGearStat(2.96)).toBe("+3");
  });

  it("grades a piece one way everywhere", () => {
    const crafted = piece("a", "memberWeapon", "pulseRifle", { rarity: "radiant", quality: 4, iLevel: 40 });
    expect(memberGradeText(crafted)).toBe("Radiant · Q4");
    expect(memberGradeText(crafted, true)).toBe("Radiant · Q4 · iL 40");
    expect(memberGradeText({ ...crafted, blueprintKey: null }, true)).toBe("Standard-Issue · iL 40");
  });
});

// ===== Task 11: who wears the fleet's one unique-equipped piece =====

function crew(id: string, name: string, teamType: AwayTeamType, shipId: string | null): AwayMember {
  return {
    id,
    teamType,
    spec: teamType === "science" ? "geology" : "offense",
    name,
    race: "earthBorn",
    gender: "female",
    rank: 1,
    traits: [],
    assignedShipId: shipId,
  };
}

function uniqueState(equipment: EquipmentInstance[]): GameState {
  const fs = freshState();
  return {
    ...fs,
    equipment,
    awayMembers: [crew("m-on", "Kira Vale", "security", fs.ships[0].id), crew("m-off", "Ana Rook", "security", null)],
  };
}

describe("awayGearDisplay: isUniqueEquippedPiece", () => {
  it("is true only for a unique-equipped variety (Neural Backup)", () => {
    expect(isUniqueEquippedPiece(piece("a", "implant", "neuralBackup"))).toBe(true);
    expect(isUniqueEquippedPiece(piece("b", "implant", "dermalWeave"))).toBe(false);
    expect(isUniqueEquippedPiece(piece("c", "implant", undefined))).toBe(false);
    expect(isUniqueEquippedPiece(piece("d", "cargoBay", "neuralBackup"))).toBe(false);
  });
});

describe("awayGearDisplay: uniqueWearerLabel", () => {
  it("names the member wearing ANOTHER copy and their ship", () => {
    const s = uniqueState([
      piece("nb-1", "implant", "neuralBackup", { fittedToMemberId: "m-on" }),
      piece("nb-2", "implant", "neuralBackup"),
    ]);
    expect(uniqueWearerLabel(s, byId(s, "nb-2"))).toBe(`Kira Vale (${shipDisplayLabel(s, s.ships[0])})`);
  });

  it("says squad and unassigned for a benched wearer", () => {
    const s = uniqueState([
      piece("nb-1", "implant", "neuralBackup", { fittedToMemberId: "m-off" }),
      piece("nb-2", "implant", "neuralBackup"),
    ]);
    expect(uniqueWearerLabel(s, byId(s, "nb-2"))).toBe("Ana Rook (Security, unassigned)");
  });

  it("is null when nobody wears one, for the worn copy itself, for a non-unique piece, or an unknown wearer", () => {
    const none = uniqueState([piece("nb-1", "implant", "neuralBackup"), piece("nb-2", "implant", "neuralBackup")]);
    expect(uniqueWearerLabel(none, byId(none, "nb-2"))).toBeNull();
    const worn = uniqueState([piece("nb-1", "implant", "neuralBackup", { fittedToMemberId: "m-on" })]);
    expect(uniqueWearerLabel(worn, byId(worn, "nb-1"))).toBeNull();
    const plain = uniqueState([
      piece("dw-1", "implant", "dermalWeave", { fittedToMemberId: "m-on" }),
      piece("dw-2", "implant", "dermalWeave"),
    ]);
    expect(uniqueWearerLabel(plain, byId(plain, "dw-2"))).toBeNull();
    const ghost = uniqueState([
      piece("nb-1", "implant", "neuralBackup", { fittedToMemberId: "m-gone" }),
      piece("nb-2", "implant", "neuralBackup"),
    ]);
    expect(uniqueWearerLabel(ghost, byId(ghost, "nb-2"))).toBeNull();
  });
});

describe("awayGearDisplay: memberFitReasonText", () => {
  it("names the wearer for a unique refusal, and falls back to memberFitBlockText otherwise", () => {
    const s = uniqueState([
      piece("nb-1", "implant", "neuralBackup", { fittedToMemberId: "m-off" }),
      piece("nb-2", "implant", "neuralBackup"),
    ]);
    expect(memberFitReasonText(s, "nb-2", "uniqueEquippedElsewhere")).toBe("Installed on Ana Rook (Security, unassigned)");
    expect(memberFitReasonText(s, "nb-2", "locked")).toBe(memberFitBlockText("locked"));
    // No resolvable wearer (unknown piece): the generic unique text.
    expect(memberFitReasonText(s, "nope", "uniqueEquippedElsewhere")).toBe(memberFitBlockText("uniqueEquippedElsewhere"));
  });

  it("never names the wearer to themselves: forMemberId === wearer reads the surface's self text", () => {
    const s = uniqueState([
      piece("nb-1", "implant", "neuralBackup", { fittedToMemberId: "m-off" }),
      piece("nb-2", "implant", "neuralBackup"),
    ]);
    expect(memberFitReasonText(s, "nb-2", "uniqueEquippedElsewhere", "m-off")).toBe(UNIQUE_SELF_TEXT_PICKER);
    expect(UNIQUE_SELF_TEXT_PICKER).toBe("Already wears one (swap it below)");
    expect(memberFitReasonText(s, "nb-2", "uniqueEquippedElsewhere", "m-off", UNIQUE_SELF_TEXT_GEAR_MODAL)).toBe(
      "Already wears one (use Swap on the installed implant)"
    );
    // Anyone else still sees who wears it.
    expect(memberFitReasonText(s, "nb-2", "uniqueEquippedElsewhere", "m-on")).toBe(
      "Installed on Ana Rook (Security, unassigned)"
    );
  });
});

function byId(s: GameState, id: string): EquipmentInstance {
  return s.equipment.find((e) => e.id === id)!;
}

// D20 + user 2026-10-07: the Med Kit stays the free Security tool, but every surface that lists or installs it
// says it needs Medical Training to heal.
describe("Medical Training hint for the Med Kit", () => {
  const trained = { traits: ["fieldMedic"] };
  const untrained = { traits: ["steadyAim"] };

  it("only the Med Kit (a heal tool) needs Medical Training; grenades and the rest do not", () => {
    expect(pieceNeedsMedicalTraining(piece("e1", "memberTool", "medKit"))).toBe(true);
    for (const v of ["stunGrenade", "toxinGrenade", "shroudEmitter"]) {
      expect(pieceNeedsMedicalTraining(piece("e2", "memberTool", v)), v).toBe(false);
    }
    expect(pieceNeedsMedicalTraining(piece("e3", "memberWeapon", "pulseRifle"))).toBe(false);
  });

  it("hasMedicalTraining reads the medic trait; unknown ids count as nothing", () => {
    expect(hasMedicalTraining(trained)).toBe(true);
    expect(hasMedicalTraining(untrained)).toBe(false);
    expect(hasMedicalTraining({ traits: ["retiredTraitId"] })).toBe(false);
  });

  it("the untrained note shows only for a Med Kit on a member without the training", () => {
    const kit = piece("e1", "memberTool", "medKit");
    expect(untrainedGearNote(kit, untrained)).toBe(UNTRAINED_MED_KIT_TEXT);
    expect(untrainedGearNote(kit, trained)).toBeNull();
    expect(untrainedGearNote(piece("e2", "memberTool", "stunGrenade"), untrained)).toBeNull();
    expect(UNTRAINED_MED_KIT_TEXT.startsWith(NEEDS_MEDICAL_TRAINING_TEXT)).toBe(true);
  });

  it("the Quartermaster's Security tool row is still the Med Kit and its blurb carries the hint", () => {
    const row = REQUISITION_ENTRIES.find((e) => e.slotType === "memberTool" && e.teamType === "security")!;
    expect(row.blurb).toContain(NEEDS_MEDICAL_TRAINING_TEXT);
  });
});
