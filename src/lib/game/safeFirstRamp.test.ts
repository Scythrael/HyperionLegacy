// Safe first runs SF-3 (docs/plans/2026-10-15-safe-first-runs-plan.md section 4 SF-3 and the USER ANSWERS): THE RAMP
// AND THE VAULT FIX. Every expedition dispatched since SF-3 that is not the training run carries an ORDINARY stamp
// (`Expedition.difficulty`: firstRun false, the curve position `ramp`, the region tier), and its consumers read it:
//   - the guards: the curve's enemy strength (user SF4 "Slow start": run 2 at 35%, run 6 about 54%, run 9 about 80%,
//     full from run 11; completed runs only, the training run excluded) on the hazard at most the tier's ceiling (user
//     SF7 "Cap by tier": Tier I 0.1, Tier II 0.5, raw from Tier III), and Weak enemies on the curve's low end (user
//     2026-10-16 "Use them on the curve");
//   - the affix roll chance, the ambush chance, the ship-event checks' fail chance and hull wear x ramp, the ship
//     battles' enemy at the curve's strength on the capped hazard;
//   - Tier I only (user SF6): Tier II and up read full strength from their first run there (forced here by parameter
//     until G2-2 supplies regions).
// Here: each effect against the same run without the stamp (never vacuous), the curve's anchors through real
// dispatches, determinism and offline == live on a ramped run, and a fixed sample of the sweep's claims
// (safeFirstRamp.sweep.test.ts runs 200 seeds per curve position, gated).

import { describe, expect, it } from "vitest";
import type { Expedition, ExpeditionActivity, ExpeditionBody, GameState } from "./model";
import { ANOMALY_EXTRA_SECONDS, TRANSIT_SECONDS, advanceExpedition, startExpedition } from "./expedition";
import { resistedHazard } from "./relics";
import { taskFightGuard, type RankedFightTask } from "./groundFight";
import { generateEncounter } from "./gambit";
import { groundThreatOddsKey } from "./groundThreat";
import { rollObjectiveAffixes } from "./affixes";
import { generateRiskProfile } from "./riskFactors";
import { EARLY_CURVE_RANK, EARLY_CURVE_WEAK_UNTIL, ENEMY_RANKS, ENEMY_RANKS_VERSION, curveBaseFactor, curveBaseRank } from "./enemyRanks";
import {
  N_FULL,
  RAMP_FLOOR,
  TIER_ENCOUNTER_HAZARD_CEILING,
  encounterHazard,
  rampEnemyScale,
  rampFraction,
  rampOddsFraction,
  rampedChance,
  rampedPassChance,
  rampedStampOf,
  runDifficultyAt,
  runRampOf,
} from "./runDifficulty";
import {
  DEBRIS_HULL_SHARE,
  HOSTILE_PROBE_HULL,
  SHIP_EVENT_DRAW_UNITS,
  resolveShipScanEventFromDraws,
  shipEventEnemy,
  type ShipEventDraws,
} from "./shipScanEvents";
import { asExpeditionVeteran, withoutCurve } from "./awayTeamTestFixtures";
import { onHull, SWEEP_END, withCrew } from "./firstRunsGoldens.fixture";
import { afterTraining, rampRun, rampSeed, tally } from "./safeFirstRamp.fixture";
import { withWr10Off } from "./wr10Switch.fixture";
import { fixRoundESwitchesOffForThisFile } from "./fixRoundESwitch.fixture";

// Fix round FR-E (0.14.0): the star rule (lane 3 I2, STAR_BODIES_SWITCH: a real star's bodies are drawn from the star,
// not from its candidate slot) moves the Orion d18 and rank1 ramp samples (the list after the training run holds Wolf
// 359). The pins here predate the round and are about another slice, so the file runs with that fix off
// (fixRoundESwitch.fixture.ts); every other fix of the round runs here. The round's own pins:
// expeditionFixRoundE.test.ts and expeditionFixRoundEGoldens.test.ts.
fixRoundESwitchesOffForThisFile("starBodies");

// ===== helpers =====

type Stamp = NonNullable<Expedition["difficulty"]>;
const stampAt = (ramp: number, tier: Stamp["tier"] = 1): Stamp => ({ version: 1, firstRun: false, ramp, tier });
// The stamp a real Tier I dispatch writes after `completed` runs (SF-3 review: the odds' own position, one run behind,
// stored only where it differs from the enemy curve's).
const dispatchStampAt = (completed: number): Stamp => {
  const ramp = rampFraction(completed);
  const oddsRamp = rampOddsFraction(completed);
  return { ...stampAt(ramp), ...(oddsRamp !== ramp ? { oddsRamp } : {}) };
};

function dispatch(state: GameState, cand = "cand-0"): { next: GameState; exp: Expedition } {
  const res = startExpedition(state, "ship-1", 1, cand);
  expect(res.success, String(res.reason)).toBe(true);
  return { next: res.next, exp: res.expedition! };
}

// An Orion rank 1 save, the training run done and `completed` runs after it.
const orionAfter = (completed: number): GameState => afterTraining(withCrew(onHull("orion"), "rank1"), completed);

// A task fight at fight point `point` of a three-point objective of grade `grade` on site `poiId`.
const task = (poiId: string, grade: number, point: number): RankedFightTask => ({
  id: "t",
  poiId,
  fightCount: point,
  pointsCleared: point,
  difficulty: grade,
  fightPoints: [0.25, 0.5, 0.75],
});
const RANKED = { enemyRanks: { version: ENEMY_RANKS_VERSION } };
const SITES = ["buriedVault", "subterraneanCivilization", "derelictOutpost", "caveNetwork", "geothermalChamber"];
const SEEDS = [1, 2, 3, 0x9e3779b9];

const DRAW_MAX = SHIP_EVENT_DRAW_UNITS - 1;
// Draws that land each kind with a failed check and an unrepelled boarding attempt (the worst roll of each kind).
const WORST: Record<string, ShipEventDraws> = {
  debris: { kind: 0, check: DRAW_MAX, cloaked: DRAW_MAX, boardingAttempt: 0, boardingRepel: DRAW_MAX },
  ghost: { kind: 70, check: DRAW_MAX, cloaked: DRAW_MAX, boardingAttempt: 0, boardingRepel: DRAW_MAX },
  storm: { kind: 90, check: DRAW_MAX, cloaked: DRAW_MAX, boardingAttempt: 0, boardingRepel: DRAW_MAX },
};

// ===== the stamp =====

describe("SF-3 the stamp: every ordinary run carries its curve position and tier", () => {
  it("the curve's anchors through real dispatches: run 2 at 35%, run 6 about 54%, run 9 about 80%, full from run 12", () => {
    const strength = (completed: number): number => {
      const { exp } = dispatch(orionAfter(completed));
      const stamp = rampedStampOf(exp)!;
      expect(exp.difficulty).toEqual(dispatchStampAt(completed));
      expect(exp.id).toBe(`expedition-${completed + 2}`); // the run number on the curve
      return rampEnemyScale(stamp.ramp);
    };
    expect(strength(0)).toBe(RAMP_FLOOR);
    expect(strength(0)).toBe(0.35);
    expect(strength(4)).toBeCloseTo(0.54, 2);
    expect(strength(7)).toBeCloseTo(0.8, 1);
    expect(strength(7)).toBeGreaterThan(0.79);
    expect(strength(N_FULL - 1)).toBe(1);
    expect(strength(30)).toBe(1);
    // Strictly rising between, never faster than the step before it would allow an exponential.
    const all = Array.from({ length: N_FULL }, (_, c) => rampEnemyScale(rampFraction(c)));
    for (let c = 1; c < all.length; c += 1) expect(all[c]).toBeGreaterThan(all[c - 1]);
    // SF-3 review "Smooth the last steps": the climb after run 9 (runs 10, 11, 12) is even, each step no larger than
    // the ease-in's last (run 8 to 9); the odds reach full strength one run later (run 13).
    for (let c = 8; c < all.length; c += 1) expect(all[c] - all[c - 1], `run ${c + 2}`).toBeLessThanOrEqual(all[7] - all[6] + 1e-12);
    expect(rampOddsFraction(N_FULL - 1)).toBeLessThan(1);
    expect(rampOddsFraction(N_FULL)).toBe(1);
    for (let c = 1; c < N_FULL + 2; c += 1) expect(rampOddsFraction(c)).toBe(rampFraction(c - 1));
  });

  it("a veteran's run reads full strength; the training run keeps its own stamp; a run from before SF-3 has none", () => {
    expect(dispatch(asExpeditionVeteran(withCrew(onHull("orion"), "rank1"))).exp.difficulty).toEqual(stampAt(1));
    const training = dispatch(withCrew(onHull("orion"), "rank1")).exp;
    expect(training.difficulty).toEqual({ version: 1, firstRun: true, ramp: 0, tier: 1 });
    expect(rampedStampOf(training)).toBeNull();
    expect(runRampOf(training)).toBe(1);
    const legacy = withoutCurve(dispatch(orionAfter(0)).exp);
    expect(legacy.difficulty).toBeUndefined();
    expect(rampedStampOf(legacy)).toBeNull();
    expect(runRampOf(legacy)).toBe(1);
  });

  it("Tier I only (user SF6): Tier II and up read full strength from their first run there and are never the training run", () => {
    const fresh = withCrew(onHull("orion"), "rank1"); // a new save: its first explorer run at Tier I is the training run
    expect(runDifficultyAt(fresh, "expedition", 1, "orion").firstRun).toBe(true);
    for (const tier of [2, 3, 7] as const) {
      expect(runDifficultyAt(fresh, "expedition", tier, "orion"), `tier ${tier}`).toEqual(stampAt(1, tier));
      expect(runDifficultyAt(afterTraining(fresh, 0), "expedition", tier, "orion")).toEqual(stampAt(1, tier));
    }
    expect(runDifficultyAt(afterTraining(fresh, 0), "expedition", 1, "orion")).toEqual(stampAt(0));
  });

  it("the stamp is read strictly: a malformed one reads as none; the ramp clamps to [0, 1] and the tier to I..VII", () => {
    expect(rampedStampOf({ difficulty: undefined })).toBeNull();
    expect(rampedStampOf({ difficulty: { version: 2, firstRun: false, ramp: 0, tier: 1 } as unknown as Stamp })).toBeNull();
    expect(rampedStampOf({ difficulty: { version: 1, firstRun: false, ramp: Number.NaN, tier: 1 } })).toBeNull();
    expect(rampedStampOf({ difficulty: { version: 1, firstRun: false, ramp: 3, tier: 9 as Stamp["tier"] } })).toEqual(stampAt(1, 7));
    expect(rampedStampOf({ difficulty: { version: 1, firstRun: false, ramp: -1, tier: 1 } })).toEqual(stampAt(0));
  });
});

// ===== the guard =====

describe("SF-3 the guard on the curve: strength, the tier hazard ceiling, Weak on the low end", () => {
  const hot: Pick<ExpeditionBody, "hazard" | "risk"> = { hazard: 0.9 };

  it("the tier ceiling (user SF7): Tier I reads hazard at most 0.1, Tier II at most 0.5, Tier III and up the raw hazard", () => {
    expect(TIER_ENCOUNTER_HAZARD_CEILING).toEqual({ 1: 0.1, 2: 0.5 });
    for (const poi of SITES) {
      for (const seed of SEEDS) {
        const simple = task(poi, 1, 2);
        // Full strength, unranked: exactly generateEncounter on the capped hazard; the run without the stamp on the raw.
        expect(taskFightGuard({ hazardResist: 0 }, hot, simple, seed)).toEqual(generateEncounter(seed, 0.9, poi));
        expect(taskFightGuard({ hazardResist: 0, difficulty: stampAt(1) }, hot, simple, seed)).toEqual(generateEncounter(seed, 0.1, poi));
        expect(taskFightGuard({ hazardResist: 0, difficulty: stampAt(1, 2) }, hot, simple, seed)).toEqual(generateEncounter(seed, 0.5, poi));
        expect(taskFightGuard({ hazardResist: 0, difficulty: stampAt(1, 3) }, hot, simple, seed)).toEqual(generateEncounter(seed, 0.9, poi));
        // A body under the ceiling reads exactly as before at full strength.
        expect(taskFightGuard({ hazardResist: 0, difficulty: stampAt(1) }, { hazard: 0.1 }, simple, seed)).toEqual(taskFightGuard({ hazardResist: 0 }, { hazard: 0.1 }, simple, seed));
      }
    }
    expect(encounterHazard(0.05, 1)).toBe(0.05);
    // The museum resist applies first, then the ceiling (a resisted hazard under it is read as it is).
    for (const resist of [0.5, 5, 50]) {
      const presented = resistedHazard(0.9, resist);
      expect(taskFightGuard({ hazardResist: resist, difficulty: stampAt(1) }, hot, task("caveNetwork", 1, 2), 7)).toEqual(generateEncounter(7, Math.min(0.1, presented), "caveNetwork"));
      expect(taskFightGuard({ hazardResist: resist, difficulty: stampAt(1, 3) }, hot, task("caveNetwork", 1, 2), 7)).toEqual(generateEncounter(7, presented, "caveNetwork"));
    }
  });

  it("the curve's strength scales every enemy's HP, power and heal (no cap, the same draws); full strength reads no profile", () => {
    for (const poi of SITES) {
      for (const seed of SEEDS) {
        for (const c of [0, 4, 7]) {
          const ramp = rampFraction(c);
          const scale = rampEnemyScale(ramp);
          const guard = taskFightGuard({ hazardResist: 0, difficulty: stampAt(ramp) }, hot, task(poi, 1, 2), seed);
          expect(guard).toEqual(generateEncounter(seed, 0.1, poi, { scale, maxEnemies: null }));
          const full = generateEncounter(seed, 0.1, poi);
          expect(guard).toHaveLength(full.length);
          guard.forEach((e, i) => expect(e.power).toBeCloseTo(full[i].power * scale, 9));
        }
      }
    }
  });

  it("Weak fades out (SF-3 review): unled enemies x(0.7 + 0.3 x ramp) after the curve's strength, named Weak below the midpoint; a placed lead keeps its rank", () => {
    expect(EARLY_CURVE_RANK).toBe("weak");
    // The factor: Weak's x0.7 at the floor, rising with every run, exactly 1 at full strength; no step between runs.
    const factors = Array.from({ length: N_FULL + 2 }, (_, c) => curveBaseFactor({ difficulty: stampAt(rampFraction(c)) }));
    expect(factors[0]).toBe(ENEMY_RANKS.weak.mult);
    factors.forEach((f, c) => expect(f, `run ${c + 2}`).toBeCloseTo(c >= N_FULL - 1 ? 1 : ENEMY_RANKS.weak.mult + (1 - ENEMY_RANKS.weak.mult) * rampFraction(c), 12));
    for (let c = 1; c < N_FULL; c += 1) expect(factors[c] - factors[c - 1], `run ${c + 2}`).toBeLessThan(0.05);
    expect(factors[N_FULL - 1]).toBe(1);
    expect(curveBaseFactor({})).toBe(1);
    expect(curveBaseFactor({ difficulty: { version: 1, firstRun: true, ramp: 0, tier: 1 } })).toBe(1);
    // The name: Weak on runs 2 to 7 (ramp below EARLY_CURVE_WEAK_UNTIL, the factor below 0.85), Normal from run 8; the
    // nearest run sits well clear of the line (no rounding near-tie).
    const bases = Array.from({ length: N_FULL + 2 }, (_, c) => curveBaseRank({ difficulty: stampAt(rampFraction(c)) }));
    expect(bases).toEqual(["weak", "weak", "weak", "weak", "weak", "weak", "normal", "normal", "normal", "normal", "normal", "normal", "normal"]);
    for (let c = 0; c < N_FULL; c += 1) expect(Math.abs(rampFraction(c) - EARLY_CURVE_WEAK_UNTIL), `run ${c + 2}`).toBeGreaterThan(0.04);
    expect(curveBaseRank({ difficulty: { version: 1, firstRun: true, ramp: 0, tier: 1 } })).toBe("normal");
    expect(curveBaseRank({})).toBe("normal");
    expect(curveBaseRank({ difficulty: stampAt(1, 2) })).toBe("normal");
    for (const poi of SITES) {
      for (const seed of SEEDS) {
        const floor = { hazardResist: 0, difficulty: stampAt(0) };
        const plain = taskFightGuard(floor, hot, task(poi, 1, 2), seed);
        const ranked = taskFightGuard({ ...floor, ...RANKED }, hot, task(poi, 1, 2), seed);
        ranked.forEach((e, i) => {
          expect(e.rank).toBe("weak");
          expect(e.power).toBeCloseTo(plain[i].power * ENEMY_RANKS.weak.mult, 9);
          expect(e.heal).toBeCloseTo(plain[i].heal * ENEMY_RANKS.weak.mult, 9);
        });
        // A Challenging final: its strongest enemy is the Elite lead (N2), every other one Weak.
        const final = taskFightGuard({ ...floor, ...RANKED }, hot, task(poi, 3, 2), seed);
        expect(final.filter((e) => e.rank === "elite")).toHaveLength(1);
        expect(final.filter((e) => e.rank === "weak")).toHaveLength(final.length - 1);
        // Surprise and reinforcement fights are unled: their enemies take the run's base too (REINFORCEMENT_RANK N5).
        for (const kind of ["surprise", "reinforcement"] as const) {
          expect(taskFightGuard({ ...floor, ...RANKED }, hot, task(poi, 5, 2), seed, 0, kind).every((e) => e.rank === "weak"), kind).toBe(true);
        }
        // Past the name line every unled enemy reads Normal at its faded factor; at full strength exactly the unranked guard.
        const later = { hazardResist: 0, difficulty: stampAt(rampFraction(6)) };
        const laterRanked = taskFightGuard({ ...later, ...RANKED }, hot, task(poi, 1, 2), seed);
        const laterPlain = taskFightGuard(later, hot, task(poi, 1, 2), seed);
        laterRanked.forEach((e, i) => {
          expect(e.rank).toBe("normal");
          expect(e.power).toBeCloseTo(laterPlain[i].power * curveBaseFactor(later), 9);
        });
        const full = { hazardResist: 0, difficulty: stampAt(1) };
        expect(taskFightGuard({ ...full, ...RANKED }, hot, task(poi, 1, 2), seed).map((e) => e.power)).toEqual(taskFightGuard(full, hot, task(poi, 1, 2), seed).map((e) => e.power));
      }
    }
  });

  // Every fight a real run fought, read off its pending record at the fight's start (the record lists every enemy not
  // Normal).
  const foughtRanks = (exp: Expedition): string[] => {
    const done = advanceExpedition(exp, SWEEP_END);
    const fights = done.groundOps!.history.filter((r) => r.step === "fight").sort((a, b) => a.startedAt - b.startedAt || a.teamIndex - b.teamIndex);
    expect(fights.length).toBeGreaterThan(0);
    let at = exp;
    return fights.flatMap((r) => {
      at = advanceExpedition(at, r.startedAt);
      const fight = at.groundOps!.teams[r.teamIndex].pendingFight;
      return fight ? Object.values(fight.ranks ?? {}) : [];
    });
  };

  it("a real run on the low end fields Weak enemies in its fights; a veteran's run none", { timeout: 60_000 }, () => {
    expect(foughtRanks(dispatch(orionAfter(0)).exp)).toContain("weak");
    expect(foughtRanks(dispatch(asExpeditionVeteran(withCrew(onHull("orion"), "rank1"))).exp)).not.toContain("weak");
  });
});

// ===== the odds =====

describe("SF-3 the odds on the curve: the affix roll, ambushes, ship events (x ramp)", () => {
  it("rampedChance and rampedPassChance: x ramp (the fail chance for a check), exact at full strength", () => {
    for (const p of [0, 0.123456789, 0.5, 0.9, 1]) {
      expect(rampedChance(p, 1)).toBe(p);
      expect(rampedPassChance(p, 1)).toBe(p);
      expect(rampedChance(p, 0)).toBe(0);
      expect(rampedPassChance(p, 0)).toBe(1);
      expect(rampedChance(p, 0.25)).toBeCloseTo(p * 0.25, 12);
      expect(rampedPassChance(p, 0.25)).toBeCloseTo(1 - (1 - p) * 0.25, 12);
    }
  });

  it("the affix roll: the rolled affix's chance x ramp, the required ones always, the same draws", () => {
    let hits = 0;
    for (let seed = 1; seed < 4000 && hits < 3; seed += 1) {
      const input = { seed, bodyIndex: 0, taskIndex: 0, tier: 7, difficulty: 5, difficultyTier: 1, combat: true, catalog: 2 };
      const nominal = rollObjectiveAffixes(input);
      expect(rollObjectiveAffixes({ ...input, ramp: 1 })).toEqual(nominal);
      const floor = rollObjectiveAffixes({ ...input, ramp: 0 });
      // The required affixes (Reinforcing on a Deadly objective) stay, with the same rank and alignment draws.
      expect(floor.length).toBeGreaterThan(0);
      expect(nominal.slice(0, floor.length)).toEqual(floor);
      if (nominal.length > floor.length) hits += 1;
    }
    expect(hits).toBeGreaterThan(0);
  });

  // Tier I's calm objectives rarely carry an ambush chance, so the run's risk is regenerated at Tier IV before any body
  // scans (the safeFirstExpedition.test.ts pattern); the stamp, not the tier, scales them.
  it("the ambush chance x ramp on every calm objective; none at the floor; exactly nominal at full strength", () => {
    const scanned = (e: Expedition): ExpeditionActivity[] =>
      advanceExpedition(e, e.phaseAnchorSeconds + TRANSIT_SECONDS + ANOMALY_EXTRA_SECONDS + 40_000).bodies.flatMap((b) => b.activities);
    let compared = 0;
    for (const cand of ["cand-0", "cand-1", "cand-2"]) {
      const { exp } = dispatch(orionAfter(4), cand);
      const forced = generateRiskProfile(exp.seed, { tier: 4, enemyTerritory: false }, exp.bodies);
      const tierFour: Expedition = { ...exp, risk: forced.profile, bodies: exp.bodies.map((b, i) => ({ ...b, risk: forced.bodies[i] })) };
      const nominal = scanned(withoutCurve(tierFour));
      // SF-3 review: ambushes read the odds' own position (one run behind the enemy curve).
      const ramp = rampOddsFraction(4);
      expect(tierFour.difficulty?.oddsRamp).toBe(ramp);
      const ramped = scanned(tierFour);
      const floor = scanned({ ...tierFour, difficulty: stampAt(0) });
      const full = scanned({ ...tierFour, difficulty: stampAt(1) });
      // Compared by objective where all four runs have stamped it (their ship events differ, so the scans pace
      // differently and a ghost's bonus find adds objectives).
      const byId = (tasks: ExpeditionActivity[]) => new Map(tasks.map((t) => [t.id, t]));
      const [r, f, u] = [byId(ramped), byId(floor), byId(full)];
      for (const t of nominal) {
        const twins = [r.get(t.id), f.get(t.id), u.get(t.id)];
        if (t.status === undefined || twins.some((x) => x?.status === undefined)) continue;
        if ((t.ambushChance ?? 0) > 0) compared += 1;
        expect(twins[0]!.ambushChance ?? 0).toBeCloseTo((t.ambushChance ?? 0) * ramp, 12);
        expect(twins[1]!.ambushChance).toBeUndefined();
        expect(twins[2]!.ambushChance).toBe(t.ambushChance);
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it("ship events: at the floor every check passes and nothing is worn; between, the fail chance x ramp; at full strength exactly as before", () => {
    const { exp } = dispatch(orionAfter(0));
    const body = exp.bodies[0];
    for (const [kind, draws] of Object.entries(WORST)) {
      const floor = resolveShipScanEventFromDraws({ ...exp, difficulty: stampAt(0) }, body, 0, 3, 1, draws).event;
      expect(floor.outcome, kind).toBe("pass");
      expect(floor.pauseSeconds ?? 0).toBe(0);
      expect(floor.hullWear).toBeUndefined();
      const nominal = resolveShipScanEventFromDraws(withoutCurve(exp), body, 0, 3, 1, draws).event;
      expect(nominal.outcome, kind).toBe("fail");
      expect(resolveShipScanEventFromDraws({ ...exp, difficulty: stampAt(1) }, body, 0, 3, 1, draws).event).toEqual(nominal);
    }
    // Debris between: the pass threshold (the first failing check draw) moves so the FAIL share halves at ramp 0.5,
    // and a failed check wears half the hull.
    const plain = withoutCurve(exp);
    const half = { ...exp, difficulty: stampAt(0.5) };
    const debris = (e: Expedition, check: number) => resolveShipScanEventFromDraws(e, body, 0, 3, 1, { ...WORST.debris, check }).event;
    const firstFail = (e: Expedition): number => {
      let lo = 0;
      let hi = DRAW_MAX; // debris(hi) fails (WORST)
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (debris(e, mid).outcome === "fail") hi = mid;
        else lo = mid + 1;
      }
      return lo;
    };
    const nominalFail = SHIP_EVENT_DRAW_UNITS - firstFail(plain);
    const halfFail = SHIP_EVENT_DRAW_UNITS - firstFail(half);
    expect(nominalFail).toBeGreaterThan(1000);
    expect(Math.abs(halfFail - nominalFail * 0.5)).toBeLessThanOrEqual(1);
    const hullMax = exp.groundOps!.shipEventProfile!.battle!.hullMax;
    const worn = debris(half, DRAW_MAX);
    expect(worn.outcome).toBe("fail");
    expect(debris(plain, DRAW_MAX).hullWear).toBe(Math.max(1, Math.round(DEBRIS_HULL_SHARE * hullMax)));
    expect(worn.hullWear).toBe(Math.max(1, Math.round(DEBRIS_HULL_SHARE * hullMax * 0.5)));
  });

  it("the ship battle's enemy: the curve's strength on the capped hazard (the run without the stamp on the raw hazard)", () => {
    const { exp } = dispatch(orionAfter(0));
    const body: ExpeditionBody = { ...exp.bodies[0], hazard: 0.9 };
    const plain = shipEventEnemy(withoutCurve(exp), body, 0, 3, HOSTILE_PROBE_HULL);
    const capped = shipEventEnemy({ ...exp, difficulty: stampAt(1) }, body, 0, 3, HOSTILE_PROBE_HULL);
    const floor = shipEventEnemy({ ...exp, difficulty: stampAt(0) }, body, 0, 3, HOSTILE_PROBE_HULL);
    expect(plain.hullMax).toBe(Math.round(HOSTILE_PROBE_HULL.stats.hullIntegrity * 1.9));
    expect(capped.hullMax).toBe(Math.round(HOSTILE_PROBE_HULL.stats.hullIntegrity * 1.1));
    expect(floor.hullMax).toBe(Math.round(HOSTILE_PROBE_HULL.stats.hullIntegrity * 1.1 * RAMP_FLOOR));
  });

  it("the threat odds' memo key tells a ramped run apart; a run without the stamp keys exactly as before", () => {
    const { exp } = dispatch(orionAfter(0));
    const plain = withoutCurve(exp);
    const t = { id: "t", poiId: "caveNetwork", fightCount: 0, pointsCleared: 0, fightPoints: [0.5], difficulty: 1 };
    const key = (e: Expedition) => groundThreatOddsKey(e, [], { hazard: 0.4 }, t, 0, 16);
    expect(key(plain)).not.toContain("curve");
    expect(key(exp)).toContain("curve");
    expect(key({ ...exp, difficulty: stampAt(0.5) })).not.toBe(key(exp));
    expect(key({ ...exp, difficulty: stampAt(0.5, 2) })).not.toBe(key({ ...exp, difficulty: stampAt(0.5) }));
  });
});

// ===== determinism =====

describe("SF-3 determinism: a ramped run", () => {
  it("offline == live: one call == 997 s chunks == 1 s steps around its first loss, and the input is never mutated", { timeout: 120_000 }, () => {
    const run = dispatch(afterTraining(withCrew(onHull("orion"), "d18"), 3), "cand-1").exp;
    expect(rampedStampOf(run)).not.toBeNull();
    const frozen = structuredClone(run);
    const one = advanceExpedition(run, SWEEP_END);
    const end = Math.min(SWEEP_END, one.phase === "complete" ? one.phaseAnchorSeconds + 1 : SWEEP_END);
    const whole = advanceExpedition(run, end);
    let e = run;
    for (let t = run.phaseAnchorSeconds + 997; t < end; t += 997) e = advanceExpedition(e, t);
    expect(advanceExpedition(e, end)).toEqual(whole);
    const loss = one.groundOps!.history.find((r) => r.outcome === "loss");
    expect(loss).toBeDefined();
    let s = advanceExpedition(run, loss!.startedAt - 200);
    for (let t = loss!.startedAt - 199; t <= loss!.endedAt + 200; t += 1) s = advanceExpedition(s, t);
    expect(s).toEqual(advanceExpedition(run, loss!.endedAt + 200));
    expect(run).toEqual(frozen);
    // The same dispatch twice is the same run.
    expect(dispatch(afterTraining(withCrew(onHull("orion"), "d18"), 3), "cand-1").exp).toEqual(run);
  });
});

// ===== a fixed sample of the sweep =====

// Orion, 10 sweep seeds per curve position (safeFirstRamp.sweep.test.ts runs 200). Measured on this build.
const SAMPLE = Array.from({ length: 10 }, (_, i) => i);
const SAMPLE_KS = [0, 3, 6, 9];

describe("SF-3 the sample: difficulty rises with the curve and never falls", () => {
  for (const crew of ["d18", "rank1"] as const) {
    it(`Orion ${crew}: the stall count and the lost fights never fall as the curve rises`, { timeout: 120_000 }, () => {
      const rows = SAMPLE_KS.map((k) => tally(SAMPLE.map((i) => rampRun("orion", crew, k, rampSeed(i)))));
      for (let j = 1; j < rows.length; j += 1) {
        expect(rows[j].stalled, `${crew} k=${SAMPLE_KS[j]}`).toBeGreaterThanOrEqual(rows[j - 1].stalled);
        expect(rows[j].anyLost, `${crew} k=${SAMPLE_KS[j]}`).toBeGreaterThanOrEqual(rows[j - 1].anyLost);
        expect(rows[j].lostFights, `${crew} k=${SAMPLE_KS[j]}`).toBeGreaterThanOrEqual(rows[j - 1].lostFights);
      }
      if (crew === "d18") expect(rows[0].stalled, "the weakest launchable crew finishes run 2").toBe(0);
      expect(rows.map((r) => `${r.stalled}/${r.anyLost}/${r.lostFights}/${r.vaultWon}:${r.vaultSites}`)).toEqual(SAMPLE_PINS[crew]);
    });
    // Wiring WR-10 moved the pins in place: with WR-10 switched off (wr10Switch.fixture.ts) the sample reads the pins as
    // the SF-3 review left them, so every move above is WR-10's.
    it(`Orion ${crew}: with WR-10 off the sample reads the pre-WR-10 pins`, { timeout: 120_000 }, () => {
      const rows = withWr10Off(() => SAMPLE_KS.map((k) => tally(SAMPLE.map((i) => rampRun("orion", crew, k, rampSeed(i))))));
      expect(rows.map((r) => `${r.stalled}/${r.anyLost}/${r.lostFights}/${r.vaultWon}:${r.vaultSites}`)).toEqual(SAMPLE_PINS_BEFORE_WR10[crew]);
    });
  }

  it("the weakest launchable crew finishes run 2 on the three fresh candidates", () => {
    for (const cand of ["cand-0", "cand-1", "cand-2"]) expect(rampRun("orion", "d18", 0, undefined, cand).stalled, cand).toBe(false);
  });
});

// Per curve position (completed 0, 3, 6, 9): stalled / runs with a lost fight / lost fights / Vault and Subterranean
// objectives won : held.
const SAMPLE_PINS: Record<string, string[]> = {
  // Re-measured by the SF-3 review (Weak fades, the climb ends at run 12): d18 run 5 lost fights 228 to 247 (its
  // ordinary enemies x0.76 now, x0.7 before); rank 1 run 8 lost 14 to 7 and run 11 stalls 3 to 0 (run 11 is no longer
  // full strength).
  // Re-measured by Wiring WR-10 (the away rules on every new run: Neural Backup waits for its wearer, Fall Back shields,
  // casters Corrode, Science rank lifts fieldwork): d18 run 2 4/83 to 5/88 and run 5 lost fights 247 to 316; rank 1 run 5
  // 0/0 to 1/1 and run 11 lost 212 to 203. Mostly the reshuffled fight streams (each caster hit now draws its Corroded roll):
  // with the Corroded chance at 0 the sample reads 5/86, 295, 1/1 and 205. Every row still never falls, and run 2 never stalls.
  // The WR-10 fix round (user 2026-11-10 "Scale with the ramp"): the casters' Corroded chance climbs the odds ramp (0 at
  // curve position 0, 31 permille at 3, 124 at 6, 237 at 9, where it was 300 everywhere): d18 run 2 5/88 back to 4/83 (no
  // Corroded at the first ramped run, so no roll is drawn: the pre-WR-10 cell) and run 5 lost fights 316 to 295; rank 1
  // unchanged. Every row still never falls, and run 2 never stalls.
  d18: ["0/4/83/19:19", "4/9/295/12:19", "10/10/400/0:19", "10/10/400/0:19"],
  rank1: ["0/0/0/19:19", "0/1/1/19:19", "0/4/7/19:19", "0/9/203/19:19"],
};
// The pins as the SF-3 review left them (before WR-10), read back with WR-10 off.
const SAMPLE_PINS_BEFORE_WR10: Record<string, string[]> = {
  d18: ["0/4/83/19:19", "4/9/247/12:19", "10/10/400/0:19", "10/10/400/0:19"],
  rank1: ["0/0/0/19:19", "0/0/0/19:19", "0/4/7/19:19", "0/9/212/19:19"],
};
