// Safe first runs SF-3, THE SWEEP (gated: SF_SWEEP set, or `npm run test:sweep:ramp`; about 4 minutes): 200 Tier I seeds
// per curve position (the save's expedition seed makeExpeditionSeed(0x1234567, i), candidate 0, the section 2.5 B
// method) for an Orion with the D18 minimum crew and a full rank 1 crew, the training run done and 0 to 10 runs
// completed after it (run 2 to run 12, full strength since the SF-3 review). Each cell is pinned (stalled runs, runs
// with a lost fight, lost fights, Vault and Subterranean objectives won : held), and the plan's claims are checked on
// the pinned table:
//   - the stall count and the lost fights never fall as the curve rises (both crews);
//   - the weakest launchable crew finishes run 2 at least 95% of the time.
// The plan's [PROVISIONAL] nominal targets (full rank 1 completes 95%, wins 90% of its Vault and Subterranean sites at
// full strength) are REPORTED for the bare crews: the user's 2026-10-16 ruling makes comfortable nominal Tier I a full
// team wearing the first Quartermaster set, and they are ASSERTED on that team (the rank1si row, below).
// Measured (WR-10 fix round build, 2026-11-10): at full strength (run 12) full rank 1 with no gear completes 125 of 200
// runs and wins 232 of its 369 Vault and Subterranean objectives (every hold a Challenging or harder Vault or
// Subterranean final: the FKR-1 Elite and Boss leads); run 11 completes 176 and wins 341 of 369. The D18 minimum
// completes run 2 on 195 of 200; its own breaking point is run 6 to 7 (stalls 99 to 175 of 200), where the faded
// strength first outgrows two rank 1 members with no gear, not a step in the curve (0.43 to 0.51 of nominal).
// The Quartermaster set (0.14.0, the rank1si row; the targets are ASSERTED on it): the same team in Standard-Issue gear
// completes 192 of 200 at full strength (run 12) and wins 359 of 369 Vault and Subterranean objectives; run 11 193 and
// 362 of 369; runs 2 to 8 finish every run and every vault (run 9: 199 of 200, 372 of 373).

import { describe, expect, it } from "vitest";
import { SWEEP } from "./firstRunsGoldens.fixture";
import { rampRun, rampSeed, tally, type RampTally } from "./safeFirstRamp.fixture";

const SEEDS = 200;
const KS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
// rank1si (0.14.0): the full rank 1 crew wearing the Quartermaster's Standard-Issue set (firstRunsGoldens.fixture.ts).
const CREWS = ["d18", "rank1", "rank1si"] as const;

// Measured on this build: per curve position (completed 0 to 9), "stalled/anyLost/lostFights/vaultWon:vaultSites".
// Re-pinned by the Wiring WR-10 fix round (2026-11-10): the away rules on every new run (Neural Backup waits for its wearer,
// Fall Back shields, the casters' Corroded on the odds ramp, Science rank lifts fieldwork, the Suppress linger, Quick
// Draw's shrug). The table had also drifted before WR-10 (later slices moved some cells); the plan's "WR-10 fix round:
// the ramp sweep" note gives the old pins, these new ones and the same sweep with WR-10 switched off, side by side.
const TABLE: Record<(typeof CREWS)[number], string[]> = {
  d18: [
    "5/132/2350/377:383", "15/146/2665/363:381", "57/159/3822/307:380", "82/174/5278/232:380", "99/177/6006/202:380",
    "175/187/7117/8:378", "176/188/7325/0:376", "183/192/7467/0:373", "185/192/7526/0:370", "187/192/7612/0:369",
    "187/192/7641/0:369",
  ],
  rank1: [
    "0/1/1/383:383", "0/2/2/381:381", "0/11/13/380:380", "0/25/30/380:380", "0/37/58/380:380",
    "0/64/205/378:378", "0/87/430/376:376", "4/120/910/369:373", "6/148/2552/362:370", "24/167/4157/341:369",
    "75/179/5468/232:369",
  ],
  rank1si: [
    "0/0/0/383:383", "0/1/1/381:381", "0/3/4/380:380", "0/8/11/380:380", "0/19/25/380:380",
    "0/38/68/378:378", "0/56/159/376:376", "1/98/452/372:373", "4/118/820/365:370", "7/140/1821/362:369",
    "8/161/3684/359:369",
  ],
};

const cell = (t: RampTally): string => `${t.stalled}/${t.anyLost}/${t.lostFights}/${t.vaultWon}:${t.vaultSites}`;
const measured: Record<string, RampTally[]> = { d18: [], rank1: [], rank1si: [] };

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

  // The plan's nominal Tier I targets, now that the Quartermaster set is built (user 2026-10-16 "Full team + upgrade"):
  // at full strength a full rank 1 team in the Standard-Issue set completes at least 95% of its runs and wins at least
  // 90% of its Vault and Subterranean objectives.
  it("the nominal targets: a full rank 1 team in the Standard-Issue set at full strength", () => {
    const full = measured.rank1si[KS.length - 1];
    expect(full).toBeDefined();
    expect((SEEDS - full.stalled) / SEEDS).toBeGreaterThanOrEqual(0.95);
    expect(full.vaultWon / full.vaultSites).toBeGreaterThanOrEqual(0.9);
  });
});
