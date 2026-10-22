// WR-8 (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-8): the seam probes the
// combat descriptors' registry entries read (registry.ts wr8Entries). Each probe is a pure function of a state (and
// its claimed context) through the real combat engine: the stamp a run starts with, the combatant a battle builds, or
// a battle (resolveBattle / fireWeapon) on a fixed set of seeds.
//
// A combat descriptor is not something a save owns, so the event probes' on / off is a MARK on the fixture
// (combatDescriptorOn): ON puts the descriptor in play, OFF takes it out (the probe says how), and the entry asserts
// the battle moved by at least its minimum effect. Self-contained (it never imports probes.ts, which spreads these
// into its PROBES table), so there is no import cycle.

import { SHIP_TYPES, type GameState, type ShipInstance } from "../model";
import { equippedFor } from "../equipment";
import { shipCombatRulesStamp } from "../crewOverlay";
import { combatHullTypeOf, shipToCombatant, type CombatShipStats } from "../combat/bridge";
import { buildPatrolPlayerCombatant } from "../combat/patrolWave";
import { applyProjectileDamage, fireWeapon, resolveBattle, type ResolveOptions } from "../combat/resolveBattle";
import { makeWeaponInstance, type WeaponId } from "../combat/weapons";
import { makeSquadron, type DroneRole, type DroneSquadron } from "../combat/drones";
import { generateEnemyWave } from "../combat/enemyWave";
import { makeRng } from "../combat/rng";
import { applyEffect } from "../combat/statusEffects";
import { stancePreferredDistance, type CombatStance } from "../combat/positioning";
import type { Combatant, CombatEvent } from "../combat/types";
import type { PirateHullId } from "../combat/enemyHulls";
import { COMBAT_RULES_WR8, ENCOUNTER_OPEN_DISTANCE, RULES_COMBAT_SPEED, stampCombatArgs, withWeaponRuleTraits, type CombatRulesStamp } from "../combat/combatRules";
import { shipEventEnemy, HOSTILE_PROBE_HULL } from "../shipScanEvents";
import type { Expedition, ExpeditionBody } from "../model";

// The context ids these probes read (a subset of probes.ts CONTEXT_IDS, named here to keep the module a leaf).
type Ctx = string;
interface Def {
  readonly label: string;
  readonly read: (s: GameState, ctx: Ctx) => number;
}

const SHIP = "ship-1";
const SEEDS = [11, 12345, 777];
const RULES: ResolveOptions = { combatRules: COMBAT_RULES_WR8 };

// ===== The on / off mark =====

const ON = new WeakSet<GameState>();
// The fixture with the WR-8 combat descriptor switched ON (a fresh object, so the mark never leaks onto another state).
export function combatDescriptorOn(s: GameState): GameState {
  const next = { ...s };
  ON.add(next);
  return next;
}
const isOn = (s: GameState): boolean => ON.has(s);

// ===== Builders =====

const FRAME: CombatShipStats = { hullIntegrity: 600, shieldCapacity: 0, shieldRecharge: 0 };

interface ShipSpec {
  id: string;
  team: "player" | "enemy";
  weapons?: WeaponId[];
  drones?: (DroneRole | DroneSquadron)[];
  stats?: CombatShipStats;
  stance?: CombatStance;
  position?: number;
  speed?: number;
  rules?: boolean;
}
function ship(spec: ShipSpec): Combatant {
  return shipToCombatant({
    id: spec.id,
    team: spec.team,
    stats: spec.stats ?? FRAME,
    weaponLoadout: (spec.weapons ?? []).map((w, i) => makeWeaponInstance(w, `${spec.id}-w${i}-${w}`)),
    drones: (spec.drones ?? []).map((d, i) => (typeof d === "string" ? makeSquadron(d, undefined, 0, `${spec.id}-${d}${i}`) : d)),
    stance: spec.stance ?? "balanced",
    position: spec.position ?? 0,
    speed: spec.speed ?? RULES_COMBAT_SPEED,
    combatRules: spec.rules ?? true,
  });
}

function battles(make: () => Combatant[], opts: ResolveOptions): { finalCombatants: Combatant[]; log: CombatEvent[] }[] {
  return SEEDS.map((seed) => resolveBattle({ combatants: make() }, seed, opts));
}
const lost = (c: Combatant | undefined): number => (c ? c.hullMax + c.shieldMax - Math.max(0, c.hull) - Math.max(0, c.shield) : 0);
const sumOver = <T>(xs: T[], f: (x: T) => number): number => xs.reduce((n, x) => n + f(x), 0);
const byId = (cs: Combatant[], id: string): Combatant | undefined => cs.find((c) => c.id === id);
// The first tick a combatant fired a weapon shot (a hit or an evade) in a logged battle, 0 if it never did.
const firstShotTick = (log: CombatEvent[], id: string): number => log.find((e) => e.actorId === id && (e.type === "hit" || e.type === "evade"))?.tDeciSec ?? 0;
// A combatant's distance to its target on round `round`'s readout (0 if absent).
const distanceAt = (log: CombatEvent[], id: string, round: number): number => log.find((e) => e.type === "roundState" && e.actorId === id && e.round === round)?.distance ?? 0;

// ===== State reads =====

function shipOf(s: GameState): ShipInstance {
  const sh = s.ships.find((x) => x.id === SHIP);
  if (!sh) throw new Error("combat descriptor probe: no ship-1");
  return sh;
}
// ship-1 as a patrol cycle under the combat rules builds it (its installed gear, its frozen combat speed).
function rulesCombatant(s: GameState): Combatant {
  const sh = shipOf(s);
  const stamp = shipCombatRulesStamp(s, sh) ?? { rules: COMBAT_RULES_WR8, speed: RULES_COMBAT_SPEED };
  return shipToCombatant({
    id: "wiring-player",
    team: "player",
    stats: SHIP_TYPES[sh.typeKey],
    hullType: combatHullTypeOf(sh.typeKey) ?? undefined,
    installedGear: equippedFor(s, sh.id),
    ...stampCombatArgs(stamp),
  });
}
// The minimal run whose ship events fight under the combat rules (the fields shipEventEnemy reads).
function rulesRun(): { exp: Expedition; body: ExpeditionBody } {
  const stamp: CombatRulesStamp = { rules: COMBAT_RULES_WR8, speed: RULES_COMBAT_SPEED };
  const exp = { id: "wiring-run", seed: 1, groundOps: { shipEventProfile: { battle: { combatRules: stamp } } } } as unknown as Expedition;
  return { exp, body: { hazard: 0 } as ExpeditionBody };
}

// ===== The probes =====

export const COMBAT_DESCRIPTOR_PROBES = {
  // OC-D9: the enemy side opens at range: a patrol wave under the rules, or a ship event's vessel on a run under them.
  combatOpenDistance: {
    label: "the enemy's opening position under the combat rules (enemyWave.ts, shipScanEvents.ts shipEventEnemy)",
    read: (_s, ctx) => {
      if (ctx === "shipEvent") {
        const { exp, body } = rulesRun();
        return shipEventEnemy(exp, body, 0, 0, HOSTILE_PROBE_HULL).position;
      }
      return generateEnemyWave(1, { hullPool: ["raider"], enemyCountMin: 1, enemyCountMax: 1, idPrefix: "wiring", combatRules: true })[0].position;
    },
  },
  // The ship's combat speed a run starting now freezes (crewOverlay.ts shipCombatRulesStamp: the sheet transit speed).
  combatSpeedStamp: {
    label: "crewOverlay.ts shipCombatRulesStamp(...).speed",
    read: (s) => shipCombatRulesStamp(s, shipOf(s))?.speed ?? 0,
  },
  // The installed Reactor Core's and FTL drive's pools under the rules (their quality).
  combatReactorPoolMax: { label: "the rules combatant's reactor durabilityMax", read: (s) => rulesCombatant(s).reactor?.durabilityMax ?? 0 },
  combatFtlPoolMax: { label: "the rules combatant's FTL durabilityMax", read: (s) => rulesCombatant(s).ftl?.durabilityMax ?? 0 },
  // The resist and pod lines, read off the installed gear (ungated: no piece rolled them before WR-8).
  combatDamageResistKinetic: { label: "shipToCombatant.damageResist.kinetic", read: (s) => rulesCombatant(s).damageResist.kinetic },
  combatDamageResistParticle: { label: "shipToCombatant.damageResist.particle", read: (s) => rulesCombatant(s).damageResist.particle },
  combatDamageResistEw: { label: "shipToCombatant.damageResist.ew", read: (s) => rulesCombatant(s).damageResist.ew },
  combatDisruptionResistKinetic: { label: "shipToCombatant.disruptionResist.kinetic", read: (s) => rulesCombatant(s).disruptionResist.kinetic },
  combatDisruptionResistParticle: { label: "shipToCombatant.disruptionResist.particle", read: (s) => rulesCombatant(s).disruptionResist.particle },
  combatDisruptionResistEw: { label: "shipToCombatant.disruptionResist.ew", read: (s) => rulesCombatant(s).disruptionResist.ew },
  combatInCombatReplenish: { label: "shipToCombatant.inCombatReplenishPercent", read: (s) => rulesCombatant(s).inCombatReplenishPercent ?? 0 },
  combatRapidChargeShare: { label: "shipToCombatant.rapidChargeShare", read: (s) => rulesCombatant(s).rapidChargeShare ?? 0 },
  combatSmartReflectChance: {
    label: "the highest squadron smartReflectChance (bridge.ts squadronFromPod)",
    read: (s) => Math.max(0, ...rulesCombatant(s).drones.map((sq) => sq.smartReflectChance ?? 0)),
  },
  // OC-D12 "conditions persist across the waves of one patrol": the next wave's combatant opens with the carried status.
  combatStatusCarry: {
    label: "combat/patrolWave.ts buildPatrolPlayerCombatant(carryStatusEffects).statusEffects.length",
    read: (s) => {
      const p = buildPatrolPlayerCombatant({
        playerId: "wiring-player",
        stats: SHIP_TYPES.destroyer,
        hullType: "destroyer",
        stance: "balanced",
        carryHull: 600,
        carryShield: 0,
        carryDrones: [],
        combatRules: { rules: COMBAT_RULES_WR8, speed: RULES_COMBAT_SPEED },
        carryStatusEffects: isOn(s) ? applyEffect([], "sensorPowerDrain", 0, makeRng(1)) : [],
      });
      return p.statusEffects.length;
    },
  },
  // The Tachyon anti-shield exception: the vs-Shields column a Tachyon shot built under the rules lands with (the EW
  // family column without the trait).
  combatTachyonVsShields: {
    label: "applyProjectileDamage's vs-Shields column for a Tachyon Burst Emitter",
    read: (s) => {
      const w = isOn(s) ? withWeaponRuleTraits(makeWeaponInstance("tachyonBurstEmitter")) : makeWeaponInstance("tachyonBurstEmitter");
      const target = ship({ id: "t", team: "enemy", stats: { hullIntegrity: 100, shieldCapacity: 1_000_000, shieldRecharge: 0 } });
      return applyProjectileDamage(target, "ew", 0, 0, 1000, false, w.vsShieldsPct).dealt / 10;
    },
  },
  // A pirate hull's stance under the rules: the distance the generated enemy holds at.
  ...pirateStanceProbes(),
  // ===== Battle events (on = the descriptor in play) =====
  combatEventWeaponRange: {
    label: "a railgun's range gates its fire at 250 (the target's damage taken)",
    read: (s) => {
      const range = isOn(s) ? 300 : 200;
      return sumOver(battles(() => {
        const p = ship({ id: "p", team: "player", weapons: ["railgun"], speed: 0 });
        p.weapons = p.weapons.map((w) => ({ ...w, range }));
        return [p, ship({ id: "e", team: "enemy", position: 250, speed: 0 })];
      }, RULES), (r) => lost(byId(r.finalCombatants, "e")));
    },
  },
  combatEventDroneRange: {
    label: "an Attack squadron's reach gates its volleys at 150 (the target's damage taken)",
    read: (s) => {
      const range = isOn(s) ? 100 : 300;
      return sumOver(battles(() => {
        const sq = makeSquadron("attack", undefined, 0, "p-attack0");
        sq.range = range;
        return [ship({ id: "p", team: "player", drones: [sq], speed: 0 }), ship({ id: "e", team: "enemy", position: 150, speed: 0 })];
      }, RULES), (r) => lost(byId(r.finalCombatants, "e")));
    },
  },
  combatEventStance: {
    label: "the player's patrol stance against a Marauder (both ships' damage taken): Aggressive vs Standoff",
    read: (s) =>
      sumOver(battles(() => [
        ship({ id: "p", team: "player", weapons: ["autocannon", "autocannon", "plasma"], stats: { hullIntegrity: 900, shieldCapacity: 200, shieldRecharge: 5 }, stance: isOn(s) ? "aggressive" : "standoff" }),
        ...pirates("marauder"),
      ], RULES), (r) => lost(byId(r.finalCombatants, "p")) + sumOver(r.finalCombatants.filter((c) => c.team === "enemy"), lost)),
  },
  combatEventSpeedKite: {
    label: "a faster ship opens the range on a Raider (its own damage taken): speed 40 vs the Raider's 30",
    read: (s) =>
      sumOver(battles(() => [
        ship({ id: "p", team: "player", weapons: ["plasma"], stats: { hullIntegrity: 900, shieldCapacity: 0, shieldRecharge: 0 }, stance: "standoff", speed: isOn(s) ? 40 : RULES_COMBAT_SPEED }),
        ...pirates("raider"),
      ], RULES), (r) => lost(byId(r.finalCombatants, "p"))),
  },
  combatEventFtlSpeedPenalty: {
    label: "a Degraded FTL drive slows the close on a railgun platform (the first round the player is within 100)",
    read: (s) => firstRoundWithin((p) => {
      if (isOn(s) && p.ftl) p.ftl.durability = Math.floor(p.ftl.durabilityMax / 2);
    }),
  },
  combatEventCoolantLeak: {
    label: "Coolant Leak slows the close (the player's distance on round 3)",
    read: (s) =>
      sumOver(battles(() => {
        const p = ship({ id: "p", team: "player", weapons: ["autocannon"], stance: "aggressive" });
        if (isOn(s)) p.statusEffects = applyEffect([], "coolantLeak", 0, makeRng(1));
        return [p, ship({ id: "e", team: "enemy", weapons: ["railgun"], position: ENCOUNTER_OPEN_DISTANCE, speed: 0 })];
      }, { ...RULES, generateLog: true }), (r) => distanceAt(r.log, "p", 3)),
  },
  combatEventSensorDrain: {
    label: "Sensor Power Drain shrinks a railgun's reach below 250 until it lapses (the first shot's tick)",
    read: (s) =>
      sumOver(battles(() => {
        const p = ship({ id: "p", team: "player", weapons: ["railgun"], speed: 0 });
        if (isOn(s)) p.statusEffects = applyEffect([], "sensorPowerDrain", 0, makeRng(1));
        return [p, ship({ id: "e", team: "enemy", position: 250, speed: 0 })];
      }, { ...RULES, precharge: true, generateLog: true }), (r) => firstShotTick(r.log, "p")),
  },
  combatEventManifoldOverheat: {
    label: "Manifold Overheat cuts a Raider's evasion (autocannon projectiles that hit, 300 shots)",
    read: (s) => projectilesHit("autocannon", () => {
      const e = pirates("raider")[0];
      if (isOn(s)) e.statusEffects = applyEffect(applyEffect(applyEffect([], "manifoldOverheat", 100, makeRng(1)), "manifoldOverheat", 100, makeRng(1)), "manifoldOverheat", 100, makeRng(1));
      return e;
    }),
  },
  combatEventArmorPen: {
    label: "a Concussion Torpedo's armor pen against a Marauder's plates (hull damage, 60 shots)",
    read: (s) => damageOver("concussionTorpedo", (w) => (isOn(s) ? w : { ...w, armorPen: 0 }), () => stripShield(pirates("marauder")[0])),
  },
  combatEventEnemyMitigation: {
    label: "a Marauder's armor and evasion under the rules (an autocannon's damage, 300 shots)",
    read: (s) => damageOver("autocannon", (w) => w, () => stripShield(isOn(s) ? pirates("marauder")[0] : pirates("marauder", false)[0])),
  },
  combatEventPrecharge: {
    label: "patrols pre-charge their guns: the first railgun shot's tick",
    read: (s) =>
      sumOver(battles(() => [ship({ id: "p", team: "player", weapons: ["railgun"], speed: 0 }), ship({ id: "e", team: "enemy", position: 250, speed: 0 })], {
        ...RULES,
        generateLog: true,
        ...(isOn(s) ? { precharge: true } : {}),
      }), (r) => firstShotTick(r.log, "p")),
  },
  combatEventAntiDrone: {
    label: "Point Defense aims at the drones under the rules: shots spent on the screen never spill onto the carrier (its damage taken)",
    read: (s) =>
      sumOver(battles(() => [
        ship({ id: "p", team: "player", weapons: ["pointDefenseArray"], rules: isOn(s), stats: { hullIntegrity: 100_000, shieldCapacity: 0, shieldRecharge: 0 } }),
        ship({ id: "e", team: "enemy", drones: ["defense", "defense"], stats: { hullIntegrity: 100_000, shieldCapacity: 0, shieldRecharge: 0 } }),
      ], RULES), (r) => lost(byId(r.finalCombatants, "e"))),
  },
  combatEventDroneDisrupted: {
    label: "an EMP anti-drone hit leaves a Defense drone it does not destroy disrupted (drones disrupted at the end)",
    read: (s) => droneScreenAfter(["empCannon"], "defense", isOn(s), (sq) => sq.drones.filter((d) => d.alive && d.status === "disrupted").length),
  },
  combatEventVsDrones: {
    label: "the vs-Drones column on a Defense drone absorbing autocannon fire (drone hit points lost, 200 shots)",
    read: (s) => {
      let hpLost = 0;
      const rng = makeRng(7);
      for (let i = 0; i < 200; i++) {
        const attacker = ship({ id: "a", team: "player", weapons: ["autocannon"] });
        const sq = makeSquadron("defense", undefined, 0, "t-defense0");
        sq.interceptChance = 0; // every drone absorbs (no deflect roll passes)
        const target = ship({ id: "t", team: "enemy", drones: [sq], stats: { hullIntegrity: 10_000, shieldCapacity: 0, shieldRecharge: 0 } });
        const before = target.drones[0].drones.reduce((n, d) => n + d.hp, 0);
        fireWeapon(attacker, target, attacker.weapons[0], rng, false, { combatants: [attacker, target], rules: isOn(s) });
        hpLost += before - target.drones[0].drones.reduce((n, d) => n + Math.max(0, d.hp), 0);
      }
      return hpLost;
    },
  },
  combatEventInhibitSource: {
    label: "Point Defense procs Inhibit on a drone-fielding enemy (Inhibits applied, logged)",
    read: (s) =>
      sumOver(battles(() => [
        ship({ id: "p", team: "player", weapons: ["pointDefenseArray"], rules: isOn(s) }),
        ship({ id: "e", team: "enemy", drones: ["defense"], stats: { hullIntegrity: 5000, shieldCapacity: 0, shieldRecharge: 0 } }),
      ], { ...RULES, generateLog: true }), (r) => r.log.filter((e) => e.type === "effectApplied" && e.effectDefId === "inhibit").length),
  },
  combatEventInhibitReader: {
    label: "Inhibit slows an Attack squadron's volleys (its volleys in the first 5 s)",
    read: (s) =>
      sumOver(battles(() => {
        const e = ship({ id: "e", team: "enemy", drones: ["attack"], speed: 0 });
        if (isOn(s)) e.statusEffects = applyEffect([], "inhibit", 0, makeRng(1));
        return [ship({ id: "p", team: "player", stats: { hullIntegrity: 100_000, shieldCapacity: 0, shieldRecharge: 0 }, speed: 0 }), e];
      }, { ...RULES, generateLog: true }), (r) => r.log.filter((ev) => ev.type === "droneVolley" && ev.actorId === "e" && ev.tDeciSec <= 50).length),
  },
  combatEventOvercharge: {
    label: "a support pulse charges its owner's capacitors under the rules (the Overcharged Capacitors rank at the end)",
    read: (s) =>
      sumOver(battles(() => [
        ship({ id: "p", team: "player", drones: ["support"], stats: { hullIntegrity: 1000, shieldCapacity: 100, shieldRecharge: 5 } }),
        ship({ id: "e", team: "enemy", stats: { hullIntegrity: 100_000, shieldCapacity: 0, shieldRecharge: 0 } }),
      ], isOn(s) ? RULES : {}), (r) => byId(r.finalCombatants, "p")?.statusEffects.find((x) => x.defId === "overchargedCapacitors")?.rank ?? 0),
  },
  combatEventVoltaicChain: {
    label: "a Voltaic shot arcs to the second foe (that foe's damage taken)",
    read: (s) =>
      sumOver(battles(() => [
        ship({ id: "p", team: "player", weapons: ["voltaic"], rules: isOn(s), speed: 0 }),
        ship({ id: "e0", team: "enemy", stats: { hullIntegrity: 100_000, shieldCapacity: 0, shieldRecharge: 0 }, speed: 0 }),
        ship({ id: "e1", team: "enemy", stats: { hullIntegrity: 100_001, shieldCapacity: 0, shieldRecharge: 0 }, speed: 0 }),
      ], RULES), (r) => lost(byId(r.finalCombatants, "e1"))),
  },
  combatEventInCombatReplenish: {
    label: "an in-combat replenish rebuilds and repairs Attack drones under Point Defense fire (drones restored, logged)",
    read: (s) =>
      sumOver(battles(() => {
        const e = ship({ id: "e", team: "enemy", drones: ["attack"], stats: { hullIntegrity: 100_000, shieldCapacity: 0, shieldRecharge: 0 } });
        if (isOn(s)) e.inCombatReplenishPercent = 50;
        return [ship({ id: "p", team: "player", weapons: ["pointDefenseArray"], stats: { hullIntegrity: 100_000, shieldCapacity: 0, shieldRecharge: 0 } }), e];
      }, { ...RULES, generateLog: true }), (r) => sumOver(r.log.filter((ev) => ev.type === "droneReplenish" && ev.actorId === "e"), (ev) => ev.projectilesHit ?? 0)),
  },
  combatEventSmartReflect: {
    label: "Smart Reflect sends reflected plasma at the weakest foe (that foe's damage taken)",
    read: (s) =>
      sumOver(battles(() => {
        const sq = makeSquadron("defense", undefined, 0, "p-defense0");
        sq.interceptChance = 100;
        sq.reflectChance = 100;
        if (isOn(s)) sq.smartReflectChance = 100;
        return [
          ship({ id: "p", team: "player", drones: [sq], stats: { hullIntegrity: 100_000, shieldCapacity: 0, shieldRecharge: 0 }, speed: 0 }),
          ship({ id: "e0", team: "enemy", weapons: ["plasma"], stats: { hullIntegrity: 100_000, shieldCapacity: 0, shieldRecharge: 0 }, speed: 0 }),
          ship({ id: "e1", team: "enemy", stats: { hullIntegrity: 50_000, shieldCapacity: 0, shieldRecharge: 0 }, speed: 0 }),
        ];
      }, RULES), (r) => lost(byId(r.finalCombatants, "e1"))),
  },
  combatEventRapidCharge: {
    label: "Rapid Charge shortens an ambushed ship's return-fire delay (the ambushed ship's first shot tick)",
    read: (s) =>
      sumOver(SEEDS, (seed) => {
        const p = ship({ id: "p", team: "player", weapons: ["autocannon"], stats: { hullIntegrity: 100_000, shieldCapacity: 0, shieldRecharge: 0 }, speed: 0 });
        if (isOn(s)) p.rapidChargeShare = 0.5;
        const e = ship({ id: "e", team: "enemy", weapons: ["autocannon"], stats: { hullIntegrity: 100_000, shieldCapacity: 0, shieldRecharge: 0 }, speed: 0 });
        const r = resolveBattle({ combatants: [p, e] }, seed, { ...RULES, precharge: true, ambush: "e", generateLog: true });
        return firstShotTick(r.log, "p");
      }),
  },
} satisfies Record<string, Def>;

// ===== Helpers the probes share =====

// A pirate wave of one `hull`, under the rules (armor, evasion, range) unless `rules` is false.
function pirates(hull: PirateHullId, rules = true): Combatant[] {
  return generateEnemyWave(1, { hullPool: [hull], enemyCountMin: 1, enemyCountMax: 1, idPrefix: "wiring", ...(rules ? { combatRules: true } : {}) });
}
function stripShield(c: Combatant): Combatant {
  c.shield = 0;
  c.shieldMax = 0;
  return c;
}
// The projectiles of `weapon` that hit a fresh `target()` over 300 shots on one stream.
function projectilesHit(weapon: WeaponId, target: () => Combatant): number {
  const rng = makeRng(3);
  let hits = 0;
  for (let i = 0; i < 300; i++) {
    const a = ship({ id: "a", team: "player", weapons: [weapon] });
    hits += fireWeapon(a, target(), a.weapons[0], rng).projectilesHit;
  }
  return hits;
}
// The damage `weapon` (shaped by `shape`) deals to a fresh `target()` over 300 shots on one stream.
function damageOver(weapon: WeaponId, shape: (w: ReturnType<typeof makeWeaponInstance>) => ReturnType<typeof makeWeaponInstance>, target: () => Combatant): number {
  const rng = makeRng(5);
  let dealt = 0;
  for (let i = 0; i < 300; i++) {
    const a = ship({ id: "a", team: "player" });
    dealt += fireWeapon(a, target(), shape(makeWeaponInstance(weapon, "a-w0")), rng).damage;
  }
  return dealt;
}
// A battle of a player firing `weapons` (with or without the rule traits and the rules) at an enemy fielding one
// `role` squadron, then `read` of the enemy's squadron at the end.
function droneScreenAfter(weapons: WeaponId[], role: DroneRole, traits: boolean, read: (sq: DroneSquadron) => number): number {
  return sumOver(battles(() => [
    ship({ id: "p", team: "player", weapons, rules: traits, stats: { hullIntegrity: 100_000, shieldCapacity: 0, shieldRecharge: 0 } }),
    ship({ id: "e", team: "enemy", drones: [role], stats: { hullIntegrity: 100_000, shieldCapacity: 0, shieldRecharge: 0 } }),
  ], traits ? RULES : {}), (r) => sumOver(byId(r.finalCombatants, "e")?.drones ?? [], read));
}
// The first round the player is within 100 of an immobile railgun platform at the opening distance, summed over the
// seeds, after `shape` edits the player.
function firstRoundWithin(shape: (p: Combatant) => void): number {
  return sumOver(battles(() => {
    const p = ship({ id: "p", team: "player", weapons: ["autocannon"], stance: "aggressive", stats: { hullIntegrity: 100_000, shieldCapacity: 0, shieldRecharge: 0 } });
    shape(p);
    return [p, ship({ id: "e", team: "enemy", weapons: ["railgun"], position: ENCOUNTER_OPEN_DISTANCE, speed: 0, stats: { hullIntegrity: 100_000, shieldCapacity: 0, shieldRecharge: 0 } })];
  }, { ...RULES, generateLog: true }), (r) => {
    const hit = r.log.find((e) => e.type === "roundState" && e.actorId === "p" && (e.distance ?? Infinity) <= 100);
    return hit?.round ?? 0;
  });
}
// One probe per pirate hull: the distance its generated combatant holds at (its stance) under the rules.
function pirateStanceProbes(): Record<`combatPirateStance:${PirateHullId}`, Def> {
  const out = {} as Record<`combatPirateStance:${PirateHullId}`, Def>;
  for (const id of ["raider", "marauder", "corsairCarrier"] as PirateHullId[]) {
    out[`combatPirateStance:${id}`] = { label: `the ${id}'s stance distance under the rules`, read: () => stancePreferredDistance(pirates(id)[0].stance) };
  }
  return out;
}
