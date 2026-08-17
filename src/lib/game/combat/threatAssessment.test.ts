// ============================================================================
// combat/threatAssessment.test.ts -- tests for the ADVISORY Threat Assessment band
// (Combat 1.0, Phase 2, Unit 2.4)
//
// threatAssessment(wins, samples) is a PURE mapping from a seeded win/loss tally to
// one of seven named tiers. The load-bearing properties proven here:
//   - each RATE band (0.20 / 0.40 / 0.60 / 0.80 boundaries) maps to the right tier,
//     with each boundary belonging to the HIGHER tier;
//   - the ZERO-LOSS GUARD: wins === samples -> Guaranteed, but a sample that rounds
//     to 100% while losing >= 1 (199/200) is Likely, NOT Guaranteed;
//   - the ZERO-WIN guard: wins === 0 -> Impossible (never Extreme);
//   - defensive clamps (0 samples, out-of-range wins) still yield exactly one tier.
// ============================================================================

import { describe, it, expect } from "vitest";
import { threatAssessment, type ThreatTier } from "./threatAssessment";

// Shorthand: assert (wins, samples) maps to the expected tier id.
function expectTier(wins: number, samples: number, tier: ThreatTier): void {
	expect(threatAssessment(wins, samples).tier).toBe(tier);
}

describe("threatAssessment -- the zero-loss + zero-win guards", () => {
	it("wins === samples is Guaranteed Victory (zero losses)", () => {
		expectTier(64, 64, "guaranteed");
		expectTier(1, 1, "guaranteed");
		expectTier(200, 200, "guaranteed");
	});

	it("wins === samples - 1 that ROUNDS to 100% is Likely, NOT Guaranteed", () => {
		// 199/200 = 0.995 -> winPercent rounds to 100, but one loss exists, so the
		// zero-loss guard must keep it out of the Guaranteed tier.
		expectTier(199, 200, "likely");
		const a = threatAssessment(199, 200);
		expect(a.tier).not.toBe("guaranteed");
		expect(a.tier).toBe("likely");
	});

	it("wins === 0 is Impossible (never Extreme Challenge)", () => {
		expectTier(0, 64, "impossible");
		expectTier(0, 1, "impossible");
		expectTier(0, 200, "impossible");
	});

	it("a single win out of many is Extreme Challenge, not Impossible", () => {
		// 1/64 = 0.0156, strictly between 0 and 0.20 -> Extreme (won at least one).
		expectTier(1, 64, "extreme");
	});
});

describe("threatAssessment -- rate bands + boundary values", () => {
	// The four boundaries each belong to the HIGHER tier (r >= boundary). Use 100
	// samples so the boundary rates are exact integers of wins.
	it("r >= 0.80 (below 1.0) is Likely Victory; boundary 0.80 is Likely", () => {
		expectTier(80, 100, "likely"); // exactly 0.80
		expectTier(95, 100, "likely"); // 0.95, still < 1.0
	});

	it("0.60 <= r < 0.80 is A Worthy Adversary; boundary 0.60 is Worthy", () => {
		expectTier(60, 100, "worthy"); // exactly 0.60
		expectTier(79, 100, "worthy"); // 0.79, just below 0.80
	});

	it("0.40 <= r < 0.60 is Toss the Dice; boundary 0.40 is Dice", () => {
		expectTier(40, 100, "dice"); // exactly 0.40
		expectTier(59, 100, "dice"); // 0.59, just below 0.60
		expectTier(50, 100, "dice"); // a true coin toss
	});

	it("0.20 <= r < 0.40 is Not Advised; boundary 0.20 is Not Advised", () => {
		expectTier(20, 100, "notAdvised"); // exactly 0.20
		expectTier(39, 100, "notAdvised"); // 0.39, just below 0.40
	});

	it("0 < r < 0.20 is Extreme Challenge", () => {
		expectTier(19, 100, "extreme"); // 0.19, just below 0.20
		expectTier(5, 100, "extreme"); // 0.05
	});

	it("just below each boundary drops to the lower tier", () => {
		// 79/100 = 0.79 -> Worthy (not Likely); 59 -> Dice; 39 -> Not Advised; 19 -> Extreme.
		expectTier(79, 100, "worthy");
		expectTier(59, 100, "dice");
		expectTier(39, 100, "notAdvised");
		expectTier(19, 100, "extreme");
	});
});

describe("threatAssessment -- returned content shape", () => {
	it("every tier returns a non-empty name, color, icon, fuzzyRange, voice", () => {
		// Drive one representative sample into each of the seven tiers and assert the
		// content fields are all populated (no blank chip / tooltip anywhere).
		const cases: Array<[number, number, ThreatTier]> = [
			[64, 64, "guaranteed"],
			[90, 100, "likely"],
			[70, 100, "worthy"],
			[50, 100, "dice"],
			[30, 100, "notAdvised"],
			[10, 100, "extreme"],
			[0, 64, "impossible"],
		];
		for (const [wins, samples, tier] of cases) {
			const a = threatAssessment(wins, samples);
			expect(a.tier).toBe(tier);
			expect(a.name.length).toBeGreaterThan(0);
			expect(a.colorHex.length).toBeGreaterThan(0);
			expect(a.icon.length).toBeGreaterThan(0);
			expect(a.fuzzyRange.length).toBeGreaterThan(0);
			expect(a.voice.length).toBeGreaterThan(0);
		}
	});

	it("fuzzyRange + voice carry no em dash or double-hyphen (house style)", () => {
		// The whole no-em-dash rule extends to in-world flavor strings (Unit 2.4 constraint).
		const tiers: Array<[number, number]> = [
			[64, 64],
			[90, 100],
			[70, 100],
			[50, 100],
			[30, 100],
			[10, 100],
			[0, 64],
		];
		for (const [wins, samples] of tiers) {
			const a = threatAssessment(wins, samples);
			expect(a.fuzzyRange).not.toContain("—"); // em dash
			expect(a.fuzzyRange).not.toContain("--");
			expect(a.voice).not.toContain("—");
			expect(a.voice).not.toContain("--");
		}
	});

	it("is a pure function of (wins, samples): same inputs, same output", () => {
		const a = threatAssessment(45, 64);
		const b = threatAssessment(45, 64);
		expect(a).toEqual(b);
	});
});

describe("threatAssessment -- defensive clamps", () => {
	it("0 samples degrades to a single-sample read (no NaN tier)", () => {
		// samples clamps to >= 1; wins clamps into [0, samples]. 0/0 -> wins 0 -> Impossible.
		expectTier(0, 0, "impossible");
		// wins above the clamped sample floor becomes a full-win (Guaranteed) rather than NaN.
		expectTier(5, 0, "guaranteed");
	});

	it("wins above samples clamps to samples (Guaranteed, not out of range)", () => {
		expectTier(100, 64, "guaranteed");
	});

	it("negative wins clamps to 0 (Impossible)", () => {
		expectTier(-5, 64, "impossible");
	});
});
