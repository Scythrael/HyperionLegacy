// OC-D8 FOLLOW-UP GOLDENS: the rows and their pins live in patrolLegLiftsGoldens.fixture.ts (captured on feat 336db4a
// before the follow-up, LIFTS_PINS_PRE; the wiring commit's moves, LIFTS_PINS_MOVED).
//
// LIFTS_CAPTURE = an output path: record every row instead of asserting.

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
canonicalOrderOffForThisFile();
// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
import { describe, expect, it } from "vitest";
// Gear wear close-out (2026-11-11: "Make it exact", "Keep the bay rate") came after every pin here: the file runs with it
// off (gearWearCloseoutSwitch.fixture.ts), so its pins keep proving their own slice (gearWearCloseoutGoldens.test.ts and
// gearWearCloseout.test.ts pin and prove what the close-out moved: leftover underway seconds at a run's end, a repair
// pause's or a field repair leg's edges credited at the rate that applied; gear keeping the bay rate until full).
import { gearWearCloseoutOffForThisFile, withCloseoutOn } from "./gearWearCloseoutSwitch.fixture";
gearWearCloseoutOffForThisFile();
// WR-8b (enemy torpedoes) came after every pin here: the file runs with it off (enemyTorpedoSwitch.fixture.ts), so its
// pins keep proving their own slice (enemyTorpedoGoldens.test.ts pins what WR-8b moved, enemyTorpedoes.test.ts proves it).
import { enemyTorpedoesOffForThisFile } from "./enemyTorpedoSwitch.fixture";
enemyTorpedoesOffForThisFile();
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
import { gearRepairJobOffForThisFile } from "./gearRepairJobSwitch.fixture";
// Gear wear step 5 review fix (the Overtime price) came after every pin here: a ship that ends a run home with worn
// gear gains its docked repair job record (ShipInstance.gearRepairJobMinutes), which moves only the state hash. The
// file ticks without the record, so its pins keep proving their own slice (gearWearStep5Fixes.test.ts pins the record).
gearRepairJobOffForThisFile();
import { hullCrewCapsOffForThisFile } from "./hullCrewCapsSwitch.fixture";
// Complement plan CP-5 (per-hull crew caps): every pin here predates CP-5 and is about another slice, so the file runs
// with the per-hull caps off (hullCrewCapsSwitch.fixture.ts); cp5Goldens.test.ts pins what CP-5 moved.
hullCrewCapsOffForThisFile();
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
  FLOWN_PINS_MOVED,
  FLOWN_PINS_PRE,
  asPreFlown,
  constRows,
  cutDispatch,
  cutRows,
  liftsDispatch,
  liftsRows,
  speedOnlyLegs,
} from "./patrolLegLiftsGoldens.fixture";
import { withPatrolLegLiftsOff, withPatrolRunClockOff } from "./patrolLegLiftsSwitch.fixture";
// The crewHours determinism fix (2026-10-30) came after these pins, which are about the patrol slices: the rows are
// read with the float crewHours counter (crewHoursMs.test.ts traces that move). The offline == live check runs live.
import { withCrewHoursFloat } from "./crewHoursSwitch.fixture";
import { wr9OffForThisFile } from "./wr9Switch.fixture";
// Homeworld reserve (user 2026-11-12; homeworldReserve.ts): this file's pins were captured before the reserve and hash a
// fleet whose surplus crew the reserve now moves out of the pool, so the whole file runs with it off and its pins keep
// proving their own slice (switch-off reproduction: every pin holds with it off). homeworldReserveGoldens pins the reserve.
import { homeworldReserveOffForThisFile } from "./homeworldReserveSwitch.fixture";
homeworldReserveOffForThisFile();
// Welcome batch (staging freeze 2026-11-14; transports.ts): this file's pins were captured before it and build their
// crew from a backlog longer than any catch-up (a fixture shortcut), so the whole file runs with it off and its pins
// keep proving their own slice (switch-off reproduction: every pin holds with it off). transportWelcome.test.ts pins it.
import { transportWelcomeOffForThisFile } from "./transportWelcomeSwitch.fixture";
import { fixRoundESwitchesOffForThisFile } from "./fixRoundESwitch.fixture";

// Fix round FR-E (0.14.0): Resume when safe (lane 4 I1, PATROL_RESUME_WHEN_SAFE_SWITCH: a Repeat repair pause ends once
// the next route is safe, not at full) moves the Repeat rows' repair pauses; the stop rule (lane 4 q3,
// PATROL_STOP_DOOMED_SWITCH: Repeat stops "outmatched" before a route it would lose even fully repaired) moves the
// Repeat rows that meet a route they would lose; and the pause's docked pricing (lane 4 M6,
// PAUSE_JOB_LIKE_DOCKED_SWITCH: a repair pause records the docked job's length for its Overtime) moves the pauses'
// records. The pins here predate the round and are about another slice, so the file runs with those fixes off
// (fixRoundESwitch.fixture.ts); every other fix of the round runs here. The round's own pins: patrolFixRoundE.test.ts.
fixRoundESwitchesOffForThisFile("resumeWhenSafe", "stopDoomed", "pauseJobLikeDocked");
transportWelcomeOffForThisFile();

// Wiring WR-9: this file's pins are about other slices and were captured before WR-9; it runs with WR-9 off (the
// WR-9 moves are pinned and proven in wr9Goldens.test.ts), so every pin here keeps proving its own slice exactly.
wr9OffForThisFile();

const CAPTURE = import.meta.env.LIFTS_CAPTURE as string | undefined;
// FLOWN_CAPTURE = an output path: record the count-only-flown rows instead of asserting.
const FLOWN_CAPTURE = import.meta.env.FLOWN_CAPTURE as string | undefined;
const RNG = (): number => 0.5;
// The whole state, each top-level key hashed on its own, and `discovered` as a set (patrolLegsGoldens' reading). The
// officers' promotion clock (crewHoursMs) is a whole-millisecond counter, so it is compared exactly too.
const keyedHash = (s: GameState): string => {
  const r = { ...s, discovered: [...s.discovered].sort() } as unknown as Record<string, unknown>;
  return hash(Object.fromEntries(Object.keys(r).sort().map((k) => [k, hash(r[k])])));
};

// Gear wear close-out (2026-11-11): this file runs with the close-out off (its pins above are the switch-off
// reproduction). With it ON, only the rows named here move, each pinned (and the same with the lifts off, the trace).
// Cause, "Keep the bay rate" alone (with only "Make it exact" on, nothing here moves): these Warband Repeat runs are
// lost, limp home and go into a Shipyard bay; their hull repair ends before their worn gear is full, and the gear now
// keeps the bay rate (ShipInstance.gearBayRate) instead of dropping to the home rate, which moves the state hash.
// GWCLOSE_ON_CAPTURE = an output path: write the moved rows there instead of asserting.
const CLOSEOUT_ON_LIFTS: Record<string, unknown> = {
  "repeat:prospectorRunner:crimsonReaverWarband:out": "1963cf20",
  "repeat:prospectorRunner:crimsonReaverWarband:back": "3500e262",
  "repeat:prospectorRunner:crimsonReaverWarband:both": "8b2dfcea",
  "repeat:aurora:crimsonReaverWarband:out": "5b2a084c",
  "repeat:aurora:crimsonReaverWarband:back": "d784630d",
  "repeat:aurora:crimsonReaverWarband:both": "6a70d732",
};
const CLOSEOUT_ON_LIFTS_OFF: Record<string, unknown> = {
  "repeat:prospectorRunner:crimsonReaverWarband:out": "bc51fe9b",
  "repeat:prospectorRunner:crimsonReaverWarband:back": "c6de5ec",
  "repeat:prospectorRunner:crimsonReaverWarband:both": "6046185",
  "repeat:aurora:crimsonReaverWarband:out": "5b2a084c",
  "repeat:aurora:crimsonReaverWarband:back": "d784630d",
  "repeat:aurora:crimsonReaverWarband:both": "6a70d732",
};
const movedFrom = (now: Record<string, unknown>, pins: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(now).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(pins[k])));

describe("OC-D8 follow-up goldens (patrol leg lifts, the Constitution run clock)", () => {
  it("close-out ON: every reading is its pin but the close-out's named moves (lifts on, and the lifts-off trace)", () => {
    const on = withCloseoutOn(() => withCrewHoursFloat(() => ({ ...liftsRows(), ...constRows() })));
    const off = withCloseoutOn(() => withCrewHoursFloat(() => withPatrolLegLiftsOff(liftsRows)));
    const offPins = Object.fromEntries(Object.keys(off).map((k) => [k, LIFTS_PINS_PRE[k]]));
    if (import.meta.env.GWCLOSE_ON_CAPTURE) {
      writeFileSync(String(import.meta.env.GWCLOSE_ON_CAPTURE), JSON.stringify({ on: movedFrom(on, { ...LIFTS_PINS_PRE, ...LIFTS_PINS_MOVED }), off: movedFrom(off, offPins) }, null, 1));
      return;
    }
    expect(on).toEqual({ ...LIFTS_PINS_PRE, ...LIFTS_PINS_MOVED, ...CLOSEOUT_ON_LIFTS });
    expect(off).toEqual({ ...offPins, ...CLOSEOUT_ON_LIFTS_OFF });
  }, 600_000);

  it("every reading matches its pin (the pre-change pins, with the follow-up's moves re-pinned)", () => {
    const now = withCrewHoursFloat(() => ({ ...liftsRows(), ...constRows() }));
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(now).toEqual({ ...LIFTS_PINS_PRE, ...LIFTS_PINS_MOVED });
  }, 600_000);

  it("with the lifts off (PATROL_LEG_LIFTS_SWITCH) every moved lift pin returns, and the clock rows are not theirs", () => {
    const off = withCrewHoursFloat(() => withPatrolLegLiftsOff(liftsRows));
    expect(off).toEqual(Object.fromEntries(Object.keys(off).map((k) => [k, LIFTS_PINS_PRE[k]])));
    expect(Object.keys(LIFTS_PINS_MOVED).filter((k) => !(k in off)).every((k) => k.startsWith("constMixed:"))).toBe(true);
  }, 600_000);

  it("with the run clock off (PATROL_RUN_CLOCK_SWITCH) every moved clock pin returns", () => {
    const off = withCrewHoursFloat(() => withPatrolRunClockOff(constRows));
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
  // state, a run mixing cycle lengths and a run whose return cut acts included. The span ends where the run ends (patrolLegsGoldens' note).
  it("one call == chunked == 1 s steps on a Constitution run", () => {
    for (const hull of CONST_HULLS) {
      for (const route of LIFTS_ROUTES) {
        // "cut": a run whose return cut acts (count only flown, an hour-long fleet tick).
        for (const mixed of [false, true, "cut"] as const) {
          const start = mixed === "cut" ? cutDispatch(hull, route) : constDispatch(hull, route, mixed);
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
    const now = withCrewHoursFloat(cutRows);
    if (FLOWN_CAPTURE) {
      writeFileSync(FLOWN_CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(now).toEqual({ ...FLOWN_PINS_PRE, ...FLOWN_PINS_MOVED });
  }, 600_000);

  it("with the run clock off (PATROL_RUN_CLOCK_SWITCH) every moved pin returns", () => {
    expect(withCrewHoursFloat(() => withPatrolRunClockOff(cutRows))).toEqual(FLOWN_PINS_PRE);
  }, 600_000);

  // The trace: at every route a run completes, the clock gains the cycle's route less, on a stamped cycle, its return
  // cut; a cycle in flight from before (unstamped) gains its full route. Only the constCut rows move.
  it("each moved pin is the clock counting only flown ticks", () => {
    expect(Object.keys(FLOWN_PINS_MOVED).every((k) => k.startsWith("constCut:"))).toBe(true);
    for (const hull of CONST_HULLS) {
      for (const route of LIFTS_ROUTES) {
        for (const inFlight of [false, true]) {
          const start = cutDispatch(hull, route);
          let s = inFlight ? asPreFlown(start) : start;
          let expected = 0;
          let cutCounted = false;
          for (let i = 0; i < CONST_SECONDS && s.captains[0].mission !== null; i++) {
            const before = s.captains[0].mission as PatrolMissionState;
            s = economyTick(s, 1, RNG);
            const m = s.captains[0].mission as PatrolMissionState | null;
            if (m === null) break;
            // Every cycle started here carries the stamp with its cut (the in-flight row's first cycle does not).
            if (m.masterSeed !== (start.captains[0].mission as PatrolMissionState).masterSeed) expect([hull, route, m.cutFlown]).toEqual([hull, route, (m.returnCutTicks ?? 0) > 0 ? 1 : undefined]);
            if (m.routesCompletedThisRun === before.routesCompletedThisRun) continue;
            const cut = before.cutFlown === 1 ? before.returnCutTicks ?? 0 : 0;
            if (cut > 0) cutCounted = true;
            expected += patrolRouteTicks(patrolRouteOf(before)) - cut;
            expect([hull, route, inFlight, m.routeTicksThisRun ?? m.routesCompletedThisRun * patrolRouteTicks(patrolRouteOf(m))]).toEqual([hull, route, inFlight, expected]);
          }
          if (`constCut:${hull}:${route}` in FLOWN_PINS_MOVED && !inFlight) expect([hull, route, cutCounted]).toEqual([hull, route, true]);
        }
      }
    }
  }, 600_000);
});
