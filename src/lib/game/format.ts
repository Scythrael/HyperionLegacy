// The ONE number formatting function. Never call .toString() on a game
// number for display anywhere else in the codebase — Ops §8.E.4. If the
// format needs to change later (named tiers, scientific notation threshold,
// etc.) this is the only place that changes.
//
// Accepts EITHER a plain number (time/tick/percentage/cost displays -- these
// never migrated to Decimal, see docs/plans/2026-07-08-big-number-migration-
// plan.md's field-split table) OR a Decimal (resource/currency displays).
// The plain-number branch below is BYTE-IDENTICAL to this function's
// pre-migration body -- zero behavior change for any caller passing a plain
// number, only NEW behavior added for the Decimal branch.

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

// Decimal-aware branch -- mirrors the plain-number logic above exactly (same
// tier table, same <1000/<10 thresholds, same decimals-by-magnitude rule),
// but reads magnitude from the Decimal's OWN mantissa/exponent instead of
// Math.log10 on a raw number, since a Decimal can hold values far beyond what
// Math.log10 could even represent as a finite double (that's the entire
// reason this type exists). break_infinity.js's Decimal has no isNaN()/
// isFinite() method (verified against the library's own .d.ts at plan-writing
// time) -- Number.isNaN(d.mantissa) is the equivalent check, since an invalid
// Decimal would surface as NaN in its own mantissa field.
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
