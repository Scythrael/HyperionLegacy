// ============================================================================
// combat/positioning.ts -- range bands, stance, movement + targeting policy for
// the combat sim (Combat 0.13.0, Phase 6: the positional layer)
//
// WHY ITS OWN MODULE (design S6). Phases 2/3 modeled distance as a bare scalar
// and movement as "close straight toward the nearest enemy". Phase 6 turns that
// into a real positional layer: three named RANGE BANDS, a per-ship STANCE with
// a preferred fighting distance, no-overshoot MOVEMENT toward that distance, and
// a formal TARGETING policy. All of it is PURE INTEGER math over positions +
// weapon ranges (design S0.4: integer everywhere, no float, no cross-device
// drift), and NONE of it draws from an RNG stream, so it is deterministic and
// cannot perturb the combat draw schedule (the offline == live invariant). The
// sim (resolveBattle) imports these helpers and applies them each tick; keeping
// the geometry here (not inline in the loop) makes every rule a small, directly
// unit-tested pure function (Omega 9: rule-based, readable without the sim).
//
// KEY MODEL FACTS carried from earlier phases:
//   - Distance between two combatants is abs(a.position - b.position) on a 1D
//     axis (types.ts Combatant.position). Movement changes positions to change
//     distance.
//   - A weapon's `range` is the MAX distance it can fire at (interpreted against
//     the bands below): a Short-range weapon needs the target inside ~BAND_SHORT.
// ============================================================================

import type { Combatant, CombatWeapon } from "./types";

// ---------------------------------------------------------------------------
// RANGE BANDS (design S6 Long / Medium / Short, anchored to the Phase 3 roster
// scale in weapons.ts: Long 300 / Medium 200 / Short 100). Named consts so the
// thresholds are ONE knob board (a balance pass, design S20, owns the exact
// numbers) and the sim reads as intent, not magic distances. A band is the
// INCLUSIVE distance ceiling of its zone: a "short" weapon (range == BAND_SHORT)
// reaches out to 100 and no further.
// ---------------------------------------------------------------------------
export const BAND_SHORT = 100;
export const BAND_MEDIUM = 200;
export const BAND_LONG = 300;

// The three bands, closest to farthest. A "long" classification also covers any
// distance BEYOND BAND_LONG (there is no fourth band; past long range simply
// means every weapon is out of range, which the range gate handles on its own).
export type RangeBand = "short" | "medium" | "long";

// Classify a raw distance into its band. Thresholds are inclusive ceilings, so
// exactly 100 is still "short", exactly 200 still "medium". Used for narration
// (the range readout's band marker) and to derive stance preferred distances.
export function bandFor(distance: number): RangeBand {
	if (distance <= BAND_SHORT) return "short";
	if (distance <= BAND_MEDIUM) return "medium";
	return "long";
}

// Can this weapon fire at a target `distance` away? A weapon's `range` is the
// MAXIMUM distance it can reach (design S6), so the test is a simple ceiling
// check. Pure geometry over the weapon's NOMINAL range; the sim applies the
// Sensor Power Drain (-range) debuff separately at the firing gate (see
// resolveBattle), keeping this helper a clean, debuff-free predicate the tests
// pin directly (a Short weapon cannot hit at Long distance).
export function weaponInRange(weapon: CombatWeapon, distance: number): boolean {
	return distance <= weapon.range;
}

// The longest NOMINAL firing range across all of a combatant's weapons (design
// S6). This is the distance at which the ship's FIRST weapon can open up (its
// longest-range gun), so it is the natural "in weapons range at all" threshold
// the combat-view PHASE derivation (combatPhase below) reads. Pure integer max
// over the weapon list, no RNG, no debuff (nominal range, mirroring
// weaponInRange). An UNARMED ship returns 0: it is never in weapons range, so it
// never leaves the pre-firing phases, which is exactly correct (it cannot fire).
export function longestWeaponRange(self: Combatant): number {
	let longest = 0;
	for (const weapon of self.weapons) {
		if (weapon.range > longest) longest = weapon.range;
	}
	return longest;
}

// ---------------------------------------------------------------------------
// COMBAT PHASE (design S16 combat view: "phase narration (detection -> intercept
// -> weapons-ready -> firing)"). A DISPLAY-ONLY classification of where a ship is
// in the engagement arc, derived purely from its distance to its target, its
// longest weapon range, the round, and whether it has fired yet. It is consumed
// ONLY by the combat-view readout (emitted under generateLog); it never gates a
// shot, moves a ship, or draws an RNG, so it cannot perturb any outcome.
// ---------------------------------------------------------------------------
export type CombatPhase = "detection" | "intercept" | "weaponsReady" | "firing";

// Derive the display phase for one combatant vs its current target (design S16).
// The four phases map to concrete, testable sim conditions, checked MOST-ADVANCED
// first so the arc only ever moves forward within a readout:
//   - "firing":       the ship has already fired at least once this engagement
//                     (shots are being exchanged). `hasFired` is the sim's record
//                     of a real shot / ambush salvo going off.
//   - "weaponsReady": not yet fired, but the target is now within the longest
//                     weapon's range (a charged salvo is about to open up).
//   - "detection":    round 0 and still out of all weapon range (the opening
//                     "entered sensor range" beat, before any closing).
//   - "intercept":    out of all weapon range and past round 0 (closing to range).
// PURE: no RNG, no mutation. Same inputs always give the same phase.
export function combatPhase(
	round: number,
	distance: number,
	longestRange: number,
	hasFired: boolean,
): CombatPhase {
	if (hasFired) return "firing";
	if (distance <= longestRange) return "weaponsReady";
	if (round === 0) return "detection";
	return "intercept";
}

// ---------------------------------------------------------------------------
// STANCE (design S6). A per-ship posture that sets the distance the ship TRIES
// to hold from its target. Player-set per dispatch (mission layer, Phase 9);
// enemies derive it from their loadout later. Default "balanced" everywhere.
// ---------------------------------------------------------------------------
export type CombatStance = "aggressive" | "balanced" | "standoff";

// The distance a stance wants to fight at (design S6): Aggressive charges to
// Short range (exposes itself to brawl), Balanced holds Medium, Standoff kites
// at Long range. Returning a band ANCHOR (not an arbitrary number) keeps stance
// and bands consistent: an aggressive ship parks exactly at the short-band edge.
// TUNABLE (design S20): the preferred distance could later be an interior point
// of a band rather than its edge.
export function stancePreferredDistance(stance: CombatStance): number {
	switch (stance) {
		case "aggressive":
			return BAND_SHORT; // charge in and brawl
		case "balanced":
			return BAND_MEDIUM; // trade at mid range
		case "standoff":
			return BAND_LONG; // kite at the edge
	}
}

// ---------------------------------------------------------------------------
// MOVEMENT (design S6). Each tick a combatant steps toward its stance's
// preferred distance from its CURRENT target: it CLOSES if too far and OPENS
// (kites) if too close, by up to `wholeSteps` position units, NEVER overshooting
// the preferred point. This is the pure geometric core; the sim owns the
// banked-tenths accumulator that turns a per-second speed into integer
// `wholeSteps` per tick (and the Coolant Leak -speed debuff scaling).
//
// Returns a SIGNED delta to add to self.position: positive moves toward the
// target (closing), negative moves away (kiting), 0 holds. All integer.
//
// DEGENERATE CO-LOCATED CASE (gap === 0): two ships stacked on the exact same
// position have NO defined direction to open toward, so the ship HOLDS. This is
// deliberate and load-bearing for two reasons: (1) a real encounter never starts
// co-located (design S6 opens at long range), so this only ever hits synthetic
// setups; (2) the pre-Phase-6 parity fixtures place both ships at position 0, and
// holding there keeps their distance at 0 (always in range), so those flagship
// determinism/parity outcomes stay byte-identical. TODO(balance): if a
// co-located kite is ever wanted, pick a deterministic open direction (e.g. by
// id) instead of holding.
// ---------------------------------------------------------------------------
export function stanceMoveDelta(
	selfPosition: number,
	targetPosition: number,
	preferredDistance: number,
	wholeSteps: number,
): number {
	// No movement budget this tick (sub-unit speed still banking): hold.
	if (wholeSteps <= 0) return 0;

	const gap = targetPosition - selfPosition;
	// Co-located: no direction to open toward (see the degenerate-case note above).
	if (gap === 0) return 0;

	// Unit direction from self toward the target on the 1D axis, and the current
	// separation. Closing moves along dirToTarget; opening moves against it.
	const dirToTarget = gap > 0 ? 1 : -1;
	const distance = Math.abs(gap);

	if (distance > preferredDistance) {
		// Too far: close the gap, capped so a fast ship never crosses PAST the
		// preferred point in a single tick (no overshoot).
		const step = Math.min(wholeSteps, distance - preferredDistance);
		return dirToTarget * step;
	}
	if (distance < preferredDistance) {
		// Too close: open/kite away, capped so we never over-open past preferred.
		const step = Math.min(wholeSteps, preferredDistance - distance);
		return -dirToTarget * step;
	}
	// Exactly at the preferred distance: hold station.
	return 0;
}

// ---------------------------------------------------------------------------
// TARGETING (design S6). The player default policy: focus-fire the lowest
// effective-HP enemy that is currently IN RANGE of at least one of the shooter's
// weapons; if no enemy is reachable yet, fall back to the lowest effective-HP
// enemy overall so the ship still has something to CLOSE toward while it walks
// into range. Deterministic id tiebreak so the pick never depends on array order
// or a float compare.
// ---------------------------------------------------------------------------

// Effective HP for target selection + tiebreak: shields soak before hull, so a
// ship's "how hard to kill right now" is simply shield + hull (design S6 lowest
// effective-HP). Exported so the sim's tiebreak + this policy share ONE
// definition (no divergent copies).
export function effectiveHp(c: Combatant): number {
	return c.shield + c.hull;
}

// A targeting policy is DATA the sim reads, so Phase 7/9 can vary it per
// combatant without touching the loop. Today it carries only the escort-share
// SEAM (see selectTarget); more knobs (priority-by-system, threat weighting)
// slot in additively later.
export interface TargetingPolicy {
	// RESERVED SEAM (design S6 "a tunable share to the escort", Phase 7/9). A
	// future integer-percent weight to occasionally split enemy fire onto a player
	// ESCORT instead of the warship. Defaults to 0 (off) and is NOT consulted yet:
	// escort ships do not exist until Phase 7/9. The field is live + typed now so
	// the seam is real; the behavior is deferred on purpose (do not build escort
	// splitting here). TODO(Phase 7/9): weighted escort target split off this value.
	escortShare?: number;
}

// Is `candidate` a strictly better target than the current `best`? Lower
// effective HP wins; on an exact tie the lower id wins (stable, order-independent
// determinism). A missing `best` means the candidate is trivially better.
function isBetterTarget(candidate: Combatant, best: Combatant | undefined): boolean {
	if (best === undefined) return true;
	const candHp = effectiveHp(candidate);
	const bestHp = effectiveHp(best);
	if (candHp !== bestHp) return candHp < bestHp;
	return candidate.id < best.id;
}

// Does `self` have ANY weapon that can reach a target `distance` away right now?
// Uses each weapon's NOMINAL range (the firing gate applies range debuffs); this
// is the heuristic that decides whether an enemy counts as "in range" for target
// selection. A ship with no in-range enemy falls back to closing on the nearest
// viable one.
function selfCanReach(self: Combatant, distance: number): boolean {
	for (const weapon of self.weapons) {
		if (weaponInRange(weapon, distance)) return true;
	}
	return false;
}

// Select the target `self` should fire at / close toward (design S6 policy).
// Two passes fused into one scan: track the best IN-RANGE enemy and the best
// enemy OVERALL; prefer the in-range one, else fall back to the overall one so
// the shooter always has a heading. Returns undefined only when no living enemy
// remains (its side has effectively won; the objective check formalizes it).
export function selectTarget(
	self: Combatant,
	all: Combatant[],
	policy: TargetingPolicy = {},
): Combatant | undefined {
	// Touch the reserved escort-share seam so it is a live, typed input (its
	// behavior is Phase 7/9; see TargetingPolicy). Intentionally a no-op today.
	void policy.escortShare;

	let bestInRange: Combatant | undefined;
	let bestAny: Combatant | undefined;

	for (const other of all) {
		// Only living enemies of `self` are valid targets.
		if (!other.alive) continue;
		if (other.team === self.team) continue;

		// Best overall (the fallback heading when nothing is in range yet).
		if (isBetterTarget(other, bestAny)) bestAny = other;

		// Best among enemies at least one weapon can currently reach.
		const distance = Math.abs(self.position - other.position);
		if (selfCanReach(self, distance) && isBetterTarget(other, bestInRange)) {
			bestInRange = other;
		}
	}

	// Prefer an in-range focus target; otherwise close on the best available.
	return bestInRange ?? bestAny;
}
