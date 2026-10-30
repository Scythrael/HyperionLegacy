// simRelicsCasual.test.ts: R2-10, the casual player with the typical relic collection. The finale and
// e10,000,000 come 5 to 20% sooner, e1,000,000 sooner (pinned 5 to 50%). Slice 5a retune (pay at the bar, the four
// Tier I levers x6.5): measured x0.940 / 0.859 / 0.865 (an earlier engine had the relic-free casual player slow at
// e1,000,000 and the relics carried it about 42% sooner, hence the wider e1,000,000 pin).
import { describe, it, expect } from "vitest";
import { simulatePlayer } from "./sim";
import { timeline, relicRatios, RELIC_FREE_SHIPPING, RELIC_GOALS, D } from "./simReport";
import { typicalBoosts } from "./relicCollections";

describe("relic boosts: the casual player with a typical collection", () => {
  it("the finale and e10,000,000 5 to 20% sooner, e1,000,000 sooner", () => {
    const r = simulatePlayer({ profile: "casual", days: 340, stopAfterExponent: { exponent: 1e7, days: 0.5 }, relicBoosts: typicalBoosts() });
    timeline("casual + typical relics", r);
    const ratio = relicRatios("casual typical", r, RELIC_FREE_SHIPPING.casual);
    for (const g of ["finale", "starfall"] as const) {
      expect(ratio[g], g).toBeGreaterThanOrEqual(0.8);
      expect(ratio[g], g).toBeLessThanOrEqual(0.95);
    }
    expect(ratio.long).toBeGreaterThanOrEqual(0.5);
    expect(ratio.long).toBeLessThanOrEqual(0.95);
  }, 1800000);

  it("the relic-free casual player on the same shipping catch-up lands on its pin (RELIC_FREE_SHIPPING)", () => {
    const r = simulatePlayer({ profile: "casual", days: 340, stopAfterExponent: { exponent: 1e7, days: 0.5 } });
    timeline("casual relic-free, shipping catch-up", r);
    for (const g of RELIC_GOALS) expect(r.events[g] / D, g).toBeCloseTo(RELIC_FREE_SHIPPING.casual[g], 2);
  }, 1800000);
});
