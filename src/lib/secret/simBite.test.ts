// simBite.test.ts: the rising bars are the real gate (Slice 2 review, user: "Make them bite"). For the
// average player to e10,000,000, from the third Fleet of each Prestigeception and from the second
// Prestigeception on, the bar (not the automatic target) decides when each one happens, and most of them
// fire with the climb right at the bar (sim.ts simulateBite).
import { describe, it, expect } from "vitest";
import { simulateBite } from "./sim";
import { report } from "./testReport";

describe("the rising bars bite", () => {
  it("decide when the average player's Fleets and Prestigeceptions happen, to e10,000,000", () => {
    const { tally: t, seconds } = simulateBite({ profile: "average", days: 300, stopExponent: 1e7 });
    const pct = (a: number, b: number) => `${a}/${b} (${Math.round((100 * a) / Math.max(1, b))}%)`;
    report(`[bite] to e10,000,000 at ${(seconds / 86400).toFixed(1)} d: Fleets decided by the bar ${pct(t.fleetsBarDecided, t.fleets)}, at the bar ${pct(t.fleetsAtBar, t.fleets)}; Prestigeceptions decided ${pct(t.pcsBarDecided, t.pcs)}, at the bar ${pct(t.pcsAtBar, t.pcs)}`);
    expect(t.fleets).toBeGreaterThanOrEqual(20);
    // (review round: PC_BAR_RATIO 3 makes four Prestigeceptions to e10,000,000, so three from the second on;
    // five at PC_BAR_RATIO 2. The share pins below are unchanged.)
    expect(t.pcs).toBeGreaterThanOrEqual(3);
    expect(t.fleetsBarDecided / t.fleets).toBeGreaterThanOrEqual(0.9);
    expect(t.pcsBarDecided / t.pcs).toBeGreaterThanOrEqual(0.9);
    expect(t.fleetsAtBar / t.fleets).toBeGreaterThanOrEqual(0.6);
    expect(t.pcsAtBar / t.pcs).toBeGreaterThanOrEqual(0.6);
  }, 900000);
});
