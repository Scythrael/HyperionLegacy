// simRelicsTargets.test.ts: R2-10, the default 100% targets stay best with a typical relic collection
// (the user's "Retune so default is best" holds with relics too). The average player with every auto
// target at 200% reaches the finale and e1,000,000 no sooner than at 100% (simRelicsAverage measures it,
// TYPICAL_RELIC_AVERAGE), within the target sweeps' margin; never reaching e1,000,000 counts as later.
// 500%, 1000% and waiting by hand were measured once (all later: finale 6.69, 15.58 and 8.01 days against
// 4.17), not pinned here, to keep the gate short.
import { describe, it, expect } from "vitest";
import { simulatePlayer } from "./sim";
import { timeline, TYPICAL_RELIC_AVERAGE, TARGET_MARGIN, D } from "./simReport";
import { typicalBoosts } from "./relicCollections";

describe("relic boosts: target sweep", () => {
  it("200% on every layer is no better than 100% with a typical collection", () => {
    const r = simulatePlayer({ profile: "average", days: 45, targets: { captain: 200, fleet: 200, pc: 200 }, stopAfterLongDays: 0, relicBoosts: typicalBoosts() });
    timeline("typical relics, targets 200%", r);
    expect(r.events.finale).toBeDefined();
    for (const key of ["finale", "long"] as const) {
      const t = r.events[key];
      if (t === undefined) continue;
      expect(t / D, key).toBeGreaterThanOrEqual(TYPICAL_RELIC_AVERAGE[key] * (1 - TARGET_MARGIN));
    }
  }, 900000);
});
