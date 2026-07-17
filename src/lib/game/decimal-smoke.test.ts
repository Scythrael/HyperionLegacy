import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";

// Pins break_infinity.js's observed Decimal behavior -- constructor equivalence,
// non-mutating arithmetic, DecimalSource plain-number acceptance, JSON
// (de)serialization shape, and extreme-magnitude representation. Written before
// any real game code depended on Decimal (Task 1, Big-Number Migration) so a
// library-behavior surprise would surface here first, cheaply -- and kept
// permanently as a regression guard: a future break_infinity.js version bump
// (or a swap to a different big-number library) changing any of this should
// fail here first, in isolation, rather than surfacing as a confusing failure
// somewhere deep in tick.test.ts/save.test.ts.
describe("break_infinity.js Decimal -- smoke test", () => {
  it("constructs from a number and a string, both producing an equal value", () => {
    const fromNumber = new Decimal(12345);
    const fromString = new Decimal("12345");
    expect(fromNumber.equals(fromString)).toBe(true);
  });

  it("plus/minus/times/dividedBy return NEW instances and accept plain numbers directly (DecimalSource)", () => {
    const a = new Decimal(10);
    const b = a.plus(5); // DecimalSource accepts a plain number, no wrapping needed
    expect(a.toNumber()).toBe(10); // `a` itself is unchanged -- Decimal is not mutated in place
    expect(b.toNumber()).toBe(15);
    expect(b.minus(3).toNumber()).toBe(12);
    expect(b.times(2).toNumber()).toBe(30);
    expect(b.dividedBy(3).toNumber()).toBe(5);
  });

  it("comparison methods accept a plain number directly, matching a mixed Decimal/number comparison this migration relies on", () => {
    const xp = new Decimal(150);
    // Mirrors tick.ts's real usage: comparing a Decimal xp against a plain-number
    // threshold returned by xpForNextLevel(level) -- no wrapping required.
    expect(xp.gte(100)).toBe(true);
    expect(xp.lt(100)).toBe(false);
  });

  it("toString()/toJSON() both produce a round-trippable string, and toNumber() converts back with acceptable precision loss for small values", () => {
    const d = new Decimal(9999.5);
    expect(d.toString()).toBe(d.toJSON()); // toJSON should just be toString's value, per the verified .d.ts
    const revived = new Decimal(d.toString());
    expect(revived.equals(d)).toBe(true);
    expect(d.toNumber()).toBeCloseTo(9999.5, 6);
  });

  it("JSON.stringify calls toJSON() automatically, embedding the Decimal as a JSON string (no custom replacer needed)", () => {
    const payload = { commonOre: new Decimal(42) };
    const json = JSON.stringify(payload);
    expect(json).toBe('{"commonOre":"42"}');
  });

  it("JSON.parse does NOT reconstruct a Decimal -- the round-tripped value is a plain string, confirming hydration after parse is mandatory", () => {
    const json = JSON.stringify({ commonOre: new Decimal(42) });
    const parsed = JSON.parse(json);
    expect(typeof parsed.commonOre).toBe("string");
    expect(parsed.commonOre instanceof Decimal).toBe(false);
    // This is exactly why Task 3 (save.ts) needs an explicit hydrateDecimals()
    // step -- JSON.parse alone can never produce a live Decimal instance.
  });

  it("Decimal.min/Decimal.max are static functions accepting two DecimalSource args", () => {
    expect(Decimal.min(new Decimal(5), 10).toNumber()).toBe(5);
    expect(Decimal.max(new Decimal(5), 10).toNumber()).toBe(10);
  });

  it("represents magnitudes far beyond Number.MAX_VALUE without overflowing to Infinity", () => {
    // 1e1000000 cannot exist as a JS number at all (overflows past ~1.8e308) --
    // this is the entire reason this migration exists. Constructing it from a
    // STRING (not a number literal, which JS itself would parse as Infinity
    // before Decimal ever saw it) proves the type genuinely holds values this large.
    const huge = new Decimal("1e1000000");
    expect(huge.toNumber()).toBe(Infinity); // toNumber() is documented as lossy/plain-double, this is expected
    expect(huge.toString()).not.toBe("Infinity"); // but the Decimal's OWN string form is not collapsed
    expect(huge.exponent).toBeCloseTo(1000000, 0);
  });
});
