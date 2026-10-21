// Quartermaster Standard-Issue member gear (0.14.0), THE SWEEP (gated: SF_SWEEP set, or `npm run test:sweep:si`): what
// the free set does for a full rank 1 team on nominal Tier I, measured two ways on this code, each beside the same crew
// wearing nothing:
//   SF-0 : the section 2.5 B method (60 seeds, dispatched as before safe first runs: no ramp, raw hazard, the
//          shakedown), the Orion rank 1 row of firstRunsGoldens.sweep.test.ts.
//   full : 200 of the SF-3 sweep's seeds (makeExpeditionSeed(0x1234567, i)) on a veteran save at full strength.
// Each cell is "complete/runs, runs with a lost fight, lost fights, Vault and Subterranean objectives won:held", pinned.
// The plan's nominal targets (a full rank 1 team completes 95% of runs and wins 90% of its Vault / Subterranean sites)
// are asserted on the SF-3 ramp at full strength (safeFirstRamp.sweep.test.ts, the rank1si row); this file proves the
// set's direction on both records: the kit never makes a row worse, and it finishes more runs and sites.

import { describe, expect, it } from "vitest";
import type { Expedition } from "./model";
import { advanceExpedition, makeExpeditionSeed, startExpedition } from "./expedition";
import { onHull, runOutcome, SWEEP, SWEEP_END, VAULT_SITES, withCrew, type CrewName } from "./firstRunsGoldens.fixture";
import { asExpeditionVeteran, asPreG2NamesDispatch, asPreRanksDispatch, asPreSafeFirstRunsDispatch } from "./awayTeamTestFixtures";

interface Tally {
  runs: number;
  complete: number;
  anyLost: number;
  lostFights: number;
  vaultWon: number;
  vaultSites: number;
}

function tally(done: readonly Expedition[]): Tally {
  const t: Tally = { runs: done.length, complete: 0, anyLost: 0, lostFights: 0, vaultWon: 0, vaultSites: 0 };
  for (const d of done) {
    const o = runOutcome(d);
    const vaults = d.bodies.flatMap((b) => b.activities).filter((a) => VAULT_SITES.has(a.poiId));
    if (!o.stalled) t.complete += 1;
    if (o.lostFights > 0) t.anyLost += 1;
    t.lostFights += o.lostFights;
    t.vaultSites += vaults.length;
    t.vaultWon += vaults.filter((a) => a.done).length;
  }
  return t;
}
const cell = (t: Tally): string => `${t.complete}/${t.runs} ${t.anyLost} ${t.lostFights} ${t.vaultWon}:${t.vaultSites}`;

function sf0Run(seed: number, crew: CrewName): Expedition {
  const res = asPreG2NamesDispatch(asPreSafeFirstRunsDispatch(asPreRanksDispatch(startExpedition(withCrew(onHull("orion", makeExpeditionSeed(0x1234567, seed)), crew), "ship-1", 1, "cand-0"))));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return advanceExpedition(res.expedition, SWEEP_END);
}

function fullRun(seed: number, crew: CrewName): Expedition {
  const res = startExpedition(asExpeditionVeteran(withCrew(onHull("orion", makeExpeditionSeed(0x1234567, seed)), crew)), "ship-1", 1, "cand-0");
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return advanceExpedition(res.expedition, SWEEP_END);
}

// Measured on this build (SF-3's ramp merged: a veteran save reads full strength, the Tier I hazard ceiling and kits).
// The SF-0 bare row is the section 2.5 B table's Orion rank 1 row (40 of 60 stalled). In words: the set takes the SF-0
// row from 20 to 36 finished runs of 60 and its Vault / Subterranean wins from 38 to 68 of 108; at full strength from
// 122 to 193 of 200 finished and 227 to 356 of 365 sites won (the plan's 95% / 90% targets: 96.5% / 97.5%).
const TABLE: Record<string, string> = {
  "sf0:rank1": "20/60 56 2118 38:108",
  "sf0:rank1si": "36/60 52 1690 68:108",
  "full:rank1": "122/200 176 5508 227:365",
  "full:rank1si": "193/200 155 3727 356:365",
};

const measured: Record<string, Tally> = {};

describe.runIf(SWEEP)("Standard-Issue member gear, the sweep (gated): a full rank 1 Orion crew with and without the set", () => {
  for (const crew of ["rank1", "rank1si"] as const) {
    it(`SF-0 method, 60 seeds, ${crew}`, { timeout: 600_000 }, () => {
      measured[`sf0:${crew}`] = tally(Array.from({ length: 60 }, (_, i) => sf0Run(i, crew)));
      expect(cell(measured[`sf0:${crew}`])).toBe(TABLE[`sf0:${crew}`]);
    });
    it(`full strength, 200 seeds, ${crew}`, { timeout: 600_000 }, () => {
      measured[`full:${crew}`] = tally(Array.from({ length: 200 }, (_, i) => fullRun(i, crew)));
      expect(cell(measured[`full:${crew}`])).toBe(TABLE[`full:${crew}`]);
    });
  }

  it("the set never makes a row worse, and finishes more runs and more Vault / Subterranean sites", () => {
    for (const method of ["sf0", "full"]) {
      const bare = measured[`${method}:rank1`];
      const kit = measured[`${method}:rank1si`];
      expect(kit.complete, method).toBeGreaterThan(bare.complete);
      expect(kit.vaultWon, method).toBeGreaterThan(bare.vaultWon);
      expect(kit.lostFights, method).toBeLessThan(bare.lostFights);
    }
  });
});
