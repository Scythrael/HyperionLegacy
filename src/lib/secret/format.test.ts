import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { formatSecret, formatExponent, groupThousands, formatMultiplier } from "./format";

describe("formatSecret", () => {
  it("prints small values literally", () => {
    expect(formatSecret(0)).toBe("0");
    expect(formatSecret(7)).toBe("7");
    expect(formatSecret(5.5)).toBe("5.50");
    expect(formatSecret(new Decimal(42))).toBe("42");
  });

  it("uses the K to Oc suffixes like the main game", () => {
    expect(formatSecret(1234)).toBe("1.23K");
    expect(formatSecret(new Decimal("999999"))).toBe("1.00M");
    expect(formatSecret(new Decimal("1.5e29"))).toBe("150Oc");
  });

  it("switches to scientific past Oc, with thousands separators on big exponents", () => {
    expect(formatSecret(new Decimal("1.234e45"))).toBe("1.23e45");
    expect(formatSecret(new Decimal("4.21e1284"))).toBe("4.21e1,284");
    expect(formatSecret(Decimal.pow(10, 777777))).toBe("1.00e777,777");
  });

  it("never prints NaN", () => {
    expect(formatSecret(new Decimal(NaN))).toBe("0");
    expect(formatSecret(NaN)).toBe("0");
  });
});

describe("formatMultiplier", () => {
  it("keeps three significant figures between 10 and 1,000, and reads like formatSecret elsewhere", () => {
    expect(formatMultiplier(12.44)).toBe("12.4");
    expect(formatMultiplier(99.96)).toBe("100");
    expect(formatMultiplier(645.4)).toBe("645");
    expect(formatMultiplier(42)).toBe("42");
    expect(formatMultiplier(1)).toBe("1");
    expect(formatMultiplier(4.8)).toBe("4.80");
    expect(formatMultiplier(new Decimal(119000))).toBe("119K");
    expect(formatMultiplier(new Decimal("1.5e400"))).toBe("1.50e400");
  });
});

describe("formatExponent", () => {
  it("names a power of ten the way the goal bar reads it", () => {
    expect(formatExponent(777777)).toBe("e777,777");
    expect(formatExponent(1000000)).toBe("e1,000,000");
    expect(formatExponent(308)).toBe("e308");
  });

  it("groups thousands", () => {
    expect(groupThousands(1284)).toBe("1,284");
    expect(groupThousands(999)).toBe("999");
  });
});
