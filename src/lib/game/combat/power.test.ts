// ============================================================================
// combat/power.test.ts -- unit tests for the reactor power budget (Combat
// 0.13.0, Phase 5, design S10)
//
// Pin the budget contract: a loadout under the reactor output is fittable, one
// that exceeds it is blocked, and the exact-equal boundary FITS (a fully-loaded
// reactor is legal). Also verifies the roster's per-weapon powerDraw is present
// so a real loadout can be summed.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
	powerBudget,
	canFitByPower,
	totalPowerDraw,
	type PoweredSystem,
} from "./power";
import { WEAPON_DEFS } from "./weapons";

// A tiny powered-system factory so tests read as intent.
const draw = (powerDraw: number): PoweredSystem => ({ powerDraw });

describe("powerBudget: total draw vs reactor output", () => {
	it("a loadout under the output is within budget with positive headroom", () => {
		const b = powerBudget(100, [draw(20), draw(30), draw(25)]);
		expect(b.draw).toBe(75);
		expect(b.remaining).toBe(25);
		expect(b.overBudget).toBe(false);
	});

	it("exact-equal draw fits (boundary is inclusive)", () => {
		const b = powerBudget(75, [draw(40), draw(35)]);
		expect(b.draw).toBe(75);
		expect(b.remaining).toBe(0);
		expect(b.overBudget).toBe(false); // exactly full is legal
	});

	it("exceeding the output is over budget with negative headroom", () => {
		const b = powerBudget(50, [draw(30), draw(25)]);
		expect(b.draw).toBe(55);
		expect(b.remaining).toBe(-5);
		expect(b.overBudget).toBe(true);
	});

	it("an empty loadout draws nothing and echoes the output", () => {
		const b = powerBudget(60, []);
		expect(b.draw).toBe(0);
		expect(b.remaining).toBe(60);
		expect(b.overBudget).toBe(false);
		expect(b.output).toBe(60);
	});
});

describe("totalPowerDraw", () => {
	it("sums an arbitrary loadout", () => {
		expect(totalPowerDraw([draw(8), draw(35), draw(10)])).toBe(53);
	});
	it("is 0 for an empty loadout", () => {
		expect(totalPowerDraw([])).toBe(0);
	});
});

describe("canFitByPower: fit-time predicate (design S10 boundary)", () => {
	it("fits when the new total stays under the reactor output", () => {
		// current 40, candidate 20, output 100 => 60 <= 100 => fits.
		expect(canFitByPower(100, 40, 20)).toBe(true);
	});

	it("fits at the exact-equal boundary (a fully-loaded reactor is legal)", () => {
		// current 80, candidate 20, output 100 => exactly 100 => fits.
		expect(canFitByPower(100, 80, 20)).toBe(true);
	});

	it("is blocked when the new total exceeds the reactor output", () => {
		// current 90, candidate 20, output 100 => 110 > 100 => blocked.
		expect(canFitByPower(100, 90, 20)).toBe(false);
	});
});

describe("roster power draws feed a real budget", () => {
	it("every roster weapon carries an integer powerDraw", () => {
		for (const w of Object.values(WEAPON_DEFS)) {
			expect(Number.isInteger(w.powerDraw)).toBe(true);
			expect(w.powerDraw).toBeGreaterThan(0);
		}
	});

	it("a mixed roster loadout sums and can over/under-run a reactor", () => {
		// A heavy loadout (Concussion Torpedo 35 + Railgun 30 + EMP 25 = 90) fits a
		// 100-output reactor but not a 60-output one, proving the budget bites.
		const heavy = [
			WEAPON_DEFS.concussionTorpedo,
			WEAPON_DEFS.railgun,
			WEAPON_DEFS.empCannon,
		];
		expect(powerBudget(100, heavy).overBudget).toBe(false);
		expect(powerBudget(60, heavy).overBudget).toBe(true);
	});
});
