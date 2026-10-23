// RARITY READINESS RR-6 (docs/plans/2026-10-23-rarity-readiness-plan.md, Review Focus 4): the ONE set engine for gear
// and E-MOD modules. 2 / 3 / 5 thresholds, counted per ship and per away-team member (never summed), recounted on every
// install, uninstall, loadout check-out / check-in and member wear / remove (derived, never stored), the Celestial
// minus-1 once per set, bonuses through equipmentStatMods (ship) and snapshotMember (member). Two test sets [PROPOSAL],
// dev mint only.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BLUEPRINTS,
  EQUIPMENT_SLOTS,
  equipmentStatMods,
  freshState,
  type EquipmentAscension,
  type EquipmentInstance,
  type EquipmentRarity,
  type EquipmentSlotType,
  type GameState,
} from "./model";
import {
  CELESTIAL_SET_REDUCTION,
  GEAR_SETS,
  GEAR_SET_POINTS_PER_PIECE,
  GEAR_SET_TIER_PIECES,
  activeGearSetTiers,
  gearSetBonusLines,
  gearSetCounts,
  gearSetDef,
  gearSetsFor,
  pieceSetId,
} from "./gearSets";
import { generateEquipment } from "./itemgen";
import { devMintFromBlueprint } from "./devMint";
import { snapshotMember } from "./awayTeam";
import { GEAR_POINT_BUMP } from "./awayTeam";
import { equippedFor } from "./equipmentQueries";
import { withTestModules, mintTestModule } from "./shipModulesTest.fixture";
import type { UniversalModuleDef } from "./shipModules";
import { plainAwayMember } from "./awayTeamTestFixtures";
import { fitEquipment, unfitEquipment } from "./equipment";
import { checkInLoadout, checkOutLoadout, createLoadout, installIntoLoadout, loadoutSlotDefsForShipType } from "./armory";
import { fitToMember, memberEquipment, unfitFromMember } from "./memberEquipment";

let n = 0;
function piece(slotType: string, over: Partial<EquipmentInstance> = {}): EquipmentInstance {
  return {
    id: `set-piece-${++n}`,
    slotType: slotType as EquipmentSlotType,
    rarity: "constellar",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: null,
    implicitStats: {},
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: null,
    ...over,
  } as EquipmentInstance;
}
const SURVEY = gearSetDef("testSetSurvey")!;
const FIELD = gearSetDef("testSetField")!;
const survey = (k: number, over: Partial<EquipmentInstance> = {}) => SURVEY.slotTypes.slice(0, k).map((st) => piece(st, { setId: SURVEY.id, ...over }));
const field = (k: number, over: Partial<EquipmentInstance> = {}) =>
  [...FIELD.slotTypes, "implant"].slice(0, k).map((st) => piece(st, { setId: FIELD.id, ...over }));
const tiersOf = (pieces: EquipmentInstance[], scope: "ship" | "member") => activeGearSetTiers(pieces, scope).map((t) => t.pieces);

describe("RR-6: the catalog", () => {
  it("two test sets [PROPOSAL], one per scope, each with the 2 / 3 / 5 tiers on existing fold keys", () => {
    expect(GEAR_SETS.map((s) => [s.id, s.label, s.scope])).toEqual([
      ["testSetSurvey", "Survey Cadre", "ship"],
      ["testSetField", "Field Cadre", "member"],
    ]);
    for (const s of GEAR_SETS) {
      expect(s.tiers.map((t) => t.pieces)).toEqual([...GEAR_SET_TIER_PIECES]);
      for (const t of s.tiers) expect(t.magnitude).toBe(t.pieces * GEAR_SET_POINTS_PER_PIECE);
      for (const st of s.slotTypes) expect(EQUIPMENT_SLOTS[st], st).toBeDefined();
      expect(s.slotTypes.length).toBeGreaterThanOrEqual(4);
    }
    expect(gearSetsFor("cargoBay").map((s) => s.id)).toEqual(["testSetSurvey"]);
    expect(gearSetsFor("implant").map((s) => s.id)).toEqual(["testSetField"]);
    expect(gearSetsFor("weapon")).toEqual([]);
  });
});

describe("RR-6: counting and thresholds", () => {
  it("1 piece: nothing; 2: the 2-piece; 3 and 4: 2 + 3; 5: all three", () => {
    expect(tiersOf(survey(1), "ship")).toEqual([]);
    expect(tiersOf(survey(2), "ship")).toEqual([2]);
    expect(tiersOf(survey(3), "ship")).toEqual([2, 3]);
    expect(tiersOf(survey(4), "ship")).toEqual([2, 3]);
    expect(tiersOf(survey(5), "ship")).toEqual([2, 3, 5]);
  });

  it("only a Constellar piece with a setId its slot may carry counts", () => {
    const [cargo, ftl] = survey(2);
    expect(pieceSetId(cargo)).toBe("testSetSurvey");
    for (const r of ["standard", "radiant", "luminous"] as EquipmentRarity[]) expect(pieceSetId({ ...cargo, rarity: r }), r).toBeUndefined();
    expect(pieceSetId({ ...cargo, setId: "noSuchSet" })).toBeUndefined();
    expect(pieceSetId(piece("weapon", { setId: SURVEY.id }))).toBeUndefined(); // the set does not cover weapons
    expect(pieceSetId(piece("cargoBay"))).toBeUndefined();
    // the same piece listed twice counts once
    expect(gearSetCounts([cargo, cargo, ftl]).get("testSetSurvey")!.count).toBe(2);
  });

  it("a Celestial Constellar piece lowers every tier of its set by one, once", () => {
    expect(CELESTIAL_SET_REDUCTION).toBe(1);
    const one = survey(4);
    one[0] = { ...one[0], ascension: "celestial" as EquipmentAscension };
    expect(tiersOf(one, "ship")).toEqual([2, 3, 5]); // 4 pieces reach the 5-piece
    const two = survey(4, { ascension: "celestial" });
    expect(tiersOf(two, "ship")).toEqual([2, 3, 5]);
    expect(tiersOf(survey(1, { ascension: "celestial" }), "ship")).toEqual([2]); // the 2-piece needs one
    expect(tiersOf(survey(3, { ascension: "celestial" }), "ship")).toEqual([2, 3]); // NOT the 5-piece (that needs 4)
    // Nova does nothing to sets
    expect(tiersOf(survey(4, { ascension: "nova" }), "ship")).toEqual([2, 3]);
  });

  it("scope keeps a ship's sets and a member's apart (never summed)", () => {
    expect(tiersOf(field(3), "ship")).toEqual([]);
    expect(tiersOf(survey(3), "member")).toEqual([]);
    expect(gearSetBonusLines([...survey(2), ...field(2)], "ship")).toEqual({ cargoCapacity: 20 });
    expect(gearSetBonusLines([...survey(2), ...field(2)], "member")).toEqual({ groundArmor: 20 });
  });
});

describe("RR-6: E-MOD set modules share the engine (fixture only: UNIVERSAL_MODULES is empty)", () => {
  const setModule = (id: string): UniversalModuleDef => ({
    id,
    label: "Test Set Module",
    category: "set",
    contexts: ["mission"],
    effect: { key: "powerOutput", magnitude: 1 },
    setId: "testSetSurvey",
    powerDraw: 0,
    source: "craft",
  });
  it("a set-category module counts toward its catalog setId, at any rarity", () => {
    const defs = [setModule("testModuleSetA"), setModule("testModuleSetB")];
    withTestModules(defs, () => {
      const a = mintTestModule(defs[0], "standard", 0, "m-a");
      const b = mintTestModule(defs[1], "radiant", 0, "m-b");
      expect(pieceSetId(a)).toBe("testSetSurvey");
      expect(tiersOf([a, b], "ship")).toEqual([2]);
      expect(tiersOf([a, ...survey(1)], "ship")).toEqual([2]); // a module and a gear piece of one set count together
    });
    // outside the fixture the def is unknown: the module counts toward nothing
    expect(pieceSetId(piece("module", { moduleVariant: "testModuleSetA", rarity: "standard" }))).toBeUndefined();
  });
});

describe("RR-6: the folds", () => {
  it("equipmentStatMods adds the ship tiers' lines (and nothing without a set)", () => {
    const base = equipmentStatMods(survey(1));
    expect(equipmentStatMods(survey(2)).flat.cargoCapacity - base.flat.cargoCapacity).toBe(2 * GEAR_SET_POINTS_PER_PIECE);
    const five = equipmentStatMods(survey(5));
    expect(five.flat.cargoCapacity).toBe(20);
    expect(five.flat.sensors).toBe(30);
    expect(five.flat.fuelCapacity).toBe(50);
    expect(equipmentStatMods(survey(5, { setId: undefined }))).toEqual(equipmentStatMods(survey(5).map((p) => ({ ...p, setId: undefined }))));
  });

  it("snapshotMember adds the member tiers' ground lines (through the one conversion)", () => {
    const member = plainAwayMember("member-set", "security", "ship-1");
    const worn = field(2, { fittedToMemberId: "member-set" });
    const off = snapshotMember(member, worn.map((p) => ({ ...p, setId: undefined })));
    const on = snapshotMember(member, worn);
    expect(on.groundStats.armor - off.groundStats.armor).toBeCloseTo(20 * GEAR_POINT_BUMP.armor, 12);
    expect(on.groundStats.power).toBe(off.groundStats.power);
    const four = snapshotMember(member, field(5, { fittedToMemberId: "member-set" }));
    expect(four.groundStats.hp).toBeCloseTo(50 * GEAR_POINT_BUMP.hp, 12);
  });

  it("two members wearing one piece each get no set; a frozen copy keeps the set state", () => {
    const [a, b] = field(2);
    expect(snapshotMember(plainAwayMember("m1", "security", "ship-1"), [a]).groundStats.armor).toBe(0);
    expect(snapshotMember(plainAwayMember("m2", "security", "ship-1"), [b]).groundStats.armor).toBe(0);
    const pieces = survey(3);
    expect(equipmentStatMods(structuredClone(pieces))).toEqual(equipmentStatMods(pieces));
  });
});

describe("RR-6: recount on install, uninstall and member wear (derived from the install authorities)", () => {
  function withSpare(s: GameState, p: EquipmentInstance): GameState {
    return { ...s, equipment: [...s.equipment, p] };
  }
  const cargoOf = (x: GameState, ship: string) => equipmentStatMods(equippedFor(x, ship)).flat.cargoCapacity;

  it("fitEquipment / unfitEquipment: the second Survey piece turns the 2-piece on, taking one off turns it off", () => {
    let s = freshState();
    const ship = s.ships[0].id;
    const [cargo, ftl] = survey(2);
    s = withSpare(withSpare(s, cargo), ftl);
    s = fitEquipment(s, ship, cargo.id);
    const withOne = cargoOf(s, ship);
    expect(equippedFor(s, ship).some((e) => e.id === cargo.id)).toBe(true);
    s = fitEquipment(s, ship, ftl.id);
    expect(equippedFor(s, ship).some((e) => e.id === ftl.id)).toBe(true);
    expect(cargoOf(s, ship)).toBe(withOne + 2 * GEAR_SET_POINTS_PER_PIECE);
    s = unfitEquipment(s, ship, "ftlDrive");
    expect(cargoOf(s, ship)).toBe(withOne);
  });

  it("a loadout check-out brings its set with it and a check-in takes it away", () => {
    let s = freshState();
    const ship = s.ships[0];
    const created = createLoadout(s, ship.typeKey, "Survey");
    s = created.next;
    const id = created.loadoutId!;
    const [cargo, ftl] = survey(2);
    s = withSpare(withSpare(s, cargo), ftl);
    const keyOf = (slot: string) => loadoutSlotDefsForShipType(ship.typeKey).find((d) => d.slotType === slot)!.key;
    s = installIntoLoadout(s, id, keyOf("cargoBay"), cargo.id);
    s = installIntoLoadout(s, id, keyOf("ftlDrive"), ftl.id);
    const before = equipmentStatMods(equippedFor(s, ship.id));
    const out = checkOutLoadout(s, id, ship.id);
    expect(out).not.toBe(s);
    const ids = equippedFor(out, ship.id).map((e) => e.id);
    expect(ids).toContain(cargo.id);
    expect(ids).toContain(ftl.id);
    expect(gearSetBonusLines(equippedFor(out, ship.id), "ship")).toEqual({ cargoCapacity: 20 });
    const back = checkInLoadout(out, id);
    expect(gearSetBonusLines(equippedFor(back, ship.id), "ship")).toEqual({});
    expect(equipmentStatMods(equippedFor(back, ship.id))).toEqual(before);
  });

  it("member wear / remove: the Field Cadre 2-piece follows the member's worn pieces", () => {
    let s = freshState();
    const ship = s.ships[0].id;
    s = { ...s, awayMembers: [...s.awayMembers, plainAwayMember("member-set", "security", ship)] };
    const [armor, weapon] = field(2);
    s = withSpare(withSpare(s, { ...armor, moduleVariant: firstVariety("memberArmor") }), { ...weapon, moduleVariant: firstVariety("memberWeapon") });
    const armorOf = (x: GameState) => snapshotMember(x.awayMembers.find((m) => m.id === "member-set")!, memberEquipment(x, "member-set")).groundStats.armor;
    s = fitToMember(s, "member-set", armor.id);
    const one = armorOf(s);
    s = fitToMember(s, "member-set", weapon.id);
    expect(armorOf(s) - one).toBeCloseTo(20 * GEAR_POINT_BUMP.armor, 12);
    s = unfitFromMember(s, "member-set", weapon.id);
    expect(armorOf(s)).toBeCloseTo(one, 12);
  });
});

describe("RR-6: the wiring registry carries one live, probed row per set tier and the Celestial hook", () => {
  it("seven GEAR_SETS entries, all live with a probe and a context", async () => {
    const { WIRING_REGISTRY } = await import("./wiring/registry");
    const rows = WIRING_REGISTRY.filter((e) => e.source.catalog === "GEAR_SETS");
    expect(rows.map((e) => e.source.key)).toEqual([
      "testSetSurvey:2",
      "testSetSurvey:3",
      "testSetSurvey:5",
      "testSetField:2",
      "testSetField:3",
      "testSetField:5",
      "celestialReduction",
    ]);
    for (const e of rows) {
      expect(e.status.kind, e.id).toBe("live");
      expect(e.probe, e.id).toBeDefined();
      expect(e.contexts.length, e.id).toBeGreaterThan(0);
    }
  });
});

function firstVariety(slot: string): string {
  return EQUIPMENT_SLOTS[slot].varieties.find((v) => v.member?.teamTypes.includes("security"))!.key;
}

describe("RR-6: the Debug minter is the only source", () => {
  const bpFor = (slot: string) => Object.keys(BLUEPRINTS).find((k) => BLUEPRINTS[k].equipmentOutput?.slotType === slot)!;
  it("a Constellar dev mint gets its slot's first set; any other band, or a slot no set covers, gets none", () => {
    const rng = () => 0.5;
    const mint = (slot: string, rarity: EquipmentRarity, setId?: string) =>
      devMintFromBlueprint({ blueprint: BLUEPRINTS[bpFor(slot)], iLevel: 40, quality: 5, rarity, setId, rng, allocateId: () => "e" })!;
    expect(mint("cargoBay", "constellar").setId).toBe("testSetSurvey");
    expect(mint("memberArmor", "constellar").setId).toBe("testSetField");
    expect(mint("cargoBay", "radiant").setId).toBeUndefined();
    expect(mint("cargoBay", "luminous").setId).toBeUndefined();
    expect(mint("hullPlating", "constellar").setId).toBeUndefined();
    expect(mint("cargoBay", "constellar", "testSetField").setId).toBe("testSetSurvey"); // a set the slot cannot carry falls back
    const weapon = devMintFromBlueprint({ blueprint: BLUEPRINTS.plasmaBp, iLevel: 40, quality: 5, rarity: "constellar", rng, allocateId: () => "w" })!;
    expect(weapon.setId).toBeUndefined();
  });

  it("no player path stamps a setId (the generators and the Fabricator never write one)", () => {
    expect(/\bsetId\b/.test(readFileSync("src/lib/game/itemgen.ts", "utf8").replace(/\/\/.*$/gm, "")), "itemgen.ts").toBe(false);
    // tick.ts's crafted mint (the Fabricator and inspect path) never writes one (tick.ts uses setId only for relic sets)
    const tick = readFileSync("src/lib/game/tick.ts", "utf8").replace(/\r\n/g, "\n");
    const start = tick.indexOf("function mintCraftedPiece(");
    expect(start).toBeGreaterThan(0);
    const body = tick.slice(start, tick.indexOf("\n}\n", start));
    expect(/\bsetId\b/.test(body), "mintCraftedPiece").toBe(false);
    const p = generateEquipment({ slotType: "cargoBay", varietyKey: EQUIPMENT_SLOTS.cargoBay.varieties[0].key, blueprintKey: null, iLevel: 40, quality: 5, rarity: "constellar", ascension: "celestial", rng: () => 0.5, allocateId: () => "e" });
    expect(p.setId).toBeUndefined();
  });
});
