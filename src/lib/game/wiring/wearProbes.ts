// GEAR WEAR step 3 (0.14.0, docs/plans/2026-10-16-gear-wear-design.md section 9): the wiring registry's WEAR probes
// and their fixtures. Each probe is a pure read through the real engine (economyTick's mission and short-range arms,
// the tail functions gearWearEngine.ts recordExpeditionWear and resolveGearWear, the run sheet runShipStats, the
// expedition dispatch snapshot), the probes.ts contract: nothing here changes engine behavior.
//
//   wear:use:<sourceId>  the condition one use event of the context takes off the fixture's piece, PER UNIT of the
//                        source's event (raw per-mille on a TOUGHNESS_REFERENCE piece at full condition): 0 without
//                        the piece. The contexts: one delivered captain-mission cycle (extraction, survey,
//                        transport), one delivered non-training short-range cycle, and one stamped expedition coming
//                        home (five minutes underway and on the ground, one fight, one fieldwork step).
//   wear:condition       the condition of the fixture's worn piece (the repair contexts move it).
//   wear:repairGain      what the repair added to the fixture's worn piece (the repair bonuses scale it).
//   wear:eff:<consumer>  a worn piece's consumer read where a run reads it: the run sheet (runShipStats) at the
//                        mission contexts, the dispatch snapshot at expedition:groundOps.

import {
  EQUIPMENT_SLOTS,
  MISSIONS,
  PATROLS,
  patrolRouteOf,
  patrolRouteTicks,
  SUBSPACE_TELESCOPE_FACILITY_KEY,
  freshState,
  effectiveMissionDef,
  missionPhaseTicks,
  type AwayTeamType,
  type CaptainMissionState,
  type CaptainState,
  type EquipmentInstance,
  type Expedition,
  type GameState,
  type MissionKey,
  type PatrolMissionState,
  type ShortRangeMissionState,
} from "../model";
import Decimal from "break_infinity.js";
import { dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, processShipRepairs, shipRepairGear } from "../tick";
import { replayPatrol, type PatrolReplay } from "../combat/patrolReplay";
import { resolveBattle } from "../combat/resolveBattle";
import { deriveWaveSeed, WAVE_BATTLE_SEED_SALT } from "../combat/waveSeed";
import { patrolBattleOptions } from "../combat/patrolProfile";
import { resolveShipScanEventFromDraws, shipEventKindOf, SHIP_EVENT_DRAW_UNITS, SHIP_EVENT_WEIGHT_TOTAL } from "../shipScanEvents";
import { resolveTaskFight, taskFightTeam } from "../groundFight";
import { equippedFor } from "../equipment";
import { advanceExpedition, expeditionCandidates, startExpedition } from "../expedition";
import { runCountsOf } from "../runDifficulty";
import { shortRangeCycleWear } from "../shortRangeCycle";
import { CONDITION_FULL, TOUGHNESS_REFERENCE, USE_CARRY_PER_MILLE, WEAR_SOURCES, patrolCycleGear, pieceCondition, withPieceCondition } from "../gearWear";
import {
  emptyWearEvents,
  expeditionWear,
  missionCycleWear,
  recordExpeditionWear,
  resolveGearWear,
  runShipStats,
  runWearStamp,
  patrolEventWear,
  patrolRouteLightYears,
  shipCrewAboard,
  type MemberUseWear,
  type ShipUseWear,
} from "../gearWearEngine";
import type { ShortRangeTemplateKey } from "../shortRange";
import { DAMAGE_CONTROL_SUITE_KEY, PATHFINDER_SUITE_KEY } from "../utilityGear";
import { GALILEO_VARIETY, studyDiveEvents } from "../gasGiantStudy";
import {
  WIRING_CAPTAIN_ID,
  WIRING_SCIENCE_ID,
  WIRING_SECURITY_ID,
  WIRING_SHIP_ID,
  captainOf,
  combatBase,
  dispatchRun,
  editCaptain,
  installPiece,
  onMission,
  onShortRangeJob,
  shipOf,
  syntheticBody,
  withAwayTeam,
  wiringMember,
  type ContextId,
  type ProbeDef,
} from "./probes";

// ============================================================================
// Fixtures
// ============================================================================

// The condition the repair fixtures start at (Worn, 70%), and the minutes a repair context entry runs.
export const WEAR_FIXTURE_CONDITION = 700;
export const WEAR_REPAIR_MINUTES = 2;

// The member a member slot's fixture piece is worn by: the weapon and the implant by the Security member, the tool by
// the Science member (a tool wears by fieldwork, which only the Science party does).
export function wearMemberOf(slotType: string): string {
  return slotType === "memberTool" ? WIRING_SCIENCE_ID : WIRING_SECURITY_ID;
}

// The first member variety of `slotType` a member of `team` may wear (its key), or undefined.
export function memberVarietyFor(slotType: string, team: AwayTeamType): string | undefined {
  return EQUIPMENT_SLOTS[slotType as keyof typeof EQUIPMENT_SLOTS]?.varieties.find((v) => v.member?.teamTypes.includes(team))?.key;
}

// The fixture piece of `slotType`: on ship-1 (installPiece's id) or on its member (wearPiece's id).
export function wearPieceIdFor(slotType: string): string {
  return slotType.startsWith("member") || slotType === "implant" ? `wiring-wear-${wearMemberOf(slotType)}-${slotType}` : `wiring-equip-${slotType}`;
}

function pieceOf(s: GameState, slotType: string): EquipmentInstance | undefined {
  const id = wearPieceIdFor(slotType);
  return s.equipment.find((e) => e.id === id);
}

// The fixture piece at `condition` (anchored now). Pure.
export function withFixtureCondition(s: GameState, slotType: string, condition: number): GameState {
  const id = wearPieceIdFor(slotType);
  return { ...s, equipment: s.equipment.map((e) => (e.id === id ? withPieceCondition(e, condition, s.gameTimeSeconds) : e)) };
}

// The fixture's utility piece as a Pathfinder Suite (the family that fires on scanned bodies). Pure.
function asPathfinder(s: GameState): GameState {
  const id = wearPieceIdFor("specUtility");
  return { ...s, equipment: s.equipment.map((e) => (e.id === id ? { ...e, moduleVariant: PATHFINDER_SUITE_KEY } : e)) };
}

// A save whose expedition training run is behind it, so a dispatch here is an ordinary (wear-stamped) run.
export function afterExpeditionTraining(s: GameState): GameState {
  const c = runCountsOf(s);
  return { ...s, runCounts: { ...c, expedition: { ...c.expedition, trainingDone: true } } };
}

// Safe first runs SF-7: a save whose first gathering run is behind it (one gathering cycle delivered), so a captain
// mission dispatched here is an ordinary run whose first delivery wears (gearWearEngine.ts gatheringTrainingStamp).
export function afterGatheringTraining(s: GameState): GameState {
  const done = s.lifetimeStats.missionsCompleted;
  return { ...s, lifetimeStats: { ...s.lifetimeStats, missionsCompleted: { ...done, shortOreRun: new Decimal(1) } } };
}

// ============================================================================
// The use events (one per context)
// ============================================================================

const MISSION_OF: Partial<Record<ContextId, MissionKey>> = {
  "mission:extraction": "shortOreRun",
  "mission:survey": "surveyMineralAnomaly",
  "mission:transport": "frontierSupplyRun",
};

// A short-range job of each kind the probes need: a haul for every ship source, the survey for the sensor array.
function shortRangeTemplateFor(sourceId: string): ShortRangeTemplateKey {
  return sourceId === "sensor:surveyCycle" ? "phenomenonSurvey" : "supplyPickup";
}

interface UseEvent {
  after: GameState;
  ship: ShipUseWear[];
  members: Map<string, MemberUseWear[]>;
}

// One delivered captain-mission cycle of ship-1 (a stamped run on its last unloading tick, one economyTick). Pure.
function missionCycleEvent(s: GameState, key: MissionKey): UseEvent {
  const ship = shipOf(s);
  const stamp = runWearStamp(s, ship.id);
  const stats = runShipStats(s, ship, stamp, true);
  const def = effectiveMissionDef(MISSIONS[key], stats);
  const m = captainOf(onMission(s, key, "unloading")).mission as CaptainMissionState;
  const mission: CaptainMissionState = { ...m, recalled: true, phaseProgressTicks: missionPhaseTicks("unloading", def, m.cargo) - 1, ...(stamp ? { gearWear: stamp } : {}) };
  const after = economyTick(editCaptain(s, { mission } as Partial<CaptainState>), 1, () => 0.5);
  return { after, ship: [missionCycleWear(key, stats, s.tickDurationSeconds, true)], members: new Map() };
}

// One delivered NON-training short-range cycle of ship-1 (a stamped run on its last home turnaround tick). Pure.
function shortRangeCycleEvent(s: GameState, sourceId: string): UseEvent {
  const on = onShortRangeJob(s, shortRangeTemplateFor(sourceId), "unloading");
  const m = captainOf(on).mission as ShortRangeMissionState;
  const stamp = runWearStamp(s, shipOf(s).id);
  const roll = { ...m.roll, difficulty: { ...m.roll.difficulty, firstRun: false } };
  const mission: ShortRangeMissionState = { ...m, roll, phaseProgressTicks: m.plan.unloadTicks - 1, ...(stamp ? { gearWear: stamp } : {}) };
  const after = economyTick(editCaptain(on, { mission } as Partial<CaptainState>), 1, () => 0.5);
  const events = shortRangeCycleWear(roll, m.plan, s.tickDurationSeconds);
  const ship: ShipUseWear[] = events ? [{ ...events, bodiesScanned: 0, prospectingCycles: 0, crewed: true }] : [];
  return { after, ship, members: new Map() };
}

// A stamped expedition of ship-1 coming home, through the engine's own tail (recordExpeditionWear, resolveGearWear):
// the real run, finished, with its use set to one known amount: five minutes underway and on the ground (one slice
// each), one ground fight for the Security member and one fieldwork step for the Science member. Pure.
function expeditionHomeEvent(s: GameState): UseEvent {
  const ready = afterExpeditionTraining(s.awayMembers.some((m) => m.assignedShipId === WIRING_SHIP_ID) ? s : withAwayTeam(s));
  const cand = expeditionCandidates(ready, WIRING_SHIP_ID)[0];
  const res = startExpedition(ready, WIRING_SHIP_ID, 1, cand.id, true, undefined, false);
  if (!res.success || !res.expedition) throw new Error(`wear probe: dispatch refused: ${res.reason}`);
  const exp = res.expedition;
  const done = advanceExpedition(exp, exp.phaseAnchorSeconds + 1e9);
  const home = done.phaseAnchorSeconds;
  const edited: Expedition = {
    ...done,
    gearWear: { version: 1, dispatchedAt: home - 300 },
    ...(done.groundOps ? { groundOps: { ...done.groundOps, startedAt: home - 300, endedAt: home, wearTally: { [WIRING_SECURITY_ID]: { fights: 1 }, [WIRING_SCIENCE_ID]: { steps: 1 } } } } : {}),
  };
  const before: GameState = { ...res.next, gameTimeSeconds: home - 1 };
  const finished: GameState = { ...res.next, gameTimeSeconds: home, expeditions: res.next.expeditions.map((e) => (e.id === exp.id ? edited : e)) };
  const events = emptyWearEvents();
  recordExpeditionWear(before, finished, events);
  const after = resolveGearWear(before, finished, events);
  const wear = expeditionWear(edited, true)!;
  const members = new Map<string, MemberUseWear[]>();
  for (const [id, list] of wear.members) members.set(id, list.map((e) => e.wear));
  return { after, ship: wear.ship.map((e) => e.wear), members };
}

// GEAR WEAR step 4: the fixture's utility piece as a Damage Control Suite whose lines are the piece's sensors line
// (the fixture's one line), so it shortens a repair and patches a wave. Pure.
export function asDamageControl(s: GameState): GameState {
  const id = wearPieceIdFor("specUtility");
  return {
    ...s,
    equipment: s.equipment.map((e) => {
      if (e.id !== id) return e;
      const line = Math.max(LINE_FLOOR, e.implicitStats.sensors ?? 0);
      return { ...e, moduleVariant: DAMAGE_CONTROL_SUITE_KEY, implicitStats: { repairSpeed: line, waveHullRegen: line } };
    }),
  };
}
// The line a Damage Control Suite fixture carries when the fixture's piece has none (its fires need a line).
const LINE_FLOOR = 20;

// GEAR WEAR step 4: a Shipyard repair the suite shortens (ship-1 damaged, one economyTick starts it). Pure.
function shipyardRepairEvent(s: GameState): UseEvent {
  const damaged: GameState = { ...s, ships: s.ships.map((sh) => (sh.id === WIRING_SHIP_ID ? { ...sh, damaged: true, repairDamage: 400 } : sh)) };
  const after = economyTick(damaged, 1, () => 0.5);
  const started = after.activeProcesses.some((p) => p.kind === "shipRepair");
  return { after, ship: started ? [{ hauls: 0, lightYears: 0, minutesUnderway: 0, surveys: 0, bodiesScanned: 0, prospectingCycles: 0, crewed: false, damageControlFires: 1 }] : [], members: new Map() };
}

// GEAR WEAR step 4: a stamped patrol wave the suite patches: ship-1 with its Standard Issue combat gear on the battle
// probes' patrol, stepped to the first later wave fought below full hull (the patch-up fires before it). Pure.
function patrolPatchEvent(s: GameState): UseEvent {
  const ready = asPatrolVeteranSave(installMissingCombatBaselines(s));
  const r = dispatchCaptainOnPatrol(ready, WIRING_CAPTAIN_ID, WEAR_BATTLE_PATROL, "balanced", false);
  if (!r.success) throw new Error(`wear probe: patrol dispatch refused: ${r.reason}`);
  const replay = replayPatrol(r.next, captainOf(r.next));
  const wave = replay.waves.findIndex((w, i) => i > 0 && w.playerStart.hull > (replay.waves[i - 1].playerEnd?.hull ?? Infinity));
  if (wave < 0) return { after: r.next, ship: [], members: new Map() };
  let st = r.next;
  for (let t = 0; t < replay.waves[wave].routeTick; t++) st = economyTick(st, 1, () => 0.5);
  return { after: st, ship: [{ hauls: 0, lightYears: 0, minutesUnderway: 0, surveys: 0, bodiesScanned: 0, prospectingCycles: 0, crewed: false, damageControlFires: 1 }], members: new Map() };
}

// GEAR WEAR step 5 (patrol use wear): one stamped, non-training patrol cycle of ship-1 ending through the live engine:
// dispatched (Dispatch Once), then set on its route's last tick with every wave behind it and its pools untouched, so
// the one economyTick that ends it records only the cycle's USE (the minutes it flew, the route's round trip). Pure.
function patrolCycleUseEvent(s: GameState): UseEvent {
  const ready = asPatrolVeteranSave(installMissingCombatBaselines(s));
  const r = dispatchCaptainOnPatrol(ready, WIRING_CAPTAIN_ID, WEAR_BATTLE_PATROL, "balanced", false);
  if (!r.success) throw new Error(`wear probe: patrol dispatch refused: ${r.reason}`);
  const m = captainOf(r.next).mission as PatrolMissionState;
  const end = patrolRouteTicks(patrolRouteOf(m)) - (m.returnCutTicks ?? 0);
  // Step 5 fix C2: the cycle's use is recorded exactly (the route's minutes and round trip) and each piece carries the
  // fraction of a per-mille it has not yet taken (EquipmentInstance.useWearCarry), so usePerUnit reads the wear taken
  // as the whole per-mille plus the carry gained.
  const mission: PatrolMissionState = { ...m, progressTicks: end - 1, nextWaveIndex: m.waveTicks.length };
  const before = editCaptain(r.next, { mission } as Partial<CaptainState>);
  const after = economyTick(before, 1, () => 0.5);
  const use = { minutesUnderway: (end * s.tickDurationSeconds) / 60, lightYears: patrolRouteLightYears(PATROLS[WEAR_BATTLE_PATROL]), crewed: shipCrewAboard(before, shipOf(before)) };
  return { after, ship: m.useWear === 1 ? [patrolEventWear({ battle: {}, damageControlFires: 0, use })] : [], members: new Map() };
}

function useEvent(s: GameState, ctx: ContextId, sourceId: string): UseEvent {
  if (ctx === "shipyard") return shipyardRepairEvent(s);
  if (ctx === "patrol") return sourceId === "specUtility:effectFires" ? patrolPatchEvent(s) : patrolCycleUseEvent(s);
  if (ctx === "mission:shortRange") return shortRangeCycleEvent(s, sourceId);
  if (ctx === "expedition:groundOps") return expeditionHomeEvent(s);
  const key = MISSION_OF[ctx];
  if (!key) throw new Error(`wear probe: no use event at ${ctx}`);
  return missionCycleEvent(s, key);
}

// The units of `sourceId`'s event the run made (the catalog's `per` divides them in the raw).
function unitsOf(sourceId: string, ship: readonly ShipUseWear[], member: readonly MemberUseWear[]): number {
  const sum = <T>(list: readonly T[], f: (w: T) => number) => list.reduce((n, w) => n + f(w), 0);
  switch (sourceId) {
    case "cargoBay:haul":
      return sum(ship, (w) => w.hauls);
    case "ftlDrive:distance":
      return sum(ship, (w) => w.lightYears);
    case "reactorCore:minutesRunning":
    case "module:minutesUnderway":
    case "bridge:minutesCrewed":
    case "quarters:minutesCrewed":
      return sum(ship, (w) => w.minutesUnderway);
    case "sensor:surveyCycle":
      return sum(ship, (w) => w.surveys);
    case "sensor:bodyScanned":
      return sum(ship, (w) => w.bodiesScanned);
    case "specUtility:effectFires":
      return sum(ship, (w) => w.prospectingCycles + w.bodiesScanned + (w.damageControlFires ?? 0));
    case "memberWeapon:groundFight":
      return sum(member, (w) => w.groundFights);
    case "memberTool:fieldworkStep":
      return sum(member, (w) => w.fieldworkSteps);
    case "implant:minutesOnGround":
      return sum(member, (w) => w.minutesOnGround);
    default:
      return 0;
  }
}

// What one use event takes off the fixture's piece, per unit of the source (negative: wear lowers it). 0 without the
// piece, or when the event made none of the source's units.
function usePerUnit(s: GameState, ctx: ContextId, sourceId: string): number {
  const source = WEAR_SOURCES.find((w) => w.id === sourceId);
  if (!source) throw new Error(`wear probe: no source ${sourceId}`);
  // A utility piece fires its own way: a prospecting rig on a mission's haul, a Pathfinder Suite on an expedition's
  // scanned bodies, so at an expedition the fixture's utility piece flies as a Pathfinder Suite; at the Shipyard and on
  // a patrol (step 4) as a Damage Control Suite (a repair it shortens, a wave it patches).
  const utility = source.slot === "specUtility";
  const run = utility && ctx === "expedition:groundOps" ? asPathfinder(s) : utility && (ctx === "shipyard" || ctx === "patrol") ? asDamageControl(s) : s;
  const before = pieceOf(run, source.slot);
  if (!before) return 0;
  const ev = useEvent(run, ctx, sourceId);
  const after = ev.after.equipment.find((e) => e.id === before.id);
  const units = unitsOf(sourceId, ev.ship, ev.members.get(wearMemberOf(source.slot)) ?? []);
  if (!after || !(units > 0)) return 0;
  // Step 5 fix C2: a patrol's exact use also leaves a carried fraction of a per-mille on the piece (useWearCarry).
  const carried = ((after.useWearCarry ?? 0) - (before.useWearCarry ?? 0)) / USE_CARRY_PER_MILLE;
  return (-(pieceCondition(before) - pieceCondition(after) + carried) * source.per) / units;
}

// ============================================================================
// The efficiency consumers (where a run reads them)
// ============================================================================

const sheetOfRun = (s: GameState) => runShipStats(s, shipOf(s), runWearStamp(s, WIRING_SHIP_ID), true);

// A Damage Control Suite's `line` (implicit and rolled) in `gear` (0 without the suite).
function dcLine(gear: readonly EquipmentInstance[], line: string): number {
  const dc = gear.find((p) => p.moduleVariant === DAMAGE_CONTROL_SUITE_KEY);
  return dc ? (dc.implicitStats[line] ?? 0) + (dc.rolledStats[line] ?? 0) : 0;
}

function memberStat(s: GameState, memberId: string, stat: string): number {
  const exp = dispatchRun(s);
  const all = [...(exp.roster?.security ?? []), ...(exp.roster?.science ?? [])];
  return all.find((m) => m.memberId === memberId)?.groundStats[stat] ?? 0;
}

const EFF_READS: Readonly<Record<string, (s: GameState, ctx: ContextId) => number>> = {
  "cargoBay:cargoCapacity": (s) => sheetOfRun(s).cargoCapacity,
  "ftlDrive:transitSpeed": (s, ctx) => (ctx === "expedition:groundOps" ? dispatchRun(s).voyage?.outboundSpeed ?? -1 : sheetOfRun(s).transitSpeedMult),
  "ftlDrive:engineEfficiency": (s) => sheetOfRun(s).engineEfficiency,
  // GEAR WEAR step 4: at the Shipyard and on a patrol the fixture's piece is a Damage Control Suite: its repair speed
  // line as the repair duration reads it (tick.ts shipRepairGear), its wave patch-up line as the dispatched cycle's
  // frozen view holds it (the suite's patch reads exactly that).
  "specUtility:lines": (s, ctx) => {
    if (ctx === "shipyard") return dcLine(shipRepairGear(asDamageControl(s), WIRING_SHIP_ID), "repairSpeed");
    if (ctx === "patrol") {
      const ready = asPatrolVeteranSave(installMissingCombatBaselines(asDamageControl(s)));
      const r = dispatchCaptainOnPatrol(ready, WIRING_CAPTAIN_ID, WEAR_BATTLE_PATROL, "balanced", false);
      if (!r.success) throw new Error(`wear probe: patrol dispatch refused: ${r.reason}`);
      return dcLine(patrolCycleGear(equippedFor(r.next, WIRING_SHIP_ID), captainOf(r.next).mission as PatrolMissionState), "waveHullRegen");
    }
    return ctx === "expedition:groundOps" ? dispatchRun(s).sensorPower : sheetOfRun(s).sensors;
  },
  "sensor:lines": (s, ctx) => (ctx === "expedition:groundOps" ? dispatchRun(s).sensorPower : sheetOfRun(s).sensors),
  "bridge:crewEfficiency": (s) => sheetOfRun(s).cargoCapacity,
  "quarters:crewEfficiency": (s) => sheetOfRun(s).unloadSpeedMult ?? 1,
  "memberArmor:groundLines": (s) => memberStat(s, WIRING_SECURITY_ID, "armor"),
  "memberWeapon:groundLines": (s) => memberStat(s, WIRING_SECURITY_ID, "power"),
  "memberTool:fieldworkLines": (s) => memberStat(s, WIRING_SCIENCE_ID, "fieldwork"),
  "implant:groundLines": (s) => memberStat(s, WIRING_SECURITY_ID, "hp"),
};
export const WEAR_EFF_PROBE_KEYS: readonly string[] = Object.keys(EFF_READS);

// ============================================================================
// Step 4: the BATTLE sources and the COMBAT consumers (gear wear step 4)
// ============================================================================
//
//   wear:battle:<sourceId>  the condition ONE battle took off the fixture's first piece of the source's slot, PER UNIT
//                           of what the battle took (the source's measure: the pool lost over its ceiling, the shield
//                           points absorbed over the pool, the hull lost over the hull pool, the drones lost over the
//                           squadron, the hp lost over the hp max), on a TOUGHNESS_REFERENCE piece: the raw per-mille
//                           (negative). Read through the live engine: a stamped patrol dispatched on the fixture and
//                           stepped 1 s at a time to the tick its wear lands (the condition the tail pass wrote), the
//                           measure from the cycle's display replay (the parity contract makes it the live fight); an
//                           expedition's light hull wear on the plating and a ground fight's armor wear through the
//                           homecoming tail. 0 without the piece.
//   wear:eff:<consumer>     (the combat consumers) the dispatched cycle's frozen pool the consumer feeds (the record's
//                           shield and hull pools, its squadron's drone hp).

// The patrol every battle probe flies (several waves, so every source has a wave that takes something).
export const WEAR_BATTLE_PATROL = "crimsonReaverWarband" as const;

// A save whose next patrol is fought at full strength (no training cycle: user W9 keeps it from wearing anything).
function asPatrolVeteranSave(s: GameState): GameState {
  const c = runCountsOf(s);
  return { ...s, runCounts: { ...c, patrol: { ...c.patrol, veteran: true } } };
}

// The battle fixture: a carrier with its Standard Issue combat gear (weapons, emitter, plating, a drone pod, the
// reactor and the drive), every piece at the TOUGHNESS_REFERENCE (so a raw amount is the amount), a patrol veteran.
// Its emitter is a token one (BATTLE_FIXTURE_SHIELD), so the first hit drains the pool: each battle source then takes
// a large share of its measure (a whole per-mille is a small part of the per-unit read).
export const BATTLE_FIXTURE_SHIELD = 1;
export function battleFixture(): GameState {
  const s = asPatrolVeteranSave(combatBase("carrier"));
  return {
    ...s,
    equipment: s.equipment.map((e) => {
      if (e.fittedToShipId !== WIRING_SHIP_ID) return e;
      const tough = { ...e, durabilityMax: TOUGHNESS_REFERENCE };
      return e.slotType === "shieldEmitters" ? { ...tough, implicitStats: { ...e.implicitStats, shieldCapacity: BATTLE_FIXTURE_SHIELD, shieldRecharge: BATTLE_FIXTURE_SHIELD } } : tough;
    }),
  };
}

// A save whose next expedition is fought at full strength (its training run behind it, a veteran: no curve, so a
// failed check takes its whole hull wear).
function asExpeditionVeteranSave(s: GameState): GameState {
  const c = runCountsOf(s);
  return { ...s, runCounts: { ...c, expedition: { ...c.expedition, trainingDone: true, veteran: true } } };
}

// The fixture with ship-1's first piece of `slotType` at `durabilityMax` (its toughness; the toughness rows).
export function withFirstPieceDurability(s: GameState, slotType: string, durabilityMax: number): GameState {
  const first = s.equipment.find((e) => e.fittedToShipId === WIRING_SHIP_ID && e.slotType === slotType);
  return first ? { ...s, equipment: s.equipment.map((e) => (e === first ? { ...e, durabilityMax } : e)) } : s;
}

// The fixture without ship-1's pieces of `slotType` (the off side of a battle source: nothing to wear).
export function withoutSlotPieces(s: GameState, slotType: string): GameState {
  return { ...s, equipment: s.equipment.filter((e) => !(e.fittedToShipId === WIRING_SHIP_ID && e.slotType === slotType)) };
}

function firstPieceOf(s: GameState, slotType: string): EquipmentInstance | undefined {
  return s.equipment.find((e) => e.fittedToShipId === WIRING_SHIP_ID && e.slotType === slotType);
}

const aliveDrones = (c: { drones: { drones: { alive: boolean }[] }[] } | undefined, i: number): number => c?.drones[i]?.drones.filter((d) => d.alive).length ?? 0;

// The tick (route ticks after dispatch) a source's wear lands on and the battle's measure there, from the dispatched
// cycle's display replay: a wave source at the first wave that took a whole per-mille of it (so the piece is pristine
// up to that wave and the read is exact up to the floor), a pool source at the cycle's end (the defeat wave, or the
// route's end). Null when the cycle took none.
function battleMeasure(sourceId: string, raw: number, replay: PatrolReplay, mission: PatrolMissionState, shipId: string): { tick: number; f: number } | null {
  const waves = replay.waves;
  if (waves.length === 0) return null;
  const pool = (sys: "weapon" | "reactor" | "ftl"): { tick: number; f: number } | null => {
    const start = waves[0].playerStart;
    const end = waves[waves.length - 1].playerEnd;
    if (!end) return null;
    const read = (c: typeof start) => (sys === "weapon" ? c.weapons[0] : sys === "reactor" ? c.reactor : c.ftl);
    const s0 = read(start);
    const s1 = read(end);
    if (!s0 || !s1 || !(s0.durabilityMax > 0)) return null;
    // WR-7 follow-up OC-D8: the cycle's own route (its frozen legs).
    const tick = replay.defeated ? waves[waves.length - 1].routeTick : patrolRouteTicks(patrolRouteOf(mission)) - (mission.returnCutTicks ?? 0);
    return { tick, f: (s0.durability - s1.durability) / s0.durabilityMax };
  };
  if (sourceId === "weapon:hitsTaken") return pool("weapon");
  if (sourceId === "reactorCore:hitsTaken") return pool("reactor");
  if (sourceId === "ftlDrive:hitsTaken") return pool("ftl");
  for (const [i, w] of waves.entries()) {
    const start = w.playerStart;
    const end = w.playerEnd;
    let f = 0;
    if (sourceId === "shieldEmitters:damageAbsorbed") {
      // The battle re-resolved with the shield tally (the same seed and options the live wave used: a pure read).
      const again = resolveBattle(
        { combatants: [start, ...w.enemyStart] },
        deriveWaveSeed(mission.masterSeed, i, WAVE_BATTLE_SEED_SALT),
        { ...patrolBattleOptions(mission), shieldTallyFor: shipId },
      );
      f = start.shieldMax > 0 ? Math.min(again.shieldAbsorbed ?? 0, start.shieldMax) / start.shieldMax : 0;
    } else if (sourceId === "hullPlating:hullLost") {
      f = start.hullMax > 0 ? Math.min(start.hull - Math.max(0, end ? end.hull : 0), start.hullMax) / start.hullMax : 0;
    } else if (sourceId === "droneBay:dronesLost") {
      const size = start.drones[0]?.drones.length ?? 0;
      f = size > 0 ? (aliveDrones(start, 0) - aliveDrones(end, 0)) / size : 0;
    }
    if (f > 0 && Math.floor(raw * f) >= 1) return { tick: w.routeTick, f };
    if (!w.playerWon) break;
  }
  return null;
}

// What one patrol battle took off the fixture's first `slot` piece, per unit of the source's measure (negative). 0
// without the piece, an unstamped cycle, or a battle that took none of it.
function patrolBattlePerUnit(s: GameState, sourceId: string, slot: string, raw: number): number {
  const piece = firstPieceOf(s, slot);
  if (!piece) return 0;
  const r = dispatchCaptainOnPatrol(s, WIRING_CAPTAIN_ID, WEAR_BATTLE_PATROL, "balanced", false);
  if (!r.success) throw new Error(`wear probe: patrol dispatch refused: ${r.reason}`);
  const mission = captainOf(r.next).mission as PatrolMissionState;
  if (mission.cycleStartCondition === undefined) return 0;
  const measure = battleMeasure(sourceId, raw, replayPatrol(r.next, captainOf(r.next)), mission, WIRING_SHIP_ID);
  if (!measure || !(measure.f > 0)) return 0;
  // GEAR WEAR step 5: the cycle flies without its use wear stamp, so the reading is the battle source alone (the
  // reactor and the drive also wear by use at the cycle's end; wear:use:* reads that at the patrol context).
  const { useWear: _use, ...battleOnly } = mission;
  let st = editCaptain(r.next, { mission: battleOnly } as Partial<CaptainState>);
  for (let t = 0; t < measure.tick; t++) st = economyTick(st, 1, () => 0.5);
  const after = st.equipment.find((e) => e.id === piece.id);
  if (!after) return 0;
  return -(CONDITION_FULL - pieceCondition(after)) / measure.f;
}

// An expedition's light hull wear on the plating (a failed debris check at the run's first boundary), per unit of the
// hull wear over the frozen hull pool, through the homecoming tail. 0 without the plating or an unflagged run.
function shipEventHullPerUnit(s: GameState): number {
  const piece = firstPieceOf(s, "hullPlating");
  if (!piece) return 0;
  const ready = asExpeditionVeteranSave(s.awayMembers.some((m) => m.assignedShipId === WIRING_SHIP_ID) ? s : withAwayTeam(s));
  const cand = expeditionCandidates(ready, WIRING_SHIP_ID)[0];
  const res = startExpedition(ready, WIRING_SHIP_ID, WIRING_CAPTAIN_ID, cand.id, true, undefined, false);
  if (!res.success || !res.expedition) throw new Error(`wear probe: dispatch refused: ${res.reason}`);
  const exp = res.expedition;
  const battle = exp.groundOps?.shipEventProfile?.battle;
  if (!battle || battle.gearWear !== 1 || exp.bodies.length === 0) return 0;
  let kind = 0;
  while (kind < SHIP_EVENT_WEIGHT_TOTAL && shipEventKindOf({ kind, cloaked: 0 }) !== "debris") kind += 1;
  const draws = { kind, check: SHIP_EVENT_DRAW_UNITS - 1, cloaked: 0, boardingAttempt: SHIP_EVENT_DRAW_UNITS - 1, boardingRepel: 0 };
  const { event } = resolveShipScanEventFromDraws(exp, exp.bodies[0], 0, 0, 1, draws);
  const w = event.hullWear ?? 0;
  if (!(w > 0) || !(battle.hullMax > 0)) return 0;
  // The run comes home now with this one event (the homecoming reads its events, its stamp and its anchor).
  const home = res.next.gameTimeSeconds + 1;
  const edited: Expedition = { ...exp, phase: "complete", phaseAnchorSeconds: home, scanEvents: [event], gearWear: { version: 1, dispatchedAt: home, battle: 1 } };
  const before: GameState = { ...res.next, gameTimeSeconds: home - 1 };
  const finished: GameState = { ...res.next, gameTimeSeconds: home, expeditions: res.next.expeditions.map((e) => (e.id === exp.id ? edited : e)) };
  const events = emptyWearEvents();
  recordExpeditionWear(before, finished, events);
  const after = resolveGearWear(before, finished, events).equipment.find((e) => e.id === piece.id);
  if (!after) return 0;
  return -(CONDITION_FULL - pieceCondition(after)) / Math.min(1, w / battle.hullMax);
}

// A ground fight's armor wear on the Security member's armor (the fixture's piece), per unit of the hp lost over the
// hp max: the real fight (groundFight.ts resolveTaskFight on a battle-stamped run), its record's armor wear landed
// through the homecoming tail. 0 without the armor or a fight in which the member lost no hp.
function groundArmorPerUnit(s: GameState): number {
  const armorId = wearPieceIdFor("memberArmor");
  const piece = s.equipment.find((e) => e.id === armorId);
  if (!piece) return 0;
  const ready = afterExpeditionTraining(s);
  const cand = expeditionCandidates(ready, WIRING_SHIP_ID)[0];
  const res = startExpedition(ready, WIRING_SHIP_ID, WIRING_CAPTAIN_ID, cand.id, true, undefined, false);
  if (!res.success || !res.expedition) throw new Error(`wear probe: dispatch refused: ${res.reason}`);
  const exp = res.expedition;
  const ops = exp.groundOps;
  if (!ops || exp.gearWear?.battle !== 1) return 0;
  const teams = ops.teams.map((team, i) => ({ securityIds: team.securityIds, downedThisTask: [] as string[], securityShare: ops.factors.securityShare[i] ?? 0 }));
  // The hardest of a few fixed fights, so the member loses a measurable share of their hp.
  for (const hazard of [0.9, 0.6, 0.3]) {
    for (const fightCount of [0, 1, 2]) {
      const task = { id: `wear-armor-${hazard}-${fightCount}`, poiId: "abandonedOutpost", fightCount, pointsCleared: 0 };
      const record = resolveTaskFight(exp, teams, syntheticBody("terrestrial", hazard), task, 0);
      const raw = record.armorWear?.[WIRING_SECURITY_ID] ?? 0;
      if (!(raw > 0)) continue;
      const downed = record.downedMemberIds.includes(WIRING_SECURITY_ID);
      const hpMax = taskFightTeam(exp, teams, task).find((c) => c.memberId === WIRING_SECURITY_ID)?.hpMax ?? 0;
      const end = downed ? 0 : (record.memberEnd[WIRING_SECURITY_ID]?.hp ?? hpMax);
      if (!(hpMax > 0)) return 0;
      const f = Math.min(1, (hpMax - end) / hpMax);
      // The run comes home now with this fight's armor wear on its tally (the homecoming reads the tally).
      const home = res.next.gameTimeSeconds + 1;
      const edited: Expedition = { ...exp, phase: "complete", phaseAnchorSeconds: home, gearWear: { version: 1, dispatchedAt: home, battle: 1 }, groundOps: { ...ops, startedAt: home, endedAt: home, wearTally: { [WIRING_SECURITY_ID]: { armor: raw } } } };
      const before: GameState = { ...res.next, gameTimeSeconds: home - 1 };
      const finished: GameState = { ...res.next, gameTimeSeconds: home, expeditions: res.next.expeditions.map((e) => (e.id === exp.id ? edited : e)) };
      const events = emptyWearEvents();
      recordExpeditionWear(before, finished, events);
      const after = resolveGearWear(before, finished, events).equipment.find((e) => e.id === armorId);
      return after ? -(CONDITION_FULL - pieceCondition(after)) / f : 0;
    }
  }
  return 0;
}

function battlePerUnit(s: GameState, ctx: ContextId, sourceId: string): number {
  const source = WEAR_SOURCES.find((w) => w.id === sourceId);
  if (!source || source.mode !== "battle") throw new Error(`wear probe: no battle source ${sourceId}`);
  if (ctx === "patrol") return patrolBattlePerUnit(s, sourceId, source.slot, source.raw);
  if (ctx === "shipEvent" && sourceId === "hullPlating:hullLost") return shipEventHullPerUnit(s);
  if (ctx === "ground" && sourceId === "memberArmor:hpLost") return groundArmorPerUnit(s);
  throw new Error(`wear probe: ${sourceId} has no battle at ${ctx}`);
}

// A combat consumer, read off the patrol cycle a dispatch starts (its frozen view folds the worn piece).
function dispatchedCycle(s: GameState): PatrolMissionState {
  const r = dispatchCaptainOnPatrol(s, WIRING_CAPTAIN_ID, WEAR_BATTLE_PATROL, "balanced", false);
  if (!r.success) throw new Error(`wear probe: patrol dispatch refused: ${r.reason}`);
  return captainOf(r.next).mission as PatrolMissionState;
}

const COMBAT_EFF_READS: Readonly<Record<string, (s: GameState) => number>> = {
  "shieldEmitters:shields": (s) => dispatchedCycle(s).playerShield,
  "hullPlating:hullPoints": (s) => dispatchedCycle(s).playerHull,
  "droneBay:drones": (s) => dispatchedCycle(s).playerDrones[0]?.droneHp ?? 0,
  "module:effect": (s) => dispatchedCycle(s).playerHull,
};

// The step 4 combat consumer fixture: the battle fixture with the consumer's piece installed at the TOUGHNESS_REFERENCE
// under its fixture id (wearPieceIdFor), so the registry's `on` (withFixtureCondition) wears exactly it.
export function combatConsumerFixture(slot: string, over: Partial<EquipmentInstance> = {}): GameState {
  return installPiece(battleFixture(), { slotType: slot, durabilityMax: TOUGHNESS_REFERENCE, ...over });
}

// Pause to repair (user 2026-10-27; the trigger 2026-10-28): the fixture (a Standard-Issue destroyer, a patrol veteran)
// and the `on` that wears its weapons so far down (BREAKING_WEAPON_CONDITION) that a cycle's projection breaks them.
const BREAKING_WEAPON_CONDITION = 20;
export function repairPauseFixture(): GameState {
  return asPatrolVeteranSave(combatBase("destroyer"));
}
export function underRepairPauseLine(s: GameState): GameState {
  return { ...s, equipment: s.equipment.map((e) => (e.fittedToShipId === WIRING_SHIP_ID && e.slotType === "weapon" ? withPieceCondition(e, BREAKING_WEAPON_CONDITION, s.gameTimeSeconds) : e)) };
}

// Whether a stamped Repeat Sweep on the fixture went home to repair at its first route's end (1) or relaunched (0),
// through the live engine.
function repairPausedAfterFirstRoute(s: GameState): number {
  const r = dispatchCaptainOnPatrol(s, WIRING_CAPTAIN_ID, "crimsonReaverSweep", "balanced", true);
  if (!r.success) throw new Error(`wear probe: patrol dispatch refused: ${r.reason}`);
  // WR-7 follow-up OC-D8: the route the dispatched cycle flies (its frozen legs).
  const routeTicks = patrolRouteTicks(patrolRouteOf(captainOf(r.next).mission as PatrolMissionState));
  let st = r.next;
  for (let t = 0; t < routeTicks; t++) st = economyTick(st, 1, () => 0.5);
  const m = captainOf(st).mission as PatrolMissionState | null;
  return m?.repairPause !== undefined ? 1 : 0;
}

// ============================================================================
// The probe table (probes.ts readProbe routes every `wear:` id here)
// ============================================================================

export type WearProbeId = `wear:${string}`;

export function wearProbeDef(id: WearProbeId): ProbeDef {
  if (id === "wear:condition") {
    return { label: "the condition of the fixture's worn piece (per-mille)", read: (s) => conditionOfWorn(s) };
  }
  if (id === "wear:dive") {
    return { label: "the condition one probe dive takes off a Galileo-Class Probe (gasGiantStudy.ts studyDiveEvents)", read: (s) => divePerUnit(s) };
  }
  if (id === "wear:repairGain") {
    return { label: "the condition the repair added to the fixture's worn piece (per-mille)", read: (s) => conditionOfWorn(s) - WEAR_FIXTURE_CONDITION };
  }
  if (id.startsWith("wear:use:")) {
    const sourceId = id.slice("wear:use:".length);
    return { label: `the condition one ${sourceId} event takes off a piece, per unit (gearWearEngine.ts)`, read: (s, ctx) => usePerUnit(s, ctx, sourceId) };
  }
  if (id === "wear:repairPause") {
    return { label: "a stamped Repeat Sweep went home to repair at its first route's end (1) or relaunched (0)", read: (s) => repairPausedAfterFirstRoute(s) };
  }
  if (id.startsWith("wear:battle:")) {
    const sourceId = id.slice("wear:battle:".length);
    return { label: `the condition one battle's ${sourceId} takes off a piece, per unit of what the battle took (gearWearCombat.ts)`, read: (s, ctx) => battlePerUnit(s, ctx, sourceId) };
  }
  if (id.startsWith("wear:eff:")) {
    const key = id.slice("wear:eff:".length);
    const combat = COMBAT_EFF_READS[key];
    if (combat) return { label: `${key} as a dispatched patrol cycle's frozen gear folds it (gearWear.ts combatGearView)`, read: (s) => combat(s) };
    const read = EFF_READS[key];
    if (!read) throw new Error(`wear probe: no consumer ${key}`);
    return { label: `${key} where a run reads it (the run sheet, or the expedition dispatch snapshot)`, read };
  }
  throw new Error(`wear probe: unknown id ${id}`);
}

// The fixture's worn piece: the one piece of the fixture whose condition is set (CONDITION_FULL when none is worn).
function conditionOfWorn(s: GameState): number {
  const worn = s.equipment.find((e) => e.id.startsWith("wiring-") && e.condition !== undefined);
  return worn ? pieceCondition(worn) : CONDITION_FULL;
}

// ===== the probe dive (Gas Giant Study GG-3's seam, gasGiantStudy.ts studyDiveEvents) =====

// The probe dive fixture's Galileo-Class Probe (a member tool) and the system the GG fixtures fly: a fresh save's
// candidate 2, whose body 1 is the gas giant.
export const WEAR_DIVE_PROBE_ID = "wiring-galileo";
const DIVE_GIANT_CANDIDATE = "cand-1-2";
const DIVE_SEC = ["member-1", "member-2", "member-3"];
const DIVE_SCI = ["member-11", "member-12", "member-13"];

// Ship-1 with one Ground team of rank 10 members, the telescope at Level 8, its training run behind it, and a Galileo
// (20 points at the variety's ratios, at the TOUGHNESS_REFERENCE) on the first Science member. Pure.
export function diveFixture(): GameState {
  const base = freshState();
  const member = (id: string, teamType: AwayTeamType) => ({ ...wiringMember(id, teamType), rank: 10 }) as unknown as GameState["awayMembers"][number];
  const s: GameState = {
    ...base,
    nextExpeditionId: 2,
    facilities: { ...base.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level: 8 } },
    awayMembers: [...DIVE_SEC.map((id) => member(id, "security")), ...DIVE_SCI.map((id) => member(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: [{ kind: "ground", security: DIVE_SEC, science: DIVE_SCI, helpOthers: false }, ...(sh.groundTeams ?? []).slice(1)] })),
  };
  const probe = {
    id: WEAR_DIVE_PROBE_ID,
    slotType: "memberTool",
    moduleVariant: GALILEO_VARIETY,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: null,
    implicitStats: { groundFieldwork: 12, groundHazardResist: 6, groundRelicFind: 2 },
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: null,
    fittedToMemberId: DIVE_SCI[0],
  } as unknown as EquipmentInstance;
  return afterExpeditionTraining({ ...s, equipment: [...s.equipment, probe] });
}

// What one probe dive took off the Galileo (negative), through the engine's own homecoming: the real run, finished,
// read at its FIRST dive (the run comes home at that instant, its other studies and its tally left out, so the dive is
// the tool's only use and no upkeep runs after it). 0 without the probe or a dive.
function divePerUnit(s: GameState): number {
  const probe = s.equipment.find((e) => e.id === WEAR_DIVE_PROBE_ID);
  if (!probe) return 0;
  const res = startExpedition(s, WIRING_SHIP_ID, 1, DIVE_GIANT_CANDIDATE, true, undefined, false);
  if (!res.success || !res.expedition) throw new Error(`wear probe: dive dispatch refused: ${res.reason}`);
  const done = advanceExpedition(res.expedition, res.expedition.phaseAnchorSeconds + 4_000_000);
  const first = studyDiveEvents(done)[0];
  if (!first || !done.groundOps) return 0;
  const leg = done.groundOps.studyLegs!.find((l) => l.done && l.endsAt === first.at)!;
  const edited: Expedition = {
    ...done,
    phaseAnchorSeconds: first.at,
    groundOps: { ...done.groundOps, studyLegs: [leg], wearTally: {}, startedAt: first.at, endedAt: first.at },
  };
  const before: GameState = { ...res.next, gameTimeSeconds: first.at - 1 };
  const finished: GameState = { ...res.next, gameTimeSeconds: first.at, expeditions: res.next.expeditions.map((e) => (e.id === edited.id ? edited : e)) };
  const events = emptyWearEvents();
  recordExpeditionWear(before, finished, events);
  const worn = resolveGearWear(before, finished, events).equipment.find((e) => e.id === WEAR_DIVE_PROBE_ID)!;
  return -(CONDITION_FULL - pieceCondition(worn));
}

// The repair context fixtures' "N minutes there" (the registry's on transform), through the engine's pass. Pure.
export function wearRepairMinutes(s: GameState, offRun: boolean): GameState {
  const later = { ...s, gameTimeSeconds: s.gameTimeSeconds + WEAR_REPAIR_MINUTES * 60 };
  const after = offRun ? editCaptain(later, { mission: null } as Partial<CaptainState>) : later;
  return resolveGearWear(s, after, null);
}

// The field repair fixture's run comes home WEAR_REPAIR_MINUTES in, still set down on its leg: through the engine's own
// homecoming (recordExpeditionWear, resolveGearWear), which settles the leg at the field rate in event order. Pure.
export function fieldRepairHome(s: GameState): GameState {
  const exp = s.expeditions.find((e) => e.shipId === WIRING_SHIP_ID && e.phase !== "complete");
  if (!exp) return s;
  const home = s.gameTimeSeconds + WEAR_REPAIR_MINUTES * 60;
  const finished: GameState = { ...s, gameTimeSeconds: home, expeditions: s.expeditions.map((e) => (e.id === exp.id ? { ...e, phase: "complete" as const, phaseAnchorSeconds: home } : e)) };
  const events = emptyWearEvents();
  recordExpeditionWear(s, finished, events);
  return resolveGearWear(s, finished, events);
}

// Ship-1 in a Shipyard repair bay (a damaged hull its auto-start put in a bay). Pure.
export function inShipyardBay(s: GameState): GameState {
  const damaged = { ...s, ships: s.ships.map((sh) => (sh.id === WIRING_SHIP_ID ? { ...sh, damaged: true, repairDamage: 5000 } : sh)) };
  return processShipRepairs(damaged);
}

// Ship-1 set down on a field repair leg of a real expedition, the leg open now. Pure.
export function onFieldRepairLeg(s: GameState): GameState {
  const ready = s.awayMembers.some((m) => m.assignedShipId === WIRING_SHIP_ID) ? s : withAwayTeam(s);
  const cand = expeditionCandidates(ready, WIRING_SHIP_ID)[0];
  const res = startExpedition(ready, WIRING_SHIP_ID, 1, cand.id, true, undefined, false);
  if (!res.success || !res.expedition) throw new Error(`wear probe: dispatch refused: ${res.reason}`);
  const t = res.next.gameTimeSeconds;
  const exp = res.expedition;
  const ops = exp.groundOps!;
  const leg = { kind: "repair" as const, siteBodyIndex: 0, scanBodyIndex: null, startsAt: t, arrivesAt: t, repairedAt: t + 3600, endsAt: t + 3700, hullRepaired: 0 };
  const withLeg: Expedition = { ...exp, groundOps: { ...ops, repairLegs: [leg] } };
  return { ...res.next, expeditions: res.next.expeditions.map((e) => (e.id === exp.id ? withLeg : e)) };
}
