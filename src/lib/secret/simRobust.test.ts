// simRobust.test.ts: the planned playtime holds when the steady player's day runs an hour later,
// and the other player types are reported (each in its own file so the gate runs them in parallel).
import { describe, it, expect } from "vitest";
import { simulatePlayer, LONG_STRETCH_DT } from "./sim";
import { timeline, expectPlannedBands, expectSixMonthBand, D } from "./simReport";

describe("robustness", () => {
  it("check-ins an hour later still land in every band, e10,000,000 included", () => {
    const r = simulatePlayer({ profile: "steady", days: 240, shiftHours: 1, longStretchDt: LONG_STRETCH_DT, stopAfterExponent: { exponent: 1e7, days: 20 } });
    timeline("steady+1h", r);
    expectPlannedBands(r);
    expectSixMonthBand(r);
  }, 900000);

  it("a light and a keen player reach the finale in a sensible range (reported)", () => {
    const light = simulatePlayer({ profile: "light", days: 12, stopAfterFinale: true });
    const keen = simulatePlayer({ profile: "keen", days: 12, stopAfterFinale: true });
    timeline("light", light);
    timeline("keen", keen);
    expect(light.events.finale).toBeLessThanOrEqual(8 * D);
    expect(keen.events.finale).toBeGreaterThanOrEqual(2.5 * D);
    expect(keen.events.finale).toBeLessThanOrEqual(light.events.finale);
  }, 240000);
});
