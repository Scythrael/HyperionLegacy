// 0.14.0 SENSORS (DORMANT) tests: the SCANNING-ARRAY catalog + its pure readers, the sensor slot's
// generation / install behavior, and CRUCIALLY the dormancy proof (installing a sensor does NOT change
// shipDerivedStats).
//
// Covers: catalog integrity (3 arrays, ids == the sensor slot variety keys, unique, kinds); the slot
// generates + stamps moduleVariant + is economy-neutral; no Standard-Issue baseline (throws); the slot
// is an installable ALLOW-EMPTY SINGLETON (swap + empty on uninstall); installedSensorArray resolves;
// effect params scale with rarity/quality; and a smoke assertion that a fitted sensor leaves
// shipDerivedStats byte-identical (the DORMANCY contract).

import { describe, it, expect } from "vitest";
import {
  SENSOR_ARRAYS,
  getSensorArrayById,
  installedSensorArray,
  sensorArrayEffect,
  sensorEffectScale,
} from "./sensorArrays";
import {
  freshState,
  generateStandardIssue,
  shipDerivedStats,
  EQUIPMENT_SLOTS,
  type GameState,
  type ShipInstance,
  type EquipmentInstance,
} from "./model";
import { generateEquipment } from "./itemgen";
import { canFitEquipment, fitEquipment, unfitEquipmentInstance, equippedFor } from "./equipment";

// --- fixture builders --------------------------------------------------------

function sensorInstance(
  id: string,
  moduleVariant: string,
  overrides: Partial<EquipmentInstance> = {},
): EquipmentInstance {
  return {
    id,
    slotType: "sensor",
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 1,
    blueprintKey: null,
    implicitStats: {},
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    durability: 100,
    fittedToShipId: null,
    moduleVariant,
    ...overrides,
  };
}

function withEquipment(s: GameState, ...pieces: EquipmentInstance[]): GameState {
  return { ...s, equipment: [...s.equipment, ...pieces] };
}

const ship1 = (s: GameState): ShipInstance => s.ships.find((sh) => sh.id === "ship-1")!;

// ============================================================================
describe("SENSOR_ARRAYS catalog", () => {
  it("has 3 arrays (wide / focused / balanced), ids unique and == the sensor slot varieties", () => {
    expect(SENSOR_ARRAYS).toHaveLength(3);
    expect(SENSOR_ARRAYS.map((a) => a.kind).sort()).toEqual(["balanced", "focused", "wide"]);
    // ids are unique.
    expect(new Set(SENSOR_ARRAYS.map((a) => a.id)).size).toBe(3);
    // ids line up with the slot's variety keys (the generation path relies on this).
    const varietyKeys = EQUIPMENT_SLOTS.sensor.varieties.map((v) => v.key).sort();
    expect(SENSOR_ARRAYS.map((a) => a.id).sort()).toEqual(varietyKeys);
    // Every array declares itself on the sensor slot.
    for (const a of SENSOR_ARRAYS) expect(a.slot).toBe("sensor");
  });

  it("getSensorArrayById resolves a real id and returns undefined for a bogus one", () => {
    expect(getSensorArrayById("sensorWideBeam")?.kind).toBe("wide");
    expect(getSensorArrayById("sensorFocusedBeam")?.kind).toBe("focused");
    expect(getSensorArrayById("nope")).toBeUndefined();
  });

  it("the array quirks match the locked design (wide = slower+wider+landmarks, focused = faster+narrower+underground)", () => {
    const wide = getSensorArrayById("sensorWideBeam")!;
    const focused = getSensorArrayById("sensorFocusedBeam")!;
    const balanced = getSensorArrayById("sensorBalanced")!;
    // Wide: slower cadence, wider coverage, a landmark bias, no underground bias.
    expect(wide.scanRateMult).toBeLessThan(balanced.scanRateMult);
    expect(wide.coverageWidth).toBeGreaterThan(balanced.coverageWidth);
    expect(wide.landmarkOddsBias).toBeGreaterThan(0);
    // Focused: faster cadence, smaller % per pass, an underground-PoI bias.
    expect(focused.scanRateMult).toBeGreaterThan(balanced.scanRateMult);
    expect(focused.coverageWidth).toBeLessThan(balanced.coverageWidth);
    expect(focused.undergroundPoiOddsBias).toBeGreaterThan(0);
  });
});

// ============================================================================
describe("the sensor slot generates + allow-empty correctly", () => {
  it("generateEquipment mints a sensor and stamps moduleVariant from the variety", () => {
    const piece = generateEquipment({
      slotType: "sensor",
      varietyKey: "sensorFocusedBeam",
      blueprintKey: null,
      iLevel: 10,
      quality: 2,
      rarity: "stellar",
      ascension: "none",
      rng: () => 0.5,
      allocateId: () => "equip-1",
    });
    expect(piece.slotType).toBe("sensor");
    expect(piece.moduleVariant).toBe("sensorFocusedBeam");
    expect(getSensorArrayById(piece.moduleVariant!)).toBeDefined();
    // Economy-neutral physicals (a sensor must not drag speed / draw power in this dormant patch).
    expect(piece.mass).toBe(0);
    expect(piece.powerDraw).toBe(0);
    // The signature `sensors` line is present (a well-formed, budgeted piece).
    expect(piece.implicitStats.sensors).toBeGreaterThan(0);
  });

  it("a NON-sensor slot leaves moduleVariant unset by the sensor path", () => {
    const piece = generateEquipment({
      slotType: "cargoBay",
      varietyKey: "balancedHold",
      blueprintKey: null,
      iLevel: 5,
      quality: 0,
      rarity: "standard",
      ascension: "none",
      rng: () => 0.5,
      allocateId: () => "equip-2",
    });
    expect(piece.moduleVariant).toBeUndefined();
  });

  it("has NO Standard-Issue baseline (generateStandardIssue throws): the slot stays empty when unequipped", () => {
    expect(() => generateStandardIssue({ slotType: "sensor", fittedToShipId: null, allocateId: () => "x" })).toThrow();
  });
});

// ============================================================================
describe("the sensor slot is an installable ALLOW-EMPTY SINGLETON", () => {
  it("a spare sensor fits any hull (no equipRequirement gate)", () => {
    const s = withEquipment(freshState(), sensorInstance("sensor-1", "sensorBalanced"));
    expect(canFitEquipment(s, "ship-1", "sensor-1")).toEqual({ ok: true });
  });

  it("installing a second sensor SWAPS (singleton): the first is evicted to the pool", () => {
    let s = withEquipment(
      freshState(),
      sensorInstance("sensor-1", "sensorWideBeam"),
      sensorInstance("sensor-2", "sensorFocusedBeam"),
    );
    s = fitEquipment(s, "ship-1", "sensor-1");
    expect(equippedFor(s, "ship-1").filter((e) => e.slotType === "sensor").map((e) => e.id)).toEqual(["sensor-1"]);
    // Install the second: it takes the singleton slot, the first is displaced back to the pool.
    s = fitEquipment(s, "ship-1", "sensor-2");
    const fitted = equippedFor(s, "ship-1").filter((e) => e.slotType === "sensor");
    expect(fitted.map((e) => e.id)).toEqual(["sensor-2"]);
    expect(s.equipment.find((e) => e.id === "sensor-1")?.fittedToShipId).toBeNull();
  });

  it("uninstalling a sensor leaves the slot EMPTY (allow-empty, no baseline restore, nothing minted)", () => {
    let s = withEquipment(freshState(), sensorInstance("sensor-1", "sensorBalanced", { fittedToShipId: "ship-1" }));
    const before = s.equipment.length;
    s = unfitEquipmentInstance(s, "ship-1", "sensor-1");
    // Slot is empty; the piece is a recoverable spare; nothing was minted.
    expect(equippedFor(s, "ship-1").filter((e) => e.slotType === "sensor")).toHaveLength(0);
    expect(s.equipment.find((e) => e.id === "sensor-1")?.fittedToShipId).toBeNull();
    expect(s.equipment).toHaveLength(before);
  });
});

// ============================================================================
describe("installedSensorArray resolution + effect params", () => {
  it("resolves an installed sensor to its catalog def, null when the slot is empty", () => {
    const empty = freshState();
    expect(installedSensorArray(empty, ship1(empty))).toBeNull();
    const s = withEquipment(empty, sensorInstance("sensor-1", "sensorWideBeam", { fittedToShipId: "ship-1" }));
    const resolved = installedSensorArray(s, ship1(s));
    expect(resolved?.def.id).toBe("sensorWideBeam");
    expect(resolved?.instance.id).toBe("sensor-1");
  });

  it("returns null for an unrecognizable variant (defensive)", () => {
    const s = withEquipment(freshState(), sensorInstance("sensor-1", "bogusArray", { fittedToShipId: "ship-1" }));
    expect(installedSensorArray(s, ship1(s))).toBeNull();
  });

  it("effect discovery-odds biases SCALE with rarity/quality; array character stays fixed", () => {
    const s0 = withEquipment(freshState(), sensorInstance("s0", "sensorWideBeam", { fittedToShipId: "ship-1" }));
    const rich = withEquipment(
      freshState(),
      sensorInstance("s1", "sensorWideBeam", { fittedToShipId: "ship-1", rarity: "stellar", quality: 5 }),
    );
    const base = sensorArrayEffect(installedSensorArray(s0, ship1(s0))!);
    const amped = sensorArrayEffect(installedSensorArray(rich, ship1(rich))!);
    // Odds bias scales up with rarity/quality.
    expect(amped.landmarkOddsBias).toBeGreaterThan(base.landmarkOddsBias);
    expect(base.landmarkOddsBias).toBeGreaterThan(0);
    // The array's fixed character (cadence / coverage) does not change with rarity/quality.
    expect(amped.scanRateMult).toBe(base.scanRateMult);
    expect(amped.coverageWidth).toBe(base.coverageWidth);
    // standard/q0 reads the catalog magnitude as-is (scale 1.0).
    expect(sensorEffectScale("standard", 0)).toBeCloseTo(1.0, 9);
    expect(sensorEffectScale("stellar", 5)).toBeGreaterThan(1.0);
  });
});

// ============================================================================
describe("DORMANCY: a fitted sensor does NOT change shipDerivedStats", () => {
  it("shipDerivedStats is byte-identical with and without a powerful crafted sensor installed", () => {
    const s = freshState();
    const ship = ship1(s);
    const bare = shipDerivedStats(ship, []);
    // A REAL generated sensor (budget-derived `sensors` line + possible massReduction affix), max-ish.
    const gen = generateEquipment({
      slotType: "sensor",
      varietyKey: "sensorFocusedBeam",
      blueprintKey: null,
      iLevel: 30,
      quality: 5,
      rarity: "radiant",
      ascension: "none",
      rng: () => 0.5,
      allocateId: () => "equip-sensor",
    });
    // Folding the sensor in changes nothing: `sensors` is unfolded (default case in equipmentStatMods),
    // and mass 0 / powerDraw 0 drag nothing. Only the (future) exploration consumer will react.
    expect(shipDerivedStats(ship, [gen])).toEqual(bare);
  });
});
