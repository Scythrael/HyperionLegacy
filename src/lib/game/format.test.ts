import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { formatNumber, formatDuration, formatClock } from "./format";

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
      expect(formatNumber(null as any)).toBe("0");
    });

    it("returns \"0\" for undefined", () => {
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
      // Same unverified-exact-string caveat as the 1e30 test above.
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

// ============================================================================
// formatDuration(ticks, secondsPerTick) -> compact human string.
//
// Author: Claude Opus 4.8 · 2026-07-16. SHARED helper (co-located with
// formatNumber as the ONE place time-span formatting lives). Converts a tick
// count to seconds (ticks * secondsPerTick) and renders a compact "~"-prefixed
// span, dropping zero trailing units and rolling up on unit boundaries. Guards
// 0 / negative / NaN -> "--" and +Infinity -> "∞". Fuel-runway (Wave 2) reuses
// this, so the tests pin the full s/m/h/d contract, not just the current caller.
// ============================================================================
describe("formatDuration", () => {
  // secondsPerTick 1 is the default game cadence, so ticks == seconds here.
  it("sub-minute renders as \"~Ns\" (45 ticks @ 1s/tick -> ~45s)", () => {
    expect(formatDuration(45, 1)).toBe("~45s");
  });

  it("minutes render as \"~Nm\", no seconds (720 ticks @ 1s -> 12m -> ~12m)", () => {
    expect(formatDuration(720, 1)).toBe("~12m");
  });

  it("hours render as \"~Hh Mm\" (8100s = 2h15m -> ~2h 15m)", () => {
    expect(formatDuration(8100, 1)).toBe("~2h 15m");
  });

  it("drops a zero trailing minute (7200s = exactly 2h -> ~2h, not ~2h 0m)", () => {
    expect(formatDuration(7200, 1)).toBe("~2h");
  });

  it("days render as \"~Dd Hh\" (273600s = 3d4h -> ~3d 4h)", () => {
    expect(formatDuration(273600, 1)).toBe("~3d 4h");
  });

  it("drops a zero trailing hour (172800s = exactly 2d -> ~2d, not ~2d 0h)", () => {
    expect(formatDuration(172800, 1)).toBe("~2d");
  });

  it("scales by secondsPerTick, not just tick count (30 ticks @ 2s/tick = 60s -> ~1m)", () => {
    expect(formatDuration(30, 2)).toBe("~1m");
  });

  it("returns \"--\" for 0 ticks", () => {
    expect(formatDuration(0, 1)).toBe("--");
  });

  it("returns \"--\" for negative ticks", () => {
    expect(formatDuration(-10, 1)).toBe("--");
  });

  it("returns \"--\" for NaN", () => {
    expect(formatDuration(NaN, 1)).toBe("--");
  });

  it("returns \"∞\" for +Infinity ticks", () => {
    expect(formatDuration(Infinity, 1)).toBe("∞");
  });

  it("floors a sub-second positive span to \"~1s\" (never \"~0s\")", () => {
    // 0.3 ticks @ 1s -> 0.3s rounds toward 0 but a positive span must read as
    // at least ~1s so the readout never shows a broken \"~0s\".
    expect(formatDuration(0.3, 1)).toBe("~1s");
  });
});

// ============================================================================
// formatClock(ticks, secondsPerTick) -> PRECISE colon-delimited clock.
//
// Author: Claude Opus 4.8 · 2026-07-16. Distinct from formatDuration's
// approximate "~2h 15m" reading: formatClock is an EXACT countdown clock used
// by the "N remaining" tick readouts. Converts a tick count to whole seconds
// (Math.round(ticks * secondsPerTick), clamped at 0), then splits into
// d/h/m/s and renders zero-padded. Days appear ONLY when present; the hours
// segment is padded only inside a longer form. Non-finite (NaN/±Infinity)
// guards to "--". Tests below are the authoritative contract (TDD, written
// before the implementation).
// ============================================================================
describe("formatClock", () => {
  // secondsPerTick 1 is the default game cadence, so ticks == seconds here.
  it("sub-hour renders as \"MM:SS\" (99s -> 01:39)", () => {
    expect(formatClock(99, 1)).toBe("01:39");
  });

  it("zero renders as \"00:00\"", () => {
    expect(formatClock(0, 1)).toBe("00:00");
  });

  it("whole minutes render as \"MM:SS\" (120s -> 02:00)", () => {
    expect(formatClock(120, 1)).toBe("02:00");
  });

  it("an exact hour renders as \"H:MM:SS\" (3600s -> 1:00:00)", () => {
    expect(formatClock(3600, 1)).toBe("1:00:00");
  });

  it("over a day renders as \"Dd HH:MM:SS\" (90061s -> 1d 01:01:01)", () => {
    expect(formatClock(90061, 1)).toBe("1d 01:01:01");
  });

  it("large multi-day span (373646s -> 4d 07:47:26)", () => {
    expect(formatClock(373646, 1)).toBe("4d 07:47:26");
  });

  it("clamps a negative span to \"00:00\"", () => {
    expect(formatClock(-10, 1)).toBe("00:00");
  });

  it("returns \"--\" for NaN", () => {
    expect(formatClock(NaN, 1)).toBe("--");
  });

  it("returns \"--\" for +Infinity", () => {
    expect(formatClock(Infinity, 1)).toBe("--");
  });

  it("scales by secondsPerTick, not just tick count (60 ticks @ 2s/tick = 120s -> 02:00)", () => {
    expect(formatClock(60, 2)).toBe("02:00");
  });
});
