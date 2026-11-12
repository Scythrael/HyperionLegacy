// GEAR WEAR step 3 (0.14.0, docs/plans/2026-10-16-gear-wear-design.md section 11 step 3): THE USE WEAR SOURCES, THE
// REPAIR CONTEXTS AND THE SETTLING. economyTick calls resolveGearWear once per call, at its very tail.
//
// The user (OC-D14, 2026-10-16, verbatim): "Everything wears in different ways. Similar to reality. Use. Battle
// damage. Etc. But can easily be repaired over time."
//
// USER ANSWERS this binds (design USER ANSWERS, 2026-10-16): "Gentle" (use wears a piece to 60% at most, a fully worn
// piece works at 75%: gearWear.ts useWear and the worn-gear view); "No wear on training; implants slow" (a training
// run makes no wear event; the implant is the slowest source); repair is automatic and free (the paid rush was dropped,
// user 2026-11-09 "None, always automatic"; step 5's Overtime only speeds a docked ship's rate); "Separate, shown together" (hull damage stays its own Shipyard system: a hull in
// a repair bay only lends its gear the faster bay rate). Battle wear and the combat half are step 4 (see below).
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
// GEAR WEAR step 4 (the combat half) adds, through the same events and the same pass: the BATTLE wear of a stamped
// patrol cycle (each wave's shields, plating and pods, the cycle's weapon, reactor and drive pools: tick.ts
// tickCaptainPatrol, gearWearCombat.ts), an expedition ship battle's wear and its hull wear on the plating, and each
// member's armor from their ground fights (landing as a battle-stamped run comes home, like the counted use), and the
// Damage Control Suite's fires (a patrol wave it patched, a Shipyard repair it shortened).
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
//   fieldRepair : its ship is set down on a GO-8b field repair leg (arrived, not yet repaired), settled as the run
//                 comes home, in event order with the wear the run took (so a leg repairs that run's own wear)
//   underway    : its ship is out on any run (crew upkeep, slow)
//   shipyardBay : its ship sits in a Shipyard repair bay (the hull repair process)
//   home        : anywhere else
//
// SETTLING AND PARITY (design 7). Repair is closed form from a piece's anchor (gearWear.ts settlePiece carries the
// leftover fraction, so many short settles equal one long one at the same rate). Each call: a piece at home or in a bay
// settles to the call's end at that context's rate; a piece UNDERWAY (an expedition's field legs included) settles at the
// underway rate only up to each of its run's events (the event's own instant: a delivery, the run coming home), takes
// the event, and, when its run ended within the call, settles the rest of the call at its new context's rate. Every
// event carries its exact instant, so one call, chunks and 1 s steps leave every piece identical (offline == live:
// tick.ts tick steps economyTick(state, 1), the same as live play). No draws anywhere: plain arithmetic on outcomes
// the game already computed.
//
// CONTEXT SWITCHES INSIDE ONE CALL: a run's own end (a mission's last delivery, a short-range run's, an expedition
// coming home) is split at its instant (runEnds), and an expedition's field repair legs are split exactly at their
// edges as the run comes home (fieldWindows, settleScheduled). Every other switch inside a call (a patrol ending, a hull
// entering or leaving a Shipyard bay) settles the whole call at the context the call STARTED in. Production never
// makes a call longer than one tick (live play and tick.ts tick both step economyTick(state, 1)), so that is exact at
// a tick's grain; only a test's single multi-tick call sees the difference.
//
// IN-FLIGHT RUNS: a captain mission, short-range run or expedition dispatched before step 3 carries no stamp, so it
// reads its gear as it always did and records no wear event. A pristine save with no event is returned as the SAME
// reference (byte-identical).

import {
  MISSIONS,
  effectiveMissionDef,
  missionCycleTiming,
  withFavoredLines,
  type CaptainMissionState,
  type EquipmentInstance,
  type Expedition,
  type GameState,
  type MissionKey,
  type PatrolMissionState,
  type RunWearStamp,
  type ShipDerivedStats,
  type ShipInstance,
} from "./model";
import { effectiveShipStats, shipRepairSpeedBonus } from "./crewOverlay";
import { reactorLiftFlagged } from "./reactorSurplus";
import { withoutCrewModuleLines } from "./crewModules";
import { shipCaptainCombatMods, withCaptainRepair } from "./captainTacticianEffects";
import { DAMAGE_CONTROL_SUITE_KEY, PATHFINDER_SUITE_KEY, damageControlEffect } from "./utilityGear";
import { equippedFor } from "./equipmentQueries";
import { distanceLightYears } from "./fuel";
import {
  CONDITION_FULL,
  WEAR_SOURCES,
  WEAR_VIEW_SLOTS,
  applyBattleWearAt,
  pieceCondition,
  repairRatePerMinute,
  decodeRepairAnchor,
  encodeRepairAnchor,
  repairRateQ,
  secondsToFull,
  settlePiece,
  useWear,
  useWearRaw,
  withWornCondition,
  wornPieceView,
  type RepairContext,
  type RepairRateBonus,
} from "./gearWear";
import type { ShortRangeWearEvents } from "./shortRangeCycle";
import { isFirstGatheringRun } from "./runDifficulty";
import { studyDiveEvents } from "./gasGiantStudy";
import { overtimeRate } from "./overtimeRate";

// ============================================================================
// The switch, the stamps and the run sheet
// ============================================================================

// Is gear wear live: does any USE source wear at all? A new run is stamped only while it is (the stamp is the run's
// "this run wears" flag), so a build with every use source at 0 dispatches exactly the record it did before step 3.
// Pure (reads the catalog at call time).
export function gearWearLive(): boolean {
  return WEAR_SOURCES.some((s) => s.mode === "use" && s.raw > 0);
}

// Safe first runs SF-7: the test-only seam golden files use to dispatch as before SF-7 (gatheringTrainingSwitch
// .fixture.ts). Live in the game.
export const GATHERING_TRAINING_WEAR_SWITCH = { live: true };

// Safe first runs SF-7 (user OC-W9 "No wear on training"; the safe first runs include "the first gathering run",
// capture 2026-10-15 section 7): the stamp a captain mission is dispatched with, marked `training` when this dispatch
// is the save's first gathering run: no gathering cycle delivered yet (runDifficulty.ts isFirstGatheringRun, the same
// read the "First run" line uses) and no other captain already flying the marked run (one training run at a time).
// A recalled run flies home (tick.ts recallCaptain) and its unload counts as a delivery even with an empty hold, so it
// uses up the exemption itself; the mark passes to the next dispatch only when a recalled transport idles unfunded
// (nothing delivered). Its first delivered cycle wears nothing (tick.ts economyTick); the mark is decided at dispatch
// only, so one call == chunks == 1 s steps. Pure.
export function gatheringTrainingStamp(state: GameState, stamp: RunWearStamp | undefined): RunWearStamp | undefined {
  if (stamp === undefined || !GATHERING_TRAINING_WEAR_SWITCH.live || !isFirstGatheringRun(state)) return stamp;
  const flying = state.captains.some((c) => c.mission !== null && c.mission.kind === "extraction" && c.mission.gearWear?.training === 1);
  return flying ? stamp : { ...stamp, training: 1 };
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
    for (const ev of events) if (ev.at <= at) p = applyShipWear(settlePiece(p, ev.at, rate), ev.wear, ev.at);
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
// E-MOD EM-4 (reactorSurplus.ts): `reactorLift` is whether the run carries the reactor surplus drive lift flag (a run
// dispatched before EM-4 does not, and flies without the lift); required, so every caller states it.
// WR-7 (OC-D3): `moduleLines` is whether the run carries the crew module lines stamp (CaptainMissionState.moduleLines);
// a run without it reads its crew modules without their Crew Stations / Crew Efficiency lines, exactly as before WR-7.
// Defaults to true (a fresh reading); the engine's run readers pass the run's stamp.
// WR-7 follow-up (OC-D5): `favored` likewise, whether the run carries the favored-spec stamp (favoredSpec); a run
// without it reads its pieces without the favored-spec bonus, exactly as before. Defaults to true (a fresh reading).
// CP-13 (OC-13): `hullBonus` likewise, whether the run carries the hull-family stamp (hullBonus); a run without it reads
// its crew modules without their hull bonus, exactly as before. Defaults to true (a fresh reading).
// CP-14 (OC-16, OC-20): `hullSensors` likewise, whether the run carries the hull sensors stamp (hullSensors); a run without
// it reads its sensors without the hull's base sensors and the Science lift, exactly as before. Defaults to true.
export function runShipStats(state: GameState, ship: ShipInstance, stamp: RunWearStamp | undefined, reactorLift: boolean, moduleLines = true, favored = true, hullBonus = true, hullSensors = true): ShipDerivedStats {
  const lined = moduleLines ? state : withoutCrewModuleLines(state);
  return effectiveShipStats(stamp === undefined ? lined : runGearView(lined, ship.id, stamp), ship, { reactorLift, favored, hullBonus, hullSensors });
}

// THE SHEET A CAPTAIN MISSION IN FLIGHT IS READ ON (EM-4 review): its frozen gear (the run's wear stamp) and its reactor
// lift flag, the ONE helper the engine's mission arm and every in-flight readout share (the Home row, the mission
// card, the transit berth wait), so a readout can never form its own opinion of a phase's length. Pure.
// WR-7 follow-up (OC-D5): a short-range run carries the same stamps, so the short-range cycle engine reads it here too.
export function missionRunSheet(
  state: GameState,
  ship: ShipInstance,
  mission: Pick<CaptainMissionState, "gearWear" | "reactorLift" | "moduleLines" | "favoredSpec" | "hullBonus" | "hullSensors">,
): ShipDerivedStats {
  return runShipStats(state, ship, mission.gearWear, reactorLiftFlagged(mission.reactorLift), mission.moduleLines === 1, mission.favoredSpec === 1, mission.hullBonus === 1, mission.hullSensors === 1);
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
  // GEAR WEAR step 4: a Damage Control Suite's fires (a patrol wave it patched, a Shipyard repair it shortened).
  damageControlFires?: number;
  // GEAR WEAR step 4: BATTLE wear at this instant, piece id -> raw per-mille before toughness (gearWearCombat.ts), taken
  // after the event's use wear (gearWear.ts applyBattleWearAt: below the use floor, never below 0).
  battle?: Readonly<Record<string, number>>;
}

// One use event for a MEMBER's gear.
export interface MemberUseWear {
  groundFights: number; // the member weapon
  fieldworkSteps: number; // the member tool
  minutesOnGround: number; // the implant (user W10: the slowest source)
  // Gas Giant Study GG-3 (gasGiantStudy.ts studyDiveEvents): ONE probe dive of this piece (a Galileo-Class Probe, a
  // member tool), one fieldwork step's use on that piece alone. Absent on every other event.
  divePieceId?: string;
  // GEAR WEAR step 4: the raw battle wear on the member's ARMOR (their ground fights' hp lost, GroundWearTally.armor).
  armor?: number;
}

// A span of a run in which its ship repaired at the FIELD REPAIR rate instead of the underway one: a GO-8b leg, from
// the ship setting down (arrivesAt) to the repair done (repairedAt). Pause to repair: a paused Repeat patrol's home
// window, at the home rate.
export interface RepairWindow {
  from: number;
  to: number;
  // GEAR WEAR close-out (user 2026-11-11 "Allow Overtime in pauses"): the Overtime multiplier a repair pause's window
  // runs the ship's OWN installed pieces at from this window's start (pauseRepairWindows splits a pause at each step
  // bought). Absent = the plain window rate. Member gear never takes it (as docked Overtime).
  overtime?: number;
}

// GEAR WEAR close-out (user 2026-11-11 "Make it exact (Recommended)": leftover underway seconds at a context change are
// credited at the rate that actually applied). A piece's anchor encodes its banked fraction of a per-mille at the rate
// in force since it (design 7, "rate constant between anchors"), so wherever the rate changes inside a span (a repair
// pause's or a field repair leg's edges, a run's end) the fraction is re-expressed at the new rate there (rebaseAnchor):
// up to about 30 s of underway time was credited at the home rate before (up to about 2%). The test-only seam golden
// files captured before it use to settle as before (gearWearCloseoutSwitch.fixture.ts). Live in the game.
export const REPAIR_EXACT_EDGES_SWITCH = { live: true };

// GEAR WEAR close-out (user 2026-11-11 "Keep the bay rate (Recommended)"): a ship whose hull repair ends in a Shipyard
// bay with its gear still worn keeps the doubled bay rate on its gear until the gear is full (ShipInstance.gearBayRate),
// so hull Overtime never makes the gear slower. The same test-only seam. Live in the game.
export const GEAR_BAY_RATE_KEPT_SWITCH = { live: true };

// The rate a window runs a piece at: the window rate, times its Overtime on the ship's own installed pieces. Pure.
function windowRateOf(w: RepairWindow, windowRate: number, own: boolean): number {
  return own && w.overtime !== undefined ? windowRate * w.overtime : windowRate;
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
  // shipId -> the field repair windows of an expedition that came home within the call (its pieces settle at the field
  // rate inside them, in order with the run's wear)
  fieldWindows: Map<string, RepairWindow[]>;
  // GEAR WEAR step 4: the ships whose run ended within the call carrying the step 4 stamp (a stamped patrol cycle, a
  // battle-stamped expedition): their pieces carry the underway fraction into the new context at its rate
  // (rebaseAnchor). A run from before step 4 settles exactly as it always did.
  rateCarry: Set<string>;
  // GEAR WEAR step 4 (pause to repair, user 2026-10-27): shipId -> the home repair windows of a Repeat patrol's pauses
  // that closed within the call (its pieces settle at the HOME rate inside them, in order with its battle wear).
  pauseWindows: Map<string, RepairWindow[]>;
  // GEAR WEAR close-out (user 2026-11-11 "Make it exact"): the ships whose run in the call carries a gear wear stamp (a
  // stamped captain mission, short-range run or expedition, a stamped patrol cycle): their pieces are walked exactly
  // (each window's edges and the run's end credited at the rate that applied, REPAIR_EXACT_EDGES_SWITCH). A run with no
  // stamp (in flight from before gear wear, as every run in a 0.13.x save) settles exactly as it always did.
  exactRuns: Set<string>;
}

export function emptyWearEvents(): GearWearEvents {
  return { ships: new Map(), members: new Map(), runEnds: new Map(), fieldWindows: new Map(), rateCarry: new Set(), pauseWindows: new Map(), exactRuns: new Set() };
}

// An expedition's field repair windows (each GO-8b leg the ship set down on, clipped to `upTo`), in time order. Pure.
export function expeditionFieldWindows(exp: Pick<Expedition, "groundOps">, upTo: number): RepairWindow[] {
  return (exp.groundOps?.repairLegs ?? [])
    .map((leg) => ({ from: leg.arrivesAt, to: Math.min(leg.repairedAt, upTo) }))
    .filter((w) => w.to > w.from)
    .sort((a, b) => a.from - b.from);
}

// Settle `piece` to `t` at `rate`, except inside `windows`, where it settles at `windowRate` (a window's Overtime on the
// ship's `own` installed pieces): split at each window edge past its anchor, so a field repair or a repair pause acts on
// exactly the span the ship was set down or home. Exact (REPAIR_EXACT_EDGES_SWITCH): the banked fraction is re-expressed
// at each edge's new rate. Pure.
export function settleScheduled(
  piece: EquipmentInstance,
  t: number,
  rate: number,
  windows: readonly RepairWindow[] | undefined,
  windowRate: number,
  own = true,
): EquipmentInstance {
  if (!windows || windows.length === 0 || piece.condition === undefined) return settlePiece(piece, t, rate);
  return REPAIR_EXACT_EDGES_SWITCH.live ? settleWalk(piece, -Infinity, t, rate, windows, windowRate, own).piece : settleScheduledLegacy(piece, t, rate, windows, windowRate, own);
}

// The settle before the close-out (REPAIR_EXACT_EDGES_SWITCH off): each call walks from the piece's anchor and carries
// its banked fraction across an edge unchanged. Pure.
function settleScheduledLegacy(piece: EquipmentInstance, t: number, rate: number, windows: readonly RepairWindow[], windowRate: number, own: boolean): EquipmentInstance {
  let p = piece;
  for (const w of windows) {
    const cursor = p.conditionAt ?? t;
    if (p.condition === undefined || w.from >= t) break;
    if (w.to <= cursor) continue;
    if (w.from > cursor) p = settlePiece(p, w.from, rate);
    if (p.condition === undefined) break;
    p = settlePiece(p, Math.min(w.to, t), windowRateOf(w, windowRate, own));
  }
  return settlePiece(p, t, rate);
}

// THE EXACT WALK (user 2026-11-11 "Make it exact"): from `pos` (where the walk already settled the piece to; -Infinity
// for a stored piece, whose anchor then marks it) to `t`, at `rate` outside the windows and each window's rate inside,
// the banked fraction re-expressed at every edge where the rate changes (rebaseAnchor), so each second is credited at
// the rate that applied. Returns the piece and the rate its anchor is encoded at (the rate in force at `t`). A stored
// anchor never sits inside a window with a bank at another rate (a pause or a field leg is walked whole in the call it
// closes, and leaving it re-encodes at the outside rate), so the walk reads one inside a window as already entered. Pure.
function settleWalk(
  piece: EquipmentInstance,
  pos: number,
  t: number,
  rate: number,
  windows: readonly RepairWindow[],
  windowRate: number,
  own: boolean,
): { piece: EquipmentInstance; rate: number } {
  let p = piece;
  let cur = rate;
  if (p.condition === undefined) return { piece: p, rate };
  let cursor = Math.max(pos, p.conditionAt ?? t);
  for (const w of windows) {
    if (p.condition === undefined) return { piece: p, rate };
    if (w.to <= cursor) continue;
    if (w.from >= t) break;
    const wr = windowRateOf(w, windowRate, own);
    // Entering at its start (the walk got there: from before it, or from the end of a back-to-back window, a pause split
    // at an Overtime step): the banked fraction is re-expressed at its rate. Already past its start: entered already.
    if (w.from >= cursor) {
      if (w.from > cursor) {
        p = settlePiece(p, w.from, cur);
        cursor = w.from;
        if (p.condition === undefined) return { piece: p, rate };
      }
      p = rebaseAnchor(p, cursor, cur, wr);
    }
    cur = wr;
    const end = Math.min(w.to, t);
    p = settlePiece(p, end, cur);
    cursor = end;
    if (end >= w.to && p.condition !== undefined) {
      p = rebaseAnchor(p, end, cur, rate);
      cur = rate;
    }
  }
  if (p.condition === undefined) return { piece: p, rate };
  return { piece: settlePiece(p, t, cur), rate: cur };
}

// A piece's settle through one span step by step (the tail pass and the relaunch projection settle it to each event,
// take the event, then go on): the walk's position is carried between steps, so each window is entered and left once.
// Not `exact` (REPAIR_EXACT_EDGES_SWITCH off, or a run with no gear wear stamp), every step walks from the anchor as
// before. A fresh walker per piece. Pure.
export function scheduledWalker(
  rate: number,
  windows: readonly RepairWindow[] | undefined,
  windowRate: number,
  own = true,
  exact = REPAIR_EXACT_EDGES_SWITCH.live,
): (piece: EquipmentInstance, t: number) => EquipmentInstance {
  let pos = -Infinity;
  return (piece, t) => {
    let p: EquipmentInstance;
    if (!windows || windows.length === 0 || piece.condition === undefined) p = settlePiece(piece, t, rate);
    else if (exact) p = settleWalk(piece, pos, t, rate, windows, windowRate, own).piece;
    else p = settleScheduledLegacy(piece, t, rate, windows, windowRate, own);
    pos = Math.max(pos, t);
    return p;
  };
}

// A repair pause's home window from its start to `to`, split at each Overtime step bought during it (each part carries
// the steps then in force as its `overtime` multiplier). Empty while `to` is not past its start. Pure.
export function pauseRepairWindows(pause: { from: number; overtime?: readonly { at: number; steps: number }[] }, to: number): RepairWindow[] {
  const out: RepairWindow[] = [];
  let from = pause.from;
  let mult: number | undefined;
  for (const o of pause.overtime ?? []) {
    const at = Math.max(from, Math.min(o.at, to));
    if (at > from) out.push(mult === undefined ? { from, to: at } : { from, to: at, overtime: mult });
    from = at;
    mult = overtimeRate(o.steps);
  }
  if (to > from) out.push(mult === undefined ? { from, to } : { from, to, overtime: mult });
  return out;
}

// User 2026-11-12, "Yes, keep it (Recommended)" (GEAR WEAR close-out; no longer an open call): a docked ship's gear
// repair Overtime carries into a "Repair first, then go" pause at dispatch (the ship never left home), so that pause
// repairs at the bought rate and is shorter (tick.ts dispatchCaptainOnPatrol). false = it clears at dispatch, as when
// any ship leaves (the record then clears at the next tick: trackGearRepairJobs keeps it only on a pause that carries
// Overtime steps). One line.
export const DOCKED_OVERTIME_CARRIES_INTO_FIRST_PAUSE = true;

// GEAR WEAR step 4 (pause to repair): the combat pieces a repair pause waits on (every system a fight reads; the pause
// lasts until each is back to full at the home rate). tick.ts reads it for the pause's length.
export const REPAIR_PAUSE_SLOTS: ReadonlySet<string> = new Set(["weapon", "reactorCore", "ftlDrive", "shieldEmitters", "hullPlating", "droneBay"]);

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
  // GEAR WEAR step 4: a battle-stamped run's ship battles and hull wear (each event's gearWear), counted like the use.
  const battle = stamp.battle === 1 ? expeditionBattleWear(exp) : undefined;
  ship.push({
    at: home,
    wear: {
      ...NO_SHIP_USE,
      lightYears: (exp.voyage?.distanceLy ?? 0) * 2,
      bodiesScanned: exp.bodies.filter((b) => b.scanned).length,
      crewed,
      ...(battle ? { battle } : {}),
    },
  });
  const members = new Map<string, TimedWear<MemberUseWear>[]>();
  const ops = exp.groundOps;
  if (ops) {
    const ground = ops.startedAt !== undefined && ops.endedAt !== undefined ? timeSlices(ops.startedAt, Math.max(0, ops.endedAt - ops.startedAt) / 60) : [];
    for (const team of ops.teams) {
      for (const id of [...team.securityIds, ...team.scienceIds]) {
        if (members.has(id)) continue;
        const tally = ops.wearTally?.[id];
        const list: TimedWear<MemberUseWear>[] = ground.map((s) => ({ at: s.at, wear: { groundFights: 0, fieldworkSteps: 0, minutesOnGround: s.minutes } }));
        // GEAR WEAR step 4: and their armor's battle wear (a battle-stamped run's tally only).
        const armor = stamp.battle === 1 ? (tally?.armor ?? 0) : 0;
        list.push({ at: home, wear: { groundFights: tally?.fights ?? 0, fieldworkSteps: tally?.steps ?? 0, minutesOnGround: 0, ...(armor > 0 ? { armor } : {}) } });
        members.set(id, list);
      }
    }
  }
  // Gas Giant Study GG-3: each probe dive wears the probe that dove, at the dive's end (studyDiveEvents).
  for (const dive of studyDiveEvents(exp)) {
    const list = members.get(dive.memberId) ?? [];
    list.push({ at: dive.at, wear: { groundFights: 0, fieldworkSteps: 0, minutesOnGround: 0, divePieceId: dive.pieceId } });
    members.set(dive.memberId, list);
  }
  for (const list of members.values()) list.sort((a, b) => a.at - b.at);
  return { ship, members };
}

// The expeditions that came home within the call (complete in `after`, not in `before`), their use recorded (each
// event at its instant), the instant each came home (its completion anchor) and its field repair windows, so its
// pieces settle in event order through the whole run. `shift` moves every instant (a time-skipped run, processSpeed.ts,
// finishes on its own clock ahead of the game's: its timeline is laid back so it ends now). Pure on the two states;
// writes only into `events`.
export function recordExpeditionWear(before: GameState, after: GameState, events: GearWearEvents, shift: number = 0): void {
  for (const exp of after.expeditions) {
    if (exp.phase !== "complete") continue;
    const prior = before.expeditions.find((e) => e.id === exp.id);
    if (!prior || prior.phase === "complete") continue;
    const home = exp.phaseAnchorSeconds;
    events.runEnds.set(exp.shipId, home + shift);
    if (exp.gearWear?.battle === 1) events.rateCarry.add(exp.shipId);
    if (exp.gearWear !== undefined) events.exactRuns.add(exp.shipId);
    const windows = expeditionFieldWindows(exp, home).map((w) => ({ from: w.from + shift, to: w.to + shift }));
    if (windows.length > 0) events.fieldWindows.set(exp.shipId, windows);
    const ship = after.ships.find((s) => s.id === exp.shipId);
    const wear = expeditionWear(exp, ship ? shipCrewAboard(after, ship) : false);
    if (!wear) continue;
    for (const ev of wear.ship) pushShipWear(events, exp.shipId, ev.at + shift, ev.wear);
    for (const [id, list] of wear.members) for (const ev of list) pushMemberWear(events, id, ev.at + shift, ev.wear);
  }
}

// A TIME-SKIPPED expedition (processSpeed.ts applyTimeSkip: the run finished on its own clock, at its natural end E,
// while the game clock stays at now) comes home now: its use wear and its field repairs apply in event order, its
// timeline laid back by E - now so it ends at the skip, exactly as if it had come home on a tick. `before` holds the
// run in flight, `after` holds it finished. Pure.
export function expeditionHomeNow(before: GameState, after: GameState, expeditionId: string): GameState {
  const exp = after.expeditions.find((e) => e.id === expeditionId);
  if (!exp || exp.phase !== "complete") return after;
  const events = emptyWearEvents();
  recordExpeditionWear(
    { ...before, expeditions: before.expeditions.filter((e) => e.id === expeditionId) },
    { ...after, expeditions: [exp] },
    events,
    after.gameTimeSeconds - exp.phaseAnchorSeconds,
  );
  return resolveGearWear(before, after, events);
}

// ============================================================================
// The raw per-mille each piece takes from one event
// ============================================================================

// GEAR WEAR step 4: the battle wear a battle-stamped expedition's ship events left (each event's gearWear, summed by
// piece), or undefined when none did. Pure.
export function expeditionBattleWear(exp: Pick<Expedition, "scanEvents">): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  let any = false;
  for (const e of exp.scanEvents ?? []) {
    for (const [id, raw] of Object.entries(e.gearWear ?? {})) {
      if (!(raw > 0)) continue;
      out[id] = (out[id] ?? 0) + raw;
      any = true;
    }
  }
  return any ? out : undefined;
}

// A Damage Control Suite fires on the patrol waves it patches and the Shipyard repairs it shortens (step 4), a
// Pathfinder Suite on scanned bodies, every other specUtility piece (a prospecting rig) on a prospecting cycle. Pure.
function utilityFires(piece: EquipmentInstance, w: ShipUseWear): number {
  if (piece.moduleVariant === DAMAGE_CONTROL_SUITE_KEY) return w.damageControlFires ?? 0;
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

// The raw per-mille a member piece takes from one use event. Member armor wears by battle only (step 4: MemberUseWear
// armor, applyMemberWear). Pure.
export function memberPieceUseRaw(piece: EquipmentInstance, w: MemberUseWear): number {
  if (w.divePieceId !== undefined) return w.divePieceId === piece.id ? useWearRaw("memberTool:fieldworkStep", 1) : 0;
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
  return withWornCondition(piece, c - amount, at);
}

// ONE ship event on a ship piece at `at` (already settled to `at`): its use wear, then its battle wear (step 4; design
// 7: "settle, then wear"). The ONE function the tail pass, the cycle-start re-reads and the patrol cycle projection
// share, so a projected condition is exactly the one the pass writes. Pure.
export function applyShipWear(piece: EquipmentInstance, w: ShipUseWear, at: number): EquipmentInstance {
  const used = applyUseWear(piece, shipPieceUseRaw(piece, w), at);
  return w.battle ? applyBattleWearAt(used, w.battle[piece.id] ?? 0, at) : used;
}

// ONE member event on a member piece at `at`: its use wear, then (step 4) the armor's battle wear. Pure.
export function applyMemberWear(piece: EquipmentInstance, w: MemberUseWear, at: number): EquipmentInstance {
  const used = applyUseWear(piece, memberPieceUseRaw(piece, w), at);
  return piece.slotType === "memberArmor" && w.divePieceId === undefined && (w.armor ?? 0) > 0 ? applyBattleWearAt(used, w.armor ?? 0, at) : used;
}

// GEAR WEAR step 4: THE NEXT PATROL CYCLE'S FROZEN GEAR (user W3; design 6.1 cycleStartCondition). The ship's pieces
// as they stand at `at` (a relaunch instant inside the call): each stored piece settled at the underway `rate` and worn
// by `events` up to `at` in order (exactly what the tail pass writes for the same events), then settled to `at` without
// writing. The worn ones, piece id -> per-mille. Pure.
// Pause to repair: `windows` (a paused patrol's home repair windows) settle at `windowRate`, as the tail pass does.
export function projectCycleConditions(
  pieces: readonly EquipmentInstance[],
  events: readonly TimedWear<ShipUseWear>[],
  at: number,
  rate: number,
  windows: readonly RepairWindow[] = [],
  windowRate: number = rate,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const piece of pieces) {
    // (the close-out's exact walk, as the tail pass walks it; every piece here is the ship's own, so a pause's Overtime
    // acts on it)
    const walk = scheduledWalker(rate, windows, windowRate);
    let p = piece;
    for (const ev of events) if (ev.at <= at) p = applyShipWear(walk(p, ev.at), ev.wear, ev.at);
    const c = pieceCondition(walk(p, at));
    if (c < CONDITION_FULL) out[piece.id] = c;
  }
  return out;
}

// The empty use of a ship event that carries only battle wear or a Damage Control Suite fire (step 4).
export function battleOnlyWear(battle: Readonly<Record<string, number>> | undefined, damageControlFires = 0): ShipUseWear {
  return { ...NO_SHIP_USE, crewed: false, ...(damageControlFires > 0 ? { damageControlFires } : {}), ...(battle && Object.keys(battle).length > 0 ? { battle } : {}) };
}

// ============================================================================
// The repair contexts
// ============================================================================

export interface RepairContextIndex {
  readonly out: ReadonlySet<string>; // ships out on a run (a captain mission, a patrol, a short-range run, an expedition)
  readonly bay: ReadonlySet<string>; // ships in a Shipyard repair bay
  readonly field: ReadonlySet<string>; // ships set down on a field repair leg right now (readouts; the pass reads windows)
  readonly memberShip: ReadonlyMap<string, string | null>; // member id -> the ship they are assigned to
  // WR-7 follow-up (OC-D5): ships out on a captain run stamped with the favored spec (favoredSpec === 1). A ship out on
  // a run NOT in this set (an unstamped run, an expedition) reads its Damage Control Suite as stored (shipRepairBonuses).
  readonly favoredRun: ReadonlySet<string>;
  // Complement CP-13 (OC-13): ships out on a captain run stamped with the hull-family stamp (hullBonus === 1). A ship out
  // on a run NOT in this set reads its crew's repair speed without the quarters' division lift (shipRepairBonuses).
  readonly hullBonusRun: ReadonlySet<string>;
  // GEAR WEAR close-out: ships whose Repeat patrol is paused to repair (home, repairing: its pieces' live reads and the
  // Overtime strip), with the pause. Still `out` for the call-by-call pass (the pause's window settles as it closes).
  readonly paused: ReadonlyMap<string, RepairPauseRecord>;
}

export type RepairPauseRecord = NonNullable<PatrolMissionState["repairPause"]>;

// Where every ship is at `state.gameTimeSeconds`, for the repair contexts. Pure.
export function repairContextIndex(state: GameState): RepairContextIndex {
  const t = state.gameTimeSeconds;
  const out = new Set<string>();
  const favoredRun = new Set<string>();
  const hullBonusRun = new Set<string>();
  const paused = new Map<string, RepairPauseRecord>();
  for (const ship of state.ships) {
    if (ship.assignedCaptainId === null) continue;
    const captain = state.captains.find((c) => c.id === ship.assignedCaptainId);
    if (captain && captain.mission !== null) {
      out.add(ship.id);
      if ((captain.mission as { favoredSpec?: unknown }).favoredSpec === 1) favoredRun.add(ship.id);
      if ((captain.mission as { hullBonus?: unknown }).hullBonus === 1) hullBonusRun.add(ship.id);
      if (captain.mission.kind === "patrol" && captain.mission.repairPause !== undefined) paused.set(ship.id, captain.mission.repairPause);
    }
  }
  // A ship on an expedition is underway for the whole run, its field repair legs included: those settle at the field
  // rate when the run comes home, in event order with its wear (fieldWindows), never call by call, so a leg repairs
  // the run's own wear however the span is chunked.
  const field = new Set<string>();
  for (const exp of state.expeditions) {
    if (exp.phase === "complete") continue;
    out.add(exp.shipId);
    if ((exp.groundOps?.repairLegs ?? []).some((leg) => leg.arrivesAt <= t && t < leg.repairedAt)) field.add(exp.shipId);
  }
  const bay = new Set<string>();
  for (const p of state.activeProcesses) if (p.kind === "shipRepair" && p.effect.type === "clearShipDamage") bay.add(p.effect.shipId);
  // GEAR WEAR close-out ("Keep the bay rate"): a docked ship whose hull left the bay with its gear worn keeps the bay rate.
  if (GEAR_BAY_RATE_KEPT_SWITCH.live) for (const ship of state.ships) if (ship.gearBayRate === 1 && !out.has(ship.id)) bay.add(ship.id);
  const memberShip = new Map<string, string | null>();
  for (const m of state.awayMembers) memberShip.set(m.id, m.assignedShipId ?? null);
  return { out, bay, field, memberShip, favoredRun, hullBonusRun, paused };
}

// The ship a piece rides with: its own ship, or its member's. null = in storage (a spare, an Armory piece). Pure.
function pieceShipId(index: RepairContextIndex, piece: EquipmentInstance): string | null {
  if (piece.fittedToShipId) return piece.fittedToShipId;
  if (piece.fittedToMemberId) return index.memberShip.get(piece.fittedToMemberId) ?? null;
  return null;
}

// A piece's repair context for the call-by-call pass (design 5.1): an expedition's field repair legs are underway here
// and settle at the field rate as the run comes home (settleScheduled with its windows). Pure.
export function pieceRepairContext(index: RepairContextIndex, piece: EquipmentInstance): RepairContext {
  const shipId = pieceShipId(index, piece);
  if (shipId === null) return "home";
  if (index.out.has(shipId)) return "underway";
  if (index.bay.has(shipId)) return "shipyardBay";
  return "home";
}

type RepairBonuses = Partial<Record<RepairRateBonus, number>>;

// A ship's two hull repair bonuses as every gear repair rate on it reads them (REPAIR_RATE_BONUSES): the hull repair's
// own speed bonus (as tick.ts shipyardRepairSpeedBonus reads it: officers, crew and captain) and the installed Damage
// Control Suite's time reduction. Pure.
// WR-7 follow-up (OC-D5): `favored` is whether the suite reads its favored-spec lines on a Tactician hull (model.ts
// withFavoredLines). A run reads them only when stamped (favoredSpec): a patrol's wear clock passes its run's stamp
// (dispatch and every relaunch) and the tail pass the same stamp (pieceRepairRate, RepairContextIndex.favoredRun), so an
// unstamped run in flight repairs exactly as before. A ship on no run reads the suite as it stands (favored).
// Complement CP-13 (OC-13): `hullBonus` likewise, whether the crew's repair speed reads the quarters module's division
// lift (index.hullBonusRun: an unstamped run in flight repairs exactly as before). Defaults to true (a fresh reading).
export function shipRepairBonuses(state: GameState, ship: ShipInstance, favored: boolean, hullBonus = true): RepairBonuses {
  const installed = equippedFor(state, ship.id);
  return {
    officerRepairSpeed: withCaptainRepair(shipRepairSpeedBonus(state, ship, hullBonus), shipCaptainCombatMods(state, ship)),
    damageControlRepairTime: damageControlEffect(favored ? withFavoredLines(installed, ship.typeKey) : installed).repairTimeReduction,
  };
}

// The rate a piece repairs at in `context` (per-mille a minute): the context's free rate lifted by its ship's hull
// repair bonuses, the same algebra as the hull repair. A piece in storage takes no bonus. Pure (the cache is the
// caller's, per call).
// WR-7 follow-up (OC-D5): a ship out on a run reads its suite on the run's favored-spec stamp (index.favoredRun); a ship
// on no run, and `postRun` (the context a run that ended within the call hands its pieces to), as it stands, so the
// span after a run ends repairs alike in one call or many.
export function pieceRepairRate(
  state: GameState,
  index: RepairContextIndex,
  piece: EquipmentInstance,
  context: RepairContext,
  cache?: Map<string, RepairBonuses>,
  postRun = false,
): number {
  const shipId = pieceShipId(index, piece);
  if (shipId === null) return repairRatePerMinute(context);
  const favored = postRun || !index.out.has(shipId) || index.favoredRun.has(shipId);
  // Complement CP-13: the same rule for the hull-family stamp.
  const hullBonus = postRun || !index.out.has(shipId) || index.hullBonusRun.has(shipId);
  const key = `${favored ? `${shipId}|favored` : shipId}${hullBonus ? "|hull" : ""}`;
  let bonuses = cache?.get(key);
  if (bonuses === undefined) {
    const ship = state.ships.find((s) => s.id === shipId);
    bonuses = ship ? shipRepairBonuses(state, ship, favored, hullBonus) : {};
    cache?.set(key, bonuses);
  }
  const rate = repairRatePerMinute(context, bonuses);
  // GEAR WEAR step 5, Overtime on gear repair: a docked ship's own installed pieces repair faster by its bought steps.
  // Never a ship out on a run (the record is inert there and clears at the call's tail), never the span after a run
  // ended within the call (postRun: the ship could not have bought it while out), never member gear or storage.
  if (postRun || piece.fittedToShipId !== shipId || index.out.has(shipId) || (context !== "home" && context !== "shipyardBay")) return rate;
  return rate * gearOvertimeMult(state, shipId);
}

// ============================================================================
// GEAR WEAR step 5: Overtime on gear repair (processSpeed.ts buyGearRepairOvertime), the engine's read
// ============================================================================

const OVERTIME_MULT_CACHE = new WeakMap<readonly ShipInstance[], Map<string, number>>();

// The repair rate multiplier a ship's bought Overtime steps give its docked gear (1 without a record). Pure (cached per
// ships array, which every state change replaces).
export function gearOvertimeMult(state: Pick<GameState, "ships">, shipId: string): number {
  let byShip = OVERTIME_MULT_CACHE.get(state.ships);
  if (byShip === undefined) {
    byShip = new Map();
    for (const s of state.ships) {
      const steps = s.gearRepairSpeed?.overtimeSteps ?? 0;
      if (steps > 0) byShip.set(s.id, overtimeRate(steps));
    }
    OVERTIME_MULT_CACHE.set(state.ships, byShip);
  }
  return byShip.get(shipId) ?? 1;
}

// A ship's INSTALLED pieces that are worn right now (livePieceCondition below full). Pure.
export function shipWornPieces(state: GameState, shipId: string): EquipmentInstance[] {
  return state.equipment.filter((p) => p.fittedToShipId === shipId && p.condition !== undefined && livePieceCondition(state, p) < CONDITION_FULL);
}

// Where a piece is recovering and how fast, for the readouts (the gear card, the ship header, the fleet care line) and
// the Overtime price. `context` is the display context ("fieldRepair" while its ship is set down on a GO-8b leg right
// now; "home" while its Repeat patrol is paused to repair); `ratePerMinute` the rate it repairs at now (Overtime
// included); `minutesToFull` the minutes until it is back to full where it is (a docked ship in a Shipyard bay: at the
// bay rate, which its gear keeps until full, user 2026-11-11 "Keep the bay rate"; a paused patrol: at the home rate, or
// null when the patrol heads back out first), null while its ship is out on a run (it repairs slowly underway and
// fully once home). `pauseMinutesLeft`: a paused patrol's minutes until it heads back out. `normal` reads the rates
// WITHOUT Overtime (the Overtime price: the job's size at the normal rate). Pure.
export interface GearRepairOutlook {
  condition: number;
  context: RepairContext;
  ratePerMinute: number;
  minutesToFull: number | null;
  pauseMinutesLeft?: number;
}

// A ship's Repeat patrol paused to repair right now (its pause), or null. Pure.
export function pausedPatrolOf(state: GameState, shipId: string): RepairPauseRecord | null {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship || ship.assignedCaptainId === null) return null;
  const m = state.captains.find((c) => c.id === ship.assignedCaptainId)?.mission;
  return m && m.kind === "patrol" && m.repairPause !== undefined ? m.repairPause : null;
}

// GEAR WEAR close-out (user 2026-11-11 "Allow Overtime in pauses"): the whole ticks a paused patrol's pause needs from
// now for every combat piece installed on the ship (REPAIR_PAUSE_SLOTS, what the pause waits on) to be back to full at
// the home rate with `steps` of Overtime: each piece settled to now through the pause, its banked fraction carried to
// the new rate, its seconds to full counted in the settle's own integers (gearWear.ts secondsToFull), so the patrol
// heads out on the tick its gear is full. At least 1; null when the ship is not paused. Pure.
export function pauseResumeTicks(state: GameState, shipId: string, steps: number): number | null {
  if (pausedPatrolOf(state, shipId) === null) return null;
  const index = repairContextIndex(state);
  const now = state.gameTimeSeconds;
  const mult = steps > 0 ? overtimeRate(steps) : 1;
  let most = 0;
  for (const piece of state.equipment) {
    if (piece.fittedToShipId !== shipId || piece.condition === undefined || !REPAIR_PAUSE_SLOTS.has(piece.slotType)) continue;
    const live = settlePieceNow(state, index, piece);
    const rate = pieceRepairRate(state, index, piece, "home") * mult;
    most = Math.max(most, secondsToFull(rebaseAnchor(live.piece, now, live.rate, rate), now, rate));
  }
  return Math.max(1, Math.ceil(most / state.tickDurationSeconds));
}

// A paused patrol's Overtime multiplier on its own installed pieces right now (the last step bought in the pause). Pure.
export function pauseOvertimeMult(pause: RepairPauseRecord): number {
  const steps = pause.overtime?.at(-1)?.steps ?? 0;
  return steps > 0 ? overtimeRate(steps) : 1;
}

export function gearRepairOutlook(state: GameState, piece: EquipmentInstance, normal = false): GearRepairOutlook {
  const index = repairContextIndex(state);
  const condition = pieceCondition(settlePieceNow(state, index, piece).piece);
  const base = pieceRepairContext(index, piece);
  const shipId = pieceShipId(index, piece);
  // GEAR WEAR close-out: a Repeat patrol paused to repair is home, repairing at the home rate (its Overtime on its own
  // installed pieces), until the pause ends.
  const pause = shipId !== null ? index.paused.get(shipId) : undefined;
  if (pause !== undefined) {
    const mult = !normal && piece.fittedToShipId === shipId ? pauseOvertimeMult(pause) : 1;
    const ratePerMinute = pieceRepairRate(state, index, piece, "home") * mult;
    const pauseMinutesLeft = (pause.ticksRemaining * state.tickDurationSeconds) / 60;
    const need = CONDITION_FULL - condition;
    if (need <= 0) return { condition, context: "home", ratePerMinute, minutesToFull: 0, pauseMinutesLeft };
    const minutes = ratePerMinute > 0 ? need / ratePerMinute : Infinity;
    return { condition, context: "home", ratePerMinute, minutesToFull: minutes <= pauseMinutesLeft ? minutes : null, pauseMinutesLeft };
  }
  const context: RepairContext = base === "underway" && shipId !== null && index.field.has(shipId) ? "fieldRepair" : base;
  const strip = (rate: number): number => (normal && shipId !== null ? rate / (piece.fittedToShipId === shipId && !index.out.has(shipId) ? gearOvertimeMult(state, shipId) : 1) : rate);
  const ratePerMinute = strip(pieceRepairRate(state, index, piece, context));
  const need = CONDITION_FULL - condition;
  if (need <= 0) return { condition, context, ratePerMinute, minutesToFull: 0 };
  if (context === "underway" || context === "fieldRepair" || !(ratePerMinute > 0)) return { condition, context, ratePerMinute, minutesToFull: null };
  // GEAR WEAR close-out ("Keep the bay rate"): the gear keeps the bay rate until it is full, whenever the hull leaves.
  if (context === "shipyardBay" && shipId !== null && !GEAR_BAY_RATE_KEPT_SWITCH.live) {
    const repair = state.activeProcesses.find((p) => p.kind === "shipRepair" && p.effect.type === "clearShipDamage" && p.effect.shipId === shipId);
    const bayMinutes = repair ? (repair.remainingTicks * state.tickDurationSeconds) / 60 : Infinity;
    if (need <= ratePerMinute * bayMinutes) return { condition, context, ratePerMinute, minutesToFull: need / ratePerMinute };
    const homeRate = strip(pieceRepairRate(state, index, piece, "home"));
    return { condition, context, ratePerMinute, minutesToFull: bayMinutes + (need - ratePerMinute * bayMinutes) / homeRate };
  }
  return { condition, context, ratePerMinute, minutesToFull: need / ratePerMinute };
}

// The pieces of a docked ship settled to now at the rate they repair at now, then re-anchored for a NEW Overtime
// multiplier (rebaseAnchor: the fraction of a per-mille the old rate banked carries over at the new rate), so a
// purchase changes the rate from this instant on and never repairs time already spent. Pure.
export function settleShipForRateChange(state: GameState, shipId: string, newMult: number): GameState {
  const index = repairContextIndex(state);
  const now = state.gameTimeSeconds;
  const oldMult = gearOvertimeMult(state, shipId);
  let changed = false;
  const equipment = state.equipment.map((piece) => {
    if (piece.fittedToShipId !== shipId || piece.condition === undefined) return piece;
    const rate = pieceRepairRate(state, index, piece, pieceRepairContext(index, piece));
    const settled = settlePiece(piece, now, rate);
    const p = rebaseAnchor(settled, now, rate, (rate / oldMult) * newMult);
    if (p !== piece) changed = true;
    return p;
  });
  return changed ? { ...state, equipment } : state;
}

// The full length of a ship's docked gear repair job right now, in minutes at the NORMAL rate (no Overtime): the time
// its slowest worn installed piece needs where it is. 0 with nothing worn; null while the ship is out on a run. Pure.
export function shipGearJobMinutes(state: GameState, shipId: string): number | null {
  let most = 0;
  for (const piece of shipWornPieces(state, shipId)) {
    const m = gearRepairOutlook(state, piece, true).minutesToFull;
    if (m === null) return null;
    most = Math.max(most, m);
  }
  return most;
}

// THE DOCKED GEAR REPAIR JOB (user 2026-11-09 "Match the existing rule": Overtime is priced by the job's FULL length,
// fixed when bought): at the call's tail each docked ship with worn installed gear and no record gets one, its full
// length at the normal rate (ShipInstance.gearRepairJobMinutes), read at the call's START when the ship was docked and
// worn then (the call after a run came home, a worn piece installed between ticks, a save loaded docked and worn: the
// job starts there, so one call, chunks and 1 s steps record the same length), else at its end (a docked piece worn
// within the call). A ship out at the call's start or end has no job (it starts the next call). The job and any Overtime on it end once the
// ship is out on a run (at the call's start or end) or none of its installed pieces is worn any more. A ship docked the
// whole call only ever recovers, so clearing at any call boundary after it is full changes no piece (offline == live).
// Pure.
// The test-only seam golden files captured before the job record use to tick as before it (gearRepairJobSwitch.fixture
// .ts): off, no job is recorded (Overtime still clears as before). Live in the game.
export const GEAR_REPAIR_JOB_SWITCH = { live: true };

// GEAR WEAR close-out: two more records ride the same tail.
//   - "Keep the bay rate" (GEAR_BAY_RATE_KEPT_SWITCH): a ship that was in a Shipyard bay at the call's start, whose hull
//     repair is gone by its end, docked with its installed gear still worn, is marked (ShipInstance.gearBayRate) and
//     keeps the bay rate while it stays docked and worn. The call the hull leaves in settles at the bay rate (the
//     context it started in), so one call, chunks and 1 s steps agree.
//   - "Allow Overtime in pauses": a Repeat patrol paused to repair at the call's start and end keeps its Overtime record
//     while its installed gear is worn (the pause record holds the rates the engine reads, pauseRepairWindows) and
//     records no job (the pause is the job: processSpeed.ts gearRepairJobMinutes). The call it resumes in clears both.
function trackGearRepairJobs(before: GameState, state: GameState, index: RepairContextIndex, indexAfter: RepairContextIndex): GameState {
  const worn = new Set<string>();
  for (const p of state.equipment) if (p.fittedToShipId && p.condition !== undefined) worn.add(p.fittedToShipId);
  if (worn.size === 0 && !state.ships.some((s) => s.gearRepairSpeed !== undefined || s.gearRepairJobMinutes !== undefined || s.gearBayRate !== undefined)) return state;
  let wornBefore: Set<string> | null = null;
  let changed = false;
  let hullInBay: Set<string> | null = null;
  const ships = state.ships.map((s0) => {
    const docked = !index.out.has(s0.id) && !indexAfter.out.has(s0.id) && worn.has(s0.id);
    let s = s0;
    if (GEAR_BAY_RATE_KEPT_SWITCH.live && (s.gearBayRate !== undefined || (docked && index.bay.has(s.id)))) {
      if (hullInBay === null) {
        hullInBay = new Set<string>();
        for (const p of state.activeProcesses) if (p.kind === "shipRepair" && p.effect.type === "clearShipDamage") hullInBay.add(p.effect.shipId);
      }
      const keep = docked && (s.gearBayRate === 1 || (index.bay.has(s.id) && !hullInBay.has(s.id)));
      if (keep && s.gearBayRate !== 1) {
        s = { ...s, gearBayRate: 1 };
        changed = true;
      } else if (!keep && s.gearBayRate !== undefined) {
        const { gearBayRate: _b, ...rest } = s;
        s = rest as ShipInstance;
        changed = true;
      }
    }
    // (the SAME pause at both ends: a call that resumed and paused again has left on a run in between)
    if (index.paused.has(s.id) && index.paused.get(s.id)?.from === indexAfter.paused.get(s.id)?.from) {
      // (only while the pause itself carries Overtime steps: with the docked carry-over off, a dispatch's record clears)
      const keepOvertime = worn.has(s.id) && s.gearRepairSpeed !== undefined && (index.paused.get(s.id)?.overtime?.length ?? 0) > 0;
      if (s.gearRepairJobMinutes === undefined && (keepOvertime || s.gearRepairSpeed === undefined)) return s;
      changed = true;
      const { gearRepairSpeed: ot, gearRepairJobMinutes: _j, ...rest } = s;
      return (keepOvertime ? { ...rest, gearRepairSpeed: ot } : rest) as ShipInstance;
    }
    if (!docked) {
      if (s.gearRepairSpeed === undefined && s.gearRepairJobMinutes === undefined) return s;
      changed = true;
      const { gearRepairSpeed: _ot, gearRepairJobMinutes: _j, ...rest } = s;
      return rest as ShipInstance;
    }
    if (s.gearRepairJobMinutes !== undefined || !GEAR_REPAIR_JOB_SWITCH.live) return s;
    if (wornBefore === null) {
      wornBefore = new Set<string>();
      for (const p of before.equipment) if (p.fittedToShipId && p.condition !== undefined) wornBefore.add(p.fittedToShipId);
    }
    const from = wornBefore.has(s.id) ? before : state;
    const minutes = shipGearJobMinutes(from, s.id) ?? shipGearJobMinutes(state, s.id) ?? 0;
    changed = true;
    return { ...s, gearRepairJobMinutes: minutes };
  });
  return changed ? { ...state, ships } : state;
}

// GEAR WEAR step 4 fix (design 7, "rate constant between anchors"): a piece settled to `at` at `oldRate` keeps the
// time it has not yet turned into a whole per-mille (settlePiece carries the leftover by leaving its anchor behind).
// Before it settles on at `newRate`, that leftover is re-expressed as the same FRACTION of a per-mille at the new rate.
// Without it a run ending into a faster context (underway, 2 a minute, into home or a Shipyard bay) repaired the whole
// leftover underway time at the faster rate. GEAR WEAR step 5 fix C1: in integers, the bank banked by `at` at the old
// rate (decodeRepairAnchor) is kept as is (a fraction of a per-mille does not depend on the rate) and the anchor is
// re-encoded from it at the new rate, at - bank / newRateQ (the same instant the old float arithmetic gave). A pristine
// piece, an anchor at or after `at`, or no rate change returns the piece as it is. Pure.
export function rebaseAnchor(piece: EquipmentInstance, at: number, oldRate: number, newRate: number): EquipmentInstance {
  if (piece.condition === undefined || piece.conditionAt === undefined || !(newRate > 0) || oldRate === newRate) return piece;
  const p = settlePiece(piece, at, oldRate);
  if (p.condition === undefined || p.conditionAt === undefined || !(at > p.conditionAt)) return p;
  const oldQ = repairRateQ(oldRate);
  const newQ = repairRateQ(newRate);
  if (oldQ <= 0 || newQ <= 0) return p;
  const { at: from, bank } = decodeRepairAnchor(p.conditionAt, oldQ);
  const banked = bank + oldQ * (at - from);
  return { ...p, conditionAt: encodeRepairAnchor(at, banked, newQ) };
}

// A piece's condition RIGHT NOW without writing it (the UI and the readouts, design 7 "reads compute condition
// without writing"): settled from its anchor at its current context's rate. Pure.
export function livePieceCondition(state: GameState, piece: EquipmentInstance): number {
  if (piece.condition === undefined) return pieceCondition(piece);
  return pieceCondition(settlePieceNow(state, repairContextIndex(state), piece).piece);
}

// A piece settled to now without writing, exactly as the tail pass will write it (the live reads, the Overtime quote
// and the recall of a paused patrol), and the rate its anchor is then encoded at (the rate in force now): an
// expedition's field repair legs at the field rate; GEAR WEAR close-out, a Repeat patrol paused to repair at the home
// rate from the pause's start (its Overtime steps on the ship's own installed pieces), so the bar is live through the
// pause and never jumps when it closes. Pure.
export function settlePieceNow(state: GameState, index: RepairContextIndex, piece: EquipmentInstance): { piece: EquipmentInstance; rate: number } {
  const now = state.gameTimeSeconds;
  const rate = pieceRepairRate(state, index, piece, pieceRepairContext(index, piece));
  if (piece.condition === undefined) return { piece, rate };
  const shipId = pieceShipId(index, piece);
  const pause = shipId === null ? undefined : index.paused.get(shipId);
  let windows: RepairWindow[] | undefined;
  let windowRate = rate;
  if (pause !== undefined) {
    windows = pauseRepairWindows(pause, now);
    windowRate = pieceRepairRate(state, index, piece, "home");
  } else {
    const exp = shipId === null ? undefined : state.expeditions.find((e) => e.shipId === shipId && e.phase !== "complete");
    windows = exp ? expeditionFieldWindows(exp, now) : undefined;
    windowRate = pieceRepairRate(state, index, piece, "fieldRepair");
  }
  if (!windows || windows.length === 0) return { piece: settlePiece(piece, now, rate), rate };
  const own = piece.fittedToShipId === shipId;
  if (!REPAIR_EXACT_EDGES_SWITCH.live) return { piece: settleScheduledLegacy(piece, now, rate, windows, windowRate, own), rate };
  return settleWalk(piece, -Infinity, now, rate, windows, windowRate, own);
}

// GEAR WEAR close-out ("Make it exact", and the bar never jumps): a Repeat patrol recalled during its repair pause ends
// at once (tick.ts recallCaptain), docked. Its pieces are settled to now through the pause (as the live read shows them)
// and their banked fraction re-expressed at the docked rate they settle at from here, so the underway time before the
// pause is never credited at the home rate. `before` holds the paused run, `after` the run ended. Off
// (REPAIR_EXACT_EDGES_SWITCH), `after` as it is. Pure.
export function settleRecalledPause(before: GameState, after: GameState, shipId: string): GameState {
  if (!REPAIR_EXACT_EDGES_SWITCH.live) return after;
  const index = repairContextIndex(before);
  if (!index.paused.has(shipId)) return after;
  const indexAfter = repairContextIndex(after);
  const now = before.gameTimeSeconds;
  let changed = false;
  const equipment = after.equipment.map((piece) => {
    if (piece.condition === undefined || pieceShipId(index, piece) !== shipId) return piece;
    const live = settlePieceNow(before, index, piece);
    const p = rebaseAnchor(live.piece, now, live.rate, pieceRepairRate(after, indexAfter, piece, pieceRepairContext(indexAfter, piece)));
    if (p !== piece) changed = true;
    return p;
  });
  return changed ? { ...after, equipment } : after;
}

// ============================================================================
// THE PASS (economyTick's tail, once per call)
// ============================================================================

// Settle and wear every piece for the call from `before` (the incoming state: where each piece was) to `after` (the
// call's result, at after.gameTimeSeconds), applying the use events the call recorded at their own instants. See the
// header for the rules. The SAME `after` reference when nothing changed. Pure.
export function resolveGearWear(before: GameState, after: GameState, events: GearWearEvents | null): GameState {
  const hasEvents = events !== null && (events.ships.size > 0 || events.members.size > 0);
  if (!hasEvents && !after.equipment.some((p) => p.condition !== undefined)) {
    // GEAR WEAR step 5: a ship's gear repair job and its Overtime end once nothing on it is worn (or it left on a run).
    return after.ships.some((s) => s.gearRepairSpeed !== undefined || s.gearRepairJobMinutes !== undefined || s.gearBayRate !== undefined)
      ? trackGearRepairJobs(before, after, repairContextIndex(before), repairContextIndex(after))
      : after;
  }
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
    // An expedition that came home: its field repair legs, at the field rate, in order with its wear.
    const shipId = pieceShipId(index, piece);
    const field = shipId !== null ? events?.fieldWindows.get(shipId) : undefined;
    // Pause to repair: a paused patrol's home windows settle at the home rate (same split as a field repair leg).
    const pause = shipId !== null && !field ? events?.pauseWindows.get(shipId) : undefined;
    const windows = field ?? pause;
    const fieldRate = field ? pieceRepairRate(before, index, piece, "fieldRepair", bonuses) : pause ? pieceRepairRate(before, index, piece, "home", bonuses) : rate;
    let p = piece;
    // Ship and member events in one time order (a member's dive lands mid-run, between its ship's slices).
    const timed: { at: number; apply: (x: EquipmentInstance) => EquipmentInstance }[] = [
      ...(shipWear ?? []).map((ev) => ({ at: ev.at, apply: (x: EquipmentInstance) => applyShipWear(x, ev.wear, ev.at) })),
      ...(memberWear ?? []).map((ev) => ({ at: ev.at, apply: (x: EquipmentInstance) => applyMemberWear(x, ev.wear, ev.at) })),
    ];
    timed.sort((a, b) => a.at - b.at);
    // (the close-out's exact walk on a stamped run: a window is entered and left once, its edges credited at the rate
    // that applied; a pause's Overtime only on the ship's own installed pieces)
    const exact = REPAIR_EXACT_EDGES_SWITCH.live && shipId !== null && events !== null && events.exactRuns.has(shipId);
    const walk = scheduledWalker(rate, windows, fieldRate, shipId !== null && piece.fittedToShipId === shipId, exact);
    for (const ev of timed) p = ev.apply(walk(p, ev.at));
    if (context === "underway") {
      if (contextAfter !== "underway") {
        // The run ended within the call: underway (and its field legs) up to the instant it ended, then the new
        // context to the call's end.
        const end = Math.min(now, (shipId !== null ? events?.runEnds.get(shipId) : undefined) ?? now);
        // WR-7 follow-up (OC-D5): the new context reads the ship off its run (postRun), as the next call would.
        const afterRate = pieceRepairRate(before, index, piece, contextAfter, bonuses, true);
        p = walk(p, end);
        // GEAR WEAR step 4: on a step 4 stamped run the fraction of a per-mille the slow underway rate banked by the end
        // carries into the new context at ITS rate (rebaseAnchor), so the new rate never repairs time spent underway.
        // GEAR WEAR close-out (user 2026-11-11 "Make it exact"): on every stamped run (a captain mission, a short-range
        // run, an expedition), not only a step 4 one.
        if (shipId !== null && (exact || events?.rateCarry.has(shipId))) p = rebaseAnchor(p, end, rate, afterRate);
        p = settlePiece(p, now, afterRate);
      }
    } else {
      p = settlePiece(p, now, rate);
    }
    if (p !== piece) changed = true;
    return p;
  });
  // GEAR WEAR step 5: and a docked ship's gear repair job starts or ends (its Overtime with it).
  return trackGearRepairJobs(before, changed ? { ...after, equipment } : after, index, indexAfter);
}
