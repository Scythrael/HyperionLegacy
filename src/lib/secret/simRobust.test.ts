// simRobust.test.ts: the planned playtime holds when the steady player's day runs an hour later,
// and the other player types are reported (each in its own file so the gate runs them in parallel).
import { describe, it, expect } from "vitest";
import { simulatePlayer } from "./sim";
import { timeline, expectPlannedBands, D } from "./simReport";

describe("robustness", () => {
  it("check-ins an hour later still land in every band", () => {
    const r = simulatePlayer({ profile: "steady", days: 45, stopAfterLongDays: 7.1, shiftHours: 1 });
    timeline("steady+1h", r);
    expectPlannedBands(r);
  }, 240000);

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
