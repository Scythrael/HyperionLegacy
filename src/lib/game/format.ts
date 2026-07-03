// The ONE number formatting function. Never call .toString() on a game
// number for display anywhere else in the codebase — Ops §8.E.4. If the
// format needs to change later (named tiers, scientific notation threshold,
// etc.) this is the only place that changes.

const TIERS = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc"];

export function formatNumber(n: number): string {
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
