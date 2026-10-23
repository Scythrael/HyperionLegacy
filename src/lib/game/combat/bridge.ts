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
//   2. MOVEMENT / DEFENSE stats. Since Combat 1.0 the defense lines (shield coherence,
//      armor, dampening) fold off the installed gear; since WR-8 (0.14.0, combatRules.ts)
//      the per-family resists fold off the crafted plating and emitter lines, a run under
//      the combat rules passes the ship's combat speed and the enemy's opening position,
//      and evasion comes from the officers (Evasive Command) or a pirate hull's line.
// ============================================================================

import type { ShipTypeDef, ShipTypeKey, PatrolSystemDurability, EquipmentInstance, OfficerCombatMods, CaptainCombatMods } from "../model";
// Combat-defense rework (2026-08-27, HYBRID model): the SI hull-plating floor + the shield REFERENCE
// constants, imported as VALUES (model.ts owns the item-mint constants; a combat leaf importing model
// values is the allowed direction, model never imports combat at runtime). hullDefenseComposition below
// derives the hull's bare frame (authored - SI_PLATING_HP, additive) + its shield effectiveness ratios
// (authored / REF), so the fold recomposes an SI ship's gear to the hull's authored totals (byte-identical).
import { SI_PLATING_HP, REF_SHIELD_CAPACITY, REF_SHIELD_RECHARGE } from "../model";
// 0.13.5 F5: the hull table, read to derive how many hardpoints and bays need padding. A VALUE
// import from model into a combat leaf is the allowed direction (model never imports combat at
// runtime), the same direction the three constants above already travel.
import { SHIP_TYPES, moduleEffectScale } from "../model";
// E-MOD EM-5: the universal module catalog readers (a leaf: types only, no cycle).
import { moduleCombatProcs, moduleConditionals, modulePassiveTotal, type ModuleCombatContext } from "../shipModules";
import type { Combatant, CombatTeam, CombatWeapon, FamilyResist } from "./types";
import type { CombatStance } from "./positioning";
import { makeWeaponInstance, WEAPON_DEFS, type WeaponId } from "./weapons";
import { makeSquadron, type DroneRole, type DroneSquadron } from "./drones";
import { qualityDurabilityMax, type DurableSystem } from "./durability";
// WR-5b (0.14.0): the commanding captain's Tactician fold (absent mods = a no-op).
import { applyCaptainCombat, applyCaptainDrones } from "./captainEdge";
import { REPLENISH_PPM } from "./droneDefense";
// Gear wear (0.14.0): a weapon opens its pool at the piece's TRUE condition (user W3), read through one pure helper.
import { pieceStartDurability } from "../gearWear";
// WR-8 (0.14.0): the combat descriptors (combatRules.ts): the default combat speed, the weapon rule traits, the resist
// and pod line curves.
import {
	DEFAULT_COMBAT_SPEED,
	DEFENSIVE_STANCE,
	familyResistPercent,
	podLineShare,
	POD_LINE_RAPID_CHARGE,
	POD_LINE_REPLENISH,
	POD_LINE_SMART_REFLECT,
	stampCombatArgs,
	withWeaponRuleTraits,
	type CombatRulesStamp,
} from "./combatRules";

// Default stance for a bridged ship (design S6): Balanced (fight at Medium range)
// until the mission layer sets a real per-dispatch stance (player-chosen) or the
// enemy generator derives one from the loadout (Phase 9). Named so the default is
// explicit + a single knob.
const DEFAULT_STANCE: CombatStance = "balanced";

// The default combat speed (position units per second) lives in combatRules.ts (WR-8): enemies fly it, and a run
// under the combat rules passes the player's own (combatSpeedFor, frozen in the run's CombatRulesStamp).

// The zero FamilyResist (no per-family damage/disruption resist). A fresh object
// per Combatant so two bridged ships never share a resist map by reference.
function zeroResist(): FamilyResist {
	return { kinetic: 0, particle: 0, ew: 0 };
}

// (The legacy frame / plating split, frameHp and COMBAT_FRAME_HP_FRACTION, was retired by WR-8 (0.14.0, OC-D12 "the
// inert descriptors get coded or deleted"): the combat-defense rework's HYBRID fold below replaced it on 2026-08-27,
// and only save.test.ts's pre-rework migration fixtures still need its old number, which they now compute locally.)

// ---------------------------------------------------------------------------
// hullDefenseComposition: derive a hull's combat-defense composition (combat-defense rework, design
// addendum 2026-08-27; HYBRID model, user-locked 2026-08-27).
//
// This PURE helper reads the hull's AUTHORED SHIP_TYPES totals (hullIntegrity / shieldCapacity /
// shieldRecharge) and returns the hull's own side of the fold, HYBRID by stat:
//   innateHullArmor            = hullIntegrity  - SI_PLATING_HP     (a bare-frame HP pool, ADDED to plating)
//   shieldCapEffectiveness     = shieldCapacity / REF_SHIELD_CAPACITY (a MULTIPLIER on the emitter cap)
//   shieldRechargeEffectiveness = shieldRecharge / REF_SHIELD_RECHARGE (a MULTIPLIER on the emitter regen)
//
// WHY HYBRID (user-locked): a ship WITHOUT hull plating must still have a nonzero BARE FRAME (it is armored,
// not an exposed space frame), so hull stays ADDITIVE (bare frame + plating; bare frame alone with no
// plating). Shields have no source without an emitter, so shield cap + recharge are MULTIPLICATIVE via an
// effectiveness ratio and fold to 0 with no emitter.
//
// THE CALIBRATION (why the rework is byte-identical). For hull: SI plating hullStrength == SI_PLATING_HP, so
// hull = (hullIntegrity - SI_PLATING_HP) + SI_PLATING_HP == hullIntegrity exactly. For shields: SI emitter
// cap == REF_SHIELD_CAPACITY / recharge == REF_SHIELD_RECHARGE, so shield = REF_S * (authored_S / REF_S) ==
// authored_S exactly. So an SI ship recomposes to today's authored numbers (parity + balance fixtures do not
// move), while CRAFTED plating/emitters ride the SAME frame/effectiveness and genuinely gain. Unlike the
// retired 1+mult shield form (which reached x5 and compounded a crafted emitter + affixes into runaway
// shields), the effectiveness ratio is a tame ~0.5..2.0x that reads as an intuitive percentage.
//
// DERIVED, not stored: the rework does NOT persist per-ship fields (a deferred seam, design 9); this
// recomputes from the hull totals each fold. NOTE the shield ratios are floats (e.g. a 10/6 recharge
// effectiveness); the SI recomposition still lands on the exact authored integer for every current hull
// and stat (the additive hull is integer-exact; REF*(authored/REF) round-trips exactly here; verified in
// bridge.test.ts, no rounding needed).
export interface HullDefenseComposition {
	innateHullArmor: number;
	shieldCapEffectiveness: number;
	shieldRechargeEffectiveness: number;
}
export function hullDefenseComposition(stats: CombatShipStats): HullDefenseComposition {
	return {
		innateHullArmor: stats.hullIntegrity - SI_PLATING_HP,
		shieldCapEffectiveness: stats.shieldCapacity / REF_SHIELD_CAPACITY,
		shieldRechargeEffectiveness: stats.shieldRecharge / REF_SHIELD_RECHARGE,
	};
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
// hardcoded value), which is what keeps the Standard-Issue fold behavior-preserving.
function affixOf(piece: EquipmentInstance | undefined, key: string): number {
	return piece ? (piece.rolledStats[key] ?? 0) : 0;
}

// Sum the per-family resist lines (`${prefix}_${family}`, e.g. "damageResist_kinetic") across every installed piece
// into one FamilyResist map of PERCENTS. WR-8 (0.14.0, OC-D12): crafted Hull Plating rolls the damage resists and
// Shield Emitters the disruption resists (combatRules.ts PLATING_RESIST_LINES / EMITTER_RESIST_LINES); the summed
// points of a family become a percent on the D23 curve (combatRules.ts familyResistPercent: approaches 100, never a
// cap). Standard-Issue gear rolls none, so its map stays all zero, matching the pre-1.4 zeroResist(). PURE.
function sumFamilyResist(gear: EquipmentInstance[], prefix: string): FamilyResist {
	const resist = zeroResist();
	for (const family of RESIST_FAMILIES) {
		const key = `${prefix}_${family}`;
		let points = 0;
		for (const piece of gear) points += statOf(piece, key);
		resist[family] = familyResistPercent(points);
	}
	return resist;
}

// WR-8 (0.14.0, OC-D12 "rapid charge, in-combat replenish and smart reflect as drone pod lines"): the summed points of
// one pod line across the installed drone pods. PURE.
function podLinePoints(gear: readonly EquipmentInstance[], key: string): number {
	let points = 0;
	for (const piece of gear) if (piece.slotType === "droneBay") points += statOf(piece, key);
	return points;
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
// BEHAVIOR-PRESERVING FLOOR (the load-bearing invariant, proven by a unit test): a
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
		// weapon opens at the piece's CONDITION (gear wear, user W3 "True condition": durabilityMax
		// x condition / 1000, exactly durabilityMax while pristine, which is what the retired
		// `durability` field always held); cross-wave wear is layered on later by the patrol
		// carry-state (applyCarriedSystemDurability), never here.
		durability: pieceStartDurability(piece),
		durabilityMax: piece.durabilityMax,
		quality: piece.quality,
	};
}

// ---------------------------------------------------------------------------
// tierFromPod: map an installed drone pod's QUALITY (0..5) to a hangar squadron TIER
// (Combat 1.0 Unit 2.3a, design 6a/S8 "hangar-tier squadron scaling"). makeSquadron
// scales squadron SIZE by tier (ROLE_BASE_SIZE + tier * TIER_SIZE_STEP), so a higher-
// quality pod fields a bigger screen, monotonically, the drone analogue of a weapon's
// quality raising its durability ceiling.
//
// BEHAVIOR-PRESERVING FLOOR (load-bearing): a Standard-Issue pod is quality 0, so this
// returns tier 0 and makeSquadron(role, undefined, 0) is the carrier's CURRENT default
// squadron. The quality->tier curve above 0 is FIRST-PASS TUNABLE (the balance pass owns
// it); only the quality-0 == tier-0 floor is a hard contract. Clamped + floored so a
// malformed/negative quality can never produce a negative tier.
export function tierFromPod(pod: EquipmentInstance): number {
	return Math.max(0, Math.floor(pod.quality));
}

// ---------------------------------------------------------------------------
// squadronFromPod: reconstruct a fightable DroneSquadron from an INSTALLED drone-pod
// EquipmentInstance (Combat 1.0 Unit 2.3a, design 9/S8). The DRONE analogue of
// weaponInstanceFromGear.
//
// The base per-drone behavior (family / accuracy / yield / range / evasion / cooldown +
// the 7b defensive fields) comes from makeSquadron(pod.droneRole, undefined, tierFromPod(pod)),
// i.e. the drone ROLE_TEMPLATE[role] scaled by the pod's hangar tier; the pod's ROLLED lines
// then modify that base:
//   droneHp       += implicit droneHp + rolled droneHp affix  (raises squadron.droneHp AND every
//                                                               drone's hpMax/hp, kept full at spawn)
//   accuracy      += rolled droneAccuracy affix               (raises the squadron's hit chance)
//
// BEHAVIOR-PRESERVING FLOOR (the load-bearing invariant, proven by a unit test): a Standard-Issue
// pod (droneRole "attack", implicit droneHp 0, no affixes, quality 0) reconstructs BYTE-IDENTICALLY
// to makeSquadron("attack", undefined, 0), the carrier's current default squadron: tier 0 (quality
// 0), every rolled delta 0, so nothing is added and the fold is a no-op. This is why lighting up
// the drone fold does not move combat outcomes for a Standard-Issue-podded carrier.
//
// ⚠️ SCOPE (2.3a vs 2.3b): this fold is what shipToCombatant returns, but the LIVE patrol path
// (buildPatrolPlayerCombatant, patrolWave.ts) OVERRIDES a combatant's drones with the persisted
// per-wave carry-state, and that carry-state is seeded at dispatch from defaultDronesForHull, NOT
// from installed pods. So a CRAFTED pod's squadron (bigger screen, +droneHp) is reconstructed here
// but discarded in a real patrol until Unit 2.3b rewires the dispatch seed + carry-state to use
// squadronFromPod-from-installed-pods. It is invisible for Standard-Issue (defaultDronesForHull ==
// squadronFromPod(the Standard-Issue pod)), which is exactly why 2.3a stays behavior-preserving.
// Once 2.3b lands, installing a crafted defense/support pod reaches the field and the DORMANT
// defense/support/reflect/smart-reflect behaviors fire automatically (makeSquadron already carries
// the deflect/reflect fields and resolveBattle already reads them, so no SIM code changes, only the
// dispatch seed).
//
// `idPrefix` scopes the squadron id (two bays of the same role never collide). Omitted -> makeSquadron
// defaults it to the role, so squadronFromPod(pod) alone reads as the role's default-named squadron
// (this is the exact form the byte-identity test compares against makeSquadron("attack", undefined, 0)).
//
// PURE: builds a fresh squadron (own drone array), never mutating the pod or any shared template.
// ---------------------------------------------------------------------------
export function squadronFromPod(pod: EquipmentInstance, idPrefix?: string): DroneSquadron {
	// A drone pod MUST name its squadron role (its combat stats come from that template). This should
	// never fire for a real installed pod (the seeder + itemgen always set droneRole), so it is a loud
	// assertion on a malformed piece, not a normal path (mirrors weaponInstanceFromGear's guard).
	if (pod.droneRole === undefined) {
		throw new Error(`squadronFromPod: drone pod "${pod.id}" has no droneRole`);
	}
	const squadron = makeSquadron(pod.droneRole, undefined, tierFromPod(pod), idPrefix);
	// The pod's rolled POWER lines (implicit signature + any rarity affix). Absent keys read 0, so a
	// Standard-Issue pod (implicit droneHp 0, rolledStats {}) contributes 0 to both -> the fold is a
	// no-op and the squadron stays byte-identical to the makeSquadron base.
	const droneHpBonus = (pod.implicitStats.droneHp ?? 0) + (pod.rolledStats.droneHp ?? 0);
	const droneAccuracyBonus = pod.rolledStats.droneAccuracy ?? 0;
	if (droneHpBonus !== 0) {
		// Raise the squadron's template hp AND every spawned drone's ceiling, kept full at battle start.
		squadron.droneHp += droneHpBonus;
		for (const drone of squadron.drones) {
			drone.hpMax += droneHpBonus;
			drone.hp = drone.hpMax;
		}
	}
	if (droneAccuracyBonus !== 0) {
		squadron.accuracy += droneAccuracyBonus;
	}
	// WR-8: a Defense pod's Smart Reflect line: the chance a reflected shot seeks the weakest foe (combatRules.ts
	// podLineShare as a whole percent). Absent without the line, so every other pod is unchanged.
	const smartPoints = statOf(pod, POD_LINE_SMART_REFLECT);
	if (smartPoints > 0) squadron.smartReflectChance = Math.round(100 * podLineShare(smartPoints));
	return squadron;
}

// Base durability (design S9) for a bridged ship's REACTOR and FTL/drive, at
// quality 0. The ship model has no per-hull durability stat yet (that arrives with
// the crafted-equipment bridge), so these are shared first-pass ceilings, mirroring
// weapons.ts BASE_WEAPON_DURABILITY. ⚠️ FIRST-PASS + TUNABLE (design S20). The
// reactor/ftl start FULL (durability == durabilityMax) at quality 0.
export const BASE_REACTOR_DURABILITY = 100;
export const BASE_FTL_DURABILITY = 100;

// Build one fresh DurableSystem (reactor or ftl) from a base ceiling at `quality` (0 by default).
// A fresh object per Combatant so the sim's per-battle wear never leaks between
// ships or back into a shared template. quality 0 => qualityDurabilityMax returns
// the base unchanged.
// WR-8 (0.14.0, "reactor / FTL systems from installed gear"): a run under the combat rules passes the installed Reactor
// Core's and FTL drive's quality, frozen in its stamp (crewOverlay.ts shipCombatRulesStamp, ShipToCombatantArgs
// systemQuality), so a crafted piece fields a bigger pool with a lower wear chance; a Standard-Issue piece is quality
// 0, the same pool as before. The pool opens FULL here: gear wear step 4 opens it at the piece's true condition.
function freshSystem(baseDurability: number, quality = 0): DurableSystem {
	const durabilityMax = qualityDurabilityMax(baseDurability, quality);
	return { durability: durabilityMax, durabilityMax, quality: Math.max(0, Math.floor(quality)) };
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
// EVERY hull is combat-capable (user decision, "every hull is combat-capable"): a
// freighter/hauler/runner/miner now also fields a WEAK Standard-Issue combat set and
// can be dispatched to patrols, it is just STRICTLY INFERIOR to a purpose-built combat
// hull (see the economy entries in COMBAT_DEFAULT_LOADOUT below). So CombatHullType is
// now ALIASED to the full ShipTypeKey union rather than the old three-hull subset. WHY
// an alias, not a hand-listed union: it makes COMBAT_DEFAULT_LOADOUT (a Record keyed on
// CombatHullType) EXHAUSTIVE by compile check, so adding a new hull to ShipTypeKey is a
// compile error here until that hull is given a default loadout (Omega 8: no silent gap).
export type CombatHullType = ShipTypeKey;

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
	// (WR-8 retired the never-read `builtInBays` count: a hull's bays are SHIP_TYPES[hull].droneBays, the field the
	// install gate reads; the carrier's second bay starts empty, filled by an installed pod.)
	droneRoles: DroneRole[];
}

export const COMBAT_DEFAULT_LOADOUT: Record<CombatHullType, CombatDefaultLoadout> = {
	// --- ECONOMY HULLS ("every hull is combat-capable") -----------------------------
	// Each of the four economy hulls ships a WEAK Standard-Issue combat set so it is
	// DISPATCHABLE to patrols but STRICTLY INFERIOR to a purpose-built warship of
	// comparable investment (user decision: "you will never outperform a destroyer of
	// similar capability"). The weakness lever is the WEAPON loadout ONLY: the hull /
	// shield stats come straight from SHIP_TYPES (unchanged), and the guns are the
	// autocannon, the weakest raw-damage weapon in the roster (weapons.ts: 6-10 yield),
	// deliberately fewer than the hull's weaponHardpoints. NO drone bays (drones stay a
	// CARRIER-only capability, 0 drone bays). The exact gun COUNTS below were tuned
	// against the REAL patrol sim (patrol-balance.test.ts): every economy hull's
	// Standard-Issue win rate lands BELOW the destroyer's on BOTH the Sweep and the
	// Warband, so an economy hull never rivals a combat hull. ⚠️ TUNABLE (same first-
	// pass spirit as the combat-hull entries below); the durable intent is "clearly
	// outgunned, drone-less, still dispatchable".
	//
	// FREIGHTER: the toughest-framed economy hull's sibling; 1 autocannon (it has 2
	// hardpoints, but a single weak gun keeps it clearly outgunned). No drones.
	generalFreighter: {
		weapons: ["autocannon"],
		droneRoles: [],
	},
	// HAULER: the biggest hull (700 integrity) but the most toothless kit, exactly 1
	// autocannon, so its tankiness alone can NEVER carry it to a combat hull's win rate
	// (a big hull with almost no offense loses the hull%-tiebreak race it survives to).
	prospectorHauler: {
		weapons: ["autocannon"],
		droneRoles: [],
	},
	// RUNNER: fast + fragile (1 hardpoint); 1 autocannon. No drones.
	prospectorRunner: {
		weapons: ["autocannon"],
		droneRoles: [],
	},
	// PROSPECTOR/MINER: mid frame (1 hardpoint); 1 autocannon. No drones.
	prospectorMiner: {
		weapons: ["autocannon"],
		droneRoles: [],
	},
	// --- COMBAT HULLS (unchanged: byte-identical parity with the pre-widening data) ---
	// DESTROYER: a fast striker. 2 FAST weapons (a low-cooldown kinetic workhorse +
	// a particle chipper that bleeds hull through shields), leaving its remaining
	// hardpoints (4 total) open for fitment. No drones.
	destroyer: {
		weapons: ["autocannon", "plasma"],
		droneRoles: [],
	},
	// BATTLESHIP: the gun wall. 3 HEAVY weapons (a precision railgun, a heavy
	// warhead torpedo, and an anti-shield Voltaic to strip screens for the kinetics),
	// on a 6-hardpoint hull (3 open for fitment). No drones.
	battleship: {
		weapons: ["railgun", "concussionTorpedo", "voltaic"],
		droneRoles: [],
	},
	// CARRIER: the drone platform. 1 weapon only (a Point-Defense screen weapon, all
	// its 2 reduced hardpoints could hold, one left open for fitment) PLUS an Attack
	// squadron in a built-in bay: its real offense is the drones. The hull's 2 drone bays
	// (SHIP_TYPES.carrier.droneBays, design S8) are its built-in capacity; the second bay
	// starts empty (filled by an installed pod later).
	carrier: {
		weapons: ["pointDefenseArray"],
		droneRoles: ["attack"],
	},
	// --- EXPLORER HULLS (0.14.0 Exploration Phase E0, design Part B) ------------------
	// The glass-tank explorers carry TERRIBLE offense by design (their power goes to shields,
	// range, and sensors, not guns). Each has weaponHardpoints 1 (model.ts), so the signature
	// loadout is a SINGLE autocannon (the weakest gun in the roster) with NO padding, and NO
	// drone bays (drones stay a carrier-only capability). Their combat survivability is their
	// huge shields (SHIP_TYPES), not their weapons: fine against underpowered foes, overmatched
	// by anything organized. ⚠️ TUNABLE, same first-pass spirit as the entries above.
	orion: {
		weapons: ["autocannon"],
		droneRoles: [],
	},
	aurora: {
		weapons: ["autocannon"],
		droneRoles: [],
	},
	eir: {
		weapons: ["autocannon"],
		droneRoles: [],
	},
};

// ============================================================================
// F5: EVERY SLOT SHIPS FILLED (0.13.5 Phase 6, design 2026-09-11-infrastructure-0.13.4 section 16)
//
// ⚠️ THE SIGNATURE WEAPONS ABOVE ARE NO LONGER THE WHOLE LOADOUT. They are the part that gives a
// hull its IDENTITY; the rest of its hardpoints are padded with the floor gun by the two functions
// below, so no ship ever launches with an empty weapon slot.
//
// THE USER'S ARGUMENT, which is a DEAD-END argument rather than a power one and is what makes this
// consistent with 0.13.3.1's empty-slot work: "There's no great reason to limit/remove weapons.
// It'd be a softlock in the same way if they weren't an option. Except that you can be dispatched
// and will lose guaranteed." An empty hardpoint does not ground a ship, so the player is free to
// dispatch it, and the game's only answer to "why did that go badly" is a slot they never knew was
// empty.
//
// ⚠️ ROUTE A, AND IT IS NOT BALANCE-NEUTRAL. The agreed middle path was "same power spread
// thinner", achieved by cutting per-hull magnitudes. THAT LEVER DOES NOT EXIST: a Standard-Issue
// WEAPON carries no per-instance magnitude (its spec comment: "its yield bonus is always 0; the
// base WEAPON_DEF carries the real stats"), and editing WEAPON_DEFS would retune every instance of
// that weapon in the game, crafted ones included. So the spare slots take the AUTOCANNON, the
// weakest gun in the roster, which is the smallest increase available. The user chose this knowing
// it is an increase ("Just the same gun as the other slots").
//
// ⚠️ patrol-balance.test.ts IS THE ACCEPTANCE GATE, NOT AN ADVISORY. Its ordering (every economy
// hull below the destroyer on both encounters) must still hold after this change. It did not pass
// by construction; see the commit for the measured result.
//
// ⚠️ DERIVED FROM weaponHardpoints, NEVER HARDCODED. Padding the table by hand would silently go
// stale the moment a hull is retuned: a battleship raised to 8 hardpoints would go back to having
// empty slots and nobody would notice. Reading the hull's own number means the invariant holds
// automatically.
// ============================================================================

// The floor gun. Named once so the "pad with the weakest thing available" decision has one home
// and is not restated at two call sites.
const PAD_WEAPON: WeaponId = "autocannon";

// A hull's FULL default weapon loadout: its signature weapons, then autocannons until every
// hardpoint is filled.
//
// Clamped at 0 so a hull whose signature list is LONGER than its hardpoints (only reachable by a
// retune that shrinks hardpoints without trimming the list) pads nothing rather than producing a
// negative-length array. Such a hull would still be over-armed, which is a data bug for the
// balance pass to catch, not something to paper over here.
export function defaultWeaponsForHull(hullType: CombatHullType): WeaponId[] {
  const signature = COMBAT_DEFAULT_LOADOUT[hullType].weapons;
  const hardpoints = SHIP_TYPES[hullType].weaponHardpoints;
  const padCount = Math.max(0, hardpoints - signature.length);
  return [...signature, ...Array<WeaponId>(padCount).fill(PAD_WEAPON)];
}

// The same idea for DRONE BAYS: a carrier's second bay shipped empty, so it gets a second pod of
// the same role rather than a new one. ⚠️ Repeats the LAST declared role rather than inventing a
// role the hull was never designed around, which would be a capability change rather than filling
// a slot. A hull with no bays and no roles pads nothing.
// ⚠️ DRONE BAYS ARE NOT PADDED, AND THAT IS THE FINDING RATHER THAN AN OMISSION (0.13.5, F5).
//
// F5's ask was about WEAPONS: "if it has 3 hardpoints, it should have 3 weapons". I extended it to
// drone bays as well, which was overreach on two counts.
//
// FIRST, the carrier's empty second bay is a DOCUMENTED DESIGN DECISION, not a gap. The loadout
// table says so directly: the carrier's 2 bays are its built-in capacity and "the second bay
// starts empty". Filling it was changing a deliberate choice while believing I was fixing an
// oversight.
//
// SECOND, and this is the part worth keeping: THERE IS NO SUCH THING AS A LOW-IMPACT FILLER POD.
// Measured, not assumed. Padding the carrier's spare bay with a DEFENSE pod looked obviously safe
// on its damage numbers (1 to 2 per volley on a 1.5s cooldown, against attack's 4 to 6 on 0.5s),
// and the carrier STILL won the showcase patrol 100% of the time. The reason: defense drones carry
// interceptChance 60 and reflectChance 50, so the role's real identity is SURVIVABILITY, and a
// patrol is won by SURVIVING every wave. The role was picked by the stat being thought about and
// not the one that decides the outcome.
//
// Support is no better: it heals. Every pod puts more bodies on the field that soak, intercept or
// repair, so a drone bay cannot be filled "weakly" the way a hardpoint can. A weapon contributes
// only damage; a pod contributes PRESENCE, and nothing dilutes presence.
//
// So: pad WEAPONS, leave BAYS as authored. A fresh carrier fields exactly the screen it fields
// today.
export function defaultDroneRolesForHull(hullType: CombatHullType): DroneRole[] {
  return [...COMBAT_DEFAULT_LOADOUT[hullType].droneRoles];
}

// combatHullTypeOf: narrow a ShipTypeKey (passed as a plain string) to a CombatHullType,
// or null if the string is not a known hull at all. Since "every hull is combat-capable"
// (CombatHullType === ShipTypeKey, and COMBAT_DEFAULT_LOADOUT now carries an entry for
// EVERY hull), this returns non-null for all seven hulls, economy AND combat: it is the
// shared "resolve this typeKey to a hull that has a combat loadout" narrow the patrol +
// seeding paths use. A genuinely unknown / corrupt typeKey (not in the loadout table)
// still returns null, so downstream callers keep a defensive no-op path. Membership is
// tested against COMBAT_DEFAULT_LOADOUT's own keys so the two can never drift (adding a
// hull's loadout entry automatically makes it resolvable here). PURE. Kept here (not
// model.ts) because CombatHullType + COMBAT_DEFAULT_LOADOUT live here.
export function combatHullTypeOf(typeKey: string): CombatHullType | null {
  return Object.prototype.hasOwnProperty.call(COMBAT_DEFAULT_LOADOUT, typeKey)
    ? (typeKey as CombatHullType)
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
  // 0.13.5 F5: every bay, not just the declared roles.
  return defaultDroneRolesForHull(hullType).map((role, index) =>
    makeSquadron(role, undefined, 0, `${idPrefix}-${role}${index}`),
  );
}

// ---------------------------------------------------------------------------
// installedDronesForPatrol: build a patrol's carry-state drone squadrons from a ship's INSTALLED
// drone-pod gear (Combat 1.0 Unit 2.3b). The INSTALLED-GEAR analogue of defaultDronesForHull: instead
// of the hull's DEFAULT drone screen, it reconstructs one fightable squadron per installed droneBay pod
// (in equippedFor's stable install order) via squadronFromPod, so a CRAFTED pod's bigger / defense /
// support squadron actually reaches a real patrol (2.3a reconstructed it in shipToCombatant, but the
// live patrol path discarded that in favour of this carry-state seed; 2.3b makes the seed itself read
// the pods).
//
// THE single source of truth both patrol drone seeds read: the LIVE dispatch / relaunch
// (tick.ts freshPatrolMission) AND the display replay (patrolReplay.ts) call THIS with the SAME
// installed gear (equippedFor) and the SAME idPrefix, so the two carry byte-identical drones across
// every wave (the structural-parity contract, mirroring how buildPatrolPlayerCombatant is shared).
//
// BYTE-IDENTITY FLOOR (why swapping this in for defaultDronesForHull is behavior-preserving): each
// squadron's id sub-format is `${idPrefix}-${role}${index}`, the EXACT format defaultDronesForHull
// produces. A Standard-Issue carrier carries exactly ONE droneBay pod (its attack pod, quality 0),
// which squadronFromPod reconstructs BYTE-IDENTICALLY to makeSquadron("attack", undefined, 0) at the
// same id (Unit 2.3a's proven equality), so it folds to the same single default squadron. A
// destroyer / battleship has 0 bays -> 0 pods -> an EMPTY array, exactly what defaultDronesForHull
// returns for them. So for every Standard-Issue set the seed is unchanged (no patrol-outcome fixture
// moves); only a CRAFTED pod (quality > 0 / defense / support) changes what takes the field.
//
// PURE: filters the passed gear and maps to fresh squadrons (squadronFromPod mints independent
// instances), mutating nothing.
// WR-5b (0.14.0): `captainCombat` is the cycle's frozen captain record: its drone nodes (Squadron Tactics, Wing
// Commander, Wolfpack) shape the seeded screen (combat/captainEdge.ts applyCaptainDrones). Absent = unchanged.
// 0.14.0 (CP-4, OC-1): `deckHandling` is the cycle's frozen Deck Handling (PatrolMissionState.deckHandling), folded
// after the captain's nodes (applyDeckHandling). Absent or 0 = unchanged.
export function installedDronesForPatrol(
  installedGear: EquipmentInstance[],
  idPrefix: string,
  captainCombat?: CaptainCombatMods,
  deckHandling?: number,
): DroneSquadron[] {
  return applyDeckHandling(
    applyCaptainDrones(
      installedGear
        .filter((piece) => piece.slotType === "droneBay")
        .map((pod, index) => squadronFromPod(pod, `${idPrefix}-${pod.droneRole}${index}`)),
      captainCombat,
    ),
    deckHandling,
  );
}

// 0.14.0 (complement plan CP-4, OC-1 "Faster drone replenish"): the crew's Deck Handling (Flight Deck buff + Belter
// racial) on a patrol cycle's seeded squadrons, as parts per million of the replenish rate (deckHandlingPpm). The
// rate itself is untouched: the between-wave replenish banks the extra progress (droneDefense.ts replenishUnits) and
// the in-combat replenish banks it the same way (resolveBattle), so any amount above zero acts, x (1 + deckHandling)
// over time. Replenishment only, never drone damage or hit points (D12). Fresh squadrons are returned (the input is
// never mutated); absent, under one part per million, or no squadron returns the list itself. Pure.
// 0.14.0 (CP-4): the Deck Handling bank a relaunch carries into its new cycle (PatrolMissionState.replenishCarryStart,
// squadron by squadron in seed order: the same installed pods seed the same list), so a small amount keeps banking
// across a long Repeat patrol instead of starting from 0 each cycle. Only a squadron with Deck Handling takes one.
// Fresh squadrons; absent or all-zero returns the list itself. Pure.
export function withReplenishCarry(squadrons: DroneSquadron[], carries: readonly number[] | undefined): DroneSquadron[] {
  if (!carries || !carries.some((c) => c > 0)) return squadrons;
  return squadrons.map((sq, i) => ((carries[i] ?? 0) > 0 && (sq.deckHandlingPpm ?? 0) > 0 ? { ...sq, replenishCarryPpm: carries[i] } : sq));
}

export function applyDeckHandling(squadrons: DroneSquadron[], deckHandling: number | undefined): DroneSquadron[] {
  const ppm = Math.round((deckHandling ?? 0) * REPLENISH_PPM);
  if (!(ppm > 0) || squadrons.length === 0) return squadrons;
  return squadrons.map((sq) => ({ ...sq, deckHandlingPpm: ppm }));
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
// WR-8 (0.14.0): `combatRules` is the cycle's stamp (PatrolMissionState.combatRules), so the reactor and drive ceilings
// are the ones the wave combatant fights with (its frozen installed-system qualities). Absent: quality 0, as before.
export function defaultSystemDurabilityForHull(
  hullType: CombatHullType,
  stats: CombatShipStats,
  installedGear?: EquipmentInstance[],
  combatRules?: CombatRulesStamp,
): PatrolSystemDurability {
  // Build the hull's fresh combatant once and read its full ceilings. id/team are irrelevant here
  // (nothing is fought), so any stable literal is fine.
  // ⚠️ THREAD installedGear (audit fix): the seed's per-weapon durabilityMax (and count/order) MUST
  // match the REAL geared combatant the patrol fights. Passing gear was missed here (the sibling
  // playerDrones seed was threaded in Unit 2.3b), so the seed defaulted to hull-default quality-0
  // weapons (max 100); a crafted quality>0 weapon (durabilityMax up to 200) was then CLAMPED to 100
  // on wave 1 by applyCarriedSystemDurability, opening it Degraded (<=60%) and forcing reduced
  // damage across the whole patrol, strictly worse than a free Standard-Issue weapon. With gear
  // threaded, seed == real ceiling and the wave-1 apply is a no-op (full). undefined gear falls to
  // the hull-default path (byte-identical for a Standard-Issue set), so enemies/tests are unchanged.
  const fresh = shipToCombatant({ id: "durability-seed", team: "player", stats, hullType, installedGear, ...(combatRules ? stampCombatArgs(combatRules) : {}) });
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
	// order), the shield pool + recharge (each MULTIPLIED by the hull's shield effectiveness) + coherence
	// from the fitted shieldEmitters piece, the hull pool (innateHullArmor + plating.hullStrength) + armor
	// + dampening from the fitted hullPlating piece, and the resist maps summed across all gear. When ABSENT (enemies,
	// the durability seed, tests), the EXACT pre-1.4 hull-default behavior is preserved.
	// A Standard-Issue set folds BYTE-IDENTICALLY to the absent path (behavior-preserving).
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
	// E-CREW 0.14.0 (Task 20): the ship's Senior Staff combat bonuses (model.ts OfficerCombatMods), applied
	// ON TOP of the fold above by applyOfficerCombat below. OPTIONAL: absent (enemies, ratings, tests, a
	// ship with no such officer) leaves the combatant byte-identical. D12: officers are EXEMPT from the
	// "crew never double-dips weapons/shields" rule, so ONLY officers feed this; the Complement never does.
	officerCombat?: OfficerCombatMods;
	// WR-5b (0.14.0): the commanding captain's Tactician talents (model.ts CaptainCombatMods), folded AFTER the
	// officers by combat/captainEdge.ts applyCaptainCombat, each its own factor. OPTIONAL: absent (enemies, ratings,
	// a captain owning no Tactician node) leaves the combatant byte-identical.
	captainCombat?: CaptainCombatMods;
	// E-MOD EM-5: which combat context this combatant fights in, for its universal modules (a module acts only in the
	// contexts it lists). Absent = "patrol" (every patrol wave, replay, carry pool and forecast); the expedition ship
	// event passes "shipEvent" (shipScanEvents.ts buildShipCombatant).
	moduleContext?: ModuleCombatContext;
	// WR-8 (0.14.0, combat/combatRules.ts): the battle runs under the combat rules (its run carries a CombatRulesStamp).
	// Then every weapon gets its rule traits (withWeaponRuleTraits: anti-drone fire, Inhibit, the Tachyon and Voltaic
	// rules). Absent or false: the pre-WR-8 combatant exactly (the caller still passes position and speed itself).
	combatRules?: boolean;
	// WR-8: the qualities of the installed Reactor Core and FTL drive the run froze in its stamp (stampCombatArgs): the
	// combat reactor and drive pools are built at them. Absent: quality 0, the pre-WR-8 pools.
	systemQuality?: { reactor: number; ftl: number };
}

// E-CREW 0.14.0 (Task 20): fold the Senior Staff combat bonuses onto a freshly minted combatant, IN PLACE
// (the combatant is fresh per call; scaled weapons are replaced with COPIES, so a caller's explicit
// weaponLoadout is never mutated). Integer at the fold like every pool above: each weapon's damage band,
// the shield pool + recharge and the hull pool are scaled by (1 + bonus) and ROUNDED; evasion becomes whole evasion points (0.1 -> 10, the integer percent
// resolveBattle subtracts from a shot's accuracy), ADDED to whatever evasion the combatant already carries
// (0 today; a future maneuver stat must never be overwritten). A zero bonus skips its stat entirely, so absent or
// all-zero mods leave every number byte-identical. Linear, not a curve: each bonus has ONE source seat per
// ship (Tactical / Pilot) plus the rare any-seat Inspiring Leader, so nothing here stacks without bound.
export function applyOfficerCombat(c: Combatant, mods: OfficerCombatMods | undefined): void {
	if (!mods) return;
	if (mods.weaponDamage !== 0) {
		const mult = 1 + mods.weaponDamage;
		c.weapons = c.weapons.map((w) => {
			const yieldMin = Math.max(0, Math.round(w.yieldMin * mult));
			return { ...w, yieldMin, yieldMax: Math.max(yieldMin, Math.round(w.yieldMax * mult)) };
		});
	}
	if (mods.shield !== 0) {
		const mult = 1 + mods.shield;
		c.shieldMax = Math.max(0, Math.round(c.shieldMax * mult));
		c.shield = c.shieldMax;
		c.shieldRecharge = Math.max(0, Math.round(c.shieldRecharge * mult));
	}
	if (mods.hull !== 0) {
		c.hullMax = Math.max(1, Math.round(c.hullMax * (1 + mods.hull)));
		c.hull = c.hullMax;
	}
	if (mods.evasion !== 0) c.evasion = Math.max(0, c.evasion + Math.round(mods.evasion * 100));
	// E-CREW (Task 21): the Integrity facet's "steady under fire" extras, read live by resolveBattle while the
	// hull is below half. Evasion becomes whole points: the under-fire total rounded, minus the points the
	// line above already added, so the two never drift by a rounding step. Absent (every all-10 bridge) = no-op.
	const uf = mods.underFire;
	if (uf) {
		const evasionPoints = Math.round((mods.evasion + uf.evasion) * 100) - Math.round(mods.evasion * 100);
		if (uf.weaponDamage !== 0 || uf.shield !== 0 || evasionPoints !== 0) {
			c.underFire = { weaponDamage: uf.weaponDamage, shieldRecharge: uf.shield, evasion: evasionPoints };
		}
	}
}

// E-MOD EM-5 (0.14.0, plan section 4 EM-5): fold a ship's installed UNIVERSAL MODULES onto a freshly minted combatant,
// IN PLACE (the combatant is fresh per call). Only the combat engines EM-5 builds:
//   Passive hullIntegrity : the hull pool scaled by (1 + the summed lift), ROUNDED (integer at the fold), full at start.
//   Conditional           : the below-threshold damage lifts, read live by resolveBattle (Combatant.moduleConditionals).
// Each magnitude is its catalog def's scaled by moduleEffectScale (rarity, quality). No module (every ship today, every
// enemy, `gear` absent) leaves the combatant byte-identical: nothing is written. EM-6 adds the Procs and Actives
// (Combatant.moduleProcs, fired by resolveBattle).
// Only the modules that list `context` act (a patrol-only module never acts in a ship event).
export function applyModuleCombat(c: Combatant, gear: readonly EquipmentInstance[] | undefined, context: ModuleCombatContext): void {
	if (gear === undefined || !gear.some((p) => p.slotType === "module")) return;
	const scaleOf = (p: EquipmentInstance) => moduleEffectScale(p.rarity, p.quality);
	const hull = modulePassiveTotal(gear, "hullIntegrity", scaleOf, context);
	if (hull > 0) {
		c.hullMax = Math.max(1, Math.round(c.hullMax * (1 + hull)));
		c.hull = c.hullMax;
	}
	const conditionals = moduleConditionals(gear, scaleOf, context);
	if (conditionals.length > 0) c.moduleConditionals = conditionals;
	// E-MOD EM-6: the Procs and Actives, fired by resolveBattle from their trigger points. The installed gear is the
	// frozen source: a module cannot move while its ship is out (equipment.ts shipGearLock, user S2), a patrol
	// cycle's waves and its display replay fold the same pieces, and an expedition's ship event folds the dispatch
	// snapshot's pieces (shipScanEvents.ts snapshotShipEventProfile).
	const procs = moduleCombatProcs(gear, scaleOf, context);
	if (procs.length > 0) c.moduleProcs = procs;
}

// ---------------------------------------------------------------------------
// shipToCombatant -- fold a game ship's combat stats into a sim Combatant.
//
// TWO PATHS (Combat 1.0 Unit 1.4):
//
// A) installedGear PRESENT (the PLAYER path). Weapons + defenses read the ship's real
//    fitted combat gear:
//      weapons            <- installed weapon pieces (weaponInstanceFromGear, install order)
//      hull, hullMax      <- innateHullArmor + installed hullPlating.hullStrength; bare frame if no plating
//      shield, shieldMax  <- installed shieldEmitters.shieldCapacity * shield-cap effectiveness; 0 if none
//      shieldRecharge     <- installed shieldEmitters.shieldRecharge  * shield-recharge effectiveness; 0 if none
//      shieldCoherence    <- installed shieldEmitters shieldCoherence affix (?? 0)
//      ablativeArmor      <- installed hullPlating ablativeArmor affix (?? 0)
//      kineticDampening   <- installed hullPlating kineticDampening affix (?? 0)
//      damageResist       <- the per-family resist lines summed across all gear, on familyResistPercent (WR-8)
//      disruptionResist   <- likewise for the disruption resists (WR-8)
//      evasion            <- 0 (the officers' Evasive Command adds to it, applyOfficerCombat)
//      speed              <- args.speed (a run under the combat rules: its frozen combat speed), else DEFAULT_COMBAT_SPEED
//      drones             <- installed drone-pod squadrons (squadronFromPod per droneBay pod, Unit 2.3a)
//      inCombatReplenishPercent / rapidChargeShare <- the installed pods' counter lines (WR-8)
//      reactor / ftl      <- quality 0 pools, or under the combat rules the installed pieces' quality (WR-8)
//    A STANDARD-ISSUE set folds BYTE-IDENTICALLY to path B (innateHullArmor + SI_PLATING_HP
//    == hullIntegrity, SI_EMITTER_CAP * shieldCapacity/REF_SHIELD_CAPACITY == the hull's shieldCapacity,
//    recharge likewise, each weapon reconstructs to makeWeaponInstance, each drone pod reconstructs
//    to the hull's default squadron): combat OUTCOMES do not change (behavior-preserving).
//
// B) installedGear ABSENT (enemies, the durability seed, tests). The EXACT pre-1.4 behavior:
//      hull, hullMax      <- stats.hullIntegrity
//      shield, shieldMax  <- stats.shieldCapacity
//      shieldRecharge     <- stats.shieldRecharge
//      weapons            <- args.weaponLoadout, ELSE COMBAT_DEFAULT_LOADOUT[hullType], ELSE []
//      shieldCoherence / ablativeArmor / kineticDampening / evasion -> 0
//      damageResist / disruptionResist -> all-zero map ; speed -> args.speed ?? DEFAULT_COMBAT_SPEED
//    (A pirate wave under the combat rules then writes its hull's armor and evasion, enemyWave.ts.)
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
	// 0.13.5 F5: the FULL default loadout, padded to the hull's hardpoints and bays, rather than
	// the signature list alone. This is the path a patrol combatant is built through, so without it
	// a ship would be SEEDED with a full loadout but FIGHT with the old partial one.
	const defaults = args.hullType
		? { weapons: defaultWeaponsForHull(args.hullType), droneRoles: defaultDroneRolesForHull(args.hullType) }
		: undefined;

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
	const builtWeapons: CombatWeapon[] = gear
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
	// WR-8: under the combat rules every weapon carries its rule traits (combatRules.ts WEAPON_RULE_TRAITS).
	const weapons = args.combatRules ? builtWeapons.map(withWeaponRuleTraits) : builtWeapons;

	// DEFENSIVE STAT BLOCK. PLAYER path (gear present): read the shield/hull pools + mitigation
	// off the fitted shieldEmitters / hullPlating pieces; ABSENT path: the pre-1.4 hull-class
	// pools + hardcoded zeros. A Standard-Issue set folds these BYTE-IDENTICALLY (see the header).
	const shieldPiece = gear?.find((piece) => piece.slotType === "shieldEmitters");
	const platingPiece = gear?.find((piece) => piece.slotType === "hullPlating");

	// The hull's combat-defense composition (combat-defense rework, HYBRID model), derived from its authored
	// SHIP_TYPES totals. Used ONLY on the PLAYER (gear) path: the bare frame is ADDED to installed plating,
	// and the shield effectivenesses MULTIPLY an installed emitter. Cheap + pure; the ABSENT (enemy) path
	// ignores it, keeping enemy composition byte-identical (enemies install no gear).
	const comp = hullDefenseComposition(stats);

	// INTEGER-AT-THE-FOLD (design S0.4 "never floats", pulled forward 2026-08-27). The crafted (gear) branch
	// below MULTIPLIES an emitter's raw cap/recharge by the hull's shield-effectiveness RATIO (a float, e.g. a
	// battleship's 5/6 recharge effectiveness), which yields a FLOAT pool. We ROUND every crafted defensive pool
	// to a whole number RIGHT HERE, so the integer invariant holds in ONE place for every downstream reader: the
	// T1 carry-state pools, advanceShieldRegen (which otherwise silently FLOORS a fractional recharge, e.g. a
	// 6.9/s regen ticking as 6/s), applyProjectileDamage's shield-overflow into hull, the offense-gate hull
	// comparison, and the panel readout (no more "507.4"). Rounding mode is Math.round: the codebase's pool /
	// stat sizing convention (frameHp() and craftedDefensiveImplicit() both Math.round); the per-tick Math.floor
	// calls downstream are DELTA quantizations, not pool-size sizing. SI byte-identity is UNTOUCHED by
	// construction: an SI set recomposes to the hull's AUTHORED INTEGER totals (SI_EMITTER_CAP *
	// (shieldCapacity / REF_SHIELD_CAPACITY) == shieldCapacity exactly, etc.), so Math.round is a no-op on it.
	// The ABSENT (enemy) branch reads the authored integer stats directly and is likewise unaffected.

	// Hull pool: the hull's bare frame (innateHullArmor) + the installed plating's raw hullStrength (ADDITIVE;
	// plating OPTIONAL, a bare hull keeps its nonzero frame, user-locked: never an exposed space frame).
	// ABSENT: the whole hull-class integrity. An SI set folds innateHullArmor + SI_PLATING_HP == hullIntegrity
	// (byte-identical, integer-exact). Both terms are integer at mint today (authored integrity minus the
	// integer SI_PLATING_HP, plus the round()'d plating hullStrength), so Math.round here is a defensive no-op
	// that keeps the "integer pool" guarantee LOCAL and self-evident instead of relying on a cross-module proof.
	const hullMax = gear
		? Math.round(comp.innateHullArmor + (platingPiece ? statOf(platingPiece, "hullStrength") : 0))
		: stats.hullIntegrity;
	// Shield pool + recharge: the installed emitter's raw cap/recharge * the hull's shield effectiveness, ROUNDED
	// to an integer (see the INTEGER-AT-THE-FOLD note above). With NO emitter there is nothing to scale ->
	// shield 0 (an emitter is the shield SOURCE). ABSENT: the hull-class shield stats. An SI set folds
	// SI_EMITTER_CAP * (shieldCapacity / REF_SHIELD_CAPACITY) == shieldCapacity (byte-identical; recharge likewise).
	const shieldMax = gear
		? shieldPiece
			? Math.round(statOf(shieldPiece, "shieldCapacity") * comp.shieldCapEffectiveness)
			: 0
		: stats.shieldCapacity;
	const shieldRecharge = gear
		? shieldPiece
			? Math.round(statOf(shieldPiece, "shieldRecharge") * comp.shieldRechargeEffectiveness)
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

	// DRONES (Combat 1.0 Unit 2.3a). PLAYER path (gear present): field one squadron per INSTALLED
	// drone-pod (slotType "droneBay"), reconstructed via squadronFromPod in the order the pods appear
	// in `gear` (equippedFor's stable order). The squadron id is `${id}-${role}${index}`, the SAME
	// format the hull-default path below uses, so a Standard-Issue carrier (one attack pod) folds to a
	// squadron BYTE-IDENTICAL to the default (squadronFromPod at quality 0 == makeSquadron(role, ...,
	// 0)); a non-carrier has 0 bays -> 0 pods -> no drones. A crafted defense/support pod lights up its
	// dormant behaviors automatically (resolveBattle already reads those squadron fields). ABSENT path
	// (enemies / durability seed / tests): an explicit `drones` wins, else the hull default's squadrons
	// minted fresh (makeSquadron -> independent per-battle drone instances, tier 0), else none.
	const drones: DroneSquadron[] = gear
		? gear
				.filter((piece) => piece.slotType === "droneBay")
				.map((pod, index) => squadronFromPod(pod, `${id}-${pod.droneRole}${index}`))
		: args.drones ??
			(defaults
				? defaults.droneRoles.map((role, index) =>
						makeSquadron(role, undefined, 0, `${id}-${role}${index}`),
					)
				: []);

	const combatant: Combatant = {
		id,
		team,

		// Hull <- bare frame + plating (PLAYER) or the hull-class integrity (ABSENT). Full at start.
		hull: hullMax,
		hullMax,

		// Shield <- the emitter's pool (PLAYER) or the hull-class shield (ABSENT). Full at start.
		shield: shieldMax,
		shieldMax,
		shieldRecharge,

		// Attenuation resist <- the emitter's shieldCoherence affix (PLAYER) or 0 (ABSENT).
		shieldCoherence,

		// Hull-path mitigation <- the plating's affixes (PLAYER) or 0 (ABSENT). Evasion starts at 0
		// on BOTH paths; E-CREW Task 20's Evasive Command adds to it through applyOfficerCombat below,
		// and a pirate wave under the combat rules writes its hull's evasion (WR-8, enemyWave.ts).
		ablativeArmor,
		kineticDampening,
		evasion: 0,

		// Per-family resist maps <- summed gear affixes (PLAYER; all-zero for Standard-Issue) or
		// the all-zero regression default (ABSENT). Fresh objects, never shared.
		damageResist,
		disruptionResist,

		// Movement on the 1D axis. Position defaults to 0 (co-located); speed to DEFAULT_COMBAT_SPEED.
		// WR-8: a run under the combat rules opens the enemy at range and passes each side's combat speed.
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
		// WR-8: a run under the combat rules builds them at its frozen installed-system qualities (systemQuality).
		reactor: freshSystem(BASE_REACTOR_DURABILITY, args.systemQuality?.reactor ?? 0),
		ftl: freshSystem(BASE_FTL_DURABILITY, args.systemQuality?.ftl ?? 0),

		// A fresh combatant is alive; the sim flips this the tick hull hits <= 0.
		alive: true,

		// Status effects start empty. Drones: explicit override, the carrier hull
		// default (resolved above), or empty for a drone-less hull.
		statusEffects: [],
		drones,

		// Counter-module effect flags (design S7): OFF by default. WR-8: the installed drone pods' Rapid Charge lines set
		// rapidChargeShare below; the Particle-Trace Detector waits for patrol cloak detection (CP-15, the user's 0.14.x).
		rapidChargeAfterAmbush: false,
		particleTraceDetector: 0,
	};
	// WR-8 review (user 2026-10-22): a ship flying Defensive (stored key "standoff") under the combat rules carries its
	// modifiers (combatRules.ts DEFENSIVE_STANCE): less damage taken and dealt, shields first, guarding. A fresh copy.
	// WR-8 review (answer 5): every combatant under the rules can close evasively (resolveBattle.ts advanceMovement).
	if (args.combatRules) combatant.evasiveClose = { active: false, carry: 0 };
	if (args.combatRules && combatant.stance === "standoff") {
		combatant.defensive = { ...DEFENSIVE_STANCE };
		combatant.defensiveCarry = { taken: 0, dealt: 0, absorb: 0 };
	}
	// WR-8 (0.14.0, OC-D12): the installed drone pods' In-Combat Replenish and Rapid Charge lines (absent without one, so
	// a combatant with no such pod is unchanged).
	if (gear !== undefined) {
		const replenishPoints = podLinePoints(gear, POD_LINE_REPLENISH);
		if (replenishPoints > 0) combatant.inCombatReplenishPercent = Math.round(100 * podLineShare(replenishPoints));
		const rapidPoints = podLinePoints(gear, POD_LINE_RAPID_CHARGE);
		if (rapidPoints > 0) combatant.rapidChargeShare = podLineShare(rapidPoints);
	}
	// E-MOD EM-5: the installed universal modules (gear, so before the people): Passive hull integrity and the
	// Conditional damage lifts. Read off the same installed gear, so every caller that folds gear folds modules.
	applyModuleCombat(combatant, gear, args.moduleContext ?? "patrol");
	// E-CREW (Task 20): the seated officers' combat bonuses, on top of everything above (absent = no-op).
	applyOfficerCombat(combatant, args.officerCombat);
	// WR-5b: the commanding captain's Tactician nodes, on top (absent = no-op).
	applyCaptainCombat(combatant, args.captainCombat);
	return combatant;
}

// ---------------------------------------------------------------------------
// foldedPlayerDefense: the player ship's FOLDED defensive carry-pools (hullMax / shieldMax /
// shieldRecharge), derived from the SAME installed-gear fold the sim actually fights with
// (combat-defense BLOCKER fix, 2026-08-27).
//
// WHY THIS EXISTS. The in-battle combatant reads its hull / shield / recharge OFF installed gear
// (shipToCombatant: hullMax = innateHullArmor + plating.hullStrength; shieldMax = emitterCap *
// shieldCapEffectiveness; shieldRecharge = emitterRecharge * shieldRechargeEffectiveness). But every
// PERSISTENT patrol carry surface (the wave-1 hull/shield seed, the between-wave shield regen and its
// cap clamp, the limp-home damage) and the dispatch forecast previously seeded from the RAW AUTHORED
// SHIP_TYPES stats, silently negating crafted plating/emitters across a patrol and biasing the
// forecast pessimistic. This ONE helper folds those pools the SAME way the sim does, so the live loop,
// the display replay, the forecast, and the dispatch card all seed from ONE source of truth and can
// never drift apart again.
//
// HOW: it builds the ship's fresh combatant via shipToCombatant (the EXACT fold the sim uses, the same
// "read a fresh combatant's ceilings" posture defaultSystemDurabilityForHull already uses for the
// durability seed) and reads its hullMax / shieldMax / shieldRecharge. Reusing shipToCombatant rather
// than re-deriving the fold math inline is precisely what makes drift impossible.
//
// BYTE-IDENTITY FLOOR: a Standard-Issue set folds to the authored stats exactly (the calibration in
// hullDefenseComposition: innateHullArmor + SI_PLATING_HP == hullIntegrity; REF * (authored / REF) ==
// authored), and installedGear ABSENT falls to shipToCombatant's authored (pre-1.4) path, so every
// existing SI fixture + the parity gate are unchanged BY CONSTRUCTION. hullType is intentionally
// omitted: it drives only weapons / drones, which do not affect the hull/shield/recharge DEFENSE
// pools this helper returns. PURE: reads only the passed stats + gear, mutates nothing.
export interface FoldedPlayerDefense {
	hullMax: number;
	shieldMax: number;
	shieldRecharge: number;
}
// E-CREW (Task 20): `officerCombat` is the patrol cycle's frozen officer bonuses (Shield Command and
// Inspiring Leader lift these pools), passed by EVERY patrol carry surface alongside the wave combatant's
// own, so the carry pools and the fighting combatant stay one fold. Absent = the pre-Task-20 fold.
// WR-5b: `captainCombat` likewise (Shield Discipline and Reinforced Hull lift these pools), the cycle's frozen value.
export function foldedPlayerDefense(
	stats: CombatShipStats,
	installedGear?: EquipmentInstance[],
	officerCombat?: OfficerCombatMods,
	captainCombat?: CaptainCombatMods,
): FoldedPlayerDefense {
	// A throwaway id/team: nothing is fought here, we only read the folded defense ceilings.
	const combatant = shipToCombatant({ id: "defense-fold", team: "player", stats, installedGear, officerCombat, captainCombat });
	return {
		hullMax: combatant.hullMax,
		shieldMax: combatant.shieldMax,
		shieldRecharge: combatant.shieldRecharge,
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
