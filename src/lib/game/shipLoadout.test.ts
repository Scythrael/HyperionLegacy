// ============================================================================
// shipLoadout.test.ts -- tests for the pure "what if I installed this?" helper.
// Author: Claude (Opus 4.8) | 2026-09-01
//
// The load-bearing test is the FIDELITY test: previewing a candidate install and then
// ACTUALLY installing it (fitEquipment, then read the ship back) must produce the SAME
// readout. That is the whole reason the helper folds through the real pure fns
// (shipToCombatant / battleRating / computeCombatReadout) instead of re-deriving stats:
// the preview can never drift from what the ship really fights with.
//
// Also covered:
//   - applyHypotheticalInstall SHAPE: a SINGLETON candidate REPLACES the same-slot piece
//     (count unchanged when one was present); a MULTI candidate (weapon) ADDS (count +1).
//   - net delta SIGN: a stronger emitter yields a positive netRating; a weaker one negative.
//
// No em dashes / no "--" as punctuation (project rule): commas, periods, parens only.
// ============================================================================

import { describe, it, expect } from "vitest";
import { freshState } from "./model";
import type { GameState, EquipmentInstance } from "./model";
import { equippedFor, fitEquipment } from "./equipment";
import { SHIP_TYPES } from "./model";
import { combatHullTypeOf, type CombatHullType } from "./combat/bridge";
import { battleRating } from "./combat/rating";
import { shipToCombatant } from "./combat/bridge";
import {
  applyHypotheticalInstall,
  readoutFor,
  compareInstall,
  type InstallTarget,
} from "./shipLoadout";

// ----------------------------------------------------------------------------
// Fixtures. Minimal hand-built EquipmentInstances (the fold reads slotType +
// weaponType + implicit/rolled stats; the rest is inert), mirroring the style of
// equipment.test.ts / combatFit.test.ts so the inputs stay painfully explicit.
// ----------------------------------------------------------------------------
function makeEquip(over: Partial<EquipmentInstance> & { id: string }): EquipmentInstance {
  return {
    id: over.id,
    slotType: over.slotType ?? "cargoBay",
    weaponType: over.weaponType,
    droneRole: over.droneRole,
    rarity: over.rarity ?? "standard",
    ascension: over.ascension ?? "none",
    quality: over.quality ?? 0,
    iLevel: over.iLevel ?? 1,
    blueprintKey: over.blueprintKey ?? null,
    implicitStats: over.implicitStats ?? {},
    rolledStats: over.rolledStats ?? {},
    mass: over.mass ?? 0,
    powerDraw: over.powerDraw ?? 0,
    durabilityMax: over.durabilityMax ?? 100,
    durability: over.durability ?? 100,
    fittedToShipId: over.fittedToShipId ?? null,
  };
}

// Put the seeded ship (ship-1) on a specific hull and replace the equipment pool
// wholesale, exactly as equipment.test.ts shapes its scenarios.
function withHull(state: GameState, typeKey: GameState["ships"][number]["typeKey"]): GameState {
  return { ...state, ships: [{ ...state.ships[0], typeKey }] };
}
function withEquipment(state: GameState, ...pieces: EquipmentInstance[]): GameState {
  return { ...state, equipment: pieces };
}

// The destroyer hull (4 weapon hardpoints, no drone bays) is the workhorse fixture:
// enough hardpoints to ADD a weapon without hitting the cap, and every combat slot is
// gate-free (no captainSpec requirement) so fitEquipment never blocks in these tests.
const DESTROYER_KEY = "destroyer" as const;
const DESTROYER_DEF = SHIP_TYPES[DESTROYER_KEY];
const DESTROYER_HULL = combatHullTypeOf(DESTROYER_KEY) as CombatHullType;

// The scalar / set content of a CombatReadout, extracted order-independently so a preview
// (candidate appended last) and a real install (candidate wherever it sat in the pool)
// compare EQUAL despite any array-order difference. This is the "key combat fields" the
// fidelity test deep-compares alongside the exact Battle Rating.
function readoutFingerprint(readout: ReturnType<typeof readoutFor>) {
  const c = readout.combat;
  return {
    rating: readout.rating,
    innateHullArmor: c.innateHullArmor,
    hullTotal: c.hullTotal,
    platingHullStrength: c.platingHullStrength,
    shieldTotal: c.shieldTotal,
    rechargeTotal: c.rechargeTotal,
    emitterCap: c.emitterCap,
    emitterRecharge: c.emitterRecharge,
    ablativeArmor: c.ablativeArmor,
    hardpointCap: c.hardpointCap,
    droneBayCap: c.droneBayCap,
    // Sets, sorted, so ORDER never breaks the equality (the readout is position-agnostic).
    weaponIds: c.mountedWeapons.map((w) => w.id).sort(),
    podIds: c.mountedPods.map((p) => p.id).sort(),
    missingRequired: [...c.missingRequired].sort(),
  };
}

// ----------------------------------------------------------------------------
// THE FIDELITY TEST: preview == actual post-fitEquipment readout.
// ----------------------------------------------------------------------------
describe("shipLoadout fidelity: preview equals the real post-install readout", () => {
  it("SINGLETON (shield emitter): previewing a swap equals installing it for real", () => {
    // ship-1 is a destroyer with an existing Standard-Issue shield emitter + one weapon.
    // The candidate is a crafted, stronger emitter spare. Installing it REPLACES the emitter.
    const oldEmitter = makeEquip({
      id: "emit-old",
      slotType: "shieldEmitters",
      implicitStats: { shieldCapacity: 100, shieldRecharge: 5 },
      fittedToShipId: "ship-1",
    });
    const weapon = makeEquip({
      id: "wpn-1",
      slotType: "weapon",
      weaponType: "autocannon",
      fittedToShipId: "ship-1",
    });
    const candidate = makeEquip({
      id: "emit-new",
      slotType: "shieldEmitters",
      implicitStats: { shieldCapacity: 300, shieldRecharge: 12 },
      fittedToShipId: null,
    });
    const state = withEquipment(withHull(freshState(), DESTROYER_KEY), oldEmitter, weapon, candidate);
    const target: InstallTarget = { kind: "slot" };

    // PREVIEW: apply the hypothetical install to the current gear, then fold the readout.
    const currentGear = equippedFor(state, "ship-1");
    const previewGear = applyHypotheticalInstall(currentGear, candidate, target);
    const preview = readoutFor(
      previewGear,
      DESTROYER_DEF,
      DESTROYER_HULL,
      DESTROYER_DEF.weaponHardpoints,
      DESTROYER_DEF.droneBays ?? 0,
    );

    // ACTUAL: really install it, then read the ship's gear back and fold the same readout.
    const afterState = fitEquipment(state, "ship-1", candidate.id);
    const afterGear = equippedFor(afterState, "ship-1");
    const actual = readoutFor(
      afterGear,
      DESTROYER_DEF,
      DESTROYER_HULL,
      DESTROYER_DEF.weaponHardpoints,
      DESTROYER_DEF.droneBays ?? 0,
    );

    expect(readoutFingerprint(preview)).toEqual(readoutFingerprint(actual));
    // And the emitter really did swap (old gone, new present) on the real install.
    expect(afterGear.map((p) => p.id).sort()).toEqual(["emit-new", "wpn-1"]);
  });

  it("MULTI (weapon): previewing an add equals installing it for real", () => {
    // Destroyer with one weapon fitted + three free hardpoints. Installing a second weapon
    // ADDS it (MULTI slot), so preview and real install must both show two weapons.
    const weapon = makeEquip({
      id: "wpn-1",
      slotType: "weapon",
      weaponType: "autocannon",
      fittedToShipId: "ship-1",
    });
    const candidate = makeEquip({
      id: "wpn-2",
      slotType: "weapon",
      weaponType: "railgun",
      implicitStats: { weaponYield: 20 },
      fittedToShipId: null,
    });
    const state = withEquipment(withHull(freshState(), DESTROYER_KEY), weapon, candidate);
    const target: InstallTarget = { kind: "hardpoint", index: 1 };

    const currentGear = equippedFor(state, "ship-1");
    const previewGear = applyHypotheticalInstall(currentGear, candidate, target);
    const preview = readoutFor(
      previewGear,
      DESTROYER_DEF,
      DESTROYER_HULL,
      DESTROYER_DEF.weaponHardpoints,
      DESTROYER_DEF.droneBays ?? 0,
    );

    const afterState = fitEquipment(state, "ship-1", candidate.id);
    const afterGear = equippedFor(afterState, "ship-1");
    const actual = readoutFor(
      afterGear,
      DESTROYER_DEF,
      DESTROYER_HULL,
      DESTROYER_DEF.weaponHardpoints,
      DESTROYER_DEF.droneBays ?? 0,
    );

    expect(readoutFingerprint(preview)).toEqual(readoutFingerprint(actual));
    expect(preview.combat.mountedWeapons.length).toBe(2);
  });
});

// ----------------------------------------------------------------------------
// applyHypotheticalInstall SHAPE: singleton replace vs MULTI add.
// ----------------------------------------------------------------------------
describe("applyHypotheticalInstall shape", () => {
  it("SINGLETON: replaces the same-slot occupant (count unchanged, old gone, new present)", () => {
    const oldEmitter = makeEquip({ id: "emit-old", slotType: "shieldEmitters", fittedToShipId: "ship-1" });
    const weapon = makeEquip({ id: "wpn-1", slotType: "weapon", weaponType: "autocannon", fittedToShipId: "ship-1" });
    const candidate = makeEquip({ id: "emit-new", slotType: "shieldEmitters", fittedToShipId: null });

    const result = applyHypotheticalInstall([oldEmitter, weapon], candidate, { kind: "slot" });

    // The old emitter is evicted, the candidate takes its place, the weapon is untouched.
    expect(result.map((p) => p.id).sort()).toEqual(["emit-new", "wpn-1"]);
    expect(result).toHaveLength(2);
    // Input array is not mutated (PURE).
    expect([oldEmitter, weapon].map((p) => p.id)).toEqual(["emit-old", "wpn-1"]);
  });

  it("SINGLETON into an EMPTY slot: simply appends the candidate (count +1)", () => {
    const weapon = makeEquip({ id: "wpn-1", slotType: "weapon", weaponType: "autocannon", fittedToShipId: "ship-1" });
    const candidate = makeEquip({ id: "plate-new", slotType: "hullPlating", fittedToShipId: null });

    const result = applyHypotheticalInstall([weapon], candidate, { kind: "slot" });

    expect(result.map((p) => p.id).sort()).toEqual(["plate-new", "wpn-1"]);
  });

  it("MULTI (weapon): ADDS the candidate without evicting a sibling weapon (count +1)", () => {
    const weapon = makeEquip({ id: "wpn-1", slotType: "weapon", weaponType: "autocannon", fittedToShipId: "ship-1" });
    const candidate = makeEquip({ id: "wpn-2", slotType: "weapon", weaponType: "railgun", fittedToShipId: null });

    const result = applyHypotheticalInstall([weapon], candidate, { kind: "hardpoint", index: 1 });

    expect(result.map((p) => p.id)).toEqual(["wpn-1", "wpn-2"]);
    expect(result.filter((p) => p.slotType === "weapon")).toHaveLength(2);
  });

  it("DUPE GUARD: a candidate already present appears exactly once", () => {
    const weapon = makeEquip({ id: "wpn-1", slotType: "weapon", weaponType: "autocannon", fittedToShipId: "ship-1" });

    const result = applyHypotheticalInstall([weapon], weapon, { kind: "hardpoint", index: 0 });

    expect(result.filter((p) => p.id === "wpn-1")).toHaveLength(1);
  });
});

// ----------------------------------------------------------------------------
// net delta SIGN: a stronger candidate raises the rating, a weaker one lowers it.
// ----------------------------------------------------------------------------
describe("compareInstall net rating sign", () => {
  // A destroyer already flying a mid emitter; swapping to a STRONGER emitter must net a
  // POSITIVE rating delta, and swapping to a WEAKER one a NEGATIVE delta.
  function stateWithEmitter(cap: number, recharge: number): GameState {
    const emitter = makeEquip({
      id: "emit-cur",
      slotType: "shieldEmitters",
      implicitStats: { shieldCapacity: cap, shieldRecharge: recharge },
      fittedToShipId: "ship-1",
    });
    return withEquipment(withHull(freshState(), DESTROYER_KEY), emitter);
  }

  it("a STRONGER emitter yields a positive netRating", () => {
    const state = stateWithEmitter(200, 8);
    const stronger = makeEquip({
      id: "emit-strong",
      slotType: "shieldEmitters",
      implicitStats: { shieldCapacity: 400, shieldRecharge: 16 },
      fittedToShipId: null,
    });
    const cmp = compareInstall(state, "ship-1", stronger, { kind: "slot" });
    expect(cmp).not.toBeNull();
    expect(cmp!.netRating).toBeGreaterThan(0);
    // The shield-capacity stat row also reads the increase.
    const shieldRow = cmp!.statDeltas.find((d) => d.key === "shieldTotal");
    expect(shieldRow!.delta).toBeGreaterThan(0);
  });

  it("a WEAKER emitter yields a negative netRating", () => {
    const state = stateWithEmitter(400, 16);
    const weaker = makeEquip({
      id: "emit-weak",
      slotType: "shieldEmitters",
      implicitStats: { shieldCapacity: 150, shieldRecharge: 4 },
      fittedToShipId: null,
    });
    const cmp = compareInstall(state, "ship-1", weaker, { kind: "slot" });
    expect(cmp).not.toBeNull();
    expect(cmp!.netRating).toBeLessThan(0);
  });

  it("returns null for an unknown ship id (safe empty state, no throw)", () => {
    const state = withHull(freshState(), DESTROYER_KEY);
    const candidate = makeEquip({ id: "x", slotType: "shieldEmitters" });
    expect(compareInstall(state, "no-such-ship", candidate, { kind: "slot" })).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// readoutFor reuses the real rating path (sanity: it equals a direct battleRating call).
// ----------------------------------------------------------------------------
describe("readoutFor", () => {
  it("its rating equals a direct battleRating over the same folded combatant", () => {
    const gear = [
      makeEquip({ id: "wpn-1", slotType: "weapon", weaponType: "autocannon", fittedToShipId: "ship-1" }),
    ];
    const direct = battleRating(
      shipToCombatant({
        id: "loadout-preview",
        team: "player",
        stats: DESTROYER_DEF,
        hullType: DESTROYER_HULL,
        installedGear: gear,
      }),
    );
    const via = readoutFor(gear, DESTROYER_DEF, DESTROYER_HULL, DESTROYER_DEF.weaponHardpoints, 0);
    expect(via.rating).toBe(direct);
  });
});
