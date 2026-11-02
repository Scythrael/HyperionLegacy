// catchUp.perf.test.ts: the catch-up's wall-clock bounds. Excluded from the default suite (vite.config.ts) and run
// alone, serially, by `npm run test:perf`: under a full parallel run the other workers load the machine and the
// timings measure that load, not the catch-up. The deterministic halves (the step bound, the result equality) stay in
// catchUp.test.ts. Full gates = suite + check + test:perf.
import { report } from "./testReport";
import { describe, it, expect, beforeAll } from "vitest";
import { advanceTo, createCatchUp, EXACT_BOUND_SECONDS, MAX_CATCHUP_STEPS } from "./catchUp";
import { serializeSecret, type SecretState } from "./state";
import { midAutoState, pastFinaleState } from "./testStates";

const H = 3600;

let states: Record<"mid" | "pastFinale", SecretState>;
beforeAll(() => {
  states = { mid: midAutoState(), pastFinale: pastFinaleState() };
}, 240000);

describe("catch-up stays fast", () => {
  it("a 30-day gap stays fast and never blocks: bounded steps, 8 ms slices", () => {
    const s = states.mid;
    const job = createCatchUp(s, s.lastTickAt + 30 * 24 * H * 1000);
    const t0 = performance.now();
    let slices = 0;
    let longest = 0;
    for (;;) {
      const a = performance.now();
      const finished = job.runFor(8);
      longest = Math.max(longest, performance.now() - a);
      slices += 1;
      if (finished) break;
    }
    const ms = performance.now() - t0;
    const r = job.result();
    report(`[perf] 30-day catch-up: ${r.steps} steps, ${ms.toFixed(0)} ms of work over ${slices} slices, longest slice ${longest.toFixed(1)} ms`);
    expect(r.steps).toBeLessThanOrEqual(MAX_CATCHUP_STEPS);
    expect(ms).toBeLessThan(5000);
    expect(longest).toBeLessThan(25);
    expect(serializeSecret(r.state)).toBe(serializeSecret(advanceTo(s, s.lastTickAt + 30 * 24 * H * 1000).state));
  }, 60000);

  it("a full exact window stays fast too", () => {
    const s = states.pastFinale;
    const t0 = performance.now();
    const r = advanceTo(s, s.lastTickAt + EXACT_BOUND_SECONDS * 1000);
    const ms = performance.now() - t0;
    report(`[perf] 6-hour exact catch-up: ${r.steps} steps in ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1500);
  }, 60000);
});
