// sim.test.ts: the planned playtime, pinned (design section 7). The steady player's offline gaps
// run through the SHIPPING catch-up (6-hour exact window), exactly as the game pays them.
import { describe, it } from "vitest";
import { simulatePlayer } from "./sim";
import { timeline, expectPlannedBands } from "./simReport";

describe("steady player pacing", () => {
  it("lands in the planned bands: first Captain in 30 to 60 min, finale in 3 to 5 days, e1,000,000 in about a month, still climbing after", () => {
    const r = simulatePlayer({ profile: "steady", days: 45, stopAfterLongDays: 7.1 });
    timeline("steady", r);
    expectPlannedBands(r);
  }, 240000);
});
