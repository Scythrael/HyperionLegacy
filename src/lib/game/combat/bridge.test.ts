// ============================================================================
// combat/bridge.test.ts -- the game-ship => Combatant bridge (Combat 0.13.0)
//
// Guards the STAT MAP (hull/shield from a ship's combat stats), the per-instance
// independence of sampleLoadout (no shared mutable state between weapon copies),
// and the end-to-end invariant that a bridged Combatant is valid input to
// resolveBattle (a real battle runs to a terminating outcome).
// ============================================================================

import { describe, it, expect } from "vitest";
import {
	shipToCombatant,
	sampleLoadout,
	COMBAT_DEFAULT_LOADOUT,
	weaponInstanceFromGear,
	frameHp,
	type CombatShipStats,
	type CombatHullType,
} from "./bridge";
import { resolveBattle } from "./resolveBattle";
import { engagementForecast } from "./rating";
import { makeWeaponInstance } from "./weapons";
import {
	SHIP_TYPES,
	seedCombatStandardIssueForShip,
	generateCombatStandardIssue,
	type CombatStandardIssueSpec,
	type EquipmentInstance,
} from "../model";

// A representative real hull so the map test rides on live SHIP_TYPES data (if a
// hull's combat stats change, this test still reads them from the source).
const FREIGHTER = SHIP_TYPES.generalFreighter;

describe("shipToCombatant stat map", () => {
	it("maps hull + shield from a ship's SHIP_TYPES combat stats", () => {
		const c = shipToCombatant({
			id: "player-ship",
			team: "player",
			stats: FREIGHTER,
			weaponLoadout: sampleLoadout(),
		});
		// Hull <- hullIntegrity (full at battle start).
		expect(c.hull).toBe(FREIGHTER.hullIntegrity);
		expect(c.hullMax).toBe(FREIGHTER.hullIntegrity);
		// Shield <- shieldCapacity (full at battle start).
		expect(c.shield).toBe(FREIGHTER.shieldCapacity);
		expect(c.shieldMax).toBe(FREIGHTER.shieldCapacity);
		// shieldRecharge passes straight through.
		expect(c.shieldRecharge).toBe(FREIGHTER.shieldRecharge);
		// Identity + weapons.
		expect(c.id).toBe("player-ship");
		expect(c.team).toBe("player");
		expect(c.weapons.length).toBe(3);
	});

	it("defaults the not-yet-modeled combat stats to neutral values", () => {
		const c = shipToCombatant({
			id: "x",
			team: "enemy",
			stats: FREIGHTER,
			weaponLoadout: [],
		});
		// TODO-default fields (no ship stat exists for these yet).
		expect(c.shieldCoherence).toBe(0);
		expect(c.ablativeArmor).toBe(0);
		expect(c.kineticDampening).toBe(0);
		expect(c.evasion).toBe(0);
		expect(c.damageResist).toEqual({ kinetic: 0, particle: 0, ew: 0 });
		expect(c.disruptionResist).toEqual({ kinetic: 0, particle: 0, ew: 0 });
		// Reserved-empty + liveness.
		expect(c.statusEffects).toEqual([]);
		expect(c.drones).toEqual([]);
		expect(c.alive).toBe(true);
	});

	it("accepts a hardcoded hull literal (structural CombatShipStats) for enemies", () => {
		// Proves the Pick-typed input lets a non-SHIP_TYPES literal through.
		const pirate: CombatShipStats = {
			hullIntegrity: 220,
			shieldCapacity: 120,
			shieldRecharge: 6,
		};
		const c = shipToCombatant({
			id: "pirate",
			team: "enemy",
			stats: pirate,
			weaponLoadout: [],
		});
		expect(c.hull).toBe(220);
		expect(c.shield).toBe(120);
	});

	it("honors explicit position + speed overrides", () => {
		const c = shipToCombatant({
			id: "x",
			team: "player",
			stats: FREIGHTER,
			weaponLoadout: [],
			position: 150,
			speed: 42,
		});
		expect(c.position).toBe(150);
		expect(c.speed).toBe(42);
	});
});

describe("sampleLoadout", () => {
	it("returns three weapons spanning all three families", () => {
		const loadout = sampleLoadout();
		expect(loadout.length).toBe(3);
		const families = loadout.map((w) => w.family).sort();
		expect(families).toEqual(["ew", "kinetic", "particle"]);
	});

	it("returns independent instances (mutating one does not affect another)", () => {
		const a = sampleLoadout("a");
		const b = sampleLoadout("b");
		// Mutate a per-battle field on one instance.
		a[0].cooldownAccumulator = 999;
		// The sibling instance from a different call is untouched.
		expect(b[0].cooldownAccumulator).toBe(0);
		// And instances within one loadout do not alias each other's effect-slot array.
		a[0].effectSlots.push({ defId: "junk", procChance: 1, escalationChance: 1 });
		expect(a[1].effectSlots).not.toBe(a[0].effectSlots);
	});

	it("gives each weapon a unique id (no turn-order key collision)", () => {
		const ids = sampleLoadout().map((w) => w.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

// ---------------------------------------------------------------------------
// COMBAT HULLS + DEFAULT LOADOUTS (Combat 0.13.0, Phase 9a). A combat hull passed
// via `hullType` (no explicit weaponLoadout) flies its COMBAT_DEFAULT_LOADOUT: real
// weapons from the roster, and (carrier) a real drone squadron. The produced
// Combatant reads its hull/shield from SHIP_TYPES and runs a real battle.
// ---------------------------------------------------------------------------
describe("combat hull default loadouts", () => {
	// Build a bridged combatant from a real combat hull using its default loadout.
	function bridgeHull(hullType: CombatHullType, id: string = hullType) {
		return shipToCombatant({
			id,
			team: "player",
			stats: SHIP_TYPES[hullType],
			hullType,
		});
	}

	it("destroyer flies its 2 fast default weapons with hull/shield from SHIP_TYPES", () => {
		const c = bridgeHull("destroyer");
		const def = SHIP_TYPES.destroyer;
		expect(c.hull).toBe(def.hullIntegrity);
		expect(c.hullMax).toBe(def.hullIntegrity);
		expect(c.shield).toBe(def.shieldCapacity);
		expect(c.shieldRecharge).toBe(def.shieldRecharge);
		// 2 weapons from the default loadout, no drones.
		expect(c.weapons.length).toBe(COMBAT_DEFAULT_LOADOUT.destroyer.weapons.length);
		expect(c.weapons.length).toBe(2);
		expect(c.drones).toEqual([]);
		// Weapon instances are fresh (unique, combatant-scoped ids; own effect arrays).
		expect(new Set(c.weapons.map((w) => w.id)).size).toBe(c.weapons.length);
	});

	it("battleship flies its 3 heavy default weapons and out-hulls the destroyer", () => {
		const c = bridgeHull("battleship");
		const def = SHIP_TYPES.battleship;
		expect(c.hull).toBe(def.hullIntegrity);
		expect(c.weapons.length).toBe(3);
		expect(c.drones).toEqual([]);
		// The tank really is tankier than the striker (sanity that profiles differ).
		expect(c.hull).toBeGreaterThan(SHIP_TYPES.destroyer.hullIntegrity);
	});

	it("carrier flies 1 weapon + a default Attack drone squadron", () => {
		const c = bridgeHull("carrier");
		expect(c.weapons.length).toBe(1);
		// The carrier's real offense is the drones: one Attack squadron by default.
		expect(c.drones.length).toBe(1);
		expect(c.drones[0].role).toBe("attack");
		// A real squadron with drones in it (makeSquadron built a full attack wing).
		expect(c.drones[0].drones.length).toBeGreaterThan(0);
	});

	it("an explicit weaponLoadout overrides the hull default", () => {
		// Passing weapons explicitly must WIN over the hullType default (tests/dev path).
		const c = shipToCombatant({
			id: "override",
			team: "player",
			stats: SHIP_TYPES.battleship,
			hullType: "battleship",
			weaponLoadout: sampleLoadout("ov"),
		});
		expect(c.weapons.length).toBe(3); // sampleLoadout's 3, not necessarily the default's
		expect(c.weapons.map((w) => w.family).sort()).toEqual(["ew", "kinetic", "particle"]);
	});

	it("each combat hull produces a Combatant that resolves a real battle", () => {
		// Every class must be valid resolveBattle input end to end (design S19).
		for (const hullType of ["destroyer", "battleship", "carrier"] as CombatHullType[]) {
			const player = bridgeHull(hullType, `${hullType}-p`);
			const enemy = shipToCombatant({
				id: `${hullType}-e`,
				team: "enemy",
				stats: { hullIntegrity: 200, shieldCapacity: 100, shieldRecharge: 4 },
				weaponLoadout: sampleLoadout(`${hullType}-e`),
			});
			const { outcome } = resolveBattle({ combatants: [player, enemy] }, 4242, {
				generateLog: false,
			});
			expect(["player", "enemy", "draw"]).toContain(outcome.winner);
			expect(outcome.rounds).toBeGreaterThan(0);
		}
	});
});

// ---------------------------------------------------------------------------
// FORECAST SANITY (design S11 Engagement Forecast). Loose bands only: these guard
// that the hull PROFILES differ meaningfully (a mirror match is ~even; a battleship
// favored over a destroyer), NOT exact balance (that is the S20 tuning pass).
// ---------------------------------------------------------------------------
describe("combat hull forecast sanity", () => {
	// Two independently-built combatants of the given hull, opposing teams.
	function duel(playerHull: CombatHullType, enemyHull: CombatHullType) {
		const player = shipToCombatant({
			id: "p",
			team: "player",
			stats: SHIP_TYPES[playerHull],
			hullType: playerHull,
		});
		const enemy = shipToCombatant({
			id: "e",
			team: "enemy",
			stats: SHIP_TYPES[enemyHull],
			hullType: enemyHull,
		});
		return engagementForecast(player, enemy, { samples: 64, baseSeed: 1 });
	}

	it("a destroyer mirror match is roughly even (~50%)", () => {
		const f = duel("destroyer", "destroyer");
		// LOOSE band: identical profiles, so neither side should dominate. Turn-order /
		// opener effects can nudge it off exactly 50, hence the wide window.
		expect(f.winPercent).toBeGreaterThanOrEqual(25);
		expect(f.winPercent).toBeLessThanOrEqual(75);
	});

	it("a battleship beats a destroyer more often than not", () => {
		const f = duel("battleship", "destroyer");
		// The tank (more hull, more shields, 3 heavy guns) should be favored. Loose:
		// just "more often than not", not a specific number.
		expect(f.winPercent).toBeGreaterThan(50);
	});
});

describe("bridged Combatant is valid resolveBattle input", () => {
	it("runs a real battle to a terminating outcome", () => {
		const player = shipToCombatant({
			id: "player",
			team: "player",
			stats: SHIP_TYPES.prospectorRunner,
			weaponLoadout: sampleLoadout("p"),
		});
		const enemy = shipToCombatant({
			id: "enemy",
			team: "enemy",
			stats: { hullIntegrity: 120, shieldCapacity: 60, shieldRecharge: 3 },
			weaponLoadout: sampleLoadout("e"),
		});
		const { outcome, log } = resolveBattle(
			{ combatants: [player, enemy] },
			12345,
			{ generateLog: true },
		);
		// It terminated with a valid winner + a positive round count.
		expect(["player", "enemy", "draw"]).toContain(outcome.winner);
		expect(outcome.rounds).toBeGreaterThan(0);
		// The log was generated (at least one event).
		expect(log.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// Combat 1.0 Unit 1.4: the gear FOLD. The load-bearing invariant is BEHAVIOUR
// PRESERVATION: a Standard-Issue-geared combat hull must produce a combatant
// byte-identical to the pre-1.4 hull-default combatant, so combat outcomes do not
// move and the parity fixtures need no re-baseline. These tests are the proof.
// ---------------------------------------------------------------------------

// Build a hull's behaviour-preserving Standard-Issue combat spec EXACTLY as the tick.ts caller does
// (full default loadout + the hull's shield stats + plating = hullIntegrity - frameHp). Kept local so
// the bridge tests exercise the real caller contract without importing tick.ts (a combat leaf must
// never import UP into the live loop).
function combatSpecFor(hull: CombatHullType): CombatStandardIssueSpec {
	const def = SHIP_TYPES[hull];
	return {
		signatureWeapons: [...COMBAT_DEFAULT_LOADOUT[hull].weapons],
		shieldCapacity: def.shieldCapacity,
		shieldRecharge: def.shieldRecharge,
		hullStrength: def.hullIntegrity - frameHp(def.hullIntegrity),
	};
}

// The Standard-Issue combat gear a fresh combat hull is born with (Unit 1.3/1.4 seeder output),
// filtered to the pieces fitted to `shipId` (all of them, here).
function standardIssueGear(hull: CombatHullType, shipId: string): EquipmentInstance[] {
	return seedCombatStandardIssueForShip(shipId, combatSpecFor(hull), 1).pieces;
}

describe("weaponInstanceFromGear (Unit 1.4 weapon reconstruction)", () => {
	it("reconstructs a Standard-Issue weapon BYTE-IDENTICALLY to makeWeaponInstance", () => {
		// A Standard-Issue weapon (weaponYield 0, quality 0, durability == durabilityMax == base) must
		// fold back to the exact template instance, so a Standard-Issue loadout fights unchanged.
		for (const weaponType of ["autocannon", "plasma", "railgun", "concussionTorpedo", "voltaic", "pointDefenseArray"] as const) {
			const piece = generateCombatStandardIssue({
				slotType: "weapon",
				weaponType,
				fittedToShipId: "ship-1",
				allocateId: () => "equip-1",
			});
			const reconstructed = weaponInstanceFromGear(piece, `player-w0-${weaponType}`);
			const template = makeWeaponInstance(weaponType, `player-w0-${weaponType}`);
			expect(reconstructed).toEqual(template);
		}
	});

	it("applies rolled weaponYield (flat, both bounds) + weaponAccuracy on top of the base def", () => {
		const base = makeWeaponInstance("plasma");
		const piece = generateCombatStandardIssue({
			slotType: "weapon",
			weaponType: "plasma",
			fittedToShipId: null,
			allocateId: () => "equip-1",
		});
		// Simulate a crafted roll: +5 yield (implicit or affix) and +4 accuracy.
		piece.rolledStats = { weaponYield: 5, weaponAccuracy: 4 };
		piece.quality = 3;
		const w = weaponInstanceFromGear(piece, "w");
		expect(w.yieldMin).toBe(base.yieldMin + 5);
		expect(w.yieldMax).toBe(base.yieldMax + 5);
		expect(w.accuracy).toBe(base.accuracy + 4);
		expect(w.quality).toBe(3);
		// Non-rolled identity fields still come straight from the base def.
		expect(w.family).toBe(base.family);
		expect(w.range).toBe(base.range);
		expect(w.effectSlots).toEqual(base.effectSlots);
	});

	it("throws on a weapon piece with no weaponType (a malformed piece)", () => {
		const piece = generateCombatStandardIssue({
			slotType: "weapon",
			weaponType: "autocannon",
			fittedToShipId: null,
			allocateId: () => "equip-1",
		});
		delete piece.weaponType;
		expect(() => weaponInstanceFromGear(piece, "w")).toThrow();
	});
});

describe("shipToCombatant gear fold: Standard-Issue is BEHAVIOUR-PRESERVING", () => {
	it.each(["destroyer", "battleship", "carrier"] as const)(
		"a Standard-Issue-geared %s produces a combatant BYTE-IDENTICAL to the hull-default combatant",
		(hull) => {
			const stats = SHIP_TYPES[hull];
			const gear = standardIssueGear(hull, "player-ship");
			// PRESENT path: the ship's Standard-Issue combat set drives every stat.
			const geared = shipToCombatant({ id: "player-ship", team: "player", stats, hullType: hull, installedGear: gear });
			// ABSENT path: the pre-1.4 hull-default build.
			const hullDefault = shipToCombatant({ id: "player-ship", team: "player", stats, hullType: hull });
			// The WHOLE combatant is byte-identical: hull/shield pools, defensive stats, weapons (ids +
			// stats), drones, systems. If ANY field diverged, an outcome could move and the parity
			// fixtures would need a re-baseline (they must not).
			expect(geared).toEqual(hullDefault);
		},
	);

	it("folds each defensive stat off the Standard-Issue gear (spot-check the destroyer)", () => {
		const stats = SHIP_TYPES.destroyer;
		const gear = standardIssueGear("destroyer", "player-ship");
		const c = shipToCombatant({ id: "player-ship", team: "player", stats, hullType: "destroyer", installedGear: gear });
		// Hull = frame + plating.hullStrength == the hull's total integrity (the frame split cancels).
		expect(c.hull).toBe(stats.hullIntegrity);
		expect(c.hullMax).toBe(stats.hullIntegrity);
		// Shield pool + recharge come from the emitter, equal to the hull's stats for Standard-Issue.
		expect(c.shieldMax).toBe(stats.shieldCapacity);
		expect(c.shieldRecharge).toBe(stats.shieldRecharge);
		// One CombatWeapon per installed weapon piece, in the hull's default loadout order.
		expect(c.weapons.map((w) => w.weaponType)).toEqual([...COMBAT_DEFAULT_LOADOUT.destroyer.weapons]);
		// Standard-Issue rolls no defensive affixes, so mitigation is all zero (the regression default).
		expect(c.shieldCoherence).toBe(0);
		expect(c.ablativeArmor).toBe(0);
		expect(c.kineticDampening).toBe(0);
		expect(c.damageResist).toEqual({ kinetic: 0, particle: 0, ew: 0 });
		expect(c.disruptionResist).toEqual({ kinetic: 0, particle: 0, ew: 0 });
	});

	it("crafted gear (better than Standard-Issue) is pure upside: bigger pools + mitigation", () => {
		const stats = SHIP_TYPES.destroyer;
		const gear = standardIssueGear("destroyer", "player-ship");
		// Upgrade the emitter + plating with rolled affixes (a crafted piece), leaving weapons alone.
		const upgraded = gear.map((p) => {
			if (p.slotType === "shieldEmitters") {
				return { ...p, implicitStats: { ...p.implicitStats, shieldCapacity: (p.implicitStats.shieldCapacity ?? 0) + 100 }, rolledStats: { shieldCoherence: 15 } };
			}
			if (p.slotType === "hullPlating") {
				return { ...p, rolledStats: { ablativeArmor: 40, kineticDampening: 12 } };
			}
			return p;
		});
		const c = shipToCombatant({ id: "player-ship", team: "player", stats, hullType: "destroyer", installedGear: upgraded });
		expect(c.shieldMax).toBe(stats.shieldCapacity + 100); // implicit + the added capacity
		expect(c.shieldCoherence).toBe(15);
		expect(c.ablativeArmor).toBe(40);
		expect(c.kineticDampening).toBe(12);
		// Hull is unchanged (plating hullStrength implicit untouched): the affixes are additive upside.
		expect(c.hull).toBe(stats.hullIntegrity);
	});
});
