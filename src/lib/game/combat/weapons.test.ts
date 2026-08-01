// ============================================================================
// combat/weapons.test.ts -- roster integrity + identity tests for the nine v1
// weapons (Combat 0.13.0, Phase 3)
//
// These guard the CONTENT (design S3) as data: every roster entry is a valid
// CombatWeapon, the family split is correct (3 particle / 3 kinetic / 3 EW), the
// signature levers are only set on their owning family (attenuation = particle,
// armorPen = kinetic), and each weapon's LOCKED IDENTITY (S3) is reflected in its
// stats (Voltaic has zero attenuation, Railgun has high armor-pen + accuracy,
// Autocannon is fast + multi-projectile, Torpedo is a heavy single warhead, etc).
// The exact numbers are tunable, so these tests assert IDENTITY-DEFINING
// RELATIONSHIPS, not brittle magic values, wherever possible.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
	WEAPON_DEFS,
	makeWeaponInstance,
	PLASMA,
	GRAVITON,
	VOLTAIC,
	RAILGUN,
	AUTOCANNON,
	CONCUSSION_TORPEDO,
	POINT_DEFENSE_ARRAY,
	TACHYON_BURST_EMITTER,
} from "./weapons";
import { DISRUPTIONS } from "./statusEffects";
import type { CombatWeapon, WeaponFamily } from "./types";

const ALL = Object.values(WEAPON_DEFS);

describe("weapon roster: shape + integrity", () => {
	it("has exactly nine weapons", () => {
		expect(ALL.length).toBe(9);
	});

	it("has three weapons per family", () => {
		const byFamily = (f: WeaponFamily) => ALL.filter((w) => w.family === f);
		expect(byFamily("particle").length).toBe(3);
		expect(byFamily("kinetic").length).toBe(3);
		expect(byFamily("ew").length).toBe(3);
	});

	it("every weapon has valid, integer, bounded stats", () => {
		for (const w of ALL) {
			// ids match their map key (no copy-paste drift).
			expect(typeof w.id).toBe("string");
			expect(w.id.length).toBeGreaterThan(0);
			// Damage band is a valid inclusive integer range.
			expect(Number.isInteger(w.yieldMin)).toBe(true);
			expect(Number.isInteger(w.yieldMax)).toBe(true);
			expect(w.yieldMin).toBeGreaterThan(0);
			expect(w.yieldMax).toBeGreaterThanOrEqual(w.yieldMin);
			// Timing + counts are positive integers.
			expect(Number.isInteger(w.cooldownDeciSec)).toBe(true);
			expect(w.cooldownDeciSec).toBeGreaterThan(0);
			expect(Number.isInteger(w.projectileCount)).toBe(true);
			expect(w.projectileCount).toBeGreaterThanOrEqual(1);
			expect(w.range).toBeGreaterThan(0);
			// Accuracy is a valid percent.
			expect(w.accuracy).toBeGreaterThanOrEqual(0);
			expect(w.accuracy).toBeLessThanOrEqual(100);
			// Signature levers are valid percents.
			expect(w.shieldAttenuation).toBeGreaterThanOrEqual(0);
			expect(w.shieldAttenuation).toBeLessThanOrEqual(100);
			expect(w.armorPen).toBeGreaterThanOrEqual(0);
			expect(w.armorPen).toBeLessThanOrEqual(100);
			// Templates start with a zeroed cooldown.
			expect(w.cooldownAccumulator).toBe(0);
			// Phase 4: each weapon carries 0..2 effect slots (design S3), and every
			// slot references a real disruption/DoT def with valid integer-percent
			// proc + escalation chances.
			expect(Array.isArray(w.effectSlots)).toBe(true);
			expect(w.effectSlots.length).toBeLessThanOrEqual(2);
			for (const slot of w.effectSlots) {
				expect(DISRUPTIONS[slot.defId]).toBeDefined();
				expect(slot.procChance).toBeGreaterThan(0);
				expect(slot.procChance).toBeLessThanOrEqual(100);
				expect(slot.escalationChance).toBeGreaterThanOrEqual(0);
				expect(slot.escalationChance).toBeLessThanOrEqual(100);
			}
		}
	});

	it("map keys match each weapon's id", () => {
		for (const [key, w] of Object.entries(WEAPON_DEFS)) {
			expect(w.id).toBe(key);
		}
	});
});

describe("weapon roster: signature levers only on the owning family", () => {
	it("only PARTICLE weapons may carry shieldAttenuation (kinetic/EW = 0)", () => {
		for (const w of ALL) {
			if (w.family !== "particle") {
				expect(w.shieldAttenuation).toBe(0);
			}
		}
	});

	it("only KINETIC weapons carry armorPen (particle/EW = 0)", () => {
		for (const w of ALL) {
			if (w.family !== "kinetic") {
				expect(w.armorPen).toBe(0);
			}
		}
	});
});

describe("weapon roster: locked identities (design S3)", () => {
	it("Voltaic is anti-shield with ZERO attenuation (weak vs hull once shields drop)", () => {
		expect(VOLTAIC.family).toBe("particle");
		// The defining trait: no bleed-through, so it cannot damage hull through
		// shields the way Plasma/Graviton can.
		expect(VOLTAIC.shieldAttenuation).toBe(0);
		// Plasma, by contrast, DOES attenuate.
		expect(PLASMA.shieldAttenuation).toBeGreaterThan(0);
	});

	it("Railgun is a high-yield, high-accuracy, high-armorPen kinetic", () => {
		expect(RAILGUN.family).toBe("kinetic");
		expect(RAILGUN.accuracy).toBeGreaterThanOrEqual(85);
		expect(RAILGUN.armorPen).toBeGreaterThanOrEqual(50);
		// Out-yields the sustained Autocannon per shot by a wide margin.
		expect(RAILGUN.yieldMin).toBeGreaterThan(AUTOCANNON.yieldMax);
	});

	it("Autocannon is low-yield, high-rate, multi-projectile sustained fire", () => {
		expect(AUTOCANNON.family).toBe("kinetic");
		expect(AUTOCANNON.projectileCount).toBeGreaterThanOrEqual(2);
		// Fastest cooldown among the kinetics (sustained DPS identity).
		expect(AUTOCANNON.cooldownDeciSec).toBeLessThan(RAILGUN.cooldownDeciSec);
		expect(AUTOCANNON.cooldownDeciSec).toBeLessThan(
			CONCUSSION_TORPEDO.cooldownDeciSec,
		);
	});

	it("Concussion Torpedo is a heavy single-projectile warhead: highest yield, slowest, low-mid accuracy", () => {
		expect(CONCUSSION_TORPEDO.family).toBe("kinetic");
		expect(CONCUSSION_TORPEDO.projectileCount).toBe(1);
		// Highest per-shot yield in the whole roster (the warhead).
		const maxYield = Math.max(...ALL.map((w) => w.yieldMax));
		expect(CONCUSSION_TORPEDO.yieldMax).toBe(maxYield);
		// Long, punishing reload + swingy accuracy.
		expect(CONCUSSION_TORPEDO.cooldownDeciSec).toBe(
			Math.max(...ALL.map((w) => w.cooldownDeciSec)),
		);
		expect(CONCUSSION_TORPEDO.accuracy).toBeLessThan(RAILGUN.accuracy);
	});

	it("Point-Defense Array is a fast, accurate, many-projectile EW screen weapon", () => {
		expect(POINT_DEFENSE_ARRAY.family).toBe("ew");
		expect(POINT_DEFENSE_ARRAY.projectileCount).toBeGreaterThanOrEqual(3);
		expect(POINT_DEFENSE_ARRAY.accuracy).toBeGreaterThanOrEqual(90);
	});
});

// ---------------------------------------------------------------------------
// COMBAT 1.0 (Unit 1.5): the three status effects that had a READER but no weapon
// SOURCE are given a home on a second effect slot, lighting them up in battle. These
// lock the SOURCE assignment (the durable identity contract), keeping each weapon's
// existing first slot. The effect-free weapons (Autocannon, Point-Defense Array) stay
// effect-free by design (S3), so their identity is not diluted.
// ---------------------------------------------------------------------------
describe("weapon roster: Combat 1.0 Unit 1.5 newly-sourced effects", () => {
	it("Plasma sources Harmonic Gap (its second slot), keeping Plasma Fire", () => {
		const ids = PLASMA.effectSlots.map((s) => s.defId);
		expect(ids).toContain("plasmaFire");
		expect(ids).toContain("harmonicGap");
	});

	it("Graviton sources Coil Dampening (its second slot), keeping Manifold Overheat", () => {
		const ids = GRAVITON.effectSlots.map((s) => s.defId);
		expect(ids).toContain("manifoldOverheat");
		expect(ids).toContain("coilDampening");
	});

	it("Tachyon Burst Emitter sources Sensor Power Drain (its second slot), keeping Scattering Field", () => {
		const ids = TACHYON_BURST_EMITTER.effectSlots.map((s) => s.defId);
		expect(ids).toContain("scatteringField");
		expect(ids).toContain("sensorPowerDrain");
	});

	it("the deliberately effect-free weapons stay effect-free (design S3)", () => {
		// Autocannon (pure sustained hull DPS) + Point-Defense Array (anti-drone screen)
		// carry NO effect slots by design; Unit 1.5 must not dilute that identity.
		expect(AUTOCANNON.effectSlots.length).toBe(0);
		expect(POINT_DEFENSE_ARRAY.effectSlots.length).toBe(0);
	});
});

describe("weapon roster: instance cloning", () => {
	it("makeWeaponInstance returns a fresh, independent copy (no shared mutation)", () => {
		const a = makeWeaponInstance("plasma");
		const b = makeWeaponInstance("plasma");
		// Plasma ships with one effect slot (Plasma Fire), so this also proves the
		// effectSlots ARRAY is cloned, not shared: mutating one instance's sim-state
		// (cooldown + slot list) must not touch the other instance or the template.
		const templateSlots = PLASMA.effectSlots.length;
		expect(templateSlots).toBeGreaterThan(0);
		a.cooldownAccumulator = 55;
		a.effectSlots.push({ defId: "coolantLeak", procChance: 1, escalationChance: 1 });
		expect(b.cooldownAccumulator).toBe(0);
		expect(b.effectSlots.length).toBe(templateSlots); // clone unaffected
		expect(PLASMA.cooldownAccumulator).toBe(0);
		expect(PLASMA.effectSlots.length).toBe(templateSlots); // template unaffected
	});

	it("makeWeaponInstance can assign a unique instance id (two of the same weapon on one ship)", () => {
		const w1 = makeWeaponInstance("autocannon", "auto-1");
		const w2 = makeWeaponInstance("autocannon", "auto-2");
		expect(w1.id).toBe("auto-1");
		expect(w2.id).toBe("auto-2");
		// Same underlying stats, different identity.
		expect(w1.family).toBe(w2.family);
		expect(w1.yieldMax).toBe(w2.yieldMax);
	});

	it("a cloned instance carries the template's stats", () => {
		const rail = makeWeaponInstance("railgun");
		const tpl: CombatWeapon = RAILGUN;
		expect(rail.family).toBe(tpl.family);
		expect(rail.yieldMin).toBe(tpl.yieldMin);
		expect(rail.yieldMax).toBe(tpl.yieldMax);
		expect(rail.armorPen).toBe(tpl.armorPen);
	});
});
