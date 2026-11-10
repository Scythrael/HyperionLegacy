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
// SAFE FIRST RUNS (SF-2): a training run's events fire and always pass (trainingShipEvent). SF-3: an ordinary run on the
// difficulty curve (runDifficulty.ts) reads each check's FAIL chance and each hull wear x its ramp, and its battle enemy
// the curve's strength with the hazard at most the tier's ceiling; at full strength every number is exactly as before.
//
// Module graph: imports model, combat/*, gambit (rollHaul, scanStepKey), crewOverlay, equipment, officerStats,
// diminishing, relics, enemyRanks, runDifficulty, fieldKits. Never imports expedition.ts or groundOps.ts. PURE throughout.
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
  withFavoredLines,
  WR11_SWITCH,
} from "./model";
import { makeRng } from "./combat/rng";
import { combatHullTypeOf, shipToCombatant, type CombatShipStats } from "./combat/bridge";
import { resolveBattle } from "./combat/resolveBattle";
import { makeWeaponInstance, type WeaponId } from "./combat/weapons";
import type { CombatStance } from "./combat/positioning";
import type { Combatant } from "./combat/types";
import { rollHaul, scanStepKey } from "./gambit";
import { equippedFor } from "./equipment";
import { damageControlEffect } from "./utilityGear";
import { effectiveShipStats, officerCombatModsFromProfile, officerCombatProfile, shipCombatRulesStamp, shipCrewContribution, shipRepairSpeedBonus } from "./crewOverlay";
// Complement CP-13: the Tactician bridge's weapon line (crewModules.ts imports no scan code, so no cycle).
import { hullFamilyWeaponLine } from "./crewModules";
import { ENCOUNTER_OPEN_DISTANCE, ENEMY_TORPEDO, RULES_COMBAT_SPEED, SHIP_EVENT_TORPEDO_PERMILLE_BY_TIER, TORPEDO_ROLL_UNITS, stampCombatArgs } from "./combat/combatRules";
// WR-5b (0.14.0): the commanding captain's Tactician talents, frozen with the battle profile.
import { shipCaptainCombatMods, withCaptainRepair } from "./captainTacticianEffects";
import { CREW_STAT_KEYS } from "./crewBuffs";
import { departmentFacet } from "./officerStats";
import { diminishing } from "./diminishing";
import { resistedHazard } from "./relics";
// GEAR WEAR step 4: a flagged run's ship fights its frozen gear and records the battle wear each event took.
import { combatGearView, wornConditions } from "./gearWear";
import { addBattleWear, combatantPools, hullWearOnPlating, poolBattleWear, waveBattleWear, type BattleWearMap } from "./gearWearCombat";
// Safe first runs SF-2: the training run stamp's one read (pass-only events).
import { isTrainingRun } from "./enemyRanks";
// Safe first runs SF-3: an ordinary run on the curve (the check and wear scale, the enemy's strength and hazard ceiling).
import { encounterHazard, rampEnemyScale, rampedChance, rampedPassChance, rampedStampOf, runOddsRampOf, runRampOf } from "./runDifficulty";
// Field Kits FKR-8 (OC-F1): a Lure Beacon's salvage drop scale, rolled per use.
import { fieldDeviceLureDial, fieldDeviceSalvageMult, fieldDeviceUseEffectiveness, fieldDevicesLive } from "./fieldKits";

// ===== Salts (odd, distinct from every engine salt: salts.test.ts) =====

export const SHIP_EVENT_SALT = 0x5c9e2b47; // the per-boundary event stream (the fixed five-draw layout)
export const PROBE_BATTLE_SALT = 0x3d71a6e9; // a probe or cloaked-vessel battle
export const PROBE_SALVAGE_SALT = 0x6f2c84b3; // a won battle's salvage haul
export const GHOST_FIND_SALT = 0x1a9d5e77; // a sensor ghost's bonus discovery (expedition.ts, at the body's completion)
export const SHIP_TORPEDO_SALT = 0x2b7e1517; // WR-8b: whether a probe or cloaked vessel carries a torpedo (one draw)

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
// E-MOD EM-5: the universal modules too (a module listing "shipEvent" acts here; the rest are skipped by the fold).
const COMBAT_SLOT_TYPES: ReadonlySet<string> = new Set(["weapon", "shieldEmitters", "hullPlating", "droneBay", "module"]);

// The frozen profile at dispatch (groundOps.ts snapshotGroundOps writes it). Pure: fresh, JSON-safe data.
export function snapshotShipEventProfile(state: GameState, ship: ShipInstance): ShipEventProfile {
  // WR-8: the run's combat rules, the ship's combat speed and its installed reactor and drive qualities, frozen here
  // (undefined only under the test switch).
  const combatRules = shipCombatRulesStamp(state, ship);
  const installed = equippedFor(state, ship.id);
  const gear = installed.filter((piece) => COMBAT_SLOT_TYPES.has(piece.slotType));
  // WR-7 follow-up (OC-D5): the suite's favored lines on a Tactician hull, frozen here with the rest of the profile.
  const dcRepair = damageControlEffect(withFavoredLines(installed, ship.typeKey)).repairTimeReduction;
  // WR-5b: the commanding captain's Tactician talents (absent without a node, so the profile is unchanged).
  const captainCombat = shipCaptainCombatMods(state, ship);
  // Complement CP-13 (OC-13): the Tactician bridge's weapon line (installed gear), frozen here (absent when 0).
  const hullWeapon = hullFamilyWeaponLine(state, ship);
  const battle: ShipEventBattle = {
    hullType: ship.typeKey,
    ...(gear.length > 0 ? { installedGear: structuredClone(gear) } : {}),
    officerCombat: structuredClone(officerCombatProfile(state, ship)),
    hullMax: 0,
    // GO-8b: the field repair's divisor (the Shipyard's: Rapid Recovery, Veteran Instincts, Engineering Constitution).
    // CP-2: officers + the complement's Damage Control and Mission Turnaround, frozen here at dispatch.
    // WR-5b: x the captain's Damage Control, its own factor (the Shipyard's divisor gets the same).
    repairSpeed: withCaptainRepair(shipRepairSpeedBonus(state, ship), captainCombat),
    ...(captainCombat ? { captainCombat: { ...captainCombat } } : {}),
    ...(combatRules ? { combatRules } : {}),
    // WR-7 (OC-D10, "Field repairs too"): the Damage Control Suite's repair time reduction, frozen for the field repair.
    ...(dcRepair > 0 ? { dcRepairTimeReduction: dcRepair } : {}),
    ...(hullWeapon > 0 ? { hullWeapon } : {}),
  };
  const c = buildShipCombatant(ship.id, battle, 0, 0);
  battle.hullMax = c.hullMax;
  const sensors = effectiveShipStats(state, ship).sensors;
  const engineering = departmentFacet(state, ship, "engineering", "integrity");
  // GO-9: the crew rollup's Boarding Defense (the Security division's buff, the Ossir racial; Strength scales the
  // Security division), frozen here like every other input.
  const boardingDefense = Math.max(0, shipCrewContribution(state, ship)[CREW_STAT_KEYS.boardingDefense] ?? 0);
  // Wiring WR-11 (OC-G5 "Delete frozen copies"): the evasion and shield pool copies are no longer frozen (nothing read
  // them). Only the test switch writes them, in their old places, so a pre-WR-11 golden reproduces.
  if (!WR11_SWITCH.live) {
    return { evasion: c.evasion / 100, sensors, shieldCapacity: c.shieldMax, engineering, boardingDefense, battle } as ShipEventProfile;
  }
  return { sensors, engineering, boardingDefense, battle };
}

// The ship as a combatant `hoursOut` hours into the run (the officers' Constitution ramp folded at that hour),
// carrying `hullDamage` (its hull starts that much below its pool, never below 1). A hull the table no longer
// knows (a removed test hull) fights from its frozen pool, unarmed. Pure: a fresh combatant.
// GEAR WEAR step 4 (user W3 "True condition"): a flagged run's ship (ShipEventBattle.gearWear) fights its dispatch
// snapshot's pieces at the conditions they carry (gearWear.ts combatGearView); any other run's stored copies read
// pristine, exactly as before.
export function buildShipCombatant(id: string, battle: ShipEventBattle, hoursOut: number, hullDamage: number): Combatant {
  const stats: CombatShipStats = SHIP_TYPES[battle.hullType] ?? { hullIntegrity: Math.max(1, battle.hullMax), shieldCapacity: 0, shieldRecharge: 0 };
  const hullType = combatHullTypeOf(battle.hullType) ?? undefined;
  const gear = battle.gearWear === 1 && battle.installedGear ? combatGearView(battle.installedGear, wornConditions(battle.installedGear)) : battle.installedGear;
  const c = shipToCombatant({
    id,
    team: "player",
    stats,
    hullType: SHIP_TYPES[battle.hullType] ? hullType : undefined,
    installedGear: gear,
    officerCombat: officerCombatModsFromProfile(battle.officerCombat, hoursOut),
    captainCombat: battle.captainCombat,
    moduleContext: "shipEvent", // E-MOD EM-5: only modules listing ship events act here
    // Complement CP-13: the frozen Tactician bridge weapon line (absent on every run without one).
    ...(battle.hullWeapon !== undefined ? { hullWeaponDamage: battle.hullWeapon } : {}),
    // WR-8: a run under the combat rules flies its frozen combat speed with the rules' traits and systems.
    ...(battle.combatRules ? stampCombatArgs(battle.combatRules) : {}),
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
  if (isTrainingRun(exp)) return trainingShipEvent(exp, body, bodyIndex, step, kind, draws, event);
  // Safe first runs SF-3: an ordinary run's curve position (1 = full strength, every run without the stamp): each check's
  // FAIL chance and each hull wear x ramp (the battles' enemy reads the curve's strength, shipEventEnemy).
  const ramp = runRampOf(exp);
  const pass = (chance: number): number => chanceUnits(rampedPassChance(chance, ramp));
  const wear = (share: number): number =>
    ramp >= 1 ? Math.max(1, Math.round(share * battle.hullMax)) : ramp > 0 ? Math.max(1, Math.round(share * battle.hullMax * ramp)) : 0;
  const ship = buildShipCombatant(exp.shipId || "ship", battle, hoursOut, exp.groundOps?.hullDamage ?? 0);
  let finding: ExpeditionFinding | null = null;
  // GEAR WEAR step 4: the battle wear this event leaves on a flagged run's pieces (ExpeditionScanEvent.gearWear).
  const wearing = battle.gearWear === 1;
  const gearWear: BattleWearMap = {};
  const plating = (w: number) => {
    if (wearing) addBattleWear(gearWear, hullWearOnPlating(battle.installedGear ?? [], w, battle.hullMax));
  };
  switch (kind) {
    case "debris": {
      const passed = draws.check < pass(shipEventCheckChance(DEBRIS_PASS_BASE, (ship.evasion / 100) * DEBRIS_EVASION_SCALE));
      event.outcome = passed ? "pass" : "fail";
      if (!passed) {
        event.pauseSeconds = DEBRIS_DELAY_SECONDS;
        const w = wear(DEBRIS_HULL_SHARE);
        if (w > 0) {
          event.hullWear = w;
          plating(w);
        }
      }
      break;
    }
    case "storm": {
      const passed = draws.check < pass(shipEventCheckChance(STORM_PASS_BASE, (ship.shieldMax * (1 + Math.max(0, profile.engineering))) / STORM_SHIELD_SCALE));
      event.outcome = passed ? "pass" : "fail";
      if (!passed) event.pauseSeconds = STORM_SLOW_SECONDS;
      break;
    }
    case "ghost": {
      const passed = draws.check < pass(ghostCheckChance(profile));
      event.outcome = passed ? "pass" : "fail";
      if (passed) event.bonusDiscovery = true;
      else event.pauseSeconds = GHOST_RESCAN_SECONDS;
      break;
    }
    case "probe":
    case "cloaked": {
      const cloaked = kind === "cloaked";
      // The cloaked vessel: the sensor check decides who strikes first (pass: the ship ambushes it).
      const ambushFirst = cloaked ? (draws.check < pass(ghostCheckChance(profile)) ? "ship" : "enemy") : null;
      const fought = shipEventBattle(exp, body, bodyIndex, step, ship, cloaked ? CLOAKED_VESSEL_HULL : HOSTILE_PROBE_HULL, ambushFirst, wearing);
      const won = fought.won;
      if (wearing && fought.end) {
        // The pools the ship opened at minus where they ended (weapons, reactor, drive), its shields and its drones.
        const gear = battle.installedGear ?? [];
        addBattleWear(gearWear, poolBattleWear(gear, combatantPools(ship), combatantPools(ship, true), combatantPools(fought.end)));
        addBattleWear(gearWear, waveBattleWear(gear, ship, fought.end, fought.shieldAbsorbed, false));
      }
      event.outcome = won ? "win" : "loss";
      if (won) {
        finding = shipEventSalvage(exp, body, bodyIndex, step, cloaked);
        event.findingId = finding.id;
      } else {
        event.pauseSeconds = cloaked ? CLOAKED_REPAIR_SECONDS : PROBE_REPAIR_SECONDS;
        const w = wear(cloaked ? CLOAKED_HULL_SHARE : PROBE_HULL_SHARE);
        if (w > 0) {
          event.hullWear = w;
          plating(w);
        }
      }
      // GO-9: the vessel may attempt to board (draws 4 and 5, see BOARDING_ATTEMPT_CHANCE).
      if (draws.boardingAttempt < chanceUnits(BOARDING_ATTEMPT_CHANCE)) {
        const repelled = draws.boardingRepel < pass(boardingRepelChance(profile.boardingDefense));
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
  if (Object.keys(gearWear).length > 0) event.gearWear = gearWear;
  return { event, finding };
}

// Safe first runs SF-2 (user SF8, "events fire and always pass"): a TRAINING RUN's ship event fires as drawn (the same
// kind from draws 1 and 3, a boarding attempt on draw 4) and every check passes: debris and the storm pass, a ghost
// passes with its bonus discovery, a probe or cloaked vessel is beaten off with its salvage (no battle is fought), a
// boarding attempt is repelled. No pause, no hull wear, nothing taken. No draw beyond the fixed five. Pure.
function trainingShipEvent(
  exp: Expedition,
  body: ExpeditionBody,
  bodyIndex: number,
  step: number,
  kind: ShipScanEventKind,
  draws: ShipEventDraws,
  event: ExpeditionScanEvent,
): ShipScanEventResult {
  let finding: ExpeditionFinding | null = null;
  if (kind === "probe" || kind === "cloaked") {
    event.outcome = "win";
    finding = shipEventSalvage(exp, body, bodyIndex, step, kind === "cloaked");
    event.findingId = finding.id;
    if (draws.boardingAttempt < chanceUnits(BOARDING_ATTEMPT_CHANCE)) event.boarding = { repelled: true };
  } else {
    event.outcome = "pass";
    if (kind === "ghost") event.bonusDiscovery = true;
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
  // Safe first runs SF-3: an ordinary run's enemy reads the hazard at most the tier's ceiling and the curve's strength.
  const stamp = rampedStampOf(exp);
  const resisted = resistedHazard(body.hazard, exp.hazardResist ?? 0);
  const hazard = stamp ? encounterHazard(resisted, stamp.tier) : resisted;
  const curve = stamp ? rampEnemyScale(stamp.ramp) : 1;
  const k = (1 + PROBE_HAZARD_SCALE * hazard) * Math.max(0, 1 - (exp.ambushSoften ?? 0)) * curve;
  // WR-8: under the run's combat rules the vessel opens at range with its weapons' rule traits.
  const rules = exp.groundOps?.shipEventProfile?.battle?.combatRules !== undefined;
  // WR-8b: on a run stamped with enemy torpedoes the vessel may carry one, after its own guns (shipEventCarriesTorpedo).
  const weaponIds: WeaponId[] = [...hull.weapons, ...(shipEventCarriesTorpedo(exp, bodyIndex, step) ? [ENEMY_TORPEDO] : [])];
  const c = shipToCombatant({
    id,
    team: "enemy",
    stats: hull.stats,
    weaponLoadout: weaponIds.map((w, i) => makeWeaponInstance(w, `${id}-w${i}-${w}`)),
    stance: hull.stance,
    ...(rules ? { combatRules: true, position: ENCOUNTER_OPEN_DISTANCE, speed: RULES_COMBAT_SPEED } : {}),
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

// WR-8b (0.14.0, enemy torpedoes; user 2026-11-10 "Simple now"): a ship event vessel's chance to carry a torpedo on run
// `exp`, in whole permille: the run's tier's SHIP_EVENT_TORPEDO_PERMILLE_BY_TIER x its odds ramp (Tier I climbs the run
// curve one run behind the enemies, like the affixes, the ambushes and the casters' Corroded; Tier II and up read full),
// only on a run whose frozen combat rules carry enemyTorpedoes (every run dispatched since WR-8b), never on the training
// run (it fights no battle) or a run without the curve stamp. Pure.
export function shipEventTorpedoPermille(exp: Pick<Expedition, "difficulty" | "groundOps">): number {
  if (exp.groundOps?.shipEventProfile?.battle?.combatRules?.enemyTorpedoes !== 1) return 0;
  const stamp = rampedStampOf(exp);
  if (stamp === null) return 0;
  return Math.round(rampedChance(SHIP_EVENT_TORPEDO_PERMILLE_BY_TIER[stamp.tier], runOddsRampOf(exp)));
}

// WR-8b: the torpedo roll's seed (its own salt, keyed by the boundary). Pure.
export function shipEventTorpedoSeed(exp: Pick<Expedition, "seed">, bodyIndex: number, step: number): number {
  return (exp.seed ^ SHIP_TORPEDO_SALT ^ Math.imul(scanStepKey(bodyIndex, step) + 1, 0x9e3779b9)) >>> 0;
}

// WR-8b: whether the vessel at `body` boundary `step` carries a torpedo: one draw on its own stream (shipEventTorpedoSeed)
// below the run's chance; no draw at 0. Every input is frozen at dispatch (the seed, the stamps), so a run replays the
// same vessel however it is advanced. Pure.
export function shipEventCarriesTorpedo(exp: Pick<Expedition, "seed" | "difficulty" | "groundOps">, bodyIndex: number, step: number): boolean {
  const permille = shipEventTorpedoPermille(exp);
  if (!(permille > 0)) return false;
  return makeRng(shipEventTorpedoSeed(exp, bodyIndex, step)).nextInt(TORPEDO_ROLL_UNITS) < permille;
}

// The event's battle against `hull`: does the ship win (a draw is a loss), and (GEAR WEAR step 4, `tally`: a flagged
// run) the ship as it ended and the shield points it absorbed, for its battle wear. `ambushFirst` names who strikes
// first (a cloaked vessel; null = an ordinary open). Pure (resolveBattle never mutates its input; the tally is a pure
// read, no draw).
function shipEventBattle(
  exp: Expedition,
  body: ExpeditionBody,
  bodyIndex: number,
  step: number,
  ship: Combatant,
  hull: ShipEventEnemyHull,
  ambushFirst: "ship" | "enemy" | null,
  tally: boolean,
): { won: boolean; end?: Combatant; shieldAbsorbed: number } {
  const enemy = shipEventEnemy(exp, body, bodyIndex, step, hull);
  const ambush = ambushFirst === "ship" ? ship.id : ambushFirst === "enemy" ? enemy.id : undefined;
  // WR-8: the run's combat rules (absent on a run dispatched before WR-8).
  const rules = exp.groundOps?.shipEventProfile?.battle?.combatRules;
  const result = resolveBattle({ combatants: [ship, enemy] }, shipEventBattleSeed(exp, bodyIndex, step), {
    precharge: true,
    ...(ambush ? { ambush } : {}),
    ...(rules ? { combatRules: rules.rules } : {}),
    ...(tally ? { shieldTallyFor: ship.id } : {}),
  });
  const won = result.outcome.winner === "player";
  if (!tally) return { won, shieldAbsorbed: 0 };
  return { won, end: result.finalCombatants.find((c) => c.id === ship.id), shieldAbsorbed: result.shieldAbsorbed ?? 0 };
}

// The salvage of a won ship battle (source "encounter", never a relic). Pure.
export function shipEventFindingId(exp: Pick<Expedition, "id">, bodyIndex: number, step: number): string {
  return `${exp.id}-find-ship-b${bodyIndex}-s${step}`;
}
// Field Kits FKR-8 (the wiring plan's OC-F1: "Lure adds a drop scale on probe salvage"): on a run carrying the field devices
// stamp the expedition's Lure Beacons (their dial over the whole union roster, as the ship events read it) raise the
// haul's scale, rolled for this use (fieldKits.ts shipSalvageScale); the haul's draws are the same either way.
function shipEventSalvage(exp: Expedition, body: ExpeditionBody, bodyIndex: number, step: number, cloaked: boolean): ExpeditionFinding {
  const seed = (exp.seed ^ PROBE_SALVAGE_SALT ^ Math.imul(scanStepKey(bodyIndex, step) + 1, 0x27d4eb2f)) >>> 0;
  const haul = rollHaul(seed, body.planetType, body.hazard, shipSalvageScale(exp, bodyIndex, step, cloaked));
  return { id: shipEventFindingId(exp, bodyIndex, step), source: "encounter", materials: haul.materials, credits: haul.credits, relic: null };
}

// The rollHaul scale of a won ship battle at `body` boundary `step`: the probe's or the cloaked vessel's, x the Lure
// Beacons' salvage multiplier at this use's rolled effectiveness on a run whose devices work per use (fieldDevicesLive;
// no Lure worn, no roll is read). Exported for the wiring probe. Pure.
export function shipSalvageScale(exp: Pick<Expedition, "seed" | "roster" | "fieldKits">, bodyIndex: number, step: number, cloaked: boolean): number {
  const base = cloaked ? CLOAKED_SALVAGE_SCALE : PROBE_SALVAGE_SCALE;
  if (!fieldDevicesLive(exp)) return base;
  const lure = fieldDeviceLureDial(exp.roster?.security ?? []);
  if (!(lure > 0)) return base;
  return base * fieldDeviceSalvageMult(lure, fieldDeviceUseEffectiveness(exp, "salvage", scanStepKey(bodyIndex, step), 0));
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

