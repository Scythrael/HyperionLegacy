// simRelicsOptimal.test.ts: R2-10, the optimal player with the typical relic collection. The climb is
// path-dependent (a Prestigeception that lands just before a goal costs about a day), so this pin is a
// little wider than the average player's 10 to 20%: every goal sooner, by 8 to 30%.
import { describe, it, expect } from "vitest";
import { simulatePlayer, LONG_STRETCH_DT } from "./sim";
import { timeline, relicRatios, RELIC_FREE, RELIC_GOALS } from "./simReport";
import { typicalBoosts } from "./relicCollections";

describe("relic boosts: the optimal player with a typical collection", () => {
  it("every goal 8 to 30% sooner", () => {
    const r = simulatePlayer({ profile: "optimal", days: 320, longStretchDt: LONG_STRETCH_DT, stopAfterExponent: { exponent: 1e7, days: 0.5 }, relicBoosts: typicalBoosts() });
    timeline("optimal + typical relics", r);
    const ratio = relicRatios("optimal typical", r, RELIC_FREE.optimal);
    for (const g of RELIC_GOALS) {
      expect(ratio[g], g).toBeGreaterThanOrEqual(0.7);
      expect(ratio[g], g).toBeLessThanOrEqual(0.92);
    }
  }, 900000);
});
