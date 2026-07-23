// ============================================================================
// combat/enemyWave.test.ts -- invariant proofs for the deterministic Patrol
// enemy-wave generator (Combat 0.13.0, Phase 9b sub-phase 4)
//
// These tests do not check "does it build some enemies"; they lock the CONTRACT
// the patrol loop + resolveBattle will lean on:
//   1. Determinism  -- same (seed, params) => byte-identical team (design S0). If
//                       this drifts, the offline==live combat invariant is broken
//                       at the wave-composition level.
//   2. Bounds       -- team length always in [enemyCountMin, enemyCountMax]; the
//                       min===max case is exact; multi-enemy actually occurs.
//   3. Team shape   -- every enemy is on the ENEMY team, alive, carries a picked
//                       pool hull's stats, and has a unique id (no turn-order key
//                       collision).
//   4. Pool respect -- only hulls from hullPool ever appear.
//   5. Fresh clones -- enemies never share a weapon / squadron object by reference
//                       (the per-battle deep-clone the sim requires).
//   6. Drones       -- a carrier in the pool can produce a drone-bearing enemy.
//   7. Guards       -- bad params throw loudly (mirrors rng.ts / waveSchedule.ts).
// ============================================================================

import { describe, it, expect } from "vitest";
import { generateEnemyWave, type EnemyWaveParams } from "./enemyWave";
import { PIRATE_HULLS, type PirateHullId } from "./enemyHulls";

// A reasonable "typical wave" baseline the individual tests clone and tweak, so a
// param rename is a single edit. Full pool, a 1..3 team size band.
const BASE: EnemyWaveParams = {
	hullPool: ["raider", "marauder", "corsairCarrier"],
	enemyCountMin: 1,
	enemyCountMax: 3,
	idPrefix: "test",
};

// The set of hullMax values a given pool can legally produce, used to assert an
// enemy came from the pool. Each first-pass hull has a distinct hullIntegrity, so
// hullMax (== hullIntegrity, set by the bridge) identifies the source hull.
function poolHullMaxes(pool: PirateHullId[]): Set<number> {
	return new Set(pool.map((id) => PIRATE_HULLS[id].hullIntegrity));
}

describe("generateEnemyWave, deterministic Patrol enemy-wave generator", () => {
	// ---- 1. Determinism ----
	it("is deterministic: same (seed, params) => byte-identical team across many seeds", () => {
		for (let seed = 0; seed < 100; seed++) {
			const a = generateEnemyWave(seed, BASE);
			const b = generateEnemyWave(seed, BASE);
			// Structural equality: no functions live on a Combatant, so a JSON compare
			// is a full byte-for-byte proof the two teams are identical.
			expect(JSON.stringify(a)).toBe(JSON.stringify(b));
		}
	});

	// ---- 2. Bounds ----
	it("team length is always in [enemyCountMin, enemyCountMax] across many seeds", () => {
		for (let seed = 0; seed < 200; seed++) {
			const team = generateEnemyWave(seed, BASE);
			expect(team.length).toBeGreaterThanOrEqual(BASE.enemyCountMin);
			expect(team.length).toBeLessThanOrEqual(BASE.enemyCountMax);
		}
	});

	it("min===max yields exactly that many enemies for every seed", () => {
		const params: EnemyWaveParams = { ...BASE, enemyCountMin: 2, enemyCountMax: 2 };
		for (let seed = 0; seed < 50; seed++) {
			expect(generateEnemyWave(seed, params).length).toBe(2);
		}
	});

	it("multi-enemy actually occurs: a max>1 band produces at least one team of length>1", () => {
		const params: EnemyWaveParams = { ...BASE, enemyCountMin: 1, enemyCountMax: 4 };
		const anyMulti = Array.from({ length: 200 }, (_, seed) =>
			generateEnemyWave(seed, params),
		).some((team) => team.length > 1);
		expect(anyMulti).toBe(true);
	});

	// ---- 3. Team shape ----
	it("every enemy is on the ENEMY team, alive, and full-HP at battle start", () => {
		for (let seed = 0; seed < 100; seed++) {
			for (const enemy of generateEnemyWave(seed, BASE)) {
				expect(enemy.team).toBe("enemy");
				expect(enemy.alive).toBe(true);
				expect(enemy.hull).toBe(enemy.hullMax);
				expect(enemy.shield).toBe(enemy.shieldMax);
			}
		}
	});

	it("every enemy carries a pool hull's stats", () => {
		const allowed = poolHullMaxes(BASE.hullPool);
		for (let seed = 0; seed < 100; seed++) {
			for (const enemy of generateEnemyWave(seed, BASE)) {
				expect(allowed.has(enemy.hullMax)).toBe(true);
			}
		}
	});

	it("enemy ids are unique within a wave (no turn-order key collision)", () => {
		const params: EnemyWaveParams = { ...BASE, enemyCountMin: 4, enemyCountMax: 4 };
		for (let seed = 0; seed < 50; seed++) {
			const ids = generateEnemyWave(seed, params).map((e) => e.id);
			expect(new Set(ids).size).toBe(ids.length);
		}
	});

	// ---- 4. Pool respect ----
	it("only hulls from hullPool appear (single-hull pool produces only that hull)", () => {
		const params: EnemyWaveParams = {
			...BASE,
			hullPool: ["raider"],
			enemyCountMin: 3,
			enemyCountMax: 3,
		};
		const allowed = poolHullMaxes(params.hullPool);
		for (let seed = 0; seed < 50; seed++) {
			for (const enemy of generateEnemyWave(seed, params)) {
				expect(allowed.has(enemy.hullMax)).toBe(true);
			}
		}
	});

	// ---- 5. Fresh clones (the per-battle deep-clone the sim requires) ----
	it("two enemies in one wave never share a weapon object by reference", () => {
		// Marauder has two weapons; a two-marauder wave gives two enemies whose
		// weapon instances must be independent objects.
		const params: EnemyWaveParams = {
			...BASE,
			hullPool: ["marauder"],
			enemyCountMin: 2,
			enemyCountMax: 2,
		};
		const [first, second] = generateEnemyWave(1, params);
		// Different object identity per weapon slot.
		expect(first.weapons[0]).not.toBe(second.weapons[0]);
		// Mutating one must not bleed into the other.
		first.weapons[0].cooldownAccumulator = 999;
		expect(second.weapons[0].cooldownAccumulator).toBe(0);
	});

	it("two enemies in one wave never share a squadron object by reference", () => {
		const params: EnemyWaveParams = {
			...BASE,
			hullPool: ["corsairCarrier"],
			enemyCountMin: 2,
			enemyCountMax: 2,
		};
		const [first, second] = generateEnemyWave(2, params);
		expect(first.drones[0]).not.toBe(second.drones[0]);
		// The inner Drone[] arrays are independent too (destroying one enemy's drone
		// must not touch the other's).
		expect(first.drones[0].drones).not.toBe(second.drones[0].drones);
		first.drones[0].drones[0].alive = false;
		expect(second.drones[0].drones[0].alive).toBe(true);
	});

	it("two waves from the same seed produce equal-but-independent teams (fresh construction each call)", () => {
		const params: EnemyWaveParams = {
			...BASE,
			hullPool: ["marauder"],
			enemyCountMin: 1,
			enemyCountMax: 1,
		};
		const a = generateEnemyWave(7, params);
		const b = generateEnemyWave(7, params);
		// Structurally identical...
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
		// ...but not the same objects (a fresh team per call).
		expect(a[0]).not.toBe(b[0]);
		expect(a[0].weapons[0]).not.toBe(b[0].weapons[0]);
	});

	// ---- 6. Drones ----
	it("a carrier-only pool produces enemies with a non-empty drones array", () => {
		const params: EnemyWaveParams = {
			...BASE,
			hullPool: ["corsairCarrier"],
			enemyCountMin: 1,
			enemyCountMax: 1,
		};
		const [carrier] = generateEnemyWave(3, params);
		expect(carrier.drones.length).toBeGreaterThan(0);
		expect(carrier.drones[0].drones.length).toBeGreaterThan(0);
	});

	// ---- 7. Guards (fail loud, mirroring rng.ts / waveSchedule.ts throw tests) ----
	it("throws on an empty hullPool", () => {
		expect(() => generateEnemyWave(1, { ...BASE, hullPool: [] })).toThrow(
			/non-empty hullPool/,
		);
	});

	it("throws on an unknown hull id in the pool", () => {
		expect(() =>
			// Cast through unknown so the test can feed a bad id the type would reject.
			generateEnemyWave(1, {
				...BASE,
				hullPool: ["notARealHull" as unknown as PirateHullId],
			}),
		).toThrow(/unknown pirate hull id/);
	});

	it("throws when enemyCountMin < 1", () => {
		expect(() =>
			generateEnemyWave(1, { ...BASE, enemyCountMin: 0, enemyCountMax: 2 }),
		).toThrow(/enemyCountMin >= 1/);
	});

	it("throws when enemyCountMax < enemyCountMin", () => {
		expect(() =>
			generateEnemyWave(1, { ...BASE, enemyCountMin: 3, enemyCountMax: 2 }),
		).toThrow(/enemyCountMax >= enemyCountMin/);
	});

	it("throws on a fractional count param", () => {
		expect(() =>
			generateEnemyWave(1, { ...BASE, enemyCountMax: 2.5 }),
		).toThrow(/integer enemyCountMax/);
	});
});
