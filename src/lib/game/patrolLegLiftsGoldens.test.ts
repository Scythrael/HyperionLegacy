// OC-D8 FOLLOW-UP GOLDENS: the rows and their pins live in patrolLegLiftsGoldens.fixture.ts (captured on feat 336db4a
// before the follow-up, LIFTS_PINS_PRE; the wiring commit's moves, LIFTS_PINS_MOVED).
//
// LIFTS_CAPTURE = an output path: record every row instead of asserting.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { economyTick } from "./tick";
import { hash } from "./firstRunsGoldens.fixture";
import type { GameState } from "./model";
import { CONST_HULLS, CONST_SECONDS, LIFTS_PINS_MOVED, LIFTS_PINS_PRE, LIFTS_ROUTES, constDispatch, constRows, liftsRows } from "./patrolLegLiftsGoldens.fixture";

const CAPTURE = import.meta.env.LIFTS_CAPTURE as string | undefined;
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
