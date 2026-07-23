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
//      weapons.ts, not an EquipmentSlotType a ship mounts). Phase 9a added a middle
//      ground: a combat hull (destroyer/battleship/carrier) now flies a DERIVED
//      DEFAULT LOADOUT from COMBAT_DEFAULT_LOADOUT (precedent: 0.11.0 Standard-Issue),
//      so pass `hullType` and the bridge builds real weapons (and the carrier's drone
//      screen). A caller may still pass an explicit `weaponLoadout` to override (tests,
//      dev harness, hardcoded enemies). Deriving weapons from a ship's FITTED / crafted
//      weapon gear (replacing the hull defaults) is a LATER sub-phase, not this bridge.
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
import { makeSquadron, type DroneRole, type DroneSquadron } from "./drones";

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

// ---------------------------------------------------------------------------
// COMBAT DEFAULT LOADOUTS (design S19 "all 3 hull classes are v1 feature-complete";
// precedent: the 0.11.0 "Standard-Issue" default equipment every ship flies with).
//
// The DERIVED default loadout a freshly-built combat hull flies with, before the
// player fits crafted weapons / drone pods (that fitment is a LATER sub-phase, see
// the SEAM note on shipToCombatant). This is CONTENT, not logic: a data table the
// bridge reads, so tuning a hull's out-of-the-box kit is a one-line edit here
// (Omega 9: readable as rule-based data). ⚠️ EVERY CHOICE IS FIRST-PASS + TUNABLE
// (design S20 owns the balance pass); the per-hull COMMENT is the durable intent.
//
// The three combat hull classes (a subset of ShipTypeKey, model.ts). Named on its
// own so the loadout map + the bridge's hullType arg are keyed exactly to the
// hulls that HAVE a combat default, not every economy hull.
export type CombatHullType = "destroyer" | "battleship" | "carrier";

// One hull's default kit. Stored as ROLE / ID lists (not pre-built instances) so
// the bridge mints a FRESH weapon/squadron per combatant at build time (never a
// shared mutable template): makeWeaponInstance + makeSquadron each return a fully
// independent instance, which is the per-battle deep-clone the sim requires.
export interface CombatDefaultLoadout {
	// The default weapons, chosen from the v1 roster (weapons.ts) UP TO the hull's
	// weaponHardpoints (model.ts). A subset is intentional: the remaining hardpoints
	// are open for fitted/crafted weapons in the later fitment sub-phase.
	weapons: WeaponId[];
	// The default drone squadrons, one per built-in bay (carrier only; design S8).
	// Each entry is a role the bridge feeds to makeSquadron. Empty for non-carriers.
	droneRoles: DroneRole[];
	// The carrier's BUILT-IN hangar bay count (design S8: carriers get ~2 built-in
	// bays plus more from the hangar SYSTEM). Lives here for now because the ship
	// model has no hangar-bay field yet; the hangar-gear system (Phase 9/12) is its
	// real home. 0 for non-carriers. droneRoles.length may be < builtInBays (some
	// bays start empty, filled by fitted pods later).
	builtInBays: number;
}

export const COMBAT_DEFAULT_LOADOUT: Record<CombatHullType, CombatDefaultLoadout> = {
	// DESTROYER: a fast striker. 2 FAST weapons (a low-cooldown kinetic workhorse +
	// a particle chipper that bleeds hull through shields), leaving its remaining
	// hardpoints (4 total) open for fitment. No drones.
	destroyer: {
		weapons: ["autocannon", "plasma"],
		droneRoles: [],
		builtInBays: 0,
	},
	// BATTLESHIP: the gun wall. 3 HEAVY weapons (a precision railgun, a heavy
	// warhead torpedo, and an anti-shield Voltaic to strip screens for the kinetics),
	// on a 6-hardpoint hull (3 open for fitment). No drones.
	battleship: {
		weapons: ["railgun", "concussionTorpedo", "voltaic"],
		droneRoles: [],
		builtInBays: 0,
	},
	// CARRIER: the drone platform. 1 weapon only (a Point-Defense screen weapon, all
	// its 2 reduced hardpoints could hold, one left open for fitment) PLUS an Attack
	// squadron in a built-in bay: its real offense is the drones. builtInBays 2 (design
	// S8) documents the carrier's built-in capacity; the second bay starts empty
	// (filled by a fitted pod later).
	carrier: {
		weapons: ["pointDefenseArray"],
		droneRoles: ["attack"],
		builtInBays: 2,
	},
};

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
	// The weapons this ship fires. OPTIONAL. Two ways to populate a combatant's guns:
	//   1. Pass an EXPLICIT weaponLoadout (tests / the dev harness / a hardcoded enemy).
	//      Each element must already be a fresh per-battle instance (sampleLoadout /
	//      makeWeaponInstance guarantee this). An explicit loadout always WINS.
	//   2. Omit it and pass `hullType` (a real combat hull): the bridge derives the
	//      default loadout from COMBAT_DEFAULT_LOADOUT and mints fresh weapon instances.
	// If BOTH are omitted the combatant flies unarmed (weapons: []), the pre-9a default.
	weaponLoadout?: CombatWeapon[];
	// The combat hull class this ship is (destroyer / battleship / carrier). When set
	// AND no explicit weaponLoadout is given, the bridge builds the weapons from
	// COMBAT_DEFAULT_LOADOUT[hullType]; when set AND no explicit `drones` is given, it
	// also builds that hull's default drone squadrons (the carrier's Attack screen).
	// Omit for a non-combat hull or when supplying weapons/drones explicitly.
	hullType?: CombatHullType;
	// Explicit drone squadrons override (rare). When omitted, drones come from the
	// hullType default (carrier) or are empty. Each element must be a fresh per-battle
	// squadron (makeSquadron guarantees this).
	drones?: DroneSquadron[];
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
//   weapons            <- args.weaponLoadout, ELSE COMBAT_DEFAULT_LOADOUT[hullType]
//   drones             <- args.drones,        ELSE COMBAT_DEFAULT_LOADOUT[hullType]
//
// LOADOUT RESOLUTION (design S19): an explicit weaponLoadout / drones ALWAYS wins
// (tests, dev harness, hardcoded enemies). Otherwise, if hullType names a real
// combat hull, the default loadout is derived from COMBAT_DEFAULT_LOADOUT and each
// weapon / squadron is minted FRESH (a per-battle deep clone, so the sim's
// per-instance mutation never leaks into the shared content templates). With
// neither supplied, the combatant is unarmed + drone-less (the pre-9a default).
// ⚠️ SEAM: fitted / crafted weapons + drone pods REPLACING these hull defaults is a
// later sub-phase (the ship model has no fitted-weapon / hangar-pod field yet).
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
	const { id, team, stats } = args;

	// Resolve the default loadout (if any) once: only when a real combat hull type
	// is supplied. Undefined for economy hulls / hardcoded enemies (they must pass
	// weapons explicitly or fly unarmed).
	const defaults = args.hullType ? COMBAT_DEFAULT_LOADOUT[args.hullType] : undefined;

	// WEAPONS: an explicit loadout wins; otherwise mint fresh instances from the hull
	// default; otherwise unarmed. Each instance id is suffixed with the combatant id +
	// slot index so two ships (or two copies of one weapon) never collide on the
	// id turn-order key (design S1 deterministic ordering).
	const weapons: CombatWeapon[] =
		args.weaponLoadout ??
		(defaults
			? defaults.weapons.map((weaponId, index) =>
					makeWeaponInstance(weaponId, `${id}-w${index}-${weaponId}`),
				)
			: []);

	// DRONES: an explicit squadron list wins; otherwise build the hull default's
	// squadrons fresh (makeSquadron mints independent drone instances, the per-battle
	// deep clone); otherwise none. idPrefix is combatant-scoped so two carriers never
	// share a squadron id. Tier 0 (base) for now; hangar-tier scaling is Phase 9/12.
	const drones: DroneSquadron[] =
		args.drones ??
		(defaults
			? defaults.droneRoles.map((role, index) =>
					makeSquadron(role, undefined, 0, `${id}-${role}${index}`),
				)
			: []);

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

		// Weapons: explicit loadout, or the hull default (resolved above).
		weapons,

		// A fresh combatant is alive; the sim flips this the tick hull hits <= 0.
		alive: true,

		// Status effects start empty. Drones: explicit override, the carrier hull
		// default (resolved above), or empty for a drone-less hull.
		statusEffects: [],
		drones,

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
