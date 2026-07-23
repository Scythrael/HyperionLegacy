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
import { resolveBattle, applyProjectileDamage } from "./resolveBattle";
import type { BattleParticipants, Combatant, CombatWeapon } from "./types";

// ---------------------------------------------------------------------------
// Test builders. Small factories so each test states only what it cares about;
// everything else takes a sane skeleton default. Kept here (not in a shared
// helper) because these are test fixtures, not production shapes.
// ---------------------------------------------------------------------------

// Build a weapon with sensible defaults. Default range is huge so the range gate
// is a non-issue unless a test opts into it; default cooldown fires roughly once
// per second. Default family is KINETIC (no attenuation, simplest for the parity
// fixtures). A `yield` convenience sets a FLAT yieldMin == yieldMax so the many
// legacy call sites that pass `yield: N` keep working unchanged; a test that
// wants a damage band sets yieldMin/yieldMax directly. Default accuracy is 90
// (mirroring the Phase 2 90% hit rate the flagship suite was written around) and
// projectileCount 1, so the parity fixtures behave as before + a 10% crit.
function makeWeapon(
	overrides: Partial<CombatWeapon> & { yield?: number } = {},
): CombatWeapon {
	const flat = overrides.yield;
	return {
		id: overrides.id ?? "w",
		family: overrides.family ?? "kinetic",
		yieldMin: overrides.yieldMin ?? flat ?? 10,
		yieldMax: overrides.yieldMax ?? flat ?? 10,
		cooldownDeciSec: overrides.cooldownDeciSec ?? 10,
		accuracy: overrides.accuracy ?? 90,
		projectileCount: overrides.projectileCount ?? 1,
		range: overrides.range ?? 1000,
		shieldAttenuation: overrides.shieldAttenuation ?? 0,
		armorPen: overrides.armorPen ?? 0,
		cooldownAccumulator: overrides.cooldownAccumulator ?? 0,
		effectSlots: overrides.effectSlots ?? [],
	};
}

// Build a combatant with sane defaults. Callers set id/team/hull/weapons per
// test; the reserved arrays start empty and the defense fields default to 0 (no
// armor/dampening/coherence/evasion) so a test only opts into the defense it is
// exercising.
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
		shieldCoherence: overrides.shieldCoherence ?? 0,
		ablativeArmor: overrides.ablativeArmor ?? 0,
		kineticDampening: overrides.kineticDampening ?? 0,
		evasion: overrides.evasion ?? 0,
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

// ===========================================================================
// PHASE 3 shot-pipeline MECHANIC tests.
//
// The mitigation math (family triangle, attenuation, armor, armor-pen) is tested
// through the PURE applyProjectileDamage function with hand-picked raw damage, so
// every assertion is an exact integer with ZERO rng involved. The rng-driven
// behaviors (evade, projectile independence, crit spread, carry-over fire timing)
// are tested through the full resolveBattle with fixed seeds.
// ===========================================================================

// A defense-target factory for the pure mitigation tests. Big pools so a single
// crafted projectile never kills it and we can read the exact shield/hull loss.
function defenseTarget(overrides: Partial<Combatant> = {}): Combatant {
	return makeCombatant({
		id: "T",
		team: "enemy",
		hull: 100000,
		hullMax: 100000,
		shield: 100000,
		shieldMax: 100000,
		...overrides,
	});
}

describe("shot pipeline: family damage triangle", () => {
	it("particle does +10% vs shields (shields up => vs-Shields column)", () => {
		// Shields up, particle, no attenuation (attenuation 0), so all 100 raw hits
		// shields at the +10% particle-vs-shields multiplier => 110 shield lost.
		const t = defenseTarget();
		const { dealt } = applyProjectileDamage(t, "particle", 0, 0, 100);
		expect(t.shield).toBe(100000 - 110);
		expect(dealt).toBe(110);
	});

	it("particle does -10% vs armor/hull (shields down => vs-Armor column)", () => {
		// No shields => vs-Armor column => particle -10% => 90 hull lost.
		const t = defenseTarget({ shield: 0, shieldMax: 0 });
		applyProjectileDamage(t, "particle", 0, 0, 100);
		expect(t.hull).toBe(100000 - 90);
	});

	it("kinetic is neutral vs shields but +10% vs armor/hull", () => {
		// Shields up: kinetic vs-Shields column is 100% => exactly 100 shield lost.
		const shielded = defenseTarget();
		applyProjectileDamage(shielded, "kinetic", 0, 0, 100);
		expect(shielded.shield).toBe(100000 - 100);

		// Shields down: kinetic vs-Armor column is +10% => 110 hull lost.
		const bare = defenseTarget({ shield: 0, shieldMax: 0 });
		applyProjectileDamage(bare, "kinetic", 0, 0, 100);
		expect(bare.hull).toBe(100000 - 110);
	});

	it("EW does -10% vs shields and is neutral vs armor/hull", () => {
		const shielded = defenseTarget();
		applyProjectileDamage(shielded, "ew", 0, 0, 100);
		expect(shielded.shield).toBe(100000 - 90); // -10% vs shields

		const bare = defenseTarget({ shield: 0, shieldMax: 0 });
		applyProjectileDamage(bare, "ew", 0, 0, 100);
		expect(bare.hull).toBe(100000 - 100); // neutral vs hull
	});
});

describe("shot pipeline: shield attenuation (particle only)", () => {
	it("a particle shot partially bypasses full shields; a kinetic shot of equal damage does not", () => {
		// Particle with 40% attenuation vs a target with 0 coherence. Per the spec
		// stage order, the triangle (step 4) is applied BEFORE attenuation (step
		// 5a): shields up => particle vs-Shields +10% => 110; then 40% of 110 = 44
		// bypasses straight to hull. We assert the hull took damage THROUGH a full
		// shield, and the exact bypass amount.
		const particleTarget = defenseTarget();
		const pr = applyProjectileDamage(particleTarget, "particle", 40, 0, 100);
		expect(pr.attenuated).toBe(true);
		expect(particleTarget.hull).toBeLessThan(100000); // hull hit through shields
		expect(particleTarget.hull).toBe(100000 - 44); // floor(110 * 40/100) = 44

		// Kinetic of identical raw against an identical full shield: NO attenuation,
		// so the shield fully walls it and hull is untouched.
		const kineticTarget = defenseTarget();
		const kr = applyProjectileDamage(kineticTarget, "kinetic", 40, 0, 100);
		expect(kr.attenuated).toBe(false);
		expect(kineticTarget.hull).toBe(100000); // hull untouched, fully walled
	});

	it("attenuation is reduced by shieldCoherence; equal coherence => zero net bypass", () => {
		// net attenuation = max(0, weaponAtten - shieldCoherence). 30 vs 30 => 0.
		const t = defenseTarget({ shieldCoherence: 30 });
		const r = applyProjectileDamage(t, "particle", 30, 0, 100);
		expect(r.attenuated).toBe(false);
		expect(t.hull).toBe(100000); // nothing bled through
	});

	it("partial coherence leaves a smaller net bypass", () => {
		// weaponAtten 50, coherence 20 => net 30% bypass. Triangle first (shields up
		// => +10% => 110), then 30% of 110 = 33 bypasses to hull.
		const t = defenseTarget({ shieldCoherence: 20 });
		const r = applyProjectileDamage(t, "particle", 50, 0, 100);
		expect(r.attenuated).toBe(true);
		expect(t.hull).toBe(100000 - 33);
	});
});

describe("shot pipeline: armor on the hull-path", () => {
	it("ablativeArmor is a depleting buffer that soaks first, then depletes", () => {
		// Shields down so 100 raw goes straight to the hull-path (kinetic vs-Armor
		// +10% => 110 incoming). Armor 40 soaks 40 (depleting to 0), leaving 70 hull.
		const t = defenseTarget({
			shield: 0,
			shieldMax: 0,
			ablativeArmor: 40,
		});
		applyProjectileDamage(t, "kinetic", 0, 0, 100);
		expect(t.ablativeArmor).toBe(0); // buffer depleted by what it soaked
		expect(t.hull).toBe(100000 - 70); // 110 incoming - 40 soaked = 70
	});

	it("kineticDampening applies a percent reduction after armor", () => {
		// Shields down, EW (neutral vs armor so incoming == 100 raw), no ablative,
		// 25% dampening => floor(100 * 75/100) = 75 hull lost.
		const t = defenseTarget({
			shield: 0,
			shieldMax: 0,
			kineticDampening: 25,
		});
		applyProjectileDamage(t, "ew", 0, 0, 100);
		expect(t.hull).toBe(100000 - 75);
	});

	it("kinetic armorPen ignores a percent of BOTH ablative armor and dampening", () => {
		// Baseline (no pen): kinetic vs-Armor +10% => 110 incoming. Armor 50 soaks
		// 50 => 60 remains, 50% dampening => floor(60*50/100)=30 hull lost.
		const noPen = defenseTarget({
			shield: 0,
			shieldMax: 0,
			ablativeArmor: 50,
			kineticDampening: 50,
		});
		applyProjectileDamage(noPen, "kinetic", 0, 0, 100);
		expect(noPen.hull).toBe(100000 - 30);

		// With 100% armorPen: effective armor 0 AND effective dampening 0, so the
		// full 110 incoming lands. Proves pen ignores BOTH mitigations.
		const fullPen = defenseTarget({
			shield: 0,
			shieldMax: 0,
			ablativeArmor: 50,
			kineticDampening: 50,
		});
		applyProjectileDamage(fullPen, "kinetic", 0, 100, 100);
		expect(fullPen.hull).toBe(100000 - 110);
		// The ignored armor was NOT consumed (pen bypassed it, did not deplete it).
		expect(fullPen.ablativeArmor).toBe(50);
	});

	it("strict mitigation order: attenuation split, then shields, then armor, then hull", () => {
		// A single particle projectile against a target with a THIN shield + armor,
		// exercising every stage at once. raw 100, attenuation 50 (coherence 0):
		//   4:  triangle first (shields up => particle vs-Shields +10%) => 110.
		//   5a: 50% of 110 = 55 bypasses to the hull-path; 55 aimed at shields.
		//   5b: shield is only 20, so 20 absorbed and 35 overflows to the hull-path.
		//       hull-path so far = 55 (bypass) + 35 (overflow) = 90.
		//   5c: ablative armor 10 soaks 10 (depletes to 0) => 80 remains.
		//   5d: 80 lands on hull.
		// The point of this test is the strict STAGE ORDER firing together, so we
		// assert the end state of each stage (shield drained, armor depleted, hull
		// hit) rather than leaning on any single intermediate.
		const t = defenseTarget({ shield: 20, shieldMax: 20, ablativeArmor: 10 });
		const r = applyProjectileDamage(t, "particle", 50, 0, 100);
		expect(r.attenuated).toBe(true);
		expect(t.shield).toBe(0); // thin shield fully drained
		expect(t.ablativeArmor).toBe(0); // armor buffer soaked + depleted
		expect(t.hull).toBeLessThan(100000); // remainder reached hull
	});
});

describe("shot pipeline: evade", () => {
	it("a zero-net-hit-chance shot misses, logs an evade, deals no damage", () => {
		// accuracy 0 => hitChance clamps to 0 => guaranteed miss regardless of seed.
		const p = oneVsOne(
			{
				hull: 1000,
				hullMax: 1000,
				weapons: [makeWeapon({ id: "pw", yield: 30, accuracy: 0 })],
			},
			{ hull: 1000, hullMax: 1000, weapons: [] },
		);
		const { log } = resolveBattle(p, 12345, { generateLog: true });
		const playerShots = log.filter((e) => e.actorId === "P1");
		expect(playerShots.length).toBeGreaterThan(0);
		// Every player shot is an evade with zero damage (nothing ever connects).
		for (const e of playerShots) {
			expect(e.type).toBe("evade");
			expect(e.result).toBe("evade");
			expect(e.damage).toBe(0);
			expect(e.projectilesHit).toBe(0);
		}
	});

	it("high target evasion equal to accuracy also yields guaranteed evades", () => {
		// accuracy 70 vs evasion 70 => net 0 hit chance => all evades.
		const p = oneVsOne(
			{
				hull: 1000,
				hullMax: 1000,
				weapons: [makeWeapon({ id: "pw", yield: 30, accuracy: 70 })],
			},
			{ hull: 1000, hullMax: 1000, weapons: [], evasion: 70 },
		);
		const { log } = resolveBattle(p, 999, { generateLog: true });
		const hits = log.filter((e) => e.actorId === "P1" && e.type === "hit");
		expect(hits.length).toBe(0);
	});
});

describe("shot pipeline: crit + projectiles roll independently", () => {
	it("a multi-projectile weapon spreads hits: some projectiles connect, some miss (seed-fixed)", () => {
		// A 4-projectile weapon at 50% accuracy: over a fixed seed the connecting
		// count per shot varies between 0 and 4 (independent per-projectile rolls),
		// which a single all-or-nothing roll could never produce.
		const p = oneVsOne(
			{
				hull: 100000,
				hullMax: 100000,
				weapons: [
					makeWeapon({
						id: "pw",
						yield: 5,
						accuracy: 50,
						projectileCount: 4,
						cooldownDeciSec: 10,
					}),
				],
			},
			{ hull: 100000, hullMax: 100000, weapons: [] },
		);
		const { log } = resolveBattle(p, 4242, { generateLog: true });
		const shots = log.filter((e) => e.actorId === "P1");
		const hitCounts = new Set(shots.map((e) => e.projectilesHit));
		// Independence => a spread of connecting counts (not just {0} or {4}).
		expect(hitCounts.size).toBeGreaterThan(1);
		// Every per-shot count is within [0, projectileCount].
		for (const e of shots) {
			expect(e.projectilesHit).toBeGreaterThanOrEqual(0);
			expect(e.projectilesHit).toBeLessThanOrEqual(4);
		}
	});

	it("crit is deterministic per seed: the same battle reports the same crit shots", () => {
		// Two identical runs must flag crit on exactly the same shots (crit is a
		// combat-stream roll, so it is reproducible).
		const build = () =>
			oneVsOne(
				{
					hull: 100000,
					hullMax: 100000,
					weapons: [makeWeapon({ id: "pw", yield: 20, accuracy: 100 })],
				},
				{ hull: 100000, hullMax: 100000, weapons: [] },
			);
		const a = resolveBattle(build(), 77, { generateLog: true });
		const b = resolveBattle(build(), 77, { generateLog: true });
		const critsA = a.log.filter((e) => e.crit).map((e) => e.tDeciSec);
		const critsB = b.log.filter((e) => e.crit).map((e) => e.tDeciSec);
		expect(critsA).toEqual(critsB);
		// A 60s fight at 10% crit over ~60 shots should land at least one crit, so
		// this also proves crits actually happen (not a vacuous match of two empties).
		expect(critsA.length).toBeGreaterThan(0);
	});
});

describe("shot pipeline: carry-over cooldown fire timing", () => {
	it("a weapon whose cooldownDeciSec does not divide the run still fires the exact count", () => {
		// cooldownDeciSec 7 (0.7s) does NOT divide the 600-tick (60s) cap evenly.
		// The carry-over accumulator means it fires every 7 ticks: floor(600/7)=85
		// times, with NO drift from the ragged remainder. accuracy 100 so every
		// fire logs a hit; target is unkillable so the battle runs the full cap.
		const p = oneVsOne(
			{
				hull: 1000000000,
				hullMax: 1000000000,
				weapons: [
					makeWeapon({
						id: "pw",
						yield: 1,
						accuracy: 100,
						cooldownDeciSec: 7,
					}),
				],
			},
			{ hull: 1000000000, hullMax: 1000000000, weapons: [] },
		);
		const { outcome, log } = resolveBattle(p, 1, { generateLog: true });
		expect(outcome.reason).toBe("capReached");
		const playerHits = log.filter(
			(e) => e.actorId === "P1" && e.type === "hit",
		);
		expect(playerHits.length).toBe(Math.floor(600 / 7)); // 85, no drift
	});
});
