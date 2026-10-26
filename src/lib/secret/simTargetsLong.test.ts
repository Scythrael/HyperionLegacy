// simTargetsLong.test.ts: the default targets stay best all the way to e10,000,000 (final re-check:
// the target sweeps stopped at e1,000,000). The steady player with every auto target at 200% reaches
// e10,000,000 no sooner than at the default 100% (simReport DEFAULT_STEADY), within the margin.
import { describe, it, expect } from "vitest";
import { simulatePlayer, LONG_STRETCH_DT } from "./sim";
import { timeline, DEFAULT_STEADY, TARGET_MARGIN, D } from "./simReport";

describe("target sweep to e10,000,000", () => {
  it("200% on every layer is no better than 100% at e10,000,000", () => {
    const r = simulatePlayer({ profile: "steady", days: 300, targets: { captain: 200, fleet: 200, pc: 200 }, longStretchDt: LONG_STRETCH_DT, stopAfterExponent: { exponent: 1e7, days: 0.5 } });
    timeline("targets 200% to e10M", r);
    // never reaching e10,000,000 inside the simulated days counts as later
    if (r.events.starfall !== undefined) expect(r.events.starfall).toBeGreaterThanOrEqual(DEFAULT_STEADY.starfall * (1 - TARGET_MARGIN));
    else expect(300 * D).toBeGreaterThan(DEFAULT_STEADY.starfall);
  }, 900000);
});
