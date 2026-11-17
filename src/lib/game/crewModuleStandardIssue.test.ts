// Standard-Issue Sensor Suite, Bridge Module and Crew Quarters (0.14.0; user 2026-11-17 "free basic set, all ships").
// Design: docs/superpowers/specs/2026-11-17-research-filter-and-crew-standard-issue-design.md section 2.
import { describe, it, expect } from "vitest";
import {
  CREW_MODULE_STANDARD_ISSUE,
  freshState,
  isStandardIssueBaseline,
  seedCrewModuleStandardIssueForShip,
  STANDARD_ISSUE_ILEVEL,
  type CaptainMissionState,
  type EquipmentInstance,
  type GameState,
  type SeniorStaffOfficer,
} from "./model";
import { buyHomeworldTalent, dispatchCaptainOnMission, mintBuiltShip, tick } from "./tick";
import { equippedFor } from "./equipmentQueries";
import { bridgeOfficerMultiplier, installedBridgeModule, installedQuartersModule, quartersCapacityBonus, QUARTERS_MODULES } from "./crewModules";
import { installedSensorArray } from "./sensorArrays";
import { complementTotalCap } from "./commandStructure";
import { generateEquipment } from "./itemgen";
import { withCrewModuleSiOff } from "./crewModuleSiSwitch.fixture";

const CREW_SLOTS = ["sensor", "bridge", "quarters"] as const;

// The three crew-module pieces installed on `shipId`, keyed by slot.
function crewSet(state: GameState, shipId: string): Record<string, EquipmentInstance[]> {
  const out: Record<string, EquipmentInstance[]> = {};
  for (const slot of CREW_SLOTS) out[slot] = equippedFor(state, shipId).filter((e) => e.slotType === slot);
  return out;
}

function expectStandardIssueSet(state: GameState, shipId: string): void {
  const set = crewSet(state, shipId);
  for (const slot of CREW_SLOTS) {
    expect(set[slot], slot).toHaveLength(1);
    const piece = set[slot][0];
    expect(piece.moduleVariant).toBe(CREW_MODULE_STANDARD_ISSUE[slot]);
    expect(piece.rarity).toBe("standard");
    expect(piece.quality).toBe(0);
    expect(piece.iLevel).toBe(STANDARD_ISSUE_ILEVEL);
    expect(piece.blueprintKey).toBeNull();
    expect(isStandardIssueBaseline(piece)).toBe(true);
    expect(piece.rolledStats).toEqual({});
  }
  const ship = state.ships.find((s) => s.id === shipId)!;
  expect(installedSensorArray(state, ship)?.def.id).toBe("sensorBalanced");
  expect(installedBridgeModule(state, ship)?.def.id).toBe("bridgeBalancedCommand");
  expect(installedQuartersModule(state, ship)?.def.id).toBe("quartersUtilitarian");
}

const captainMission = (s: GameState): CaptainMissionState | null => s.captains[0].mission as CaptainMissionState | null;
const idNum = (id: string): number => Number(id.replace("equip-", ""));

describe("Standard-Issue crew modules: the set", () => {
  it("names Balanced Array, Balanced Command and Utilitarian Quarters, minted in sensor, bridge, quarters order", () => {
    expect(CREW_MODULE_STANDARD_ISSUE).toEqual({ sensor: "sensorBalanced", bridge: "bridgeBalancedCommand", quarters: "quartersUtilitarian" });
    const r = seedCrewModuleStandardIssueForShip("ship-9", 40);
    expect(r.pieces.map((p) => [p.id, p.slotType, p.fittedToShipId])).toEqual([
      ["equip-40", "sensor", "ship-9"],
      ["equip-41", "bridge", "ship-9"],
      ["equip-42", "quarters", "ship-9"],
    ]);
    expect(r.nextId).toBe(43);
  });

  it("skips the slot types it is told to skip, threading the ids over the rest", () => {
    const r = seedCrewModuleStandardIssueForShip("ship-2", 10, new Set(["bridge"]));
    expect(r.pieces.map((p) => [p.id, p.slotType])).toEqual([
      ["equip-10", "sensor"],
      ["equip-11", "quarters"],
    ]);
    expect(r.nextId).toBe(12);
  });

  it("is pure and repeatable (same inputs, byte-identical pieces)", () => {
    expect(seedCrewModuleStandardIssueForShip("ship-1", 5)).toEqual(seedCrewModuleStandardIssueForShip("ship-1", 5));
  });

  it("mints nothing with the test switch off", () => {
    expect(withCrewModuleSiOff(() => seedCrewModuleStandardIssueForShip("ship-1", 5))).toEqual({ pieces: [], nextId: 5 });
  });
});

describe("Standard-Issue crew modules: every ship born carries the set", () => {
  it("a fresh game's ship-1, right after its four economy pieces", () => {
    const s = freshState();
    expectStandardIssueSet(s, "ship-1");
    const economy = equippedFor(s, "ship-1").filter((e) => !CREW_SLOTS.includes(e.slotType as (typeof CREW_SLOTS)[number]));
    const crew = equippedFor(s, "ship-1").filter((e) => CREW_SLOTS.includes(e.slotType as (typeof CREW_SLOTS)[number]));
    expect(Math.max(...economy.map((e) => idNum(e.id)))).toBe(4);
    expect(crew.map((e) => e.id)).toEqual(["equip-5", "equip-6", "equip-7"]);
    expect(s.nextEquipmentId).toBe(8);
  });

  it("a Shipyard build, right after its economy and combat pieces", () => {
    const base = freshState();
    const built = mintBuiltShip({ ships: base.ships, nextShipId: base.nextShipId, equipment: base.equipment, nextEquipmentId: base.nextEquipmentId }, "destroyer");
    const s: GameState = { ...base, ships: built.ships, nextShipId: built.nextShipId, equipment: built.equipment, nextEquipmentId: built.nextEquipmentId };
    expectStandardIssueSet(s, built.shipId);
    const mine = s.equipment.filter((e) => e.fittedToShipId === built.shipId);
    const crewIds = mine.filter((e) => CREW_SLOTS.includes(e.slotType as (typeof CREW_SLOTS)[number])).map((e) => idNum(e.id));
    const otherIds = mine.filter((e) => !CREW_SLOTS.includes(e.slotType as (typeof CREW_SLOTS)[number])).map((e) => idNum(e.id));
    expect(otherIds.length).toBeGreaterThan(4); // economy four plus the destroyer's combat set
    expect(Math.min(...crewIds)).toBe(Math.max(...otherIds) + 1);
    expect(crewIds).toEqual([crewIds[0], crewIds[0] + 1, crewIds[0] + 2]);
    expect(s.nextEquipmentId).toBe(crewIds[2] + 1);
  });

  it("a captain-slot hull grant, right after its economy and combat pieces", () => {
    const state = freshState();
    state.adminPoints = 10;
    const withHub = buyHomeworldTalent(state, "fleetLogisticsHub").next;
    const { next, success } = buyHomeworldTalent(withHub, "fleetLogisticsSlot1");
    expect(success).toBe(true);
    const granted = next.ships.find((sh) => sh.assignedCaptainId === 2)!;
    expectStandardIssueSet(next, granted.id);
    const mine = next.equipment.filter((e) => e.fittedToShipId === granted.id);
    const crewIds = mine.filter((e) => CREW_SLOTS.includes(e.slotType as (typeof CREW_SLOTS)[number])).map((e) => idNum(e.id));
    const otherIds = mine.filter((e) => !CREW_SLOTS.includes(e.slotType as (typeof CREW_SLOTS)[number])).map((e) => idNum(e.id));
    expect(Math.min(...crewIds)).toBe(Math.max(...otherIds) + 1);
    expect(next.nextEquipmentId).toBe(Math.max(...crewIds) + 1);
  });

  it("none of them with the test switch off (the game before the set)", () => {
    const s = withCrewModuleSiOff(() => freshState());
    for (const slot of CREW_SLOTS) expect(crewSet(s, "ship-1")[slot]).toHaveLength(0);
    expect(s.nextEquipmentId).toBe(5);
  });
});

describe("Standard-Issue crew modules: determinism", () => {
  it("offline equals live with the set installed: one call equals 997 s chunks equals 1 s steps", () => {
    const s0 = freshState();
    s0.captains = s0.captains.map((c) => ({ ...c, level: 10 }));
    const sent = dispatchCaptainOnMission(s0, 1, "shortOreRun");
    expect(sent.success).toBe(true);
    expect(captainMission(sent.next)?.hullBonus).toBe(1); // the free bridge and quarters stamp the run's hull bonus
    const TOTAL = 4000;
    const rng = (): number => 0.5;
    const once = tick(TOTAL, sent.next, rng);
    let chunked = sent.next;
    for (let left = TOTAL; left > 0; left -= 997) chunked = tick(Math.min(997, left), chunked, rng);
    let stepped = sent.next;
    for (let t = 0; t < TOTAL; t++) stepped = tick(1, stepped, rng);
    expect(JSON.stringify(chunked)).toBe(JSON.stringify(once));
    expect(JSON.stringify(stepped)).toBe(JSON.stringify(once));
  });
});

describe("Standard-Issue crew modules: effects", () => {
  it("the ship's berths rise by Utilitarian Quarters' own berths (12)", () => {
    const utilitarian = QUARTERS_MODULES.find((m) => m.id === "quartersUtilitarian")!;
    expect(utilitarian.baseCapacity).toBe(12);
    const on = freshState();
    const off = withCrewModuleSiOff(() => freshState());
    const ship = on.ships[0];
    expect(quartersCapacityBonus(off, off.ships[0])).toBe(0);
    expect(quartersCapacityBonus(on, ship)).toBe(utilitarian.baseCapacity);
    expect(complementTotalCap(ship.typeKey, quartersCapacityBonus(on, ship))).toBe(complementTotalCap(ship.typeKey) + utilitarian.baseCapacity);
  });

  it("a crafted Balanced Command at a higher quality amplifies more than the Standard-Issue one (moduleEffectScale)", () => {
    const s = freshState();
    const ship = s.ships[0];
    const officer = { seat: "operations", rank: 1 } as unknown as SeniorStaffOfficer;
    const free = installedBridgeModule(s, ship)!;
    const crafted = generateEquipment({
      slotType: "bridge",
      varietyKey: "bridgeBalancedCommand",
      blueprintKey: "craftedBridgeTest",
      iLevel: 1,
      quality: 3,
      rarity: "standard",
      ascension: "none",
      rng: () => 0.5,
      allocateId: () => "equip-999",
    });
    // Compare on the variant effect alone: drop the crafted piece's rolled Crew Efficiency lines.
    const craftedPlain = { ...crafted, implicitStats: {}, rolledStats: {} };
    const freeLift = bridgeOfficerMultiplier(free, officer, "general");
    const craftedLift = bridgeOfficerMultiplier({ def: free.def, instance: craftedPlain }, officer, "general");
    expect(freeLift).toBeCloseTo(1.1, 12); // Balanced Command's amp 0.1 at the quality-0 floor
    expect(craftedLift).toBeGreaterThan(freeLift);
  });
});
