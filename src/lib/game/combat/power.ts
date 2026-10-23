// ============================================================================
// combat/power.ts: reactor power budget (Combat 0.13.0, Phase 5, design S10)
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
// E-MOD EM-2 (0.14.0): the install gate is live. It reads the whole ship (hull base
// output + Reactor Core, net draw after power efficiency) through shipPower.ts and
// refuses in equipment.ts canFitEquipment (reason overPower), with this file's
// boundary rule (exact-equal fits). canFitByPower stays the one-candidate form.
//
// E-MOD EM-3 (0.14.0): the combat over-budget penalty's curve (powerSupplyPercent below).
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

// ============================================================================
// E-MOD EM-3 (0.14.0): the combat over-budget penalty (plan docs/plans/2026-10-17-material-lines-and-emod-plan.md
// section 4 EM-3; user answers 2026-10-17: Over budget "Gentle penalty curve (Recommended)": smooth reduced strength as
// the shortfall grows, nothing shuts off; P6 "sqrt curve, floor 60% (Recommended)").
//
// A ship whose net draw exceeds its output fights at a POWER SUPPLY percent: its weapon damage and shield recharge are
// x sqrt(output / draw), never below POWER_SUPPLY_FLOOR_PERCENT. A ship in budget (draw <= output, the exact-equal
// rule above) is at 100, so it fights exactly as before. Frozen in the run's combat rules stamp when the cycle (or the
// run) starts (combatRules.ts CombatRulesStamp.powerSupplyPercent), applied in resolveBattle beside the worn reactor's
// reactorDamagePercent (multiplicative with it).
// ============================================================================

// The lowest power supply percent an over-budget ship fights at (user answer P6, 2026-10-17: "floor 60%").
export const POWER_SUPPLY_FLOOR_PERCENT = 60;

// The whole square root of a non-negative integer, rounded down (exact: Math.sqrt is correctly rounded, and the two
// loops fix any float edge). Pure.
function isqrt(n: number): number {
	let r = Math.floor(Math.sqrt(n));
	while (r * r > n) r -= 1;
	while ((r + 1) * (r + 1) <= n) r += 1;
	return r;
}

// The whole power supply percent a ship of `output` fights at against a NET draw of `draw` (both whole numbers):
// 100 in budget; otherwise floor(100 x sqrt(output / draw)), never below the floor. Integer math only (floor of the
// root of 10,000 x output / draw), so it is the same on every machine. Pure.
export function powerSupplyPercent(output: number, draw: number): number {
	if (!(draw > output)) return 100;
	const ratio = Math.floor((10_000 * Math.max(0, output)) / draw);
	// (ratio < 10,000 here, so the root is below 100.)
	return Math.max(POWER_SUPPLY_FLOOR_PERCENT, isqrt(ratio));
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
