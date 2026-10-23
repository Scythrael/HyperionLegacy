// E-MOD EM-4 (plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-4): the Reactor Cores the EM-4
// goldens and the B10 test install. TEST-ONLY (imported by *.test.ts files only).
//
// Every core is a REAL mint (itemgen.ts generateEquipment, a pure function of its inputs), so a pin taken on one is a
// pin on what a player can craft:
//   ref : the B10 reference, a Standard-quality tier 1 core at the tier's top item level (20), Standard rarity, the
//         WORST roll over 400 seeds (the lowest power output, then the heaviest): its two rolled lines missed both
//         powerOutput and massReduction, so it carries the full base mass 12 and only its signature output.
//   mid : a Balanced Core at item level 10, Standard quality and rarity (a mid-early craft).
//   top : a High-Output Core at item level 40 (the tier 2 cap), quality 5, Radiant: the strongest core 0.14.0 can mint.

import { equipmentStatMods, type EquipmentInstance, type GameState } from "./model";
import { generateEquipment } from "./itemgen";

export const EM4_SHIP = "ship-1";

function seededRng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) ^ 0x9e3779b9) >>> 0;
    return (x >>> 8) / (1 << 24);
  };
}

export type Em4CoreName = "ref" | "mid" | "top";
export const EM4_CORES: readonly Em4CoreName[] = ["ref", "mid", "top"];

// One minted Reactor Core (not yet installed).
export function mintCore(varietyKey: string, iLevel: number, quality: number, rarity: EquipmentInstance["rarity"], seed: number): EquipmentInstance {
  return generateEquipment({
    slotType: "reactorCore",
    varietyKey,
    blueprintKey: null,
    iLevel,
    quality,
    rarity,
    ascension: "none",
    rng: seededRng(seed),
    allocateId: () => "em4-core",
  });
}

// The worst Standard-quality roll of `varietyKey` at `iLevel` over seeds 1 to 400: the lowest power output, then the
// heaviest piece. Deterministic.
export function worstCore(varietyKey: string, iLevel: number): EquipmentInstance {
  let worst: EquipmentInstance | null = null;
  let worstOut = Infinity;
  for (let seed = 1; seed <= 400; seed++) {
    const p = mintCore(varietyKey, iLevel, 0, "standard", seed * 7919);
    const out = equipmentStatMods([p]).powerOutput;
    if (worst === null || out < worstOut || (out === worstOut && p.mass > worst.mass)) {
      worst = p;
      worstOut = out;
    }
  }
  return worst!;
}

export function em4Core(name: Em4CoreName): EquipmentInstance {
  switch (name) {
    case "ref":
      return worstCore("balancedCore", 20);
    case "mid":
      return mintCore("balancedCore", 10, 0, "standard", 0x4d1d);
    case "top":
      return mintCore("highOutputCore", 40, 5, "radiant", 0x70b5);
  }
}

// `s` with ship-1's Reactor Core replaced by `core` (the Standard-Issue core comes out).
export function withCore(s: GameState, core: EquipmentInstance): GameState {
  const rest = s.equipment.filter((e) => !(e.fittedToShipId === EM4_SHIP && e.slotType === "reactorCore"));
  return { ...s, equipment: [...rest, { ...core, fittedToShipId: EM4_SHIP }] };
}

// `s` with a powered Cargo Bay on ship-1 drawing `draw` (a pristine draw; nothing else on the bay acts).
export function withDraw(s: GameState, draw: number): GameState {
  const rest = s.equipment.filter((e) => !(e.fittedToShipId === EM4_SHIP && e.slotType === "cargoBay"));
  const bay: EquipmentInstance = {
    id: "em4-bay",
    slotType: "cargoBay",
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 1,
    blueprintKey: null,
    implicitStats: { cargoCapacity: 0 },
    rolledStats: {},
    mass: 0,
    powerDraw: draw,
    durabilityMax: 100,
    fittedToShipId: EM4_SHIP,
  };
  return { ...s, equipment: [...rest, bay] };
}
