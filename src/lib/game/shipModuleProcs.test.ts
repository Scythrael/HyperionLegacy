// E-MOD EM-6 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-6): the Proc and Active
// engine, tested on FIXTURE modules, one per trigger (shipModulesTest.fixture.ts; the catalog ships empty until EM-7).
// Each trigger fires at its point; cooldowns and once per battle hold; the private streams never touch the combat
// stream or the shared economy stream; offline == live == the display replay; a run in flight is unchanged.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { SHIP_TYPES, freshState, moduleEffectScale, type AwayMember, type EquipmentInstance, type Expedition, type GameState, type PatrolMissionState, type ShipTypeKey } from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, missionCycleModulesFor, tick } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { applyModuleCombat, combatHullTypeOf, shipToCombatant } from "./combat/bridge";
import { resolveBattle, type ResolveOptions } from "./combat/resolveBattle";
import type { Combatant, CombatEvent } from "./combat/types";
import { makeWeaponInstance } from "./combat/weapons";
import { canFitEquipment, equippedFor, fitEquipment, unfitEquipmentInstance } from "./equipment";
import { advanceExpedition, expeditionCandidates } from "./expedition";
import { CLOAKED_VESSEL_HULL, buildShipCombatant, snapshotShipEventProfile } from "./shipScanEvents";
import { deserialize, migrate, serialize } from "./save";
import { itemTotal } from "./inventory";
import { plainAwayMember, withSlottedAwayTeams, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { withCombatRulesOff } from "./combatRulesSwitch.fixture";
import {
  MODULE_CHANCE_UNITS,
  bonusHaulUnits,
  moduleCombatProcs,
  moduleCycleProcs,
  moduleScanProcs,
  validateUniversalModuleCatalog,
  validateUniversalModuleDef,
  type UniversalModuleDef,
} from "./shipModules";
import {
  TEST_AMBUSH_RECOVERY,
  TEST_AMBUSH_WARD,
  TEST_ARC_DISCHARGER,
  TEST_ECHO,
  TEST_LENS,
  TEST_OPENING_ARC,
  TEST_SURGE,
  TEST_TICK_ARC,
  mintTestModule,
  withTestModules,
} from "./shipModulesTest.fixture";

const SHIP = "ship-1";
const ALL = [TEST_OPENING_ARC, TEST_AMBUSH_WARD, TEST_AMBUSH_RECOVERY, TEST_ARC_DISCHARGER, TEST_TICK_ARC, TEST_SURGE, TEST_ECHO, TEST_LENS];
const scaleOf = (p: EquipmentInstance) => moduleEffectScale(p.rarity, p.quality);

function hullState(hull: ShipTypeKey): GameState {
  const base = freshState();
  return installMissingCombatBaselines({ ...base, credits: new Decimal(1_000_000), ships: base.ships.map((sh) => (sh.id === SHIP ? { ...sh, typeKey: hull } : sh)) });
}
function withoutUtility(s: GameState): GameState {
  const u = equippedFor(s, SHIP).find((e) => e.slotType === "specUtility");
  return u ? unfitEquipmentInstance(s, SHIP, u.id) : s;
}
function installAll(s0: GameState, pieces: EquipmentInstance[]): GameState {
  let s: GameState = { ...s0, equipment: [...s0.equipment, ...pieces] };
  for (const p of pieces) {
    const v = canFitEquipment(s, SHIP, p.id);
    expect(v.ok, v.ok ? "" : v.reason).toBe(true);
    s = fitEquipment(s, SHIP, p.id);
  }
  return s;
}

// A destroyer combatant carrying `defs` (as installed pieces) for `context`, and its enemy at range.
const DESTROYER = combatHullTypeOf("destroyer")!;
function player(defs: readonly UniversalModuleDef[], context: "patrol" | "shipEvent" = "patrol", rarity: EquipmentInstance["rarity"] = "standard", quality = 0): Combatant {
  const c = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, hullType: DESTROYER });
  applyModuleCombat(c, defs.map((d, i) => ({ ...mintTestModule(d, rarity, quality, `test-${d.id}-${i}`), fittedToShipId: SHIP })), context);
  return c;
}
const enemy = (hull: ShipTypeKey = "destroyer"): Combatant =>
  shipToCombatant({ id: "e", team: "enemy", stats: SHIP_TYPES[hull], hullType: combatHullTypeOf(hull)!, position: 40 });
const procEvents = (log: CombatEvent[], id?: string) => log.filter((e) => e.type === "moduleProc" && (id === undefined || e.moduleId === id));
function fight(p: Combatant, e: Combatant, seed: number, options: ResolveOptions = {}) {
  return resolveBattle({ combatants: [p, e] }, seed, { precharge: true, ...options, generateLog: true });
}

describe("the catalog rules (validation)", () => {
  it("every fixture is well-formed, and the trigger rules refuse what no engine could fire", () => {
    for (const d of ALL) expect(validateUniversalModuleDef(d), d.id).toEqual([]);
    const v = (d: UniversalModuleDef) => validateUniversalModuleDef(d).join();
    // M3: an Active casts by its one preset rule (once per battle or a cooldown), never by chance, in combat only.
    expect(v({ ...TEST_SURGE, chance: 0.5 })).toMatch(/an active has no chance/);
    expect(v({ ...TEST_AMBUSH_RECOVERY, oncePerBattle: undefined })).toMatch(/once per battle or a cooldown/);
    expect(v({ ...TEST_ECHO, category: "active", chance: undefined })).toMatch(/an active casts in combat only/);
    // A threshold held for many ticks needs a rule; a proc needs a chance.
    expect(v({ ...TEST_SURGE, category: "proc", chance: 0.5, oncePerBattle: undefined })).toMatch(/hull threshold needs once per battle or a cooldown/);
    expect(v({ ...TEST_ARC_DISCHARGER, chance: undefined })).toMatch(/needs a chance in \(0, 1\]/);
    expect(v({ ...TEST_SURGE, trigger: { kind: "hullBelow", fraction: 1 } })).toMatch(/hull threshold must be in \(0, 1\)/);
    // Contexts are checked per context: a patrol never ambushes; a mission cycle is a mission's; a scan an expedition's.
    expect(v({ ...TEST_AMBUSH_WARD, contexts: ["shipEvent", "patrol"] })).toMatch(/incomingAmbush trigger never fires in the patrol context/);
    expect(v({ ...TEST_ECHO, contexts: ["mission", "expedition"] })).toMatch(/missionCycle trigger never fires in the expedition context/);
    // Each trigger applies only its own effects; battle clocks act in combat only; whole and fraction magnitudes.
    expect(v({ ...TEST_ECHO, effect: { key: "arcDamage", magnitude: 5 } })).toMatch(/missionCycle trigger does not apply arcDamage/);
    expect(v({ ...TEST_ECHO, cooldownTicks: 10 })).toMatch(/acts in combat only/);
    expect(v({ ...TEST_ARC_DISCHARGER, effect: { key: "arcDamage", magnitude: 2.5 } })).toMatch(/whole number of at least 1/);
    expect(v({ ...TEST_SURGE, effect: { key: "shieldRestore", magnitude: 1.5 } })).toMatch(/fraction in \(0, 1\]/);
    expect(v({ ...TEST_TICK_ARC, cooldownTicks: 2.5 })).toMatch(/cooldown is a whole number/);
    // Nothing but a triggered category carries a trigger, a cooldown or once per battle.
    expect(v({ ...TEST_SURGE, category: "conditional", condition: { kind: "hullBelow", fraction: 0.5 }, effect: { key: "weaponDamage", magnitude: 0.1 } })).toMatch(/only a proc, an active or a special/);
    // D23: two modules on one triggered effect key would add up as a plain sum.
    expect(validateUniversalModuleCatalog([TEST_ECHO, { ...TEST_ECHO, id: "testModuleEcho2" }]).join()).toMatch(/diminishing curve first/);
    expect(validateUniversalModuleCatalog([TEST_ARC_DISCHARGER, TEST_SURGE, TEST_ECHO, TEST_LENS])).toEqual([]);
  });
});

describe("the fold: installed pieces become frozen procs", () => {
    it("combat procs are scaled, integer, in module id order, and only for their context", () =>
      withTestModules(ALL, () => {
        const pieces = ALL.map((d, i) => mintTestModule(d, "radiant", 5, `fold-${i}`));
        const patrol = moduleCombatProcs(pieces, scaleOf, "patrol");
        expect(patrol.map((p) => p.moduleId)).toEqual([TEST_ARC_DISCHARGER.id, TEST_OPENING_ARC.id, TEST_SURGE.id, TEST_TICK_ARC.id]);
        const shipEvent = moduleCombatProcs(pieces, scaleOf, "shipEvent");
        expect(shipEvent.map((p) => p.moduleId)).toContain(TEST_AMBUSH_WARD.id);
        const scale = moduleEffectScale("radiant", 5);
        const arc = patrol.find((p) => p.moduleId === TEST_ARC_DISCHARGER.id)!;
        expect(arc).toEqual({ moduleId: TEST_ARC_DISCHARGER.id, trigger: "onHit", chanceUnits: MODULE_CHANCE_UNITS / 2, cooldownTicks: 0, oncePerBattle: false, effect: "arcDamage", amount: Math.round(12 * scale) });
        const surge = patrol.find((p) => p.moduleId === TEST_SURGE.id)!;
        expect(surge).toMatchObject({ trigger: "hullBelow", hullBelowFraction: 0.5, chanceUnits: MODULE_CHANCE_UNITS, oncePerBattle: true, amount: Math.round(0.3 * scale * 1000) });
        // The mission and the scan folds: the Echo's fraction scales; the Lens' scale lifts its chance (a count stays whole).
        expect(moduleCycleProcs(pieces, scaleOf)).toEqual([{ moduleId: TEST_ECHO.id, chanceUnits: MODULE_CHANCE_UNITS / 2, fraction: 0.25 * scale }]);
        expect(moduleScanProcs(pieces, scaleOf)).toEqual([{ moduleId: TEST_LENS.id, chanceUnits: Math.round(Math.min(1, 0.5 * scale) * MODULE_CHANCE_UNITS), count: 1 }]);
        // A better piece does more: a standard piece's arc is smaller.
        const plain = moduleCombatProcs([mintTestModule(TEST_ARC_DISCHARGER, "standard", 0, "fold-plain")], scaleOf, "patrol")[0];
        expect(plain.amount).toBeLessThan(arc.amount);
      }));
    it("no module: nothing is folded, nothing is written", () => {
      const c = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, hullType: DESTROYER });
      applyModuleCombat(c, [], "patrol");
      expect(c.moduleProcs).toBeUndefined();
      expect(missionCycleModulesFor(hullState("generalFreighter"), SHIP)).toBeUndefined();
    });
});

describe("every combat trigger fires at its point", () => {
  it("battle start: before the first tick and before any shot, at the enemy", () =>
    withTestModules([TEST_OPENING_ARC], () => {
      const r = fight(player([TEST_OPENING_ARC]), enemy(), 7);
      const ev = procEvents(r.log);
      expect(ev.length).toBe(1);
      expect(ev[0]).toMatchObject({ tDeciSec: 0, round: 0, actorId: "p", targetId: "e", moduleEffect: "arcDamage" });
      expect(ev[0].damage).toBeGreaterThan(0);
      expect(r.log.findIndex((e) => e.type === "moduleProc")).toBeLessThan(r.log.findIndex((e) => e.type === "hit" || e.type === "evade"));
      // It moved the battle: the enemy took the arc.
      const bare = fight(player([]), enemy(), 7);
      expect(JSON.stringify(r.finalCombatants.find((c) => c.id === "e"))).not.toBe(JSON.stringify(bare.finalCombatants.find((c) => c.id === "e")));
    }));

  it("incoming ambush: only for the ambushed party, before the opening salvo, at the ambusher", () =>
    withTestModules([TEST_AMBUSH_WARD], () => {
      const ambushed = fight(player([TEST_AMBUSH_WARD], "shipEvent"), enemy(), 11, { ambush: "e" });
      const ev = procEvents(ambushed.log);
      expect(ev.length).toBe(1);
      expect(ev[0]).toMatchObject({ tDeciSec: 0, actorId: "p", targetId: "e" });
      expect(ambushed.log.indexOf(ev[0])).toBeLessThan(ambushed.log.findIndex((e) => e.type === "ambush"));
      // The player ambushing, or no ambush at all: the ward never fires.
      expect(procEvents(fight(player([TEST_AMBUSH_WARD], "shipEvent"), enemy(), 11, { ambush: "p" }).log)).toEqual([]);
      expect(procEvents(fight(player([TEST_AMBUSH_WARD], "shipEvent"), enemy(), 11).log)).toEqual([]);
      // A patrol fold carries no ambush module at all (its context never ambushes).
      expect(player([TEST_AMBUSH_WARD], "patrol").moduleProcs).toBeUndefined();
    }));

  it("after ambush: once the opening salvo landed, once per battle, restoring missing shields", () =>
    withTestModules([TEST_AMBUSH_RECOVERY], () => {
      const p = player([TEST_AMBUSH_RECOVERY], "shipEvent");
      p.shield = Math.floor(p.shieldMax / 4);
      const r = fight(p, enemy(), 13, { ambush: "e" });
      const ev = procEvents(r.log);
      expect(ev.length).toBe(1);
      const lastAmbush = r.log.map((e) => e.type).lastIndexOf("ambush");
      expect(r.log.indexOf(ev[0])).toBeGreaterThan(lastAmbush);
      expect(ev[0]).toMatchObject({ tDeciSec: 0, actorId: "p", targetId: "p", moduleEffect: "shieldRestore" });
      expect(ev[0].damage).toBe(Math.min(Math.floor((p.shieldMax * 500) / 1000), p.shieldMax - p.shield));
      expect(ev[0].shieldAfter).toBe(p.shield + ev[0].damage!);
      // Full shields: nothing to restore, so the Active holds (the rule casts only when it would act).
      expect(procEvents(fight(player([TEST_AMBUSH_RECOVERY], "shipEvent"), enemy(), 13, { ambush: "e" }).log)).toEqual([]);
    }));

  it("on hit: right after a connecting shot on the ship, at the attacker that struck, on its chance", () =>
    withTestModules([TEST_ARC_DISCHARGER], () => {
      let fired = 0;
      let hits = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const r = fight(player([TEST_ARC_DISCHARGER]), enemy(), seed);
        for (let i = 0; i < r.log.length; i++) {
          const e = r.log[i];
          if (e.targetId === "p" && e.actorId === "e" && (e.type === "hit" || e.type === "droneVolley") && (e.projectilesHit ?? 1) > 0) hits++;
          if (e.type !== "moduleProc") continue;
          fired++;
          expect(e).toMatchObject({ actorId: "p", targetId: "e" });
          // The struck shot is the latest enemy hit on the ship at the same tick.
          const before = r.log.slice(0, i).filter((x) => x.tDeciSec === e.tDeciSec && x.actorId === "e" && x.targetId === "p" && (x.type === "hit" || x.type === "droneVolley"));
          expect(before.length).toBeGreaterThan(0);
        }
      }
      expect(fired).toBeGreaterThan(0);
      expect(fired).toBeLessThan(hits); // a 50% proc: some hits arc, some do not
    }));

  it("per combat tick: after status effects, never inside its cooldown", () =>
    withTestModules([TEST_TICK_ARC], () => {
      const r = fight(player([TEST_TICK_ARC]), enemy("battleship"), 5);
      const ticks = procEvents(r.log).map((e) => e.tDeciSec);
      expect(ticks.length).toBeGreaterThan(1);
      for (let i = 1; i < ticks.length; i++) expect(ticks[i] - ticks[i - 1]).toBeGreaterThanOrEqual(TEST_TICK_ARC.cooldownTicks!);
      expect(ticks[0]).toBeGreaterThanOrEqual(1);
    }));

  it("below a hull threshold: once per battle, only once the hull is strictly below its fraction", () =>
    withTestModules([TEST_SURGE], () => {
      let surged = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const p = player([TEST_SURGE]);
        const r = fight(p, enemy("battleship"), seed);
        const ev = procEvents(r.log);
        expect(ev.length).toBeLessThanOrEqual(1);
        if (ev.length === 1) {
          surged++;
          expect(ev[0].hullAfter!).toBeLessThan(p.hullMax * 0.5);
          // It restored real shield (an Active casts only when it would act).
          expect(ev[0].damage).toBeGreaterThan(0);
        }
      }
      expect(surged).toBeGreaterThan(0);
    }));
});

describe("determinism: private streams, offline == live", () => {
  it("logged and unlogged battles agree with every fixture aboard", () =>
    withTestModules(ALL, () => {
      for (let seed = 1; seed <= 6; seed++) {
        for (const ambush of [undefined, "e", "p"]) {
          const mk = () => resolveBattle({ combatants: [player(ALL, "shipEvent"), enemy()] }, seed, { precharge: true, ...(ambush ? { ambush } : {}) });
          const off = mk();
          const live = resolveBattle({ combatants: [player(ALL, "shipEvent"), enemy()] }, seed, { precharge: true, ...(ambush ? { ambush } : {}), generateLog: true });
          expect(JSON.stringify(off.outcome)).toBe(JSON.stringify(live.outcome));
          expect(JSON.stringify(off.finalCombatants)).toBe(JSON.stringify(live.finalCombatants));
          expect(JSON.stringify(mk().finalCombatants)).toBe(JSON.stringify(off.finalCombatants));
        }
      }
    }));

  it("a proc that never lands draws only its own stream: the battle is exactly the module-free one", () => {
    const quiet: UniversalModuleDef = { ...TEST_TICK_ARC, id: "testModuleQuiet", chance: 1 / MODULE_CHANCE_UNITS, cooldownTicks: undefined };
    withTestModules([quiet], () => {
      for (let seed = 1; seed <= 8; seed++) {
        const withMod = fight(player([quiet]), enemy(), seed);
        const bare = fight(player([]), enemy(), seed);
        expect(procEvents(withMod.log)).toEqual([]);
        expect(JSON.stringify(withMod.log)).toBe(JSON.stringify(bare.log));
        const strip = (cs: Combatant[]) => JSON.stringify(cs.map(({ moduleProcs: _m, ...rest }) => rest));
        expect(strip(withMod.finalCombatants)).toBe(strip(bare.finalCombatants));
      }
    });
  });

  it("an arc that destroys the ambusher ends its salvo (no shot from a wreck)", () =>
    withTestModules([{ ...TEST_AMBUSH_WARD, effect: { key: "arcDamage", magnitude: 100_000 } }], () => {
      const e = enemy();
      e.weapons = [makeWeaponInstance("autocannon", "e-w0-autocannon")];
      const r = fight(player([{ ...TEST_AMBUSH_WARD, effect: { key: "arcDamage", magnitude: 100_000 } }], "shipEvent"), e, 3, { ambush: "e" });
      expect(r.log.some((x) => x.type === "ambush")).toBe(false);
      expect(r.outcome.winner).toBe("player");
    }));
});

describe("patrols: frozen per cycle, the replay agrees, a run in flight carries on", () => {
  // One patrol cycle (no Repeat) stepped until every wave is fought (the EM-5 patrol test's loop); `saveAt` serializes
  // the run in flight at that tick.
  const wavesDone = (s: GameState) => {
    const m = s.captains[0].mission as PatrolMissionState | null;
    return m === null || m.wavesWon + m.wavesLost >= m.waveTicks.length || m.phase === "limpingHome";
  };
  const stepOn = (s0: GameState, from: number) => {
    let s = s0;
    for (let i = from; i < 1500 && !wavesDone(s); i++) s = economyTick(s, 1, () => 0.5);
    return s;
  };
  const run = (s0: GameState, saveAt?: number) => {
    let s = dispatchCaptainOnPatrol({ ...s0, nextPatrolSeed: 11 }, 1, "crimsonReaverSweep", "balanced", false).next;
    let saved: string | null = null;
    for (let i = 0; i < 1500 && !wavesDone(s); i++) {
      if (i === saveAt) saved = serialize(s, 0, 0);
      s = economyTick(s, 1, () => 0.5);
    }
    return { s, saved };
  };
  // Merged with WR-8 (the combat rules): this pin was written before them, so its runs dispatch with the rules off
  // (combatRulesSwitch.fixture.ts withCombatRulesOff, the precedent for pre-WR-8 tests). Under the rules the save's
  // first patrol (the training cycle) ends with the same hull and shield either way, so the state check below would not
  // see the modules; the test after it proves they still fight there.
  it("an on-hit and a below-threshold module fight on every wave; live, replay and a reloaded run agree", { timeout: 60_000 }, () =>
    withTestModules([TEST_ARC_DISCHARGER, TEST_SURGE], () => withCombatRulesOff(() => {
      const base = withoutUtility(hullState("destroyer"));
      const fitted = installAll(base, [mintTestModule(TEST_ARC_DISCHARGER, "radiant", 5, "pt-arc"), mintTestModule(TEST_SURGE, "radiant", 5, "pt-surge")]);
      const bare = run(base);
      const live = run(fitted, 5);
      // The modules moved the patrol (sensitivity).
      expect(JSON.stringify(live.s.captains[0])).not.toBe(JSON.stringify(bare.s.captains[0]));
      // The display replay re-resolves every wave from the same stored cycle and installed pieces.
      const m = live.s.captains[0].mission as PatrolMissionState;
      expect(m).not.toBeNull();
      expect(m.wavesWon + m.wavesLost).toBeGreaterThan(0);
      const replay = replayPatrol(live.s, live.s.captains[0]);
      expect(replay.waves.length).toBe(m.wavesWon + m.wavesLost);
      if (!replay.defeated) expect(replay.finalPlayerHull).toBe(m.playerHull);
      expect(replay.waves.some((w) => JSON.stringify(w).includes("moduleProc"))).toBe(true);
      // Saved mid-patrol, loaded and stepped on: the same run.
      expect(live.saved).not.toBeNull();
      const t = stepOn(migrate(deserialize(live.saved!)!), 5);
      expect(JSON.stringify(t.captains[0])).toBe(JSON.stringify(live.s.captains[0]));
    })));
  it("under the WR-8 combat rules the modules still fight every wave of the cycle (the display replay shows their procs)", { timeout: 60_000 }, () =>
    withTestModules([TEST_ARC_DISCHARGER, TEST_SURGE], () => {
      const base = withoutUtility(hullState("destroyer"));
      const fitted = installAll(base, [mintTestModule(TEST_ARC_DISCHARGER, "radiant", 5, "pt-arc"), mintTestModule(TEST_SURGE, "radiant", 5, "pt-surge")]);
      const live = run(fitted);
      const m = live.s.captains[0].mission as PatrolMissionState;
      expect(m.combatRules).toBeDefined();
      const replay = replayPatrol(live.s, live.s.captains[0]);
      expect(replay.waves.length).toBeGreaterThan(0);
      expect(replay.waves.every((w) => JSON.stringify(w).includes("moduleProc"))).toBe(true);
      const bare = run(base);
      expect(JSON.stringify(replayPatrol(bare.s, bare.s.captains[0]).waves)).not.toBe(JSON.stringify(replay.waves));
    }));
});

describe("ship events: frozen in the dispatch snapshot", () => {
  it("the snapshot carries the ambush module; the cloaked vessel's ambush fires it", () =>
    withTestModules([TEST_AMBUSH_WARD], () => {
      const s = installAll(withoutUtility(hullState("orion")), [mintTestModule(TEST_AMBUSH_WARD, "standard", 0, "se-ward")]);
      const battle = snapshotShipEventProfile(s, s.ships.find((x) => x.id === SHIP)!).battle!;
      const ship = buildShipCombatant(SHIP, battle, 0, 0);
      expect(ship.moduleProcs?.map((p) => p.trigger)).toEqual(["incomingAmbush"]);
      const vessel = shipToCombatant({ id: "cloaked", team: "enemy", stats: CLOAKED_VESSEL_HULL.stats, weaponLoadout: CLOAKED_VESSEL_HULL.weapons.map((w, i) => makeWeaponInstance(w, `cloaked-w${i}-${w}`)), position: 40 });
      const r = resolveBattle({ combatants: [ship, vessel] }, 99, { precharge: true, ambush: "cloaked", generateLog: true });
      expect(procEvents(r.log).map((e) => [e.actorId, e.targetId])).toEqual([[SHIP, "cloaked"]]);
    }));
});

// ===== missions: the mission-cycle trigger =====

describe("mission cycles: a private stream per delivered cycle, offline == live", () => {
  const dispatchEcho = (withModule: boolean) =>
    withTestModules([TEST_ECHO], () => {
      const base = withoutUtility(hullState("generalFreighter"));
      const s0 = withModule ? installAll(base, [mintTestModule(TEST_ECHO, "standard", 0, "mc-echo")]) : base;
      const r = dispatchCaptainOnMission({ ...s0, captains: s0.captains.map((c) => ({ ...c, level: 10 })) }, 1, "shortOreRun");
      expect(r.success).toBe(true);
      return r.next;
    });
  const counted = (seed: number) => {
    let s = seed >>> 0;
    const fn = () => {
      fn.calls++;
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    fn.calls = 0;
    return fn;
  };
  it("the Echo grows the common haul on some cycles, takes no shared draw, and one offline call equals stepping", { timeout: 60_000 }, () =>
    withTestModules([TEST_ECHO], () => {
      const fitted = dispatchEcho(true);
      const bare = dispatchEcho(false);
      expect(missionCycleModulesFor(fitted, SHIP)?.procs).toEqual([{ moduleId: TEST_ECHO.id, chanceUnits: MODULE_CHANCE_UNITS / 2, fraction: 0.25 }]);
      const step = (s0: GameState, rng: ReturnType<typeof counted>) => {
        let s = s0;
        for (let i = 0; i < 1500; i++) s = economyTick(s, 1, rng);
        return s;
      };
      const rngA = counted(0xe6);
      const rngB = counted(0xe6);
      const withEcho = step(fitted, rngA);
      const without = step(bare, rngB);
      // The shared economy stream: the same draws with or without the module.
      expect(rngA.calls).toBe(rngB.calls);
      const cycles = withEcho.captains[0].moduleCycles ?? 0;
      expect(cycles).toBeGreaterThan(1);
      const common = (s: GameState) => itemTotal(s.inventory, "commonOre");
      expect(common(withEcho).gt(common(without))).toBe(true);
      // Offline: one tick() call over the same span is the same state.
      const offline = tick(1500, fitted, counted(0xe6), 0);
      expect(JSON.stringify(offline.captains)).toBe(JSON.stringify(withEcho.captains));
      expect(JSON.stringify(offline.inventory)).toBe(JSON.stringify(withEcho.inventory));
    }));
  it("the bonus haul is a share of the cycle's common material; whole stays whole", () => {
    expect(bonusHaulUnits(100, 0.25)).toBe(25);
    expect(bonusHaulUnits(10, 0.25)).toBe(2);
    expect(bonusHaulUnits(10.5, 0.2)).toBeCloseTo(2.1, 10);
    expect(bonusHaulUnits(0, 0.5)).toBe(0);
  });
});

// ===== expeditions: the body-scanned trigger =====

describe("body scans: frozen at dispatch, keyed per body", () => {
  const member = (id: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({ ...plainAwayMember(id, teamType, SHIP), ...over });
  const SQUAD: AwayMember[] = [member("member-1", "security", { rank: 3 }), member("member-2", "security", { rank: 2 }), member("member-11", "science")];
  const dispatch = (withModule: boolean, seed: number): { exp: Expedition; next: GameState } =>
    withTestModules([TEST_LENS], () => {
      const base = withoutUtility(hullState("orion"));
      const s0 = withModule ? installAll(base, [mintTestModule(TEST_LENS, "standard", 0, "bs-lens")]) : base;
      const s = withSlottedAwayTeams({ ...s0, awayMembers: SQUAD.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: seed });
      const res = dispatchPastPropulsion(s, SHIP, 1, expeditionCandidates(s, SHIP)[0].id);
      if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
      return { exp: res.expedition, next: res.next };
    });
  const discoveries = (e: Expedition) => e.bodies.reduce((n, b) => n + b.discoveries.length, 0);
  it("the Lens adds discoveries on some bodies only; the others' are untouched; chunked == one call", { timeout: 60_000 }, () => {
    let extra = 0;
    for (const seed of [0x1234, 0x5678, 0x9abc]) {
      const lens = dispatch(true, seed).exp;
      const bare = dispatch(false, seed).exp;
      expect(lens.moduleScanProcs).toEqual([{ moduleId: TEST_LENS.id, chanceUnits: MODULE_CHANCE_UNITS / 2, count: 1 }]);
      expect(bare.moduleScanProcs).toBeUndefined();
      const a = advanceExpedition(lens, 2_000_000);
      const b = advanceExpedition(bare, 2_000_000);
      // Each body keeps every discovery it had; the Lens only appends.
      a.bodies.forEach((body, i) => expect(body.discoveries.slice(0, b.bodies[i].discoveries.length).map((d) => d.poiId)).toEqual(b.bodies[i].discoveries.map((d) => d.poiId)));
      extra += discoveries(a) - discoveries(b);
      // The module is frozen in the run: removing it from the catalog after dispatch changes nothing.
      expect(JSON.stringify(advanceExpedition(lens, 2_000_000))).toBe(JSON.stringify(a));
      let chunked = lens;
      for (let now = lens.phaseAnchorSeconds; now < 2_000_000 && chunked.phase !== "complete"; now += 3_600) chunked = advanceExpedition(chunked, now);
      chunked = advanceExpedition(chunked, 2_000_000);
      expect(JSON.stringify(chunked.bodies)).toBe(JSON.stringify(a.bodies));
    }
    expect(extra).toBeGreaterThan(0);
  });
});
