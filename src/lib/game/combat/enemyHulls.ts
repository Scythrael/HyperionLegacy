// ============================================================================
// combat/enemyHulls.ts -- the pirate ENEMY hull roster as DATA (Combat 0.13.0,
// Phase 9b sub-phase 4)
//
// WHY ITS OWN MODULE, AND WHY NOT IN model.ts:
// Patrols fight waves of NAMED-PIRATE-FACTION enemies. Those enemies need a small
// hull table of their own: hull/shield stats, default guns, any drone squadrons,
// and a stance. Unlike FACTIONS (id/name/flavor, which is combat-agnostic and so
// lives in model.ts), these records reference the COMBAT module's own vocabulary
// (WeaponId, DroneRole, CombatStance). Keeping them here means model.ts never has
// to import combat internals, and the combat directory owns the one board a
// balance pass tunes (Omega 9: rule-based, readable without the sim).
//
// WHY NOT IN SHIP_TYPES:
// These are NOT player-buildable ships. They have no buildRecipe / cost / economy
// fields, so folding them into SHIP_TYPES (which every builder / researcher / UI
// reads) would pollute that table with entries the economy must special-case out.
// A pirate hull is combat CONTENT, not an economy hull, so it lives in combat/.
//
// HOW THESE FEED THE SIM:
// The enemy-wave generator (enemyWave.ts) reads a hull's stats to build the
// CombatShipStats a Combatant needs (via bridge.ts shipToCombatant), and reads
// its `weapons` / `droneRoles` lists to MINT FRESH weapon + squadron instances
// per enemy (never a shared mutable template, the per-battle deep clone the sim
// requires). This table stays pure DATA: no factory, no draws, no logic here.
//
// UNITS (mirroring types.ts): hull / shield are bounded integers; shieldRecharge
// is points-per-second. No float ever enters a hull stat.
//
// ⚠️ EVERY NUMBER HERE IS FIRST-PASS AND TUNABLE. They are chosen so all three
// hulls are individually BEATABLE by an entry destroyer flying its default
// loadout (autocannon + plasma; hull 600 / shield 300 / recharge 10), which makes
// early pirates weaker than the player's warships. A future TI-TX difficulty tier
// will SCALE these up (that scaling knob lives on the generator's params, not
// here). The per-hull INTENT COMMENT is the durable contract; the exact integers
// will move in the balance pass (design S20).
// ============================================================================

import type { WeaponId } from "./weapons";
import type { DroneRole } from "./drones";
import type { CombatStance } from "./positioning";

// The stable id union for the v1 pirate roster, so any code referencing a pirate
// hull by id gets a compile error on a typo rather than a runtime miss (same
// discipline WeaponId / ShipTypeKey use).
export type PirateHullId = "raider" | "marauder" | "corsairCarrier";

// One pirate hull as a plain stat line + loadout intent. Stored as WeaponId /
// DroneRole LISTS (not pre-built instances) on purpose: the generator mints a
// FRESH weapon / squadron per enemy at build time, so this record is an immutable
// template that is never mutated by the sim.
export interface PirateHull {
	// Stable identifier. The map key MUST equal this id (drift guard, asserted in
	// the shape test, mirroring FACTIONS / BLUEPRINTS).
	id: PirateHullId;
	// Player-facing display name (shown in the combat log / patrol readout).
	name: string;

	// -- Combat stat line (the three fields bridge.ts's CombatShipStats reads). --
	// Structural HP pool. Full at battle start.
	hullIntegrity: number;
	// Deflector absorb pool. Full at battle start.
	shieldCapacity: number;
	// Shield points regenerated per second.
	shieldRecharge: number;

	// -- Loadout intent (turned into fresh instances by the generator). --
	// The default guns this hull fires, chosen from the v1 weapon roster
	// (weapons.ts). Non-empty by contract (every combat hull can shoot); the shape
	// test guards this.
	weapons: WeaponId[];
	// The drone squadrons this hull fields, one role per built-in bay. EMPTY for
	// most hulls; the carrier is the reason enemies "may bring drones", so the
	// player's anti-drone weapons (Point-Defense / EMP) have something to shoot.
	droneRoles: DroneRole[];
	// The posture the hull fights in (design S6): aggressive closes to Short,
	// balanced holds Medium, standoff hangs at Long. Derived-from-loadout intent,
	// hardcoded per hull here rather than computed.
	stance: CombatStance;
}

// ---------------------------------------------------------------------------
// THE ROSTER, keyed by id (map-key-equals-id, so a lookup is a direct
// PIRATE_HULLS[id] read, mirroring FACTIONS / BLUEPRINTS / WEAPON_DEFS). Three
// hulls to start; add an entry here (and grow PirateHullId) when a new pirate
// hull is authored, never repurpose an existing id.
// ---------------------------------------------------------------------------
export const PIRATE_HULLS: Record<PirateHullId, PirateHull> = {
	// RAIDER: the cannon-fodder pirate. Light + fast, LOW hull/shield, a single
	// FAST gun (the Autocannon workhorse), no drones, aggressive (it closes to
	// Short range and brawls). Meant to die quickly to an entry destroyer and to
	// swarm in numbers rather than threaten one-on-one.
	raider: {
		id: "raider",
		name: "Raider",
		hullIntegrity: 120,
		shieldCapacity: 40,
		shieldRecharge: 3,
		weapons: ["autocannon"],
		droneRoles: [],
		stance: "aggressive",
	},

	// MARAUDER: the medium line pirate. More hull + shield than a raider, TWO guns
	// mixing a fast workhorse (Autocannon) with a HEAVIER hitter (Railgun, high
	// yield + armor-pen) so it actually threatens the player's hull, no drones,
	// balanced (fights at Medium). The step-up enemy: still beatable one-on-one by
	// a destroyer, dangerous in a pair.
	marauder: {
		id: "marauder",
		name: "Marauder",
		hullIntegrity: 260,
		shieldCapacity: 120,
		shieldRecharge: 5,
		weapons: ["autocannon", "railgun"],
		droneRoles: [],
		stance: "balanced",
	},

	// CORSAIR CARRIER: the drone tender. The toughest of the three but with only a
	// MODEST direct gun (a single Plasma chipper); its real offense is a fielded
	// Attack drone squadron. It is the reason enemies bring drones, so the player's
	// anti-drone weapons matter. Standoff (hangs at Long and lets the drones do the
	// work). Still tuned to be beatable by an entry destroyer.
	corsairCarrier: {
		id: "corsairCarrier",
		name: "Corsair Carrier",
		hullIntegrity: 320,
		shieldCapacity: 160,
		shieldRecharge: 6,
		weapons: ["plasma"],
		droneRoles: ["attack"],
		stance: "standoff",
	},
};
