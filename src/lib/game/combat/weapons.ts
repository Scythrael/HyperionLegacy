// ============================================================================
// combat/weapons.ts -- the v1 weapon roster as DATA (Combat 0.13.0, Phase 3)
//
// The nine v1 weapons (three per family) from design S3, expressed as plain
// CombatWeapon stat lines. This is CONTENT, not logic: the shot pipeline in
// resolveBattle.ts reads these fields and the family triangle / signatures do
// the rest, so tuning a weapon is a one-line data edit here (Omega 9: readable
// as rule-based data, no hidden behavior).
//
// ⚠️ EVERY NUMBER HERE IS FIRST-PASS AND TUNABLE (design S20 owns the balance
// pass). They are chosen to EXPRESS each weapon's locked identity (S3), not to
// be balanced against each other yet. The identity comment on each weapon is the
// durable contract; the exact integers will move.
//
// UNITS recap (see types.ts): cooldownDeciSec is tenths of a second (10 = 1.0s,
// lower = faster fire); accuracy is an integer percent; shieldAttenuation and
// armorPen are integer percents and are ONLY consulted for their signature
// family (particle / kinetic respectively). range is a scalar on the 1D axis
// until Phase 6 turns it into Long/Medium/Short bands; the nominal band anchors
// below keep the roster's relative reach legible in the meantime.
//
// Phase 4 FILLED each weapon's effectSlots with its S3-identity disruption/DoT
// (see per-weapon comments below); the shot pipeline rolls them on hit. Proc +
// escalation chances are FIRST-PASS + TUNABLE; the DEF ID a weapon carries is the
// durable identity contract.
//
// FORWARD HOOKS still deliberately NOT on these records (kept off so the contract
// stays minimal; added additively later):
//   - installCap + class gates + power draw  [Phase 5]
// ============================================================================

import type { CombatWeapon, WeaponFamily } from "./types";
import type { WeaponEffect } from "./statusEffects";

// A tiny builder for a weapon effect slot so the roster reads as intent: which
// disruption/DoT id, its on-hit proc chance, and its base escalation chance (both
// integer percents; escalation is scaled by current rank in applyEffect). EVERY
// number here is FIRST-PASS + TUNABLE (design S20 owns the balance pass); the
// DEF ID each weapon carries is the durable identity contract (design S3).
function fx(
	defId: string,
	procChance: number,
	escalationChance: number,
): WeaponEffect {
	return { defId, procChance, escalationChance };
}

// Nominal range-band anchors on the 1D distance axis (design S6 Long/Medium/
// Short). Phase 6 replaces the scalar `range` with real bands; until then these
// give the roster a legible, consistent reach scale (a Railgun outranges an
// Autocannon, a Torpedo reaches far, etc.). TUNABLE.
const RANGE_LONG = 300;
const RANGE_MEDIUM = 200;
const RANGE_SHORT = 100;

// Base weapon durability (design S9) for the roster TEMPLATES, at quality 0. A
// shared first-pass base keeps the roster legible; a real per-instance ceiling
// (quality raises it via qualityDurabilityMax) arrives with the crafted-equipment
// bridge in the integration phase. TUNABLE (design S20). Templates ship full
// (durability == durabilityMax) at quality 0.
const BASE_WEAPON_DURABILITY = 100;

// A tiny builder so each roster entry states only its identity stats and inherits
// the two always-zero-unless-signature fields + the empty Phase-4 effect slots +
// a zeroed cooldown accumulator. Keeps the roster readable as a table of intent.
function def(
	id: string,
	family: WeaponFamily,
	stats: {
		yieldMin: number;
		yieldMax: number;
		cooldownDeciSec: number;
		accuracy: number;
		projectileCount: number;
		range: number;
		// Reactor load this weapon places on the ship (design S10). Required per
		// weapon so the roster states each draw explicitly; the pure budget helpers
		// (combat/power.ts) sum these against the reactor's powerOutput. FIRST-PASS +
		// TUNABLE (design S20): heavier / higher-impact weapons draw more (a Concussion
		// Torpedo or Railgun costs far more reactor than an Autocannon).
		powerDraw: number;
		// Signature levers default to 0; only the owning family sets them.
		shieldAttenuation?: number;
		armorPen?: number;
		// Up to 2 effect slots (design S3). Defaults to none for weapons whose
		// identity is pure direct damage (Autocannon) or whose kit is a later
		// phase (Point-Defense = anti-drone, Phase 8).
		effectSlots?: WeaponEffect[];
		// AMBUSH ELIGIBILITY (design S7): may this weapon fire in the free hull-direct
		// ambush opener? Defaults to TRUE (most weapons); heavy warheads (Concussion
		// Torpedo) set it false so a hull-direct torpedo cannot be an opener.
		ambushEligible?: boolean;
	},
): CombatWeapon {
	return {
		id,
		// Roster TYPE identity (design S16 flavor layer). Equals the template id here;
		// makeWeaponInstance spreads this template, so a minted instance keeps
		// weaponType even though its per-instance `id` gets mangled to be unique. This
		// is what lets Phase 12 flavor narrate a Railgun differently from an Autocannon.
		weaponType: id,
		family,
		yieldMin: stats.yieldMin,
		yieldMax: stats.yieldMax,
		cooldownDeciSec: stats.cooldownDeciSec,
		accuracy: stats.accuracy,
		projectileCount: stats.projectileCount,
		range: stats.range,
		powerDraw: stats.powerDraw,
		shieldAttenuation: stats.shieldAttenuation ?? 0,
		armorPen: stats.armorPen ?? 0,
		cooldownAccumulator: 0,
		effectSlots: stats.effectSlots ?? [],
		// Ambush-eligible unless the weapon explicitly opts out (Concussion Torpedo).
		ambushEligible: stats.ambushEligible ?? true,
		// Durability (design S9): templates ship full at quality 0. The sim does not
		// roll loss live yet (see the durability.ts SEAM note); quality + a real
		// per-instance ceiling arrive with the equipment bridge (integration phase).
		durability: BASE_WEAPON_DURABILITY,
		durabilityMax: BASE_WEAPON_DURABILITY,
		quality: 0,
	};
}

// ---------------------------------------------------------------------------
// PARTICLE family: +10% vs shields, -10% vs armor, signature Shield Attenuation
// (partial hull damage bleeds through shields). Steady shield-pressure family.
// ---------------------------------------------------------------------------

// Plasma: the moderate, well-rounded particle staple. Middling everything with a
// healthy attenuation so it always chips hull through shields.
// Effect slot 1: strong Plasma Fire DoT (its signature burn), high proc + escalation
// so Plasma reliably stacks the burn (design S3 "strong Plasma Fire DoT").
// Effect slot 2 (Combat 1.0, Unit 1.5): Harmonic Gap (+shield attenuation on the
// target). A shield-bleed particle weapon is the natural home for a debuff that opens
// a gap for MORE particle fire to slip through, so Plasma's own attenuation + the
// growing gap compound: the more it hits, the more each shot bleeds hull. A moderate
// secondary (below the signature burn), matching the roster's first-pass tuning.
export const PLASMA: CombatWeapon = def("plasma", "particle", {
	yieldMin: 18,
	yieldMax: 26,
	cooldownDeciSec: 12, // 1.2s
	accuracy: 80,
	projectileCount: 1,
	range: RANGE_MEDIUM,
	powerDraw: 20, // mid-cost particle staple
	shieldAttenuation: 30, // solid bleed-through
	effectSlots: [fx("plasmaFire", 60, 40), fx("harmonicGap", 45, 30)],
});

// Graviton: a longer-reach particle emitter, slightly lower yield/rate, modest
// attenuation. The "engine-disruptor" flavor lands in Phase 4.
// Effect slot 1: engine disruption (Manifold Overheat, -maneuver) per its "engine-
// disruptor" identity (design S3).
// Effect slot 2 (Combat 1.0, Unit 1.5): Coil Dampening (-outgoing weapon damage on
// the target). A gravitic emitter that warps the target's firing coils reads as a
// soft-power debuff, so Graviton becomes a control emitter: it slows the target's
// thrusters AND saps its guns. A leaner secondary (below the primary), matching the
// roster's first-pass tuning.
export const GRAVITON: CombatWeapon = def("graviton", "particle", {
	yieldMin: 14,
	yieldMax: 20,
	cooldownDeciSec: 14, // 1.4s
	accuracy: 82,
	projectileCount: 1,
	range: RANGE_LONG,
	powerDraw: 18, // slightly leaner long-reach emitter
	shieldAttenuation: 25,
	effectSlots: [fx("manifoldOverheat", 45, 30), fx("coilDampening", 40, 25)],
});

// Voltaic: the anti-shield specialist. High yield that the particle +10%-vs-
// shields lever amplifies, but shieldAttenuation 0 by design: it CANNOT bleed
// through shields, so once shields drop it is a poor hull weapon (particle -10%
// vs armor with no attenuation). Pair it with a kinetic finisher.
// Effect: the anti-shield specialist carries BOTH shield disruptions (Emitter
// Overload = +damage taken, Capacitor Failure = -shield recharge), so it grinds
// a screen down and keeps it down (design S3). TODO(P4/balance): the cross-target
// CHAIN mechanic is not modeled yet (single-target sim); revisit with multi-enemy
// targeting in Phase 6/8.
export const VOLTAIC: CombatWeapon = def("voltaic", "particle", {
	yieldMin: 20,
	yieldMax: 30,
	cooldownDeciSec: 13, // 1.3s
	accuracy: 78,
	projectileCount: 1,
	range: RANGE_MEDIUM,
	powerDraw: 22, // high-yield anti-shield specialist runs hot
	shieldAttenuation: 0, // deliberate: no bleed-through (weak vs hull)
	effectSlots: [fx("capacitorFailure", 50, 35), fx("emitterOverload", 40, 30)],
});

// ---------------------------------------------------------------------------
// KINETIC family: +10% vs armor/hull, hard-walled by shields (never attenuates),
// signature Armor Penetration. The finisher family once shields are down.
// ---------------------------------------------------------------------------

// Railgun: the precision heavy hitter. High yield, high accuracy, slow rate, long
// reach, and high armor penetration so it shreds armored hulls.
// Effect: Targeting Drift (-accuracy debuff on the target) per its precision
// identity (design S3). Modest proc; a heavy hitter, not a disruption platform.
export const RAILGUN: CombatWeapon = def("railgun", "kinetic", {
	yieldMin: 40,
	yieldMax: 55,
	cooldownDeciSec: 20, // 2.0s
	accuracy: 90,
	projectileCount: 1,
	range: RANGE_LONG,
	powerDraw: 30, // heavy precision gun, big reactor bite
	armorPen: 60, // ignores 60% of ablative armor + dampening
	effectSlots: [fx("targetingDrift", 35, 25)],
});

// Autocannon: sustained short-range hull DPS. Low per-shot yield but a very fast
// cooldown and TWO projectiles, so it is reliable chip once shields are gone;
// modest armor-pen. The workhorse.
// Effect: NONE by design (S3: "Autocannon can have none or a light one"). Its
// identity is pure sustained hull DPS, not disruption; effectSlots defaults to [].
export const AUTOCANNON: CombatWeapon = def("autocannon", "kinetic", {
	yieldMin: 6,
	yieldMax: 10,
	cooldownDeciSec: 4, // 0.4s (high rate)
	accuracy: 75,
	projectileCount: 2,
	range: RANGE_SHORT,
	powerDraw: 8, // cheap sustained workhorse
	armorPen: 15,
});

// Concussion Torpedo: the heavy warhead. Very high single-projectile yield, long
// cooldown, low-mid accuracy (swingy: all-or-nothing), decent armor-pen. Barred
// from ambush openers by design (S7), enforced later.
// Effect: Coolant Leak (-speed disruption) per design S3, a heavy warhead that
// also cripples the target's drives. High proc (a torpedo hit is a big event).
export const CONCUSSION_TORPEDO: CombatWeapon = def(
	"concussionTorpedo",
	"kinetic",
	{
		yieldMin: 90,
		yieldMax: 130,
		cooldownDeciSec: 60, // 6.0s
		accuracy: 60,
		projectileCount: 1,
		range: RANGE_LONG,
		powerDraw: 35, // heaviest warhead, priciest to power
		armorPen: 40,
		effectSlots: [fx("coolantLeak", 60, 30)],
		// BARRED from ambush openers (design S7): a hull-direct torpedo would be a
		// delete button. The only v1 weapon that opts out of ambush eligibility.
		ambushEligible: false,
	},
);

// ---------------------------------------------------------------------------
// EW family: -10% vs shields, neutral vs armor, weak direct damage, signature
// Disruption-focused. The support/debuff family (procs are the whole point,
// Phase 4). Carries the anti-drone tools (Phase 8). No attenuation, no armor-pen.
// ---------------------------------------------------------------------------

// Point-Defense Array: fast, accurate, many small projectiles. Mid direct damage
// but great screen coverage; anti-drone role lands in Phase 8 (does NOT hard-
// destroy torpedoes by design).
// Effect: NONE in v1 (S3: "Point-Defense can have none or a light one"). Its
// whole value is the anti-drone screen role in Phase 8, not disruptions; leaving
// effectSlots empty keeps it a pure screen weapon until then.
export const POINT_DEFENSE_ARRAY: CombatWeapon = def(
	"pointDefenseArray",
	"ew",
	{
		yieldMin: 8,
		yieldMax: 12,
		cooldownDeciSec: 5, // 0.5s (high rate)
		accuracy: 92,
		projectileCount: 3, // saturates a drone screen (Phase 8)
		range: RANGE_SHORT,
		powerDraw: 10, // light screen weapon
	},
);

// EMP Cannon: low DIRECT damage on purpose. Its value is disruptions (Phase 4)
// and anti-drone (Phase 8), not raw yield.
// Effect: Weapon Jam (offline chance) + Capacitor Failure (a power/system
// disruption: -shield recharge) per design S3 ("drone damage + stun + power/
// system disruptions"). The EW disruption specialist: two high-proc slots.
export const EMP_CANNON: CombatWeapon = def("empCannon", "ew", {
	yieldMin: 4,
	yieldMax: 8,
	cooldownDeciSec: 16, // 1.6s
	accuracy: 80,
	projectileCount: 1,
	range: RANGE_MEDIUM,
	powerDraw: 25, // disruption platform draws a lot for little damage
	effectSlots: [fx("weaponJam", 55, 40), fx("capacitorFailure", 45, 35)],
});

// Tachyon Burst Emitter: the deliberate EW anti-shield EXCEPTION (design S3: it
// is "buffed vs shields" against the family's normal -10%). Sensor disruptions
// and strong-vs-drones role land later.
// TODO(balance/P4): the anti-shield exception is NOT expressed yet. The Phase 3
// triangle is family-based (EW = -10% vs shields), so Tachyon currently inherits
// the EW column. Its vs-shields buff will arrive via shield disruptions in Phase
// 4 and, if still wanted as a raw-damage lever, a per-weapon triangle override in
// the balance pass. Its stats below give it the best direct yield of the EW
// family as a stand-in for that identity.
// Effect slot 1: Scattering Field (sensor -accuracy) per design S3 ("sensor
// disruptions"). Its vs-shields buff identity is still parked for the balance pass
// (see the TODO above).
// Effect slot 2 (Combat 1.0, Unit 1.5): Sensor Power Drain (-effective range on the
// target). A sensor-disruptor emitter is the natural home for a debuff that browns
// out the target's arrays and closes its horizon, so Tachyon becomes the dedicated
// sensor-warfare weapon: it blinds targeting AND shrinks reach. A strong secondary
// (both slots are sensor disruptions, its whole identity), matching first-pass tuning.
export const TACHYON_BURST_EMITTER: CombatWeapon = def(
	"tachyonBurstEmitter",
	"ew",
	{
		yieldMin: 10,
		yieldMax: 16,
		cooldownDeciSec: 12, // 1.2s
		accuracy: 82,
		projectileCount: 1,
		range: RANGE_MEDIUM,
		powerDraw: 20, // best-yield EW emitter, mid draw
		effectSlots: [fx("scatteringField", 55, 35), fx("sensorPowerDrain", 50, 30)],
	},
);

// ---------------------------------------------------------------------------
// The full roster, keyed by weapon id, for lookup + iteration (tests, enemy
// generation, future equip). Freshly spread on read is the caller's job: these
// are TEMPLATES (cooldownAccumulator 0, effectSlots []), so clone before mounting
// on a combatant so the sim's per-instance mutation never leaks back into the
// shared template (same discipline resolveBattle uses when it clones weapons).
// ---------------------------------------------------------------------------
export const WEAPON_DEFS = {
	plasma: PLASMA,
	graviton: GRAVITON,
	voltaic: VOLTAIC,
	railgun: RAILGUN,
	autocannon: AUTOCANNON,
	concussionTorpedo: CONCUSSION_TORPEDO,
	pointDefenseArray: POINT_DEFENSE_ARRAY,
	empCannon: EMP_CANNON,
	tachyonBurstEmitter: TACHYON_BURST_EMITTER,
} as const satisfies Record<string, CombatWeapon>;

// Stable id union for the v1 roster, so callers referencing a weapon by id get a
// compile error on a typo rather than a runtime miss.
export type WeaponId = keyof typeof WEAPON_DEFS;

// A convenience clone so callers mounting a roster weapon onto a combatant get a
// FRESH instance (own cooldown accumulator + effect-slot array), never a shared
// reference to the template. Give it a unique instance id if two of the same
// weapon are mounted on one ship.
export function makeWeaponInstance(
	id: WeaponId,
	instanceId?: string,
): CombatWeapon {
	const template = WEAPON_DEFS[id];
	return {
		...template,
		id: instanceId ?? template.id,
		effectSlots: [...template.effectSlots],
		cooldownAccumulator: 0,
	};
}
