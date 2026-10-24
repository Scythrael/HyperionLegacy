// simOptimal.test.ts: the optimal player's timeline, pinned (0.13.11.1 curve round, user: "run a few
// sims as an optimal player, an average player, and a casual player"). Nine check-ins a day after a
// 3-hour first session (sim.ts). Bands leave room for a milestone moving by a check-in or two.
import { describe, it, expect } from "vitest";
import { simulatePlayer, LONG_STRETCH_DT } from "./sim";
import { timeline, D, H } from "./simReport";

describe("the optimal player", () => {
  it("first Captain under an hour, finale in 3.5 to 5.5 days, e1,000,000 in 28 to 41 days, e10,000,000 in 195 to 260 days", () => {
    const r = simulatePlayer({ profile: "optimal", days: 320, longStretchDt: LONG_STRETCH_DT, stopAfterExponent: { exponent: 1e7, days: 1 } });
    timeline("optimal", r);
    const e = r.events;
    expect(e.captain1).toBeLessThanOrEqual(H);
    expect(e.finale).toBeGreaterThanOrEqual(3.5 * D);
    expect(e.finale).toBeLessThanOrEqual(5.5 * D);
    expect(e.long).toBeGreaterThanOrEqual(28 * D);
    expect(e.long).toBeLessThanOrEqual(41 * D);
    expect(e.starfall).toBeGreaterThanOrEqual(195 * D);
    expect(e.starfall).toBeLessThanOrEqual(260 * D);
  }, 900000);
});
