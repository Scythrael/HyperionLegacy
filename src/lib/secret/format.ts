// format.ts: the secret game's own number formatter (0.13.11).
//
// The main game's formatNumber (src/lib/game/format.ts) is deliberately left untouched: this is a
// separate module so nothing the easter egg needs can move a main-game display. Same reading rules
// as the main formatter below 1e30 (K to Oc, three significant figures, whole numbers literal),
// then scientific "1.23e45". Exponents of 1,000 and up get thousands separators so they stay
// readable: "4.21e1,284", and a goal reads "e777,777".

import Decimal from "break_infinity.js";

const TIERS = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc"];

// "1284" -> "1,284". Integers only (exponents and counts).
export function groupThousands(n: number): string {
  const sign = n < 0 ? "-" : "";
  const digits = Math.floor(Math.abs(n)).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// A power of ten as a goal: 777777 -> "e777,777".
export function formatExponent(e: number): string {
  return `e${groupThousands(e)}`;
}

function decimalsFor(scaled: number): number {
  const m = Math.abs(scaled);
  return m < 10 ? 2 : m < 100 ? 1 : 0;
}

function formatSmall(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return Math.abs(n) < 10 && n !== 0 ? n.toFixed(2) : Math.trunc(n).toString();
}

export function formatSecret(value: Decimal | number): string {
  const d = value instanceof Decimal ? value : new Decimal(value);
  if (!Number.isFinite(d.mantissa) || !Number.isFinite(d.exponent)) return "0";
  if (d.mantissa === 0) return "0";
  if (d.lt(0)) return `-${formatSecret(d.neg())}`;
  if (d.exponent < 3) return formatSmall(d.toNumber());

  if (d.exponent < TIERS.length * 3) {
    let tier = Math.floor(d.exponent / 3);
    let scaled = d.mantissa * Math.pow(10, d.exponent - tier * 3);
    let places = decimalsFor(scaled);
    if (Number(scaled.toFixed(places)) >= 1000 && tier + 1 < TIERS.length) {
      tier += 1;
      scaled = d.mantissa * Math.pow(10, d.exponent - tier * 3);
      places = decimalsFor(scaled);
    }
    if (Number(scaled.toFixed(places)) >= 1000) return scientific(d);
    return `${scaled.toFixed(places)}${TIERS[tier]}`;
  }
  return scientific(d);
}

// 0.13.11.2 prestige previews: a multiplier with three significant figures from 10 to 1,000 too, where
// formatSecret drops the decimals (12.4 reads "12"), so a small before and after change still shows.
export function formatMultiplier(value: Decimal | number): string {
  const d = value instanceof Decimal ? value : new Decimal(value);
  const n = d.toNumber();
  if (!Number.isFinite(n) || n < 10 || n >= 1000 || Number.isInteger(n)) return formatSecret(d);
  const places = Number(n.toFixed(1)) < 100 ? 1 : 0;
  return n.toFixed(places);
}

function scientific(d: Decimal): string {
  let mantissa = d.mantissa;
  let exponent = d.exponent;
  // Rounding 9.996 to two places reads "10.00": roll it into the next power instead.
  if (Number(mantissa.toFixed(2)) >= 10) {
    mantissa /= 10;
    exponent += 1;
  }
  return `${mantissa.toFixed(2)}e${groupThousands(exponent)}`;
}
