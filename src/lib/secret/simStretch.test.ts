// simStretch.test.ts: the six-month pins run the stretch after e1,000,000 with 10-second coarse
// offline steps (LONG_STRETCH_DT). This checks that shortcut against the SHIPPING catch-up: the
// same steady player, from the same state past e1,000,000, for twelve days, both ways.
import { describe, it, expect } from "vitest";
import { simulatePlayer, LONG_STRETCH_DT, SIM_START_MS } from "./sim";
import { pastLongState } from "./testStates";
import { effectiveExponent } from "./engine";
import { FINALE_EXPONENT } from "./config";
import { report } from "./testReport";

describe("the sim's coarse stretch", () => {
  it("tracks the shipping catch-up within a few percent over twelve days past e1,000,000", () => {
    const from = pastLongState();
    from.lastTickAt = SIM_START_MS + 31 * 86400 * 1000; // day 31, the stretch the shortcut covers
    const e0 = effectiveExponent(from.bestOre);
    const fast = simulatePlayer({ profile: "steady", days: 43, from, longStretchDt: LONG_STRETCH_DT, stopAfterLongDays: Infinity });
    const shipping = simulatePlayer({ profile: "steady", days: 43, from, stopAfterLongDays: Infinity });
    const eFast = effectiveExponent(fast.final.bestOre);
    const eShip = effectiveExponent(shipping.final.bestOre);
    // Measured on the distance above the finale, the quantity the soft curve paces (a whole
    // e1,000,000 to e10,000,000 run read 178.0 against 178.8 days the same way).
    const gap = Math.abs(eFast - eShip) / (eShip - FINALE_EXPONENT);
    const climb = (eFast - e0) / (eShip - e0);
    report(`[stretch] 12 d from e${e0.toFixed(0)}: coarse e${eFast.toFixed(0)} shipping e${eShip.toFixed(0)}, ${(gap * 100).toFixed(2)}% of the distance above the finale, coarse climb x${climb.toFixed(3)} of shipping (wall ${fast.wallMs.toFixed(0)} / ${shipping.wallMs.toFixed(0)} ms)`);
    expect(eShip).toBeGreaterThan(e0);
    expect(gap).toBeLessThan(0.03);
    expect(climb).toBeGreaterThan(0.85);
    expect(climb).toBeLessThan(1.25);
  }, 600000);
});
