// ============================================================================
// combat/logFormat.test.ts -- the dev combat-log renderer (Combat 0.13.0)
//
// Guards the round grouping (a "=== Round N ===" divider per round), the hit-line
// content (attacker / target / damage all present), determinism (a fixed log
// renders identical lines every call), and the outcome summary line.
// ============================================================================

import { describe, it, expect } from "vitest";
import { formatCombatLog } from "./logFormat";
import type { BattleOutcome, CombatEvent } from "./types";

// A tiny fixed log spanning two rounds with a hit, an evade, and a destruction.
const FIXED_LOG: CombatEvent[] = [
	{
		tDeciSec: 5,
		round: 0,
		type: "hit",
		actorId: "player",
		targetId: "enemy",
		damage: 42,
		result: "hit",
		shieldAfter: 18,
		hullAfter: 100,
		family: "kinetic",
		crit: false,
		attenuated: false,
		projectilesHit: 1,
	},
	{
		tDeciSec: 8,
		round: 0,
		type: "evade",
		actorId: "enemy",
		targetId: "player",
		result: "evade",
		family: "ew",
		projectilesHit: 0,
	},
	{
		tDeciSec: 14,
		round: 1,
		type: "destroyed",
		actorId: "player",
		targetId: "enemy",
		result: "destroyed",
		shieldAfter: 0,
		hullAfter: -3,
	},
];

// Name lookup: ids -> friendly names.
const nameFor = (id: string): string =>
	id === "player" ? "Ravenscar" : id === "enemy" ? "the raider" : id;

const OUTCOME: BattleOutcome = {
	winner: "player",
	reason: "eliminated",
	rounds: 2,
};

describe("formatCombatLog", () => {
	it("emits a round divider for each round present", () => {
		const lines = formatCombatLog(FIXED_LOG, nameFor);
		expect(lines).toContain("=== Round 1 ===");
		expect(lines).toContain("=== Round 2 ===");
	});

	it("hit line includes attacker, target, and damage", () => {
		const lines = formatCombatLog(FIXED_LOG, nameFor);
		const hitLine = lines.find((l) => l.includes("hits"));
		expect(hitLine).toBeDefined();
		expect(hitLine).toContain("Ravenscar");
		expect(hitLine).toContain("the raider");
		expect(hitLine).toContain("42");
	});

	it("is deterministic for a fixed log", () => {
		const a = formatCombatLog(FIXED_LOG, nameFor, OUTCOME);
		const b = formatCombatLog(FIXED_LOG, nameFor, OUTCOME);
		expect(a).toEqual(b);
	});

	it("appends the outcome as a final line when provided", () => {
		const lines = formatCombatLog(FIXED_LOG, nameFor, OUTCOME);
		expect(lines[lines.length - 1]).toBe(
			"Outcome: player wins in 2 rounds (eliminated).",
		);
	});

	it("narrates a destruction line", () => {
		const lines = formatCombatLog(FIXED_LOG, nameFor);
		expect(lines).toContain("the raider is destroyed!");
	});

	it("omits the outcome line when no outcome is passed", () => {
		const lines = formatCombatLog(FIXED_LOG, nameFor);
		expect(lines.some((l) => l.startsWith("Outcome:"))).toBe(false);
	});
});
