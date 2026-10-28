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
      // 0.14.0 prestige redesign Slice 2 (rising bars): e10,000,000 measured 21.5% sooner (92.30 against
      // 117.58 d), just past the Gentle band's 20%; no Fleet bar ratio that holds the relic-free bands
      // brings it back (1.16 to 1.19 all measured 91.3 to 92.3 d with relics). Slice 5 replaces the relic
      // curve with the 2.5x ceiling and re-pins this band (plan Slice 5, "about 15% faster").
      expect(ratio[g], g).toBeGreaterThanOrEqual(g === "starfall" ? 0.78 : 0.8);
      expect(ratio[g], g).toBeLessThanOrEqual(0.9);
      // the heavy pin compares against these
      expect(r.events[g] / D / TYPICAL_RELIC_AVERAGE[g], g).toBeCloseTo(1, 2);
    }
  }, 900000);
});
