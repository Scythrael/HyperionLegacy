// patrolCatchUp.perf.test.ts (0.14.0 release blocker, PATROL CATCH-UP PERFORMANCE): the offline catch-up of a fleet with
// five Repeat combat patrols, in production tick() 1 s steps.
//
// Excluded from the default suite (vite.config.ts) and run alone, serially, by `npm run test:perf`, like
// oldSaveFirstLoad.perf.test.ts. The fleet (patrolPerf.fixture.ts patrolFleet): 11 ships, five combat hulls on a Repeat
// Crimson Reaver Sweep in mixed stances, six idle, 400 spares, the welcome crew seated. Before the pass a 4-day catch-up
// of it took 8 to 10 minutes on a desktop (about 2,200 us a step, measured 2026-11-16 on the dev box; 0.13.11.3 about
// 112 us); after it, about 285 us a step bundled and 364 us here under vitest (the parity test proves the results are the
// same). The budget leaves about 2.5x headroom on the dev box and fails long before the old cost.
import { describe, expect, it } from "vitest";
import { report } from "../secret/testReport";
import { tick } from "./tick";
import { lcg, patrolFleet } from "./patrolPerf.fixture";

const HOUR = 3600;
const DAY = 86400;
const PER_STEP_BUDGET_US = 900;

describe("a five-patrol fleet catches up fast", () => {
  it(`one hour of 1 s steps stays under ${PER_STEP_BUDGET_US} us a step`, () => {
    // Ten minutes first, so the timed hour is the steady state (patrols in mid-run, repair pauses and relaunches).
    const warm = tick(600, patrolFleet(), lcg(0x15));
    const t0 = performance.now();
    const out = tick(HOUR, warm, lcg(0x16));
    const ms = performance.now() - t0;
    const perStepUs = (ms / HOUR) * 1000;
    report(`[perf] five Repeat patrols, 1 h of 1 s steps: ${ms.toFixed(0)} ms, ${perStepUs.toFixed(1)} us a step, 4 days ~ ${((perStepUs * 4 * DAY) / 1e6).toFixed(0)} s`);
    // Not vacuous: the five patrols are still flying.
    expect(out.captains.filter((c) => c.mission?.kind === "patrol").length).toBe(5);
    expect(perStepUs).toBeLessThan(PER_STEP_BUDGET_US);
  }, 600000);
});
