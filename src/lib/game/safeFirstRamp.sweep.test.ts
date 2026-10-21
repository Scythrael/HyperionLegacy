// Safe first runs SF-3, THE SWEEP (gated: SF_SWEEP set, or `npm run test:sweep:ramp`; about 4 minutes): 200 Tier I seeds
// per curve position (the save's expedition seed makeExpeditionSeed(0x1234567, i), candidate 0, the section 2.5 B
// method) for an Orion with the D18 minimum crew and a full rank 1 crew, the training run done and 0 to 10 runs
// completed after it (run 2 to run 12, full strength since the SF-3 review). Each cell is pinned (stalled runs, runs
// with a lost fight, lost fights, Vault and Subterranean objectives won : held), and the plan's claims are checked on
// the pinned table:
//   - the stall count and the lost fights never fall as the curve rises (both crews);
//   - the weakest launchable crew finishes run 2 at least 95% of the time.
// The plan's [PROVISIONAL] nominal targets (full rank 1 completes 95%, wins 90% of its Vault and Subterranean sites at
// full strength) are REPORTED, not asserted: the user's 2026-10-16 ruling makes comfortable nominal Tier I a full team
// wearing the first Quartermaster set, whose stats are not built yet (model.ts STANDARD_ISSUE_IMPLICIT_MAGNITUDE 0).
// Measured (SF-3 review build: Weak fades, the climb ends at run 12): at full strength (run 12) full rank 1 with no gear
// completes 125 of 200 runs and wins 231 of its 365 Vault and Subterranean objectives (every hold a Challenging or
// harder Vault or Subterranean final: the FKR-1 Elite and Boss leads); run 11 completes 181 and wins 341 of 366. The D18
// minimum completes run 2 on 195 of 200; its own breaking point is run 6 to 7 (stalls 97 to 175 of 200), where the
// faded strength first outgrows two rank 1 members with no gear, not a step in the curve (0.43 to 0.51 of nominal).

import { describe, expect, it } from "vitest";
import { SWEEP } from "./firstRunsGoldens.fixture";
import { rampRun, rampSeed, tally, type RampTally } from "./safeFirstRamp.fixture";

const SEEDS = 200;
const KS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const CREWS = ["d18", "rank1"] as const;

// Measured on this build: per curve position (completed 0 to 9), "stalled/anyLost/lostFights/vaultWon:vaultSites".
const TABLE: Record<(typeof CREWS)[number], string[]> = {
  d18: [
    "5/132/2351/377:383", "15/146/2666/363:381", "56/159/3786/308:380", "82/175/5203/231:380", "97/177/5968/203:378",
    "175/187/7142/8:376", "176/188/7340/0:369", "183/192/7490/0:369", "184/192/7522/0:369", "187/192/7612/0:366",
    "187/192/7641/0:365",
  ],
  rank1: [
    "0/1/1/383:383", "0/2/2/381:381", "0/12/15/380:380", "0/27/35/380:380", "0/38/58/378:378",
    "0/63/192/376:376", "0/89/386/369:369", "4/119/928/364:369", "6/145/2483/361:369", "19/164/4178/341:366",
    "75/179/5426/231:365",
  ],
};

const cell = (t: RampTally): string => `${t.stalled}/${t.anyLost}/${t.lostFights}/${t.vaultWon}:${t.vaultSites}`;
const measured: Record<string, RampTally[]> = { d18: [], rank1: [] };

describe.runIf(SWEEP)("SF-3 the sweep (gated): 200 Tier I seeds per curve position", () => {
  for (const crew of CREWS) {
    for (const k of KS) {
      it(`Orion ${crew}, ${k} runs completed after the training run (run ${k + 2})`, { timeout: 600_000 }, () => {
        const t = tally(Array.from({ length: SEEDS }, (_, i) => rampRun("orion", crew, k, rampSeed(i))));
        measured[crew][k] = t;
        expect(cell(t)).toBe(TABLE[crew][k]);
      });
    }
  }

  it("the claims on the table: difficulty never falls as the curve rises; the weakest crew finishes run 2", () => {
    for (const crew of CREWS) {
      const rows = measured[crew];
      expect(rows).toHaveLength(KS.length);
      for (let k = 1; k < rows.length; k += 1) {
        expect(rows[k].stalled, `${crew} k=${k}`).toBeGreaterThanOrEqual(rows[k - 1].stalled);
        expect(rows[k].anyLost, `${crew} k=${k}`).toBeGreaterThanOrEqual(rows[k - 1].anyLost);
      }
    }
    expect(measured.d18[0].stalled / SEEDS).toBeLessThanOrEqual(0.05);
  });
});
