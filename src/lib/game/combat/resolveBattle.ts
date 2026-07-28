// ============================================================================
// combat/resolveBattle.ts -- the deterministic fixed-timestep combat simulator
// (Combat 0.13.0, Phase 3: real shot pipeline + weapon families)
//
// THE ONE ENTRY POINT for resolving any battle. `resolveBattle(participants,
// seed, options?)` is a PURE function of its inputs (design S0 principle 1):
// same participants + same seed => identical outcome, ALWAYS, on any device,
// live or offline. Two hard invariants govern everything here:
//
//   1. OFFLINE == LIVE (design S0 principle 2). The OUTCOME must be identical
//      whether or not we build the log / pick flavor. We achieve this by
//      pulling every outcome-affecting roll from the `combat` RNG stream on a
//      FIXED schedule that does not depend on options.generateLog, and pushing
//      log events / touching the `cosmetic` stream ONLY when generateLog is on.
//      Offline callers pass generateLog:false, skip all cosmetic work, and get
//      the exact same winner.
//
//   2. INTEGER FIXED-POINT TIME (design S0 principle 4). The sim clock is an
//      integer tick counter in DECI-SECONDS (1 tick = 1 dt = 0.1s). Per-second
//      rates (movement speed, shield recharge) are converted to per-tick motion
//      through integer ACCUMULATORS (tenths banked until a whole unit is due),
//      never floats, so there is zero cross-device float drift.
//
// This is a SKELETON. Movement is "close toward the nearest target", and the
// shot is a clearly-marked PLACEHOLDER (a single hit roll + flat damage). Phase
// 3 replaces the shot with the real pipeline (families, accuracy vs evasion,
// projectiles, crit, variance, mitigation order); Phases 4/8 add status effects
// and drones at the seams already stubbed in the loop. The value of the
// skeleton is that battles actually RESOLVE, so the flagship determinism /
// parity / termination tests are meaningful now and keep guarding the invariant
// as later phases fill in the real mechanics.
// ============================================================================

import type {
	BattleObjective,
	BattleOutcome,
	BattleParticipants,
	Combatant,
	CombatEvent,
	CombatWeapon,
	WeaponFamily,
} from "./types";
import { lastTeamStanding } from "./types";
import type { DroneSquadron, Drone } from "./drones";
// Phase 7b DEFENSIVE helpers (the pure half of the drone defense model). This
// module orchestrates them: it routes a shot's projectiles through the target's
// drone screen and reuses these small, unit-tested facts (particle-only reflect,
// HP absorption, reflect-target pick, defender ordering, replenishment, cleanse).
import {
	canReflect,
	absorbWithDrone,
	selectReflectTarget,
	availableDefenders,
	replenishDrones,
	supportCleanse,
} from "./droneDefense";
import type { Defender } from "./droneDefense";
import { makeStreams, type Rng } from "./rng";
import {
	applyEffect,
	tickEffects,
	activeStatDelta,
	applyPercentDelta,
} from "./statusEffects";
import {
	stancePreferredDistance,
	stanceMoveDelta,
	selectTarget,
	bandFor,
	longestWeaponRange,
	combatPhase,
} from "./positioning";
import { selectFlavorTemplate, FLAVOR_PICK_RANGE } from "./flavor";

// ---------------------------------------------------------------------------
// attachFlavor: select a cosmetic flavor line for a log event and stamp it on.
//
// The ONE place the sim consumes the `cosmetic` stream (design S0 principle 3):
// draw a single integer, let flavor.ts pick the most-specific template for this
// event, and store that raw template on `event.flavor` (names/numbers bind later
// at render). Returns the same event so call sites read `log.push(attachFlavor(
// {...}, cosmetic))`.
//
// CRITICAL ISOLATION CONTRACT: this touches ONLY the cosmetic stream, never the
// combat stream, so it cannot move any outcome. Every caller invokes it INSIDE a
// `generateLog` guard, so offline resolution never calls it, draws zero cosmetic
// state, and stays byte-identical to live (the flagship parity invariant).
// ---------------------------------------------------------------------------
function attachFlavor(event: CombatEvent, cosmetic: Rng): CombatEvent {
	event.flavor = selectFlavorTemplate(event, cosmetic.nextInt(FLAVOR_PICK_RANGE));
	return event;
}

// One simulation step is 1 deci-second. Named so the "0.1s" intent is explicit
// wherever we advance a clock or a cooldown, and so it is a single knob if the
// step size is ever retuned (design S1 calls the step a tunable).
const DT_DECISEC = 1;

// Tenths of a second in one whole second. This is the denominator for the
// per-second-rate accumulators: bank `rate` tenths each tick, and every time
// the bank reaches TENTHS_PER_SECOND, one whole unit (of movement / shield) is
// due. Keeps rate math in pure integers.
const TENTHS_PER_SECOND = 10;

// Hard cap on simulated time: 60 seconds = 600 deci-second ticks. Bounded work
// (design S0 principle 5, Omega 14): no battle can loop forever. If the cap is
// hit, we stop and tiebreak by hull% (see below) so two uncrackable tanks
// resolve deterministically instead of hanging offline catch-up.
const MAX_TICKS = 600;

// ---------------------------------------------------------------------------
// OPENER / AMBUSH TUNING (design S7, Phase 6). FIRST-PASS + TUNABLE (design S20).
// ---------------------------------------------------------------------------

// How long (deci-seconds) the AMBUSHED party is stunned before its firing timer
// starts, after the ambush's first hit lands (design S7: "the ambushed party's
// firing timer starts only AFTER that first hit lands"). Its weapons hold (no
// cooldown accrual) until tick reaches this value; movement + shields + status
// still tick. 10 = 1.0s.
const AMBUSH_RETURN_DELAY_DECISEC = 10;

// The SHORTENED return-fire delay when the ambushed party carries a Rapid-Charge
// counter-module (Combatant.rapidChargeAfterAmbush, design S7). Strictly less
// than the base delay so the module is a real mitigation. 3 = 0.3s.
const RAPID_CHARGE_RETURN_DELAY_DECISEC = 3;

// ---------------------------------------------------------------------------
// SHOT-PIPELINE TUNING CONSTANTS (all FIRST-PASS, a balance pass owns them,
// design S20). Grouped here so the balance pass has one obvious knob board and
// so the pipeline code below reads as intent, not magic numbers. Every value is
// integer / integer-percent so the math stays drift-proof (design S0.4).
// ---------------------------------------------------------------------------

// Base crit chance per landed projectile, as numerator/denominator (design S2.3
// "base crit ~5-10%"). Rolled with combat.chance(CRIT_CHANCE_NUM, CRIT_CHANCE_DEN).
// TODO(balance): make crit chance a per-weapon field so weapons differ.
const CRIT_CHANCE_NUM = 1;
const CRIT_CHANCE_DEN = 10; // 10%

// Crit damage multiplier as a fraction CRIT_MULT_NUM / CRIT_MULT_DEN (design
// S2.3 "1.5x"). Applied to a projectile's raw damage as integer floor math.
// TODO(balance): per-weapon crit multipliers.
const CRIT_MULT_NUM = 3;
const CRIT_MULT_DEN = 2; // 1.5x

// The damage-type triangle (design S3), as integer percents applied via
// floor(dmg * mult / 100). Two columns: the multiplier used while the target
// still has shields up (vs Shields) vs once shields are down (vs Armor/Hull).
//
// DESIGN CHOICE (documented): the design table is CONTEXTUAL ("+10% vs Shields",
// "+10% vs Armor"). Rather than split a single shot's damage across both columns
// (which forces messy fractional overflow accounting), Phase 3 picks ONE column
// per shot from the target's CURRENT shield state at the instant the shot lands:
// shields up => vs-Shields column, shields down => vs-Armor column. This exactly
// matches the design narrative ("Particle chips through shields; Kinetic shreds
// the exposed hull once shields drop") and keeps the math a single integer
// multiply. TODO(balance): if a finer per-pool split is ever wanted, scale the
// shield-absorbed portion and the hull-path portion independently instead.
//
// "vs Drones" (design S3: Kinetic -10%, EW +10%, Particle 0%) is INERT until the
// drone sub-system lands (Phase 8); only the shield/armor columns apply now.
const FAMILY_VS_SHIELDS: Record<WeaponFamily, number> = {
	particle: 110, // +10% vs shields (its specialty)
	kinetic: 100, //   neutral vs shields (hard-walled, no attenuation)
	ew: 90, //         -10% vs shields (weak direct damage)
};
const FAMILY_VS_ARMOR: Record<WeaponFamily, number> = {
	particle: 90, //  -10% vs armor/hull (poor once shields drop)
	kinetic: 110, //  +10% vs armor/hull (the finisher)
	ew: 100, //        neutral vs armor/hull
};

// Options that tune HOW resolveBattle runs WITHOUT changing the outcome. The
// only knob today is generateLog. Kept as an object so later phases add flags
// (e.g. objective override, telemetry) without churning the call sites.
export interface ResolveOptions {
	// When true (LIVE watching): build the structured event log and allow
	// cosmetic-stream draws for flavor selection. When false/undefined (OFFLINE
	// catch-up, the default): skip all of that and produce ONLY the outcome. The
	// outcome is byte-identical either way; that equivalence is the whole point.
	generateLog?: boolean;
	// Optional objective override. Defaults to lastTeamStanding. Present so
	// Patrol / other mission types plug in their own win condition (design S1:
	// objective is pluggable data) without touching the loop.
	objective?: BattleObjective;

	// PHASE 6 ENCOUNTER OPEN (design S6): weapons PRE-CHARGE during the close so the
	// first weapon to enter range fires its charged salvo immediately (no cooldown
	// wait). Modeled by seeding every weapon's cooldownAccumulator to its
	// cooldownDeciSec at battle start, so it is ready on the first tick it is in
	// range (the longest-range weapon fires the opener; shorter guns join as the
	// distance closes). Default false so synthetic fixtures (co-located, immediate
	// fire) are unchanged; the mission layer (Phase 9) opens real encounters with
	// precharge:true. TODO(Phase 9): the mission dispatch sets this for a normal open.
	precharge?: boolean;

	// PHASE 6 AMBUSH (design S7), SYMMETRIC: the combatant id of the AMBUSHER (the
	// player can ambush too), or undefined for no ambush. The ambusher lands a free
	// opening salvo that strikes HULL DIRECTLY (bypassing the not-yet-raised shields)
	// with its ambush-eligible weapons ONLY (Concussion Torpedo is barred), and the
	// ambushed target's return fire is delayed. An enemy CLOAK opener is modeled as
	// an ambush with the enemy as ambusher (design S7: cloak is a flavor of ambush).
	// The two counter-modules (Combatant.particleTraceDetector / rapidChargeAfterAmbush)
	// can downgrade or soften it. Default undefined => no ambush, zero new draws, so
	// every existing fixture is byte-identical. The mission layer sets this per
	// encounter (Phase 9). TODO(Phase 9): derive the ambusher from mission + stealth.
	ambush?: string;
}

// Transient per-combatant fixed-point accumulators. These are SIM-INTERNAL
// working state, NOT part of the persisted Combatant shape, so we keep them in
// a side Map keyed by combatant id rather than polluting types.ts. Each holds
// "banked tenths" that convert per-second rates into whole per-tick units.
interface Accumulators {
	// Banked tenths of a position-unit from movement speed.
	move: number;
	// Banked tenths of a shield-point from shield recharge.
	shield: number;
}

// Deep-ish clone of the participant list so resolveBattle NEVER mutates the
// caller's objects (purity: the caller can resolve the same battle twice, or
// keep using its ships afterward, with zero side effects). Combatants + their
// weapons + their DRONE SQUADRONS are the mutable things the sim writes to, so we
// deep-copy those; the statusEffects array is copied by reference-into-fresh-array.
function cloneParticipants(participants: BattleParticipants): BattleParticipants {
	return {
		combatants: participants.combatants.map((c) => ({
			...c,
			// Fresh weapon objects: the sim advances cooldownAccumulator on these,
			// which must not leak back into the caller's data.
			weapons: c.weapons.map((w) => ({ ...w })),
			// Fresh statusEffects array so in-sim mutation is isolated.
			statusEffects: [...c.statusEffects],
			// Phase 7a: DEEP-copy each squadron AND its per-drone list. The sim mutates
			// squadron.cooldownAccumulator + each drone's hp/alive/status, so a shallow
			// copy would leak those writes back into the caller (breaking purity + a
			// second resolve of the same battle). Squadrons/drones are plain data, so a
			// spread per level is a full clone.
			drones: c.drones.map((sq) => ({
				...sq,
				drones: sq.drones.map((d) => ({ ...d })),
			})),
		})),
	};
}

// Target selection is the Phase 6 policy in positioning.ts (selectTarget):
// focus-fire the lowest effective-HP enemy IN RANGE, falling back to the lowest
// effective-HP enemy overall to close on when none are reachable yet, with a
// deterministic id tiebreak. It also carries the reserved escort-share seam
// (Phase 7/9). The sim imports it rather than keeping a divergent local copy.

// Move `self` toward its STANCE's preferred distance from `target` along the 1D
// position axis (design S6), using the banked-tenths accumulator so a per-SECOND
// speed becomes exact integer motion per 0.1s tick. Closes if too far, kites if
// too close, holds at the preferred point (never overshoots): the geometry is the
// pure stanceMoveDelta helper; this function only owns the fixed-point speed
// banking + the debuff-scaled effective speed.
function advanceMovement(
	self: Combatant,
	target: Combatant,
	acc: Accumulators,
): void {
	// PHASE 6 DEBUFF (applied): Coolant Leak (-speed) scales the EFFECTIVE movement
	// speed DOWN before banking. Read the combatant's summed `speed` delta (a
	// negative percent for a coolant leak) and apply it to the base speed. Pure
	// integer scaling of an already-integer rate, no combat draw, so parity holds
	// (offline == live) and a leak-free ship is byte-identical (zero delta = no-op).
	const speedDelta = activeStatDelta(self.statusEffects, "speed");
	const effectiveSpeed =
		speedDelta !== 0 ? applyPercentDelta(self.speed, speedDelta) : self.speed;

	// Bank this tick's worth of tenths (effective speed tenths per second * dt).
	acc.move += effectiveSpeed * DT_DECISEC;
	// Convert whole banked units into position steps; keep the remainder banked.
	const wholeSteps = Math.floor(acc.move / TENTHS_PER_SECOND);
	if (wholeSteps <= 0) return;
	acc.move -= wholeSteps * TENTHS_PER_SECOND;

	// Step toward the stance's preferred distance (signed: + closes, - kites, 0
	// holds). stanceMoveDelta caps the step so we never overshoot the preferred
	// point and holds when co-located (gap 0), which preserves the co-located
	// parity fixtures (both at position 0 stay put).
	const preferred = stancePreferredDistance(self.stance);
	self.position += stanceMoveDelta(
		self.position,
		target.position,
		preferred,
		wholeSteps,
	);
}

// Regenerate shields using the banked-tenths accumulator (per-second recharge
// -> exact integer points per tick), clamped to shieldMax. Dead ships and full
// shields do nothing. Design S2.5b: shields tick back during drawn-out fights,
// rewarding burst damage.
function advanceShieldRegen(self: Combatant, acc: Accumulators): void {
	if (!self.alive) return;
	if (self.shield >= self.shieldMax) return;
	// PHASE 4 DEBUFF (applied): Capacitor Failure reduces shieldRecharge. Scale the
	// per-second recharge by the combatant's active shieldRecharge delta (a summed
	// negative percent) before banking it. Pure integer scaling of an
	// already-integer rate: no combat draw, so parity (offline == live) is intact.
	const rechargeDelta = activeStatDelta(self.statusEffects, "shieldRecharge");
	const effectiveRecharge = applyPercentDelta(self.shieldRecharge, rechargeDelta);
	acc.shield += effectiveRecharge * DT_DECISEC;
	const wholePoints = Math.floor(acc.shield / TENTHS_PER_SECOND);
	if (wholePoints <= 0) return;
	acc.shield -= wholePoints * TENTHS_PER_SECOND;
	self.shield = Math.min(self.shieldMax, self.shield + wholePoints);
}

// Result of firing one weapon: the aggregate of every projectile in the shot +
// the target's post-shot snapshot, so the OPTIONAL log event is built from real
// values without re-deriving them. Returned even when generateLog is off (cheap
// struct) so the fire path is single and the combat-stream draw schedule is
// identical regardless of logging (the parity invariant).
interface ShotResult {
	fired: boolean;
	// How many projectiles connected (0 => the whole volley was evaded).
	projectilesHit: number;
	// Total damage dealt to the target across all projectiles (integer).
	damage: number;
	// True if any projectile critically hit.
	crit: boolean;
	// True if this (particle) shot bled damage through shields via attenuation.
	attenuated: boolean;
	shieldAfter: number;
	hullAfter: number;
	killed: boolean;
	// Phase 4: which effect-slot disruptions/DoTs this shot LANDED on the target
	// (empty if the weapon has no slots or none proc'd). Collected always (cheap)
	// so the OPTIONAL "effectApplied" log events are built from real data without
	// re-deriving; the effect application itself already happened in fireWeapon.
	appliedEffects: string[];

	// -- Phase 7b DRONE-DEFENSE fields (all default 0 / empty for a droneless
	// target, keeping a screen-less shot byte-identical to the 7a result). --
	// How many of this shot's projectiles a drone ENGAGED (deflected, absorbed, or
	// evaded+countered). Lets the flavor layer narrate "the screen caught 2 of 3".
	dronesEngaged: number;
	// How many of the carrier's drones this shot DESTROYED (HP penetrated).
	dronesDestroyed: number;
	// COLLATERAL hits this shot caused on OTHER combatants: a reflected shot back at
	// the attacker (or a smart-reflect priority foe) and an attack-drone
	// counterattack. Applied inside fireWeapon (so the mutation + death are done);
	// surfaced here only so the tick loop can LOG them (parity: log-only).
	collateral: CollateralHit[];
}

// One reflect/counter hit landed on a combatant OTHER than the shot's target, as a
// by-product of the target's drone screen (design S8 reflect + attack-drone
// counterattack). Data only; the damage was already applied in fireWeapon.
interface CollateralHit {
	// The combatant that took the collateral damage.
	targetId: string;
	// Damage actually dealt (post-mitigation, integer).
	damage: number;
	// Which drone behavior produced it, so flavor can distinguish the two.
	kind: "reflect" | "counter";
	// True if this collateral hit destroyed that combatant.
	killed: boolean;
}

// ---------------------------------------------------------------------------
// Apply ONE projectile's already-rolled raw damage to a target through the
// STRICT mitigation order (design S2.5): family triangle -> attenuation split
// (particle) -> shields -> armor (ablative deplete then dampening %, with
// kinetic armor-pen) -> hull. Mutates the target's shield/hull/ablativeArmor.
// Returns the total damage that reached the target (shield loss + hull loss),
// plus whether this projectile attenuated, so the caller can aggregate + log.
//
// PURE INTEGER MATH throughout (floor on every scaling) so the outcome is
// bit-identical on every device. No combat-stream draws happen here; the raw
// damage + crit were already rolled by the caller, keeping the draw schedule in
// one place (fireWeapon) for parity auditing.
// ---------------------------------------------------------------------------
export function applyProjectileDamage(
	target: Combatant,
	family: WeaponFamily,
	weaponShieldAttenuation: number,
	weaponArmorPen: number,
	rawAfterCrit: number,
	// PHASE 6 AMBUSH (design S7): when true, this shot strikes HULL DIRECTLY, as if
	// the target's shields are not up yet. The shield POOL is bypassed entirely (no
	// absorption, no attenuation split) and the shot uses the vs-Armor triangle
	// column (shields notionally down). Armor + dampening + hull still apply (an
	// ambush skips the deflector screen, not the hull plating). Default false keeps
	// every normal shot byte-identical (the regression default for all fixtures).
	bypassShields = false,
): { dealt: number; attenuated: boolean } {
	// STEP 4 (triangle): pick ONE column. Normally from the target's CURRENT shield
	// state (shields up => vs-Shields, shields down => vs-Armor); a hull-direct
	// ambush always uses the vs-Armor column (shields are down for this shot). See
	// FAMILY_VS_* above for why a single column per shot rather than a per-pool split.
	const triangleMult = bypassShields
		? FAMILY_VS_ARMOR[family]
		: target.shield > 0
			? FAMILY_VS_SHIELDS[family]
			: FAMILY_VS_ARMOR[family];
	const dmgAfterTriangle = Math.floor((rawAfterCrit * triangleMult) / 100);

	// STEP 4b (per-family DAMAGE RESIST, design S5). A flat TYPE resist applied to
	// the raw typed damage BEFORE any mitigation stage (shields / armor / hull),
	// which is the design-consistent spot: design S2.4 forms the raw typed damage
	// from "the family triangle multiplier AND per-type resists" together, then
	// mitigation (step 5) acts on the result. We place it right after the triangle
	// (both are properties of the damage TYPE) so the whole shot, including the
	// particle attenuation split below, is computed off the already-resisted
	// number. Integer floor math, clamped 0..100, so 0 resist is a no-op (the
	// regression default that keeps every zero-resist fixture byte-identical).
	const damageResistPct = Math.max(0, Math.min(100, target.damageResist[family]));
	const dmg =
		damageResistPct > 0
			? Math.floor((dmgAfterTriangle * (100 - damageResistPct)) / 100)
			: dmgAfterTriangle;

	// Track total damage actually removed from the target (for logging + the
	// aggregate the caller sums), and whether this projectile attenuated.
	const shieldBefore = target.shield;
	let hullPath = 0;
	let attenuated = false;

	if (bypassShields) {
		// PHASE 6 AMBUSH hull-direct: the shield pool is not up, so the ENTIRE shot
		// routes to the hull-path with no shield absorption and no attenuation split
		// (attenuation is a particle-vs-shields interaction; there is no shield to
		// slip past here). The shield value is left untouched (the test asserts the
		// first ambush hit does not scratch the shield).
		hullPath += dmg;
	} else {
		// STEP 5a (attenuation, PARTICLE ONLY): a net fraction skips shields straight
		// to the hull-path. net = max(0, weaponShieldAttenuation - shieldCoherence).
		// Kinetic + EW never attenuate (their signature is armor-pen / disruption).
		let toShields = dmg;
		if (family === "particle") {
			const netAttenPct = Math.max(
				0,
				weaponShieldAttenuation - target.shieldCoherence,
			);
			if (netAttenPct > 0) {
				const bypass = Math.floor((dmg * netAttenPct) / 100);
				if (bypass > 0) {
					hullPath += bypass;
					toShields = dmg - bypass;
					attenuated = true;
				}
			}
		}

		// STEP 5b (shields): the non-attenuated portion is absorbed up to the current
		// shield pool; the overflow continues to the hull-path.
		if (target.shield > 0) {
			const absorbed = Math.min(target.shield, toShields);
			target.shield -= absorbed;
			hullPath += toShields - absorbed;
		} else {
			hullPath += toShields;
		}
	}

	// STEP 5c (armor on the hull-path): ablativeArmor is a DEPLETING buffer that
	// soaks first, then kineticDampening is a flat percent reduction. Kinetic
	// weapons apply Armor Penetration: they IGNORE weaponArmorPen percent of BOTH
	// the ablative buffer and the dampening for this shot (the ignored armor is
	// not consumed).
	if (hullPath > 0) {
		let effectiveArmor = target.ablativeArmor;
		let effectiveDampenPct = target.kineticDampening;
		if (family === "kinetic" && weaponArmorPen > 0) {
			const penComplement = 100 - Math.min(100, weaponArmorPen);
			effectiveArmor = Math.floor((effectiveArmor * penComplement) / 100);
			effectiveDampenPct = Math.floor((effectiveDampenPct * penComplement) / 100);
		}

		// Ablative soak: reduce the hull-path damage and DEPLETE the real buffer by
		// what it actually soaked (never below what pen let us reach).
		if (effectiveArmor > 0) {
			const soaked = Math.min(hullPath, effectiveArmor);
			hullPath -= soaked;
			target.ablativeArmor = Math.max(0, target.ablativeArmor - soaked);
		}

		// Dampening: flat percent reduction on whatever remains.
		if (hullPath > 0 && effectiveDampenPct > 0) {
			const keptPct = 100 - Math.min(100, effectiveDampenPct);
			hullPath = Math.floor((hullPath * keptPct) / 100);
		}
	}

	// STEP 5d (hull): the remainder lands on hull. Hull may go negative; the
	// caller's death check reads `alive`, never re-derives from a clamped value.
	if (hullPath > 0) {
		target.hull -= hullPath;
	}

	// Total damage the target actually lost = shield drained + hull-path landed.
	const shieldLost = shieldBefore - target.shield;
	return { dealt: shieldLost + hullPath, attenuated };
}

// ---------------------------------------------------------------------------
// DRONE-DEFENSE CONTEXT (Phase 7b). Threaded into fireWeapon ONLY from the normal
// tick-loop firing path, carrying the full combatant list the reflect / smart-
// reflect target pick needs. When it is undefined (the AMBUSH opener, design S7:
// a surprise strike slips past the screen), NO drone interception happens and the
// draw schedule is exactly the 7a one, so the ambush fixtures stay byte-identical.
// TODO(balance): decide if a detected/less-surprising ambush lets the screen react.
// ---------------------------------------------------------------------------
interface DroneDefenseContext {
	combatants: Combatant[];
}

// ---------------------------------------------------------------------------
// PER-PROJECTILE DRONE INTERCEPT (design S8 interaction matrix). Decide what ONE
// defending drone does with ONE incoming projectile that has already ROLLED its
// raw damage. This is the branch table that IS the drone AI:
//
//   CARRIER IS TARGETED (targeted=false, a normal shot the screen guards against):
//     - defense: DEFLECT roll (interceptChance, higher than self-evasion). Success
//       + PARTICLE => reflect roll (reflectChance): reflect the shot back (attacker
//       or smart-reflect priority) else harmless block. Success + kinetic/EW =>
//       harmless block (particle-only reflect). Fail => absorb with HP, overflow to
//       carrier, drone may die.
//     - support: PURE MEAT-SHIELD, no roll: absorb with HP, overflow to carrier,
//       drone may die.
//     - attack: RISKY guarding EVADE (interceptChance, lower than self-evasion).
//       Success => a solid COUNTERATTACK at the attacker (drone unharmed). Fail =>
//       absorb with HP, overflow to carrier, drone may die.
//
//   SQUADRON IS TARGETED (targeted=true, an antiDrone weapon aimed at the drones):
//     - attack/support: EVADE roll (self-evasion). Success => nothing. Fail => take
//       the hit, die if HP penetrated. No overflow to the carrier (aimed at drones).
//     - defense: DEFLECT/reflect exactly as above; destroyed only if HP penetrated;
//       no carrier overflow.
//
// Every yes/no is one COMBAT-stream draw; a counterattack draws its damage too.
// Mutates the drone's HP/status (via absorbWithDrone). Returns a PLAN the caller
// executes (carrier overflow + collateral reflect/counter) so all applyProjectile-
// Damage calls stay in fireWeapon (one mitigation site for parity auditing).
// ---------------------------------------------------------------------------
interface InterceptPlan {
	// Raw (pre-mitigation) damage that spilled past the drone onto the carrier; the
	// caller routes it through applyProjectileDamage. 0 when fully stopped or when a
	// squadron-targeted (antiDrone) shot was spent on the drone.
	carrierOverflow: number;
	// A reflected (particle) shot to apply to another combatant, if any.
	reflect?: { target: Combatant; damage: number };
	// An attack-drone counterattack to apply to the attacker, if any.
	counter?: { target: Combatant; damage: number; family: WeaponFamily };
	// True if this projectile destroyed the engaging drone.
	droneDestroyed: boolean;
}

function planIntercept(
	defender: Defender,
	weapon: CombatWeapon,
	raw: number,
	attacker: Combatant,
	carrier: Combatant,
	combatants: Combatant[],
	targeted: boolean,
	combat: Rng,
): InterceptPlan {
	const { squadron, drone } = defender;
	const role = squadron.role;

	// DEFENSE: deflect/reflect in BOTH the carrier-targeted and squadron-targeted
	// cases (a defense drone's whole job is to block, whoever it is shielding).
	if (role === "defense") {
		if (combat.chance(squadron.interceptChance, 100)) {
			// Deflected. PARTICLE-ONLY reflect: roll whether it bounces back.
			if (canReflect(weapon.family) && combat.chance(squadron.reflectChance, 100)) {
				const reflectTarget = selectReflectTarget(
					carrier,
					attacker,
					combatants,
					squadron.smartReflect,
				);
				return {
					carrierOverflow: 0,
					reflect: { target: reflectTarget, damage: raw },
					droneDestroyed: false,
				};
			}
			// Harmless block (non-particle, or a particle that did not reflect).
			return { carrierOverflow: 0, droneDestroyed: false };
		}
		// Failed deflect: absorb with HP; overflow leaks to the carrier UNLESS this
		// was squadron-targeted anti-drone fire (spent on the drone).
		const { overflow, destroyed } = absorbWithDrone(drone, raw);
		return { carrierOverflow: targeted ? 0 : overflow, droneDestroyed: destroyed };
	}

	// SUPPORT.
	if (role === "support") {
		if (targeted) {
			// Squadron-targeted: evade like attack (design S8 "evade like Attack").
			if (combat.chance(squadron.evasion, 100)) {
				return { carrierOverflow: 0, droneDestroyed: false };
			}
			const { destroyed } = absorbWithDrone(drone, raw);
			return { carrierOverflow: 0, droneDestroyed: destroyed };
		}
		// Carrier-targeted: PURE MEAT-SHIELD, no roll. Absorb + overflow to carrier.
		const { overflow, destroyed } = absorbWithDrone(drone, raw);
		return { carrierOverflow: overflow, droneDestroyed: destroyed };
	}

	// ATTACK.
	if (targeted) {
		// Squadron-targeted: it is being HUNTED, so it just tries to evade (no
		// counterattack: it is not guarding the carrier here).
		if (combat.chance(squadron.evasion, 100)) {
			return { carrierOverflow: 0, droneDestroyed: false };
		}
		const { destroyed } = absorbWithDrone(drone, raw);
		return { carrierOverflow: 0, droneDestroyed: destroyed };
	}
	// Carrier-targeted: risky guarding intercept. Success dodges AND counterattacks.
	if (combat.chance(squadron.interceptChance, 100)) {
		const counterDamage = combat.nextRange(squadron.yieldMin, squadron.yieldMax);
		return {
			carrierOverflow: 0,
			counter: { target: attacker, damage: counterDamage, family: squadron.family },
			droneDestroyed: false,
		};
	}
	const { overflow, destroyed } = absorbWithDrone(drone, raw);
	return { carrierOverflow: overflow, droneDestroyed: destroyed };
}

// ---------------------------------------------------------------------------
// THE REAL SHOT PIPELINE (design S2), replacing the Phase 2 placeholder.
//
// One shot fires `projectileCount` projectiles. Per projectile, in order, all
// rolls off the COMBAT stream:
//   1/2. Hit: roll clamp(accuracy - evasion, 0, 100) percent. A projectile that
//        misses deals nothing. If EVERY projectile misses, the whole shot reads
//        as an evade (design S2.1). Each projectile rolls independently (design
//        S2.2): single-projectile weapons are swingy, multi-projectile reliable.
//   3.   Crit: each connecting projectile rolls crit for a damage multiplier.
//   4.   Raw damage: an integer in [yieldMin, yieldMax], times crit.
//   5.   Mitigation (triangle -> attenuation -> shields -> armor -> hull): done
//        by applyProjectileDamage above.
//
// ⚠️ CRITICAL FOR PARITY: every combat-stream draw happens HERE, on a schedule
// that does NOT depend on generateLog (a miss draws only its hit roll; a hit
// draws hit + crit + damage; a CONNECTING shot then draws one proc roll per
// effect slot, plus an escalation roll when a proc lands on an existing effect).
// Logging/flavor never adds or removes a combat draw, so the outcome is
// byte-identical live vs offline.
//
// PHASE 4 DEBUFFS applied here (all read the ATTACKER's OWN active effects, so no
// state is threaded into the pure applyProjectileDamage function and its exact-
// integer tests stay intact): Scattering Field / Targeting Drift reduce the
// attacker's outgoing accuracy; Coil Dampening reduces its outgoing raw damage.
// Both are deterministic post-draw scalings, so they never shift the draw count.
// ---------------------------------------------------------------------------
export function fireWeapon(
	self: Combatant,
	target: Combatant,
	weapon: CombatWeapon,
	combat: Rng,
	// PHASE 6 AMBUSH: when true (the ambush opener), every projectile strikes hull
	// directly (bypasses the shield pool). Default false for the normal firing loop.
	bypassShields = false,
	// PHASE 7b DRONE DEFENSE: the normal firing path passes this so an incoming shot
	// is contested by the TARGET's drone screen (the "Carrier/Squadron is targeted"
	// matrix rows). Undefined (the ambush opener) => no interception, 7a draw
	// schedule. A droneless target also makes zero extra draws (the parity guard).
	defenseCtx?: DroneDefenseContext,
): ShotResult {
	// PHASE 4 DEBUFF (applied): the attacker's accuracy debuffs (Scattering Field,
	// Targeting Drift) scale weapon accuracy DOWN before the evasion subtraction.
	const accuracyDelta = activeStatDelta(self.statusEffects, "accuracy");
	const effectiveAccuracy = applyPercentDelta(weapon.accuracy, accuracyDelta);
	// PHASE 6 DEBUFF (applied): the TARGET's Manifold Overheat (-maneuver) scales its
	// EVASION down (design S6: maneuverability feeds evasion). A negative maneuver
	// delta reduces evasion => the ship is EASIER to hit while its thrusters overheat.
	// Zero delta => applyPercentDelta(evasion, 0) == evasion, so an unafflicted target
	// is byte-identical (parity). This only moves the hit THRESHOLD, never the draw.
	const maneuverDelta = activeStatDelta(target.statusEffects, "maneuver");
	const effectiveEvasion =
		maneuverDelta !== 0 ? applyPercentDelta(target.evasion, maneuverDelta) : target.evasion;
	// Per-projectile hit chance: (debuffed) accuracy reduced by the target's
	// (maneuver-scaled) evasion, clamped to a valid percent. No minimum floor, so a 0
	// net chance is a guaranteed miss (the evade tests rely on this) and >= 100 sure.
	const hitChance = Math.max(0, Math.min(100, effectiveAccuracy - effectiveEvasion));

	// PHASE 4 DEBUFF (applied): the attacker's weapon-damage debuff (Coil
	// Dampening) scales every projectile's raw damage DOWN. Computed once per shot.
	const weaponDamageDelta = activeStatDelta(self.statusEffects, "weaponDamage");

	let projectilesHit = 0;
	let totalDealt = 0;
	let anyCrit = false;
	let anyAttenuated = false;

	// PHASE 7b: build the TARGET's drone screen ONCE for this shot (design S8:
	// "up to N drones pulled into the intercept"). Empty when there is no defense
	// context (the ambush path) or the target owns no online drones, so a droneless
	// shot makes ZERO extra draws below (the parity guard). `targeted` = this weapon
	// aims at the drones themselves (antiDrone), selecting the squadron-targeted
	// matrix row for whichever drone engages.
	const defenders: Defender[] =
		defenseCtx !== undefined ? availableDefenders(target) : [];
	const targeted = weapon.antiDrone === true;
	let dronesEngaged = 0;
	let dronesDestroyed = 0;
	const collateral: CollateralHit[] = [];

	// Apply a reflect/counterattack hit to a combatant OTHER than the shot's target
	// (design S8). Routes through the SAME mitigation (particle for a reflect, the
	// drone's family for a counter) + death bookkeeping, and records it for logging.
	function applyCollateral(
		victim: Combatant,
		family: WeaponFamily,
		damage: number,
		kind: "reflect" | "counter",
	): void {
		// A reflect/counter carries no attenuation/armor-pen signature (0/0): it is a
		// bounced/return bolt, not the original weapon's shaped shot. TODO(balance):
		// let a reflect inherit the source weapon's attenuation.
		const { dealt } = applyProjectileDamage(victim, family, 0, 0, damage);
		let killed = false;
		if (victim.hull <= 0 && victim.alive) {
			victim.alive = false;
			killed = true;
		}
		collateral.push({ targetId: victim.id, damage: dealt, kind, killed });
	}

	// Fire each projectile independently. projectileCount is >= 1 by contract; a
	// bad 0/negative count would simply fire nothing (defensive, no throw).
	for (let p = 0; p < weapon.projectileCount; p++) {
		// STEP 1/2: hit roll (one combat draw, always).
		const hit = combat.chance(hitChance, 100);
		if (!hit) continue; // missed projectile: no crit/damage draw, no damage

		projectilesHit++;

		// STEP 3: crit roll (one combat draw per connecting projectile).
		const crit = combat.chance(CRIT_CHANCE_NUM, CRIT_CHANCE_DEN);
		if (crit) anyCrit = true;

		// STEP 4: raw damage in [yieldMin, yieldMax] (one combat draw), * crit, then
		// scaled by the attacker's Coil Dampening weapon-damage debuff (deterministic
		// post-draw scaling; does not change the draw count).
		let raw = combat.nextRange(weapon.yieldMin, weapon.yieldMax);
		if (crit) {
			raw = Math.floor((raw * CRIT_MULT_NUM) / CRIT_MULT_DEN);
		}
		if (weaponDamageDelta !== 0) {
			raw = applyPercentDelta(raw, weaponDamageDelta);
		}

		// PHASE 7b INTERCEPT: each projectile pulls the NEXT available defender (one
		// drone per projectile, design S8 saturation). If the screen is thinner than
		// the projectile count, `defender` is undefined for the surplus projectiles
		// and they LEAK straight to the carrier (the 7a path below). All intercept
		// draws happen inside planIntercept, only when a defender exists (parity).
		const defender: Defender | undefined = p < defenders.length ? defenders[p] : undefined;
		if (defender !== undefined) {
			dronesEngaged++;
			const plan = planIntercept(
				defender,
				weapon,
				raw,
				self,
				target,
				defenseCtx!.combatants,
				targeted,
				combat,
			);
			if (plan.droneDestroyed) dronesDestroyed++;
			// A reflected (particle) shot bounces onto the attacker or a smart-reflect
			// priority foe; an attack-drone counter hits the attacker. Apply + record.
			if (plan.reflect !== undefined) {
				applyCollateral(plan.reflect.target, "particle", plan.reflect.damage, "reflect");
			}
			if (plan.counter !== undefined) {
				applyCollateral(plan.counter.target, plan.counter.family, plan.counter.damage, "counter");
			}
			// Overflow past the drone (if any) lands on the carrier through normal
			// mitigation. A fully-stopped / anti-drone-spent projectile has 0 overflow.
			if (plan.carrierOverflow > 0) {
				const { dealt, attenuated } = applyProjectileDamage(
					target,
					weapon.family,
					weapon.shieldAttenuation,
					weapon.armorPen,
					plan.carrierOverflow,
					bypassShields,
				);
				totalDealt += dealt;
				if (attenuated) anyAttenuated = true;
			}
			continue;
		}

		// STEP 5 (no defender): mitigation. Applies triangle + attenuation + shields +
		// armor + hull to THIS projectile against the target's live state (so a volley
		// that breaks the shield mid-way correctly switches the triangle column
		// and stops attenuating once shields are gone).
		const { dealt, attenuated } = applyProjectileDamage(
			target,
			weapon.family,
			weapon.shieldAttenuation,
			weapon.armorPen,
			raw,
			bypassShields,
		);
		totalDealt += dealt;
		if (attenuated) anyAttenuated = true;
	}

	// PHASE 4 (design S2.6): on a CONNECTING shot, roll each effect slot's proc off
	// the combat stream; on success apply it to the target with rank escalation.
	// Rolled ONCE per shot (design says "on hit"), AFTER the projectile loop, so a
	// multi-projectile weapon does not multiply its proc odds. Weapons with no
	// slots (effectSlots []) draw nothing here, which is exactly why the flagship
	// parity fixtures (all empty-slot) keep an identical draw schedule. The draw
	// order is fixed and independent of generateLog.
	const appliedEffects: string[] = [];
	if (projectilesHit > 0) {
		// PHASE 5 (design S5): the target's per-family DISRUPTION RESIST cuts this
		// weapon-family's procs, DUAL-purpose with its damage resist. It lowers BOTH
		// the proc chance AND the escalation chance (rank), computed once per shot as
		// a deterministic pre-roll scaling. Because it only changes the THRESHOLD of
		// rolls we already draw (never whether we draw), the combat-stream schedule
		// is unchanged, so parity (offline == live) holds and a zero-resist target is
		// byte-identical to before. Clamped 0..100; 0 = no-op.
		const disruptionResistPct = Math.max(
			0,
			Math.min(100, target.disruptionResist[weapon.family]),
		);
		const resistKept = 100 - disruptionResistPct; // percent of chance retained
		for (const slot of weapon.effectSlots) {
			// Cut the proc chance by the family disruption resist (integer floor).
			const effectiveProcChance =
				disruptionResistPct > 0
					? Math.floor((slot.procChance * resistKept) / 100)
					: slot.procChance;
			// One proc roll per slot, always (whether or not it lands). The DRAW
			// happens unconditionally; resist only moves the pass threshold.
			if (!combat.chance(effectiveProcChance, 100)) continue;
			// Cut the escalation chance the same way, so resist also suppresses RANK
			// growth (design S5 "the chance + rank"): a resisted target is both less
			// likely to be disrupted AND less likely to have it escalate.
			const effectiveEscalationChance =
				disruptionResistPct > 0
					? Math.floor((slot.escalationChance * resistKept) / 100)
					: slot.escalationChance;
			// It landed: apply (add rank 1, or refresh + roll escalation if the target
			// already has it). applyEffect draws the escalation roll from the SAME
			// combat stream, only when refreshing an un-capped effect.
			target.statusEffects = applyEffect(
				target.statusEffects,
				slot.defId,
				effectiveEscalationChance,
				combat,
			);
			appliedEffects.push(slot.defId);
		}
	}

	// PHASE 5 DURABILITY SEAM (design S9): a connecting hit is a durability "damage
	// event" for the TARGET's systems. The pure model + roll live in
	// combat/durability.ts (rollDurabilityLoss / systemCondition), fully unit
	// tested. We deliberately do NOT roll it here yet: a live combat-stream draw
	// per hit would shift the fixed roll schedule the flagship parity + Phase 3/4
	// mechanic fixtures pin, and durability is not yet synced to real game
	// equipment (that is the integration phase). When the equipment-durability
	// bridge lands, this is exactly where the loop calls rollDurabilityLoss on the
	// target's damaged systems (and, per S9, optionally the firing weapon), using
	// `combat` so offline == live holds. TODO(integration): wire rollDurabilityLoss
	// here + sync to equipment durability.

	// Death bookkeeping: hull at or below 0 means destroyed. Single source of
	// truth for liveness (the loop + objective read `alive`, never re-derive).
	let killed = false;
	if (target.hull <= 0 && target.alive) {
		target.alive = false;
		killed = true;
	}

	return {
		fired: true,
		projectilesHit,
		damage: totalDealt,
		crit: anyCrit,
		attenuated: anyAttenuated,
		shieldAfter: target.shield,
		hullAfter: target.hull,
		killed,
		appliedEffects,
		dronesEngaged,
		dronesDestroyed,
		collateral,
	};
}

// ---------------------------------------------------------------------------
// DRONE SQUADRON VOLLEY (design S8, Phase 7a OFFENSE). Aggregate of every ALIVE,
// ONLINE drone that fired this volley at the owner's target. Returned always
// (cheap struct) so the OPTIONAL log event is built from real values and the
// combat-stream draw schedule is identical regardless of logging (parity).
// ---------------------------------------------------------------------------
interface VolleyResult {
	// A volley actually happened (the squadron has offense AND at least one alive,
	// online drone). False => nothing fired, ZERO combat draws (support in 7a, or a
	// wiped squadron), so no log/cosmetic work either.
	fired: boolean;
	// How many drones connected (0 => the whole volley was evaded).
	dronesHit: number;
	// Total damage dealt to the target across every connecting drone (integer).
	damage: number;
	shieldAfter: number;
	hullAfter: number;
	killed: boolean;
}

// ---------------------------------------------------------------------------
// Fire ONE drone squadron's volley (design S8 "Squadron attacks" row). Each
// ALIVE, ONLINE drone independently rolls its own hit (drone accuracy vs the
// target's maneuver-scaled evasion) and, on a hit, its ~1/size damage, applied
// through the SAME mitigation as a weapon shot (applyProjectileDamage). Drones
// are many small kinetic attackers: NO crit, NO effect procs, NO attenuation/
// armor-pen (shieldAttenuation/armorPen passed 0), keeping the model simple for
// 7a. TODO(balance): per-role families + optional drone crit.
//
// ⚠️ PARITY: every combat-stream draw happens HERE, on a schedule independent of
// generateLog: one hit roll per participating drone, plus one damage roll per
// CONNECTING drone. A squadron with no offense (yieldMax 0, i.e. Support in 7a)
// or no alive drones draws NOTHING and returns fired:false. Output scales with
// the ALIVE drone count (design S8): dead drones are skipped, so fewer drones =>
// fewer draws => less damage (which sets up 7b, where drones get destroyed).
// ---------------------------------------------------------------------------
function fireSquadron(
	self: Combatant,
	target: Combatant,
	squadron: DroneSquadron,
	combat: Rng,
): VolleyResult {
	// NO-OFFENSE short-circuit (Support in 7a): a zero-yield squadron never fires,
	// so it draws nothing and cannot perturb the combat stream. Its real kit is
	// utility (repair/cleanse), built in Phase 7b. Void `self` so the unused-param
	// lint is honest while the signature stays uniform with fireWeapon (7b reads
	// `self` for the carrier interactions).
	void self;
	if (squadron.yieldMax <= 0) {
		return {
			fired: false,
			dronesHit: 0,
			damage: 0,
			shieldAfter: target.shield,
			hullAfter: target.hull,
			killed: false,
		};
	}

	// The target's evasion, scaled by its Manifold Overheat (-maneuver) debuff
	// exactly as fireWeapon does (design S6: maneuverability feeds evasion). Zero
	// delta => nominal evasion, so an unafflicted target is byte-identical. This
	// only moves the hit THRESHOLD, never the draw count.
	const maneuverDelta = activeStatDelta(target.statusEffects, "maneuver");
	const effectiveEvasion =
		maneuverDelta !== 0 ? applyPercentDelta(target.evasion, maneuverDelta) : target.evasion;
	// Per-drone hit chance: the squadron's accuracy reduced by the target's evasion,
	// clamped to a valid percent (no floor: a 0 net chance is a guaranteed miss).
	const hitChance = Math.max(0, Math.min(100, squadron.accuracy - effectiveEvasion));

	let dronesHit = 0;
	let totalDealt = 0;
	// Did ANY drone actually participate this volley? A squadron whose drones are
	// all dead/offline fires nothing (fired:false => no draws happened above the
	// per-drone guards, and no log/cosmetic work downstream).
	let anyFired = false;

	for (const drone of squadron.drones) {
		// Output scales with ALIVE count: a destroyed drone contributes nothing (and
		// draws nothing). Disrupted/refabricating drones cannot strike either (their
		// status transitions land in 7b; in 7a every alive drone is "online").
		if (!drone.alive) continue;
		if (drone.status !== "online") continue;
		anyFired = true;

		// STEP 1/2: this drone's hit roll (one combat draw per participating drone).
		if (!combat.chance(hitChance, 100)) continue; // missed: no damage draw
		dronesHit++;

		// STEP 4: raw damage in [yieldMin, yieldMax] (one combat draw per hit). No
		// crit for drones in 7a (TODO balance).
		const raw = combat.nextRange(squadron.yieldMin, squadron.yieldMax);

		// STEP 5: mitigation, same strict order as a weapon shot. Drones carry no
		// particle attenuation or kinetic armor-pen (0/0), so they route through
		// shields -> armor -> hull cleanly against the target's live state.
		const { dealt } = applyProjectileDamage(
			target,
			squadron.family,
			0, // shieldAttenuation: drones do not attenuate
			0, // armorPen: drones do not penetrate armor
			raw,
		);
		totalDealt += dealt;
	}

	// Death bookkeeping: mirror fireWeapon. Single source of truth for liveness.
	let killed = false;
	if (target.hull <= 0 && target.alive) {
		target.alive = false;
		killed = true;
	}

	return {
		fired: anyFired,
		dronesHit,
		damage: totalDealt,
		shieldAfter: target.shield,
		hullAfter: target.hull,
		killed,
	};
}

// Compute the winner when the hard tick cap is reached: the team with the
// highest TOTAL hull% remaining (design S1 tiebreak). Percentages are compared
// as integer cross-multiplications to avoid any float, and an exact tie yields
// "draw". Deterministic given the final combatant state.
function tiebreakByHullPercent(
	combatants: Combatant[],
): "player" | "enemy" | "draw" {
	// Sum hull and hullMax per team; team hull% = sumHull / sumHullMax.
	let playerHull = 0;
	let playerMax = 0;
	let enemyHull = 0;
	let enemyMax = 0;
	for (const c of combatants) {
		// Clamp negative hull to 0 for the ratio (a corpse contributes 0, not a
		// negative that would skew the sum).
		const hull = Math.max(0, c.hull);
		if (c.team === "player") {
			playerHull += hull;
			playerMax += c.hullMax;
		} else {
			enemyHull += hull;
			enemyMax += c.hullMax;
		}
	}
	// Guard against divide-by-zero maxes (empty team): treat 0-max as 0%.
	// Compare playerHull/playerMax vs enemyHull/enemyMax via cross-multiply:
	//   player% > enemy%  <=>  playerHull * enemyMax > enemyHull * playerMax
	const left = playerHull * enemyMax;
	const right = enemyHull * playerMax;
	if (left > right) return "player";
	if (right > left) return "enemy";
	return "draw";
}

// ---------------------------------------------------------------------------
// AMBUSH OPENER (design S7, Phase 6). Resolve the ambusher's free opening salvo
// before the main loop: it strikes HULL DIRECTLY (shields not up yet) with the
// ambusher's ambush-eligible weapons only, and stuns the target's return fire.
//
// SYMMETRIC (either side can be the ambusher) and used for CLOAK too (a cloaked
// enemy is just the ambusher). Two counter-modules on the TARGET can change the
// outcome: a Particle-Trace Detector (combat-stream chance) can detect the ambush
// and raise shields, downgrading the hull-direct strike to a normal shielded
// opener and cancelling the delay; a Rapid-Charge module shortens the delay.
//
// PARITY: every RNG draw here is on the COMBAT stream and runs unconditionally
// when an ambush is set (the detector roll, then each salvo shot's hit/crit/
// damage/proc draws), so offline == live. Only the log pushes are gated on
// generateLog. Mutates the target's hull/shield + populates returnFireReadyTick.
// ---------------------------------------------------------------------------
function resolveAmbushOpener(
	ambusherId: string,
	combatants: Combatant[],
	combat: Rng,
	cosmetic: Rng,
	generateLog: boolean,
	log: CombatEvent[],
	returnFireReadyTick: Map<string, number>,
	// DISPLAY-ONLY (Phase 12b): the set of combatant ids that have fired at least
	// once, so the round-0 phase readout can show the ambusher already "firing". A
	// pure narration record; only written under generateLog, only read by the phase
	// derivation, never gates a shot.
	hasFired: Set<string>,
): void {
	// The ambusher must exist + be alive to open. An unknown/dead id is a caller
	// mistake we tolerate silently (no opener) rather than throw mid-battle.
	const ambusher = combatants.find((c) => c.id === ambusherId && c.alive);
	if (ambusher === undefined) return;

	// The surprised party is the ambusher's focus-fire target. The opener IGNORES
	// the range gate: the ambusher chose the moment (a cloak decloaks already in
	// range), so it can strike even from the long-range encounter open.
	const target = selectTarget(ambusher, combatants);
	if (target === undefined) return;

	// DETECTOR (design S7): the AMBUSHED target's Particle-Trace Detector is an
	// integer-percent COMBAT-stream chance to see the ambush coming and raise
	// shields, downgrading the strike to a shielded opener + cancelling the delay.
	// 0 = no module, no draw (keeps the draw schedule tied to real detector gear).
	let detected = false;
	if (target.particleTraceDetector > 0) {
		detected = combat.chance(target.particleTraceDetector, 100);
	}

	// Fire each AMBUSH-ELIGIBLE weapon once. Heavy weapons (Concussion Torpedo,
	// ambushEligible false) are BARRED (design S7: a hull-direct torpedo is a delete
	// button). Hull-direct unless the target detected + shielded up. Track whether
	// ANY eligible weapon actually fired: an ambusher packing only barred weapons
	// lands no opener, so there is no free salvo AND no return-fire stun (the ambush
	// fizzles) rather than a phantom stun with no hit behind it.
	const bypassShields = !detected;
	let firedOpener = false;
	for (const weapon of ambusher.weapons) {
		if (!weapon.ambushEligible) continue;
		firedOpener = true;
		const shot = fireWeapon(ambusher, target, weapon, combat, bypassShields);
		// DISPLAY-ONLY (Phase 12b): record that the ambusher opened fire, so the
		// round-0 phase readout narrates it as "firing" from the outset. Gated on
		// generateLog (the set is only read by the phase readout, itself log-only),
		// so offline never populates it.
		if (generateLog && shot.fired) hasFired.add(ambusher.id);
		// LOG ONLY (gated): an "ambush" event so the flavor layer narrates the
		// surprise salvo distinctly (result flags hull-direct vs a detected shielded
		// opener). Stamped at t=0 (the opener precedes tick 1). attachFlavor draws
		// the cosmetic pick (cosmetic-only, cannot move the outcome).
		if (generateLog && shot.fired) {
			log.push(
				attachFlavor(
					{
						tDeciSec: 0,
						round: 0,
						type: "ambush",
						actorId: ambusher.id,
						targetId: target.id,
						damage: shot.damage,
						result: detected ? "shielded" : "hullDirect",
						shieldAfter: shot.shieldAfter,
						hullAfter: shot.hullAfter,
						family: weapon.family,
						weaponType: weapon.weaponType,
						crit: shot.crit,
						attenuated: shot.attenuated,
						projectilesHit: shot.projectilesHit,
					},
					cosmetic,
				),
			);
			if (shot.killed) {
				log.push(
					attachFlavor(
						{
							tDeciSec: 0,
							round: 0,
							type: "destroyed",
							actorId: ambusher.id,
							targetId: target.id,
							result: "destroyed",
							shieldAfter: shot.shieldAfter,
							hullAfter: shot.hullAfter,
						},
						cosmetic,
					),
				);
			}
		}
	}

	// RETURN-FIRE DELAY (design S7). A detected ambush (shields up, not caught
	// unaware) or a fizzled one (no eligible weapon fired) imposes NO delay.
	// Otherwise the target is stunned for the base delay, SHORTENED by a Rapid-Charge
	// counter-module. Its weapons hold until this tick.
	if (!detected && firedOpener) {
		const delay = target.rapidChargeAfterAmbush
			? RAPID_CHARGE_RETURN_DELAY_DECISEC
			: AMBUSH_RETURN_DELAY_DECISEC;
		returnFireReadyTick.set(target.id, delay);
	}
}

// ---------------------------------------------------------------------------
// PHASE 12b PER-ROUND ARENA READOUT (design S16 combat view). Emit one
// "roundState" event per LIVING combatant, carrying its range readout (distance
// to its current target + the derived band) and its engagement phase (detection
// -> intercept -> weapons-ready -> firing). This is the structured data the
// combat view renders the range track + band label + phase narration from.
//
// DISPLAY-ONLY / OUTCOME-NEUTRAL by construction:
//   - Called ONLY under generateLog (offline never builds the log, so it emits
//     none of these and stays byte-identical).
//   - It READS the sim state the main loop already computed (positions, weapons,
//     the same selectTarget policy) and derives band/phase via the pure
//     positioning.ts helpers (bandFor / longestWeaponRange / combatPhase, the
//     single source of truth for the thresholds). It draws NO RNG, mutates
//     nothing, and gates no shot.
//   - It does NOT attach flavor (no cosmetic-stream draw): the view renders these
//     from the band/phase enums + the distance number directly. That also leaves
//     every OTHER event's cosmetic flavor selection byte-identical to before this
//     phase existed (the P12b-1 replay-parity guarantee).
//
// PER-COMBATANT (not one aggregate) so the readout is fully general: each ship
// has its own distance-to-target and phase, and escorts / multi-ship encounters
// (later phases) fall out for free. The view picks the row it wants to feature
// (the player's) for the primary range track. A combatant with no living enemy
// (its side has won) has no engagement to read, so it is skipped.
// ---------------------------------------------------------------------------
function emitRoundState(
	combatants: Combatant[],
	round: number,
	tDeciSec: number,
	hasFired: Set<string>,
	log: CombatEvent[],
): void {
	for (const self of combatants) {
		if (!self.alive) continue;
		// The same focus-fire policy the loop uses, so the readout's target matches
		// the ship the sim is actually engaging. No living enemy => no readout.
		const target = selectTarget(self, combatants);
		if (target === undefined) continue;

		const distance = Math.abs(self.position - target.position);
		const band = bandFor(distance);
		const phase = combatPhase(
			round,
			distance,
			longestWeaponRange(self),
			hasFired.has(self.id),
		);

		log.push({
			tDeciSec,
			round,
			type: "roundState",
			actorId: self.id,
			targetId: target.id,
			distance,
			band,
			phase,
		});
	}
}

// The public simulator. See file header for the two invariants it upholds.
//
// RETURN SHAPE:
//   outcome         -- the resolved BattleOutcome (winner/reason/rounds).
//   log             -- the structured event stream (empty when generateLog is off).
//   finalCombatants -- the POST-battle combatant array: every ship's final hull,
//                      shield, drones, statusEffects, alive flag, etc. after the
//                      sim finishes. This is the carry-state enabler for the Patrol
//                      loop (sub-phase 5b): it runs a battle per wave and reads the
//                      player's surviving hull/shield/drones off this to seed the
//                      next wave.
//
//   TWO CAVEATS the caller MUST know about finalCombatants:
//
//   1. ID-SORTED ORDER, NOT INPUT ORDER. The sim sorts `combatants` by id once at
//      the start (deterministic turn order, ~line 1158), so finalCombatants is in
//      ascending-id order, which is generally NOT the order the caller passed in.
//      Look a ship up BY ID, never by index:
//          finalCombatants.find((c) => c.id === playerId)
//
//   2. PURITY IS PRESERVED. finalCombatants is the PRIVATE clone the sim mutated
//      (made by cloneParticipants ~line 199), NOT the caller's input objects. The
//      caller's original combatants are still untouched (they can re-resolve the
//      same battle). We are handing back the clone we already own, which is exactly
//      the post-battle state the caller wants, so no input is ever exposed or
//      mutated. finalCombatants members are therefore DIFFERENT object references
//      from the input combatants.
//
//   finalCombatants is OUTCOME state: it is driven purely by the `combat` RNG
//   stream, never the `cosmetic` stream, so it is byte-identical offline vs live
//   (design S0 principle 2), exactly like `outcome`. The flagship parity suite
//   asserts this.
export function resolveBattle(
	participants: BattleParticipants,
	seed: number,
	options?: ResolveOptions,
): { outcome: BattleOutcome; log: CombatEvent[]; finalCombatants: Combatant[] } {
	const generateLog = options?.generateLog ?? false;
	const objective = options?.objective ?? lastTeamStanding;

	// Two independent RNG streams from the one seed. `combat` drives every
	// outcome roll; `cosmetic` is touched ONLY under generateLog for flavor, and
	// by construction cannot perturb `combat` (see rng.ts makeStreams).
	const { combat, cosmetic } = makeStreams(seed);

	// Work on a private copy so the caller's data is never mutated (purity).
	const working = cloneParticipants(participants);
	const combatants = working.combatants;

	// DETERMINISTIC TURN ORDER: sort the whole cast by id once. ids are unique +
	// stable per battle, so this order is identical on every run and every
	// device, which every deterministic roll downstream depends on.
	combatants.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

	// Per-combatant fixed-point accumulators (movement + shield banking).
	const accumulators = new Map<string, Accumulators>();
	for (const c of combatants) {
		accumulators.set(c.id, { move: 0, shield: 0 });
	}

	// PHASE 7b IN-COMBAT DRONE REPLENISH banks (design S8). Keyed by
	// `${combatantId}:${squadronId}`, these bank fixed-point refab/repair progress
	// so a per-SECOND droneReplenishRate becomes exact integer progress per 0.1s
	// tick (same banked idiom as movement/shields). ONLY populated for combatants
	// whose inCombatReplenishPercent > 0, so a normal battle never touches this Map
	// (the parity guard: no bank, no state, no drone recovery mid-fight).
	const droneReplenishBank = new Map<string, number>();

	// The structured event stream. Built only when generateLog is on; offline
	// leaves it an empty array (and pays for none of the pushes/flavor draws).
	const log: CombatEvent[] = [];

	// PHASE 12b DISPLAY-ONLY: the set of combatant ids that have fired at least one
	// shot (or ambush salvo) so far, the sole input the phase readout needs beyond
	// pure geometry to tell "weapons-ready" from "firing". Written ONLY under
	// generateLog (inside the fire path's existing log guard + the ambush opener),
	// read ONLY by the per-round roundState emission. It draws no RNG and gates
	// nothing, so offline never touches it and stays byte-identical.
	const hasFired = new Set<string>();

	// PHASE 6 ENCOUNTER OPEN (design S6): pre-charge weapons so the first to enter
	// range fires immediately. Seed every weapon's cooldownAccumulator to its full
	// cooldownDeciSec, so on tick 1 it is already ready and fires the instant the
	// range gate opens (the longest-range weapon fires the opener; shorter guns join
	// as the ship closes). Opt-in (default off) so co-located immediate-fire fixtures
	// are unchanged.
	if (options?.precharge) {
		for (const c of combatants) {
			for (const w of c.weapons) {
				w.cooldownAccumulator = w.cooldownDeciSec;
			}
		}
	}

	// PHASE 6 AMBUSH return-fire delay (design S7). Maps a combatant id -> the tick
	// at or after which it may FIRE (its weapons hold until then). Default (absent)
	// = 0 = fire from tick 1 (no delay). Only an ambushed target gets a positive
	// entry; everyone else is unaffected, so a no-ambush battle never gates firing.
	const returnFireReadyTick = new Map<string, number>();

	// PHASE 6 AMBUSH opener (design S7). Resolve the ambusher's free opening salvo
	// BEFORE the main loop. This runs its combat-stream draws (detector roll, then
	// the salvo's hit/crit/damage/proc draws) UNCONDITIONALLY when an ambush is set,
	// so offline == live holds (only the LOG pushes below are gated on generateLog).
	if (options?.ambush !== undefined) {
		resolveAmbushOpener(
			options.ambush,
			combatants,
			combat,
			cosmetic,
			generateLog,
			log,
			returnFireReadyTick,
			hasFired,
		);
	}

	// PHASE 4 DoT LOG AGGREGATION (design S4 / S16). DoT damage lands EVERY tick
	// (in the Phase D loop below), but the LOG must show ONE aggregated line per
	// DoT per ROUND ("Plasma Fire II sears the hull for Z this round"). We bank a
	// round's per-(combatant, defId) DoT damage here and FLUSH it to one event per
	// entry when the round rolls over, plus once more at battle end. This is LOG
	// ONLY: the damage itself is applied unconditionally, so offline (which never
	// touches this map) loses byte-identical hull.
	interface DotRoundEntry {
		combatantId: string;
		defId: string;
		damage: number; // summed hull damage this round
		rank: number; // rank at the latest tick (for the "Plasma Fire II" flavor)
		hullAfter: number; // target hull after the latest DoT tick this round
	}
	const dotRoundAccum = new Map<string, DotRoundEntry>();
	// The round the accumulator currently holds (flushed when the tick's round
	// advances past it). Starts at 0 (the round of ticks 1..9).
	let dotAccumRound = 0;
	// Emit one "dot" event per accumulated entry for a completed round, then clear.
	// Only ever called under generateLog.
	const flushDotRound = (roundToFlush: number): void => {
		for (const entry of dotRoundAccum.values()) {
			log.push(
				attachFlavor(
					{
						// Stamp the event at the END of the round it summarizes.
						tDeciSec: roundToFlush * TENTHS_PER_SECOND + TENTHS_PER_SECOND,
						round: roundToFlush,
						type: "dot",
						// A DoT has no single actor (the burn outlives the shot that lit it);
						// only the afflicted target is recorded.
						targetId: entry.combatantId,
						result: "dot",
						damage: entry.damage,
						hullAfter: entry.hullAfter,
						effectDefId: entry.defId,
						effectRank: entry.rank,
					},
					cosmetic,
				),
			);
		}
		dotRoundAccum.clear();
	};

	// PHASE 12b DISPLAY-ONLY: the last round we emitted per-round arena readout
	// ("roundState") events for. Starts at -1 so round 0 (the opening) emits on the
	// very first tick. Only advanced under generateLog (offline emits none). See the
	// emit block at the top of the loop.
	let lastRoundStateRound = -1;

	// Decided-outcome holder. Set the moment the objective resolves; the loop
	// breaks and we package the outcome after.
	let decided: "player" | "enemy" | "draw" | null = null;
	// deci-second timestamp of the CURRENT tick (1..MAX_TICKS). Also our elapsed
	// clock for computing rounds at the end.
	let t = 0;

	// -------------------------------------------------------------------------
	// MAIN FIXED-TIMESTEP LOOP. One iteration = one 0.1s tick. Ordered phases per
	// tick (design S1): movement -> weapons (+ effect procs) -> status effects
	// (DoT/disruption ticks) -> deaths -> objective. Bounded by MAX_TICKS so it
	// always terminates.
	// -------------------------------------------------------------------------
	for (t = 1; t <= MAX_TICKS; t++) {
		// The 1-second narration bucket for events created this tick.
		const round = Math.floor(t / TENTHS_PER_SECOND);

		// PHASE 4: the round rolled over, so flush the PREVIOUS round's aggregated
		// DoT damage to one log line per DoT (design S4). Log-only; offline skips it.
		if (generateLog && round !== dotAccumRound) {
			flushDotRound(dotAccumRound);
			dotAccumRound = round;
		}

		// PHASE 12b DISPLAY-ONLY: on the FIRST tick of each round, emit one
		// "roundState" event per living combatant carrying its range readout (distance
		// to its current target + the derived band) and its engagement phase, so the
		// combat view can render the range track + band label + phase narration (design
		// S16). This is PURE NARRATION: it samples position/target the sim already
		// holds, derives band/phase via the positioning.ts helpers (the single source
		// of truth for the thresholds), draws NO RNG, mutates nothing, and never gates a
		// shot. Emitted at the round's opening (before this round's movement/firing), so
		// it reads as the state ENTERING the round. Gated on generateLog, so offline
		// emits none of it and stays byte-identical. No cosmetic-stream draw either (the
		// view renders these from the enum/number directly, not a flavor line), which
		// also keeps every OTHER event's flavor selection byte-identical to before.
		if (generateLog && round !== lastRoundStateRound) {
			emitRoundState(combatants, round, t, hasFired, log);
			lastRoundStateRound = round;
		}

		// Iterate combatants in the fixed id order. A combatant that died earlier
		// this same tick is skipped (alive flag), so a killed ship cannot fire
		// back within the tick it dies.
		for (const self of combatants) {
			if (!self.alive) continue;

			// Choose this combatant's target (Phase 6 focus-fire policy: lowest
			// effective-HP enemy in range, else the best to close on). No living enemy
			// => nothing to do this tick (its side has effectively won; the objective
			// check below will formalize it).
			const target = selectTarget(self, combatants);
			if (target === undefined) continue;

			const acc = accumulators.get(self.id)!;

			// PHASE A: movement. Step toward this ship's stance preferred distance from
			// the target (close / kite / hold), Coolant-Leak-scaled (see advanceMovement).
			advanceMovement(self, target, acc);

			// PHASE B: shield regen for the acting combatant (banked per-tick).
			advanceShieldRegen(self, acc);

			// PHASE 6 AMBUSH return-fire delay (design S7): a freshly-ambushed target
			// holds fire (weapons do not even accrue cooldown) until its ready tick.
			// It still moved + regenerated shields above; only its firing is stunned.
			// Default 0 (absent) => never gates, so a no-ambush battle is unaffected.
			const readyTick = returnFireReadyTick.get(self.id) ?? 0;
			if (t < readyTick) continue;

			// PHASE 6 DEBUFF (applied): Sensor Power Drain (-range) shrinks this ship's
			// EFFECTIVE weapon range (design S4/S6: sensor drains reduce range). Read the
			// summed `range` delta (negative for a drain) ONCE per combatant; zero delta
			// => nominal range, so an undrained ship is byte-identical (parity). Applied
			// to each weapon's range at the gate below.
			const rangeDelta = activeStatDelta(self.statusEffects, "range");

			// PHASE C: weapons. Advance each weapon's cooldown clock by dt; fire any
			// that have both come off cooldown AND have the target in range.
			for (const weapon of self.weapons) {
				weapon.cooldownAccumulator += DT_DECISEC;
				// Not yet ready to fire.
				if (weapon.cooldownAccumulator < weapon.cooldownDeciSec) continue;

				// Range gate: fire only if the target sits within this weapon's
				// (sensor-drain-scaled) range on the 1D axis. If out of range we HOLD the
				// accumulator at (or above) the ready threshold so the shot goes off the
				// instant the ship closes into range (design S6: charged salvo fires when
				// the band opens). We do NOT reset it here.
				const distance = Math.abs(self.position - target.position);
				const effectiveRange =
					rangeDelta !== 0 ? applyPercentDelta(weapon.range, rangeDelta) : weapon.range;
				if (distance > effectiveRange) continue;

				// Ready + in range: fire. Consume ONE cooldown period from the
				// accumulator, carrying the remainder so fractional fire rates stay
				// exact over time (design S1: cooldown accumulator with carry-over).
				weapon.cooldownAccumulator -= weapon.cooldownDeciSec;

				// Capture the target's shield BEFORE the shot so the flavor layer can
				// distinguish a shield-BREAK (shields dropped to 0 this hit, the "hull
				// laid bare" death beat) from a plain shield hit or hull hit. Read only
				// under generateLog so offline stays untouched; the read never affects
				// the outcome regardless.
				const shieldBefore = generateLog ? target.shield : 0;

				// REAL shot pipeline. Every combat-stream draw happens inside, on a
				// schedule independent of generateLog (parity invariant). Passes `self`
				// so the pipeline can read the ATTACKER's active accuracy / weapon-damage
				// debuffs (Phase 4). Effect procs against the target also happen inside.
				// PHASE 7b: pass the defense context so an incoming shot is contested by
				// the target's drone screen (interception / deflect / reflect / meat-
				// shield). Droneless targets make zero extra draws (the parity guard).
				const shot = fireWeapon(self, target, weapon, combat, false, {
					combatants,
				});

				// LOG + COSMETIC work is gated on generateLog ONLY. None of this can
				// change the outcome: fireWeapon already did all its combat draws.
				// attachFlavor performs the single cosmetic draw per event (cosmetic
				// stream only), replacing the Phase-3 throwaway draw with the real
				// Phase-12 flavor selection.
				if (generateLog && shot.fired) {
					// PHASE 12b DISPLAY-ONLY: mark that this ship has opened fire, so its
					// phase readout advances to "firing" from the next round boundary on.
					hasFired.add(self.id);
					// A shot with zero connecting projectiles reads as an evade; any
					// connection is a hit. The flavor layer reads the detail fields to
					// pick the most specific line (crit / attenuated / shield-break / family).
					const evaded = shot.projectilesHit === 0;
					log.push(
						attachFlavor(
							{
								tDeciSec: t,
								round,
								type: evaded ? "evade" : "hit",
								actorId: self.id,
								targetId: target.id,
								damage: shot.damage,
								result: evaded ? "evade" : "hit",
								shieldAfter: shot.shieldAfter,
								hullAfter: shot.hullAfter,
								family: weapon.family,
								weaponType: weapon.weaponType,
								crit: shot.crit,
								attenuated: shot.attenuated,
								projectilesHit: shot.projectilesHit,
								// Shield-break only on a CONNECTING hit that zeroed a live shield.
								shieldBroke:
									!evaded && shieldBefore > 0 && shot.shieldAfter === 0,
							},
							cosmetic,
						),
					);
					// PHASE 4: log one "effectApplied" event per disruption/DoT this
					// shot landed (design S4: log an effect-applied event under
					// generateLog only). The effect was already applied inside
					// fireWeapon; here we only narrate it, reading the target's CURRENT
					// rank so an escalation reads "II" / "III".
					for (const defId of shot.appliedEffects) {
						const inst = target.statusEffects.find((e) => e.defId === defId);
						log.push(
							attachFlavor(
								{
									tDeciSec: t,
									round,
									type: "effectApplied",
									actorId: self.id,
									targetId: target.id,
									result: "effectApplied",
									shieldAfter: shot.shieldAfter,
									hullAfter: shot.hullAfter,
									effectDefId: defId,
									effectRank: inst?.rank ?? 1,
								},
								cosmetic,
							),
						);
					}
					if (shot.killed) {
						log.push(
							attachFlavor(
								{
									tDeciSec: t,
									round,
									type: "destroyed",
									actorId: self.id,
									targetId: target.id,
									result: "destroyed",
									shieldAfter: shot.shieldAfter,
									hullAfter: shot.hullAfter,
								},
								cosmetic,
							),
						);
					}
					// PHASE 7b: narrate the drone screen's reaction (log-only; the outcome
					// was already resolved inside fireWeapon). One aggregate "droneIntercept"
					// line when the screen engaged, one "destroyed" per drone lost, and one
					// "droneReflect"/"droneCounter" per collateral hit on the attacker / a
					// smart-reflect priority foe.
					if (shot.dronesEngaged > 0) {
						log.push(
							attachFlavor(
								{
									tDeciSec: t,
									round,
									type: "droneIntercept",
									actorId: target.id, // the DEFENDER's drones acted
									targetId: self.id,
									result: "droneIntercept",
									projectilesHit: shot.dronesEngaged,
									family: weapon.family,
								},
								cosmetic,
							),
						);
					}
					for (const hit of shot.collateral) {
						log.push(
							attachFlavor(
								{
									tDeciSec: t,
									round,
									type: hit.kind === "reflect" ? "droneReflect" : "droneCounter",
									actorId: target.id, // the carrier's screen dealt this
									targetId: hit.targetId,
									damage: hit.damage,
									result: hit.kind === "reflect" ? "droneReflect" : "droneCounter",
								},
								cosmetic,
							),
						);
						if (hit.killed) {
							log.push(
								attachFlavor(
									{
										tDeciSec: t,
										round,
										type: "destroyed",
										actorId: target.id,
										targetId: hit.targetId,
										result: "destroyed",
									},
									cosmetic,
								),
							);
						}
					}
				}
			}

				// PHASE C2: DRONE SQUADRONS (design S8, Phase 7a OFFENSE). Each squadron
				// advances its OWN firing clock; when ready AND the owner's target is within
				// the squadron's reach, every ONLINE drone fires its ~1/size shot at that
				// target through the same mitigation as a weapon (fireSquadron above). Output
				// scales with the ALIVE drone count. An empty drones [] iterates nothing =>
				// ZERO combat draws (the parity guard); a zero-offense Support squadron draws
				// nothing either. This sits AFTER the ambush return-fire gate above, so a
				// freshly-ambushed ship's drones hold fire with its weapons (the whole ship is
				// caught off guard) until its ready tick.
				//
				// PHASE 7b: the DEFENSIVE interactions live in fireWeapon (an incoming
				// shot is contested by this same array); here the loop adds the SUPPORT
				// KIT (Mode 3): a support squadron's pulse repairs the owner + cleanses
				// disruptions instead of firing. Offense (attack/defense volleys) is 7a.
				for (const squadron of self.drones) {
					// Advance the squadron's firing clock by dt (no combat draw).
					squadron.cooldownAccumulator += DT_DECISEC;
					// Not yet ready to volley / pulse.
					if (squadron.cooldownAccumulator < squadron.attackCooldownDeciSec) continue;

					// PHASE 7b SUPPORT PULSE (design S8 Mode 3). A utility squadron does
					// NOT fire; when its clock is ready it repairs the OWNER's hull (per
					// alive drone, no range gate: it tends its own ship) and attempts to
					// cleanse the owner's disruptions (halve-per-rank chance). Gated on
					// mode so attack/defense fall through to the offense volley below, and
					// on there being a support squadron at all (parity: no support => no
					// draw here). The cleanse is the only combat-stream draw.
					if (squadron.mode === "utility") {
						squadron.cooldownAccumulator -= squadron.attackCooldownDeciSec;
						// Count alive+online drones: a wiped/jammed support screen heals less.
						let activeDrones = 0;
						for (const d of squadron.drones) {
							if (d.alive && d.status === "online") activeDrones++;
						}
						// Hull repair (deterministic, no draw), clamped to hullMax.
						const healed = squadron.supportHullRepair * activeDrones;
						const hullBefore = self.hull;
						if (healed > 0 && self.hull < self.hullMax) {
							self.hull = Math.min(self.hullMax, self.hull + healed);
						}
						// Cleanse (draws on the combat stream, one per disruption). Only when
						// the screen has an active drone to run the kit.
						const cleansed =
							activeDrones > 0 ? supportCleanse(self, combat) : [];
						// LOG-ONLY narration of the pulse (never changes the outcome).
						// attachFlavor makes the single cosmetic draw per event.
						if (generateLog && (self.hull !== hullBefore || cleansed.length > 0)) {
							log.push(
								attachFlavor(
									{
										tDeciSec: t,
										round,
										type: "droneSupport",
										actorId: self.id,
										targetId: self.id,
										result: "droneSupport",
										damage: self.hull - hullBefore, // hull RESTORED this pulse
										hullAfter: self.hull,
									},
									cosmetic,
								),
							);
							for (const defId of cleansed) {
								log.push(
									attachFlavor(
										{
											tDeciSec: t,
											round,
											type: "droneCleanse",
											actorId: self.id,
											targetId: self.id,
											result: "droneCleanse",
											effectDefId: defId,
										},
										cosmetic,
									),
								);
							}
						}
						continue;
					}

					// Reach gate: owner-to-target distance vs the squadron's range. Out of
					// reach HOLDS the accumulator (like a weapon) so the volley fires the
					// instant the owner closes into range. Attack drones "zoom in" (short
					// reach); defense/support fire from long reach (see drones.ts templates).
					const droneDistance = Math.abs(self.position - target.position);
					if (droneDistance > squadron.range) continue;

					// Ready + in reach: consume ONE cooldown period (carry the remainder for
					// exact fractional rates), then volley. Every combat-stream draw happens
					// inside fireSquadron, on a schedule independent of generateLog (parity).
					squadron.cooldownAccumulator -= squadron.attackCooldownDeciSec;
					const volley = fireSquadron(self, target, squadron, combat);

					// LOG + COSMETIC gated on generateLog ONLY (cannot change the outcome:
					// fireSquadron already did all its combat draws). ONE AGGREGATE event per
					// squadron per volley (design S8: do NOT spam one line per drone per tick);
					// projectilesHit carries how many drones connected, so the flavor layer can
					// narrate "Wasp squadron strikes E1 for N (6 of 8 drones)".
					if (generateLog && volley.fired) {
						// attachFlavor makes the single cosmetic draw per event, same
						// proof-of-isolation as a weapon shot: offline skips it, yet the
						// outcome is identical.
						const evaded = volley.dronesHit === 0;
						log.push(
							attachFlavor(
								{
									tDeciSec: t,
									round,
									type: "droneVolley",
									actorId: self.id,
									targetId: target.id,
									damage: volley.damage,
									result: evaded ? "evade" : "droneVolley",
									shieldAfter: volley.shieldAfter,
									hullAfter: volley.hullAfter,
									family: squadron.family,
									projectilesHit: volley.dronesHit,
								},
								cosmetic,
							),
						);
						if (volley.killed) {
							log.push(
								attachFlavor(
									{
										tDeciSec: t,
										round,
										type: "destroyed",
										actorId: self.id,
										targetId: target.id,
										result: "destroyed",
										shieldAfter: volley.shieldAfter,
										hullAfter: volley.hullAfter,
									},
									cosmetic,
								),
							);
						}
					}
				}
		}

		// PHASE C3: IN-COMBAT DRONE REPLENISH (design S8, Phase 7b). A combatant with
		// an in-combat replenish MODULE (inCombatReplenishPercent > 0, Phase 9 content)
		// rebuilds destroyed / repairs disrupted drones DURING the fight at x% of each
		// squadron's droneReplenishRate. Fully GATED on the percent being > 0, so a
		// combatant without the module never banks or draws here and its drones only
		// recover OUT of combat (between waves, Phase 9). NO combat-stream draw
		// (replenishDrones is deterministic), so this is parity-safe by construction.
		// Runs for every LIVING combatant, target or not (a screen recovers regardless).
		for (const self of combatants) {
			if (!self.alive) continue;
			const pct = self.inCombatReplenishPercent ?? 0;
			if (pct <= 0) continue; // no module: no in-combat recovery (parity guard)
			for (const squadron of self.drones) {
				// Bank fixed-point progress: rate (per second) * pct% * dt (deci-seconds).
				// Divisor 100 (percent) * TENTHS_PER_SECOND (per-second -> per-tick) keeps
				// it exact integer, releasing whole progress units and carrying the rest.
				const key = `${self.id}:${squadron.id}`;
				const banked =
					(droneReplenishBank.get(key) ?? 0) +
					squadron.droneReplenishRate * pct * DT_DECISEC;
				const units = Math.floor(banked / (100 * TENTHS_PER_SECOND));
				droneReplenishBank.set(key, banked - units * 100 * TENTHS_PER_SECOND);
				if (units > 0) {
					const restored = replenishDrones(squadron, units);
					// LOG-ONLY: narrate a drone coming back online mid-fight.
					if (generateLog && restored > 0) {
						log.push(
							attachFlavor(
								{
									tDeciSec: t,
									round,
									type: "droneReplenish",
									actorId: self.id,
									targetId: self.id,
									result: "droneReplenish",
									projectilesHit: restored, // count of drones restored this tick
								},
								cosmetic,
							),
						);
					}
				}
			}
		}

		// PHASE D: status effects (design S4). Tick EVERY living combatant's
		// DoTs / disruptions once this tick, INDEPENDENT of whether it had a
		// target to act on above (a ship burns even after its last enemy dies).
		// DoT hull damage is outcome-affecting, so this runs unconditionally;
		// tickEffects makes NO combat-stream draw in v1 (flat DoT), so the parity
		// invariant holds. Only the per-round LOG aggregation is gated below.
		for (const self of combatants) {
			if (!self.alive) continue;
			const { dotDamageByDef, killed, expired } = tickEffects(self, DT_DECISEC, combat);
			if (!generateLog) continue;
			// PHASE 12b DISPLAY-ONLY: one "effectExpired" event per effect that lapsed
			// on its own this tick (timer reached 0). The mechanical removal already
			// happened inside tickEffects (the survivors filter); this only NARRATES it
			// so the combat view can drop the status pip, fixing the fold's pip
			// over-report. Distinct from "droneCleanse" (a support-drone removal). No
			// cosmetic draw (the view renders it from the effect def, not a flavor line),
			// keeping every other event's flavor byte-identical. Gated on generateLog, so
			// offline emits none of it.
			for (const lapsed of expired) {
				log.push({
					tDeciSec: t,
					round,
					type: "effectExpired",
					targetId: self.id,
					result: "effectExpired",
					effectDefId: lapsed.defId,
					effectRank: lapsed.rank,
				});
			}
			// Accumulate this tick's DoT damage into the current round's bucket, one
			// entry per (combatant, defId), for the aggregated round line.
			for (const [defId, dmg] of dotDamageByDef) {
				const key = `${self.id}:${defId}`;
				// After ticking, the effect may have EXPIRED and been removed; fall
				// back to the entry's last-known rank (or 1) so the flavor still reads.
				const liveRank = self.statusEffects.find((e) => e.defId === defId)?.rank;
				const existing = dotRoundAccum.get(key);
				if (existing) {
					existing.damage += dmg;
					existing.hullAfter = self.hull;
					existing.rank = liveRank ?? existing.rank;
				} else {
					dotRoundAccum.set(key, {
						combatantId: self.id,
						defId,
						damage: dmg,
						rank: liveRank ?? 1,
						hullAfter: self.hull,
					});
				}
			}
			// A DoT can be the killing blow; narrate it (no actor: the burn's source
			// shot is long gone).
			if (killed) {
				log.push(
					attachFlavor(
						{
							tDeciSec: t,
							round,
							type: "destroyed",
							targetId: self.id,
							result: "destroyed",
							shieldAfter: self.shield,
							hullAfter: self.hull,
						},
						cosmetic,
					),
				);
			}
		}

		// PHASE E: evaluate the objective after the full tick resolved. If the
		// battle is decided, stop immediately (a wiped team, etc.).
		decided = objective(working);
		if (decided !== null) {
			break;
		}
	}

	// PHASE 4: flush the final (in-progress) round's aggregated DoT damage, which
	// the round-rollover flush at the loop top never reached because the battle
	// ended mid-round. Log-only; offline never populated the accumulator.
	if (generateLog) {
		flushDotRound(dotAccumRound);
	}

	// -------------------------------------------------------------------------
	// PACKAGE THE OUTCOME.
	// -------------------------------------------------------------------------
	// Rounds elapsed = the final tick clock converted to whole seconds, at least
	// 1 (a battle that ends in the first tick still counts as round 1 of action).
	// If we ran to the cap, t is MAX_TICKS + 1 after the for-loop increment, so
	// clamp to MAX_TICKS before converting.
	const finalTick = Math.min(t, MAX_TICKS);
	const rounds = Math.max(1, Math.ceil(finalTick / TENTHS_PER_SECOND));

	let outcome: BattleOutcome;
	if (decided !== null) {
		// Objective resolved before the cap: a clean elimination/decision.
		outcome = { winner: decided, reason: "eliminated", rounds };
	} else {
		// Hit the hard cap without a decision: tiebreak by hull% (deterministic).
		outcome = {
			winner: tiebreakByHullPercent(combatants),
			reason: "capReached",
			rounds,
		};
	}

	// Hand back the outcome, the log, AND the post-battle combatant array. The
	// latter is `combatants` (=== working.combatants), the id-sorted PRIVATE clone
	// the sim has been mutating all along: its members carry every ship's final
	// hull/shield/drones/statusEffects/alive state. This is additive and does NOT
	// reintroduce input mutation, because `combatants` is the clone from
	// cloneParticipants (~line 199), never the caller's input (purity intact). It
	// is in ascending-id order (sorted ~line 1158): callers look ships up BY ID.
	return { outcome, log, finalCombatants: combatants };
}
