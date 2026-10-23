// simTargets.test.ts: the default targets are the best targets (0.13.11.1, user: "Retune so default
// is best"). The steady player from a fresh game with every auto target at 200% and at 500% reaches
// the finale and e1,000,000 no sooner than at the default 100% (simReport DEFAULT_STEADY), within a
// small margin. Each sweep file runs in parallel with the others.
import { describe, it } from "vitest";
import { simulatePlayer } from "./sim";
import { timeline, expectNoBetterThanDefault } from "./simReport";

const all = (pct: number) => ({ captain: pct, fleet: pct, pc: pct });

describe("target sweep: 200% and 500%", () => {
  for (const pct of [200, 500]) {
    it(`${pct}% on every layer is no better than 100%`, () => {
      const r = simulatePlayer({ profile: "steady", days: 45, targets: all(pct), stopAfterLongDays: 0 });
      timeline(`targets ${pct}%`, r);
      expectNoBetterThanDefault(`${pct}%`, r);
    }, 900000);
  }
});
