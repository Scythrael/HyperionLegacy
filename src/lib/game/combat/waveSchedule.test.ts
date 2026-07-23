// ============================================================================
// combat/waveSchedule.test.ts -- invariant proofs for the deterministic Patrol
// wave-schedule generator (Combat 0.13.0, Phase 9b sub-phase 3)
//
// These tests do not check "does it pick some ticks"; they lock the CONTRACT
// the mission loop will lean on:
//   1. Determinism  -- same (seed, params) => byte-identical array (design S0).
//   2. Bounds       -- length always in [minWaves, maxWaves]; ticks in-window,
//                       strictly ascending, unique (one wave per tick max).
//   3. Floor        -- catch-up alone reaches minWaves even with 0% natural
//                       chance, and the guaranteed waves are SPREAD, not stacked
//                       at the final tick.
//   4. Ceiling      -- maxWaves holds even when every natural roll succeeds.
//   5. Monotonicity -- raising maxWaves (Infamy) never yields fewer waves and,
//                       in the certain-chance case, the smaller run is a prefix.
//   6. Guards       -- bad params throw loudly (mirrors rng.ts's throw tests).
// If any of these go red, the offline==live combat invariant is at risk at the
// wave-count level, so treat a failure here as a determinism regression.
// ============================================================================

import { describe, it, expect } from "vitest";
import { planWaveSchedule, type WaveScheduleParams } from "./waveSchedule";

// A reasonable "typical Patrol" baseline the individual tests clone and tweak.
// Kept in one place so a param rename is a single edit.
const BASE: WaveScheduleParams = {
	minWaves: 2,
	maxWaves: 5,
	rollStartTick: 10,
	rollEndTick: 100,
	waveChanceNumerator: 15,
	waveChanceDenominator: 100,
};

// Recompute the documented checkpoint ticks INDEPENDENTLY of the module, so the
// floor tests can assert the exact spread the algorithm promises. This mirrors
// the formula in waveSchedule.ts on purpose: it is the contract we are locking,
// and duplicating it here means a silent change to the spacing breaks a test.
function expectedCheckpoints(params: WaveScheduleParams): number[] {
	const window = params.rollEndTick - params.rollStartTick;
	const out: number[] = [];
	for (let i = 1; i <= params.minWaves; i++) {
		out.push(params.rollStartTick + Math.floor((i * window) / params.minWaves));
	}
	return out;
}

// A spread of seeds to hammer probabilistic properties across many streams.
// Fixed list (not random) so the test run itself stays deterministic.
const SEEDS = [
	0, 1, 2, 3, 7, 42, 99, 123, 1000, 65535, 123456, 999999, 2 ** 31 - 1,
];

describe("planWaveSchedule determinism", () => {
	it("same seed + params yields an identical array, across many seeds", () => {
		for (const seed of SEEDS) {
			const a = planWaveSchedule(seed, BASE);
			const b = planWaveSchedule(seed, BASE);
			expect(a).toEqual(b);
		}
	});
});

describe("planWaveSchedule bounds + shape", () => {
	it("length is always within [minWaves, maxWaves] for many seeds", () => {
		for (const seed of SEEDS) {
			const result = planWaveSchedule(seed, BASE);
			expect(result.length).toBeGreaterThanOrEqual(BASE.minWaves);
			expect(result.length).toBeLessThanOrEqual(BASE.maxWaves);
		}
	});

	it("every tick is in-window, strictly ascending, and unique", () => {
		for (const seed of SEEDS) {
			const result = planWaveSchedule(seed, BASE);
			for (let i = 0; i < result.length; i++) {
				expect(result[i]).toBeGreaterThanOrEqual(BASE.rollStartTick);
				expect(result[i]).toBeLessThanOrEqual(BASE.rollEndTick);
				if (i > 0) {
					// Strictly ascending implies both sorted AND unique (one per tick).
					expect(result[i]).toBeGreaterThan(result[i - 1]);
				}
			}
		}
	});
});

describe("planWaveSchedule minimum guaranteed (catch-up)", () => {
	it("with 0% natural chance, length === minWaves and ticks are the spread checkpoints", () => {
		const params: WaveScheduleParams = {
			...BASE,
			waveChanceNumerator: 0, // no natural roll can ever fire
		};
		const checkpoints = expectedCheckpoints(params);
		for (const seed of SEEDS) {
			const result = planWaveSchedule(seed, params);
			// Catch-up alone must hit the floor exactly (no natural additions).
			expect(result.length).toBe(params.minWaves);
			// And it must land on the documented, evenly-spread checkpoint ticks.
			expect(result).toEqual(checkpoints);
		}
	});

	it("the guaranteed waves are SPREAD, not all stacked at rollEndTick", () => {
		const params: WaveScheduleParams = { ...BASE, waveChanceNumerator: 0 };
		const result = planWaveSchedule(SEEDS[0], params);
		// First guaranteed wave is strictly before the last tick; last one lands
		// exactly on rollEndTick (the final checkpoint deadline).
		expect(result[0]).toBeLessThan(params.rollEndTick);
		expect(result[result.length - 1]).toBe(params.rollEndTick);
	});
});

describe("planWaveSchedule maximum enforced (cap)", () => {
	it("with certain natural chance, length === maxWaves (scheduling stops early)", () => {
		const params: WaveScheduleParams = {
			...BASE,
			waveChanceNumerator: 100,
			waveChanceDenominator: 100, // every roll succeeds
		};
		for (const seed of SEEDS) {
			const result = planWaveSchedule(seed, params);
			expect(result.length).toBe(params.maxWaves);
		}
	});
});

describe("planWaveSchedule Infamy raises max (monotonic)", () => {
	it("a larger maxWaves never yields fewer waves and is prefix-compatible (certain chance)", () => {
		const small: WaveScheduleParams = {
			...BASE,
			maxWaves: 4,
			waveChanceNumerator: 100,
			waveChanceDenominator: 100,
		};
		const large: WaveScheduleParams = { ...small, maxWaves: 7 };
		for (const seed of SEEDS) {
			const smallRun = planWaveSchedule(seed, small);
			const largeRun = planWaveSchedule(seed, large);
			expect(largeRun.length).toBeGreaterThanOrEqual(smallRun.length);
			// In the certain-chance case waves fill contiguously from the start, so
			// the smaller run must be an exact prefix of the larger one.
			expect(largeRun.slice(0, smallRun.length)).toEqual(smallRun);
		}
	});

	it("prefix property holds at realistic 15% chance too (the property Infamy relies on)", () => {
		// The prefix relationship is NOT special to certain chance: maxWaves only
		// affects the early-stop break, so two runs that differ ONLY in maxWaves
		// draw byte-identical PRNG values (same seed, same order) until the smaller
		// cap is reached. Raising the cap (Infamy) therefore only ever EXTENDS the
		// schedule, never rewrites its earlier waves. This is the exact guarantee
		// Infamy scaling leans on, so we prove it at the realistic BASE 15% chance.
		const small: WaveScheduleParams = { ...BASE, maxWaves: 3 };
		const large: WaveScheduleParams = { ...small, maxWaves: 6 };
		for (const seed of SEEDS) {
			const smallRun = planWaveSchedule(seed, small);
			const largeRun = planWaveSchedule(seed, large);
			expect(largeRun.length).toBeGreaterThanOrEqual(smallRun.length);
			expect(largeRun.slice(0, smallRun.length)).toEqual(smallRun);
		}
	});
});

describe("planWaveSchedule edge cases", () => {
	it("minWaves === 0 with 0% chance returns []", () => {
		const params: WaveScheduleParams = {
			...BASE,
			minWaves: 0,
			waveChanceNumerator: 0,
		};
		for (const seed of SEEDS) {
			expect(planWaveSchedule(seed, params)).toEqual([]);
		}
	});

	it("minWaves === maxWaves produces exactly that many waves regardless of chance", () => {
		// Try both extremes of chance; the count is pinned either way.
		for (const num of [0, 100]) {
			const params: WaveScheduleParams = {
				...BASE,
				minWaves: 3,
				maxWaves: 3,
				waveChanceNumerator: num,
				waveChanceDenominator: 100,
			};
			for (const seed of SEEDS) {
				expect(planWaveSchedule(seed, params).length).toBe(3);
			}
		}
	});

	it("maxWaves === 0 returns [] immediately", () => {
		const params: WaveScheduleParams = {
			...BASE,
			minWaves: 0,
			maxWaves: 0,
		};
		for (const seed of SEEDS) {
			expect(planWaveSchedule(seed, params)).toEqual([]);
		}
	});
});

describe("planWaveSchedule guard throws", () => {
	it("throws when minWaves < 0", () => {
		expect(() =>
			planWaveSchedule(1, { ...BASE, minWaves: -1 }),
		).toThrow();
	});

	it("throws on a fractional tick (no float may enter the outcome path)", () => {
		expect(() =>
			planWaveSchedule(1, { ...BASE, rollStartTick: 10.5 }),
		).toThrow();
	});

	it("throws on a NaN numerator (Number.isInteger rejects NaN)", () => {
		expect(() =>
			planWaveSchedule(1, { ...BASE, waveChanceNumerator: NaN }),
		).toThrow();
	});

	it("throws when maxWaves < minWaves", () => {
		expect(() =>
			planWaveSchedule(1, { ...BASE, minWaves: 5, maxWaves: 4 }),
		).toThrow();
	});

	it("throws when rollStartTick > rollEndTick (inverted window)", () => {
		expect(() =>
			planWaveSchedule(1, { ...BASE, rollStartTick: 100, rollEndTick: 10 }),
		).toThrow();
	});

	it("throws when denominator < 1", () => {
		expect(() =>
			planWaveSchedule(1, { ...BASE, waveChanceDenominator: 0 }),
		).toThrow();
	});

	it("throws when numerator is out of [0, denominator]", () => {
		expect(() =>
			planWaveSchedule(1, { ...BASE, waveChanceNumerator: -1 }),
		).toThrow();
		expect(() =>
			planWaveSchedule(1, {
				...BASE,
				waveChanceNumerator: 101,
				waveChanceDenominator: 100,
			}),
		).toThrow();
	});

	it("throws when the window is too small to hold minWaves distinct ticks", () => {
		// Window holds 3 ticks (98,99,100) but minWaves demands 4: impossible.
		expect(() =>
			planWaveSchedule(1, {
				...BASE,
				minWaves: 4,
				maxWaves: 4,
				rollStartTick: 98,
				rollEndTick: 100,
			}),
		).toThrow();
	});
});
