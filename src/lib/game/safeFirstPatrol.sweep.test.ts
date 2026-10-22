// Safe first runs SF-4 (docs/plans/2026-10-15-safe-first-runs-plan.md section 4 SF-4): THE 1,000-SEED PROOF that the
// save's first patrol cannot be lost, and the patrol curve's win table. GATED (SF_SWEEP set, or `npm run
// test:sweep:patrol`):
//   1. proof : master seeds 0 to 999 x every hull x both routes x Dispatch Once and Dispatch Repeatedly, each a fresh
//              save's first patrol through safeFirstPatrol.fixture.ts proveTrainingPatrol (the training cycle, won, no
//              defeat, no limp, no damage, the route off the curve; Repeat flies on at the curve's floor). 40,000
//              patrols. The backstop (a lost wave breaks off) must never have fired: no lost wave at all.
//   2. curve : Dispatch Once over master seeds 0 to 399 (CURVE_SEEDS; 0 to 199 before WR-8 answer 5) at every curve
//              position (0 to 10 won routes after the safe patrol), every hull x both routes: wins never rise as the curve climbs (per hull and route), the top of
//              the curve equals a veteran's (full strength), the whole table pinned.
// The default run's fixed sample is safeFirstPatrol.test.ts.

import { describe, expect, it } from "vitest";
import { SWEEP } from "./firstRunsGoldens.fixture";
import { HULLS, ROUTES, onPatrolCurve, patrolBase, patrolWon, proveTrainingPatrol } from "./safeFirstPatrol.fixture";
import { N_FULL, runCountsOf } from "./runDifficulty";
import type { GameState } from "./model";

const SEEDS = 1000;
const CHUNK = 250;
const totals = { patrols: 0, waves: 0, brokeOff: 0 };

describe.runIf(SWEEP)("SF-4 the 1,000-seed proof (gated): the first patrol cannot be lost", () => {
  for (const hull of HULLS) {
    for (let from = 0; from < SEEDS; from += CHUNK) {
      it(`${hull}: seeds ${from} to ${from + CHUNK - 1} x both routes x Once and Repeat`, { timeout: 600_000 }, () => {
        for (let seed = from; seed < from + CHUNK; seed++) {
          for (const key of ROUTES) {
            for (const repeat of [false, true]) {
              const proof = proveTrainingPatrol(hull, key, seed, repeat);
              totals.patrols += 1;
              totals.waves += proof.waves;
              totals.brokeOff += proof.brokeOff;
            }
          }
        }
      });
    }
  }

  it("every patrol of the sweep was proven, every wave won (the backstop never fired)", () => {
    expect(totals.patrols).toBe(HULLS.length * SEEDS * ROUTES.length * 2);
    expect(totals.waves).toBe(totals.patrols * 2);
    expect(totals.brokeOff).toBe(0);
  });
});

const CURVE_SEEDS = 400;
// Wins of CURVE_SEEDS per curve position c = 0..10 (won routes after the safe patrol), Sweep then Warband. Measured on
// SF-4 with 200 seeds; the last column is full strength (a veteran's, checked above).
// WR-8 (0.14.0) moved every row: the fights open at range under the combat rules, the pirates carry armor and evasion,
// and (WR-8 review, user 2026-10-22) the stances park where their guns work, Defensive carries its modifiers and the
// pirates were softened (option 1: Raider armor 3 / evasion 3, Marauder 10 / 2, Corsair Carrier 8 / 1, no dampening).
// Before WR-8 (SF-4, wins of 200), for comparison:
//   generalFreighter: [[200, 200, 200, 200, 200, 200, 200, 200, 199, 197, 191], [181, 177, 135, 96, 76, 49, 26, 14, 9, 8, 5]],
//   prospectorHauler: [[200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 198], [194, 190, 170, 137, 114, 75, 49, 25, 18, 11, 10]],
//   prospectorRunner: [[200, 200, 200, 200, 200, 188, 164, 125, 108, 107, 106], [60, 49, 24, 15, 7, 5, 2, 0, 0, 0, 0]],
//   prospectorMiner: [[200, 200, 200, 200, 200, 198, 187, 158, 131, 110, 107], [80, 70, 36, 24, 14, 7, 4, 2, 0, 0, 0]],
//   destroyer: [[200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200], [200, 200, 198, 194, 188, 173, 140, 101, 80, 55, 44]],
//   battleship: [[200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200], [200, 200, 200, 200, 200, 199, 199, 189, 184, 172, 158]],
//   carrier: [[200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200], [200, 200, 200, 200, 200, 197, 186, 172, 160, 124, 109]],
//   orion: [[200, 200, 200, 200, 200, 200, 200, 198, 195, 184, 176], [105, 98, 77, 54, 39, 21, 13, 8, 4, 2, 1]],
//   aurora: [[200, 200, 200, 200, 200, 200, 200, 198, 194, 183, 174], [97, 90, 68, 51, 30, 15, 11, 6, 4, 2, 1]],
//   eir: [[200, 200, 200, 200, 200, 200, 200, 197, 191, 180, 172], [106, 98, 75, 53, 39, 18, 9, 8, 2, 1, 1]],
// WR-8 review answer 5 (user 2026-10-22, "Closing is evasive"): a ship closing while none of its guns reaches takes
// CLOSING_EVASION_PCT less. With it the 200-seed table broke "wins never rise" by one or two seeds (Aurora Warband c3
// 19 -> 20 at every tried value 20 to 60; per seed, the c2 -> c3 step flips about a dozen outcomes each way), so the
// curve now runs 400 seeds (CURVE_SEEDS), where every row falls. The early Sweep stays gentle (every hull wins 394 or
// more of 400 through c4; the combat hulls all 400). The early Warband stays harder for the light hulls than before
// WR-8 (Freighter c0 262 of 400, 131 of 200; was 181 of 200); closing evasion does not restore it, because the
// approach is short (about 7 s from the open distance) and both sides close. The balance pass owns it (user
// 2026-10-22: "the actual balancing of the content can wait").
const CURVE_WINS: Record<string, [number[], number[]]> = {
  generalFreighter: [[400, 400, 400, 400, 400, 400, 400, 395, 383, 366, 354], [262, 238, 174, 128, 95, 51, 29, 15, 9, 7, 6]],
  prospectorHauler: [[400, 400, 400, 400, 400, 400, 400, 400, 398, 390, 377], [331, 310, 244, 194, 143, 91, 54, 28, 23, 13, 9]],
  prospectorRunner: [[400, 400, 400, 399, 394, 362, 313, 219, 208, 207, 206], [53, 42, 22, 18, 7, 3, 2, 1, 1, 1, 1]],
  prospectorMiner: [[400, 400, 400, 400, 397, 381, 358, 275, 221, 208, 208], [78, 63, 39, 26, 14, 7, 3, 1, 1, 1, 1]],
  destroyer: [[400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400], [387, 379, 372, 353, 324, 273, 217, 151, 114, 86, 64]],
  battleship: [[400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400], [400, 400, 400, 400, 400, 398, 397, 384, 378, 355, 348]],
  carrier: [[400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400], [399, 396, 390, 386, 371, 345, 319, 253, 222, 175, 150]],
  orion: [[400, 400, 400, 400, 400, 400, 398, 388, 371, 353, 335], [89, 78, 54, 37, 25, 17, 10, 5, 3, 3, 2]],
  aurora: [[400, 400, 400, 400, 400, 400, 397, 387, 369, 352, 328], [76, 67, 41, 35, 23, 16, 9, 5, 3, 3, 2]],
  eir: [[400, 400, 400, 400, 400, 399, 396, 378, 365, 345, 305], [90, 81, 54, 39, 24, 14, 10, 4, 3, 2, 2]],
};

function asVeteran(state: GameState): GameState {
  const counts = runCountsOf(state);
  return { ...state, runCounts: { ...counts, patrol: { dispatched: 4, completed: 1, veteran: true } } };
}

describe.runIf(SWEEP)("SF-4 the patrol curve (gated): wins never rise as the curve climbs", () => {
  for (const hull of HULLS) {
    it(`${hull}: wins of ${CURVE_SEEDS} at every curve position, both routes`, { timeout: 600_000 }, () => {
      const rows = ROUTES.map((key) => {
        const row: number[] = [];
        for (let c = 0; c < N_FULL; c++) {
          let wins = 0;
          for (let seed = 0; seed < CURVE_SEEDS; seed++) if (patrolWon(onPatrolCurve(patrolBase(hull, seed), c), key, seed)) wins += 1;
          row.push(wins);
        }
        let veteran = 0;
        for (let seed = 0; seed < CURVE_SEEDS; seed++) if (patrolWon(asVeteran(patrolBase(hull, seed)), key, seed)) veteran += 1;
        expect(row[N_FULL - 1], `${hull} ${key}: the top of the curve is full strength`).toBe(veteran);
        for (let c = 1; c < row.length; c++) expect(row[c], `${hull} ${key} c${c}`).toBeLessThanOrEqual(row[c - 1]);
        return row;
      });
      expect([rows[0], rows[1]], hull).toEqual(CURVE_WINS[hull]);
    });
  }
});
