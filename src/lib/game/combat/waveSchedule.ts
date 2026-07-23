// ============================================================================
// combat/waveSchedule.ts -- deterministic Patrol wave-schedule generator
// (Combat 0.13.0, Phase 9b sub-phase 3)
//
// WHY THIS EXISTS, AND WHY IT IS ITS OWN PURE MODULE:
// A Patrol mission travels a route and, along the way, fights a deterministic
// number of enemy waves. This module answers exactly ONE question: HOW MANY
// waves occur and AT WHICH ROUTE TICKS. It does not run battles, touch mission
// state, or persist anything; later sub-phases (dispatch + a resolveBattle call
// per encounter) consume the tick list this returns.
//
// It is isolated on purpose. The whole combat system rests on design S0's hard
// invariant: every outcome-affecting value must be a PURE function of (inputs,
// seed) and resolve BYTE-IDENTICALLY whether the mission runs live or offline
// (headless catch-up). The wave count is outcome-affecting (it decides how many
// battles happen), so it MUST be deterministic and draw its randomness from the
// combat PRNG (rng.ts), never Math.random. Pulling this into a tiny pure module
// lets us PROVE that determinism + the count invariants in unit tests before it
// is ever wired into the mission loop, which is where a determinism bug would be
// far more expensive to find.
//
// TWO FORCES SHAPE THE SCHEDULE:
//   1. A per-tick "natural" roll (waveChance*) that organically sprinkles waves
//      across the eligible window. This is the flavor knob (a spikier route
//      raises the numerator).
//   2. Catch-up "checkpoints" that GUARANTEE the floor (minWaves) is met even on
//      an unlucky run where the natural rolls never fire, and that those
//      guaranteed waves are SPREAD across the route rather than dumped at the
//      end. maxWaves caps the top (Infamy raises the cap => more possible waves).
// The result length is therefore always in [minWaves, maxWaves] by construction.
//
// DRAW-ORDER CONTRACT (critical for future integration parity):
// We consume the PRNG stream in a single, predictable order: one forward pass
// over ticks rollStartTick..rollEndTick, and we draw EXACTLY ONE chance() roll
// per tick where we take a natural roll, and ZERO draws on a catch-up tick or
// once the cap is reached. Because catch-up consumes no draw, the number of
// draws taken is fully determined by the params + seed, so a later consumer that
// shares this stream can predict the draw count and stay parity-safe.
// ============================================================================

import { makeRng } from "./rng";

// Public param shape every caller (patrol definitions, dispatch) codes against.
// All fields are integers by contract; the guards below reject anything that
// would let a float or a nonsensical range into the outcome path.
export interface WaveScheduleParams {
	minWaves: number; // guaranteed floor (>= 0)
	maxWaves: number; // ceiling (>= minWaves)
	rollStartTick: number; // first route tick a wave can occur (after initial transit)
	rollEndTick: number; // last route tick a wave can occur (inclusive)
	waveChanceNumerator: number; // per-tick natural-roll chance, e.g. 15
	waveChanceDenominator: number; // e.g. 100  (=> 15% per eligible tick)
}

// Returns the SORTED, ascending route ticks at which waves occur. Length is
// always in [minWaves, maxWaves]. Deterministic: same seed + params => same
// array, whether called live or in offline catch-up.
export function planWaveSchedule(
	seed: number,
	params: WaveScheduleParams,
): number[] {
	const {
		minWaves,
		maxWaves,
		rollStartTick,
		rollEndTick,
		waveChanceNumerator,
		waveChanceDenominator,
	} = params;

	// ---- Guards: fail loud (Omega 14), mirroring rng.ts's throw style. A bad
	// param here is a caller/def bug, and silently clamping it would hide a
	// balance error and, worse, could desync live vs offline. So we throw. ----

	if (minWaves < 0) {
		throw new Error(
			`planWaveSchedule requires minWaves >= 0, received ${minWaves}`,
		);
	}
	if (maxWaves < minWaves) {
		throw new Error(
			`planWaveSchedule requires maxWaves >= minWaves, received ` +
				`min=${minWaves} max=${maxWaves}`,
		);
	}
	if (rollStartTick > rollEndTick) {
		throw new Error(
			`planWaveSchedule requires rollStartTick <= rollEndTick, received ` +
				`[${rollStartTick}, ${rollEndTick}]`,
		);
	}
	if (waveChanceDenominator < 1) {
		throw new Error(
			`planWaveSchedule requires waveChanceDenominator >= 1, received ` +
				`${waveChanceDenominator}`,
		);
	}
	if (
		waveChanceNumerator < 0 ||
		waveChanceNumerator > waveChanceDenominator
	) {
		throw new Error(
			`planWaveSchedule requires waveChanceNumerator in [0, ` +
				`${waveChanceDenominator}], received ${waveChanceNumerator}`,
		);
	}
	// The window must physically hold at least minWaves distinct ticks, one wave
	// per tick. If a def demands more guaranteed waves than the window has ticks,
	// the floor is impossible; that is a sizing bug in the patrol def, so throw
	// rather than silently delivering fewer than minWaves.
	const windowTickCount = rollEndTick - rollStartTick + 1;
	if (windowTickCount < minWaves) {
		throw new Error(
			`planWaveSchedule window [${rollStartTick}, ${rollEndTick}] holds ` +
				`${windowTickCount} ticks, too few for minWaves=${minWaves}`,
		);
	}

	// A zero ceiling means no waves are possible at all; short-circuit before we
	// build any state. (minWaves is guaranteed <= maxWaves === 0 here, so this is
	// consistent with the floor.)
	if (maxWaves === 0) {
		return [];
	}

	// ---- Catch-up checkpoints: the deadlines that guarantee the floor, spread
	// evenly across the window. ----
	//
	// checkpoint_i = rollStartTick + floor(i * window / minWaves), for i in
	// 1..minWaves, where window = rollEndTick - rollStartTick. This places the
	// LAST checkpoint (i === minWaves) exactly on rollEndTick and distributes the
	// rest evenly before it, so the guaranteed minimum is spread across the route
	// instead of stacked at the end.
	//
	// NOTE (FIRST-PASS TUNABLE): this even spacing is a starting point, not a
	// balance verdict. If playtesting wants front-loaded or back-loaded pressure,
	// only this formula changes; the pass below and every invariant stay intact.
	// The design doc's "~tick 20 and ~90" example is illustrative; nothing here
	// hardcodes those numbers.
	//
	// When minWaves === 0 this loop produces no checkpoints (an empty floor),
	// which also sidesteps the divide-by-minWaves entirely.
	const window = rollEndTick - rollStartTick;
	const checkpoints: number[] = [];
	for (let i = 1; i <= minWaves; i++) {
		checkpoints.push(rollStartTick + Math.floor((i * window) / minWaves));
	}
	// requiredByTick(t) = how many checkpoint deadlines have passed by tick t.
	// checkpoints is ascending by construction, so we count with a moving pointer
	// as the forward pass advances t (cheaper + clearer than re-scanning). This
	// value is monotonic non-decreasing in t and reaches minWaves at rollEndTick.
	let checkpointPtr = 0;

	// ---- The single forward pass. ----
	// One deterministic PRNG stream, consumed in strict tick order. `scheduled`
	// is both the running count and the index of the next slot to fill.
	const rng = makeRng(seed);
	const ticks: number[] = [];
	let scheduled = 0;

	for (let t = rollStartTick; t <= rollEndTick; t++) {
		// Once the cap is hit, no further wave can be added; stop early. This is
		// what enforces maxWaves and, in the certain-chance case, makes waves fill
		// contiguously from the start (so a smaller cap is a prefix of a larger).
		if (scheduled === maxWaves) {
			break;
		}

		// Advance the checkpoint pointer past every deadline at or before t, giving
		// requiredByTick(t). A collision (two checkpoints on one tick) cannot occur
		// for any window the guard allows, so this increments by at most one per
		// tick, exactly matching our one-wave-per-tick catch-up capacity.
		while (
			checkpointPtr < checkpoints.length &&
			checkpoints[checkpointPtr] <= t
		) {
			checkpointPtr++;
		}
		const requiredByTick = checkpointPtr;

		// CATCH-UP FIRST: if we are behind the guaranteed floor for this tick, we
		// MUST place a wave here to stay on pace, and we deliberately do NOT also
		// run a natural roll on this same tick (one wave per tick max). Crucially,
		// a catch-up tick consumes NO PRNG draw, which is what keeps the draw count
		// predictable for parity (see the draw-order contract in the header).
		if (scheduled < requiredByTick) {
			ticks.push(t);
			scheduled++;
			continue;
		}

		// ELSE NATURAL ROLL: we are on pace, so let the route organically decide.
		// Exactly one chance() draw here (an integer-domain draw, no float in the
		// outcome path). On success we schedule; on failure the tick stays empty.
		if (rng.chance(waveChanceNumerator, waveChanceDenominator)) {
			ticks.push(t);
			scheduled++;
		}
	}

	// Ascending already (single forward pass, one push per tick). Length is in
	// [minWaves, maxWaves]: checkpoints force scheduled up to minWaves unless the
	// cap intervenes first, and the cap bounds the top.
	return ticks;
}
