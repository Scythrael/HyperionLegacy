// ============================================================================
// combat/rating.test.ts -- tests for the ADVISORY combat readiness numbers
// (Combat 0.13.0, Phase 8): Battle Rating + Engagement Forecast.
//
// Two very different contracts are proven here:
//   - battleRating: a PURE, DETERMINISTIC, OPPONENT-AGNOSTIC, MONOTONIC scalar.
//     The load-bearing property is MONOTONICITY: adding gear (a weapon, hull,
//     shield, a drone squadron) must NEVER lower the number, or the "how geared
//     am I" promise breaks. We assert equal-for-equal + each monotonic axis +
//     a clearly-stronger loadout outrating a weaker one.
//   - engagementForecast: a Monte-Carlo over the REAL deterministic sim. The
//     load-bearing properties are DETERMINISM (fixed baseSeed => same percent
//     every call), HONESTY (a dominant player forecasts high, a hopeless one
//     low, a mirror ~50), the [0,100] bound, and NO MUTATION of the inputs.
// ============================================================================

import { describe, it, expect } from "vitest";
import { battleRating, engagementForecast } from "./rating";
import { makeSquadron } from "./drones";
import type { Combatant, CombatWeapon } from "./types";

// ---------------------------------------------------------------------------
// Local test builders (mirrors resolveBattle.test.ts's fixtures so these tests
// state only what they care about; everything else takes a sane default).
// ---------------------------------------------------------------------------

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
		durability: overrides.durability ?? 100,
		durabilityMax: overrides.durabilityMax ?? 100,
		quality: overrides.quality ?? 0,
		powerDraw: overrides.powerDraw ?? 0,
		ambushEligible: overrides.ambushEligible ?? true,
	};
}

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
		damageResist: overrides.damageResist ?? { kinetic: 0, particle: 0, ew: 0 },
		disruptionResist: overrides.disruptionResist ?? {
			kinetic: 0,
			particle: 0,
			ew: 0,
		},
		position: overrides.position ?? 0,
		speed: overrides.speed ?? 10,
		stance: overrides.stance ?? "balanced",
		weapons: overrides.weapons ?? [makeWeapon()],
		alive: overrides.alive ?? true,
		statusEffects: overrides.statusEffects ?? [],
		drones: overrides.drones ?? [],
		rapidChargeAfterAmbush: overrides.rapidChargeAfterAmbush ?? false,
		particleTraceDetector: overrides.particleTraceDetector ?? 0,
	};
}

// ===========================================================================
// battleRating
// ===========================================================================

describe("battleRating determinism + equality", () => {
	it("is deterministic (same combatant => same rating every call)", () => {
		const c = makeCombatant({ hull: 250, shield: 120 });
		const a = battleRating(c);
		const b = battleRating(c);
		expect(a).toBe(b);
	});

	it("returns an integer", () => {
		const c = makeCombatant({
			hull: 250,
			shield: 120,
			shieldRecharge: 7,
			ablativeArmor: 30,
			kineticDampening: 15,
		});
		const r = battleRating(c);
		expect(Number.isInteger(r)).toBe(true);
	});

	it("gives two structurally-identical combatants equal ratings", () => {
		const a = makeCombatant({
			id: "A",
			hull: 300,
			shield: 150,
			weapons: [makeWeapon({ id: "w1", yield: 12 })],
		});
		const b = makeCombatant({
			id: "B",
			hull: 300,
			shield: 150,
			weapons: [makeWeapon({ id: "w1", yield: 12 })],
		});
		expect(battleRating(a)).toBe(battleRating(b));
	});

	it("does not mutate the combatant it rates (purity)", () => {
		const c = makeCombatant({
			hull: 200,
			shield: 100,
			weapons: [makeWeapon({ id: "w", yield: 8 })],
			drones: [makeSquadron("attack")],
		});
		const before = JSON.parse(JSON.stringify(c));
		battleRating(c);
		expect(c).toEqual(before);
	});
});

describe("battleRating monotonicity (the load-bearing property)", () => {
	// A shared baseline every monotonic axis grows from.
	const base = () =>
		makeCombatant({
			hull: 200,
			shield: 100,
			shieldRecharge: 5,
			weapons: [makeWeapon({ id: "w1", yield: 10 })],
		});

	it("adding a weapon never lowers the rating", () => {
		const before = battleRating(base());
		const withExtra = base();
		withExtra.weapons = [
			...withExtra.weapons,
			makeWeapon({ id: "w2", yield: 10 }),
		];
		expect(battleRating(withExtra)).toBeGreaterThanOrEqual(before);
		// And a positive-DPS weapon should STRICTLY raise it (sanity that the
		// weapon term is actually contributing, not silently dropped).
		expect(battleRating(withExtra)).toBeGreaterThan(before);
	});

	it("more hull never lowers the rating", () => {
		const before = battleRating(base());
		const tougher = base();
		tougher.hull += 500;
		tougher.hullMax += 500;
		expect(battleRating(tougher)).toBeGreaterThan(before);
	});

	it("more shield never lowers the rating", () => {
		const before = battleRating(base());
		const shieldier = base();
		shieldier.shield += 300;
		shieldier.shieldMax += 300;
		expect(battleRating(shieldier)).toBeGreaterThan(before);
	});

	it("adding a drone squadron never lowers the rating", () => {
		const before = battleRating(base());
		const carrier = base();
		carrier.drones = [makeSquadron("attack")];
		expect(battleRating(carrier)).toBeGreaterThan(before);
	});

	it("more defense (armor/dampening/resists) never lowers the rating", () => {
		const before = battleRating(base());
		const armored = base();
		armored.ablativeArmor += 50;
		armored.kineticDampening += 20;
		armored.damageResist = { kinetic: 30, particle: 30, ew: 30 };
		expect(battleRating(armored)).toBeGreaterThan(before);
	});
});

describe("battleRating ordering + opponent-agnosticism", () => {
	it("rates a clearly-stronger loadout above a weaker one", () => {
		const weak = makeCombatant({
			id: "weak",
			hull: 100,
			shield: 0,
			weapons: [makeWeapon({ id: "pop", yield: 3, cooldownDeciSec: 20 })],
		});
		const strong = makeCombatant({
			id: "strong",
			hull: 600,
			shield: 300,
			shieldRecharge: 20,
			ablativeArmor: 80,
			kineticDampening: 25,
			weapons: [
				makeWeapon({ id: "cannon", yield: 40, projectileCount: 3 }),
				makeWeapon({ id: "battery", yield: 25, cooldownDeciSec: 8 }),
			],
			drones: [makeSquadron("attack"), makeSquadron("defense")],
		});
		expect(battleRating(strong)).toBeGreaterThan(battleRating(weak));
	});

	it("is opponent-agnostic: takes exactly one combatant (no enemy param)", () => {
		// The function's arity is 1. If a future edit added an enemy param this
		// guard flags the API drift (the whole point of Battle Rating is that it
		// is a stable, matchup-free number).
		expect(battleRating.length).toBe(1);
	});
});

// ===========================================================================
// engagementForecast
// ===========================================================================

// A tanky, hard-hitting player vs a fragile popgun enemy: the player should
// win nearly every seed.
function dominantMatchup(): { player: Combatant; enemy: Combatant } {
	const player = makeCombatant({
		id: "P1",
		team: "player",
		hull: 500,
		shield: 250,
		shieldRecharge: 15,
		ablativeArmor: 40,
		weapons: [makeWeapon({ id: "pw", yield: 30, projectileCount: 2 })],
	});
	const enemy = makeCombatant({
		id: "E1",
		team: "enemy",
		hull: 60,
		shield: 0,
		weapons: [makeWeapon({ id: "ew", yield: 2, cooldownDeciSec: 20 })],
	});
	return { player, enemy };
}

// Mirror of dominantMatchup with sides swapped: the player is the popgun.
function hopelessMatchup(): { player: Combatant; enemy: Combatant } {
	const { player, enemy } = dominantMatchup();
	// Swap roles: give the player the fragile popgun stats and the enemy the
	// tanky loadout, keeping the ids/teams correct.
	const weakPlayer = makeCombatant({
		id: "P1",
		team: "player",
		hull: 60,
		shield: 0,
		weapons: [makeWeapon({ id: "pw", yield: 2, cooldownDeciSec: 20 })],
	});
	const strongEnemy = makeCombatant({
		id: "E1",
		team: "enemy",
		hull: 500,
		shield: 250,
		shieldRecharge: 15,
		ablativeArmor: 40,
		weapons: [makeWeapon({ id: "ew", yield: 30, projectileCount: 2 })],
	});
	// silence unused-destructure lint noise while keeping the mirror intent clear.
	void player;
	void enemy;
	return { player: weakPlayer, enemy: strongEnemy };
}

// A near-mirror: statistically identical ships (only ids/teams differ). Over
// many seeds the win rate should sit near 50%.
function mirrorMatchup(): { player: Combatant; enemy: Combatant } {
	const loadout = () => ({
		hull: 200,
		shield: 100,
		shieldRecharge: 8,
		weapons: [makeWeapon({ id: "gun", yield: 12 })],
	});
	const player = makeCombatant({ id: "P1", team: "player", ...loadout() });
	const enemy = makeCombatant({ id: "E1", team: "enemy", ...loadout() });
	return { player, enemy };
}

describe("engagementForecast determinism", () => {
	it("is deterministic for a fixed baseSeed (same percent every call)", () => {
		const { player, enemy } = mirrorMatchup();
		const a = engagementForecast(player, enemy, { samples: 48, baseSeed: 7 });
		const b = engagementForecast(player, enemy, { samples: 48, baseSeed: 7 });
		expect(a.winPercent).toBe(b.winPercent);
		expect(a.samples).toBe(48);
		expect(b.samples).toBe(48);
	});

	it("stays deterministic at a larger sample count", () => {
		const { player, enemy } = mirrorMatchup();
		const a = engagementForecast(player, enemy, { samples: 128, baseSeed: 99 });
		const b = engagementForecast(player, enemy, { samples: 128, baseSeed: 99 });
		expect(a.winPercent).toBe(b.winPercent);
		expect(a.samples).toBe(128);
	});

	it("uses a default sample count when none is given", () => {
		const { player, enemy } = mirrorMatchup();
		const r = engagementForecast(player, enemy);
		expect(r.samples).toBeGreaterThan(0);
	});
});

describe("engagementForecast honesty (advisory bands)", () => {
	it("forecasts a dominant player HIGH (> 80%)", () => {
		const { player, enemy } = dominantMatchup();
		const r = engagementForecast(player, enemy, { samples: 64, baseSeed: 3 });
		expect(r.winPercent).toBeGreaterThan(80);
	});

	it("forecasts a hopeless player LOW (< 20%)", () => {
		const { player, enemy } = hopelessMatchup();
		const r = engagementForecast(player, enemy, { samples: 64, baseSeed: 3 });
		expect(r.winPercent).toBeLessThan(20);
	});

	it("forecasts a near-mirror match NEAR 50% (30..70 band)", () => {
		const { player, enemy } = mirrorMatchup();
		const r = engagementForecast(player, enemy, { samples: 128, baseSeed: 5 });
		expect(r.winPercent).toBeGreaterThanOrEqual(30);
		expect(r.winPercent).toBeLessThanOrEqual(70);
	});

	it("always returns winPercent within [0, 100]", () => {
		const dom = dominantMatchup();
		const hope = hopelessMatchup();
		const mir = mirrorMatchup();
		for (const m of [dom, hope, mir]) {
			const r = engagementForecast(m.player, m.enemy, {
				samples: 32,
				baseSeed: 11,
			});
			expect(r.winPercent).toBeGreaterThanOrEqual(0);
			expect(r.winPercent).toBeLessThanOrEqual(100);
		}
	});
});

describe("engagementForecast purity", () => {
	it("does not mutate the player or enemy inputs", () => {
		const { player, enemy } = dominantMatchup();
		const playerBefore = JSON.parse(JSON.stringify(player));
		const enemyBefore = JSON.parse(JSON.stringify(enemy));
		engagementForecast(player, enemy, { samples: 24, baseSeed: 1 });
		expect(player).toEqual(playerBefore);
		expect(enemy).toEqual(enemyBefore);
	});
});

// ---------------------------------------------------------------------------
// Combat 1.0 Unit 2.4: the forecast now also returns the RAW win COUNT (for the
// Threat Assessment zero-loss guard) and accepts a multi-enemy WAVE (a Combatant[]).
// ---------------------------------------------------------------------------
describe("engagementForecast wins count (Unit 2.4)", () => {
	it("returns wins consistent with winPercent (round(wins/samples*100))", () => {
		const { player, enemy } = mirrorMatchup();
		const r = engagementForecast(player, enemy, { samples: 64, baseSeed: 7 });
		expect(r.wins).toBeGreaterThanOrEqual(0);
		expect(r.wins).toBeLessThanOrEqual(r.samples);
		expect(r.winPercent).toBe(Math.round((r.wins / r.samples) * 100));
	});

	it("a dominant player wins every sample (wins === samples)", () => {
		const { player, enemy } = dominantMatchup();
		const r = engagementForecast(player, enemy, { samples: 32, baseSeed: 3 });
		expect(r.wins).toBe(r.samples); // the zero-loss case the guard reserves Guaranteed for
	});

	it("a hopeless player wins none (wins === 0)", () => {
		const { player, enemy } = hopelessMatchup();
		const r = engagementForecast(player, enemy, { samples: 32, baseSeed: 3 });
		expect(r.wins).toBe(0); // the Impossible case
	});
});

describe("engagementForecast multi-enemy wave (Unit 2.4)", () => {
	it("accepts a Combatant[] and simulates the whole enemy team", () => {
		// A single fragile enemy the dominant player crushes; add a SECOND identical
		// enemy and the player should still win, but the two-enemy team is a harder
		// fight, so its win count must be <= the single-enemy count (more incoming DPS).
		const { player, enemy } = dominantMatchup();
		const enemy2 = { ...enemy, id: "E2", weapons: enemy.weapons.map((w) => ({ ...w, id: "ew2" })) };
		const single = engagementForecast(player, enemy, { samples: 48, baseSeed: 9 });
		const pair = engagementForecast(player, [enemy, enemy2], { samples: 48, baseSeed: 9 });
		expect(pair.samples).toBe(48);
		expect(pair.wins).toBeLessThanOrEqual(single.wins);
	});

	it("a single Combatant and a one-element array give identical results", () => {
		// The array normalization must be byte-identical to the pre-2.4 single-enemy path.
		const { player, enemy } = mirrorMatchup();
		const scalar = engagementForecast(player, enemy, { samples: 40, baseSeed: 4 });
		const asArray = engagementForecast(player, [enemy], { samples: 40, baseSeed: 4 });
		expect(asArray.wins).toBe(scalar.wins);
		expect(asArray.winPercent).toBe(scalar.winPercent);
	});
});
