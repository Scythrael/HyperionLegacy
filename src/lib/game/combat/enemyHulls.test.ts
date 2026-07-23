// ============================================================================
// combat/enemyHulls.test.ts -- shape-guard for the pirate ENEMY hull roster
// (Combat 0.13.0, Phase 9b sub-phase 4)
//
// Nothing balances the numbers here (that is a later balance pass, design S20);
// these tests pin the DATA-SHAPE CONTRACT the enemy-wave generator relies on,
// mirroring the FACTIONS / BLUEPRINTS drift guards in model.test.ts:
//   - map-key-equals-id (a key and its id can never disagree),
//   - unique ids,
//   - non-empty display name,
//   - non-empty weapon list (every combat hull can shoot),
//   - positive combat stats (no zero/negative HP or shield pool).
// If any go red, the generator could mint a malformed enemy Combatant.
// ============================================================================

import { describe, it, expect } from "vitest";
import { PIRATE_HULLS } from "./enemyHulls";

describe("PIRATE_HULLS, pirate enemy hull roster (Combat 0.13.0 §9b.4)", () => {
	it("has a small first-pass roster (at least 3 hulls)", () => {
		expect(Object.keys(PIRATE_HULLS).length).toBeGreaterThanOrEqual(3);
	});

	it("every entry's map key equals its id (no key/id drift)", () => {
		for (const [key, hull] of Object.entries(PIRATE_HULLS)) {
			expect(hull.id).toBe(key);
		}
	});

	it("ids are unique", () => {
		const ids = Object.values(PIRATE_HULLS).map((h) => h.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("every hull has a non-empty display name", () => {
		for (const hull of Object.values(PIRATE_HULLS)) {
			expect(hull.name.length).toBeGreaterThan(0);
		}
	});

	it("every hull has at least one weapon (a combat hull can shoot)", () => {
		for (const hull of Object.values(PIRATE_HULLS)) {
			expect(hull.weapons.length).toBeGreaterThan(0);
		}
	});

	it("every hull has positive hull / shield / recharge stats", () => {
		for (const hull of Object.values(PIRATE_HULLS)) {
			expect(hull.hullIntegrity).toBeGreaterThan(0);
			expect(hull.shieldCapacity).toBeGreaterThan(0);
			expect(hull.shieldRecharge).toBeGreaterThan(0);
		}
	});

	it("at least one hull fields drones (the carrier, so anti-drone content matters)", () => {
		const anyDrones = Object.values(PIRATE_HULLS).some(
			(h) => h.droneRoles.length > 0,
		);
		expect(anyDrones).toBe(true);
	});
});
