// simTargetsHigh.test.ts: 1000% targets and waiting by hand (the automatic prestiges off, prestiging
// only at check-ins once the gain is 10 times, or twice, what you have) are no better than the
// default 100% targets (0.13.11.1, user: "Retune so default is best").
import { describe, it } from "vitest";
import { simulatePlayer } from "./sim";
import { timeline, expectNoBetterThanDefault } from "./simReport";

const all = (pct: number) => ({ captain: pct, fleet: pct, pc: pct });

describe("target sweep: 1000% and waiting by hand", () => {
  it("1000% on every layer is no better than 100%", () => {
    const r = simulatePlayer({ profile: "steady", days: 45, targets: all(1000), stopAfterLongDays: 0 });
    timeline("targets 1000%", r);
    expectNoBetterThanDefault("1000%", r);
  }, 900000);

  for (const pct of [1000, 200]) {
    it(`waiting by hand for ${pct}% is no better than 100%`, () => {
      const r = simulatePlayer({ profile: "steady", days: 45, targets: all(pct), style: { manual: true }, stopAfterLongDays: 0 });
      timeline(`by hand ${pct}%`, r);
      expectNoBetterThanDefault(`by hand ${pct}%`, r);
    }, 900000);
  }
});
