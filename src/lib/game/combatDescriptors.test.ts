// WR-8 (0.14.0, docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-8): the combat descriptors at
// their consumers. combatDescriptorGoldens.test.ts pins the patrols, the forecast and the ship battles (and proves a
// run from before WR-8 is byte-identical); the wiring registry's sensitivity tests prove each descriptor moves its
// value; this file pins the rules' mechanics, the stamping, offline == live and the replay parity under them.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { PATROLS, SHIP_TYPES, freshState, type GameState, type PatrolMissionState, type ShipTypeKey } from "./model";
import { dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines } from "./tick";
import { equippedFor } from "./equipment";
import { shipCombatRulesStamp } from "./crewOverlay";
import { replayPatrol } from "./combat/patrolReplay";
import { shipToCombatant } from "./combat/bridge";
import { resolveBattle, droneCooldown, droneTakesHit } from "./combat/resolveBattle";
import { makeDrone } from "./combat/drones";
import { makeWeaponInstance } from "./combat/weapons";
import { generateEnemyWave } from "./combat/enemyWave";
import { PIRATE_HULLS } from "./combat/enemyHulls";
import { stancePreferredDistance } from "./combat/positioning";
import {
  COMBAT_RULES_SWITCH,
  COMBAT_RULES_WR8,
  ENCOUNTER_OPEN_DISTANCE,
  FAMILY_RESIST_KNEE,
  RULES_COMBAT_SPEED,
  combatSpeedFor,
  familyResistPercent,
  podLineShare,
  withWeaponRuleTraits,
} from "./combat/combatRules";
import { withCombatRulesOff } from "./combatRulesSwitch.fixture";
import { onHull, withCrew } from "./firstRunsGoldens.fixture";
import { asExpeditionVeteran, asPatrolVeteran, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { shipEventEnemy, HOSTILE_PROBE_HULL } from "./shipScanEvents";
import type { CombatEvent } from "./combat/types";

const RNG = (): number => 0.5;
const patrolOf = (s: GameState): PatrolMissionState => s.captains[0].mission as PatrolMissionState;

// ship-1's installed Reactor Core and FTL drive at the given qualities (each installed fresh when the ship has none).
function withSystemQuality(s: GameState, reactor: number, ftl: number): GameState {
  const template = equippedFor(s, "ship-1")[0];
  let equipment = s.equipment;
  for (const [slotType, quality] of [["reactorCore", reactor], ["ftlDrive", ftl]] as const) {
    const has = equipment.some((e) => e.fittedToShipId === "ship-1" && e.slotType === slotType);
    equipment = has
      ? equipment.map((e) => (e.fittedToShipId === "ship-1" && e.slotType === slotType ? { ...e, quality } : e))
      : [...equipment, { ...template, id: `q-${slotType}`, slotType, quality, weaponType: undefined, droneRole: undefined, implicitStats: {}, rolledStats: {}, fittedToShipId: "ship-1" }];
  }
  return { ...s, equipment };
}

function patrolBase(hull: ShipTypeKey, seed = 1): GameState {
  return asPatrolVeteran({ ...onHull(hull), nextPatrolSeed: seed, credits: new Decimal(100_000) });
}

describe("WR-8 the stamp: every new patrol cycle and expedition carries the combat rules", () => {
  it("a dispatch stamps the cycle with the rules, the ship's combat speed and no system qualities on Standard Issue", () => {
    const r = dispatchCaptainOnPatrol(patrolBase("destroyer"), 1, "crimsonReaverSweep", "balanced", false);
    expect(patrolOf(r.next).combatRules).toEqual({ rules: COMBAT_RULES_WR8, speed: RULES_COMBAT_SPEED });
  });

  it("a relaunch stamps its new cycle; a cycle dispatched before WR-8 relaunches stamped (the next cycle only)", () => {
    const old = withCombatRulesOff(() => dispatchCaptainOnPatrol(patrolBase("destroyer"), 1, "crimsonReaverSweep", "balanced", true)).next;
    expect(patrolOf(old).combatRules).toBeUndefined();
    let s = old;
    const seed = patrolOf(s).masterSeed;
    for (let t = 0; t < 2000 && patrolOf(s)?.masterSeed === seed; t++) s = economyTick(s, 1, RNG);
    expect(patrolOf(s).masterSeed).not.toBe(seed);
    expect(patrolOf(s).combatRules).toEqual({ rules: COMBAT_RULES_WR8, speed: RULES_COMBAT_SPEED });
  });

  it("the switch off stamps nothing, and restores itself", () => {
    withCombatRulesOff(() => expect(COMBAT_RULES_SWITCH.stampNewRuns).toBe(false));
    expect(COMBAT_RULES_SWITCH.stampNewRuns).toBe(true);
    expect(withCombatRulesOff(() => shipCombatRulesStamp(patrolBase("destroyer"), patrolBase("destroyer").ships[0]))).toBeUndefined();
  });

  it("the stamp freezes the installed Reactor Core's and FTL drive's quality (written only above 0)", () => {
    const s = withSystemQuality(patrolBase("destroyer"), 3, 0);
    expect(shipCombatRulesStamp(s, s.ships[0])).toEqual({ rules: COMBAT_RULES_WR8, speed: RULES_COMBAT_SPEED, reactorQuality: 3 });
  });

  it("an expedition's ship-event battle inputs are stamped at dispatch; a run from before WR-8 is not", () => {
    const state = asExpeditionVeteran(withCrew(onHull("orion"), "d18"));
    const now = dispatchPastPropulsion(state, "ship-1", 1, "cand-1").expedition!;
    const old = withCombatRulesOff(() => dispatchPastPropulsion(state, "ship-1", 1, "cand-1")).expedition!;
    expect(now.groundOps?.shipEventProfile?.battle?.combatRules).toEqual({ rules: COMBAT_RULES_WR8, speed: RULES_COMBAT_SPEED });
    expect(old.groundOps?.shipEventProfile?.battle?.combatRules).toBeUndefined();
    const body = now.bodies[0];
    expect(shipEventEnemy(now, body, 0, 0, HOSTILE_PROBE_HULL).position).toBe(ENCOUNTER_OPEN_DISTANCE);
    expect(shipEventEnemy(old, body, 0, 0, HOSTILE_PROBE_HULL).position).toBe(0);
  });
});

describe("WR-8 speed: a ship's combat speed follows its transit speed, relative to its hull", () => {
  it("every Standard-Issue hull maneuvers at the rules' speed (its sheet equals its hull's base)", () => {
    for (const hull of Object.keys(SHIP_TYPES) as ShipTypeKey[]) {
      const s = onHull(hull);
      expect(shipCombatRulesStamp(s, s.ships[0])?.speed, hull).toBe(RULES_COMBAT_SPEED);
    }
  });
  it("faster than its hull is faster in combat, and mass slows it (whole units, at least 1)", () => {
    expect(combatSpeedFor(1.3, 1.0)).toBe(39);
    expect(combatSpeedFor(0.5, 1.0)).toBe(15);
    expect(combatSpeedFor(0, 1)).toBe(1);
  });
});

describe("WR-8 positions: fights open at range and close", () => {
  const frame = { hullIntegrity: 100_000, shieldCapacity: 0, shieldRecharge: 0 };
  const firstShot = (log: CombatEvent[], id: string): number => log.find((e) => e.actorId === id && (e.type === "hit" || e.type === "evade"))?.tDeciSec ?? -1;

  it("a short gun closes whatever its stance (its reach caps the stance's band) and fires once in range", () => {
    for (const stance of ["aggressive", "balanced", "standoff"] as const) {
      const p = shipToCombatant({ id: "p", team: "player", stats: frame, weaponLoadout: [makeWeaponInstance("autocannon", "p-w0")], stance, speed: RULES_COMBAT_SPEED, combatRules: true });
      const e = shipToCombatant({ id: "e", team: "enemy", stats: frame, position: ENCOUNTER_OPEN_DISTANCE, speed: 0, combatRules: true });
      const r = resolveBattle({ combatants: [p, e] }, 1, { combatRules: COMBAT_RULES_WR8, precharge: true, generateLog: true });
      // 200 units to close at 3 a tick: its first shot lands once it is within 100, never before.
      expect(firstShot(r.log, "p"), stance).toBeGreaterThan(60);
      expect(r.finalCombatants.find((c) => c.id === "p")!.position, stance).toBe(ENCOUNTER_OPEN_DISTANCE - 100);
    }
  });

  it("an equal-speed ship never opens the range: the shorter-ranged side closes and fires", () => {
    const p = shipToCombatant({ id: "p", team: "player", stats: frame, weaponLoadout: [makeWeaponInstance("plasma", "p-w0")], stance: "standoff", speed: RULES_COMBAT_SPEED, combatRules: true });
    const e = shipToCombatant({ id: "e", team: "enemy", stats: frame, weaponLoadout: [makeWeaponInstance("autocannon", "e-w0")], stance: "aggressive", position: ENCOUNTER_OPEN_DISTANCE, speed: RULES_COMBAT_SPEED, combatRules: true });
    const r = resolveBattle({ combatants: [p, e] }, 2, { combatRules: COMBAT_RULES_WR8, precharge: true, generateLog: true });
    expect(firstShot(r.log, "e")).toBeGreaterThan(0);
  });

  it("a faster ship keeps its band on a short-ranged foe, which then never fires", () => {
    const p = shipToCombatant({ id: "p", team: "player", stats: frame, weaponLoadout: [makeWeaponInstance("plasma", "p-w0")], stance: "standoff", speed: RULES_COMBAT_SPEED + 10, combatRules: true });
    const e = shipToCombatant({ id: "e", team: "enemy", stats: frame, weaponLoadout: [makeWeaponInstance("autocannon", "e-w0")], stance: "aggressive", position: ENCOUNTER_OPEN_DISTANCE, speed: RULES_COMBAT_SPEED, combatRules: true });
    const r = resolveBattle({ combatants: [p, e] }, 2, { combatRules: COMBAT_RULES_WR8, precharge: true, generateLog: true });
    expect(firstShot(r.log, "e")).toBe(-1);
    expect(firstShot(r.log, "p")).toBeGreaterThan(0);
  });

  it("without the rules nothing moves: the pre-WR-8 co-located fight", () => {
    const p = shipToCombatant({ id: "p", team: "player", stats: frame, weaponLoadout: [makeWeaponInstance("autocannon", "p-w0")] });
    const e = shipToCombatant({ id: "e", team: "enemy", stats: frame });
    const r = resolveBattle({ combatants: [p, e] }, 1, { generateLog: true });
    expect(r.finalCombatants.every((c) => c.position === 0)).toBe(true);
  });
});

describe("WR-8 pirates: armor, dampening and evasion under the rules only", () => {
  for (const id of Object.keys(PIRATE_HULLS) as (keyof typeof PIRATE_HULLS)[]) {
    it(id, () => {
      const params = { hullPool: [id], enemyCountMin: 1, enemyCountMax: 1, idPrefix: "t" };
      const ruled = generateEnemyWave(9, { ...params, combatRules: true })[0];
      const old = generateEnemyWave(9, params)[0];
      expect([ruled.ablativeArmor, ruled.kineticDampening, ruled.evasion, ruled.position]).toEqual([PIRATE_HULLS[id].ablativeArmor, PIRATE_HULLS[id].kineticDampening, PIRATE_HULLS[id].evasion, ENCOUNTER_OPEN_DISTANCE]);
      expect([old.ablativeArmor, old.kineticDampening, old.evasion, old.position]).toEqual([0, 0, 0, 0]);
      expect(stancePreferredDistance(ruled.stance)).toBeGreaterThan(0);
    });
  }
});

describe("WR-8 the curves (D23: concave, never a cap)", () => {
  it("family resist approaches 100% and never reaches it (whole percents rounded down); the knee is half", () => {
    expect(familyResistPercent(0)).toBe(0);
    expect(familyResistPercent(FAMILY_RESIST_KNEE)).toBe(50);
    expect(familyResistPercent(20)).toBe(28); // 28.57, rounded down
    // WR-8 review: rounding to nearest reached 100 (immunity) from about 9,950 points; it never does now.
    for (const p of [9_949, 9_950, 10_000, 1e6, 1e9, 1e18, Number.MAX_SAFE_INTEGER]) expect(familyResistPercent(p), String(p)).toBe(99);
    for (let p = 1; p < 400; p++) expect(familyResistPercent(p + 1)).toBeGreaterThanOrEqual(familyResistPercent(p));
  });
  it("a pod line's share rises without bound below 1", () => {
    expect(podLineShare(0)).toBe(0);
    for (let p = 1; p < 400; p++) expect(podLineShare(p + 1)).toBeGreaterThan(podLineShare(p));
    expect(podLineShare(1e9)).toBeLessThan(1);
  });
  it("a drone that survives a hit takes the whole projectile; only a destroyed drone lets the rest through", () => {
    // WR-8 review: kinetic raw 11 at the 90% column is 9 on the drone; it survives, so nothing leaks (it was 1).
    const survivor = makeDrone(20);
    expect(droneTakesHit(survivor, 11, "kinetic", false, true)).toEqual({ overflow: 0, destroyed: false });
    expect(survivor.hp).toBe(11);
    // A drone the hit destroys soaks its last 5 (6 of the shot's points at 90%, rounded up); the other 5 go on.
    const doomed = makeDrone(5);
    expect(droneTakesHit(doomed, 11, "kinetic", false, true)).toEqual({ overflow: 5, destroyed: true });
    // Without the rules it is absorbWithDrone exactly.
    expect(droneTakesHit(makeDrone(5), 11, "kinetic", false, false)).toEqual({ absorbed: 5, overflow: 6, destroyed: true });
  });
  it("Inhibit stretches a squadron's period by 100 / (100 + delta), rounded up; none leaves it", () => {
    expect(droneCooldown(5, 0)).toBe(5);
    expect(droneCooldown(5, -20)).toBe(7);
    expect(droneCooldown(20, -60)).toBe(50);
  });
  it("the rule traits: anti-drone Point Defense and EMP, Point Defense's Inhibit, Tachyon's vs-Shields, Voltaic's arc", () => {
    expect(withWeaponRuleTraits(makeWeaponInstance("pointDefenseArray")).antiDrone).toBe(true);
    expect(withWeaponRuleTraits(makeWeaponInstance("pointDefenseArray")).droneEffectSlots?.map((e) => e.defId)).toEqual(["inhibit"]);
    expect(withWeaponRuleTraits(makeWeaponInstance("empCannon")).antiDrone).toBe(true);
    expect(withWeaponRuleTraits(makeWeaponInstance("tachyonBurstEmitter")).vsShieldsPct).toBe(110);
    expect(withWeaponRuleTraits(makeWeaponInstance("voltaic")).chainSharePct).toBe(30);
    const plain = makeWeaponInstance("railgun");
    expect(withWeaponRuleTraits(plain)).toBe(plain);
  });
});

describe("WR-8 patrols under the rules: offline == live, the replay matches the fight, statuses carry", () => {
  for (const hull of ["destroyer", "carrier", "orion"] as ShipTypeKey[]) {
    for (const key of Object.keys(PATROLS)) {
      it(`${hull} ${key}: one call == 1 s ticks, and the replay reads the same waves`, () => {
        const r = dispatchCaptainOnPatrol(patrolBase(hull, 7), 1, key, "balanced", false);
        const replay = replayPatrol(r.next, r.next.captains[0]);
        let stepped = r.next;
        const len = PATROLS[key].transitOutTicks + PATROLS[key].rollWindowTicks;
        for (let t = 0; t < len; t++) stepped = economyTick(stepped, 1, RNG);
        const big = economyTick(r.next, len, RNG);
        expect(big.captains[0].mission).toEqual(stepped.captains[0].mission);
        const m = patrolOf(stepped);
        if (m !== null && m.phase !== "limpingHome") {
          expect(replay.wavesWon).toBe(m.wavesWon);
          expect(replay.finalPlayerHull).toBe(m.playerHull);
        }
      });
    }
  }

  it("a status a wave leaves on the ship opens the next wave (the replay's next wave starts with it)", () => {
    let witnessed = false;
    for (let seed = 1; seed < 80 && !witnessed; seed++) {
      const r = dispatchCaptainOnPatrol(patrolBase("battleship", seed), 1, "crimsonReaverWarband", "balanced", false);
      const replay = replayPatrol(r.next, r.next.captains[0]);
      for (let i = 0; i + 1 < replay.waves.length; i++) {
        const left = replay.waves[i].playerEnd?.statusEffects ?? [];
        if (left.length === 0 || !replay.waves[i].playerWon) continue;
        expect(replay.waves[i + 1].playerStart.statusEffects).toEqual(left);
        witnessed = true;
        // And the live loop carries the same statuses on the mission between those two waves.
        let s = r.next;
        const m0 = patrolOf(s);
        for (let t = 0; t < m0.waveTicks[i]; t++) s = economyTick(s, 1, RNG);
        expect(patrolOf(s).playerStatusEffects).toEqual(left);
        break;
      }
    }
    expect(witnessed).toBe(true);
  });

  it("a cycle without the stamp never carries statuses (the pre-WR-8 waves open clean)", () => {
    const r = withCombatRulesOff(() => dispatchCaptainOnPatrol(patrolBase("battleship", 3), 1, "crimsonReaverWarband", "balanced", false));
    let s = r.next;
    for (let t = 0; t < 40 && patrolOf(s) !== null; t++) {
      s = economyTick(s, 1, RNG);
      if (patrolOf(s) !== null) expect(patrolOf(s).playerStatusEffects).toBeUndefined();
    }
  });
});

describe("WR-8 installed systems: a crafted reactor and drive set the combat pools under the rules", () => {
  it("the patrol cycle's reactor and drive carry pools are the installed pieces' (quality-scaled)", () => {
    const crafted = withSystemQuality(
      installMissingCombatBaselines({ ...freshState(), credits: new Decimal(100_000), ships: freshState().ships.map((s) => (s.id === "ship-1" ? { ...s, typeKey: "destroyer" as ShipTypeKey } : s)) }),
      3,
      2,
    );
    const ruled = patrolOf(dispatchCaptainOnPatrol(asPatrolVeteran(crafted), 1, "crimsonReaverSweep", "balanced", false).next);
    expect([ruled.playerSystemDurability.reactor, ruled.playerSystemDurability.ftl]).toEqual([160, 140]);
    const old = patrolOf(withCombatRulesOff(() => dispatchCaptainOnPatrol(asPatrolVeteran(crafted), 1, "crimsonReaverSweep", "balanced", false)).next);
    expect([old.playerSystemDurability.reactor, old.playerSystemDurability.ftl]).toEqual([100, 100]);
  });
});
