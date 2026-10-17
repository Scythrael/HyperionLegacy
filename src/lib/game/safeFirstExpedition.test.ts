// Safe first runs SF-2 (docs/plans/2026-10-15-safe-first-runs-plan.md section 3.2 and 4 SF-2, with the USER ANSWERS
// at its end): THE SAFE FIRST EXPEDITION. The training run is the first expedition FROM AN EXPLORER (Orion, Aurora,
// Eir; SF3), stamped at dispatch (Expedition.difficulty, runDifficulty.ts runDifficultyAt), and it cannot be lost with
// the weakest crew that can launch (OC-1, OC-2): one guard per fight at FIRST_RUN_ENEMY_SCALE of its strength with the
// hazard read as 0, no affixes, no ambushes, ship events that fire and always pass (SF8), and the backstop (a lost
// fight still clears its point, "The guards fell back. Training run: no setback.", SF12). The 30 minute shakedown is
// retired (group 3): the training run flies TUTORIAL_TRANSIT_SECONDS, equal to the regular transit for now.
//
// Here: the stamp and the transit, each profile effect against the same run without the stamp (never vacuous), the
// backstop with a crew that cannot win (incl. a wipe and its recovery leg, and offline == live on it), the forecast
// against the run, and the PROOF on a fixed sample (the three fresh candidates on every explorer with every crew, and
// a spread of Tier I seeds). The 500-seed proof is safeFirstExpedition.sweep.test.ts (gated: npm run test:sweep:training).

import { describe, expect, it } from "vitest";
import { SUBSPACE_TELESCOPE_FACILITY_KEY, type Expedition, type ExpeditionScanEvent, type GameState } from "./model";
import {
  ANOMALY_EXTRA_SECONDS,
  SHAKEDOWN_TRANSIT_SECONDS,
  TRANSIT_SECONDS,
  TUTORIAL_TRANSIT_SECONDS,
  advanceExpedition,
  claimExpedition,
  expeditionCandidates,
  expeditionLaunchView,
  makeExpeditionSeed,
  startExpedition,
} from "./expedition";
import { TRAINING_FELL_BACK_TEXT, groundOpsLogText } from "./groundOps";
import { generateEncounter } from "./gambit";
import { isTrainingRun } from "./enemyRanks";
import { groundSiteLabel } from "./expeditionContent";
import { FIRST_RUN_ENEMY_SCALE, FIRST_RUN_MAX_ENEMIES } from "./runDifficulty";
import { TELESCOPE_DETAIL } from "./telescope";
import { generateRiskProfile } from "./riskFactors";
import { BOARDING_ATTEMPT_CHANCE, SHIP_EVENT_DRAW_UNITS, chanceUnits, resolveShipScanEventFromDraws, type ShipEventDraws } from "./shipScanEvents";
import { asExpeditionVeteran, withoutSafeFirstRuns } from "./awayTeamTestFixtures";
import { SWEEP_END } from "./firstRunsGoldens.fixture";
import {
  D18,
  EXPLORERS,
  FRESH_CANDIDATES,
  RANK1,
  RANK1_COMPLEMENT,
  boardCrew,
  proveTrainingRun,
  provingState,
  type ProofCrew,
} from "./safeFirstExpedition.fixture";

// ===== helpers =====

function dispatched(state: GameState, cand = "cand-0"): { next: GameState; exp: Expedition } {
  const res = startExpedition(state, "ship-1", 1, cand);
  expect(res.success, String(res.reason)).toBe(true);
  return { next: res.next, exp: res.expedition! };
}

// The same run WITHOUT the training stamp (an ordinary run; nothing else changes). Pure.
function notTraining(exp: Expedition): Expedition {
  const rest = { ...exp };
  delete rest.difficulty;
  return rest;
}

// The run with a Security squad that cannot fight: no Security member in the frozen roster (every fight fields nobody:
// a loss of 0 rounds). Pure.
function unarmed(exp: Expedition): Expedition {
  return { ...exp, roster: { ...exp.roster!, security: [] } };
}

// The run with every Security member at 1 HP and no power (groundStats hp -0.99, power -1 on the frozen roster), so
// the guard always downs them: every fight is a WIPE (a recovery leg). Pure.
function frail(exp: Expedition): Expedition {
  const weak = exp.roster!.security.map((m) => ({ ...m, groundStats: { ...m.groundStats, hp: -0.99, power: -1 } }));
  return { ...exp, roster: { ...exp.roster!, security: weak } };
}

// The instant the run first leaves `phase`, walking 50 s chunks (every phase lasts longer). Pure.
function leaves(exp: Expedition, phase: string): number {
  let e = exp;
  for (let t = exp.phaseAnchorSeconds + 50; t < SWEEP_END; t += 50) {
    e = advanceExpedition(e, t);
    if (e.phase !== phase) return e.phaseAnchorSeconds;
  }
  throw new Error(`never left ${phase}`);
}

const DRAW_MAX = SHIP_EVENT_DRAW_UNITS - 1;
// Draws that land each kind with a failed check and an unrepelled boarding attempt (the worst roll of each kind).
const WORST: Record<string, ShipEventDraws> = {
  debris: { kind: 0, check: DRAW_MAX, cloaked: DRAW_MAX, boardingAttempt: 0, boardingRepel: DRAW_MAX },
  probe: { kind: 40, check: DRAW_MAX, cloaked: DRAW_MAX, boardingAttempt: 0, boardingRepel: DRAW_MAX },
  ghost: { kind: 70, check: DRAW_MAX, cloaked: DRAW_MAX, boardingAttempt: 0, boardingRepel: DRAW_MAX },
  cloaked: { kind: 70, check: DRAW_MAX, cloaked: 0, boardingAttempt: 0, boardingRepel: DRAW_MAX },
  storm: { kind: 90, check: DRAW_MAX, cloaked: DRAW_MAX, boardingAttempt: 0, boardingRepel: DRAW_MAX },
};

const setback = (e: ExpeditionScanEvent): boolean =>
  e.outcome === "fail" || e.outcome === "loss" || (e.pauseSeconds ?? 0) > 0 || (e.hullWear ?? 0) > 0 || (e.boarding !== undefined && !e.boarding.repelled);

// ===== the stamp and the transit =====

describe("SF-2 the training run: the first expedition from an explorer, stamped at dispatch", () => {
  for (const hull of EXPLORERS) {
    it(`${hull}: the first run is the training run (stamp, no shakedown, the tutorial transit equal to the regular one)`, () => {
      const { exp } = dispatched(provingState(hull, D18));
      expect(exp.difficulty).toEqual({ version: 1, firstRun: true, ramp: 0, tier: 1 });
      expect(isTrainingRun(exp)).toBe(true);
      expect(exp.shakedown).toBe(false);
      expect(TUTORIAL_TRANSIT_SECONDS).toBe(TRANSIT_SECONDS);
      const scanFrom = leaves(exp, "transit");
      expect(scanFrom - exp.phaseAnchorSeconds).toBe(TUTORIAL_TRANSIT_SECONDS + (advanceExpedition(exp, scanFrom).anomalyCharted ? ANOMALY_EXTRA_SECONDS : 0));
    });
  }

  it("a General Freighter's first run is NOT the training run (not an explorer) and flies the regular transit (the shakedown is retired)", () => {
    const { exp } = dispatched(provingState("generalFreighter", D18));
    expect(exp.difficulty).toBeUndefined();
    expect(exp.shakedown).toBe(false);
    const scanFrom = leaves(exp, "transit");
    expect(scanFrom - exp.phaseAnchorSeconds).toBe(TRANSIT_SECONDS + (advanceExpedition(exp, scanFrom).anomalyCharted ? ANOMALY_EXTRA_SECONDS : 0));
  });

  it("a veteran save (or one whose training run is claimed) flies an ordinary run: no stamp", () => {
    expect(dispatched(asExpeditionVeteran(provingState("orion", D18))).exp.difficulty).toBeUndefined();
    const s = provingState("eir", D18);
    const trained = { ...s, runCounts: { ...s.runCounts!, expedition: { completed: 0, trainingDone: true, veteran: false } } };
    expect(dispatched(trained).exp.difficulty).toBeUndefined();
  });

  it("a run in flight from before SF-2 (the shakedown stored, no stamp) keeps its 30 minute transit", () => {
    const legacy = withoutSafeFirstRuns(dispatched(provingState("orion", D18)).exp);
    expect(legacy.shakedown).toBe(true);
    expect(isTrainingRun(legacy)).toBe(false);
    const scanFrom = leaves(legacy, "transit");
    expect(scanFrom - legacy.phaseAnchorSeconds).toBe(SHAKEDOWN_TRANSIT_SECONDS + (advanceExpedition(legacy, scanFrom).anomalyCharted ? ANOMALY_EXTRA_SECONDS : 0));
  });

  it("the claimed training run marks training done and the next explorer run is ordinary; a RECALLED one carries over (SF16)", () => {
    const { next, exp } = dispatched(provingState("aurora", D18));
    const done = advanceExpedition(exp, SWEEP_END);
    expect(done.phase).toBe("complete");
    const at = { ...next, gameTimeSeconds: done.phaseAnchorSeconds };
    const claimed = claimExpedition({ ...at, expeditions: [done] }, done.id);
    expect(claimed.next.runCounts!.expedition).toEqual({ completed: 0, trainingDone: true, veteran: false });
    expect(dispatched(claimed.next).exp.difficulty).toBeUndefined();
    // G2-5's recall marker (read by shape until it lands): the training run carries over to the next dispatch.
    const recalled = claimExpedition({ ...at, expeditions: [{ ...done, recall: { at: done.phaseAnchorSeconds } } as Expedition] }, done.id);
    expect(recalled.success).toBe(true);
    expect(recalled.next.runCounts!.expedition.trainingDone).toBe(false);
    expect(isTrainingRun(dispatched(recalled.next).exp)).toBe(true);
  });
});

// ===== the profile, effect by effect =====

describe("SF-2 the training profile, each effect against the same run without the stamp", () => {
  it("generateEncounter: no profile is exactly today's guard; the profile keeps the first enemy at its scaled strength, same draws", () => {
    for (const poi of ["buriedVault", "subterraneanCivilization", "caveNetwork", "derelictOutpost", "unknownSite"]) {
      for (const seed of [1, 2, 3, 0x9e3779b9]) {
        expect(generateEncounter(seed, 0.65, poi, undefined)).toEqual(generateEncounter(seed, 0.65, poi));
        const base = generateEncounter(seed, 0, poi);
        const scaled = generateEncounter(seed, 0, poi, { scale: FIRST_RUN_ENEMY_SCALE, maxEnemies: FIRST_RUN_MAX_ENEMIES });
        expect(scaled).toHaveLength(FIRST_RUN_MAX_ENEMIES);
        expect(scaled[0]).toMatchObject({ id: base[0].id, role: base[0].role, armor: base[0].armor, accuracy: base[0].accuracy });
        expect(scaled[0].power).toBeCloseTo(base[0].power * FIRST_RUN_ENEMY_SCALE, 9);
        expect(scaled[0].heal).toBeCloseTo(base[0].heal * FIRST_RUN_ENEMY_SCALE, 9);
        expect(scaled[0].threat).toBe(scaled[0].power);
        expect(scaled[0].hp).toBeLessThan(base[0].hp);
      }
    }
  });

  // Tier I's calm objectives rarely carry an ambush chance, so each fresh run also gets a forced Tier IV twin (its risk
  // regenerated before any body scans, the launchPreview.test.ts pattern): the stamp, not the tier, removes them.
  it("no affixes and no ambushes on any objective (the same runs unstamped have both)", () => {
    let affixed = 0;
    let ambushable = 0;
    const scannedTasks = (e: Expedition) => advanceExpedition(e, e.phaseAnchorSeconds + TRANSIT_SECONDS + ANOMALY_EXTRA_SECONDS + 40_000).bodies.flatMap((b) => b.activities);
    for (const hull of EXPLORERS) {
      for (const cand of FRESH_CANDIDATES) {
        const { exp } = dispatched(provingState(hull, RANK1), cand);
        const forced = generateRiskProfile(exp.seed, { tier: 4, enemyTerritory: false }, exp.bodies);
        const tierFour: Expedition = { ...exp, risk: forced.profile, bodies: exp.bodies.map((b, i) => ({ ...b, risk: forced.bodies[i] })) };
        for (const run of [exp, tierFour]) {
          const tasks = scannedTasks(run);
          expect(tasks.length).toBeGreaterThan(0);
          for (const t of tasks) {
            expect(t.affixes, `${hull} ${cand} ${t.poiId}`).toBeUndefined();
            expect(t.ambushChance, `${hull} ${cand} ${t.poiId}`).toBeUndefined();
          }
          const plain = scannedTasks(notTraining(run));
          affixed += plain.filter((t) => (t.affixes ?? []).length > 0).length;
          ambushable += plain.filter((t) => (t.ambushChance ?? 0) > 0).length;
        }
      }
    }
    expect(affixed).toBeGreaterThan(0);
    expect(ambushable).toBeGreaterThan(0);
  });

  it("ship events fire and always pass: the worst draw of every kind is a pass (the bonus sides still pay), never a setback", () => {
    const { exp } = dispatched(provingState("orion", D18));
    const body = exp.bodies[0];
    let ordinarySetbacks = 0;
    for (const [kind, draws] of Object.entries(WORST)) {
      const { event, finding } = resolveShipScanEventFromDraws(exp, body, 0, 3, 1, draws);
      expect(event.event, kind).toBe(kind);
      expect(setback(event), `${kind}: ${JSON.stringify(event)}`).toBe(false);
      if (kind === "probe" || kind === "cloaked") {
        expect(event.outcome).toBe("win");
        expect(finding?.id).toBe(event.findingId); // the salvage still pays
        expect(draws.boardingAttempt < chanceUnits(BOARDING_ATTEMPT_CHANCE)).toBe(true);
        expect(event.boarding).toEqual({ repelled: true });
      } else {
        expect(event.outcome).toBe("pass");
        expect(finding).toBeNull();
        expect(event.bonusDiscovery ?? false).toBe(kind === "ghost"); // the ghost's find still pays
      }
      if (setback(resolveShipScanEventFromDraws(notTraining(exp), body, 0, 3, 1, draws).event)) ordinarySetbacks += 1;
    }
    expect(ordinarySetbacks).toBe(Object.keys(WORST).length);
  });
});

// ===== the backstop =====

describe("SF-2 the backstop: a lost fight on a training run still clears its point (the guards fell back)", () => {
  it("a crew that cannot fight at all still finishes 100%: every loss fell back, logged in the user's words, nothing set back", () => {
    const { exp } = dispatched(provingState("orion", D18), "cand-1");
    const done = advanceExpedition(unarmed(exp), SWEEP_END);
    expect(done.phase).toBe("complete");
    const tasks = done.bodies.flatMap((b) => b.activities);
    expect(tasks.every((t) => t.done)).toBe(true);
    for (const t of tasks) {
      expect(t.alert).toBeUndefined();
      expect(t.lossStreak).toBeUndefined();
      expect(t.sentBack).toBeUndefined();
      expect(t.pointsCleared ?? 0).toBe(t.fightPoints?.length ?? 0);
    }
    const history = done.groundOps!.history;
    const losses = history.filter((r) => r.outcome === "loss");
    expect(losses.length).toBeGreaterThan(0);
    expect(losses.every((r) => r.fellBack === true)).toBe(true);
    expect(history.filter((r) => r.outcome === "win")).toEqual([]);
    const lines = (done.groundOps!.log ?? []).filter((l) => l.kind === "trainingFellBack");
    expect(lines.length).toBe(losses.length);
    const first = lines[0];
    const task = tasks.find((t) => t.id === first.taskId)!;
    expect(groundOpsLogText(done, first)).toBe(`${groundSiteLabel(task.poiId)}: The guards fell back. Training run: no setback.`);
    expect(TRAINING_FELL_BACK_TEXT).toBe("The guards fell back. Training run: no setback.");
    // The same crew on the same run WITHOUT the stamp never clears a fight point: it stalls.
    const plain = advanceExpedition(unarmed(notTraining(exp)), SWEEP_END);
    expect(plain.phase).not.toBe("complete");
  });

  it("a crew wiped in every fight comes home on its recovery leg each time and the run still finishes 100%", () => {
    const { exp } = dispatched(provingState("eir", D18), "cand-2");
    const run = frail(exp);
    const done = advanceExpedition(run, SWEEP_END);
    expect(done.phase).toBe("complete");
    expect(done.bodies.flatMap((b) => b.activities).every((t) => t.done)).toBe(true);
    expect(done.groundOps!.shipLegs.length).toBeGreaterThan(0); // the recovery legs
    expect(done.groundOps!.history.some((r) => r.outcome === "loss" && r.fellBack === true)).toBe(true);
    expect(done.groundOps!.hullDamage ?? 0).toBe(0);
    expect(advanceExpedition(frail(notTraining(exp)), SWEEP_END).phase).not.toBe("complete");
  });

  it("offline == live on that run: one call == 997 s chunks == 1 s steps around the first recovery leg == the event-boundary chain", { timeout: 120_000 }, () => {
    const { exp } = dispatched(provingState("eir", D18), "cand-2");
    const run = frail(exp);
    const frozen = structuredClone(run);
    const one = advanceExpedition(run, SWEEP_END);
    const end = one.phaseAnchorSeconds + 1;
    const whole = advanceExpedition(run, end);
    let e = run;
    for (let t = run.phaseAnchorSeconds + 997; t < end; t += 997) e = advanceExpedition(e, t);
    expect(advanceExpedition(e, end)).toEqual(whole);
    const leg = one.groundOps!.shipLegs[0];
    let s = advanceExpedition(run, leg.startsAt - 300);
    for (let t = leg.startsAt - 299; t <= leg.startsAt + 300; t += 1) s = advanceExpedition(s, t);
    expect(s).toEqual(advanceExpedition(run, leg.startsAt + 300));
    const times = new Set<number>([run.phaseAnchorSeconds]);
    const ops = one.groundOps!;
    for (const r of ops.history) for (const t of [r.startedAt, r.endedAt]) times.add(t);
    for (const l of ops.log ?? []) times.add(l.at);
    for (const l of ops.shipLegs) for (const t of [l.startsAt, l.arrivesAt, l.endsAt]) times.add(t);
    const chain = [...times].filter((t) => Number.isFinite(t) && t > 1 && t + 1 < end).sort((a, b) => a - b);
    expect(chain.length).toBeGreaterThan(20);
    e = run;
    for (const t of chain) for (const at of [t - 1, t, t + 1]) e = advanceExpedition(e, at);
    expect(advanceExpedition(e, end)).toEqual(whole);
    expect(run).toEqual(frozen);
  });
});

// ===== the forecast against the run =====

describe("SF-2 the launch forecast reads the training profile, and agrees with the run", () => {
  for (const hull of EXPLORERS) {
    it(`${hull}, D18 minimum crew, telescope Level 8: every fresh candidate's forecast leaves nothing unfinished at Guaranteed, and the run finishes`, () => {
      const crewed = provingState(hull, D18);
      const s = { ...crewed, facilities: { ...crewed.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level: 8 } } };
      for (const c of expeditionCandidates(s, "ship-1")) {
        expect(c.telescope.detail, c.id).toBe(TELESCOPE_DETAIL.forecast);
        const f = expeditionLaunchView(s, "ship-1", c).forecast!;
        expect(f, c.id).not.toBeNull();
        expect(f.unfinished, c.id).toBe(0);
        if (f.hardest) expect(f.threat?.tier, c.id).toBe("guaranteed");
        const proof = proveTrainingRun(s, c.id, `${hull} ${c.id}`);
        // The run works every forecast objective (a sensor ghost's bonus find, which no telescope foresees, may add more).
        expect(proof.objectives).toBeGreaterThanOrEqual(f.tasks);
      }
    });
  }
});

// ===== the proof on a fixed sample (the 500-seed sweep is gated) =====

const FRESH_CREWS: ProofCrew[] = [D18, ...[0, 1, 2, 3, 4, 5].map((w) => boardCrew(w)), boardCrew(0, true), RANK1, RANK1_COMPLEMENT];
const SAMPLE_SEEDS = [1, 7, 19, 42, 77, 128, 255, 400];

describe("SF-2 the proof (default sample): the training run cannot be lost", () => {
  for (const hull of EXPLORERS) {
    it(`${hull}: the three fresh-save candidates x the D18 minimum, the board hires at windows 0 to 5, all ten, full rank 1, full rank 1 with a complement`, { timeout: 120_000 }, () => {
      let fights = 0;
      for (const crew of FRESH_CREWS) for (const cand of FRESH_CANDIDATES) fights += proveTrainingRun(provingState(hull, crew), cand, `${hull} ${crew.name} ${cand}`).fights;
      expect(fights).toBeGreaterThan(0);
    });

    it(`${hull}: ${SAMPLE_SEEDS.length} Tier I seeds x the D18 minimum, a board hire, full rank 1, full rank 1 with a complement`, { timeout: 120_000 }, () => {
      for (const i of SAMPLE_SEEDS) {
        const seed = makeExpeditionSeed(0x5afe1, i);
        for (const crew of [D18, boardCrew(i % 6), RANK1, RANK1_COMPLEMENT]) proveTrainingRun(provingState(hull, crew, seed), "cand-0", `${hull} seed ${i} ${crew.name}`);
      }
    });
  }
});
