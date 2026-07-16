// The ONE number formatting function. Never call .toString() on a game
// number for display anywhere else in the codebase — Ops §8.E.4. If the
// format needs to change later (named tiers, scientific notation threshold,
// etc.) this is the only place that changes.
//
// Accepts EITHER a plain number (time/tick/percentage/cost displays -- these
// never migrated to Decimal, see docs/plans/2026-07-08-big-number-migration-
// plan.md's field-split table) OR a Decimal (resource/currency displays),
// delegating to formatDecimal below for the latter. The plain-number branch
// is BYTE-IDENTICAL to this function's pre-migration body -- zero behavior
// change for any existing caller.

import Decimal from "break_infinity.js";

const TIERS = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc"];

export function formatNumber(n: number | Decimal): string {
  if (n instanceof Decimal) return formatDecimal(n);

  if (n === null || n === undefined || Number.isNaN(n)) return "0";
  const abs = Math.abs(n);
  if (abs < 1000) return abs < 10 && abs !== 0 ? n.toFixed(2) : Math.floor(n).toString();

  let tier = Math.floor(Math.log10(abs) / 3);
  if (tier >= TIERS.length) return n.toExponential(2);
  tier = Math.min(tier, TIERS.length - 1);

  const scaled = n / Math.pow(10, tier * 3);
  const decimals = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  return `${scaled.toFixed(decimals)}${TIERS[tier]}`;
}

// Mirrors formatNumber's plain-number logic exactly (same tier table, same
// <1000/<10 thresholds, same decimals-by-magnitude rule), but reads magnitude
// from the Decimal's OWN mantissa/exponent instead of Math.log10 on a raw
// number, since a Decimal can hold values far beyond what Math.log10 could
// even represent as a finite double (that's the entire reason this type
// exists). break_infinity.js's Decimal has no isNaN()/isFinite() method
// (verified against the library's own .d.ts at plan-writing time) --
// Number.isNaN(d.mantissa) is the equivalent check, since an invalid Decimal
// would surface as NaN in its own mantissa field.
function formatDecimal(d: Decimal): string {
  if (Number.isNaN(d.mantissa)) return "0";
  if (d.exponent < 3) return formatNumber(d.toNumber()); // small enough to safely round-trip through a plain double -- reuse the exact plain-number branch above, not a duplicate implementation
  if (d.exponent >= TIERS.length * 3) return d.toExponential(2);

  const tier = Math.floor(d.exponent / 3);
  // Math.pow(10, tier*3) (a plain number) is sufficient here, not new Decimal(10).pow(tier*3) --
  // tier*3 never exceeds 27 (TIERS has 10 entries, index 9 * 3 = 27), nowhere near double
  // overflow, and .dividedBy() accepts a plain-number DecimalSource directly.
  const scaled = d.dividedBy(Math.pow(10, tier * 3)).toNumber();
  const decimals = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  return `${scaled.toFixed(decimals)}${TIERS[tier]}`;
}

// ============================================================================
// formatDuration -- a compact, human-readable time span.
//
// Added 2026-07-16 (fuel net-display fix) as a SHARED helper, co-located with
// formatNumber because this is the ONE place span formatting lives (the same
// single-source discipline the header comment above states for number
// formatting). Wave 2's fuel-runway readout reuses it, so it is written general
// (full s/m/h/d ladder), not tailored to today's one caller.
//
// Converts a TICK count to seconds via `ticks * secondsPerTick`, then renders
// the largest one or two units with a leading "~" (the value is an estimate --
// the caller passes an average rate, not a guaranteed countdown):
//   sub-minute -> "~45s"      minutes -> "~12m"
//   hours      -> "~2h 15m"   days    -> "~3d 4h"
// A zero trailing sub-unit is dropped ("~2h", not "~2h 0m"). On a rounding
// boundary the sub-unit rolls up into the next unit (e.g. 59.6s of remainder
// never renders as "60m"/"60s").
//
// GUARDS (why each): a non-finite or non-positive span has no sensible ladder
// rendering, so:
//   - NaN / <= 0 (includes 0, negatives, -Infinity) -> "—"  (nothing to show)
//   - +Infinity                                      -> "∞"  (never drains)
// A positive span that rounds below one second still reads "~1s" so the readout
// never shows a broken "~0s".
export function formatDuration(ticks: number, secondsPerTick: number): string {
  const totalSeconds = ticks * secondsPerTick;

  // Non-finite / non-positive guards FIRST, before any arithmetic. Order
  // matters: NaN fails every comparison, so test it explicitly; +Infinity is
  // the one "still finite work remaining is unbounded" case that reads "∞".
  if (Number.isNaN(totalSeconds)) return "—";
  if (totalSeconds === Infinity) return "∞";
  if (totalSeconds <= 0) return "—"; // 0, negatives, and -Infinity all mean "nothing to show"

  const SECONDS_PER_MINUTE = 60;
  const SECONDS_PER_HOUR = 3600;
  const SECONDS_PER_DAY = 86400;

  // Sub-minute: whole seconds, floored at 1 so a positive sub-second span never
  // renders "~0s".
  if (totalSeconds < SECONDS_PER_MINUTE) {
    return `~${Math.max(1, Math.round(totalSeconds))}s`;
  }

  // Minutes (no seconds sub-unit -- minute granularity is enough at this scale).
  // A round-up landing on 60 rolls into "~1h" so we never print "~60m".
  if (totalSeconds < SECONDS_PER_HOUR) {
    const minutes = Math.round(totalSeconds / SECONDS_PER_MINUTE);
    return minutes >= 60 ? "~1h" : `~${minutes}m`;
  }

  // Hours + minutes. Floor the whole hours, round the remainder to minutes; a
  // remainder rounding to 60 rolls up into an extra hour with 0 minutes (then
  // dropped by the zero-trailing rule).
  if (totalSeconds < SECONDS_PER_DAY) {
    let hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
    let minutes = Math.round((totalSeconds - hours * SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    if (minutes >= 60) {
      hours += 1;
      minutes = 0;
    }
    return minutes > 0 ? `~${hours}h ${minutes}m` : `~${hours}h`;
  }

  // Days + hours. Same floor-big / round-small / roll-up-on-boundary pattern.
  let days = Math.floor(totalSeconds / SECONDS_PER_DAY);
  let hours = Math.round((totalSeconds - days * SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  if (hours >= 24) {
    days += 1;
    hours = 0;
  }
  return hours > 0 ? `~${days}d ${hours}h` : `~${days}d`;
}
