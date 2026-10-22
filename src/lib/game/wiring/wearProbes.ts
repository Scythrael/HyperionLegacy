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
  effectiveMissionDef,
  missionPhaseTicks,
  type AwayTeamType,
  type CaptainMissionState,
  type CaptainState,
  type EquipmentInstance,
  type Expedition,
  type GameState,
  type MissionKey,
  type ShortRangeMissionState,
} from "../model";
import { economyTick, processShipRepairs } from "../tick";
import { advanceExpedition, expeditionCandidates, startExpedition } from "../expedition";
import { runCountsOf } from "../runDifficulty";
import { shortRangeCycleWear } from "../shortRangeCycle";
import { CONDITION_FULL, WEAR_SOURCES, pieceCondition, withPieceCondition } from "../gearWear";
import {
  emptyWearEvents,
  expeditionWear,
  missionCycleWear,
  recordExpeditionWear,
  resolveGearWear,
  runShipStats,
  runWearStamp,
  type MemberUseWear,
  type ShipUseWear,
} from "../gearWearEngine";
import type { ShortRangeTemplateKey } from "../shortRange";
import { PATHFINDER_SUITE_KEY } from "../utilityGear";
import {
  WIRING_SCIENCE_ID,
  WIRING_SECURITY_ID,
  WIRING_SHIP_ID,
  captainOf,
  dispatchRun,
  editCaptain,
  onMission,
  onShortRangeJob,
  shipOf,
  withAwayTeam,
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
  const stats = runShipStats(s, ship, stamp);
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

function useEvent(s: GameState, ctx: ContextId, sourceId: string): UseEvent {
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
      return sum(ship, (w) => w.prospectingCycles + w.bodiesScanned);
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
  // scanned bodies, so at an expedition the fixture's utility piece flies as a Pathfinder Suite.
  const run = ctx === "expedition:groundOps" && source.slot === "specUtility" ? asPathfinder(s) : s;
  const before = pieceOf(run, source.slot);
  if (!before) return 0;
  const ev = useEvent(run, ctx, sourceId);
  const after = ev.after.equipment.find((e) => e.id === before.id);
  const units = unitsOf(sourceId, ev.ship, ev.members.get(wearMemberOf(source.slot)) ?? []);
  if (!after || !(units > 0)) return 0;
  return (-(pieceCondition(before) - pieceCondition(after)) * source.per) / units;
}

// ============================================================================
// The efficiency consumers (where a run reads them)
// ============================================================================

const sheetOfRun = (s: GameState) => runShipStats(s, shipOf(s), runWearStamp(s, WIRING_SHIP_ID));

function memberStat(s: GameState, memberId: string, stat: string): number {
  const exp = dispatchRun(s);
  const all = [...(exp.roster?.security ?? []), ...(exp.roster?.science ?? [])];
  return all.find((m) => m.memberId === memberId)?.groundStats[stat] ?? 0;
}

const EFF_READS: Readonly<Record<string, (s: GameState, ctx: ContextId) => number>> = {
  "cargoBay:cargoCapacity": (s) => sheetOfRun(s).cargoCapacity,
  "ftlDrive:transitSpeed": (s, ctx) => (ctx === "expedition:groundOps" ? dispatchRun(s).voyage?.outboundSpeed ?? -1 : sheetOfRun(s).transitSpeedMult),
  "ftlDrive:engineEfficiency": (s) => sheetOfRun(s).engineEfficiency,
  "specUtility:lines": (s, ctx) => (ctx === "expedition:groundOps" ? dispatchRun(s).sensorPower : sheetOfRun(s).sensors),
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
// The probe table (probes.ts readProbe routes every `wear:` id here)
// ============================================================================

export type WearProbeId = `wear:${string}`;

export function wearProbeDef(id: WearProbeId): ProbeDef {
  if (id === "wear:condition") {
    return { label: "the condition of the fixture's worn piece (per-mille)", read: (s) => conditionOfWorn(s) };
  }
  if (id === "wear:repairGain") {
    return { label: "the condition the repair added to the fixture's worn piece (per-mille)", read: (s) => conditionOfWorn(s) - WEAR_FIXTURE_CONDITION };
  }
  if (id.startsWith("wear:use:")) {
    const sourceId = id.slice("wear:use:".length);
    return { label: `the condition one ${sourceId} event takes off a piece, per unit (gearWearEngine.ts)`, read: (s, ctx) => usePerUnit(s, ctx, sourceId) };
  }
  if (id.startsWith("wear:eff:")) {
    const key = id.slice("wear:eff:".length);
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

// The repair context fixtures' "N minutes there" (the registry's on transform), through the engine's pass. Pure.
export function wearRepairMinutes(s: GameState, offRun: boolean): GameState {
  const later = { ...s, gameTimeSeconds: s.gameTimeSeconds + WEAR_REPAIR_MINUTES * 60 };
  const after = offRun ? editCaptain(later, { mission: null } as Partial<CaptainState>) : later;
  return resolveGearWear(s, after, null);
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
