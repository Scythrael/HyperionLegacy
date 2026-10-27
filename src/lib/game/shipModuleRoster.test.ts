// E-MOD EM-7 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-7): the v1 universal
// module roster (user M6, 2026-10-19, "Approve all"), its blueprints (Lab tiers 2 to 4, Material Lines recipes, user M7)
// and the Survey Pair, the first module set of the shared set engine (gearSets.ts, RR-6). Each module mints, installs
// through the real gate, and acts in its context only; rarity, quality and ascension scale every effect; nothing a
// player could already own moves.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  BLUEPRINTS,
  EQUIPMENT_SLOTS,
  ITEMS,
  MODULE_BLUEPRINTS,
  SHIP_TYPES,
  freshState,
  moduleEffectScale,
  shipDerivedStats,
  shipGearSetBonusLines,
  type EquipmentInstance,
  type EquipmentRarity,
  type GameState,
  type ShipTypeKey,
} from "./model";
import { dispatchCaptainOnMission, economyTick, inspectBlank, installMissingCombatBaselines, missionCycleModulesFor, startLine, startResearch, tick } from "./tick";
import { applyModuleCombat, combatHullTypeOf, shipToCombatant } from "./combat/bridge";
import { fireWeapon, resolveBattle } from "./combat/resolveBattle";
import { makeRng } from "./combat/rng";
import type { Combatant, CombatEvent } from "./combat/types";
import { canFitEquipment, equippedFor, fitEquipment, unfitEquipmentInstance } from "./equipment";
import { installTargetsFor } from "./memberEquipment";
import { checkInLoadout, checkOutLoadout, createLoadout, installIntoLoadout, uninstallFromLoadout } from "./armory";
import { shipPowerBudget } from "./shipPower";
import { effectiveShipStats } from "./crewOverlay";
import { expeditionGearBonuses } from "./expedition";
import { loadoutSlotDefsForShipType } from "./armory";
import { isSparePiece } from "./model";
import { archivableBlueprints, archiveItem } from "./archive";
import { salvageEquipment } from "./salvage";
import { itemTotal } from "./inventory";
import { GEAR_SETS, activeGearSetTiers, gearSetDef } from "./gearSets";
import { wornPieceView } from "./gearWear";
import {
  MODULE_ENGINE_KEYS,
  MODULE_INSTALL_ARMORY_ONLY,
  MODULE_V1_NUMBERS,
  hullHasSpecUtilitySlot,
  moduleArmoryOnlyReasonText,
  moduleSlotsFullReasonText,
  moduleSlotsUsed,
  SURVEY_PAIR_SET_ID,
  UNIVERSAL_MODULES,
  UNIVERSAL_MODULES_LIVE,
  universalModuleDef,
  validateUniversalModuleCatalog,
  validateUniversalModuleDef,
  type UniversalModuleDef,
} from "./shipModules";
import { mintTestModule } from "./shipModulesTest.fixture";
import { dispatchRun, holding, withFacilityLevel } from "./wiring/probes";
import { WIRING_REGISTRY } from "./wiring/registry";
import { EM7_ADDED_ENTRY_IDS, EM7_MODULE_SLOTS_IDS } from "./emodEm7Registry.fixture";
import { moduleEffectSentence, moduleKindText, moduleRuleText, pieceModuleLines } from "../ui/moduleEffectText";
import { ICON_PATHS } from "../ui/icons";
import { ICON_SEMANTICS } from "../ui/iconPacks";

const SHIP = "ship-1";
const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const def = (id: string): UniversalModuleDef => universalModuleDef(id)!;
const scaleOf = (p: EquipmentInstance) => moduleEffectScale(p.rarity, p.quality, p.ascension);

function hullState(hull: ShipTypeKey): GameState {
  const base = freshState();
  return installMissingCombatBaselines({ ...base, credits: new Decimal(1_000_000), ships: base.ships.map((sh) => (sh.id === SHIP ? { ...sh, typeKey: hull } : sh)) });
}
function withoutUtility(s: GameState): GameState {
  const u = equippedFor(s, SHIP).find((e) => e.slotType === "specUtility");
  return u ? unfitEquipmentInstance(s, SHIP, u.id) : s;
}
// Install `pieces` through the real gate (each verdict must be ok).
function installAll(s0: GameState, pieces: EquipmentInstance[]): GameState {
  let s: GameState = { ...s0, equipment: [...s0.equipment, ...pieces] };
  for (const p of pieces) {
    const v = canFitEquipment(s, SHIP, p.id);
    expect(v.ok, v.ok ? p.id : `${p.id}: ${v.reason}`).toBe(true);
    s = fitEquipment(s, SHIP, p.id);
  }
  return s;
}
const mint = (id: string, rarity: EquipmentRarity = "standard", quality = 0, pieceId?: string) => mintTestModule(def(id), rarity, quality, pieceId ?? `roster-${id}-${rarity}-${quality}`);

describe("the roster (user M6 'Approve all': the eight rows as named, with those effects)", () => {
  it("names, categories, contexts and engine keys are the approved rows; the catalog validates", () => {
    expect(UNIVERSAL_MODULES.map((d) => [d.id, d.label, d.category, d.effect.key])).toEqual([
      ["auxiliaryCapacitor", "Auxiliary Capacitor", "passive", "powerOutput"],
      ["structuralBracing", "Structural Bracing", "passive", "hullIntegrity"],
      ["arcDischarger", "Arc Discharger", "proc", "arcDamage"],
      ["prospectorsEcho", "Prospector's Echo", "proc", "bonusHaul"],
      ["lastStandProtocol", "Last Stand Protocol", "conditional", "weaponDamage"],
      ["shieldSurge", "Shield Surge", "active", "shieldRestore"],
      ["longBaselineArray", "Long-Baseline Array", "set", "scanSpeedBonus"],
      ["signalIntegrator", "Signal Integrator", "set", "scanSpeedBonus"],
      // Gas Giant Study GG-7 (user call 11, "Three now"): the Ramscoop Collector, a special blueprint's module.
      ["ramscoopCollector", "Ramscoop Collector", "passive", "nebulaSweep"],
    ]);
    expect(validateUniversalModuleCatalog()).toEqual([]);
    // The approved shapes: on a hit taken; each extraction cycle; below 25% hull; once per battle below 50% hull.
    expect(def("arcDischarger").trigger).toEqual({ kind: "onHit" });
    expect(def("prospectorsEcho")).toMatchObject({ trigger: { kind: "missionCycle" }, contexts: ["mission"] });
    expect(def("lastStandProtocol").condition).toEqual({ kind: "hullBelow", fraction: 0.25 });
    expect(def("shieldSurge")).toMatchObject({ trigger: { kind: "hullBelow", fraction: 0.5 }, oncePerBattle: true });
    expect(def("shieldSurge").effect.magnitude).toBe(0.3);
    // M5 unique effects only: no module reads a generic gear line.
    for (const d of UNIVERSAL_MODULES) expect(MODULE_ENGINE_KEYS[d.category], d.id).toContain(d.effect.key);
  });

  it("the module slot's varieties are the catalog; one blueprint each on Lab tiers 2 to 4; the switch is on", () => {
    expect(EQUIPMENT_SLOTS.module.varieties.map((v) => [v.key, v.label])).toEqual(UNIVERSAL_MODULES.map((d) => [d.id, d.label]));
    // GG-7: the Ramscoop Collector's blueprint is a special blueprint (model.ts GAS_GIANT_BLUEPRINTS, gasGiantSpecials.test.ts),
    // so the EM-7 roster rows below are the others.
    const all = Object.values(BLUEPRINTS).filter((b) => b.equipmentOutput?.slotType === "module");
    expect(all.map((b) => b.equipmentOutput!.varietyKey).sort()).toEqual(UNIVERSAL_MODULES.map((d) => d.id).sort());
    const bps = all.filter((b) => b.key !== "ramscoopCollectorBp");
    for (const b of bps) {
      expect(b).toBe(MODULE_BLUEPRINTS[b.key]);
      expect([2, 3, 4], b.key).toContain(b.tier);
      expect(b.requiresRelicDiscovery, b.key).toBeUndefined();
      // No number in the flavor: the effect line on the card carries the numbers (OC-K3).
      expect(b.flavor ?? "", b.key).not.toMatch(/\d/);
    }
    expect(Object.fromEntries(bps.map((b) => [b.equipmentOutput!.varietyKey, b.tier]))).toEqual({
      auxiliaryCapacitor: 2,
      structuralBracing: 2,
      prospectorsEcho: 2,
      arcDischarger: 3,
      lastStandProtocol: 3,
      longBaselineArray: 3,
      signalIntegrator: 3,
      shieldSurge: 4,
    });
    expect(UNIVERSAL_MODULES_LIVE).toBe(true);
    for (const hull of HULLS) expect(loadoutSlotDefsForShipType(hull).filter((d) => d.slotType === "module").length, hull).toBe(SHIP_TYPES[hull].moduleSlots);
  });

  it("recipes are the realism audit's (section 10), on real Material Lines items (user M7)", () => {
    const recipe = (id: string) => BLUEPRINTS[`${id}Bp`].recipe.inputs;
    expect(recipe("auxiliaryCapacitor")).toEqual({ powerCoupling: 2, reclaimedCircuit: 2, polysilicateWafer: 1 });
    expect(recipe("structuralBracing")).toEqual({ ferriteIngot: 2, frameSegment: 2 });
    expect(recipe("arcDischarger")).toEqual({ cobaltCoil: 2, powerCoupling: 1 });
    expect(recipe("prospectorsEcho")).toEqual({ photonicGel: 1, reclaimedCircuit: 2 });
    expect(recipe("lastStandProtocol")).toEqual({ reclaimedCircuit: 2, polysilicateWafer: 2 });
    // User 2026-10-26 ("Add Iridium Catalyst", M7 "Iridium Catalyst for the top tier"): the tier 4 Active takes one.
    expect(recipe("shieldSurge")).toEqual({ powerCoupling: 2, cobaltCoil: 1, reclaimedCircuit: 1, iridiumCatalyst: 1 });
    expect(recipe("longBaselineArray")).toEqual({ photonicGel: 2, frameSegment: 1 });
    expect(recipe("signalIntegrator")).toEqual({ reclaimedCircuit: 2, polysilicateWafer: 1 });
    for (const d of UNIVERSAL_MODULES) for (const item of Object.keys(recipe(d.id))) expect(ITEMS[item], `${d.id}: ${item}`).toBeDefined();
  });

  it("the Survey Pair is a module set of the ONE set engine; its pieces' bonus is its tier's", () => {
    const set = gearSetDef(SURVEY_PAIR_SET_ID)!;
    expect(set).toMatchObject({ label: "Survey Pair", scope: "ship", slotTypes: [], moduleSet: true });
    expect(set.tiers).toEqual([{ pieces: 2, stat: "scanSpeedBonus", magnitude: MODULE_V1_NUMBERS.surveyPair.scanSpeedBonus }]);
    for (const d of UNIVERSAL_MODULES.filter((x) => x.category === "set")) {
      expect(gearSetDef(d.setId), d.id).toBeDefined();
      const tier = gearSetDef(d.setId)!.tiers[0];
      expect([d.effect.key, d.effect.magnitude], d.id).toEqual([tier.stat, tier.magnitude]);
    }
    expect(GEAR_SETS.filter((s) => s.moduleSet === true).map((s) => s.id)).toEqual([SURVEY_PAIR_SET_ID]);
  });

  it("the set rules refuse a set module with no set, the wrong context, or a second set on one bonus (D23)", () => {
    const lba = def("longBaselineArray");
    const v = (d: UniversalModuleDef) => validateUniversalModuleDef(d).join();
    expect(v({ ...lba, setId: undefined })).toMatch(/needs a setId/);
    expect(v({ ...lba, contexts: ["patrol"] })).toMatch(/acts in expedition only/);
    expect(v({ ...lba, effect: { key: "scanSpeedBonus", magnitude: 2 } })).toMatch(/fraction in \(0, 1\]/);
    expect(v({ ...def("structuralBracing"), setId: SURVEY_PAIR_SET_ID })).toMatch(/only a set module carries a setId/);
    expect(validateUniversalModuleCatalog([lba, { ...lba, id: "x", setId: "another" }]).join()).toMatch(/a second set on scanSpeedBonus/);
  });
});

describe("the mint, the player path and the item card", () => {
  it("every module mints with its id stamped, its def's draw, no mass and no stat lines, at every live band", () => {
    for (const d of UNIVERSAL_MODULES) {
      for (const rarity of ["standard", "augmented", "stellar", "radiant"] as const) {
        const p = mint(d.id, rarity, 3);
        expect([p.slotType, p.moduleVariant, p.powerDraw, p.mass, p.implicitStats, p.rolledStats, p.rarity], `${d.id} ${rarity}`).toEqual(["module", d.id, d.powerDraw, 0, {}, {}, rarity]);
      }
    }
  });

  it("research, craft, inspect, install: a Structural Bracing reaches a Destroyer's combat hull through the real path", () => {
    const key = "structuralBracingBp";
    const bp = BLUEPRINTS[key];
    let s: GameState = { ...withFacilityLevel(withFacilityLevel(hullState("destroyer"), "research", bp.tier), "fabricator", bp.tier), credits: new Decimal(1e9) };
    const r = startResearch(s, key);
    expect(r.started).toBe(true);
    s = r.next;
    for (let i = 0; i < bp.researchDurationTicks + 2; i++) s = economyTick(s, 1, () => 0.5);
    expect(s.researchedBlueprints).toContain(key);
    for (const [item, qty] of Object.entries(bp.recipe.inputs)) s = holding(s, item, new Decimal(qty));
    const line = startLine(s, "fabricate", key, { kind: "batch", remaining: 1 });
    expect(line.started).toBe(true);
    s = line.next;
    for (let i = 0; i < bp.craftDurationTicks + 4; i++) s = economyTick(s, 1, () => 0.5);
    expect(Number(s.blanks[key] ?? 0)).toBe(1);
    const before = s.equipment.length;
    s = inspectBlank(s, key);
    expect(s.equipment.length).toBe(before + 1);
    const piece = s.equipment.at(-1)!;
    expect([piece.slotType, piece.moduleVariant, piece.blueprintKey]).toEqual(["module", "structuralBracing", key]);
    const hullType = combatHullTypeOf("destroyer")!;
    const hullOf = (st: GameState) => shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, hullType, installedGear: equippedFor(st, SHIP) }).hullMax;
    const bare = hullOf(s);
    const v = canFitEquipment(s, SHIP, piece.id);
    expect(v.ok).toBe(true);
    s = fitEquipment(s, SHIP, piece.id);
    expect(hullOf(s)).toBe(Math.max(1, Math.round(bare * (1 + def("structuralBracing").effect.magnitude * scaleOf(piece)))));
  });

  it("a module salvages and enshrines like any crafted piece; the Archive has one slot per module blueprint", () => {
    const keys = archivableBlueprints().map((a) => a.key);
    for (const k of Object.keys(MODULE_BLUEPRINTS)) expect(keys).toContain(k);
    const piece = { ...mint("arcDischarger", "stellar", 2, "salvage-me"), blueprintKey: "arcDischargerBp", fittedToShipId: null };
    const s: GameState = { ...freshState(), equipment: [piece] };
    const r = salvageEquipment(s, "salvage-me", () => 0.5);
    expect(r.ok).toBe(true);
    const a = archiveItem(s, "salvage-me");
    expect(a.archive.arcDischargerBp?.score).toBeGreaterThan(0);
    expect(a.equipment).toHaveLength(0);
  });

  it("the item card says what each module does at the piece's own scale (the mockup's words)", () => {
    const lines = (id: string, rarity: EquipmentRarity = "standard", q = 0) => pieceModuleLines(mint(id, rarity, q))!;
    expect(lines("auxiliaryCapacitor")).toEqual({ kind: "Passive · Everywhere", effect: "Adds 8 power output.", rule: null, when: "Always on, everywhere the ship goes.", draw: "Power draw 0, adds 8 power", condition: null });
    expect(lines("structuralBracing").effect).toBe("+6% hull integrity in combat.");
    expect(lines("arcDischarger")).toMatchObject({ kind: "Proc · Combat", effect: "When the ship takes a hit: a 15% chance to arc 8 damage back at the attacker." });
    expect(lines("prospectorsEcho")).toMatchObject({ kind: "Proc · Missions", effect: "Each extraction cycle: a 10% chance of a bonus haul, +50% of that cycle's common material." });
    expect(lines("lastStandProtocol").effect).toBe("While hull is below 25%: +12% weapon damage.");
    expect(lines("shieldSurge")).toEqual({ kind: "Active · Combat", effect: "Restores 30% shields.", rule: "Auto-cast, preset rule: once per battle, when hull falls below 50%.", when: "Acts in combat once the ship's hull falls below 50%.", draw: "Power draw 6", condition: null });
    expect(lines("longBaselineArray")).toMatchObject({ kind: "Set · Expeditions", effect: "With a Signal Integrator installed: +8% scan speed on expeditions (the pair's bonus averages both pieces)." });
    expect(lines("signalIntegrator").effect).toBe("With a Long-Baseline Array installed: +8% scan speed on expeditions (the pair's bonus averages both pieces).");
    // EM-7 review: installed as a pair (the host passes the ship's pieces), the card shows the REAL pair bonus, the mean
    // of both pieces' scales (the engine's own reader), not this piece's alone.
    const lba = { ...mint("longBaselineArray", "radiant", 5, "card-lba"), fittedToShipId: SHIP };
    const sig = { ...mint("signalIntegrator", "standard", 0, "card-sig"), fittedToShipId: SHIP };
    const pair = (Math.round(0.08 * ((moduleEffectScale("radiant", 5) + 1) / 2) * 1000) / 10).toFixed(1);
    expect(pieceModuleLines(lba, [lba, sig])!.effect).toBe(`Survey Pair active: +${pair}% scan speed on expeditions.`);
    expect(pieceModuleLines(sig, [lba, sig])!.effect).toBe(`Survey Pair active: +${pair}% scan speed on expeditions.`);
    expect(pieceModuleLines(lba, [lba])!.effect).toMatch(/averages both pieces/);
    // A better roll reads a bigger number (rarity and quality are never inert).
    expect(lines("auxiliaryCapacitor", "radiant", 5).effect).not.toBe(lines("auxiliaryCapacitor").effect);
    expect(moduleRuleText(def("arcDischarger"))).toBeNull();
    expect(moduleKindText(def("structuralBracing"))).toBe("Passive · Combat");
    expect(moduleEffectSentence(def("auxiliaryCapacitor"), 2)).toBe("Adds 16 power output.");
    expect(pieceModuleLines({ ...mint("auxiliaryCapacitor"), slotType: "cargoBay" })).toBeNull();
    // Every line obeys the text rules (no em dash, no double hyphen).
    for (const d of UNIVERSAL_MODULES) {
      const l = lines(d.id);
      for (const t of [l.kind, l.effect, l.rule ?? "", l.when, l.draw]) expect(t, d.id).not.toMatch(/\u2014|\x2d\x2d/);
    }
  });

  it("every module draws an SVG glyph (icons.ts + ICON_SEMANTICS)", () => {
    for (const name of ["moduleCapacitor", "moduleBracing", "moduleArc", "moduleEcho", "moduleLastStand", "moduleSurge", "moduleSignal", "telescope"] as const) {
      expect(ICON_PATHS[name], name).toBeDefined();
      expect(ICON_SEMANTICS[name], name).toBe("subject");
    }
  });
});

describe("each module acts in its context, and only there", () => {
  it("Auxiliary Capacitor: power output on the sheet and in the budget (every context); nothing in combat", () => {
    const s0 = withoutUtility(hullState("prospectorRunner"));
    const s1 = installAll(s0, [mint("auxiliaryCapacitor")]);
    const ship = (s: GameState) => s.ships.find((x) => x.id === SHIP)!;
    expect(effectiveShipStats(s1, ship(s1)).powerOutput - effectiveShipStats(s0, ship(s0)).powerOutput).toBe(MODULE_V1_NUMBERS.auxiliaryCapacitor.powerOutput);
    expect(shipPowerBudget(s1, SHIP).moduleOutput).toBe(MODULE_V1_NUMBERS.auxiliaryCapacitor.powerOutput);
    const radiant = installAll(s0, [mint("auxiliaryCapacitor", "radiant", 5)]);
    expect(shipPowerBudget(radiant, SHIP).moduleOutput).toBe(Math.round(8 * moduleEffectScale("radiant", 5)));
    expect(shipPowerBudget(radiant, SHIP).moduleOutput).toBeGreaterThan(8);
  });

  const hullType = combatHullTypeOf("destroyer")!;
  const combatant = (ids: string[], context: "patrol" | "shipEvent" = "patrol", rarity: EquipmentRarity = "standard"): Combatant => {
    const c = shipToCombatant({ id: SHIP, team: "player", stats: SHIP_TYPES.destroyer, hullType });
    applyModuleCombat(c, ids.map((id) => ({ ...mint(id, rarity, 0, `c-${id}`), fittedToShipId: SHIP })), context);
    return c;
  };
  const enemy = (): Combatant => shipToCombatant({ id: "e", team: "enemy", stats: SHIP_TYPES.battleship, hullType: combatHullTypeOf("battleship")!, position: 40 });
  const procs = (log: CombatEvent[], effect: string) => log.filter((e) => e.type === "moduleProc" && e.moduleEffect === effect);

  it("Structural Bracing: a bigger hull pool in patrols and ship events; the sheet is unchanged", () => {
    const bare = combatant([]).hullMax;
    for (const ctx of ["patrol", "shipEvent"] as const) expect(combatant(["structuralBracing"], ctx).hullMax).toBe(Math.round(bare * 1.06));
    const s0 = withoutUtility(hullState("destroyer"));
    const s1 = installAll(s0, [mint("structuralBracing")]);
    expect(shipDerivedStats(s1.ships[0], equippedFor(s1, SHIP))).toEqual({ ...shipDerivedStats(s0.ships[0], equippedFor(s0, SHIP)), powerDraw: shipDerivedStats(s1.ships[0], equippedFor(s1, SHIP)).powerDraw });
  });

  it("Arc Discharger: arcs land on the attacker after hits taken, on the module's own stream", () => {
    let arcs = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const r = resolveBattle({ combatants: [combatant(["arcDischarger"]), enemy()] }, seed * 101, { precharge: true, generateLog: true });
      const hits = procs(r.log, "arcDamage");
      for (const h of hits) expect(h.targetId).toBe("e");
      arcs += hits.length;
      // The combat stream is untouched: with the module's draws removed the enemy's own shots are the same.
      const bare = resolveBattle({ combatants: [combatant([]), enemy()] }, seed * 101, { precharge: true, generateLog: true });
      expect(r.log.filter((e) => e.actorId === "e" && e.type !== "moduleProc").slice(0, 3)).toEqual(bare.log.filter((e) => e.actorId === "e").slice(0, 3));
    }
    expect(arcs).toBeGreaterThan(0);
  });

  it("Arc Discharger: every arc is exactly its configured size on an unarmored target (only a killing arc is smaller)", () => {
    const size = Math.round(def("arcDischarger").effect.magnitude * moduleEffectScale("standard", 0));
    let arcs = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const foe = enemy();
      foe.shield = 0;
      foe.shieldMax = 0;
      foe.ablativeArmor = 0;
      foe.kineticDampening = 0;
      const r = resolveBattle({ combatants: [combatant(["arcDischarger"]), foe] }, seed * 211, { precharge: true, generateLog: true });
      for (const h of procs(r.log, "arcDamage")) {
        arcs++;
        if ((h.hullAfter ?? 1) > 0) expect(h.damage).toBe(size);
        else expect(h.damage).toBeLessThanOrEqual(size);
      }
    }
    expect(arcs).toBeGreaterThan(0);
  });

  it("Last Stand Protocol: harder hits only while the hull is below 25%", () => {
    const target = () => {
      const t = enemy();
      t.shield = 0;
      t.shieldMax = 0;
      t.ablativeArmor = 0;
      return t;
    };
    const volley = (ids: string[], hullFrac: number) => {
      let total = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const c = combatant(ids);
        c.hull = Math.floor(c.hullMax * hullFrac);
        total += fireWeapon(c, target(), c.weapons[0], makeRng(seed)).damage;
      }
      return total;
    };
    expect(volley(["lastStandProtocol"], 0.5)).toBe(volley([], 0.5));
    expect(volley(["lastStandProtocol"], 0.2)).toBeGreaterThan(volley([], 0.2));
  });

  it("Shield Surge: once per battle, when the hull falls below half, shields come back", () => {
    let casts = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const r = resolveBattle({ combatants: [combatant(["shieldSurge"]), enemy()] }, seed * 131, { precharge: true, generateLog: true });
      const surges = procs(r.log, "shieldRestore");
      expect(surges.length, `seed ${seed}`).toBeLessThanOrEqual(1);
      // EM-7 review: each cast restores exactly floor(pool x 30%), never past the pool.
      const pool = combatant(["shieldSurge"]).shieldMax;
      for (const e of surges) {
        const before = (e.shieldAfter ?? 0) - (e.damage ?? 0);
        expect(e.damage).toBe(Math.min(Math.floor((pool * 300) / 1000), pool - before));
      }
      casts += surges.length;
    }
    expect(casts).toBeGreaterThan(0);
  });

  it("Prospector's Echo: a bonus common haul on extraction cycles, offline == live, no shared draw", { timeout: 60_000 }, () => {
    const dispatch = (withModule: boolean) => {
      // EM-7 review: a REAL fresh save's Freighter (its Standard-Issue Spec Utility, which it shows no slot for, never
      // fills its one module slot).
      const base = freshState();
      const s0 = withModule ? installAll(base, [mint("prospectorsEcho")]) : base;
      const r = dispatchCaptainOnMission({ ...s0, captains: s0.captains.map((c) => ({ ...c, level: 10 })) }, 1, "shortOreRun");
      expect(r.success).toBe(true);
      return r.next;
    };
    const installed = dispatch(true);
    expect(missionCycleModulesFor(installed, SHIP)?.procs.map((p) => p.moduleId)).toEqual(["prospectorsEcho"]);
    let calls = 0;
    const counted = (seed: number) => {
      let x = seed >>> 0;
      return () => {
        calls++;
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
        return x / 4294967296;
      };
    };
    let live = installed;
    const rngA = counted(0x7e);
    for (let i = 0; i < 3000; i++) live = economyTick(live, 1, rngA);
    const callsWith = calls;
    calls = 0;
    let bare = dispatch(false);
    const rngB = counted(0x7e);
    for (let i = 0; i < 3000; i++) bare = economyTick(bare, 1, rngB);
    expect(calls).toBe(callsWith);
    expect(itemTotal(live.inventory, "commonOre").gt(itemTotal(bare.inventory, "commonOre"))).toBe(true);
    const offline = tick(3000, installed, counted(0x7e), 0);
    expect(JSON.stringify(offline.captains)).toBe(JSON.stringify(live.captains));
    expect(JSON.stringify(offline.inventory)).toBe(JSON.stringify(live.inventory));
  });

  it("the Survey Pair: one piece gives nothing, the pair speeds an Aurora's scans, a better pair more, a worn pair less", () => {
    const base = wiringAurora();
    const one = installAll(base, [mint("longBaselineArray")]);
    const both = installAll(one, [mint("signalIntegrator")]);
    const ship = (s: GameState) => s.ships.find((x) => x.id === SHIP)!;
    const pf = expeditionGearBonuses(base, ship(base)).scanSpeed;
    expect(expeditionGearBonuses(one, ship(one)).scanSpeed).toBe(pf);
    expect(expeditionGearBonuses(both, ship(both)).scanSpeed).toBeCloseTo(pf + 0.08, 12);
    expect(dispatchRun(both).scanSpeedBonus - dispatchRun(base).scanSpeedBonus).toBeCloseTo(0.08, 12);
    // The sheet never folds it.
    expect(shipDerivedStats(ship(both), equippedFor(both, SHIP))).toEqual({ ...shipDerivedStats(ship(base), equippedFor(base, SHIP)), powerDraw: shipDerivedStats(ship(both), equippedFor(both, SHIP)).powerDraw });
    // A Radiant quality 5 pair: the tier scales by the pair's mean module scale.
    const radiant = installAll(base, [mint("longBaselineArray", "radiant", 5), mint("signalIntegrator", "radiant", 5)]);
    expect(expeditionGearBonuses(radiant, ship(radiant)).scanSpeed).toBeCloseTo(pf + 0.08 * moduleEffectScale("radiant", 5), 12);
    const mixed = [mint("longBaselineArray", "radiant", 5), mint("signalIntegrator")];
    expect(shipGearSetBonusLines(mixed).scanSpeedBonus).toBeCloseTo(0.08 * (moduleEffectScale("radiant", 5) + 1) / 2, 12);
    // Worn: gear wear step 4 took a module's wear efficiency live in COMBAT (registry wear:WEAR_EFFICIENCY:module:effect:
    // a battle's frozen view scales its hull lift, its conditional damage and its procs); a run's worn view still
    // leaves module pieces as they are, so the pair (an expedition reader, not combat) still gives its full tier. The
    // set tier wearing with its module pieces (the RR-6 rule) is logged for gear wear step 5.
    const worn = [mint("longBaselineArray"), mint("signalIntegrator")].map((p) => wornPieceView({ ...p, condition: p.durabilityMax / 2 } as EquipmentInstance));
    expect(activeGearSetTiers(worn, "ship", undefined, scaleOf)[0].magnitude).toBe(0.08);
    expect(WIRING_REGISTRY.find((e) => e.id === "wear:WEAR_EFFICIENCY:module:effect")?.status.kind).toBe("live");
  });
});

function wiringAurora(): GameState {
  return withoutUtility(hullState("aurora"));
}

describe("EM-7 review: the Freighter's slot, Armory loadouts only, the module set's own rules", () => {
  it("a fresh Freighter (its Standard-Issue Spec Utility aboard) installs one module, then refuses a second", () => {
    const s0 = freshState();
    const ship = s0.ships.find((x) => x.id === SHIP)!;
    expect(ship.typeKey).toBe("generalFreighter");
    expect(equippedFor(s0, SHIP).some((e) => e.slotType === "specUtility")).toBe(true);
    expect(SHIP_TYPES.generalFreighter.moduleSlots).toBe(1);
    expect(moduleSlotsUsed(equippedFor(s0, SHIP), hullHasSpecUtilitySlot("general"))).toBe(0);
    const echo = mint("prospectorsEcho", "standard", 0, "fr-echo");
    let s = { ...s0, equipment: [...s0.equipment, echo] };
    expect(canFitEquipment(s, SHIP, echo.id)).toEqual({ ok: true });
    s = fitEquipment(s, SHIP, echo.id);
    const arc = mint("arcDischarger", "standard", 0, "fr-arc");
    s = { ...s, equipment: [...s.equipment, arc] };
    expect(canFitEquipment(s, SHIP, arc.id)).toEqual({ ok: false, reason: "moduleSlotsFull" });
    // A specialized hull still counts its utility (M1 "Separate counts").
    expect(hullHasSpecUtilitySlot("prospector")).toBe(true);
    expect(moduleSlotsUsed([{ slotType: "specUtility" }, { slotType: "module" }])).toBe(2);
    expect(moduleSlotsUsed([{ slotType: "specUtility" }, { slotType: "module" }], false)).toBe(1);
  });

  it("EM-10: Install on... lists every ship with the real gate's verdict for a module (the Armory-only switch is off)", () => {
    expect(MODULE_INSTALL_ARMORY_ONLY).toBe(false);
    const s0 = freshState();
    const echo = { ...mint("prospectorsEcho", "standard", 0, "io-echo"), fittedToShipId: null };
    const s = { ...s0, equipment: [...s0.equipment, echo] };
    const targets = installTargetsFor(s, echo.id);
    expect(targets.length).toBe(s.ships.length);
    for (const t of targets) {
      expect(t.kind).toBe("ship");
      if (t.kind !== "ship") continue;
      const gate = canFitEquipment(s, t.shipId, echo.id);
      expect(t).toEqual(gate.ok ? { kind: "ship", shipId: t.shipId, ok: true } : { kind: "ship", shipId: t.shipId, ok: false, refusal: gate });
    }
    // The fresh Freighter has a free module slot, so the Echo goes on through the item side now.
    expect(targets.find((t) => t.kind === "ship" && t.shipId === SHIP)).toMatchObject({ ok: true });
    // The reason text stays (the switch is a one-line revert), and the full-slots text is the mockup's again.
    expect(moduleArmoryOnlyReasonText()).toBe("install modules through an Armory loadout for now");
    expect(moduleSlotsFullReasonText()).toBe("no free module slot (modules and the Spec Utility share them). Remove a module first");
  });

  it("an Armory loadout installs and removes a module cleanly on a fresh Freighter", () => {
    let s = freshState();
    const created = createLoadout(s, "generalFreighter", "Echo run");
    s = created.next;
    const id = created.loadoutId!;
    const echo = { ...mint("prospectorsEcho", "standard", 0, "lo-echo"), fittedToShipId: null };
    s = { ...s, equipment: [...s.equipment, echo] };
    const moduleKey = loadoutSlotDefsForShipType("generalFreighter").find((d) => d.slotType === "module")!.key;
    s = installIntoLoadout(s, id, moduleKey, echo.id);
    expect(s.loadouts.find((l) => l.id === id)!.slots[moduleKey]).toBe(echo.id);
    const out = checkOutLoadout(s, id, SHIP);
    expect(out).not.toBe(s);
    expect(equippedFor(out, SHIP).map((e) => e.id)).toContain(echo.id);
    expect(missionCycleModulesFor(out, SHIP)?.procs.map((p) => p.moduleId)).toEqual(["prospectorsEcho"]);
    const back = checkInLoadout(out, id);
    expect(equippedFor(back, SHIP).map((e) => e.id)).not.toContain(echo.id);
    expect(missionCycleModulesFor(back, SHIP)).toBeUndefined();
    const freed = uninstallFromLoadout(back, id, moduleKey);
    expect(freed.loadouts.find((l) => l.id === id)!.slots[moduleKey] ?? null).toBeNull();
    expect(isSparePiece(freed.equipment.find((e) => e.id === echo.id)!)).toBe(true);
  });

  it("the Celestial minus-1 never lets ONE Survey Pair piece complete the pair (a module set keeps its count)", () => {
    const celestial = { ...mint("longBaselineArray", "constellar", 0, "cel-lba"), ascension: "celestial" as const };
    expect(activeGearSetTiers([celestial], "ship", undefined, scaleOf)).toEqual([]);
    expect(shipGearSetBonusLines([celestial]).scanSpeedBonus).toBeUndefined();
  });
});

describe("the registry (every module a live, probed row; emodEm7Registry.fixture.ts reads the move back)", () => {
  it("one live row per module and per Survey Pair tier and module blueprint; every hull's moduleSlots live", () => {
    const added = WIRING_REGISTRY.filter((e) => EM7_ADDED_ENTRY_IDS.has(e.id));
    expect(added.map((e) => e.id).sort()).toEqual([...EM7_ADDED_ENTRY_IDS].sort());
    for (const e of added) {
      expect(e.status.kind, e.id).toBe("live");
      expect(e.probe, e.id).toBeDefined();
      expect(e.contexts.length, e.id).toBeGreaterThan(0);
    }
    const slots = WIRING_REGISTRY.filter((e) => EM7_MODULE_SLOTS_IDS.has(e.id));
    expect(slots).toHaveLength(HULLS.length);
    for (const e of slots) expect(e.status.kind, e.id).toBe("live");
  });
});
