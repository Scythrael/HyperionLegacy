// G1-1 (Short-Range Missions, docs/plans/2026-10-17-short-range-missions-plan.md section 4 G1-1): guest quarters
// (`colonistCapacity`, shown as "Guest quarters") goes live. Its four sources (user 2026-10-19 call 6, "Affix, variety,
// hull, perk"): the Crew Quarters affix line, the Guest Wing variety's signature line, the transport hulls' base
// berths, and the General hull family's quarters perk. Proven here: neutrality (no source, no field), each source
// moves the stat by its catalog magnitude, and guests are never crew and never cargo.

import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_SLOTS,
  GENERAL_QUARTERS_GUEST_PERK,
  HULL_GUEST_QUARTERS,
  LIVE_STAT_KEYS,
  RESERVED_STAT_KEYS,
  SHIP_TYPES,
  equipmentStatMods,
  freshState,
  rarityIndex,
  shipDerivedStats,
  type BlueprintDef,
  type EquipmentInstance,
  type GameState,
  type ShipInstance,
  type ShipTypeKey,
} from "./model";
import { GUEST_QUARTERS_PER_POINT, computeBudget, budgetShares, generateEquipment, guestLineValue, previewCraftOutcome } from "./itemgen";
import { effectiveShipStats, shipCrewContribution } from "./crewOverlay";
import { GUEST_WING_CREW_CAPACITY, getQuartersModuleById, quartersCapacityBonus } from "./crewModules";
import { complementTotalCap } from "./commandStructure";
import { installPiece } from "./wiring/probes";

const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];

const hull = (typeKey: ShipTypeKey): ShipInstance => ({ id: "ship-g", typeKey, assignedCaptainId: null });

// A quarters piece on ship-g carrying `guests` berths on its rolled (affix) line, of `variety`.
function quarters(guests: number, variety = "quartersUtilitarian", where: "rolled" | "implicit" = "rolled"): EquipmentInstance {
  return {
    id: "equip-g",
    slotType: "quarters",
    moduleVariant: variety,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: null,
    implicitStats: where === "implicit" && guests > 0 ? { colonistCapacity: guests } : {},
    rolledStats: where === "rolled" && guests > 0 ? { colonistCapacity: guests } : {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 110,
    durability: 110,
    fittedToShipId: "ship-g",
  };
}

// freshState with ship-1 retyped to `typeKey` (its economy Standard Issue kept).
function on(typeKey: ShipTypeKey): GameState {
  const s = freshState();
  return { ...s, ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey } : sh)) };
}

describe("G1-1 guest quarters: the stat vocabulary", () => {
  it("colonistCapacity is LIVE (no longer reserved) and rolls on the quarters slot", () => {
    expect(LIVE_STAT_KEYS).toContain("colonistCapacity");
    expect(RESERVED_STAT_KEYS as readonly string[]).not.toContain("colonistCapacity");
    expect(EQUIPMENT_SLOTS.quarters.affixPool.at(-1)).toEqual({ stat: "colonistCapacity", weight: 2 });
    const wing = EQUIPMENT_SLOTS.quarters.varieties.find((v) => v.key === "quartersGuestWing");
    expect(wing?.label).toBe("Guest Wing");
    expect(wing?.implicitStats).toEqual(["colonistCapacity"]);
  });
});

describe("G1-1 guest quarters: neutrality", () => {
  it("a hull with no base and no guest line carries no colonistCapacity field (bare and fitted)", () => {
    for (const k of HULLS.filter((h) => SHIP_TYPES[h].colonistCapacity === undefined)) {
      expect("colonistCapacity" in shipDerivedStats(hull(k)), k).toBe(false);
      expect("colonistCapacity" in shipDerivedStats(hull(k), [quarters(0)]), k).toBe(false);
    }
  });
  it("a fold with no guest line leaves equipmentStatMods' flat record in its pre-G1 shape", () => {
    expect(Object.keys(equipmentStatMods([quarters(0)]).flat).sort()).toEqual(["cargoCapacity", "fuelCapacity", "sensors"]);
    expect(equipmentStatMods([quarters(12)]).flat.colonistCapacity).toBe(12);
  });
});

describe("G1-1 guest quarters: each source moves the stat by its catalog magnitude", () => {
  it("hull base: each transport hull's bare sheet reads HULL_GUEST_QUARTERS, every other hull none", () => {
    expect(HULL_GUEST_QUARTERS).toEqual({ generalFreighter: 20, orion: 40, aurora: 40, eir: 80 });
    for (const k of HULLS) {
      const want = (HULL_GUEST_QUARTERS as Record<string, number>)[k];
      expect(SHIP_TYPES[k].colonistCapacity, k).toBe(want);
      expect(shipDerivedStats(hull(k)).colonistCapacity, k).toBe(want);
      expect(effectiveShipStats(on(k), on(k).ships[0]).colonistCapacity, k).toBe(want);
    }
  });

  it("affix line: adds its berths flat (on a non-General hull, where no perk applies)", () => {
    expect(shipDerivedStats(hull("prospectorHauler"), [quarters(30)]).colonistCapacity).toBe(30);
    expect(shipDerivedStats(hull("orion"), [quarters(30)]).colonistCapacity).toBe(70);
    expect(shipDerivedStats(hull("eir"), [quarters(30, "quartersGuestWing", "implicit")]).colonistCapacity).toBe(110);
  });

  it("Guest Wing: its signature line is guest quarters in berths (no crewStations line), and it is stamped", () => {
    const p = generateEquipment({
      slotType: "quarters",
      varietyKey: "quartersGuestWing",
      blueprintKey: null,
      iLevel: 10,
      quality: 0,
      rarity: "derelict",
      ascension: "none",
      rng: () => 0.5,
      allocateId: () => "equip-w",
    });
    const points = Math.round(budgetShares(computeBudget(10, 0, 0)).implicitShare);
    expect(p.implicitStats).toEqual({ colonistCapacity: points * GUEST_QUARTERS_PER_POINT });
    expect(p.moduleVariant).toBe("quartersGuestWing");
    expect(shipDerivedStats(hull("prospectorRunner"), [{ ...p, fittedToShipId: "ship-g" }]).colonistCapacity).toBe(points * GUEST_QUARTERS_PER_POINT);
  });

  it("a rolled guest affix is stored in berths too (budget points x GUEST_QUARTERS_PER_POINT)", () => {
    expect(guestLineValue("colonistCapacity", 5)).toBe(5 * GUEST_QUARTERS_PER_POINT);
    expect(guestLineValue("crewStations", 5)).toBe(5);
    let found = false;
    for (let seed = 1; seed < 200 && !found; seed++) {
      let x = seed;
      const p = generateEquipment({
        slotType: "quarters",
        varietyKey: "quartersUtilitarian",
        blueprintKey: null,
        iLevel: 10,
        quality: 0,
        rarity: "standard",
        ascension: "none",
        rng: () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296),
        allocateId: () => "equip-a",
      });
      if (p.rolledStats.colonistCapacity !== undefined) {
        found = true;
        // A standard piece rolls exactly two affixes, which split the affix share evenly.
        const points = Math.round(budgetShares(computeBudget(10, 0, rarityIndex("standard"))).affixShare / 2);
        expect(p.rolledStats.colonistCapacity).toBe(points * GUEST_QUARTERS_PER_POINT);
      }
    }
    expect(found, "some seed rolls the guest affix").toBe(true);
  });

  it("the craft preview shows the Guest Wing's signature in berths, the same number the mint stores", () => {
    const bp = {
      key: "guestWingPreviewBp",
      label: "Guest Wing Blueprint",
      tier: 1,
      researchDurationTicks: 1,
      researchCreditCost: 1,
      craftDurationTicks: 1,
      recipe: { inputs: {} },
      equipmentOutput: { slotType: "quarters", varietyKey: "quartersGuestWing" },
    } as unknown as BlueprintDef;
    const preview = previewCraftOutcome(bp, { craftingLevel: 10 })!;
    const minted = generateEquipment({ slotType: "quarters", varietyKey: "quartersGuestWing", blueprintKey: null, iLevel: preview.iLevel, quality: 0, rarity: "standard", ascension: "none", rng: () => 0.5, allocateId: () => "x" });
    expect(preview.implicit).toEqual([expect.objectContaining({ stat: "colonistCapacity", min: minted.implicitStats.colonistCapacity })]);
    expect(preview.affixPool).toContain("colonistCapacity");
  });

  it("General perk: a quarters module on a General hull multiplies the whole guest quarters by (1 + perk), in whole berths", () => {
    expect(GENERAL_QUARTERS_GUEST_PERK).toBe(0.1);
    expect(SHIP_TYPES.generalFreighter.spec).toBe("general");
    // Bare: no module, no perk.
    expect(shipDerivedStats(hull("generalFreighter")).colonistCapacity).toBe(20);
    // A module with no guest line still carries the perk (20 x 1.1).
    expect(shipDerivedStats(hull("generalFreighter"), [quarters(0)]).colonistCapacity).toBe(22);
    // With a guest line: (20 + 30) x 1.1.
    expect(shipDerivedStats(hull("generalFreighter"), [quarters(30)]).colonistCapacity).toBe(55);
    // Rounded to whole berths: (20 + 3) x 1.1 = 25.3 -> 25.
    expect(shipDerivedStats(hull("generalFreighter"), [quarters(3)]).colonistCapacity).toBe(25);
    // A non-General hull never gets it.
    expect(shipDerivedStats(hull("orion"), [quarters(0)]).colonistCapacity).toBe(40);
    // A non-quarters piece does not trigger it.
    const cargo: EquipmentInstance = { ...quarters(0), slotType: "cargoBay" };
    expect(shipDerivedStats(hull("generalFreighter"), [cargo]).colonistCapacity).toBe(20);
  });
});

describe("G1-1 guest quarters: guests are not crew and not cargo", () => {
  it("guest lines never move the crew capacity a quarters module grants", () => {
    const base = installPiece(on("orion"), { slotType: "quarters", moduleVariant: "quartersGuestWing" });
    const loaded = installPiece(on("orion"), { slotType: "quarters", moduleVariant: "quartersGuestWing", implicitStats: { colonistCapacity: 999 }, rolledStats: { colonistCapacity: 999 } });
    expect(quartersCapacityBonus(base, base.ships[0])).toBe(GUEST_WING_CREW_CAPACITY);
    expect(quartersCapacityBonus(loaded, loaded.ships[0])).toBe(GUEST_WING_CREW_CAPACITY);
    expect(getQuartersModuleById("quartersGuestWing")).toMatchObject({ kind: "general", focusBoost: 0, offBoost: 0, capacityScales: false });
  });

  it("guest berths never move the complement cap or the crew contribution", () => {
    // The Eir's 80 base berths and a Guest Wing's 999 + 999 berths of lines: the cap is the hull's command structure
    // plus the module's fixed crew capacity, and the crew map is identical with or without the guest lines.
    const empty = installPiece(on("eir"), { slotType: "quarters", moduleVariant: "quartersGuestWing" });
    const loaded = installPiece(on("eir"), { slotType: "quarters", moduleVariant: "quartersGuestWing", implicitStats: { colonistCapacity: 999 }, rolledStats: { colonistCapacity: 999 } });
    expect(effectiveShipStats(loaded, loaded.ships[0]).colonistCapacity).toBe(80 + 999 + 999);
    expect(complementTotalCap("eir", quartersCapacityBonus(loaded, loaded.ships[0]))).toBe(complementTotalCap("eir") + GUEST_WING_CREW_CAPACITY);
    expect(shipCrewContribution(loaded, loaded.ships[0])).toEqual(shipCrewContribution(empty, empty.ships[0]));
  });

  it("guest lines never stand in for the hold (cargo is unchanged), and every other stat is unchanged", () => {
    for (const k of HULLS) {
      const without = shipDerivedStats(hull(k), [quarters(0, "quartersElite")]);
      const withGuests = shipDerivedStats(hull(k), [quarters(500, "quartersElite")]);
      const { colonistCapacity: a, ...restWithout } = without;
      const { colonistCapacity: b, ...restWith } = withGuests;
      expect(restWith, k).toEqual(restWithout);
      expect((b ?? 0) - (a ?? 0), k).toBeGreaterThan(0);
    }
  });
});
