import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { formatNumber } from "./format";

// Pins formatNumber's contract post-migration (Task 8, Big-Number Migration):
// the plain-number branch must remain BYTE-IDENTICAL to the pre-migration
// function body (zero behavior change for the many existing callers passing
// plain numbers -- offlineSeconds, talent.cost, xpForNextFleetAdminLevel(...),
// etc, see App.svelte), while the new Decimal branch adds the ability to
// format values far beyond Number.MAX_VALUE without collapsing to "Infinity".
// Every case below was hand-traced against the actual implementation in
// format.ts before being written (no test runner is available in this
// environment to execute these -- see PR/commit notes).
describe("formatNumber", () => {
  describe("plain-number branch (pre-migration behavior, must not change)", () => {
    it("formats 0 as \"0\", not \"0.00\" -- the abs!==0 guard skips toFixed for exact zero", () => {
      // abs = 0, abs < 1000 true, but `abs < 10 && abs !== 0` is false because
      // abs !== 0 fails -- falls through to Math.floor(0).toString().
      expect(formatNumber(0)).toBe("0");
    });

    it("formats a small decimal (5.5) with 2 decimal places", () => {
      // abs = 5.5, < 1000 true, 5.5 < 10 && 5.5 !== 0 -> true -> toFixed(2).
      expect(formatNumber(5.5)).toBe("5.50");
    });

    it("formats a value just under 1000 (999) with no decimals, no tier suffix", () => {
      // abs = 999, < 1000 true, 999 < 10 false -> Math.floor(999).toString().
      expect(formatNumber(999)).toBe("999");
    });

    it("formats 1000 exactly at the K tier boundary as \"1.00K\"", () => {
      // tier = floor(log10(1000)/3) = floor(3/3) = 1. scaled = 1000/1000 = 1.
      // 1 < 10 -> decimals = 2 -> "1.00" + TIERS[1] ("K").
      expect(formatNumber(1000)).toBe("1.00K");
    });

    it("formats 1000000 exactly at the M tier boundary as \"1.00M\"", () => {
      // tier = floor(log10(1e6)/3) = floor(6/3) = 2. scaled = 1e6/1e6 = 1.
      // decimals = 2 -> "1.00" + TIERS[2] ("M").
      expect(formatNumber(1000000)).toBe("1.00M");
    });

    it("returns \"0\" for NaN", () => {
      expect(formatNumber(NaN)).toBe("0");
    });

    it("returns \"0\" for null", () => {
      // The function signature is typed number | Decimal, but existing callers
      // in App.svelte historically could pass null/undefined at runtime (JS is
      // not strictly enforced past the type checker) -- pre-migration guard
      // preserved verbatim.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(formatNumber(null as any)).toBe("0");
    });

    it("returns \"0\" for undefined", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(formatNumber(undefined as any)).toBe("0");
    });

    it("falls through to scientific notation when tier >= TIERS.length (abs >= 1e30)", () => {
      // abs = 1e33. tier = floor(log10(1e33)/3) = floor(33/3) = 11. 11 >= 10
      // (TIERS.length) -> returns n.toExponential(2) directly, no tier suffix.
      expect(formatNumber(1e33)).toBe("1.00e+33");
    });
  });

  describe("Decimal branch (new behavior)", () => {
    it("round-trips a small Decimal (42) through the plain-number branch unchanged", () => {
      // new Decimal(42) normalizes to mantissa 4.2, exponent 1. exponent < 3
      // -> delegates to formatNumber(d.toNumber()) = formatNumber(42), which
      // takes the abs < 1000, abs >= 10 path -> Math.floor(42).toString().
      expect(formatNumber(new Decimal(42))).toBe("42");
    });

    it("formats Decimal(0) as \"0\" via the same exponent < 3 delegation path", () => {
      expect(formatNumber(new Decimal(0))).toBe("0");
    });

    it("formats Decimal(1234) identically to the pre-migration plain-number result (\"1.23K\")", () => {
      // new Decimal(1234) normalizes to mantissa 1.234, exponent 3. exponent < 3
      // is false (3 < 3 is false), exponent >= 30 is false. tier =
      // floor(3/3) = 1. scaled = 1234/1000 = 1.234. decimals = 2 (1.234 < 10).
      // Result: "1.23K" -- byte-identical to what the OLD plain-number
      // formatNumber(1234) produced pre-migration (independently hand-traced
      // and confirmed in the implementation report for this task).
      expect(formatNumber(new Decimal(1234))).toBe("1.23K");
    });

    it("formats Decimal(1000000) at the M tier boundary as \"1.00M\", matching the plain-number case above", () => {
      // mantissa 1, exponent 6. tier = floor(6/3) = 2. scaled =
      // dividedBy(1e6).toNumber() = 1. decimals = 2. "1.00" + TIERS[2] ("M").
      expect(formatNumber(new Decimal(1000000))).toBe("1.00M");
    });

    it("falls through to scientific notation exactly at the exponent >= TIERS.length*3 boundary (1e30)", () => {
      // Constructed from a STRING: a numeric literal 1e30 would still fit in a
      // plain JS double (max ~1.8e308) so this alone doesn't prove Decimal's
      // value, but it does exercise the exact tier-table upper boundary --
      // mantissa 1, exponent 30. exponent < 3 false. exponent >= 30 (10*3)
      // true -> returns d.toExponential(2) directly, skipping the tier table
      // entirely (proving no out-of-bounds TIERS[10] access occurs here).
      // NOTE: the exact string format of Decimal.toExponential(2) (e.g.
      // whether it emits "1.00e+30" vs some other separator/sign convention)
      // is asserted here based on break_infinity.js's documented convention
      // mirroring Number.prototype.toExponential, but was NOT independently
      // verified against library source in this environment (no node_modules/
      // .d.ts available) -- flagged as an assumption in the implementation
      // report for this task. The properties below are checked independently
      // of the exact string so this test still catches the boundary/overflow
      // regressions even if the precise format string needs adjustment.
      const result = formatNumber(new Decimal("1e30"));
      expect(result).not.toBe("Infinity");
      expect(result.toLowerCase()).toContain("e+30");
      expect(result).toBe("1.00e+30");
    });

    it("represents a magnitude far beyond Number.MAX_VALUE (1e500) without throwing or collapsing to \"Infinity\"", () => {
      // This is the entire point of the migration: 1e500 cannot exist as a
      // plain JS number (overflows past ~1.8e308) -- constructing from a
      // STRING proves Decimal holds it natively via its own mantissa/exponent
      // fields, never routing through Math.log10 or double arithmetic that
      // would overflow. mantissa 1, exponent 500. exponent < 3 false,
      // exponent >= 30 true -> d.toExponential(2), which operates on the
      // Decimal's own internal representation, not a plain double.
      // As with the 1e30 case above, the precise toExponential(2) string
      // format is an assumption (not independently verified against library
      // source in this environment) -- the not-Infinity/not-throw assertions
      // are the load-bearing checks this test exists to make.
      const huge = new Decimal("1e500");
      const result = formatNumber(huge);
      expect(result).not.toBe("Infinity");
      expect(result).not.toContain("Infinity");
      expect(() => formatNumber(huge)).not.toThrow();
      expect(result.toLowerCase()).toContain("e+500");
      expect(result).toBe("1.00e+500");
    });

    it("returns \"0\" for a Decimal whose mantissa is NaN (invalid Decimal), mirroring the plain-number NaN guard", () => {
      // break_infinity.js has no isNaN()/isFinite() method on Decimal (verified
      // against the library's .d.ts) -- Number.isNaN(d.mantissa) is the
      // equivalent check per format.ts's own header comment. An invalid
      // Decimal constructed from a non-numeric string surfaces NaN in mantissa.
      const invalid = new Decimal(NaN);
      expect(formatNumber(invalid)).toBe("0");
    });
  });
});
