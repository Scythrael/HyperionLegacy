// ============================================================================
// combat/enemyWave.ts -- the deterministic Patrol enemy-wave generator
// (Combat 0.13.0, Phase 9b sub-phase 4)
//
// WHY THIS EXISTS, AND WHY IT IS ITS OWN PURE MODULE:
// A Patrol travels a route and, at each scheduled wave (waveSchedule.ts decides
// WHEN + HOW MANY), a battle runs. This module answers the next question: WHAT is
// in one wave. It builds the ENEMY SIDE of a single battle: a fresh Combatant[]
// team, each combatant a picked pirate hull (enemyHulls.ts) folded through the
// bridge (bridge.ts shipToCombatant) with FRESH weapon + drone instances. It does
// NOT run the battle, define the Patrol mission, or touch save / GameState; a
// later sub-phase calls this, then hands the (player + enemies) roster to
// resolveBattle.
//
// DETERMINISM IS THE HARD INVARIANT (design S0 principles 1 to 3):
// The enemy team is an OUTCOME INPUT to resolveBattle, so it MUST be a pure
// function of (seed, params): same seed + same params => a byte-identical team,
// whether the patrol runs live or offline (headless catch-up). Every random draw
// comes ONLY from makeRng(seed) integer helpers (rng.ts); NOTHING here touches
// Math.random. The patrol loop will pass a seed derived from a persisted master
// seed + the encounter index, so a wave's composition replays identically.
//
// DRAW-ORDER CONTRACT (critical for future integration parity):
// We consume the PRNG stream in ONE fixed, documented order:
//   1. ONE nextRange(min, max) draw to pick the team SIZE (count).
//   2. Then, per enemy i in 0..count-1, ONE nextInt(hullPool.length) draw to pick
//      that enemy's hull from the pool.
// Total draws = 1 + count. Building each enemy's weapons + squadrons consumes NO
// draws (they are deterministic expansions of the picked hull's fixed lists). So
// the draw count is fully determined by (seed, params), which lets a later
// consumer that shares this stream predict the draw count and stay parity-safe.
// ============================================================================

import { makeRng } from "./rng";
import { shipToCombatant, type CombatShipStats } from "./bridge";
import { makeWeaponInstance } from "./weapons";
import { makeSquadron } from "./drones";
import { PIRATE_HULLS, type PirateHullId } from "./enemyHulls";
import type { Combatant, CombatTeam } from "./types";

// The enemy team value from the CombatTeam union (types.ts). Bound to a named
// const (rather than sprinkling the bare "enemy" string) so the team side these
// combatants join is stated once and a rename of the union would surface here.
const ENEMY_TEAM: CombatTeam = "enemy";

// Public param shape every caller (the patrol / faction layer in 9b.5) codes
// against. All numeric fields are integers by contract; the guards below reject
// anything that would let a float or a nonsensical range into the outcome path.
export interface EnemyWaveParams {
	// Which pirate hulls THIS wave may field. The patrol / faction supplies it in
	// 9b.5 (e.g. an early faction fields only ["raider"], a tougher one adds the
	// marauder + carrier). Must be non-empty and every id a real PIRATE_HULLS key.
	hullPool: PirateHullId[];
	// Team-size floor (>= 1). A wave is always at least one enemy.
	enemyCountMin: number;
	// Team-size ceiling (>= enemyCountMin). MULTI-ENEMY IS SUPPORTED: when
	// enemyCountMax > 1 a wave can be a TEAM of several pirates (the returned
	// Combatant[] length can exceed 1).
	enemyCountMax: number;
	// Id prefix for every combatant / weapon / squadron id this wave mints (e.g.
	// the faction id + encounter index). Makes enemy ids UNIQUE across the battle
	// (the sim's turn-order sort key must not collide) and TRACEABLE back to the
	// wave that spawned them.
	idPrefix: string;

	// ⚠️ FORWARD SEAM (TI-TX difficulty, design note): a future difficulty tier
	// will scale enemy strength / count / hazards. This params object is the SINGLE
	// place such a knob would be added (e.g. a `tier` field the generator reads to
	// scale stats or bias the hull pick). Do NOT build it now; it is called out
	// here so a future reader grows THIS shape instead of threading a new argument.
}

// ---------------------------------------------------------------------------
// generateEnemyWave -- build the ENEMY TEAM for one wave.
//
// Returns a fresh Combatant[] of length in [enemyCountMin, enemyCountMax], each
// combatant built via shipToCombatant with the ENEMY team, a picked pirate hull's
// stats, and FRESH per-battle weapon + drone instances (so the sim's per-instance
// mutation never leaks between enemies or back into the shared content templates).
// Deterministic from (seed, params): see the draw-order contract in the header.
// ---------------------------------------------------------------------------
export function generateEnemyWave(
	seed: number,
	params: EnemyWaveParams,
): Combatant[] {
	const { hullPool, enemyCountMin, enemyCountMax, idPrefix } = params;

	// ---- Guards: fail loud (Omega 14), mirroring rng.ts / waveSchedule.ts throw
	// style. A bad param here is a caller / def bug; silently clamping it would
	// hide a balance error and, worse, could desync live vs offline. So we throw. --

	// Integer-ness of the two count params FIRST: a float in the outcome path is
	// exactly the drift risk S0 forbids. Number.isInteger rejects fractionals, NaN,
	// and Infinity in a single check.
	if (!Number.isInteger(enemyCountMin)) {
		throw new Error(
			`generateEnemyWave requires integer enemyCountMin, received ${enemyCountMin}`,
		);
	}
	if (!Number.isInteger(enemyCountMax)) {
		throw new Error(
			`generateEnemyWave requires integer enemyCountMax, received ${enemyCountMax}`,
		);
	}
	// A non-empty pool is required: there must be at least one hull to pick from,
	// or nextInt(0) would itself throw with a less informative message.
	if (hullPool.length === 0) {
		throw new Error(
			`generateEnemyWave requires a non-empty hullPool, received an empty array`,
		);
	}
	// Every pool id must be a real hull. An unknown id would look up `undefined`
	// and crash mid-build with a confusing stack; catch it up front with the bad id.
	for (const hullId of hullPool) {
		if (!(hullId in PIRATE_HULLS)) {
			throw new Error(
				`generateEnemyWave received an unknown pirate hull id "${hullId}" in hullPool`,
			);
		}
	}
	// A wave is always at least one enemy (design: a scheduled wave that resolves to
	// zero enemies would be a no-op battle, which is a def bug, not a valid state).
	if (enemyCountMin < 1) {
		throw new Error(
			`generateEnemyWave requires enemyCountMin >= 1, received ${enemyCountMin}`,
		);
	}
	// The ceiling must not sit below the floor, or the count draw has no valid band.
	if (enemyCountMax < enemyCountMin) {
		throw new Error(
			`generateEnemyWave requires enemyCountMax >= enemyCountMin, received ` +
				`min=${enemyCountMin} max=${enemyCountMax}`,
		);
	}

	// ---- The single deterministic stream, consumed in the documented order. ----
	const rng = makeRng(seed);

	// DRAW 1: the team size. nextRange is inclusive of both ends, so a wave can be
	// exactly enemyCountMin, exactly enemyCountMax, or anything between.
	const count = rng.nextRange(enemyCountMin, enemyCountMax);

	// Build the team. For each enemy: DRAW one hull index, look up the template,
	// then EXPAND (no draws) its guns + squadrons into fresh instances.
	const enemies: Combatant[] = [];
	for (let i = 0; i < count; i++) {
		// DRAW (per enemy): pick a hull from the pool. Uniform over the pool; a
		// weighted pick would be a future knob on the params seam, not this pass.
		const hullId = hullPool[rng.nextInt(hullPool.length)];
		const hull = PIRATE_HULLS[hullId];

		// The three combat stats the bridge reads, pulled straight off the hull
		// template. A plain literal structurally satisfies CombatShipStats (the
		// bridge does not require a full ShipTypeDef).
		const stats: CombatShipStats = {
			hullIntegrity: hull.hullIntegrity,
			shieldCapacity: hull.shieldCapacity,
			shieldRecharge: hull.shieldRecharge,
		};

		// FRESH weapon instances (no draws): one per weapon in the hull's list. Each
		// instance id is suffixed with the enemy index + slot so two enemies (or two
		// copies of one weapon) never collide on the id turn-order key. makeWeaponInstance
		// returns a fully independent instance (own cooldown accumulator + effect-slot
		// array), the per-battle deep clone the sim requires.
		const weaponLoadout = hull.weapons.map((weaponId, w) =>
			makeWeaponInstance(weaponId, `${idPrefix}-e${i}-w${w}-${weaponId}`),
		);

		// FRESH squadrons (no draws): one per drone role the hull fields (empty for
		// non-carriers). Tier 0 (base) + role-default size, matching how the bridge
		// builds a carrier's default screen. idPrefix is enemy-scoped so two carriers
		// in one wave never share a squadron id.
		const drones = hull.droneRoles.map((role, r) =>
			makeSquadron(role, undefined, 0, `${idPrefix}-e${i}-${role}${r}`),
		);

		// Fold it into a Combatant on the ENEMY team. An explicit weaponLoadout /
		// drones ALWAYS wins in the bridge (no hullType passed: a pirate hull is not
		// one of the player CombatHullTypes). Stance comes from the hull template.
		enemies.push(
			shipToCombatant({
				id: `${idPrefix}-e${i}`,
				team: ENEMY_TEAM,
				stats,
				weaponLoadout,
				drones,
				stance: hull.stance,
			}),
		);
	}

	return enemies;
}
