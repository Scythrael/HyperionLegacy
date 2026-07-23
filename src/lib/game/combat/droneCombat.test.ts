// ============================================================================
// combat/droneCombat.test.ts -- SIM-LEVEL drone defense tests (Combat 0.13.0,
// Phase 7b). These exercise the WIRING of the S8 interaction matrix through the
// real shot pipeline (fireWeapon) and the real tick loop (resolveBattle): a shot
// routed through a drone screen, reflect/smart-reflect, multi-projectile
// saturation, the support pulse, and in-combat replenishment.
//
// Determinism WITHOUT seed hunting: the per-projectile drone rolls (deflect /
// evade / reflect) are integer-percent COMBAT-stream draws, so a SCRIPTED rng
// (each chance() forced true/false, each damage roll a fixed value) pins exactly
// which branch fires. The squadron chance fields are also forced to 0/100 where a
// test wants a guaranteed branch, so nothing depends on a lucky seed.
// ============================================================================

import { describe, it, expect } from "vitest";
import { fireWeapon, resolveBattle } from "./resolveBattle";
import type { Combatant, CombatWeapon } from "./types";
import type { Rng } from "./rng";
import { makeSquadron, makeDrone } from "./drones";
import type { DroneSquadron } from "./drones";

// A scripted rng: chance() pops the next forced boolean (default false when the
// script runs dry), nextRange/nextInt return a fixed value. Lets a test dictate
// hit / crit / deflect / evade / reflect outcomes in the exact draw order
// fireWeapon uses (per projectile: hit, crit, damage, then the intercept rolls).
function scriptedRng(chances: boolean[], fixed = 0): Rng {
	const queue = [...chances];
	return {
		next: () => 0,
		nextInt: () => fixed,
		nextRange: () => fixed,
		chance: () => (queue.length > 0 ? queue.shift()! : false),
	};
}

function makeWeapon(overrides: Partial<CombatWeapon> = {}): CombatWeapon {
	return {
		id: overrides.id ?? "w",
		family: overrides.family ?? "ew", // EW = neutral vs armor (1:1 damage math)
		yieldMin: overrides.yieldMin ?? 50,
		yieldMax: overrides.yieldMax ?? 50,
		cooldownDeciSec: overrides.cooldownDeciSec ?? 10,
		accuracy: overrides.accuracy ?? 100, // always "hits" (scripted controls anyway)
		projectileCount: overrides.projectileCount ?? 1,
		range: overrides.range ?? 1000,
		shieldAttenuation: overrides.shieldAttenuation ?? 0,
		armorPen: overrides.armorPen ?? 0,
		cooldownAccumulator: overrides.cooldownAccumulator ?? 0,
		effectSlots: overrides.effectSlots ?? [],
		durability: 100,
		durabilityMax: 100,
		quality: 0,
		powerDraw: 0,
		ambushEligible: overrides.ambushEligible ?? true,
		antiDrone: overrides.antiDrone,
	};
}

function makeCombatant(overrides: Partial<Combatant> = {}): Combatant {
	const hullMax = overrides.hullMax ?? overrides.hull ?? 100;
	return {
		id: overrides.id ?? "c",
		team: overrides.team ?? "player",
		hull: overrides.hull ?? hullMax,
		hullMax,
		shield: overrides.shield ?? 0, // 0 => the vs-ARMOR triangle column applies
		shieldMax: overrides.shieldMax ?? 0,
		shieldRecharge: 0,
		shieldCoherence: 0,
		ablativeArmor: overrides.ablativeArmor ?? 0,
		kineticDampening: overrides.kineticDampening ?? 0,
		evasion: overrides.evasion ?? 0,
		damageResist: { kinetic: 0, particle: 0, ew: 0 },
		disruptionResist: { kinetic: 0, particle: 0, ew: 0 },
		position: overrides.position ?? 0,
		speed: overrides.speed ?? 0,
		stance: overrides.stance ?? "balanced",
		weapons: overrides.weapons ?? [],
		alive: overrides.alive ?? true,
		statusEffects: overrides.statusEffects ?? [],
		drones: overrides.drones ?? [],
		rapidChargeAfterAmbush: false,
		particleTraceDetector: 0,
		inCombatReplenishPercent: overrides.inCombatReplenishPercent,
	};
}

// A single-drone squadron of `role`, with its defensive chances forced so a test
// gets a guaranteed branch. Built from the real factory (so every field is
// present) then overridden.
function forcedSquadron(
	role: "attack" | "defense" | "support",
	overrides: Partial<DroneSquadron> = {},
): DroneSquadron {
	const sq = makeSquadron(role, 1);
	return { ...sq, ...overrides };
}

describe("carrier-targeted: defense drone deflects a particle shot", () => {
	it("a deflected particle shot leaves the carrier untouched", () => {
		const defense = forcedSquadron("defense", { interceptChance: 100, reflectChance: 0 });
		const carrier = makeCombatant({ id: "P1", team: "player", hull: 100, drones: [defense] });
		const attacker = makeCombatant({ id: "E1", team: "enemy" });
		const weapon = makeWeapon({ family: "particle", yieldMin: 20, yieldMax: 20 });

		// Draw order: hit(true), crit(false), then deflect(true). reflectChance 0 =>
		// no reflect roll (harmless block).
		const shot = fireWeapon(attacker, carrier, weapon, scriptedRng([true, false, true], 20), false, {
			combatants: [attacker, carrier],
		});

		expect(carrier.hull).toBe(100); // untouched
		expect(shot.damage).toBe(0);
		expect(shot.dronesEngaged).toBe(1);
		expect(shot.collateral).toEqual([]);
		expect(defense.drones[0].alive).toBe(true); // deflect costs no HP
	});
});

describe("carrier-targeted: reflect is particle-only", () => {
	it("a reflected particle shot bounces onto the attacker", () => {
		const defense = forcedSquadron("defense", { interceptChance: 100, reflectChance: 100 });
		const carrier = makeCombatant({ id: "P1", team: "player", hull: 100, drones: [defense] });
		const attacker = makeCombatant({ id: "E1", team: "enemy", hull: 100 });
		const weapon = makeWeapon({ family: "particle", yieldMin: 20, yieldMax: 20 });

		// hit, crit(false), deflect(true), reflect(true).
		const shot = fireWeapon(
			attacker,
			carrier,
			weapon,
			scriptedRng([true, false, true, true], 20),
			false,
			{ combatants: [attacker, carrier] },
		);

		// Carrier takes nothing; the attacker eats the reflected particle bolt
		// (raw 20, particle vs armor 90% => 18 with the attacker's shields down).
		expect(carrier.hull).toBe(100);
		expect(shot.collateral).toEqual([
			{ targetId: "E1", damage: 18, kind: "reflect", killed: false },
		]);
		expect(attacker.hull).toBe(82);
	});

	it("a torpedo (kinetic) is intercepted but NEVER reflected: blocked, no attacker damage", () => {
		const defense = forcedSquadron("defense", { interceptChance: 100, reflectChance: 100 });
		const carrier = makeCombatant({ id: "P1", team: "player", hull: 100, drones: [defense] });
		const attacker = makeCombatant({ id: "E1", team: "enemy", hull: 100 });
		// Concussion Torpedo is KINETIC: canReflect(kinetic) is false, so no reflect
		// roll is drawn even though reflectChance is 100.
		const weapon = makeWeapon({ family: "kinetic", yieldMin: 40, yieldMax: 40 });

		const shot = fireWeapon(attacker, carrier, weapon, scriptedRng([true, false, true], 40), false, {
			combatants: [attacker, carrier],
		});

		expect(carrier.hull).toBe(100); // blocked
		expect(attacker.hull).toBe(100); // NOT reflected
		expect(shot.collateral).toEqual([]);
	});
});

describe("carrier-targeted: failed deflect overflows to the carrier", () => {
	it("the drone absorbs with HP and the overflow (damage - droneHP) hits the carrier + kills the drone", () => {
		// Defense drone hp 30; forced deflect FAIL (interceptChance 0).
		const drone = makeDrone(30);
		const defense = forcedSquadron("defense", { interceptChance: 0, drones: [drone] });
		const carrier = makeCombatant({ id: "P1", team: "player", hull: 100, drones: [defense] });
		const attacker = makeCombatant({ id: "E1", team: "enemy" });
		// EW is neutral vs armor (100%), so overflow lands 1:1 for clean math.
		const weapon = makeWeapon({ family: "ew", yieldMin: 50, yieldMax: 50 });

		// hit, crit(false), deflect(false).
		const shot = fireWeapon(attacker, carrier, weapon, scriptedRng([true, false, false], 50), false, {
			combatants: [attacker, carrier],
		});

		// 50 damage vs a 30-HP drone => 30 absorbed, 20 overflow onto the carrier.
		expect(carrier.hull).toBe(80);
		expect(shot.damage).toBe(20);
		expect(drone.alive).toBe(false);
		expect(drone.status).toBe("refabricating");
		expect(shot.dronesDestroyed).toBe(1);
	});
});

describe("carrier-targeted: support drone is a pure meat-shield", () => {
	it("takes the hit with no roll; the weapon punches through for damage - droneHP", () => {
		const drone = makeDrone(15);
		const support = forcedSquadron("support", { drones: [drone] });
		const carrier = makeCombatant({ id: "P1", team: "player", hull: 100, drones: [support] });
		const attacker = makeCombatant({ id: "E1", team: "enemy" });
		const weapon = makeWeapon({ family: "ew", yieldMin: 50, yieldMax: 50 });

		// Support meat-shield takes NO roll: after hit(true)+crit(false) the drone
		// just absorbs. 50 - 15 = 35 overflow to the carrier.
		const shot = fireWeapon(attacker, carrier, weapon, scriptedRng([true, false], 50), false, {
			combatants: [attacker, carrier],
		});

		expect(carrier.hull).toBe(65);
		expect(shot.damage).toBe(35);
		expect(drone.alive).toBe(false);
	});
});

describe("carrier-targeted: attack drone risky intercept + counterattack", () => {
	it("a successful evade dodges the shot AND lands a solid counter on the attacker", () => {
		// Attack squadron (kinetic family), forced intercept success (interceptChance 100).
		const attack = forcedSquadron("attack", {
			interceptChance: 100,
			yieldMin: 6,
			yieldMax: 6,
		});
		const carrier = makeCombatant({ id: "P1", team: "player", hull: 100, drones: [attack] });
		const attacker = makeCombatant({ id: "E1", team: "enemy", hull: 100 });
		const weapon = makeWeapon({ family: "ew", yieldMin: 50, yieldMax: 50 });

		// hit, crit(false), intercept-evade(true). The counter damage is a nextRange
		// roll (fixed 6). Kinetic counter vs the attacker's armor-down hull: 110% =>
		// floor(6 * 1.1) = 6.
		const shot = fireWeapon(attacker, carrier, weapon, scriptedRng([true, false, true], 6), false, {
			combatants: [attacker, carrier],
		});

		expect(carrier.hull).toBe(100); // dodged
		expect(shot.collateral).toEqual([
			{ targetId: "E1", damage: 6, kind: "counter", killed: false },
		]);
		expect(attacker.hull).toBe(94);
		expect(attack.drones[0].alive).toBe(true); // the drone took nothing
	});
});

describe("multi-projectile saturation: N projectiles vs a thin screen", () => {
	it("a 3-projectile weapon vs a 1-drone screen: 1 contested, 2 leak to the carrier", () => {
		const defense = forcedSquadron("defense", { interceptChance: 100, reflectChance: 0 });
		const carrier = makeCombatant({ id: "P1", team: "player", hull: 100, drones: [defense] });
		const attacker = makeCombatant({ id: "E1", team: "enemy" });
		const weapon = makeWeapon({ family: "ew", yieldMin: 10, yieldMax: 10, projectileCount: 3 });

		// Projectile 1: hit, crit(false), deflect(true) -> blocked.
		// Projectiles 2 & 3: hit, crit(false) -> no defender left -> leak to carrier.
		const shot = fireWeapon(
			attacker,
			carrier,
			weapon,
			scriptedRng([true, false, true, true, false, true, false], 10),
			false,
			{ combatants: [attacker, carrier] },
		);

		expect(shot.dronesEngaged).toBe(1); // only ONE drone could contest
		expect(shot.damage).toBe(20); // two 10-damage projectiles leaked through
		expect(carrier.hull).toBe(80);
	});
});

describe("squadron-targeted (antiDrone weapon)", () => {
	it("an attack drone evades anti-drone fire and takes nothing", () => {
		const attack = forcedSquadron("attack", { evasion: 100 });
		const carrier = makeCombatant({ id: "P1", team: "player", hull: 100, drones: [attack] });
		const attacker = makeCombatant({ id: "E1", team: "enemy" });
		const weapon = makeWeapon({ family: "ew", yieldMin: 50, yieldMax: 50, antiDrone: true });

		// hit, crit(false), squadron-targeted evade(true).
		const shot = fireWeapon(attacker, carrier, weapon, scriptedRng([true, false, true], 50), false, {
			combatants: [attacker, carrier],
		});

		expect(attack.drones[0].alive).toBe(true);
		expect(carrier.hull).toBe(100); // anti-drone fire never spills to the carrier
		expect(shot.damage).toBe(0);
	});

	it("an attack drone that fails to evade anti-drone fire dies, and nothing hits the carrier", () => {
		const attack = forcedSquadron("attack", { evasion: 0 }); // guaranteed hit on the drone
		const carrier = makeCombatant({ id: "P1", team: "player", hull: 100, drones: [attack] });
		const attacker = makeCombatant({ id: "E1", team: "enemy" });
		const weapon = makeWeapon({ family: "ew", yieldMin: 50, yieldMax: 50, antiDrone: true });

		// hit, crit(false), evade(false) -> drone takes 50 > 20 HP -> destroyed.
		const shot = fireWeapon(attacker, carrier, weapon, scriptedRng([true, false, false], 50), false, {
			combatants: [attacker, carrier],
		});

		expect(attack.drones[0].alive).toBe(false);
		expect(carrier.hull).toBe(100); // no overflow to the carrier (aimed at the drones)
		expect(shot.dronesDestroyed).toBe(1);
	});

	it("a defense drone deflects anti-drone fire (destroyed only on penetration)", () => {
		const drone = makeDrone(30);
		const defense = forcedSquadron("defense", { interceptChance: 0, drones: [drone] });
		const carrier = makeCombatant({ id: "P1", team: "player", hull: 100, drones: [defense] });
		const attacker = makeCombatant({ id: "E1", team: "enemy" });
		const weapon = makeWeapon({ family: "ew", yieldMin: 20, yieldMax: 20, antiDrone: true });

		// Forced deflect FAIL: the drone absorbs 20 of its 30 HP and survives; anti-
		// drone fire does NOT spill to the carrier.
		const shot = fireWeapon(attacker, carrier, weapon, scriptedRng([true, false, false], 20), false, {
			combatants: [attacker, carrier],
		});

		expect(drone.alive).toBe(true);
		expect(drone.hp).toBe(10);
		expect(carrier.hull).toBe(100);
		expect(shot.dronesDestroyed).toBe(0);
	});
});

describe("smart-reflect retargets a reflected shot to a priority foe", () => {
	it("a smart-reflect carrier bounces the shot at the WEAKEST enemy, not the attacker", () => {
		const defense = forcedSquadron("defense", {
			interceptChance: 100,
			reflectChance: 100,
			smartReflect: true,
		});
		const carrier = makeCombatant({ id: "P1", team: "player", hull: 100, drones: [defense] });
		const attacker = makeCombatant({ id: "E1", team: "enemy", hull: 100 });
		const weak = makeCombatant({ id: "E2", team: "enemy", hull: 30 });
		const weapon = makeWeapon({ family: "particle", yieldMin: 20, yieldMax: 20 });

		const shot = fireWeapon(
			attacker,
			carrier,
			weapon,
			scriptedRng([true, false, true, true], 20),
			false,
			{ combatants: [attacker, carrier, weak] },
		);

		// The reflected bolt hits E2 (the weakest enemy), not the E1 attacker.
		expect(shot.collateral).toEqual([
			{ targetId: "E2", damage: 18, kind: "reflect", killed: false },
		]);
		expect(attacker.hull).toBe(100);
		expect(weak.hull).toBe(12); // 30 - 18
	});
});

// ---------------------------------------------------------------------------
// SIM-LEVEL (through resolveBattle): support pulse, cleanse, in-combat replenish.
// These assert on the LOG event stream the tick loop emits.
// ---------------------------------------------------------------------------

describe("support kit (Mode 3) through the sim", () => {
	it("a support squadron repairs the owner's hull over the fight", () => {
		const support = makeSquadron("support", 6); // 6 drones * 1 = 6 hull/pulse
		const battle = {
			combatants: [
				makeCombatant({
					id: "P1",
					team: "player",
					hull: 50,
					hullMax: 100,
					drones: [support],
					weapons: [makeWeapon({ id: "pw", family: "ew", yieldMin: 1, yieldMax: 1 })],
				}),
				// A big, weaponless punching bag so the fight lasts many support pulses.
				makeCombatant({ id: "E1", team: "enemy", hull: 5000, hullMax: 5000, weapons: [] }),
			],
		};
		const { log } = resolveBattle(battle, 7, { generateLog: true });
		const pulses = log.filter((e) => e.type === "droneSupport");
		expect(pulses.length).toBeGreaterThan(0);
		// Hull climbed above the starting 50 via the repair pulses.
		const lastPulse = pulses[pulses.length - 1];
		expect(lastPulse.hullAfter!).toBeGreaterThan(50);
	});

	it("a support squadron cleanses a disruption on the owner", () => {
		const support = makeSquadron("support", 6);
		const battle = {
			combatants: [
				makeCombatant({
					id: "P1",
					team: "player",
					hull: 100,
					hullMax: 100,
					drones: [support],
					weapons: [makeWeapon({ id: "pw", family: "ew", yieldMin: 1, yieldMax: 1 })],
					// A long-lived disruption the support kit should eventually strip.
					statusEffects: [
						{ defId: "scatteringField", rank: 1, remainingDeciSec: 5000, dotBank: 0 },
					],
				}),
				makeCombatant({ id: "E1", team: "enemy", hull: 5000, hullMax: 5000, weapons: [] }),
			],
		};
		const { log } = resolveBattle(battle, 3, { generateLog: true });
		expect(log.some((e) => e.type === "droneCleanse" && e.effectDefId === "scatteringField")).toBe(
			true,
		);
	});
});

describe("in-combat replenishment through the sim", () => {
	function battleWith(pct: number | undefined) {
		// P1 fields a defense squadron with ONE pre-destroyed drone; a high replenish
		// rate + a long fight means the in-combat module (when present) rebuilds it.
		const squad = makeSquadron("defense", 2);
		squad.drones[0].alive = false;
		squad.drones[0].status = "refabricating";
		squad.drones[0].refabProgress = 0;
		squad.droneReplenishRate = 200; // fast, so a rebuild lands within the fight
		return {
			combatants: [
				makeCombatant({
					id: "P1",
					team: "player",
					hull: 100,
					hullMax: 100,
					drones: [squad],
					inCombatReplenishPercent: pct,
					weapons: [makeWeapon({ id: "pw", family: "ew", yieldMin: 1, yieldMax: 1 })],
				}),
				makeCombatant({ id: "E1", team: "enemy", hull: 5000, hullMax: 5000, weapons: [] }),
			],
		};
	}

	it("rebuilds a destroyed drone DURING the fight when the module grants it", () => {
		const { log } = resolveBattle(battleWith(100), 5, { generateLog: true });
		expect(log.some((e) => e.type === "droneReplenish")).toBe(true);
	});

	it("does NOT rebuild in combat without the module (parity-safe default)", () => {
		const { log } = resolveBattle(battleWith(undefined), 5, { generateLog: true });
		expect(log.some((e) => e.type === "droneReplenish")).toBe(false);
	});
});

describe("empty-drones parity guard", () => {
	it("a droneless battle emits no drone-defense events and stays deterministic", () => {
		const build = () => ({
			combatants: [
				makeCombatant({
					id: "P1",
					team: "player",
					hull: 120,
					weapons: [makeWeapon({ id: "pw", family: "kinetic", yieldMin: 8, yieldMax: 8 })],
				}),
				makeCombatant({
					id: "E1",
					team: "enemy",
					hull: 120,
					weapons: [makeWeapon({ id: "ew1", family: "kinetic", yieldMin: 8, yieldMax: 8 })],
				}),
			],
		});
		const a = resolveBattle(build(), 999, { generateLog: true });
		const b = resolveBattle(build(), 999, { generateLog: true });
		expect(a).toEqual(b); // deterministic
		// None of the Phase 7b defensive event types appear without a screen.
		const droneTypes = new Set([
			"droneIntercept",
			"droneReflect",
			"droneCounter",
			"droneSupport",
			"droneCleanse",
			"droneReplenish",
		]);
		expect(a.log.some((e) => droneTypes.has(e.type))).toBe(false);
	});
});
