// ============================================================================
// combat/positioning.test.ts -- range bands, stance, movement + targeting (the
// Phase 6 positional layer). Pure-function units: bands classify distances,
// weaponInRange gates a shot by distance, stancePreferredDistance maps a posture
// to a band anchor, stanceMoveDelta steps toward that distance without
// overshooting (closing OR kiting), and selectTarget applies the focus-fire
// policy. None of these draw RNG, so they are fully deterministic here.
// ============================================================================

import { describe, it, expect } from "vitest";
import type { Combatant, CombatWeapon } from "./types";
import {
	BAND_SHORT,
	BAND_MEDIUM,
	BAND_LONG,
	bandFor,
	weaponInRange,
	stancePreferredDistance,
	stanceMoveDelta,
	effectiveHp,
	selectTarget,
} from "./positioning";

// A minimal weapon whose only interesting field here is `range`; everything else
// takes a harmless default so a range test states just the range it cares about.
function wpn(range: number): CombatWeapon {
	return {
		id: "w",
		family: "kinetic",
		yieldMin: 1,
		yieldMax: 1,
		cooldownDeciSec: 10,
		accuracy: 100,
		projectileCount: 1,
		range,
		shieldAttenuation: 0,
		armorPen: 0,
		cooldownAccumulator: 0,
		effectSlots: [],
		durability: 100,
		durabilityMax: 100,
		quality: 0,
		powerDraw: 0,
		ambushEligible: true,
	};
}

// A minimal combatant for targeting tests: id/team/position/hull/shield plus the
// weapon(s) that decide its reach. Other fields take neutral defaults.
function mkc(overrides: Partial<Combatant> = {}): Combatant {
	return {
		id: overrides.id ?? "c",
		team: overrides.team ?? "player",
		hull: overrides.hull ?? 100,
		hullMax: overrides.hullMax ?? 100,
		shield: overrides.shield ?? 0,
		shieldMax: overrides.shieldMax ?? 0,
		shieldRecharge: 0,
		shieldCoherence: 0,
		ablativeArmor: 0,
		kineticDampening: 0,
		evasion: 0,
		damageResist: { kinetic: 0, particle: 0, ew: 0 },
		disruptionResist: { kinetic: 0, particle: 0, ew: 0 },
		position: overrides.position ?? 0,
		speed: overrides.speed ?? 10,
		stance: overrides.stance ?? "balanced",
		weapons: overrides.weapons ?? [wpn(1000)],
		alive: overrides.alive ?? true,
		statusEffects: [],
		drones: [],
		rapidChargeAfterAmbush: false,
		particleTraceDetector: 0,
	};
}

describe("range bands: bandFor thresholds", () => {
	it("classifies by inclusive ceilings (short <=100, medium <=200, long beyond)", () => {
		expect(bandFor(0)).toBe("short");
		expect(bandFor(BAND_SHORT)).toBe("short"); // exactly 100 is still short
		expect(bandFor(BAND_SHORT + 1)).toBe("medium");
		expect(bandFor(BAND_MEDIUM)).toBe("medium"); // exactly 200 is still medium
		expect(bandFor(BAND_MEDIUM + 1)).toBe("long");
		expect(bandFor(BAND_LONG)).toBe("long");
		expect(bandFor(BAND_LONG + 500)).toBe("long"); // beyond long is still "long"
	});
});

describe("range bands: weaponInRange", () => {
	it("a weapon fires only within its max range (inclusive)", () => {
		const short = wpn(BAND_SHORT);
		expect(weaponInRange(short, 0)).toBe(true);
		expect(weaponInRange(short, BAND_SHORT)).toBe(true); // exactly at max reaches
		expect(weaponInRange(short, BAND_SHORT + 1)).toBe(false);
	});

	it("a Short-range weapon cannot hit at Long distance", () => {
		const short = wpn(BAND_SHORT);
		expect(weaponInRange(short, BAND_LONG)).toBe(false);
	});

	it("a Long-range weapon reaches across all three bands", () => {
		const long = wpn(BAND_LONG);
		expect(weaponInRange(long, BAND_SHORT)).toBe(true);
		expect(weaponInRange(long, BAND_MEDIUM)).toBe(true);
		expect(weaponInRange(long, BAND_LONG)).toBe(true);
	});
});

describe("stance: preferred distance maps to a band anchor", () => {
	it("aggressive->Short, balanced->Medium, standoff->Long", () => {
		expect(stancePreferredDistance("aggressive")).toBe(BAND_SHORT);
		expect(stancePreferredDistance("balanced")).toBe(BAND_MEDIUM);
		expect(stancePreferredDistance("standoff")).toBe(BAND_LONG);
	});
});

describe("movement: stanceMoveDelta closes, kites, and never overshoots", () => {
	it("closes toward the target when too far (positive delta)", () => {
		// self at 0, target at 500, preferred 200: gap 500 > 200, close by up to
		// wholeSteps but not past the 300-unit close-to-preferred budget.
		expect(stanceMoveDelta(0, 500, 200, 10)).toBe(10); // small step: just close 10
		expect(stanceMoveDelta(0, 500, 200, 400)).toBe(300); // capped: 500 - 200 = 300
	});

	it("kites away when too close (negative delta), never over-opening", () => {
		// self at 0, target at 50, preferred 200: distance 50 < 200, open AWAY from
		// the target (target is at +50, so open toward -x).
		expect(stanceMoveDelta(0, 50, 200, 10)).toBe(-10);
		expect(stanceMoveDelta(0, 50, 200, 999)).toBe(-150); // capped: 200 - 50 = 150
	});

	it("holds exactly at the preferred distance", () => {
		expect(stanceMoveDelta(0, 200, 200, 50)).toBe(0);
	});

	it("holds when co-located (gap 0: no direction to open) -- parity guard", () => {
		expect(stanceMoveDelta(0, 0, 200, 50)).toBe(0);
	});

	it("holds when there is no movement budget this tick", () => {
		expect(stanceMoveDelta(0, 500, 200, 0)).toBe(0);
	});

	it("respects target direction sign (target behind self closes negatively)", () => {
		// target at -500 (behind), preferred 200: close toward -x.
		expect(stanceMoveDelta(0, -500, 200, 400)).toBe(-300);
	});
});

describe("movement: deterministic convergence to the stance band over N ticks", () => {
	it("an aggressive ship closes to Short and holds (no overshoot, no oscillation)", () => {
		// Simulate: self at 0 closing on a stationary target at 1000, 1 unit/tick
		// budget, aggressive stance (preferred 100). It should walk in to exactly a
		// 100-unit gap (position 900) and then hold there forever.
		let pos = 0;
		const targetPos = 1000;
		const preferred = stancePreferredDistance("aggressive"); // 100
		for (let tick = 0; tick < 2000; tick++) {
			pos += stanceMoveDelta(pos, targetPos, preferred, 1);
		}
		expect(targetPos - pos).toBe(100); // held exactly at Short band
		expect(pos).toBe(900);
	});

	it("a balanced ship settles at Medium range and holds", () => {
		// self at 0 closing on a stationary target at 1000, balanced (preferred 200):
		// it walks in to a 200-unit gap (position 800) and holds.
		let pos = 0;
		const targetPos = 1000;
		const preferred = stancePreferredDistance("balanced"); // 200
		for (let tick = 0; tick < 2000; tick++) {
			pos += stanceMoveDelta(pos, targetPos, preferred, 1);
		}
		expect(targetPos - pos).toBe(200); // held exactly at Medium band
	});

	it("a standoff ship opens to Long and holds when it started too close", () => {
		// self at 950 (50 from a target at 1000), standoff (preferred 300): it kites
		// out to a 300-unit gap (position 700) and holds.
		let pos = 950;
		const targetPos = 1000;
		const preferred = stancePreferredDistance("standoff"); // 300
		for (let tick = 0; tick < 2000; tick++) {
			pos += stanceMoveDelta(pos, targetPos, preferred, 1);
		}
		expect(targetPos - pos).toBe(300); // held exactly at Long band
	});
});

describe("targeting: focus-fire lowest effective-HP enemy in range", () => {
	it("picks the lowest effective-HP living enemy that is in range", () => {
		const self = mkc({ id: "P1", team: "player", position: 0, weapons: [wpn(1000)] });
		const strong = mkc({ id: "E1", team: "enemy", position: 10, hull: 200, shield: 50 });
		const weak = mkc({ id: "E2", team: "enemy", position: 10, hull: 40, shield: 0 });
		const picked = selectTarget(self, [self, strong, weak]);
		expect(picked?.id).toBe("E2"); // lower effective HP
	});

	it("ignores dead enemies and same-team combatants", () => {
		const self = mkc({ id: "P1", team: "player" });
		const ally = mkc({ id: "P2", team: "player", hull: 1 });
		const deadEnemy = mkc({ id: "E1", team: "enemy", hull: 0, alive: false });
		const liveEnemy = mkc({ id: "E2", team: "enemy", hull: 80 });
		const picked = selectTarget(self, [self, ally, deadEnemy, liveEnemy]);
		expect(picked?.id).toBe("E2");
	});

	it("breaks an effective-HP tie by lower id (order-independent)", () => {
		const self = mkc({ id: "P1", team: "player" });
		const a = mkc({ id: "E9", team: "enemy", hull: 50 });
		const b = mkc({ id: "E2", team: "enemy", hull: 50 });
		expect(selectTarget(self, [self, a, b])?.id).toBe("E2");
		expect(selectTarget(self, [self, b, a])?.id).toBe("E2"); // reversed: same pick
	});

	it("falls back to the nearest-by-HP enemy to close on when none are in range", () => {
		// self has only a Short weapon; both enemies sit at Long distance (out of
		// range). The policy still returns the lower-HP one so the ship has a heading.
		const self = mkc({ id: "P1", team: "player", position: 0, weapons: [wpn(BAND_SHORT)] });
		const far1 = mkc({ id: "E1", team: "enemy", position: BAND_LONG, hull: 200 });
		const far2 = mkc({ id: "E2", team: "enemy", position: BAND_LONG, hull: 60 });
		const picked = selectTarget(self, [self, far1, far2]);
		expect(picked?.id).toBe("E2");
	});

	it("prefers an in-range enemy over a lower-HP out-of-range enemy", () => {
		// A very weak enemy sits out of range; a tougher one is in range. Focus-fire
		// prefers the reachable target (you cannot shoot what you cannot reach).
		const self = mkc({ id: "P1", team: "player", position: 0, weapons: [wpn(BAND_SHORT)] });
		const inRangeTough = mkc({ id: "E1", team: "enemy", position: 50, hull: 150 });
		const outOfRangeWeak = mkc({ id: "E2", team: "enemy", position: BAND_LONG, hull: 5 });
		const picked = selectTarget(self, [self, inRangeTough, outOfRangeWeak]);
		expect(picked?.id).toBe("E1");
	});

	it("returns undefined when no living enemy remains", () => {
		const self = mkc({ id: "P1", team: "player" });
		const ally = mkc({ id: "P2", team: "player" });
		expect(selectTarget(self, [self, ally])).toBeUndefined();
	});

	it("effectiveHp sums shield + hull", () => {
		expect(effectiveHp(mkc({ hull: 100, shield: 40 }))).toBe(140);
	});
});
