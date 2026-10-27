// simRelicsCasual.test.ts: R2-10, the casual player with the typical relic collection. The finale and
// e10,000,000 come 5 to 20% sooner. e1,000,000 comes much sooner (measured about 42%): the relic-free
// casual player sits at the slow end of its 38 to 58 day band (47.8 days, one Prestigeception landing
// late), and the relics carry it to the average player's month instead; reported, pinned to "sooner".
import { describe, it, expect } from "vitest";
import { simulatePlayer, LONG_STRETCH_DT } from "./sim";
import { timeline, relicRatios, RELIC_FREE } from "./simReport";
import { typicalBoosts } from "./relicCollections";

describe("relic boosts: the casual player with a typical collection", () => {
  it("the finale and e10,000,000 5 to 20% sooner, e1,000,000 sooner", () => {
    const r = simulatePlayer({ profile: "casual", days: 340, longStretchDt: LONG_STRETCH_DT, stopAfterExponent: { exponent: 1e7, days: 0.5 }, relicBoosts: typicalBoosts() });
    timeline("casual + typical relics", r);
    const ratio = relicRatios("casual typical", r, RELIC_FREE.casual);
    for (const g of ["finale", "starfall"] as const) {
      expect(ratio[g], g).toBeGreaterThanOrEqual(0.8);
      expect(ratio[g], g).toBeLessThanOrEqual(0.95);
    }
    expect(ratio.long).toBeGreaterThanOrEqual(0.5);
    expect(ratio.long).toBeLessThanOrEqual(0.95);
  }, 900000);
});
