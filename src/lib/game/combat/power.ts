// ============================================================================
// combat/power.ts -- reactor power budget (Combat 0.13.0, Phase 5, design S10)
//
// A ship's reactor `powerOutput` gates what its loadout can draw: you cannot
// stack the craziest weapons/modules if the reactor cannot supply them, which
// makes loadout a real tradeoff (design S10). This module is the PURE budget
// math:
//   - powerBudget(reactorOutput, loadout): total draw vs output, with remaining
//     headroom and an over-budget flag.
//   - canFitByPower(reactorOutput, currentDraw, candidateDraw): would adding one
//     more drawing system still fit under the reactor.
//
// ⚠️ SEAM (integration phase, NOT this patch): the FIT-TIME UI gate that CALLS
// canFitByPower (blocking an over-budget install) is the integration phase, along
// with real per-ship reactor numbers (design S10 also has reactorTier gating
// equip/module tiers, forward). Here we ship only the datum (CombatWeapon.
// powerDraw) + these pure helpers, unit tested.
//
// Integer math throughout (design S0.4): powerDraw and powerOutput are whole
// numbers, so the budget is exact and drift-proof. The boundary rule is
// EXACT-EQUAL FITS (draw == output is allowed, a fully-loaded reactor is legal);
// only STRICTLY exceeding the output is blocked.
// ============================================================================

// The minimal shape the budget reads: anything that draws reactor power. Kept
// STRUCTURAL (not tied to CombatWeapon) so modules / drones / any future powered
// system feed the same budget without a shared class. CombatWeapon satisfies it.
export interface PoweredSystem {
	// Reactor load this system places on the ship (integer, >= 0).
	powerDraw: number;
}

// The computed budget for a loadout against a reactor output.
export interface PowerBudget {
	// The reactor's total supply (echoed back for callers/UI).
	output: number;
	// Sum of every system's powerDraw in the loadout.
	draw: number;
	// output - draw. NEGATIVE when the loadout exceeds the reactor (over budget);
	// >= 0 is the headroom left for another system.
	remaining: number;
	// True iff draw STRICTLY exceeds output (design S10: exact-equal is allowed, so
	// only a real overrun is flagged).
	overBudget: boolean;
}

// Sum a loadout's total power draw (integer). Empty loadout => 0.
export function totalPowerDraw(loadout: readonly PoweredSystem[]): number {
	let sum = 0;
	for (const system of loadout) {
		sum += system.powerDraw;
	}
	return sum;
}

// Compute the full budget for a loadout against a reactor output (design S10).
// Pure: reads only its inputs, allocates a fresh result. Exact-equal draw==output
// is IN budget (overBudget false, remaining 0); a strict overrun is over budget.
export function powerBudget(
	reactorOutput: number,
	loadout: readonly PoweredSystem[],
): PowerBudget {
	const draw = totalPowerDraw(loadout);
	return {
		output: reactorOutput,
		draw,
		remaining: reactorOutput - draw,
		// STRICTLY greater than output => over budget. Equal fits.
		overBudget: draw > reactorOutput,
	};
}

// Would adding a candidate system of `candidateDraw` to a loadout already drawing
// `currentDraw` still fit under `reactorOutput`? True iff the new TOTAL is <=
// output (design S10 boundary: exact-equal fits). This is the predicate the
// integration-phase fit-time gate calls to block an over-budget install.
export function canFitByPower(
	reactorOutput: number,
	currentDraw: number,
	candidateDraw: number,
): boolean {
	return currentDraw + candidateDraw <= reactorOutput;
}
