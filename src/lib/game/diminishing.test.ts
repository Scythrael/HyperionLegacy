// E-CREW 0.14.0 (Task 15a, design D23): the shared DIMINISHING RETURNS curve.
//
// D23 (user, 2026-10-08): "Numbers get bigger and bigger and as you get more, they mean less and less",
// "without removing the entire ability to push past a certain point". So the curve must be:
//   - zero at zero (an empty bonus stays exactly empty: additive-neutral), and 0 for any x <= 0;
//   - nearly 1:1 for a bonus much smaller than the knee;
//   - monotonic (more is never worse) and strictly concave (each extra point is worth less);
//   - UNBOUNDED (no ceiling: it keeps growing forever).

import { describe, it, expect } from "vitest";
import { diminishing } from "./diminishing";

describe("diminishing (D23: unbounded, concave, no cap)", () => {
  it("is exactly 0 at 0, and 0 for a negative, NaN or -Infinity input", () => {
    expect(diminishing(0, 2)).toBe(0);
    expect(diminishing(-0.5, 2)).toBe(0);
    expect(diminishing(-1e9, 2)).toBe(0);
    expect(diminishing(Number.NaN, 2)).toBe(0);
    expect(diminishing(Number.NEGATIVE_INFINITY, 2)).toBe(0);
  });

  it("is the closed form knee * (sqrt(1 + 2x / knee) - 1)", () => {
    for (const knee of [0.5, 1.2, 2, 100]) {
      for (const x of [0.01, 0.3, 1, 2.25, 7, 1000]) {
        expect(diminishing(x, knee)).toBeCloseTo(knee * (Math.sqrt(1 + (2 * x) / knee) - 1), 12);
      }
    }
    // At the knee itself a bonus keeps sqrt(3) - 1 of its value (about 73%).
    expect(diminishing(2, 2)).toBeCloseTo(2 * (Math.sqrt(3) - 1), 12);
  });

  it("is nearly 1:1 far below the knee (relative loss about x / (2 knee))", () => {
    expect(diminishing(1e-9, 2) / 1e-9).toBeCloseTo(1, 9);
    expect(diminishing(0.01, 2) / 0.01).toBeGreaterThan(0.997);
    // A +30% bonus at a knee of 2 keeps over 93% of its value.
    expect(diminishing(0.3, 2) / 0.3).toBeGreaterThan(0.93);
    expect(diminishing(0.3, 2)).toBeLessThan(0.3);
  });

  it("never exceeds its input (a diminished bonus is never a bigger bonus)", () => {
    for (const x of [0.001, 0.1, 1, 10, 1e6]) expect(diminishing(x, 2)).toBeLessThanOrEqual(x);
  });

  it("is strictly increasing and each equal step adds strictly less (strictly concave)", () => {
    let prev = 0;
    let prevStep = Number.POSITIVE_INFINITY;
    for (let i = 1; i <= 400; i++) {
      const v = diminishing(i * 0.05, 1.2);
      const step = v - prev;
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThan(prevStep);
      prev = v;
      prevStep = step;
    }
  });

  it("has NO ceiling: it passes any bound, growing like sqrt(2 knee x) far past the knee", () => {
    expect(diminishing(1e4, 2)).toBeGreaterThan(100);
    expect(diminishing(1e8, 2)).toBeGreaterThan(10000);
    // Quadrupling a huge input about doubles the output (it keeps growing, ever more slowly).
    const r = diminishing(4e8, 2) / diminishing(1e8, 2);
    expect(r).toBeGreaterThan(1.99);
    expect(r).toBeLessThan(2.01);
  });

  it("scales with the knee: diminishing(c x, c k) == c diminishing(x, k)", () => {
    // So a knee can be stated in whatever unit the input is in (strength points or fractions).
    expect(diminishing(225, 120)).toBeCloseTo(100 * diminishing(2.25, 1.2), 9);
  });

  it("is pure: the same input gives the same output", () => {
    expect(diminishing(1.7, 2)).toBe(diminishing(1.7, 2));
  });

  it("rejects a knee that is not a positive finite number", () => {
    expect(() => diminishing(1, 0)).toThrow(RangeError);
    expect(() => diminishing(1, -1)).toThrow(RangeError);
    expect(() => diminishing(1, Number.NaN)).toThrow(RangeError);
    expect(() => diminishing(1, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("stays finite, positive and rising at the far numeric edges (no overflow to NaN or 0)", () => {
    const big = [1e300, 1e308, Number.MAX_VALUE];
    for (const x of big) {
      const v = diminishing(x, 2);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
    expect(diminishing(1e308, 2)).toBeGreaterThan(diminishing(1e300, 2));
    expect(diminishing(1e300, 1e-10)).toBeGreaterThan(diminishing(1e290, 1e-10));
  });
});
