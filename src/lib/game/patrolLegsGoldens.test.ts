// WR-7 follow-up OC-D8 PATROL LEGS GOLDENS: the rows and their pins live in patrolLegsGoldens.fixture.ts (captured on
// feat 0fcee45 before the legs scaled with transit speed, LEGS_PINS_PRE; the wiring commit's moves, LEGS_PINS_MOVED).
//
// LEGS_CAPTURE = an output path: record every row instead of asserting.

import { describe, expect, it } from "vitest";
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
import { patrolUseWearOffForThisFile } from "./patrolUseWearSwitch.fixture";
// Gear wear step 5 (patrol use wear) came after every pin here: the file dispatches its patrols unstamped, so its pins
// keep proving their own slice (gearWearStep5Goldens.test.ts pins what step 5 moved on a patrol).
patrolUseWearOffForThisFile();
import { writeFileSync } from "node:fs";
import { economyTick } from "./tick";
import { hash } from "./firstRunsGoldens.fixture";
import { PATROLS, type GameState, type PatrolMissionState } from "./model";
import { LEGS_HULLS, LEGS_LOADOUTS, LEGS_PINS_MOVED, LEGS_PINS_PRE, LEGS_ROUTES, REPEAT_SECONDS, legsDispatch, legsRows } from "./patrolLegsGoldens.fixture";
import { withPatrolLegsOff } from "./patrolLegsSwitch.fixture";

const CAPTURE = import.meta.env.LEGS_CAPTURE as string | undefined;
const RNG = (): number => 0.5;
// The whole state, each top-level key hashed on its own, and `discovered` as a set: a call over a span and the same span
// in steps may build the top-level keys in a different order and first see the same items in a different order (both
// true before the legs scaled too), which is not a different state.
const keyedHash = (s: GameState): string => {
  const r = { ...s, discovered: [...s.discovered].sort() } as unknown as Record<string, unknown>;
  return hash(Object.fromEntries(Object.keys(r).sort().map((k) => [k, hash(r[k])])));
};

describe("OC-D8 patrol legs goldens", () => {
  it("every reading matches its pin (the pre-change pins, with the legs' moves re-pinned)", () => {
    const now = legsRows();
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(now).toEqual({ ...LEGS_PINS_PRE, ...LEGS_PINS_MOVED });
  }, 600_000);

  it("with the legs off (PATROL_LEGS_SWITCH) every moved pin returns", () => {
    expect(withPatrolLegsOff(legsRows)).toEqual(LEGS_PINS_PRE);
  }, 600_000);

  // The trace: a run moves exactly when its cycle froze legs other than the route's, and a moved Dispatch Once run moves
  // by its legs alone: each phase after the outbound leg starts that leg's change later, the ending lands both legs'
  // change later (a lost run's limp home is twice its return leg), with the same outcome.
  it("each moved pin is the legs", () => {
    const shift = (timeline: string, dOut: number): string =>
      timeline
        .split(",")
        .map((p) => {
          const [phase, at] = p.split("@");
          return phase === "transitOut" ? p : `${phase}@${Number(at) + dOut}`;
        })
        .join(",");
    let moved = 0;
    for (const hull of LEGS_HULLS) {
      for (const route of LEGS_ROUTES) {
        for (const loadout of LEGS_LOADOUTS) {
          const key = `${hull}:${route}:${loadout}`;
          const m = legsDispatch(hull, route, loadout, false).captains[0].mission as PatrolMissionState;
          const legs = m.legTicks;
          expect([key, `once:${key}` in LEGS_PINS_MOVED, `replay:${key}` in LEGS_PINS_MOVED]).toEqual([key, legs !== undefined, legs !== undefined]);
          expect([key, `inFlight:${key}` in LEGS_PINS_MOVED]).toEqual([key, false]);
          if (`repeat:${key}` in LEGS_PINS_MOVED) expect([key, legs]).not.toEqual([key, undefined]);
          if (legs === undefined) continue;
          moved += 1;
          const def = PATROLS[route];
          const dOut = legs.out - def.transitOutTicks;
          const dBack = legs.back - def.transitBackTicks;
          const pre = LEGS_PINS_PRE[`once:${key}`] as string[];
          const post = LEGS_PINS_MOVED[`once:${key}`] as string[];
          const [outcome, ticks] = pre[2].split(":");
          const ended = Number(ticks) + dOut + (outcome === "lost" ? 2 : 1) * dBack;
          expect([key, post[1], post[2]]).toEqual([key, shift(pre[1], dOut), `${outcome}:${ended}`]);
        }
      }
    }
    expect(moved).toBe(27);
  }, 600_000);

  // Offline == live: one call over the whole span, 7 s chunks and 1 s steps land on the same state (relaunches, waves,
  // the wear and a limp home included). The span ends where the run ends (at most REPEAT_SECONDS): a Shipyard repair
  // queued inside a call starts counting down at the next call, so a span running on past the end of a lost run reads
  // differently in steps (true before the legs scaled; not a patrol reading).
  it("one call == chunked == 1 s steps on a Repeat run", () => {
    for (const hull of LEGS_HULLS) {
      for (const route of LEGS_ROUTES) {
        for (const loadout of LEGS_LOADOUTS) {
          const start = legsDispatch(hull, route, loadout, true);
          let stepped = start;
          let span = 0;
          while (span < REPEAT_SECONDS && stepped.captains[0].mission !== null) {
            stepped = economyTick(stepped, 1, RNG);
            span += 1;
          }
          const once = keyedHash(economyTick(start, span, RNG));
          let chunked = start;
          for (let t = 0; t < span; t += 7) chunked = economyTick(chunked, Math.min(7, span - t), RNG);
          const want = [hull, route, loadout, span, keyedHash(stepped)];
          expect([hull, route, loadout, span, once], "one call").toEqual(want);
          expect([hull, route, loadout, span, keyedHash(chunked)], "chunked").toEqual(want);
        }
      }
    }
  }, 600_000);
});
