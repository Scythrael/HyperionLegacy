// ============================================================================
// combat/statusEffects.ts: the unified status-effect system (Combat 0.13.0,
// Phase 4: DoTs + system disruptions + buffs, with ranks)
//
// ONE engine, three flavors of timed effect (design S4). A combatant carries a
// list of active StatusEffect instances; each ticks down every 0.1s step and is
// one of:
//   - "dot"    -> deals damage every tick (Plasma Fire burn). The LOG aggregates
//                 those per-tick damages into ONE line per round; the damage
//                 itself lands every tick (design S4 / S16).
//   - "debuff" -> a timed stat degradation on the AFFLICTED ship (the System
//                 Disruptions table: -accuracy, -recharge, -speed, ...).
//   - "buff"   -> a timed stat improvement (module / support-drone procs, wired
//                 in Phases 6/7; the KIND + application path exist now so a buff
//                 def dropped in later "just works").
//
// WHY ONE ENGINE (not three parallel systems): every effect is "a timed, ranked,
// type-flavored modifier on a combatant" (design S4). Sharing the tick / rank /
// refresh / cleanse machinery keeps the sim loop's status phase a single call and
// means a new disruption is a DATA row in the registry below, never new engine
// code (Omega 4 evolvable foundations, Omega 9 rule-based-as-data).
//
// DETERMINISM CONTRACT (design S0): every OUTCOME-affecting roll here (only the
// rank-escalation roll in v1; flat DoT damage takes NO roll) draws from the
// COMBAT stream passed in, on a schedule that does NOT depend on log generation,
// so offline == live holds exactly. Flat DoT damage is pure integer arithmetic
// (no draw), so a burning ship loses identical hull live and offline.
//
// INTEGER FIXED-POINT everywhere (design S0.4): durations are deci-seconds,
// magnitudes are integer percents, DoT damage is distributed across a round's
// ten ticks via an integer accumulator (the same banked-tenths idiom the sim
// already uses for movement + shield regen), never a float.
// ============================================================================

import type { Rng } from "./rng";

// ---------------------------------------------------------------------------
// CORE TYPES
// ---------------------------------------------------------------------------

// The three flavors of effect that share the engine (design S4). This is the
// author-facing category; the MECHANIC (below) is what the sim actually applies.
export type StatusEffectKind = "dot" | "debuff" | "buff";

// Which ship SYSTEM a disruption attacks, mirroring the S4 table's first column.
// "dot" is the table's "(DoT)" row (a burn is not tied to a targetable system).
// Purely descriptive today (used for UI grouping / flavor); per-type disruption
// RESISTS key off this in Phase 5.
export type StatusEffectSystem =
	| "sensors"
	| "engines"
	| "shields"
	| "weapons"
	| "drones"
	| "dot";

// The stat a debuff/buff scales. These name the S4 "Effect" column targets. Not
// every one is modeled in the sim yet (movement/range/drones arrive in Phases
// 6/8); resolveBattle applies the ones it can cheaply today and TODO-comments the
// rest, but the FULL vocabulary lives here so a disruption def never lacks a home.
export type StatusEffectStat =
	| "accuracy" // Sensors Scattering Field + Weapons Targeting Drift
	| "range" // Sensors Sensor Power Drain          [applied Phase 6: range bands]
	| "maneuver" // Engines Manifold Overheat          [applied Phase 6: evasion]
	| "speed" // Engines Coolant Leak               [applied Phase 6: movement]
	| "damageTaken" // Shields Emitter Overload        [applied Phase 5: defense math]
	| "attenuation" // Shields Harmonic Gap            [applied Phase 5: defense math]
	| "shieldRecharge" // Shields Capacitor Failure
	| "weaponDamage" // Weapons Coil Dampening
	| "weaponOffline" // Weapons Weapon Jam (an offline CHANCE) [applied later: gate]
	| "droneAttackRate"; // Drones Inhibit                [applied Phase 8: drones]

// The MECHANIC a def applies, a discriminated union so the sim switches
// exhaustively:
//   - "dot":       deals `damagePerRankPerRound * rank` hull damage per round,
//                  distributed across the round's ten ticks (design S4).
//   - "statDelta": scales `stat` by `deltaPercentPerRank * rank` percent (a
//                  debuff uses a NEGATIVE delta, a buff a positive one). Rank 1
//                  magnitude ~20% per design S4.
export type StatusEffectMechanic =
	| { readonly type: "dot"; readonly damagePerRankPerRound: number }
	| {
			readonly type: "statDelta";
			readonly stat: StatusEffectStat;
			readonly deltaPercentPerRank: number;
	  };

// A DEFINITION: the immutable template for one disruption/DoT/buff. Content, not
// state. The registry below is a table of these. name/flavor/color are DATA the
// def carries; the actual flavor-LINE selection happens later on the cosmetic
// stream (design S16), so these fields never touch an outcome.
export interface StatusEffectDef {
	// Stable id; also the registry key + the CombatEvent.effectDefId the flavor
	// layer switches on.
	readonly id: string;
	readonly kind: StatusEffectKind;
	readonly system: StatusEffectSystem;
	readonly mechanic: StatusEffectMechanic;
	// How long a fresh application lasts, in deci-seconds (integer). A reapply
	// REFRESHES to this full value (design S4 refresh + escalate stacking).
	readonly durationDeciSec: number;
	// Display + flavor DATA (selection of a flavor line is cosmetic, done later).
	readonly displayName: string;
	readonly flavor: string;
	readonly color: string;
}

// An ACTIVE INSTANCE on a combatant: which def, at what rank, with how long left.
// This is the STATE that lives on Combatant.statusEffects and persists between
// battles (design S4: disruptions tick down over time, not cleared at battle end).
export interface StatusEffect {
	// Which def this is an instance of (registry key).
	readonly defId: string;
	// Current rank, 1..MAX_RANK. Higher rank = bigger effect AND (via applyEffect)
	// a higher escalation chance on the next reapply (design S4).
	rank: number;
	// Deci-seconds remaining before the effect expires (decremented each tick).
	remainingDeciSec: number;
	// SIM-INTERNAL fixed-point accumulator for DoT damage ONLY (0 for non-DoTs).
	// A DoT's per-round damage is spread across the round's ten ticks: each tick
	// banks `damagePerRankPerRound * rank` and releases floor(bank / TICKS_PER_
	// ROUND) whole hull points, keeping the remainder. This is the SAME banked
	// idiom the sim uses for movement/shield regen, so DoT damage stays exact
	// integer per tick with zero float. It happens to live on the instance
	// (rather than a side map) because tickEffects is a pure (combatant,dt)->...
	// function that owns the effect's ongoing state; it starts at 0 and is
	// harmless if persisted.
	dotBank: number;
}

// A weapon's EFFECT SLOT: which disruption/DoT it can inflict, and the integer-
// percent chances governing it (design S3: a weapon rolls up to 2 of these). This
// is the type that fills CombatWeapon.effectSlots (was `unknown[]` in Phase 3).
export interface WeaponEffect {
	// The disruption/DoT this slot inflicts (registry key).
	readonly defId: string;
	// Chance, on a CONNECTING shot, that this effect lands at all, as an integer
	// percent (0..100). Rolled off the combat stream in the shot pipeline.
	readonly procChance: number;
	// BASE escalation chance as an integer percent. When a proc lands on an effect
	// the target ALREADY has, applyEffect rolls escalation at `escalationChance *
	// currentRank` (capped 100) so higher ranks escalate more readily (design S4:
	// higher rank = higher escalation chance). TODO(Phase 5): derive the real
	// escalation chance from the SOURCE weapon's quality + rarity instead of this
	// flat per-slot scalar (design S4).
	readonly escalationChance: number;
}

// ---------------------------------------------------------------------------
// TUNING CONSTANTS (FIRST-PASS; the balance pass owns them, design S20). Grouped
// so there is one obvious knob board. All integer.
// ---------------------------------------------------------------------------

// The rank ceiling: effects escalate 1 -> 2 -> 3 and cap (design S4 "1 -> 2 ->
// 3, a MAX_RANK cap").
export const MAX_RANK = 3;

// Ticks in one narration round (must match resolveBattle's TENTHS_PER_SECOND):
// the denominator that spreads a DoT's per-round damage across the round's ticks.
const TICKS_PER_ROUND = 10;

// Base support-drone cleanse chance (integer percent) at rank 1; it HALVES per
// rank (design S4 / S8: rank1 base, rank2 base/2, rank3 base/4). Consumed by the
// support-drone kit in Phase 8; defined here because it is a property of the
// status-effect system, and unit-tested now.
const CLEANSE_BASE_PERCENT = 60;

// ---------------------------------------------------------------------------
// THE REGISTRY (design S4 System Disruptions table, encoded as data).
//
// DISRUPTIONS: the twelve S4 entries (eleven system debuffs + Plasma Fire DoT).
// BUFFS:       reserved forward hook. Buffs are inflicted by module / support-
//              drone procs in Phases 6/7; one reserved entry proves the buff path
//              works end to end (the engine is kind-agnostic).
// STATUS_EFFECT_DEFS: the merged lookup the helpers + sim resolve ids against.
//
// Every magnitude here is FIRST-PASS + TUNABLE. Rank-1 debuff magnitude is 20%
// per design S4 ("Rank 1 example magnitude ~20%"); a NEGATIVE delta degrades,
// a POSITIVE one worsens-for-the-target (Emitter Overload = +damage taken,
// Harmonic Gap = +attenuation, Weapon Jam = +offline chance). Durations are a
// flat 50 deci-seconds (5s) except the faster-cycling Plasma Fire.
// ---------------------------------------------------------------------------

// A shared default duration so the table reads as intent, not repeated numbers.
const DEFAULT_DURATION_DECISEC = 50; // 5.0s

// Small builder: every def is a debuff-or-buff statDelta or a dot, so the table
// rows below state only what differs. Keeps the registry legible as a table.
function debuffDef(
	id: string,
	system: StatusEffectSystem,
	stat: StatusEffectStat,
	deltaPercentPerRank: number,
	displayName: string,
	flavor: string,
	color: string,
	durationDeciSec: number = DEFAULT_DURATION_DECISEC,
): StatusEffectDef {
	return {
		// Every row built by this helper is a system DISRUPTION, i.e. a debuff. A
		// positive delta (Emitter Overload, Harmonic Gap, Weapon Jam) still WORSENS
		// the afflicted ship, so it is a debuff, not a buff. Buffs live in BUFFS.
		id,
		kind: "debuff",
		system,
		mechanic: { type: "statDelta", stat, deltaPercentPerRank },
		durationDeciSec,
		displayName,
		flavor,
		color,
	};
}

export const DISRUPTIONS: Record<string, StatusEffectDef> = {
	// Sensors -------------------------------------------------------------
	scatteringField: debuffDef(
		"scatteringField",
		"sensors",
		"accuracy",
		-20, // -20% weapon accuracy per rank
		"Scattering Field",
		"Sensor returns dissolve into ghost contacts; targeting solutions slip.",
		"#4fc3f7",
	),
	sensorPowerDrain: debuffDef(
		"sensorPowerDrain",
		"sensors",
		"range",
		-20, // -20% effective sensor/weapon range per rank
		"Sensor Power Drain",
		"Sensor arrays brown out; the horizon closes in.",
		"#4fc3f7",
	),
	// Engines -------------------------------------------------------------
	manifoldOverheat: debuffDef(
		"manifoldOverheat",
		"engines",
		"maneuver",
		-20, // -20% maneuverability per rank
		"Manifold Overheat",
		"Thermal alarms redline the maneuvering thrusters.",
		"#ff8a65",
	),
	coolantLeak: debuffDef(
		"coolantLeak",
		"engines",
		"speed",
		-20, // -20% movement speed per rank
		"Coolant Leak",
		"Coolant venting forces the drives into a limp.",
		"#ff8a65",
	),
	// Shields -------------------------------------------------------------
	emitterOverload: debuffDef(
		"emitterOverload",
		"shields",
		"damageTaken",
		20, // +20% damage taken per rank
		"Emitter Overload",
		"Shield emitters cascade; incoming fire bites deeper.",
		"#ba68c8",
	),
	harmonicGap: debuffDef(
		"harmonicGap",
		"shields",
		"attenuation",
		20, // +20% attenuation bleed-through per rank
		"Harmonic Gap",
		"A harmonic gap opens; particle fire slips through the screen.",
		"#ba68c8",
	),
	capacitorFailure: debuffDef(
		"capacitorFailure",
		"shields",
		"shieldRecharge",
		-20, // -20% shield recharge per rank
		"Capacitor Failure",
		"Shield capacitors falter; the screen refuses to rebuild.",
		"#ba68c8",
	),
	// Weapons -------------------------------------------------------------
	// (Weapons -damage; design S4 left the name pending Power Sag / Emitter
	// Fatigue / Coil Dampening. We pick Coil Dampening. TODO(balance): rename if
	// the final flavor pass prefers another.)
	coilDampening: debuffDef(
		"coilDampening",
		"weapons",
		"weaponDamage",
		-20, // -20% outgoing weapon damage per rank
		"Coil Dampening",
		"Weapon coils sag; every shot lands softer.",
		"#e57373",
	),
	weaponJam: debuffDef(
		"weaponJam",
		"weapons",
		"weaponOffline",
		20, // +20% chance a weapon is offline this shot, per rank
		"Weapon Jam",
		"Feed mechanisms seize; guns cough and fall silent.",
		"#e57373",
	),
	targetingDrift: debuffDef(
		"targetingDrift",
		"weapons",
		"accuracy",
		-20, // -20% weapon accuracy per rank
		"Targeting Drift",
		"Fire-control drifts off-boresight; rounds sail wide.",
		"#e57373",
	),
	// Drones --------------------------------------------------------------
	inhibit: debuffDef(
		"inhibit",
		"drones",
		"droneAttackRate",
		-20, // -20% drone attack rate per rank
		"Inhibit",
		"Squadron comms jam; drones hesitate between passes.",
		"#aed581",
	),
	// DoT -----------------------------------------------------------------
	plasmaFire: {
		id: "plasmaFire",
		kind: "dot",
		system: "dot",
		// 10 hull/round at rank 1, scaling linearly with rank (20 at rank 2, 30 at
		// rank 3). Distributed across the round's ten ticks (1 hull/tick/rank).
		mechanic: { type: "dot", damagePerRankPerRound: 10 },
		durationDeciSec: 30, // 3.0s: a burn cycles faster than a system disruption
		displayName: "Plasma Fire",
		flavor: "Superheated plasma clings to the hull and eats inward.",
		color: "#ff7043",
	},
};

// Reserved BUFF registry (design S4: buffs share the engine; module / support-
// drone procs in Phases 6/7 inflict them). One entry so the buff path is real +
// testable now; a positive delta IMPROVES the holder's stat.
export const BUFFS: Record<string, StatusEffectDef> = {
	overchargedCapacitors: {
		id: "overchargedCapacitors",
		kind: "buff",
		system: "shields",
		mechanic: { type: "statDelta", stat: "shieldRecharge", deltaPercentPerRank: 20 },
		durationDeciSec: DEFAULT_DURATION_DECISEC,
		displayName: "Overcharged Capacitors",
		flavor: "Capacitors run hot; the shield screen rebuilds in a rush.",
		color: "#64b5f6",
	},
};

// The merged lookup the helpers + sim resolve ids against. Kept separate from the
// two authored tables so DISRUPTIONS stays exactly the S4 table (Omega 15: no
// surprise members) while helpers still resolve any id in one place.
export const STATUS_EFFECT_DEFS: Record<string, StatusEffectDef> = {
	...DISRUPTIONS,
	...BUFFS,
};

// Resolve a def by id, failing LOUD on an unknown id rather than silently doing
// nothing (Omega 14: no silent wrong behavior). A missing def is always a caller
// bug (a typo'd effect slot), never a runtime-tolerable condition.
function requireDef(defId: string): StatusEffectDef {
	const def = STATUS_EFFECT_DEFS[defId];
	if (def === undefined) {
		throw new Error(`Unknown status-effect def id: ${defId}`);
	}
	return def;
}

// ---------------------------------------------------------------------------
// PURE HELPERS
// ---------------------------------------------------------------------------

// Scale a base stat by a signed integer-percent delta, floored to an integer and
// clamped at >= 0 (a stat can be zeroed but never negative). This is the ONE
// place a status delta becomes a concrete number, so the sim reads as intent:
//   applyPercentDelta(80, -20) === 64   (accuracy 80 with a rank-1 -20% debuff)
//   applyPercentDelta(50, -40) === 30   (recharge 50 with a rank-2 capacitorFail)
//   applyPercentDelta(80, +20) === 96   (a buff)
export function applyPercentDelta(base: number, deltaPercent: number): number {
	return Math.max(0, Math.floor((base * (100 + deltaPercent)) / 100));
}

// Sum the active percent-delta on a given stat across ALL of a combatant's
// effects (debuffs AND buffs, kind-agnostic: a buff is just a positive delta).
// Multiple effects targeting the same stat stack additively, and each effect's
// contribution scales with its rank. Returns a signed integer percent that the
// sim feeds to applyPercentDelta. Ignores DoT effects (they have no statDelta).
//
//   two rank-1 -20% accuracy debuffs      -> -40
//   one rank-2 -20%/rank accuracy debuff  -> -40
export function activeStatDelta(
	effects: StatusEffect[],
	stat: StatusEffectStat,
): number {
	let total = 0;
	for (const e of effects) {
		const mech = requireDef(e.defId).mechanic;
		if (mech.type === "statDelta" && mech.stat === stat) {
			total += mech.deltaPercentPerRank * e.rank;
		}
	}
	return total;
}

// The support-drone cleanse chance for an effect at `rank`, HALVING per rank
// (design S4 / S8: rank1 base, rank2 base/2, rank3 base/4). Integer percent.
// Consumed by the Phase-8 support kit; defined + tested here as a property of the
// status system.
export function cleanseChance(rank: number): number {
	// Halve the base once per rank above 1: base >> (rank - 1) via integer divide.
	const clampedRank = Math.max(1, Math.floor(rank));
	let value = CLEANSE_BASE_PERCENT;
	for (let r = 1; r < clampedRank; r++) {
		value = Math.floor(value / 2);
	}
	return value;
}

// Apply an effect to a combatant's effect list, returning a NEW array (the sim
// reassigns combatant.statusEffects to the result). Encodes the design S4 stacking
// rule "refresh + tier-escalation, capped, no unbounded stacks":
//   - NOT present   -> add a fresh rank-1 instance (no escalation roll).
//   - already present -> REFRESH its duration to full AND roll escalation: a
//     COMBAT-stream chance of `escalationChance * currentRank` percent (capped
//     100) bumps the rank by one, up to MAX_RANK. Higher current rank => higher
//     escalation chance (design S4). At MAX_RANK the rank cannot climb, so no
//     escalation roll is drawn (the schedule stays deterministic either way).
//
// The escalation roll is the ONLY rng draw in this module; it comes from the
// COMBAT stream and is independent of log generation, preserving offline == live.
export function applyEffect(
	effects: StatusEffect[],
	defId: string,
	escalationChance: number,
	rng: Rng,
): StatusEffect[] {
	const def = requireDef(defId);
	// Copy the instances so the returned array is a fresh, independently-mutable
	// list (purity: the caller's prior array is never mutated in place).
	const next: StatusEffect[] = effects.map((e) => ({ ...e }));
	const existing = next.find((e) => e.defId === defId);

	if (existing === undefined) {
		// First application: rank 1, full duration, zeroed DoT bank.
		next.push({
			defId,
			rank: 1,
			remainingDeciSec: def.durationDeciSec,
			dotBank: 0,
		});
		return next;
	}

	// Reapplication: refresh duration regardless of whether the rank climbs.
	existing.remainingDeciSec = def.durationDeciSec;

	// Escalation: only meaningful below the cap. Scale the base chance by the
	// current rank so higher ranks escalate more readily (design S4), capped 100.
	if (existing.rank < MAX_RANK) {
		const effectiveChance = Math.min(100, escalationChance * existing.rank);
		if (rng.chance(effectiveChance, 100)) {
			existing.rank += 1;
		}
	}
	return next;
}

// The per-tick damage a single DoT effect deals this step, using the banked-
// tenths accumulator on the instance. Mutates `effect.dotBank`, returns the whole
// hull points released this tick (0 if this tick only banked a fraction). Pure
// integer: banks `damagePerRankPerRound * rank * dt` and releases floor(bank /
// TICKS_PER_ROUND), keeping the remainder, so the round total is exactly
// `damagePerRankPerRound * rank` regardless of how it splits across ticks.
function dotDamageThisTick(
	effect: StatusEffect,
	def: StatusEffectDef,
	dtDeciSec: number,
): number {
	if (def.mechanic.type !== "dot") return 0;
	effect.dotBank += def.mechanic.damagePerRankPerRound * effect.rank * dtDeciSec;
	const whole = Math.floor(effect.dotBank / TICKS_PER_ROUND);
	if (whole <= 0) return 0;
	effect.dotBank -= whole * TICKS_PER_ROUND;
	return whole;
}

// The result of ticking one combatant's effects for one step.
export interface TickEffectsResult {
	// DoT hull damage dealt THIS tick, keyed by def id, so resolveBattle can
	// accumulate it per round and emit one aggregated log line per DoT per round
	// (design S4 / S16). Empty when no DoT dealt whole damage this tick.
	dotDamageByDef: Map<string, number>;
	// True if this tick's DoT damage brought the combatant to <= 0 hull (so the
	// caller can log a destruction + let the objective read `alive`).
	killed: boolean;
}

// Advance a combatant's status effects by one step (design S4 tick phase):
//   1. Apply each DoT's per-tick hull damage (internal burn; bypasses shields,
//      straight to hull per design S4). Accumulate per def for the round log.
//   2. Decrement every effect's duration; drop any that expired this tick.
// Mutates the combatant in place (matching resolveBattle's mutate-the-clone
// pattern) and returns the DoT damage + whether the DoT was lethal.
//
// PARITY: this makes NO combat-stream draws in v1 (flat DoT is pure arithmetic),
// so it runs identically offline and live and cannot perturb the roll schedule.
// The `rng` param is accepted for the FORWARD case where DoT tick damage varies
// (design S4 "DoT tick damage if it varies" would draw from combat); v1 does not
// draw. TODO(balance): variance on DoT ticks would draw rng here.
export function tickEffects(
	combatant: {
		hull: number;
		alive: boolean;
		statusEffects: StatusEffect[];
	},
	dtDeciSec: number,
	// Forward hook (see doc above): unused in v1's flat DoT, hence the leading
	// underscore so the compiler's noUnusedParameters accepts the reserved slot.
	_rng: Rng,
): TickEffectsResult {
	const dotDamageByDef = new Map<string, number>();

	// A dead ship's effects do nothing (they persist untouched; the battle is
	// ending anyway). No draw, no damage.
	if (!combatant.alive) {
		return { dotDamageByDef, killed: false };
	}

	const survivors: StatusEffect[] = [];
	for (const effect of combatant.statusEffects) {
		const def = requireDef(effect.defId);

		// STEP 1: DoT damage this tick (internal, straight to hull).
		const dot = dotDamageThisTick(effect, def, dtDeciSec);
		if (dot > 0) {
			combatant.hull -= dot;
			dotDamageByDef.set(effect.defId, (dotDamageByDef.get(effect.defId) ?? 0) + dot);
		}

		// STEP 2: decrement duration; keep only effects with time left. An effect
		// deals its damage FIRST, then may expire this same tick (design S4: it
		// ticks, then expires).
		effect.remainingDeciSec -= dtDeciSec;
		if (effect.remainingDeciSec > 0) {
			survivors.push(effect);
		}
	}
	combatant.statusEffects = survivors;

	// Death bookkeeping: a DoT can be the killing blow. Single source of truth for
	// liveness (the loop + objective read `alive`, never re-derive).
	let killed = false;
	if (combatant.hull <= 0 && combatant.alive) {
		combatant.alive = false;
		killed = true;
	}

	return { dotDamageByDef, killed };
}
