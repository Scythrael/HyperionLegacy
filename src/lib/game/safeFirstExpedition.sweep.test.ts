// Safe first runs SF-2 (docs/plans/2026-10-15-safe-first-runs-plan.md section 4 SF-2, "the proof tests (the heart of
// the plan)"): THE 500-SEED PROOF that the training run cannot be lost. GATED (SF_SWEEP set, or `npm run
// test:sweep:training`): 500 Tier I seeds (the save's expedition seed makeExpeditionSeed(0x5afe2, i), candidate 0) on
// each explorer (Orion, Aurora, Eir) x five crews: the D18 minimum (the weakest launchable crew: 1 Security + 1 Science,
// rank 1, no gear), the real fresh board's first Security and first Science hire and all ten hires at board window
// i mod 6, a full rank-1 crew, and a full rank-1 crew with a passive complement. Everything on auto, no player
// action. Every run must pass safeFirstExpedition.fixture.ts proveTrainingRun: never stuck at any 10,000 s checkpoint,
// complete with every objective done, the window closed, no lost fight (the backstop never fires), no send-back, no
// hull damage, no ship-event setback, no boarding loss, claimed with the ship undamaged. 7,500 runs.
// The default run's fixed sample is safeFirstExpedition.test.ts.

import { describe, expect, it } from "vitest";
import type { ShipTypeKey } from "./model";
import { makeExpeditionSeed } from "./expedition";
import { SWEEP } from "./firstRunsGoldens.fixture";
import { D18, EXPLORERS, RANK1, RANK1_COMPLEMENT, boardCrew, proveTrainingRun, provingState } from "./safeFirstExpedition.fixture";

const SEEDS = 500;
const CHUNK = 50;
const CREWS_PER_SEED = 5;

const totals = { runs: 0, objectives: 0, fights: 0, events: 0 };

function proveSeeds(hull: ShipTypeKey, from: number, to: number): void {
  for (let i = from; i < to; i++) {
    const seed = makeExpeditionSeed(0x5afe2, i);
    for (const crew of [D18, boardCrew(i % 6), boardCrew(i % 6, true), RANK1, RANK1_COMPLEMENT]) {
      const proof = proveTrainingRun(provingState(hull, crew, seed), "cand-0", `${hull} seed ${i} ${crew.name}`);
      totals.runs += 1;
      totals.objectives += proof.objectives;
      totals.fights += proof.fights;
      totals.events += proof.events;
    }
  }
}

describe.runIf(SWEEP)("SF-2 the 500-seed proof (gated): the training run cannot be lost", () => {
  for (const hull of EXPLORERS) {
    for (let from = 0; from < SEEDS; from += CHUNK) {
      it(`${hull}: seeds ${from} to ${from + CHUNK - 1} x five crews`, { timeout: 600_000 }, () => proveSeeds(hull, from, from + CHUNK));
    }
  }

  it("every run of the sweep was proven, and the runs were not vacuous (objectives, won fights and passed ship events)", () => {
    expect(totals.runs).toBe(EXPLORERS.length * SEEDS * CREWS_PER_SEED);
    expect(totals.objectives).toBeGreaterThan(totals.runs);
    expect(totals.fights).toBeGreaterThan(totals.runs);
    expect(totals.events).toBeGreaterThan(0);
  });
});
