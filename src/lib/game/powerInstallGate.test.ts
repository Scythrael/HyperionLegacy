// E-MOD EM-2 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-2): the power install
// gate. User answers (2026-10-17): P1 "No ship goes over" (hull base at or above the heaviest crafted loadout; the
// census lives in emodGoldens.test.ts and emodEm2Goldens.test.ts), P2 "Never evict; a warning chip" and "installing
// over budget is refused with the reason shown". Every install path, both sides of the boundary (exact-equal fits), on
// pristine values only (wear is never read), uninstall never blocked, and power efficiency (Reactor Overdrive, Power
// Discipline, the Martian racial) moving the verdict.

import { describe, expect, it } from "vitest";
import { SHIP_TYPES, freshState, generateStandardIssue, type EquipmentInstance, type GameState, type ShipTypeKey } from "./model";
import { installMissingCombatBaselines } from "./tick";
import { canFitEquipment, fitEquipment, unfitEquipmentInstance } from "./equipment";
import { installTargetsFor } from "./memberEquipment";
import { checkOutLoadout, createLoadout, installIntoLoadout, loadoutCheckOutPowerShortfall } from "./armory";
import { applyRoster, createRoster, rosterLoadoutPowerShortfall } from "./personnelRosters";
import { unassignOfficer } from "./seniorStaff";
import {
  POWER_GATE_ALLOWS_NON_WORSENING_INSTALL,
  installPowerShortfall,
  overBudgetNotice,
  overPowerReasonText,
  shipPowerBudget,
  shipPowerTotals,
} from "./shipPower";
import { buildInstallOnRows } from "../installOnPicker";
import { bucketOf, seatOfficer, withBuckets } from "./wiring/probes";

const SHIP = "ship-1";
const HULL: ShipTypeKey = "generalFreighter";
const BASE = SHIP_TYPES[HULL].basePowerOutput; // 85

function piece(id: string, over: Partial<EquipmentInstance> & { slotType: EquipmentInstance["slotType"] }): EquipmentInstance {
  return {
    id,
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
    fittedToShipId: null,
    ...over,
  } as EquipmentInstance;
}

// ship-1 on `hull` with its Standard Issue (draws 0, supplies 0), `installed` pieces replacing their slot's Standard
// Issue, and `spares` in storage.
function shipWith(installed: EquipmentInstance[] = [], spares: EquipmentInstance[] = [], hull: ShipTypeKey = HULL): GameState {
  const fresh = freshState();
  const base = installMissingCombatBaselines({ ...fresh, ships: fresh.ships.map((s) => (s.id === SHIP ? { ...s, typeKey: hull } : s)) });
  const slots = new Set(installed.filter((e) => e.slotType !== "weapon" && e.slotType !== "droneBay").map((e) => e.slotType));
  return {
    ...base,
    equipment: [
      ...base.equipment.filter((e) => !(e.fittedToShipId === SHIP && slots.has(e.slotType))),
      ...installed.map((p) => ({ ...p, fittedToShipId: SHIP })),
      ...spares.map((p) => ({ ...p, fittedToShipId: null })),
    ],
  };
}

const verdict = (s: GameState, id: string, replacing?: string) => {
  const g = canFitEquipment(s, SHIP, id, replacing);
  return g.ok ? "ok" : g.reason === "overPower" ? `overPower:${g.powerShortfall}` : g.reason;
};

describe("EM-2: the install gate, both sides of the boundary", () => {
  it("exact-equal fits; one point over is refused with the shortfall", () => {
    const s = shipWith([], [piece("fits", { slotType: "cargoBay", powerDraw: BASE }), piece("over", { slotType: "cargoBay", powerDraw: BASE + 1 })]);
    expect(verdict(s, "fits")).toBe("ok");
    expect(verdict(s, "over")).toBe("overPower:1");
    expect(() => fitEquipment(s, SHIP, "over")).toThrow(/overPower/);
    expect(shipPowerTotals(fitEquipment(s, SHIP, "fits"), SHIP)).toEqual({ output: BASE, draw: BASE });
  });

  it("is checked LAST: a full hardpoint still reads hardpointsFull, a locked spare still reads locked", () => {
    const gun = piece("gun", { slotType: "weapon", weaponType: "railgun", powerDraw: 999 });
    const s = shipWith([], [gun, piece("locked", { slotType: "cargoBay", powerDraw: 999, locked: true })]);
    expect(verdict(s, "gun")).toBe("hardpointsFull");
    expect(verdict(s, "locked")).toBe("locked");
  });

  it("a targeted weapon swap counts the outgoing weapon out", () => {
    const heavy = piece("heavy", { slotType: "weapon", weaponType: "railgun", powerDraw: BASE });
    const s = shipWith([], [heavy, piece("heavier", { slotType: "weapon", weaponType: "railgun", powerDraw: BASE + 4 }), piece("light", { slotType: "weapon", weaponType: "railgun", powerDraw: 10 })]);
    const outgoing = s.equipment.find((e) => e.fittedToShipId === SHIP && e.slotType === "weapon")!.id;
    const armed = fitEquipment(s, SHIP, "heavy", outgoing);
    expect(verdict(armed, "heavier", "heavy")).toBe("overPower:4");
    expect(verdict(armed, "light", "heavy")).toBe("ok");
  });

  it("the refusal text is the signed-off mockup's wording", () => {
    expect(overPowerReasonText(12)).toBe("needs 12 more power. Install a stronger Reactor Core or remove a powered system");
  });
});

describe("EM-2: the reactor swap and the Reactor Core's own output", () => {
  const core = piece("core", { slotType: "reactorCore", powerDraw: 1, implicitStats: { powerOutput: 30 } });
  const hold = piece("hold", { slotType: "cargoBay", powerDraw: BASE + 29 }); // with the core: 85 + 30 out, 114 + 1 in
  const loaded = () => shipWith([core, hold], [generateStandardIssue({ slotType: "reactorCore", fittedToShipId: null, allocateId: () => "si-core" })]);

  it("the crafted core's power lets the heavy hold in; swapping back to Standard Issue is refused", () => {
    expect(shipPowerTotals(loaded(), SHIP)).toEqual({ output: BASE + 30, draw: BASE + 30 });
    expect(verdict(loaded(), "si-core")).toBe("overPower:29");
    // Without the core first, the hold itself is refused.
    const bare = shipWith([], [hold]);
    expect(verdict(bare, "hold")).toBe("overPower:29");
  });

  it("uninstalling is never blocked, and nothing is evicted: the ship goes over budget and carries the warning", () => {
    const s = unfitEquipmentInstance(loaded(), SHIP, "core");
    expect(s.equipment.find((e) => e.id === "hold")!.fittedToShipId).toBe(SHIP);
    const notice = overBudgetNotice(s, SHIP)!;
    expect(notice.shortfall).toBe(29);
    expect(notice.chip).toBe("Over budget by 29");
    expect(notice.cause).toContain(`against ${BASE} output (the hull's own ${BASE}, with no Reactor Core power)`);
    expect(notice.cause).toContain("Install a stronger Reactor Core or remove a powered system");
    expect(overBudgetNotice(loaded(), SHIP)).toBeNull();
  });
});

describe("EM-2: a ship already over budget (P2) [PROVISIONAL rule: an install that does not make it worse passes]", () => {
  const over = () => shipWith([piece("hold", { slotType: "cargoBay", powerDraw: BASE + 10 })], [
    piece("bridge", { slotType: "bridge", powerDraw: 0 }),
    piece("hotter", { slotType: "cargoBay", powerDraw: BASE + 15 }),
    piece("same", { slotType: "cargoBay", powerDraw: BASE + 10 }),
    piece("weakCore", { slotType: "reactorCore", powerDraw: 0, implicitStats: { powerOutput: 4 } }),
    piece("bigCore", { slotType: "reactorCore", powerDraw: 0, implicitStats: { powerOutput: 40 } }),
  ]);

  it("the default is on", () => {
    expect(POWER_GATE_ALLOWS_NON_WORSENING_INSTALL).toBe(true);
  });

  it("an unpowered or equal install passes; a hotter one is refused by what it adds; any stronger core passes", () => {
    expect(verdict(over(), "bridge")).toBe("ok");
    expect(verdict(over(), "same")).toBe("ok");
    expect(verdict(over(), "hotter")).toBe("overPower:5");
    expect(verdict(over(), "weakCore")).toBe("ok");
    expect(verdict(over(), "bigCore")).toBe("ok");
  });

  it("the rule as a pure function, both settings", () => {
    const before = { output: 85, draw: 95 };
    expect(installPowerShortfall(before, { output: 85, draw: 100 })).toBe(5);
    expect(installPowerShortfall(before, { output: 85, draw: 100 }, false)).toBe(15);
    expect(installPowerShortfall(before, { output: 85, draw: 95 }, false)).toBe(10);
    expect(installPowerShortfall(before, { output: 85, draw: 85 }, false)).toBe(0);
    expect(installPowerShortfall({ output: 85, draw: 0 }, { output: 85, draw: 86 })).toBe(1);
  });
});

describe("EM-2: power efficiency moves the verdict (Reactor Overdrive, Power Discipline, the Martian racial)", () => {
  // Gross 90 on an 85 hull: 5 over bare; about 8% off with one Overdrive officer (ceil(90 / 1.08...) = 84) fits.
  const hot = piece("hot", { slotType: "cargoBay", powerDraw: 90 });
  it("Reactor Overdrive", () => {
    const bare = shipWith([], [hot]);
    expect(verdict(bare, "hot")).toBe("overPower:5");
    expect(verdict(seatOfficer(bare, "engineering", ["eng.overdrive"]), "hot")).toBe("ok");
  });

  it("Power Discipline and the Martian racial (crew complement)", () => {
    const bare = shipWith([], [hot]);
    const discipline = withBuckets(bare, [bucketOf("engineering", "eng.power", 200)]);
    expect(verdict(discipline, "hot")).toBe("ok");
    const martians = withBuckets(bare, [bucketOf("engineering", "test.none", 200, "martian")]);
    const before = shipPowerBudget(martians, SHIP, { piece: { ...hot, fittedToShipId: null } });
    expect(before.draw).toBeLessThan(before.grossDraw);
    expect(verdict(martians, "hot")).toBe(before.draw <= before.output ? "ok" : `overPower:${before.draw - before.output}`);
    expect(before.draw).toBeLessThan(90);
  });

  it("an officer leaving puts the ship over budget; nothing is evicted, the warning names the cause", () => {
    const crewed = seatOfficer(shipWith([], [hot]), "engineering", ["eng.overdrive"]);
    const installed = fitEquipment(crewed, SHIP, "hot");
    expect(overBudgetNotice(installed, SHIP)).toBeNull();
    const left = unassignOfficer(installed, crewed.officers.find((o) => o.assignedShipId === SHIP)!.id);
    expect(left.equipment.find((e) => e.id === "hot")!.fittedToShipId).toBe(SHIP);
    expect(overBudgetNotice(left, SHIP)!.chip).toBe("Over budget by 5");
    // An overrun the crew's cut cannot cover names the cut in the cause.
    const stillOver = withBuckets(shipWith([piece("hotter", { slotType: "cargoBay", powerDraw: 120 })]), [bucketOf("engineering", "eng.power", 200)]);
    const t = shipPowerTotals(stillOver, SHIP);
    expect(t.draw).toBeLessThan(120);
    expect(overBudgetNotice(stillOver, SHIP)!.cause).toContain(`draw ${t.draw} after power efficiency (120 before) against ${BASE} output`);
  });
});

describe("EM-2: pristine values only (gear wear design 4.3: the install gate never reads wear)", () => {
  it("a worn Reactor Core counts its full output; a worn hold its full draw", () => {
    const core = piece("core", { slotType: "reactorCore", powerDraw: 0, implicitStats: { powerOutput: 30 } });
    const hold = piece("hold", { slotType: "cargoBay", powerDraw: BASE + 30 });
    const fresh = shipWith([core], [hold]);
    const worn = { ...fresh, equipment: fresh.equipment.map((e) => (e.id === "core" || e.id === "hold" ? { ...e, condition: 0.05, conditionAt: 0 } : e)) };
    expect(verdict(fresh, "hold")).toBe("ok");
    expect(verdict(worn, "hold")).toBe("ok");
    const tooHot = { ...worn, equipment: worn.equipment.map((e) => (e.id === "hold" ? { ...e, powerDraw: BASE + 31 } : e)) };
    expect(verdict(tooHot, "hold")).toBe("overPower:1");
  });
});

describe("EM-2: every install path carries the same gate", () => {
  const core = piece("core", { slotType: "reactorCore", powerDraw: 0, implicitStats: { powerOutput: 30 } });
  const hold = piece("hold", { slotType: "cargoBay", powerDraw: BASE + 30 });
  const hotHold = piece("hotHold", { slotType: "cargoBay", powerDraw: BASE + 31 });

  function loadout(s0: GameState, ids: { core?: string; hold: string }): { s: GameState; id: string } {
    const made = createLoadout(s0, HULL, "Power");
    let s = made.next;
    if (ids.core !== undefined) s = installIntoLoadout(s, made.loadoutId!, "reactorCore", ids.core);
    s = installIntoLoadout(s, made.loadoutId!, "cargoBay", ids.hold);
    return { s, id: made.loadoutId! };
  }

  it("item side: Install on... carries the refusal and its number", () => {
    const s = shipWith([], [hotHold]);
    const [t] = installTargetsFor(s, "hotHold");
    expect(t).toMatchObject({ kind: "ship", ok: false, reason: "overPower", refusal: { reason: "overPower", powerShortfall: BASE + 31 - BASE } });
    const [row] = buildInstallOnRows(s, "hotHold", (r) => (r.reason === "overPower" ? overPowerReasonText(r.powerShortfall) : r.reason));
    expect(row.reason).toBe("Needs 31 more power. Install a stronger Reactor Core or remove a powered system");
  });

  it("Armory check-out: the whole set, its own Reactor Core included; exact-equal fits, one over is refused", () => {
    const withCore = loadout(shipWith([], [core, hold]), { core: "core", hold: "hold" });
    expect(loadoutCheckOutPowerShortfall(withCore.s, withCore.id, SHIP)).toBe(0);
    expect(checkOutLoadout(withCore.s, withCore.id, SHIP)).not.toBe(withCore.s);
    const over = loadout(shipWith([], [core, hotHold]), { core: "core", hold: "hotHold" });
    expect(loadoutCheckOutPowerShortfall(over.s, over.id, SHIP)).toBe(1);
    expect(checkOutLoadout(over.s, over.id, SHIP)).toBe(over.s);
    const noCore = loadout(shipWith([], [hold]), { hold: "hold" });
    expect(loadoutCheckOutPowerShortfall(noCore.s, noCore.id, SHIP)).toBe(30);
  });

  it("Armory check-out: the ship's own manual gear goes back to storage, so its Reactor Core does not count", () => {
    const onShip = loadout(shipWith([core], [hold]), { hold: "hold" });
    expect(loadoutCheckOutPowerShortfall(onShip.s, onShip.id, SHIP)).toBe(30);
  });

  it("roster apply: a linked loadout the gate refuses stays in the Armory, and the shortfall is named", () => {
    const over = loadout(shipWith([], [hold]), { hold: "hold" });
    const made = createRoster(over.s, { name: "Gear", linkedLoadoutId: over.id, includePeople: false });
    expect(rosterLoadoutPowerShortfall(made.next, made.rosterId!, SHIP)).toBe(30);
    const out = applyRoster(made.next, made.rosterId!, SHIP);
    expect(out.loadouts.find((l) => l.id === over.id)!.checkedOutToShipId).toBeNull();
    const fits = loadout(shipWith([], [core, hold]), { core: "core", hold: "hold" });
    const ok = createRoster(fits.s, { name: "Gear", linkedLoadoutId: fits.id, includePeople: false });
    expect(rosterLoadoutPowerShortfall(ok.next, ok.rosterId!, SHIP)).toBe(0);
    expect(applyRoster(ok.next, ok.rosterId!, SHIP).loadouts.find((l) => l.id === fits.id)!.checkedOutToShipId).toBe(SHIP);
  });
});
