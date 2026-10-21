// G1-4 (Short-Range Missions, docs/plans/2026-10-17-short-range-missions-plan.md section 4 G1-4, every USER ANSWERS
// section and docs/plans/2026-10-19-merge-batch-answers.md): THE CYCLE ENGINE. economyTick routes a captain flying a
// short-range board slot here (tick.ts, the "shortRange" arm of its mission switch).
//
// One cycle: transit out (the rolled distance), the job on site, transit back, the home turnaround (unloading, which
// occupies a transit berth on the captain-mission rules, call 18). What the user decided:
// - The WHOLE JOB re-rolls at every cycle start (call 1), through the board's one cycle-start seam
//   (shortRangeBoard.ts startShortRangeCycle), which bumps the drawn template's `dispatched` count, so the first cycle
//   start of each template is its training run; two slots can both start an untried template (both train).
// - A Supply Drop-off pays its load cost AT THE CYCLE START, as the ship leaves home (user 2026-10-20 "At cycle start
//   (Recommended)"); the delivery returns the full load value plus the margin. When the fleet cannot afford it the slot
//   idles at home and leaves on its own the moment it can (never a failure). A Supply Pickup whose material is at its
//   Warehouse cap idles the same way (plan 3.1, the materialAtCap seam). An idled roll is never re-drawn: the board's
//   cycle cursor advances only on a delivered cycle, so no stream shifts.
// - Rewards per template (shortRange.ts shortRangeCycleReward: the Tier II band, Prisoner Transport x1.20, Titanium
//   Ore from a pickup, Iridium Ore from a survey), then the ship's mission output share (Command Presence and the
//   complement's Crew Output Multiplier) on credits and materials, the captain's Trade terms on a drop-off (the
//   supply-run loop: margin x (1 + bonus), supplies x (1 - discount)) and Motherlode on a delivered haul. Captain and
//   Fleet Admiral XP accrue per ACTIVE tick at integer rates (the closed-form parity trap, tickCaptainMission).
// - The slow-start curve (SF4) reads completed cycles per template, the training run excluded (SF5); no gear wear on a
//   training run (W9: shortRangeCycleWear returns none for it).
// - Recall finishes the current cycle, then the run ends (recallCaptain marks it; a run that has not left home yet
//   ends at once there, and its cycle start is taken back so the template keeps its training run).
// - No failure state: a ship that met the sheet at dispatch always completes (call 9).
//
// THE PARITY ARGUMENT. Everything a cycle reads is frozen at its start (the roll and its plan) or is a constant of the
// call (the ship's stats, its crew's output share, the captain's terms); the counters and the board cursor are
// threaded through the loop, and every phase boundary is crossed at the same whole tick however the span is chunked,
// so one economyTick(state, N) equals N calls of economyTick(state, 1) for a run (shortRangeCycle.test.ts proves one
// call == 997 s chunks == 1 s steps over 20 cycles). Like tickCaptainMission, the shared budgets (credits for a load,
// transit berths) are drawn from the incoming state: a credit or a berth another captain frees within one call is
// claimable on the next call, which is what production does (live and offline both step economyTick(state, 1)).
//
// PURE: no clock, no shared economy rng (the material rounding draws on the roll's own SHORT_RANGE_OUTPUT_SALT stream,
// Motherlode on the captain's private stream), no state mutation.

import { type CaptainState, type GameState, type RunCounts, type ShipInstance, type ShortRangeMissionState, type ShortRangePhase } from "./model";
import { SHORT_RANGE_OUTPUT_SALT, SHORT_RANGE_TEMPLATES, shortRangeCycleReward, wholeUnits, type ShortRangeCyclePlan, type ShortRangeRoll } from "./shortRange";
import { shortRangeSlotById, startShortRangeCycle } from "./shortRangeBoard";
import { effectiveShipStats, shipMissionOutputBonus } from "./crewOverlay";
import { captainMotherlodeChance, captainTransportTerms, motherlodeSeed } from "./captainSecondaryEffects";
import { countShortRangeCycleComplete } from "./runDifficulty";
import { makeRng } from "./combat/rng";

// The float-snap epsilon of a phase boundary (tickCaptainMission's MISSION_TICK_EPSILON).
const TICK_EPSILON = 1e-9;

// The phase after each one; null after the home turnaround (the cycle is delivered).
const NEXT_PHASE: Readonly<Record<ShortRangePhase, ShortRangePhase | null>> = {
  transitOut: "onSite",
  onSite: "transitBack",
  transitBack: "unloading",
  unloading: null,
};

// A phase's length in this cycle, from the plan frozen at its start. Pure.
export function shortRangePhaseTicks(mission: Pick<ShortRangeMissionState, "phase" | "plan">): number {
  const p = mission.plan;
  switch (mission.phase) {
    case "transitOut":
      return p.transitOutTicks;
    case "onSite":
      return p.onSiteTicks;
    case "transitBack":
      return p.transitBackTicks;
    case "unloading":
      return p.unloadTicks;
  }
}

// Whether this cycle has left home: anything past the first instant of its outbound leg. A cycle that has not is
// waiting at the departure gate (its load unpaid) or is about to leave on the next tick. Pure.
export function shortRangeHasDeparted(mission: Pick<ShortRangeMissionState, "phase" | "phaseProgressTicks">): boolean {
  return mission.phase !== "transitOut" || mission.phaseProgressTicks > 0;
}

// What a departing cycle pays for its load: a Supply Drop-off's working capital (its units x the tier's supply cost),
// bought at the captain's Trade discount (Shrewd Negotiator: the supplies cost x (1 - discount), the sale value is
// unchanged). 0 for every other job. Pure.
export function shortRangeLoadToPay(roll: ShortRangeRoll, captain: CaptainState | null | undefined): number {
  const reward = SHORT_RANGE_TEMPLATES[roll.template].reward;
  if (reward.kind !== "supplyLoop") return 0;
  const cost = (roll.units ?? 0) * reward.supplyCostPerUnit[roll.tier];
  const discount = Math.max(0, captainTransportTerms(captain).supplyDiscount);
  return discount === 0 ? cost : cost * (1 - discount);
}

// Why a cycle that has not left home is waiting at the departure gate, or null when it can leave now:
//   "warehouse"  a Supply Pickup whose material is at its Warehouse cap (`atCap`, the materialAtCap seam)
//   "credits"    a Supply Drop-off whose load the fleet cannot pay (`credits` is the balance it may draw on)
// The UI's waiting line (G1-6) reads the same answer the engine acts on. Pure.
export type ShortRangeDepartureHold = "warehouse" | "credits";
export function shortRangeDepartureHold(
  mission: Pick<ShortRangeMissionState, "roll">,
  captain: CaptainState | null | undefined,
  credits: number,
  atCap: (itemId: string) => boolean,
): ShortRangeDepartureHold | null {
  const reward = SHORT_RANGE_TEMPLATES[mission.roll.template].reward;
  if (reward.kind === "pickup" && atCap(reward.material)) return "warehouse";
  const load = shortRangeLoadToPay(mission.roll, captain);
  if (load > 0 && credits < load) return "credits";
  return null;
}

// ===== the gear wear seam =====

// The use-wear events one delivered cycle of `roll` makes, in the units of the gear wear design's table (docs/plans/
// 2026-10-16-gear-wear-design.md 3.1): a haul for a job that carries goods (the cargo bay), the lightyears flown both
// ways (the FTL drive), the minutes underway (the reactor core and the crew modules) and a survey cycle (the sensor
// array). null on a training run: W9 "No wear on training". SEAM, owner: the gear wear engine (not merged in 0.14.0's
// branch yet; it calls this at each delivered cycle, the one place a short-range cycle ends). Pure.
export interface ShortRangeWearEvents {
  hauls: number;
  lightYears: number;
  minutesUnderway: number;
  surveys: number;
}
export function shortRangeCycleWear(roll: ShortRangeRoll, plan: ShortRangeCyclePlan, secondsPerTick: number): ShortRangeWearEvents | null {
  if (roll.difficulty.firstRun) return null;
  const site = SHORT_RANGE_TEMPLATES[roll.template].work.site;
  return {
    hauls: site === "offload" || site === "load" || (site === "work" && roll.units !== undefined) ? 1 : 0,
    lightYears: roll.distanceLy * 2,
    minutesUnderway: (plan.totalTicks * secondsPerTick) / 60,
    surveys: site === "scan" ? 1 : 0,
  };
}

// ===== the cycle loop =====

export interface ShortRangeTickInput {
  ticksElapsed: number;
  captain: CaptainState; // flying a short-range run (mission.kind "shortRange")
  state: GameState; // the INCOMING state: the ship's stats, the board's slots and the call-constant reads
  ship: ShipInstance | undefined; // the hull this captain flies
  creditsBudget: number; // the credits this call may still draw on for a load (economyTick's running balance)
  berthBudget: number; // the transit berths this call may still claim
  runCounts: RunCounts; // the fleet's running counters this call (threaded across captains)
  nextCycle: Readonly<Record<number, number>>; // the board's running cycle cursor this call
  atCap: (itemId: string) => boolean; // materialAtCap on the incoming state
}

export interface ShortRangeTickResult {
  captain: CaptainState; // the mission advanced (XP is NOT applied here: economyTick folds captainXpAwarded)
  creditsDelta: number; // loads paid out (negative), deliveries paid in (the load returned plus what was earned)
  creditsEarned: number; // the earned part only (lifetime stats): margins, discount savings and job pay
  budgetDraw: number; // the credits this call drew from the shared balance beyond its own deliveries (never negative)
  materials: Readonly<Record<string, number>>; // whole units delivered to the Warehouse
  captainXpAwarded: number; // integer: per-active-tick XP before the retirement multiplier
  fleetAdminXpDelta: number; // integer
  berthsClaimed: number; // berths claimed from the shared budget (a berth the run freed and took again is not drawn twice)
  cyclesDelivered: number;
  completedByTemplate: Readonly<Record<string, number>>; // delivered cycles per template this call
  runCounts: RunCounts; // the same reference when nothing changed
  nextCycle: Readonly<Record<number, number>>; // the same reference when nothing changed
  ended: { slotId: number; cycles: number } | null; // the run ended this call (recalled): the completion log entry
}

// Advance one captain's short-range run by `ticksElapsed`. See the header for the rules and the parity argument.
export function tickCaptainShortRange(input: ShortRangeTickInput): ShortRangeTickResult {
  const { ticksElapsed, captain, state, ship } = input;
  const idle: ShortRangeTickResult = {
    captain,
    creditsDelta: 0,
    creditsEarned: 0,
    budgetDraw: 0,
    materials: {},
    captainXpAwarded: 0,
    fleetAdminXpDelta: 0,
    berthsClaimed: 0,
    cyclesDelivered: 0,
    completedByTemplate: {},
    runCounts: input.runCounts,
    nextCycle: input.nextCycle,
    ended: null,
  };
  const startMission = captain.mission;
  // A run always flies a hull (the crew lock keeps it aboard); a hull-less one holds still rather than guessing stats.
  if (startMission === null || startMission.kind !== "shortRange" || ticksElapsed <= 0 || ship === undefined) return idle;

  // Call-constants: the hull, its gear and its crew cannot change while it is out (the crew and gear locks), and the
  // captain's talents are read once per call, exactly as tickCaptainMission reads its bonuses.
  const stats = effectiveShipStats(state, ship);
  const outputShare = Math.max(0, shipMissionOutputBonus(state, ship));
  const marginBonus = Math.max(0, captainTransportTerms(captain).marginBonus);
  const motherlodeChance = Math.max(0, captainMotherlodeChance(captain));
  let motherlodeCycles: number | undefined = captain.motherlodeCycles;

  let mission: ShortRangeMissionState | null = { ...startMission };
  let remaining = ticksElapsed;
  let credits = input.creditsBudget;
  let paidOut = 0;
  let paidIn = 0;
  let creditsDelta = 0;
  let creditsEarned = 0;
  let berths = input.berthBudget;
  let sharedClaims = 0;
  // A berth this run freed within the call (its own home turnaround done): reclaimable by this run only, so a later
  // captain in the same call never sees it (tickCaptainMission's rule) and the run never draws the shared budget twice.
  let ownFree = 0;
  let runCounts = input.runCounts;
  let nextCycle = input.nextCycle;
  let captainXp = 0;
  let fleetAdminXp = 0;
  let cyclesDelivered = 0;
  const completedByTemplate: Record<string, number> = {};
  const materials: Record<string, number> = {};
  let ended: ShortRangeTickResult["ended"] = null;

  // 0.14.0 SPEED SEAM (processSpeed.ts applyTimeSkip): while the CURRENT cycle carries speed.instantComplete, each
  // phase is applied whole without spending the call's own ticks, so the cycle runs through to its delivery inside
  // this call (the same pay and XP the time would have produced). The next cycle is built without the flag. A
  // departure or berth hold breaks out as usual and the skip resumes on the next tick.
  while (mission !== null && (remaining > 0 || mission.speed?.instantComplete === true)) {
    const skipping: boolean = mission.speed?.instantComplete === true;
    // THE DEPARTURE GATE (cycle start): a pickup with a full Warehouse waits; a drop-off pays its load or waits.
    if (!shortRangeHasDeparted(mission)) {
      if (shortRangeDepartureHold(mission, captain, credits, input.atCap) !== null) break;
      const load = shortRangeLoadToPay(mission.roll, captain);
      if (load > 0) {
        credits -= load;
        paidOut += load;
        creditsDelta -= load;
        mission = { ...mission, loadPaid: load };
      }
    }
    const required = shortRangePhaseTicks(mission);
    let step: number = skipping ? required - mission.phaseProgressTicks : Math.min(remaining, required - mission.phaseProgressTicks);
    if (Math.abs(mission.phaseProgressTicks + step - required) < TICK_EPSILON) step = required - mission.phaseProgressTicks;
    step = Math.max(0, step);
    // XP per ACTIVE whole tick (integer rates: one big call and many small ones credit the identical count).
    const whole = Math.floor(mission.phaseProgressTicks + step) - Math.floor(mission.phaseProgressTicks);
    const rewardDef = SHORT_RANGE_TEMPLATES[mission.roll.template].reward;
    captainXp += rewardDef.captainXpPerTick[mission.roll.tier] * whole;
    fleetAdminXp += rewardDef.fleetAdminXpPerTick * whole;
    mission = { ...mission, phaseProgressTicks: mission.phaseProgressTicks + step };
    if (!skipping) remaining -= step;
    if (Math.abs(remaining) < TICK_EPSILON) remaining = 0;
    if (mission.phaseProgressTicks < required) continue;

    const next: ShortRangePhase | null = NEXT_PHASE[mission.phase];
    if (next !== null) {
      // THE TRANSIT-BERTH HOLD (call 18, tickCaptainMission's): a returning ship needs a free berth before it docks.
      // Progress banks at the end of the return leg and the loop breaks (berths.ts isAwaitingBerth reads it); the
      // unloading phase itself is never gated (the softlock proof).
      if (next === "unloading") {
        if (ownFree > 0) ownFree -= 1;
        else if (berths < 1) break;
        else {
          berths -= 1;
          sharedClaims += 1;
        }
      }
      mission = { ...mission, phase: next, phaseProgressTicks: 0 };
      continue;
    }

    // ===== THE DELIVERY: the home turnaround is done =====
    ownFree += 1;
    const roll = mission.roll;
    const base = shortRangeCycleReward(roll, stats);
    // Credits: the job's pay; a drop-off's is its margin (the captain's Trade bonus on it) plus the discount saved,
    // with the load it paid at the start returned. Then the ship's mission output share on what was earned.
    let earned = base.credits;
    let returned = 0;
    if (rewardDefOf(roll).kind === "supplyLoop") {
      const paid = mission.loadPaid;
      const margin = marginBonus === 0 ? base.credits : base.loadCost * marginOf(roll) * (1 + marginBonus);
      returned = paid === undefined ? 0 : paid;
      earned = margin + (paid === undefined ? 0 : base.loadCost - paid);
    }
    if (outputShare > 0) earned *= 1 + outputShare;
    creditsDelta += returned + earned;
    creditsEarned += earned;
    paidIn += returned + earned;
    credits += returned + earned;
    // Materials: Motherlode on the haul (the captain's private stream, one draw per delivered haul), then the output
    // share in whole units on the roll's own stream (one draw per item, always taken while the share is live).
    const haul: Record<string, number> = { ...base.materials };
    const items = Object.keys(haul).filter((k) => haul[k] > 0).sort();
    if (items.length > 0 && motherlodeChance > 0) {
      const hit = makeRng(motherlodeSeed(captain.id, motherlodeCycles ?? 0)).next() < motherlodeChance;
      motherlodeCycles = (motherlodeCycles ?? 0) + 1;
      if (hit) for (const k of items) haul[k] *= 2;
    }
    if (items.length > 0 && outputShare > 0) {
      const rng = makeRng((roll.seed ^ SHORT_RANGE_OUTPUT_SALT) >>> 0);
      for (const k of items) haul[k] = wholeUnits(haul[k] * (1 + outputShare), rng);
    }
    for (const k of items) if (haul[k] > 0) materials[k] = (materials[k] ?? 0) + haul[k];
    // The counters: one more delivered cycle (the curve skips the training run, SF5) and the board's cursor.
    cyclesDelivered += 1;
    completedByTemplate[roll.template] = (completedByTemplate[roll.template] ?? 0) + 1;
    if (!roll.difficulty.firstRun) runCounts = countShortRangeCycleComplete(runCounts, roll.template);
    nextCycle = { ...nextCycle, [mission.slotId]: roll.cycleIndex + 1 };
    const cycles = (mission.cyclesThisRun ?? 0) + 1;
    const slot = shortRangeSlotById(state, mission.slotId);
    // Recall finishes the cycle, then the run ends. A slot that no longer exists (a hand-edited save) ends the same way.
    if (mission.recalled || slot === null) {
      ended = { slotId: mission.slotId, cycles };
      mission = null;
      break;
    }
    // THE NEXT CYCLE START: the whole job re-rolls at the slot's next cycle index against the counters as they stand
    // now (this call's earlier starts and deliveries included), through the board's one cycle-start seam.
    const start = startShortRangeCycle({ ...state, runCounts }, ship, slot, roll.cycleIndex + 1);
    runCounts = start.runCounts;
    mission = {
      kind: "shortRange",
      slotId: mission.slotId,
      roll: start.roll,
      plan: start.plan,
      phase: "transitOut",
      phaseProgressTicks: 0,
      recalled: false,
      cyclesThisRun: cycles,
    };
  }

  return {
    captain: { ...captain, mission, ...(motherlodeCycles !== undefined ? { motherlodeCycles } : {}) },
    creditsDelta,
    creditsEarned,
    budgetDraw: Math.max(0, paidOut - paidIn),
    materials,
    captainXpAwarded: captainXp,
    fleetAdminXpDelta: fleetAdminXp,
    berthsClaimed: sharedClaims,
    cyclesDelivered,
    completedByTemplate,
    runCounts,
    nextCycle,
    ended,
  };
}

function rewardDefOf(roll: ShortRangeRoll) {
  return SHORT_RANGE_TEMPLATES[roll.template].reward;
}

function marginOf(roll: ShortRangeRoll): number {
  const reward = rewardDefOf(roll);
  return reward.kind === "supplyLoop" ? reward.margin : 0;
}
