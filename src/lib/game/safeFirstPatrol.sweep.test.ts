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
// curve runs 400 seeds (CURVE_SEEDS; user 2026-10-22 answer 7: approved), where every row falls.
// WR-8 review answer 6 (user 2026-10-22, "Ship it, soften early curve"): a patrol cycle under the combat rules climbs
// the curve from PATROL_RULES_RAMP_FLOOR (0.2, the shared floor is 0.35), so the light hulls' early Warbands are back
// near their pre-WR-8 values (Freighter c0 373 of 400, 186.5 of 200, was 181 of 200 before WR-8 and 262 of 400 just
// before this; the prospectors gentler than before, the explorers a little under: Orion c0 94.5 of 200, was 105).
// Full strength (c10) is unchanged. The early Sweep is 400 of 400 through c4 on every hull.
// WR-8 follow-up review fix 3 (2026-10-23: the evasive state is read after the move) moved 48 cells by 9 of 400 at most
// (Runner Sweep c7 267, was 276; Freighter Warband c0 unchanged at 373, c10 5, was 6); every row still falls.
const CURVE_WINS: Record<string, [number[], number[]]> = {
  generalFreighter: [[400, 400, 400, 400, 400, 400, 400, 399, 392, 371, 351], [373, 362, 314, 257, 163, 95, 41, 24, 11, 7, 5]],
  prospectorHauler: [[400, 400, 400, 400, 400, 400, 400, 400, 398, 392, 377], [392, 382, 361, 328, 220, 146, 81, 40, 24, 13, 9]],
  prospectorRunner: [[400, 400, 400, 400, 400, 396, 357, 267, 211, 208, 206], [167, 141, 95, 49, 22, 9, 3, 2, 1, 1, 1]],
  prospectorMiner: [[400, 400, 400, 400, 400, 398, 373, 341, 247, 208, 208], [239, 204, 133, 75, 38, 15, 4, 2, 1, 1, 1]],
  destroyer: [[400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400], [399, 397, 394, 389, 367, 332, 259, 192, 132, 98, 64]],
  battleship: [[400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400], [400, 400, 400, 400, 400, 400, 397, 392, 380, 367, 348]],
  carrier: [[400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400], [400, 400, 400, 399, 389, 375, 343, 293, 246, 198, 149]],
  orion: [[400, 400, 400, 400, 400, 400, 400, 397, 385, 357, 331], [189, 162, 125, 88, 50, 23, 13, 8, 5, 3, 2]],
  aurora: [[400, 400, 400, 400, 400, 400, 400, 396, 382, 353, 327], [169, 147, 108, 75, 44, 23, 13, 8, 5, 3, 2]],
  eir: [[400, 400, 400, 400, 400, 400, 399, 393, 372, 351, 304], [196, 171, 129, 90, 56, 25, 12, 6, 3, 2, 2]],
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
