// Ground Operations 0.14.0 (GO-8, user 9b.6): SHIP-SIDE SCAN EVENTS.
//
// The ship scans from orbit, so nobody is on the ground to fight: on a flagged run the scan step roll's draw 1
// (expedition.ts scanStepRoll, the Task 14 keyed roll and its timing, unchanged) fires a SHIP EVENT resolved
// by the ship and its officers instead of a ground battle (legacy runs keep Task 14's battles). The approved
// set (design 9b.6, user 2026-10-09):
//   DEBRIS FIELD      the pilot's evasion. Pass: nothing. Fail: a short scan delay + light hull damage.
//   HOSTILE PROBE     a quick ship battle on the existing combat engine (combat/resolveBattle.ts), the frozen
//                     player ship against a small probe hull scaled by the body's hazard and SOFTENED by Security
//                     Cunning's over-delivery (exp.ambushSoften moved here from the scan ground battles, Task 21).
//                     Win: salvage. Loss: the scan pauses while the ship repairs, light hull damage.
//   SENSOR GHOST      the ship's sensors (they fold the Science officer and division). Pass: one bonus discovery
//                     on this body. Fail: lost scan progress (a re-scan pause). A rare ghost is a CLOAKED VESSEL:
//                     a probe-style fight against a stronger cloaked hull; the sensor check decides who strikes
//                     first (pass: the ship ambushes it; fail: it ambushes the ship). Win: a richer find. Loss:
//                     a longer repair pause, more hull damage.
//   RADIATION STORM   Engineering (its Integrity facet) and shields. Pass: nothing. Fail: a slowdown pause.
// Every negative outcome is a `pauseSeconds` on the event, so the existing scan walk (expedition.ts pauseAt,
// encounterScanDurationSeconds, the GO-7b scan clock) times it exactly and offline == live holds unchanged.
// User Q12 (2026-10-12): debris and a lost ship battle leave LIGHT HULL DAMAGE (`hullWear`), summed on the run
// (GroundOpsState.hullDamage) and carried home to the Shipyard at claim (GO-8b's field repair can fix it first).
//
// THE FLAG: only a run whose frozen ShipEventProfile carries `battle` (written at dispatch since GO-8) rolls
// ship events; a flagged run dispatched before GO-8 keeps rolling draw 1 at chance 0 (its exact shape).
//
// DETERMINISM: one private stream per boundary, makeRng(seed ^ SHIP_EVENT_SALT ^ imul(scanStepKey + 1, golden)),
// with a FIXED draw layout so later additions shift nothing: draw 1 the kind, draw 2 the check, draw 3 cloaked
// (a ghost only), draw 4 a boarding attempt, draw 5 the boarding repel (GO-9 reads 4 and 5). All five are
// always taken. Battles roll on PROBE_BATTLE_SALT, salvage on PROBE_SALVAGE_SALT, a ghost's bonus discovery on
// GHOST_FIND_SALT (expedition.ts, at the body's completion), each keyed by the boundary. Ramped values (the
// officers' Constitution ramp on the ship's combat bonuses) read the event's WALL time, passed in as hoursOut.
//
// Module graph: imports model, combat/*, gambit (rollHaul, scanStepKey), crewOverlay, equipment, officerStats,
// diminishing, relics. Never imports expedition.ts or groundOps.ts. PURE throughout.
//
// EVERY NUMBER BELOW IS FIRST-PASS TUNABLE; the [PROVISIONAL] ones answer open questions Q12, Q13, Q19.

import {
  SHIP_TYPES,
  type Expedition,
  type ExpeditionBody,
  type ExpeditionFinding,
  type ExpeditionScanEvent,
  type GameState,
  type ShipEventBattle,
  type ShipEventProfile,
  type ShipInstance,
  type ShipScanEventKind,
} from "./model";
import { makeRng } from "./combat/rng";
import { combatHullTypeOf, shipToCombatant, type CombatShipStats } from "./combat/bridge";
import { resolveBattle } from "./combat/resolveBattle";
import { makeWeaponInstance, type WeaponId } from "./combat/weapons";
import type { CombatStance } from "./combat/positioning";
import type { Combatant } from "./combat/types";
import { rollHaul, scanStepKey } from "./gambit";
import { equippedFor } from "./equipment";
import { effectiveShipStats, officerCombatModsFromProfile, officerCombatProfile, officerRepairSpeedBonus, shipCrewContribution } from "./crewOverlay";
import { CREW_STAT_KEYS } from "./crewBuffs";
import { departmentFacet } from "./officerStats";
import { diminishing } from "./diminishing";
import { resistedHazard } from "./relics";

// ===== Salts (odd, distinct from every engine salt: salts.test.ts) =====

export const SHIP_EVENT_SALT = 0x5c9e2b47; // the per-boundary event stream (the fixed five-draw layout)
export const PROBE_BATTLE_SALT = 0x3d71a6e9; // a probe or cloaked-vessel battle
export const PROBE_SALVAGE_SALT = 0x6f2c84b3; // a won battle's salvage haul
export const GHOST_FIND_SALT = 0x1a9d5e77; // a sensor ghost's bonus discovery (expedition.ts, at the body's completion)

// ===== The event table =====

// Draw 1 picks the kind by these weights (out of SHIP_EVENT_WEIGHT_TOTAL), in this order. A ghost becomes a
// cloaked vessel on draw 3.
export const SHIP_EVENT_WEIGHTS: Readonly<Record<"debris" | "probe" | "ghost" | "storm", number>> = {
  debris: 35,
  probe: 25,
  ghost: 25,
  storm: 15,
};
const EVENT_ORDER = ["debris", "probe", "ghost", "storm"] as const;
export const SHIP_EVENT_WEIGHT_TOTAL = EVENT_ORDER.reduce((sum, k) => sum + SHIP_EVENT_WEIGHTS[k], 0);
export const GHOST_CLOAKED_CHANCE = 0.1; // a ghost is a cloaked vessel this often (draw 3)

// The checks: chance = 1 - (1 - base) / (1 + diminishing(power, CHECK_KNEE)), the ODDS form: the base with no
// bonus, rising with the ship's power on the D23 curve (unbounded power, so certainty is approached, never reached).
export const CHECK_KNEE = 1;
export const DEBRIS_PASS_BASE = 0.5;
export const DEBRIS_EVASION_SCALE = 10; // evasion share 0.1 (10 points) = power 1
export const GHOST_PASS_BASE = 0.4;
export const GHOST_SENSOR_SCALE = 40; // 40 sensors = power 1 (SENSOR_REVEAL_HAZARD's scale)
export const STORM_PASS_BASE = 0.5;
export const STORM_SHIELD_SCALE = 300; // a 300-point shield pool (an entry destroyer's) = power 1, x (1 + Engineering Integrity)

// The stakes [PROVISIONAL, Q12 / Q19]: pauses in scan seconds, hull damage as a share of the frozen hull pool.
export const DEBRIS_DELAY_SECONDS = 120;
export const DEBRIS_HULL_SHARE = 0.04;
export const PROBE_REPAIR_SECONDS = 300;
export const PROBE_HULL_SHARE = 0.08;
export const CLOAKED_REPAIR_SECONDS = 420;
export const CLOAKED_HULL_SHARE = 0.12;
export const GHOST_RESCAN_SECONDS = 180;
export const STORM_SLOW_SECONDS = 240;
export const PROBE_SALVAGE_SCALE = 0.4; // rollHaul scale of a won probe battle (an activity haul is 1)
export const CLOAKED_SALVAGE_SCALE = 0.8;
// The enemy hull grows with the body's hazard as the run presents it (the museum resist applied).
export const PROBE_HAZARD_SCALE = 1;

// GO-9 BOARDING (D26: "a ship-side scan event (the cloaked ship, or a hostile vessel) can attempt to board;
// crew.boardingDefense and the Ossir racial decide it"). On a probe or cloaked-vessel event draw 4 decides an
// attempt; draw 5 the repel, at the odds-form check on the frozen boardingDefense (the Security division's
// Boarding Defense, the Ossir racial, Strength's facet through the crew rollup): base BOARDING_REPEL_BASE, power =
// boardingDefense x BOARDING_DEFENSE_SCALE (the D23 curve: more defense always helps, never certain). Repelled:
// recorded only. Not repelled (user Q13, 2026-10-12): a scan pause PLUS a small loss from the RUN'S findings
// (BOARDING_CREDIT_LOSS_SHARE of the credits the run holds so far, newest findings first, never below zero, never
// the player's bank) [PROVISIONAL numbers].
export const BOARDING_ATTEMPT_CHANCE = 0.25;
export const BOARDING_REPEL_BASE = 0.5;
export const BOARDING_DEFENSE_SCALE = 4; // boardingDefense 0.25 = power 1
export const BOARDING_PAUSE_SECONDS = 300;
export const BOARDING_CREDIT_LOSS_SHARE = 0.1;

// The two enemy hulls (combat content, the PIRATE_HULLS shape: a stat line + weapon ids + a stance).
export interface ShipEventEnemyHull {
  name: string;
  stats: CombatShipStats;
  weapons: readonly WeaponId[];
  stance: CombatStance;
}
export const HOSTILE_PROBE_HULL: ShipEventEnemyHull = {
  name: "Hostile Probe",
  stats: { hullIntegrity: 90, shieldCapacity: 30, shieldRecharge: 2 },
  weapons: ["autocannon"],
  stance: "aggressive",
};
export const CLOAKED_VESSEL_HULL: ShipEventEnemyHull = {
  name: "Cloaked Vessel",
  stats: { hullIntegrity: 220, shieldCapacity: 100, shieldRecharge: 4 },
  weapons: ["autocannon", "railgun"],
  stance: "balanced",
};

// ===== The flag and the snapshot =====

// Does this run roll ship events? Only a flagged run whose profile carries the frozen battle inputs (GO-8). Pure.
export function shipEventsLive(exp: Pick<Expedition, "groundOps">): boolean {
  return exp.groundOps?.shipEventProfile?.battle !== undefined;
}

// The installed slot types a ship's battle reads (shipToCombatant). Every other installed piece is left out.
const COMBAT_SLOT_TYPES: ReadonlySet<string> = new Set(["weapon", "shieldEmitters", "hullPlating", "droneBay"]);

// The frozen profile at dispatch (groundOps.ts snapshotGroundOps writes it). Pure: fresh, JSON-safe data.
export function snapshotShipEventProfile(state: GameState, ship: ShipInstance): ShipEventProfile {
  const gear = equippedFor(state, ship.id).filter((piece) => COMBAT_SLOT_TYPES.has(piece.slotType));
  const battle: ShipEventBattle = {
    hullType: ship.typeKey,
    ...(gear.length > 0 ? { installedGear: structuredClone(gear) } : {}),
    officerCombat: structuredClone(officerCombatProfile(state, ship)),
    hullMax: 0,
    // GO-8b: the field repair's divisor (the Shipyard's: Rapid Recovery, Veteran Instincts, Engineering Constitution).
    repairSpeed: officerRepairSpeedBonus(state, ship),
  };
  const c = buildShipCombatant(ship.id, battle, 0, 0);
  battle.hullMax = c.hullMax;
  return {
    evasion: c.evasion / 100,
    sensors: effectiveShipStats(state, ship).sensors,
    shieldCapacity: c.shieldMax,
    engineering: departmentFacet(state, ship, "engineering", "integrity"),
    // GO-9: the crew rollup's Boarding Defense (the Security division's buff, the Ossir racial; Strength scales the
    // Security division), frozen here like every other input.
    boardingDefense: Math.max(0, shipCrewContribution(state, ship)[CREW_STAT_KEYS.boardingDefense] ?? 0),
    battle,
  };
}

// The ship as a combatant `hoursOut` hours into the run (the officers' Constitution ramp folded at that hour),
// carrying `hullDamage` (its hull starts that much below its pool, never below 1). A hull the table no longer
// knows (a removed test hull) fights from its frozen pool, unarmed. Pure: a fresh combatant.
export function buildShipCombatant(id: string, battle: ShipEventBattle, hoursOut: number, hullDamage: number): Combatant {
  const stats: CombatShipStats = SHIP_TYPES[battle.hullType] ?? { hullIntegrity: Math.max(1, battle.hullMax), shieldCapacity: 0, shieldRecharge: 0 };
  const hullType = combatHullTypeOf(battle.hullType) ?? undefined;
  const c = shipToCombatant({
    id,
    team: "player",
    stats,
    hullType: SHIP_TYPES[battle.hullType] ? hullType : undefined,
    installedGear: battle.installedGear,
    officerCombat: officerCombatModsFromProfile(battle.officerCombat, hoursOut),
  });
  if (hullDamage > 0) c.hull = Math.max(1, c.hullMax - Math.round(hullDamage));
  return c;
}

// ===== The roll =====

// The boundary's private stream seed. Pure.
export function shipEventSeed(exp: Pick<Expedition, "seed">, bodyIndex: number, step: number): number {
  return (exp.seed ^ SHIP_EVENT_SALT ^ Math.imul(scanStepKey(bodyIndex, step) + 1, 0x9e3779b9)) >>> 0;
}

// GO-8 review (combat/rng.ts's integer-first contract): every outcome draw is an INTEGER. Draws 2 to 5 are
// nextInt(SHIP_EVENT_DRAW_UNITS) and pass when below the chance scaled to the same units (chanceUnits, rounded), so
// no float compare decides an outcome. One step per draw, as before: the layout and the draw count are unchanged.
export const SHIP_EVENT_DRAW_UNITS = 1_000_000;

// A chance in [0, 1] in draw units (rounded; out-of-range or NaN clamps). Pure.
export function chanceUnits(chance: number): number {
  const p = Number.isFinite(chance) ? Math.max(0, Math.min(1, chance)) : 0;
  return Math.round(p * SHIP_EVENT_DRAW_UNITS);
}

// The fixed five draws of a boundary (see the header): draw 1 an integer in [0, SHIP_EVENT_WEIGHT_TOTAL), the rest
// integers in [0, SHIP_EVENT_DRAW_UNITS). Pure.
export interface ShipEventDraws {
  kind: number;
  check: number;
  cloaked: number;
  boardingAttempt: number;
  boardingRepel: number;
}
export function shipEventDraws(exp: Pick<Expedition, "seed">, bodyIndex: number, step: number): ShipEventDraws {
  const rng = makeRng(shipEventSeed(exp, bodyIndex, step));
  const kind = rng.nextInt(SHIP_EVENT_WEIGHT_TOTAL);
  const check = rng.nextInt(SHIP_EVENT_DRAW_UNITS);
  const cloaked = rng.nextInt(SHIP_EVENT_DRAW_UNITS);
  const boardingAttempt = rng.nextInt(SHIP_EVENT_DRAW_UNITS);
  const boardingRepel = rng.nextInt(SHIP_EVENT_DRAW_UNITS);
  return { kind, check, cloaked, boardingAttempt, boardingRepel };
}

// The event kind draws 1 and 3 name. Pure.
export function shipEventKindOf(draws: Pick<ShipEventDraws, "kind" | "cloaked">): ShipScanEventKind {
  let roll = draws.kind;
  for (const k of EVENT_ORDER) {
    roll -= SHIP_EVENT_WEIGHTS[k];
    if (roll < 0) return k === "ghost" && draws.cloaked < chanceUnits(GHOST_CLOAKED_CHANCE) ? "cloaked" : k;
  }
  return "storm";
}

// The odds-form check chance (see CHECK_KNEE). Pure.
export function shipEventCheckChance(base: number, power: number): number {
  const p = Number.isFinite(power) && power > 0 ? power : 0;
  return 1 - (1 - base) / (1 + diminishing(p, CHECK_KNEE));
}

// What one event did. `finding` is the salvage of a won battle (the caller appends it); `event` is the record
// (the caller appends it and adds its hullWear to the run's damage). Pure.
export interface ShipScanEventResult {
  event: ExpeditionScanEvent;
  finding: ExpeditionFinding | null;
}

// Resolve the ship event at `body`'s boundary `step` (draw 1 fired), `hoursOut` hours since dispatch at the
// event's WALL time. Reads the stored run only (its frozen profile, its hull damage so far). Pure.
export function resolveShipScanEvent(exp: Expedition, body: ExpeditionBody, bodyIndex: number, step: number, hoursOut: number): ShipScanEventResult {
  return resolveShipScanEventFromDraws(exp, body, bodyIndex, step, hoursOut, shipEventDraws(exp, bodyIndex, step));
}

// The same, from given draws (resolveShipScanEvent's body; tests stub the draws). Pure.
export function resolveShipScanEventFromDraws(
  exp: Expedition,
  body: ExpeditionBody,
  bodyIndex: number,
  step: number,
  hoursOut: number,
  draws: ShipEventDraws,
): ShipScanEventResult {
  const profile = exp.groundOps?.shipEventProfile;
  const battle = profile?.battle;
  const kind = shipEventKindOf(draws);
  const event: ExpeditionScanEvent = { bodyIndex, step, kind: "shipEvent", event: kind };
  if (!profile || !battle) return { event, finding: null };
  const wear = (share: number): number => Math.max(1, Math.round(share * battle.hullMax));
  const ship = buildShipCombatant(exp.shipId || "ship", battle, hoursOut, exp.groundOps?.hullDamage ?? 0);
  let finding: ExpeditionFinding | null = null;
  switch (kind) {
    case "debris": {
      const pass = draws.check < chanceUnits(shipEventCheckChance(DEBRIS_PASS_BASE, (ship.evasion / 100) * DEBRIS_EVASION_SCALE));
      event.outcome = pass ? "pass" : "fail";
      if (!pass) {
        event.pauseSeconds = DEBRIS_DELAY_SECONDS;
        event.hullWear = wear(DEBRIS_HULL_SHARE);
      }
      break;
    }
    case "storm": {
      const pass = draws.check < chanceUnits(shipEventCheckChance(STORM_PASS_BASE, (ship.shieldMax * (1 + Math.max(0, profile.engineering))) / STORM_SHIELD_SCALE));
      event.outcome = pass ? "pass" : "fail";
      if (!pass) event.pauseSeconds = STORM_SLOW_SECONDS;
      break;
    }
    case "ghost": {
      const pass = draws.check < chanceUnits(ghostCheckChance(profile));
      event.outcome = pass ? "pass" : "fail";
      if (pass) event.bonusDiscovery = true;
      else event.pauseSeconds = GHOST_RESCAN_SECONDS;
      break;
    }
    case "probe":
    case "cloaked": {
      const cloaked = kind === "cloaked";
      // The cloaked vessel: the sensor check decides who strikes first (pass: the ship ambushes it).
      const ambushFirst = cloaked ? (draws.check < chanceUnits(ghostCheckChance(profile)) ? "ship" : "enemy") : null;
      const won = shipEventBattleWon(exp, body, bodyIndex, step, ship, cloaked ? CLOAKED_VESSEL_HULL : HOSTILE_PROBE_HULL, ambushFirst);
      event.outcome = won ? "win" : "loss";
      if (won) {
        finding = shipEventSalvage(exp, body, bodyIndex, step, cloaked);
        event.findingId = finding.id;
      } else {
        event.pauseSeconds = cloaked ? CLOAKED_REPAIR_SECONDS : PROBE_REPAIR_SECONDS;
        event.hullWear = wear(cloaked ? CLOAKED_HULL_SHARE : PROBE_HULL_SHARE);
      }
      // GO-9: the vessel may attempt to board (draws 4 and 5, see BOARDING_ATTEMPT_CHANCE).
      if (draws.boardingAttempt < chanceUnits(BOARDING_ATTEMPT_CHANCE)) {
        const repelled = draws.boardingRepel < chanceUnits(boardingRepelChance(profile.boardingDefense));
        event.boarding = { repelled };
        if (!repelled) {
          event.pauseSeconds = (event.pauseSeconds ?? 0) + BOARDING_PAUSE_SECONDS;
          const held = exp.findings.reduce((sum, f) => sum + Math.max(0, f.credits ?? 0), 0) + Math.max(0, finding?.credits ?? 0);
          const lost = Math.floor(BOARDING_CREDIT_LOSS_SHARE * held);
          if (lost > 0) event.boarding.creditsLost = lost;
        }
      }
      break;
    }
  }
  return { event, finding };
}

// The chance the crew repels a boarding attempt (see BOARDING_ATTEMPT_CHANCE). Pure.
export function boardingRepelChance(boardingDefense: number): number {
  return shipEventCheckChance(BOARDING_REPEL_BASE, boardingDefense * BOARDING_DEFENSE_SCALE);
}

// The boarders' haul (user Q13): `credits` taken from the run's findings, newest first, each never below zero.
// Mutates the working clone's findings (the caller appends the event's own finding first).
export function takeBoardingLoss(findings: { credits?: number }[], credits: number): void {
  let left = Math.max(0, Math.floor(credits));
  for (let i = findings.length - 1; i >= 0 && left > 0; i -= 1) {
    const have = Math.max(0, findings[i].credits ?? 0);
    if (have <= 0) continue;
    const take = Math.min(have, left);
    findings[i].credits = have - take;
    left -= take;
  }
}

// The sensor check (a ghost, and the cloaked vessel's first strike). Pure.
function ghostCheckChance(profile: ShipEventProfile): number {
  return shipEventCheckChance(GHOST_PASS_BASE, profile.sensors / GHOST_SENSOR_SCALE);
}

// The battle's seed (its own salt, keyed by the boundary). Pure.
export function shipEventBattleSeed(exp: Pick<Expedition, "seed">, bodyIndex: number, step: number): number {
  return (exp.seed ^ PROBE_BATTLE_SALT ^ Math.imul(scanStepKey(bodyIndex, step) + 1, 0x85ebca6b)) >>> 0;
}

// The enemy of a ship event: `hull` scaled up by the body's hazard (as the run presents it: the museum resist
// applied) and SOFTENED by the run's Security Cunning (exp.ambushSoften: hull, shield and weapon damage x (1 -
// soften); Task 21's "softened ambush", moved here from the scan ground battles). Pure: a fresh combatant.
export function shipEventEnemy(exp: Expedition, body: ExpeditionBody, bodyIndex: number, step: number, hull: ShipEventEnemyHull): Combatant {
  const id = `${exp.id}-shipevent-b${bodyIndex}-s${step}`;
  const k = (1 + PROBE_HAZARD_SCALE * resistedHazard(body.hazard, exp.hazardResist ?? 0)) * Math.max(0, 1 - (exp.ambushSoften ?? 0));
  const c = shipToCombatant({
    id,
    team: "enemy",
    stats: hull.stats,
    weaponLoadout: hull.weapons.map((w, i) => makeWeaponInstance(w, `${id}-w${i}-${w}`)),
    stance: hull.stance,
  });
  c.hullMax = Math.max(1, Math.round(c.hullMax * k));
  c.hull = c.hullMax;
  c.shieldMax = Math.max(0, Math.round(c.shieldMax * k));
  c.shield = c.shieldMax;
  c.weapons = c.weapons.map((w) => {
    const yieldMin = Math.max(0, Math.round(w.yieldMin * k));
    return { ...w, yieldMin, yieldMax: Math.max(yieldMin, Math.round(w.yieldMax * k)) };
  });
  return c;
}

// Does the ship win the event's battle against `hull`? `ambushFirst` names who strikes first (a cloaked vessel;
// null = an ordinary open). A draw is a loss. Pure (resolveBattle never mutates its input).
function shipEventBattleWon(
  exp: Expedition,
  body: ExpeditionBody,
  bodyIndex: number,
  step: number,
  ship: Combatant,
  hull: ShipEventEnemyHull,
  ambushFirst: "ship" | "enemy" | null,
): boolean {
  const enemy = shipEventEnemy(exp, body, bodyIndex, step, hull);
  const ambush = ambushFirst === "ship" ? ship.id : ambushFirst === "enemy" ? enemy.id : undefined;
  const result = resolveBattle({ combatants: [ship, enemy] }, shipEventBattleSeed(exp, bodyIndex, step), { precharge: true, ...(ambush ? { ambush } : {}) });
  return result.outcome.winner === "player";
}

// The salvage of a won ship battle (source "encounter", never a relic). Pure.
export function shipEventFindingId(exp: Pick<Expedition, "id">, bodyIndex: number, step: number): string {
  return `${exp.id}-find-ship-b${bodyIndex}-s${step}`;
}
function shipEventSalvage(exp: Expedition, body: ExpeditionBody, bodyIndex: number, step: number, cloaked: boolean): ExpeditionFinding {
  const seed = (exp.seed ^ PROBE_SALVAGE_SALT ^ Math.imul(scanStepKey(bodyIndex, step) + 1, 0x27d4eb2f)) >>> 0;
  const haul = rollHaul(seed, body.planetType, body.hazard, cloaked ? CLOAKED_SALVAGE_SCALE : PROBE_SALVAGE_SCALE);
  return { id: shipEventFindingId(exp, bodyIndex, step), source: "encounter", materials: haul.materials, credits: haul.credits, relic: null };
}

// The bonus-discovery stream of a ghost read at `body` boundary `step` (expedition.ts draws the PoI). Pure.
export function ghostFindSeed(exp: Pick<Expedition, "seed">, bodyIndex: number, step: number): number {
  return (exp.seed ^ GHOST_FIND_SALT ^ Math.imul(scanStepKey(bodyIndex, step) + 1, 0x9e3779b9)) >>> 0;
}

// The light hull damage a run's ship carries home (GroundOpsState.hullDamage), applied to the ship at claim
// through the existing damage path: the ship is marked damaged and its repairDamage grows by the whole points,
// so the Shipyard's auto-repair (tick.ts processShipRepairs) takes it from there. A run with none, or a ship no
// longer in the fleet, returns the SAME state. Pure.
export function applyShipEventDamage(state: GameState, exp: Pick<Expedition, "shipId" | "groundOps">): GameState {
  const damage = Math.ceil(exp.groundOps?.hullDamage ?? 0);
  if (!(damage > 0) || !state.ships.some((s) => s.id === exp.shipId)) return state;
  return {
    ...state,
    ships: state.ships.map((s) => (s.id === exp.shipId ? { ...s, damaged: true, repairDamage: (s.repairDamage ?? 0) + damage } : s)),
  };
}

