// WR-7 follow-up OC-D8 PATROL LEGS GOLDENS FIRST: the rows and their pre-change pins live in
// patrolLegsGoldens.fixture.ts (captured on feat 0fcee45, before the legs scaled with transit speed).
//
// LEGS_CAPTURE = an output path: record every row instead of asserting.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { economyTick } from "./tick";
import { hash } from "./firstRunsGoldens.fixture";
import type { GameState } from "./model";
import { LEGS_HULLS, LEGS_LOADOUTS, LEGS_PINS_PRE, LEGS_ROUTES, REPEAT_SECONDS, legsDispatch, legsRows } from "./patrolLegsGoldens.fixture";

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
  it("every reading matches its pin", () => {
    const now = legsRows();
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(now).toEqual(LEGS_PINS_PRE);
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
