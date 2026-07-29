// ============================================================================
// combat/durability.ts: system durability model + four-state condition
// (Combat 0.13.0, Phase 5, design S9)
//
// Gear loses durability on DAMAGE EVENTS (design S9: "a hit is an event"). This
// module is the PURE, self-contained combat-model logic for that:
//   - durabilityLossChance(quality): the per-event chance to lose one point,
//     REDUCED by quality (design S9: "~-10%/rank chance to lose a durability
//     point per event").
//   - qualityDurabilityMax(base, quality): the max-durability a quality item
//     carries (design S9: higher quality "~+100% durability" at the top rank).
//   - rollDurabilityLoss(item, rng): draw the combat-stream event once and drop
//     one durability point on success.
//   - systemCondition(item, isDisrupted): the FOUR-STATE condition pip the UI
//     reads later (design S9 / S16: Nominal / Degraded / Disrupted / Offline).
//
// ⚠️ SEAM (integration phase, NOT this patch): durability here is the combat
// MODEL only. It is NOT yet synced to real game equipment durability, and the
// sim does NOT roll it live yet (that would perturb the flagship parity/mechanic
// fixtures' fixed draw schedule). resolveBattle carries a documented TODO where
// the target's-systems durability event will fire once equipment durability sync
// lands. Until then these helpers are exercised only by their unit tests, which
// is exactly the "pure, tested helper" the phase asks for.
//
// ⚠️ EVERY NUMERIC CONSTANT HERE IS FIRST-PASS + TUNABLE (design S20 owns the
// balance pass). Integer / integer-percent math throughout (design S0.4), so the
// model is drift-proof on every device.
// ============================================================================

import type { Rng } from "./rng";

// ---------------------------------------------------------------------------
// The minimal shape the durability helpers read/write. Kept STRUCTURAL (not tied
// to CombatWeapon) so a combatant's defensive "systems" can reuse the exact same
// model without a shared class. CombatWeapon satisfies this shape (it carries all
// three fields), and so will any future durable defensive system.
// ---------------------------------------------------------------------------
export interface DurableSystem {
	// Current durability points remaining (integer, >= 0). 0 => the system is
	// Offline (see systemCondition).
	durability: number;
	// Maximum durability (integer, >= 0). The denominator for the Degraded
	// threshold; a quality item's max comes from qualityDurabilityMax below.
	durabilityMax: number;
	// Quality rank 0..5 (design S9). Higher quality REDUCES the loss chance and
	// (via qualityDurabilityMax) RAISES the max durability.
	quality: number;
}

// The four-state condition a durable system reports (design S9 / S16 pip model):
//   nominal   -> healthy durability, no active disruption (green pip).
//   degraded  -> low durability, reduced effectiveness (yellow pip).
//   disrupted -> currently carries a debuff / disruption (orange pip).
//   offline   -> durability depleted or hard-disabled, e.g. Weapon Jam (red pip).
export type SystemCondition = "nominal" | "degraded" | "disrupted" | "offline";

// ---------------------------------------------------------------------------
// TUNING CONSTANTS (FIRST-PASS; the balance pass owns them, design S20). Grouped
// here so there is one obvious knob board. All integer / integer-percent.
// ---------------------------------------------------------------------------

// Base chance, as an integer percent, that a quality-0 system loses one
// durability point on a single damage event. Quality reduces this (below).
export const BASE_DURABILITY_LOSS_PERCENT = 40;

// Quality's reduction of the loss chance, per rank, as a RETAINED-fraction
// numerator over 100. Design S9 says "~-10%/rank": we model it MULTIPLICATIVELY
// (each rank keeps 90% of the previous rank's chance), mirroring the codebase's
// existing multiplicative idioms (the support-drone cleanse HALVES per rank).
// This can never drive the chance negative, unlike a flat -10-points-per-rank
// subtraction would. TODO(balance): if a flat percentage-point drop is preferred,
// swap this loop for a subtraction + clamp.
const QUALITY_LOSS_RETAINED_PER_RANK = 90; // keep 90% per quality rank (-10%/rank)

// Quality's bonus to MAX durability, per rank, as an integer percent added to the
// base. +20%/rank => +100% at quality 5 (design S9 "~+100% durability" at top
// quality). qualityDurabilityMax applies it as floor(base * (100 + q*20) / 100).
const QUALITY_DURABILITY_BONUS_PER_RANK = 20;

// The Degraded threshold: a system at or below this integer percent of its max
// durability (but still above 0) reports "degraded" (design S9 "low durability,
// reduced effectiveness"). Above it (and not disrupted) => "nominal".
export const DEGRADED_THRESHOLD_PERCENT = 50;

// ---------------------------------------------------------------------------
// CONDITION MECHANICAL EFFECTS (Phase 12b Unit B1). A worn system does not just
// report a pip; it MECHANICALLY degrades the ship. These are the ONE knob board
// for those magnitudes, read by resolveBattle so the wiring stays declarative
// (Omega 9: rule-based, readable without the sim). Integer / integer-percent
// throughout (design S0.4, drift-proof). ⚠️ EVERY VALUE IS FIRST-PASS + TUNABLE
// (design S20 owns the balance pass); the mapping INTENT is the durable contract.
//   - a DEGRADED weapon deals less damage (per-weapon condition),
//   - a worn REACTOR starves EVERY weapon of power (a global damage multiplier),
//   - a worn FTL/drive cuts the ship's EVASION and its CLOSING SPEED.
// A system is never mechanically penalised while nominal, so a full-durability
// ship is byte-identical to the pre-B1 sim on these levers (the wear rolls, not
// these deterministic scalings, are what shift the schedule).
// ---------------------------------------------------------------------------

// A DEGRADED weapon deals this integer percent of its normal damage (design S9
// "reduced effectiveness"), i.e. ~-25% first pass. An OFFLINE weapon does not fire
// at all (gated in resolveBattle's fire loop), so only the degraded case scales
// damage; nominal is an implicit 100 (no scaling) at the call site.
export const DEGRADED_WEAPON_DAMAGE_PERCENT = 75;

// The REACTOR's condition as a GLOBAL weapon-damage multiplier (integer percent),
// standing in for power starvation (design S10 seam): a worn reactor cannot supply
// full power, so every weapon hits softer. Applied ON TOP of each weapon's own
// condition. Nominal x1.0, Degraded ~x0.9, Offline ~x0.7. "disrupted" is unreachable
// for the reactor (no S4 disruption category targets it; systemCondition is called
// with isDisrupted=false), but it maps to the degraded value so the function is total.
export const REACTOR_DAMAGE_PERCENT_DEGRADED = 90;
export const REACTOR_DAMAGE_PERCENT_OFFLINE = 70;
export function reactorDamagePercent(condition: SystemCondition): number {
	switch (condition) {
		case "nominal":
			return 100;
		case "degraded":
		case "disrupted":
			return REACTOR_DAMAGE_PERCENT_DEGRADED;
		case "offline":
			return REACTOR_DAMAGE_PERCENT_OFFLINE;
	}
}

// The FTL/drive's condition as an EVASION penalty: an integer percent REDUCTION of
// the ship's evasion, because a damaged drive cannot juke, so the ship is easier to
// hit. Worse as it degrades (Degraded < Offline, design S9). Nominal none, Degraded
// -20%, Offline -40%. (Bridged ships default evasion 0 until the maneuver stat lands,
// so this lever is wired but inert for real ships today; it drives the mechanic +
// its unit tests now, and the closing-speed penalty below already bites live.)
export const FTL_EVASION_PENALTY_DEGRADED = 20;
export const FTL_EVASION_PENALTY_OFFLINE = 40;
export function ftlEvasionPenaltyPercent(condition: SystemCondition): number {
	switch (condition) {
		case "nominal":
			return 0;
		case "degraded":
		case "disrupted":
			return FTL_EVASION_PENALTY_DEGRADED;
		case "offline":
			return FTL_EVASION_PENALTY_OFFLINE;
	}
}

// The FTL/drive's condition as a CLOSING-SPEED penalty: an integer percent REDUCTION
// of the ship's movement speed, because a damaged drive limps. Worse as it degrades
// (Degraded < Offline, design S9). Nominal none, Degraded -25%, Offline -50%.
export const FTL_SPEED_PENALTY_DEGRADED = 25;
export const FTL_SPEED_PENALTY_OFFLINE = 50;
export function ftlSpeedPenaltyPercent(condition: SystemCondition): number {
	switch (condition) {
		case "nominal":
			return 0;
		case "degraded":
		case "disrupted":
			return FTL_SPEED_PENALTY_DEGRADED;
		case "offline":
			return FTL_SPEED_PENALTY_OFFLINE;
	}
}

// Quality is a 0..5 rank (design S9). Clamp defensively so a stray value never
// produces a nonsense chance/max (Omega 8: no ghost assumptions about inputs).
const QUALITY_MIN = 0;
const QUALITY_MAX = 5;

function clampQuality(quality: number): number {
	return Math.max(QUALITY_MIN, Math.min(QUALITY_MAX, Math.floor(quality)));
}

// ---------------------------------------------------------------------------
// PURE HELPERS
// ---------------------------------------------------------------------------

// The per-event durability-loss chance for a system of the given quality, as an
// integer percent (design S9). Multiplicative -10%/rank from the base:
//   quality 0 -> BASE (40)
//   quality 1 -> floor(40 * 90/100) = 36
//   quality 5 -> floor(...) = 23
// Monotonically non-increasing in quality, and never negative.
export function durabilityLossChance(quality: number): number {
	const q = clampQuality(quality);
	let chance = BASE_DURABILITY_LOSS_PERCENT;
	// Apply the retained-fraction once per quality rank (integer floor each step,
	// same banked-integer discipline the cleanse chance uses).
	for (let rank = 0; rank < q; rank++) {
		chance = Math.floor((chance * QUALITY_LOSS_RETAINED_PER_RANK) / 100);
	}
	return chance;
}

// The max durability a system of `baseDurability` carries at the given quality
// (design S9: higher quality ~+100% durability). +20%/rank => quality 5 doubles
// the base. Integer floor so the result is drift-proof.
//   qualityDurabilityMax(100, 0) === 100
//   qualityDurabilityMax(100, 5) === 200  (+100%)
export function qualityDurabilityMax(
	baseDurability: number,
	quality: number,
): number {
	const q = clampQuality(quality);
	return Math.floor(
		(baseDurability * (100 + q * QUALITY_DURABILITY_BONUS_PER_RANK)) / 100,
	);
}

// Roll ONE durability-loss event against the combat stream and, on success, drop
// the system's durability by one point (never below 0). Returns true iff a point
// was lost. The single combat-stream draw is deterministic + seeded, so a battle
// that ever wires this in stays offline == live (the draw is independent of log
// generation, exactly like every other combat roll).
//
// PURE relative to global state: it mutates only the passed system (matching the
// sim's mutate-the-clone pattern) and draws only from the injected rng.
export function rollDurabilityLoss(system: DurableSystem, rng: Rng): boolean {
	// A system already at 0 cannot lose more; no draw is spent on a dead system so
	// the schedule matches the intuition "only living systems roll".
	if (system.durability <= 0) return false;
	const chance = durabilityLossChance(system.quality);
	if (!rng.chance(chance, 100)) return false;
	system.durability = Math.max(0, system.durability - 1);
	return true;
}

// The four-state condition of a durable system (design S9 / S16 pip model).
// PRECEDENCE (most severe first), documented because two conditions can be true
// at once and a single pip must pick one:
//   1. OFFLINE   -> durability depleted (<= 0). The system cannot function, which
//      dominates everything else. (Hard-disable sources like a Weapon Jam map to
//      offline via the isHardDisabled flag, so the caller can force it without
//      draining durability.)
//   2. DISRUPTED -> an active debuff is riding the system. More urgent/actionable
//      than mere wear, so it outranks Degraded.
//   3. DEGRADED  -> durability at/below the Degraded threshold (but > 0).
//   4. NOMINAL   -> healthy and undisrupted.
//
// `isDisrupted` is passed by the caller (design seam): the combat model attaches
// disruptions to the COMBATANT, not to individual weapons, so the caller decides
// whether THIS system counts as disrupted (e.g. the owner carries a Weapons-
// system disruption). `isHardDisabled` lets a hard-off source (Weapon Jam) force
// Offline without touching durability. Both default false.
export function systemCondition(
	system: DurableSystem,
	isDisrupted: boolean = false,
	isHardDisabled: boolean = false,
): SystemCondition {
	// 1. Offline: depleted durability OR a hard-disable source.
	if (system.durability <= 0 || isHardDisabled) return "offline";
	// 2. Disrupted: an active debuff outranks mere wear.
	if (isDisrupted) return "disrupted";
	// 3. Degraded: at/below the threshold fraction of max. Cross-multiply to avoid
	//    a divide (and guard a 0/negative max, which we treat as not-degraded since
	//    a 0-durability case was already caught as offline above).
	if (
		system.durabilityMax > 0 &&
		system.durability * 100 <= DEGRADED_THRESHOLD_PERCENT * system.durabilityMax
	) {
		return "degraded";
	}
	// 4. Nominal: healthy and undisrupted.
	return "nominal";
}
