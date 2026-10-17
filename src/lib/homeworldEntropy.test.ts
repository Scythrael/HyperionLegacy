import { describe, expect, it } from "vitest";
import { drawHomeworldSeed } from "./homeworldEntropy";

describe("G2-1: the homeworld entropy draw (the one entropy source)", () => {
  it("reads one 32-bit value from the random source", () => {
    const source = { getRandomValues: (a: Uint32Array) => ((a[0] = 0xdeadbeef), a) };
    expect(drawHomeworldSeed(source)).toBe(0xdeadbeef);
  });

  it("draws a whole number in [0, 2^32), and two draws from the real source differ", () => {
    const a = drawHomeworldSeed();
    const b = drawHomeworldSeed();
    for (const s of [a, b]) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBe(s >>> 0);
    }
    expect(a).not.toBe(b);
  });

  it("falls back to a whole 32-bit number when there is no source, or the source throws", () => {
    for (const source of [null, { getRandomValues: () => { throw new Error("blocked"); } }]) {
      const s = drawHomeworldSeed(source);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBe(s >>> 0);
    }
  });
});
