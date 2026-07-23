// ============================================================================
// combat/statusEffects.test.ts -- unit suite for the unified status-effect system
// (Combat 0.13.0, Phase 4)
//
// These guard the MECHANICS in isolation (design S4), with rng driven by a real
// seeded stream where a roll is involved and by exact arithmetic where it is not:
//   - applyEffect: rank-1 on first apply; escalate 1 -> 2 -> 3 and CAP; refresh
//     extends duration; escalation is a combat-stream roll.
//   - tickEffects: DoT deals damage per tick, aggregates to the right per-round
//     total, decrements duration, and expires.
//   - cleanseChance halves per rank.
//   - activeStatDelta: a debuff's per-rank magnitude scales + stacks.
//   - the registry encodes the full S4 table.
// ============================================================================

import { describe, it, expect } from "vitest";
import { makeRng } from "./rng";
import {
	DISRUPTIONS,
	BUFFS,
	STATUS_EFFECT_DEFS,
	MAX_RANK,
	applyEffect,
	tickEffects,
	cleanseChance,
	activeStatDelta,
	applyPercentDelta,
	type StatusEffect,
} from "./statusEffects";

// A minimal combatant stand-in for tickEffects (it only touches these fields).
function dotSubject(
	effects: StatusEffect[],
	overrides: { hull?: number; alive?: boolean } = {},
) {
	return {
		hull: overrides.hull ?? 1000,
		alive: overrides.alive ?? true,
		statusEffects: effects,
	};
}

// A fresh instance builder for tick tests (bank starts at 0 like a real apply).
function instance(defId: string, rank: number, remainingDeciSec: number): StatusEffect {
	return { defId, rank, remainingDeciSec, dotBank: 0 };
}

describe("registry: encodes the S4 System Disruptions table", () => {
	it("has all twelve S4 entries with the right system + mechanic", () => {
		// Sensors
		expect(DISRUPTIONS.scatteringField.system).toBe("sensors");
		expect(DISRUPTIONS.sensorPowerDrain.system).toBe("sensors");
		// Engines
		expect(DISRUPTIONS.manifoldOverheat.system).toBe("engines");
		expect(DISRUPTIONS.coolantLeak.system).toBe("engines");
		// Shields
		expect(DISRUPTIONS.emitterOverload.system).toBe("shields");
		expect(DISRUPTIONS.harmonicGap.system).toBe("shields");
		expect(DISRUPTIONS.capacitorFailure.system).toBe("shields");
		// Weapons
		expect(DISRUPTIONS.coilDampening.system).toBe("weapons");
		expect(DISRUPTIONS.weaponJam.system).toBe("weapons");
		expect(DISRUPTIONS.targetingDrift.system).toBe("weapons");
		// Drones
		expect(DISRUPTIONS.inhibit.system).toBe("drones");
		// DoT
		expect(DISRUPTIONS.plasmaFire.kind).toBe("dot");
		expect(DISRUPTIONS.plasmaFire.mechanic.type).toBe("dot");

		// Exactly twelve disruptions in the table.
		expect(Object.keys(DISRUPTIONS).length).toBe(12);
	});

	it("every def id matches its registry key and carries flavor + color data", () => {
		for (const [key, def] of Object.entries(STATUS_EFFECT_DEFS)) {
			expect(def.id).toBe(key);
			expect(def.displayName.length).toBeGreaterThan(0);
			expect(def.flavor.length).toBeGreaterThan(0);
			expect(def.color.length).toBeGreaterThan(0);
			expect(def.durationDeciSec).toBeGreaterThan(0);
		}
	});

	it("reserved buff path exists and improves its stat (positive delta)", () => {
		const buff = BUFFS.overchargedCapacitors;
		expect(buff.kind).toBe("buff");
		expect(buff.mechanic.type).toBe("statDelta");
		if (buff.mechanic.type === "statDelta") {
			expect(buff.mechanic.deltaPercentPerRank).toBeGreaterThan(0);
		}
	});
});

describe("applyEffect: rank escalation, refresh, and cap", () => {
	it("applies a fresh effect at rank 1 with full duration", () => {
		const rng = makeRng(1);
		const out = applyEffect([], "scatteringField", 100, rng);
		expect(out.length).toBe(1);
		expect(out[0].defId).toBe("scatteringField");
		expect(out[0].rank).toBe(1);
		expect(out[0].remainingDeciSec).toBe(
			DISRUPTIONS.scatteringField.durationDeciSec,
		);
	});

	it("re-applying with a guaranteed escalation climbs 1 -> 2 -> 3 then CAPS", () => {
		// escalationChance 100 => effectiveChance = min(100, 100 * rank) = always a
		// certain escalation, so three applies land rank 1, 2, 3 and the fourth is
		// capped at MAX_RANK (no further climb).
		const rng = makeRng(7);
		let effects = applyEffect([], "targetingDrift", 100, rng); // rank 1
		expect(effects[0].rank).toBe(1);
		effects = applyEffect(effects, "targetingDrift", 100, rng); // -> 2
		expect(effects[0].rank).toBe(2);
		effects = applyEffect(effects, "targetingDrift", 100, rng); // -> 3
		expect(effects[0].rank).toBe(3);
		expect(effects[0].rank).toBe(MAX_RANK);
		effects = applyEffect(effects, "targetingDrift", 100, rng); // capped
		expect(effects[0].rank).toBe(MAX_RANK);
	});

	it("a zero escalation chance never climbs but still refreshes duration", () => {
		const rng = makeRng(3);
		let effects = applyEffect([], "coolantLeak", 0, rng);
		// Age the effect down, then reapply: rank stays 1, duration returns to full.
		effects[0].remainingDeciSec = 5;
		effects = applyEffect(effects, "coolantLeak", 0, rng);
		expect(effects[0].rank).toBe(1);
		expect(effects[0].remainingDeciSec).toBe(
			DISRUPTIONS.coolantLeak.durationDeciSec,
		);
	});

	it("returns a NEW array and does not mutate the input (purity)", () => {
		const rng = makeRng(9);
		const input: StatusEffect[] = [];
		const out = applyEffect(input, "plasmaFire", 50, rng);
		expect(out).not.toBe(input);
		expect(input.length).toBe(0);
	});

	it("different effect ids coexist rather than merging", () => {
		const rng = makeRng(2);
		let effects = applyEffect([], "scatteringField", 100, rng);
		effects = applyEffect(effects, "coolantLeak", 100, rng);
		expect(effects.map((e) => e.defId).sort()).toEqual([
			"coolantLeak",
			"scatteringField",
		]);
	});
});

describe("tickEffects: DoT damage per tick, aggregation, and expiry", () => {
	it("Plasma Fire rank 1 deals its per-round total across the round's ten ticks", () => {
		// damagePerRankPerRound 10 at rank 1 => 10 hull over 10 ticks (1/tick). We
		// tick ten times and sum the reported DoT damage + confirm the hull loss.
		const rng = makeRng(1);
		const subject = dotSubject([instance("plasmaFire", 1, 100)]);
		let total = 0;
		for (let i = 0; i < 10; i++) {
			const r = tickEffects(subject, 1, rng);
			total += r.dotDamageByDef.get("plasmaFire") ?? 0;
		}
		expect(total).toBe(10); // exactly the per-round total
		expect(subject.hull).toBe(1000 - 10);
	});

	it("rank scales the DoT: rank 2 deals double the per-round damage", () => {
		const rng = makeRng(1);
		const subject = dotSubject([instance("plasmaFire", 2, 100)]);
		let total = 0;
		for (let i = 0; i < 10; i++) {
			total += tickEffects(subject, 1, rng).dotDamageByDef.get("plasmaFire") ?? 0;
		}
		expect(total).toBe(20); // 10/round/rank * rank 2
		expect(subject.hull).toBe(1000 - 20);
	});

	it("a DoT expires after its duration and stops dealing damage", () => {
		const rng = makeRng(1);
		// Duration 3 deci-seconds: it deals damage on ticks 1..3 then is gone.
		const subject = dotSubject([instance("plasmaFire", 1, 3)]);
		for (let i = 0; i < 3; i++) tickEffects(subject, 1, rng);
		expect(subject.statusEffects.length).toBe(0); // expired + removed
		const hullAfterExpiry = subject.hull;
		// Further ticks do nothing (no effects left).
		tickEffects(subject, 1, rng);
		expect(subject.hull).toBe(hullAfterExpiry);
	});

	it("a lethal DoT tick flips alive to false and reports killed", () => {
		const rng = makeRng(1);
		// hull 1, plasmaFire rank 1 deals 1/tick => dies on the first releasing tick.
		const subject = dotSubject([instance("plasmaFire", 1, 100)], { hull: 1 });
		let killed = false;
		for (let i = 0; i < 10 && !killed; i++) {
			killed = tickEffects(subject, 1, rng).killed;
		}
		expect(killed).toBe(true);
		expect(subject.alive).toBe(false);
		expect(subject.hull).toBeLessThanOrEqual(0);
	});

	it("a debuff-only combatant takes no DoT damage but its duration ticks down", () => {
		const rng = makeRng(1);
		const subject = dotSubject([instance("scatteringField", 1, 5)]);
		const r = tickEffects(subject, 1, rng);
		expect(r.dotDamageByDef.size).toBe(0); // no DoT
		expect(subject.hull).toBe(1000); // untouched
		expect(subject.statusEffects[0].remainingDeciSec).toBe(4); // decremented
	});

	it("a dead combatant's effects are left untouched (no damage, no decrement)", () => {
		const rng = makeRng(1);
		const subject = dotSubject([instance("plasmaFire", 1, 5)], {
			hull: -3,
			alive: false,
		});
		const r = tickEffects(subject, 1, rng);
		expect(r.dotDamageByDef.size).toBe(0);
		expect(subject.hull).toBe(-3);
		expect(subject.statusEffects[0].remainingDeciSec).toBe(5); // not decremented
	});
});

describe("cleanseChance: halves per rank (design S4 / S8)", () => {
	it("rank 1 base, rank 2 base/2, rank 3 base/4", () => {
		const base = cleanseChance(1);
		expect(base).toBeGreaterThan(0);
		expect(cleanseChance(2)).toBe(Math.floor(base / 2));
		expect(cleanseChance(3)).toBe(Math.floor(Math.floor(base / 2) / 2));
	});
});

describe("activeStatDelta + applyPercentDelta: magnitude scales + stacks", () => {
	it("a rank-1 debuff is ~20% and a rank-2 debuff doubles it", () => {
		const r1 = activeStatDelta([instance("targetingDrift", 1, 50)], "accuracy");
		const r2 = activeStatDelta([instance("targetingDrift", 2, 50)], "accuracy");
		expect(r1).toBe(-20); // rank 1 magnitude ~20% (design S4)
		expect(r2).toBe(-40); // scales with rank
	});

	it("two different accuracy debuffs stack additively", () => {
		const stacked = activeStatDelta(
			[instance("targetingDrift", 1, 50), instance("scatteringField", 1, 50)],
			"accuracy",
		);
		expect(stacked).toBe(-40);
	});

	it("applyPercentDelta scales a base stat, floors, and clamps at zero", () => {
		expect(applyPercentDelta(80, -20)).toBe(64); // accuracy 80 with a -20% debuff
		expect(applyPercentDelta(50, -40)).toBe(30); // recharge 50 with -40%
		expect(applyPercentDelta(80, 20)).toBe(96); // a buff raises it
		expect(applyPercentDelta(10, -200)).toBe(0); // clamped, never negative
	});

	it("only the queried stat is summed (unrelated debuffs are ignored)", () => {
		const effects = [
			instance("targetingDrift", 1, 50), // accuracy
			instance("capacitorFailure", 1, 50), // shieldRecharge
		];
		expect(activeStatDelta(effects, "accuracy")).toBe(-20);
		expect(activeStatDelta(effects, "shieldRecharge")).toBe(-20);
		expect(activeStatDelta(effects, "speed")).toBe(0);
	});
});
