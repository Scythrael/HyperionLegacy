// ============================================================================
// combat/bridge.test.ts -- the game-ship => Combatant bridge (Combat 0.13.0)
//
// Guards the STAT MAP (hull/shield from a ship's combat stats), the per-instance
// independence of sampleLoadout (no shared mutable state between weapon copies),
// and the end-to-end invariant that a bridged Combatant is valid input to
// resolveBattle (a real battle runs to a terminating outcome).
// ============================================================================

import { describe, it, expect } from "vitest";
import { shipToCombatant, sampleLoadout, type CombatShipStats } from "./bridge";
import { resolveBattle } from "./resolveBattle";
import { SHIP_TYPES } from "../model";

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
