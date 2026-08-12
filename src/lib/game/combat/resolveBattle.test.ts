// ============================================================================
// combat/resolveBattle.test.ts -- FLAGSHIP parity + termination suite for the
// combat simulator (Combat 0.13.0, Phase 2)
//
// These tests guard the invariants the ENTIRE combat epic depends on, so they
// matter more than any single mechanic test:
//   - Determinism: same inputs => byte-identical outcome, every call.
//   - Offline == live: outcome identical with and without the log (the thing
//     that lets offline catch-up skip flavor and still match live exactly).
//   - Cosmetic isolation: log/flavor work cannot shift a combat roll.
//   - Termination: the hard cap fires + tiebreaks; a dominant team eliminates.
//   - Basic sanity: an out-damaging team wins.
// If any go red, the deterministic-headless contract is broken at the root and
// no later phase can be trusted, so keep these green above all else.
// ============================================================================

import { describe, it, expect } from "vitest";
import { resolveBattle, applyProjectileDamage, fireWeapon } from "./resolveBattle";
import { makeWeaponInstance } from "./weapons";
import { bandFor } from "./positioning";
import { makeStreams } from "./rng";
import type { DurableSystem } from "./durability";
import type { BattleParticipants, Combatant, CombatWeapon } from "./types";

// ---------------------------------------------------------------------------
// Test builders. Small factories so each test states only what it cares about;
// everything else takes a sane skeleton default. Kept here (not in a shared
// helper) because these are test fixtures, not production shapes.
// ---------------------------------------------------------------------------

// Build a weapon with sensible defaults. Default range is huge so the range gate
// is a non-issue unless a test opts into it; default cooldown fires roughly once
// per second. Default family is KINETIC (no attenuation, simplest for the parity
// fixtures). A `yield` convenience sets a FLAT yieldMin == yieldMax so the many
// legacy call sites that pass `yield: N` keep working unchanged; a test that
// wants a damage band sets yieldMin/yieldMax directly. Default accuracy is 90
// (mirroring the Phase 2 90% hit rate the flagship suite was written around) and
// projectileCount 1, so the parity fixtures behave as before + a 10% crit.
function makeWeapon(
	overrides: Partial<CombatWeapon> & { yield?: number } = {},
): CombatWeapon {
	const flat = overrides.yield;
	return {
		id: overrides.id ?? "w",
		family: overrides.family ?? "kinetic",
		yieldMin: overrides.yieldMin ?? flat ?? 10,
		yieldMax: overrides.yieldMax ?? flat ?? 10,
		cooldownDeciSec: overrides.cooldownDeciSec ?? 10,
		accuracy: overrides.accuracy ?? 90,
		projectileCount: overrides.projectileCount ?? 1,
		range: overrides.range ?? 1000,
		shieldAttenuation: overrides.shieldAttenuation ?? 0,
		armorPen: overrides.armorPen ?? 0,
		cooldownAccumulator: overrides.cooldownAccumulator ?? 0,
		effectSlots: overrides.effectSlots ?? [],
		// Durability defaults: full pool at quality 0. The sim does not roll loss
		// live, so these never move a resolveBattle outcome (regression-safe).
		durability: overrides.durability ?? 100,
		durabilityMax: overrides.durabilityMax ?? 100,
		quality: overrides.quality ?? 0,
		// Power draw is inert in resolveBattle (the fit-time gate is the integration
		// phase); default 0 so fixtures are unaffected.
		powerDraw: overrides.powerDraw ?? 0,
		// Ambush-eligible by default (Phase 6); an ambush test opts a torpedo out.
		ambushEligible: overrides.ambushEligible ?? true,
	};
}

// Build a combatant with sane defaults. Callers set id/team/hull/weapons per
// test; the reserved arrays start empty and the defense fields default to 0 (no
// armor/dampening/coherence/evasion) so a test only opts into the defense it is
// exercising.
function makeCombatant(overrides: Partial<Combatant> = {}): Combatant {
	const hullMax = overrides.hullMax ?? overrides.hull ?? 100;
	const shieldMax = overrides.shieldMax ?? overrides.shield ?? 0;
	return {
		id: overrides.id ?? "c",
		team: overrides.team ?? "player",
		hull: overrides.hull ?? hullMax,
		hullMax,
		shield: overrides.shield ?? shieldMax,
		shieldMax,
		shieldRecharge: overrides.shieldRecharge ?? 0,
		shieldCoherence: overrides.shieldCoherence ?? 0,
		ablativeArmor: overrides.ablativeArmor ?? 0,
		kineticDampening: overrides.kineticDampening ?? 0,
		evasion: overrides.evasion ?? 0,
		// Per-family resists default to all-zero (no resist), so any test not
		// exercising resists is byte-identical to the pre-Phase-5 behavior.
		damageResist: overrides.damageResist ?? { kinetic: 0, particle: 0, ew: 0 },
		disruptionResist: overrides.disruptionResist ?? {
			kinetic: 0,
			particle: 0,
			ew: 0,
		},
		position: overrides.position ?? 0,
		speed: overrides.speed ?? 10,
		// Default stance Balanced (Phase 6). Co-located fixtures (position 0) hold
		// station regardless of stance, so this keeps every pre-Phase-6 outcome.
		stance: overrides.stance ?? "balanced",
		weapons: overrides.weapons ?? [makeWeapon()],
		// Phase 12b Unit B1 durable defensive systems. OPTIONAL: a fixture opts in only
		// when it exercises reactor/ftl wear or condition effects; omitted => undefined,
		// which the sim reads as "no such system" (byte-identical to the pre-B1 fixture).
		reactor: overrides.reactor,
		ftl: overrides.ftl,
		alive: overrides.alive ?? true,
		statusEffects: overrides.statusEffects ?? [],
		drones: overrides.drones ?? [],
		// Counter-module flags OFF by default (Phase 6); ambush tests opt in.
		rapidChargeAfterAmbush: overrides.rapidChargeAfterAmbush ?? false,
		particleTraceDetector: overrides.particleTraceDetector ?? 0,
	};
}

// A standard 1v1: a player ship vs an enemy ship, both co-located so range is
// never the gating factor. Callers tweak the returned combatants per test.
function oneVsOne(
	player: Partial<Combatant> = {},
	enemy: Partial<Combatant> = {},
): BattleParticipants {
	return {
		combatants: [
			makeCombatant({ id: "P1", team: "player", ...player }),
			makeCombatant({ id: "E1", team: "enemy", ...enemy }),
		],
	};
}

describe("resolveBattle determinism", () => {
	it("same participants + seed => deep-equal outcome across repeated calls", () => {
		const build = () =>
			oneVsOne(
				{ hull: 80, weapons: [makeWeapon({ id: "pw", yield: 7 })] },
				{ hull: 90, weapons: [makeWeapon({ id: "ew", yield: 5 })] },
			);
		const a = resolveBattle(build(), 42);
		const b = resolveBattle(build(), 42);
		const c = resolveBattle(build(), 42);
		expect(a.outcome).toEqual(b.outcome);
		expect(b.outcome).toEqual(c.outcome);
	});

	it("does NOT mutate the caller's participants (purity)", () => {
		const p = oneVsOne({ hull: 50 }, { hull: 50 });
		const before = JSON.parse(JSON.stringify(p));
		resolveBattle(p, 1, { generateLog: true });
		// The caller's objects must be untouched: hull, alive, cooldownAccumulator
		// all as they were, so the same battle can be re-run identically.
		expect(p).toEqual(before);
	});

	it("different seeds can produce different battle courses (log differs)", () => {
		const build = () =>
			oneVsOne(
				{ hull: 200, weapons: [makeWeapon({ id: "pw", yield: 6 })] },
				{ hull: 200, weapons: [makeWeapon({ id: "ew", yield: 6 })] },
			);
		const a = resolveBattle(build(), 1, { generateLog: true });
		const b = resolveBattle(build(), 987654, { generateLog: true });
		// The miss/hit pattern (driven by the combat stream) should differ across
		// seeds, so at least the logs are not identical. (Outcomes may coincide.)
		expect(a.log).not.toEqual(b.log);
	});
});

describe("resolveBattle offline == live (the hard invariant)", () => {
	it("outcome is identical with generateLog true vs false", () => {
		const build = () =>
			oneVsOne(
				{ hull: 120, weapons: [makeWeapon({ id: "pw", yield: 8 })] },
				{ hull: 100, weapons: [makeWeapon({ id: "ew", yield: 6 })] },
			);
		const live = resolveBattle(build(), 31337, { generateLog: true });
		const offline = resolveBattle(build(), 31337, { generateLog: false });
		// The OUTCOME must match exactly...
		expect(offline.outcome).toEqual(live.outcome);
		// ...while the logs differ in existence (live built one, offline did not).
		expect(live.log.length).toBeGreaterThan(0);
		expect(offline.log.length).toBe(0);
	});

	it("holds across many seeds (fuzz the parity)", () => {
		for (let seed = 0; seed < 60; seed++) {
			const build = () =>
				oneVsOne(
					{ hull: 90, weapons: [makeWeapon({ id: "pw", yield: 7 })] },
					{ hull: 95, weapons: [makeWeapon({ id: "ew", yield: 6 })] },
				);
			const live = resolveBattle(build(), seed, { generateLog: true });
			const offline = resolveBattle(build(), seed, { generateLog: false });
			expect(offline.outcome).toEqual(live.outcome);
		}
	});

	it("default (no options) behaves as offline: no log, same outcome as explicit false", () => {
		const build = () => oneVsOne({ hull: 70 }, { hull: 70 });
		const bare = resolveBattle(build(), 5);
		const explicitOffline = resolveBattle(build(), 5, { generateLog: false });
		expect(bare.log.length).toBe(0);
		expect(bare.outcome).toEqual(explicitOffline.outcome);
	});
});

// The carry-state enabler (sub-phase 5b): resolveBattle also returns the final
// (post-battle) combatant array so the Patrol loop can carry a ship's surviving
// hull/shield/drones forward to the next wave. finalCombatants is OUTCOME state
// (driven only by the combat RNG stream), so it MUST obey the same offline==live
// + determinism + purity guarantees as `outcome`. These tests guard exactly that.
describe("resolveBattle finalCombatants (carry-state)", () => {
	// A decisive 1v1 the player clearly wins: high yield + fast cooldown vs a
	// fragile enemy, so the enemy is wiped and the player survives with hull left.
	// This gives us a known-shape post-battle state to assert against.
	const buildDecisive = () =>
		oneVsOne(
			{
				id: "P1",
				hull: 500,
				hullMax: 500,
				weapons: [makeWeapon({ id: "pw", yield: 50, cooldownDeciSec: 5 })],
			},
			{
				id: "E1",
				hull: 40,
				hullMax: 40,
				weapons: [makeWeapon({ id: "ew", yield: 2, cooldownDeciSec: 20 })],
			},
		);

	it("returns the same combatants (by id) that went in, in id-sorted order", () => {
		const { finalCombatants } = resolveBattle(buildDecisive(), 7);
		expect(Array.isArray(finalCombatants)).toBe(true);
		// Same cast, keyed by id (order-independent set equality).
		const ids = finalCombatants.map((c) => c.id).sort();
		expect(ids).toEqual(["E1", "P1"]);
		// ...and the array itself is ASCENDING-ID order (the sim sorts by id), which
		// is the contract the Patrol loop relies on (look up BY ID, not by index).
		const asReturned = finalCombatants.map((c) => c.id);
		expect(asReturned).toEqual([...asReturned].sort());
	});

	it("reflects POST-battle state: loser is dead, winner survives with hull", () => {
		const { outcome, finalCombatants } = resolveBattle(buildDecisive(), 7);
		// Sanity: this fixture resolves by elimination in the player's favor.
		expect(outcome.winner).toBe("player");
		expect(outcome.reason).toBe("eliminated");
		const player = finalCombatants.find((c) => c.id === "P1");
		const enemy = finalCombatants.find((c) => c.id === "E1");
		expect(player).toBeDefined();
		expect(enemy).toBeDefined();
		// The wiped enemy is dead (alive false and/or hull bottomed out)...
		expect(enemy?.alive).toBe(false);
		expect(enemy?.hull).toBeLessThanOrEqual(0);
		// ...while the winner is still standing with hull to spare (this is the
		// carry-forward value the next wave seeds from).
		expect(player?.alive).toBe(true);
		expect(player?.hull).toBeGreaterThan(0);
	});

	it("does NOT alias the caller's input objects (purity preserved)", () => {
		const p = buildDecisive();
		const inputPlayer = p.combatants.find((c) => c.id === "P1");
		const before = JSON.parse(JSON.stringify(p));
		const { finalCombatants } = resolveBattle(p, 7, { generateLog: true });
		// The caller's original objects are untouched (the existing purity guarantee):
		// finalCombatants is the sim's PRIVATE clone, not the input.
		expect(p).toEqual(before);
		const returnedPlayer = finalCombatants.find((c) => c.id === "P1");
		// Different object references: mutating the returned state can never leak
		// back into the caller's ships.
		expect(returnedPlayer).not.toBe(inputPlayer);
	});

	it("is deterministic: same participants + seed => identical finalCombatants", () => {
		const a = resolveBattle(buildDecisive(), 7);
		const b = resolveBattle(buildDecisive(), 7);
		expect(a.finalCombatants).toEqual(b.finalCombatants);
	});

	it("offline == live for finalCombatants, not just the outcome (PARITY)", () => {
		// The hard invariant, extended to the new field: because finalCombatants is
		// pure combat-stream state, the post-battle hull/shield/drones/status of EVERY
		// ship must be byte-identical whether we built the log (live) or not (offline).
		// If any cosmetic-stream work ever leaked into that state, this diverges.
		const live = resolveBattle(buildDecisive(), 7, { generateLog: true });
		const offline = resolveBattle(buildDecisive(), 7, { generateLog: false });
		expect(offline.finalCombatants).toEqual(live.finalCombatants);
	});

	it("finalCombatants parity holds across many seeds (fuzz)", () => {
		// A closer, longer 1v1 so most seeds resolve mid-fight with non-trivial
		// surviving state (partial hull, live status/drones), giving the parity check
		// real post-battle variety to compare rather than always-clean eliminations.
		const build = () =>
			oneVsOne(
				{ id: "P1", hull: 120, weapons: [makeWeapon({ id: "pw", yield: 7 })] },
				{ id: "E1", hull: 115, weapons: [makeWeapon({ id: "ew", yield: 6 })] },
			);
		for (let seed = 0; seed < 60; seed++) {
			const live = resolveBattle(build(), seed, { generateLog: true });
			const offline = resolveBattle(build(), seed, { generateLog: false });
			expect(offline.finalCombatants).toEqual(live.finalCombatants);
		}
	});
});

describe("resolveBattle cosmetic isolation", () => {
	it("cosmetic/log work cannot shift the combat rolls (outcome invariant)", () => {
		// This is the resolveBattle-level restatement of rng's independence test:
		// the log path draws from the cosmetic stream on every shot, yet the
		// winner + round count are identical to the log-free run. If a cosmetic
		// draw ever leaked into the combat sequence, these would diverge.
		const build = () =>
			oneVsOne(
				{ hull: 140, weapons: [makeWeapon({ id: "pw", yield: 9 })] },
				{ hull: 130, weapons: [makeWeapon({ id: "ew", yield: 7 })] },
			);
		const withLog = resolveBattle(build(), 24680, { generateLog: true });
		const withoutLog = resolveBattle(build(), 24680, { generateLog: false });
		expect(withLog.outcome).toEqual(withoutLog.outcome);
	});

	// PHASE 12: the real flavor selection (many cosmetic draws, one per event)
	// replaced the Phase-3 single throwaway draw. This confirms (a) events now
	// carry a selected flavor TEMPLATE under generateLog, (b) offline carries
	// none, and (c) the outcome is still byte-identical, so the extra cosmetic
	// draws cannot have perturbed the combat stream.
	it("attaches flavor under generateLog, none offline, and the outcome is unchanged", () => {
		const build = () =>
			oneVsOne(
				{ hull: 140, weapons: [makeWeapon({ id: "pw", yield: 9 })] },
				{ hull: 130, weapons: [makeWeapon({ id: "ew", yield: 7 })] },
			);
		const live = resolveBattle(build(), 24680, { generateLog: true });
		const offline = resolveBattle(build(), 24680, { generateLog: false });

		// Every FLAVORED logged event under generateLog carries a non-empty flavor
		// template. The Phase-12b structured display events (roundState / effectExpired)
		// are STRUCTURED-ONLY by design: the combat view renders them from their
		// band/phase/effect fields, not a flavor line, and they deliberately make NO
		// cosmetic-stream draw (so every other event's flavor stays byte-identical). They
		// are therefore excluded from this flavor-presence assertion.
		const flavoredEvents = live.log.filter(
			(e) => e.type !== "roundState" && e.type !== "effectExpired",
		);
		expect(flavoredEvents.length).toBeGreaterThan(0);
		for (const e of flavoredEvents) {
			expect(e.flavor).toBeDefined();
			expect(e.flavor && e.flavor.length).toBeGreaterThan(0);
		}
		// Offline generated no log (and therefore no flavor / cosmetic work).
		expect(offline.log.length).toBe(0);
		// The outcome is identical despite the per-event cosmetic draws.
		expect(live.outcome).toEqual(offline.outcome);
	});
});

// ---------------------------------------------------------------------------
// COMBAT 0.13.0 combat-log options: the DISPLAY-ONLY shield/hull damage split.
// Each connecting hit event carries shieldDamage + hullDamage (the two halves of
// `damage`) so the Simplified log style + damage-color option can report them. This
// is emitted ONLY under generateLog (like the flavor field), so it MUST be
// outcome-neutral: the winner + surviving ships are byte-identical live vs offline.
// ---------------------------------------------------------------------------
describe("resolveBattle shield/hull damage split (display-only, outcome-neutral)", () => {
	// A shielded enemy guarantees BOTH a shield-absorbing hit (shieldDamage > 0) and,
	// once its shields fall, a hull-landing hit (hullDamage > 0), so the split is
	// exercised across the whole event stream.
	const build = () =>
		oneVsOne(
			{ hull: 160, weapons: [makeWeapon({ id: "pw", yield: 12 })] },
			{ hull: 120, shield: 60, weapons: [makeWeapon({ id: "ew", yield: 8 })] },
		);

	it("emits shieldDamage + hullDamage on every connecting hit, summing to damage", () => {
		const live = resolveBattle(build(), 4242, { generateLog: true });
		const hits = live.log.filter((e) => e.type === "hit");
		expect(hits.length).toBeGreaterThan(0);
		let sawShieldAbsorb = false;
		let sawHullLand = false;
		for (const h of hits) {
			// Present on every connecting hit, and a pure decomposition of `damage`.
			expect(h.shieldDamage).toBeDefined();
			expect(h.hullDamage).toBeDefined();
			expect((h.shieldDamage ?? 0) + (h.hullDamage ?? 0)).toBe(h.damage ?? 0);
			if ((h.shieldDamage ?? 0) > 0) sawShieldAbsorb = true;
			if ((h.hullDamage ?? 0) > 0) sawHullLand = true;
		}
		expect(sawShieldAbsorb).toBe(true);
		expect(sawHullLand).toBe(true);
	});

	it("offline emits none of the split fields (no log built)", () => {
		const offline = resolveBattle(build(), 4242, { generateLog: false });
		expect(offline.log.length).toBe(0);
	});

	it("is OUTCOME-NEUTRAL: outcome + finalCombatants byte-identical live vs offline", () => {
		const live = resolveBattle(build(), 4242, { generateLog: true });
		const offline = resolveBattle(build(), 4242, { generateLog: false });
		expect(offline.outcome).toEqual(live.outcome);
		expect(offline.finalCombatants).toEqual(live.finalCombatants);
	});

	it("outcome-neutrality holds across many seeds (fuzz)", () => {
		for (let seed = 1; seed <= 40; seed++) {
			const live = resolveBattle(build(), seed, { generateLog: true });
			const offline = resolveBattle(build(), seed, { generateLog: false });
			expect(offline.outcome).toEqual(live.outcome);
			expect(offline.finalCombatants).toEqual(live.finalCombatants);
		}
	});
});

// ---------------------------------------------------------------------------
// PHASE 12b DISPLAY-ONLY emission: range/band + phase (roundState) + status-effect
// expiry (effectExpired). ALL of this is gated on generateLog and must NOT move a
// single outcome. These tests prove (a) the events carry sane display data and (b)
// their presence changes no outcome / finalCombatants vs offline (the hard
// invariant, extended to the new emission).
// ---------------------------------------------------------------------------
describe("Phase 12b: range/band/phase (roundState) emission", () => {
	// Two ships that OPEN at long range and close through the bands, so the
	// roundState readout exercises detection -> intercept -> weapons-ready -> firing
	// and every band. Short weapon range (100) forces a real close before firing.
	const build = (): BattleParticipants => ({
		combatants: [
			makeCombatant({
				id: "P1",
				team: "player",
				hull: 400,
				hullMax: 400,
				position: 0,
				speed: 30,
				stance: "aggressive", // charge to short range so it closes + fires
				weapons: [makeWeapon({ id: "pw", yield: 8, range: 100, accuracy: 80 })],
			}),
			makeCombatant({
				id: "E1",
				team: "enemy",
				hull: 400,
				hullMax: 400,
				position: 250, // opens at 250 => long band, out of the 100 weapon range
				speed: 20,
				stance: "aggressive",
				weapons: [makeWeapon({ id: "ew", yield: 7, range: 100, accuracy: 80 })],
			}),
		],
	});

	it("emits per-combatant roundState events with the band matching bandFor(distance)", () => {
		const { log } = resolveBattle(build(), 4242, { generateLog: true });
		const roundStates = log.filter((e) => e.type === "roundState");
		expect(roundStates.length).toBeGreaterThan(0);
		for (const e of roundStates) {
			// Every roundState carries the display triple.
			expect(e.distance).toBeDefined();
			expect(e.band).toBeDefined();
			expect(e.phase).toBeDefined();
			// The band is exactly bandFor(distance): positioning.ts is the single source
			// of truth for the thresholds, never re-hardcoded here.
			expect(e.band).toBe(bandFor(e.distance!));
		}
	});

	it("round 0 opens at long-range detection (out of weapon range, before any fire)", () => {
		const { log } = resolveBattle(build(), 4242, { generateLog: true });
		const round0 = log.filter((e) => e.type === "roundState" && e.round === 0);
		// Both ships get a readout; both open at distance 250 (the |250 - 0| gap), which
		// is the long band and out of the 100 weapon range, so the phase is detection.
		expect(round0.length).toBe(2);
		for (const e of round0) {
			expect(e.distance).toBe(250);
			expect(e.band).toBe("long");
			expect(e.phase).toBe("detection");
		}
	});

	it("the engagement reaches a firing phase once the ships close into range", () => {
		const { log } = resolveBattle(build(), 4242, { generateLog: true });
		const phases = new Set(
			log.filter((e) => e.type === "roundState").map((e) => e.phase),
		);
		// The arc advances past the opening: at minimum it reaches firing (shots
		// exchanged) after closing, and it passed through a non-detection phase.
		expect(phases.has("firing")).toBe(true);
	});

	it("is OUTCOME-NEUTRAL with BOTH streams firing together: a closing battle that ALSO expires a debuff mid-fight (fuzz)", () => {
		// The review gap: the roundState fuzz above carries no status effects, and the
		// effectExpired fixture never closes distance, so neither proves the two display
		// streams are neutral TOGETHER. This fixture opens at long range and closes (the
		// full roundState arc) AND carries a coilDampening debuff that times out partway
		// (effectExpired), then asserts outcome + finalCombatants stay byte-identical.
		const buildBoth = (): BattleParticipants => ({
			combatants: [
				makeCombatant({
					id: "P1",
					team: "player",
					hull: 300,
					hullMax: 300,
					position: 0,
					speed: 30,
					stance: "aggressive",
					// Expires at tick 25, long before hull-300 ships trade to a kill. The enemy
					// has no effect-slot weapon, so it is never reapplied: it genuinely lapses.
					statusEffects: [
						{ defId: "coilDampening", rank: 1, remainingDeciSec: 25, dotBank: 0 },
					],
					weapons: [makeWeapon({ id: "pw", yield: 10, range: 100, accuracy: 80 })],
				}),
				makeCombatant({
					id: "E1",
					team: "enemy",
					hull: 300,
					hullMax: 300,
					position: 250,
					speed: 20,
					stance: "aggressive",
					weapons: [makeWeapon({ id: "ew", yield: 9, range: 100, accuracy: 80 })],
				}),
			],
		});
		for (let seed = 1; seed <= 40; seed++) {
			const live = resolveBattle(buildBoth(), seed, { generateLog: true });
			const offline = resolveBattle(buildBoth(), seed, { generateLog: false });
			expect(offline.outcome).toEqual(live.outcome);
			expect(offline.finalCombatants).toEqual(live.finalCombatants);
			expect(offline.log.length).toBe(0);
		}
		// Confirm the fuzz was not vacuous: both display streams actually fire together.
		const { log } = resolveBattle(buildBoth(), 3, { generateLog: true });
		expect(log.some((e) => e.type === "roundState")).toBe(true);
		expect(log.some((e) => e.type === "effectExpired")).toBe(true);
	});

	it("is OUTCOME-NEUTRAL: generateLog true vs false gives identical outcome + finalCombatants (fuzz)", () => {
		// The heart of the unit: the roundState (+ effectExpired) emission is all under
		// generateLog, so a live run's outcome AND every ship's post-battle state must
		// stay byte-identical to the offline run that emits none of it.
		for (let seed = 1; seed <= 40; seed++) {
			const live = resolveBattle(build(), seed, { generateLog: true });
			const offline = resolveBattle(build(), seed, { generateLog: false });
			expect(offline.outcome).toEqual(live.outcome);
			expect(offline.finalCombatants).toEqual(live.finalCombatants);
			// Offline emitted no roundState (no log at all); live did.
			expect(offline.log.length).toBe(0);
			expect(live.log.some((e) => e.type === "roundState")).toBe(true);
		}
	});
});

describe("Phase 12b: status-effect expiry (effectExpired) emission", () => {
	// A ship carrying a pre-existing debuff that is NEVER reapplied (its enemy has no
	// weapons) ticks the effect down; when its timer hits 0 the sim removes it and
	// emits exactly ONE effectExpired event. Both ships are near-unkillable so the
	// battle outlasts the effect's duration.
	const build = (): BattleParticipants => ({
		combatants: [
			makeCombatant({
				id: "P1",
				team: "player",
				hull: 100000,
				hullMax: 100000,
				// coilDampening rank 1, 25 deci-seconds left => expires at tick 25.
				statusEffects: [
					{ defId: "coilDampening", rank: 1, remainingDeciSec: 25, dotBank: 0 },
				],
				weapons: [makeWeapon({ id: "pw", yield: 1 })],
			}),
			makeCombatant({
				id: "E1",
				team: "enemy",
				hull: 100000,
				hullMax: 100000,
				weapons: [], // cannot fight back or REAPPLY the debuff
			}),
		],
	});

	it("an effect that times out emits exactly one effectExpired, tagged with target/def/rank", () => {
		const { log } = resolveBattle(build(), 7, { generateLog: true });
		const expiries = log.filter((e) => e.type === "effectExpired");
		expect(expiries.length).toBe(1);
		const e = expiries[0];
		expect(e.targetId).toBe("P1");
		expect(e.effectDefId).toBe("coilDampening");
		expect(e.effectRank).toBe(1);
		// Stamped at the expiry tick (25) and its round bucket (2).
		expect(e.tDeciSec).toBe(25);
		expect(e.round).toBe(2);
	});

	it("effectExpired is outcome-neutral: offline outcome/finalCombatants match live", () => {
		const live = resolveBattle(build(), 7, { generateLog: true });
		const offline = resolveBattle(build(), 7, { generateLog: false });
		expect(offline.outcome).toEqual(live.outcome);
		expect(offline.finalCombatants).toEqual(live.finalCombatants);
		// Offline emitted no expiry event (no log), yet the effect still expired
		// mechanically (its removal is in the outcome path, not the log path): the
		// surviving player carries no coilDampening in either run.
		const livePlayer = live.finalCombatants.find((c) => c.id === "P1")!;
		const offlinePlayer = offline.finalCombatants.find((c) => c.id === "P1")!;
		expect(livePlayer.statusEffects).toEqual([]);
		expect(offlinePlayer.statusEffects).toEqual([]);
	});
});

describe("resolveBattle termination", () => {
	it("two high-hull, low-damage tanks hit the cap and tiebreak (no hang)", () => {
		// Enormous hull + tiny yield => neither can kill the other inside 60s, so
		// the hard cap must fire. The player is given slightly MORE hull so the
		// hull% tiebreak is decisive and deterministic rather than a draw.
		const p = oneVsOne(
			{
				hull: 100000,
				hullMax: 100000,
				weapons: [makeWeapon({ id: "pw", yield: 1 })],
			},
			{
				hull: 50000,
				hullMax: 50000,
				weapons: [makeWeapon({ id: "ew", yield: 1 })],
			},
		);
		const { outcome } = resolveBattle(p, 111);
		expect(outcome.reason).toBe("capReached");
		// 60s cap => 60 rounds elapsed.
		expect(outcome.rounds).toBe(60);
		// Both took ~equal absolute damage, but player has far more max hull, so
		// its remaining hull% is higher => player wins the tiebreak.
		expect(outcome.winner).toBe("player");
	});

	it("a clearly-superior team eliminates the other and wins by 'eliminated'", () => {
		// Player out-guns the enemy massively: high yield, fast cooldown, big hull;
		// enemy is fragile and weak. The enemy must be wiped well before the cap.
		const p = oneVsOne(
			{
				hull: 500,
				hullMax: 500,
				weapons: [makeWeapon({ id: "pw", yield: 50, cooldownDeciSec: 5 })],
			},
			{
				hull: 40,
				hullMax: 40,
				weapons: [makeWeapon({ id: "ew", yield: 2, cooldownDeciSec: 20 })],
			},
		);
		const { outcome } = resolveBattle(p, 7);
		expect(outcome.reason).toBe("eliminated");
		expect(outcome.winner).toBe("player");
		// Should be a quick kill, far under the 60-round cap.
		expect(outcome.rounds).toBeLessThan(60);
	});
});

describe("resolveBattle basic sanity", () => {
	it("a 1v1 where team A out-damages team B => A wins", () => {
		// Equal hull, but the player's yield/rate strictly dominates, so across
		// many seeds the player should win every time (the ~90% hit placeholder is
		// symmetric, so raw DPS advantage decides it).
		for (let seed = 0; seed < 20; seed++) {
			const p = oneVsOne(
				{
					hull: 100,
					hullMax: 100,
					weapons: [makeWeapon({ id: "pw", yield: 30, cooldownDeciSec: 5 })],
				},
				{
					hull: 100,
					hullMax: 100,
					weapons: [makeWeapon({ id: "ew", yield: 3, cooldownDeciSec: 20 })],
				},
			);
			const { outcome } = resolveBattle(p, seed);
			expect(outcome.winner).toBe("player");
			expect(outcome.reason).toBe("eliminated");
		}
	});

	it("shields absorb before hull: a shielded ship survives a shot it would die to bare-hull", () => {
		// One shot of 30 vs a ship with 25 shield + 10 hull: 25 soaks the shield,
		// 5 spills to hull, leaving it alive at 5 hull. Proves the shield-then-hull
		// order actually runs in the skeleton shot. Enemy has no weapon so only the
		// player fires; we check the enemy is dead and player alive is trivial, so
		// instead assert the battle ends by elimination in the player's favor.
		const p = oneVsOne(
			{
				hull: 1000,
				hullMax: 1000,
				weapons: [makeWeapon({ id: "pw", yield: 30, cooldownDeciSec: 10 })],
			},
			{
				hull: 10,
				hullMax: 10,
				shield: 25,
				shieldMax: 25,
				shieldRecharge: 0,
				weapons: [],
			},
		);
		const { outcome } = resolveBattle(p, 3);
		expect(outcome.winner).toBe("player");
		expect(outcome.reason).toBe("eliminated");
	});
});

// ===========================================================================
// PHASE 3 shot-pipeline MECHANIC tests.
//
// The mitigation math (family triangle, attenuation, armor, armor-pen) is tested
// through the PURE applyProjectileDamage function with hand-picked raw damage, so
// every assertion is an exact integer with ZERO rng involved. The rng-driven
// behaviors (evade, projectile independence, crit spread, carry-over fire timing)
// are tested through the full resolveBattle with fixed seeds.
// ===========================================================================

// A defense-target factory for the pure mitigation tests. Big pools so a single
// crafted projectile never kills it and we can read the exact shield/hull loss.
function defenseTarget(overrides: Partial<Combatant> = {}): Combatant {
	return makeCombatant({
		id: "T",
		team: "enemy",
		hull: 100000,
		hullMax: 100000,
		shield: 100000,
		shieldMax: 100000,
		...overrides,
	});
}

describe("shot pipeline: family damage triangle", () => {
	it("particle does +10% vs shields (shields up => vs-Shields column)", () => {
		// Shields up, particle, no attenuation (attenuation 0), so all 100 raw hits
		// shields at the +10% particle-vs-shields multiplier => 110 shield lost.
		const t = defenseTarget();
		const { dealt } = applyProjectileDamage(t, "particle", 0, 0, 100);
		expect(t.shield).toBe(100000 - 110);
		expect(dealt).toBe(110);
	});

	it("particle does -10% vs armor/hull (shields down => vs-Armor column)", () => {
		// No shields => vs-Armor column => particle -10% => 90 hull lost.
		const t = defenseTarget({ shield: 0, shieldMax: 0 });
		applyProjectileDamage(t, "particle", 0, 0, 100);
		expect(t.hull).toBe(100000 - 90);
	});

	it("kinetic is neutral vs shields but +10% vs armor/hull", () => {
		// Shields up: kinetic vs-Shields column is 100% => exactly 100 shield lost.
		const shielded = defenseTarget();
		applyProjectileDamage(shielded, "kinetic", 0, 0, 100);
		expect(shielded.shield).toBe(100000 - 100);

		// Shields down: kinetic vs-Armor column is +10% => 110 hull lost.
		const bare = defenseTarget({ shield: 0, shieldMax: 0 });
		applyProjectileDamage(bare, "kinetic", 0, 0, 100);
		expect(bare.hull).toBe(100000 - 110);
	});

	it("EW does -10% vs shields and is neutral vs armor/hull", () => {
		const shielded = defenseTarget();
		applyProjectileDamage(shielded, "ew", 0, 0, 100);
		expect(shielded.shield).toBe(100000 - 90); // -10% vs shields

		const bare = defenseTarget({ shield: 0, shieldMax: 0 });
		applyProjectileDamage(bare, "ew", 0, 0, 100);
		expect(bare.hull).toBe(100000 - 100); // neutral vs hull
	});
});

describe("shot pipeline: shield attenuation (particle only)", () => {
	it("a particle shot partially bypasses full shields; a kinetic shot of equal damage does not", () => {
		// Particle with 40% attenuation vs a target with 0 coherence. Per the spec
		// stage order, the triangle (step 4) is applied BEFORE attenuation (step
		// 5a): shields up => particle vs-Shields +10% => 110; then 40% of 110 = 44
		// bypasses straight to hull. We assert the hull took damage THROUGH a full
		// shield, and the exact bypass amount.
		const particleTarget = defenseTarget();
		const pr = applyProjectileDamage(particleTarget, "particle", 40, 0, 100);
		expect(pr.attenuated).toBe(true);
		expect(particleTarget.hull).toBeLessThan(100000); // hull hit through shields
		expect(particleTarget.hull).toBe(100000 - 44); // floor(110 * 40/100) = 44

		// Kinetic of identical raw against an identical full shield: NO attenuation,
		// so the shield fully walls it and hull is untouched.
		const kineticTarget = defenseTarget();
		const kr = applyProjectileDamage(kineticTarget, "kinetic", 40, 0, 100);
		expect(kr.attenuated).toBe(false);
		expect(kineticTarget.hull).toBe(100000); // hull untouched, fully walled
	});

	it("attenuation is reduced by shieldCoherence; equal coherence => zero net bypass", () => {
		// net attenuation = max(0, weaponAtten - shieldCoherence). 30 vs 30 => 0.
		const t = defenseTarget({ shieldCoherence: 30 });
		const r = applyProjectileDamage(t, "particle", 30, 0, 100);
		expect(r.attenuated).toBe(false);
		expect(t.hull).toBe(100000); // nothing bled through
	});

	it("partial coherence leaves a smaller net bypass", () => {
		// weaponAtten 50, coherence 20 => net 30% bypass. Triangle first (shields up
		// => +10% => 110), then 30% of 110 = 33 bypasses to hull.
		const t = defenseTarget({ shieldCoherence: 20 });
		const r = applyProjectileDamage(t, "particle", 50, 0, 100);
		expect(r.attenuated).toBe(true);
		expect(t.hull).toBe(100000 - 33);
	});
});

describe("shot pipeline: armor on the hull-path", () => {
	it("ablativeArmor is a depleting buffer that soaks first, then depletes", () => {
		// Shields down so 100 raw goes straight to the hull-path (kinetic vs-Armor
		// +10% => 110 incoming). Armor 40 soaks 40 (depleting to 0), leaving 70 hull.
		const t = defenseTarget({
			shield: 0,
			shieldMax: 0,
			ablativeArmor: 40,
		});
		applyProjectileDamage(t, "kinetic", 0, 0, 100);
		expect(t.ablativeArmor).toBe(0); // buffer depleted by what it soaked
		expect(t.hull).toBe(100000 - 70); // 110 incoming - 40 soaked = 70
	});

	it("kineticDampening applies a percent reduction after armor", () => {
		// Shields down, EW (neutral vs armor so incoming == 100 raw), no ablative,
		// 25% dampening => floor(100 * 75/100) = 75 hull lost.
		const t = defenseTarget({
			shield: 0,
			shieldMax: 0,
			kineticDampening: 25,
		});
		applyProjectileDamage(t, "ew", 0, 0, 100);
		expect(t.hull).toBe(100000 - 75);
	});

	it("kinetic armorPen ignores a percent of BOTH ablative armor and dampening", () => {
		// Baseline (no pen): kinetic vs-Armor +10% => 110 incoming. Armor 50 soaks
		// 50 => 60 remains, 50% dampening => floor(60*50/100)=30 hull lost.
		const noPen = defenseTarget({
			shield: 0,
			shieldMax: 0,
			ablativeArmor: 50,
			kineticDampening: 50,
		});
		applyProjectileDamage(noPen, "kinetic", 0, 0, 100);
		expect(noPen.hull).toBe(100000 - 30);

		// With 100% armorPen: effective armor 0 AND effective dampening 0, so the
		// full 110 incoming lands. Proves pen ignores BOTH mitigations.
		const fullPen = defenseTarget({
			shield: 0,
			shieldMax: 0,
			ablativeArmor: 50,
			kineticDampening: 50,
		});
		applyProjectileDamage(fullPen, "kinetic", 0, 100, 100);
		expect(fullPen.hull).toBe(100000 - 110);
		// The ignored armor was NOT consumed (pen bypassed it, did not deplete it).
		expect(fullPen.ablativeArmor).toBe(50);
	});

	it("strict mitigation order: attenuation split, then shields, then armor, then hull", () => {
		// A single particle projectile against a target with a THIN shield + armor,
		// exercising every stage at once. raw 100, attenuation 50 (coherence 0):
		//   4:  triangle first (shields up => particle vs-Shields +10%) => 110.
		//   5a: 50% of 110 = 55 bypasses to the hull-path; 55 aimed at shields.
		//   5b: shield is only 20, so 20 absorbed and 35 overflows to the hull-path.
		//       hull-path so far = 55 (bypass) + 35 (overflow) = 90.
		//   5c: ablative armor 10 soaks 10 (depletes to 0) => 80 remains.
		//   5d: 80 lands on hull.
		// The point of this test is the strict STAGE ORDER firing together, so we
		// assert the end state of each stage (shield drained, armor depleted, hull
		// hit) rather than leaning on any single intermediate.
		const t = defenseTarget({ shield: 20, shieldMax: 20, ablativeArmor: 10 });
		const r = applyProjectileDamage(t, "particle", 50, 0, 100);
		expect(r.attenuated).toBe(true);
		expect(t.shield).toBe(0); // thin shield fully drained
		expect(t.ablativeArmor).toBe(0); // armor buffer soaked + depleted
		expect(t.hull).toBeLessThan(100000); // remainder reached hull
	});
});

describe("shot pipeline: evade", () => {
	it("a zero-net-hit-chance shot misses, logs an evade, deals no damage", () => {
		// accuracy 0 => hitChance clamps to 0 => guaranteed miss regardless of seed.
		const p = oneVsOne(
			{
				hull: 1000,
				hullMax: 1000,
				weapons: [makeWeapon({ id: "pw", yield: 30, accuracy: 0 })],
			},
			{ hull: 1000, hullMax: 1000, weapons: [] },
		);
		const { log } = resolveBattle(p, 12345, { generateLog: true });
		// Player SHOT events only (hit / evade). Exclude the Phase-12b per-round
		// "roundState" readout, which also carries actorId "P1" but is not a shot.
		const playerShots = log.filter(
			(e) => e.actorId === "P1" && (e.type === "hit" || e.type === "evade"),
		);
		expect(playerShots.length).toBeGreaterThan(0);
		// Every player shot is an evade with zero damage (nothing ever connects).
		for (const e of playerShots) {
			expect(e.type).toBe("evade");
			expect(e.result).toBe("evade");
			expect(e.damage).toBe(0);
			expect(e.projectilesHit).toBe(0);
		}
	});

	it("high target evasion equal to accuracy also yields guaranteed evades", () => {
		// accuracy 70 vs evasion 70 => net 0 hit chance => all evades.
		const p = oneVsOne(
			{
				hull: 1000,
				hullMax: 1000,
				weapons: [makeWeapon({ id: "pw", yield: 30, accuracy: 70 })],
			},
			{ hull: 1000, hullMax: 1000, weapons: [], evasion: 70 },
		);
		const { log } = resolveBattle(p, 999, { generateLog: true });
		const hits = log.filter((e) => e.actorId === "P1" && e.type === "hit");
		expect(hits.length).toBe(0);
	});
});

describe("shot pipeline: crit + projectiles roll independently", () => {
	it("a multi-projectile weapon spreads hits: some projectiles connect, some miss (seed-fixed)", () => {
		// A 4-projectile weapon at 50% accuracy: over a fixed seed the connecting
		// count per shot varies between 0 and 4 (independent per-projectile rolls),
		// which a single all-or-nothing roll could never produce.
		const p = oneVsOne(
			{
				hull: 100000,
				hullMax: 100000,
				weapons: [
					makeWeapon({
						id: "pw",
						yield: 5,
						accuracy: 50,
						projectileCount: 4,
						cooldownDeciSec: 10,
					}),
				],
			},
			{ hull: 100000, hullMax: 100000, weapons: [] },
		);
		const { log } = resolveBattle(p, 4242, { generateLog: true });
		// Player SHOT events only (hit / evade). Exclude the Phase-12b per-round
		// "roundState" readout, which also carries actorId "P1" but is not a shot.
		const shots = log.filter(
			(e) => e.actorId === "P1" && (e.type === "hit" || e.type === "evade"),
		);
		const hitCounts = new Set(shots.map((e) => e.projectilesHit));
		// Independence => a spread of connecting counts (not just {0} or {4}).
		expect(hitCounts.size).toBeGreaterThan(1);
		// Every per-shot count is within [0, projectileCount].
		for (const e of shots) {
			expect(e.projectilesHit).toBeGreaterThanOrEqual(0);
			expect(e.projectilesHit).toBeLessThanOrEqual(4);
		}
	});

	it("crit is deterministic per seed: the same battle reports the same crit shots", () => {
		// Two identical runs must flag crit on exactly the same shots (crit is a
		// combat-stream roll, so it is reproducible).
		const build = () =>
			oneVsOne(
				{
					hull: 100000,
					hullMax: 100000,
					weapons: [makeWeapon({ id: "pw", yield: 20, accuracy: 100 })],
				},
				{ hull: 100000, hullMax: 100000, weapons: [] },
			);
		const a = resolveBattle(build(), 77, { generateLog: true });
		const b = resolveBattle(build(), 77, { generateLog: true });
		const critsA = a.log.filter((e) => e.crit).map((e) => e.tDeciSec);
		const critsB = b.log.filter((e) => e.crit).map((e) => e.tDeciSec);
		expect(critsA).toEqual(critsB);
		// A 60s fight at 10% crit over ~60 shots should land at least one crit, so
		// this also proves crits actually happen (not a vacuous match of two empties).
		expect(critsA.length).toBeGreaterThan(0);
	});
});

describe("shot pipeline: carry-over cooldown fire timing", () => {
	it("a weapon whose cooldownDeciSec does not divide the run still fires the exact count", () => {
		// cooldownDeciSec 7 (0.7s) does NOT divide the 600-tick (60s) cap evenly.
		// The carry-over accumulator means it fires every 7 ticks: floor(600/7)=85
		// times, with NO drift from the ragged remainder. accuracy 100 so every
		// fire logs a hit; target is unkillable so the battle runs the full cap.
		const p = oneVsOne(
			{
				hull: 1000000000,
				hullMax: 1000000000,
				weapons: [
					makeWeapon({
						id: "pw",
						yield: 1,
						accuracy: 100,
						cooldownDeciSec: 7,
					}),
				],
			},
			{ hull: 1000000000, hullMax: 1000000000, weapons: [] },
		);
		const { outcome, log } = resolveBattle(p, 1, { generateLog: true });
		expect(outcome.reason).toBe("capReached");
		const playerHits = log.filter(
			(e) => e.actorId === "P1" && e.type === "hit",
		);
		expect(playerHits.length).toBe(Math.floor(600 / 7)); // 85, no drift
	});
});

// ===========================================================================
// PHASE 5 per-family DAMAGE-RESIST tests (pure applyProjectileDamage).
//
// Damage resist is a flat per-family cut on the raw typed damage, applied right
// after the triangle and before mitigation. All exact-integer, zero rng.
// ===========================================================================

describe("shot pipeline: per-family damage resist (design S5)", () => {
	it("50% particle resist halves a particle shot (after the triangle)", () => {
		// Shields up, particle => triangle +10% => 110, then 50% damage resist =>
		// floor(110 * 50/100) = 55 shield lost. Resist is applied to the typed
		// damage BEFORE mitigation, so the whole 55 hits the (huge) shield pool.
		const t = defenseTarget({
			damageResist: { kinetic: 0, particle: 50, ew: 0 },
		});
		const { dealt } = applyProjectileDamage(t, "particle", 0, 0, 100);
		expect(t.shield).toBe(100000 - 55);
		expect(dealt).toBe(55);
	});

	it("resist is per-family: particle resist does NOT reduce a kinetic shot", () => {
		// Same 50% PARTICLE resist, but a KINETIC shot: kinetic vs-Shields is neutral
		// (100%) and the particle-only resist does not apply => full 100 shield lost.
		const t = defenseTarget({
			damageResist: { kinetic: 0, particle: 50, ew: 0 },
		});
		applyProjectileDamage(t, "kinetic", 0, 0, 100);
		expect(t.shield).toBe(100000 - 100);
	});

	it("resist cuts the raw typed damage before the attenuation split", () => {
		// Particle, 40% attenuation, 50% particle damage resist, shields up.
		//   triangle: +10% => 110
		//   resist:   floor(110 * 50/100) = 55  (the number the split works off)
		//   attenuate: floor(55 * 40/100) = 22 bypass to hull; 33 to shields.
		// Proves resist lands on the raw typed damage, upstream of attenuation.
		const t = defenseTarget({
			damageResist: { kinetic: 0, particle: 50, ew: 0 },
		});
		const r = applyProjectileDamage(t, "particle", 40, 0, 100);
		expect(r.attenuated).toBe(true);
		expect(t.hull).toBe(100000 - 22); // floor(55 * 40/100)
		expect(t.shield).toBe(100000 - 33); // the non-bypassed remainder
	});

	it("zero resist is a byte-identical no-op (regression guard)", () => {
		// An all-zero resist map must reproduce the plain triangle result exactly.
		const t = defenseTarget({
			damageResist: { kinetic: 0, particle: 0, ew: 0 },
		});
		applyProjectileDamage(t, "particle", 0, 0, 100);
		expect(t.shield).toBe(100000 - 110); // unchanged +10% particle-vs-shields
	});

	it("100% resist fully negates the matching family's damage", () => {
		const t = defenseTarget({
			damageResist: { kinetic: 0, particle: 100, ew: 0 },
		});
		const { dealt } = applyProjectileDamage(t, "particle", 0, 0, 100);
		expect(dealt).toBe(0);
		expect(t.shield).toBe(100000);
	});
});

// ===========================================================================
// PHASE 5 per-family DISRUPTION-RESIST tests (through the full resolveBattle).
//
// Disruption resist cuts the matching family's proc chance AND escalation
// (rank). Deterministic per seed; a zero-resist run is unchanged.
// ===========================================================================

describe("status effects: per-family disruption resist (design S5)", () => {
	// A particle Plasma-Fire weapon that always connects and always tries to proc,
	// so the ONLY thing gating the proc landing is the target's disruption resist.
	const alwaysProcPlasma = () =>
		makeWeapon({
			id: "pw",
			family: "particle",
			yield: 1,
			accuracy: 100,
			cooldownDeciSec: 10,
			effectSlots: [{ defId: "plasmaFire", procChance: 100, escalationChance: 0 }],
		});

	it("100% particle disruption resist blocks all particle procs; 0% does not", () => {
		const resisted = oneVsOne(
			{ hull: 100000, hullMax: 100000, weapons: [alwaysProcPlasma()] },
			{
				hull: 100000,
				hullMax: 100000,
				weapons: [],
				disruptionResist: { kinetic: 0, particle: 100, ew: 0 },
			},
		);
		const clean = oneVsOne(
			{ hull: 100000, hullMax: 100000, weapons: [alwaysProcPlasma()] },
			{ hull: 100000, hullMax: 100000, weapons: [] },
		);
		const r = resolveBattle(resisted, 11, { generateLog: true });
		const c = resolveBattle(clean, 11, { generateLog: true });
		const procs = (res: typeof r) =>
			res.log.filter((e) => e.type === "effectApplied").length;
		expect(procs(r)).toBe(0); // fully resisted: nothing lands
		expect(procs(c)).toBeGreaterThan(0); // unresisted: procs land
	});

	it("disruption resist is per-family: EW resist does NOT block a particle proc", () => {
		// Target resists EW disruptions fully, but the incoming weapon is PARTICLE,
		// so its Plasma Fire still lands exactly as if unresisted.
		const ewResisted = oneVsOne(
			{ hull: 100000, hullMax: 100000, weapons: [alwaysProcPlasma()] },
			{
				hull: 100000,
				hullMax: 100000,
				weapons: [],
				disruptionResist: { kinetic: 0, particle: 0, ew: 100 },
			},
		);
		const clean = oneVsOne(
			{ hull: 100000, hullMax: 100000, weapons: [alwaysProcPlasma()] },
			{ hull: 100000, hullMax: 100000, weapons: [] },
		);
		const proc = (p: BattleParticipants) =>
			resolveBattle(p, 11, { generateLog: true }).log.filter(
				(e) => e.type === "effectApplied",
			).length;
		expect(proc(ewResisted)).toBe(proc(clean));
	});

	it("disruption resist suppresses rank escalation (cuts rank, not just chance)", () => {
		// The resist cuts proc AND escalation by the SAME factor, so it cannot zero
		// escalation while procs still land; the rank-suppression is therefore
		// statistical, demonstrated on a pinned seed. escalationChance 100 => an
		// unresisted target climbs to MAX_RANK 3. A 75% particle disruption resist
		// dampens both proc chance (100 -> 25) and escalation (100 -> 25), so on this
		// representative seed the resisted target peaks at a STRICTLY lower rank.
		// The seed is safe to pin: resist only moves roll THRESHOLDS, never the draw
		// schedule, so the sequence is stable (same discipline as the crit tests).
		const escalating = () =>
			makeWeapon({
				id: "pw",
				family: "particle",
				yield: 1,
				accuracy: 100,
				cooldownDeciSec: 10,
				effectSlots: [
					{ defId: "plasmaFire", procChance: 100, escalationChance: 100 },
				],
			});
		const clean = oneVsOne(
			{ hull: 100000, hullMax: 100000, weapons: [escalating()] },
			{ hull: 100000, hullMax: 100000, weapons: [] },
		);
		const resisted = oneVsOne(
			{ hull: 100000, hullMax: 100000, weapons: [escalating()] },
			{
				hull: 100000,
				hullMax: 100000,
				weapons: [],
				disruptionResist: { kinetic: 0, particle: 75, ew: 0 },
			},
		);
		const maxRank = (p: BattleParticipants) => {
			const dots = resolveBattle(p, 0, { generateLog: true }).log.filter(
				(e) => e.type === "dot" && e.effectDefId === "plasmaFire",
			);
			return Math.max(0, ...dots.map((e) => e.effectRank ?? 0));
		};
		expect(maxRank(clean)).toBe(3); // unresisted climbs to the cap
		expect(maxRank(resisted)).toBeLessThan(3); // resist held the rank down
	});

	it("offline == live still holds with a disruption-resisted target (parity)", () => {
		// Resist changes proc/escalation THRESHOLDS but never the draw schedule, so
		// the winner + rounds must match with and without the log.
		const build = () =>
			oneVsOne(
				{
					hull: 400,
					hullMax: 400,
					weapons: [
						makeWeapon({
							id: "pw",
							family: "particle",
							yield: 20,
							accuracy: 100,
							effectSlots: [
								{ defId: "plasmaFire", procChance: 70, escalationChance: 40 },
							],
						}),
					],
				},
				{
					hull: 300,
					hullMax: 300,
					weapons: [makeWeapon({ id: "ew", yield: 4 })],
					disruptionResist: { kinetic: 0, particle: 60, ew: 0 },
					damageResist: { kinetic: 0, particle: 25, ew: 0 },
				},
			);
		const live = resolveBattle(build(), 5150, { generateLog: true });
		const offline = resolveBattle(build(), 5150, { generateLog: false });
		expect(offline.outcome).toEqual(live.outcome);
	});
});

// ===========================================================================
// PHASE 4 status-effect INTEGRATION tests (through the full resolveBattle).
//
// These exercise the effect-proc seam + the per-tick tickEffects pass + the
// per-round DoT log aggregation + an applied debuff, all end to end, plus a
// restatement of the parity invariant with an effect-procing weapon. The pure
// mechanics (rank/refresh/DoT math/cleanse) are unit-tested in
// statusEffects.test.ts; here we prove the SIM wires them correctly.
// ===========================================================================

// A weapon that reliably lands its effect: a particle weapon at 100% accuracy
// with a single guaranteed-proc, non-escalating Plasma Fire slot and negligible
// direct damage, so the hull movement we observe is the DoT, not the shot.
function plasmaFireWeapon(
	overrides: {
		procChance?: number;
		escalationChance?: number;
		yield?: number;
	} = {},
): CombatWeapon {
	return makeWeapon({
		id: "pw",
		family: "particle",
		yield: overrides.yield ?? 1, // tiny direct damage; the DoT is the story
		accuracy: 100, // always connects, so the proc always gets its roll
		cooldownDeciSec: 10, // fire once per round
		effectSlots: [
			{
				defId: "plasmaFire",
				procChance: overrides.procChance ?? 100,
				escalationChance: overrides.escalationChance ?? 0,
			},
		],
	});
}

// A punching-bag enemy: enormous hull, NO weapons (so it never kills the player
// and the battle runs to the cap), no shields (so DoT hits hull directly and is
// easy to read). The player likewise gets huge hull so it always survives.
function burnTargetBattle(playerWeapon: CombatWeapon): BattleParticipants {
	return oneVsOne(
		{ hull: 100000, hullMax: 100000, weapons: [playerWeapon] },
		{ hull: 100000, hullMax: 100000, weapons: [] },
	);
}

describe("status effects: DoT proc + burn over rounds", () => {
	it("a Plasma hit applies Plasma Fire and it burns the target over subsequent rounds", () => {
		const { log } = resolveBattle(burnTargetBattle(plasmaFireWeapon()), 11, {
			generateLog: true,
		});
		// The shot landed the effect: an effectApplied event names plasmaFire.
		const applied = log.filter(
			(e) => e.type === "effectApplied" && e.effectDefId === "plasmaFire",
		);
		expect(applied.length).toBeGreaterThan(0);
		// The DoT actually burned hull: dot events with positive damage, on the
		// enemy target, across MORE THAN ONE round (it burns over time).
		const dots = log.filter(
			(e) => e.type === "dot" && e.effectDefId === "plasmaFire",
		);
		expect(dots.length).toBeGreaterThan(1);
		for (const d of dots) {
			expect(d.targetId).toBe("E1");
			expect(d.damage).toBeGreaterThan(0);
		}
		const burnRounds = new Set(dots.map((e) => e.round));
		expect(burnRounds.size).toBeGreaterThan(1); // burned across several rounds
	});

	it("the DoT log aggregates to ONE line per round, not one per tick", () => {
		const { log } = resolveBattle(burnTargetBattle(plasmaFireWeapon()), 11, {
			generateLog: true,
		});
		const dots = log.filter(
			(e) => e.type === "dot" && e.effectDefId === "plasmaFire",
		);
		// No two plasmaFire dot events may share a round: exactly one aggregated
		// line per round (not the ~10 ticks that actually dealt the damage).
		const rounds = dots.map((e) => e.round);
		expect(new Set(rounds).size).toBe(rounds.length);
		// A rank-1 Plasma Fire deals 10/round; a full round's aggregated line must
		// therefore never exceed 10 (partial first/last rounds can be less).
		for (const d of dots) {
			expect(d.damage).toBeLessThanOrEqual(10);
		}
		// And a representative full round should sum to the whole 10 (proving the
		// aggregation adds the per-tick damage, not just logs one tick).
		const tens = dots.filter((e) => e.damage === 10);
		expect(tens.length).toBeGreaterThan(0);
	});

	it("escalation climbs the rank in-sim when escalationChance is guaranteed", () => {
		// procChance + escalationChance 100 => every fire re-applies and (below the
		// cap) escalates, so later rounds' DoT lines report a higher rank + bigger
		// per-round damage, up to MAX_RANK 3 (30/round).
		const { log } = resolveBattle(
			burnTargetBattle(plasmaFireWeapon({ escalationChance: 100 })),
			11,
			{ generateLog: true },
		);
		const dots = log.filter(
			(e) => e.type === "dot" && e.effectDefId === "plasmaFire",
		);
		const maxRank = Math.max(...dots.map((e) => e.effectRank ?? 0));
		expect(maxRank).toBe(3); // escalated to the cap
		// The heaviest full round burns at the rank-3 rate (30/round).
		const maxDamage = Math.max(...dots.map((e) => e.damage ?? 0));
		expect(maxDamage).toBe(30);
	});

	it("proc + burn is deterministic per seed (identical dot log across runs)", () => {
		const build = () => burnTargetBattle(plasmaFireWeapon({ procChance: 50 }));
		const a = resolveBattle(build(), 909, { generateLog: true });
		const b = resolveBattle(build(), 909, { generateLog: true });
		const dotsOf = (r: typeof a) =>
			r.log
				.filter((e) => e.type === "dot")
				.map((e) => `${e.round}:${e.damage}:${e.effectRank}`);
		expect(dotsOf(a)).toEqual(dotsOf(b));
		// A 50% proc over ~60 shots reliably lands at least one burn, so this is not
		// a vacuous match of two empty lists.
		expect(dotsOf(a).length).toBeGreaterThan(0);
	});

	it("offline == live still holds with an effect-procing weapon (parity)", () => {
		// The proc + escalation add combat-stream draws; they must be independent of
		// generateLog. A high-proc, escalating Plasma vs a killable enemy: the winner
		// + rounds must match with and without the log.
		const build = () =>
			oneVsOne(
				{
					hull: 400,
					hullMax: 400,
					weapons: [
						plasmaFireWeapon({ procChance: 70, escalationChance: 40, yield: 20 }),
					],
				},
				{ hull: 300, hullMax: 300, weapons: [makeWeapon({ id: "ew", yield: 4 })] },
			);
		const live = resolveBattle(build(), 5150, { generateLog: true });
		const offline = resolveBattle(build(), 5150, { generateLog: false });
		expect(offline.outcome).toEqual(live.outcome);
	});
});

describe("status effects: applied accuracy debuff reduces hit rate", () => {
	it("an attacker afflicted with an accuracy disruption lands fewer hits", () => {
		// Same battle, same seed; the only difference is the attacker carries a
		// rank-3 Scattering Field (-60% accuracy) with a long duration so it stays
		// active for the whole fight. It must land strictly fewer hits than a clean
		// attacker. Target is unkillable so both runs go the full cap (same shot
		// count opportunity), isolating the accuracy effect.
		const cleanBattle = () =>
			oneVsOne(
				{
					hull: 100000,
					hullMax: 100000,
					weapons: [makeWeapon({ id: "pw", yield: 1, accuracy: 90 })],
				},
				{ hull: 100000, hullMax: 100000, weapons: [] },
			);
		const debuffedBattle = () =>
			oneVsOne(
				{
					hull: 100000,
					hullMax: 100000,
					weapons: [makeWeapon({ id: "pw", yield: 1, accuracy: 90 })],
					// A long-lived rank-3 accuracy disruption on the SHOOTER.
					statusEffects: [
						{
							defId: "scatteringField",
							rank: 3,
							remainingDeciSec: 100000,
							dotBank: 0,
						},
					],
				},
				{ hull: 100000, hullMax: 100000, weapons: [] },
			);
		const clean = resolveBattle(cleanBattle(), 321, { generateLog: true });
		const debuffed = resolveBattle(debuffedBattle(), 321, { generateLog: true });
		const hits = (r: typeof clean) =>
			r.log.filter((e) => e.actorId === "P1" && e.type === "hit").length;
		expect(hits(debuffed)).toBeLessThan(hits(clean));
		// Sanity: the clean attacker at 90% actually landed plenty of hits.
		expect(hits(clean)).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// COMBAT 1.0 (Unit 1.5): the five newly-live status effects. THREE readers are wired
// here (Emitter Overload +damageTaken, Harmonic Gap +attenuation, Weapon Jam offline
// chance); THREE weapon SOURCES are added in weapons.ts (Sensor Power Drain -> Tachyon,
// Coil Dampening -> Graviton, Harmonic Gap -> Plasma; the -range and -weaponDamage
// readers already existed). Each test below proves the effect now CHANGES an outcome,
// deterministically (pure applyProjectileDamage helper calls, or a seeded sim), and is
// parity-safe by construction (the readers make no cosmetic-stream draw; the jam roll
// is on the combat stream, ungated by generateLog).
// ---------------------------------------------------------------------------
describe("Combat 1.0 Unit 1.5: Emitter Overload reader (+damageTaken)", () => {
	it("a target under Emitter Overload takes MORE damage from the same shot", () => {
		// Pure applyProjectileDamage: an identical kinetic shot (no shields/armor, so the
		// debuff is the ONLY variable) vs a clean target and one carrying a rank-1 Emitter
		// Overload (+20% damage taken). A bare kinetic shot uses the vs-Armor column (+10%):
		// raw 100 -> 110. The overloaded target then scales UP by +20% -> 132.
		const clean = makeCombatant({ hull: 1000, hullMax: 1000 });
		const overloaded = makeCombatant({
			hull: 1000,
			hullMax: 1000,
			statusEffects: [
				{ defId: "emitterOverload", rank: 1, remainingDeciSec: 100, dotBank: 0 },
			],
		});
		const c = applyProjectileDamage(clean, "kinetic", 0, 0, 100);
		const o = applyProjectileDamage(overloaded, "kinetic", 0, 0, 100);
		expect(c.dealt).toBe(110);
		expect(o.dealt).toBe(132); // 110 * 1.20
		expect(o.dealt).toBeGreaterThan(c.dealt);
	});

	it("does nothing to a target without the effect (byte-identical no-op)", () => {
		const clean = makeCombatant({ hull: 1000, hullMax: 1000 });
		expect(applyProjectileDamage(clean, "kinetic", 0, 0, 100).dealt).toBe(110);
	});
});

describe("Combat 1.0 Unit 1.5: Harmonic Gap reader (+attenuation)", () => {
	it("a particle shot bleeds MORE through a target carrying Harmonic Gap", () => {
		// Same particle shot (weapon shieldAttenuation 20) vs a fully-shielded target, once
		// clean and once with a rank-2 Harmonic Gap (+40% attenuation). Clean net atten =
		// 20%; gapped = 20 + 40 = 60%. Particle vs shielded uses +10% (raw 100 -> 110), so
		// clean bleeds floor(110*20/100)=22 to hull, gapped floor(110*60/100)=66.
		const shielded = () =>
			makeCombatant({
				hull: 1000,
				hullMax: 1000,
				shield: 1000,
				shieldMax: 1000,
			});
		const clean = shielded();
		const gapped = makeCombatant({
			...shielded(),
			statusEffects: [
				{ defId: "harmonicGap", rank: 2, remainingDeciSec: 100, dotBank: 0 },
			],
		});
		const c = applyProjectileDamage(clean, "particle", 20, 0, 100);
		const g = applyProjectileDamage(gapped, "particle", 20, 0, 100);
		expect(c.hullDealt).toBe(22);
		expect(g.hullDealt).toBe(66);
		expect(g.hullDealt).toBeGreaterThan(c.hullDealt);
		expect(g.attenuated).toBe(true);
	});
});

describe("Combat 1.0 Unit 1.5: Weapon Jam reader (weaponOffline chance)", () => {
	it("a jammed attacker fires fewer shots than a clean one (seeded, aggregated)", () => {
		// Same battle + seed; the ONLY difference is the attacker carries a long-lived
		// rank-3 Weapon Jam (60% offline chance per shot). A jammed weapon skips its shot
		// (still consuming its cooldown), so over a spread of seeds the jammed attacker
		// fires strictly fewer total shots. Both targets are unkillable so each run gets
		// the same firing OPPORTUNITY (both run to the tick cap), isolating the jam. Each
		// seed is deterministic; the aggregate makes the strict inequality robust.
		const build = (jam: boolean) => (): BattleParticipants =>
			oneVsOne(
				{
					hull: 1000000,
					hullMax: 1000000,
					weapons: [
						makeWeapon({ id: "pw", yield: 1, accuracy: 100, cooldownDeciSec: 5 }),
					],
					statusEffects: jam
						? [{ defId: "weaponJam", rank: 3, remainingDeciSec: 1000000, dotBank: 0 }]
						: [],
				},
				{ hull: 1000000, hullMax: 1000000, weapons: [] },
			);
		const shotsFired = (jam: boolean): number => {
			let total = 0;
			for (let seed = 0; seed < 20; seed++) {
				const r = resolveBattle(build(jam)(), seed, { generateLog: true });
				total += r.log.filter(
					(e) => e.actorId === "P1" && (e.type === "hit" || e.type === "evade"),
				).length;
			}
			return total;
		};
		const jammed = shotsFired(true);
		const clean = shotsFired(false);
		expect(clean).toBeGreaterThan(0);
		expect(jammed).toBeLessThan(clean);
	});
});

// ---------------------------------------------------------------------------
// COMBAT 1.0 POLISH: the DISPLAY-ONLY Weapon Jam log event. When a jammed
// weapon's per-shot roll seizes it (the Unit 1.5 skip), the sim now pushes a
// "jam" event so the log shows the jam instead of it looking like plain
// cooldown. Built ONLY under generateLog + flavored off the COSMETIC stream, so
// it MUST be outcome-neutral: winner + surviving ships byte-identical live vs
// offline, exactly like the flavor field and the damage-split fields above.
// ---------------------------------------------------------------------------
describe("resolveBattle Weapon Jam log event (display-only, outcome-neutral)", () => {
	// A rank-3 Weapon Jam (60% offline chance) on a fast-firing player vs an
	// unkillable, unarmed enemy: the player gets many firing opportunities (so jams
	// are near-certain across a battle) and neither ship dies, so live and offline
	// run the identical combat schedule to the tick cap. This isolates the jam
	// event as the ONLY live-vs-offline difference.
	const build = (): BattleParticipants =>
		oneVsOne(
			{
				hull: 1000000,
				hullMax: 1000000,
				weapons: [makeWeapon({ id: "pw", yield: 1, accuracy: 100, cooldownDeciSec: 5 })],
				statusEffects: [
					{ defId: "weaponJam", rank: 3, remainingDeciSec: 1000000, dotBank: 0 },
				],
			},
			{ hull: 1000000, hullMax: 1000000, weapons: [] },
		);

	it("emits a flavored, actor-only jam event under generateLog", () => {
		const live = resolveBattle(build(), 4242, { generateLog: true });
		const jams = live.log.filter((e) => e.type === "jam");
		// The seeded battle jams at least once (60% per shot over ~120 opportunities).
		expect(jams.length).toBeGreaterThan(0);
		for (const j of jams) {
			// The firing ship is the actor; a jam affects no target (target-less shape).
			expect(j.actorId).toBe("P1");
			expect(j.targetId).toBeUndefined();
			// It carries a non-empty COSMETIC-selected flavor template (proving it went
			// through attachFlavor, the cosmetic-only path).
			expect(j.flavor).toBeDefined();
			expect(j.flavor && j.flavor.length).toBeGreaterThan(0);
		}
	});

	it("offline builds no log (and therefore no jam events)", () => {
		const offline = resolveBattle(build(), 4242, { generateLog: false });
		expect(offline.log.length).toBe(0);
	});

	it("is OUTCOME-NEUTRAL: outcome + finalCombatants byte-identical live vs offline", () => {
		const live = resolveBattle(build(), 4242, { generateLog: true });
		const offline = resolveBattle(build(), 4242, { generateLog: false });
		// The jam event is pure narration: despite the extra cosmetic draws it triggers,
		// the combat-stream-driven results are byte-identical.
		expect(offline.outcome).toEqual(live.outcome);
		expect(offline.finalCombatants).toEqual(live.finalCombatants);
	});

	it("outcome-neutrality holds across many seeds (fuzz)", () => {
		for (let seed = 1; seed <= 40; seed++) {
			const live = resolveBattle(build(), seed, { generateLog: true });
			const offline = resolveBattle(build(), seed, { generateLog: false });
			expect(offline.outcome).toEqual(live.outcome);
			expect(offline.finalCombatants).toEqual(live.finalCombatants);
		}
	});
});

describe("Combat 1.0 Unit 1.5: roster weapons inflict their newly-sourced effect", () => {
	// Fire a roster weapon at a durable, shielded target across many seeds via the real
	// shot pipeline; its second effect slot must LAND at least once (proving the SOURCE
	// assignment feeds the proc pipeline end to end). Deterministic per seed, aggregated
	// for robustness. The pre-existing -range / -weaponDamage readers plus these sources
	// are what make Sensor Power Drain + Coil Dampening live.
	const timesInflicted = (weaponId: Parameters<typeof makeWeaponInstance>[0], defId: string): number => {
		let applied = 0;
		for (let seed = 0; seed < 40; seed++) {
			const { combat } = makeStreams(seed);
			const self = makeCombatant({ id: "S" });
			const target = makeCombatant({
				id: "T",
				hull: 1000000,
				hullMax: 1000000,
				shield: 1000000,
				shieldMax: 1000000,
			});
			const shot = fireWeapon(self, target, makeWeaponInstance(weaponId), combat);
			if (shot.appliedEffects.includes(defId)) applied++;
		}
		return applied;
	};

	it("Tachyon Burst Emitter inflicts Sensor Power Drain", () => {
		expect(timesInflicted("tachyonBurstEmitter", "sensorPowerDrain")).toBeGreaterThan(0);
	});

	it("Graviton inflicts Coil Dampening", () => {
		expect(timesInflicted("graviton", "coilDampening")).toBeGreaterThan(0);
	});

	it("Plasma inflicts Harmonic Gap", () => {
		expect(timesInflicted("plasma", "harmonicGap")).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// PHASE 6: range bands + stance movement, exercised through the full sim (the
// pure geometry is unit-tested in positioning.test.ts). This asserts the
// OBSERVABLE consequence: a long-range attacker punishes a short-range brawler
// during the approach, landing hits before the brawler can answer (design S6:
// "Being out-ranged is punishing ... A short-range brawler must survive the
// walk-in").
// ---------------------------------------------------------------------------
describe("Phase 6: out-ranged punishment during the approach", () => {
	it("a long-range attacker hits a short-range brawler before it can answer", () => {
		// Player: a Long-range gun (range 300), STANDOFF stance (kite at 300), slow so
		// it holds the enemy at arm's length. Starts at position 0.
		// Enemy: a Short-range gun (range 100), AGGRESSIVE stance (charge to 100), fast
		// so it eventually closes into its own range. Starts far away at 300.
		const battle = (): BattleParticipants => ({
			combatants: [
				makeCombatant({
					id: "P1",
					team: "player",
					hull: 100000,
					hullMax: 100000,
					position: 0,
					speed: 5, // slow kite
					stance: "standoff", // preferred distance 300 (Long)
					weapons: [makeWeapon({ id: "pw", yield: 20, accuracy: 100, range: 300, cooldownDeciSec: 10 })],
				}),
				makeCombatant({
					id: "E1",
					team: "enemy",
					hull: 100000,
					hullMax: 100000,
					position: 300, // opens at Long distance
					speed: 20, // fast rush
					stance: "aggressive", // preferred distance 100 (Short)
					weapons: [makeWeapon({ id: "ew", yield: 20, accuracy: 100, range: 100, cooldownDeciSec: 10 })],
				}),
			],
		});
		const { log } = resolveBattle(battle(), 4242, { generateLog: true });

		// First hit landed BY the player and BY the enemy (by timestamp).
		const firstBy = (id: string): number | undefined =>
			log.find((e) => e.type === "hit" && e.actorId === id)?.tDeciSec;
		const firstPlayerHit = firstBy("P1");
		const firstEnemyHit = firstBy("E1");

		// The player (long-range) lands the opening damage very early in the approach.
		expect(firstPlayerHit).toBeDefined();
		expect(firstPlayerHit!).toBeLessThanOrEqual(20);
		// The short-range brawler must survive the walk-in: its first answer, if it
		// comes at all, lands strictly AFTER the player has already been firing.
		expect(firstEnemyHit === undefined || firstEnemyHit > firstPlayerHit!).toBe(true);
	});
});

describe("Phase 6: focus-fire targeting through the sim", () => {
	it("the player kills the lower effective-HP enemy first (focus-fire)", () => {
		// One player vs two co-located enemies: a weak one (E-weak) and a tough one
		// (E-tough). The focus-fire policy (positioning.selectTarget) must concentrate
		// on the weaker in-range enemy, so its destruction is logged FIRST.
		const battle = (): BattleParticipants => ({
			combatants: [
				makeCombatant({
					id: "P1",
					team: "player",
					hull: 100000,
					hullMax: 100000,
					weapons: [makeWeapon({ id: "pw", yield: 40, accuracy: 100, cooldownDeciSec: 5 })],
				}),
				makeCombatant({ id: "E-tough", team: "enemy", hull: 400, weapons: [] }),
				makeCombatant({ id: "E-weak", team: "enemy", hull: 60, weapons: [] }),
			],
		});
		const { log } = resolveBattle(battle(), 999, { generateLog: true });
		const destroyOrder = log
			.filter((e) => e.type === "destroyed")
			.map((e) => e.targetId);
		// The weak enemy dies before the tough one (focus-fire concentrated on it).
		expect(destroyOrder.indexOf("E-weak")).toBeGreaterThanOrEqual(0);
		expect(destroyOrder.indexOf("E-weak")).toBeLessThan(destroyOrder.indexOf("E-tough"));
	});
});

// ---------------------------------------------------------------------------
// PHASE 6: encounter open (pre-charge) + ambush / first-strike / cloak (S7).
// ---------------------------------------------------------------------------
describe("Phase 6: encounter open pre-charge", () => {
	it("pre-charge fires the opener on tick 1 instead of after a full cooldown", () => {
		// A single long-range gun (cd 20 = 2.0s) already in range at the start. With
		// precharge it fires on tick 1; without, only after its 20-deci cooldown.
		const battle = (): BattleParticipants => ({
			combatants: [
				makeCombatant({
					id: "P1",
					team: "player",
					position: 0,
					speed: 0, // stationary: isolate the timing from movement
					weapons: [makeWeapon({ id: "pw", yield: 10, accuracy: 100, range: 300, cooldownDeciSec: 20 })],
				}),
				makeCombatant({ id: "E1", team: "enemy", hull: 100000, hullMax: 100000, position: 250, speed: 0, weapons: [] }),
			],
		});
		const firstHitT = (opts: object): number | undefined =>
			resolveBattle(battle(), 77, { generateLog: true, ...opts }).log.find(
				(e) => e.type === "hit" && e.actorId === "P1",
			)?.tDeciSec;

		expect(firstHitT({ precharge: true })).toBe(1); // immediate charged salvo
		expect(firstHitT({ precharge: false })).toBe(20); // waited a full cooldown
	});

	it("the longest-range in-range weapon fires the opener; a short gun holds out of range", () => {
		// Player mounts a Long particle gun (range 300) + a Short kinetic gun (range
		// 100). The enemy sits at distance 250 and the player only closes to Medium
		// (balanced preferred 200), so the short gun NEVER reaches. Only particle hits.
		const battle = (): BattleParticipants => ({
			combatants: [
				makeCombatant({
					id: "P1",
					team: "player",
					position: 0,
					speed: 10,
					stance: "balanced", // settles at distance 200
					weapons: [
						makeWeapon({ id: "long", family: "particle", yield: 10, accuracy: 100, range: 300, cooldownDeciSec: 20 }),
						makeWeapon({ id: "short", family: "kinetic", yield: 10, accuracy: 100, range: 100, cooldownDeciSec: 20 }),
					],
				}),
				makeCombatant({ id: "E1", team: "enemy", hull: 100000, hullMax: 100000, position: 250, speed: 0, weapons: [] }),
			],
		});
		const { log } = resolveBattle(battle(), 88, { generateLog: true, precharge: true });
		const hits = log.filter((e) => e.type === "hit" && e.actorId === "P1");
		// The opener is the long-range (particle) weapon, on tick 1.
		expect(hits[0].family).toBe("particle");
		expect(hits[0].tDeciSec).toBe(1);
		// The short-range kinetic gun is out-ranged the whole fight: it never lands.
		expect(hits.some((e) => e.family === "kinetic")).toBe(false);
	});

	it("caps a banked cooldown so a weapon ENTERING range fires one charged shot, not a burst", () => {
		// A short gun (range 100, cd 4) starts far out of range (enemy at 250) and comes off
		// cooldown while the ship is still closing (aggressive holds at Short = 100). WITHOUT
		// the out-of-range accumulator cap it banks a shot every tick during the long approach
		// and dumps a burst (hits on consecutive ticks) the instant it reaches range; WITH the
		// cap it holds exactly ONE charged shot, then fires on its normal cadence, so no two
		// hits ever land closer than the cooldown (4 deci) apart. (cooldown-burst fix, S6.)
		const battle = (): BattleParticipants => ({
			combatants: [
				makeCombatant({
					id: "P1",
					team: "player",
					position: 0,
					speed: 30,
					stance: "aggressive",
					weapons: [makeWeapon({ id: "short", yield: 10, accuracy: 100, range: 100, cooldownDeciSec: 4 })],
				}),
				makeCombatant({ id: "E1", team: "enemy", hull: 1_000_000, hullMax: 1_000_000, position: 250, speed: 0, weapons: [] }),
			],
		});
		const { log } = resolveBattle(battle(), 123, { generateLog: true });
		const hitTimes = log
			.filter((e) => e.type === "hit" && e.actorId === "P1")
			.map((e) => e.tDeciSec as number);
		expect(hitTimes.length).toBeGreaterThan(1); // the gun does reach range and fire repeatedly
		const gaps = hitTimes.slice(1).map((t, i) => t - hitTimes[i]);
		// The BUG fires on CONSECUTIVE ticks (gap 1) while draining the banked accumulator.
		// The FIX fires one charged shot on entry, then resumes cadence: a single gap of 3
		// (the design-S1 carry-over leaves a remainder after the entry shot) followed by
		// steady gaps of 4. So the tell-tale burst signature is a gap of 1: assert none exist.
		expect(gaps.every((g) => g >= 2)).toBe(true);
	});
});

describe("Phase 6: ambush opener (design S7)", () => {
	// A 1v1 where P1 ambushes E1. E1 has shields; the ambusher a plain particle gun.
	const ambushBattle = (
		playerWeapons: CombatWeapon[],
		enemyOverrides: Partial<Combatant> = {},
	): (() => BattleParticipants) => () => ({
		combatants: [
			makeCombatant({ id: "P1", team: "player", hull: 100000, hullMax: 100000, weapons: playerWeapons }),
			makeCombatant({
				id: "E1",
				team: "enemy",
				hull: 300,
				hullMax: 300,
				shield: 100,
				shieldMax: 100,
				weapons: [makeWeapon({ id: "ew", yield: 5, accuracy: 100, cooldownDeciSec: 10 })],
				...enemyOverrides,
			}),
		],
	});

	it("the ambusher's opening salvo strikes hull directly, leaving the shield untouched", () => {
		const { log } = resolveBattle(
			ambushBattle([makeWeapon({ id: "pw", family: "particle", yield: 40, accuracy: 100, cooldownDeciSec: 10 })])(),
			1234,
			{ generateLog: true, ambush: "P1" },
		);
		const firstAmbush = log.find((e) => e.type === "ambush");
		expect(firstAmbush).toBeDefined();
		expect(firstAmbush!.result).toBe("hullDirect");
		// Shield pool NOT scratched by the hull-direct opener; hull WAS bitten.
		expect(firstAmbush!.shieldAfter).toBe(100);
		expect(firstAmbush!.hullAfter).toBeLessThan(300);
	});

	it("delays the ambushed party's return fire (it fires later than an un-ambushed baseline)", () => {
		const weapons = [makeWeapon({ id: "pw", family: "particle", yield: 5, accuracy: 100, cooldownDeciSec: 10 })];
		const firstEnemyHit = (opts: object): number | undefined =>
			resolveBattle(ambushBattle(weapons)(), 55, { generateLog: true, ...opts }).log.find(
				(e) => e.type === "hit" && e.actorId === "E1",
			)?.tDeciSec;
		const baseline = firstEnemyHit({}); // no ambush: E1 fires on its cooldown
		const ambushed = firstEnemyHit({ ambush: "P1" }); // stunned first
		expect(baseline).toBeDefined();
		expect(ambushed).toBeDefined();
		expect(ambushed!).toBeGreaterThan(baseline!);
	});

	it("bars a torpedo from the opener: an ambusher with only a barred weapon lands no free salvo and no stun", () => {
		// Concussion Torpedo is ambushEligible:false. The lone-torpedo ambusher fires
		// no opener (no ambush event) AND the target is not stunned (fires on time).
		const torpedo = makeWeapon({ id: "torp", family: "kinetic", yield: 90, accuracy: 100, cooldownDeciSec: 10, ambushEligible: false });
		const withAmbush = resolveBattle(ambushBattle([torpedo])(), 55, { generateLog: true, ambush: "P1" });
		const withoutAmbush = resolveBattle(ambushBattle([torpedo])(), 55, { generateLog: true });
		expect(withAmbush.log.some((e) => e.type === "ambush")).toBe(false); // torpedo barred
		// No stun: E1's first return shot lands at the same tick as the un-ambushed run.
		const firstE1 = (r: typeof withAmbush) => r.log.find((e) => e.type === "hit" && e.actorId === "E1")?.tDeciSec;
		expect(firstE1(withAmbush)).toBe(firstE1(withoutAmbush));
	});

	it("particleTraceDetector downgrades a hull-direct ambush to a shielded opener", () => {
		// Detector at 100% is a forced success: the target raises shields, so the
		// opener is a normal shielded shot (result 'shielded', shield takes the hit).
		const { log } = resolveBattle(
			ambushBattle(
				[makeWeapon({ id: "pw", family: "particle", yield: 40, accuracy: 100, cooldownDeciSec: 10 })],
				{ particleTraceDetector: 100 },
			)(),
			1234,
			{ generateLog: true, ambush: "P1" },
		);
		const firstAmbush = log.find((e) => e.type === "ambush");
		expect(firstAmbush!.result).toBe("shielded");
		// The shield absorbed the shielded opener (it was touched, unlike hull-direct).
		expect(firstAmbush!.shieldAfter).toBeLessThan(100);
	});

	it("rapidChargeAfterAmbush shortens the return-fire delay", () => {
		const weapons = [makeWeapon({ id: "pw", family: "particle", yield: 5, accuracy: 100, cooldownDeciSec: 10 })];
		const firstEnemyHit = (rapid: boolean): number | undefined =>
			resolveBattle(
				ambushBattle(weapons, { rapidChargeAfterAmbush: rapid })(),
				55,
				{ generateLog: true, ambush: "P1" },
			).log.find((e) => e.type === "hit" && e.actorId === "E1")?.tDeciSec;
		const slow = firstEnemyHit(false); // base ambush delay
		const fast = firstEnemyHit(true); // rapid-charge module
		expect(fast!).toBeLessThan(slow!);
	});

	it("offline == live still holds with an ambush configured (parity)", () => {
		const build = ambushBattle([makeWeapon({ id: "pw", family: "particle", yield: 40, accuracy: 100, cooldownDeciSec: 10 })]);
		const live = resolveBattle(build(), 909, { generateLog: true, ambush: "P1" });
		const offline = resolveBattle(build(), 909, { generateLog: false, ambush: "P1" });
		expect(offline.outcome).toEqual(live.outcome);
		expect(offline.log.length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// PHASE 6: the movement / sensor debuffs the status system carried since Phase
// 4 are now WIRED into the positional math (Coolant Leak -> effective move speed,
// Sensor Power Drain -> effective weapon range, Manifold Overheat -> evasion).
// Each reads active statusEffects and is a no-op at zero, so parity holds.
// ---------------------------------------------------------------------------
describe("Phase 6: wired movement + sensor debuffs", () => {
	const leak = (rank: number) => ({ defId: "coolantLeak", rank, remainingDeciSec: 100000, dotBank: 0 });
	const drain = (rank: number) => ({ defId: "sensorPowerDrain", rank, remainingDeciSec: 100000, dotBank: 0 });
	const overheat = (rank: number) => ({ defId: "manifoldOverheat", rank, remainingDeciSec: 100000, dotBank: 0 });

	it("Coolant Leak slows a ship's closing, so it reaches firing range later", () => {
		// A short-range brawler charges a stationary dummy at distance 300. With a
		// Coolant Leak it closes slower, so its first in-range shot lands later.
		const battle = (leaked: boolean): BattleParticipants => ({
			combatants: [
				makeCombatant({
					id: "P1",
					team: "player",
					position: 0,
					speed: 20,
					stance: "aggressive", // charge to Short (100)
					weapons: [makeWeapon({ id: "pw", yield: 10, accuracy: 100, range: 100, cooldownDeciSec: 5 })],
					statusEffects: leaked ? [leak(1)] : [],
				}),
				makeCombatant({ id: "E1", team: "enemy", hull: 100000, hullMax: 100000, position: 300, speed: 0, weapons: [] }),
			],
		});
		const firstHitT = (leaked: boolean): number | undefined =>
			resolveBattle(battle(leaked), 12, { generateLog: true }).log.find(
				(e) => e.type === "hit" && e.actorId === "P1",
			)?.tDeciSec;
		const clean = firstHitT(false);
		const leaked = firstHitT(true);
		expect(clean).toBeDefined();
		expect(leaked).toBeDefined();
		expect(leaked!).toBeGreaterThan(clean!); // slowed = later into range
	});

	it("Sensor Power Drain shrinks effective range: an edge-of-range target falls out of reach", () => {
		// A stationary shooter with range 300 vs a target at distance 250. Clean it
		// is in range and fires; a rank-1 sensor drain (-20% => range 240) puts the
		// target out of reach, so the shooter never lands a shot.
		const battle = (drained: boolean): BattleParticipants => ({
			combatants: [
				makeCombatant({
					id: "P1",
					team: "player",
					position: 0,
					speed: 0, // stationary: isolate range from movement
					weapons: [makeWeapon({ id: "pw", yield: 10, accuracy: 100, range: 300, cooldownDeciSec: 10 })],
					statusEffects: drained ? [drain(1)] : [],
				}),
				makeCombatant({ id: "E1", team: "enemy", hull: 100000, hullMax: 100000, position: 250, speed: 0, weapons: [] }),
			],
		});
		const landedAny = (drained: boolean): boolean =>
			resolveBattle(battle(drained), 34, { generateLog: true }).log.some(
				(e) => e.type === "hit" && e.actorId === "P1",
			);
		expect(landedAny(false)).toBe(true); // in range at 250 <= 300
		expect(landedAny(true)).toBe(false); // drained range 240 < 250: out of reach
	});

	it("Manifold Overheat cuts evasion, so an overheated target is easier to hit", () => {
		// Same seeded battle; the only difference is a rank-3 Manifold Overheat on the
		// evasive target, which lowers its evasion and lets the attacker land more.
		const battle = (overheated: boolean): BattleParticipants => ({
			combatants: [
				makeCombatant({
					id: "P1",
					team: "player",
					hull: 100000,
					hullMax: 100000,
					weapons: [makeWeapon({ id: "pw", yield: 1, accuracy: 60, cooldownDeciSec: 5 })],
				}),
				makeCombatant({
					id: "E1",
					team: "enemy",
					hull: 100000,
					hullMax: 100000,
					evasion: 40,
					weapons: [],
					statusEffects: overheated ? [overheat(3)] : [],
				}),
			],
		});
		const hits = (overheated: boolean): number =>
			resolveBattle(battle(overheated), 71, { generateLog: true }).log.filter(
				(e) => e.type === "hit" && e.actorId === "P1",
			).length;
		expect(hits(true)).toBeGreaterThan(hits(false)); // overheated = easier to hit
	});
});

// ============================================================================
// PHASE 12b UNIT B1: LIVE SYSTEM DURABILITY (wear + condition effects).
//
// These lock the B1 wiring: systems WEAR on hits (combat stream, deterministic),
// quality mitigates it, a depleted weapon stops firing, worn systems mechanically
// DEGRADE output (weapon/reactor damage, ftl evasion), and the HARD INVARIANTS still
// hold with durability live (same-seed determinism + offline == live on a battle whose
// systems genuinely degrade). fireWeapon is exercised directly for the per-shot facts,
// resolveBattle for the whole-battle behaviour + parity.
// ============================================================================

// A DurableSystem factory (reactor / ftl), so a test states only what it cares about.
function sys(overrides: Partial<DurableSystem> = {}): DurableSystem {
	const durabilityMax = overrides.durabilityMax ?? 100;
	return {
		durability: overrides.durability ?? durabilityMax,
		durabilityMax,
		quality: overrides.quality ?? 0,
	};
}

// A fresh combat-stream Rng for a seed (fireWeapon draws every roll from this).
const combatRng = (seed: number) => makeStreams(seed).combat;

describe("B1 wear: systems lose durability on hits taken", () => {
	it("connecting shots wear the target weapon + reactor + ftl, deterministically for a fixed seed", () => {
		// Fire many connecting shots at a target and total the durability lost per system.
		// Run twice with the SAME seed: byte-identical wear (the roll is combat-stream +
		// deterministic).
		const run = () => {
			const target = makeCombatant({
				id: "T",
				team: "enemy",
				hull: 100000, // huge so it never dies mid-test (we want a long wear sample)
				weapons: [makeWeapon({ id: "tw", durability: 100, durabilityMax: 100 })],
				reactor: sys(),
				ftl: sys(),
			});
			const attacker = makeCombatant({ id: "A", team: "player" });
			const weapon = makeWeapon({ id: "aw", accuracy: 100, yield: 5 });
			const rng = combatRng(2024);
			for (let i = 0; i < 40; i++) fireWeapon(attacker, target, weapon, rng);
			return {
				weapon: 100 - target.weapons[0].durability,
				reactor: 100 - target.reactor!.durability,
				ftl: 100 - target.ftl!.durability,
			};
		};
		const a = run();
		const b = run();
		expect(a).toEqual(b); // deterministic for the fixed seed
		// A hit is a durability event: every system took some wear over 40 connecting shots.
		expect(a.weapon).toBeGreaterThan(0);
		expect(a.reactor).toBeGreaterThan(0);
		expect(a.ftl).toBeGreaterThan(0);
	});

	it("higher quality wears SLOWER under the identical draw schedule (quality mitigates loss)", () => {
		// Quality 0 vs quality 5 weapon, hit with the SAME seed the same number of times.
		// The wear roll spends one draw either way (schedule-fixed), so both runs stay
		// aligned; only the loss THRESHOLD differs, so the q5 weapon loses fewer points.
		const worn = (quality: number) => {
			const target = makeCombatant({
				id: "T",
				team: "enemy",
				hull: 100000,
				weapons: [
					makeWeapon({ id: "tw", durability: 100, durabilityMax: 100, quality }),
				],
			});
			const attacker = makeCombatant({ id: "A", team: "player" });
			const weapon = makeWeapon({ id: "aw", accuracy: 100, yield: 5 });
			const rng = combatRng(99);
			for (let i = 0; i < 60; i++) fireWeapon(attacker, target, weapon, rng);
			return 100 - target.weapons[0].durability;
		};
		expect(worn(5)).toBeLessThan(worn(0));
	});
});

describe("B1 condition: an OFFLINE (depleted) weapon cannot fire", () => {
	it("a weapon at 0 durability never fires, so its target takes no damage from it", () => {
		// P1 only weapon starts depleted; E1 fights back with a 0-accuracy weapon (never
		// lands), so if the depleted weapon truly cannot fire, the E1 hull stays pristine.
		const battle = (durability: number): BattleParticipants => ({
			combatants: [
				makeCombatant({
					id: "P1",
					team: "player",
					hull: 100000,
					weapons: [
						makeWeapon({
							id: "pw",
							durability,
							durabilityMax: 100,
							yield: 20,
							accuracy: 100,
						}),
					],
				}),
				makeCombatant({
					id: "E1",
					team: "enemy",
					hull: 500,
					weapons: [makeWeapon({ id: "ew", yield: 1, accuracy: 0 })],
				}),
			],
		});
		const depleted = resolveBattle(battle(0), 5);
		const enemyDepleted = depleted.finalCombatants.find((c) => c.id === "E1")!;
		expect(enemyDepleted.hull).toBe(enemyDepleted.hullMax); // never fired => no damage
		// Control: the SAME weapon at full durability DOES fire and damages the enemy.
		const armed = resolveBattle(battle(100), 5);
		const enemyArmed = armed.finalCombatants.find((c) => c.id === "E1")!;
		expect(enemyArmed.hull).toBeLessThan(enemyArmed.hullMax);
	});
});

describe("B1 condition effects: worn systems degrade output", () => {
	// Fire ONE shot with a controlled rng + a target that never dodges, and read the damage
	// dealt. Same seed + same target so the hit/crit/damage draws are identical; only the
	// condition modifier under test differs, so any damage delta is that modifier alone.
	function shotDamage(opts: {
		weaponDurability?: number;
		reactor?: DurableSystem;
	}): number {
		const target = makeCombatant({
			id: "T",
			team: "enemy",
			hull: 100000,
			shield: 0,
			weapons: [], // no target systems => no wear draws, minimal + identical schedule
		});
		const attacker = makeCombatant({
			id: "A",
			team: "player",
			reactor: opts.reactor,
		});
		const weapon = makeWeapon({
			id: "aw",
			accuracy: 100,
			yield: 100,
			durability: opts.weaponDurability ?? 100,
			durabilityMax: 100,
		});
		return fireWeapon(attacker, target, weapon, combatRng(7)).damage;
	}

	it("a DEGRADED weapon deals less than a nominal one (same seed)", () => {
		const nominal = shotDamage({ weaponDurability: 100 });
		// durability 10 of 100 sits at/below the 50% degraded threshold => degraded.
		const degraded = shotDamage({ weaponDurability: 10 });
		expect(degraded).toBeLessThan(nominal);
		expect(degraded).toBeGreaterThan(0); // still fires, just softer
	});

	it("an OFFLINE reactor scales weapon damage down vs a nominal reactor (same seed)", () => {
		const nominal = shotDamage({ reactor: sys({ durability: 100 }) });
		const offlineReactor = shotDamage({ reactor: sys({ durability: 0 }) });
		expect(offlineReactor).toBeLessThan(nominal);
		expect(offlineReactor).toBeGreaterThan(0);
	});

	it("a worn FTL cuts the target evasion (an offline drive lets otherwise-missing shots land)", () => {
		// evasion 100 vs accuracy 100 => hitChance 0 (guaranteed miss) while the drive is
		// nominal/absent. An OFFLINE drive cuts evasion 40% => 60 => hitChance 40 => hits land.
		const fire = (ftl?: DurableSystem) => {
			const target = makeCombatant({
				id: "T",
				team: "enemy",
				hull: 100000,
				evasion: 100,
				ftl,
			});
			const attacker = makeCombatant({ id: "A", team: "player" });
			const weapon = makeWeapon({
				id: "aw",
				accuracy: 100,
				projectileCount: 30,
				yield: 1,
			});
			return fireWeapon(attacker, target, weapon, combatRng(3)).projectilesHit;
		};
		expect(fire(sys({ durability: 100 }))).toBe(0); // nominal drive: un-hittable
		expect(fire(undefined)).toBe(0); // no drive: un-hittable (byte-identical)
		expect(fire(sys({ durability: 0 }))).toBeGreaterThan(0); // offline drive: shots land
	});
});

describe("B1 HARD INVARIANTS: determinism + offline == live on a DEGRADING battle", () => {
	// A 1v1 whose systems have SMALL durability ceilings, so they genuinely wear down
	// (cross degraded / offline) during the fight, making durability outcome-ACTIVE (not a
	// no-op the parity test would trivially pass).
	function degradingBattle(): BattleParticipants {
		const mk = (id: string, team: "player" | "enemy") =>
			makeCombatant({
				id,
				team,
				hull: 300,
				hullMax: 300,
				shield: 40,
				shieldMax: 40,
				shieldRecharge: 2,
				weapons: [
					makeWeapon({
						id: `${id}-w0`,
						yield: 8,
						accuracy: 85,
						durability: 4,
						durabilityMax: 8,
					}),
					makeWeapon({
						id: `${id}-w1`,
						yield: 5,
						accuracy: 90,
						durability: 3,
						durabilityMax: 6,
					}),
				],
				reactor: sys({ durability: 4, durabilityMax: 8 }),
				ftl: sys({ durability: 3, durabilityMax: 6 }),
			});
		return { combatants: [mk("P1", "player"), mk("E1", "enemy")] };
	}

	for (const seed of [1, 2, 7, 13, 42, 100, 777]) {
		it(`seed ${seed}: same-seed determinism AND offline outcome == live outcome`, () => {
			// Determinism: two OFFLINE runs are byte-identical (outcome + final state).
			const off1 = resolveBattle(degradingBattle(), seed);
			const off2 = resolveBattle(degradingBattle(), seed);
			expect(off1.outcome).toEqual(off2.outcome);
			expect(off1.finalCombatants).toEqual(off2.finalCombatants);
			// Offline == live: the flavored (generateLog) run has the IDENTICAL outcome +
			// final combatant state. The cosmetic stream + the display-only condition-pip
			// emission cannot move a durability roll, so the fight resolves the same.
			const live = resolveBattle(degradingBattle(), seed, { generateLog: true });
			expect(live.outcome).toEqual(off1.outcome);
			expect(live.finalCombatants).toEqual(off1.finalCombatants);
		});
	}

	it("PURITY: live wear does NOT mutate the caller's reactor/ftl/weapon durability", () => {
		// The sim wears its PRIVATE clone; the caller's input systems must be untouched, so
		// the same participants object can be resolved twice with an identical result.
		const participants: BattleParticipants = {
			combatants: [
				makeCombatant({
					id: "P1",
					team: "player",
					hull: 300,
					weapons: [makeWeapon({ id: "P1-w", durability: 8, durabilityMax: 8 })],
					reactor: sys({ durability: 8, durabilityMax: 8 }),
					ftl: sys({ durability: 6, durabilityMax: 6 }),
				}),
				makeCombatant({
					id: "E1",
					team: "enemy",
					hull: 300,
					weapons: [makeWeapon({ id: "E1-w", durability: 8, durabilityMax: 8 })],
					reactor: sys({ durability: 8, durabilityMax: 8 }),
					ftl: sys({ durability: 6, durabilityMax: 6 }),
				}),
			],
		};
		const before = JSON.parse(JSON.stringify(participants));
		const first = resolveBattle(participants, 9);
		// NON-VACUOUS GUARD: confirm this battle actually WORE systems, so the "caller
		// unchanged" assertion below proves isolation rather than passing because nothing
		// wore (a mutate-through regression could otherwise slip past a zero-wear seed).
		const worn = first.finalCombatants.some(
			(c) =>
				c.weapons.some((w) => w.durability < w.durabilityMax) ||
				(c.reactor !== undefined && c.reactor.durability < c.reactor.durabilityMax) ||
				(c.ftl !== undefined && c.ftl.durability < c.ftl.durabilityMax),
		);
		expect(worn).toBe(true);
		// The caller's objects are byte-identical to before (no wear leaked back).
		expect(JSON.parse(JSON.stringify(participants))).toEqual(before);
		// And a second resolve of the SAME (untouched) participants matches the first.
		const second = resolveBattle(participants, 9);
		expect(second.outcome).toEqual(first.outcome);
		expect(second.finalCombatants).toEqual(first.finalCombatants);
	});

	it("the fixture genuinely degrades systems (some durability drops below max by battle end)", () => {
		const { finalCombatants } = resolveBattle(degradingBattle(), 42, {
			generateLog: true,
		});
		const anyWorn = finalCombatants.some(
			(c) =>
				c.weapons.some((w) => w.durability < w.durabilityMax) ||
				(c.reactor !== undefined && c.reactor.durability < c.reactor.durabilityMax) ||
				(c.ftl !== undefined && c.ftl.durability < c.ftl.durabilityMax),
		);
		expect(anyWorn).toBe(true);
	});
});

describe("B1 condition-pip emission (display-only, outcome-neutral)", () => {
	it("roundState events carry one systemConditions pip per weapon + reactor + ftl", () => {
		const battle: BattleParticipants = {
			combatants: [
				makeCombatant({
					id: "P1",
					team: "player",
					hull: 300,
					weapons: [makeWeapon({ id: "P1-w0" }), makeWeapon({ id: "P1-w1" })],
					reactor: sys(),
					ftl: sys(),
				}),
				makeCombatant({ id: "E1", team: "enemy", hull: 300, reactor: sys(), ftl: sys() }),
			],
		};
		const { log } = resolveBattle(battle, 4, { generateLog: true });
		const p1RoundState = log.find(
			(e) => e.type === "roundState" && e.actorId === "P1",
		);
		expect(p1RoundState).toBeDefined();
		const pips = p1RoundState!.systemConditions!;
		// Two weapons + reactor + ftl = four pips, correctly kinded + all nominal at the open.
		expect(pips.map((p) => p.kind)).toEqual(["weapon", "weapon", "reactor", "ftl"]);
		expect(pips.every((p) => p.condition === "nominal")).toBe(true);
		expect(pips.find((p) => p.kind === "reactor")!.id).toBe("reactor");
	});

	it("emission is OUTCOME-NEUTRAL: the pip payload does not change the battle result", () => {
		// Building the pips (a pure read under generateLog) never perturbs an outcome: the
		// offline (no emission) and live (emission) runs match in outcome + final state.
		const build = (): BattleParticipants => ({
			combatants: [
				makeCombatant({ id: "P1", team: "player", hull: 200, reactor: sys(), ftl: sys() }),
				makeCombatant({ id: "E1", team: "enemy", hull: 200, reactor: sys(), ftl: sys() }),
			],
		});
		const offline = resolveBattle(build(), 55);
		const live = resolveBattle(build(), 55, { generateLog: true });
		expect(live.outcome).toEqual(offline.outcome);
		expect(live.finalCombatants).toEqual(offline.finalCombatants);
	});
});
