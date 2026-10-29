// simRelicsAverage.test.ts: R2-10 "Gentle" (user 2026-10-26: about 10 to 20% faster to each goal for a
// typical 0.14.0 relic collection). The average player with the typical collection (relicCollections.ts)
// reaches the finale, e1,000,000 and e10,000,000 10 to 20% sooner than without relics. Relic-free players
// keep the shipped bands: sim.test.ts and the other pacing pins run unchanged (relicGoldens.test.ts). 0.14.0
// Slice 5a: the relic pins run on the shipping catch-up all the way, against RELIC_FREE_SHIPPING.
import { describe, it, expect } from "vitest";
import { simulatePlayer } from "./sim";
import { timeline, relicRatios, RELIC_FREE_SHIPPING, RELIC_GOALS, TYPICAL_RELIC_AVERAGE, D } from "./simReport";
import { typicalBoosts } from "./relicCollections";

describe("relic boosts: the average player with a typical collection", () => {
  it("every goal 10 to 20% sooner (Gentle)", () => {
    const r = simulatePlayer({ profile: "average", days: 280, stopAfterExponent: { exponent: 1e7, days: 0.5 }, relicBoosts: typicalBoosts() });
    timeline("average + typical relics", r);
    const ratio = relicRatios("average typical", r, RELIC_FREE_SHIPPING.average);
    for (const g of RELIC_GOALS) {
      expect(ratio[g], g).toBeGreaterThanOrEqual(0.8);
      expect(ratio[g], g).toBeLessThanOrEqual(0.9);
      // the heavy pin compares against these
      expect(r.events[g] / D / TYPICAL_RELIC_AVERAGE[g], g).toBeCloseTo(1, 2);
    }
  }, 1800000);

  it("the relic-free average player on the same shipping catch-up lands on its pin (RELIC_FREE_SHIPPING)", () => {
    const r = simulatePlayer({ profile: "average", days: 280, stopAfterExponent: { exponent: 1e7, days: 0.5 } });
    timeline("average relic-free, shipping catch-up", r);
    for (const g of RELIC_GOALS) expect(r.events[g] / D, g).toBeCloseTo(RELIC_FREE_SHIPPING.average[g], 2);
  }, 1800000);
});
