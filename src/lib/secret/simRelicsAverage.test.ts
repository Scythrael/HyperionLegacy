// simRelicsAverage.test.ts: R2-10 "Gentle" (user 2026-10-26: about 10 to 20% faster to each goal for a
// typical 0.14.0 relic collection). The average player with the typical collection (relicCollections.ts)
// reaches the finale, e1,000,000 and e10,000,000 10 to 20% sooner than without relics. Relic-free players
// keep the shipped bands: sim.test.ts and the other pacing pins run unchanged (relicGoldens.test.ts).
import { describe, it, expect } from "vitest";
import { simulatePlayer, LONG_STRETCH_DT } from "./sim";
import { timeline, relicRatios, RELIC_FREE, RELIC_GOALS, TYPICAL_RELIC_AVERAGE, D } from "./simReport";
import { typicalBoosts } from "./relicCollections";

describe("relic boosts: the average player with a typical collection", () => {
  it("every goal 10 to 20% sooner (Gentle)", () => {
    const r = simulatePlayer({ profile: "average", days: 280, longStretchDt: LONG_STRETCH_DT, stopAfterExponent: { exponent: 1e7, days: 0.5 }, relicBoosts: typicalBoosts() });
    timeline("average + typical relics", r);
    const ratio = relicRatios("average typical", r, RELIC_FREE.average);
    for (const g of RELIC_GOALS) {
      expect(ratio[g], g).toBeGreaterThanOrEqual(0.8);
      expect(ratio[g], g).toBeLessThanOrEqual(0.9);
      // the heavy pin compares against these
      expect(r.events[g] / D / TYPICAL_RELIC_AVERAGE[g], g).toBeCloseTo(1, 2);
    }
  }, 900000);
});
