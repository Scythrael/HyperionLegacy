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
import { makeStreams, type Rng } from "./rng";
import {
	applyEffect,
	tickEffects,
	activeStatDelta,
	applyPercentDelta,
} from "./statusEffects";
import { stancePreferredDistance, stanceMoveDelta, selectTarget } from "./positioning";

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
// weapons are the only mutable things the sim writes to, so we copy those; the
// reserved statusEffects/drones arrays are empty in the skeleton and copied by
// reference-into-fresh-array to stay forward-safe.
function cloneParticipants(participants: BattleParticipants): BattleParticipants {
	return {
		combatants: participants.combatants.map((c) => ({
			...c,
			// Fresh weapon objects: the sim advances cooldownAccumulator on these,
			// which must not leak back into the caller's data.
			weapons: c.weapons.map((w) => ({ ...w })),
			// Fresh reserved arrays so future in-sim mutation is isolated too.
			statusEffects: [...c.statusEffects],
			drones: [...c.drones],
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
function fireWeapon(
	self: Combatant,
	target: Combatant,
	weapon: CombatWeapon,
	combat: Rng,
	// PHASE 6 AMBUSH: when true (the ambush opener), every projectile strikes hull
	// directly (bypasses the shield pool). Default false for the normal firing loop.
	bypassShields = false,
): ShotResult {
	// PHASE 4 DEBUFF (applied): the attacker's accuracy debuffs (Scattering Field,
	// Targeting Drift) scale weapon accuracy DOWN before the evasion subtraction.
	const accuracyDelta = activeStatDelta(self.statusEffects, "accuracy");
	const effectiveAccuracy = applyPercentDelta(weapon.accuracy, accuracyDelta);
	// Per-projectile hit chance: (debuffed) accuracy reduced by the target's
	// evasion, clamped to a valid percent. No minimum floor, so a 0 net chance is a
	// guaranteed miss (the evade tests rely on this) and >= 100 is a sure hit.
	const hitChance = Math.max(0, Math.min(100, effectiveAccuracy - target.evasion));

	// PHASE 4 DEBUFF (applied): the attacker's weapon-damage debuff (Coil
	// Dampening) scales every projectile's raw damage DOWN. Computed once per shot.
	const weaponDamageDelta = activeStatDelta(self.statusEffects, "weaponDamage");

	let projectilesHit = 0;
	let totalDealt = 0;
	let anyCrit = false;
	let anyAttenuated = false;

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

		// STEP 5: mitigation. Applies triangle + attenuation + shields + armor +
		// hull to THIS projectile against the target's live state (so a volley
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
	generateLog: boolean,
	log: CombatEvent[],
	returnFireReadyTick: Map<string, number>,
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
		// LOG ONLY (gated): an "ambush" event so the flavor layer narrates the
		// surprise salvo distinctly (result flags hull-direct vs a detected shielded
		// opener). Stamped at t=0 (the opener precedes tick 1).
		if (generateLog && shot.fired) {
			log.push({
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
				crit: shot.crit,
				attenuated: shot.attenuated,
				projectilesHit: shot.projectilesHit,
			});
			if (shot.killed) {
				log.push({
					tDeciSec: 0,
					round: 0,
					type: "destroyed",
					actorId: ambusher.id,
					targetId: target.id,
					result: "destroyed",
					shieldAfter: shot.shieldAfter,
					hullAfter: shot.hullAfter,
				});
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

// The public simulator. See file header for the two invariants it upholds.
export function resolveBattle(
	participants: BattleParticipants,
	seed: number,
	options?: ResolveOptions,
): { outcome: BattleOutcome; log: CombatEvent[] } {
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

	// The structured event stream. Built only when generateLog is on; offline
	// leaves it an empty array (and pays for none of the pushes/flavor draws).
	const log: CombatEvent[] = [];

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
			generateLog,
			log,
			returnFireReadyTick,
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
			log.push({
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
			});
		}
		dotRoundAccum.clear();
	};

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

			// PHASE C: weapons. Advance each weapon's cooldown clock by dt; fire any
			// that have both come off cooldown AND have the target in range.
			for (const weapon of self.weapons) {
				weapon.cooldownAccumulator += DT_DECISEC;
				// Not yet ready to fire.
				if (weapon.cooldownAccumulator < weapon.cooldownDeciSec) continue;

				// Range gate: fire only if the target sits within this weapon's
				// range on the 1D axis. If out of range we HOLD the accumulator at
				// (or above) the ready threshold so the shot goes off the instant the
				// ship closes into range (design S6: charged salvo fires when the
				// band opens). We do NOT reset it here.
				const distance = Math.abs(self.position - target.position);
				if (distance > weapon.range) continue;

				// Ready + in range: fire. Consume ONE cooldown period from the
				// accumulator, carrying the remainder so fractional fire rates stay
				// exact over time (design S1: cooldown accumulator with carry-over).
				weapon.cooldownAccumulator -= weapon.cooldownDeciSec;

				// REAL shot pipeline. Every combat-stream draw happens inside, on a
				// schedule independent of generateLog (parity invariant). Passes `self`
				// so the pipeline can read the ATTACKER's active accuracy / weapon-damage
				// debuffs (Phase 4). Effect procs against the target also happen inside.
				const shot = fireWeapon(self, target, weapon, combat);

				// LOG + COSMETIC work is gated on generateLog ONLY. None of this can
				// change the outcome: fireWeapon already did all its combat draws.
				if (generateLog && shot.fired) {
					// Touch the cosmetic stream to select flavor (Phase 3: a throwaway
					// draw standing in for Phase-16 flavor-line selection). This PROVES
					// the isolation: offline skips this draw entirely, yet the combat
					// sequence is identical, so the outcome cannot move.
					cosmetic.nextInt(1000);
					// A shot with zero connecting projectiles reads as an evade; any
					// connection is a hit. The flavor layer reads the detail fields to
					// pick the most specific line (crit / attenuated / family).
					const evaded = shot.projectilesHit === 0;
					log.push({
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
						crit: shot.crit,
						attenuated: shot.attenuated,
						projectilesHit: shot.projectilesHit,
					});
					// PHASE 4: log one "effectApplied" event per disruption/DoT this
					// shot landed (design S4: log an effect-applied event under
					// generateLog only). The effect was already applied inside
					// fireWeapon; here we only narrate it, reading the target's CURRENT
					// rank so an escalation reads "II" / "III".
					for (const defId of shot.appliedEffects) {
						const inst = target.statusEffects.find((e) => e.defId === defId);
						log.push({
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
						});
					}
					if (shot.killed) {
						log.push({
							tDeciSec: t,
							round,
							type: "destroyed",
							actorId: self.id,
							targetId: target.id,
							result: "destroyed",
							shieldAfter: shot.shieldAfter,
							hullAfter: shot.hullAfter,
						});
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
			const { dotDamageByDef, killed } = tickEffects(self, DT_DECISEC, combat);
			if (!generateLog) continue;
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
				log.push({
					tDeciSec: t,
					round,
					type: "destroyed",
					targetId: self.id,
					result: "destroyed",
					shieldAfter: self.shield,
					hullAfter: self.hull,
				});
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

	return { outcome, log };
}
