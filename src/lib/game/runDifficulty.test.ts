// Safe first runs SF-1 (docs/plans/2026-10-15-safe-first-runs-plan.md section 4 SF-1 and the USER ANSWERS): the
// per-type run counters, the training-run rule, the gentle difficulty curve and the v70 save fold. SF-1 changes no
// behavior: nothing reads the curve or the training rule yet (SF-2 to SF-4 consume them).

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, freshRunCounts, type Expedition, type GameState, type RunCounts } from "./model";
import {
  N_FULL,
  RAMP_FLOOR,
  RAMP_EXPONENT,
  FIRST_RUN_ENEMY_SCALE,
  FIRST_RUN_MAX_ENEMIES,
  TIER_ENCOUNTER_HAZARD_CEILING,
  completedRuns,
  countClaimedExpedition,
  countPatrolDispatch,
  countPatrolRuns,
  encounterHazard,
  isFirstRun,
  isTrainingExpedition,
  isWellFormedRunCounts,
  rampEnemyScale,
  rampFraction,
  runCountsOf,
  runDifficultyAt,
  runEnemyScale,
  runMaxEnemies,
  runRamp,
  veteranRunCountsV70,
} from "./runDifficulty";
import { advanceExpedition, claimExpedition, startExpedition } from "./expedition";
import { dispatchCaptainOnPatrol, economyTick } from "./tick";
import { migrate, serialize, deserialize, SAVE_VERSION, type SaveFile } from "./save";
import { onHull, withCrew } from "./firstRunsGoldens.fixture";
import { asPreSafeFirstRunsDispatch } from "./awayTeamTestFixtures";
import { withoutCp14 } from "./cp14Switch.fixture";

const RNG = (): number => 0.5;

// A stored run with only the fields the claim rule reads (the stamp and G2-5's recall), for the pure rule tests.
function run(over: Partial<Expedition> & { recall?: unknown } = {}): Expedition {
  return { id: "expedition-9", shipId: "ship-1", phase: "complete", ...over } as unknown as Expedition;
}

function withCounts(state: GameState, counts: RunCounts): GameState {
  return { ...state, runCounts: counts };
}

describe("SF-1: the gentle curve (user SF4 \"Slow start\": run 2 at 35%, run 6 about 54%, run 9 about 80%; the SF-3 review spreads the last climb over runs 9 to 12)", () => {
  it("is 0 after no completed runs, 1 from N_FULL - 1 completed runs on, strictly increasing between", () => {
    expect(N_FULL).toBe(11);
    expect(RAMP_EXPONENT).toBe(1.5);
    expect(rampFraction(0)).toBe(0);
    expect(rampFraction(N_FULL - 1)).toBe(1);
    expect(rampFraction(N_FULL)).toBe(1);
    expect(rampFraction(500)).toBe(1);
    for (let c = 1; c < N_FULL; c++) expect(rampFraction(c)).toBeGreaterThan(rampFraction(c - 1));
  });

  it("is never exponential: every step is at most the linear step x 1.5, so the step ratio stays bounded", () => {
    const linearStep = 1 / (N_FULL - 1);
    for (let c = 1; c < N_FULL; c++) {
      const step = rampFraction(c) - rampFraction(c - 1);
      expect(step).toBeLessThanOrEqual(linearStep * 1.5 + 1e-12);
      if (c >= 2) expect(step / (rampFraction(c - 1) - rampFraction(c - 2))).toBeLessThan(3);
    }
  });

  it("reads the plan's table as enemy strength: run 2 (0 completed after training) to run 12", () => {
    // Run r has r - 2 completed runs behind it (runs 2 to r - 1; the training run never counts, user SF5).
    const strength = Array.from({ length: N_FULL }, (_, c) => Math.round(rampEnemyScale(rampFraction(c)) * 100) / 100);
    // SF4's anchors (run 2, 6, 9) unchanged; the SF-3 review's even climb: run 10 0.86, run 11 0.93, run 12 full.
    expect(strength).toEqual([0.35, 0.37, 0.42, 0.48, 0.54, 0.62, 0.7, 0.8, 0.86, 0.93, 1]);
    // No step after run 9 is larger than the ease-in's last (run 8 to 9): no wall at the top.
    const steps = strength.slice(1).map((v, i) => v - strength[i]);
    for (let c = 7; c < steps.length; c++) expect(steps[c], `step ${c}`).toBeLessThanOrEqual(steps[6] + 1e-9);
    expect(RAMP_FLOOR).toBe(0.35);
    expect(rampEnemyScale(0)).toBe(RAMP_FLOOR);
    expect(rampEnemyScale(1)).toBe(1);
  });

  it("treats a junk count as none (never a NaN ramp)", () => {
    expect(rampFraction(-3)).toBe(0);
    expect(rampFraction(Number.NaN)).toBe(0);
    expect(rampFraction(2.5)).toBe(rampFraction(2));
  });

  it("is Tier I only (user SF6): Tier II and up read full strength from their first run", () => {
    expect(runRamp(0, 1)).toBe(0);
    expect(runRamp(4, 1)).toBe(rampFraction(4));
    for (const tier of [2, 3, 4, 5, 6, 7] as const) expect(runRamp(0, tier)).toBe(1);
  });

  it("caps the encounter hazard by tier (user SF7): I 0.1, II 0.5, III and up the real hazard", () => {
    expect(TIER_ENCOUNTER_HAZARD_CEILING).toEqual({ 1: 0.1, 2: 0.5 });
    expect(encounterHazard(0.9, 1)).toBe(0.1);
    expect(encounterHazard(0.05, 1)).toBe(0.05);
    expect(encounterHazard(0.9, 2)).toBe(0.5);
    expect(encounterHazard(0.9, 3)).toBe(0.9);
    expect(encounterHazard(0.9, 7)).toBe(0.9);
  });

  it("gives the training run its own enemy scale and enemy cap; a ramped run scales on the curve, uncapped", () => {
    expect(runEnemyScale({ firstRun: true, ramp: 0 })).toBe(FIRST_RUN_ENEMY_SCALE);
    expect(runMaxEnemies({ firstRun: true })).toBe(FIRST_RUN_MAX_ENEMIES);
    expect(runEnemyScale({ firstRun: false, ramp: 0 })).toBe(RAMP_FLOOR);
    expect(runEnemyScale({ firstRun: false, ramp: 1 })).toBe(1);
    expect(runMaxEnemies({ firstRun: false })).toBeNull();
  });
});

describe("SF-1: the counters on a new game", () => {
  it("freshState starts every counter at zero, not a veteran", () => {
    const s = freshState();
    expect(s.runCounts).toEqual(freshRunCounts());
    expect(runCountsOf(s)).toEqual({
      version: 1,
      expedition: { completed: 0, trainingDone: false, veteran: false },
      patrol: { dispatched: 0, completed: 0, veteran: false },
      shortRange: {},
    });
    expect(isWellFormedRunCounts(s.runCounts)).toBe(true);
  });

  it("the training run is the first expedition FROM AN EXPLORER (user SF3), whichever hull flew before", () => {
    const s = freshState();
    for (const hull of ["orion", "aurora", "eir"] as const) {
      expect(isTrainingExpedition(s, hull)).toBe(true);
      expect(isFirstRun(s, "expedition", hull)).toBe(true);
    }
    for (const hull of ["generalFreighter", "destroyer", "prospectorRunner"] as const) expect(isTrainingExpedition(s, hull)).toBe(false);
    expect(isFirstRun(s, "expedition")).toBe(false); // no hull named: no training run
    // A freighter's claimed run counts on the curve and leaves the training run for the first explorer.
    const afterFreighter = withCounts(s, countClaimedExpedition(runCountsOf(s), run()));
    expect(completedRuns(afterFreighter, "expedition")).toBe(1);
    expect(isTrainingExpedition(afterFreighter, "orion")).toBe(true);
  });

  it("one training run at a time: while a stamped training run is out, a second explorer flies a ramped run", () => {
    const s = freshState();
    const out = { ...s, expeditions: [run({ phase: "transit", difficulty: { version: 1, firstRun: true, ramp: 0, tier: 1 } })] };
    expect(isTrainingExpedition(out, "aurora")).toBe(false);
    const plain = { ...s, expeditions: [run({ phase: "transit" })] };
    expect(isTrainingExpedition(plain, "aurora")).toBe(true);
  });

  it("one safe patrol in total (user SF9): the first patrol dispatch on the save, either route", () => {
    const s = freshState();
    expect(isFirstRun(s, "patrol")).toBe(true);
    const once = withCounts(s, countPatrolDispatch(runCountsOf(s)));
    expect(isFirstRun(once, "patrol")).toBe(false);
    expect(runCountsOf(once).patrol.dispatched).toBe(1);
  });

  it("short-range missions (G1 contract): per template, first until that template has been dispatched", () => {
    const s = freshState();
    expect(isFirstRun(s, "shortRange", "anyTemplate")).toBe(true);
    expect(completedRuns(s, "shortRange", "anyTemplate")).toBe(0);
    const seen = withCounts(s, { ...freshRunCounts(), shortRange: { anyTemplate: { dispatched: 1, completed: 1 } } });
    expect(isFirstRun(seen, "shortRange", "anyTemplate")).toBe(false);
    expect(isFirstRun(seen, "shortRange", "other")).toBe(true);
    expect(completedRuns(seen, "shortRange", "anyTemplate")).toBe(1);
    expect(isFirstRun(s, "shortRange")).toBe(false); // no template named
  });
});

describe("SF-1: the claim rule (user SF5 completed runs minus the training run; SF16 a recalled training run carries over)", () => {
  const counts = freshRunCounts();
  const training = { version: 1 as const, firstRun: true, ramp: 0, tier: 1 as const };

  it("a claimed training run marks training done and does not count on the curve", () => {
    const next = countClaimedExpedition(counts, run({ difficulty: training }));
    expect(next.expedition).toEqual({ completed: 0, trainingDone: true, veteran: false });
  });

  it("a recalled training run carries the training run over: nothing changes", () => {
    expect(countClaimedExpedition(counts, run({ difficulty: training, recall: { version: 1, atSeconds: 1, phaseAtRecall: "transit", pickupSeconds: 0, returnSeconds: 0 } }))).toEqual(counts);
  });

  it("a claimed ordinary run counts once; a recalled one does not count (completed runs only)", () => {
    expect(countClaimedExpedition(counts, run()).expedition.completed).toBe(1);
    expect(countClaimedExpedition(counts, run({ difficulty: { ...training, firstRun: false, ramp: 0.2 } })).expedition.completed).toBe(1);
    expect(countClaimedExpedition(counts, run({ recall: { version: 1, atSeconds: 1, phaseAtRecall: "transit", pickupSeconds: 0, returnSeconds: 0 } }))).toEqual(counts);
  });

  it("patrol routes add on; zero or junk routes change nothing", () => {
    expect(countPatrolRuns(counts, 3).patrol.completed).toBe(3);
    expect(countPatrolRuns(counts, 0)).toBe(counts);
    expect(countPatrolRuns(counts, Number.NaN)).toBe(counts);
  });

  it("is pure: the input counts are never mutated", () => {
    const before = structuredClone(counts);
    countClaimedExpedition(counts, run({ difficulty: training }));
    countPatrolDispatch(counts);
    countPatrolRuns(counts, 2);
    expect(counts).toEqual(before);
  });
});

describe("SF-1: the stamp a dispatch would write (consumed by SF-2 to SF-4)", () => {
  it("a new game's first explorer run is the training run; a non-explorer's first run sits at the floor", () => {
    const s = freshState();
    expect(runDifficultyAt(s, "expedition", 1, "orion")).toEqual({ version: 1, firstRun: true, ramp: 0, tier: 1 });
    expect(runDifficultyAt(s, "expedition", 1, "generalFreighter")).toEqual({ version: 1, firstRun: false, ramp: 0, tier: 1 });
    expect(runDifficultyAt(s, "patrol", 1)).toEqual({ version: 1, firstRun: true, ramp: 0, tier: 1 });
  });

  it("after the training run the curve follows completed runs; Tier II reads full strength", () => {
    const done: RunCounts = { ...freshRunCounts(), expedition: { completed: 4, trainingDone: true, veteran: false } };
    const s = withCounts(freshState(), done);
    // SF-3 review: the odds (affix roll, ambushes) one run behind the enemy curve.
    expect(runDifficultyAt(s, "expedition", 1, "orion")).toEqual({ version: 1, firstRun: false, ramp: rampFraction(4), tier: 1, oddsRamp: rampFraction(3) });
    expect(runDifficultyAt(s, "expedition", 2, "orion")).toEqual({ version: 1, firstRun: false, ramp: 1, tier: 2 });
  });

  it("a veteran (a save that flew the type before 0.14.0) reads today's difficulty: no training run, full ramp", () => {
    const vet: RunCounts = {
      ...freshRunCounts(),
      expedition: { completed: 1, trainingDone: true, veteran: true },
      patrol: { dispatched: 4, completed: 1, veteran: true },
    };
    const s = withCounts(freshState(), vet);
    expect(runDifficultyAt(s, "expedition", 1, "orion")).toEqual({ version: 1, firstRun: false, ramp: 1, tier: 1 });
    expect(runDifficultyAt(s, "patrol", 1)).toEqual({ version: 1, firstRun: false, ramp: 1, tier: 1 });
  });
});

describe("SF-1: the engine writes the counters", () => {
  it("claimExpedition counts a claimed run (SF-2: the training run marks training done, an ordinary run counts once) and changes nothing else", () => {
    // SF-2: an Eir's first run is the training run (stamped); its claim marks training done and is not counted.
    const crewed = withCrew(onHull("eir"), "rank3");
    const first = startExpedition(crewed, "ship-1", 1, "cand-1");
    expect(first.expedition!.difficulty?.firstRun).toBe(true);
    const trained = claimExpedition({ ...first.next, expeditions: [advanceExpedition(first.expedition!, 3_000_000)] }, first.expedition!.id);
    expect(trained.success).toBe(true);
    expect(runCountsOf(trained.next).expedition).toEqual({ completed: 0, trainingDone: true, veteran: false });
    // An ordinary run (training done; SF-3: the curve's stamp, run 2 at the floor). A full rank-3 Eir finishes every
    // fresh candidate (plan section 2.5 A), so the run reaches its claim.
    const ordinary = { ...crewed, runCounts: { ...crewed.runCounts!, expedition: { completed: 0, trainingDone: true, veteran: false } } };
    const res = startExpedition(ordinary, "ship-1", 1, "cand-1");
    expect(res.success).toBe(true);
    expect(res.expedition!.difficulty).toEqual({ version: 1, firstRun: false, ramp: 0, tier: 1 });
    expect(res.next.runCounts).toEqual(ordinary.runCounts); // dispatch writes no counter
    const done = advanceExpedition(res.expedition!, 3_000_000);
    expect(done.phase).toBe("complete");
    const before = { ...res.next, expeditions: [done] };
    const claim = claimExpedition(before, done.id);
    expect(claim.success).toBe(true);
    expect(runCountsOf(claim.next).expedition).toEqual({ completed: 1, trainingDone: true, veteran: false });
    const { runCounts: _a, ...rest } = claim.next;
    const { runCounts: _b, ...restWithoutCount } = claimExpedition({ ...before, runCounts: undefined }, done.id).next;
    expect(restWithoutCount).toEqual(rest);
  });

  it("a dispatch stores the counters a state without them reads, so it never flips to veteran (SF-1 review)", () => {
    const crewed = { ...withCrew(onHull("eir"), "rank3"), runCounts: undefined };
    expect(isTrainingExpedition(crewed, "eir")).toBe(true);
    const res = startExpedition(crewed, "ship-1", 1, "cand-1");
    expect(res.success).toBe(true);
    expect(res.next.runCounts).toEqual(freshRunCounts());
    expect(runCountsOf(res.next).expedition.veteran).toBe(false);
    const stored = withCrew(onHull("eir"), "rank3");
    expect(startExpedition(stored, "ship-1", 1, "cand-1").next.runCounts).toBe(stored.runCounts);
  });

  it("a refused claim writes nothing (the same reference)", () => {
    const s = freshState();
    expect(claimExpedition(s, "expedition-404").next).toBe(s);
  });

  it("a patrol dispatch counts once; a refused dispatch writes nothing", () => {
    const s = onHull("destroyer");
    const r = dispatchCaptainOnPatrol(s, 1, "crimsonReaverSweep", "balanced", false);
    expect(r.success).toBe(true);
    expect(runCountsOf(r.next).patrol.dispatched).toBe(1);
    const again = dispatchCaptainOnPatrol(r.next, 1, "crimsonReaverSweep", "balanced", false);
    expect(again.success).toBe(false);
    expect(again.next).toBe(r.next);
  });

  // SF-4: the save's first patrol is the training cycle, whose route stays off the curve (SF5 "minus the tutorial run").
  it("each patrol RUN counts once on the patrol curve (the training run excepted), the same in one call or one tick at a time", () => {
    // SF-4, user 2026-10-21 "One step per patrol run": a Repeat run is one step however many routes it wins.
    const flown = (s: GameState) => {
      const r = dispatchCaptainOnPatrol(s, 1, "crimsonReaverSweep", "balanced", true);
      expect(r.success).toBe(true);
      const big = economyTick(r.next, 400, RNG);
      let stepped = r.next;
      for (let i = 0; i < 400; i++) stepped = economyTick(stepped, 1, RNG);
      const won = Number(big.lifetimeStats.missionsCompleted.crimsonReaverSweep ?? new Decimal(0));
      expect(won).toBeGreaterThan(1);
      expect(runCountsOf(stepped).patrol).toEqual(runCountsOf(big).patrol);
      return runCountsOf(big).patrol;
    };
    const s = onHull("destroyer");
    expect(flown(s)).toEqual({ dispatched: 1, completed: 0, veteran: false });
    const second = { ...s, runCounts: { ...runCountsOf(s), patrol: { dispatched: 1, completed: 0, veteran: false } } };
    expect(flown(second)).toEqual({ dispatched: 2, completed: 1, veteran: false });
  });

  it("a tick with no won route leaves the counters as they were (the same reference)", () => {
    const s = freshState();
    expect(economyTick(s, 5, RNG).runCounts).toBe(s.runCounts);
  });
});

describe("SF-1: SAVE v70, existing saves count as done (veterans)", () => {
  // A v69 save: the current state serialized, runCounts removed (no v69 save holds it), the version set back.
  function v69(state: GameState): SaveFile {
    const raw = JSON.parse(JSON.stringify(deserialize(serialize(state, 0)))) as SaveFile;
    delete (raw.state as unknown as Record<string, unknown>).runCounts;
    return { ...raw, version: 69 };
  }

  it("v70 is the shared bump (no v71)", () => {
    expect(SAVE_VERSION).toBe(71); // E5-1 took v71 (the board evacuation stamp); this feature added no bump
  });

  it("a save that never flew anything starts fresh: the first explorer run is the training run", () => {
    const restored = migrate(v69(freshState()));
    expect(restored.runCounts).toEqual(freshRunCounts());
    expect(isTrainingExpedition(restored, "orion")).toBe(true);
    expect(isFirstRun(restored, "patrol")).toBe(true);
  });

  it("a save with claimed expeditions and patrol history is a veteran of both", () => {
    const base = freshState();
    const flown: GameState = {
      ...base,
      nextExpeditionId: 4,
      expeditions: [run({ id: "expedition-3", phase: "transit" })],
      nextPatrolSeed: 5,
      lifetimeStats: {
        ...base.lifetimeStats,
        missionsCompleted: { crimsonReaverSweep: new Decimal(2), crimsonReaverWarband: new Decimal(1), localFuelRun: new Decimal(7) },
      },
    };
    const restored = migrate(v69(flown));
    expect(restored.runCounts).toEqual({
      version: 1,
      expedition: { completed: 2, trainingDone: true, veteran: true },
      patrol: { dispatched: 4, completed: 3, veteran: true },
      shortRange: {},
    });
    expect(isTrainingExpedition(restored, "orion")).toBe(false);
    expect(isFirstRun(restored, "patrol")).toBe(false);
  });

  it("an in-flight run alone makes an expedition veteran; a won route alone makes a patrol veteran", () => {
    const base = freshState();
    const inFlight = migrate(v69({ ...base, nextExpeditionId: 2, expeditions: [run({ id: "expedition-1", phase: "scanning" })] }));
    expect(inFlight.runCounts!.expedition).toEqual({ completed: 0, trainingDone: true, veteran: true });
    expect(inFlight.runCounts!.patrol.veteran).toBe(false);
    const wonOnly = migrate(v69({
      ...base,
      lifetimeStats: { ...base.lifetimeStats, missionsCompleted: { crimsonReaverSweep: new Decimal(1) } },
    }));
    expect(wonOnly.runCounts!.patrol).toEqual({ dispatched: 1, completed: 1, veteran: true });
    expect(wonOnly.runCounts!.expedition.veteran).toBe(false);
  });

  it("an in-flight run is unchanged by the migration and counts once at its claim", () => {
    const crewed = withCrew(onHull("eir"), "rank3");
    // SF-2: a v69 save's in-flight run was dispatched before SF-2 (no training stamp, the shakedown), so before CP-14 too:
    // it froze the Eir's sensors without its base sensors (withoutCp14).
    const res = asPreSafeFirstRunsDispatch(withoutCp14(() => startExpedition(crewed, "ship-1", 1, "cand-1")));
    const restored = migrate(v69(res.next));
    expect(restored.expeditions).toEqual(res.next.expeditions);
    expect(restored.runCounts!.expedition).toEqual({ completed: 0, trainingDone: true, veteran: true });
    const done = advanceExpedition(restored.expeditions[0], 3_000_000);
    expect(done.phase).toBe("complete");
    const claim = claimExpedition({ ...restored, expeditions: [done] }, done.id);
    expect(claim.next.runCounts!.expedition).toEqual({ completed: 1, trainingDone: true, veteran: true });
  });

  it("the derivation is frozen, hardened and idempotent", () => {
    const junk = veteranRunCountsV70({ nextExpeditionId: "x", expeditions: "y", nextPatrolSeed: null, lifetimeStats: { missionsCompleted: { crimsonReaverSweep: "nope" } } });
    expect(junk).toEqual(freshRunCounts());
    expect(veteranRunCountsV70(null)).toEqual(freshRunCounts());
    const once = migrate(v69(freshState()));
    const raw = JSON.parse(JSON.stringify(deserialize(serialize(once, 0)))) as SaveFile;
    const twice = migrate({ ...raw, version: 69 });
    expect(twice.runCounts).toEqual(once.runCounts);
  });

  it("round-trips through serialize and deserialize", () => {
    const s = withCounts(freshState(), { ...freshRunCounts(), expedition: { completed: 3, trainingDone: true, veteran: false }, shortRange: { t: { dispatched: 2, completed: 1 } } });
    const back = migrate(deserialize(serialize(s, 0))!);
    expect(back.runCounts).toEqual(s.runCounts);
  });

  it("a current-version state without counters (a dev save from before SF-1) reads them from its history", () => {
    const s = { ...freshState(), runCounts: undefined, nextExpeditionId: 3 };
    expect(runCountsOf(s).expedition).toEqual({ completed: 2, trainingDone: true, veteran: true });
    expect(runCountsOf({ ...freshState(), runCounts: undefined })).toEqual(freshRunCounts());
  });
});
