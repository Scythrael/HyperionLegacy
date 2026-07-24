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

// ---------------------------------------------------------------------------
// PHASE 12: when an event carries a selected flavor line, the renderer PREFERS
// it (binding names/numbers) over the built-in per-type template. Events with no
// flavor still fall back to the templates (covered by the FIXED_LOG suite above,
// whose events carry no `flavor`).
// ---------------------------------------------------------------------------
describe("formatCombatLog flavor rendering", () => {
	// A hit whose flavor template holds unbound {placeholders}: the renderer must
	// bind {actor}/{target}/{damage} from nameFor + the event fields.
	const FLAVORED_LOG: CombatEvent[] = [
		{
			tDeciSec: 5,
			round: 0,
			type: "hit",
			actorId: "player",
			targetId: "enemy",
			damage: 140,
			result: "hit",
			shieldAfter: 0,
			hullAfter: 60,
			family: "kinetic",
			weaponType: "railgun",
			projectilesHit: 1,
			flavor: "{actor}'s railgun punches clean through, {damage} into the hull.",
		},
	];

	it("renders the interpolated flavor line, not the built-in hit template", () => {
		const lines = formatCombatLog(FLAVORED_LOG, nameFor);
		expect(lines).toContain(
			"Ravenscar's railgun punches clean through, 140 into the hull.",
		);
		// The generic "hits ... for ..." template must NOT appear for this event.
		expect(lines.some((l) => l.includes("kinetic fire hits"))).toBe(false);
	});

	it("still binds names for a flavored event with no actor (target-only line)", () => {
		const log: CombatEvent[] = [
			{
				tDeciSec: 14,
				round: 1,
				type: "destroyed",
				targetId: "enemy",
				result: "destroyed",
				hullAfter: -3,
				flavor: "{target}'s hull gives way and it breaks apart.",
			},
		];
		const lines = formatCombatLog(log, nameFor);
		expect(lines).toContain("the raider's hull gives way and it breaks apart.");
	});
});
