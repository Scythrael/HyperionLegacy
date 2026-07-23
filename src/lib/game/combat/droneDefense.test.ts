// ============================================================================
// combat/droneDefense.test.ts -- unit tests for the PURE drone-defense helpers
// (Combat 0.13.0, Phase 7b). These pin the small, sim-independent facts the S8
// defensive matrix rests on: the particle-only reflect gate, drone HP absorption
// + overflow, smart-reflect target selection, the intercept priority ordering,
// replenishment (refab + repair progress), and the support cleanse curve.
//
// The sim-level wiring (a real shot routed through the screen, multi-projectile
// saturation, reflect landing on the attacker) is exercised in resolveBattle.test.ts;
// here we test the helpers in isolation with a SCRIPTED rng so each roll outcome
// is forced, not seed-hunted.
// ============================================================================

import { describe, it, expect } from "vitest";
import type { Rng } from "./rng";
import {
	canReflect,
	absorbWithDrone,
	selectReflectTarget,
	availableDefenders,
	replenishDrones,
	supportCleanse,
} from "./droneDefense";
import { makeDrone, makeSquadron } from "./drones";
import type { Combatant } from "./types";
import type { StatusEffect } from "./statusEffects";

// A scripted Rng: chance() pops the next boolean from `chances` (defaulting true
// once the script runs out), and nextRange/nextInt return fixed values. Lets a
// test force EXACTLY which deflect/evade/reflect rolls pass without seed hunting.
function scriptedRng(opts: { chances?: boolean[]; range?: number } = {}): Rng {
	const chances = [...(opts.chances ?? [])];
	const range = opts.range ?? 0;
	return {
		next: () => 0,
		nextInt: () => range,
		nextRange: () => range,
		chance: () => (chances.length > 0 ? chances.shift()! : true),
	};
}

// A bare combatant good enough for the pure helpers (they only read team/hull/
// alive/id/drones/statusEffects). Not the full sim combatant.
function stubCombatant(overrides: Partial<Combatant> = {}): Combatant {
	return {
		id: "c",
		team: "player",
		hull: 100,
		hullMax: 100,
		shield: 0,
		shieldMax: 0,
		shieldRecharge: 0,
		shieldCoherence: 0,
		ablativeArmor: 0,
		kineticDampening: 0,
		evasion: 0,
		damageResist: { kinetic: 0, particle: 0, ew: 0 },
		disruptionResist: { kinetic: 0, particle: 0, ew: 0 },
		position: 0,
		speed: 0,
		stance: "balanced",
		weapons: [],
		alive: true,
		statusEffects: [],
		drones: [],
		rapidChargeAfterAmbush: false,
		particleTraceDetector: 0,
		...overrides,
	};
}

describe("canReflect: particle-only", () => {
	it("only particle shots can be reflected", () => {
		expect(canReflect("particle")).toBe(true);
		expect(canReflect("kinetic")).toBe(false); // torpedoes are kinetic => blocked
		expect(canReflect("ew")).toBe(false);
	});
});

describe("absorbWithDrone: HP soak + overflow", () => {
	it("soaks up to remaining HP and destroys the drone on penetration", () => {
		const drone = makeDrone(30);
		// 50 damage vs a 30-HP drone: 30 absorbed, 20 overflow, drone destroyed.
		const r = absorbWithDrone(drone, 50);
		expect(r.absorbed).toBe(30);
		expect(r.overflow).toBe(20);
		expect(r.destroyed).toBe(true);
		expect(drone.alive).toBe(false);
		expect(drone.hp).toBe(0);
		expect(drone.status).toBe("refabricating");
		expect(drone.refabProgress).toBe(0);
	});

	it("a non-lethal hit soaks everything, no overflow, drone survives", () => {
		const drone = makeDrone(30);
		const r = absorbWithDrone(drone, 12);
		expect(r.absorbed).toBe(12);
		expect(r.overflow).toBe(0);
		expect(r.destroyed).toBe(false);
		expect(drone.alive).toBe(true);
		expect(drone.hp).toBe(18);
		expect(drone.status).toBe("online");
	});
});

describe("selectReflectTarget", () => {
	it("plain reflect goes straight back at the attacker", () => {
		const carrier = stubCombatant({ id: "P1", team: "player" });
		const attacker = stubCombatant({ id: "E1", team: "enemy", hull: 90 });
		const combatants = [carrier, attacker];
		expect(selectReflectTarget(carrier, attacker, combatants, false)).toBe(attacker);
	});

	it("smart-reflect retargets to the weakest living enemy of the carrier", () => {
		const carrier = stubCombatant({ id: "P1", team: "player" });
		const attacker = stubCombatant({ id: "E1", team: "enemy", hull: 90 });
		const weak = stubCombatant({ id: "E2", team: "enemy", hull: 20 });
		const dead = stubCombatant({ id: "E3", team: "enemy", hull: 0, alive: false });
		const combatants = [carrier, attacker, weak, dead];
		// The weakest LIVING enemy (E2, hull 20) is chosen over the attacker (hull 90).
		expect(selectReflectTarget(carrier, attacker, combatants, true)).toBe(weak);
	});

	it("smart-reflect falls back to the attacker when no other enemy lives", () => {
		const carrier = stubCombatant({ id: "P1", team: "player" });
		const attacker = stubCombatant({ id: "E1", team: "enemy", hull: 90 });
		expect(selectReflectTarget(carrier, attacker, [carrier, attacker], true)).toBe(attacker);
	});
});

describe("availableDefenders: intercept priority defense -> support -> attack", () => {
	it("orders defenders by role, skipping dead/offline drones", () => {
		const attack = makeSquadron("attack", 2);
		const defense = makeSquadron("defense", 2);
		const support = makeSquadron("support", 2);
		// Kill one defense drone: it must NOT appear as an available defender.
		defense.drones[1].alive = false;
		defense.drones[1].status = "refabricating";
		const carrier = stubCombatant({ drones: [attack, defense, support] });

		const defenders = availableDefenders(carrier);
		// 1 defense (one dead) + 2 support + 2 attack = 5, in that role order.
		expect(defenders.map((d) => d.squadron.role)).toEqual([
			"defense",
			"support",
			"support",
			"attack",
			"attack",
		]);
	});

	it("a carrier with no drones has no defenders (the parity guard)", () => {
		expect(availableDefenders(stubCombatant({ drones: [] }))).toEqual([]);
	});
});

describe("replenishDrones: refab + repair progress", () => {
	it("refabricates a destroyed drone up to the squadron size over multiple calls", () => {
		const squad = makeSquadron("attack", 3);
		absorbWithDrone(squad.drones[0], 999); // destroy drone 0
		expect(squad.drones[0].alive).toBe(false);

		// A partial rate advances refab progress but does not finish it.
		let restored = replenishDrones(squad, 40);
		expect(restored).toBe(0);
		expect(squad.drones[0].alive).toBe(false);
		expect(squad.drones[0].status).toBe("refabricating");
		expect(squad.drones[0].refabProgress).toBe(40);

		// Enough total progress brings it fully back ONLINE at full HP.
		restored = replenishDrones(squad, 60);
		expect(restored).toBe(1);
		expect(squad.drones[0].alive).toBe(true);
		expect(squad.drones[0].status).toBe("online");
		expect(squad.drones[0].hp).toBe(squad.drones[0].hpMax);
		expect(squad.drones[0].refabProgress).toBe(0);
	});

	it("repairs a disrupted (alive) drone back to online over repairProgress", () => {
		const squad = makeSquadron("defense", 2);
		squad.drones[0].status = "disrupted";
		squad.drones[0].repairProgress = 0;

		replenishDrones(squad, 30);
		expect(squad.drones[0].status).toBe("disrupted");
		expect(squad.drones[0].repairProgress).toBe(30);

		const restored = replenishDrones(squad, 80);
		expect(restored).toBe(1);
		expect(squad.drones[0].status).toBe("online");
		expect(squad.drones[0].repairProgress).toBe(0);
		expect(squad.drones[0].alive).toBe(true);
	});

	it("a zero rate is a no-op (parity-safe when the in-combat percent floors to 0)", () => {
		const squad = makeSquadron("attack", 2);
		absorbWithDrone(squad.drones[0], 999);
		const before = JSON.parse(JSON.stringify(squad.drones));
		expect(replenishDrones(squad, 0)).toBe(0);
		expect(squad.drones).toEqual(before);
	});
});

describe("supportCleanse: strips disruptions, halving chance per rank", () => {
	function disruption(defId: string, rank: number): StatusEffect {
		return { defId, rank, remainingDeciSec: 50, dotBank: 0 };
	}

	it("cleanses a disruption on a passing roll and leaves it on a failing roll", () => {
		const owner = {
			statusEffects: [
				disruption("scatteringField", 1),
				disruption("coolantLeak", 1),
			],
		};
		// Script: first disruption cleansed (true), second not (false).
		const rng = scriptedRng({ chances: [true, false] });
		const cleansed = supportCleanse(owner, rng);
		expect(cleansed).toEqual(["scatteringField"]);
		expect(owner.statusEffects.map((e) => e.defId)).toEqual(["coolantLeak"]);
	});

	it("leaves non-disruption effects (buffs) untouched", () => {
		const owner = {
			statusEffects: [
				disruption("scatteringField", 1),
				{ defId: "overchargedCapacitors", rank: 1, remainingDeciSec: 50, dotBank: 0 },
			],
		};
		const rng = scriptedRng({ chances: [true] }); // only the disruption is rolled
		const cleansed = supportCleanse(owner, rng);
		expect(cleansed).toEqual(["scatteringField"]);
		// The buff survives (cleanse never rolls it).
		expect(owner.statusEffects.map((e) => e.defId)).toEqual(["overchargedCapacitors"]);
	});
});
