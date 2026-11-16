// Fix round FR-E (0.14.0, docs/qa/2026-11-13-fable-sweep-ledger.md lane 4 and the USER ANSWERS of 2026-11-13/14):
//   I1  "Resume when safe": a Repeat patrol paused for repairs heads out once the next route no longer breaks its gear;
//   I2  "Climb every N routes": a Repeat run climbs the patrol curve every PATROL_CLIMB_EVERY_ROUTES routes;
//   q3  "Stop and explain": Repeat never flies a route it would lose even fully repaired; it stops and says why;
//   M4  a patrol that ends in defeat mid-call: the same across chunkings (lane 4 M8 made the whole state so);
//   M6  a pause's Overtime step costs what the same gear's docked step costs;
//   I3, M5, M7: the Combat Patrols Help.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { type EquipmentInstance, type GameState, type PatrolMissionState } from "./model";
import { dispatchCaptainOnPatrol, economyTick, projectedCycleBreak, projectedPristineDefeat, recallCaptain, tick } from "./tick";
import { CONDITION_FULL, REPAIR_BANK_PER_MILLE, REPAIR_RATES, repairRateQ, withPieceCondition } from "./gearWear";
import { REPAIR_PAUSE_SLOTS, livePieceCondition } from "./gearWearEngine";
import { gearOvertimePurchase } from "../gearWearDisplay";
import { canBuyGearRepairOvertime } from "./processSpeed";
import { combatHullTypeOf } from "./combat/bridge";
import { fnv, onHull } from "./firstRunsGoldens.fixture";
import { asPatrolVeteran } from "./awayTeamTestFixtures";
import { PATROL_CLIMB_EVERY_ROUTES } from "./runDifficulty";
import { PATROL_END_REASON_VIEW } from "./homeDashboard";
import { HELP_TOPICS } from "../helpTopics";
import { withFixRoundEOff, withPauseJobLikeDockedOff, withRepeatClimbOff, withResumeWhenSafeOff, withStopDoomedOff } from "./fixRoundESwitch.fixture";

const RNG = () => 0.5;
const SHIP = "ship-1";
const COMBAT = ["weapon", "reactorCore", "ftlDrive", "shieldEmitters", "hullPlating", "droneBay"];

function stepped(s: GameState, n: number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, RNG);
  return out;
}
function chunked(s: GameState, total: number, step: number): GameState {
  let out = s;
  for (let left = total; left > 0; left -= step) out = economyTick(out, Math.min(step, left), RNG);
  return out;
}
const patrolOf = (s: GameState): PatrolMissionState | null => s.captains[0].mission as PatrolMissionState | null;
const pieces = (s: GameState): EquipmentInstance[] => s.equipment.filter((e) => e.fittedToShipId === SHIP);
const combat = (s: GameState): EquipmentInstance[] => pieces(s).filter((e) => REPAIR_PAUSE_SLOTS.has(e.slotType));
const veteran = (hull: "destroyer" | "carrier" | "battleship" = "destroyer"): GameState =>
  asPatrolVeteran({ ...onHull(hull), nextPatrolSeed: 1, credits: new Decimal(10_000_000) });
const wornAt = (s: GameState, c: number): GameState => ({
  ...s,
  equipment: s.equipment.map((e) => (e.fittedToShipId === SHIP && COMBAT.includes(e.slotType) ? withPieceCondition(e, c, s.gameTimeSeconds) : e)),
});

describe("FR-E I1: a Repeat repair pause ends once the next route is safe, not at full", () => {
  // A Repeat Sweep dispatched worn at `c` ("Repair first, then go"), on the first condition that gives a pause short of
  // full repair.
  function pausedShort(): { s: GameState; c: number } {
    for (const c of [20, 100, 200, 300, 400, 500, 600, 700]) {
      const r = dispatchCaptainOnPatrol(wornAt(veteran(), c), 1, "crimsonReaverSweep", "balanced", true);
      expect(r.success, r.reason).toBe(true);
      const pause = patrolOf(r.next)!.repairPause;
      if (pause?.target !== undefined) return { s: r.next, c };
    }
    throw new Error("no fixture pause short of full repair");
  }

  it("the pause is shorter than a full repair, heads out with gear short of full, and the route it flies is safe", () => {
    const { s, c } = pausedShort();
    const pause = patrolOf(s)!.repairPause!;
    const full = withResumeWhenSafeOff(() => patrolOf(dispatchCaptainOnPatrol(wornAt(veteran(), c), 1, "crimsonReaverSweep", "balanced", true).next)!.repairPause!);
    expect(full.target).toBeUndefined();
    expect(pause.ticksRemaining).toBeLessThan(full.ticksRemaining);
    // Every worn combat piece's goal is below full and above where it stood.
    for (const [id, goal] of Object.entries(pause.target!)) {
      expect(goal).toBeLessThan(CONDITION_FULL);
      expect(goal).toBeGreaterThan(c);
      expect(combat(s).some((p) => p.id === id)).toBe(true);
    }
    // Through the pause: it heads out on its countdown, each piece at or past its goal, some still short of full.
    let t = s;
    while (patrolOf(t)!.repairPause !== undefined) t = economyTick(t, 1, RNG);
    const out = patrolOf(t)!;
    const opened = out.cycleStartCondition ?? {};
    for (const [id, goal] of Object.entries(pause.target!)) expect(opened[id] ?? CONDITION_FULL).toBeGreaterThanOrEqual(goal);
    expect(Object.keys(opened).length).toBeGreaterThan(0);
    const hull = combatHullTypeOf(t.ships[0].typeKey)!;
    expect(projectedCycleBreak(out, SHIP, hull, pieces(t))).toBe(false);
  });

  it("offline == live through the pause and on: one call == 997 s chunks == 1 s steps", () => {
    const { s } = pausedShort();
    const n = patrolOf(s)!.repairPause!.ticksRemaining + 600;
    const steps = stepped(s, n);
    for (const [name, x] of [["one", economyTick(s, n, RNG)], ["chunks", chunked(s, n, 997)]] as const) {
      expect(JSON.stringify(x.equipment), name).toBe(JSON.stringify(steps.equipment));
      expect(JSON.stringify(x.captains), name).toBe(JSON.stringify(steps.captains));
    }
  });

  it("an Overtime step in the pause rescales it to the same goals, at the new rate", () => {
    const { s } = pausedShort();
    const later = stepped(s, 60);
    const before = patrolOf(later)!.repairPause!;
    const q = canBuyGearRepairOvertime(later, SHIP);
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.minutesLeftAfter).toBeLessThan(q.minutesLeft);
    expect(q.minutesLeft * 60).toBe(before.ticksRemaining * later.tickDurationSeconds);
  });
});

// The fix pass: gearWearCloseout.test.ts sections 2 and 2b and gearWearCombat.test.ts "Repair first, then go" pin the
// pause that runs to full (they run with "Resume when safe" off); the same promises on the pause the game now makes, with
// the round on: Overtime in a pause rescales it to the tick its gear reaches the goals, exactly, and the live bar
// matches a hand-built exact reference every second, a purchase mid-bank and at a mid-second large game time included.
describe("FR-E I1 with Overtime: the target pause resumes on the exact tick its gear reaches the goals", () => {
  // The first condition (every combat piece at it) whose Repeat Sweep dispatch pauses short of full, and its goal (every
  // piece starts at the same condition, so every piece has the same goal).
  const SHORT = ((): { c: number; goal: number } => {
    for (const c of [20, 100, 200, 300, 400, 500, 600, 700]) {
      const pause = patrolOf(dispatchCaptainOnPatrol(wornAt(veteran(), c), 1, "crimsonReaverSweep", "balanced", true).next)?.repairPause;
      if (pause?.target !== undefined) {
        const goals = new Set(Object.values(pause.target));
        expect(goals.size).toBe(1);
        return { c, goal: [...goals][0] };
      }
    }
    throw new Error("no fixture pause short of full repair");
  })();
  const Q_HOME = repairRateQ(REPAIR_RATES.home);
  // A combat piece at SHORT.c, anchored (bank 0) at the pause's start t0, with Overtime steps bought at [instant, steps].
  function reference(t0: number, buys: readonly [number, number][], t: number): number {
    let units = 0;
    let from = t0;
    let q = Q_HOME;
    for (const [at, steps] of buys) {
      if (t <= at) break;
      units += q * (at - from);
      from = at;
      q = repairRateQ(REPAIR_RATES.home * (1 + 0.25 * steps));
    }
    units += q * Math.max(0, t - from);
    return Math.min(CONDITION_FULL, SHORT.c + Math.floor(units / REPAIR_BANK_PER_MILLE));
  }
  function pausedFrom(t0: number): GameState {
    const base = { ...veteran(), gameTimeSeconds: t0 };
    const r = dispatchCaptainOnPatrol(wornAt(base, SHORT.c), 1, "crimsonReaverSweep", "balanced", true);
    expect(r.success, r.reason).toBe(true);
    const pause = patrolOf(r.next)!.repairPause!;
    expect(pause.from).toBe(t0);
    expect(new Set(Object.values(pause.target!))).toEqual(new Set([SHORT.goal]));
    return r.next;
  }
  const targeted = (s: GameState): EquipmentInstance[] => combat(s).filter((p) => patrolOf(s)!.repairPause!.target![p.id] !== undefined);

  it("steps 1 to 3: the patrol heads out on the tick its gear reaches the goals, not a tick before", () => {
    for (let steps = 1; steps <= 3; steps++) {
      let s = pausedFrom(0);
      s = stepped(s, Math.floor(patrolOf(s)!.repairPause!.ticksRemaining / 4));
      for (let i = 0; i < steps; i++) s = gearOvertimePurchase(s, SHIP).next;
      expect(s.ships[0].gearRepairSpeed?.overtimeSteps).toBe(steps);
      const ids = targeted(s).map((p) => p.id);
      let before = s;
      while (patrolOf(s)!.repairPause !== undefined) {
        before = s;
        s = economyTick(s, 1, RNG);
      }
      // One tick before the close a targeted piece was still short of its goal; the relaunched cycle opens with each at
      // or past it, short of full (the pause ended when the route was safe, not at full).
      expect(combat(before).some((p) => ids.includes(p.id) && livePieceCondition(before, p) < SHORT.goal), `x${steps}`).toBe(true);
      const opened = patrolOf(s)!.cycleStartCondition ?? {};
      for (const id of ids) expect(opened[id] ?? CONDITION_FULL, `x${steps}`).toBeGreaterThanOrEqual(SHORT.goal);
      expect(ids.some((id) => (opened[id] ?? CONDITION_FULL) < CONDITION_FULL), `x${steps}`).toBe(true);
      expect(s.ships[0].gearRepairSpeed, `x${steps}`).toBeUndefined();
    }
  });

  // Buy at each offset (seconds after t0, steps in order), then step 1 s: every second the live bar of every combat piece
  // is the reference; the pause closes on exactly the second the reference reaches the goal. `coarse`: the spans before
  // the buy and up to 3 s before the close run as one call each (one call == 1 s steps, I1 above).
  function check(t0: number, offsets: readonly number[], coarse = false): void {
    let s = pausedFrom(t0);
    const buys: [number, number][] = [];
    for (const off of offsets) {
      const n = off - (s.gameTimeSeconds - t0);
      s = coarse ? economyTick(s, n, RNG) : stepped(s, n);
      for (const p of combat(s)) expect(livePieceCondition(s, p), `${t0}+${off} before the buy`).toBe(reference(t0, buys, s.gameTimeSeconds));
      const r = gearOvertimePurchase(s, SHIP);
      expect(r.bought, `${t0}+${off}`).toBe(true);
      s = r.next;
      buys.push([s.gameTimeSeconds, buys.length + 1]);
      for (const p of combat(s)) expect(livePieceCondition(s, p), `${t0}+${off} at the buy`).toBe(reference(t0, buys, s.gameTimeSeconds));
    }
    let goalAt = s.gameTimeSeconds;
    while (reference(t0, buys, goalAt) < SHORT.goal) goalAt += 1;
    if (coarse && goalAt - 3 > s.gameTimeSeconds) {
      s = economyTick(s, goalAt - 3 - s.gameTimeSeconds, RNG);
      expect(patrolOf(s)!.repairPause).toBeDefined();
    }
    while (patrolOf(s)!.repairPause !== undefined) {
      s = economyTick(s, 1, RNG);
      if (patrolOf(s)!.repairPause !== undefined) {
        for (const p of combat(s)) expect(livePieceCondition(s, p), `${t0} ${offsets} at ${s.gameTimeSeconds}`).toBe(reference(t0, buys, s.gameTimeSeconds));
      }
    }
    expect(s.gameTimeSeconds, `${t0} ${offsets} resumes`).toBe(goalAt);
    expect(reference(t0, buys, goalAt - 1)).toBeLessThan(SHORT.goal);
  }
  // Offsets inside the pause (it is shorter than the full one): a quarter in, and a second later (a bank in flight).
  const quarter = (): number => Math.max(2, Math.floor(patrolOf(pausedFrom(0))!.repairPause!.ticksRemaining / 4));

  it("bought a quarter in and a second later (a bank in flight), one step", () => {
    check(0, [quarter()]);
    check(0, [quarter() + 1]);
  });

  it("two steps at banked seconds", () => {
    check(0, [quarter() + 1, 2 * quarter() + 1]);
  });

  it("a mid-second purchase at a large game time (3e6 + 0.5 s)", () => {
    check(3e6 + 0.5, [quarter() + 1], true);
  });
});

describe("FR-E I1: Repair first, then go (gearWearCombat's pin with the round on)", () => {
  it("the run repairs until the first route is safe, then flies it repaired that far; a Dispatch Once never pauses", () => {
    const worn = wornAt(veteran(), 20);
    const s = dispatchCaptainOnPatrol(worn, 1, "crimsonReaverSweep", "balanced", true).next;
    const pause = patrolOf(s)!.repairPause!;
    expect(patrolOf(s)!.repairPausesThisRun).toBe(1);
    let st = s;
    while (patrolOf(st)!.repairPause !== undefined) st = economyTick(st, 1, RNG);
    const opened = patrolOf(st)!.cycleStartCondition ?? {};
    const goals = pause.target ?? Object.fromEntries(combat(s).map((p) => [p.id, CONDITION_FULL]));
    for (const [id, goal] of Object.entries(goals)) expect(opened[id] ?? CONDITION_FULL).toBeGreaterThanOrEqual(goal);
    expect(projectedCycleBreak(patrolOf(st)!, SHIP, combatHullTypeOf(st.ships[0].typeKey)!, pieces(st))).toBe(false);
    expect(patrolOf(dispatchCaptainOnPatrol(worn, 1, "crimsonReaverSweep", "balanced", false).next)!.repairPause).toBeUndefined();
  });
});

describe("FR-E M6: a pause's Overtime step costs what the same gear's docked step costs", () => {
  it("at the pause's first instant, paused and docked quote the same step price (and differed by the margin before)", () => {
    for (const c of [20, 100]) {
      const r = dispatchCaptainOnPatrol(wornAt(veteran(), c), 1, "crimsonReaverSweep", "balanced", true);
      const paused = r.next;
      expect(patrolOf(paused)!.repairPause).toBeDefined();
      // The same ship docked at the same instant (the run recalled from its pause ends at once, docked).
      const docked = recallCaptain(paused, 1).next;
      expect(docked.captains[0].mission).toBeNull();
      const a = canBuyGearRepairOvertime(paused, SHIP);
      const b = canBuyGearRepairOvertime(docked, SHIP);
      expect(a.ok && b.ok, `c ${c}`).toBe(true);
      if (!a.ok || !b.ok) continue;
      expect(a.cost, `c ${c}`).toBe(b.cost);
      expect(a.jobMinutes, `c ${c}`).toBeCloseTo(b.jobMinutes, 9);
      // Before the fix the pause priced its own length, the settle margin tick included.
      const old = withPauseJobLikeDockedOff(() => withResumeWhenSafeOff(() => {
        const p = dispatchCaptainOnPatrol(wornAt(veteran(), c), 1, "crimsonReaverSweep", "balanced", true).next;
        return canBuyGearRepairOvertime(p, SHIP);
      }));
      expect(old.ok && old.jobMinutes > b.jobMinutes, `c ${c}`).toBe(true);
    }
  });
});

describe("FR-E I2: a Repeat run climbs the patrol curve every N routes", () => {
  it("a fresh save's first patrol on Repeat: training, then the floor, then one step per N routes; chunk-invariant", () => {
    const s0 = { ...onHull("destroyer"), nextPatrolSeed: 1, credits: new Decimal(10_000_000) };
    const r = dispatchCaptainOnPatrol(s0, 1, "crimsonReaverSweep", "balanced", true);
    expect(r.success, r.reason).toBe(true);
    expect(patrolOf(r.next)!.difficulty?.firstRun).toBe(true);
    // The stamp each route flew, by route number (1-based), stepping 1 s at a time.
    const fly = (from: GameState, routes: number): { flown: Map<number, number | null>; end: GameState; ticks: number } => {
      const flown = new Map<number, number | null>();
      let s = from;
      let ticks = 0;
      for (; ticks < 200_000 && (patrolOf(s)?.routesCompletedThisRun ?? 0) < routes; ticks++) {
        s = economyTick(s, 1, RNG);
        const m = patrolOf(s);
        expect(m, "the run must go on").not.toBeNull();
        if (m!.repairPause === undefined) flown.set((m!.routesCompletedThisRun ?? 0) + 1, m!.difficulty ? m!.difficulty.completed : null);
      }
      return { flown, end: s, ticks };
    };
    const { flown, end, ticks } = fly(r.next, 2 * PATROL_CLIMB_EVERY_ROUTES + 1);
    // Route 1 is the training cycle; the run then flies the floor (0 completed) and climbs one step at route N + 1 and
    // again at 2N + 1.
    expect(flown.get(2)).toBe(0);
    expect(flown.get(PATROL_CLIMB_EVERY_ROUTES)).toBe(0);
    expect(flown.get(PATROL_CLIMB_EVERY_ROUTES + 1)).toBe(1);
    expect(flown.get(2 * PATROL_CLIMB_EVERY_ROUTES)).toBe(1);
    expect(flown.get(2 * PATROL_CLIMB_EVERY_ROUTES + 1)).toBe(2);
    // The save's own curve still counts runs, not routes (a run that began as training never counts on it, SF5).
    expect(end.runCounts?.patrol.completed).toBe(0);
    // One call and 997 s chunks climb the same.
    expect(JSON.stringify(economyTick(r.next, ticks, RNG).captains)).toBe(JSON.stringify(end.captains));
    expect(JSON.stringify(chunked(r.next, ticks, 997).captains)).toBe(JSON.stringify(end.captains));
    // With the climb off, the run keeps the floor.
    expect(withRepeatClimbOff(() => fly(r.next, PATROL_CLIMB_EVERY_ROUTES + 1).flown.get(PATROL_CLIMB_EVERY_ROUTES + 1))).toBe(0);
  });
});

describe("FR-E q3: Repeat never flies a route it would lose even fully repaired; it stops and says why", () => {
  // The ledger's carrier: a veteran carrier on Repeat Sweep, torpedoes on (the app's default), lost a route at 3,502 s.
  const carrier = (): GameState => {
    const r = dispatchCaptainOnPatrol(veteran("carrier"), 1, "crimsonReaverSweep", "balanced", true);
    expect(r.success, r.reason).toBe(true);
    return r.next;
  };

  it("the run ends at a route's end, home and undamaged, its log entry saying why; with the rule off it limped home", () => {
    const T = 8000;
    const s = chunked(carrier(), T, 997);
    const entry = (s.completionLog ?? []).find((e) => e.kind === "patrolRun");
    expect(entry?.patrolEndReason).toBe("outmatched");
    expect(PATROL_END_REASON_VIEW.outmatched.label).toBe("stopped: the next route would be lost even fully repaired");
    expect(s.captains[0].mission).toBeNull();
    expect(s.ships[0].damaged).not.toBe(true);
    expect(s.captains[0].lastStopReason).toBeUndefined();
    const before = withStopDoomedOff(() => chunked(carrier(), T, 997));
    expect((before.completionLog ?? []).find((e) => e.kind === "patrolRun")?.patrolEndReason).toBe("defeat");
  });

  it("the stop is the same however the span is cut (one call, 997 s chunks, 1 s steps)", () => {
    const T = 5000;
    const steps = stepped(carrier(), T);
    for (const [name, x] of [["one", economyTick(carrier(), T, RNG)], ["chunks", chunked(carrier(), T, 997)]] as const) {
      expect(JSON.stringify(x.captains), name).toBe(JSON.stringify(steps.captains));
      expect(JSON.stringify(x.completionLog), name).toBe(JSON.stringify(steps.completionLog));
      expect(JSON.stringify(x.equipment), name).toBe(JSON.stringify(steps.equipment));
    }
  });

  it("projectedPristineDefeat reads the route at full repair: a fresh dispatch of a won route is not doomed", () => {
    const s = carrier();
    const hull = combatHullTypeOf(s.ships[0].typeKey)!;
    expect(projectedPristineDefeat(patrolOf(s)!, SHIP, hull, pieces(s))).toBe(false);
  });
});

describe("FR-E M4: a patrol that ends in defeat mid-call (the stop rule off, to reach a defeat)", () => {
  const lost = (): GameState => withStopDoomedOff(() => {
    const r = dispatchCaptainOnPatrol(veteran("carrier"), 1, "crimsonReaverSweep", "balanced", true);
    return r.next;
  });
  it("the patrol's own outcome is the same across chunkings, and so are the repair job and the crew fill", () => {
    const T = 8000;
    const [one, chunks, steps] = withStopDoomedOff(() => [economyTick(lost(), T, RNG), chunked(lost(), T, 997), stepped(lost(), T)]);
    for (const [name, x] of [["one", one], ["chunks", chunks]] as const) {
      // The run, its rewards and its gear wear: identical.
      expect(JSON.stringify(x.captains), name).toBe(JSON.stringify(steps.captains));
      expect(JSON.stringify(x.equipment), name).toBe(JSON.stringify(steps.equipment));
      expect(x.credits.toString(), name).toBe(steps.credits.toString());
      expect(JSON.stringify(x.completionLog?.filter((e) => e.kind === "patrolRun")), name).toBe(JSON.stringify(steps.completionLog?.filter((e) => e.kind === "patrolRun")));
    }
    // Lane 4 M8 (patrolHomeSplit.test.ts): the call splits at the tick the wreck lands and fills crew window by window,
    // so the ships and the Shipyard's processes match 1 s steps too (they started at the call's end before). The game
    // always steps one tick per call (live play and the offline catch-up alike, tick.ts tick), and that is the 1 s result:
    for (const [name, x] of [["one", one], ["chunks", chunks]] as const) {
      expect(JSON.stringify(x.ships), name).toBe(JSON.stringify(steps.ships));
      expect(JSON.stringify(x.activeProcesses), name).toBe(JSON.stringify(steps.activeProcesses));
    }
    const offline = withStopDoomedOff(() => tick(T * lost().tickDurationSeconds, lost(), RNG));
    expect(JSON.stringify(offline.ships)).toBe(JSON.stringify(steps.ships));
    expect(JSON.stringify(offline.activeProcesses)).toBe(JSON.stringify(steps.activeProcesses));
    expect(JSON.stringify(offline.captains)).toBe(JSON.stringify(steps.captains));
  });
});

describe("FR-E Help (lane 4 I3, M5, M7)", () => {
  const body = HELP_TOPICS.find((t) => t.id === "patrols")?.body ?? "";
  it("the Sweep is no longer promised as a sure win, and Repeat's repair pause, stop and climb are explained", () => {
    expect(body).not.toContain("any warship can win");
    expect(body).toMatch(/Crimson-Reaver Sweep, a short local sweep a warship usually wins/);
    expect(body).toMatch(/REPEAT AND REPAIRS:/);
    expect(body).toMatch(/goes home to repair first/);
    expect(body).toMatch(/as soon as the repairs make the next route safe/);
    expect(body).toMatch(/would be lost even fully repaired/);
    expect(body).toMatch(new RegExp(`every ${PATROL_CLIMB_EVERY_ROUTES} routes`));
    // M5: the stance difference shows with longer-reach gear.
    expect(body).toMatch(/Aggressive and Balanced fight the same while every gun reaches about as far/);
    expect(body).not.toMatch(/—|--/);
  });
});

// The round's patrol pins: the ledger's three 30,000 s Repeat Sweeps (veteran, Balanced, torpedoes on), hashed (the
// captains, the ship's gear and the log) with the round on, and with it off (withFixRoundEOff).
const SWEEP_T = 30_000;
const sweepHash = (hull: "destroyer" | "carrier" | "battleship"): string => {
  const r = dispatchCaptainOnPatrol(veteran(hull), 1, "crimsonReaverSweep", "balanced", true);
  const s = chunked(r.next, SWEEP_T, 997);
  return fnv(JSON.stringify([s.captains, pieces(s), s.completionLog]));
};
// Moved by the round (each returns with it off): every hull's pauses end once the next route is safe (I1) and are priced
// like docked (M6); the carrier stops "outmatched" at a route's end where it limped home in defeat (q3). These veteran
// runs carry no curve stamp, so the climb (I2) moves nothing here.
const SWEEP_PINS: Record<string, [string, string]> = {
  destroyer: ["109a9a3", "b2f4624e"],
  carrier: ["48565ad0", "8f161d10"],
  battleship: ["37e36eb8", "9b287c62"],
};
describe("FR-E patrol pins (the ledger's Repeat Sweeps)", () => {
  for (const hull of ["destroyer", "carrier", "battleship"] as const) {
    it(`${hull}: with the round, and without it`, { timeout: 600_000 }, () => {
      const got: [string, string] = [sweepHash(hull), withFixRoundEOff(() => sweepHash(hull))];
      expect(got).toEqual(SWEEP_PINS[hull]);
    });
  }
});
