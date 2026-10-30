// OC-D8 FOLLOW-UP GOLDENS: the rows and their pins live in patrolLegLiftsGoldens.fixture.ts (captured on feat 336db4a
// before the follow-up, LIFTS_PINS_PRE; the wiring commit's moves, LIFTS_PINS_MOVED).
//
// LIFTS_CAPTURE = an output path: record every row instead of asserting.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { economyTick } from "./tick";
import { hash } from "./firstRunsGoldens.fixture";
import { patrolRouteOf, patrolRouteTicks, type GameState, type PatrolMissionState } from "./model";
import {
  CONST_HULLS,
  CONST_SECONDS,
  LIFTS_CREWS,
  LIFTS_HULLS,
  LIFTS_PINS_MOVED,
  LIFTS_PINS_PRE,
  LIFTS_ROUTES,
  constDispatch,
  FLOWN_PINS_PRE,
  constRows,
  cutDispatch,
  cutRows,
  liftsDispatch,
  liftsRows,
  speedOnlyLegs,
} from "./patrolLegLiftsGoldens.fixture";
import { withPatrolLegLiftsOff, withPatrolRunClockOff } from "./patrolLegLiftsSwitch.fixture";

const CAPTURE = import.meta.env.LIFTS_CAPTURE as string | undefined;
// FLOWN_CAPTURE = an output path: record the count-only-flown rows instead of asserting.
const FLOWN_CAPTURE = import.meta.env.FLOWN_CAPTURE as string | undefined;
const RNG = (): number => 0.5;
// The whole state, each top-level key hashed on its own, and `discovered` as a set (patrolLegsGoldens' reading). The
// officers' promotion clock (promotionCounters.crewHours) sums a float per call, so one call and 1 s steps land on it
// a few ulps apart (true before this follow-up, and not a patrol reading): it is compared to 12 significant digits.
const officersRounded = (s: GameState): unknown =>
  s.officers.map((o) => {
    const c = (o as { promotionCounters?: { crewHours?: number } }).promotionCounters;
    return c?.crewHours === undefined ? o : { ...o, promotionCounters: { ...c, crewHours: Number(c.crewHours.toPrecision(12)) } };
  });
const keyedHash = (s: GameState): string => {
  const r = { ...s, discovered: [...s.discovered].sort(), officers: officersRounded(s) } as unknown as Record<string, unknown>;
  return hash(Object.fromEntries(Object.keys(r).sort().map((k) => [k, hash(r[k])])));
};

describe("OC-D8 follow-up goldens (patrol leg lifts, the Constitution run clock)", () => {
  it("every reading matches its pin (the pre-change pins, with the follow-up's moves re-pinned)", () => {
    const now = { ...liftsRows(), ...constRows() };
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(now).toEqual({ ...LIFTS_PINS_PRE, ...LIFTS_PINS_MOVED });
  }, 600_000);

  it("with the lifts off (PATROL_LEG_LIFTS_SWITCH) every moved lift pin returns, and the clock rows are not theirs", () => {
    const off = withPatrolLegLiftsOff(liftsRows);
    expect(off).toEqual(Object.fromEntries(Object.keys(off).map((k) => [k, LIFTS_PINS_PRE[k]])));
    expect(Object.keys(LIFTS_PINS_MOVED).filter((k) => !(k in off)).every((k) => k.startsWith("constMixed:"))).toBe(true);
  }, 600_000);

  it("with the run clock off (PATROL_RUN_CLOCK_SWITCH) every moved clock pin returns", () => {
    const off = withPatrolRunClockOff(constRows);
    expect(off).toEqual(Object.fromEntries(Object.keys(off).map((k) => [k, LIFTS_PINS_PRE[k]])));
  }, 600_000);

  // The trace: a lift row moves exactly when the lifted legs differ from the sweeping speed's, and a moved Dispatch Once
  // run moves by its legs alone (the patrolLegsGoldens trace); the replay moves only with the outbound leg.
  it("each moved lift pin is the lifted legs", () => {
    const shift = (timeline: string, dOut: number): string =>
      timeline
        .split(",")
        .map((p) => {
          const [phase, at] = p.split("@");
          return phase === "transitOut" ? p : `${phase}@${Number(at) + dOut}`;
        })
        .join(",");
    let moved = 0;
    for (const hull of LIFTS_HULLS) {
      for (const route of LIFTS_ROUTES) {
        for (const crew of LIFTS_CREWS) {
          const key = `${hull}:${route}:${crew}`;
          const s = liftsDispatch(hull, route, crew, false);
          const lifted = patrolRouteOf(s.captains[0].mission as PatrolMissionState);
          const plain = patrolRouteOf({ patrolKey: route, legTicks: speedOnlyLegs(s) });
          const dOut = lifted.transitOutTicks - plain.transitOutTicks;
          const dBack = lifted.transitBackTicks - plain.transitBackTicks;
          // A lift only ever shortens its own leg; Fast Departure never touches the leg home, Fast Return never the way out.
          expect([key, dOut <= 0, dBack <= 0]).toEqual([key, true, true]);
          if (crew === "out") expect([key, dBack]).toEqual([key, 0]);
          if (crew === "back") expect([key, dOut]).toEqual([key, 0]);
          const legsMoved = dOut !== 0 || dBack !== 0;
          expect([key, `once:${key}` in LIFTS_PINS_MOVED, `replay:${key}` in LIFTS_PINS_MOVED, `inFlight:${key}` in LIFTS_PINS_MOVED]).toEqual([key, legsMoved, dOut !== 0, false]);
          if (`repeat:${key}` in LIFTS_PINS_MOVED) expect([key, legsMoved]).toEqual([key, true]);
          if (!legsMoved) continue;
          moved += 1;
          const pre = LIFTS_PINS_PRE[`once:${key}`] as string[];
          const post = LIFTS_PINS_MOVED[`once:${key}`] as string[];
          const [outcome, ticks] = pre[2].split(":");
          const ended = Number(ticks) + dOut + (outcome === "lost" ? 2 : 1) * dBack;
          expect([key, post[1], post[2]]).toEqual([key, shift(pre[1], dOut), `${outcome}:${ended}`]);
        }
      }
    }
    expect(moved).toBe(21);
  }, 600_000);

  // The clock trace: only a run that mixes cycle lengths moves, and only it stores the summed route ticks.
  it("each moved clock pin is a run mixing cycle lengths", () => {
    for (const hull of CONST_HULLS) {
      for (const route of LIFTS_ROUTES) {
        expect([hull, route, `constSteady:${hull}:${route}` in LIFTS_PINS_MOVED]).toEqual([hull, route, false]);
        let s = constDispatch(hull, route, true);
        const first = patrolRouteTicks(patrolRouteOf(s.captains[0].mission as PatrolMissionState));
        let stored = false;
        for (let i = 0; i < CONST_SECONDS && s.captains[0].mission !== null; i++) {
          s = economyTick(s, 1, RNG);
          const m = s.captains[0].mission as PatrolMissionState | null;
          if (m?.routeTicksThisRun !== undefined) {
            stored = true;
            // The sum: the first cycle's route plus every later cycle's own (the relaunches all freeze the ship's legs).
            const later = patrolRouteTicks(patrolRouteOf(m));
            expect(m.routeTicksThisRun).toBe(first + (m.routesCompletedThisRun - 1) * later);
          }
        }
        const mixed = first !== patrolRouteTicks(patrolRouteOf(constDispatch(hull, route, false).captains[0].mission as PatrolMissionState));
        expect([hull, route, stored]).toEqual([hull, route, mixed && stored]);
        if (`constMixed:${hull}:${route}` in LIFTS_PINS_MOVED) expect([hull, route, mixed, stored]).toEqual([hull, route, true, true]);
      }
    }
  }, 600_000);

  // Offline == live on the Constitution run clock: one call over the span, 7 s chunks and 1 s steps land on the same
  // state, a run mixing cycle lengths included. The span ends where the run ends (patrolLegsGoldens' note).
  it("one call == chunked == 1 s steps on a Constitution run", () => {
    for (const hull of CONST_HULLS) {
      for (const route of LIFTS_ROUTES) {
        for (const mixed of [false, true]) {
          const start = constDispatch(hull, route, mixed);
          let stepped = start;
          let span = 0;
          while (span < CONST_SECONDS && stepped.captains[0].mission !== null) {
            stepped = economyTick(stepped, 1, RNG);
            span += 1;
          }
          const once = keyedHash(economyTick(start, span, RNG));
          let chunked = start;
          for (let t = 0; t < span; t += 7) chunked = economyTick(chunked, Math.min(7, span - t), RNG);
          const want = [hull, route, mixed, span, keyedHash(stepped)];
          expect([hull, route, mixed, span, once], "one call").toEqual(want);
          expect([hull, route, mixed, span, keyedHash(chunked)], "chunked").toEqual(want);
        }
      }
    }
  }, 600_000);
});

// "Count only flown" (user 2026-10-30): the Constitution run clock on runs whose return cut acts (an hour-long fleet
// tick), captured on fc1ff7c before the change (FLOWN_PINS_PRE).
describe("count only flown goldens (the Constitution run clock with a return cut)", () => {
  it("every run carries a return cut (the rows read the rule)", () => {
    for (const hull of CONST_HULLS) {
      for (const route of LIFTS_ROUTES) {
        const m = cutDispatch(hull, route).captains[0].mission as PatrolMissionState;
        expect([hull, route, (m.returnCutTicks ?? 0) > 0]).toEqual([hull, route, true]);
      }
    }
  });

  it("every reading matches its pin", () => {
    const now = cutRows();
    if (FLOWN_CAPTURE) {
      writeFileSync(FLOWN_CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(now).toEqual(FLOWN_PINS_PRE);
  }, 600_000);
});
