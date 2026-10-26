// E-MOD EM-5 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-5): the universal module
// slot, its cap, its refusals and the Passive and Conditional engines, tested on FIXTURE modules (the catalog ships
// empty until EM-7; shipModulesTest.fixture.ts).

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  BLUEPRINTS,
  EQUIPMENT_SLOTS,
  SHIP_TYPES,
  freshState,
  generateStandardIssue,
  moduleEffectScale,
  shipDerivedStats,
  type EquipmentInstance,
  type GameState,
  type PatrolMissionState,
  type ShipTypeKey,
} from "./model";
import { dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { snapshotShipEventProfile } from "./shipScanEvents";
import { canFitEquipment, equippedFor, fitEquipment, unfitEquipment, unfitEquipmentInstance } from "./equipment";
import { shipPowerBudget, shipPowerTotals } from "./shipPower";
import { effectiveShipStats } from "./crewOverlay";
import { applyModuleCombat, combatHullTypeOf, foldedPlayerDefense, shipToCombatant } from "./combat/bridge";
import { fireWeapon, resolveBattle } from "./combat/resolveBattle";
import { makeRng } from "./combat/rng";
import { createLoadout, installIntoLoadout, loadoutModuleRuleBroken, loadoutSlotDefsForShipType } from "./armory";
import { installTargetsFor } from "./memberEquipment";
import { REQUISITION_CATALOGUE } from "./quartermaster";
import { WEAR_EFFICIENCY, WEAR_SOURCES } from "./gearWear";
import { deserialize, migrate, serialize } from "./save";
import {
  MODULE_SLOT_SHARING_TYPES,
  UNIVERSAL_MODULES,
  UNIVERSAL_MODULES_LIVE,
  hullHasSpecUtilitySlot,
  moduleConditionals,
  modulePowerOutput,
  moduleSlotsUsed,
  pieceModuleDef,
  validateUniversalModuleCatalog,
  validateUniversalModuleDef,
  type UniversalModuleDef,
} from "./shipModules";
import { TEST_BRACING, TEST_CAPACITOR, TEST_FILLERS, TEST_LAST_STAND, mintTestModule, withTestModules } from "./shipModulesTest.fixture";
import { WIRING_REGISTRY } from "./wiring/registry";
import { EM5_ADDED_ENTRY_IDS, EM5_MODULE_SLOTS_IDS } from "./emodEm5Registry.fixture";

const SHIP = "ship-1";
const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const scaleOf = (p: EquipmentInstance) => moduleEffectScale(p.rarity, p.quality);

function hullState(hull: ShipTypeKey): GameState {
  const base = freshState();
  return installMissingCombatBaselines({ ...base, credits: new Decimal(1_000_000), ships: base.ships.map((sh) => (sh.id === SHIP ? { ...sh, typeKey: hull } : sh)) });
}
const withPieces = (s: GameState, pieces: EquipmentInstance[]): GameState => ({ ...s, equipment: [...s.equipment, ...pieces] });
const utilityOf = (s: GameState) => equippedFor(s, SHIP).find((e) => e.slotType === "specUtility");
function withoutUtility(s: GameState): GameState {
  const u = utilityOf(s);
  return u ? unfitEquipmentInstance(s, SHIP, u.id) : s;
}
function installAll(s0: GameState, pieces: EquipmentInstance[]): { state: GameState; verdicts: string[] } {
  let s = withPieces(s0, pieces);
  const verdicts: string[] = [];
  for (const p of pieces) {
    const v = canFitEquipment(s, SHIP, p.id);
    verdicts.push(v.ok ? "ok" : v.reason);
    if (v.ok) s = fitEquipment(s, SHIP, p.id);
  }
  return { state: s, verdicts };
}

describe("the catalog", () => {
  it("the module slot's varieties are exactly the catalog ids, and the real catalog is well-formed", () => {
    expect(EQUIPMENT_SLOTS.module.varieties.map((v) => v.key)).toEqual(UNIVERSAL_MODULES.map((d) => d.id));
    expect(validateUniversalModuleCatalog()).toEqual([]);
  });

  it("the switch stays off until a module can be crafted (nothing player-reachable is inert)", () => {
    const moduleBlueprints = Object.values(BLUEPRINTS).filter((b) => b.equipmentOutput?.slotType === "module");
    expect(UNIVERSAL_MODULES_LIVE).toBe(moduleBlueprints.length > 0);
    // Off: the Armory offers no module slot; on (the tests' hook): one per moduleSlots.
    for (const hull of HULLS) {
      expect(loadoutSlotDefsForShipType(hull).some((d) => d.slotType === "module")).toBe(UNIVERSAL_MODULES_LIVE);
      expect(loadoutSlotDefsForShipType(hull, true).filter((d) => d.slotType === "module").length).toBe(SHIP_TYPES[hull].moduleSlots);
    }
  });

  it("validation refuses a category or key with no engine, a malformed conditional, and a shared engine key (D23)", () => {
    expect(validateUniversalModuleDef(TEST_CAPACITOR)).toEqual([]);
    expect(validateUniversalModuleDef(TEST_BRACING)).toEqual([]);
    expect(validateUniversalModuleDef(TEST_LAST_STAND)).toEqual([]);
    // EM-6 built the proc engine, so a proc now fails only on a key it does not read; EM-7 built the Set engine, so a
    // set fails only on a key it does not read (its own rules: shipModuleRoster.test.ts).
    const proc: UniversalModuleDef = { ...TEST_CAPACITOR, id: "p", category: "proc", contexts: ["patrol"], trigger: { kind: "onHit" }, chance: 0.15 };
    expect(validateUniversalModuleDef(proc).join()).toMatch(/the proc engine does not read powerOutput/);
    const set: UniversalModuleDef = { ...TEST_BRACING, id: "s", category: "set", setId: "testSet" };
    expect(validateUniversalModuleDef(set).join()).toMatch(/the set engine does not read hullIntegrity/);
    expect(validateUniversalModuleDef({ ...TEST_CAPACITOR, id: "w", effect: { key: "weaponDamage", magnitude: 0.1 } }).join()).toMatch(/does not read weaponDamage/);
    expect(validateUniversalModuleDef({ ...TEST_LAST_STAND, id: "c", condition: undefined }).join()).toMatch(/needs a condition/);
    expect(validateUniversalModuleDef({ ...TEST_LAST_STAND, id: "c", contexts: ["mission"] }).join()).toMatch(/combat only/);
    expect(validateUniversalModuleDef({ ...TEST_BRACING, id: "b", contexts: ["expedition"] }).join()).toMatch(/combat only/);
    expect(validateUniversalModuleCatalog([TEST_CAPACITOR, { ...TEST_CAPACITOR, id: "second" }]).join()).toMatch(/diminishing curve first/);
    expect(validateUniversalModuleCatalog([TEST_CAPACITOR, TEST_BRACING, TEST_LAST_STAND])).toEqual([]);
  });

  it("the Quartermaster issues no Standard-Issue module, and modules wear slowly underway (M9)", () => {
    expect(REQUISITION_CATALOGUE.module).toBeNull();
    // Gear wear step 3: at the approved crew module rate (4 a minute), so it outruns the 2 a minute underway upkeep.
    expect(WEAR_SOURCES.filter((w) => w.slot === "module").map((w) => [w.id, w.mode, w.raw])).toEqual([["module:minutesUnderway", "use", 4]]);
    expect(WEAR_EFFICIENCY.some((w) => w.slot === "module" && w.combat)).toBe(true);
  });
});

describe("the registry move (emodEm5Registry.fixture.ts reads it back for the earlier pins)", () => {
  it("adds the two module wear rows (pending on gear wear) and re-owns every hull's moduleSlots to EM-7 (live since EM-7)", () => {
    const added = WIRING_REGISTRY.filter((e) => EM5_ADDED_ENTRY_IDS.has(e.id));
    expect(added.map((e) => e.id).sort()).toEqual([...EM5_ADDED_ENTRY_IDS].sort());
    // Gear wear step 3 wired the use source live (a module wears by time underway); its efficiency (combat) is step 4's.
    expect(added.map((e) => `${e.id}|${e.status.kind}`).sort()).toEqual(["wear:WEAR_EFFICIENCY:module:effect|pending", "wear:WEAR_SOURCES:module:minutesUnderway|live"]);
    const slots = WIRING_REGISTRY.filter((e) => EM5_MODULE_SLOTS_IDS.has(e.id));
    expect(slots).toHaveLength(HULLS.length);
    // EM-7 took them live (the slot is shown; the install gate's count is measured): emodEm7Registry.fixture.ts reads
    // the EM-5 state back for the earlier pins.
    for (const e of slots) expect([e.status, e.probe, e.contexts]).toEqual([{ kind: "live" }, `content:moduleInstalls:${e.source.key.split(":")[0]}`, ["sheet"]]);
  });
});

describe("the mint path", () => {
  it("a module mints with its catalog id stamped, its def's draw, no mass and no stat lines", () =>
    withTestModules([TEST_BRACING], () => {
      const piece = mintTestModule(TEST_BRACING, "radiant", 3);
      expect(piece.slotType).toBe("module");
      expect(piece.moduleVariant).toBe(TEST_BRACING.id);
      expect(piece.powerDraw).toBe(TEST_BRACING.powerDraw);
      expect(piece.mass).toBe(0);
      expect(piece.implicitStats).toEqual({});
      expect(piece.rolledStats).toEqual({});
      expect(pieceModuleDef(piece)).toBe(TEST_BRACING);
    }));

  it("a module round-trips through a save (optional fields only, no migration step)", () =>
    withTestModules([TEST_BRACING], () => {
      const piece = { ...mintTestModule(TEST_BRACING, "stellar", 2, "equip-9001"), fittedToShipId: SHIP };
      const s = withPieces(hullState("destroyer"), [piece]);
      const back = migrate(deserialize(serialize(s, 1))!);
      expect(back.equipment.find((e) => e.id === "equip-9001")).toEqual(piece);
      // A module whose id this build does not know keeps its slot and acts as nothing.
      const stray = { ...piece, id: "equip-9002", moduleVariant: "retiredModule" };
      expect(pieceModuleDef(stray)).toBeUndefined();
      expect(modulePowerOutput([stray], scaleOf)).toBe(0);
    }));
});

describe("the shared module slots (M1: moduleSlots caps the modules and the Spec Utility)", () => {
  for (const hull of HULLS) {
    it(`${hull}: ${SHIP_TYPES[hull].moduleSlots} slots, the next module refused, the Spec Utility counted`, () =>
      withTestModules(TEST_FILLERS, () => {
        const cap = SHIP_TYPES[hull].moduleSlots;
        const fillers = TEST_FILLERS.map((d) => mintTestModule(d));
        // No Spec Utility: exactly `cap` modules install, the next is refused.
        const bare = installAll(withoutUtility(hullState(hull)), fillers);
        expect(bare.verdicts).toEqual(fillers.map((_, i) => (i < cap ? "ok" : "moduleSlotsFull")));
        expect(moduleSlotsUsed(equippedFor(bare.state, SHIP))).toBe(cap);
        // A Spec Utility into the EMPTY slot of a full ship is refused too; it installs once a module comes off.
        const util = generateStandardIssue({ slotType: "specUtility", fittedToShipId: null, allocateId: () => "test-util" });
        const full = withPieces(bare.state, [util]);
        const canUtility = (s: GameState) => {
          const v = canFitEquipment(s, SHIP, util.id);
          return v.ok ? "ok" : v.reason;
        };
        expect(["moduleSlotsFull", "hullSpec"]).toContain(canUtility(full));
        const freed = unfitEquipmentInstance(full, SHIP, equippedFor(full, SHIP).find((e) => e.slotType === "module")!.id);
        expect(["ok", "hullSpec"]).toContain(canUtility(freed));
        // With the Spec Utility aboard, one module slot fewer; EM-7 review: except on a hull with no Spec Utility slot
        // (the Freighter's seeded Standard-Issue utility fills nothing it cannot remove).
        const s = hullState(hull);
        if (utilityOf(s)) {
          const withUtil = installAll(s, TEST_FILLERS.map((d) => mintTestModule(d)));
          expect(withUtil.verdicts.filter((v) => v === "ok").length).toBe(hullHasSpecUtilitySlot(SHIP_TYPES[hull].spec) ? cap - 1 : cap);
        }
      }));
  }

  it("a Spec Utility swap always installs (the singleton swap moves the old one out), a full ship included", () =>
    withTestModules(TEST_FILLERS, () => {
      const hull: ShipTypeKey = "prospectorMiner";
      const s0 = hullState(hull);
      expect(utilityOf(s0)).toBeDefined();
      const filled = installAll(s0, TEST_FILLERS.map((d) => mintTestModule(d))).state;
      expect(moduleSlotsUsed(equippedFor(filled, SHIP))).toBe(SHIP_TYPES[hull].moduleSlots);
      const spare = generateStandardIssue({ slotType: "specUtility", fittedToShipId: null, allocateId: () => "test-util-2" });
      expect(canFitEquipment(withPieces(filled, [spare]), SHIP, spare.id)).toEqual({ ok: true });
    }));

  it("the sharing set is exactly the module and the Spec Utility; the bridge, quarters and sensor never count", () => {
    expect([...MODULE_SLOT_SHARING_TYPES].sort()).toEqual(["module", "specUtility"]);
    expect(moduleSlotsUsed([{ slotType: "bridge" }, { slotType: "quarters" }, { slotType: "sensor" }])).toBe(0);
  });
});

describe("one copy per ship (M8)", () => {
  it("a second copy of a module is refused; a different module or a targeted swap of a copy for itself is not", () =>
    withTestModules([TEST_BRACING, TEST_LAST_STAND], () => {
      const s0 = withoutUtility(hullState("orion"));
      const a = mintTestModule(TEST_BRACING, "standard", 0, "test-a");
      const b = mintTestModule(TEST_BRACING, "radiant", 5, "test-b");
      const c = mintTestModule(TEST_LAST_STAND, "standard", 0, "test-c");
      const { state, verdicts } = installAll(s0, [a, b, c]);
      expect(verdicts).toEqual(["ok", "duplicateModule", "ok"]);
      // Swapping the installed copy out for the better copy is a legal targeted swap.
      expect(canFitEquipment(state, SHIP, "test-b", "test-a")).toEqual({ ok: true });
      const swapped = fitEquipment(state, SHIP, "test-b", "test-a");
      expect(equippedFor(swapped, SHIP).filter((e) => e.slotType === "module").map((e) => e.id).sort()).toEqual(["test-b", "test-c"]);
      // The item-side Install on... list says why on the ship it cannot go to. EM-7 (user 2026-10-26, "Armory loadouts
      // only"): until EM-10 every ship is refused for a module there, the gate's own reason still duplicateModule.
      expect(installTargetsFor(state, "test-b").find((t) => t.kind === "ship" && t.shipId === SHIP)).toMatchObject({ ok: false, refusal: { reason: "moduleArmoryOnly" } });
      expect(canFitEquipment(state, SHIP, "test-b")).toEqual({ ok: false, reason: "duplicateModule" });
    }));

  it("the Armory refuses a duplicate and an overfull set inside a loadout", () =>
    withTestModules([...TEST_FILLERS, TEST_BRACING], () => {
      const hull: ShipTypeKey = "prospectorRunner"; // 2 module slots, a Spec Utility slot
      const made = createLoadout(hullState(hull), hull, "EM-5");
      const id = made.loadoutId!;
      const a = mintTestModule(TEST_BRACING, "standard", 0, "test-la");
      const b = mintTestModule(TEST_BRACING, "standard", 0, "test-lb");
      const f = mintTestModule(TEST_FILLERS[0], "standard", 0, "test-lf");
      const u = generateStandardIssue({ slotType: "specUtility", fittedToShipId: null, allocateId: () => "test-lu" });
      const s = withPieces(made.next, [a, b, f, u]);
      expect(loadoutSlotDefsForShipType(hull, true).filter((d) => d.slotType === "module").map((d) => d.key)).toEqual(["module0", "module1"]);
      // While the slot is hidden the loadout offers no module slot at all.
      if (!UNIVERSAL_MODULES_LIVE) expect(installIntoLoadout(s, id, "module0", a.id)).toBe(s);
      // The rule installIntoLoadout applies, on a loadout holding one Bracing in module0.
      const loadout = { ...s.loadouts.find((l) => l.id === id)!, slots: { module0: a.id } };
      expect(loadoutModuleRuleBroken(s, loadout, "module1", b)).toBe(true); // one per set
      expect(loadoutModuleRuleBroken(s, loadout, "module0", b)).toBe(false); // replacing the copy in its own slot
      expect(loadoutModuleRuleBroken(s, loadout, "module1", f)).toBe(false); // 2 of 2 slots
      const withUtil = { ...loadout, slots: { ...loadout.slots, specUtility: u.id } };
      expect(loadoutModuleRuleBroken(s, withUtil, "module1", f)).toBe(true); // the Spec Utility shares the two
      expect(loadoutModuleRuleBroken(s, withUtil, "specUtility", u)).toBe(false); // re-committing it is no new slot
      const twoModules = { ...loadout, slots: { module0: a.id, module1: f.id } };
      expect(loadoutModuleRuleBroken(s, twoModules, "specUtility", u)).toBe(true);
      // The real Armory install of a Spec Utility (a slot that exists today) is unchanged with no module in the set.
      expect(installIntoLoadout(s, id, "specUtility", u.id)).not.toBe(s);
    }));
});

describe("the S2 lock: modules wait while the ship is out", () => {
  it("an expedition locks module installs and removals (onMission), and every other slot's gear too (S2 shipGearLock)", () =>
    withTestModules([TEST_BRACING], () => {
      const m = mintTestModule(TEST_BRACING, "standard", 0, "test-s2");
      const home = installAll(withoutUtility(hullState("orion")), [m]).state;
      const spare = mintTestModule(TEST_BRACING, "standard", 0, "test-s2b");
      const out = { ...withPieces(home, [spare]), expeditions: [{ shipId: SHIP } as unknown as GameState["expeditions"][number]] };
      expect(canFitEquipment(out, SHIP, "test-s2b", "test-s2")).toEqual({ ok: false, reason: "onMission", lock: "onExpedition" });
      expect(() => unfitEquipmentInstance(out, SHIP, "test-s2")).toThrow(/onMission/);
      // The dev panel's slot-targeted uninstall honors it too, and at home takes the module off without minting.
      expect(() => unfitEquipment(out, SHIP, "module")).toThrow(/onMission/);
      const off = unfitEquipment(home, SHIP, "module");
      expect(off.equipment.find((e) => e.id === "test-s2")?.fittedToShipId).toBeNull();
      expect(off.nextEquipmentId).toBe(home.nextEquipmentId);
      expect(unfitEquipment(off, SHIP, "module")).toBe(off);
      // S1 / S2 merged: the one gear lock (equipment.ts shipGearLock) holds every slot, a cargo bay too.
      const cargo = equippedFor(out, SHIP).find((e) => e.slotType === "cargoBay")!;
      expect(() => unfitEquipmentInstance(out, SHIP, cargo.id)).toThrow(/onMission/);
    }));
});

describe("Passive engines: each passive moves its value; no module moves nothing", () => {
  it("power output: the sheet, the totals and the budget rise by the scaled magnitude; the reactor's share does not", () =>
    withTestModules([TEST_CAPACITOR], () => {
      const s0 = withoutUtility(hullState("orion"));
      const piece = mintTestModule(TEST_CAPACITOR, "stellar", 2, "test-cap");
      const s1 = installAll(s0, [piece]).state;
      const add = Math.round(TEST_CAPACITOR.effect.magnitude * moduleEffectScale("stellar", 2));
      expect(add).toBeGreaterThan(TEST_CAPACITOR.effect.magnitude); // rarity and quality scale it
      const ship = (s: GameState) => s.ships.find((x) => x.id === SHIP)!;
      expect(shipDerivedStats(ship(s1), equippedFor(s1, SHIP)).powerOutput).toBe(shipDerivedStats(ship(s0), equippedFor(s0, SHIP)).powerOutput + add);
      expect(effectiveShipStats(s1, ship(s1)).powerOutput).toBe(effectiveShipStats(s0, ship(s0)).powerOutput + add);
      expect(shipPowerTotals(s1, SHIP).output).toBe(shipPowerTotals(s0, SHIP).output + add);
      const b0 = shipPowerBudget(s0, SHIP);
      const b1 = shipPowerBudget(s1, SHIP);
      expect(b1.output).toBe(b0.output + add);
      expect(b1.moduleOutput).toBe(add);
      expect(b1.reactorOutput).toBe(b0.reactorOutput);
      expect(b1.reactorSurplus).toBe(b0.reactorSurplus);
    }));

  it("power draw: a module's def draw joins the budget, so the install gate binds on modules", () =>
    withTestModules([{ ...TEST_BRACING, powerDraw: 500 }], () => {
      const s0 = withoutUtility(hullState("orion"));
      const piece = { ...mintTestModule({ ...TEST_BRACING, powerDraw: 500 }, "standard", 0, "test-heavy") };
      expect(piece.powerDraw).toBe(500);
      const v = canFitEquipment(withPieces(s0, [piece]), SHIP, piece.id);
      expect(v.ok).toBe(false);
      expect(!v.ok && v.reason).toBe("overPower");
      expect(shipPowerBudget(s0, SHIP, { piece }).grossDraw).toBe(shipPowerBudget(s0, SHIP).grossDraw + 500);
    }));

  it("hull integrity: the combat hull pool rises by the scaled fraction, rounded, in every fold that reads gear", () =>
    withTestModules([TEST_BRACING], () => {
      const s0 = withoutUtility(hullState("destroyer"));
      const s1 = installAll(s0, [mintTestModule(TEST_BRACING, "augmented", 1, "test-brace")]).state;
      const fold = (s: GameState) => shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, installedGear: equippedFor(s, SHIP) });
      const lift = TEST_BRACING.effect.magnitude * moduleEffectScale("augmented", 1);
      expect(fold(s1).hullMax).toBe(Math.round(fold(s0).hullMax * (1 + lift)));
      expect(fold(s1).hull).toBe(fold(s1).hullMax);
      expect(foldedPlayerDefense(SHIP_TYPES.destroyer, equippedFor(s1, SHIP)).hullMax).toBe(fold(s1).hullMax);
      // Everything else on the combatant is untouched.
      const { hull: _h1, hullMax: _m1, ...rest1 } = fold(s1);
      const { hull: _h0, hullMax: _m0, ...rest0 } = fold(s0);
      expect(rest1).toEqual(rest0);
    }));

  it("a patrol fights with the module (the hull pool seeds from it) and the live loop and the replay agree", { timeout: 60_000 }, () =>
    withTestModules([TEST_BRACING, TEST_LAST_STAND], () => {
      const base = withoutUtility(hullState("destroyer"));
      const fitted = installAll(base, [mintTestModule(TEST_BRACING, "radiant", 5, "test-pb"), mintTestModule(TEST_LAST_STAND, "radiant", 5, "test-pl")]).state;
      const run = (s0: GameState) => {
        let s = dispatchCaptainOnPatrol({ ...s0, nextPatrolSeed: 7 }, 1, "crimsonReaverWarband", "balanced", false).next;
        const m0 = s.captains[0].mission as PatrolMissionState;
        const start = m0.playerHull;
        for (let i = 0; i < 1500; i++) {
          const m = s.captains[0].mission as PatrolMissionState | null;
          if (m === null || m.wavesWon + m.wavesLost >= m.waveTicks.length || m.phase === "limpingHome") break;
          s = economyTick(s, 1, () => 0.5);
        }
        return { s, start };
      };
      const without = run(base);
      const withModules = run(fitted);
      expect(withModules.start).toBeGreaterThan(without.start); // the folded hull pool carries the Bracing
      const live = withModules.s.captains[0].mission as PatrolMissionState | null;
      if (live !== null) {
        const replay = replayPatrol(withModules.s, withModules.s.captains[0]);
        expect(replay.waves.length).toBe(live.wavesWon + live.wavesLost);
        if (!replay.defeated) expect(replay.finalPlayerHull).toBe(live.playerHull);
      }
    }));

  it("no module: the stat fold reports 0 and the combat fold writes nothing", () => {
    const s = hullState("battleship");
    const gear = equippedFor(s, SHIP);
    expect(modulePowerOutput(gear, scaleOf)).toBe(0);
    expect(moduleConditionals(gear, scaleOf, "patrol")).toEqual([]);
    const c = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.battleship, installedGear: gear });
    const before = JSON.stringify(c);
    applyModuleCombat(c, gear, "patrol");
    applyModuleCombat(c, undefined, "patrol");
    expect(JSON.stringify(c)).toBe(before);
    expect(c.moduleConditionals).toBeUndefined();
  });
});

describe("contexts: a module acts only where it says it does", () => {
  it("a patrol-only module lifts a patrol combatant but never a ship event's (and the reverse)", () => {
    const patrolOnly: UniversalModuleDef = { ...TEST_BRACING, id: "testModulePatrolBrace", contexts: ["patrol"] };
    const eventOnly: UniversalModuleDef = { ...TEST_LAST_STAND, id: "testModuleEventLast", contexts: ["shipEvent"] };
    withTestModules([patrolOnly, eventOnly], () => {
      const s = installAll(withoutUtility(hullState("destroyer")), [mintTestModule(patrolOnly, "standard", 0, "test-cp"), mintTestModule(eventOnly, "standard", 0, "test-ce")]).state;
      const gear = equippedFor(s, SHIP);
      const bare = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, installedGear: equippedFor(withoutUtility(hullState("destroyer")), SHIP) });
      const patrol = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, installedGear: gear });
      const event = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, installedGear: gear, moduleContext: "shipEvent" });
      expect(patrol.hullMax).toBe(Math.round(bare.hullMax * (1 + patrolOnly.effect.magnitude)));
      expect(patrol.moduleConditionals).toBeUndefined();
      expect(event.hullMax).toBe(bare.hullMax);
      expect(event.moduleConditionals).toEqual([{ pool: "hull", fraction: 0.25, weaponDamage: 0.12 }]);
      // The patrol carry pools read the patrol context too.
      expect(foldedPlayerDefense(SHIP_TYPES.destroyer, gear).hullMax).toBe(patrol.hullMax);
    });
  });

  it("the expedition ship event snapshot carries the modules and folds them in the ship event context", () =>
    withTestModules([TEST_BRACING], () => {
      const s = installAll(withoutUtility(hullState("orion")), [mintTestModule(TEST_BRACING, "standard", 0, "test-se")]).state;
      const profile = snapshotShipEventProfile(s, s.ships.find((x) => x.id === SHIP)!);
      expect(profile.battle!.installedGear!.some((p) => p.slotType === "module")).toBe(true);
      const bare = snapshotShipEventProfile(withoutUtility(hullState("orion")), s.ships.find((x) => x.id === SHIP)!);
      expect(profile.battle!.hullMax).toBe(Math.round(bare.battle!.hullMax * (1 + TEST_BRACING.effect.magnitude)));
    }));

  it("power output acts on the ship sheet, so only a module listing every context lifts it (and validation says so)", () => {
    const narrow: UniversalModuleDef = { ...TEST_CAPACITOR, id: "testModuleNarrowCap", contexts: ["patrol"] };
    expect(validateUniversalModuleDef(narrow).join()).toMatch(/must list every context/);
    withTestModules([narrow, TEST_CAPACITOR], () => {
      expect(modulePowerOutput([mintTestModule(narrow)], scaleOf)).toBe(0);
      expect(modulePowerOutput([mintTestModule(TEST_CAPACITOR)], scaleOf)).toBe(TEST_CAPACITOR.effect.magnitude);
    });
  });
});

describe("Conditional engine: fires only in its state", () => {
  const hullType = combatHullTypeOf("destroyer")!;
  const target = () => shipToCombatant({ id: "t", team: "enemy", stats: SHIP_TYPES.battleship, hullType: combatHullTypeOf("battleship")! });

  it("below the hull threshold every shot hits harder; at or above it, byte-identical", () =>
    withTestModules([TEST_LAST_STAND], () => {
      const gear = [{ ...mintTestModule(TEST_LAST_STAND, "standard", 0, "test-ls"), fittedToShipId: SHIP }];
      const mk = (withModule: boolean, hullFrac: number) => {
        const c = shipToCombatant({ id: "a", team: "player", stats: SHIP_TYPES.destroyer, hullType });
        if (withModule) applyModuleCombat(c, gear, "patrol");
        c.hull = Math.floor(c.hullMax * hullFrac);
        return c;
      };
      expect(mk(true, 1).moduleConditionals).toEqual([{ pool: "hull", fraction: 0.25, weaponDamage: 0.12 }]);
      let above = 0;
      let aboveMod = 0;
      let atThreshold = 0;
      let atThresholdMod = 0;
      let below = 0;
      let belowMod = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const shot = (c: ReturnType<typeof mk>) => fireWeapon(c, target(), c.weapons[0], makeRng(seed)).damage;
        above += shot(mk(false, 0.9));
        aboveMod += shot(mk(true, 0.9));
        atThreshold += shot(mk(false, 0.25));
        atThresholdMod += shot(mk(true, 0.25));
        below += shot(mk(false, 0.2));
        belowMod += shot(mk(true, 0.2));
      }
      expect(above).toBeGreaterThan(0);
      expect(aboveMod).toBe(above);
      expect(atThresholdMod).toBe(atThreshold); // strictly below only
      expect(belowMod).toBeGreaterThan(below);
    }));

  it("a whole battle: identical while the hull holds, different when it fights below the threshold", () =>
    withTestModules([TEST_LAST_STAND], () => {
      const gear = [{ ...mintTestModule(TEST_LAST_STAND, "standard", 0, "test-ls2"), fittedToShipId: SHIP }];
      const fight = (withModule: boolean, hullFrac: number) => {
        const p = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, hullType });
        if (withModule) applyModuleCombat(p, gear, "patrol");
        p.hull = Math.floor(p.hullMax * hullFrac);
        p.shield = 0;
        const e = shipToCombatant({ id: "e", team: "enemy", stats: SHIP_TYPES.destroyer, hullType });
        return JSON.stringify(resolveBattle({ combatants: [p, e] }, 4242, { generateLog: true }).log);
      };
      expect(fight(true, 0.2)).not.toBe(fight(false, 0.2));
      // A shield-pool conditional reads the shield pool, not the hull.
      const shieldDef: UniversalModuleDef = { ...TEST_LAST_STAND, id: "testModuleShieldLow", condition: { kind: "shieldBelow", fraction: 0.5 } };
      withTestModules([shieldDef], () => {
        const g = [{ ...mintTestModule(shieldDef, "standard", 0, "test-sh"), fittedToShipId: SHIP }];
        const c = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, hullType });
        applyModuleCombat(c, g, "patrol");
        expect(c.moduleConditionals).toEqual([{ pool: "shield", fraction: 0.5, weaponDamage: 0.12 }]);
      });
    }));
});
