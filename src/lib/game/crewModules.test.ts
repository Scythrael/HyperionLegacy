// Crew 0.14.0 (Phase 1b) tests: the BRIDGE + CREW-QUARTERS module catalogs, their pure effect
// readers, and the wiring into the crew overlay (complement effectiveness / division focus, officer
// amplification) + the capacity bonus feeding autoCrew.
//
// Covers: catalog integrity (9 quarters + 3 bridge, ids == slot variety keys, unique); the two new
// slots generate/allow-empty correctly (generateEquipment stamps moduleVariant, no baseline); the
// effect scale; each quarters variant's effect (division focus vs general, Efficient capacity scales
// while others do not); each bridge variant's officer amplification; overlay additive-neutrality with
// no module; economy-neutrality of an installed module; and the capacity bonus feeding autoCrew/caps.

import { describe, it, expect } from "vitest";
import {
  QUARTERS_MODULES,
  BRIDGE_MODULES,
  getQuartersModuleById,
  getBridgeModuleById,
  moduleEffectScale,
  installedQuartersModule,
  installedBridgeModule,
  quartersProfessionMultiplier,
  quartersCapacityBonus,
  bridgeOfficerMultiplier,
  HULL_ROLE_SEATS,
} from "./crewModules";
import {
  freshState,
  generateStandardIssue,
  EQUIPMENT_SLOTS,
  type GameState,
  type ShipInstance,
  type EquipmentInstance,
  type CrewBucket,
  type CrewProfession,
  type SeniorStaffOfficer,
} from "./model";
import { generateEquipment } from "./itemgen";
import { shipCrewContribution, effectiveShipStats } from "./crewOverlay";
import { CREW_STAT_KEYS } from "./crewBuffs";
import { complementTotalCap, CREW_PROFESSIONS } from "./commandStructure";
import { autoCrewShip } from "./autoCrew";
import { totalCrew } from "./crew";

// --- fixture builders --------------------------------------------------------

function moduleInstance(
  slotType: "bridge" | "quarters",
  moduleVariant: string,
  overrides: Partial<EquipmentInstance> = {},
): EquipmentInstance {
  return {
    id: `equip-${slotType}-mod`,
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
    durabilityMax: 110,
    fittedToShipId: "ship-1",
    moduleVariant,
    ...overrides,
  };
}

function withModule(s: GameState, piece: EquipmentInstance): GameState {
  return { ...s, equipment: [...s.equipment, piece] };
}

function staffShip(s: GameState, shipId: string, buckets: CrewBucket[]): GameState {
  return {
    ...s,
    ships: s.ships.map((sh) => (sh.id === shipId ? { ...sh, complement: { buckets, mode: "passive" as const } } : sh)),
  };
}

function bucket(profession: CrewProfession, buff1Id: string, count: number, rank: CrewBucket["rank"] = 1): CrewBucket {
  // A Belter crew (its racial acts only on a carrier's patrol drone screen; the Spacer, the CP-2 choice, lifts the
  // transit speed since 0.14.0), so the race lifts nothing the module tests measure. (The Earth-born racial is Crew
  // Effectiveness, which lifts every other complement buff since CP-2.)
  return { profession, rarity: "standard", rank, race: "belter", buff1Id, buff2Id: null, count };
}

function officer(overrides: Partial<SeniorStaffOfficer> = {}): SeniorStaffOfficer {
  return {
    id: "officer-1",
    seat: "operations",
    name: "Test Officer",
    race: "earthBorn",
    gender: "nonbinary",
    rank: "ensign", // rank factor 1.0
    bonuses: [
      { id: "ops.cargoExpand", magnitude: 0.08 }, // officer.effectiveCargoMult -> crew.effectiveCargo
      { id: "ops.unloadSurge", magnitude: 0.1 }, // officer.unloadTimeCut -> crew.unloadSpeed
    ],
    missionsCompleted: 0,
    assignedShipId: "ship-1",
    ...overrides,
  };
}

const ship1 = (s: GameState): ShipInstance => s.ships.find((sh) => sh.id === "ship-1")!;

// ============================================================================
describe("module catalogs", () => {
  it("QUARTERS_MODULES has 10 (6 division + 3 general + the G1-1 Guest Wing), ids unique and == the quarters slot varieties", () => {
    expect(QUARTERS_MODULES).toHaveLength(10);
    const divisions = QUARTERS_MODULES.filter((m) => m.kind === "division");
    const general = QUARTERS_MODULES.filter((m) => m.kind === "general");
    expect(divisions).toHaveLength(6);
    expect(general).toHaveLength(4);
    // One division module per complement profession.
    expect(divisions.map((m) => m.division).sort()).toEqual([...CREW_PROFESSIONS].sort());
    // Exactly one Efficient module scales its capacity; no other does.
    expect(QUARTERS_MODULES.filter((m) => m.capacityScales)).toHaveLength(1);
    expect(getQuartersModuleById("quartersEfficient")?.capacityScales).toBe(true);
    // Ids line up with the slot's variety keys (the generation path relies on this).
    const varietyKeys = EQUIPMENT_SLOTS.quarters.varieties.map((v) => v.key).sort();
    expect(QUARTERS_MODULES.map((m) => m.id).sort()).toEqual(varietyKeys);
  });

  it("BRIDGE_MODULES has 3 (balanced/focused/flag), ids unique and == the bridge slot varieties", () => {
    expect(BRIDGE_MODULES).toHaveLength(3);
    expect(BRIDGE_MODULES.map((m) => m.kind).sort()).toEqual(["balanced", "flag", "focused"]);
    const varietyKeys = EQUIPMENT_SLOTS.bridge.varieties.map((v) => v.key).sort();
    expect(BRIDGE_MODULES.map((m) => m.id).sort()).toEqual(varietyKeys);
  });

  it("HULL_ROLE_SEATS covers every ship spec", () => {
    for (const spec of ["general", "prospector", "tactician", "explorer"] as const) {
      expect(HULL_ROLE_SEATS[spec].length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
describe("moduleEffectScale", () => {
  it("is 1.0 at standard/quality-0 (catalog magnitude used as-is)", () => {
    expect(moduleEffectScale("standard", 0)).toBeCloseTo(1.0, 9);
  });

  it("rises with rarity and with quality (monotonic)", () => {
    expect(moduleEffectScale("stellar", 0)).toBeGreaterThan(moduleEffectScale("standard", 0));
    expect(moduleEffectScale("standard", 5)).toBeGreaterThan(moduleEffectScale("standard", 0));
    expect(moduleEffectScale("radiant", 5)).toBeGreaterThan(moduleEffectScale("stellar", 0));
  });
});

// ============================================================================
describe("the two new slots generate + allow-empty correctly", () => {
  it("generateEquipment mints a quarters module and stamps moduleVariant from the variety", () => {
    const piece = generateEquipment({
      slotType: "quarters",
      varietyKey: "quartersEfficient",
      blueprintKey: null,
      iLevel: 10,
      quality: 2,
      rarity: "stellar",
      ascension: "none",
      rng: () => 0.5,
      allocateId: () => "equip-1",
    });
    expect(piece.slotType).toBe("quarters");
    expect(piece.moduleVariant).toBe("quartersEfficient");
    expect(getQuartersModuleById(piece.moduleVariant!)).toBeDefined();
    // Economy-neutral physicals (a module must not drag speed / draw power).
    expect(piece.mass).toBe(0);
    expect(piece.powerDraw).toBe(0);
  });

  it("generateEquipment mints a bridge module and stamps moduleVariant", () => {
    const piece = generateEquipment({
      slotType: "bridge",
      varietyKey: "bridgeFlagCommand",
      blueprintKey: null,
      iLevel: 5,
      quality: 0,
      rarity: "standard",
      ascension: "none",
      rng: () => 0.5,
      allocateId: () => "equip-2",
    });
    expect(piece.moduleVariant).toBe("bridgeFlagCommand");
    expect(getBridgeModuleById("bridgeFlagCommand")).toBeDefined();
  });

  it("a NON-module slot leaves moduleVariant undefined", () => {
    const piece = generateEquipment({
      slotType: "cargoBay",
      varietyKey: "balancedHold",
      blueprintKey: null,
      iLevel: 5,
      quality: 0,
      rarity: "standard",
      ascension: "none",
      rng: () => 0.5,
      allocateId: () => "equip-3",
    });
    expect(piece.moduleVariant).toBeUndefined();
  });

  it("has NO Standard-Issue baseline (generateStandardIssue throws): the slots stay empty when unequipped", () => {
    expect(() => generateStandardIssue({ slotType: "quarters", fittedToShipId: null, allocateId: () => "x" })).toThrow();
    expect(() => generateStandardIssue({ slotType: "bridge", fittedToShipId: null, allocateId: () => "x" })).toThrow();
  });
});

// ============================================================================
describe("quarters module effect on the complement (via shipCrewContribution)", () => {
  // 100 Security crew (buff sec.boarding -> crew.boardingDefense, base 0.002 -> 0.2 total) +
  // 100 Engineering crew (buff eng.range -> crew.rangeEfficiency, base 0.002 -> 0.2 total).
  function stateWithMixedComplement(): GameState {
    const s = freshState();
    return staffShip(s, "ship-1", [
      bucket("security", "sec.boarding", 100),
      bucket("engineering", "eng.range", 100),
    ]);
  }

  it("no module: the rollup is the plain per-head contribution (0.2 each)", () => {
    const s = stateWithMixedComplement();
    const contrib = shipCrewContribution(s, ship1(s));
    expect(contrib[CREW_STAT_KEYS.boardingDefense]).toBeCloseTo(0.2, 9);
    expect(contrib[CREW_STAT_KEYS.rangeEfficiency]).toBeCloseTo(0.2, 9);
  });

  it("a DIVISION module boosts its own division and taxes the others", () => {
    // Security Quarters (standard/q0 -> scale 1.0): security *1.5 (focusBoost 0.5), others *0.9 (offBoost -0.1).
    const s = withModule(stateWithMixedComplement(), moduleInstance("quarters", "quartersSecurityWing"));
    const contrib = shipCrewContribution(s, ship1(s));
    expect(contrib[CREW_STAT_KEYS.boardingDefense]).toBeCloseTo(0.2 * 1.5, 9);
    expect(contrib[CREW_STAT_KEYS.rangeEfficiency]).toBeCloseTo(0.2 * 0.9, 9);
  });

  it("a GENERAL module (Utilitarian) lifts every division uniformly", () => {
    const s = withModule(stateWithMixedComplement(), moduleInstance("quarters", "quartersUtilitarian"));
    const contrib = shipCrewContribution(s, ship1(s));
    expect(contrib[CREW_STAT_KEYS.boardingDefense]).toBeCloseTo(0.2 * 1.1, 9);
    expect(contrib[CREW_STAT_KEYS.rangeEfficiency]).toBeCloseTo(0.2 * 1.1, 9);
  });

  it("Elite lifts per-head strongly; Efficient applies a small uniform penalty", () => {
    const elite = withModule(stateWithMixedComplement(), moduleInstance("quarters", "quartersElite"));
    expect(shipCrewContribution(elite, ship1(elite))[CREW_STAT_KEYS.boardingDefense]).toBeCloseTo(0.2 * 1.4, 9);
    const eff = withModule(stateWithMixedComplement(), moduleInstance("quarters", "quartersEfficient"));
    expect(shipCrewContribution(eff, ship1(eff))[CREW_STAT_KEYS.boardingDefense]).toBeCloseTo(0.2 * 0.95, 9);
  });

  it("a division module's effectiveness SCALES with rarity/quality", () => {
    const base = withModule(stateWithMixedComplement(), moduleInstance("quarters", "quartersSecurityWing"));
    const rich = withModule(
      stateWithMixedComplement(),
      moduleInstance("quarters", "quartersSecurityWing", { rarity: "stellar", quality: 5 }),
    );
    const baseVal = shipCrewContribution(base, ship1(base))[CREW_STAT_KEYS.boardingDefense];
    const richVal = shipCrewContribution(rich, ship1(rich))[CREW_STAT_KEYS.boardingDefense];
    // A richer module amplifies the focus MORE (a bigger boost above the 0.2 base).
    expect(richVal).toBeGreaterThan(baseVal);
    expect(baseVal).toBeGreaterThan(0.2);
  });
});

// ============================================================================
describe("quarters CAPACITY (only Efficient scales with rarity/quality)", () => {
  it("Efficient adds capacity that SCALES with rarity/quality", () => {
    const s = freshState();
    const std = withModule(s, moduleInstance("quarters", "quartersEfficient"));
    const rich = withModule(s, moduleInstance("quarters", "quartersEfficient", { rarity: "stellar", quality: 5 }));
    const stdBonus = quartersCapacityBonus(std, ship1(std));
    const richBonus = quartersCapacityBonus(rich, ship1(rich));
    expect(stdBonus).toBeGreaterThan(0);
    expect(richBonus).toBeGreaterThan(stdBonus);
  });

  it("every OTHER module contributes a FIXED capacity (does NOT scale)", () => {
    const s = freshState();
    for (const id of ["quartersUtilitarian", "quartersSecurityWing"]) {
      const std = withModule(s, moduleInstance("quarters", id));
      const rich = withModule(s, moduleInstance("quarters", id, { rarity: "stellar", quality: 5 }));
      expect(quartersCapacityBonus(rich, ship1(rich))).toBe(quartersCapacityBonus(std, ship1(std)));
    }
    // Elite adds no capacity (fewest crew: the hull base is the floor).
    const elite = withModule(s, moduleInstance("quarters", "quartersElite"));
    expect(quartersCapacityBonus(elite, ship1(elite))).toBe(0);
  });

  it("no quarters module -> zero capacity bonus", () => {
    const s = freshState();
    expect(quartersCapacityBonus(s, ship1(s))).toBe(0);
  });
});

// ============================================================================
describe("bridge module effect on officers (via shipCrewContribution)", () => {
  it("Balanced Command lifts an assigned officer's output uniformly", () => {
    // ship-1 is a generalFreighter (spec general). Operations officer, ops.cargoExpand -> effectiveCargo 0.08.
    const s = withModule({ ...freshState(), officers: [officer()] }, moduleInstance("bridge", "bridgeBalancedCommand"));
    const contrib = shipCrewContribution(s, ship1(s));
    expect(contrib[CREW_STAT_KEYS.effectiveCargo]).toBeCloseTo(0.08 * 1.1, 9); // amp 0.1 at scale 1.0
  });

  it("Focused Command lifts a HULL-ROLE-matched officer but NOT an unmatched one", () => {
    // general hull matches [operations, pilot, executive]. An operations officer is matched.
    const matched = withModule({ ...freshState(), officers: [officer({ seat: "operations" })] }, moduleInstance("bridge", "bridgeFocusedCommand"));
    expect(shipCrewContribution(matched, ship1(matched))[CREW_STAT_KEYS.effectiveCargo]).toBeCloseTo(0.08 * 1.3, 9);
    // A science officer (with the same bonus, for isolation) is NOT matched -> no lift.
    const unmatched = withModule(
      { ...freshState(), officers: [officer({ seat: "science" })] },
      moduleInstance("bridge", "bridgeFocusedCommand"),
    );
    expect(shipCrewContribution(unmatched, ship1(unmatched))[CREW_STAT_KEYS.effectiveCargo]).toBeCloseTo(0.08, 9);
  });

  it("Flag Command amplifies a higher-rank officer MORE than a lower-rank one", () => {
    const ensign = withModule({ ...freshState(), officers: [officer({ rank: "ensign" })] }, moduleInstance("bridge", "bridgeFlagCommand"));
    const commander = withModule({ ...freshState(), officers: [officer({ rank: "commander" })] }, moduleInstance("bridge", "bridgeFlagCommand"));
    const ensignVal = shipCrewContribution(ensign, ship1(ensign))[CREW_STAT_KEYS.effectiveCargo];
    const commanderVal = shipCrewContribution(commander, ship1(commander))[CREW_STAT_KEYS.effectiveCargo];
    expect(commanderVal).toBeGreaterThan(ensignVal);
    expect(ensignVal).toBeGreaterThan(0.08); // still a lift over the un-amplified 0.08
  });

  it("bridge amplification scales with the module's rarity/quality", () => {
    const std = withModule({ ...freshState(), officers: [officer()] }, moduleInstance("bridge", "bridgeBalancedCommand"));
    const rich = withModule(
      { ...freshState(), officers: [officer()] },
      moduleInstance("bridge", "bridgeBalancedCommand", { rarity: "stellar", quality: 5 }),
    );
    expect(shipCrewContribution(rich, ship1(rich))[CREW_STAT_KEYS.effectiveCargo]).toBeGreaterThan(
      shipCrewContribution(std, ship1(std))[CREW_STAT_KEYS.effectiveCargo],
    );
  });
});

// ============================================================================
describe("additive-neutrality + economy-neutrality", () => {
  it("no module -> shipCrewContribution is identical to the pre-module rollup", () => {
    const staffed = staffShip(freshState(), "ship-1", [bucket("security", "sec.boarding", 100)]);
    const contrib = shipCrewContribution(staffed, ship1(staffed));
    // Exactly the plain per-head value, no module scaling.
    expect(contrib[CREW_STAT_KEYS.boardingDefense]).toBeCloseTo(0.2, 9);
  });

  it("an installed module with NO crew leaves effectiveShipStats byte-identical to the bare fold", () => {
    const s = freshState();
    const ship = ship1(s);
    const bare = effectiveShipStats(s, ship);
    // Fit a REAL generated quarters module (with budget-derived stat lines) but keep the complement empty.
    const gen = generateEquipment({
      slotType: "quarters",
      varietyKey: "quartersEfficient",
      blueprintKey: null,
      iLevel: 20,
      quality: 5,
      rarity: "stellar",
      ascension: "none",
      rng: () => 0.5,
      allocateId: () => "equip-mod",
    });
    const withMod = withModule(s, { ...gen, fittedToShipId: "ship-1" });
    // No crew + no officers -> crew map empty -> overlay is a no-op; module stat lines are unfolded
    // and its mass is 0, so the economy fold is unchanged too.
    // G1-1 (named move): guest quarters is the one quarters line that folds, and a quarters module on a General
    // hull carries the General quarters perk, so ONLY colonistCapacity moves (the Freighter's 20 base berths plus
    // any guest affix, times 1.1); every other stat is byte-identical.
    const { colonistCapacity: guestsWith, ...restWith } = effectiveShipStats(withMod, ship1(withMod));
    const { colonistCapacity: guestsBare, ...restBare } = bare;
    expect(restWith).toEqual(restBare);
    expect(guestsBare).toBe(20);
    expect(guestsWith).toBe(Math.round((20 + (gen.rolledStats.colonistCapacity ?? 0)) * 1.1));
  });
});

// ============================================================================
describe("quarters capacity bonus feeds autoCrew + the cap readers", () => {
  it("raises complementTotalCap by the bonus", () => {
    const s = freshState();
    const ship = ship1(s);
    const eff = withModule(s, moduleInstance("quarters", "quartersEfficient"));
    const bonus = quartersCapacityBonus(eff, ship1(eff));
    expect(complementTotalCap(ship.typeKey, bonus)).toBe(complementTotalCap(ship.typeKey, 0) + bonus);
  });

  it("lets autoCrew fill berths that the base total cap would refuse", () => {
    // Fill the general-freighter complement to its exact base TOTAL cap, leaving the OPERATIONS
    // division one seat short, so the TOTAL cap (not the division cap) is the binding constraint.
    const s = freshState();
    const ship = ship1(s);
    const hull = ship.typeKey; // generalFreighter (spec general)
    // General hull division caps (round(30 * weight)): operations 9, flightDeck 8, engineering 5,
    // security 3, science 3, medical 3 -> total headcount 30 == the base total cap, operations at 8/9.
    const prefill: CrewBucket[] = [
      bucket("operations", "ops.unloadSpeed", 8),
      bucket("flightDeck", "flight.transitOut", 8),
      bucket("engineering", "eng.range", 5),
      bucket("security", "sec.boarding", 3),
      bucket("science", "sci.extraction", 3),
      bucket("medical", "med.effectiveness", 3),
    ];
    const baseTotal = complementTotalCap(hull, 0);
    expect(totalCrew(prefill)).toBe(baseTotal); // saturated at the base total
    const complement = { buckets: prefill, mode: "passive" as const };
    // A pool of extra OPERATIONS crew (the under-filled division).
    const pool: CrewBucket[] = [bucket("operations", "ops.unloadSpeed", 50)];

    // WITHOUT the bonus, the total cap is full -> auto-crew adds nothing.
    const noBonus = autoCrewShip(pool, hull, complement, 0);
    expect(totalCrew(noBonus.complement.buckets)).toBe(baseTotal);

    // WITH an Efficient module's capacity bonus, the raised total cap lets operations fill its
    // remaining seat.
    const eff = withModule(s, moduleInstance("quarters", "quartersEfficient"));
    const bonus = quartersCapacityBonus(eff, ship);
    expect(bonus).toBeGreaterThan(0);
    const withBonus = autoCrewShip(pool, hull, complement, bonus);
    expect(totalCrew(withBonus.complement.buckets)).toBeGreaterThan(baseTotal);
  });
});
