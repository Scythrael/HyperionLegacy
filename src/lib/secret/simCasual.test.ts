// simCasual.test.ts: the casual player's timeline, pinned (0.13.11.1 curve round). Two 15-minute
// check-ins a day after a 90-minute first session (sim.ts). Bands leave room for a milestone moving
// by a check-in or two. (Content pacing, "About 4 months": the casual e10,000,000 measured 140.6 days.)
// 0.14.0 prestige redesign, user 2026-10-28 "Accept, re-pin casual": with the automations earned at
// milestones the casual player keeps pace with the average one once they arrive (that catch-up is the QoL
// point), so the bands moved to the new measurement (6.07 / 33.24 / 113.61 days; before 6.86 / 47.84 /
// 140.65 with finale 5.5 to 8.5, e1,000,000 38 to 58 and e10,000,000 125 to 160). Review round: the player's own
// first Prestigeception (Auto Prestigeception granted off until revealed, user 2026-10-29) took the measured casual
// finale to 4.82 days at PC_BAR_RATIO 2, so the finale floor moved from 5 to 4 days (5.62 / 32.71 / 123.28 at 3;
// Slice 5a retune, pay at the bar and PC_BAR_RATIO 2: 4.81 / 32.50 / 120.61).
import { describe, it, expect } from "vitest";
import { simulatePlayer, LONG_STRETCH_DT } from "./sim";
import { timeline, expectSlowsAfterStarfall, D, H, RELIC_FREE, RELIC_GOALS } from "./simReport";

describe("the casual player", () => {
  it("first Captain under an hour, finale in 4 to 7.5 days, e1,000,000 in 28 to 41 days, e10,000,000 in 105 to 135 days", () => {
    const r = simulatePlayer({ profile: "casual", days: 340, longStretchDt: LONG_STRETCH_DT, stopAfterExponent: { exponent: 1e7, days: 20 } });
    timeline("casual", r);
    const e = r.events;
    expect(e.captain1).toBeLessThanOrEqual(H);
    expect(e.finale).toBeGreaterThanOrEqual(4 * D);
    expect(e.finale).toBeLessThanOrEqual(7.5 * D);
    // R2-10: the relic pins compare against these relic-free numbers (simReport RELIC_FREE.casual)
    for (const g of RELIC_GOALS) expect(e[g] / D, g).toBeCloseTo(RELIC_FREE.casual[g], 2);
    expect(e.long).toBeGreaterThanOrEqual(28 * D);
    expect(e.long).toBeLessThanOrEqual(41 * D);
    expect(e.starfall).toBeGreaterThanOrEqual(105 * D);
    expectSlowsAfterStarfall(r);
    expect(e.starfall).toBeLessThanOrEqual(135 * D);
  }, 900000);
});
