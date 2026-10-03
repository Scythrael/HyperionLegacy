// E-CREW Task 7: away-team MEMBER gear on the ship-system gear engine (design D3/D4, sections 4 and 5.4).
//
// Covers the slot-type + ground-stat foundation:
//   - the four member slot types and the one named predicate (isMemberSlotType) ship-only lists filter with;
//   - the GROUND stat vocabulary (MEMBER_GROUND_STAT_KEYS), disjoint from every ship stat key and mapped
//     onto the member stats it raises (awayTeam.ts GROUND_STAT_MEMBER_STAT);
//   - SHIP NEUTRALITY: member gear never folds into ShipDerivedStats, whether it is spare, worn by a member,
//     or (defensively) handed straight to the fold, and ship-only lists (ship install gate, Armory loadout
//     slots, Quartermaster requisition) never offer it.
import { describe, it, expect } from "vitest";
import {
  freshState,
  equipmentStatMods,
  shipDerivedStats,
  isMemberSlotType,
  MEMBER_SLOT_TYPES,
  MEMBER_GROUND_STAT_KEYS,
  LIVE_STAT_KEYS,
  RESERVED_STAT_KEYS,
  SHIP_TYPES,
  SLOT_BASE_PHYSICALS,
  type EquipmentInstance,
  type EquipmentSlotType,
  type GameState,
  type ShipTypeKey,
} from "./model";
import { effectiveShipStats } from "./crewOverlay";
import { canFitEquipment } from "./equipment";
import { loadoutSlotDefsForShipType } from "./armory";
import { REQUISITION_CATALOGUE, REQUISITION_ENTRIES } from "./quartermaster";
import { GROUND_STAT_MEMBER_STAT } from "./awayTeam";

// Every ship slot type (the union minus the four member slots), listed by hand so a new member slot
// that is NOT registered in MEMBER_SLOT_TYPES fails the partition test below.
const SHIP_SLOT_TYPES: EquipmentSlotType[] = [
  "cargoBay", "ftlDrive", "reactorCore", "specUtility",
  "shieldEmitters", "hullPlating", "weapon", "droneBay",
  "bridge", "quarters", "thrusters", "sensor", "propellantTanks",
];

// A minimal piece; overrides set the fields under test.
function piece(overrides: Partial<EquipmentInstance> = {}): EquipmentInstance {
  return {
    id: "equip-m1",
    slotType: "memberWeapon",
    rarity: "radiant",
    ascension: "none",
    quality: 5,
    iLevel: 40,
    blueprintKey: null,
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

// A member piece carrying EVERY ground line at a large magnitude, the worst case for a leak.
function loudMemberPiece(id: string, slotType: EquipmentSlotType, overrides: Partial<EquipmentInstance> = {}): EquipmentInstance {
  const lines: Record<string, number> = {};
  for (const k of MEMBER_GROUND_STAT_KEYS) lines[k] = 99;
  return piece({ id, slotType, implicitStats: { ...lines }, rolledStats: { ...lines }, ...overrides });
}

describe("member slot types", () => {
  it("MEMBER_SLOT_TYPES is exactly the four member slots", () => {
    expect([...MEMBER_SLOT_TYPES].sort()).toEqual(["implant", "memberArmor", "memberTool", "memberWeapon"]);
  });

  it("isMemberSlotType is true for the member slots and false for every ship slot", () => {
    for (const t of MEMBER_SLOT_TYPES) expect(isMemberSlotType(t), t).toBe(true);
    for (const t of SHIP_SLOT_TYPES) expect(isMemberSlotType(t), t).toBe(false);
    expect(isMemberSlotType("not-a-slot")).toBe(false);
  });

  it("member slots carry no ship mass or reactor draw", () => {
    for (const t of MEMBER_SLOT_TYPES) {
      const base = SLOT_BASE_PHYSICALS[t as keyof typeof SLOT_BASE_PHYSICALS];
      expect(base, t).toBeDefined();
      expect(base.mass, t).toBe(0);
      expect(base.powerDraw, t).toBe(0);
      expect(base.durability, t).toBeGreaterThan(0);
    }
  });
});

describe("ground stat vocabulary", () => {
  it("is ground-prefixed, duplicate-free, and disjoint from the LIVE and RESERVED ship vocabularies", () => {
    const live = new Set<string>(LIVE_STAT_KEYS);
    const reserved = new Set<string>(RESERVED_STAT_KEYS);
    expect(new Set(MEMBER_GROUND_STAT_KEYS).size).toBe(MEMBER_GROUND_STAT_KEYS.length);
    for (const k of MEMBER_GROUND_STAT_KEYS) {
      expect(k.startsWith("ground"), k).toBe(true);
      expect(live.has(k), `${k} is not a ship LIVE key`).toBe(false);
      expect(reserved.has(k), `${k} is not a ship RESERVED key`).toBe(false);
    }
  });

  it("every ground key maps to a member stat (or an explicit null) for the member-power task", () => {
    expect(Object.keys(GROUND_STAT_MEMBER_STAT).sort()).toEqual([...MEMBER_GROUND_STAT_KEYS].sort());
    expect(GROUND_STAT_MEMBER_STAT.groundPower).toBe("power");
    expect(GROUND_STAT_MEMBER_STAT.groundHazardResist).toBe("hazardResist");
    expect(GROUND_STAT_MEMBER_STAT.groundOrganicsYield).toBeNull();
  });
});

describe("ship neutrality: member gear never folds into ShipDerivedStats", () => {
  it("equipmentStatMods ignores every ground line", () => {
    const pieces = MEMBER_SLOT_TYPES.map((t, i) => loudMemberPiece(`m${i}`, t));
    expect(equipmentStatMods(pieces)).toEqual(equipmentStatMods([]));
  });

  it("shipDerivedStats is byte-identical with member pieces added to a real ship fold", () => {
    const s = freshState();
    const ship = s.ships[0];
    // A real crafted cargo piece puts the fold on its non-fast path.
    const cargo = piece({ id: "cargo-1", slotType: "cargoBay", implicitStats: { cargoCapacity: 12 }, mass: 4, powerDraw: 2, fittedToShipId: ship.id });
    const members = MEMBER_SLOT_TYPES.map((t, i) => loudMemberPiece(`m${i}`, t));
    expect(JSON.stringify(shipDerivedStats(ship, [cargo, ...members]))).toBe(JSON.stringify(shipDerivedStats(ship, [cargo])));
    // And member pieces ALONE fold to the bare hull.
    expect(JSON.stringify(shipDerivedStats(ship, members))).toBe(JSON.stringify(shipDerivedStats(ship, [])));
  });

  it("effectiveShipStats is byte-identical whether member gear sits in storage or is worn by a member", () => {
    const base = freshState();
    const ship = base.ships[0];
    const cargo = piece({ id: "cargo-1", slotType: "cargoBay", implicitStats: { cargoCapacity: 12 }, mass: 4, fittedToShipId: ship.id });
    const without: GameState = { ...base, equipment: [...base.equipment, cargo] };
    const spare = loudMemberPiece("m-spare", "memberArmor");
    const worn = loudMemberPiece("m-worn", "implant", { fittedToMemberId: "member-1" });
    const withGear: GameState = { ...without, equipment: [...without.equipment, spare, worn] };
    for (const sh of withGear.ships) {
      expect(JSON.stringify(effectiveShipStats(withGear, sh))).toBe(JSON.stringify(effectiveShipStats(without, sh)));
    }
  });
});

describe("ship-only lists never offer member gear", () => {
  it("canFitEquipment refuses a member piece on a ship (slotNotInstallable)", () => {
    const s = freshState();
    const ship = s.ships[0];
    for (const t of MEMBER_SLOT_TYPES) {
      const p = piece({ id: `m-${t}`, slotType: t });
      const state: GameState = { ...s, equipment: [...s.equipment, p] };
      expect(canFitEquipment(state, ship.id, p.id), t).toEqual({ ok: false, reason: "slotNotInstallable" });
    }
  });

  it("no hull's Armory loadout board lists a member slot", () => {
    for (const typeKey of Object.keys(SHIP_TYPES) as ShipTypeKey[]) {
      for (const def of loadoutSlotDefsForShipType(typeKey)) {
        expect(isMemberSlotType(def.slotType), `${typeKey}/${def.key}`).toBe(false);
      }
    }
  });

  it("the ship Quartermaster requisition offers no member slot (their floors land with E-CREW Task 9)", () => {
    for (const t of MEMBER_SLOT_TYPES) expect(REQUISITION_CATALOGUE[t], t).toBeNull();
    for (const entry of REQUISITION_ENTRIES) expect(isMemberSlotType(entry.slotType), entry.slotType).toBe(false);
  });
});
