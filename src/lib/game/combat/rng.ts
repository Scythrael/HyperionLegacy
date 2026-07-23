// ============================================================================
// combat/rng.ts -- deterministic seeded PRNG for the combat sim (Combat 0.13.0,
// Phase 2 sim-core skeleton)
//
// WHY THIS EXISTS, AND WHY IT IS ITS OWN TINY MODULE:
// The entire combat system rests on ONE hard invariant (design S0 principles
// 1 to 3): a battle is a PURE function of (participants, seed), and it must
// resolve BYTE-IDENTICALLY whether it runs live (with a rendered log + flavor)
// or offline (headless, no log, no flavor). The only way to guarantee that is
// to make every outcome-affecting random draw come from a fully deterministic,
// integer-based PRNG that is seeded once and consumed in a fixed order. This
// module is that PRNG. Nothing here touches Math.random (which is nondetermin-
// istic and would instantly break replay + offline==live), and nothing here
// uses Decimal/break_infinity (that is ONLY for the unbounded idle economy;
// combat values are bounded integers, so plain 32-bit integer math is correct
// AND avoids cross-device float drift).
//
// TWO INDEPENDENT STREAMS (design S0 principle 3): the sim draws from a
// `combat` stream for every roll that changes the outcome (hit/evade, crit,
// damage variance, loot, ...) and a SEPARATE `cosmetic` stream for flavor-line
// selection only. Offline catch-up skips the cosmetic stream entirely and the
// outcome never changes. For that to hold, consuming the cosmetic stream must
// NOT perturb the combat stream in any way, so the two streams are fully
// independent PRNG instances seeded from decorrelated seeds (see makeStreams).
//
// ALGORITHM: mulberry32. Chosen because it is a single well-known 32-bit
// integer step (one multiply-free-ish mixing chain over a uint32 counter), it
// is trivially auditable (a human can read the whole generator in a few
// lines, satisfying Omega 9 tool/lock-in transparency), it is fast, and its
// output quality is more than enough for game combat rolls. We are NOT doing
// cryptography here; we need reproducibility + decent distribution, and
// mulberry32 delivers both with the smallest possible surface.
// ============================================================================

// The public shape every consumer codes against. Kept deliberately small and
// INTEGER-first: callers should reach for nextInt / nextRange / chance (all of
// which return bounded integers or booleans) so that no float ever enters the
// outcome path. `next` (a [0,1) float) is exposed only as the low-level
// primitive the integer helpers are built on; sim code should avoid it for
// outcome math to keep everything drift-proof.
export interface Rng {
	// Raw generator step: advances internal state and returns a float in [0, 1).
	// Deterministic (derived purely from state), but a FLOAT, so prefer the
	// integer helpers below for anything that affects the battle outcome.
	next(): number;
	// Returns an integer in [0, maxExclusive). maxExclusive must be >= 1.
	// This is the core integer primitive the sim uses for indexed picks.
	nextInt(maxExclusive: number): number;
	// Returns an integer in [minInclusive, maxInclusive] (both ends included).
	// Convenience wrapper for damage-variance style "roll between A and B" draws.
	nextRange(minInclusive: number, maxInclusive: number): number;
	// Returns true with probability numerator/denominator, decided by a single
	// integer draw so the odds are exact and reproducible. Used for hit/crit/
	// proc style yes-or-no rolls without introducing any float comparison.
	chance(numerator: number, denominator: number): boolean;
}

// mulberry32: given a 32-bit state, produce the next state + a [0,1) float.
// This is the ONE place the actual bit-mixing lives. Everything else is a thin
// wrapper. The `>>> 0` coercions keep every intermediate an unsigned 32-bit int
// so the sequence is identical on every JS engine (no accidental float widening
// or sign drift), which is exactly the cross-device determinism S0 demands.
function mulberry32Step(state: number): { state: number; value: number } {
	// Advance the counter by the mulberry32 odd constant (a fixed increment),
	// masked back to uint32. This is the generator's internal clock.
	let t = (state + 0x6d2b79f5) >>> 0;
	const nextState = t;
	// Mixing chain: xorshift + multiply against the state offset by an odd
	// amount, then a second xorshift/multiply, then a final xorshift. These
	// magic constants ARE the mulberry32 algorithm (not tunables); do not
	// "clean them up" or the sequence changes and every seeded battle drifts.
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	// Final scramble, then divide into [0, 1). We take the top 32 bits as an
	// unsigned value and normalize by 2^32 so the float is fully determined by
	// the integer state (same bits in => same float out, on any engine).
	const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	return { state: nextState, value };
}

// Concrete Rng backed by a single mutable uint32 state. Each instance is an
// independent stream; two instances with the same seed produce identical
// sequences, and consuming one never touches the other (that independence is
// what makeStreams relies on).
class Mulberry32Rng implements Rng {
	// The generator's entire memory: one 32-bit integer. Private + mutable; the
	// ONLY way it changes is a next() step, so the sequence is a pure function
	// of the initial seed and the number of draws taken.
	private state: number;

	constructor(seed: number) {
		// Coerce the incoming seed to uint32 up front so callers can pass any
		// integer (or a hashed value) and still land on a well-defined state.
		this.state = seed >>> 0;
	}

	next(): number {
		const stepped = mulberry32Step(this.state);
		this.state = stepped.state;
		return stepped.value;
	}

	nextInt(maxExclusive: number): number {
		// Guard: a zero-or-negative bound has no valid integer to return and
		// almost certainly signals a caller bug. Fail loud (Omega 14: no silent
		// wrong behavior) rather than returning a bogus 0 that hides the error.
		if (maxExclusive < 1) {
			throw new Error(
				`Rng.nextInt requires maxExclusive >= 1, received ${maxExclusive}`,
			);
		}
		// Multiply the [0,1) float by the range and floor. Because next() is
		// fully deterministic, this index is deterministic too. (Modulo bias is
		// irrelevant at the magnitudes combat uses; the float-multiply approach
		// keeps the mapping simple and readable, Alpha "readable > clever".)
		return Math.floor(this.next() * maxExclusive);
	}

	nextRange(minInclusive: number, maxInclusive: number): number {
		// Guard against an inverted range; again fail loud rather than silently
		// producing values outside the caller's intended band.
		if (maxInclusive < minInclusive) {
			throw new Error(
				`Rng.nextRange requires maxInclusive >= minInclusive, received ` +
					`[${minInclusive}, ${maxInclusive}]`,
			);
		}
		// Width is inclusive of both ends, hence the +1. e.g. nextRange(1, 6)
		// spans 6 possible values (a d6), never 5 and never 7.
		const width = maxInclusive - minInclusive + 1;
		return minInclusive + this.nextInt(width);
	}

	chance(numerator: number, denominator: number): boolean {
		// Guard: a denominator of 0 is a divide-by-nothing bug; block it.
		if (denominator < 1) {
			throw new Error(
				`Rng.chance requires denominator >= 1, received ${denominator}`,
			);
		}
		// Decide with a SINGLE integer draw in [0, denominator) and compare to
		// the numerator. This makes the probability exact (numerator successes
		// out of denominator equally-likely buckets) and consumes exactly one
		// step of the stream, which keeps draw-counting predictable for parity.
		return this.nextInt(denominator) < numerator;
	}
}

// Factory for a single stream. Callers that only need one deterministic stream
// (tests, ad-hoc tools) use this; the sim itself uses makeStreams below.
export function makeRng(seed: number): Rng {
	return new Mulberry32Rng(seed);
}

// Decorrelation constant for the cosmetic stream. XORing the seed with a fixed
// nonzero pattern gives the cosmetic stream a starting state far from the
// combat stream's, so the two sequences do not visibly correlate. (mulberry32
// further scrambles from there.) The exact value is arbitrary-but-fixed: it
// only has to be a stable nonzero constant so the derivation is reproducible.
const COSMETIC_SEED_XOR = 0x9e3779b9; // fractional bits of the golden ratio, a common mixing constant

// Derive the TWO independent streams the sim uses from one battle seed.
//
// WHY TWO SEPARATE INSTANCES (not one shared generator with tagged draws):
// the combat stream must advance IDENTICALLY whether or not any cosmetic work
// happens. If both roles pulled from a single generator, then generating the
// log (which selects flavor lines) would consume draws and shift every later
// combat roll, and offline (no flavor) would diverge from live. By giving each
// role its OWN generator seeded from a decorrelated seed, cosmetic draws are
// physically incapable of perturbing the combat sequence. That is the
// mechanism behind the offline==live invariant.
export function makeStreams(seed: number): { combat: Rng; cosmetic: Rng } {
	return {
		// The combat stream is seeded directly from the battle seed: this is THE
		// canonical outcome sequence, the thing that must never move.
		combat: makeRng(seed),
		// The cosmetic stream is seeded from a decorrelated transform of the same
		// seed so it is reproducible (same battle => same flavor) yet fully
		// independent of the combat stream.
		cosmetic: makeRng((seed ^ COSMETIC_SEED_XOR) >>> 0),
	};
}
