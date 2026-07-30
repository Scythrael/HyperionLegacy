// ============================================================================
// combat/durability.test.ts -- unit tests for the durability model (Combat
// 0.13.0, Phase 5, design S9)
//
// The whole point of Phase 5 durability is a PURE, tested helper (the live sim
// wiring is the integration phase). These tests pin the model's contract:
//   - quality REDUCES the per-event loss chance (design S9 ~-10%/rank),
//   - quality RAISES max durability (~+100% at the top rank),
//   - rollDurabilityLoss is deterministic + seeded and drops exactly one point,
//   - systemCondition reports the four-state model with its documented precedence.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
	durabilityLossChance,
	qualityDurabilityMax,
	rollDurabilityLoss,
	systemCondition,
	reactorDamagePercent,
	ftlEvasionPenaltyPercent,
	ftlSpeedPenaltyPercent,
	BASE_DURABILITY_LOSS_PERCENT,
	DEGRADED_THRESHOLD_PERCENT,
	DEGRADED_WEAPON_DAMAGE_PERCENT,
	REACTOR_DAMAGE_PERCENT_DEGRADED,
	REACTOR_DAMAGE_PERCENT_OFFLINE,
	FTL_EVASION_PENALTY_DEGRADED,
	FTL_EVASION_PENALTY_OFFLINE,
	FTL_SPEED_PENALTY_DEGRADED,
	FTL_SPEED_PENALTY_OFFLINE,
	type DurableSystem,
} from "./durability";
import { makeStreams } from "./rng";

// A durable-system factory so each test states only what it cares about.
function sys(overrides: Partial<DurableSystem> = {}): DurableSystem {
	return {
		durability: overrides.durability ?? 100,
		durabilityMax: overrides.durabilityMax ?? 100,
		quality: overrides.quality ?? 0,
	};
}

describe("durabilityLossChance: quality reduces the per-event loss chance", () => {
	it("quality 0 is the base chance", () => {
		expect(durabilityLossChance(0)).toBe(BASE_DURABILITY_LOSS_PERCENT);
	});

	it("is monotonically NON-INCREASING as quality climbs, and strictly lower at the top", () => {
		let prev = durabilityLossChance(0);
		for (let q = 1; q <= 5; q++) {
			const cur = durabilityLossChance(q);
			expect(cur).toBeLessThanOrEqual(prev);
			prev = cur;
		}
		// Top quality is strictly better than quality 0 (the mitigation is real).
		expect(durabilityLossChance(5)).toBeLessThan(durabilityLossChance(0));
	});

	it("applies the -10%/rank multiplicatively (exact integer floors)", () => {
		// 50 -> floor(50*0.9)=45 -> floor(45*0.9)=40 -> floor(40*0.9)=36.
		expect(durabilityLossChance(1)).toBe(45);
		expect(durabilityLossChance(2)).toBe(40);
		expect(durabilityLossChance(3)).toBe(36);
	});

	it("clamps out-of-range quality (never negative, never past rank 5)", () => {
		// Below 0 behaves as 0; above 5 behaves as 5 (defensive clamp).
		expect(durabilityLossChance(-3)).toBe(durabilityLossChance(0));
		expect(durabilityLossChance(99)).toBe(durabilityLossChance(5));
	});
});

describe("qualityDurabilityMax: quality raises the durability ceiling", () => {
	it("quality 0 leaves the base untouched", () => {
		expect(qualityDurabilityMax(100, 0)).toBe(100);
	});

	it("quality 5 roughly DOUBLES the base (~+100%, design S9)", () => {
		expect(qualityDurabilityMax(100, 5)).toBe(200);
	});

	it("scales +20%/rank in between (exact integer floor)", () => {
		expect(qualityDurabilityMax(100, 1)).toBe(120);
		expect(qualityDurabilityMax(100, 3)).toBe(160);
		// A base that does not divide evenly floors cleanly.
		expect(qualityDurabilityMax(75, 1)).toBe(90); // floor(75 * 120/100)
	});
});

describe("rollDurabilityLoss: deterministic seeded single-point loss", () => {
	it("drops exactly one durability point on a losing roll, never below zero", () => {
		// A quality-0 system (40% loss chance) over a fixed seed: some events lose a
		// point, each losing event drops EXACTLY one, and it never goes negative.
		const { combat } = makeStreams(1234);
		const s = sys({ durability: 5, durabilityMax: 5, quality: 0 });
		let losses = 0;
		for (let i = 0; i < 100; i++) {
			const before = s.durability;
			const lost = rollDurabilityLoss(s, combat);
			if (lost) {
				losses++;
				expect(s.durability).toBe(before - 1); // exactly one point
			} else {
				expect(s.durability).toBe(before); // untouched on a non-loss
			}
			expect(s.durability).toBeGreaterThanOrEqual(0); // never negative
		}
		// Over 100 events at ~40% the pool of 5 is certainly exhausted to 0.
		expect(s.durability).toBe(0);
		expect(losses).toBe(5); // only 5 points ever existed to lose
	});

	it("is fully deterministic per seed (same loss sequence twice)", () => {
		const run = () => {
			const { combat } = makeStreams(42);
			const s = sys({ durability: 50, durabilityMax: 50 });
			const seq: boolean[] = [];
			for (let i = 0; i < 30; i++) seq.push(rollDurabilityLoss(s, combat));
			return { seq, final: s.durability };
		};
		const a = run();
		const b = run();
		expect(a.seq).toEqual(b.seq);
		expect(a.final).toBe(b.final);
	});

	it("higher quality loses durability more slowly over the SAME seed", () => {
		// Same seed + same event count: a quality-5 system (lower loss chance) must
		// retain at least as much durability as a quality-0 one. Statistical but
		// deterministic on a fixed seed.
		const drain = (quality: number) => {
			const { combat } = makeStreams(777);
			const s = sys({ durability: 200, durabilityMax: 200, quality });
			for (let i = 0; i < 100; i++) rollDurabilityLoss(s, combat);
			return s.durability;
		};
		expect(drain(5)).toBeGreaterThan(drain(0));
	});

	it("a system already at 0 spends no roll and stays offline", () => {
		const { combat } = makeStreams(9);
		const s = sys({ durability: 0, durabilityMax: 100 });
		expect(rollDurabilityLoss(s, combat)).toBe(false);
		expect(s.durability).toBe(0);
	});
});

describe("systemCondition: four-state model + precedence (design S9/S16)", () => {
	it("nominal when healthy and undisrupted", () => {
		expect(systemCondition(sys({ durability: 100, durabilityMax: 100 }))).toBe(
			"nominal",
		);
	});

	it("degraded when durability is at/below the threshold (but > 0)", () => {
		// DEGRADED_THRESHOLD_PERCENT of max is the boundary; at it => degraded.
		const atThreshold = sys({
			durability: DEGRADED_THRESHOLD_PERCENT,
			durabilityMax: 100,
		});
		expect(systemCondition(atThreshold)).toBe("degraded");
		const belowThreshold = sys({ durability: 10, durabilityMax: 100 });
		expect(systemCondition(belowThreshold)).toBe("degraded");
		// Just ABOVE the threshold is still nominal.
		const aboveThreshold = sys({
			durability: DEGRADED_THRESHOLD_PERCENT + 1,
			durabilityMax: 100,
		});
		expect(systemCondition(aboveThreshold)).toBe("nominal");
	});

	it("offline when durability is depleted (0), regardless of anything else", () => {
		// Offline dominates: even flagged disrupted, a 0-durability system is offline.
		expect(systemCondition(sys({ durability: 0, durabilityMax: 100 }))).toBe(
			"offline",
		);
		expect(
			systemCondition(sys({ durability: 0, durabilityMax: 100 }), true),
		).toBe("offline");
	});

	it("offline when hard-disabled (e.g. Weapon Jam) even at full durability", () => {
		// A hard-disable source forces offline without draining durability.
		expect(
			systemCondition(sys({ durability: 100, durabilityMax: 100 }), false, true),
		).toBe("offline");
	});

	it("disrupted outranks degraded (an active debuff is more urgent than wear)", () => {
		// Low durability (would be degraded) AND disrupted => reports disrupted.
		const worn = sys({ durability: 10, durabilityMax: 100 });
		expect(systemCondition(worn, true)).toBe("disrupted");
		// Healthy + disrupted is also disrupted.
		const healthy = sys({ durability: 100, durabilityMax: 100 });
		expect(systemCondition(healthy, true)).toBe("disrupted");
	});
});

// ---------------------------------------------------------------------------
// CONDITION MECHANICAL EFFECTS (Phase 12b Unit B1). The pure magnitude helpers the
// sim reads to translate a system's condition into a real penalty. Total functions
// (every SystemCondition maps to a value); worse penalties at worse conditions.
// ---------------------------------------------------------------------------
describe("reactorDamagePercent: a worn reactor softens all weapon damage", () => {
	it("nominal is full power (no penalty)", () => {
		expect(reactorDamagePercent("nominal")).toBe(100);
	});
	it("degraded is the degraded percent, offline the offline percent", () => {
		expect(reactorDamagePercent("degraded")).toBe(REACTOR_DAMAGE_PERCENT_DEGRADED);
		expect(reactorDamagePercent("offline")).toBe(REACTOR_DAMAGE_PERCENT_OFFLINE);
	});
	it("offline is a strictly harsher penalty than degraded (worse condition, less power)", () => {
		expect(reactorDamagePercent("offline")).toBeLessThan(
			reactorDamagePercent("degraded"),
		);
	});
	it("disrupted (unreachable for the reactor) maps defensively to the degraded value", () => {
		expect(reactorDamagePercent("disrupted")).toBe(REACTOR_DAMAGE_PERCENT_DEGRADED);
	});
});

describe("ftlEvasionPenaltyPercent / ftlSpeedPenaltyPercent: a worn drive juke/limps", () => {
	it("nominal has no evasion or speed penalty", () => {
		expect(ftlEvasionPenaltyPercent("nominal")).toBe(0);
		expect(ftlSpeedPenaltyPercent("nominal")).toBe(0);
	});
	it("degraded < offline for BOTH evasion and speed (design S9 Degraded < Offline)", () => {
		expect(ftlEvasionPenaltyPercent("degraded")).toBe(FTL_EVASION_PENALTY_DEGRADED);
		expect(ftlEvasionPenaltyPercent("offline")).toBe(FTL_EVASION_PENALTY_OFFLINE);
		expect(ftlEvasionPenaltyPercent("degraded")).toBeLessThan(
			ftlEvasionPenaltyPercent("offline"),
		);
		expect(ftlSpeedPenaltyPercent("degraded")).toBe(FTL_SPEED_PENALTY_DEGRADED);
		expect(ftlSpeedPenaltyPercent("offline")).toBe(FTL_SPEED_PENALTY_OFFLINE);
		expect(ftlSpeedPenaltyPercent("degraded")).toBeLessThan(
			ftlSpeedPenaltyPercent("offline"),
		);
	});
});

describe("DEGRADED_WEAPON_DAMAGE_PERCENT: a degraded weapon deals less (but > 0)", () => {
	it("is a reduction (< 100) that still fires (> 0)", () => {
		expect(DEGRADED_WEAPON_DAMAGE_PERCENT).toBeLessThan(100);
		expect(DEGRADED_WEAPON_DAMAGE_PERCENT).toBeGreaterThan(0);
	});
});
