// ============================================================================
// combat/rng.test.ts -- determinism + independence guarantees for the combat
// PRNG (Combat 0.13.0, Phase 2)
//
// These tests are not "does random work" busywork; they lock the exact
// properties the whole combat-parity invariant depends on: reproducibility,
// stream independence, and bounded output. If any of these ever go red, the
// offline==live guarantee is broken at the root.
// ============================================================================

import { describe, it, expect } from "vitest";
import { makeRng, makeStreams } from "./rng";

// Pull N floats off a stream into an array, so we can compare whole sequences.
function drawFloats(rng: { next(): number }, count: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < count; i++) {
		out.push(rng.next());
	}
	return out;
}

describe("makeRng determinism", () => {
	it("same seed yields an identical sequence", () => {
		const a = drawFloats(makeRng(12345), 50);
		const b = drawFloats(makeRng(12345), 50);
		expect(a).toEqual(b);
	});

	it("different seeds yield different sequences", () => {
		const a = drawFloats(makeRng(1), 50);
		const b = drawFloats(makeRng(2), 50);
		// Not merely "not deep-equal at some far index"; the very first draw
		// should already differ for these seeds. We assert the whole arrays
		// differ, which is the property that matters.
		expect(a).not.toEqual(b);
	});
});

describe("Rng integer helpers respect bounds", () => {
	it("nextInt stays within [0, maxExclusive)", () => {
		const rng = makeRng(999);
		for (let i = 0; i < 1000; i++) {
			const v = rng.nextInt(7);
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(7);
			expect(Number.isInteger(v)).toBe(true);
		}
	});

	it("nextRange includes both endpoints and never exceeds them", () => {
		const rng = makeRng(4242);
		let sawMin = false;
		let sawMax = false;
		for (let i = 0; i < 2000; i++) {
			const v = rng.nextRange(3, 5);
			expect(v).toBeGreaterThanOrEqual(3);
			expect(v).toBeLessThanOrEqual(5);
			expect(Number.isInteger(v)).toBe(true);
			if (v === 3) sawMin = true;
			if (v === 5) sawMax = true;
		}
		// Over 2000 draws of a 3-wide band, both extremes must have appeared;
		// this catches an off-by-one that silently excludes an endpoint.
		expect(sawMin).toBe(true);
		expect(sawMax).toBe(true);
	});

	it("chance(0, d) is always false and chance(d, d) is always true", () => {
		const rng = makeRng(7);
		for (let i = 0; i < 200; i++) {
			expect(rng.chance(0, 4)).toBe(false);
			expect(rng.chance(4, 4)).toBe(true);
		}
	});

	it("nextInt throws on a non-positive bound instead of silently returning 0", () => {
		const rng = makeRng(1);
		expect(() => rng.nextInt(0)).toThrow();
	});

	it("nextRange throws on an inverted range", () => {
		const rng = makeRng(1);
		expect(() => rng.nextRange(5, 3)).toThrow();
	});
});

describe("makeStreams independence (the offline==live foundation)", () => {
	it("combat and cosmetic are different sequences from the same seed", () => {
		const { combat, cosmetic } = makeStreams(55);
		const c = drawFloats(combat, 40);
		const k = drawFloats(cosmetic, 40);
		expect(c).not.toEqual(k);
	});

	it("draining the cosmetic stream does NOT perturb the combat sequence", () => {
		// Reference: the pristine combat sequence with zero cosmetic activity.
		const reference = drawFloats(makeStreams(2024).combat, 30);

		// Now build a fresh pair, hammer the cosmetic stream first (simulating
		// live flavor-line selection that offline would skip entirely), THEN
		// read the combat stream. It must match the reference byte-for-byte.
		const streams = makeStreams(2024);
		drawFloats(streams.cosmetic, 500); // consume a lot of cosmetic draws
		const afterCosmetic = drawFloats(streams.combat, 30);

		expect(afterCosmetic).toEqual(reference);
	});

	it("same seed reproduces the same cosmetic sequence too (reproducible flavor)", () => {
		const a = drawFloats(makeStreams(77).cosmetic, 25);
		const b = drawFloats(makeStreams(77).cosmetic, 25);
		expect(a).toEqual(b);
	});
});
