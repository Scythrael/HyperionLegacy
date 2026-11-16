// FR-C lane 1 I2 (user 2026-11-13/14, "Curve below 100% (Recommended)"): the salvage recovery fraction had no ceiling, so
// late Museum and Salvager bonuses pushed it to 0.93 to 1.16 and build then salvage became profitable. The fraction now
// passes a diminishing curve that approaches 100% and never reaches it (no hard cap). Below the knee nothing changes, so
// every ordinary salvage (the 30 to 40% band plus the usual bonuses) recovers exactly what it did.
import { describe, it, expect } from "vitest";
import { SALVAGE_FRACTION_MAX, SALVAGE_FRACTION_MIN, SALVAGE_RECOVERY_KNEE, hullTeardownFraction, salvageRecoveryCurve, salvageYieldMult } from "./salvage";
import { RELICS } from "./relics";
import { freshState, withGeneralMuseumRecord, type GameState } from "./model";

describe("salvageRecoveryCurve", () => {
  it("is the identity up to the knee, so ordinary salvages are unchanged", () => {
    for (const raw of [0, 0.3, 0.35, 0.4, 0.45, SALVAGE_RECOVERY_KNEE]) expect(salvageRecoveryCurve(raw)).toBe(raw);
  });

  it("rises without bound in its input but stays below 100%, even for huge raw fractions", () => {
    let prev = salvageRecoveryCurve(SALVAGE_RECOVERY_KNEE);
    for (const raw of [0.6, 0.93, 1, 1.16, 2, 10, 1e6, 1e300]) {
      const f = salvageRecoveryCurve(raw);
      expect(f, `raw ${raw}`).toBeLessThan(1);
      expect(f, `raw ${raw}`).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(salvageRecoveryCurve(1.16)).toBeLessThan(1.16);
    expect(salvageRecoveryCurve(0.93)).toBeLessThan(0.93);
  });

  it("is concave above the knee (each extra point recovers a little less)", () => {
    const step = 0.05;
    let lastGain = Infinity;
    for (let raw = SALVAGE_RECOVERY_KNEE; raw < 2; raw += step) {
      const gain = salvageRecoveryCurve(raw + step) - salvageRecoveryCurve(raw);
      expect(gain).toBeGreaterThan(0);
      expect(gain).toBeLessThanOrEqual(lastGain + 1e-15);
      lastGain = gain;
    }
  });

  it("a hull teardown with a far-past-real Museum recovers less than it cost (never 100% or more)", () => {
    // Every relic at 10,000 copies: every set tier at its top level, so the salvageYield multiplier is at its largest.
    const museum: Record<string, number> = {};
    for (const r of RELICS) museum[r.id] = 10_000;
    const state: GameState = withGeneralMuseumRecord(freshState(), museum);
    expect(salvageYieldMult(state)).toBeGreaterThan(1);
    for (const d of [0, 0.5, 0.999]) {
      const raw = (SALVAGE_FRACTION_MIN + d * (SALVAGE_FRACTION_MAX - SALVAGE_FRACTION_MIN)) * salvageYieldMult(state);
      expect(hullTeardownFraction(state, d)).toBe(salvageRecoveryCurve(raw));
      expect(hullTeardownFraction(state, d)).toBeLessThan(1);
    }
  });
});
