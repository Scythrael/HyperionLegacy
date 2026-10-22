// Safe first runs SF-4 (docs/plans/2026-10-15-safe-first-runs-plan.md section 4 SF-4): THE 1,000-SEED PROOF that the
// save's first patrol cannot be lost, and the patrol curve's win table. GATED (SF_SWEEP set, or `npm run
// test:sweep:patrol`):
//   1. proof : master seeds 0 to 999 x every hull x both routes x Dispatch Once and Dispatch Repeatedly, each a fresh
//              save's first patrol through safeFirstPatrol.fixture.ts proveTrainingPatrol (the training cycle, won, no
//              defeat, no limp, no damage, the route off the curve; Repeat flies on at the curve's floor). 40,000
//              patrols. The backstop (a lost wave breaks off) must never have fired: no lost wave at all.
//   2. curve : Dispatch Once over master seeds 0 to 199 at every curve position (0 to 10 won routes after the safe
//              patrol), every hull x both routes: wins never rise as the curve climbs (per hull and route), the top of
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

const CURVE_SEEDS = 200;
// Wins of 200 per curve position c = 0..10 (won routes after the safe patrol), Sweep then Warband. Measured on SF-4;
// the last column is full strength and equals the SF-0 200-seed WINS table (firstRunsGoldens.test.ts), a veteran's.
// WR-8 (0.14.0) moved every row: the fights open at range under the combat rules, the pirates carry armor and evasion,
// and (WR-8 review, user 2026-10-22) the stances park where their guns work, Defensive carries its modifiers and the
// pirates were softened (option 1: Raider armor 3 / evasion 3, Marauder 10 / 2, Corsair Carrier 8 / 1, no dampening).
// Before WR-8 (SF-4), for comparison:
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
// The early Sweep stays gentle (every hull wins 194 or more of 200 through c4; the combat hulls all 200). The Warband
// is harder early for the light hulls (Freighter c0 129, was 181; Orion 48, was 105): the WR-8 approach (an enemy
// railgun's free shots while a short-gunned ship closes) costs more than the pirates' mitigation (with zero pirate armor
// and evasion a veteran Freighter still wins 88 of 100 Sweeps, 97 before WR-8). The balance pass owns it (user
// 2026-10-22: "the actual balancing of the content can wait"). Every row still never rises as the curve climbs.
const CURVE_WINS: Record<string, [number[], number[]]> = {
  generalFreighter: [[200, 200, 200, 200, 200, 200, 199, 195, 189, 182, 174], [129, 119, 86, 63, 44, 19, 15, 9, 7, 5, 2]],
  prospectorHauler: [[200, 200, 200, 200, 200, 200, 200, 199, 196, 194, 185], [167, 157, 114, 90, 68, 46, 26, 14, 12, 8, 6]],
  prospectorRunner: [[200, 200, 199, 198, 194, 180, 143, 109, 108, 107, 107], [25, 20, 10, 8, 5, 2, 1, 0, 0, 0, 0]],
  prospectorMiner: [[200, 200, 200, 199, 198, 188, 178, 127, 111, 108, 108], [38, 35, 19, 14, 8, 5, 2, 0, 0, 0, 0]],
  destroyer: [[200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200], [195, 189, 186, 180, 168, 142, 114, 76, 59, 43, 28]],
  battleship: [[200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200], [200, 200, 200, 200, 200, 199, 197, 188, 184, 178, 176]],
  carrier: [[200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200], [199, 198, 195, 191, 185, 174, 166, 133, 114, 91, 80]],
  orion: [[200, 200, 200, 200, 200, 199, 198, 195, 185, 176, 171], [48, 42, 27, 21, 16, 8, 5, 3, 2, 1, 1]],
  aurora: [[200, 200, 200, 200, 200, 199, 198, 195, 184, 176, 168], [38, 32, 20, 19, 16, 7, 4, 3, 2, 1, 1]],
  eir: [[200, 200, 200, 200, 200, 199, 198, 188, 181, 173, 155], [48, 44, 27, 21, 16, 7, 5, 2, 2, 1, 1]],
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
