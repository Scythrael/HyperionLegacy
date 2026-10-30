// G1-3 (Short-Range Missions, docs/plans/2026-10-17-short-range-missions-plan.md section 4 G1-3, both USER ANSWERS
// sections and docs/plans/2026-10-19-merge-batch-answers.md): the BOARD, DISPATCH and RECALL engine.
//
// What the user decided:
// - Slots come from Mission Control upgrades (call 8, 2026-10-17 "Mission Control upgrades (Recommended)"): two Tier I
//   slots from the start, a Tier II slot at Mission Control level 2 (the kept 50-completion hook), a fourth at level 3
//   (model.ts MISSION_CONTROL_BOARD_RUNGS, hidden from players until SHORT_RANGE_BOARD_LIVE, G1-6).
// - A captain and their hull take a slot, through the same picker as captain missions (call 16); the captain is busy
//   while the slot runs, and the ship is crew-locked like any mission (crewLock.ts reads captain.mission).
// - The whole job re-rolls every cycle (call 1), so a template's training run is decided by its per-template
//   `dispatched` count, bumped at every cycle START of that template (startShortRangeCycle, shared with G1-4's cycle
//   engine). Two slots can both draw an untried template; each roll reads the counters as they stand at its start.
// - Home unload occupies a transit berth on the captain-mission rules (call 18): berths.ts reads the frozen plan.
// - Recall finishes the current cycle, then stops (tick.ts recallCaptain).
//
// NOT here: the cycle itself (phases, re-roll at each cycle start, rewards, XP, idles: G1-4, shortRangeCycle.ts) and
// every screen (G1-6).
//
// Pure: every function reads state and returns verdicts or new states; no draws outside the roll's own stream, no
// clock, never the shared economy rng.

import { MISSION_CONTROL_BOARD_RUNGS, favoredSpecStamp, type CaptainState, type GameState, type RunWearStamp, type ShipInstance, type ShortRangeBoardState, type ShortRangeMissionState, type ShortRangePhase, type RunCounts } from "./model";
import {
  SHORT_RANGE_TEMPLATES,
  meetsSheet,
  rollShortRangeJob,
  shortRangeCyclePlan,
  shortRangeShipEngineering,
  type ShortRangeCategory,
  type ShortRangeCyclePlan,
  type ShortRangeRoll,
  type ShortRangeSlotRef,
  type ShortRangeTier,
} from "./shortRange";
import { runShipStats, runWearStamp } from "./gearWearEngine";
import { countShortRangeCycleStart, runCountsOf } from "./runDifficulty";
import { crewLockReasonText, shipCrewLocked } from "./crewLock";
import { RELIC_BLANKS_VERSION, RELIC_STAGGER_VERSION, newRunRelicBlanksFlag } from "./relicBlanks";
import { newReactorLiftFlag, reactorLiftFlagged } from "./reactorSurplus";
import { crewModuleLinesStamp } from "./crewModules";
import { equippedFor } from "./equipmentQueries";

// ===== the board =====

// The slots every save starts with, by tier (call 8: "Two Tier I slots from the start"). Slot ids are positions on
// the board (0, 1, then one per reached Mission Control board rung), stable forever: a slot id keys its roll stream.
export const SHORT_RANGE_BASE_SLOT_TIERS: readonly ShortRangeTier[] = [1, 1];

// The board's slots right now: the base slots, then one per reached Mission Control board rung (rung i is reached at
// Mission Control level i + 2, so level 2 opens the third slot and level 3 the fourth). DERIVED from the facility
// level on every read, never stored (plan 3.6). A missing or malformed level opens only the base slots. Pure.
export function shortRangeBoardSlots(state: Pick<GameState, "facilities">): ShortRangeSlotRef[] {
  const slots: ShortRangeSlotRef[] = SHORT_RANGE_BASE_SLOT_TIERS.map((tier, id) => ({ id, tier }));
  const raw = state.facilities?.missionControl?.level;
  const level = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 0;
  MISSION_CONTROL_BOARD_RUNGS.forEach((rung, i) => {
    const effect = rung.effect;
    if (level >= i + 2 && "addShortRangeSlot" in effect) slots.push({ id: slots.length, tier: effect.addShortRangeSlot });
  });
  return slots;
}

// One slot by id, or null when the board has no such slot (yet). Pure.
export function shortRangeSlotById(state: Pick<GameState, "facilities">, slotId: number): ShortRangeSlotRef | null {
  return shortRangeBoardSlots(state).find((s) => s.id === slotId) ?? null;
}

function isWholeCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

// The stored board's shape check (save.ts hydration drops a malformed one: it then reads as every slot at cycle 0).
// Pure.
export function isWellFormedShortRangeBoard(v: unknown): v is ShortRangeBoardState {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  const next = b.nextCycle;
  return (
    b.version === 1 &&
    !!next && typeof next === "object" && !Array.isArray(next) &&
    Object.entries(next as Record<string, unknown>).every(([k, n]) => isWholeCount(Number(k)) && isWholeCount(n))
  );
}

// The cycle index a slot's NEXT roll reads (0 for a slot that never delivered, and for any save without a board).
// Advanced only by a delivered cycle (G1-4, shortRangeCycle.ts). Pure.
export function shortRangeNextCycle(state: Pick<GameState, "shortRangeBoard">, slotId: number): number {
  const board = state.shortRangeBoard;
  if (!isWellFormedShortRangeBoard(board)) return 0;
  return board.nextCycle[slotId] ?? 0;
}

// The captain flying `slotId`, or null when the slot is free. One captain per slot. Pure.
export function shortRangeSlotOccupant(state: Pick<GameState, "captains">, slotId: number): CaptainState | null {
  return state.captains.find((c) => c.mission !== null && c.mission.kind === "shortRange" && c.mission.slotId === slotId) ?? null;
}

// What a free slot will ask next, shown on the board before dispatch (plan 3.1): the roll at its next cycle index,
// against the counters as they stand now. A dispatch in between (of the same template, elsewhere) can turn a
// training-run preview into a regular roll; the roll at dispatch is always read fresh. Pure.
export function shortRangeSlotPreview(state: GameState, slot: ShortRangeSlotRef): ShortRangeRoll {
  return rollShortRangeJob(state, slot, shortRangeNextCycle(state, slot.id));
}

// ===== the cycle start (shared with the cycle engine) =====

export interface ShortRangeCycleStart {
  roll: ShortRangeRoll;
  plan: ShortRangeCyclePlan;
  runCounts: RunCounts;
}

// THE cycle-start seam: roll `slot`'s job at `cycleIndex` against the counters as they stand (the training run is the
// template's first cycle start, isFirstRun), freeze its phase lengths for `ship` (shortRangeCyclePlan: the mission
// folds, the crew's unload speed, Sensors and the Engineering rating), and count one more cycle start of the drawn
// template. Dispatch calls it for the first cycle; G1-4's cycle engine calls it for every later one, so the training
// run and the counters can never disagree. GEAR WEAR step 3: `wear` is the run's stamp (gearWearEngine.ts
// runWearStamp at dispatch, projectRunStamp at each later cycle start), so the plan reads the gear the cycle froze; without one (a run from before step 3, a
// preview) it reads the stored sheet. E-MOD EM-4: `reactorLift` is whether the run carries the reactor surplus drive
// lift flag (reactorSurplus.ts; a run dispatched before EM-4 plans its later cycles without the lift). Pure.
export function startShortRangeCycle(state: GameState, ship: ShipInstance, slot: ShortRangeSlotRef, cycleIndex: number, wear: RunWearStamp | undefined, reactorLift: boolean, moduleLines = true, favored = true): ShortRangeCycleStart {
  const roll = rollShortRangeJob(state, slot, cycleIndex);
  // WR-7 (OC-D3): `moduleLines` is whether the run carries the crew module lines stamp (true for a preview).
  // WR-7 follow-up (OC-D5): `favored` likewise, the favored-spec stamp (true for a preview).
  const plan = shortRangeCyclePlan(roll, runShipStats(state, ship, wear, reactorLift, moduleLines, favored), shortRangeShipEngineering(state, ship));
  return { roll, plan, runCounts: countShortRangeCycleStart(runCountsOf(state), roll.template) };
}

// ===== the dispatch gate =====

// Why a short-range dispatch is refused. The status reasons mirror the captain-mission gates (tick.ts canDispatch);
// then ONE reason per sheet category the ship falls short in (plan 4 G1-3), named after the category, so the
// dispatch popup (G1-6) can name each short bar.
//   noCaptain    no captain has that id
//   noSlot       the board has no such slot (yet: it opens with a Mission Control upgrade)
//   busy         the captain is already on a mission, patrol or short-range run
//   slotTaken    another captain is flying this slot
//   noShip       the captain flies no hull
//   needsRepair  the hull is damaged and must be repaired first (canDispatch's rule)
//   crewLocked   the ship's crew is locked (it is on an expedition: crewLock.ts, the one crew lock)
//   <category>   the ship falls short of the slot's sheet in that category (shortRange.ts meetsSheet)
export type ShortRangeDispatchBlockReason =
  | "noCaptain"
  | "noSlot"
  | "busy"
  | "slotTaken"
  | "noShip"
  | "needsRepair"
  | "crewLocked"
  | ShortRangeCategory;

export type ShortRangeDispatchGate =
  | { ok: true }
  // `reason` is the first refusal (the status reasons in gate order, else the first short category); `short` lists
  // EVERY category the ship falls short in (empty when a status reason refused first).
  | { ok: false; reason: ShortRangeDispatchBlockReason; short: ShortRangeCategory[] };

// Can `captainId` and their hull take `slotId` right now? Checked in order: noCaptain, noSlot, busy, slotTaken,
// noShip, needsRepair, crewLocked, then the sheet (every category; none is skipped for a roll that does not use it,
// the user's rule). Spends nothing. Pure.
export function canDispatchShortRange(state: GameState, captainId: number, slotId: number): ShortRangeDispatchGate {
  const refuse = (reason: ShortRangeDispatchBlockReason): ShortRangeDispatchGate => ({ ok: false, reason, short: [] });
  const captain = state.captains.find((c) => c.id === captainId);
  if (!captain) return refuse("noCaptain");
  const slot = shortRangeSlotById(state, slotId);
  if (slot === null) return refuse("noSlot");
  if (captain.mission !== null) return refuse("busy");
  if (shortRangeSlotOccupant(state, slotId) !== null) return refuse("slotTaken");
  const ship = state.ships.find((s) => s.assignedCaptainId === captainId);
  if (!ship) return refuse("noShip");
  if (ship.damaged) return refuse("needsRepair");
  if (shipCrewLocked(state, ship.id)) return refuse("crewLocked");
  const sheet = meetsSheet(state, ship, slot.tier);
  if (!sheet.ok) return { ok: false, reason: sheet.short[0], short: sheet.short };
  return { ok: true };
}

// The player text for a refusal (US English). EXHAUSTIVE with no default. Pure.
export function shortRangeBlockText(reason: ShortRangeDispatchBlockReason): string {
  switch (reason) {
    case "noCaptain":
      return "That captain is no longer in the fleet";
    case "noSlot":
      return "That mission slot is not open yet";
    case "busy":
      return "Captain is already out on a mission";
    case "slotTaken":
      return "Another captain is already flying this slot";
    case "noShip":
      return "Captain has no ship assigned";
    case "needsRepair":
      return "Ship needs repairs at the Shipyard first";
    case "crewLocked":
      return crewLockReasonText("onExpedition");
    case "range":
      return "Not enough range for this slot's round trip";
    case "cargo":
      return "Cargo hold too small for this slot";
    case "guests":
      return "Not enough guest quarters for this slot";
    case "sensors":
      return "Sensors too weak for this slot";
    case "engineering":
      return "Engineering crew rating too low for this slot";
    case "security":
      return "Security crew rating too low for this slot";
  }
}

// ===== dispatch =====

export interface ShortRangeDispatchResult {
  next: GameState;
  success: boolean;
  reason?: ShortRangeDispatchBlockReason;
  short?: ShortRangeCategory[];
}

// Put an idle captain and their hull on `slotId`. A thin wrapper over canDispatchShortRange (the one gate): a refusal
// returns the SAME state with the reason and every short category. On success the first cycle starts
// (startShortRangeCycle: the roll at the slot's next cycle index, its frozen plan, one more cycle start of the drawn
// template), the mission begins its outbound leg, and any stale wall-stop reason is cleared (dispatchCaptainOnMission's
// rule). Spends nothing itself: a drop-off pays its load as the cycle leaves home, at the cycle engine's departure gate
// on the next tick (G1-4, user 2026-10-20 "At cycle start"), and waits there while the fleet cannot pay.
// `repeat` false flies one cycle and stops (the run starts recalled); the default runs until recalled. Pure.
export function dispatchCaptainOnShortRange(state: GameState, captainId: number, slotId: number, repeat: boolean = true): ShortRangeDispatchResult {
  const gate = canDispatchShortRange(state, captainId, slotId);
  if (!gate.ok) return { next: state, success: false, reason: gate.reason, short: gate.short };
  // The gate guarantees the captain, the slot and the hull exist.
  const idx = state.captains.findIndex((c) => c.id === captainId);
  const slot = shortRangeSlotById(state, slotId)!;
  const ship = state.ships.find((s) => s.assignedCaptainId === captainId)!;
  // GEAR WEAR step 3: the run's wear flag with its ship's worn gear frozen (gearWearEngine.ts), while any source is live.
  const wear = runWearStamp(state, ship.id);
  // E-MOD EM-4 (reactorSurplus.ts): a run dispatched now on a ship with a powered Reactor Core flies with the reactor
  // surplus drive lift.
  const reactorLift = newReactorLiftFlag(equippedFor(state, ship.id));
  // WR-7 (OC-D3): a run dispatched now reads its crew modules' lines (stamped only when one carries a line).
  const moduleLines = crewModuleLinesStamp(state, ship);
  // WR-7 follow-up (OC-D5): and its favored pieces' bonus (stamped only when a piece favors the hull's spec).
  const favoredSpec = favoredSpecStamp(equippedFor(state, ship.id), ship.typeKey);
  const start = startShortRangeCycle(state, ship, slot, shortRangeNextCycle(state, slotId), wear, reactorLift !== undefined, moduleLines === 1, favoredSpec === 1);
  const mission: ShortRangeMissionState = {
    kind: "shortRange",
    slotId,
    roll: start.roll,
    plan: start.plan,
    phase: "transitOut",
    phaseProgressTicks: 0,
    recalled: !repeat,
    ...(wear !== undefined ? { gearWear: wear } : {}),
    // G1-5: a new run rolls relic blanks at each delivered cycle (the flag rides every later cycle of the run); a run
    // dispatched before G1-5 carries none and plays exactly as it did.
    // Relics v2 tier stagger: the flag also carries `stagger` (the run's blanks carry the stagger stamp).
    relicBlanks: newRunRelicBlanksFlag(),
    ...(reactorLift !== undefined ? { reactorLift } : {}),
    ...(moduleLines !== undefined ? { moduleLines } : {}),
    ...(favoredSpec !== undefined ? { favoredSpec } : {}),
  };
  const captains = [...state.captains];
  captains[idx] = { ...captains[idx], mission, lastStopReason: undefined };
  return { next: { ...state, captains, runCounts: start.runCounts }, success: true };
}

// ===== the Repeat toggle (G1-6) =====

// The board card's Repeat toggle (user 2026-10-21 "Keep it, on by default"): `repeat` false lets the current cycle
// finish and then ends the run (the run reads recalled, exactly what a single run starts as); `repeat` true takes that
// back, so the slot keeps re-rolling. Unlike recallCaptain it never ends a run that has not left home: a waiting run
// set to stop still flies its one cycle. A captain not flying a short-range run, or a run already at that setting,
// returns the SAME state (success false). Pure.
export function setShortRangeRepeat(state: GameState, captainId: number, repeat: boolean): { next: GameState; success: boolean } {
  const idx = state.captains.findIndex((c) => c.id === captainId);
  const mission = idx === -1 ? null : state.captains[idx].mission;
  if (mission === null || mission.kind !== "shortRange" || mission.recalled === !repeat) return { next: state, success: false };
  const captains = [...state.captains];
  captains[idx] = { ...captains[idx], mission: { ...mission, recalled: !repeat } };
  return { next: { ...state, captains }, success: true };
}

// ===== readers =====

// The run's display name: its current job's template label. Pure.
export function shortRangeMissionLabel(mission: Pick<ShortRangeMissionState, "roll">): string {
  return SHORT_RANGE_TEMPLATES[mission.roll.template]?.label ?? "Short-Range Mission";
}

const SHORT_RANGE_PHASES: readonly ShortRangePhase[] = ["transitOut", "onSite", "transitBack", "unloading"];
const PLAN_KEYS = ["transitOutTicks", "onSiteTicks", "transitBackTicks", "unloadTicks", "totalTicks"] as const;
const ROLL_SIZE_KEYS = ["guests", "units", "scan", "engineering", "security"] as const;

function isFiniteNonNegative(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

// Whether a stored short-range run is one this code can carry (save.ts hydration ends any other at load, with no
// reward): a known template and tier, whole sizes, a difficulty stamp, a plan of finite phase lengths, a known phase
// and finite progress. Hardened against hand-edited and hostile saves. Pure.
export function isWellFormedShortRangeMission(m: unknown): m is ShortRangeMissionState {
  if (!m || typeof m !== "object") return false;
  const s = m as Record<string, unknown>;
  if (s.kind !== "shortRange" || !isWholeCount(s.slotId) || typeof s.recalled !== "boolean") return false;
  if (!SHORT_RANGE_PHASES.includes(s.phase as ShortRangePhase) || !isFiniteNonNegative(s.phaseProgressTicks)) return false;
  const r = s.roll as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== "object" || r.version !== 1) return false;
  if (typeof r.template !== "string" || !Object.prototype.hasOwnProperty.call(SHORT_RANGE_TEMPLATES, r.template)) return false;
  if (r.tier !== 1 && r.tier !== 2) return false;
  if (!isWholeCount(r.seed) || !isWholeCount(r.cycleIndex) || !isWholeCount(r.destinationIndex) || !isWholeCount(r.flavorIndex)) return false;
  if (!isWholeCount(r.distanceLy) || r.distanceLy === 0) return false;
  if (!ROLL_SIZE_KEYS.every((k) => r[k] === undefined || isWholeCount(r[k]))) return false;
  const d = r.difficulty as Record<string, unknown> | null | undefined;
  if (!d || typeof d !== "object" || typeof d.firstRun !== "boolean" || !isFiniteNonNegative(d.ramp)) return false;
  const p = s.plan as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== "object" || !PLAN_KEYS.every((k) => isFiniteNonNegative(p[k]))) return false;
  // G1-4: the cycle engine's optional fields (the load a drop-off paid, the cycles this run delivered).
  if (s.loadPaid !== undefined && !isFiniteNonNegative(s.loadPaid)) return false;
  if (s.cyclesThisRun !== undefined && !isWholeCount(s.cyclesThisRun)) return false;
  // G1-5: the relic flag and the run's relic count.
  if (s.relicBlanks !== undefined && (!s.relicBlanks || typeof s.relicBlanks !== "object" || (s.relicBlanks as { version?: unknown }).version !== RELIC_BLANKS_VERSION)) return false;
  // Relics v2 tier stagger: the flag's optional stagger stamp.
  if (s.relicBlanks !== undefined && "stagger" in (s.relicBlanks as object) && (s.relicBlanks as { stagger?: unknown }).stagger !== RELIC_STAGGER_VERSION) return false;
  if (s.relicsThisRun !== undefined && !isWholeCount(s.relicsThisRun)) return false;
  // E-MOD EM-4: the reactor surplus drive lift flag.
  if (s.reactorLift !== undefined && !reactorLiftFlagged(s.reactorLift)) return false;
  if (s.moduleLines !== undefined && s.moduleLines !== 1) return false; // WR-7 (OC-D3): the module lines stamp
  if (s.favoredSpec !== undefined && s.favoredSpec !== 1) return false; // WR-7 follow-up (OC-D5): the favored-spec stamp
  return true;
}
