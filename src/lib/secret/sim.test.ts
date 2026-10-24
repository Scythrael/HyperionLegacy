// sim.test.ts: the planned playtime, pinned (0.13.11 design section 7, 0.13.11.1 design section 6).
// One steady player from a fresh game to 20 days past e10,000,000. Up to e1,000,000 the offline
// gaps run through the SHIPPING catch-up (6-hour exact window), exactly as the game pays them, so
// the 0.13.11 bands are checked unchanged; after e1,000,000 the gaps run as 10-second coarse steps
// (LONG_STRETCH_DT) so six months simulate in about a minute.
import { describe, it, expect } from "vitest";
import { simulatePlayer, LONG_STRETCH_DT } from "./sim";
import { timeline, expectPlannedBands, expectSixMonthBand, DEFAULT_STEADY } from "./simReport";

describe("steady player pacing", () => {
  it("first Captain in 30 to 60 min, finale in 3 to 5 days, e1,000,000 in about a month, e10,000,000 in about four months (content pacing)", () => {
    const r = simulatePlayer({ profile: "steady", days: 280, longStretchDt: LONG_STRETCH_DT, stopAfterExponent: { exponent: 1e7, days: 20 } });
    timeline("steady", r);
    expectPlannedBands(r);
    expectSixMonthBand(r);
    // The target sweeps (simTargets*.test.ts) compare against these default-target pins.
    expect(r.events.finale / DEFAULT_STEADY.finale).toBeCloseTo(1, 2);
    expect(r.events.long / DEFAULT_STEADY.long).toBeCloseTo(1, 2);
  }, 900000);
});
