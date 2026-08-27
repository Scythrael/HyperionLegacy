// ============================================================================
// combat/craftedGearPayoff.test.ts -- Combat 1.0 Unit 1.6 VALIDATION PASS
//
// WHAT THIS PROVES (the whole point of Unit 1.6's "light" debut scope):
// the craft -> install -> gear-driven-combat loop actually PAYS OFF. Units 1.2
// (generateWeapon / generateEquipment mint rolled gear) and 1.4 (shipToCombatant
// folds INSTALLED gear into the sim) are already in the branch; this test is the
// end-to-end proof that a BETTER-crafted set produces a MEASURABLY STRONGER
// combatant AND wins the same fight more often than the Standard-Issue floor.
//
// WHY IT LIVES HERE, NOT IN bridge.test.ts: bridge.test.ts already guards the
// STAT FOLD in isolation (Standard-Issue is byte-identical; a hand-upgraded piece
// reads back bigger pools). This file closes the loop the OTHER end: it mints
// gear through the REAL itemgen path (generateWeapon / generateEquipment, the same
// minters the Fabricator calls) and drives the REAL sim (resolveBattle, via
// engagementForecast), so it is an integration proof, not a unit fold proof.
//
// DETERMINISM (the hard invariant, design S0): every number here is reproducible.
// Gear is minted from a seeded mulberry32 stream (no Math.random); the win-rate
// comparison uses engagementForecast with a FIXED baseSeed, so resolveBattle walks
// the same seed pool for both the Standard-Issue and the crafted player. Same
// inputs => same win counts on every run and every device.
//
// FAIRNESS OF THE COMPARISON: both players are the SAME destroyer hull with the
// SAME loadout SHAPE (autocannon + plasma + one emitter + one plating, in the same
// slots). The ONLY difference is the rolled magnitudes: Standard-Issue is the
// quality-0 / iLevel-1 floor, crafted is a high quality / rarity / iLevel roll.
// So any win-rate gap is attributable to GEAR POWER alone, which is exactly the
// "craft better gear -> better combat" promise being validated.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
	shipToCombatant,
	COMBAT_DEFAULT_LOADOUT,
	type CombatHullType,
} from "./bridge";
import { engagementForecast, battleRating } from "./rating";
import { makeWeaponInstance, type WeaponId } from "./weapons";
import {
	SHIP_TYPES,
	seedCombatStandardIssueForShip,
	// Combat-defense rework: the FIXED SI-gear dials the local SI-spec mirror mints at.
	SI_PLATING_HP,
	SI_EMITTER_CAP,
	SI_EMITTER_RECHARGE,
	type CombatStandardIssueSpec,
	type EquipmentInstance,
} from "../model";
import { generateWeapon, generateEquipment } from "../itemgen";

// The hull under test. The destroyer is the starter's THINNEST-margin combat hull
// (patrol-balance.test.ts: 99% at Standard-Issue vs 100% for the other two), so it
// is the most sensitive probe of a gear delta: if better gear helps ANY hull win a
// tougher fight more often, it helps the striker.
const HULL: CombatHullType = "destroyer";
const SHIP_ID = "ship-1";

// -- Standard-Issue gear (the quality-0 floor), built EXACTLY as the tick.ts caller
// does (full default loadout + the FIXED SI-gear dials). Mirrors bridge.test.ts's local
// helper so this file exercises the real seeder output without importing tick.ts (a
// combat leaf must never import UP into the live loop). Combat-defense rework: the SI
// defensive magnitudes are the hull-independent dials; the hull's innate stats (applied in
// the fold) recompose an SI set to its authored totals, and a crafted emitter is amplified
// by the same innate mult (so crafted defense clears the modest SI floor with real margin).
function combatSpecFor(hull: CombatHullType): CombatStandardIssueSpec {
	return {
		signatureWeapons: [...COMBAT_DEFAULT_LOADOUT[hull].weapons],
		// Unit 2.3a: the hull's default drone-pod roles (destroyer under test has none).
		droneRoles: [...COMBAT_DEFAULT_LOADOUT[hull].droneRoles],
		shieldCapacity: SI_EMITTER_CAP,
		shieldRecharge: SI_EMITTER_RECHARGE,
		hullStrength: SI_PLATING_HP,
	};
}

function standardIssueGear(hull: CombatHullType, shipId: string): EquipmentInstance[] {
	return seedCombatStandardIssueForShip(shipId, combatSpecFor(hull), 1).pieces;
}

// -- A tiny, well-distributed seeded PRNG (test-local; NOT part of itemgen, exactly
// like itemgen.test.ts). itemgen only ever calls the rng passed IN, so seeding it
// here keeps the whole crafted mint reproducible with zero Math.random.
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// A monotonically-increasing id source so every minted piece gets a distinct id
// (the sim's turn-order key must never collide).
function idAllocator(prefix: string): () => string {
	let n = 0;
	return () => `${prefix}-${n++}`;
}

// -- Mint a CRAFTED destroyer set through the REAL itemgen minters, with the SAME
// slot SHAPE as the Standard-Issue set (autocannon + plasma + one emitter + one
// plating) but a high quality / rarity / iLevel roll, so it is strictly the same
// build "shape" and any combat gap is gear POWER alone. All pieces are fitted to
// SHIP_ID, matching what equippedFor() would hand shipToCombatant in live play.
//
// A FIXED, HIGH-quality / high-rarity roll is chosen so the crafted set reliably DOMINATES
// the Standard-Issue floor on EVERY stat; the test asserts the per-stat dominance at runtime
// rather than trusting the constants blindly.
const CRAFTED_QUALITY = 5;
const CRAFTED_RARITY = "radiant" as const;

// TWO iLevels, because the Standard-Issue floor is NOT uniform across the slots:
//
//  - WEAPONS float on a ZERO floor: Standard-Issue weaponYield is 0 (the base WEAPON_DEF
//    carries the real stats), so ANY crafted weaponYield already beats it. A realistic
//    crafted weapon level therefore suffices, and keeping it realistic keeps the DPS-driven
//    Battle Rating sane (a huge weapon-yield roll balloons the rating without adding proof).
const CRAFTED_WEAPON_ILEVEL = 40;
//
//  - SHIELD + PLATING now float on a FLAT, hull-independent Standard-Issue floor. The combat-defense
//    rework moved the hull's own defense into its INNATE stats (innateHullArmor is ADDED to
//    plating.hullStrength; innateShieldCapMult AMPLIFIES emitter.shieldCapacity), so the Standard-Issue
//    gear carries only the fixed dials SI_PLATING_HP = 100 and SI_EMITTER_CAP = 100, the SAME on every
//    hull. A crafted piece therefore beats Standard-Issue iff its RAW hullStrength / shieldCapacity
//    clears 100, and the innate stats add/amplify SI and crafted equally, so the raw comparison is
//    hull-independent. Combat-defense rework Unit 4 re-tuned the crafted defensive implicit (itemgen
//    craftedDefensiveImplicit, replacing the deleted CRAFTED_DEFENSE_IMPLICIT_MULT hack) so even the
//    FIRST crafted tier (iLevel 1, q0, standard) clears 100 with margin (~109 raw), and it scales up
//    from there (the first-tier-above-SI proof lives in itemgen.test.ts; the MID-iLevel out-tank proof
//    lives in the dedicated test below). This end-to-end payoff proof deliberately keeps a HIGH iLevel
//    so the crafted set DOMINATES the floor on every stat with unambiguous margin (its win-rate signal
//    must not sit near the crossover); the exact magnitudes remain the 0.16.0 balance pass's to finalize.
const CRAFTED_DEFENSE_ILEVEL = 260;

// A MID item level for the crafted-upgrade proof: high enough that a q5 crafted defensive set already
// out-tanks the Standard-Issue destroyer (crafted gear is an upgrade, not a downgrade), but far below
// the dominance level above. Under the re-tuned curve a q5 / radiant iLevel-60 emitter + plating each
// roll a raw ~434 (well above the flat 100 SI floor), so once folded through the destroyer's innate
// stats the crafted pools sit comfortably above the Standard-Issue destroyer.
const CRAFTED_DEFENSE_MID_ILEVEL = 60;

// `defenseILevel` is the item level minted for the emitter + plating; it defaults to the high
// dominance level CRAFTED_DEFENSE_ILEVEL (the existing end-to-end payoff callers are unchanged),
// and the Unit 2.5a crossover test passes CRAFTED_DEFENSE_MID_ILEVEL to prove the mid-iLevel upgrade.
// The weapon iLevel is independent (CRAFTED_WEAPON_ILEVEL), so the weapons' rng draws are identical
// regardless of defenseILevel and the emitter/plating still see the same reproducible affix picks.
function craftedGear(shipId: string, defenseILevel: number = CRAFTED_DEFENSE_ILEVEL): EquipmentInstance[] {
	// One shared seeded stream drives the whole mint so the set is reproducible.
	const rng = mulberry32(90210);
	const alloc = idAllocator("crafted");
	const weaponTypes = COMBAT_DEFAULT_LOADOUT[HULL].weapons;

	// Crafted weapons, in the SAME loadout order the Standard-Issue set mints them,
	// so shipToCombatant reconstructs them in the same slot order (by-index alignment).
	const weapons = weaponTypes.map((weaponType: WeaponId) =>
		generateWeapon({
			weaponType,
			blueprintKey: null,
			iLevel: CRAFTED_WEAPON_ILEVEL,
			quality: CRAFTED_QUALITY,
			rarity: CRAFTED_RARITY,
			ascension: "none",
			rng,
			allocateId: alloc,
		}),
	);

	// Crafted shield emitter: the capacity-heavy variety, so its shieldCapacity implicit
	// clears the Standard-Issue floor by a wide margin.
	const emitter = generateEquipment({
		slotType: "shieldEmitters",
		varietyKey: "capacitorBank",
		blueprintKey: null,
		iLevel: defenseILevel,
		quality: CRAFTED_QUALITY,
		rarity: CRAFTED_RARITY,
		ascension: "none",
		rng,
		allocateId: alloc,
	});

	// Crafted hull plating: the hull-heavy variety, so its hullStrength implicit clears
	// the Standard-Issue floor.
	const plating = generateEquipment({
		slotType: "hullPlating",
		varietyKey: "reinforcedPlating",
		blueprintKey: null,
		iLevel: defenseILevel,
		quality: CRAFTED_QUALITY,
		rarity: CRAFTED_RARITY,
		ascension: "none",
		rng,
		allocateId: alloc,
	});

	// Fit every piece to the ship (the live caller passes equippedFor(shipId), whose
	// pieces all carry this fittedToShipId). shipToCombatant reads by slotType, so this
	// mainly documents intent + keeps the array shaped like the real installed set.
	return [...weapons, emitter, plating].map((p) => ({ ...p, fittedToShipId: shipId }));
}

// -- The two players under comparison: the SAME destroyer hull, Standard-Issue vs
// crafted gear. Built once and reused (resolveBattle deep-clones internally, so the
// same objects are safe across every forecast sample).
const stats = SHIP_TYPES[HULL];
const siPlayer = shipToCombatant({
	id: SHIP_ID,
	team: "player",
	stats,
	hullType: HULL,
	installedGear: standardIssueGear(HULL, SHIP_ID),
});
const craftedPlayer = shipToCombatant({
	id: SHIP_ID,
	team: "player",
	stats,
	hullType: HULL,
	installedGear: craftedGear(SHIP_ID),
});

// -- A FIXED benchmark enemy, tuned to sit in the SEPARATION BAND: tough enough that
// the Standard-Issue destroyer does NOT auto-win every seed (so there is headroom for
// crafted to win MORE), but not so tough that neither side wins (which would prove
// nothing). Its stats/weapons are a plain hull literal (the enemy-side pattern from
// bridge.test.ts), built ONCE so both matchups face byte-identical opposition.
function benchmarkEnemy(): ReturnType<typeof shipToCombatant> {
	return shipToCombatant({
		id: "bench-enemy",
		team: "enemy",
		stats: { hullIntegrity: 520, shieldCapacity: 260, shieldRecharge: 9 },
		// A mixed two-gun enemy (kinetic finisher + fast workhorse) so the fight exercises
		// both the shield and hull pools rather than a single damage channel.
		weaponLoadout: [
			makeWeaponInstance("railgun", "bench-enemy-w0-railgun"),
			makeWeaponInstance("autocannon", "bench-enemy-w1-autocannon"),
		],
		stance: "balanced",
	});
}

// A large, FIXED seed pool + baseSeed so both win rates are stable, reproducible
// integers. 200 samples gives a tight enough estimate that the crafted advantage is
// not a sampling artifact.
const FORECAST_SAMPLES = 200;
const FORECAST_BASE_SEED = 7000;

describe("Combat 1.0 Unit 1.6: crafted gear pays off end-to-end (craft -> install -> combat)", () => {
	// ---- PROOF (a): the crafted combatant is MEASURABLY stronger, stat by stat. ----
	// These read straight off the folded Combatant, so they prove the Unit 1.4 fold
	// carried the Unit 1.2 rolls through into real combat stats (not just onto the item).
	it("a crafted-geared destroyer folds into strictly bigger combat pools than Standard-Issue", () => {
		// Shield pool: crafted emitter capacity > Standard-Issue emitter (the hull's floor).
		expect(craftedPlayer.shieldMax).toBeGreaterThan(siPlayer.shieldMax);
		// Hull pool: frame is shared; crafted plating.hullStrength > Standard-Issue plating.
		expect(craftedPlayer.hullMax).toBeGreaterThan(siPlayer.hullMax);
		// Weapon yield, per aligned slot: a crafted weapon adds weaponYield on top of the
		// base def; Standard-Issue adds 0. Same weaponType per index (same loadout shape).
		expect(craftedPlayer.weapons.length).toBe(siPlayer.weapons.length);
		for (let i = 0; i < craftedPlayer.weapons.length; i++) {
			const crafted = craftedPlayer.weapons[i];
			const si = siPlayer.weapons[i];
			expect(crafted.weaponType).toBe(si.weaponType); // same slot, fair comparison
			expect(crafted.yieldMin).toBeGreaterThan(si.yieldMin);
			expect(crafted.yieldMax).toBeGreaterThan(si.yieldMax);
		}
		// Battle Rating (the opponent-agnostic "how geared am I" composite) must also rise:
		// it is monotonic in every pool + DPS term, so a strictly-better set reads higher.
		const siRating = battleRating(siPlayer);
		const craftedRating = battleRating(craftedPlayer);
		// eslint-disable-next-line no-console
		console.log(
			`[crafted-payoff] battleRating  Standard-Issue = ${siRating}  crafted = ${craftedRating}`,
		);
		expect(craftedRating).toBeGreaterThan(siRating);
	});

	// ---- PROOF (a2), combat-defense rework Unit 4: crafted defensive gear at a MID item level is an
	// UPGRADE over the free Standard-Issue floor, not a downgrade. ----
	// Under the re-tuned defensive curve (itemgen craftedDefensiveImplicit) the Standard-Issue floor is
	// a flat, hull-independent 100 shieldCapacity / 100 hullStrength, and even a MID-iLevel q5 crafted
	// set rolls raw magnitudes far above it (~434 each at iLevel 60), so once folded through the
	// destroyer's innate stats the crafted pools sit comfortably ABOVE the Standard-Issue destroyer.
	// (The first-crafted-tier-above-SI guarantee at the LOWEST roll is proven directly in itemgen.test.ts.)
	it("crafted defensive gear at a MID item level already out-tanks the Standard-Issue destroyer", () => {
		const midCraftedPlayer = shipToCombatant({
			id: SHIP_ID,
			team: "player",
			stats,
			hullType: HULL,
			installedGear: craftedGear(SHIP_ID, CRAFTED_DEFENSE_MID_ILEVEL),
		});
		// Hull pool: mid-iLevel crafted plating.hullStrength (implicit boosted) clears the SI floor.
		expect(midCraftedPlayer.hullMax).toBeGreaterThan(siPlayer.hullMax);
		// Shield pool: mid-iLevel crafted emitter.shieldCapacity (implicit boosted) clears the SI floor.
		expect(midCraftedPlayer.shieldMax).toBeGreaterThan(siPlayer.shieldMax);
	});

	// ---- PROOF (b): the crafted combatant WINS THE SAME FIGHT MORE OFTEN. ----
	// The honest end-to-end metric: run each player vs the SAME benchmark enemy across
	// the SAME fixed seed pool through the REAL sim, and compare win %. Crafted must win
	// strictly more often, and the Standard-Issue floor must be in the separation band
	// (neither 0% nor 100%) so the gap is a real gear signal, not a saturated ceiling.
	it("a crafted-geared destroyer wins the benchmark matchup more often than Standard-Issue", () => {
		const enemy = benchmarkEnemy();
		const siForecast = engagementForecast(siPlayer, enemy, {
			samples: FORECAST_SAMPLES,
			baseSeed: FORECAST_BASE_SEED,
		});
		const craftedForecast = engagementForecast(craftedPlayer, enemy, {
			samples: FORECAST_SAMPLES,
			baseSeed: FORECAST_BASE_SEED,
		});
		// eslint-disable-next-line no-console
		console.log(
			`[crafted-payoff] benchmark win%  Standard-Issue = ${siForecast.winPercent}%  ` +
				`crafted = ${craftedForecast.winPercent}%  (${FORECAST_SAMPLES} seeds, base ${FORECAST_BASE_SEED})`,
		);
		// The Standard-Issue floor is genuinely challenged (real headroom for improvement).
		expect(siForecast.winPercent).toBeGreaterThan(0);
		expect(siForecast.winPercent).toBeLessThan(100);
		// THE PAYOFF: better gear -> strictly more wins over the same seed pool + same enemy.
		expect(craftedForecast.winPercent).toBeGreaterThan(siForecast.winPercent);
	});
});
