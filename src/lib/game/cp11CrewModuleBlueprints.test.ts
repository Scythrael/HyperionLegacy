// Complement CP-11 (plan docs/plans/2026-10-14-complement-and-acquisition-plan.md CP-11, Task 28 engine): the crew
// module and early sensor array blueprints. Tiers per SMS-2's table and OC-15; recipes per the recipe realism audit
// section 5 (user call 13, "Component mixes"; Medical Quarters takes 1 Purified Biomass) and section 4.8 (the arrays).
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { BLUEPRINTS, CREW_MODULE_BLUEPRINTS, EQUIPMENT_SLOTS, ITEMS, freshState, type GameState } from "./model";
import { installedBridgeModule, installedQuartersModule, quartersCapacityBonus } from "./crewModules";
import { installedSensorArray } from "./sensorArrays";
import { canResearch, economyTick, inspectBlank, startLine, startResearch } from "./tick";
import { canFitEquipment, fitEquipment } from "./equipment";
import { archivableBlueprints } from "./archive";
import { addItemQuality } from "./inventory";
import { CP11_BLUEPRINT_KEYS, withoutCp11Content } from "./cp11BlueprintsSwitch.fixture";
import { WIRING_REGISTRY as REGISTRY } from "./wiring/registry";

// The user-locked tiers (SMS-2 / OC-15; the Guest Wing's, user 2026-11-03: "Tier 1").
const TIERS: Readonly<Record<string, 1 | 2 | 3>> = {
  balancedCommandBp: 1,
  utilitarianQuartersBp: 1,
  wideBeamArrayBp: 1,
  balancedArrayBp: 1,
  guestWingBp: 1,
  focusedCommandBp: 2,
  securityQuartersBp: 2,
  engineeringQuartersBp: 2,
  scienceQuartersBp: 2,
  medicalQuartersBp: 2,
  operationsQuartersBp: 2,
  flightDeckQuartersBp: 2,
  efficientQuartersBp: 2,
  focusedBeamArrayBp: 2,
  flagCommandBp: 3,
};

// The recipes: the audit's section 5 for the modules and section 4.8 for the arrays (approved 2026-11-03), save the
// three [PROPOSAL] swaps that tell the shared quarters pairs apart (user 2026-11-03, "Tell them apart"; model.ts
// CREW_MODULE_BLUEPRINTS lists old and new): Engineering, Science and the Guest Wing.
const RECIPES: Readonly<Record<string, Record<string, number>>> = {
  balancedCommandBp: { frameSegment: 1, powerCoupling: 2, polysilicateWafer: 2 },
  focusedCommandBp: { frameSegment: 1, powerCoupling: 2, polysilicateWafer: 3 },
  flagCommandBp: { structuralAssembly: 1, powerCoupling: 3, polysilicateWafer: 3 },
  utilitarianQuartersBp: { frameSegment: 2, titaniumIngot: 2, powerCoupling: 1 },
  efficientQuartersBp: { frameSegment: 2, titaniumIngot: 1, powerCoupling: 2 },
  securityQuartersBp: { frameSegment: 2, titaniumIngot: 3 },
  engineeringQuartersBp: { frameSegment: 2, powerCoupling: 2, polysilicateWafer: 1 }, // [PROPOSAL]
  scienceQuartersBp: { frameSegment: 2, polysilicateWafer: 1, titaniumIngot: 1, powerCoupling: 1 }, // [PROPOSAL]
  medicalQuartersBp: { frameSegment: 2, polysilicateWafer: 1, titaniumIngot: 1, purifiedBiomass: 1 },
  operationsQuartersBp: { frameSegment: 2, polysilicateWafer: 2, powerCoupling: 1 },
  flightDeckQuartersBp: { frameSegment: 3, powerCoupling: 1 },
  guestWingBp: { frameSegment: 1, titaniumIngot: 2, powerCoupling: 2 }, // [PROPOSAL]
  wideBeamArrayBp: { polysilicateWafer: 4, frameSegment: 2 },
  focusedBeamArrayBp: { polysilicateWafer: 3, powerCoupling: 2 },
  balancedArrayBp: { polysilicateWafer: 3, powerCoupling: 1, frameSegment: 1 },
};

// Components only (L2): the three component blueprints' outputs and the two refined bases; Medical Quarters' Purified
// Biomass is the one exception (call 13).
const COMPONENT_INPUTS = new Set(["frameSegment", "powerCoupling", "structuralAssembly", "titaniumIngot", "polysilicateWafer"]);

function minted(s: GameState, key: string): { state: GameState; id: string } {
  const held: GameState = { ...s, blanks: { ...s.blanks, [key]: new Decimal(1) } };
  const after = inspectBlank(held, key);
  const piece = after.equipment.find((e) => !held.equipment.some((x) => x.id === e.id));
  if (piece === undefined) throw new Error(`no piece minted for ${key}`);
  return { state: after, id: piece.id };
}

describe("CP-11: the crew module and early sensor array blueprints", () => {
  it("adds the fifteen blueprints (3 bridge, 9 quarters with the Guest Wing, 3 arrays), each in BLUEPRINTS", () => {
    expect(new Set(Object.keys(CREW_MODULE_BLUEPRINTS))).toEqual(CP11_BLUEPRINT_KEYS);
    const bySlot = { bridge: 0, quarters: 0, sensor: 0 } as Record<string, number>;
    for (const key of CP11_BLUEPRINT_KEYS) {
      expect(BLUEPRINTS[key], key).toBe(CREW_MODULE_BLUEPRINTS[key]);
      bySlot[BLUEPRINTS[key].equipmentOutput!.slotType] += 1;
    }
    expect(bySlot).toEqual({ bridge: 3, quarters: 9, sensor: 3 });
  });

  it("names each blueprint after its variety, like the Bio-Resonance one", () => {
    for (const key of CP11_BLUEPRINT_KEYS) {
      const out = BLUEPRINTS[key].equipmentOutput!;
      const variety = EQUIPMENT_SLOTS[out.slotType].varieties.find((v) => v.key === out.varietyKey);
      expect(variety, key).toBeDefined();
      expect(BLUEPRINTS[key].label).toBe(`${variety!.label} Blueprint`);
    }
  });

  it("puts each on its Lab tier (SMS-2 / OC-15) with no relic or decode gate", () => {
    for (const [key, tier] of Object.entries(TIERS)) {
      const bp = BLUEPRINTS[key];
      expect(bp.tier, key).toBe(tier);
      expect(bp.requiresRelicDiscovery, key).toBeUndefined();
      expect(bp.requiresDecode, key).toBeUndefined();
      expect(bp.unlockOnly, key).toBeUndefined();
    }
    // Flag Command shares Elite Quarters' tier III rung (OC-15 "tier 3 now that the rung exists") and its costs.
    expect(BLUEPRINTS.flagCommandBp.tier).toBe(BLUEPRINTS.eliteQuartersBp.tier);
    expect([BLUEPRINTS.flagCommandBp.researchDurationTicks, BLUEPRINTS.flagCommandBp.researchCreditCost, BLUEPRINTS.flagCommandBp.craftDurationTicks]).toEqual([
      BLUEPRINTS.eliteQuartersBp.researchDurationTicks,
      BLUEPRINTS.eliteQuartersBp.researchCreditCost,
      BLUEPRINTS.eliteQuartersBp.craftDurationTicks,
    ]);
  });

  it("takes the audit's recipes: components only, Medical Quarters' Purified Biomass the one exception", () => {
    for (const [key, inputs] of Object.entries(RECIPES)) expect(BLUEPRINTS[key].recipe.inputs, key).toEqual(inputs);
    for (const key of CP11_BLUEPRINT_KEYS) {
      for (const item of Object.keys(BLUEPRINTS[key].recipe.inputs)) {
        expect(COMPONENT_INPUTS.has(item) || (key === "medicalQuartersBp" && item === "purifiedBiomass"), `${key} ${item}`).toBe(true);
        expect(ITEMS[item], item).toBeDefined();
      }
      // M7: no Iridium Catalyst below the top tier; call 14: canisters only on the tier 3+ quarters and sensors.
      expect(BLUEPRINTS[key].recipe.inputs.iridiumCatalyst, key).toBeUndefined();
    }
  });

  it("gives every bridge and quarters module, and the three early arrays, a blueprint", () => {
    const made = new Set(Object.values(BLUEPRINTS).map((bp) => (bp.equipmentOutput ? `${bp.equipmentOutput.slotType}:${bp.equipmentOutput.varietyKey}` : "")));
    for (const slot of ["bridge", "quarters"] as const) for (const v of EQUIPMENT_SLOTS[slot].varieties) expect(made.has(`${slot}:${v.key}`), v.key).toBe(true);
    for (const v of ["sensorWideBeam", "sensorFocusedBeam", "sensorBalanced"]) expect(made.has(`sensor:${v}`), v).toBe(true);
  });

  it("each blueprint mints its variety, which installs and resolves as its module", () => {
    for (const key of CP11_BLUEPRINT_KEYS) {
      const out = BLUEPRINTS[key].equipmentOutput!;
      const { state, id } = minted(freshState(), key);
      const piece = state.equipment.find((e) => e.id === id)!;
      expect([piece.slotType, piece.moduleVariant, piece.blueprintKey], key).toEqual([out.slotType, out.varietyKey, key]);
      expect(canFitEquipment(state, "ship-1", id), key).toEqual({ ok: true });
      const fitted = fitEquipment(state, "ship-1", id);
      const ship = fitted.ships.find((sh) => sh.id === "ship-1")!;
      const def = out.slotType === "quarters" ? installedQuartersModule(fitted, ship)?.def : out.slotType === "bridge" ? installedBridgeModule(fitted, ship)?.def : installedSensorArray(fitted, ship)?.def;
      expect(def?.id, key).toBe(out.varietyKey);
      // Quarters: every CP-11 quarters module adds berths (Elite Quarters, the one that adds none, is GG-7's).
      if (out.slotType === "quarters") expect(quartersCapacityBonus(fitted, ship), key).toBeGreaterThan(0);
    }
  });

  it("a fresh save researches, crafts and installs a Wide-Beam Array, a Balanced Command and Utilitarian Quarters with no relic", () => {
    for (const key of ["wideBeamArrayBp", "balancedCommandBp", "utilitarianQuartersBp"]) {
      let s: GameState = { ...freshState(), credits: new Decimal(1e6) };
      s = { ...s, facilities: { ...s.facilities, research: { level: 1 }, fabricator: { level: 1 } } };
      expect(s.relicDiscovered ?? []).toEqual([]);
      expect(canResearch(s, key), key).toEqual({ ok: true });
      const r = startResearch(s, key);
      expect(r.started, key).toBe(true);
      s = r.next;
      for (let i = 0; i < BLUEPRINTS[key].researchDurationTicks + 2 && !s.researchedBlueprints.includes(key); i += 1) s = economyTick(s, 1, () => 0.5);
      expect(s.researchedBlueprints, key).toContain(key);
      for (const [item, qty] of Object.entries(BLUEPRINTS[key].recipe.inputs)) s = { ...s, inventory: addItemQuality(s.inventory, item, new Decimal(qty), 0) };
      const line = startLine(s, "fabricate", key, { kind: "batch", remaining: 1 });
      expect(line.started, `${key} ${line.reason}`).toBe(true);
      s = line.next;
      for (let i = 0; i < BLUEPRINTS[key].craftDurationTicks + 2 && !(s.blanks[key]?.gte(1) ?? false); i += 1) s = economyTick(s, 1, () => 0.5);
      expect(s.blanks[key]?.gte(1), key).toBe(true);
      const before = s.equipment.length;
      s = inspectBlank(s, key);
      expect(s.equipment.length, key).toBe(before + 1);
      const piece = s.equipment[s.equipment.length - 1];
      expect(piece.moduleVariant, key).toBe(BLUEPRINTS[key].equipmentOutput!.varietyKey);
      expect(canFitEquipment(s, "ship-1", piece.id), key).toEqual({ ok: true });
    }
  });

  it("the Archive gains the fifteen rows (completion % drops: the Task 10 precedent, a patch note)", () => {
    const now = archivableBlueprints().map((a) => a.key);
    const before = withoutCp11Content(() => archivableBlueprints().map((a) => a.key));
    expect(now.length - before.length).toBe(15);
    expect(new Set(now.filter((k) => !before.includes(k)))).toEqual(CP11_BLUEPRINT_KEYS);
  });

  it("registers each blueprint's effect LIVE with a probe; the obtainable row went live with CP-12's install tiles", () => {
    for (const key of CP11_BLUEPRINT_KEYS) {
      const e = REGISTRY.find((x) => x.id === `ship:BLUEPRINTS:${key}:effect`);
      expect(e?.status, key).toEqual({ kind: "live" });
      expect(e?.probe, key).toBeDefined();
    }
    // CP-12 (cp12BridgeQuartersTiles.test.ts): the Bridge Module and Crew Quarters tiles exist, so the row is live.
    const obtainable = REGISTRY.find((x) => x.id === "ship:EQUIPMENT_SLOTS:bridge+quarters:obtainable");
    expect(obtainable?.status).toEqual({ kind: "live" });
    expect(obtainable?.probe).toBe("fillableBerths");
  });
});
