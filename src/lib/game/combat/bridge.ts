// ============================================================================
// combat/bridge.ts -- the game-ship => Combatant bridge (Combat 0.13.0)
//
// The combat sim (resolveBattle) speaks the Combatant shape (types.ts); the game
// speaks ShipInstance + SHIP_TYPES (model.ts). This module is the SEAM that folds
// a game ship's combat-relevant stats into a sim Combatant so a real battle can
// be driven from real game data. It is DELIBERATELY THIN and PURE: it only reads
// stats and constructs a fresh Combatant, it never touches GameState, the save,
// or the sim's internals.
//
// ⚠️ INTEGRATION SCOPE. Two things the game does NOT have yet are stubbed with
// clearly-labelled defaults here, to be replaced in the mission-integration phase:
//
//   1. FITTED WEAPONS. Ships carry equipment (cargo/ftl/reactor/spec-utility) but
//      NOT weapons as fitted gear yet (weapons are the 0.13.0 combat roster in
//      weapons.ts, not an EquipmentSlotType a ship mounts). So this bridge does
//      NOT derive weapons from the ship: the CALLER supplies a weaponLoadout
//      (see sampleLoadout below for an illustrative one). Real fitted-weapon
//      wiring (map a ship's mounted weapon gear -> CombatWeapon[]) is the
//      mission-integration phase, NOT this bridge.
//
//   2. MOVEMENT / DEFENSE stats the ship model has no field for yet (evasion,
//      combat speed, armor, resists, shield coherence). These default to sensible
//      neutral values with a TODO each, so a Combatant is valid input to
//      resolveBattle today and the real stats layer in additively later without
//      reshaping this function.
// ============================================================================

import type { ShipTypeDef } from "../model";
import type { Combatant, CombatTeam, CombatWeapon, FamilyResist } from "./types";
import type { CombatStance } from "./positioning";
import { makeWeaponInstance, type WeaponId } from "./weapons";

// Default stance for a bridged ship (design S6): Balanced (fight at Medium range)
// until the mission layer sets a real per-dispatch stance (player-chosen) or the
// enemy generator derives one from the loadout (Phase 9). Named so the default is
// explicit + a single knob.
const DEFAULT_STANCE: CombatStance = "balanced";

// Default combat speed (position units per second) for a bridged ship until the
// ship model grows a real combat-maneuver stat (TODO integration). Non-zero so
// ships still close distance on the 1D axis; the exact value is a first-pass
// placeholder (the sim's range gate mostly makes it moot at position 0 vs 0).
const DEFAULT_COMBAT_SPEED = 10;

// The zero FamilyResist (no per-family damage/disruption resist). A fresh object
// per Combatant so two bridged ships never share a resist map by reference.
function zeroResist(): FamilyResist {
	return { kinetic: 0, particle: 0, ew: 0 };
}

// The combat-relevant slice of a ship's stats this bridge reads. A real SHIP_TYPES
// entry (ShipTypeDef) structurally satisfies this Pick, so callers pass
// `SHIP_TYPES[ship.typeKey]` directly; a hardcoded enemy hull can pass a plain
// literal of the same three fields. Narrowed to a Pick (not the whole ShipTypeDef)
// so the bridge is not coupled to the ~20 unrelated economy/build fields on a hull.
export type CombatShipStats = Pick<
	ShipTypeDef,
	"hullIntegrity" | "shieldCapacity" | "shieldRecharge"
>;

// Everything shipToCombatant needs to mint one Combatant. Kept as a named args
// object (not positional params) so later phases add inputs (real evasion, armor,
// resists) without churning call sites.
export interface ShipToCombatantArgs {
	// Unique id across BOTH teams for this battle (the sim's turn-order sort key).
	// Use the ShipInstance id for the player ship, a stable made-up id for enemies.
	id: string;
	// Which side this combatant fights for.
	team: CombatTeam;
	// The ship's combat stat source: a SHIP_TYPES entry or a hardcoded hull literal.
	stats: CombatShipStats;
	// The weapons this ship fires. CALLER-SUPPLIED because the game has no fitted-
	// weapon system yet (see the file header). Each element should already be a
	// fresh per-battle instance (sampleLoadout / makeWeaponInstance guarantee this).
	weaponLoadout: CombatWeapon[];
	// Starting position on the 1D distance axis. Defaults to 0. Pass different
	// values to open the fight at range.
	position?: number;
	// Combat speed (position units/sec). Defaults to DEFAULT_COMBAT_SPEED.
	speed?: number;
	// Combat stance (design S6). Defaults to Balanced. The mission layer sets the
	// player's chosen stance / the enemy's loadout-derived stance (Phase 9).
	stance?: CombatStance;
}

// ---------------------------------------------------------------------------
// shipToCombatant -- fold a game ship's combat stats into a sim Combatant.
//
// STAT MAP (the durable contract of this bridge):
//   hull, hullMax      <- stats.hullIntegrity   (the structural HP pool)
//   shield, shieldMax  <- stats.shieldCapacity  (the deflector absorb pool)
//   shieldRecharge     <- stats.shieldRecharge  (points regenerated per second)
//   weapons            <- args.weaponLoadout    (caller-supplied, see header)
//
// TODO-DEFAULTS (no ship field exists yet; integration phase replaces these):
//   shieldCoherence, ablativeArmor, kineticDampening, evasion  -> 0
//   damageResist, disruptionResist                             -> all-zero map
//   speed                                                      -> DEFAULT_COMBAT_SPEED
//
// Reserved-empty (forward-shaped, sim iterates them as no-ops today):
//   statusEffects: [], drones: []
//   alive: true (a fresh combatant is always alive at battle start)
// ---------------------------------------------------------------------------
export function shipToCombatant(args: ShipToCombatantArgs): Combatant {
	const { id, team, stats, weaponLoadout } = args;
	return {
		id,
		team,

		// Hull <- the hull's structural HP pool. Full at battle start.
		hull: stats.hullIntegrity,
		hullMax: stats.hullIntegrity,

		// Shield <- the deflector absorb pool. Full at battle start.
		shield: stats.shieldCapacity,
		shieldMax: stats.shieldCapacity,
		shieldRecharge: stats.shieldRecharge,

		// TODO(integration): no attenuation-resist stat on ships yet. Neutral 0.
		shieldCoherence: 0,

		// TODO(integration): no armor / dampening / evasion stats on ships yet.
		ablativeArmor: 0,
		kineticDampening: 0,
		evasion: 0,

		// TODO(integration): no per-family resist stats on ships yet. All-zero maps
		// (fresh objects, never shared) keep the ship at the regression default.
		damageResist: zeroResist(),
		disruptionResist: zeroResist(),

		// Movement on the 1D axis. Position defaults to 0 (co-located); speed to the
		// placeholder DEFAULT_COMBAT_SPEED (TODO integration: a real maneuver stat).
		position: args.position ?? 0,
		speed: args.speed ?? DEFAULT_COMBAT_SPEED,
		// Stance (design S6): Balanced by default; caller/mission layer overrides.
		stance: args.stance ?? DEFAULT_STANCE,

		// Caller-supplied weapons (the game has no fitted-weapon system yet).
		weapons: weaponLoadout,

		// A fresh combatant is alive; the sim flips this the tick hull hits <= 0.
		alive: true,

		// Reserved-empty forward-shaped arrays (the sim iterates them as no-ops).
		statusEffects: [],
		drones: [],

		// Counter-module effect flags (design S7): OFF by default. The module ITEMS
		// that grant these are Phase 9; a bridged ship carries none yet. TODO(Phase
		// 9): read these from the ship's fitted counter-modules.
		rapidChargeAfterAmbush: false,
		particleTraceDetector: 0,
	};
}

// ---------------------------------------------------------------------------
// sampleLoadout -- an illustrative 3-weapon loadout spanning all three families.
//
// ⚠️ THIS IS A DEV / TEST STAND-IN, NOT REAL FITMENT. The game does not yet mount
// weapons as fitted equipment, so this hands back a small, family-diverse loadout
// pulled from the v1 roster (weapons.ts) so a bridged ship can actually shoot in a
// test battle. Real fitted-weapon wiring (derive CombatWeapon[] from a ship's
// mounted weapon gear) is the mission-integration phase.
//
// Each weapon is a FRESH per-battle instance via makeWeaponInstance (own
// cooldownAccumulator + effect-slot array), so mutating one loadout never leaks
// into another or into the shared WEAPON_DEFS templates. Instance ids are suffixed
// so two ships (or two copies of a weapon) never collide on the id turn-order key.
// ---------------------------------------------------------------------------
export function sampleLoadout(idPrefix = "wpn"): CombatWeapon[] {
	// One weapon per family: a particle chipper (Plasma), a kinetic finisher
	// (Railgun), and an EW screen weapon (Point-Defense Array). Chosen to exercise
	// all three triangle columns + the attenuation / armor-pen signatures.
	const roster: WeaponId[] = ["plasma", "railgun", "pointDefenseArray"];
	return roster.map((weaponId, index) =>
		makeWeaponInstance(weaponId, `${idPrefix}-${index}-${weaponId}`),
	);
}
