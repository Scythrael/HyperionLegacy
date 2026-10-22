// GEAR WEAR step 3 (0.14.0, docs/plans/2026-10-16-gear-wear-design.md section 11 step 3): THE USE WEAR SOURCES, THE
// REPAIR CONTEXTS AND THE SETTLING. economyTick calls resolveGearWear once per call, at its very tail.
//
// The user (OC-D14, 2026-10-16, verbatim): "Everything wears in different ways. Similar to reality. Use. Battle
// damage. Etc. But can easily be repaired over time."
//
// USER ANSWERS this binds (design USER ANSWERS, 2026-10-16): "Gentle" (use wears a piece to 60% at most, a fully worn
// piece works at 75%: gearWear.ts useWear and the worn-gear view); "No wear on training; implants slow" (a training
// run makes no wear event; the implant is the slowest source); "Free auto + paid rush" (every repair here is automatic
// and free; the paid rush is step 5); "Separate, shown together" (hull damage stays its own Shipyard system: a hull in
// a repair bay only lends its gear the faster bay rate). Battle wear and the combat half are step 4.
//
// THE USE WEAR SOURCES, per kind (gearWear.ts WEAR_SOURCES, every amount through useWear: toughness-scaled, shrinking
// toward the 60% use floor and never below it), each applied at its own game instant:
//   a delivered captain-mission cycle (a run stamped CaptainMissionState.gearWear): the cargo bay one haul, the FTL
//     drive the round trip's light-years, the reactor core the cycle's minutes underway, the bridge and quarters
//     modules the same minutes when crew is aboard, the sensor array one survey (a survey mission), a prospecting
//     rig one fire (an extraction or survey cycle: its yield line acts on the haul);
//   a delivered short-range cycle (a run stamped ShortRangeMissionState.gearWear; the G1-4 engine's seam,
//     shortRangeCycle.ts shortRangeCycleWear, none on a training run): its hauls, light-years, minutes and survey;
//   an expedition coming home (a run stamped Expedition.gearWear; never the training run): the FTL drive the
//     voyage's light-years both ways, the reactor and crew modules the minutes from dispatch to home, the sensor
//     array and a Pathfinder Suite every body scanned; each deployed member's weapon their ground fights, their tool
//     their fieldwork steps (GroundOpsState.wearTally) and their implant the minutes of the ground operations window.
// The Damage Control Suite's fires (a repair it shortens, a wave it patches) and every battle source are step 4.
//
// WHAT A RUN READS (user 2026-10-21, "Re-read each cycle"): a captain mission and a short-range run freeze the condition
// of their ship's worn gear in their stamp (RunWearStamp.frozen) at dispatch AND at each cycle start, and fold THAT for
// the cycle (runShipStats), so worn gear shows from cycle 2 and never changes mid-cycle. The short-range engine
// and the captain-mission loop (tick.ts tickCaptainMission onCycleDelivered) both re-read inside their loops
// (projectRunStamp), so one call, chunks and 1 s steps agree. An expedition stays frozen at dispatch (expedition.ts
// reads the worn-gear view there).
//
// THE REPAIR CONTEXTS (gearWear.ts REPAIR_RATES, lifted by the hull repair's own speed bonuses), by where the piece is
// (member gear follows its member's ship; a spare or an Armory piece not checked out is at home):
//   fieldRepair : its ship is set down on a GO-8b field repair leg (arrived, not yet repaired)
//   underway    : its ship is out on any run (crew upkeep, slow)
//   shipyardBay : its ship sits in a Shipyard repair bay (the hull repair process)
//   home        : anywhere else
//
// SETTLING AND PARITY (design 7). Repair is closed form from a piece's anchor (gearWear.ts settlePiece carries the
// leftover fraction, so many short settles equal one long one at the same rate). Each call: a piece at home, in a bay
// or on a field repair leg settles to the call's end at that context's rate; a piece UNDERWAY settles at the
// underway rate only up to each of its run's events (the event's own instant: a delivery, the run coming home), takes
// the event, and, when its run ended within the call, settles the rest of the call at its new context's rate. Every
// event carries its exact instant, so one call, chunks and 1 s steps leave every piece identical (offline == live:
// tick.ts tick steps economyTick(state, 1), the same as live play). No draws anywhere: plain arithmetic on outcomes
// the game already computed.
//
// IN-FLIGHT RUNS: a captain mission, short-range run or expedition dispatched before step 3 carries no stamp, so it
// reads its gear as it always did and records no wear event. A pristine save with no event is returned as the SAME
// reference (byte-identical).

import {
  MISSIONS,
  effectiveMissionDef,
  missionCycleTiming,
  type EquipmentInstance,
  type Expedition,
  type GameState,
  type MissionKey,
  type RunWearStamp,
  type ShipDerivedStats,
  type ShipInstance,
} from "./model";
import { effectiveShipStats, shipRepairSpeedBonus } from "./crewOverlay";
import { shipCaptainCombatMods, withCaptainRepair } from "./captainTacticianEffects";
import { DAMAGE_CONTROL_SUITE_KEY, PATHFINDER_SUITE_KEY, damageControlEffect } from "./utilityGear";
import { equippedFor } from "./equipmentQueries";
import { distanceLightYears } from "./fuel";
import {
  CONDITION_FULL,
  WEAR_SOURCES,
  WEAR_VIEW_SLOTS,
  pieceCondition,
  repairRatePerMinute,
  settlePiece,
  useWear,
  useWearRaw,
  withPieceCondition,
  wornPieceView,
  type RepairContext,
  type RepairRateBonus,
} from "./gearWear";
import type { ShortRangeWearEvents } from "./shortRangeCycle";

// ============================================================================
// The switch, the stamps and the run sheet
// ============================================================================

// Is gear wear live: does any USE source wear at all? A new run is stamped only while it is (the stamp is the run's
// "this run wears" flag), so a build with every use source at 0 dispatches exactly the record it did before step 3.
// Pure (reads the catalog at call time).
export function gearWearLive(): boolean {
  return WEAR_SOURCES.some((s) => s.mode === "use" && s.raw > 0);
}

// The stamp a captain mission or short-range run is dispatched with (undefined while no source is live): its ship's
// WORN view-slot pieces' conditions, frozen (absent when all are pristine). Pure.
export function runWearStamp(state: GameState, shipId: string): RunWearStamp | undefined {
  if (!gearWearLive()) return undefined;
  const frozen: Record<string, number> = {};
  let any = false;
  for (const p of state.equipment) {
    if (p.fittedToShipId !== shipId || p.condition === undefined || !WEAR_VIEW_SLOTS.has(p.slotType)) continue;
    const c = pieceCondition(p);
    if (c >= CONDITION_FULL) continue;
    frozen[p.id] = c;
    any = true;
  }
  return any ? { version: 1, frozen } : { version: 1 };
}

// The state as a stamped run reads its gear: the ship's pieces at the condition the run froze at dispatch (a piece
// not in `frozen` reads pristine), through the worn-gear view (gearWear.ts wornPieceView). Every other piece is the
// stored one. The SAME state when the run froze nothing and none of its ship's pieces carries a condition. Pure.
export function runGearView(state: GameState, shipId: string, stamp: RunWearStamp): GameState {
  const frozen = stamp.frozen ?? {};
  const touched = state.equipment.some((p) => p.fittedToShipId === shipId && (p.condition !== undefined || frozen[p.id] !== undefined));
  if (!touched) return state;
  const equipment = state.equipment.map((p) => {
    if (p.fittedToShipId !== shipId) return p;
    const at = frozen[p.id];
    if (at === undefined && p.condition === undefined) return p;
    const { condition: _c, conditionAt: _a, ...rest } = p;
    return wornPieceView(at === undefined ? (rest as EquipmentInstance) : { ...(rest as EquipmentInstance), condition: at });
  });
  return { ...state, equipment };
}

// THE RE-READ AT A CYCLE START (user 2026-10-21, "Re-read each cycle"): a Repeat captain mission or short-range run
// re-freezes its stamp at each cycle start, so worn gear shows from cycle 2. The ship's worn view-slot pieces as they
// stand at `at`: each settled at its repair rate (underway) and worn by `events` up to `at` in order, exactly what the
// tail pass (resolveGearWear) writes for the same events, then settled to `at` without writing. `state` is where the
// pieces were during the span (the call's incoming state). Pure.
export function projectRunStamp(state: GameState, shipId: string, events: readonly TimedWear<ShipUseWear>[], at: number): RunWearStamp {
  const index = repairContextIndex(state);
  const bonuses = new Map<string, RepairBonuses>();
  const frozen: Record<string, number> = {};
  let any = false;
  for (const piece of state.equipment) {
    if (piece.fittedToShipId !== shipId || !WEAR_VIEW_SLOTS.has(piece.slotType)) continue;
    if (piece.condition === undefined && events.length === 0) continue;
    const rate = pieceRepairRate(state, index, piece, pieceRepairContext(index, piece), bonuses);
    let p = piece;
    for (const ev of events) if (ev.at <= at) p = applyUseWear(settlePiece(p, ev.at, rate), shipPieceUseRaw(p, ev.wear), ev.at);
    const c = pieceCondition(settlePiece(p, at, rate));
    if (c >= CONDITION_FULL) continue;
    frozen[piece.id] = c;
    any = true;
  }
  return any ? { version: 1, frozen } : { version: 1 };
}

// THE RUN SHEET: the crew-boosted ship stats a stamped run reads, folded over its frozen gear (runGearView), so a worn
// cargo bay, drive, sensor array, prospecting rig or crew module acts on the run. economyTick's mission arm, the
// short-range cycle engine and its cycle-start plan read it. A run without a stamp (dispatched before step 3) reads
// the stored sheet; every gate reads the stored sheet too (design 4.3). Pure.
export function runShipStats(state: GameState, ship: ShipInstance, stamp: RunWearStamp | undefined): ShipDerivedStats {
  return effectiveShipStats(stamp === undefined ? state : runGearView(state, ship.id, stamp), ship);
}

// ============================================================================
// The use wear events a call records
// ============================================================================

// One use event for a SHIP's gear, in the units of the design table (3.1).
export interface ShipUseWear {
  hauls: number; // completed haul cycles (the cargo bay)
  lightYears: number; // light-years flown (the FTL drive, per 10 ly)
  minutesUnderway: number; // minutes out (the reactor core; the crew modules when `crewed`)
  surveys: number; // survey cycles (the sensor array)
  bodiesScanned: number; // bodies scanned on an expedition (the sensor array; a Pathfinder Suite's fires)
  prospectingCycles: number; // extraction or survey cycles (a prospecting rig's fires: its yield line acts)
  crewed: boolean; // crew aboard (the bridge and quarters modules wear only then)
}

// One use event for a MEMBER's gear.
export interface MemberUseWear {
  groundFights: number; // the member weapon
  fieldworkSteps: number; // the member tool
  minutesOnGround: number; // the implant (user W10: the slowest source)
}

export interface TimedWear<W> {
  at: number; // the game instant (gameTimeSeconds) it happened
  wear: W;
}

export interface GearWearEvents {
  ships: Map<string, TimedWear<ShipUseWear>[]>;
  members: Map<string, TimedWear<MemberUseWear>[]>;
  // shipId -> the instant its run ended within the call (the last delivery of a run that stopped, an expedition home)
  runEnds: Map<string, number>;
}

export function emptyWearEvents(): GearWearEvents {
  return { ships: new Map(), members: new Map(), runEnds: new Map() };
}

export function pushShipWear(events: GearWearEvents, shipId: string, at: number, wear: ShipUseWear): void {
  const list = events.ships.get(shipId);
  if (list) list.push({ at, wear });
  else events.ships.set(shipId, [{ at, wear }]);
}

export function pushMemberWear(events: GearWearEvents, memberId: string, at: number, wear: MemberUseWear): void {
  const list = events.members.get(memberId);
  if (list) list.push({ at, wear });
  else events.members.set(memberId, [{ at, wear }]);
}

// Crew aboard: a complement head or a seated officer (the bridge module amplifies the officers, the quarters module
// the complement). Pure.
export function shipCrewAboard(state: GameState, ship: ShipInstance): boolean {
  if ((ship.complement?.buckets ?? []).some((b) => b.count > 0)) return true;
  return state.officers.some((o) => o.assignedShipId === ship.id);
}

// One delivered captain-mission cycle's use: one haul, the mission's round trip in light-years, the cycle's planned
// length in minutes (missionCycleTiming of the run sheet's mission def, the length the cycle ran), one survey on a
// survey mission, one prospecting fire on an extraction or survey cycle. Pure.
export function missionCycleWear(missionKey: MissionKey, stats: ShipDerivedStats, secondsPerTick: number, crewed: boolean): ShipUseWear {
  const def = MISSIONS[missionKey];
  const ticks = missionCycleTiming(effectiveMissionDef(def, stats)).total;
  return {
    hauls: 1,
    lightYears: distanceLightYears(def),
    minutesUnderway: (ticks * secondsPerTick) / 60,
    surveys: def.missionType === "survey" ? 1 : 0,
    bodiesScanned: 0,
    prospectingCycles: def.missionType === "transport" ? 0 : 1,
    crewed,
  };
}

// One delivered short-range cycle's use, from the cycle engine's seam. Pure.
export function shortRangeWear(events: ShortRangeWearEvents, crewed: boolean): ShipUseWear {
  return { hauls: events.hauls, lightYears: events.lightYears, minutesUnderway: events.minutesUnderway, surveys: events.surveys, bodiesScanned: 0, prospectingCycles: 0, crewed };
}

// The slice an expedition's TIME-based use is spread in (minutes; user-approved 2026-10-21 with the step 3 rates): a run
// of hours wears its reactor,
// crew modules and implants slice by slice across the time it ran, each slice settled against the underway upkeep
// first (the cadence a captain mission's cycle gives the same sources), so a long run settles where wear and upkeep
// balance instead of landing hours of wear at once. The COUNTED use (light-years, bodies, fights, fieldwork steps)
// lands as the run comes home.
export const EXPEDITION_WEAR_SLICE_MINUTES = 5;

const NO_SHIP_USE: Omit<ShipUseWear, "crewed"> = { hauls: 0, lightYears: 0, minutesUnderway: 0, surveys: 0, bodiesScanned: 0, prospectingCycles: 0 };

// `minutes` from `from` (game seconds) spread in EXPEDITION_WEAR_SLICE_MINUTES slices: each slice's instant (its end)
// and its minutes. Pure.
function timeSlices(from: number, minutes: number): { at: number; minutes: number }[] {
  if (!(minutes > 0)) return [];
  const n = Math.ceil(minutes / EXPEDITION_WEAR_SLICE_MINUTES - 1e-9);
  const each = minutes / n;
  return Array.from({ length: n }, (_, k) => ({ at: from + (k + 1) * each * 60, minutes: each }));
}

// A stamped expedition's use as it comes home (null without the stamp), every event at its instant, in order:
//   the ship: its minutes from dispatch to home in slices (the reactor, the crew modules when crewed), then at the
//     instant it came home the voyage both ways (the drive) and the bodies scanned (the sensor array, a Pathfinder);
//   each deployed member: the minutes of the ground operations window in slices (the implant), then at the instant
//     the run came home their ground fights (the weapon) and fieldwork steps (the tool) from the run's tally.
// Pure.
export function expeditionWear(exp: Expedition, crewed: boolean): { ship: TimedWear<ShipUseWear>[]; members: Map<string, TimedWear<MemberUseWear>[]> } | null {
  const stamp = exp.gearWear;
  if (!stamp) return null;
  const home = exp.phaseAnchorSeconds;
  const ship: TimedWear<ShipUseWear>[] = timeSlices(stamp.dispatchedAt, Math.max(0, home - stamp.dispatchedAt) / 60).map((s) => ({
    at: s.at,
    wear: { ...NO_SHIP_USE, minutesUnderway: s.minutes, crewed },
  }));
  ship.push({ at: home, wear: { ...NO_SHIP_USE, lightYears: (exp.voyage?.distanceLy ?? 0) * 2, bodiesScanned: exp.bodies.filter((b) => b.scanned).length, crewed } });
  const members = new Map<string, TimedWear<MemberUseWear>[]>();
  const ops = exp.groundOps;
  if (ops) {
    const ground = ops.startedAt !== undefined && ops.endedAt !== undefined ? timeSlices(ops.startedAt, Math.max(0, ops.endedAt - ops.startedAt) / 60) : [];
    for (const team of ops.teams) {
      for (const id of [...team.securityIds, ...team.scienceIds]) {
        if (members.has(id)) continue;
        const tally = ops.wearTally?.[id];
        const list: TimedWear<MemberUseWear>[] = ground.map((s) => ({ at: s.at, wear: { groundFights: 0, fieldworkSteps: 0, minutesOnGround: s.minutes } }));
        list.push({ at: home, wear: { groundFights: tally?.fights ?? 0, fieldworkSteps: tally?.steps ?? 0, minutesOnGround: 0 } });
        members.set(id, list);
      }
    }
  }
  return { ship, members };
}

// The expeditions that came home within the call (complete in `after`, not in `before`), their use recorded (each
// event at its instant; the run ended at its completion anchor). Pure on the two states; writes only into `events`.
export function recordExpeditionWear(before: GameState, after: GameState, events: GearWearEvents): void {
  for (const exp of after.expeditions) {
    if (exp.phase !== "complete" || !exp.gearWear) continue;
    const prior = before.expeditions.find((e) => e.id === exp.id);
    if (!prior || prior.phase === "complete") continue;
    const ship = after.ships.find((s) => s.id === exp.shipId);
    const wear = expeditionWear(exp, ship ? shipCrewAboard(after, ship) : false);
    if (!wear) continue;
    for (const ev of wear.ship) pushShipWear(events, exp.shipId, ev.at, ev.wear);
    for (const [id, list] of wear.members) for (const ev of list) pushMemberWear(events, id, ev.at, ev.wear);
    events.runEnds.set(exp.shipId, exp.phaseAnchorSeconds);
  }
}

// ============================================================================
// The raw per-mille each piece takes from one event
// ============================================================================

// A Damage Control Suite fires on repairs and waves (step 4), a Pathfinder Suite on scanned bodies, every other
// specUtility piece (a prospecting rig) on a prospecting cycle. Pure.
function utilityFires(piece: EquipmentInstance, w: ShipUseWear): number {
  if (piece.moduleVariant === DAMAGE_CONTROL_SUITE_KEY) return 0;
  if (piece.moduleVariant === PATHFINDER_SUITE_KEY) return w.bodiesScanned;
  return w.prospectingCycles;
}

// The raw per-mille a ship piece takes from one use event (before toughness and the floor, gearWear.ts useWear). Pure.
export function shipPieceUseRaw(piece: EquipmentInstance, w: ShipUseWear): number {
  switch (piece.slotType) {
    case "cargoBay":
      return useWearRaw("cargoBay:haul", w.hauls);
    case "ftlDrive":
      return useWearRaw("ftlDrive:distance", w.lightYears);
    case "reactorCore":
      return useWearRaw("reactorCore:minutesRunning", w.minutesUnderway);
    case "bridge":
      return w.crewed ? useWearRaw("bridge:minutesCrewed", w.minutesUnderway) : 0;
    case "quarters":
      return w.crewed ? useWearRaw("quarters:minutesCrewed", w.minutesUnderway) : 0;
    // E-MOD EM-5 (user M9 "Slowly underway"): a universal module wears by time underway, crew or not.
    case "module":
      return useWearRaw("module:minutesUnderway", w.minutesUnderway);
    case "sensor":
      return useWearRaw("sensor:surveyCycle", w.surveys) + useWearRaw("sensor:bodyScanned", w.bodiesScanned);
    case "specUtility":
      return useWearRaw("specUtility:effectFires", utilityFires(piece, w));
    default:
      return 0;
  }
}

// The raw per-mille a member piece takes from one use event. Member armor wears by battle only (step 4). Pure.
export function memberPieceUseRaw(piece: EquipmentInstance, w: MemberUseWear): number {
  switch (piece.slotType) {
    case "memberWeapon":
      return useWearRaw("memberWeapon:groundFight", w.groundFights);
    case "memberTool":
      return useWearRaw("memberTool:fieldworkStep", w.fieldworkSteps);
    case "implant":
      return useWearRaw("implant:minutesOnGround", w.minutesOnGround);
    default:
      return 0;
  }
}

// One use event on a piece at `at` (already settled to `at`): the toughness-scaled amount off its condition, never
// below the use floor (gearWear.ts useWear). A worn piece keeps its settle anchor, so the fraction of a per-mille its
// repair had banked carries on (the wear never resets the clock); a pristine piece is anchored at `at`. The piece as
// it is when the event takes nothing. Pure.
export function applyUseWear(piece: EquipmentInstance, raw: number, at: number): EquipmentInstance {
  if (!(raw > 0)) return piece;
  const c = pieceCondition(piece);
  const amount = useWear(raw, piece.durabilityMax, c);
  if (!(amount > 0)) return piece;
  const anchor = piece.condition !== undefined && piece.conditionAt !== undefined ? piece.conditionAt : at;
  return withPieceCondition(piece, c - amount, anchor);
}

// ============================================================================
// The repair contexts
// ============================================================================

export interface RepairContextIndex {
  readonly out: ReadonlySet<string>; // ships out on a run (a captain mission, a patrol, a short-range run, an expedition)
  readonly bay: ReadonlySet<string>; // ships in a Shipyard repair bay
  readonly field: ReadonlySet<string>; // ships set down on a field repair leg
  readonly memberShip: ReadonlyMap<string, string | null>; // member id -> the ship they are assigned to
}

// Where every ship is at `state.gameTimeSeconds`, for the repair contexts. Pure.
export function repairContextIndex(state: GameState): RepairContextIndex {
  const t = state.gameTimeSeconds;
  const out = new Set<string>();
  for (const ship of state.ships) {
    if (ship.assignedCaptainId === null) continue;
    const captain = state.captains.find((c) => c.id === ship.assignedCaptainId);
    if (captain && captain.mission !== null) out.add(ship.id);
  }
  const field = new Set<string>();
  for (const exp of state.expeditions) {
    if (exp.phase === "complete") continue;
    out.add(exp.shipId);
    if ((exp.groundOps?.repairLegs ?? []).some((leg) => leg.arrivesAt <= t && t < leg.repairedAt)) field.add(exp.shipId);
  }
  const bay = new Set<string>();
  for (const p of state.activeProcesses) if (p.kind === "shipRepair" && p.effect.type === "clearShipDamage") bay.add(p.effect.shipId);
  const memberShip = new Map<string, string | null>();
  for (const m of state.awayMembers) memberShip.set(m.id, m.assignedShipId ?? null);
  return { out, bay, field, memberShip };
}

// The ship a piece rides with: its own ship, or its member's. null = in storage (a spare, an Armory piece). Pure.
function pieceShipId(index: RepairContextIndex, piece: EquipmentInstance): string | null {
  if (piece.fittedToShipId) return piece.fittedToShipId;
  if (piece.fittedToMemberId) return index.memberShip.get(piece.fittedToMemberId) ?? null;
  return null;
}

// A piece's repair context (design 5.1). Pure.
export function pieceRepairContext(index: RepairContextIndex, piece: EquipmentInstance): RepairContext {
  const shipId = pieceShipId(index, piece);
  if (shipId === null) return "home";
  if (index.field.has(shipId)) return "fieldRepair";
  if (index.out.has(shipId)) return "underway";
  if (index.bay.has(shipId)) return "shipyardBay";
  return "home";
}

type RepairBonuses = Partial<Record<RepairRateBonus, number>>;

// A ship's two hull repair bonuses as every gear repair rate on it reads them (REPAIR_RATE_BONUSES): the hull repair's
// own speed bonus (as tick.ts shipyardRepairSpeedBonus reads it: officers, crew and captain) and the installed Damage
// Control Suite's time reduction. Pure.
export function shipRepairBonuses(state: GameState, ship: ShipInstance): RepairBonuses {
  return {
    officerRepairSpeed: withCaptainRepair(shipRepairSpeedBonus(state, ship), shipCaptainCombatMods(state, ship)),
    damageControlRepairTime: damageControlEffect(equippedFor(state, ship.id)).repairTimeReduction,
  };
}

// The rate a piece repairs at in `context` (per-mille a minute): the context's free rate lifted by its ship's hull
// repair bonuses, the same algebra as the hull repair. A piece in storage takes no bonus. Pure (the cache is the
// caller's, per call).
export function pieceRepairRate(
  state: GameState,
  index: RepairContextIndex,
  piece: EquipmentInstance,
  context: RepairContext,
  cache?: Map<string, RepairBonuses>,
): number {
  const shipId = pieceShipId(index, piece);
  if (shipId === null) return repairRatePerMinute(context);
  let bonuses = cache?.get(shipId);
  if (bonuses === undefined) {
    const ship = state.ships.find((s) => s.id === shipId);
    bonuses = ship ? shipRepairBonuses(state, ship) : {};
    cache?.set(shipId, bonuses);
  }
  return repairRatePerMinute(context, bonuses);
}

// A piece's condition RIGHT NOW without writing it (the UI and the readouts, design 7 "reads compute condition
// without writing"): settled from its anchor at its current context's rate. Pure.
export function livePieceCondition(state: GameState, piece: EquipmentInstance): number {
  if (piece.condition === undefined) return pieceCondition(piece);
  const index = repairContextIndex(state);
  const context = pieceRepairContext(index, piece);
  return pieceCondition(settlePiece(piece, state.gameTimeSeconds, pieceRepairRate(state, index, piece, context)));
}

// ============================================================================
// THE PASS (economyTick's tail, once per call)
// ============================================================================

// Settle and wear every piece for the call from `before` (the incoming state: where each piece was) to `after` (the
// call's result, at after.gameTimeSeconds), applying the use events the call recorded at their own instants. See the
// header for the rules. The SAME `after` reference when nothing changed. Pure.
export function resolveGearWear(before: GameState, after: GameState, events: GearWearEvents | null): GameState {
  const hasEvents = events !== null && (events.ships.size > 0 || events.members.size > 0);
  if (!hasEvents && !after.equipment.some((p) => p.condition !== undefined)) return after;
  const now = after.gameTimeSeconds;
  const index = repairContextIndex(before);
  const indexAfter = repairContextIndex(after);
  const bonuses = new Map<string, RepairBonuses>();
  let changed = false;
  const equipment = after.equipment.map((piece) => {
    const shipWear = piece.fittedToShipId ? events?.ships.get(piece.fittedToShipId) : undefined;
    const memberWear = piece.fittedToMemberId ? events?.members.get(piece.fittedToMemberId) : undefined;
    if (shipWear === undefined && memberWear === undefined && piece.condition === undefined) return piece;
    const context = pieceRepairContext(index, piece);
    const contextAfter = pieceRepairContext(indexAfter, piece);
    // Underway with no event and still out: settled only at its run's events.
    if (shipWear === undefined && memberWear === undefined && context === "underway" && contextAfter === "underway") return piece;
    const rate = pieceRepairRate(before, index, piece, context, bonuses);
    let p = piece;
    for (const ev of shipWear ?? []) p = applyUseWear(settlePiece(p, ev.at, rate), shipPieceUseRaw(p, ev.wear), ev.at);
    for (const ev of memberWear ?? []) p = applyUseWear(settlePiece(p, ev.at, rate), memberPieceUseRaw(p, ev.wear), ev.at);
    if (context === "underway") {
      if (contextAfter !== "underway") {
        // The run ended within the call: underway up to the instant it ended, then the new context to the call's end.
        const shipId = piece.fittedToShipId ?? (piece.fittedToMemberId ? index.memberShip.get(piece.fittedToMemberId) ?? null : null);
        const end = Math.min(now, (shipId !== null ? events?.runEnds.get(shipId) : undefined) ?? now);
        p = settlePiece(p, end, rate);
        p = settlePiece(p, now, pieceRepairRate(before, index, piece, contextAfter, bonuses));
      }
    } else {
      p = settlePiece(p, now, rate);
    }
    if (p !== piece) changed = true;
    return p;
  });
  return changed ? { ...after, equipment } : after;
}
