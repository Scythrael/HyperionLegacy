// E-MOD EM-1 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-1): the power budget
// engine. The hull's own output (P1), the net draw after power efficiency on a D23 curve (P4), the FTL drive class
// draw (P5, acting the moment a drive blueprint carries a class), the reactor surplus (EM-4's input) and the
// shipPowerBudget reader, which matches the ship sheet exactly. Display only: no gate, no penalty (EM-2, EM-3).

import { describe, expect, it } from "vitest";
import {
  BLUEPRINTS,
  DRIVE_CLASS_POWER_DRAW_MULT,
  SHIP_TYPES,
  driveClassPowerDraw,
  equipmentStatMods,
  freshState,
  ftlDriveClass,
  type EquipmentInstance,
  type GameState,
  type ShipTypeKey,
} from "./model";
import { installMissingCombatBaselines } from "./tick";
import { applyCrewOverlay, effectiveShipStats, netPowerDraw, POWER_EFFICIENCY_KNEE, shipCrewContribution } from "./crewOverlay";
import { CREW_PROFESSION_BUFFS } from "./crewBuffs";
import { CREW_RACES } from "./crewRaces";
import { getSeniorStaffBonusById } from "./seniorStaffBonuses";
import { diminishing } from "./diminishing";
import { shipPowerBudget } from "./shipPower";
import { bucketOf, seatOfficer, withBuckets } from "./wiring/probes";
import { crewModuleSiOffForThisFile } from "./crewModuleSiSwitch.fixture";

// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"): this file's pins predate the
// free Sensor Suite, Bridge Module and Crew Quarters every ship now carries (their berths, officer lift, hull bonus
// and equipment ids), so the set is off here and the pins keep proving their own slice. The set itself is pinned in
// crewModuleStandardIssue.test.ts.
crewModuleSiOffForThisFile();

const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const SHIP = "ship-1";

function piece(over: Partial<EquipmentInstance> & { slotType: EquipmentInstance["slotType"] }): EquipmentInstance {
  return {
    id: `p-${over.slotType}`,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: null,
    implicitStats: {},
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: SHIP,
    ...over,
  } as EquipmentInstance;
}

// ship-1 on `hull` with its Standard Issue, plus `extra` pieces replacing the same slot (multi slots add).
function shipWith(hull: ShipTypeKey, extra: EquipmentInstance[] = []): GameState {
  const base = installMissingCombatBaselines({ ...freshState(), ships: freshState().ships.map((s) => (s.id === SHIP ? { ...s, typeKey: hull } : s)) });
  const slots = new Set(extra.filter((e) => e.slotType !== "weapon" && e.slotType !== "droneBay").map((e) => e.slotType));
  return { ...base, equipment: [...base.equipment.filter((e) => !(e.fittedToShipId === SHIP && slots.has(e.slotType))), ...extra] };
}

const sheet = (s: GameState) => effectiveShipStats(s, s.ships.find((sh) => sh.id === SHIP)!);
const POWERED = piece({ slotType: "cargoBay", powerDraw: 100 });

describe("EM-1: the hull's own power output (P1)", () => {
  it("every hull carries a positive base output, and a bare sheet reads it", () => {
    for (const hull of HULLS) {
      expect(SHIP_TYPES[hull].basePowerOutput, hull).toBeGreaterThan(0);
      expect(Number.isInteger(SHIP_TYPES[hull].basePowerOutput), hull).toBe(true);
      expect(sheet(shipWith(hull)).powerOutput, hull).toBe(SHIP_TYPES[hull].basePowerOutput);
    }
  });

  it("explorers are power-rich: each one's base output exceeds every non-explorer hull of its weapon count", () => {
    const explorers = HULLS.filter((h) => SHIP_TYPES[h].spec === "explorer");
    const others = HULLS.filter((h) => SHIP_TYPES[h].spec !== "explorer" && SHIP_TYPES[h].weaponHardpoints === 1);
    for (const e of explorers) for (const o of others) expect(SHIP_TYPES[e].basePowerOutput, `${e} vs ${o}`).toBeGreaterThan(SHIP_TYPES[o].basePowerOutput);
  });

  it("a Reactor Core's powerOutput line adds on top of the hull's own", () => {
    const s = shipWith("destroyer", [piece({ slotType: "reactorCore", implicitStats: { powerOutput: 37 } })]);
    expect(sheet(s).powerOutput).toBe(SHIP_TYPES.destroyer.basePowerOutput + 37);
  });
});

describe("EM-1: power efficiency cuts the net draw on a D23 curve (P4)", () => {
  it("netPowerDraw: identity at no efficiency or no draw; integer; concave; never reaches zero", () => {
    expect(netPowerDraw(100, 0)).toBe(100);
    expect(netPowerDraw(0, 0.5)).toBe(0);
    expect(netPowerDraw(100, 0.1)).toBe(Math.ceil(100 / (1 + diminishing(0.1, POWER_EFFICIENCY_KNEE))));
    let prevDraw = 1000;
    let prevCut = Infinity;
    for (let e = 0.1; e <= 5; e += 0.1) {
      const d = netPowerDraw(1000, e);
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBeLessThanOrEqual(prevDraw); // more efficiency never draws more
      const cut = (1000 / (1 + diminishing(e - 0.1, POWER_EFFICIENCY_KNEE))) - 1000 / (1 + diminishing(e, POWER_EFFICIENCY_KNEE));
      expect(cut).toBeLessThan(prevCut); // each extra step cuts less (diminishing, never a cap)
      prevCut = cut;
      prevDraw = d;
    }
    expect(netPowerDraw(1000, 1000)).toBeGreaterThan(0);
    // Exact divisions stay exact (no float creep past a whole point).
    expect(netPowerDraw(80, invEff(0.25))).toBe(64);
  });

  it("each source moves the sheet's power draw: Reactor Overdrive, Power Discipline, a Martian officer, a Martian crew", () => {
    const base = shipWith("destroyer", [POWERED]);
    const plain = sheet(base).powerDraw;
    expect(plain).toBe(100);
    const overdrive = seatOfficer(base, "engineering", ["eng.overdrive"]);
    const discipline = withBuckets(base, [bucketOf("engineering", "eng.power", 50)]);
    const martianOfficer = seatOfficer(base, "executive", [], { race: "martian" });
    const martianCrew = withBuckets(base, [bucketOf("engineering", "eng.range", 50, "martian")]);
    const cases: [string, GameState, number][] = [
      ["Reactor Overdrive", overdrive, getSeniorStaffBonusById("eng.overdrive")!.magnitude],
      ["Power Discipline", discipline, CREW_PROFESSION_BUFFS.engineering.find((b) => b.id === "eng.power")!.magnitude * 50],
      ["Martian officer", martianOfficer, CREW_RACES.martian.racialBonus.seniorStaff],
      ["Martian crew", martianCrew, CREW_RACES.martian.racialBonus.complement * 50],
    ];
    for (const [label, s, e] of cases) {
      const ship = s.ships.find((sh) => sh.id === SHIP)!;
      expect(shipCrewContribution(s, ship)["crew.powerEfficiency"], label).toBeCloseTo(e, 12);
      expect(sheet(s).powerDraw, label).toBe(netPowerDraw(100, e));
      expect(sheet(s).powerDraw, label).toBeLessThan(plain);
    }
  });

  it("neutral: no efficiency source, or nothing drawing, leaves the crew overlay's result untouched", () => {
    const st = shipWith("destroyer", [POWERED]);
    const ship = st.ships.find((sh) => sh.id === SHIP)!;
    const fold = { ...sheet(st) };
    // No efficiency: the same object back.
    expect(applyCrewOverlay(fold, {})).toBe(fold);
    // Efficiency with nothing drawing: the same object back.
    const idle = { ...fold, powerDraw: 0 };
    expect(applyCrewOverlay(idle, { "crew.powerEfficiency": 0.4 })).toBe(idle);
    // A Standard Issue ship with an Overdrive officer: the sheet equals the officer-free sheet.
    const si = shipWith("destroyer");
    expect(sheet(seatOfficer(si, "engineering", ["eng.overdrive"]))).toEqual(sheet(si));
    expect(shipCrewContribution(st, ship)["crew.powerEfficiency"] ?? 0).toBe(0);
  });
});

describe("EM-1: an FTL drive draws x1.6 per class above I (P5)", () => {
  it("driveClassPowerDraw: Class I is the draw itself; each class above multiplies by 1.6, rounded up", () => {
    expect(DRIVE_CLASS_POWER_DRAW_MULT).toBe(1.6);
    expect(driveClassPowerDraw(4, 1)).toBe(4);
    expect(driveClassPowerDraw(4, 2)).toBe(7); // 6.4
    expect(driveClassPowerDraw(4, 3)).toBe(11); // 10.24
    expect(driveClassPowerDraw(4, 7)).toBe(68); // 67.1
    expect(driveClassPowerDraw(0, 5)).toBe(0); // a Standard Issue drive draws nothing at any class
    expect(driveClassPowerDraw(5, 2)).toBe(8); // exactly 8, no float creep
  });

  // Expedition Tiers G2-4: the Class II Drive Blueprint is the one classed drive the facility tracks serve today; every
  // other drive (the three Class I blueprints, Standard Issue) still folds its own draw.
  // OC-15 (both facility tracks reach tier VII): the Class III to VII drives are served too, each its own class.
  it("every drive but the classed drives (Class II to VII) is Class I, so their fold is unchanged", () => {
    const classed: Record<string, number> = { classIIDriveBp: 2, classIIIDriveBp: 3, classIVDriveBp: 4, classVDriveBp: 5, classVIDriveBp: 6, classVIIDriveBp: 7 };
    for (const [key, bp] of Object.entries(BLUEPRINTS)) expect(bp.driveClass, key).toBe(classed[key]);
    expect(ftlDriveClass({ blueprintKey: null })).toBe(1);
    expect(ftlDriveClass({ blueprintKey: "balancedDriveBp" })).toBe(1);
    expect(ftlDriveClass({ blueprintKey: "classIIDriveBp" })).toBe(2);
  });

  it("the moment a drive blueprint carries a class, its installed drive's draw grows on the sheet", () => {
    const key = "emodTestClassedDrive";
    BLUEPRINTS[key] = { ...Object.values(BLUEPRINTS).find((b) => b.equipmentOutput?.slotType === "ftlDrive")!, key, driveClass: 3 };
    try {
      const drive = piece({ slotType: "ftlDrive", blueprintKey: key, powerDraw: 4 });
      expect(ftlDriveClass(drive)).toBe(3);
      expect(equipmentStatMods([drive]).totalPowerDraw).toBe(11);
      expect(sheet(shipWith("orion", [drive])).powerDraw).toBe(11);
      // Only the drive slot reads a class: the same blueprint key on a cargo bay draws its own number.
      expect(equipmentStatMods([piece({ slotType: "cargoBay", blueprintKey: key, powerDraw: 4 })]).totalPowerDraw).toBe(4);
      expect(shipPowerBudget(shipWith("orion", [drive]), SHIP).grossDraw).toBe(11);
    } finally {
      delete BLUEPRINTS[key];
    }
  });
});

describe("EM-1: shipPowerBudget", () => {
  it("matches the ship sheet exactly, every hull, Standard Issue, crafted and crewed", () => {
    for (const hull of HULLS) {
      const variants = [
        shipWith(hull),
        shipWith(hull, [POWERED, piece({ slotType: "reactorCore", implicitStats: { powerOutput: 25 }, powerDraw: 1 })]),
        seatOfficer(withBuckets(shipWith(hull, [POWERED]), [bucketOf("engineering", "eng.power", 30, "martian")]), "engineering", ["eng.overdrive"], { race: "martian" }),
      ];
      for (const s of variants) {
        const b = shipPowerBudget(s, SHIP);
        expect(b.output, hull).toBe(sheet(s).powerOutput);
        expect(b.draw, hull).toBe(sheet(s).powerDraw);
        expect(b.remaining, hull).toBe(b.output - b.draw);
        expect(b.overBudget, hull).toBe(b.draw > b.output);
        expect(b.baseOutput + b.reactorOutput, hull).toBe(b.output);
      }
    }
  });

  it("the reactor surplus is the unused reactor power, never the hull's own", () => {
    const si = shipPowerBudget(shipWith("destroyer"), SHIP);
    expect(si.reactorOutput).toBe(0);
    expect(si.reactorSurplus).toBe(0);
    const crafted = shipPowerBudget(shipWith("destroyer", [piece({ slotType: "reactorCore", implicitStats: { powerOutput: 30 } })]), SHIP);
    expect(crafted.reactorSurplus).toBe(30); // the hull's own covers the (zero) draw, so all 30 are spare
    const heavy = shipPowerBudget(shipWith("destroyer", [piece({ slotType: "reactorCore", implicitStats: { powerOutput: 30 } }), piece({ slotType: "cargoBay", powerDraw: 175 })]), SHIP);
    expect(heavy.reactorSurplus).toBe(SHIP_TYPES.destroyer.basePowerOutput + 30 - 175);
    const over = shipPowerBudget(shipWith("destroyer", [piece({ slotType: "reactorCore", implicitStats: { powerOutput: 30 } }), piece({ slotType: "cargoBay", powerDraw: 400 })]), SHIP);
    expect(over.reactorSurplus).toBe(0);
    expect(over.overBudget).toBe(true);
  });

  it("a candidate: a singleton swaps its slot's occupant, a weapon adds, a named weapon is replaced", () => {
    const s = shipWith("destroyer", [piece({ id: "w-heavy", slotType: "weapon", powerDraw: 35 })]);
    const now = shipPowerBudget(s, SHIP);
    const reactor = piece({ id: "r-new", slotType: "reactorCore", implicitStats: { powerOutput: 40 }, powerDraw: 1, fittedToShipId: null });
    const withReactor = shipPowerBudget(s, SHIP, { piece: reactor });
    expect(withReactor.reactorOutput).toBe(40);
    expect(withReactor.grossDraw).toBe(now.grossDraw + 1); // the Standard Issue reactor (draw 0) moved out
    const gun = piece({ id: "w-new", slotType: "weapon", powerDraw: 20, fittedToShipId: null });
    expect(shipPowerBudget(s, SHIP, { piece: gun }).grossDraw).toBe(now.grossDraw + 20);
    expect(shipPowerBudget(s, SHIP, { piece: gun, replacingInstanceId: "w-heavy" }).grossDraw).toBe(now.grossDraw - 35 + 20);
    // The reader never changes the state.
    expect(shipPowerBudget(s, SHIP)).toEqual(now);
  });

  it("reads pristine gear: wear never moves the budget", () => {
    const s = shipWith("destroyer", [POWERED, piece({ slotType: "reactorCore", implicitStats: { powerOutput: 30 } })]);
    const worn: GameState = { ...s, equipment: s.equipment.map((e) => (e.fittedToShipId === SHIP ? { ...e, durability: 1 } : e)) };
    expect(shipPowerBudget(worn, SHIP)).toEqual(shipPowerBudget(s, SHIP));
  });
});

// The efficiency that makes 1 + diminishing(e, knee) exactly 1 + y (registry.ts invDiminishing's formula).
function invEff(y: number): number {
  return y + (y * y) / (2 * POWER_EFFICIENCY_KNEE);
}
