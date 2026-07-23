// ============================================================================
// combat/rating.ts -- the two ADVISORY combat readiness numbers (Combat 0.13.0,
// Phase 8, design S11):
//
//   1. battleRating(combatant): a STABLE, OPPONENT-AGNOSTIC scalar composite of a
//      combatant's combat stats. The "how geared am I" number you can hold in
//      your head. Higher gear/hull/shields/weapon DPS/resists/drones => higher
//      rating. DETERMINISTIC and MONOTONIC (adding gear never LOWERS it).
//
//   2. engagementForecast(player, enemy, options): a Monte-Carlo win-rate over
//      the REAL deterministic sim. Shown at mission-select vs a SPECIFIC enemy;
//      it runs YOUR build vs THEIRS through resolveBattle across N seeds and
//      reports the win %. This is the HONEST predictor: it uses the actual
//      mechanics (elements, resists, disruptions, range, drones), which is why a
//      25000-rating loadout can still forecast a LOSS vs a hard 3000-rating
//      counter. Battle Rating alone cannot see a matchup; the forecast can.
//
// WHY TWO NUMBERS (design S11): a single power number lies about matchups (the
// "25,000 loses to 3,000" problem). Rating answers "am I geared?" cheaply and
// matchup-free; the forecast answers "will I win THIS fight?" honestly by
// actually simulating it. Both are ADVISORY: the fight is a seeded sim, so a
// player can dispatch under-geared and still win, or lose a favored fight. These
// are guidance, never a gate.
//
// PURITY: both functions are PURE. They never mutate their inputs and have no
// side effects. resolveBattle already DEEP-CLONES its participants (see
// resolveBattle.ts cloneParticipants + its "does NOT mutate the caller's
// participants" parity test), so the Monte-Carlo can reuse the same combatant
// objects across every sample without cloning them here.
//
// ⚠️ EVERY WEIGHT + CONSTANT in this file is FIRST-PASS + TUNABLE (design S20
// owns the balance pass). They are chosen to make the rating MONOTONIC and
// roughly express "more of any combat stat is worth more", NOT to be balanced
// against each other yet. The forecast's honesty does NOT depend on these
// weights at all (it simulates), so mis-tuned rating weights only affect the
// cheap advisory number, never the matchup prediction.
//
// SEAMS: the mission-select UI (Phase 12) shows battleRating on a ship card and
// engagementForecast on a Patrol card vs the generated enemy; Phase 9 (mission
// integration) also calls engagementForecast to populate that card. Both are
// pure functions those layers CALL; this file does not import or touch any UI /
// mission / GameState code (design invariant: stay inside combat/).
// ============================================================================

import type { Combatant, CombatWeapon, FamilyResist } from "./types";
import type { DroneSquadron } from "./drones";
import { resolveBattle } from "./resolveBattle";

// ---------------------------------------------------------------------------
// TUNABLE WEIGHTS (design S20). Each term below is computed in "natural" units
// (effective HP in points, weapon output in damage-per-second, etc.) and then
// scaled by its weight into the single composite scalar. The weights set the
// RELATIVE worth of a point of each: e.g. a point of sustained DPS is worth more
// rating than a point of hull, because DPS ends fights.
//
// These are deliberately simple round numbers. The ONLY hard contract they must
// preserve is MONOTONICITY: every weight is >= 0 and every term is a sum of
// non-negative contributions, so adding any gear can only hold or raise the
// rating, never lower it.
// ---------------------------------------------------------------------------
const RATING_WEIGHTS = {
	// A point of effective HP (hullMax + shieldMax). The survivability floor.
	effectiveHp: 1,
	// A point of sustained weapon damage-per-second. Offense ends fights, so a
	// DPS point is worth ~10 HP points of rating (first-pass).
	weaponDps: 10,
	// A point of the mixed defense term (recharge + armor + dampening + resists).
	// Mitigation multiplies your EHP in practice, so it is weighted above raw HP.
	defense: 2,
	// A point of the drone contribution (drone DPS + a fraction of drone EHP).
	drone: 8,
} as const;

// Within the DRONE term, how much a point of drone effective-HP is worth
// relative to a point of drone DPS. Drones are expendable screens, so their HP
// is worth a FRACTION of their offense. Tunable (design S20).
const DRONE_EHP_FRACTION = 0.1;

// ---------------------------------------------------------------------------
// battleRating -- the stable, opponent-agnostic composite.
// ---------------------------------------------------------------------------

// Sum a FamilyResist's three integer percents. Used for both the damage-resist
// and disruption-resist maps in the defense term. A higher total (more resist
// across families) raises the defense term, so it is monotonic.
function sumFamilyResist(r: FamilyResist): number {
	return r.kinetic + r.particle + r.ew;
}

// Approximate a single weapon's SUSTAINED damage-per-second, opponent-agnostic.
//
//   dps = avgYield * projectileCount * hitFactor / cooldownSeconds
//
// where avgYield = (yieldMin + yieldMax) / 2, hitFactor = accuracy/100 (a
// "hit-ish" factor with no specific enemy evasion, since rating is matchup-
// free), and cooldownSeconds = cooldownDeciSec / 10 (deci-seconds -> seconds).
//
// This is intentionally a naive expected-output number: it ignores crit, the
// family triangle, and attenuation (all of which need an enemy to matter). Those
// matchup effects live in engagementForecast, not here. Every input only ADDS to
// the sum, so the weapons term is monotonic in yield, projectiles, accuracy, and
// (inversely) cooldown.
function weaponDps(w: CombatWeapon): number {
	const avgYield = (w.yieldMin + w.yieldMax) / 2;
	// Guard divide-by-zero: a weapon should always have a positive cooldown, but
	// a malformed 0 must not produce Infinity/NaN (which would poison the sum and
	// break determinism). Clamp to at least 1 deci-second.
	const cooldownDeciSec = Math.max(1, w.cooldownDeciSec);
	const cooldownSeconds = cooldownDeciSec / 10;
	const hitFactor = w.accuracy / 100;
	return (avgYield * w.projectileCount * hitFactor) / cooldownSeconds;
}

// Approximate one squadron's contribution: its ALIVE drones' combined DPS plus a
// small fraction of their combined effective HP (they screen, so their HP has
// some rating worth, but far less than their offense). A support squadron with
// yield 0 contributes only its EHP fraction (still non-negative => monotonic).
function squadronContribution(sq: DroneSquadron): number {
	const aliveCount = sq.drones.reduce((n, d) => n + (d.alive ? 1 : 0), 0);
	if (aliveCount === 0) return 0;

	// Per-drone DPS mirrors weaponDps (each drone is a tiny weapon).
	const avgYield = (sq.yieldMin + sq.yieldMax) / 2;
	const cooldownDeciSec = Math.max(1, sq.attackCooldownDeciSec);
	const cooldownSeconds = cooldownDeciSec / 10;
	const hitFactor = sq.accuracy / 100;
	const perDroneDps = (avgYield * hitFactor) / cooldownSeconds;
	const squadronDps = perDroneDps * aliveCount;

	// The screen's own effective HP, worth a fraction of DPS (see the constant).
	const squadronEhp = sq.droneHp * aliveCount * DRONE_EHP_FRACTION;

	return squadronDps + squadronEhp;
}

// Compute the stable, opponent-agnostic Battle Rating for one combatant.
//
// The composite is four weighted terms:
//   1. Effective HP:  hullMax + shieldMax (the survivability pool). We use the
//      MAX values, not current, so the rating is a stable "how geared" number
//      that a mid-battle damaged ship still reports at full (it is a loadout
//      score, not a live-health score).
//   2. Weapons:       sum of each weapon's approximate DPS (weaponDps above).
//   3. Defense:       shieldRecharge + ablativeArmor + kineticDampening +
//      shieldCoherence + summed damage-resist + summed disruption-resist. Mixed
//      units (points and percents) deliberately summed flat: this is an advisory
//      scalar, not a physics model, and every input is non-negative so the term
//      stays monotonic.
//   4. Drones:        sum of each squadron's contribution (squadronContribution).
//
// Each term is scaled by its RATING_WEIGHTS entry, summed, and rounded ONCE at
// the end to a single integer (deterministic: no float ever escapes).
//
// MONOTONIC by construction: every term is a sum of non-negative contributions
// and every weight is non-negative, so adding a weapon / hull / shield / drone /
// defense point can only raise or hold the rating, never lower it. That is the
// property the tests assert and the "how geared am I" promise depends on.
export function battleRating(combatant: Combatant): number {
	// 1. Effective HP term (max pools => stable loadout score).
	const effectiveHp = combatant.hullMax + combatant.shieldMax;

	// 2. Weapons term: total approximate sustained DPS.
	let weaponDpsTotal = 0;
	for (const w of combatant.weapons) {
		weaponDpsTotal += weaponDps(w);
	}

	// 3. Defense term: flat sum of every mitigation stat (see the doc block).
	const defenseTotal =
		combatant.shieldRecharge +
		combatant.ablativeArmor +
		combatant.kineticDampening +
		combatant.shieldCoherence +
		sumFamilyResist(combatant.damageResist) +
		sumFamilyResist(combatant.disruptionResist);

	// 4. Drones term: total squadron contribution.
	let droneTotal = 0;
	for (const sq of combatant.drones) {
		droneTotal += squadronContribution(sq);
	}

	// Weighted composite, rounded once to a single deterministic integer.
	const composite =
		RATING_WEIGHTS.effectiveHp * effectiveHp +
		RATING_WEIGHTS.weaponDps * weaponDpsTotal +
		RATING_WEIGHTS.defense * defenseTotal +
		RATING_WEIGHTS.drone * droneTotal;

	return Math.round(composite);
}

// ---------------------------------------------------------------------------
// engagementForecast -- the honest Monte-Carlo win-rate vs a SPECIFIC enemy.
// ---------------------------------------------------------------------------

// Default number of simulated battles. Accuracy vs cost tradeoff (design S20 /
// S11): more samples tighten the estimate but cost more sim runs. 64 is a
// first-pass balance (a ~+/-6% standard error near 50%, cheap enough for a
// mission-select card). TUNABLE by the caller via options.samples.
const DEFAULT_SAMPLES = 64;

// Options for the forecast. Both optional so the common call site is just
// engagementForecast(player, enemy).
export interface EngagementForecastOptions {
	// How many seeded battles to simulate. More => a tighter estimate at more
	// cost. Defaults to DEFAULT_SAMPLES. TUNABLE (accuracy vs cost).
	samples?: number;
	// The base seed the per-sample seeds are derived from. A FIXED baseSeed makes
	// the whole forecast deterministic (same inputs + baseSeed => same win %),
	// which is what lets a mission-select card show a STABLE number instead of a
	// flickering one. Defaults to 0. The mission layer (Phase 9/12) can pass a
	// per-encounter seed so different encounters get independent samplings.
	baseSeed?: number;
}

// The forecast result: the win % (rounded integer 0..100) and the sample count
// it was computed from (so the UI can show confidence / "over N battles").
export interface EngagementForecast {
	winPercent: number;
	samples: number;
}

// Run YOUR build vs THEIRS through the real deterministic sim across many seeds
// and report the fraction the player wins.
//
// HOW THE MONTE-CARLO RUNS:
//   - For sample i in [0, samples), resolveBattle is called with seed
//     (baseSeed + i). Distinct consecutive seeds give distinct deterministic
//     battle courses (the combat RNG stream is seeded per call), so the samples
//     span a range of hit/miss/crit/proc rolls rather than repeating one battle.
//   - generateLog:false => the fast path (no event log, no cosmetic draws). The
//     outcome is byte-identical to the logged path (resolveBattle's offline==live
//     invariant), so skipping the log never changes the win count.
//   - A "win" is a battle whose outcome.winner equals the PLAYER'S team. Draws
//     and losses both count as not-a-win (a draw is not a success to dispatch on).
//
// DETERMINISM: for a fixed baseSeed the seed sequence is fixed, resolveBattle is
// pure + deterministic, so the win count and thus winPercent are identical on
// every call and every device. This is the property the mission card relies on.
//
// NO MUTATION: resolveBattle deep-clones its participants every call, so the same
// player/enemy objects are safely reused across all samples and are returned to
// the caller untouched (asserted by the purity test). We do NOT clone here.
//
// SEEDS: the mission-select UI (Phase 12) + Phase 9 mission integration call this
// to populate a Patrol card's forecast vs the seeded enemy; keep `samples`
// tunable there (accuracy vs the cost of N sims).
export function engagementForecast(
	player: Combatant,
	enemy: Combatant,
	options?: EngagementForecastOptions,
): EngagementForecast {
	// Resolve options. Clamp samples to at least 1 so we never divide by zero and
	// always run at least one battle (a malformed 0/negative degrades gracefully
	// to a single sample rather than returning NaN).
	const samples = Math.max(1, Math.floor(options?.samples ?? DEFAULT_SAMPLES));
	const baseSeed = options?.baseSeed ?? 0;

	// The participant set is the same for every sample; resolveBattle clones it
	// internally, so building it ONCE and reusing it is safe and avoids per-sample
	// allocation. The player's team drives what counts as a win.
	const participants = { combatants: [player, enemy] };
	const playerTeam = player.team;

	let wins = 0;
	for (let i = 0; i < samples; i++) {
		// Distinct deterministic seed per sample. baseSeed + i is the simplest
		// derivation that gives a fixed, reproducible sequence; a fancier splitmix
		// step is unnecessary since the RNG stream already decorrelates adjacent
		// seeds internally (see rng.ts makeStreams).
		const seed = baseSeed + i;
		// generateLog:false => fast, outcome-only, byte-identical to the logged path.
		const { outcome } = resolveBattle(participants, seed, {
			generateLog: false,
		});
		if (outcome.winner === playerTeam) {
			wins += 1;
		}
	}

	// Round the win fraction to a single integer percent. Deterministic given the
	// deterministic win count.
	const winPercent = Math.round((wins / samples) * 100);

	return { winPercent, samples };
}
