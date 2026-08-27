// ============================================================================
// combatFit.test.ts -- unit tests for the pure combat-fit readout helpers.
// Author: Claude (Opus 4.8) | 2026-08-12
// Reworked 2026-08-27 (combat-defense rework, HYBRID model): the readout folds defense as the hull's
// bare frame + installed plating (ADDITIVE) and the installed emitter x the hull's shield effectiveness
// (matching shipToCombatant), so these cover the bare-frame armor, the shield-cap / recharge effectiveness
// ratios, the composed hull/shield totals, the weapon + drone-pod lists, and the still-empty combat-slot
// list. All pure, no DOM.
//
// The hull stat inputs below: the "destroyer" (cap 300 / recharge 6) IS the shield reference, so it reads
// 100% shield/recharge effectiveness; a TANKY hull reads 200% and a GLASS hull 50%. Hull is additive:
// innateHullArmor = hullIntegrity - SI_PLATING_HP (100), so the destroyer's bare frame is 500.
// ============================================================================

import { describe, it, expect } from "vitest";
import type { EquipmentInstance, EquipmentSlotType } from "./model";
import { SI_PLATING_HP, SI_EMITTER_CAP, SI_EMITTER_RECHARGE } from "./model";
import type { CombatShipStats } from "./combat/bridge";
import { computeCombatReadout } from "./combatFit";

// The MID combat hull == the shield reference, so it reads 100% shield/recharge effectiveness. Its bare
// frame (additive) = 600 - SI_PLATING_HP(100) = 500.
const DESTROYER: CombatShipStats = { hullIntegrity: 600, shieldCapacity: 300, shieldRecharge: 6 };
// A TANKY hull: 2x the shield reference -> 200% shield/recharge effectiveness; bare frame = 1200 - 100 = 1100.
const TANKY: CombatShipStats = { hullIntegrity: 1200, shieldCapacity: 600, shieldRecharge: 12 };
// A GLASS hull: 0.5x the shield reference -> 50% shield/recharge effectiveness; bare frame = 300 - 100 = 200.
const GLASS: CombatShipStats = { hullIntegrity: 300, shieldCapacity: 150, shieldRecharge: 3 };
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
  it("exposes the hull's bare frame (additive) + shield effectiveness ratios (mid 100%, glass 50%, tanky 200%)", () => {
    const mid = computeCombatReadout([], DESTROYER, 4);
    expect(mid.innateHullArmor).toBe(500); // 600 - SI_PLATING_HP(100), additive bare frame
    expect(mid.shieldCapEffectiveness).toBe(1); // 300 / REF_SHIELD_CAPACITY(300)
    expect(mid.shieldRechargeEffectiveness).toBe(1); // 6 / REF_SHIELD_RECHARGE(6)

    const glass = computeCombatReadout([], GLASS, 1);
    expect(glass.innateHullArmor).toBe(200); // 300 - 100
    expect(glass.shieldCapEffectiveness).toBe(0.5);
    expect(glass.shieldRechargeEffectiveness).toBe(0.5);

    const tanky = computeCombatReadout([], TANKY, 6);
    expect(tanky.innateHullArmor).toBe(1100); // 1200 - 100
    expect(tanky.shieldCapEffectiveness).toBe(2);
    expect(tanky.shieldRechargeEffectiveness).toBe(2);
  });

  it("folds hull = innateHullArmor + plating.hullStrength (implicit + rolled, ADDITIVE)", () => {
    // Plating carries 380 implicit + 100 rolled = 480; on the TANKY hull (bare frame 1100) the total
    // hull is 1100 + 480 = 1580 (additive, independent of any shield effectiveness).
    const gear = [
      piece("hullPlating", { implicitStats: { hullStrength: 380 }, rolledStats: { hullStrength: 100 } }),
    ];
    const r = computeCombatReadout(gear, TANKY, 4);
    expect(r.innateHullArmor).toBe(1100);
    expect(r.platingHullStrength).toBe(480);
    expect(r.hullTotal).toBe(1580);
  });

  it("an UNPLATED ship folds to its nonzero bare frame, never 0 (user-locked)", () => {
    // No hull plating installed: hullTotal is the bare frame alone (innateHullArmor), a nonzero number
    // (a bare hull is armored, not an exposed space frame). platingHullStrength is 0.
    const r = computeCombatReadout([piece("weapon", { weaponType: "autocannon" })], DESTROYER, 4);
    expect(r.hullPlating).toBeNull();
    expect(r.platingHullStrength).toBe(0);
    expect(r.innateHullArmor).toBe(500);
    expect(r.hullTotal).toBe(500); // NOT 0
  });

  it("a Standard-Issue plating recomposes to the hull's authored integrity (byte-identical)", () => {
    // SI plating hullStrength == SI_PLATING_HP(100), ADDED to the bare frame: destroyer 500 + 100 = 600,
    // tanky 1100 + 100 = 1200, both the authored integrity (byte-identical).
    expect(computeCombatReadout([piece("hullPlating", { implicitStats: { hullStrength: SI_PLATING_HP } })], DESTROYER, 4).hullTotal).toBe(600);
    expect(computeCombatReadout([piece("hullPlating", { implicitStats: { hullStrength: SI_PLATING_HP } })], TANKY, 4).hullTotal).toBe(1200);
  });

  it("scales the emitter cap/recharge by the hull's shield effectiveness; 0 when stripped", () => {
    // Emitter cap 100 implicit + 20 rolled = 120, recharge 5. On the TANKY hull (200% shield/recharge
    // effectiveness): shield 120 x 2 = 240, recharge 5 x 2 = 10. Raw cap/recharge exposed alongside.
    const withEmitter = computeCombatReadout(
      [piece("shieldEmitters", { implicitStats: { shieldCapacity: 100, shieldRecharge: 5 }, rolledStats: { shieldCapacity: 20 } })],
      TANKY,
      4
    );
    expect(withEmitter.emitterCap).toBe(120);
    expect(withEmitter.emitterRecharge).toBe(5);
    expect(withEmitter.shieldTotal).toBe(240);
    expect(withEmitter.rechargeTotal).toBe(10);

    // No emitter: there is nothing to scale, so every shield figure is 0 (emitters ARE the source).
    const bare = computeCombatReadout([], DESTROYER, 4);
    expect(bare.emitterCap).toBe(0);
    expect(bare.emitterRecharge).toBe(0);
    expect(bare.shieldTotal).toBe(0);
    expect(bare.rechargeTotal).toBe(0);
    expect(bare.shieldEmitter).toBeNull();
  });

  it("a Standard-Issue emitter recomposes to the hull's authored shield (byte-identical)", () => {
    // SI emitter cap == SI_EMITTER_CAP, recharge == SI_EMITTER_RECHARGE: on the reference (100%) hull
    // it folds to exactly the destroyer's authored shieldCapacity 300 / shieldRecharge 6.
    const r = computeCombatReadout(
      [piece("shieldEmitters", { implicitStats: { shieldCapacity: SI_EMITTER_CAP, shieldRecharge: SI_EMITTER_RECHARGE } })],
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
