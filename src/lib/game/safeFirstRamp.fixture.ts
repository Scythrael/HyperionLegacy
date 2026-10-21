// TEST-ONLY helpers for safe first runs SF-3 (docs/plans/2026-10-15-safe-first-runs-plan.md section 4 SF-3): the runs
// AFTER the training run, on the difficulty curve. Shared by safeFirstRamp.test.ts (a fixed sample, the default run)
// and safeFirstRamp.sweep.test.ts (200 seeds per curve position, gated). The SF-0 method (firstRunsGoldens.fixture.ts):
// freshState, ship-1 retyped to the hull with its Standard-Issue gear, no officers, nothing edited after dispatch, the
// run advanced in one call to SWEEP_END. Never imported by app code.

import type { GameState, ShipTypeKey } from "./model";
import { advanceExpedition, makeExpeditionSeed, startExpedition } from "./expedition";
import { onHull, runOutcome, SWEEP_END, VAULT_SITES, withCrew, type CrewName } from "./firstRunsGoldens.fixture";
import { runCountsOf } from "./runDifficulty";
import { asPreG2NamesDispatch } from "./awayTeamTestFixtures";

// The sweep seeds: the save's expedition seed set to makeExpeditionSeed(RAMP_SEED_BASE, i), candidate 0 dispatched
// (the section 2.5 B method).
export const RAMP_SEED_BASE = 0x1234567;

// `state` with its training run behind it and `completed` ordinary runs claimed after it (not a veteran), so its next
// expedition is run `completed + 2` on the curve. Pure.
export function afterTraining(state: GameState, completed: number): GameState {
  const counts = runCountsOf(state);
  return { ...state, nextExpeditionId: completed + 2, runCounts: { ...counts, expedition: { completed, trainingDone: true, veteran: false } } };
}

// One run's outcome, as the sweep counts it.
export interface RampOutcome {
  stalled: boolean; // an objective held and flagged at SWEEP_END
  anyLost: boolean; // at least one lost fight
  lostFights: number;
  fights: number;
  vaultSites: number;
  vaultWon: number; // Vault and Subterranean objectives done
}

// Dispatch `cand` on hull `hull` with `crew`, `completed` runs after the training run, the save's expedition seed
// `seed` (undefined: freshState's, the three fresh candidates), and advance it with no player action. Pure.
export function rampRun(hull: ShipTypeKey, crew: CrewName, completed: number, seed: number | undefined, cand = "cand-0"): RampOutcome {
  const state = afterTraining(withCrew(onHull(hull, seed), crew), completed);
  // Merged with G2-2 / G2-3: dispatched as before G2-2 (no region, no voyage: the fixed pre-G2-3 legs), so the measured
  // curve table keeps measuring the curve alone (the voyage's timing moved a few stalled runs' lost-fight counts by 1).
  const res = asPreG2NamesDispatch(startExpedition(state, "ship-1", 1, cand));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const done = advanceExpedition(res.expedition, SWEEP_END);
  const o = runOutcome(done);
  const tasks = done.bodies.flatMap((b) => b.activities).filter((t) => VAULT_SITES.has(t.poiId));
  return {
    stalled: o.stalled,
    anyLost: o.lostFights > 0,
    lostFights: o.lostFights,
    fights: (done.groundOps?.history ?? []).filter((r) => r.outcome !== undefined).length,
    vaultSites: tasks.length,
    vaultWon: tasks.filter((t) => t.done).length,
  };
}

// The sweep seed `i`. Pure.
export const rampSeed = (i: number): number => makeExpeditionSeed(RAMP_SEED_BASE, i);

// Sums over a set of runs.
export interface RampTally {
  runs: number;
  stalled: number;
  anyLost: number;
  lostFights: number;
  vaultSites: number;
  vaultWon: number;
}
export function tally(outcomes: readonly RampOutcome[]): RampTally {
  return {
    runs: outcomes.length,
    stalled: outcomes.filter((o) => o.stalled).length,
    anyLost: outcomes.filter((o) => o.anyLost).length,
    lostFights: outcomes.reduce((n, o) => n + o.lostFights, 0),
    vaultSites: outcomes.reduce((n, o) => n + o.vaultSites, 0),
    vaultWon: outcomes.reduce((n, o) => n + o.vaultWon, 0),
  };
}
