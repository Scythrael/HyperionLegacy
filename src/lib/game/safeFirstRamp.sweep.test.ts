// Safe first runs SF-3, THE SWEEP (gated: SF_SWEEP set, or `npm run test:sweep:ramp`; about 4 minutes): 200 Tier I seeds
// per curve position (the save's expedition seed makeExpeditionSeed(0x1234567, i), candidate 0, the section 2.5 B
// method) for an Orion with the D18 minimum crew and a full rank 1 crew, the training run done and 0 to 9 runs
// completed after it (run 2 to run 11, full strength). Each cell is pinned (stalled runs, runs with a lost fight, lost
// fights, Vault and Subterranean objectives won : held), and the plan's claims are checked on the pinned table:
//   - the stall count and the lost fights never fall as the curve rises (both crews);
//   - the weakest launchable crew finishes run 2 at least 95% of the time.
// The plan's [PROVISIONAL] nominal targets (full rank 1 completes 95%, wins 90% of its Vault and Subterranean sites at
// full strength) are REPORTED, not asserted: the user's 2026-10-16 ruling makes comfortable nominal Tier I a full team
// wearing the first Quartermaster set, whose stats are not built yet (model.ts STANDARD_ISSUE_IMPLICIT_MAGNITUDE 0).
// Measured: at full strength (run 11) full rank 1 with no gear completes 125 of 200 runs and wins 231 of its 365 Vault
// and Subterranean objectives (every hold is a Challenging or harder Vault or Subterranean final: the FKR-1 Elite and
// Boss leads); the D18 minimum completes run 2 on 195 of 200.

import { describe, expect, it } from "vitest";
import { SWEEP } from "./firstRunsGoldens.fixture";
import { rampRun, rampSeed, tally, type RampTally } from "./safeFirstRamp.fixture";

const SEEDS = 200;
const KS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const CREWS = ["d18", "rank1"] as const;

// Measured on this build: per curve position (completed 0 to 9), "stalled/anyLost/lostFights/vaultWon:vaultSites".
const TABLE: Record<(typeof CREWS)[number], string[]> = {
  d18: [
    "5/132/2351/377:383", "15/146/2650/363:381", "55/157/3613/309:380", "79/167/4865/245:380", "89/176/5740/223:378",
    "136/177/6133/182:376", "182/192/7467/0:369", "184/192/7520/0:369", "187/192/7612/0:368", "187/192/7641/0:365",
  ],
  rank1: [
    "0/1/1/383:383", "0/2/2/381:381", "0/8/9/380:380", "0/22/32/380:380", "0/36/46/378:378",
    "0/49/96/376:376", "1/111/673/368:369", "6/136/1436/361:369", "10/162/3986/356:368", "75/179/5426/231:365",
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
