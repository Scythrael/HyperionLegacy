// simRelicsOptimal.test.ts: R2-10, the optimal player with the typical relic collection. The climb is
// path-dependent (a Prestigeception that lands just before a goal costs about a day), so this pin is a
// little wider than the average player's 10 to 20%: every goal sooner, by 8 to 30%.
import { describe, it, expect } from "vitest";
import { simulatePlayer } from "./sim";
import { timeline, relicRatios, RELIC_FREE_SHIPPING, RELIC_GOALS, D } from "./simReport";
import { typicalBoosts } from "./relicCollections";

describe("relic boosts: the optimal player with a typical collection", () => {
  it("every goal 8 to 30% sooner", () => {
    const r = simulatePlayer({ profile: "optimal", days: 320, stopAfterExponent: { exponent: 1e7, days: 0.5 }, relicBoosts: typicalBoosts() });
    timeline("optimal + typical relics", r);
    const ratio = relicRatios("optimal typical", r, RELIC_FREE_SHIPPING.optimal);
    for (const g of RELIC_GOALS) {
      expect(ratio[g], g).toBeGreaterThanOrEqual(0.7);
      expect(ratio[g], g).toBeLessThanOrEqual(0.92);
    }
  }, 1800000);

  it("the relic-free optimal player on the same shipping catch-up lands on its pin (RELIC_FREE_SHIPPING)", () => {
    const r = simulatePlayer({ profile: "optimal", days: 320, stopAfterExponent: { exponent: 1e7, days: 0.5 } });
    timeline("optimal relic-free, shipping catch-up", r);
    for (const g of RELIC_GOALS) expect(r.events[g] / D, g).toBeCloseTo(RELIC_FREE_SHIPPING.optimal[g], 2);
  }, 1800000);
});
