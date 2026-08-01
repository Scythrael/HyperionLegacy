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

import type { ShipTypeDef, PatrolSystemDurability, EquipmentInstance } from "../model";
import type { Combatant, CombatTeam, CombatWeapon, FamilyResist } from "./types";
import type { CombatStance } from "./positioning";
import { makeWeaponInstance, WEAPON_DEFS, type WeaponId } from "./weapons";
import { makeSquadron, type DroneRole, type DroneSquadron } from "./drones";
import { qualityDurabilityMax, type DurableSystem } from "./durability";

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
// FRAME HP (Combat 1.0 Unit 1.4, design 6a "middle path").
//
// A combat hull keeps a SMALL intrinsic frame integrity; hull plating provides the
// BULK of effective HP plus all mitigation. This fraction is the single named tunable
// that splits a hull's total structural HP between the intrinsic frame and the plating
// baseline: frameHp = round(hullIntegrity * COMBAT_FRAME_HP_FRACTION), and the
// Standard-Issue plating carries the remainder (hullIntegrity - frameHp) so a
// Standard-Issue-geared ship's hull pool folds back to EXACTLY hullIntegrity
// (frameHp + remainder == hullIntegrity), i.e. behaviour-preserving.
//
// It is the ONE source of truth for the split, read in BOTH directions:
//   - tick.ts seeds the Standard-Issue plating's hullStrength as hullIntegrity - frameHp.
//   - shipToCombatant (below) folds hull as frameHp(stats.hullIntegrity) + plating.hullStrength.
// Keeping frameHp here (a combat leaf) rather than in model.ts preserves the repo rule
// that model.ts never imports combat internals: model gets the resolved hullStrength
// value passed IN, and only the combat side computes the frame split.
export const COMBAT_FRAME_HP_FRACTION = 0.2;

// The intrinsic frame HP for a hull with the given total structural integrity. PURE +
// integer (Math.round), so the seed side (tick.ts) and the fold side (below) always
// agree to the byte. See COMBAT_FRAME_HP_FRACTION above for the design intent.
export function frameHp(hullIntegrity: number): number {
	return Math.round(hullIntegrity * COMBAT_FRAME_HP_FRACTION);
}

// The three weapon families a per-family resist affix can name, in a fixed order so a
// summed resist map is built deterministically. Named once so sumFamilyResist below
// and any future resist reader share one list.
const RESIST_FAMILIES = ["kinetic", "particle", "ew"] as const;

// The combined magnitude of one stat line on a piece: its implicit (signature) value
// PLUS any rolled affix of the same key. A Standard-Issue piece has only implicits
// (rolledStats {}), so this returns exactly the implicit; a crafted piece adds its
// rolled affix on top. Absent keys read as 0. PURE.
function statOf(piece: EquipmentInstance, key: string): number {
	return (piece.implicitStats[key] ?? 0) + (piece.rolledStats[key] ?? 0);
}

// The rolled-affix-only magnitude of one stat line (no implicit). Used for the
// defensive affixes (shieldCoherence / ablativeArmor / kineticDampening) that a slot
// carries ONLY as an optional rolled affix, never as a signature implicit. A
// Standard-Issue piece rolls none, so every one of these reads 0 (the pre-1.4
// hardcoded value), which is what keeps the Standard-Issue fold behaviour-preserving.
function affixOf(piece: EquipmentInstance | undefined, key: string): number {
	return piece ? (piece.rolledStats[key] ?? 0) : 0;
}

// Sum the per-family resist affixes (`${prefix}_${family}`, e.g. "damageResist_kinetic")
// across every installed piece into one FamilyResist map. FORWARD-WIRED: no gear rolls
// these keys yet (per-family resist affixes are a later unit's vocabulary), so today
// this always returns an all-zero map for a Standard-Issue set, matching the pre-1.4
// hardcoded zeroResist(). Wired now so the fold reads real numbers the moment those
// affixes exist, without reshaping shipToCombatant. PURE (fresh map per call).
function sumFamilyResist(gear: EquipmentInstance[], prefix: string): FamilyResist {
	const resist = zeroResist();
	for (const piece of gear) {
		for (const family of RESIST_FAMILIES) {
			const key = `${prefix}_${family}`;
			resist[family] += statOf(piece, key);
		}
	}
	return resist;
}

// ---------------------------------------------------------------------------
// weaponInstanceFromGear: reconstruct a fireable CombatWeapon from an INSTALLED
// weapon EquipmentInstance (Combat 1.0 Unit 1.4, design S4).
//
// The base type (family / triangle / effect slots / range / cooldown / power draw /
// ambush eligibility) comes from WEAPON_DEFS[piece.weaponType]; the ROLLED lines on the
// piece modify that base:
//   yieldMin/yieldMax += weaponYield   (FLAT, implicit + rolled affix)
//   accuracy          += weaponAccuracy (rolled affix)
//   quality           <- piece.quality
//   durability(Max)   <- the piece (its ceiling is already quality-scaled at mint)
//
// BEHAVIOUR-PRESERVING FLOOR (the load-bearing invariant, proven by a unit test): a
// Standard-Issue weapon (weaponYield 0, weaponAccuracy 0, quality 0, durability ==
// durabilityMax == the template base) reconstructs BYTE-IDENTICALLY to
// makeWeaponInstance(weaponType, instanceId): every rolled delta is 0 and every carried
// value equals the template's, so combat outcomes for a Standard-Issue set do not move.
//
// PURE: builds a fresh instance (own effectSlots array, zeroed cooldown accumulator),
// never mutating the shared WEAPON_DEFS template or the piece.
// ---------------------------------------------------------------------------
export function weaponInstanceFromGear(
	piece: EquipmentInstance,
	instanceId: string,
): CombatWeapon {
	// A weapon piece MUST name its base weapon type (its combat stats come from that def).
	// This should never fire for a real installed weapon (the seeder + itemgen always set
	// weaponType), so it is a loud assertion on a malformed piece, not a normal path.
	if (piece.weaponType === undefined) {
		throw new Error(`weaponInstanceFromGear: weapon piece "${piece.id}" has no weaponType`);
	}
	const template = WEAPON_DEFS[piece.weaponType];
	// FLAT yield bonus: implicit signature line + any rolled affix of the same key.
	const weaponYield = statOf(piece, "weaponYield");
	// Accuracy is a rolled affix only (no signature implicit); absent reads 0.
	const weaponAccuracy = piece.rolledStats.weaponAccuracy ?? 0;
	return {
		...template,
		id: instanceId,
		yieldMin: template.yieldMin + weaponYield,
		yieldMax: template.yieldMax + weaponYield,
		accuracy: template.accuracy + weaponAccuracy,
		// Fresh effect-slot array + zeroed cooldown so the sim's per-battle mutation never
		// leaks into the shared template (mirrors makeWeaponInstance exactly).
		effectSlots: [...template.effectSlots],
		cooldownAccumulator: 0,
		// Durability from the piece (its ceiling was quality-scaled at mint). A fresh combat
		// weapon opens at the piece's current durability; cross-wave wear is layered on later
		// by the patrol carry-state (applyCarriedSystemDurability), never here.
		durability: piece.durability,
		durabilityMax: piece.durabilityMax,
		quality: piece.quality,
	};
}

// Base durability (design S9) for a bridged ship's REACTOR and FTL/drive, at
// quality 0. The ship model has no per-hull durability stat yet (that arrives with
// the crafted-equipment bridge), so these are shared first-pass ceilings, mirroring
// weapons.ts BASE_WEAPON_DURABILITY. ⚠️ FIRST-PASS + TUNABLE (design S20). The
// reactor/ftl start FULL (durability == durabilityMax) at quality 0.
const BASE_REACTOR_DURABILITY = 100;
const BASE_FTL_DURABILITY = 100;

// Build one fresh DurableSystem (reactor or ftl) at quality 0 from a base ceiling.
// A fresh object per Combatant so the sim's per-battle wear never leaks between
// ships or back into a shared template. quality 0 => qualityDurabilityMax returns
// the base unchanged; a real per-instance quality arrives with the equipment bridge.
function freshSystem(baseDurability: number): DurableSystem {
	const durabilityMax = qualityDurabilityMax(baseDurability, 0);
	return { durability: durabilityMax, durabilityMax, quality: 0 };
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

// combatHullTypeOf: narrow a ShipTypeKey (passed as a plain string) to a CombatHullType,
// or null if the hull is NOT a combat hull. Combat 0.13.0 (Phase 9b.5a): patrol dispatch
// (tick.ts canDispatchPatrol) gates on the assigned ship being a combat hull, and needs
// the CombatHullType to look up its default drone loadout. The three combat hull ShipType
// keys ARE exactly the CombatHullType members (destroyer/battleship/carrier), so this is a
// direct membership narrow. An economy hull (freighter/hauler/runner/miner) returns null.
// PURE. Kept here (not model.ts) because CombatHullType + COMBAT_DEFAULT_LOADOUT live here.
export function combatHullTypeOf(typeKey: string): CombatHullType | null {
  return typeKey === "destroyer" || typeKey === "battleship" || typeKey === "carrier"
    ? typeKey
    : null;
}

// defaultDronesForHull: build a combat hull's DEFAULT drone squadrons fresh, for a
// patrol's persisted carry-state (PatrolMissionState.playerDrones). Combat 0.13.0 (Phase
// 9b.5a): a carrier deploys its COMBAT_DEFAULT_LOADOUT drone screen; every other combat
// hull fields none (empty array). Mirrors the drone-building branch inside shipToCombatant
// exactly (makeSquadron mints independent instances, tier 0), so a patrol's seeded drones
// match what a bridged carrier would fly. idPrefix scopes the squadron ids to one patrol.
// PURE.
export function defaultDronesForHull(hullType: CombatHullType, idPrefix: string): DroneSquadron[] {
  return COMBAT_DEFAULT_LOADOUT[hullType].droneRoles.map((role, index) =>
    makeSquadron(role, undefined, 0, `${idPrefix}-${role}${index}`),
  );
}

// defaultSystemDurabilityForHull: build a combat hull's FULL (no-wear) per-system durability
// carry-state, for a patrol's persisted PatrolMissionState.playerSystemDurability. Combat
// 0.13.0 (Phase 12b Unit B2): freshPatrolMission seeds this at dispatch/relaunch and the
// v32->v33 save migration backfills it, both meaning "full durability = no wear" (the safe
// default). Mirrors defaultDronesForHull's posture (a carry-state seed derived from the hull
// default): it builds the SAME fresh combatant shipToCombatant would fly, so the weapon COUNT
// + ORDER and the reactor/ftl ceilings come from ONE source of truth (no separately-maintained
// per-hull durability table that could drift from the real loadout). At quality 0 durability ==
// durabilityMax, so each system reads FULL. PURE (reads only the static loadout tables + the
// passed stats, mutates nothing). A carried value is later CLAMPED to the fresh max on apply,
// so even if a hull is retuned after a save was written, a backfilled "full" can never exceed
// the real ceiling.
export function defaultSystemDurabilityForHull(
  hullType: CombatHullType,
  stats: CombatShipStats,
): PatrolSystemDurability {
  // Build the hull's fresh default combatant once and read its full ceilings. id/team are
  // irrelevant here (nothing is fought), so any stable literal is fine.
  const fresh = shipToCombatant({ id: "durability-seed", team: "player", stats, hullType });
  return {
    weapons: fresh.weapons.map((weapon) => weapon.durabilityMax),
    // A real combat hull always carries both (shipToCombatant builds them); the `?? 0` guards
    // the impossible-in-practice absent case so the shape is always complete + JSON-safe.
    reactor: fresh.reactor ? fresh.reactor.durabilityMax : 0,
    ftl: fresh.ftl ? fresh.ftl.durabilityMax : 0,
  };
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
	// The ship's INSTALLED combat gear (Combat 1.0 Unit 1.4): the EquipmentInstance[]
	// currently fitted to this ship (state.equipment filtered by fittedToShipId). OPTIONAL.
	// When PRESENT (the PLAYER path), shipToCombatant reads weapons + shield + hull + the
	// defensive stats OFF this gear instead of the hull defaults / hardcoded zeros: weapons
	// from the fitted weapon pieces (reconstructed via weaponInstanceFromGear, in installed
	// order), the shield pool + recharge + coherence from the fitted shieldEmitters piece,
	// the hull pool (frame + plating.hullStrength) + armor + dampening from the fitted
	// hullPlating piece, and the resist maps summed across all gear. When ABSENT (enemies,
	// the durability seed, tests), the EXACT pre-1.4 hull-default behaviour is preserved.
	// A Standard-Issue set folds BYTE-IDENTICALLY to the absent path (behaviour-preserving).
	// The caller (live tick loop + display replay) MUST derive this array the SAME way from
	// the SAME source (equippedFor) so the two paths' combatants stay byte-identical.
	installedGear?: EquipmentInstance[];
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
// TWO PATHS (Combat 1.0 Unit 1.4):
//
// A) installedGear PRESENT (the PLAYER path). Weapons + defenses read the ship's real
//    fitted combat gear:
//      weapons            <- installed weapon pieces (weaponInstanceFromGear, install order)
//      shield, shieldMax  <- installed shieldEmitters.shieldCapacity  (implicit + affix)
//      shieldRecharge     <- installed shieldEmitters.shieldRecharge  (implicit + affix)
//      shieldCoherence    <- installed shieldEmitters shieldCoherence affix (?? 0)
//      hull, hullMax      <- frameHp(stats.hullIntegrity) + installed hullPlating.hullStrength
//      ablativeArmor      <- installed hullPlating ablativeArmor affix (?? 0)
//      kineticDampening   <- installed hullPlating kineticDampening affix (?? 0)
//      damageResist       <- summed per-family resist affixes across all gear (?? 0 each)
//      disruptionResist   <- summed per-family resist affixes across all gear (?? 0 each)
//      evasion            <- 0            (no maneuver stat wired this unit; TODO 1.6)
//      speed              <- DEFAULT_COMBAT_SPEED (unchanged this unit; TODO 1.6)
//      drones             <- hullType default (drones become gear in Phase 2; unchanged)
//    A STANDARD-ISSUE set folds BYTE-IDENTICALLY to path B (frameHp + plating.hullStrength
//    == hullIntegrity, emitter capacity == the hull's shieldCapacity, each weapon
//    reconstructs to makeWeaponInstance): combat OUTCOMES do not change (behaviour-preserving).
//
// B) installedGear ABSENT (enemies, the durability seed, tests). The EXACT pre-1.4 behaviour:
//      hull, hullMax      <- stats.hullIntegrity
//      shield, shieldMax  <- stats.shieldCapacity
//      shieldRecharge     <- stats.shieldRecharge
//      weapons            <- args.weaponLoadout, ELSE COMBAT_DEFAULT_LOADOUT[hullType], ELSE []
//      shieldCoherence / ablativeArmor / kineticDampening / evasion -> 0
//      damageResist / disruptionResist -> all-zero map ; speed -> DEFAULT_COMBAT_SPEED
//    An explicit weaponLoadout / drones ALWAYS wins on this path (hardcoded enemies, tests);
//    otherwise a real hullType derives the default loadout, minting each weapon/squadron FRESH.
//
// Reserved-empty (forward-shaped, sim iterates them as no-ops today):
//   statusEffects: []
//   alive: true (a fresh combatant is always alive at battle start)
// ---------------------------------------------------------------------------
export function shipToCombatant(args: ShipToCombatantArgs): Combatant {
	const { id, team, stats } = args;

	// Resolve the default loadout (if any) once: only when a real combat hull type
	// is supplied. Undefined for economy hulls / hardcoded enemies (they must pass
	// weapons explicitly or fly unarmed).
	const defaults = args.hullType ? COMBAT_DEFAULT_LOADOUT[args.hullType] : undefined;

	// The ship's installed combat gear (the PLAYER path). Undefined for enemies / the
	// durability seed / tests (path B, byte-identical to pre-1.4).
	const gear = args.installedGear;

	// WEAPONS. PLAYER path: reconstruct one CombatWeapon per INSTALLED weapon piece, in the
	// order the pieces appear in `gear` (the caller passes equippedFor()'s array, whose order
	// is stable wave-to-wave, so the carry-state's by-index durability stays aligned). Each
	// instance id is `${combatantId}-w${index}-${weaponType}`, the SAME format the hull-default
	// path below uses, so a Standard-Issue set (whose weapon pieces are in COMBAT_DEFAULT_LOADOUT
	// order) reconstructs to byte-identical ids + stats. A gear set with no weapon yields [] (the
	// dispatch blocker guarantees >=1 in normal play). ABSENT path (B): explicit loadout wins,
	// else the hull default, else unarmed (the pre-9a default).
	const weapons: CombatWeapon[] = gear
		? gear
				.filter((piece) => piece.slotType === "weapon")
				.map((piece, index) =>
					weaponInstanceFromGear(piece, `${id}-w${index}-${piece.weaponType}`),
				)
		: args.weaponLoadout ??
			(defaults
				? defaults.weapons.map((weaponId, index) =>
						makeWeaponInstance(weaponId, `${id}-w${index}-${weaponId}`),
					)
				: []);

	// DEFENSIVE STAT BLOCK. PLAYER path (gear present): read the shield/hull pools + mitigation
	// off the fitted shieldEmitters / hullPlating pieces; ABSENT path: the pre-1.4 hull-class
	// pools + hardcoded zeros. A Standard-Issue set folds these BYTE-IDENTICALLY (see the header).
	const shieldPiece = gear?.find((piece) => piece.slotType === "shieldEmitters");
	const platingPiece = gear?.find((piece) => piece.slotType === "hullPlating");

	// Hull pool: intrinsic frame + plating (design 6a). ABSENT: the whole hull-class integrity.
	const hullMax = gear
		? frameHp(stats.hullIntegrity) + (platingPiece ? statOf(platingPiece, "hullStrength") : 0)
		: stats.hullIntegrity;
	// Shield pool + recharge: pure-gear (design 5a). ABSENT: the hull-class shield stats.
	const shieldMax = gear
		? shieldPiece
			? statOf(shieldPiece, "shieldCapacity")
			: 0
		: stats.shieldCapacity;
	const shieldRecharge = gear
		? shieldPiece
			? statOf(shieldPiece, "shieldRecharge")
			: 0
		: stats.shieldRecharge;
	// Mitigation affixes: gear affixes on the PLAYER path, hardcoded 0 on the ABSENT path
	// (affixOf returns 0 for an absent piece, so a Standard-Issue set with no affixes is 0 too).
	const shieldCoherence = gear ? affixOf(shieldPiece, "shieldCoherence") : 0;
	const ablativeArmor = gear ? affixOf(platingPiece, "ablativeArmor") : 0;
	const kineticDampening = gear ? affixOf(platingPiece, "kineticDampening") : 0;
	// Per-family resist maps: summed across gear on the PLAYER path (all-zero for Standard-Issue,
	// which rolls no resist affixes), the all-zero regression default on the ABSENT path.
	const damageResist = gear ? sumFamilyResist(gear, "damageResist") : zeroResist();
	const disruptionResist = gear ? sumFamilyResist(gear, "disruptionResist") : zeroResist();

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

		// Hull <- frame + plating (PLAYER) or the hull-class integrity (ABSENT). Full at start.
		hull: hullMax,
		hullMax,

		// Shield <- the emitter's pool (PLAYER) or the hull-class shield (ABSENT). Full at start.
		shield: shieldMax,
		shieldMax,
		shieldRecharge,

		// Attenuation resist <- the emitter's shieldCoherence affix (PLAYER) or 0 (ABSENT).
		shieldCoherence,

		// Hull-path mitigation <- the plating's affixes (PLAYER) or 0 (ABSENT). Evasion stays 0
		// this unit on BOTH paths (no maneuver stat wired yet; TODO 1.6).
		ablativeArmor,
		kineticDampening,
		evasion: 0,

		// Per-family resist maps <- summed gear affixes (PLAYER; all-zero for Standard-Issue) or
		// the all-zero regression default (ABSENT). Fresh objects, never shared.
		damageResist,
		disruptionResist,

		// Movement on the 1D axis. Position defaults to 0 (co-located); speed to the
		// placeholder DEFAULT_COMBAT_SPEED (TODO 1.6: a real maneuver stat), unchanged this unit.
		position: args.position ?? 0,
		speed: args.speed ?? DEFAULT_COMBAT_SPEED,
		// Stance (design S6): Balanced by default; caller/mission layer overrides.
		stance: args.stance ?? DEFAULT_STANCE,

		// Weapons: explicit loadout, or the hull default (resolved above).
		weapons,

		// DEFENSIVE DURABLE SYSTEMS (Phase 12b Unit B1, design S9): every real ship
		// carries a reactor + ftl/drive that wear on hits taken. Fresh per-combatant
		// systems at quality 0 (first-pass base). Both players and enemies come through
		// this bridge, so both sides wear symmetrically. The sim reads their condition
		// for the power-starvation damage multiplier + the drive evasion/speed penalties.
		reactor: freshSystem(BASE_REACTOR_DURABILITY),
		ftl: freshSystem(BASE_FTL_DURABILITY),

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
