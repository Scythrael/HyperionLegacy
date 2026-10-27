// simRelicsHeavy.test.ts: R2-10, the average player with a HEAVY relic collection (relicCollections.ts:
// Tier I 2,000 identified with 1,000 past the soft cap counting 5x, Tier II 1,000, Tier III 300). Still the
// D23 curve (no cap, no compounding), so it is faster than the typical collection at every goal; how much
// faster is reported for the user (a later minigame update balances new bonuses around this scaling).
import { describe, it, expect } from "vitest";
import { simulatePlayer, LONG_STRETCH_DT } from "./sim";
import { timeline, relicRatios, RELIC_FREE, RELIC_GOALS, TYPICAL_RELIC_AVERAGE, D } from "./simReport";
import { heavyBoosts } from "./relicCollections";

describe("relic boosts: the average player with a heavy collection", () => {
  it("every goal sooner than with the typical collection (reported)", () => {
    const r = simulatePlayer({ profile: "average", days: 280, longStretchDt: LONG_STRETCH_DT, stopAfterExponent: { exponent: 1e7, days: 0.5 }, relicBoosts: heavyBoosts() });
    timeline("average + heavy relics", r);
    relicRatios("average heavy", r, RELIC_FREE.average);
    for (const g of RELIC_GOALS) expect(r.events[g] / D, g).toBeLessThan(TYPICAL_RELIC_AVERAGE[g]);
  }, 900000);
});
