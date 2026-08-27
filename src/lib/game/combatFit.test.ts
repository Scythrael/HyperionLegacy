// ============================================================================
// combatFit.test.ts -- unit tests for the pure combat-fit readout helpers.
// Author: Claude (Opus 4.8) | 2026-08-12
// Reworked 2026-08-27 (combat-defense rework, Unit 6): the readout folds defense
// as innate ship stats + item gear (matching shipToCombatant), so these cover the
// innate armor + shield-amplification split, the composed hull/shield totals, the
// weapon + drone-pod lists, and the still-empty combat-slot list. All pure, no DOM.
//
// The hull stat inputs below use the design's calibration + SI dials
// (SI_PLATING_HP=100, SI_EMITTER_CAP=100, SI_EMITTER_RECHARGE=3), so a "destroyer"
// hull (integrity 600 / shield cap 300 / recharge 6) derives innateHullArmor 500,
// innateShieldCapMult 2.0 (300/100 - 1), innateShieldRechargeMult 1.0 (6/3 - 1).
// ============================================================================

import { describe, it, expect } from "vitest";
import type { EquipmentInstance, EquipmentSlotType } from "./model";
import type { CombatShipStats } from "./combat/bridge";
import { computeCombatReadout } from "./combatFit";

// A "destroyer" hull's combat stats: integrity 600, shield cap 300, recharge 6. Derives
// innateHullArmor 500, innateShieldCapMult 2.0, innateShieldRechargeMult 1.0 (clean values).
const DESTROYER: CombatShipStats = { hullIntegrity: 600, shieldCapacity: 300, shieldRecharge: 6 };
// A "carrier" hull's combat stats (used only for the drone-bay assertions).
const CARRIER: CombatShipStats = { hullIntegrity: 1100, shieldCapacity: 500, shieldRecharge: 7 };

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
  it("exposes the hull's innate stats derived from its authored totals + the SI dials", () => {
    const r = computeCombatReadout([], DESTROYER, 4);
    expect(r.innateHullArmor).toBe(500); // 600 - SI_PLATING_HP(100)
    expect(r.innateShieldCapMult).toBe(2); // 300 / SI_EMITTER_CAP(100) - 1
    expect(r.innateShieldRechargeMult).toBe(1); // 6 / SI_EMITTER_RECHARGE(3) - 1
  });

  it("folds hull = innateHullArmor + plating.hullStrength (implicit + rolled)", () => {
    // Plating carries 380 implicit + 100 rolled = 480, added to the innate 500 armor = 980.
    const gear = [
      piece("hullPlating", { implicitStats: { hullStrength: 380 }, rolledStats: { hullStrength: 100 } }),
    ];
    const r = computeCombatReadout(gear, DESTROYER, 4);
    expect(r.innateHullArmor).toBe(500);
    expect(r.platingHullStrength).toBe(480);
    expect(r.hullTotal).toBe(980);
  });

  it("a Standard-Issue plating recomposes to the hull's authored integrity (byte-identical)", () => {
    // SI plating hullStrength == SI_PLATING_HP(100): innate 500 + 100 = 600 = authored integrity.
    const r = computeCombatReadout([piece("hullPlating", { implicitStats: { hullStrength: 100 } })], DESTROYER, 4);
    expect(r.hullTotal).toBe(600);
  });

  it("amplifies the emitter cap/recharge by the hull's innate shield mults; 0 when stripped", () => {
    // Emitter cap 100 implicit + 20 rolled = 120, recharge 5. capMult 2.0 -> shield 120 x 3 = 360;
    // rechMult 1.0 -> recharge 5 x 2 = 10. The raw cap/recharge are exposed alongside the totals.
    const withEmitter = computeCombatReadout(
      [piece("shieldEmitters", { implicitStats: { shieldCapacity: 100, shieldRecharge: 5 }, rolledStats: { shieldCapacity: 20 } })],
      DESTROYER,
      4
    );
    expect(withEmitter.emitterCap).toBe(120);
    expect(withEmitter.emitterRecharge).toBe(5);
    expect(withEmitter.shieldTotal).toBe(360);
    expect(withEmitter.rechargeTotal).toBe(10);

    // No emitter: there is nothing to amplify, so every shield figure is 0 (emitters ARE the source).
    const bare = computeCombatReadout([], DESTROYER, 4);
    expect(bare.emitterCap).toBe(0);
    expect(bare.emitterRecharge).toBe(0);
    expect(bare.shieldTotal).toBe(0);
    expect(bare.rechargeTotal).toBe(0);
    expect(bare.shieldEmitter).toBeNull();
  });

  it("a Standard-Issue emitter recomposes to the hull's authored shield (byte-identical)", () => {
    // SI emitter cap == SI_EMITTER_CAP(100), recharge == SI_EMITTER_RECHARGE(3): 100 x 3 = 300,
    // 3 x 2 = 6, both the destroyer's authored shieldCapacity / shieldRecharge.
    const r = computeCombatReadout(
      [piece("shieldEmitters", { implicitStats: { shieldCapacity: 100, shieldRecharge: 3 } })],
      DESTROYER,
      4
    );
    expect(r.shieldTotal).toBe(300);
    expect(r.rechargeTotal).toBe(6);
  });

  it("counts mounted weapons in fitted order and exposes the hardpoint cap", () => {
    const gear = [
      piece("weapon", { id: "w1", weaponType: "autocannon" }),
      piece("weapon", { id: "w2", weaponType: "plasma" }),
    ];
    const r = computeCombatReadout(gear, DESTROYER, 4);
    expect(r.mountedWeapons.map((w) => w.id)).toEqual(["w1", "w2"]);
    expect(r.hardpointCap).toBe(4);
  });

  it("reports every empty combat slot on a bare hull", () => {
    const r = computeCombatReadout([], DESTROYER, 4);
    expect(r.missingRequired).toEqual(["weapon", "shieldEmitters", "hullPlating"]);
  });

  it("reports no empty combat slots once a weapon + emitter + plating are installed", () => {
    const gear = [
      piece("weapon", { weaponType: "autocannon" }),
      piece("shieldEmitters", { implicitStats: { shieldCapacity: 300, shieldRecharge: 5 } }),
      piece("hullPlating", { implicitStats: { hullStrength: 480 } }),
    ];
    const r = computeCombatReadout(gear, DESTROYER, 4);
    expect(r.missingRequired).toEqual([]);
  });

  it("names only the still-empty combat slots (partial fit)", () => {
    // Weapon + plating installed, shield emitter stripped: only shieldEmitters empty.
    const gear = [
      piece("weapon", { weaponType: "autocannon" }),
      piece("hullPlating", { implicitStats: { hullStrength: 480 } }),
    ];
    const r = computeCombatReadout(gear, DESTROYER, 4);
    expect(r.missingRequired).toEqual(["shieldEmitters"]);
  });

  it("surfaces the plating's ablative armor rolled affix (0 when absent)", () => {
    const withArmor = computeCombatReadout(
      [piece("hullPlating", { implicitStats: { hullStrength: 480 }, rolledStats: { ablativeArmor: 40 } })],
      DESTROYER,
      4
    );
    expect(withArmor.ablativeArmor).toBe(40);
    expect(computeCombatReadout([], DESTROYER, 4).ablativeArmor).toBe(0);
  });

  // Drone pods: the DRONE analogue of the weapon assertions above. mountedPods mirrors
  // mountedWeapons (fitted order, one per bay cell) and droneBayCap mirrors hardpointCap;
  // drone bays are OPTIONAL, so they never change missingRequired.

  it("counts mounted drone pods in fitted order and exposes the drone bay cap", () => {
    const gear = [
      piece("droneBay", { id: "d1", droneRole: "attack" }),
      piece("droneBay", { id: "d2", droneRole: "defense" }),
    ];
    const r = computeCombatReadout(gear, CARRIER, 2, 2);
    expect(r.mountedPods.map((p) => p.id)).toEqual(["d1", "d2"]);
    expect(r.droneBayCap).toBe(2);
  });

  it("defaults droneBayCap to 0 and mountedPods to [] on a hull with no bays (3-arg call)", () => {
    // A non-carrier combat hull: the 3-arg call site (no bay count) reads a carrier-free
    // readout, and gear that carries no droneBay piece mounts no pods.
    const gear = [piece("weapon", { weaponType: "autocannon" })];
    const r = computeCombatReadout(gear, DESTROYER, 4);
    expect(r.droneBayCap).toBe(0);
    expect(r.mountedPods).toEqual([]);
  });

  it("does not let installed drone pods affect the empty-combat-slot list", () => {
    // A carrier with only pods installed (no weapon / emitter / plating) still reports every
    // combat slot empty: drone bays are optional and never satisfy a combat slot.
    const gear = [piece("droneBay", { droneRole: "support" })];
    const r = computeCombatReadout(gear, CARRIER, 2, 2);
    expect(r.missingRequired).toEqual(["weapon", "shieldEmitters", "hullPlating"]);
    expect(r.mountedPods.length).toBe(1);
  });
});
