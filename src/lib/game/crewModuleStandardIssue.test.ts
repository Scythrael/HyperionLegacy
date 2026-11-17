// Standard-Issue Sensor Suite, Bridge Module and Crew Quarters (0.14.0; user 2026-11-17 "free basic set, all ships").
// Design: docs/superpowers/specs/2026-11-17-research-filter-and-crew-standard-issue-design.md section 2.
import { describe, it, expect } from "vitest";
import {
  CREW_MODULE_STANDARD_ISSUE,
  EQUIPMENT_SLOTS,
  freshState,
  isStandardIssueBaseline,
  seedCrewModuleStandardIssueForShip,
  STANDARD_ISSUE_ILEVEL,
  type CaptainMissionState,
  type EquipmentInstance,
  type GameState,
  type PatrolKey,
  type PatrolMissionState,
  type SeniorStaffOfficer,
  type ShipTypeKey,
} from "./model";
import { buyHomeworldTalent, dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, mintBuiltShip, tick } from "./tick";
import Decimal from "break_infinity.js";
import { advanceExpedition } from "./expedition";
import { onHull, withCrew } from "./firstRunsGoldens.fixture";
import { asPatrolVeteran, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { equippedFor } from "./equipmentQueries";
import { BRIDGE_MODULES, bridgeOfficerMultiplier, crewStationsBerths, crewStationsBerthsForPoints, HULL_FAMILY_MODULE_BONUS, installedBridgeModule, installedQuartersModule, quartersCapacityBonus, QUARTERS_MODULES } from "./crewModules";
import { COMPLEMENT_PARAGRAPHS, HELP_TOPICS, SENSORS_HELP, SI_QUARTERS_BERTHS, STANDARD_ISSUE_CREW_MODULES_TEXT } from "../helpTopics";
import { installedSensorArray } from "./sensorArrays";
import { complementTotalCap } from "./commandStructure";
import { generateEquipment } from "./itemgen";
import { withCrewModuleSiOff } from "./crewModuleSiSwitch.fixture";
import { deserialize, migrate, SAVE_VERSION, serialize, type SaveFile } from "./save";
import { fitEquipment, unfitEquipmentInstance } from "./equipment";
import { canRequisition, freeSpareBaselinesFor, REQUISITION_ENTRIES, requisitionStandardIssue } from "./quartermaster";

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

// Task B2: Help names the free set with numbers read from the catalogs.
describe("Standard-Issue crew modules: Help", () => {
  const body = (id: string): string => HELP_TOPICS.find((t) => t.id === id)!.body;
  const util = QUARTERS_MODULES.find((m) => m.id === CREW_MODULE_STANDARD_ISSUE.quarters)!;
  const bridge = BRIDGE_MODULES.find((m) => m.id === CREW_MODULE_STANDARD_ISSUE.bridge)!;
  it("the Ship Systems topic names the set, its numbers, the one-time grant and the empty slots", () => {
    expect(util.baseCapacity).toBe(12);
    expect(bridge.amp).toBe(0.1);
    expect(util.focusBoost).toBe(0.1);
    expect(STANDARD_ISSUE_CREW_MODULES_TEXT).toBe(
      `Every ship also comes with a free Standard-Issue Sensor Suite, Bridge Module and Crew Quarters: a Balanced Array (slightly better odds of surface landmarks and underground finds when it scans; it adds no sensor points of its own), Balanced Command (every officer seated on the ship works 10% better) and Utilitarian Quarters (12 crew berths, and every division works 10% better). The Bridge Module and Crew Quarters also give their hull bonus (see the Hull bonuses topic). Ships you already had were given the same set in any of these three slots that was empty. These three slots can be left empty: uninstalling one leaves it empty, and the Quartermaster issues a free replacement of each. Crafted modules are upgrades, since rarity and quality raise their effects: a crafted Utilitarian Quarters adds the berths of its Crew Stations line on top of the 12 (${crewStationsBerthsForPoints(50)} more at 50 points), and it lifts the divisions more.`,
    );
    expect(crewStationsBerthsForPoints(50)).toBe(2); // the curve's sample (CREW_STATIONS_BERTH_SCALE, CREW_STATIONS_BERTH_KNEE)
    // Only the bridge and quarters carry a hull-family bonus; the sensor has none, so Help names those two.
    for (const spec of Object.keys(HULL_FAMILY_MODULE_BONUS)) {
      expect(Object.keys(HULL_FAMILY_MODULE_BONUS[spec as keyof typeof HULL_FAMILY_MODULE_BONUS]).sort()).toEqual(["bridge", "quarters"]);
    }
    expect(body("shipSystems")).toContain(STANDARD_ISSUE_CREW_MODULES_TEXT);
    expect(body("shipSystems")).toContain("issues one for any economy or combat slot, Sensor Suite, Bridge Module or Crew Quarters at no cost");
  });
  it("the berths line is true: a crafted Utilitarian Quarters adds its Crew Stations berths over the free 12", () => {
    // Measured, not assumed (fix pass 2026-11-17): the free one is 12, a crafted one 12 plus crewStationsBerths.
    const s = freshState();
    const ship = s.ships[0];
    expect(quartersCapacityBonus(s, ship)).toBe(util.baseCapacity);
    const crafted = generateEquipment({
      slotType: "quarters",
      varietyKey: CREW_MODULE_STANDARD_ISSUE.quarters,
      blueprintKey: "craftedQuartersTest",
      iLevel: 100,
      quality: 5,
      rarity: "radiant",
      ascension: "none",
      rng: () => 0.5,
      allocateId: () => "equip-q",
    });
    const withCrafted: GameState = { ...s, equipment: [...s.equipment.filter((e) => e.slotType !== "quarters"), { ...crafted, fittedToShipId: ship.id }] };
    const bonus = quartersCapacityBonus(withCrafted, ship);
    expect(crewStationsBerths(crafted)).toBeGreaterThan(0);
    expect(bonus).toBe(util.baseCapacity + crewStationsBerths(crafted));
  });
  it("the Quartermaster, Complement and Sensors topics agree", () => {
    expect(body("quartermaster")).toContain("one row per slot that has a baseline");
    expect(body("quartermaster")).toContain("the free Sensor Suite, Bridge Module and Crew Quarters every ship is born with (a Balanced Array, Balanced Command and Utilitarian Quarters)");
    expect(body("quartermaster")).toContain("or canceled");
    expect(body("quartermaster")).not.toMatch(/not issued here|cancelled/);
    expect(COMPLEMENT_PARAGRAPHS.join("\n")).toContain(`every ship comes with Standard-Issue Utilitarian Quarters, ${SI_QUARTERS_BERTHS} berths; the Elite Quarters add none`);
    expect(SENSORS_HELP).toContain("The free Standard-Issue Balanced Array every ship comes with adds none; a crafted Sensor Suite does.");
    for (const text of [STANDARD_ISSUE_CREW_MODULES_TEXT, body("shipSystems"), body("quartermaster"), SENSORS_HELP]) expect(text).not.toMatch(/—|-{2}|\bfit/);
  });
});

// Task B2: existing ships get the set ONCE, into their EMPTY sensor / bridge / quarters slots (SAVE_VERSION 71 to 72).
describe("Standard-Issue crew modules: the v71 -> v72 migration", () => {
  const ENTROPY = 0x5eed0072;
  // A save a v71 build wrote: built with the set off (no v71 ship ever had it), stamped version 71.
  const v71Save = (state: GameState): SaveFile => ({ ...(deserialize(serialize(state, 0)) as SaveFile), version: 71 });
  // A pre-set game with a second ship (a destroyer) built.
  function oldFleet(): GameState {
    return withCrewModuleSiOff(() => {
      const base = freshState();
      const built = mintBuiltShip({ ships: base.ships, nextShipId: base.nextShipId, equipment: base.equipment, nextEquipmentId: base.nextEquipmentId }, "destroyer");
      return { ...base, ships: built.ships, nextShipId: built.nextShipId, equipment: built.equipment, nextEquipmentId: built.nextEquipmentId };
    });
  }

  it("is SAVE_VERSION 72", () => {
    expect(SAVE_VERSION).toBe(72);
  });

  it("installs the set on every ship, ids threaded from nextEquipmentId in ship order (sensor, bridge, quarters)", () => {
    const old = oldFleet();
    for (const sh of old.ships) for (const slot of CREW_SLOTS) expect(crewSet(old, sh.id)[slot]).toHaveLength(0);
    const start = old.nextEquipmentId;
    const m = migrate(v71Save(old), ENTROPY);
    for (const sh of m.ships) expectStandardIssueSet(m, sh.id);
    const isCrew = (e: EquipmentInstance): boolean => CREW_SLOTS.includes(e.slotType as (typeof CREW_SLOTS)[number]);
    expect(m.equipment.filter(isCrew).map((e) => [e.id, e.slotType, e.fittedToShipId])).toEqual([
      [`equip-${start}`, "sensor", "ship-1"],
      [`equip-${start + 1}`, "bridge", "ship-1"],
      [`equip-${start + 2}`, "quarters", "ship-1"],
      [`equip-${start + 3}`, "sensor", "ship-2"],
      [`equip-${start + 4}`, "bridge", "ship-2"],
      [`equip-${start + 5}`, "quarters", "ship-2"],
    ]);
    expect(m.nextEquipmentId).toBe(start + 6);
    // Nothing else in the pool moved.
    expect(m.equipment.filter((e) => !isCrew(e))).toEqual(old.equipment);
  });

  it("never replaces an installed module: a ship with a crafted bridge keeps it and gains only the sensor and quarters", () => {
    const old = oldFleet();
    const crafted = generateEquipment({
      slotType: "bridge",
      varietyKey: "bridgeFlagCommand",
      blueprintKey: "flagCommandBp",
      iLevel: 20,
      quality: 2,
      rarity: "standard",
      ascension: "none",
      rng: () => 0.5,
      allocateId: () => `equip-${old.nextEquipmentId}`,
    });
    const withBridge: GameState = { ...old, equipment: [...old.equipment, { ...crafted, fittedToShipId: "ship-1" }], nextEquipmentId: old.nextEquipmentId + 1 };
    const m = migrate(v71Save(withBridge), ENTROPY);
    const set1 = crewSet(m, "ship-1");
    expect(set1.bridge).toHaveLength(1);
    expect(set1.bridge[0].id).toBe(crafted.id);
    expect(set1.bridge[0].moduleVariant).toBe("bridgeFlagCommand");
    expect(set1.sensor.map((e) => e.moduleVariant)).toEqual(["sensorBalanced"]);
    expect(set1.quarters.map((e) => e.moduleVariant)).toEqual(["quartersUtilitarian"]);
    const start = withBridge.nextEquipmentId;
    expect([...set1.sensor, ...set1.quarters].map((e) => e.id)).toEqual([`equip-${start}`, `equip-${start + 1}`]);
    expectStandardIssueSet(m, "ship-2");
    expect(m.nextEquipmentId).toBe(start + 5);
  });

  it("a ship out on a mission keeps its run record unchanged (the pieces land, the stamps do not move)", () => {
    const old = withCrewModuleSiOff(() => {
      const s0 = freshState();
      s0.captains = s0.captains.map((c) => ({ ...c, level: 10 }));
      return tick(30, dispatchCaptainOnMission(s0, 1, "shortOreRun").next, () => 0.5);
    });
    const before = captainMission(old);
    expect(before).not.toBeNull();
    expect(before!.hullBonus).toBeUndefined(); // dispatched with no module aboard
    const m = migrate(v71Save(old), ENTROPY);
    expectStandardIssueSet(m, "ship-1");
    expect(JSON.stringify(captainMission(m))).toBe(JSON.stringify(before));
  });

  it("runs once: a slot the player empties after the migration stays empty on every later load", () => {
    const m = migrate(v71Save(oldFleet()), ENTROPY);
    const bridge = crewSet(m, "ship-1").bridge[0];
    const emptied = unfitEquipmentInstance(m, "ship-1", bridge.id);
    expect(crewSet(emptied, "ship-1").bridge).toHaveLength(0);
    const reloaded = migrate(deserialize(serialize(emptied, 0)) as SaveFile, ENTROPY);
    expect(crewSet(reloaded, "ship-1").bridge).toHaveLength(0);
    expect(reloaded.equipment.filter((e) => e.slotType === "bridge" && e.fittedToShipId === null).map((e) => e.id)).toEqual([bridge.id]);
    expect(reloaded.nextEquipmentId).toBe(emptied.nextEquipmentId);
  });

  it("a fresh v72 game loads unchanged (no second set)", () => {
    const fresh = freshState();
    const loaded = migrate(deserialize(serialize(fresh, 0)) as SaveFile, ENTROPY);
    expect(loaded.equipment).toEqual(fresh.equipment);
    expect(loaded.nextEquipmentId).toBe(fresh.nextEquipmentId);
  });

  it("an old save from before Standard-Issue (v27) still loads, each ship fully set up", () => {
    const old = withCrewModuleSiOff(() => freshState());
    const v27 = { ...v71Save({ ...old, equipment: [], nextEquipmentId: 1 }), version: 27 } as SaveFile;
    const m = migrate(v27, ENTROPY);
    expectStandardIssueSet(m, "ship-1");
    expect(equippedFor(m, "ship-1").filter((e) => e.slotType === "reactorCore")).toHaveLength(1);
  });

  it("with the test switch off the migration adds nothing", () => {
    const old = oldFleet();
    const m = withCrewModuleSiOff(() => migrate(v71Save(old), ENTROPY));
    expect(m.equipment).toEqual(old.equipment);
    expect(m.nextEquipmentId).toBe(old.nextEquipmentId);
  });
});

// Fix pass (user 2026-11-17 "Yes, add them"): the Quartermaster issues the free Sensor Suite, Bridge Module and Crew
// Quarters like the other Standard-Issue gear: the same piece a new ship is born with, one spare of each at a time.
describe("Standard-Issue crew modules: the Quartermaster issues them", () => {
  const born = seedCrewModuleStandardIssueForShip("ship-1", 5).pieces;
  const bornPiece = (slot: (typeof CREW_SLOTS)[number]): EquipmentInstance => born.find((p) => p.slotType === slot)!;

  it("has a row for each, labeled from the slot and naming the free piece, after the combat rows", () => {
    const keys = REQUISITION_ENTRIES.filter((e) => e.teamType === null).map((e) => e.key);
    expect(keys.slice(-3)).toEqual(["sensor", "bridge", "quarters"]);
    for (const slot of CREW_SLOTS) {
      const entry = REQUISITION_ENTRIES.find((e) => e.slotType === slot)!;
      expect(entry.mint).toEqual({ kind: "crewModule", varietyKey: CREW_MODULE_STANDARD_ISSUE[slot] });
      expect(entry.label).toBe(EQUIPMENT_SLOTS[slot]!.label);
    }
    expect(REQUISITION_ENTRIES.filter((e) => CREW_SLOTS.includes(e.slotType as (typeof CREW_SLOTS)[number])).map((e) => e.issuedName)).toEqual([
      "Standard-Issue Balanced Array",
      "Standard-Issue Balanced Command",
      "Standard-Issue Utilitarian Quarters",
    ]);
  });

  it("issues each one free as a spare: the piece a new ship is born with, bar its id, install and grace stamp", () => {
    for (const slot of CREW_SLOTS) {
      const s = freshState();
      // The ship's own installed piece is doing its job, so it never counts as holding one.
      expect(canRequisition(s, slot)).toEqual({ ok: true });
      const r = requisitionStandardIssue(s, slot);
      expect(r.reason, slot).toBeNull();
      const piece = r.minted!;
      expect(piece.id).toBe(`equip-${s.nextEquipmentId}`);
      expect(r.next.nextEquipmentId).toBe(s.nextEquipmentId + 1);
      expect(r.next.credits).toEqual(s.credits); // free
      expect(piece.fittedToShipId).toBeNull();
      expect(piece.graceStartedAtGameSeconds).toBe(s.gameTimeSeconds);
      expect(isStandardIssueBaseline(piece)).toBe(true);
      const { id: _a, fittedToShipId: _b, graceStartedAtGameSeconds: _c, ...rest } = piece;
      const { id: _d, fittedToShipId: _e, ...bornRest } = bornPiece(slot);
      expect(rest).toEqual(bornRest);
      expect(freeSpareBaselinesFor(r.next, slot).map((p) => p.id)).toEqual([piece.id]);
    }
  });

  it("holds the one-spare limit per slot, each slot on its own", () => {
    let s = freshState();
    for (const slot of CREW_SLOTS) s = requisitionStandardIssue(s, slot).next;
    for (const slot of CREW_SLOTS) {
      expect(canRequisition(s, slot)).toEqual({ ok: false, reason: "alreadyHoldingOne" });
      const again = requisitionStandardIssue(s, slot);
      expect(again.minted).toBeNull();
      expect(again.next).toBe(s);
    }
    // An uninstalled free piece is a spare too: emptying the bridge leaves one in hand, so the counter waits.
    const bridge = crewSet(freshState(), "ship-1").bridge[0];
    const emptied = unfitEquipmentInstance(freshState(), "ship-1", bridge.id);
    expect(canRequisition(emptied, "bridge")).toEqual({ ok: false, reason: "alreadyHoldingOne" });
    expect(canRequisition(emptied, "quarters")).toEqual({ ok: true });
  });

  it("installs from the issued spare into an emptied slot, and the counter then issues another", () => {
    for (const slot of CREW_SLOTS) {
      const fresh = freshState();
      const own = crewSet(fresh, "ship-1")[slot][0];
      // The player salvaged the ship's own piece: model that as gone from the pool, leaving the slot empty.
      const bare: GameState = { ...fresh, equipment: fresh.equipment.filter((e) => e.id !== own.id) };
      expect(crewSet(bare, "ship-1")[slot]).toHaveLength(0);
      const issued = requisitionStandardIssue(bare, slot);
      const installed = fitEquipment(issued.next, "ship-1", issued.minted!.id);
      expect(crewSet(installed, "ship-1")[slot].map((p) => p.id)).toEqual([issued.minted!.id]);
      expectStandardIssueSet(installed, "ship-1");
      expect(canRequisition(installed, slot)).toEqual({ ok: true });
    }
    // The berths come back with the quarters.
    const fresh = freshState();
    const own = crewSet(fresh, "ship-1").quarters[0];
    const bare: GameState = { ...fresh, equipment: fresh.equipment.filter((e) => e.id !== own.id) };
    expect(quartersCapacityBonus(bare, bare.ships[0])).toBe(0);
    const issued = requisitionStandardIssue(bare, "quarters");
    const back = fitEquipment(issued.next, "ship-1", issued.minted!.id);
    expect(quartersCapacityBonus(back, back.ships[0])).toBe(SI_QUARTERS_BERTHS);
  });
});

// Fix pass: the offline == live gates the golden files prove with the set OFF (firstRunsGoldens.test.ts golden 2's
// closed-form patrol and golden 4's expedition parity), rerun here on the shipped game (every switch live, the set on).
// Parity only: no hash pins, so a later balance move cannot break them, only a determinism break can.
describe("Standard-Issue crew modules: offline == live with the set on (the golden parity gates, shipped game)", () => {
  const RNG = (): number => 0.5;
  const patrolOf = (s: GameState): PatrolMissionState | null => s.captains[0].mission as PatrolMissionState | null;
  const patrolBase = (hull: ShipTypeKey): GameState => ({ ...onHull(hull), nextPatrolSeed: 1, credits: new Decimal(100_000) });

  it("patrol closed form: one economyTick call == 1 s ticks over a won training cycle and a veteran's Warband", () => {
    for (const [hull, key, veteran] of [["orion", "crimsonReaverSweep", false], ["prospectorRunner", "crimsonReaverWarband", true]] as [ShipTypeKey, PatrolKey, boolean][]) {
      const from = veteran ? asPatrolVeteran(patrolBase(hull)) : patrolBase(hull);
      expectStandardIssueSet(from, "ship-1");
      const start = dispatchCaptainOnPatrol(from, 1, key, "balanced", false);
      expect(start.success, `${hull} ${key}: ${start.reason}`).toBe(true);
      let end = start.next;
      let ticks = 0;
      while (patrolOf(end) !== null) {
        end = economyTick(end, 1, RNG);
        ticks += 1;
        if (ticks > 2000) throw new Error("the patrol never ended");
      }
      if (!veteran) expect(end.ships[0].damaged === true, "the training cycle cannot be lost").toBe(false);
      const big = economyTick(start.next, ticks, RNG);
      expect(big.captains).toEqual(end.captains);
      expect(big.ships).toEqual(end.ships);
      expect(big.nextPatrolSeed).toBe(end.nextPatrolSeed);
      expect(big.credits.toString()).toBe(end.credits.toString());
      expect(big.equipment).toEqual(end.equipment); // the three free pieces wear the same both ways
    }
  });

  it("expedition: one call == 997 s chunks == the event-boundary chain on the D18 Orion's first run", () => {
    const H = 250_000;
    const base = withCrew(onHull("orion"), "d18");
    expectStandardIssueSet(base, "ship-1");
    const exp = dispatchPastPropulsion(base, "ship-1", 1, "cand-1").expedition!;
    const frozen = structuredClone(exp);
    const one = advanceExpedition(exp, H);
    let e = exp;
    for (let t = 997; t < H; t += 997) e = advanceExpedition(e, t);
    expect(advanceExpedition(e, H)).toEqual(one);
    const times = new Set<number>([exp.phaseAnchorSeconds]);
    const ops = one.groundOps!;
    for (const r of ops.history) for (const t of [r.startedAt, r.endedAt]) times.add(t);
    for (const l of ops.log ?? []) times.add(l.at);
    for (const leg of ops.shipLegs) for (const t of [leg.startsAt, leg.arrivesAt, leg.endsAt]) times.add(t);
    const chain = [...times].filter((t) => Number.isFinite(t) && t > 1 && t + 1 < H).sort((a, b) => a - b);
    expect(chain.length).toBeGreaterThan(20);
    e = exp;
    for (const t of chain) for (const at of [t - 1, t, t + 1]) e = advanceExpedition(e, at);
    expect(advanceExpedition(e, H)).toEqual(one);
    expect(exp).toEqual(frozen);
  });
});
