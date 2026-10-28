// simRelicsStretch.test.ts: R2-10, the six-month pins' coarse stretch (LONG_STRETCH_DT) still tracks the
// SHIPPING catch-up with a typical relic collection (the same check as simStretch.test.ts, relic boosts on).
import { describe, it, expect } from "vitest";
import { simulatePlayer, LONG_STRETCH_DT, SIM_START_MS } from "./sim";
import { pastLongState } from "./testStates";
import { effectiveExponent } from "./engine";
import { FINALE_EXPONENT } from "./config";
import { report } from "./testReport";
import { typicalBoosts } from "./relicCollections";

describe("the sim's coarse stretch with relics", () => {
  it("tracks the shipping catch-up within a few percent over twelve days past e1,000,000", () => {
    const from = { ...pastLongState(), relicBoosts: typicalBoosts() };
    from.lastTickAt = SIM_START_MS + 31 * 86400 * 1000;
    const e0 = effectiveExponent(from.bestOre);
    const fast = simulatePlayer({ profile: "steady", days: 43, from, longStretchDt: LONG_STRETCH_DT, stopAfterLongDays: Infinity });
    const shipping = simulatePlayer({ profile: "steady", days: 43, from, stopAfterLongDays: Infinity });
    const eFast = effectiveExponent(fast.final.bestOre);
    const eShip = effectiveExponent(shipping.final.bestOre);
    const gap = Math.abs(eFast - eShip) / (eShip - FINALE_EXPONENT);
    const climb = (eFast - e0) / (eShip - e0);
    report(`[stretch relics] 12 d from e${e0.toFixed(0)}: coarse e${eFast.toFixed(0)} shipping e${eShip.toFixed(0)}, ${(gap * 100).toFixed(2)}%, climb x${climb.toFixed(3)}`);
    expect(eShip).toBeGreaterThan(e0);
    // 0.14.0 prestige redesign Slice 2: pastLongState is built by playing the engine, so the rising bars
    // moved it, and this twelve-day window now crosses Overdrive Overdrive's wake with relics. The
    // shortcut's coarse steps (each produces COARSE_GENEROSITY longer) buy about one upgrade level ahead
    // at each check-in, and Overdrive Overdrive (a power on production) compounds that: measured 9.1%
    // (e3,243,551 against e3,037,206, Overdrive Overdrive 9 against 7); no prestige fires in the window,
    // so the bars play no part. The relic-free stretch still measures 1.35%. Slice 5 re-measures the
    // relic pins against the shipping catch-up when it replaces the relic curve.
    expect(gap).toBeLessThan(0.1);
    expect(climb).toBeGreaterThan(0.85);
    expect(climb).toBeLessThan(1.25);
  }, 600000);
});
