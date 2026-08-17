// ============================================================================
// combat/threatAssessment.ts -- the ADVISORY "should I dispatch into this?" BAND
// (Combat 1.0, Phase 2, Unit 2.4)
//
// WHAT THIS IS:
// engagementForecast (rating.ts) runs YOUR build vs a patrol's enemies through the
// real deterministic sim across N seeded battles and reports a raw win COUNT. That
// raw count is deliberately NOT shown to the player: a bare "73% win chance" invites
// false precision on a coarse, seed-dependent estimate. threatAssessment maps the
// count into one of seven NAMED, colored TIERS the dispatch card shows instead. The
// player sees a categorical read ("A Worthy Adversary") plus a coarse fuzzy phrase
// and an in-world tactical-officer line, never the exact percentage.
//
// PURITY: this is a PURE function of two integers (wins, samples). No RNG, no sim,
// no game state, no side effects. It is display mapping ONLY; it never influences a
// real patrol outcome (Unit 2.4 parity contract).
//
// THE BANDS (mapped from the win RATE r = wins / samples, boundaries at 0.20 / 0.40
// / 0.60 / 0.80, each boundary belonging to the HIGHER tier):
//
//   Guaranteed Victory        wins === samples           (ZERO losses, see guard)
//   Likely Victory            0.80 <= r  AND wins < samples
//   A Worthy Adversary        0.60 <= r < 0.80
//   It's Time to Toss the Dice 0.40 <= r < 0.60
//   Not Advised               0.20 <= r < 0.40
//   Extreme Challenge         0.00 <  r < 0.20
//   Impossible                wins === 0                 (ZERO wins)
//
// THE ZERO-LOSS GUARD (the load-bearing rule):
// "Guaranteed Victory" is reserved for a fight that lost ZERO of the whole sample
// (wins === samples). It is NOT enough for the win RATE to round to 100%: a 199/200
// sample rounds to 100% yet lost once, so it is "Likely Victory", never "Guaranteed".
// This keeps the strongest label HONEST: it only ever appears on a fight the sim
// could not find a single loss for. Symmetrically, "Impossible" is reserved for
// wins === 0 (the sim never once won), distinct from "Extreme Challenge" which still
// won at least one sample.
//
// EVALUATION ORDER matters and is enforced below:
//   1. wins === 0        -> Impossible   (must beat the "0 < r" Extreme band)
//   2. wins === samples  -> Guaranteed   (must beat the "r >= 0.80" Likely band)
//   3. otherwise map the rate r, where wins is now guaranteed in (0, samples).
//
// COLORS: the per-band hex values are the mockup's literal band palette (a warm gold
// for Guaranteed down through green / lime / yellow / orange / red / dark-red). They
// are intentionally LITERAL hex, not app theme tokens: the band ramp is a fixed
// semantic scale (green == good, red == bad) that must read the same in every theme,
// so it does not follow the light/dark token swap. The dispatch card's surrounding
// chrome still uses theme tokens; only the chip's accent color is from this ramp.
// ============================================================================

// The stable machine id per tier. Persist-safe + switch-exhaustive; the display
// `name` is separate so copy can change without breaking a stored/compared id.
export type ThreatTier =
	| "guaranteed"
	| "likely"
	| "worthy"
	| "dice"
	| "notAdvised"
	| "extreme"
	| "impossible";

// One fully-resolved advisory readout for the dispatch card.
export interface ThreatAssessment {
	// Stable machine id (see ThreatTier). For keys / tests / conditional styling.
	tier: ThreatTier;
	// The player-facing band name shown on the chip (e.g. "A Worthy Adversary").
	name: string;
	// The chip accent color: a LITERAL hex from the mockup's band ramp (NOT a theme
	// token, by design; see the header). Named colorHex because it stores a literal hex
	// value (e.g. "#fbbf24"); the App consumer feeds it into the chip's --threat-color.
	colorHex: string;
	// A short glyph shown on the chip (emoji, rendered as the chip's leading icon).
	icon: string;
	// A COARSE, decimals-free phrase for the tooltip (never the exact percent). It
	// conveys the rough shape of the odds without the false precision of a number.
	fuzzyRange: string;
	// One in-world TACTICAL-OFFICER line advising the Admiral, shown in the tooltip.
	voice: string;
}

// The per-tier static content. One table so a copy / color tweak lives in exactly
// one place, and the mapping function below only decides WHICH tier, never its text.
const TIER_CONTENT: Record<ThreatTier, Omit<ThreatAssessment, "tier">> = {
	guaranteed: {
		name: "Guaranteed Victory",
		// Warm gold, distinct from the paler Dice yellow below (the crown tier).
		colorHex: "#fbbf24",
		icon: "👑",
		fuzzyRange: "Not one simulated engagement was lost",
		voice:
			"Every projection comes back clean, Admiral. Not a hull lost across the board. Give the order.",
	},
	likely: {
		name: "Likely Victory",
		colorHex: "#86efac",
		icon: "🛡️",
		fuzzyRange: "Roughly 4 in 5 or better fall in your favor",
		voice:
			"The odds sit firmly with us, Admiral. Expect a win, though I would not promise it bloodless.",
	},
	worthy: {
		name: "A Worthy Adversary",
		colorHex: "#bef264",
		icon: "⚔️",
		fuzzyRange: "Closer to 3 in 5 in your favor",
		voice:
			"A real fight, Admiral. We hold the edge, but this crew will have to earn it.",
	},
	dice: {
		name: "It's Time to Toss the Dice",
		colorHex: "#fde047",
		icon: "🎲",
		fuzzyRange: "About a coin toss either way",
		voice:
			"Too close to call, Admiral. This one turns on the rolls. Your order, your risk.",
	},
	notAdvised: {
		name: "Not Advised",
		colorHex: "#fb923c",
		icon: "⚠️",
		fuzzyRange: "Only about 1 in 3 ends in a win",
		voice:
			"I would counsel against it, Admiral. The numbers favor them more often than not.",
	},
	extreme: {
		name: "Extreme Challenge",
		colorHex: "#ef4444",
		icon: "🔥",
		fuzzyRange: "Fewer than 1 in 5 come back a victory",
		voice:
			"This is a long shot, Admiral. Most projections end with us adrift and burning.",
	},
	impossible: {
		name: "Impossible",
		colorHex: "#7f1d1d",
		icon: "💀",
		fuzzyRange: "No simulated engagement was won",
		voice:
			"We cannot win this as we stand, Admiral. Install stronger gear before you commit the crew.",
	},
};

// Band boundaries on the win RATE (r = wins / samples). Each boundary belongs to the
// HIGHER tier (r >= boundary), so exactly 0.80 is "Likely", exactly 0.60 is "Worthy",
// etc. Named so the thresholds are stated once and read the same as the header table.
const BAND_LIKELY = 0.8;
const BAND_WORTHY = 0.6;
const BAND_DICE = 0.4;
const BAND_NOT_ADVISED = 0.2;

// Map a seeded win/loss tally into its advisory tier + all display content.
//
// GUARDS FIRST (exact counts, before any rate math), then the rate bands:
//   - samples is clamped to >= 1 so the rate is never a divide-by-zero (a malformed
//     0-sample forecast degrades to a single-sample read rather than NaN).
//   - wins is clamped into [0, samples] so a stray out-of-range count (never expected
//     from engagementForecast, but cheap to defend) cannot escape the seven tiers.
export function threatAssessment(wins: number, samples: number): ThreatAssessment {
	// Defensive clamps: keep the mapping total (every input yields exactly one tier).
	const safeSamples = Math.max(1, Math.floor(samples));
	const safeWins = Math.max(0, Math.min(safeSamples, Math.floor(wins)));

	const tier = tierFor(safeWins, safeSamples);
	return { tier, ...TIER_CONTENT[tier] };
}

// Decide the tier id from the clamped counts. Kept separate from the content lookup
// so the branching logic is testable + readable on its own. Evaluation order is the
// contract (see the header): the two exact-count guards MUST precede the rate bands.
function tierFor(wins: number, samples: number): ThreatTier {
	// GUARD 1: zero wins across the whole sample -> Impossible. Precedes the rate
	// bands so a 0-win read is never mislabeled "Extreme Challenge" (which requires
	// at least one win). r would be exactly 0 here.
	if (wins === 0) return "impossible";

	// GUARD 2: zero LOSSES across the whole sample -> Guaranteed Victory (the crown
	// tier). Precedes the rate bands so a 199/200 read (r rounds to ~100% but lost
	// once) can never claim "Guaranteed"; it falls through to the r >= 0.80 Likely
	// band below. This is the zero-loss guard the header describes.
	if (wins === samples) return "guaranteed";

	// From here wins is strictly in (0, samples), so r is strictly in (0, 1): every
	// remaining tier is reachable and none of the guards' exact cases can recur.
	const r = wins / samples;
	if (r >= BAND_LIKELY) return "likely";
	if (r >= BAND_WORTHY) return "worthy";
	if (r >= BAND_DICE) return "dice";
	if (r >= BAND_NOT_ADVISED) return "notAdvised";
	// 0 < r < 0.20: won at least one (not Impossible) but deeply unfavorable.
	return "extreme";
}
