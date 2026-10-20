// E-CREW Task 7: away-team MEMBER gear on the ship-system gear engine (design D3/D4, sections 4 and 5.4).
//
// Covers the slot-type + ground-stat foundation:
//   - the four member slot types and the one named predicate (isMemberSlotType) ship-only lists filter with;
//   - the GROUND stat vocabulary (MEMBER_GROUND_STAT_KEYS), disjoint from every ship stat key and mapped
//     onto the member stats it raises (awayTeam.ts GROUND_STAT_MEMBER_STAT);
//   - SHIP NEUTRALITY: member gear never folds into ShipDerivedStats, whether it is spare, worn by a member,
//     or (defensively) handed straight to the fold, and ship-only lists (ship install gate, Armory loadout
//     slots, the Quartermaster's ship requisition rows) never offer it.
// And the catalog + blueprints:
//   - the mockup names exactly, per slot; every variety's teamTypes non-empty and never "prospecting";
//     tool planetTypes / encounterBias and the implant team split + unique-equipped as authored;
//   - exactly one blueprint per member variety (the blueprint mints into that variety's slot), existing
//     producible inputs only, Neural Backup discovery-gated by the Heart of the Archive with 1 Intact Data Core;
//   - generateEquipment and the Fabricator blank + inspect path mint every member variety with ground lines
//     only, stamped with its variety.
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  BLUEPRINTS,
  EQUIPMENT_SLOTS,
  ITEMS,
  REFINE_RECIPES,
  RESEARCH_FACILITY_KEY,
  AWAY_TEAM_TYPES,
  PRODUCIBLE_EQUIPMENT_RARITIES,
  blueprintRelicLocked,
  blueprintKind,
  memberVariety,
  pieceVarietyDef,
  type MemberVarietyDef,
  equipmentStatMods,
  shipDerivedStats,
  isMemberSlotType,
  MEMBER_SLOT_TYPES,
  MEMBER_GROUND_STAT_KEYS,
  LIVE_STAT_KEYS,
  RESERVED_STAT_KEYS,
  SHIP_TYPES,
  SLOT_BASE_PHYSICALS,
  type EquipmentInstance,
  type EquipmentSlotType,
  type GameState,
  type ShipTypeKey,
} from "./model";
import { effectiveShipStats } from "./crewOverlay";
import { canFitEquipment } from "./equipment";
import { loadoutSlotDefsForShipType } from "./armory";
import { REQUISITION_CATALOGUE, REQUISITION_ENTRIES } from "./quartermaster";
import { GROUND_STAT_MEMBER_STAT } from "./awayTeam";
import { PROSPECTING_BLUEPRINTS } from "./prospecting";
import { FIELD_KITS_HIDDEN_BLUEPRINTS } from "./model";
import { generateEquipment } from "./itemgen";
import { canResearch, inspectBlank } from "./tick";
import { PLANET_TYPES } from "./expeditionContent";
import { getRelicById } from "./relics";

// Every ship slot type (the union minus the four member slots), listed by hand so a new member slot
// that is NOT registered in MEMBER_SLOT_TYPES fails the partition test below.
const SHIP_SLOT_TYPES: EquipmentSlotType[] = [
  "cargoBay", "ftlDrive", "reactorCore", "specUtility",
  "shieldEmitters", "hullPlating", "weapon", "droneBay",
  "bridge", "quarters", "thrusters", "sensor", "propellantTanks",
];

// A minimal piece; overrides set the fields under test.
function piece(overrides: Partial<EquipmentInstance> = {}): EquipmentInstance {
  return {
    id: "equip-m1",
    slotType: "memberWeapon",
    rarity: "radiant",
    ascension: "none",
    quality: 5,
    iLevel: 40,
    blueprintKey: null,
    implicitStats: {},
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    durability: 100,
    fittedToShipId: null,
    ...overrides,
  };
}

// A member piece carrying EVERY ground line at a large magnitude, the worst case for a leak.
function loudMemberPiece(id: string, slotType: EquipmentSlotType, overrides: Partial<EquipmentInstance> = {}): EquipmentInstance {
  const lines: Record<string, number> = {};
  for (const k of MEMBER_GROUND_STAT_KEYS) lines[k] = 99;
  return piece({ id, slotType, implicitStats: { ...lines }, rolledStats: { ...lines }, ...overrides });
}

describe("member slot types", () => {
  it("MEMBER_SLOT_TYPES is exactly the four member slots", () => {
    expect([...MEMBER_SLOT_TYPES].sort()).toEqual(["implant", "memberArmor", "memberTool", "memberWeapon"]);
  });

  it("isMemberSlotType is true for the member slots and false for every ship slot", () => {
    for (const t of MEMBER_SLOT_TYPES) expect(isMemberSlotType(t), t).toBe(true);
    for (const t of SHIP_SLOT_TYPES) expect(isMemberSlotType(t), t).toBe(false);
    expect(isMemberSlotType("not-a-slot")).toBe(false);
  });

  it("member slots carry no ship mass or reactor draw", () => {
    for (const t of MEMBER_SLOT_TYPES) {
      const base = SLOT_BASE_PHYSICALS[t as keyof typeof SLOT_BASE_PHYSICALS];
      expect(base, t).toBeDefined();
      expect(base.mass, t).toBe(0);
      expect(base.powerDraw, t).toBe(0);
      expect(base.durability, t).toBeGreaterThan(0);
    }
  });
});

describe("ground stat vocabulary", () => {
  it("is ground-prefixed, duplicate-free, and disjoint from the LIVE and RESERVED ship vocabularies", () => {
    const live = new Set<string>(LIVE_STAT_KEYS);
    const reserved = new Set<string>(RESERVED_STAT_KEYS);
    expect(new Set(MEMBER_GROUND_STAT_KEYS).size).toBe(MEMBER_GROUND_STAT_KEYS.length);
    for (const k of MEMBER_GROUND_STAT_KEYS) {
      expect(k.startsWith("ground"), k).toBe(true);
      expect(live.has(k), `${k} is not a ship LIVE key`).toBe(false);
      expect(reserved.has(k), `${k} is not a ship RESERVED key`).toBe(false);
    }
  });

  it("every ground key maps to a member stat (or an explicit null) for the member-power task", () => {
    expect(Object.keys(GROUND_STAT_MEMBER_STAT).sort()).toEqual([...MEMBER_GROUND_STAT_KEYS].sort());
    expect(GROUND_STAT_MEMBER_STAT.groundPower).toBe("power");
    expect(GROUND_STAT_MEMBER_STAT.groundHazardResist).toBe("hazardResist");
    expect(GROUND_STAT_MEMBER_STAT.groundOrganicsYield).toBeNull();
  });
});

describe("ship neutrality: member gear never folds into ShipDerivedStats", () => {
  it("equipmentStatMods ignores every ground line", () => {
    const pieces = MEMBER_SLOT_TYPES.map((t, i) => loudMemberPiece(`m${i}`, t));
    expect(equipmentStatMods(pieces)).toEqual(equipmentStatMods([]));
  });

  it("shipDerivedStats is byte-identical with member pieces added to a real ship fold", () => {
    const s = freshState();
    const ship = s.ships[0];
    // A real crafted cargo piece puts the fold on its non-fast path.
    const cargo = piece({ id: "cargo-1", slotType: "cargoBay", implicitStats: { cargoCapacity: 12 }, mass: 4, powerDraw: 2, fittedToShipId: ship.id });
    const members = MEMBER_SLOT_TYPES.map((t, i) => loudMemberPiece(`m${i}`, t));
    expect(JSON.stringify(shipDerivedStats(ship, [cargo, ...members]))).toBe(JSON.stringify(shipDerivedStats(ship, [cargo])));
    // And member pieces ALONE fold to the bare hull.
    expect(JSON.stringify(shipDerivedStats(ship, members))).toBe(JSON.stringify(shipDerivedStats(ship, [])));
  });

  it("effectiveShipStats is byte-identical whether member gear sits in storage or is worn by a member", () => {
    const base = freshState();
    const ship = base.ships[0];
    const cargo = piece({ id: "cargo-1", slotType: "cargoBay", implicitStats: { cargoCapacity: 12 }, mass: 4, fittedToShipId: ship.id });
    const without: GameState = { ...base, equipment: [...base.equipment, cargo] };
    const spare = loudMemberPiece("m-spare", "memberArmor");
    const worn = loudMemberPiece("m-worn", "implant", { fittedToMemberId: "member-1" });
    const withGear: GameState = { ...without, equipment: [...without.equipment, spare, worn] };
    for (const sh of withGear.ships) {
      expect(JSON.stringify(effectiveShipStats(withGear, sh))).toBe(JSON.stringify(effectiveShipStats(without, sh)));
    }
  });

  it("even a worn member piece with a STRAY fittedToShipId on the ship leaves its stats byte-identical (fold-side guard)", () => {
    const base = freshState();
    const ship = base.ships[0];
    const cargo = piece({ id: "cargo-1", slotType: "cargoBay", implicitStats: { cargoCapacity: 12 }, mass: 4, fittedToShipId: ship.id });
    const without: GameState = { ...base, equipment: [...base.equipment, cargo] };
    // A corrupt record: worn by a member AND pointing at the ship, so equippedFor hands it to the fold.
    const stray = MEMBER_SLOT_TYPES.map((t, i) => loudMemberPiece(`m-stray-${i}`, t, { fittedToMemberId: "member-1", fittedToShipId: ship.id }));
    const withStray: GameState = { ...without, equipment: [...without.equipment, ...stray] };
    expect(JSON.stringify(effectiveShipStats(withStray, ship))).toBe(JSON.stringify(effectiveShipStats(without, ship)));
  });
});

describe("ship-only lists never offer member gear", () => {
  it("canFitEquipment refuses a member piece on a ship (slotNotInstallable)", () => {
    const s = freshState();
    const ship = s.ships[0];
    for (const t of MEMBER_SLOT_TYPES) {
      const p = piece({ id: `m-${t}`, slotType: t });
      const state: GameState = { ...s, equipment: [...s.equipment, p] };
      expect(canFitEquipment(state, ship.id, p.id), t).toEqual({ ok: false, reason: "slotNotInstallable" });
    }
  });

  it("no hull's Armory loadout board lists a member slot", () => {
    for (const typeKey of Object.keys(SHIP_TYPES) as ShipTypeKey[]) {
      for (const def of loadoutSlotDefsForShipType(typeKey)) {
        expect(isMemberSlotType(def.slotType), `${typeKey}/${def.key}`).toBe(false);
      }
    }
  });

  it("the requisition catalogue keys partition EXACTLY into the ship slots + the member slots", () => {
    expect(Object.keys(REQUISITION_CATALOGUE).sort()).toEqual([...SHIP_SLOT_TYPES, ...MEMBER_SLOT_TYPES].sort());
  });

  it("a SHIP Quartermaster row never issues member gear; member rows always name a squad (E-CREW Task 9)", () => {
    // Task 9 gave the member slots per-squad floors, so member rows now exist; what must hold is the
    // separation: a ship row (teamType null) is never a member slot, and a member row always names a squad.
    for (const entry of REQUISITION_ENTRIES) {
      expect(isMemberSlotType(entry.slotType), entry.key).toBe(entry.teamType !== null);
    }
  });
});

// ============================================================================
// Catalog (design section 5.4, names exactly as the user-approved mockup)
// ============================================================================

// The Prospecting names (hidden squads design 2026-10-16 section 5, kept by the user) trail each slot.
const MEMBER_CATALOG: Record<string, string[]> = {
  memberWeapon: ["Pulse Rifle", "Scattergun", "Shock Baton", "Sidearm", "Plasma Cutter", "Rock Breaker", "Sampling Lance"],
  memberArmor: ["Ballistic Weave", "Assault Hardsuit", "Field Suit", "Hazard Suit", "Excavator Suit"],
  memberTool: [
    // Field Kits FKR-5: the user-named Impact Grenade (FK11) after the two specialized grenades.
    "Stun Grenade", "Toxin Grenade", "Impact Grenade", "Med Kit", "Shroud Emitter", "Lure Beacon",
    "Flora Scanner", "Thermal Rig", "Core Drill", "Decryptor", "Atmo Probe",
    "Assay Scanner", "Seismic Mapper",
  ],
  implant: [
    "Dermal Weave", "Reflex Booster", "Targeting Optic", "Adrenal Surge", "Med-Nanite Swarm",
    "Toxin Filters", "Cortex Shield", "Neural Backup",
    "Synaptic Accelerator", "Archaeo-Scanner", "Environmental Adaptation", "Cipher Wetware", "Bio-Analyzer",
    "Ore-Sense Optic", "Myo-Lift Frame",
  ],
};

// Every member variety as (slotType, variety), through the typed accessor (member traits non-optional).
const MEMBER_VARIETIES: { slotType: EquipmentSlotType; v: MemberVarietyDef }[] = MEMBER_SLOT_TYPES.flatMap((slotType) =>
  EQUIPMENT_SLOTS[slotType].varieties.map((raw) => {
    const v = memberVariety(slotType, raw.key);
    if (v === undefined) throw new Error(`${slotType}/${raw.key} has no member traits`);
    return { slotType, v };
  }),
);
const variety = (slotType: string, key: string): MemberVarietyDef => {
  const v = memberVariety(slotType, key);
  if (v === undefined) throw new Error(`no member variety ${slotType}/${key}`);
  return v;
};

describe("member gear catalog", () => {
  it("each member slot carries exactly the mockup names, in order", () => {
    for (const slotType of MEMBER_SLOT_TYPES) {
      expect(EQUIPMENT_SLOTS[slotType].varieties.map((v) => v.label), slotType).toEqual(MEMBER_CATALOG[slotType]);
    }
  });

  it("member slot labels never collide with a ship slot label on shared surfaces", () => {
    expect(EQUIPMENT_SLOTS.memberArmor.label).toBe("Away-Team Armor");
    expect(EQUIPMENT_SLOTS.memberWeapon.label).toBe("Away-Team Weapon");
    expect(EQUIPMENT_SLOTS.memberTool.label).toBe("Away-Team Tool");
    expect(EQUIPMENT_SLOTS.implant.label).toBe("Implant");
    const shipLabels = new Set(Object.entries(EQUIPMENT_SLOTS).filter(([k]) => !isMemberSlotType(k)).map(([, slot]) => slot.label));
    for (const t of MEMBER_SLOT_TYPES) expect(shipLabels.has(EQUIPMENT_SLOTS[t].label), t).toBe(false);
  });

  it("variety keys are unique across the WHOLE slot table (blueprints are keyed <varietyKey>Bp)", () => {
    const keys = Object.values(EQUIPMENT_SLOTS).flatMap((slot) => slot.varieties.map((v) => v.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every member variety carries member traits with a non-empty teamTypes of real team types; Prospecting wears only its own eight plus the two shared hazard pieces", () => {
    const prospecting: string[] = [];
    for (const { slotType, v } of MEMBER_VARIETIES) {
      const teams = v.member.teamTypes;
      expect(teams.length, `${slotType}/${v.key}`).toBeGreaterThan(0);
      for (const t of teams) expect(AWAY_TEAM_TYPES, `${slotType}/${v.key}`).toContain(t);
      if (teams.includes("prospecting")) prospecting.push(v.key);
    }
    expect(prospecting.sort()).toEqual(
      [
        "plasmaCutter", "rockBreaker", "samplingLance", "hazardSuit", "excavatorSuit",
        "assayScanner", "seismicMapper", "environmentalAdaptation", "oreSenseOptic", "myoLiftFrame",
      ].sort(),
    );
  });

  it("no SHIP variety carries member traits, and memberVariety refuses ship slots and unknown keys", () => {
    for (const [slotType, slot] of Object.entries(EQUIPMENT_SLOTS)) {
      if (isMemberSlotType(slotType)) continue;
      for (const v of slot.varieties) {
        expect(v.member, `${slotType}/${v.key}`).toBeUndefined();
        expect(memberVariety(slotType, v.key), `${slotType}/${v.key}`).toBeUndefined();
      }
    }
    expect(memberVariety("memberWeapon", "noSuchGun")).toBeUndefined();
  });

  it("weapons: Security long / short / short, Science Sidearm; Scattergun hits a group, Shock Baton stuns", () => {
    expect(variety("memberWeapon", "pulseRifle").member).toEqual({ teamTypes: ["security"], weaponRange: "long" });
    expect(variety("memberWeapon", "scattergun").member).toEqual({ teamTypes: ["security"], weaponRange: "short", groundEffect: { kind: "groupHit" } });
    expect(variety("memberWeapon", "shockBaton").member).toEqual({
      teamTypes: ["security"],
      weaponRange: "short",
      groundEffect: { kind: "inflict", status: "stun" },
    });
    expect(variety("memberWeapon", "sidearm").member.teamTypes).toEqual(["science"]);
  });

  it("armor: two Security, two Science (the Hazard Suit shared with Prospecting), one Prospecting; the Hazard Suit's signature is hazard resist", () => {
    expect(variety("memberArmor", "ballisticWeave").member.teamTypes).toEqual(["security"]);
    expect(variety("memberArmor", "assaultHardsuit").member.teamTypes).toEqual(["security"]);
    expect(variety("memberArmor", "fieldSuit").member.teamTypes).toEqual(["science"]);
    const hazard = variety("memberArmor", "hazardSuit");
    expect(hazard.member.teamTypes).toEqual(["science", "prospecting"]);
    expect(hazard.implicitStats).toEqual(["groundHazardResist"]);
    expect(variety("memberArmor", "excavatorSuit").member.teamTypes).toEqual(["prospecting"]);
  });

  it("tools: the encounter dial (Shroud -0.4, Lure +0.4) is Security-only; Science tools are planet-tuned as authored", () => {
    expect(variety("memberTool", "shroudEmitter").member).toEqual({ teamTypes: ["security"], encounterBias: -0.4 });
    expect(variety("memberTool", "lureBeacon").member).toEqual({ teamTypes: ["security"], encounterBias: 0.4 });
    for (const key of ["stunGrenade", "toxinGrenade", "medKit"]) expect(variety("memberTool", key).member.teamTypes).toEqual(["security"]);
    // Only the two dial tools carry a bias.
    const biased = MEMBER_VARIETIES.filter(({ v }) => v.member.encounterBias !== undefined).map(({ v }) => v.key);
    expect(biased.sort()).toEqual(["lureBeacon", "shroudEmitter"]);
    const PLANETS: Record<string, string[] | undefined> = {
      floraScanner: ["terrestrial", "ocean", "toxic"],
      thermalRig: ["volcanic", "frozen"],
      coreDrill: ["arid", "barren"],
      decryptor: undefined, // any body
      atmoProbe: ["gasGiant"],
    };
    const realPlanets = new Set<string>(PLANET_TYPES.map((p) => p.id));
    for (const [key, planets] of Object.entries(PLANETS)) {
      const m = variety("memberTool", key).member;
      expect(m.teamTypes, key).toEqual(["science"]);
      expect(m.planetTypes === undefined ? undefined : [...m.planetTypes], key).toEqual(planets);
      for (const p of m.planetTypes ?? []) expect(realPlanets.has(p), `${key} ${p}`).toBe(true);
    }
    // Only Science tools are planet-tuned.
    for (const { v } of MEMBER_VARIETIES) {
      if (v.member.planetTypes !== undefined) expect(v.member.teamTypes, v.key).toEqual(["science"]);
    }
  });

  it("implants: 8 Security, 5 Science (Environmental Adaptation shared with Prospecting), 2 Prospecting; Neural Backup is the ONE unique-equipped piece", () => {
    const implants = MEMBER_VARIETIES.filter(({ slotType }) => slotType === "implant").map(({ v }) => v.member.teamTypes);
    expect(implants.filter((t) => t.length === 1 && t[0] === "security").length).toBe(8);
    expect(implants.filter((t) => t[0] === "science").length).toBe(5);
    expect(variety("implant", "environmentalAdaptation").member.teamTypes).toEqual(["science", "prospecting"]);
    expect(implants.filter((t) => t.length === 1 && t[0] === "prospecting").length).toBe(2);
    expect(implants.length).toBe(15);
    const unique = MEMBER_VARIETIES.filter(({ v }) => v.member.uniqueEquipped === true).map(({ v }) => v.key);
    expect(unique).toEqual(["neuralBackup"]);
    expect(variety("implant", "neuralBackup").member).toEqual({
      teamTypes: ["security"],
      uniqueEquipped: true,
      groundEffect: { kind: "revive", chance: 0.5, hpFraction: 0.3 },
    });
  });

  it("a groundStatusResist line only appears on gear that resists something (no dead budget)", () => {
    for (const { slotType, v } of MEMBER_VARIETIES) {
      const stats = new Set([
        ...(v.implicitStats ?? EQUIPMENT_SLOTS[slotType].implicitStats),
        ...(v.affixPool ?? EQUIPMENT_SLOTS[slotType].affixPool).map((a) => a.stat),
      ]);
      if (stats.has("groundStatusResist")) expect(v.member.groundEffect?.kind, `${slotType}/${v.key}`).toBe("resistStatus");
    }
  });

  it("each variety's statRatios cover exactly its affix pool and sum to ~1 (so the variety bias is coherent)", () => {
    for (const { slotType, v } of MEMBER_VARIETIES) {
      const pool = (v.affixPool ?? EQUIPMENT_SLOTS[slotType].affixPool).map((a) => a.stat).sort();
      expect(Object.keys(v.statRatios).sort(), `${slotType}/${v.key}`).toEqual(pool);
      const sum = Object.values(v.statRatios).reduce((a, b) => a + b, 0);
      expect(sum, `${slotType}/${v.key}`).toBeCloseTo(1, 9);
    }
  });
});

// ============================================================================
// Blueprints
// ============================================================================

// Prospecting squads (hidden): the Prospecting-only varieties' blueprints live in prospecting.ts
// PROSPECTING_BLUEPRINTS (kept out of BLUEPRINTS until the surfaces go visible), so the catalog checks read both. Field
// Kits FKR-5: the Impact Grenade's waits in FIELD_KITS_HIDDEN_BLUEPRINTS until FIELD_KITS_PLAYER_LIVE (FKR-7), when
// BLUEPRINTS spreads it in (keyed, so it is counted once either way).
const memberBlueprints = Object.values({ ...BLUEPRINTS, ...PROSPECTING_BLUEPRINTS, ...FIELD_KITS_HIDDEN_BLUEPRINTS }).filter(
  (bp) => bp.equipmentOutput !== undefined && isMemberSlotType(bp.equipmentOutput.slotType),
);

describe("member gear blueprints", () => {
  it("every member variety has EXACTLY one blueprint, and that blueprint mints into the variety's own slot", () => {
    expect(memberBlueprints.length).toBe(MEMBER_VARIETIES.length);
    for (const { slotType, v } of MEMBER_VARIETIES) {
      const bps = memberBlueprints.filter((bp) => bp.equipmentOutput!.varietyKey === v.key);
      expect(bps.length, `${slotType}/${v.key}`).toBe(1);
      const bp = bps[0];
      expect(bp.key).toBe(`${v.key}Bp`);
      expect(bp.label).toBe(`${v.label} Blueprint`);
      expect(bp.equipmentOutput!.slotType, v.key).toBe(slotType);
      expect(blueprintKind(bp), v.key).toBe("equipment");
      expect(bp.tier, v.key).toBeGreaterThanOrEqual(1);
      expect(bp.tier, v.key).toBeLessThanOrEqual(2); // the Research Lab's ceiling
    }
  });

  it("recipes use EXISTING producible materials only (refined from the Refinery, components from the Fabricator)", () => {
    const refineOutputs = new Set<string>(Object.values(REFINE_RECIPES).map((r) => r.output.itemId));
    const componentOutputs = new Set<string>();
    for (const b of Object.values(BLUEPRINTS)) if (b.recipe.outputItem !== undefined) componentOutputs.add(b.recipe.outputItem);
    for (const bp of memberBlueprints) {
      const inputs = Object.entries(bp.recipe.inputs);
      expect(inputs.length, bp.key).toBeGreaterThan(0);
      for (const [itemId, qty] of inputs) {
        expect(ITEMS[itemId], `${bp.key} ${itemId}`).toBeDefined();
        expect(qty, `${bp.key} ${itemId}`).toBeGreaterThan(0);
        if (bp.key === "neuralBackupBp" && itemId === "intactDataCore") continue; // the relic-tier salvage exotic
        expect(refineOutputs.has(itemId) || componentOutputs.has(itemId), `${bp.key} ${itemId} is producible`).toBe(true);
      }
    }
  });

  it("only Neural Backup is discovery-gated, by the Heart of the Archive, and it consumes 1 Intact Data Core", () => {
    const gated = memberBlueprints.filter((bp) => bp.requiresRelicDiscovery !== undefined).map((bp) => bp.key);
    expect(gated).toEqual(["neuralBackupBp"]);
    const nb = BLUEPRINTS.neuralBackupBp;
    expect(nb.requiresRelicDiscovery).toBe("heartOfTheArchive");
    expect(getRelicById("heartOfTheArchive")?.label).toBe("Heart of the Archive");
    expect(nb.recipe.inputs.intactDataCore).toBe(1);
    expect(nb.equipmentOutput).toEqual({ slotType: "implant", varietyKey: "neuralBackup" });
  });

  it("Neural Backup is relic-locked (and unresearchable) until the Heart of the Archive is discovered, then open", () => {
    const s0 = freshState();
    const lab: GameState = { ...s0, credits: new Decimal(1_000_000), facilities: { ...s0.facilities, [RESEARCH_FACILITY_KEY]: { level: 2 } } };
    expect(blueprintRelicLocked(lab, "neuralBackupBp")).toBe(true);
    expect(canResearch(lab, "neuralBackupBp")).toEqual({ ok: false, reason: "undiscovered" });
    const found: GameState = { ...lab, relicDiscovered: [...(lab.relicDiscovered ?? []), "heartOfTheArchive"] };
    expect(blueprintRelicLocked(found, "neuralBackupBp")).toBe(false);
    expect(canResearch(found, "neuralBackupBp")).toEqual({ ok: true });
    // Every other member blueprint is an ordinary (ungated) research project.
    for (const bp of memberBlueprints) {
      if (bp.key !== "neuralBackupBp") expect(blueprintRelicLocked(lab, bp.key), bp.key).toBe(false);
    }
  });
});

// ============================================================================
// Generation: generateEquipment + the Fabricator blank / inspect path
// ============================================================================

describe("member gear generation", () => {
  const GROUND = new Set<string>(MEMBER_GROUND_STAT_KEYS);
  // A small deterministic stream so every rarity's affix draws are exercised.
  const seq = (seed: number) => {
    let x = seed;
    return () => {
      x = (x * 9301 + 49297) % 233280;
      return x / 233280;
    };
  };

  it("generateEquipment mints every member variety with ground lines only, stamped with its variety", () => {
    let n = 0;
    for (const { slotType, v } of MEMBER_VARIETIES) {
      for (const rarity of PRODUCIBLE_EQUIPMENT_RARITIES) {
        const p = generateEquipment({
          slotType,
          varietyKey: v.key,
          blueprintKey: `${v.key}Bp`,
          iLevel: 30,
          quality: 3,
          rarity,
          ascension: "none",
          rng: seq(n + 1),
          allocateId: () => `equip-g${n}`,
        });
        n++;
        const where = `${slotType}/${v.key}/${rarity}`;
        expect(p.slotType, where).toBe(slotType);
        expect(p.moduleVariant, where).toBe(v.key);
        expect(pieceVarietyDef(p), where).toBe(EQUIPMENT_SLOTS[slotType].varieties.find((x) => x.key === v.key));
        expect(p.rarity, where).toBe(rarity);
        expect(p.quality, where).toBe(3);
        expect(p.iLevel, where).toBe(30);
        expect(p.mass, where).toBe(0);
        expect(p.powerDraw, where).toBe(0);
        expect(p.fittedToShipId, where).toBeNull();
        expect(p.durability, where).toBe(p.durabilityMax);
        const implicitKeys = Object.keys(p.implicitStats);
        expect(implicitKeys.sort(), where).toEqual([...(v.implicitStats ?? EQUIPMENT_SLOTS[slotType].implicitStats)].sort());
        for (const k of [...implicitKeys, ...Object.keys(p.rolledStats)]) expect(GROUND.has(k), `${where} ${k}`).toBe(true);
        for (const val of Object.values(p.implicitStats)) expect(val, where).toBeGreaterThan(0);
      }
    }
  });

  it("a Fabricator blank of every member blueprint inspects into a spare piece of that variety (a hidden Prospecting one is refused)", () => {
    for (const bp of memberBlueprints) {
      const s0 = freshState();
      if (!(bp.key in BLUEPRINTS)) {
        // Hidden: kept out of BLUEPRINTS until the prospecting quests patch (or FKR-7 for the Impact Grenade), so no
        // surface can make one yet.
        const held: GameState = { ...s0, blanks: { [bp.key]: new Decimal(1) } };
        expect(inspectBlank(held, bp.key), bp.key).toBe(held);
        continue;
      }
      const s: GameState = { ...s0, blanks: { [bp.key]: new Decimal(1) } };
      const after = inspectBlank(s, bp.key);
      expect(after, bp.key).not.toBe(s);
      const minted = after.equipment[after.equipment.length - 1];
      expect(minted.blueprintKey, bp.key).toBe(bp.key);
      expect(minted.slotType, bp.key).toBe(bp.equipmentOutput!.slotType);
      expect(minted.moduleVariant, bp.key).toBe(bp.equipmentOutput!.varietyKey);
      // It lands as a free spare, and no ship can take it.
      expect(minted.fittedToShipId, bp.key).toBeNull();
      expect(canFitEquipment(after, after.ships[0].id, minted.id), bp.key).toEqual({ ok: false, reason: "slotNotInstallable" });
    }
  });
});

// ============================================================================
// pieceVarietyDef: the one "which variety is this piece" resolver
// ============================================================================

describe("pieceVarietyDef", () => {
  it("resolves a stamped piece to its catalog variety", () => {
    const p = piece({ slotType: "memberTool", moduleVariant: "floraScanner" });
    expect(pieceVarietyDef(p)).toBe(EQUIPMENT_SLOTS.memberTool.varieties.find((v) => v.key === "floraScanner"));
    const sensor = piece({ slotType: "sensor", moduleVariant: "sensorBioResonance" });
    expect(pieceVarietyDef(sensor)?.label).toBe("Bio-Resonance Array");
  });

  it("is undefined for an unstamped piece, an unknown key, or a key from another slot", () => {
    expect(pieceVarietyDef(piece({ slotType: "cargoBay" }))).toBeUndefined();
    expect(pieceVarietyDef(piece({ slotType: "memberWeapon", moduleVariant: "retiredGun" }))).toBeUndefined();
    expect(pieceVarietyDef(piece({ slotType: "memberWeapon", moduleVariant: "medKit" }))).toBeUndefined();
  });
});
