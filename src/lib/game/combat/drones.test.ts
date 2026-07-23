// ============================================================================
// combat/drones.test.ts -- drone sub-system tests (Combat 0.13.0, Phase 7a)
//
// Two halves:
//   1. MODEL: makeSquadron sizes per role + size/tier scaling, brand names,
//      independent instances, and the squadronStatusSummary counter.
//   2. OFFENSE (in the sim): an Attack squadron adds damage over a battle vs the
//      same combatant with no drones; output scales with ALIVE drone count;
//      Defense deals less and Support deals none; and it is deterministic per
//      seed. The empty-drones PARITY guard (a zero-offense squadron adds no combat
//      draws) is asserted here and re-confirmed by the flagship suite staying green.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
	makeDrone,
	makeSquadron,
	makeDronePod,
	squadronStatusSummary,
	type DroneRole,
} from "./drones";
import { resolveBattle } from "./resolveBattle";
import type { BattleParticipants, Combatant, CombatWeapon } from "./types";
import type { DroneSquadron } from "./drones";

// ---------------------------------------------------------------------------
// Local fixtures (mirroring resolveBattle.test.ts's builders, kept local since
// they are test scaffolding, not production shapes).
// ---------------------------------------------------------------------------
function makeWeapon(overrides: Partial<CombatWeapon> = {}): CombatWeapon {
	return {
		id: overrides.id ?? "w",
		family: overrides.family ?? "kinetic",
		yieldMin: overrides.yieldMin ?? 10,
		yieldMax: overrides.yieldMax ?? 10,
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
		disruptionResist: overrides.disruptionResist ?? { kinetic: 0, particle: 0, ew: 0 },
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

// A drone-armed player (no weapons of its own, so ALL its damage comes from the
// squadron, isolating drone offense) versus a passive punching-bag enemy with a
// huge hull and no weapons (so nothing dies and the battle runs to the cap).
function droneOwnerVsBag(squadrons: DroneSquadron[]): BattleParticipants {
	return {
		combatants: [
			makeCombatant({
				id: "P1",
				team: "player",
				hull: 100000,
				hullMax: 100000,
				weapons: [], // no ship weapons: only drones deal damage
				drones: squadrons,
			}),
			makeCombatant({
				id: "E1",
				team: "enemy",
				hull: 100000,
				hullMax: 100000,
				weapons: [], // passive: cannot kill the owner, so the battle runs long
			}),
		],
	};
}

// Sum the damage the ENEMY took from drone volleys in a logged battle. Isolates
// drone offense (the owner has no weapons, so every "droneVolley" is a squadron).
function totalDroneDamage(participants: BattleParticipants, seed: number): number {
	const { log } = resolveBattle(participants, seed, { generateLog: true });
	let total = 0;
	for (const event of log) {
		if (event.type === "droneVolley" && event.targetId === "E1") {
			total += event.damage ?? 0;
		}
	}
	return total;
}

// ---------------------------------------------------------------------------
// MODEL.
// ---------------------------------------------------------------------------
describe("makeSquadron sizes + templates", () => {
	it("uses the baseline size per role (Attack 8 / Defense 10 / Support 6)", () => {
		expect(makeSquadron("attack").drones.length).toBe(8);
		expect(makeSquadron("defense").drones.length).toBe(10);
		expect(makeSquadron("support").drones.length).toBe(6);
	});

	it("honors an explicit size param (overrides the baseline)", () => {
		expect(makeSquadron("attack", 3).drones.length).toBe(3);
		expect(makeSquadron("defense", 1).drones.length).toBe(1);
		// A zero/negative size is clamped to at least one drone (never empty).
		expect(makeSquadron("attack", 0).drones.length).toBe(1);
	});

	it("scales size up with hangar tier when no explicit size is given", () => {
		const base = makeSquadron("attack").drones.length;
		const tiered = makeSquadron("attack", undefined, 4).drones.length;
		expect(tiered).toBeGreaterThan(base);
	});

	it("auto-assigns the behavior mode from the role (no toggle)", () => {
		expect(makeSquadron("attack").mode).toBe("assault");
		expect(makeSquadron("defense").mode).toBe("guard");
		expect(makeSquadron("support").mode).toBe("utility");
	});

	it("gives each squadron a real brand/model name (not a placeholder)", () => {
		expect(makeSquadron("attack").model).toBe("Wasp-class");
		expect(makeSquadron("defense").model).toBe("Aegis-class");
		expect(makeSquadron("support").model).toBe("Medic-class");
	});

	it("spawns full-HP online drones matching the role template", () => {
		const sq = makeSquadron("defense");
		for (const drone of sq.drones) {
			expect(drone.alive).toBe(true);
			expect(drone.status).toBe("online");
			expect(drone.hp).toBe(drone.hpMax);
			expect(drone.hp).toBe(sq.droneHp);
		}
	});

	it("produces INDEPENDENT instances (no shared drone references)", () => {
		const a = makeSquadron("attack", 2);
		const b = makeSquadron("attack", 2);
		expect(a.drones).not.toBe(b.drones);
		expect(a.drones[0]).not.toBe(b.drones[0]);
		// Mutating one squadron's drone must not touch the other's.
		a.drones[0].hp = 0;
		expect(b.drones[0].hp).toBe(b.drones[0].hpMax);
	});
});

describe("makeDrone + makeDronePod", () => {
	it("makeDrone builds a fresh full-HP online drone", () => {
		const d = makeDrone(25);
		expect(d).toEqual({
			hp: 25,
			hpMax: 25,
			alive: true,
			status: "online",
			repairProgress: 0,
			refabProgress: 0,
		});
	});

	it("makeDronePod wraps a squadron of the requested role", () => {
		const pod = makeDronePod("support");
		expect(pod.role).toBe("support");
		expect(pod.model).toBe(pod.squadron.model);
		expect(pod.squadron.role).toBe("support");
		expect(pod.squadron.drones.length).toBe(6);
	});
});

describe("squadronStatusSummary", () => {
	it("counts a full squadron as all-online, all-alive", () => {
		const sq = makeSquadron("attack"); // 8 drones
		expect(squadronStatusSummary(sq)).toEqual({
			total: 8,
			alive: 8,
			online: 8,
			disrupted: 0,
			refabricating: 0,
		});
	});

	it("reflects per-drone liveness + status changes", () => {
		const sq = makeSquadron("attack", 5);
		// Simulate a couple of 7b-style transitions by hand (7a never drives these).
		sq.drones[0].alive = false;
		sq.drones[0].status = "refabricating";
		sq.drones[1].status = "disrupted";
		const summary = squadronStatusSummary(sq);
		expect(summary.total).toBe(5);
		expect(summary.alive).toBe(4);
		expect(summary.online).toBe(3);
		expect(summary.disrupted).toBe(1);
		expect(summary.refabricating).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// OFFENSE (in the sim).
// ---------------------------------------------------------------------------
describe("drone offense in resolveBattle", () => {
	it("an Attack squadron adds damage the owner otherwise could not deal", () => {
		// Owner has NO weapons: without drones it deals nothing; with an attack
		// squadron the enemy takes real damage.
		const withDrones = totalDroneDamage(
			droneOwnerVsBag([makeSquadron("attack")]),
			1234,
		);
		expect(withDrones).toBeGreaterThan(0);

		// And the enemy's hull is actually reduced only when drones are present: a
		// no-drone owner produces zero drone-damage events.
		const withoutDrones = totalDroneDamage(droneOwnerVsBag([]), 1234);
		expect(withoutDrones).toBe(0);
	});

	it("is deterministic per seed", () => {
		const a = totalDroneDamage(droneOwnerVsBag([makeSquadron("attack")]), 777);
		const b = totalDroneDamage(droneOwnerVsBag([makeSquadron("attack")]), 777);
		expect(a).toBe(b);
		expect(a).toBeGreaterThan(0);
	});

	it("output scales with ALIVE drone count (killing drones lowers damage)", () => {
		const full = makeSquadron("attack"); // 8 alive
		const halved = makeSquadron("attack"); // kill 4 -> 4 alive
		for (let i = 0; i < 4; i++) halved.drones[i].alive = false;

		const fullDamage = totalDroneDamage(droneOwnerVsBag([full]), 555);
		const halvedDamage = totalDroneDamage(droneOwnerVsBag([halved]), 555);

		expect(halvedDamage).toBeGreaterThan(0);
		expect(halvedDamage).toBeLessThan(fullDamage);
	});

	it("a squadron with zero alive drones deals no damage", () => {
		const dead = makeSquadron("attack", 4);
		for (const drone of dead.drones) drone.alive = false;
		expect(totalDroneDamage(droneOwnerVsBag([dead]), 999)).toBe(0);
	});

	it("Defense deals less offense than Attack; Support deals none", () => {
		const attack = totalDroneDamage(droneOwnerVsBag([makeSquadron("attack")]), 4242);
		const defense = totalDroneDamage(droneOwnerVsBag([makeSquadron("defense")]), 4242);
		const support = totalDroneDamage(droneOwnerVsBag([makeSquadron("support")]), 4242);

		expect(support).toBe(0); // Support has no offense in 7a (utility kit is 7b)
		expect(defense).toBeGreaterThan(0);
		expect(defense).toBeLessThan(attack);
	});
});

// ---------------------------------------------------------------------------
// PARITY GUARD: a ZERO-OFFENSE squadron (Support in 7a) draws nothing from the
// combat stream, so a battle with one is byte-identical to a battle with an empty
// drone list. This proves the drone phase adds no draws when there is no offense,
// which is the mechanism behind "empty drones changes nothing".
// ---------------------------------------------------------------------------
describe("drone parity guard", () => {
	function battle(playerDrones: DroneSquadron[]): BattleParticipants {
		return {
			combatants: [
				makeCombatant({
					id: "P1",
					team: "player",
					hull: 200,
					weapons: [makeWeapon({ id: "pw", yieldMin: 6, yieldMax: 10 })],
					drones: playerDrones,
				}),
				makeCombatant({
					id: "E1",
					team: "enemy",
					hull: 200,
					weapons: [makeWeapon({ id: "ew", yieldMin: 5, yieldMax: 9 })],
				}),
			],
		};
	}

	it("a zero-offense (Support) squadron yields the same outcome as no drones", () => {
		const noDrones = resolveBattle(battle([]), 31337).outcome;
		const supportOnly = resolveBattle(battle([makeSquadron("support")]), 31337).outcome;
		expect(supportOnly).toEqual(noDrones);
	});

	it("offline == live holds with an Attack squadron firing (parity)", () => {
		const build = () => droneOwnerVsBag([makeSquadron("attack")]);
		const offline = resolveBattle(build(), 8080, { generateLog: false }).outcome;
		const live = resolveBattle(build(), 8080, { generateLog: true }).outcome;
		expect(offline).toEqual(live);
	});

	it("resolveBattle never mutates the caller's squadron (purity)", () => {
		const squadron = makeSquadron("attack");
		const participants = droneOwnerVsBag([squadron]);
		resolveBattle(participants, 2024, { generateLog: false });
		// The caller's squadron cooldown + drones are untouched (the sim clones).
		expect(squadron.cooldownAccumulator).toBe(0);
		expect(squadron.drones.every((d) => d.alive)).toBe(true);
	});
});
