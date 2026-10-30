// WR-5b (0.14.0): the captain Tactician tree (Gunnery, Aegis, Fleet Ops) wired. Every node is checked at its
// consumer (a real resolveBattle, a real patrol, the Shipyard and field repairs), at its CATALOG magnitude, on the
// ship its captain commands, frozen at dispatch / per patrol cycle, offline == live, and a save without a node is
// byte-identical (tacticianGoldens.test.ts pins that). The registry's seam checks are wiring.sensitivity.test.ts.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  SECONDARY_CAPTAIN_TALENTS,
  SHIP_TYPES,
  freshState,
  withFavoredLines,
  type CaptainCombatMods,
  type EquipmentInstance,
  type GameState,
  type PatrolMissionState,
  type SecondaryTalentKey,
  type ShipTypeKey,
} from "./model";
import {
  TACTICIAN_MOD_OF,
  captainCombatMods,
  captainWaveRegenFraction,
  patrolWaveRewardMult,
  tacticianEffectText,
  tacticianMagnitude,
  withCaptainRepair,
} from "./captainTacticianEffects";
import { secondaryTalentEffectText } from "./captainSecondaryEffects";
import {
  dispatchCaptainOnPatrol,
  economyTick,
  installMissingCombatBaselines,
  shipRepairDurationTicks,
  shipyardRepairSpeedBonus,
} from "./tick";
import { equippedFor } from "./equipment";
import { officerRepairSpeedBonus } from "./crewOverlay";
import { shipToCombatant, foldedPlayerDefense } from "./combat/bridge";
import { resolveBattle, applyProjectileDamage } from "./combat/resolveBattle";
import { replayPatrol } from "./combat/patrolReplay";
import { captainDroneDamage, captainProjectileDamage, incomingHitChance, landHullDamage, OVERCHARGE_HULL_SHARE } from "./combat/captainEdge";
import { buildShipCombatant, snapshotShipEventProfile } from "./shipScanEvents";
import { damageControlEffect, DAMAGE_CONTROL_SUITE_KEY } from "./utilityGear";
import { generateEquipment } from "./itemgen";
import type { Combatant } from "./combat/types";

const TACTICIAN: readonly SecondaryTalentKey[] = [
  "gunnery1", "gunnery2", "gunnery3", "gunnery4", "gunnery5",
  "aegis1", "aegis2", "aegis3", "aegis4", "aegis5",
  "fleetOps1", "fleetOps2", "fleetOps3", "fleetOps4", "fleetOps5",
];

const m = (key: SecondaryTalentKey): number => tacticianMagnitude(key);
const mods = (key: SecondaryTalentKey): CaptainCombatMods => captainCombatMods({ unlockedSecondaryTalents: [key] } as never)!;

function seededRng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) ^ 0x9e3779b9) >>> 0;
    return (x >>> 8) / (1 << 24);
  };
}

function dcSuite(): EquipmentInstance {
  const piece = generateEquipment({
    slotType: "specUtility",
    varietyKey: DAMAGE_CONTROL_SUITE_KEY,
    blueprintKey: null,
    iLevel: 30,
    quality: 2,
    rarity: "augmented",
    ascension: "none",
    rng: seededRng(30 * 31 + 2),
    allocateId: () => "dcs-1",
  });
  return { ...piece, fittedToShipId: "ship-1" };
}

// ship-1 on `typeKey` with its Standard Issue combat gear (and optionally a Damage Control Suite), captain 1 owning
// `nodes` (hand-edited: the allocation rules are captainSecondaryTree's subject).
function onHull(typeKey: ShipTypeKey, nodes: readonly SecondaryTalentKey[], opts: { suite?: boolean } = {}): GameState {
  const base = freshState();
  const s = installMissingCombatBaselines({
    ...base,
    credits: new Decimal(1_000_000),
    ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey } : sh)),
  });
  return {
    ...s,
    equipment: opts.suite ? [...s.equipment, dcSuite()] : s.equipment,
    captains: s.captains.map((c) => (c.id === 1 ? { ...c, unlockedSecondaryTalents: [...nodes] } : c)),
  };
}

function patrolOf(s: GameState): PatrolMissionState {
  return s.captains[0].mission as PatrolMissionState;
}

function dispatched(s0: GameState, patrol = "crimsonReaverSweep", repeat = true): GameState {
  const r = dispatchCaptainOnPatrol(s0, 1, patrol, "balanced", repeat);
  if (!r.success) throw new Error(`patrol refused: ${r.reason}`);
  return r.next;
}

// A player ship (the destroyer's default loadout) shooting a weaponless, shieldless, armorless 1,000,000-hull dummy
// until the battle cap: the damage it deals (no effect procs). With `dronesOnly`, a carrier with its weapons removed.
// The factor is exact on each projectile's raw damage (the seam tests below); the hull it lands on passes the damage
// triangle's whole-point rounding, so a battle total sits within BATTLE_TOLERANCE of the factor.
const BATTLE_TOLERANCE = 0.02;
function damageDealt(captainCombat: CaptainCombatMods | undefined, opts: { dronesOnly?: boolean; seed?: number } = {}): number {
  const typeKey: ShipTypeKey = opts.dronesOnly ? "carrier" : "destroyer";
  const player = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES[typeKey], hullType: typeKey, captainCombat });
  // No effect procs: a damage-over-time status is not a projectile, so it would blur the projectile factor.
  player.weapons = opts.dronesOnly ? [] : player.weapons.map((w) => ({ ...w, effectSlots: [] }));
  const dummy = shipToCombatant({ id: "dummy", team: "enemy", stats: { hullIntegrity: 1_000_000, shieldCapacity: 0, shieldRecharge: 0 }, weaponLoadout: [] });
  const { finalCombatants } = resolveBattle({ combatants: [player, dummy] }, opts.seed ?? 0x77);
  const d = finalCombatants.find((c) => c.id === "dummy")!;
  return d.hullMax - d.hull;
}

// A weaponless 1,000,000-hull player shot at by a destroyer until the cap: the damage it takes.
function damageTaken(captainCombat: CaptainCombatMods | undefined, seed = 0x91): number {
  const player = shipToCombatant({ id: "p", team: "player", stats: { hullIntegrity: 1_000_000, shieldCapacity: 0, shieldRecharge: 0 }, weaponLoadout: [], captainCombat });
  const enemy = shipToCombatant({ id: "e", team: "enemy", stats: SHIP_TYPES.destroyer, hullType: "destroyer" });
  const { finalCombatants } = resolveBattle({ combatants: [player, enemy] }, seed);
  const p = finalCombatants.find((c) => c.id === "p")!;
  return p.hullMax - p.hull;
}

describe("the frozen record and the text", () => {
  it("each Tactician node maps to its own field at its catalog magnitude; nothing else contributes", () => {
    expect(captainCombatMods(undefined)).toBeUndefined();
    expect(captainCombatMods({ unlockedSecondaryTalents: [] } as never)).toBeUndefined();
    expect(captainCombatMods({ unlockedSecondaryTalents: ["extraction1", "surveySensors1"] } as never)).toBeUndefined();
    for (const key of TACTICIAN) {
      const field = TACTICIAN_MOD_OF[key]!;
      expect(m(key), key).toBeGreaterThan(0);
      expect(mods(key), key).toEqual({ [field]: m(key) });
    }
    expect(new Set(TACTICIAN.map((k) => TACTICIAN_MOD_OF[k])).size).toBe(TACTICIAN.length);
  });

  it("the capstones carry the plan table's sizes and no Tactician node is a placeholder (OC-A3)", () => {
    expect(m("gunnery5")).toBe(0.5);
    expect(m("aegis5")).toBe(1);
    expect(m("fleetOps5")).toBe(1);
    expect(SECONDARY_CAPTAIN_TALENTS.fleetOps4.effect.type).toBe("statMult");
    for (const key of TACTICIAN) {
      const text = secondaryTalentEffectText(key);
      expect(text, key).toBe(tacticianEffectText(key));
      expect(text, key).not.toMatch(/No bonus yet|first-pass|pending/);
      expect(text, key).not.toMatch(new RegExp(`${String.fromCharCode(0x2014)}|-{2}`));
    }
  });
});

describe("Gunnery", () => {
  it("gunnery1 Weapons Drill: every projectile x (1 + m), over a whole battle", () => {
    const off = damageDealt(undefined);
    const on = damageDealt(mods("gunnery1"));
    expect(off).toBeGreaterThan(1000);
    expect(Math.abs(on / off - (1 + m("gunnery1")))).toBeLessThanOrEqual(BATTLE_TOLERANCE);
  });

  it("gunnery1 banks a small factor on small hits instead of rounding it away", () => {
    const edge = { weaponDamage: m("gunnery1"), highHealthDamage: 0, openingVolley: 0, droneDamage: 0, evasion: 0 };
    const weapon = { openingVolley: false } as never;
    let total = 0;
    for (let i = 0; i < 1000; i++) total += captainProjectileDamage(edge, weapon, { hull: 1, hullMax: 100 }, 4);
    expect(total).toBe(Math.floor(4000 * (1 + m("gunnery1"))));
  });

  it("gunnery2 Marksman: every weapon's accuracy x (1 + m), and more of the battle's shots land", () => {
    const off = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, hullType: "destroyer" });
    const on = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, hullType: "destroyer", captainCombat: mods("gunnery2") });
    on.weapons.forEach((w, i) => expect(w.accuracy).toBe(Math.round(off.weapons[i].accuracy * (1 + m("gunnery2")))));
    expect(damageDealt(mods("gunnery2"))).toBeGreaterThan(damageDealt(undefined));
  });

  it("gunnery3 Overcharge: x (1 + m) only while the target is above half hull", () => {
    const edge = { weaponDamage: 0, highHealthDamage: m("gunnery3"), openingVolley: 0, droneDamage: 0, evasion: 0 };
    const weapon = { openingVolley: false } as never;
    let high = 0;
    let low = 0;
    for (let i = 0; i < 1000; i++) {
      high += captainProjectileDamage(edge, weapon, { hull: 51, hullMax: 100 }, 100);
      low += captainProjectileDamage(edge, weapon, { hull: OVERCHARGE_HULL_SHARE * 100, hullMax: 100 }, 100);
    }
    expect(high).toBe(100_000 * (1 + m("gunnery3")));
    expect(low).toBe(100_000);
    // The dummy never drops below half: the whole battle is overcharged.
    expect(Math.abs(damageDealt(mods("gunnery3")) / damageDealt(undefined) - (1 + m("gunnery3")))).toBeLessThanOrEqual(BATTLE_TOLERANCE);
  });

  it("gunnery4 Ammo Reserves: every cooldown clock runs (1 + m) as fast, so more shots fire", () => {
    const on = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, hullType: "destroyer", captainCombat: mods("gunnery4") });
    for (const w of on.weapons) expect(w.chargeRatePct).toBe(Math.round(100 * (1 + m("gunnery4"))));
    const off = damageDealt(undefined);
    const ratio = damageDealt(mods("gunnery4")) / off;
    expect(ratio).toBeGreaterThan(1 + m("gunnery4") * 0.6);
    expect(ratio).toBeLessThan(1 + m("gunnery4") * 1.6);
  });

  it("gunnery5 Alpha Strike: x (1 + m) on each weapon's first shot only", () => {
    const edge = { weaponDamage: 0, highHealthDamage: 0, openingVolley: m("gunnery5"), droneDamage: 0, evasion: 0 };
    expect(captainProjectileDamage(edge, { openingVolley: true } as never, { hull: 1, hullMax: 1 }, 100)).toBe(100 * (1 + m("gunnery5")));
    expect(captainProjectileDamage(edge, { openingVolley: false } as never, { hull: 1, hullMax: 1 }, 100)).toBe(100);
    const off = damageDealt(undefined);
    const on = damageDealt(mods("gunnery5"));
    expect(on).toBeGreaterThan(off);
    expect(on - off).toBeLessThan(500); // a few opening shots, not the whole battle
  });
});

describe("Aegis", () => {
  it("aegis1 Shield Discipline and aegis2 Reinforced Hull: the pools x (1 + m), in patrols and ship events", () => {
    const base = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, hullType: "destroyer" });
    const sh = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, hullType: "destroyer", captainCombat: mods("aegis1") });
    const hu = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, hullType: "destroyer", captainCombat: mods("aegis2") });
    expect(sh.shieldMax).toBe(Math.round(base.shieldMax * (1 + m("aegis1"))));
    expect(sh.shieldRecharge).toBe(Math.round(base.shieldRecharge * (1 + m("aegis1"))));
    expect(hu.hullMax).toBe(Math.round(base.hullMax * (1 + m("aegis2"))));
    // A patrol's carry pools seed from the same fold (the ship never opens a wave below its pool).
    const s = dispatched(onHull("destroyer", ["aegis2"]));
    expect(patrolOf(s).playerHull).toBe(hu.hullMax);
    const ev = snapshotShipEventProfile(onHull("destroyer", ["aegis2"]), onHull("destroyer", []).ships[0]);
    expect(ev.battle!.hullMax).toBe(hu.hullMax);
  });

  it("aegis3 Damage Control: the Shipyard divisor, the field repair divisor and the between-wave patch-up, x (1 + m)", () => {
    const plain = onHull("destroyer", []);
    const dc = onHull("destroyer", ["aegis3"]);
    expect(shipyardRepairSpeedBonus(plain, plain.ships[0])).toBe(officerRepairSpeedBonus(plain, plain.ships[0]));
    expect(shipyardRepairSpeedBonus(dc, dc.ships[0])).toBeCloseTo((1 + 0) * (1 + m("aegis3")) - 1, 12);
    const damaged = { ...dc.ships[0], damaged: true, repairDamage: 5000 };
    const offTicks = shipRepairDurationTicks(damaged, [], shipyardRepairSpeedBonus(plain, plain.ships[0]));
    const onTicks = shipRepairDurationTicks(damaged, [], shipyardRepairSpeedBonus(dc, dc.ships[0]));
    expect(Math.abs(onTicks - offTicks / (1 + m("aegis3")))).toBeLessThanOrEqual(1);
    // The field repair's divisor, frozen at dispatch.
    expect(snapshotShipEventProfile(dc, dc.ships[0]).battle!.repairSpeed).toBeCloseTo(withCaptainRepair(0, mods("aegis3")), 12);
    // The Damage Control Suite's patch-up before a later wave, on a hull carried in damaged.
    const regenOf = (nodes: SecondaryTalentKey[]): number => {
      let s = dispatched(onHull("carrier", nodes, { suite: true }));
      s = { ...s, captains: s.captains.map((c) => ({ ...c, mission: { ...(c.mission as PatrolMissionState), playerHull: 200 } })) };
      while (patrolOf(s).nextWaveIndex < 1) s = economyTick(s, 1, () => 0.5);
      // Now just past wave 0: the next wave index > 0 patches the hull before it fights.
      const before = patrolOf(s).playerHull;
      while (patrolOf(s).nextWaveIndex < 2) s = economyTick(s, 1, () => 0.5);
      return patrolOf(s).playerHull - before;
    };
    // WR-7 follow-up (OC-D5): the run is stamped favoredSpec, so the suite's lines count +10% on the carrier.
    const fraction = damageControlEffect(withFavoredLines([dcSuite()], "carrier")).waveHullRegenFraction;
    const hullMax = foldedPlayerDefense(SHIP_TYPES.carrier, equippedFor(onHull("carrier", [], { suite: true }), "ship-1")).hullMax;
    expect(regenOf(["aegis3"]) - regenOf([])).toBe(Math.floor(hullMax * captainWaveRegenFraction(fraction, mods("aegis3"))) - Math.floor(hullMax * fraction));
    expect(captainWaveRegenFraction(0, mods("aegis3"))).toBe(0);
  });

  it("aegis4 Point Defense: every incoming hit chance / (1 + m), so the ship takes less fire", () => {
    const target = { captainEdge: { weaponDamage: 0, highHealthDamage: 0, openingVolley: 0, droneDamage: 0, evasion: m("aegis4") } };
    expect(incomingHitChance(target, 100)).toBe(Math.round(100 / (1 + m("aegis4"))));
    expect(incomingHitChance({}, 100)).toBe(100);
    const off = damageTaken(undefined);
    const ratio = damageTaken(mods("aegis4")) / off;
    expect(off).toBeGreaterThan(1000);
    expect(ratio).toBeLessThan(1);
    expect(ratio).toBeGreaterThan(1 / (1 + m("aegis4")) - 0.05);
  });

  it("aegis5 Bulwark: m lethal hits per battle leave the ship at 1 hull", () => {
    const c = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, hullType: "destroyer", captainCombat: mods("aegis5") });
    expect(c.bulwarkCharges).toBe(m("aegis5"));
    c.shield = 0;
    applyProjectileDamage(c, "kinetic", 0, 0, c.hull + 10_000);
    expect(c.hull).toBe(1);
    expect(c.bulwarkCharges).toBe(0);
    applyProjectileDamage(c, "kinetic", 0, 0, 10);
    expect(c.hull).toBeLessThanOrEqual(0);
    const bare = { hull: 5, hullMax: 5 } as Combatant;
    landHullDamage(bare, 10);
    expect(bare.hull).toBe(-5);
    // In a real battle the doomed ship lasts longer and spends its charge.
    const doomed = (captainCombat?: CaptainCombatMods) => {
      const p = shipToCombatant({ id: "p", team: "player", stats: { hullIntegrity: 40, shieldCapacity: 0, shieldRecharge: 0 }, weaponLoadout: [], captainCombat });
      const e = shipToCombatant({ id: "e", team: "enemy", stats: SHIP_TYPES.destroyer, hullType: "destroyer" });
      return resolveBattle({ combatants: [p, e] }, 0x31);
    };
    const off = doomed();
    const on = doomed(mods("aegis5"));
    expect(on.outcome.rounds).toBeGreaterThanOrEqual(off.outcome.rounds);
    expect(on.finalCombatants.find((x) => x.id === "p")!.bulwarkCharges).toBe(0);
  });
});

describe("Fleet Ops", () => {
  it("fleetOps1 Drone Handler: every drone hit x (1 + m), exact at the seam and over a battle", () => {
    const carry = { milli: 0 };
    const edge = { weaponDamage: 0, highHealthDamage: 0, openingVolley: 0, droneDamage: m("fleetOps1"), evasion: 0 };
    let total = 0;
    for (let i = 0; i < 1000; i++) total += captainDroneDamage(edge, carry, 5);
    expect(total).toBe(Math.floor(5000 * (1 + m("fleetOps1"))));
    const off = damageDealt(undefined, { dronesOnly: true });
    expect(off).toBeGreaterThan(500);
    expect(Math.abs(damageDealt(mods("fleetOps1"), { dronesOnly: true }) / off - (1 + m("fleetOps1")))).toBeLessThanOrEqual(BATTLE_TOLERANCE);
  });

  it("fleetOps2 Squadron Tactics and fleetOps4 Wing Commander: drone hit points and replenish x (1 + m), in the patrol seed", () => {
    const off = patrolOf(dispatched(onHull("carrier", []))).playerDrones[0];
    const hp = patrolOf(dispatched(onHull("carrier", ["fleetOps2"]))).playerDrones[0];
    const rep = patrolOf(dispatched(onHull("carrier", ["fleetOps4"]))).playerDrones[0];
    expect(hp.droneHp).toBe(Math.round(off.droneHp * (1 + m("fleetOps2"))));
    expect(hp.drones.every((d) => d.hpMax === hp.droneHp && d.hp === hp.droneHp)).toBe(true);
    expect(rep.droneReplenishRate).toBe(Math.round(off.droneReplenishRate * (1 + m("fleetOps4"))));
    // The ship event's combatant too.
    const ev = (nodes: SecondaryTalentKey[]) => {
      const s = onHull("carrier", nodes);
      return buildShipCombatant("ship-1", snapshotShipEventProfile(s, s.ships[0]).battle!, 0, 0).drones[0];
    };
    expect(ev(["fleetOps2"]).droneHp).toBe(hp.droneHp);
    expect(ev(["fleetOps4"]).droneReplenishRate).toBe(rep.droneReplenishRate);
  });

  it("fleetOps3 Patrol Efficiency: the won waves' credits and materials grow x (1 + m)", () => {
    expect(patrolWaveRewardMult(0, undefined)).toBe(1);
    expect(patrolWaveRewardMult(0.1, undefined)).toBe(1.1);
    expect(patrolWaveRewardMult(0, mods("fleetOps3"))).toBe(1 + m("fleetOps3"));
    const run = (nodes: SecondaryTalentKey[]) => {
      let s = dispatched(onHull("destroyer", nodes));
      const c0 = Number(s.credits);
      for (let i = 0; i < 2000; i++) s = economyTick(s, 1, () => 0.5);
      return Number(s.credits) - c0;
    };
    const off = run([]);
    const ratio = run(["fleetOps3"]) / off;
    expect(off).toBeGreaterThan(500);
    expect(ratio).toBeGreaterThan(1 + m("fleetOps3") * 0.75);
    expect(ratio).toBeLessThan(1 + m("fleetOps3") * 1.25);
  });

  it("fleetOps5 Wolfpack: m more squadrons copied from the first pod; none without a pod", () => {
    const off = patrolOf(dispatched(onHull("carrier", []))).playerDrones;
    const on = patrolOf(dispatched(onHull("carrier", ["fleetOps5"]))).playerDrones;
    expect(on.length).toBe(off.length + m("fleetOps5"));
    expect(new Set(on.map((q) => q.id)).size).toBe(on.length);
    expect(on.at(-1)!.role).toBe(off[0].role);
    expect(patrolOf(dispatched(onHull("destroyer", ["fleetOps5"]))).playerDrones.length).toBe(0);
    // More drones, more damage.
    const carrier = (captainCombat?: CaptainCombatMods) => shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.carrier, hullType: "carrier", captainCombat });
    expect(carrier(mods("fleetOps5")).drones.length).toBe(carrier().drones.length + 1);
    expect(damageDealt(mods("fleetOps5"), { dronesOnly: true })).toBeGreaterThan(damageDealt(undefined, { dronesOnly: true }));
  });
});

describe("own ship, frozen, offline == live, replay == fight", () => {
  const BRANCHES: SecondaryTalentKey[][] = [
    ["gunnery1", "gunnery2", "gunnery3", "gunnery4", "gunnery5"],
    ["aegis1", "aegis2", "aegis3", "aegis4", "aegis5"],
    ["fleetOps1", "fleetOps2", "fleetOps3", "fleetOps4", "fleetOps5"],
  ];

  it("a patrol freezes the captain's record at dispatch and again at each relaunch", () => {
    const s0 = onHull("carrier", BRANCHES[0]);
    const s = dispatched(s0);
    expect(patrolOf(s).captainCombat).toEqual(captainCombatMods(s0.captains[0]));
    let t = s;
    for (let i = 0; i < 60; i++) t = economyTick(t, 1, () => 0.5);
    expect(patrolOf(t).masterSeed).not.toBe(patrolOf(s).masterSeed); // relaunched
    expect(patrolOf(t).captainCombat).toEqual(captainCombatMods(s0.captains[0]));
    // No node: no record at all.
    expect("captainCombat" in patrolOf(dispatched(onHull("carrier", [])))).toBe(false);
  });

  it("acts only on the ship that captain commands", () => {
    const s0 = onHull("carrier", BRANCHES[1]);
    // The same save with the captain unassigned from the ship: nothing reads the nodes.
    const unassigned = { ...s0, ships: s0.ships.map((sh) => ({ ...sh, assignedCaptainId: null })) };
    const plain = onHull("carrier", []);
    expect(snapshotShipEventProfile(unassigned, unassigned.ships[0])).toEqual(snapshotShipEventProfile(plain, plain.ships[0]));
    expect(shipyardRepairSpeedBonus(unassigned, unassigned.ships[0])).toBe(shipyardRepairSpeedBonus(plain, plain.ships[0]));
  });

  for (const nodes of BRANCHES) {
    it(`one big call == many small calls, and the replay matches the fight (${nodes[0].replace(/\d$/, "")})`, () => {
      const s = dispatched(onHull("carrier", nodes, { suite: true }), "crimsonReaverWarband");
      const N = 40;
      const big = economyTick(s, N, () => 0.5);
      let stepped = s;
      for (let i = 0; i < N; i++) stepped = economyTick(stepped, 1, () => 0.5);
      expect(big.captains).toEqual(stepped.captains);
      expect(big.ships).toEqual(stepped.ships);
      expect(big.credits.toString()).toBe(stepped.credits.toString());
      // The display replay of the dispatched cycle reproduces the live waves.
      let live = s;
      while (patrolOf(live) !== null && patrolOf(live).masterSeed === patrolOf(s).masterSeed && patrolOf(live).phase !== "limpingHome" && patrolOf(live).phase !== "transitBack") {
        live = economyTick(live, 1, () => 0.5);
      }
      const replay = replayPatrol(s, s.captains[0]);
      const m1 = patrolOf(live);
      if (m1 && m1.masterSeed === patrolOf(s).masterSeed) {
        expect(replay.wavesWon).toBe(m1.wavesWon);
        expect(replay.finalPlayerHull).toBe(m1.playerHull);
      }
    });
  }
});
