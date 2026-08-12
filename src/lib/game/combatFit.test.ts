// ============================================================================
// combatFit.test.ts -- unit tests for the pure combat-fit readout helpers.
// Author: Claude (Opus 4.8) | 2026-08-12
//
// Covers computeCombatReadout: the hull frame+plating fold, shield pool/recharge
// off the emitter, the weapons-mounted count, and the required-slot "missing" list
// that drives the dispatch-blocker banner. All pure, no DOM.
// ============================================================================

import { describe, it, expect } from "vitest";
import type { EquipmentInstance, EquipmentSlotType } from "./model";
import { frameHp } from "./combat/bridge";
import { computeCombatReadout } from "./combatFit";

// A tiny factory: a fully-shaped EquipmentInstance with sane defaults, so each test
// states only the fields it cares about (slotType + the stats under test).
function piece(
  slotType: EquipmentSlotType,
  overrides: Partial<EquipmentInstance> = {}
): EquipmentInstance {
  return {
    id: overrides.id ?? `p-${slotType}-${Math.random().toString(36).slice(2, 7)}`,
    slotType,
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
    fittedToShipId: "ship-1",
    ...overrides,
  };
}

describe("computeCombatReadout", () => {
  it("folds hull = frameHp(hullIntegrity) + plating.hullStrength (implicit + rolled)", () => {
    // Destroyer-like hull (integrity 600 -> frame 120). Plating carries 380 implicit
    // + 100 rolled = 480, so the total hull pool is 120 + 480 = 600.
    const gear = [
      piece("hullPlating", { implicitStats: { hullStrength: 380 }, rolledStats: { hullStrength: 100 } }),
    ];
    const r = computeCombatReadout(gear, 600, 4);
    expect(r.frameHp).toBe(frameHp(600)); // 120
    expect(r.platingHp).toBe(480);
    expect(r.hullTotal).toBe(600);
  });

  it("reads shield capacity + recharge off the emitter (implicit + rolled), 0 when stripped", () => {
    const withEmitter = computeCombatReadout(
      [piece("shieldEmitters", { implicitStats: { shieldCapacity: 300, shieldRecharge: 5 }, rolledStats: { shieldCapacity: 20 } })],
      600,
      4
    );
    expect(withEmitter.shieldCapacity).toBe(320);
    expect(withEmitter.shieldRecharge).toBe(5);

    const bare = computeCombatReadout([], 600, 4);
    expect(bare.shieldCapacity).toBe(0);
    expect(bare.shieldRecharge).toBe(0);
    expect(bare.shieldEmitter).toBeNull();
  });

  it("counts mounted weapons in fitted order and exposes the hardpoint cap", () => {
    const gear = [
      piece("weapon", { id: "w1", weaponType: "autocannon" }),
      piece("weapon", { id: "w2", weaponType: "plasma" }),
    ];
    const r = computeCombatReadout(gear, 600, 4);
    expect(r.mountedWeapons.map((w) => w.id)).toEqual(["w1", "w2"]);
    expect(r.hardpointCap).toBe(4);
  });

  it("reports every required combat slot missing on a bare hull", () => {
    const r = computeCombatReadout([], 600, 4);
    expect(r.missingRequired).toEqual(["weapon", "shieldEmitters", "hullPlating"]);
  });

  it("reports no missing slots once a weapon + emitter + plating are installed", () => {
    const gear = [
      piece("weapon", { weaponType: "autocannon" }),
      piece("shieldEmitters", { implicitStats: { shieldCapacity: 300, shieldRecharge: 5 } }),
      piece("hullPlating", { implicitStats: { hullStrength: 480 } }),
    ];
    const r = computeCombatReadout(gear, 600, 4);
    expect(r.missingRequired).toEqual([]);
  });

  it("names only the still-empty required slots (partial fit)", () => {
    // Weapon + plating installed, shield emitter stripped: only shieldEmitters missing.
    const gear = [
      piece("weapon", { weaponType: "autocannon" }),
      piece("hullPlating", { implicitStats: { hullStrength: 480 } }),
    ];
    const r = computeCombatReadout(gear, 600, 4);
    expect(r.missingRequired).toEqual(["shieldEmitters"]);
  });

  it("surfaces the plating's ablative armor rolled affix (0 when absent)", () => {
    const withArmor = computeCombatReadout(
      [piece("hullPlating", { implicitStats: { hullStrength: 480 }, rolledStats: { ablativeArmor: 40 } })],
      600,
      4
    );
    expect(withArmor.ablativeArmor).toBe(40);
    expect(computeCombatReadout([], 600, 4).ablativeArmor).toBe(0);
  });
});
