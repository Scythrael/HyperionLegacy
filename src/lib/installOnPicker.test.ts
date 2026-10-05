// E-CREW Task 10 review: the item-side "Install on..." picker's row model (installOnPicker.ts).

import { describe, it, expect } from "vitest";
import { SHIP_TYPES, freshState } from "./game/model";
import type { AwayMember, AwayTeamType, CrewRace, EquipmentInstance, EquipmentSlotType, GameState } from "./game/model";
import { buildInstallOnRows, sentenceCase } from "./installOnPicker";

function member(id: string, teamType: AwayTeamType, race: CrewRace = "earthBorn", shipId: string | null = null): AwayMember {
  return {
    id,
    teamType,
    spec: teamType === "science" ? "geology" : "offense",
    name: `Member ${id}`,
    race,
    gender: "female",
    rank: 1,
    traits: [],
    assignedShipId: shipId,
  };
}

function piece(id: string, slotType: EquipmentSlotType, moduleVariant: string | undefined, overrides: Partial<EquipmentInstance> = {}): EquipmentInstance {
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

const shipReason = (r: string): string => `ship refused: ${r}`;

function state(equipment: EquipmentInstance[], awayMembers: AwayMember[]): GameState {
  return { ...freshState(), equipment, awayMembers };
}

describe("buildInstallOnRows", () => {
  it("lists usable targets first, keeping roster order within each band", () => {
    const s = state(
      [piece("equip-1", "memberWeapon", "pulseRifle")],
      [member("m1", "science"), member("m2", "security"), member("m3", "science"), member("m4", "security")]
    );
    const rows = buildInstallOnRows(s, "equip-1", shipReason);
    expect(rows.map((r) => r.targetId)).toEqual(["m2", "m4", "m1", "m3"]);
    expect(rows.map((r) => r.ok)).toEqual([true, true, false, false]);
    expect(rows[2].reason).toBe("This squad cannot use this gear");
    expect(rows[0].reason).toBe("");
  });

  it("offers one Replace choice per worn implant at the cap, each with its own gate", () => {
    // A Martian has two implant slots; both are full. One worn implant belongs to a checked-out loadout,
    // so swapping it out is refused while the other swap is allowed.
    const s = state(
      [
        piece("equip-1", "implant", "dermalWeave", { fittedToMemberId: "m1" }),
        piece("equip-2", "implant", "reflexBooster", { fittedToMemberId: "m1", committedToLoadoutId: "loadout-1" }),
        piece("equip-3", "implant", "targetingOptic"),
      ],
      [member("m1", "security", "martian")]
    );
    const [row] = buildInstallOnRows(s, "equip-3", shipReason);
    expect(row.ok).toBe(false);
    expect(row.reason).toContain("implant slots are full");
    expect(row.replace.map((r) => [r.id, r.name, r.ok])).toEqual([
      ["equip-1", "Dermal Weave", true],
      ["equip-2", "Reflex Booster", false],
    ]);
    expect(row.replace[1].reason).toContain("checked-out loadout");
  });

  it("names what a singleton slot holds now ('wears X') and where the member serves", () => {
    const fs = freshState();
    const shipId = fs.ships[0].id;
    const s = state(
      [piece("equip-1", "memberWeapon", "pulseRifle", { fittedToMemberId: "m1" }), piece("equip-2", "memberWeapon", "scattergun")],
      [member("m1", "security", "earthBorn", shipId), member("m2", "security")]
    );
    const rows = buildInstallOnRows(s, "equip-2", shipReason);
    const m1 = rows.find((r) => r.targetId === "m1")!;
    const m2 = rows.find((r) => r.targetId === "m2")!;
    expect(m1.sub).toContain("wears Pulse Rifle");
    expect(m1.sub).toContain("· Security");
    expect(m2.sub).not.toContain("wears");
    expect(m2.sub).toContain("Unassigned · Security");
  });

  it("shows the hull class only under a custom ship name", () => {
    const fs = freshState();
    const ship = fs.ships[0];
    const hull = SHIP_TYPES[ship.typeKey].label;
    const cargo = piece("equip-1", "cargoBay", undefined, { blueprintKey: null });
    const plain = buildInstallOnRows({ ...fs, equipment: [cargo] }, "equip-1", shipReason);
    expect(plain[0].kind).toBe("ship");
    expect(plain[0].label.startsWith(hull)).toBe(true);
    expect(plain[0].sub).toBe("");
    const named = buildInstallOnRows(
      { ...fs, equipment: [cargo], ships: fs.ships.map((x) => (x.id === ship.id ? { ...x, name: "Aurora Prime" } : x)) },
      "equip-1",
      shipReason
    );
    expect(named[0].label).toBe("Aurora Prime");
    expect(named[0].sub).toBe(hull);
  });

  it("sentence-cases the host's ship refusal text, and returns nothing for an unknown piece", () => {
    const fs = freshState();
    const locked = piece("equip-1", "cargoBay", undefined, { blueprintKey: null, locked: true });
    const rows = buildInstallOnRows({ ...fs, equipment: [locked] }, "equip-1", shipReason);
    expect(rows[0].ok).toBe(false);
    expect(rows[0].reason).toBe("Ship refused: locked");
    expect(buildInstallOnRows(fs, "nope", shipReason)).toEqual([]);
    expect(sentenceCase("abc")).toBe("Abc");
  });
});
