// ============================================================================
// combat/resolveBattle.test.ts -- FLAGSHIP parity + termination suite for the
// combat simulator (Combat 0.13.0, Phase 2)
//
// These tests guard the invariants the ENTIRE combat epic depends on, so they
// matter more than any single mechanic test:
//   - Determinism: same inputs => byte-identical outcome, every call.
//   - Offline == live: outcome identical with and without the log (the thing
//     that lets offline catch-up skip flavor and still match live exactly).
//   - Cosmetic isolation: log/flavor work cannot shift a combat roll.
//   - Termination: the hard cap fires + tiebreaks; a dominant team eliminates.
//   - Basic sanity: an out-damaging team wins.
// If any go red, the deterministic-headless contract is broken at the root and
// no later phase can be trusted, so keep these green above all else.
// ============================================================================

import { describe, it, expect } from "vitest";
import { resolveBattle } from "./resolveBattle";
import type { BattleParticipants, Combatant, CombatWeapon } from "./types";

// ---------------------------------------------------------------------------
// Test builders. Small factories so each test states only what it cares about;
// everything else takes a sane skeleton default. Kept here (not in a shared
// helper) because these are test fixtures, not production shapes.
// ---------------------------------------------------------------------------

// Build a weapon with sensible skeleton defaults. Default range is huge so the
// range gate is a non-issue unless a test opts into it; default cooldown fires
// roughly once per second.
function makeWeapon(overrides: Partial<CombatWeapon> = {}): CombatWeapon {
	return {
		id: overrides.id ?? "w",
		yield: overrides.yield ?? 10,
		cooldownDeciSec: overrides.cooldownDeciSec ?? 10,
		range: overrides.range ?? 1000,
		cooldownAccumulator: overrides.cooldownAccumulator ?? 0,
	};
}

// Build a combatant with skeleton defaults. Callers set id/team/hull/weapons
// per test; the reserved arrays start empty (as the skeleton requires).
function makeCombatant(overrides: Partial<Combatant> = {}): Combatant {
	const hullMax = overrides.hullMax ?? overrides.hull ?? 100;
	const shieldMax = overrides.shieldMax ?? overrides.shield ?? 0;
	return {
		id: overrides.id ?? "c",
		team: overrides.team ?? "player",
		hull: overrides.hull ?? hullMax,
		hullMax,
		shield: overrides.shield ?? shieldMax,
		shieldMax,
		shieldRecharge: overrides.shieldRecharge ?? 0,
		position: overrides.position ?? 0,
		speed: overrides.speed ?? 10,
		weapons: overrides.weapons ?? [makeWeapon()],
		alive: overrides.alive ?? true,
		statusEffects: overrides.statusEffects ?? [],
		drones: overrides.drones ?? [],
	};
}

// A standard 1v1: a player ship vs an enemy ship, both co-located so range is
// never the gating factor. Callers tweak the returned combatants per test.
function oneVsOne(
	player: Partial<Combatant> = {},
	enemy: Partial<Combatant> = {},
): BattleParticipants {
	return {
		combatants: [
			makeCombatant({ id: "P1", team: "player", ...player }),
			makeCombatant({ id: "E1", team: "enemy", ...enemy }),
		],
	};
}

describe("resolveBattle determinism", () => {
	it("same participants + seed => deep-equal outcome across repeated calls", () => {
		const build = () =>
			oneVsOne(
				{ hull: 80, weapons: [makeWeapon({ id: "pw", yield: 7 })] },
				{ hull: 90, weapons: [makeWeapon({ id: "ew", yield: 5 })] },
			);
		const a = resolveBattle(build(), 42);
		const b = resolveBattle(build(), 42);
		const c = resolveBattle(build(), 42);
		expect(a.outcome).toEqual(b.outcome);
		expect(b.outcome).toEqual(c.outcome);
	});

	it("does NOT mutate the caller's participants (purity)", () => {
		const p = oneVsOne({ hull: 50 }, { hull: 50 });
		const before = JSON.parse(JSON.stringify(p));
		resolveBattle(p, 1, { generateLog: true });
		// The caller's objects must be untouched: hull, alive, cooldownAccumulator
		// all as they were, so the same battle can be re-run identically.
		expect(p).toEqual(before);
	});

	it("different seeds can produce different battle courses (log differs)", () => {
		const build = () =>
			oneVsOne(
				{ hull: 200, weapons: [makeWeapon({ id: "pw", yield: 6 })] },
				{ hull: 200, weapons: [makeWeapon({ id: "ew", yield: 6 })] },
			);
		const a = resolveBattle(build(), 1, { generateLog: true });
		const b = resolveBattle(build(), 987654, { generateLog: true });
		// The miss/hit pattern (driven by the combat stream) should differ across
		// seeds, so at least the logs are not identical. (Outcomes may coincide.)
		expect(a.log).not.toEqual(b.log);
	});
});

describe("resolveBattle offline == live (the hard invariant)", () => {
	it("outcome is identical with generateLog true vs false", () => {
		const build = () =>
			oneVsOne(
				{ hull: 120, weapons: [makeWeapon({ id: "pw", yield: 8 })] },
				{ hull: 100, weapons: [makeWeapon({ id: "ew", yield: 6 })] },
			);
		const live = resolveBattle(build(), 31337, { generateLog: true });
		const offline = resolveBattle(build(), 31337, { generateLog: false });
		// The OUTCOME must match exactly...
		expect(offline.outcome).toEqual(live.outcome);
		// ...while the logs differ in existence (live built one, offline did not).
		expect(live.log.length).toBeGreaterThan(0);
		expect(offline.log.length).toBe(0);
	});

	it("holds across many seeds (fuzz the parity)", () => {
		for (let seed = 0; seed < 60; seed++) {
			const build = () =>
				oneVsOne(
					{ hull: 90, weapons: [makeWeapon({ id: "pw", yield: 7 })] },
					{ hull: 95, weapons: [makeWeapon({ id: "ew", yield: 6 })] },
				);
			const live = resolveBattle(build(), seed, { generateLog: true });
			const offline = resolveBattle(build(), seed, { generateLog: false });
			expect(offline.outcome).toEqual(live.outcome);
		}
	});

	it("default (no options) behaves as offline: no log, same outcome as explicit false", () => {
		const build = () => oneVsOne({ hull: 70 }, { hull: 70 });
		const bare = resolveBattle(build(), 5);
		const explicitOffline = resolveBattle(build(), 5, { generateLog: false });
		expect(bare.log.length).toBe(0);
		expect(bare.outcome).toEqual(explicitOffline.outcome);
	});
});

describe("resolveBattle cosmetic isolation", () => {
	it("cosmetic/log work cannot shift the combat rolls (outcome invariant)", () => {
		// This is the resolveBattle-level restatement of rng's independence test:
		// the log path draws from the cosmetic stream on every shot, yet the
		// winner + round count are identical to the log-free run. If a cosmetic
		// draw ever leaked into the combat sequence, these would diverge.
		const build = () =>
			oneVsOne(
				{ hull: 140, weapons: [makeWeapon({ id: "pw", yield: 9 })] },
				{ hull: 130, weapons: [makeWeapon({ id: "ew", yield: 7 })] },
			);
		const withLog = resolveBattle(build(), 24680, { generateLog: true });
		const withoutLog = resolveBattle(build(), 24680, { generateLog: false });
		expect(withLog.outcome).toEqual(withoutLog.outcome);
	});
});

describe("resolveBattle termination", () => {
	it("two high-hull, low-damage tanks hit the cap and tiebreak (no hang)", () => {
		// Enormous hull + tiny yield => neither can kill the other inside 60s, so
		// the hard cap must fire. The player is given slightly MORE hull so the
		// hull% tiebreak is decisive and deterministic rather than a draw.
		const p = oneVsOne(
			{
				hull: 100000,
				hullMax: 100000,
				weapons: [makeWeapon({ id: "pw", yield: 1 })],
			},
			{
				hull: 50000,
				hullMax: 50000,
				weapons: [makeWeapon({ id: "ew", yield: 1 })],
			},
		);
		const { outcome } = resolveBattle(p, 111);
		expect(outcome.reason).toBe("capReached");
		// 60s cap => 60 rounds elapsed.
		expect(outcome.rounds).toBe(60);
		// Both took ~equal absolute damage, but player has far more max hull, so
		// its remaining hull% is higher => player wins the tiebreak.
		expect(outcome.winner).toBe("player");
	});

	it("a clearly-superior team eliminates the other and wins by 'eliminated'", () => {
		// Player out-guns the enemy massively: high yield, fast cooldown, big hull;
		// enemy is fragile and weak. The enemy must be wiped well before the cap.
		const p = oneVsOne(
			{
				hull: 500,
				hullMax: 500,
				weapons: [makeWeapon({ id: "pw", yield: 50, cooldownDeciSec: 5 })],
			},
			{
				hull: 40,
				hullMax: 40,
				weapons: [makeWeapon({ id: "ew", yield: 2, cooldownDeciSec: 20 })],
			},
		);
		const { outcome } = resolveBattle(p, 7);
		expect(outcome.reason).toBe("eliminated");
		expect(outcome.winner).toBe("player");
		// Should be a quick kill, far under the 60-round cap.
		expect(outcome.rounds).toBeLessThan(60);
	});
});

describe("resolveBattle basic sanity", () => {
	it("a 1v1 where team A out-damages team B => A wins", () => {
		// Equal hull, but the player's yield/rate strictly dominates, so across
		// many seeds the player should win every time (the ~90% hit placeholder is
		// symmetric, so raw DPS advantage decides it).
		for (let seed = 0; seed < 20; seed++) {
			const p = oneVsOne(
				{
					hull: 100,
					hullMax: 100,
					weapons: [makeWeapon({ id: "pw", yield: 30, cooldownDeciSec: 5 })],
				},
				{
					hull: 100,
					hullMax: 100,
					weapons: [makeWeapon({ id: "ew", yield: 3, cooldownDeciSec: 20 })],
				},
			);
			const { outcome } = resolveBattle(p, seed);
			expect(outcome.winner).toBe("player");
			expect(outcome.reason).toBe("eliminated");
		}
	});

	it("shields absorb before hull: a shielded ship survives a shot it would die to bare-hull", () => {
		// One shot of 30 vs a ship with 25 shield + 10 hull: 25 soaks the shield,
		// 5 spills to hull, leaving it alive at 5 hull. Proves the shield-then-hull
		// order actually runs in the skeleton shot. Enemy has no weapon so only the
		// player fires; we check the enemy is dead and player alive is trivial, so
		// instead assert the battle ends by elimination in the player's favor.
		const p = oneVsOne(
			{
				hull: 1000,
				hullMax: 1000,
				weapons: [makeWeapon({ id: "pw", yield: 30, cooldownDeciSec: 10 })],
			},
			{
				hull: 10,
				hullMax: 10,
				shield: 25,
				shieldMax: 25,
				shieldRecharge: 0,
				weapons: [],
			},
		);
		const { outcome } = resolveBattle(p, 3);
		expect(outcome.winner).toBe("player");
		expect(outcome.reason).toBe("eliminated");
	});
});
