// GEAR WEAR step 4 (0.14.0, docs/plans/2026-10-16-gear-wear-design.md section 3.2 and section 11 step 4): THE BATTLE
// WEAR SOURCES, read off battles the game already fought. Pure leaf: no draws, no state, plain integer arithmetic on
// end-state reads of seeded battles (design 7: "no new draws").
//
// The user (OC-D14, 2026-10-16, verbatim): "Everything wears in different ways. Similar to reality. Use. Battle
// damage. Etc. But can easily be repaired over time." USER ANSWERS this binds: W2 + W7 "Gentle" (battle can take a
// piece below the 60% use floor, down to 0, never breaking, uninstalling or blocking anything: gearWear.ts
// applyBattleWearAt); W3 "True condition" (the pools a battle opens are the pieces' real conditions, and the wear a
// pool took converts back to the piece one to one); W9 "No wear on training" (the callers never record a training
// run's battles).
//
// Every amount below is RAW per-mille before toughness (gearWear.ts battleWearRaw over WEAR_SOURCES), keyed by the
// piece id of the battle's frozen gear (gearWear.ts combatGearView), so the engine (gearWearEngine.ts) applies it to
// the stored piece at the battle's instant, scaled by the piece's toughness:
//   weapon:hitsTaken / reactorCore:hitsTaken / ftlDrive:hitsTaken : the pool a cycle (or a ship battle) opened at minus
//                                 what it ended at, over the pool's ceiling (raw 1000 = the whole pool);
//   shieldEmitters:damageAbsorbed : the shield points the wave absorbed over the shield pool;
//   hullPlating:hullLost          : the hull the wave took over the hull pool (an expedition's light hull wear the same);
//   droneBay:dronesLost           : the drones a squadron had at the wave's start and lost by its end, over its size;
//   memberArmor:hpLost            : the hp a member lost in a ground fight over their hp max (groundFight.ts).
// Alignment: the i-th weapon (drone pod) of the gear is the i-th weapon (squadron) of the combatant, exactly the order
// combat/bridge.ts shipToCombatant and installedDronesForPatrol build them in.

import type { EquipmentInstance, PatrolSystemDurability } from "./model";
import type { Combatant } from "./combat/types";
import type { DroneSquadron } from "./combat/drones";
import { battleWearRaw } from "./gearWear";

// Raw battle wear by piece id (only nonzero amounts are kept).
export type BattleWearMap = Record<string, number>;

// One stamped patrol cycle's wear at an instant of the call (tick.ts tickCaptainPatrol): `atTicks` route ticks after
// the call began, the battle wear it took and the Damage Control Suite fires (a patch-up before the wave).
export interface PatrolWearEvent {
  atTicks: number;
  battle: BattleWearMap;
  damageControlFires: number;
}

// The engine's clock for a patrol call (economyTick passes it): the call's starting instant, the tick length and the
// ship's underway repair rate (per-mille a minute), so a relaunch can freeze its gear as it stands at its instant.
export interface PatrolWearClock {
  startSeconds: number;
  secondsPerTick: number;
  underwayRate: number;
  // Pause to repair (user 2026-10-27): the ship's home repair rate, which a paused Repeat patrol repairs at.
  homeRate: number;
}

// Record one wave's (or a cycle end's) wear at `atTicks`, when it took anything. Mutates `events`.
export function recordPatrolWear(events: PatrolWearEvent[], atTicks: number, battle: BattleWearMap | null, damageControlFired: boolean): void {
  const any = battle !== null && Object.keys(battle).length > 0;
  if (!any && !damageControlFired) return;
  events.push({ atTicks, battle: battle ?? {}, damageControlFires: damageControlFired ? 1 : 0 });
}

// Add `raw` to `piece`'s entry in `into` (a zero amount, or no piece, adds nothing). Mutates `into`.
function addRaw(into: BattleWearMap, piece: EquipmentInstance | undefined, raw: number): void {
  if (!piece || !(raw > 0)) return;
  into[piece.id] = (into[piece.id] ?? 0) + raw;
}

// Sum `from` into `into`. Mutates `into`; returns it.
export function addBattleWear(into: BattleWearMap, from: Readonly<BattleWearMap>): BattleWearMap {
  for (const [id, raw] of Object.entries(from)) if (raw > 0) into[id] = (into[id] ?? 0) + raw;
  return into;
}

function piecesOf(gear: readonly EquipmentInstance[], slotType: string): EquipmentInstance[] {
  return gear.filter((p) => p.slotType === slotType);
}

function aliveCount(squadron: DroneSquadron | undefined): number {
  return squadron ? squadron.drones.filter((d) => d.alive).length : 0;
}

// What ONE battle took off the shields, the plating and the drone pods: `start` is the player combatant as it entered
// (hull, shield pool, squadrons), `end` the same combatant after (undefined: lost with nothing left), `shieldAbsorbed`
// the shield points the battle absorbed (resolveBattle's shieldTallyFor). `hull`: whether the battle's hull loss wears
// the plating (a patrol wave; an expedition ship battle's hull damage is its event's hull wear instead). Pure.
export function waveBattleWear(
  gear: readonly EquipmentInstance[],
  start: Combatant,
  end: Combatant | undefined,
  shieldAbsorbed: number,
  hull: boolean,
): BattleWearMap {
  const out: BattleWearMap = {};
  addRaw(out, piecesOf(gear, "shieldEmitters")[0], battleWearRaw("shieldEmitters:damageAbsorbed", shieldAbsorbed, start.shieldMax));
  if (hull) {
    const lost = start.hull - Math.max(0, end ? end.hull : 0);
    addRaw(out, piecesOf(gear, "hullPlating")[0], battleWearRaw("hullPlating:hullLost", lost, start.hullMax));
  }
  piecesOf(gear, "droneBay").forEach((pod, i) => {
    const before = start.drones[i];
    if (!before) return;
    const lost = aliveCount(before) - aliveCount(end?.drones[i]);
    addRaw(out, pod, battleWearRaw("droneBay:dronesLost", lost, before.drones.length));
  });
  return out;
}

// What a cycle (or one ship battle) took off its POOLS: each weapon, the reactor and the drive, the pool it opened at
// (`start`) minus what it ended at (`end`), over its ceiling (`max`). Pure.
export function poolBattleWear(
  gear: readonly EquipmentInstance[],
  start: PatrolSystemDurability,
  max: PatrolSystemDurability,
  end: PatrolSystemDurability,
): BattleWearMap {
  const out: BattleWearMap = {};
  piecesOf(gear, "weapon").forEach((weapon, i) => {
    if (start.weapons[i] === undefined || end.weapons[i] === undefined) return;
    addRaw(out, weapon, battleWearRaw("weapon:hitsTaken", start.weapons[i] - end.weapons[i], max.weapons[i] ?? 0));
  });
  addRaw(out, piecesOf(gear, "reactorCore")[0], battleWearRaw("reactorCore:hitsTaken", start.reactor - end.reactor, max.reactor));
  addRaw(out, piecesOf(gear, "ftlDrive")[0], battleWearRaw("ftlDrive:hitsTaken", start.ftl - end.ftl, max.ftl));
  return out;
}

// A combatant's pools as a PatrolSystemDurability (the current points, or with `ceiling` their maxes). Pure.
export function combatantPools(c: Combatant, ceiling = false): PatrolSystemDurability {
  return {
    weapons: c.weapons.map((w) => (ceiling ? w.durabilityMax : w.durability)),
    reactor: c.reactor ? (ceiling ? c.reactor.durabilityMax : c.reactor.durability) : 0,
    ftl: c.ftl ? (ceiling ? c.ftl.durabilityMax : c.ftl.durability) : 0,
  };
}

// An expedition's light hull wear (a debris strike, a lost ship battle: ExpeditionScanEvent.hullWear) on the plating,
// the same share of the hull pool a patrol wave's hull loss counts at (design 3.2). Pure.
export function hullWearOnPlating(gear: readonly EquipmentInstance[], hullWear: number, hullMax: number): BattleWearMap {
  const out: BattleWearMap = {};
  addRaw(out, piecesOf(gear, "hullPlating")[0], battleWearRaw("hullPlating:hullLost", hullWear, hullMax));
  return out;
}
