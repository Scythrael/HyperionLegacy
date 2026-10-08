// E-CREW 0.14.0 (Task 15a): the shared DIMINISHING RETURNS curve (design D23, user 2026-10-08).
//
// D23: "Diminishing returns will 100% come into play, but without removing the entire ability to push past
// a certain point. Numbers get bigger and bigger and as you get more, they mean less and less." So a bonus
// passes through an UNBOUNDED concave curve, never a ceiling:
//
//   diminishing(x, knee) = knee * (sqrt(1 + 2x / knee) - 1)        (x > 0; 0 otherwise)
//
// Why this shape:
//   - f(0) = 0 and f'(0) = 1: an empty bonus stays exactly empty (additive-neutral) and a bonus far below
//     the knee passes nearly 1:1 (it keeps about 1 - x / (2 knee) of its value: +30% at a knee of 2 keeps
//     about 93%).
//   - f'(x) = 1 / sqrt(1 + 2x / knee): strictly decreasing, so each extra point is worth less than the last,
//     yet always positive, so more is never worse.
//   - UNBOUNDED: far past the knee it grows like sqrt(2 knee x) (four times the input is about twice the
//     output). That is D23's "push past a certain point" with no ceiling.
//   - At the knee itself a bonus keeps sqrt(3) - 1 (about 73%) of its value; at half the knee about 83%.
// Rejected: knee * ln(1 + x / knee) (unbounded but so slow it reads as a cap to a player) and
// x / (1 + x / knee) (bounded by the knee: a hard cap in disguise, which D23 rules out).
// Scale-free: diminishing(c x, c knee) == c diminishing(x, knee), so a knee is stated in the input's unit.
//
// Computed as 2x / (sqrt(1 + 2x / knee) + 1), the same value without the cancellation the subtraction
// suffers for a tiny x. PURE: no state, no random draw, so offline == live holds by construction.
// Existing asymptotic curves (model.ts, utilityGear.ts) are a balance-pass review item, not changed here.

export function diminishing(x: number, knee: number): number {
  if (!(knee > 0) || !Number.isFinite(knee)) {
    throw new RangeError(`diminishing: knee must be a positive finite number (got ${knee})`);
  }
  if (!(x > 0)) return 0; // also 0 for NaN
  if (x === Number.POSITIVE_INFINITY) return x; // unbounded: infinity stays infinity (the form below is NaN)
  return (2 * x) / (Math.sqrt(1 + (2 * x) / knee) + 1);
}
