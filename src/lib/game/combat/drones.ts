// ============================================================================
// combat/drones.ts -- the drone sub-system data model + squadron factory
// (Combat 0.13.0, Phase 7a model/offense + Phase 7b defensive fields)
//
// WHY ITS OWN MODULE (design S8). Drones are a whole offense/defense/utility
// sub-system: a ship's hangar bays each hold one Drone Squadron Pod (one
// squadron of one role), and a squadron is INDIVIDUALLY TRACKED down to each
// drone's HP + status (cheap at 6 to 10 drones/squadron, and required for the
// per-unit status pips the combat UI shows). Keeping the shapes + the content
// (baseline sizes, per-role stat templates, brand/model names) here, separate
// from the sim loop, means the balance pass tunes ONE data board (Omega 9:
// rule-based, readable without the sim) and the sim just reads these fields.
//
// SCOPE OF THIS FILE: the DATA MODEL (Drone / DroneSquadron / DronePod), the
// makeSquadron/makeDronePod factories, and the read-only squadronStatusSummary
// helper. Every field a squadron needs lives here (offense stats AND the Phase 7b
// defensive stats: interceptChance / reflectChance / smartReflect /
// supportHullRepair / droneReplenishRate). The BEHAVIOR that reads them is split
// across two sim files: OFFENSE (fireSquadron) + the SUPPORT PULSE + IN-COMBAT
// REPLENISH live in resolveBattle.ts's tick loop, and the DEFENSIVE interactions
// (deflect/reflect/meat-shield when a shot targets a drone-carrier) run through
// resolveBattle.fireWeapon using the PURE helpers in droneDefense.ts (absorb,
// reflect-target pick, replenishDrones, supportCleanse). The per-drone status
// TRANSITIONS (destroyed -> refabricating -> online, disrupted -> online) are
// driven by absorbWithDrone + replenishDrones. The CARRIER hull class + hangar
// equipment + between-wave replenishment CALL remain Phase 9 seams.
//
// UNITS (mirroring types.ts): every time value is INTEGER DECI-SECONDS (10 =
// 1.0s); HP / damage / accuracy-percent / evasion-percent are bounded integers.
// No float ever enters a drone stat, so the sim stays cross-device drift-proof.
// ============================================================================

import type { WeaponFamily } from "./types";
// Range-band anchors are the shared distance scale (design S6). Reusing them
// (instead of re-declaring magic distances) keeps drone reach consistent with
// weapon reach: a "long-range" defense squadron reaches the same LONG band a
// long-range weapon does. No runtime cycle: positioning.ts imports types.ts as
// TYPES ONLY, and this module only pulls its plain numeric consts.
import { BAND_SHORT, BAND_LONG } from "./positioning";

// ---------------------------------------------------------------------------
// ROLES + MODES (design S8: "Three roles, three auto-assigned modes, no toggle").
// The player picks a ROLE per bay; the behavior MODE is DERIVED, never toggled,
// so the AI is a pure function of the loadout (Alpha: explicit over clever).
// ---------------------------------------------------------------------------

// The three squadron roles. A pod (and thus a bay) is exactly one role.
export type DroneRole = "attack" | "defense" | "support";

// The auto-assigned behavior mode each role maps to (design S8 Mode 1/2/3):
//   - "assault": Mode 1 (Attack). Zoom in, fast sweeping strikes at the owner's
//     target, higher yield per drone (the offensive screen).
//   - "guard":   Mode 2 (Defense). Hang by the carrier and fire LONG-range but
//     slow, few/low-damage projectiles; its real value is defensive (7b).
//   - "utility": Mode 3 (Support). Like guard but even lower offense; its kit is
//     repair/cleanse utility, built in 7b, so offense here is minimal/none.
export type DroneMode = "assault" | "guard" | "utility";

// Fixed role -> mode map (no toggle: the mode is auto-assigned from the role).
const ROLE_MODE: Record<DroneRole, DroneMode> = {
	attack: "assault",
	defense: "guard",
	support: "utility",
};

// ---------------------------------------------------------------------------
// PER-DRONE STATUS (design S8 individual-unit tracking + status pips).
// Each drone tracks its own liveness + a status the UI renders as a pip:
//   online        -> healthy, contributing to the squadron's output
//   disrupted     -> jammed by a disruption, repairing 0..100% (persists post-battle)
//   refabricating -> destroyed and being rebuilt 0..100% (out-of-combat replenish)
// ⚠️ Phase 7a models these fields but only ever produces "online" drones; the
// TRANSITIONS between states (disruption, destruction, refab, replenishment) are
// DRIVEN in Phase 7b. See squadronStatusSummary for the read side the UI uses.
// ---------------------------------------------------------------------------
export type DroneStatus = "online" | "disrupted" | "refabricating";

// One individual drone (INDIVIDUALLY TRACKED, design S8). Cheap at 6 to 10 per
// squadron, and required so the UI can show per-unit pips + tooltips.
export interface Drone {
	// Current hit points (integer, >= 0). At 0 the drone is destroyed (alive
	// false) and, in 7b, flips to "refabricating" while it rebuilds.
	hp: number;
	// Maximum hit points (integer). The squadron template's droneHp seeds this.
	hpMax: number;
	// Liveness. A destroyed drone stops contributing to squadron output (offense
	// scales with ALIVE count). Phase 7b flips this on penetration + back on refab.
	alive: boolean;
	// UI/behavior status (see DroneStatus). Phase 7a: always "online". Phase 7b
	// drives the transitions.
	status: DroneStatus;
	// Repair progress 0..100 for a "disrupted" drone climbing back to "online"
	// (design S8: disruptions repair 0-100%). Inert (0) until 7b drives it.
	repairProgress: number;
	// Rebuild progress 0..100 for a "refabricating" (destroyed) drone (design S8:
	// refabricating 0-100%). Inert (0) until 7b replenishment drives it.
	refabProgress: number;
}

// ---------------------------------------------------------------------------
// SQUADRON (design S8). A squadron of role R has a baseline SIZE (Attack 8 /
// Defense 10 / Support 6), scaled by hangar TIER later; it carries a PER-DRONE
// stat template (each drone deals ~1/size of an equivalent weapon, so a full
// squadron is roughly one weapon spread across the drones, design S8 balance),
// plus its own firing cooldown clock.
// ---------------------------------------------------------------------------
export interface DroneSquadron {
	// Stable identifier for this squadron (UI + log + deterministic reference).
	id: string;
	// The squadron's role (one role per squadron/bay/pod).
	role: DroneRole;
	// The auto-assigned behavior mode (derived from role; no toggle).
	mode: DroneMode;
	// The brand/model name (content, like the weapon roster; design S8 "unique
	// per drone, not placeholders"). First-pass names live in ROLE_MODELS below.
	model: string;

	// The individually-tracked drones. Length == squadron size at full strength;
	// output scales with the ALIVE subset (losing drones lowers damage, which sets
	// up 7b where drones get destroyed).
	drones: Drone[];

	// -- PER-DRONE STAT TEMPLATE (each field applies to every drone in the squadron;
	// stored once on the squadron, not duplicated per drone, since drones in a
	// squadron are identical stat-wise). All FIRST-PASS + TUNABLE (design S20). --
	// Max HP each drone spawns with (seeds Drone.hpMax/hp).
	droneHp: number;
	// The damage FAMILY each drone's shot deals, selecting the mitigation triangle
	// in applyProjectileDamage (design S3). First-pass: all roles are kinetic (the
	// simplest, attenuation-free type). TODO(balance): per-role families (e.g. an
	// EW support drone, a particle defense drone).
	family: WeaponFamily;
	// Per-drone hit chance as an INTEGER PERCENT (design S2.1). The sim rolls each
	// drone against clamp(accuracy - targetEvasion, 0, 100) on the combat stream.
	accuracy: number;
	// Per-drone damage band, INCLUSIVE integers. Each firing drone rolls a raw
	// value in [yieldMin, yieldMax] (design S8: each drone deals ~1/size of a
	// weapon). yieldMin == yieldMax == 0 means the squadron has NO offense (support
	// in 7a), and the sim fires no volley for it (zero combat draws).
	yieldMin: number;
	yieldMax: number;
	// Firing reach on the 1D distance axis (integer). The volley only lands when
	// the OWNER-to-target distance is <= this. Attack drones "zoom in" (short reach,
	// they close to strike); defense/support hang back and fire at LONG reach.
	// TODO(Phase 7b/UI): a real per-drone position model; for now the owner's
	// distance to the target gates the whole squadron.
	range: number;
	// The squadron's EVASION as an integer percent (design S8). Used when the
	// squadron is TARGETED (Phase 7b "Squadron is targeted" row): a drone that is
	// being hunted rolls this to dodge. NOT its own offense. Attack/support are
	// nimble (high), defense is a low-evade blocker (it deflects instead, below).
	evasion: number;

	// -- PHASE 7b DEFENSIVE FIELDS (design S8 interaction matrix). Additive on top of
	// the 7a offense model; every one defaults to a role-appropriate value from the
	// template so a squadron built by makeSquadron is complete. A drone-less
	// combatant never consults these (the parity guard). --
	//
	// interceptChance: the integer-percent COMBAT-stream chance a drone STOPS an
	// incoming projectile when it engages the intercept (design S8 "Carrier is
	// targeted"). Semantics differ by role:
	//   - defense: DEFLECT chance, deliberately HIGHER than its own self-evasion
	//     (it is guarding, not counterattacking): a successful deflect blocks the
	//     shot (and, particle-only, may reflect it, see reflectChance).
	//   - attack:  the risky guarding EVADE, deliberately LOWER than its own
	//     self-evasion; on success the drone dodges AND lands a solid counterattack.
	//   - support: 0 (a pure meat-shield never evades when guarding the carrier).
	interceptChance: number;
	// reflectChance: given a DEFENSE drone deflected a PARTICLE shot, the integer-
	// percent COMBAT-stream chance it REFLECTS the shot back rather than merely
	// blocking it (design S8: reflect is PARTICLE-ONLY). 0 for non-defense roles.
	reflectChance: number;
	// smartReflect: a CARRIER-EXCLUSIVE flag (design S8) that retargets a reflected
	// shot to a PRIORITY enemy (a weaker/Support foe) instead of the attacker.
	// Default false; the module/hull that grants it is Phase 9. Inert when off.
	smartReflect: boolean;
	// supportHullRepair: hull points a SUPPORT squadron repairs on the owner PER
	// SUPPORT PULSE, PER ALIVE DRONE (design S8 Mode 3 "small hull repair per tick").
	// 0 for attack/defense. No combat draw (deterministic heal).
	supportHullRepair: number;
	// droneReplenishRate: refab/repair PROGRESS UNITS per SECOND this squadron
	// recovers (design S8: "an implicit droneReplenishRate rebuilds destroyed drones
	// only out of combat"). Phase 9 passes this to replenishDrones between waves; the
	// in-combat replenish module (Combatant.inCombatReplenishPercent) uses x% of it
	// DURING battle. FIRST-PASS + TUNABLE.
	droneReplenishRate: number;

	// Time between volleys, in deci-seconds (integer fixed-point). Attack fires
	// FAST (short cooldown), defense/support fire SLOW.
	attackCooldownDeciSec: number;
	// Carry-over cooldown clock, advanced by dt each tick; when it reaches
	// attackCooldownDeciSec the squadron volleys and we SUBTRACT the period
	// (keeping the remainder) so fractional fire rates never skew over time.
	// Mirrors CombatWeapon.cooldownAccumulator exactly. Seeded to 0 at build.
	cooldownAccumulator: number;
}

// ---------------------------------------------------------------------------
// POD (design S8). The squadron-as-EQUIPPABLE shape: a hangar bay holds exactly
// one pod = one squadron of one role. Pods are swapped like any other gear when
// the ship is parked (the fit-to-ship pipeline is Phase 9/12; here a pod is just
// the caller-supplied wrapper around a squadron). Kept a thin wrapper so the
// equip layer has a stable item shape to hang inventory/fabrication off later.
// ---------------------------------------------------------------------------
export interface DronePod {
	// Stable identifier for this pod as an inventory item.
	id: string;
	// The role this pod fields (matches its squadron's role).
	role: DroneRole;
	// The pod's brand/model name (matches its squadron's model).
	model: string;
	// The squadron this pod deploys into a bay.
	squadron: DroneSquadron;
}

// ---------------------------------------------------------------------------
// CONTENT: baseline sizes, brand/model names, per-role stat templates.
// EVERY number here is FIRST-PASS + TUNABLE (design S20 owns the balance pass);
// they are chosen to EXPRESS each role's locked identity (S8), not to be
// balanced against each other yet.
// ---------------------------------------------------------------------------

// Baseline squadron size per role (design S8: Attack 8 / Defense 10 / Support 6),
// before any hangar-tier scaling. The size is the number of drones fielded.
const ROLE_BASE_SIZE: Record<DroneRole, number> = {
	attack: 8,
	defense: 10,
	support: 6,
};

// How many extra drones each hangar TIER adds (design S8: "~+4 at top tier").
// Modules do NOT change count (design S8). FIRST-PASS + TUNABLE.
const TIER_SIZE_STEP = 1;

// Brand/model names per role (CONTENT, like the weapon roster; design S8: drone
// names are "unique per drone, not placeholders"). FIRST-PASS names, evocative
// per role; the factory picks the first as the default model. A real fabricated
// pod would carry its own chosen name from this pool (Phase 9 content). More
// names slot in additively here without touching the sim.
const ROLE_MODELS: Record<DroneRole, string[]> = {
	// Attack: fast, stinging swarm names.
	attack: ["Wasp-class", "Hornet-class", "Shrike-class"],
	// Defense: shielding/guardian names.
	defense: ["Aegis-class", "Bulwark-class", "Sentinel-class"],
	// Support: healer/keeper names.
	support: ["Medic-class", "Lamplighter-class", "Warden-class"],
};

// The per-role stat template. These become the squadron's per-drone stats.
// EXPORTED (Combat 1.0 Unit 2.1a) so the itemgen drone-pod minter (generateDronePod) can look a
// role up here to VALIDATE it and treat this as the pod's fixed "base def", the DRONE analogue of
// WEAPON_DEFS for generateWeapon. Export-only: adds NO runtime behavior, so combat parity is
// untouched (nothing in the sim reads it differently).
export interface RoleTemplate {
	droneHp: number;
	family: WeaponFamily;
	accuracy: number;
	yieldMin: number;
	yieldMax: number;
	range: number;
	evasion: number;
	attackCooldownDeciSec: number;
	// -- Phase 7b defensive fields (see DroneSquadron for full docs). --
	interceptChance: number;
	reflectChance: number;
	supportHullRepair: number;
	droneReplenishRate: number;
}

// Per-role templates expressing the S8 "Squadron attacks" row:
//   Attack  -> zoom in, FAST cooldown, HIGHER yield/drone, short reach, nimble.
//   Defense -> hang back, SLOW cooldown, LOW yield/drone, LONG reach, low evade.
//   Support -> like defense but NO offense in 7a (yield 0); its kit is 7b utility.
// FIRST-PASS + TUNABLE (design S20). The relative ordering (attack > defense >
// support offense) is the durable identity contract; the exact integers move.
export const ROLE_TEMPLATE: Record<DroneRole, RoleTemplate> = {
	attack: {
		droneHp: 20,
		family: "kinetic", // TODO(balance): per-role families
		accuracy: 85,
		yieldMin: 4,
		yieldMax: 6,
		range: BAND_SHORT, // "zoom in" and strike at close reach
		evasion: 40, // nimble: hard to swat when the squadron is TARGETED (7b)
		attackCooldownDeciSec: 5, // fast: a volley every 0.5s
		// GUARDING intercept is LOWER than its self-evasion (40): attack drones do
		// not normally guard, so guarding is a RISKY dodge (design S8). On success it
		// dodges the shot AND lands a solid counterattack (yieldMin..yieldMax).
		interceptChance: 25,
		reflectChance: 0, // attack drones never reflect (that is defense's kit)
		supportHullRepair: 0,
		droneReplenishRate: 20,
	},
	defense: {
		droneHp: 30,
		family: "kinetic",
		accuracy: 80,
		yieldMin: 1,
		yieldMax: 2,
		range: BAND_LONG, // long-range picket by the carrier
		evasion: 15, // low-evade when TARGETED (it blocks/deflects instead)
		attackCooldownDeciSec: 15, // slow: a volley every 1.5s
		// GUARDING deflect is HIGHER than its self-evasion (15): a defense drone is
		// built to intercept (design S8 "HIGHER deflect than self-defense").
		interceptChance: 60,
		// On a successful deflect of a PARTICLE shot, half the time it reflects.
		reflectChance: 50,
		supportHullRepair: 0,
		droneReplenishRate: 15,
	},
	support: {
		droneHp: 15,
		family: "kinetic",
		accuracy: 70,
		// NO offense: support's real kit is utility (repair/cleanse), wired into the
		// tick loop in 7b. yield 0 makes the sim skip its volley entirely (zero combat
		// draws) and route it to the SUPPORT PULSE instead.
		yieldMin: 0,
		yieldMax: 0,
		range: BAND_LONG,
		evasion: 40, // evades like attack WHEN TARGETED (design S8 "evade like Attack")
		attackCooldownDeciSec: 20, // slowest: the support-pulse cadence
		// Support never deflects; guarding the carrier it is a PURE MEAT-SHIELD (0).
		interceptChance: 0,
		reflectChance: 0,
		// Heals the owner 1 hull per alive drone per support pulse (design S8 Mode 3).
		supportHullRepair: 1,
		droneReplenishRate: 25,
	},
};

// ---------------------------------------------------------------------------
// FACTORIES.
// ---------------------------------------------------------------------------

// Build one fresh, full-HP, online drone from a max-HP template value. Each call
// returns an INDEPENDENT object (no shared references), which the squadron
// factory relies on so two squadrons never alias the same drone.
export function makeDrone(hpMax: number): Drone {
	return {
		hp: hpMax,
		hpMax,
		alive: true,
		status: "online",
		repairProgress: 0,
		refabProgress: 0,
	};
}

// Resolve the squadron size for a role: an explicit `size` wins (the caller knows
// exactly how many, e.g. a test or a future affix); otherwise the role baseline
// plus hangar-tier scaling (design S8: size scales with hangar TIER). Clamped to
// at least 1 so a squadron is never empty-by-construction.
function resolveSize(role: DroneRole, size: number | undefined, tier: number): number {
	if (size !== undefined) return Math.max(1, Math.floor(size));
	return Math.max(1, ROLE_BASE_SIZE[role] + tier * TIER_SIZE_STEP);
}

// Build a squadron of `role`. `size` overrides the baseline (else baseline +
// tier scaling); `tier` is the hangar tier (0 = base). Every squadron gets fresh
// drone instances + fresh arrays, so repeated calls are fully independent (the
// sim clones anyway, but independence at construction keeps callers safe too).
//
// `idPrefix` lets a caller field MULTIPLE squadrons of the same role with unique
// ids (e.g. two attack bays); it defaults to the role so a single-of-each loadout
// reads cleanly.
export function makeSquadron(
	role: DroneRole,
	size?: number,
	tier = 0,
	idPrefix?: string,
): DroneSquadron {
	const template = ROLE_TEMPLATE[role];
	const count = resolveSize(role, size, tier);

	// Fresh, independent drones at full strength.
	const drones: Drone[] = [];
	for (let i = 0; i < count; i++) {
		drones.push(makeDrone(template.droneHp));
	}

	return {
		id: `${idPrefix ?? role}Squadron`,
		role,
		mode: ROLE_MODE[role],
		// Default model is the first name in the role's pool (first-pass content).
		model: ROLE_MODELS[role][0],
		drones,
		droneHp: template.droneHp,
		family: template.family,
		accuracy: template.accuracy,
		yieldMin: template.yieldMin,
		yieldMax: template.yieldMax,
		range: template.range,
		evasion: template.evasion,
		attackCooldownDeciSec: template.attackCooldownDeciSec,
		cooldownAccumulator: 0,
		// Phase 7b defensive fields (from the role template). smartReflect is a
		// carrier-exclusive upgrade the factory leaves OFF by default; Phase 9 flips
		// it on for a carrier hull / module.
		interceptChance: template.interceptChance,
		reflectChance: template.reflectChance,
		smartReflect: false,
		supportHullRepair: template.supportHullRepair,
		droneReplenishRate: template.droneReplenishRate,
	};
}

// Build a pod (the equippable wrapper) for `role`, deploying a squadron built
// with the same size/tier rules. Thin wrapper so the Phase 9/12 equip + inventory
// layer has a stable item shape; here it is just squadron-in-a-box.
export function makeDronePod(role: DroneRole, size?: number, tier = 0): DronePod {
	const squadron = makeSquadron(role, size, tier);
	return {
		id: `${role}Pod`,
		role,
		model: squadron.model,
		squadron,
	};
}

// ---------------------------------------------------------------------------
// STATUS SUMMARY (design S8 / S16 UI). Count the squadron's drones per status so
// the combat UI can render the pip row (Online / Disrupted / Refabricating) and a
// live-count readout without re-deriving. Pure read; makes no state change.
// ---------------------------------------------------------------------------
export interface SquadronStatusSummary {
	// Total drones in the squadron (full-strength size, alive or not).
	total: number;
	// Drones still alive (contributing to offense). Derived from the alive flag.
	alive: number;
	// Per-status counts (the three pip colors). In Phase 7a everything is online;
	// disrupted/refabricating populate once 7b drives the transitions.
	online: number;
	disrupted: number;
	refabricating: number;
}

// Tally a squadron's drones per status + alive count.
export function squadronStatusSummary(squadron: DroneSquadron): SquadronStatusSummary {
	let alive = 0;
	let online = 0;
	let disrupted = 0;
	let refabricating = 0;
	for (const drone of squadron.drones) {
		if (drone.alive) alive++;
		switch (drone.status) {
			case "online":
				online++;
				break;
			case "disrupted":
				disrupted++;
				break;
			case "refabricating":
				refabricating++;
				break;
		}
	}
	return {
		total: squadron.drones.length,
		alive,
		online,
		disrupted,
		refabricating,
	};
}
