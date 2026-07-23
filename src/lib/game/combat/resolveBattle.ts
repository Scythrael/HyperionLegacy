// ============================================================================
// combat/resolveBattle.ts -- the deterministic fixed-timestep combat simulator
// (Combat 0.13.0, Phase 2 sim-core SKELETON)
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
} from "./types";
import { lastTeamStanding } from "./types";
import { makeStreams } from "./rng";

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

// Effective HP used for target selection + tiebreak: shield soaks before hull,
// so a ship's "how hard to kill right now" is simply shield + hull. Integer.
function effectiveHp(c: Combatant): number {
	return c.shield + c.hull;
}

// Pick the target a combatant should shoot at / close toward.
//
// SKELETON POLICY: focus the lowest effective-HP living ENEMY (a stand-in for
// the design's "focus-fire the lowest effective-HP enemy" default, Section 6),
// with a deterministic id tiebreak so the choice never depends on array order
// or floating comparisons. Returns undefined if no living enemy remains.
// Phase 6 replaces this with real per-combatant targeting policies + range.
function selectTarget(
	self: Combatant,
	all: Combatant[],
): Combatant | undefined {
	let best: Combatant | undefined;
	for (const other of all) {
		// Only living enemies of `self` are valid targets.
		if (!other.alive) continue;
		if (other.team === self.team) continue;
		if (best === undefined) {
			best = other;
			continue;
		}
		// Prefer lower effective HP; on a tie, prefer the lower id so the pick is
		// fully deterministic and independent of iteration order.
		const otherHp = effectiveHp(other);
		const bestHp = effectiveHp(best);
		if (otherHp < bestHp || (otherHp === bestHp && other.id < best.id)) {
			best = other;
		}
	}
	return best;
}

// Move `self` toward `target` along the 1D position axis, using the banked-
// tenths accumulator so a per-SECOND speed becomes exact integer motion per
// 0.1s tick. Never overshoots the target's position (skeleton just closes the
// gap; Phase 6 adds stance-driven preferred ranges + kiting).
function advanceMovement(
	self: Combatant,
	target: Combatant,
	acc: Accumulators,
): void {
	// Bank this tick's worth of tenths (speed tenths per second * dt ticks).
	acc.move += self.speed * DT_DECISEC;
	// Convert whole banked units into position steps; keep the remainder banked.
	const wholeSteps = Math.floor(acc.move / TENTHS_PER_SECOND);
	if (wholeSteps <= 0) return;
	acc.move -= wholeSteps * TENTHS_PER_SECOND;

	// Distance + direction to the target on the 1D axis.
	const gap = target.position - self.position;
	if (gap === 0) return; // already co-located; nothing to close
	const direction = gap > 0 ? 1 : -1;
	const distance = Math.abs(gap);
	// Move by the banked steps but never past the target (min with distance).
	const step = Math.min(wholeSteps, distance);
	self.position += direction * step;
}

// Regenerate shields using the banked-tenths accumulator (per-second recharge
// -> exact integer points per tick), clamped to shieldMax. Dead ships and full
// shields do nothing. Design S2.5b: shields tick back during drawn-out fights,
// rewarding burst damage.
function advanceShieldRegen(self: Combatant, acc: Accumulators): void {
	if (!self.alive) return;
	if (self.shield >= self.shieldMax) return;
	acc.shield += self.shieldRecharge * DT_DECISEC;
	const wholePoints = Math.floor(acc.shield / TENTHS_PER_SECOND);
	if (wholePoints <= 0) return;
	acc.shield -= wholePoints * TENTHS_PER_SECOND;
	self.shield = Math.min(self.shieldMax, self.shield + wholePoints);
}

// Result of firing one weapon: how much damage landed + the target's snapshot,
// so the OPTIONAL log event can be built from real post-shot values without
// re-deriving them. Returned even when generateLog is off (cheap struct) to
// keep the fire path single, so the combat-stream draw schedule is identical
// regardless of logging.
interface ShotResult {
	fired: boolean;
	hit: boolean;
	damage: number;
	shieldAfter: number;
	hullAfter: number;
	killed: boolean;
}

// ---------------------------------------------------------------------------
// PLACEHOLDER SHOT, Phase 3 replaces this with the real shot pipeline.
//
// The real pipeline (design S2) is: hit-or-evade -> projectiles -> crit ->
// damage variance -> family triangle -> mitigation (attenuation/shields/armor/
// hull). The skeleton collapses all of that to: roll ONE hit chance off the
// combat stream, and on a hit apply a flat `yield` to shields-then-hull. This
// is enough to make battles resolve deterministically.
//
// ⚠️ CRITICAL FOR PARITY: the combat-stream draw (the hit roll) happens HERE on
// every fire, unconditionally, with NO reference to generateLog. Logging never
// adds or removes a combat draw, so the outcome is identical live vs offline.
// ---------------------------------------------------------------------------
function fireWeapon(
	shooter: Combatant,
	target: Combatant,
	weapon: { yield: number },
	combat: { chance(n: number, d: number): boolean },
): ShotResult {
	// Placeholder hit chance: 90% (9/10), one integer draw off the combat stream.
	// Phase 3 replaces this with weaponAccuracy vs target evasion, range-modified.
	const hit = combat.chance(9, 10);
	if (!hit) {
		// A miss still consumed exactly one combat draw (above), keeping the draw
		// schedule fixed. No damage applied.
		return {
			fired: true,
			hit: false,
			damage: 0,
			shieldAfter: target.shield,
			hullAfter: target.hull,
			killed: false,
		};
	}

	// Apply flat yield to shields first, overflow to hull (design S2.5b/d order,
	// minus the armor/attenuation stages Phase 5 adds). All integer arithmetic.
	let remaining = weapon.yield;
	if (target.shield > 0) {
		const absorbed = Math.min(target.shield, remaining);
		target.shield -= absorbed;
		remaining -= absorbed;
	}
	if (remaining > 0) {
		target.hull -= remaining; // hull may go negative; death check clamps intent
	}

	// Death bookkeeping: hull at or below 0 means destroyed. Single source of
	// truth for liveness (the loop + objective read `alive`, never re-derive).
	let killed = false;
	if (target.hull <= 0 && target.alive) {
		target.alive = false;
		killed = true;
	}

	return {
		fired: true,
		hit: true,
		damage: weapon.yield,
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

	// Decided-outcome holder. Set the moment the objective resolves; the loop
	// breaks and we package the outcome after.
	let decided: "player" | "enemy" | "draw" | null = null;
	// deci-second timestamp of the CURRENT tick (1..MAX_TICKS). Also our elapsed
	// clock for computing rounds at the end.
	let t = 0;

	// -------------------------------------------------------------------------
	// MAIN FIXED-TIMESTEP LOOP. One iteration = one 0.1s tick. Ordered phases per
	// tick (design S1): movement -> weapons -> (status effects, Phase 4) ->
	// deaths -> objective. Bounded by MAX_TICKS so it always terminates.
	// -------------------------------------------------------------------------
	for (t = 1; t <= MAX_TICKS; t++) {
		// The 1-second narration bucket for events created this tick.
		const round = Math.floor(t / TENTHS_PER_SECOND);

		// Iterate combatants in the fixed id order. A combatant that died earlier
		// this same tick is skipped (alive flag), so a killed ship cannot fire
		// back within the tick it dies.
		for (const self of combatants) {
			if (!self.alive) continue;

			// Choose this combatant's target (lowest-effective-HP living enemy).
			// No living enemy => nothing to do this tick (its side has effectively
			// won; the objective check below will formalize it).
			const target = selectTarget(self, combatants);
			if (target === undefined) continue;

			const acc = accumulators.get(self.id)!;

			// PHASE A: movement. Close toward the target (skeleton behavior).
			advanceMovement(self, target, acc);

			// PHASE B: shield regen for the acting combatant (banked per-tick).
			advanceShieldRegen(self, acc);

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

				// PLACEHOLDER shot. The combat-stream draw happens inside, always,
				// independent of generateLog (parity invariant).
				const shot = fireWeapon(self, target, weapon, combat);

				// LOG + COSMETIC work is gated on generateLog ONLY. None of this can
				// change the outcome: fireWeapon already did its single combat draw.
				if (generateLog && shot.fired) {
					// Touch the cosmetic stream to select flavor (skeleton: a throwaway
					// draw standing in for Phase-16 flavor-line selection). This PROVES
					// the isolation: offline skips this draw entirely, yet the combat
					// sequence is identical, so the outcome cannot move. Kept even in
					// the skeleton so the parity test exercises a real cosmetic draw.
					cosmetic.nextInt(1000);
					log.push({
						tDeciSec: t,
						round,
						type: shot.hit ? "hullShieldHit" : "miss",
						actorId: self.id,
						targetId: target.id,
						damage: shot.damage,
						result: shot.hit ? "hit" : "miss",
						shieldAfter: shot.shieldAfter,
						hullAfter: shot.hullAfter,
					});
					if (shot.killed) {
						log.push({
							tDeciSec: t,
							round,
							type: "destroyed",
							actorId: self.id,
							targetId: target.id,
							shieldAfter: shot.shieldAfter,
							hullAfter: shot.hullAfter,
						});
					}
				}
			}

			// PHASE D (Phase 4 seam): tick status effects here. Empty in the
			// skeleton; the reserved self.statusEffects array is intentionally not
			// iterated yet. Left as a comment so the ordering slot is reserved.
			// for (const effect of self.statusEffects) { /* Phase 4 */ }
		}

		// PHASE E: evaluate the objective after the full tick resolved. If the
		// battle is decided, stop immediately (a wiped team, etc.).
		decided = objective(working);
		if (decided !== null) {
			break;
		}
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
