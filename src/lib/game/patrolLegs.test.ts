// WR-7 follow-up OC-D8 (user 2026-10-15 "Speed counts everywhere": "patrol legs scale with transitSpeedMult"): a patrol
// cycle freezes its two transit legs at the ship's transit speed when it starts (model.ts patrolLegTicksFor), and every
// reader of the cycle's time goes through patrolRouteOf. Reach and fuel stay on the route's legs (distance).

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { PATROLS, patrolLegTicksFor, patrolRouteOf, patrolRouteTicks, type GameState, type PatrolKey, type PatrolMissionState, type ShipTypeKey } from "./model";
import { canDispatchPatrol, dispatchCaptainOnPatrol, economyTick, patrolDispatchRoute, recallCaptain, shipReachesRoundTrip } from "./tick";
import { effectiveShipStats } from "./crewOverlay";
import { replayPatrol } from "./combat/patrolReplay";
import { deserialize, migrate, serialize } from "./save";
import { onHull } from "./firstRunsGoldens.fixture";
import { asPatrolVeteran } from "./awayTeamTestFixtures";
import { installPiece } from "./wiring/probes";
import { asPreLegs } from "./patrolLegsGoldens.fixture";
import { withPatrolLegsOff } from "./patrolLegsSwitch.fixture";
import { withPatrolLegLiftsOff } from "./patrolLegLiftsSwitch.fixture";
import { crewModuleSiOffForThisFile } from "./crewModuleSiSwitch.fixture";

// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"): this file's pins predate the
// free Sensor Suite, Bridge Module and Crew Quarters every ship now carries (their berths, officer lift, hull bonus
// and equipment ids), so the set is off here and the pins keep proving their own slice. The set itself is pinned in
// crewModuleStandardIssue.test.ts.
crewModuleSiOffForThisFile();

const RNG = (): number => 0.5;
const SWEEP: PatrolKey = "crimsonReaverSweep";
const WARBAND: PatrolKey = "crimsonReaverWarband";

const base = (hull: ShipTypeKey): GameState => asPatrolVeteran({ ...onHull(hull), nextPatrolSeed: 1, credits: new Decimal(100_000) });
const withDrive = (s: GameState, points: number): GameState => installPiece(s, { slotType: "ftlDrive", implicitStats: { transitSpeedMult: points } });
const patrolOf = (s: GameState): PatrolMissionState | null => s.captains[0].mission as PatrolMissionState | null;
const speedOf = (s: GameState): number => effectiveShipStats(s, s.ships[0]).transitSpeedMult;

function dispatch(s: GameState, key: PatrolKey, repeat = false): GameState {
  const r = dispatchCaptainOnPatrol(s, 1, key, "balanced", repeat);
  expect(r.success, String(r.reason)).toBe(true);
  return r.next;
}

// The route tick each phase began at, and the seconds until the run ended (1 s steps).
function flown(start: GameState): { phases: Record<string, number>; ended: number } {
  const phases: Record<string, number> = { transitOut: 0 };
  let s = start;
  let t = 0;
  while (patrolOf(s) !== null && t < 1000) {
    s = economyTick(s, 1, RNG);
    t += 1;
    const m = patrolOf(s);
    if (m !== null && phases[m.phase] === undefined) phases[m.phase] = t;
  }
  return { phases, ended: t };
}

describe("OC-D8: patrol legs scale with transit speed", () => {
  it("a slow hull's legs take longer: a Battleship's Sweep legs (3 ticks) take 5, its Warband legs (5) take 8", () => {
    const s = base("battleship");
    const speed = speedOf(s);
    expect(speed).toBeLessThan(1);
    for (const [key, out] of [[SWEEP, 5], [WARBAND, 8]] as const) {
      const def = PATROLS[key];
      const m = patrolOf(dispatch(s, key))!;
      expect(m.legTicks).toEqual({ out: Math.ceil(def.transitOutTicks / speed), back: Math.ceil(def.transitBackTicks / speed) });
      expect(m.legTicks!.out).toBe(out);
      const run = flown(dispatch(s, key));
      // A won run: the window opens where the frozen outbound leg ends, keeps its length, and the return is the frozen leg.
      expect(run.phases.engaging).toBe(out);
      expect(run.phases.transitBack).toBe(out + def.rollWindowTicks);
      expect(run.ended).toBe(out + def.rollWindowTicks + m.legTicks!.back);
    }
  });

  it("a faster drive shortens them, and the faster the shorter (monotone)", () => {
    const def = PATROLS[WARBAND];
    let last = Infinity;
    for (const points of [0, 30, 60, 120]) {
      const s = withDrive(base("destroyer"), points);
      const m = patrolOf(dispatch(s, WARBAND))!;
      const route = patrolRouteOf(m);
      expect(route.transitOutTicks).toBe(Math.ceil(def.transitOutTicks / speedOf(s)));
      expect(route.transitOutTicks).toBeLessThanOrEqual(last);
      last = route.transitOutTicks;
    }
    expect(last).toBeLessThan(def.transitOutTicks);
    const fast = withDrive(base("destroyer"), 30);
    const run = flown(dispatch(fast, WARBAND));
    expect(run.ended).toBeLessThan(patrolRouteTicks(def));
  });

  it("speed 1 is unchanged: no legs are written and the cycle is the one dispatched before the change", () => {
    expect(patrolLegTicksFor(PATROLS[SWEEP], 1)).toBeUndefined();
    expect(patrolLegTicksFor(PATROLS[WARBAND], 1)).toBeUndefined();
    // A speed whose rounding gives back the route's own legs writes none either.
    expect(patrolLegTicksFor(PATROLS[SWEEP], 1.1)).toBeUndefined();
    // A fixture ship at exactly speed 1 (the General Freighter's Standard Issue set).
    const s = base("generalFreighter");
    expect(speedOf(s)).toBe(1);
    const now = dispatch(s, WARBAND, true);
    expect(patrolOf(now)!.legTicks).toBeUndefined();
    expect(now).toEqual(withPatrolLegsOff(() => dispatch(s, WARBAND, true)));
    expect(patrolRouteOf(patrolOf(now)!)).toBe(PATROLS[WARBAND]);
  });

  it("a cycle dispatched before the change keeps the route's legs; the relaunch freezes the ship's", () => {
    const slow = base("battleship");
    const fresh = dispatch(slow, SWEEP, true);
    const legs = patrolOf(fresh)!.legTicks!;
    expect(legs.out).toBe(5);
    // As a save from before OC-D8 holds it: no legs, and the route's own wave schedule.
    const before = withPatrolLegsOff(() => dispatch(slow, SWEEP, true));
    const inFlight = asPreLegs(fresh, patrolOf(before)!.waveTicks);
    expect(patrolOf(inFlight)).toEqual(patrolOf(before));
    const def = PATROLS[SWEEP];
    let s = inFlight;
    for (let t = 0; t < patrolRouteTicks(def); t++) {
      s = economyTick(s, 1, RNG);
      // The first cycle flies the route's legs, its phases on the route's boundaries.
      if (t + 1 === def.transitOutTicks) expect(patrolOf(s)!.phase).toBe("engaging");
    }
    // Relaunched exactly at the route's own end, into a cycle with the ship's legs.
    const next = patrolOf(s)!;
    expect(next.routesCompletedThisRun).toBe(1);
    expect(next.progressTicks).toBe(0);
    expect(next.legTicks).toEqual(legs);
  });

  it("a cycle in flight keeps its frozen legs when the ship's speed changes; the next cycle reads the new speed", () => {
    const s0 = dispatch(base("battleship"), SWEEP, true);
    const legs = patrolOf(s0)!.legTicks!;
    let s = economyTick(s0, 2, RNG);
    s = withDrive(s, 120); // a much faster drive installed mid-cycle (a test edit; the game locks gear while out)
    const route = patrolRouteTicks(patrolRouteOf(patrolOf(s0)!));
    s = economyTick(s, route - 2, RNG);
    const next = patrolOf(s)!;
    expect(next.routesCompletedThisRun).toBe(1);
    const fastLegs = patrolLegTicksFor(PATROLS[SWEEP], speedOf(s));
    expect(next.legTicks).toEqual(fastLegs);
    expect((fastLegs?.out ?? PATROLS[SWEEP].transitOutTicks)).toBeLessThan(legs.out);
  });

  // Since 0.13.6 fuel is reach (refuel is instant and free): the reach gate reads the route's distance, so a slow ship
  // is never refused a route its tank covers because its legs take longer, and a fast one gains no range.
  it("reach (fuel) stays on the route's legs (distance), whatever the speed", () => {
    for (const s of [base("battleship"), withDrive(base("destroyer"), 120)]) {
      const def = PATROLS[WARBAND];
      const { route } = patrolDispatchRoute(s, s.ships[0], WARBAND);
      expect(route.transitOutTicks).not.toBe(def.transitOutTicks);
      expect(shipReachesRoundTrip(s, s.ships[0], def.transitOutTicks, def.transitBackTicks)).toBe(true);
      expect(canDispatchPatrol(s, 1, WARBAND)).toEqual(withPatrolLegsOff(() => canDispatchPatrol(s, 1, WARBAND)));
    }
  });

  it("the display replay and the recall read the cycle's own route", () => {
    const s = dispatch(base("battleship"), SWEEP, true);
    const m = patrolOf(s)!;
    const route = patrolRouteOf(m);
    const replay = replayPatrol(s, s.captains[0]);
    expect(replay.waves.map((w) => w.routeTick)).toEqual(m.waveTicks);
    expect(Math.min(...m.waveTicks)).toBeGreaterThanOrEqual(route.transitOutTicks);
    const recalled = recallCaptain(s, 1);
    expect(recalled.success).toBe(true);
    const r = patrolOf(recalled.next)!;
    expect([r.phase, r.progressTicks]).toEqual(["transitBack", route.transitOutTicks + route.rollWindowTicks]);
  });

  // OC-D8 follow-up (user 2026-10-30 "Yes, each its own leg"): Fast Departure lifts the outbound leg, Fast Return the
  // leg home, each at outboundLegSpeed / returnLegSpeed's arithmetic.
  it("each leg lift shortens its own leg only (patrolLegTicksFor)", () => {
    const def = PATROLS[WARBAND]; // 5-tick legs
    expect(patrolLegTicksFor(def, 0.8)).toEqual({ out: 7, back: 7 });
    expect(patrolLegTicksFor(def, 0.8, { out: 1.4 })).toEqual({ out: 5, back: 7 });
    expect(patrolLegTicksFor(def, 0.8, { back: 1.4 })).toEqual({ out: 7, back: 5 });
    // Lifts that bring both legs back to the route's write nothing, like speed 1.
    expect(patrolLegTicksFor(def, 0.8, { out: 1.4, back: 1.4 })).toBeUndefined();
    expect(withPatrolLegLiftsOff(() => patrolLegTicksFor(def, 0.8, { out: 1.4, back: 1.4 }))).toEqual({ out: 7, back: 7 });
  });

  it("the frozen legs survive a save and load", () => {
    const s = dispatch(base("battleship"), WARBAND, true);
    const loaded = migrate(deserialize(serialize(s, 0, 0))!);
    expect(patrolOf(loaded)!.legTicks).toEqual(patrolOf(s)!.legTicks);
  });
});
