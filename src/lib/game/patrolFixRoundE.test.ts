// Fix round FR-E (0.14.0, docs/qa/2026-11-13-fable-sweep-ledger.md lane 4 and the USER ANSWERS of 2026-11-13/14):
//   I1  "Resume when safe": a Repeat patrol paused for repairs heads out once the next route no longer breaks its gear;
//   I2  "Climb every N routes": a Repeat run climbs the patrol curve every PATROL_CLIMB_EVERY_ROUTES routes;
//   q3  "Stop and explain": Repeat never flies a route it would lose even fully repaired; it stops and says why;
//   M4  a patrol that ends in defeat mid-call: what holds across chunkings, and what starts at the call's end;
//   M6  a pause's Overtime step costs what the same gear's docked step costs;
//   I3, M5, M7: the Combat Patrols Help.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { type EquipmentInstance, type GameState, type PatrolMissionState } from "./model";
import { dispatchCaptainOnPatrol, economyTick, projectedCycleBreak, projectedPristineDefeat, recallCaptain, tick } from "./tick";
import { CONDITION_FULL, withPieceCondition } from "./gearWear";
import { REPAIR_PAUSE_SLOTS } from "./gearWearEngine";
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
  it("the patrol's own outcome is the same across chunkings; the repair job and the crew fill start at the call's end", () => {
    const T = 8000;
    const [one, chunks, steps] = withStopDoomedOff(() => [economyTick(lost(), T, RNG), chunked(lost(), T, 997), stepped(lost(), T)]);
    for (const [name, x] of [["one", one], ["chunks", chunks]] as const) {
      // The run, its rewards and its gear wear: identical.
      expect(JSON.stringify(x.captains), name).toBe(JSON.stringify(steps.captains));
      expect(JSON.stringify(x.equipment), name).toBe(JSON.stringify(steps.equipment));
      expect(x.credits.toString(), name).toBe(steps.credits.toString());
      expect(JSON.stringify(x.completionLog?.filter((e) => e.kind === "patrolRun")), name).toBe(JSON.stringify(steps.completionLog?.filter((e) => e.kind === "patrolRun")));
    }
    // KNOWN (not player-visible): the Shipyard repair job auto-starts, and a passive ship's crew fill runs, at the end of
    // the economyTick call the defeat lands in (tick.ts, crewOverlay.ts resolveCrew), so a call that spans the limp's
    // end starts them later than 1 s steps do. The game always steps one tick per call (live play and the offline
    // catch-up alike, tick.ts tick), so what a player sees is the 1 s result exactly:
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
