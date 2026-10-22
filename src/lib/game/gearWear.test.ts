// GEAR WEAR steps 1 and 2 (0.14.0, docs/plans/2026-10-16-gear-wear-design.md): the catalogs and the pure helpers,
// pinned against the USER ANSWERS (2026-10-16) they bind. The tick side (step 3) is gearWearEngine.test.ts.

import { describe, expect, it } from "vitest";
import {
  CONDITION_FULL,
  REPAIR_RATES,
  TOUGHNESS_REFERENCE,
  USE_WEAR_FLOOR,
  WEAR_EFFICIENCY,
  WEAR_EFFICIENCY_DEPTH,
  WEAR_SOURCES,
  applyBattleWear,
  battleWearRaw,
  pieceCondition,
  pieceStartDurability,
  pieceWearEfficiency,
  repairRatePerMinute,
  settleCondition,
  settlePiece,
  toughnessScale,
  useWear,
  useWearRaw,
  wearEfficiency,
  wearEfficiencyConsumers,
  withPieceCondition,
  type WearSlot,
} from "./gearWear";
import { EQUIPMENT_SLOTS, SLOT_BASE_PHYSICALS, freshState, type EquipmentInstance } from "./model";
import { generateEquipment } from "./itemgen";

function piece(over: Partial<EquipmentInstance> = {}): EquipmentInstance {
  return {
    id: "equip-1",
    slotType: "cargoBay",
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 1,
    blueprintKey: null,
    implicitStats: { cargoCapacity: 10 },
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: null,
    ...over,
  };
}

describe("gear wear: the user's depth (W1 0-1000 condition, W2 + W7 Gentle)", () => {
  it("condition is per-mille, use stops at 60%, a fully worn piece works at 75%", () => {
    expect(CONDITION_FULL).toBe(1000);
    expect(USE_WEAR_FLOOR).toBe(600);
    expect(WEAR_EFFICIENCY_DEPTH).toBe(0.25);
    expect(wearEfficiency(0)).toBe(0.75);
  });

  it("the efficiency curve: 100% pristine, nearly invisible when lightly worn, smooth and concave in wear", () => {
    expect(wearEfficiency(1000)).toBe(1);
    expect(wearEfficiency(900)).toBeCloseTo(0.9975, 12);
    expect(wearEfficiency(800)).toBeCloseTo(0.99, 12);
    expect(wearEfficiency(600)).toBeCloseTo(0.96, 12);
    expect(wearEfficiency(400)).toBeCloseTo(0.91, 12);
    expect(wearEfficiency(200)).toBeCloseTo(0.84, 12);
    // Monotone, and each further 100 of wear costs more than the one before (no cliff, no plateau).
    let prevDrop = -1;
    for (let c = 1000; c > 0; c -= 100) {
      const drop = wearEfficiency(c) - wearEfficiency(c - 100);
      expect(drop).toBeGreaterThan(0);
      expect(drop).toBeGreaterThan(prevDrop);
      prevDrop = drop;
    }
  });

  it("a junk stored condition reads pristine and an out-of-range one clamps (nothing can wear a piece by accident)", () => {
    expect(pieceCondition(piece())).toBe(1000);
    expect(pieceCondition(piece({ condition: Number.NaN }))).toBe(1000);
    expect(pieceCondition(piece({ condition: "x" as unknown as number }))).toBe(1000);
    expect(pieceCondition(piece({ condition: -50 }))).toBe(0);
    expect(pieceCondition(piece({ condition: 4000 }))).toBe(1000);
    expect(pieceCondition(piece({ condition: 712.9 }))).toBe(712);
    expect(pieceWearEfficiency(piece())).toBe(1);
  });
});

describe("gear wear: toughness (durabilityMax scales every wear amount)", () => {
  it("raw x 100 / durabilityMax, floored, at least 1 for a raw of at least 1", () => {
    expect(TOUGHNESS_REFERENCE).toBe(100);
    expect(toughnessScale(12, 100)).toBe(12);
    expect(toughnessScale(100, 160)).toBe(62); // plating base: 62% of the reference
    expect(toughnessScale(100, 80)).toBe(125); // member tool base: 125%
    expect(toughnessScale(100, 200)).toBe(50); // a quality-5 twin (x2 ceiling): half
    expect(toughnessScale(1, 1000)).toBe(1); // never vanishes
    expect(toughnessScale(0, 100)).toBe(0);
    expect(toughnessScale(-3, 100)).toBe(0);
    expect(toughnessScale(10, 0)).toBe(10); // a junk max reads the reference
  });

  it("a crafted piece is tougher than its Standard-Issue twin (quality lifts durabilityMax), so it wears slower", () => {
    const crafted = generateEquipment({
      slotType: "cargoBay",
      varietyKey: EQUIPMENT_SLOTS.cargoBay.varieties[0].key,
      blueprintKey: null,
      iLevel: 30,
      quality: 5,
      rarity: "augmented",
      ascension: "none",
      rng: () => 0.5,
      allocateId: () => "equip-9",
    });
    expect(crafted.durabilityMax).toBeGreaterThan(SLOT_BASE_PHYSICALS.cargoBay.durability);
    expect(useWear(120, crafted.durabilityMax, 1000)).toBeLessThan(useWear(120, SLOT_BASE_PHYSICALS.cargoBay.durability, 1000));
  });
});

describe("gear wear: use wear never goes below the use floor (user W2)", () => {
  it("full amount at full condition, shrinking with the headroom above the floor", () => {
    expect(useWear(12, 100, 1000)).toBe(12);
    expect(useWear(12, 100, 800)).toBe(6); // half the headroom left
    expect(useWear(12, 100, 610)).toBe(1); // at least 1 while there is headroom
    expect(useWear(12, 100, 600)).toBe(0);
    expect(useWear(12, 100, 300)).toBe(0); // a battered piece takes no use wear
    expect(useWear(0, 100, 1000)).toBe(0);
  });

  it("a piece in continuous use approaches the floor and never crosses it", () => {
    let c = 1000;
    for (let i = 0; i < 10_000; i++) c -= useWear(40, 100, c);
    expect(c).toBe(USE_WEAR_FLOOR);
    let tough = 1000;
    for (let i = 0; i < 10_000; i++) tough -= useWear(1, 500, tough);
    expect(tough).toBe(USE_WEAR_FLOOR);
  });

  it("a use source quotes its raw per its event units (the FTL drive per 10 ly)", () => {
    // Step 3 tune: the drive wears 2 per 10 ly (floor of 2 x 25 / 10), the hold 8 a haul.
    expect(useWearRaw("ftlDrive:distance", 25)).toBe(5);
    expect(useWearRaw("ftlDrive:distance", 24)).toBe(4);
    expect(useWearRaw("cargoBay:haul", 1)).toBe(8);
    expect(useWearRaw("cargoBay:haul", 0)).toBe(0);
    expect(useWearRaw("weapon:hitsTaken", 5)).toBe(0); // a battle source is not a use source
    expect(useWearRaw("nope", 5)).toBe(0);
  });
});

describe("gear wear: battle wear can go below the floor, down to 0, never below (never breaks)", () => {
  it("proportional to what the battle took, capped at the whole of it", () => {
    expect(battleWearRaw("hullPlating:hullLost", 50, 100)).toBe(125);
    expect(battleWearRaw("hullPlating:hullLost", 500, 100)).toBe(250);
    expect(battleWearRaw("weapon:hitsTaken", 30, 120)).toBe(250); // a pool source: the pool share lost
    expect(battleWearRaw("weapon:hitsTaken", 0, 120)).toBe(0);
    expect(battleWearRaw("cargoBay:haul", 10, 100)).toBe(0); // a use source is not a battle source
  });

  it("applyBattleWear goes below the use floor and stops at 0", () => {
    expect(applyBattleWear(700, 250)).toBe(450);
    expect(applyBattleWear(100, 999)).toBe(0);
    expect(applyBattleWear(500, 0)).toBe(500);
    expect(applyBattleWear(500, -20)).toBe(500);
  });
});

describe("gear wear: repair is automatic, free and closed form (user Free auto + paid rush, W4)", () => {
  it("faster in a Shipyard bay than at home, slow underway (crew upkeep)", () => {
    expect(REPAIR_RATES.shipyardBay).toBeGreaterThan(REPAIR_RATES.home);
    expect(REPAIR_RATES.home).toBeGreaterThan(REPAIR_RATES.underway);
    expect(REPAIR_RATES.underway).toBeGreaterThan(0);
    for (const r of Object.values(REPAIR_RATES)) expect(r).toBeGreaterThan(0);
  });

  it("the two hull repair bonuses lift every rate with the hull's own algebra", () => {
    expect(repairRatePerMinute("home")).toBe(REPAIR_RATES.home);
    expect(repairRatePerMinute("home", { officerRepairSpeed: 0.5 })).toBeCloseTo(REPAIR_RATES.home * 1.5, 12);
    expect(repairRatePerMinute("home", { damageControlRepairTime: 0.2 })).toBeCloseTo(REPAIR_RATES.home / 0.8, 12);
    expect(repairRatePerMinute("home", { damageControlRepairTime: 1 })).toBe(REPAIR_RATES.home); // no division by zero
    expect(repairRatePerMinute("home", { officerRepairSpeed: -1 })).toBe(REPAIR_RATES.home);
  });

  it("settleCondition: min(1000, c + floor(rate x elapsed / 60)); a future anchor or no rate changes nothing", () => {
    expect(settleCondition(600, 0, 60, 40)).toBe(640);
    expect(settleCondition(600, 0, 90, 40)).toBe(660);
    expect(settleCondition(990, 0, 600, 40)).toBe(1000);
    expect(settleCondition(600, 100, 50, 40)).toBe(600);
    expect(settleCondition(600, 0, 60, 0)).toBe(600);
  });

  it("settlePiece moves the anchor, and a piece back at full sheds BOTH fields (it serializes as pristine)", () => {
    const worn = withPieceCondition(piece(), 700, 1000);
    expect(worn.condition).toBe(700);
    expect(worn.conditionAt).toBe(1000);
    const later = settlePiece(worn, 1060, 40);
    expect(later.condition).toBe(740);
    expect(later.conditionAt).toBe(1060);
    const full = settlePiece(worn, 1000 + 60 * 60, 40);
    expect("condition" in full).toBe(false);
    expect("conditionAt" in full).toBe(false);
    expect(JSON.stringify(full)).toBe(JSON.stringify(piece()));
    const pristine = piece();
    expect(settlePiece(pristine, 5000, 40)).toBe(pristine); // the same reference
    expect(withPieceCondition(pristine, 1000, 5000)).toBe(pristine);
  });
});

describe("gear wear: settling keeps the leftover time (offline == live)", () => {
  // Settle a piece every `step` seconds from `t0` to `t1` (the last step lands exactly on t1).
  function settleEvery(p: EquipmentInstance, t0: number, t1: number, step: number, rate: number): EquipmentInstance {
    let out = p;
    for (let t = t0 + step; t < t1; t += step) out = settlePiece(out, t, rate);
    return settlePiece(out, t1, rate);
  }

  it("many short settles equal one long settle, at every cadence and rate", () => {
    const worn = withPieceCondition(piece(), 300, 0);
    for (const rate of Object.values(REPAIR_RATES)) {
      for (const span of [7, 59, 600, 1234, 5000]) {
        const once = settlePiece(worn, span, rate);
        for (const step of [1, 3, 7, 13, 29, 61]) {
          const many = settleEvery(worn, 0, span, step, rate);
          expect(pieceCondition(many), `rate ${rate} span ${span} step ${step}`).toBe(pieceCondition(once));
          expect(many.conditionAt, `rate ${rate} span ${span} step ${step}`).toBe(once.conditionAt);
        }
      }
    }
  });

  it("a settle cadence below one per-mille's worth of time still repairs (2 per minute underway, every 10 s)", () => {
    const worn = withPieceCondition(piece(), 600, 0);
    const after = settleEvery(worn, 0, 600, 10, REPAIR_RATES.underway);
    expect(pieceCondition(after)).toBe(600 + REPAIR_RATES.underway * 10);
    // One 10 s settle gains nothing yet and keeps the anchor (the same reference): the time is not lost.
    const tenSeconds = settlePiece(worn, 10, REPAIR_RATES.underway);
    expect(tenSeconds).toBe(worn);
  });

  it("the anchor advances only by the time the gain used; a worn piece with no anchor starts from now", () => {
    const worn = withPieceCondition(piece(), 600, 0);
    const p = settlePiece(worn, 45, 2); // 1.5 per-mille earned, 1 taken
    expect(pieceCondition(p)).toBe(601);
    expect(p.conditionAt).toBe(30);
    const anchorless = piece({ condition: 500 });
    const anchored = settlePiece(anchorless, 900, 40);
    expect(anchored.condition).toBe(500);
    expect(anchored.conditionAt).toBe(900);
  });
});

describe("gear wear: pieceStartDurability (user W3 True condition)", () => {
  it("a pristine piece opens at exactly durabilityMax (what the retired durability field always held)", () => {
    expect(pieceStartDurability(piece({ durabilityMax: 137 }))).toBe(137);
    for (const p of freshState().equipment) expect(pieceStartDurability(p), p.id).toBe(p.durabilityMax);
  });

  it("a worn piece opens at its real condition, no raised start floor", () => {
    expect(pieceStartDurability(piece({ durabilityMax: 120, condition: 500 }))).toBe(60);
    expect(pieceStartDurability(piece({ durabilityMax: 120, condition: 300 }))).toBe(36); // below Degraded: true condition
    expect(pieceStartDurability(piece({ durabilityMax: 120, condition: 0 }))).toBe(0);
  });
});

describe("gear wear: the catalogs", () => {
  const WEARING_SLOTS: WearSlot[] = ["cargoBay", "ftlDrive", "reactorCore", "specUtility", "sensor", "bridge", "quarters", "weapon", "shieldEmitters", "hullPlating", "droneBay", "memberArmor", "memberWeapon", "memberTool", "implant"];

  it("every slot with pieces wears some way (everything wears in different ways), and ids are unique", () => {
    for (const slot of WEARING_SLOTS) expect(WEAR_SOURCES.some((w) => w.slot === slot), slot).toBe(true);
    expect(new Set(WEAR_SOURCES.map((w) => w.id)).size).toBe(WEAR_SOURCES.length);
    for (const w of WEAR_SOURCES) {
      expect(w.id.startsWith(`${w.slot}:`), w.id).toBe(true);
      expect(w.raw, w.id).toBeGreaterThan(0);
      expect(w.per, w.id).toBeGreaterThan(0);
    }
  });

  it("implants wear slowest of all use sources (user W10), yet faster than the underway upkeep, so they wear at all", () => {
    const uses = WEAR_SOURCES.filter((w) => w.mode === "use");
    const implant = uses.find((w) => w.slot === "implant")!;
    // Step 3 (tune): the lowest raw amount among the sources quoted per event or per minute. The FTL drive's raw is
    // quoted per 10 ly (a different unit), so it is left out of the raw comparison.
    for (const w of uses.filter((x) => x.per === 1)) expect(implant.raw, w.id).toBeLessThanOrEqual(w.raw);
    // And slower than every other time-based source (the reactor and the crew modules, per minute underway).
    for (const w of uses.filter((x) => x.slot !== "implant" && x.event.startsWith("per minute"))) expect(implant.raw, w.id).toBeLessThan(w.raw);
    // "Wear very slowly" (W10 (a)), not "Never wear" (W10 (b)): above the underway upkeep a member's gear repairs at.
    expect(implant.raw).toBeGreaterThan(REPAIR_RATES.underway);
  });

  it("weapons, the reactor and the FTL drive take no second efficiency penalty in combat (combat's model is the authority)", () => {
    expect(wearEfficiencyConsumers("weapon")).toEqual([]);
    for (const c of WEAR_EFFICIENCY) {
      if (c.slot === "reactorCore" || c.slot === "ftlDrive") expect(c.combat, c.id).toBe(false);
    }
    expect(new Set(WEAR_EFFICIENCY.map((c) => c.id)).size).toBe(WEAR_EFFICIENCY.length);
    for (const c of WEAR_EFFICIENCY) expect(c.id.startsWith(`${c.slot}:`), c.id).toBe(true);
  });

  it("the battle sources are exactly the hit-taking kinds", () => {
    expect(WEAR_SOURCES.filter((w) => w.mode === "battle").map((w) => w.slot).sort()).toEqual(
      ["droneBay", "ftlDrive", "hullPlating", "memberArmor", "reactorCore", "shieldEmitters", "weapon"].sort(),
    );
  });
});
