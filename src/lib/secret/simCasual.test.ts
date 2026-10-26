// simCasual.test.ts: the casual player's timeline, pinned (0.13.11.1 curve round). Two 15-minute
// check-ins a day after a 90-minute first session (sim.ts). Bands leave room for a milestone moving
// by a check-in or two. (Content pacing, "About 4 months": the casual e10,000,000 measured 140.6 days.)
import { describe, it, expect } from "vitest";
import { simulatePlayer, LONG_STRETCH_DT } from "./sim";
import { timeline, expectSlowsAfterStarfall, D, H } from "./simReport";

describe("the casual player", () => {
  it("first Captain under an hour, finale in 5.5 to 8.5 days, e1,000,000 in 38 to 58 days, e10,000,000 in 125 to 160 days", () => {
    const r = simulatePlayer({ profile: "casual", days: 340, longStretchDt: LONG_STRETCH_DT, stopAfterExponent: { exponent: 1e7, days: 20 } });
    timeline("casual", r);
    const e = r.events;
    expect(e.captain1).toBeLessThanOrEqual(H);
    expect(e.finale).toBeGreaterThanOrEqual(5.5 * D);
    expect(e.finale).toBeLessThanOrEqual(8.5 * D);
    expect(e.long).toBeGreaterThanOrEqual(38 * D);
    expect(e.long).toBeLessThanOrEqual(58 * D);
    expect(e.starfall).toBeGreaterThanOrEqual(125 * D);
    expectSlowsAfterStarfall(r);
    expect(e.starfall).toBeLessThanOrEqual(160 * D);
  }, 900000);
});
