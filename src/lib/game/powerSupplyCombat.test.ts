// E-MOD EM-3 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-3): the combat
// over-budget penalty. User answers 2026-10-17: Over budget "Gentle penalty curve (Recommended)" (smooth reduced
// strength as the shortfall grows; nothing shuts off), P2 "Never evict; a warning chip; the combat penalty applies",
// P6 "sqrt curve, floor 60% (Recommended)". The curve, the stamp, the player's path into it (an Engineering officer
// leaving), neutrality, the exact banked percent on weapon damage and shield recharge, stacking with a worn reactor,
// and offline == live.

import { describe, expect, it } from "vitest";
// WR-8b (enemy torpedoes) came after every pin here: the file runs with it off (enemyTorpedoSwitch.fixture.ts), so its
// pins keep proving their own slice (enemyTorpedoGoldens.test.ts pins what WR-8b moved, enemyTorpedoes.test.ts proves it).
import { enemyTorpedoesOffForThisFile } from "./enemyTorpedoSwitch.fixture";
enemyTorpedoesOffForThisFile();
import Decimal from "break_infinity.js";
import { SHIP_TYPES, freshState, type EquipmentInstance, type GameState, type PatrolMissionState } from "./model";
import { dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, tick } from "./tick";
import { fitEquipment } from "./equipment";
import { unassignOfficer } from "./seniorStaff";
import { overBudgetNotice, shipPowerTotals } from "./shipPower";
import { shipCombatRulesStamp } from "./crewOverlay";
import { seatOfficer } from "./wiring/probes";
import { POWER_SUPPLY_FLOOR_PERCENT, powerSupplyPercent } from "./combat/power";
import { COMBAT_RULES_WR8, newCombatRulesStamp, stampCombatArgs } from "./combat/combatRules";
import { shipToCombatant } from "./combat/bridge";
import { fireWeapon, resolveBattle } from "./combat/resolveBattle";
import { makeWeaponInstance } from "./combat/weapons";
import { makeRng } from "./combat/rng";
import { replayPatrol } from "./combat/patrolReplay";
import type { Combatant } from "./combat/types";
import { withPowerSupplyOff } from "./emodEm3Switch.fixture";
import { asPatrolVeteran } from "./awayTeamTestFixtures";
import { hash, onHull } from "./firstRunsGoldens.fixture";

const SHIP = "ship-1";
// The supply a run starting now would freeze for ship-1 (the stamp's own fold).
const supplyOf = (s: GameState): number => shipCombatRulesStamp(s, s.ships.find((x) => x.id === SHIP)!)?.powerSupplyPercent ?? 100;

function piece(id: string, over: Partial<EquipmentInstance> & { slotType: EquipmentInstance["slotType"] }): EquipmentInstance {
  return {
    id, rarity: "standard", ascension: "none", quality: 0, iLevel: 10, blueprintKey: null, implicitStats: {}, rolledStats: {},
    mass: 0, powerDraw: 0, durabilityMax: 100, fittedToShipId: null, ...over,
  } as EquipmentInstance;
}

// ship-1 as a Freighter with its Standard Issue and `spares` in storage.
function freighterWith(spares: EquipmentInstance[]): GameState {
  const fresh = freshState();
  const base = installMissingCombatBaselines(fresh);
  return { ...base, equipment: [...base.equipment, ...spares.map((p) => ({ ...p, fittedToShipId: null }))] };
}

// ship-1 with its installed Cargo Bay drawing `draw` (pristine), nothing else touched.
function withCargoDraw(s: GameState, draw: number): GameState {
  return { ...s, equipment: s.equipment.map((e) => (e.fittedToShipId === SHIP && e.slotType === "cargoBay" ? { ...e, powerDraw: draw } : e)) };
}

describe("EM-3: the power supply curve (P6: sqrt(output / draw), never below 60%)", () => {
  it("is 100 in budget, the exact-equal boundary included", () => {
    expect(powerSupplyPercent(100, 0)).toBe(100);
    expect(powerSupplyPercent(100, 50)).toBe(100);
    expect(powerSupplyPercent(100, 100)).toBe(100);
  });
  it("falls smoothly as the shortfall grows (whole percents, rounded down)", () => {
    expect(powerSupplyPercent(100, 101)).toBe(99); // floor(sqrt(9900.99...)) = 99
    expect(powerSupplyPercent(85, 90)).toBe(97);
    expect(powerSupplyPercent(2, 3)).toBe(81);
    expect(powerSupplyPercent(100, 200)).toBe(70);
    const seq = Array.from({ length: 200 }, (_, i) => powerSupplyPercent(100, 100 + i));
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeLessThanOrEqual(seq[i - 1]);
  });
  it("never goes below the floor, however deep the shortfall (nothing shuts off)", () => {
    expect(POWER_SUPPLY_FLOOR_PERCENT).toBe(60);
    expect(powerSupplyPercent(100, 277)).toBe(60); // sqrt(0.361) = 0.6008
    expect(powerSupplyPercent(100, 400)).toBe(60);
    expect(powerSupplyPercent(1, 1_000_000)).toBe(60);
    expect(powerSupplyPercent(0, 5)).toBe(60);
  });
  it("is integer math: the root is exact at perfect squares", () => {
    expect(powerSupplyPercent(81, 100)).toBe(90);
    expect(powerSupplyPercent(64, 100)).toBe(80);
    expect(powerSupplyPercent(4_900, 10_000)).toBe(70);
  });
});

describe("EM-3: the stamp carries the supply only when below 100", () => {
  it("a ship in budget writes the stamp it wrote before EM-3", () => {
    expect(newCombatRulesStamp(30, 0, 0, 100)).toEqual({ rules: COMBAT_RULES_WR8, speed: 30 });
    expect(newCombatRulesStamp(30, 0, 0, 81)).toEqual({ rules: COMBAT_RULES_WR8, speed: 30, powerSupplyPercent: 81 });
    expect(withPowerSupplyOff(() => newCombatRulesStamp(30, 0, 0, 81))).toEqual({ rules: COMBAT_RULES_WR8, speed: 30 });
    expect(stampCombatArgs({ rules: COMBAT_RULES_WR8, speed: 30 })).not.toHaveProperty("powerSupplyPercent");
    expect(stampCombatArgs({ rules: COMBAT_RULES_WR8, speed: 30, powerSupplyPercent: 81 }).powerSupplyPercent).toBe(81);
  });

  it("the player's path (P2): an Engineering officer leaves, the ship goes over, its next fight runs at its supply", () => {
    // Gross 90 on the Freighter's 85: it installs only with an Overdrive officer's cut (EM-2), then the officer leaves.
    const crewed = seatOfficer(freighterWith([piece("hot", { slotType: "cargoBay", powerDraw: 90 })]), "engineering", ["eng.overdrive"]);
    const installed = fitEquipment(crewed, SHIP, "hot");
    const ship = () => installed.ships.find((x) => x.id === SHIP)!;
    expect(shipCombatRulesStamp(installed, ship())).not.toHaveProperty("powerSupplyPercent");
    const left = unassignOfficer(installed, crewed.officers.find((o) => o.assignedShipId === SHIP)!.id);
    expect(shipPowerTotals(left, SHIP)).toEqual({ output: 85, draw: 90 });
    expect(supplyOf(left)).toBe(97);
    expect(shipCombatRulesStamp(left, left.ships.find((x) => x.id === SHIP)!)!.powerSupplyPercent).toBe(97);
    const notice = overBudgetNotice(left, SHIP)!;
    expect(notice.supplyPercent).toBe(97);
    expect(notice.strength).toBe("Weapons and shield recharge at 97%.");
    expect(notice.gentleNote).toBe("The cut is gentle and grows with the shortfall, never below 60%.");
  });

  it("power efficiency lifts the supply: the officer back aboard brings it to full", () => {
    const over = withCargoDraw(onHull("destroyer"), 200); // 160 output, 200 gross
    const seated = seatOfficer(over, "engineering", ["eng.overdrive"]);
    expect(supplyOf(over)).toBe(powerSupplyPercent(160, 200));
    expect(supplyOf(seated)).toBeGreaterThan(supplyOf(over));
  });
});

// A bare combatant firing one Tachyon Burst Emitter (EW: the neutral vs-armor column, so no floor sits between the bank
// and the hull and the sum is exact), at `supply` power and with its reactor at `reactorDurability`.
function gunner(supply: number | undefined, reactorDurability?: number): Combatant {
  const c = shipToCombatant({
    id: "p", team: "player", stats: { hullIntegrity: 600, shieldCapacity: 0, shieldRecharge: 0 },
    weaponLoadout: [makeWeaponInstance("tachyonBurstEmitter", "p-tbe")], speed: 30,
    ...(supply !== undefined ? { powerSupplyPercent: supply } : {}),
  });
  if (reactorDurability !== undefined && c.reactor) c.reactor.durability = reactorDurability;
  return c;
}
function target(): Combatant {
  return shipToCombatant({ id: "t", team: "enemy", stats: { hullIntegrity: 1_000_000, shieldCapacity: 0, shieldRecharge: 0 }, speed: 30 });
}
function totalDamage(a: Combatant, shots = 400): number {
  const rng = makeRng(0x3e3);
  let dealt = 0;
  for (let i = 0; i < shots; i++) dealt += fireWeapon(a, target(), a.weapons[0], rng).damage;
  return dealt;
}

describe("EM-3: neutrality (a ship in budget fights exactly as before)", () => {
  it("a supply of 100 builds the combatant without one", () => {
    expect(gunner(100)).toEqual(gunner(undefined));
    expect(gunner(100)).not.toHaveProperty("powerSupplyPercent");
  });
  it("and the battle is byte-identical", () => {
    const run = (supply: number | undefined) => resolveBattle({ combatants: [gunner(supply), target()] }, 77, { combatRules: COMBAT_RULES_WR8, generateLog: true });
    expect(hash(run(100))).toBe(hash(run(undefined)));
  });
});

describe("EM-3: weapon damage (banked, exact over a fight)", () => {
  const full = totalDamage(gunner(undefined));
  it("scales the whole fight's damage by the supply, to the point", () => {
    expect(full).toBeGreaterThan(1000);
    for (const supply of [99, 97, 81, 70, 60]) expect(totalDamage(gunner(supply)), `${supply}`).toBe(Math.floor((full * supply) / 100));
  });
  it("stacks with a worn reactor multiplicatively: the reactor's own per-hit floor first, then the supply", () => {
    // Degraded (at 60% durability or below) is the reactor's 90%; offline (0) its 70%. The reactor rounds each hit down
    // exactly as it does in budget, and the supply then scales the fight's total (banked).
    const degradedOnly = totalDamage(gunner(undefined, 60));
    const offlineOnly = totalDamage(gunner(undefined, 0));
    expect(degradedOnly).toBeLessThan(full);
    const both = totalDamage(gunner(81, 60));
    expect(both).toBe(Math.floor((degradedOnly * 81) / 100));
    const floors = totalDamage(gunner(POWER_SUPPLY_FLOOR_PERCENT, 0));
    expect(floors).toBe(Math.floor((offlineOnly * POWER_SUPPLY_FLOOR_PERCENT) / 100));
    expect(floors).toBeLessThan(offlineOnly);
  });
  // Review must-fix (2026-10-23): a worn reactor's per-hit floor must never make an over-budget ship hit HARDER than
  // the same ship in budget (small hits lose the most to rounding, so they are the test).
  it("over budget never beats in budget, at every reactor condition and small yields (1 to 8)", () => {
    const small = (supply: number | undefined, durability: number, lo: number, hi: number): number => {
      const a = gunner(supply, durability);
      a.weapons = a.weapons.map((w) => ({ ...w, yieldMin: lo, yieldMax: hi }));
      return totalDamage(a);
    };
    const bands: [number, number][] = [...Array.from({ length: 8 }, (_, i): [number, number] => [i + 1, i + 1]), [1, 8], [4, 8]];
    for (const durability of [100, 60, 0]) {
      for (const [lo, hi] of bands) {
        const inBudget = small(undefined, durability, lo, hi);
        for (const supply of [99, 97, 90, 81, 60]) {
          expect(small(supply, durability, lo, hi), `reactor ${durability}, yields ${lo}-${hi}, supply ${supply}`).toBeLessThanOrEqual(inBudget);
        }
      }
    }
  });
  it("is a post-draw scaling: the combat stream draws the same", () => {
    const a = gunner(81);
    const b = gunner(undefined);
    const ra = makeRng(9);
    const rb = makeRng(9);
    for (let i = 0; i < 50; i++) {
      expect(fireWeapon(a, target(), a.weapons[0], ra).projectilesHit).toBe(fireWeapon(b, target(), b.weapons[0], rb).projectilesHit);
    }
    expect(ra.next()).toBe(rb.next());
  });
});

describe("EM-3: shield recharge (banked, exact over a fight)", () => {
  function regained(supply: number | undefined): number {
    const p = shipToCombatant({
      id: "p", team: "player", stats: { hullIntegrity: 100_000, shieldCapacity: 100_000, shieldRecharge: 7 }, combatRules: true, speed: 0,
      ...(supply !== undefined ? { powerSupplyPercent: supply } : {}),
    });
    p.shield = 0;
    const e = shipToCombatant({ id: "e", team: "enemy", stats: { hullIntegrity: 100_000, shieldCapacity: 0, shieldRecharge: 0 }, combatRules: true, speed: 0, position: 1000 });
    return resolveBattle({ combatants: [p, e] }, 5, { combatRules: COMBAT_RULES_WR8 }).finalCombatants.find((c) => c.id === "p")!.shield;
  }
  it("recharges at the supply percent of the full rate (within a whole point)", () => {
    const full = regained(undefined);
    expect(full).toBeGreaterThan(100);
    for (const supply of [97, 81, 60]) {
      const got = regained(supply);
      expect(Math.abs(got - (full * supply) / 100), `${supply}`).toBeLessThanOrEqual(1);
      // Review must-fix check: the shield bank has no reactor floor in it, and its floor never rounds up.
      expect(got, `${supply}`).toBeLessThanOrEqual(Math.floor((full * supply) / 100) + 1);
      expect(got, `${supply}`).toBeLessThan(full);
    }
    expect(regained(100)).toBe(full);
  });
});

describe("EM-3: offline == live, and the replay reads the stamp", () => {
  function overPatrol(): GameState {
    const s = withCargoDraw(asPatrolVeteran({ ...onHull("destroyer"), nextPatrolSeed: 3, credits: new Decimal(100_000) }), 240);
    const r = dispatchCaptainOnPatrol(s, 1, "crimsonReaverWarband", "balanced", true);
    expect(r.success).toBe(true);
    expect((r.next.captains[0].mission as PatrolMissionState).combatRules!.powerSupplyPercent).toBe(81);
    return r.next;
  }
  it("one 900 s call equals 900 one-second ticks, Repeat relaunches included", () => {
    const start = overPatrol();
    const rng = () => 0.5;
    let live = start;
    for (let i = 0; i < 900; i++) live = economyTick(live, 1, rng);
    const offline = tick(900, start, rng, 0);
    expect(hash(offline.captains)).toBe(hash(live.captains));
    expect(hash(offline.ships)).toBe(hash(live.ships));
  });
  it("the display replay follows the stamp (stripping the supply replays the full-power fight)", () => {
    const s = overPatrol();
    const cap = s.captains[0];
    const m = cap.mission as PatrolMissionState;
    const { powerSupplyPercent: _drop, ...fullPower } = m.combatRules!;
    const stripped = { ...cap, mission: { ...m, combatRules: fullPower } };
    expect(hash(replayPatrol(s, cap))).not.toBe(hash(replayPatrol(s, stripped)));
    const inBudget = dispatchCaptainOnPatrol(asPatrolVeteran({ ...onHull("destroyer"), nextPatrolSeed: 3, credits: new Decimal(100_000) }), 1, "crimsonReaverWarband", "balanced", true).next;
    expect(hash(replayPatrol(s, stripped))).toBe(hash(replayPatrol(inBudget, inBudget.captains[0])));
  });
  it("the over-budget ship's hull base is the one P1 sized (the Destroyer's 160)", () => {
    expect(SHIP_TYPES.destroyer.basePowerOutput).toBe(160);
  });
});
