// Gas Giant Study GG-4 (plan docs/plans/2026-10-17-gas-giant-study-plan.md section 4 GG-4): NEBULAE. User call 2
// "System-level sweep": a nebula is a system-level feature on its own draw, swept by the ship after the bodies; call 12:
// the sweep takes 2 hours; the four kinds approved 2026-10-21. The signed-off v3 mockup, as drawn: the sweep sits on the
// ship lane after the bodies, uses no probe, and returns Standard to Stellar canisters.

import { describe, expect, it } from "vitest";
import { SUBSPACE_TELESCOPE_FACILITY_KEY, freshState, type AwayMember, type Expedition, type GameState, type ShipGroundTeam } from "./model";
import { advanceExpedition, claimExpedition, expeditionCandidates, expeditionLaunchView, heldSystems, recallExpedition, startExpedition, systemTaskPreview } from "./expedition";
import { groundOpsProgress, groundShipPosition, studyPickupAt } from "./groundOps";
import { taskDemand, taskDemandText } from "./launchRecommendation";
import { GAS_CANISTER_IDS, ITEM_BANDS, NEBULA_KINDS, RESEARCH_DATA_ITEM, RESEARCH_FAMILIES, type NebulaKindId } from "./gasGiantContent";
import {
  FAMOUS_NEBULA_KIND,
  NEBULA_CANISTERS_MAX,
  NEBULA_CANISTERS_MIN,
  NEBULA_PERMILLE_BY_TIER,
  NEBULA_SWEEP_BODY_INDEX,
  NEBULA_SWEEP_SECONDS,
  STUDY_RESEARCH_DATA_PERMILLE,
  STUDY_SURVEY_READOUT_PERMILLE,
  isStudyBody,
  nebulaCanisterRange,
  nebulaStampFor,
  rollNebulaReward,
  rollSystemNebula,
  studyDiveEvents,
  sweepsNebula,
} from "./gasGiantStudy";
import { ITEMS, type RegionTier } from "./model";
import { installMissingCombatBaselines } from "./tick";
import { difficultyWeight } from "./riskFactors";
import { asExpeditionVeteran, dispatchPastPropulsion, plainAwayMember, withoutNebula } from "./awayTeamTestFixtures";

const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const T0 = 100_000;
const FINAL = T0 + 8_000_000;
const TIERS: readonly RegionTier[] = [1, 2, 3, 4, 5, 6, 7];

function crewed(expeditionSeed?: number): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  return {
    ...base,
    gameTimeSeconds: T0,
    nextExpeditionId: 2,
    ...(expeditionSeed !== undefined ? { expeditionSeed } : {}),
    facilities: { ...base.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level: 8 } },
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

// Advance in 600 s steps until every body is scanned and every study (the sweep included) is done.
function settled(exp: Expedition): Expedition {
  let run = exp;
  const done = (r: Expedition) => r.bodies.every((b) => b.scanned) && (r.groundOps?.studyLegs ?? []).every((l) => l.done) && (r.groundOps?.studyLegs ?? []).some((l) => l.nebula === 1);
  for (let t = exp.phaseAnchorSeconds + 600; t < exp.phaseAnchorSeconds + 4_000_000 && !done(run); t += 600) run = advanceExpedition(run, t);
  expect(done(run)).toBe(true);
  return run;
}

// The first dispatched run (save seeds x tiers x slots) whose system holds a nebula and matches `want`.
function nebulaRun(want: (e: Expedition) => boolean): { state: GameState; next: GameState; exp: Expedition; candId: string } {
  for (let seed = 1; seed < 200; seed += 1) {
    const state = crewed(0x51f15e + seed * 977);
    for (const tier of TIERS) {
      for (const c of expeditionCandidates(state, "ship-1", tier)) {
        const res = dispatchPastPropulsion(state, "ship-1", 1, c.id);
        if (!res.success || !res.expedition?.nebula || !want(res.expedition)) continue;
        return { state, next: res.next, exp: res.expedition, candId: c.id };
      }
    }
  }
  throw new Error("no fixture nebula run");
}

const plainNebula = () => nebulaRun((e) => !e.study);
const giantLastNebula = () => nebulaRun((e) => e.study === 1 && isStudyBody(e, e.bodies[e.bodies.length - 1]));

describe("GG-4 the system's nebula draw", () => {
  it("is a pure function of the seed, the tier and the system, on its own stream", () => {
    for (let seed = 1; seed < 200; seed += 1) {
      expect(rollSystemNebula(seed * 7919, 3, "x")).toBe(rollSystemNebula(seed * 7919, 3, "x"));
    }
  });

  it("finds a nebula at each tier's per-mille (8% at Tier I rising to 20% at VII), a kind uniform over the four", () => {
    const N = 6000;
    for (const tier of TIERS) {
      let hits = 0;
      const kinds: Record<string, number> = {};
      for (let i = 0; i < N; i += 1) {
        const k = rollSystemNebula(Math.imul(i + 1, 0x9e3779b1) >>> 0, tier, "catalog-system");
        if (k === null) continue;
        hits += 1;
        kinds[k] = (kinds[k] ?? 0) + 1;
      }
      const p = NEBULA_PERMILLE_BY_TIER[tier] / 1000;
      expect(Math.abs(hits / N - p), `tier ${tier}`).toBeLessThan(0.02);
      for (const k of NEBULA_KINDS) expect(Math.abs((kinds[k.id] ?? 0) / hits - 0.25), k.id).toBeLessThan(0.06);
    }
    // Rising with the tier.
    for (let i = 1; i < TIERS.length; i += 1) expect(NEBULA_PERMILLE_BY_TIER[TIERS[i]]).toBeGreaterThan(NEBULA_PERMILLE_BY_TIER[TIERS[i - 1]]);
  });

  it("a famous nebula always holds its own kind (an emission nebula), whatever the draw", () => {
    for (const [id, kind] of Object.entries(FAMOUS_NEBULA_KIND)) {
      for (let seed = 1; seed < 100; seed += 1) expect(rollSystemNebula(seed, 2, id)).toBe(kind);
      expect(kind).toBe("emissionNebula");
    }
  });

  it("no nebula on a seed whose draw misses: no stamp, and the dispatch writes no key", () => {
    let missed = 0;
    for (let seed = 1; seed < 50; seed += 1) {
      if (rollSystemNebula(seed, 1, "catalog-system") !== null) continue;
      missed += 1;
      expect(nebulaStampFor(seed, 1, "catalog-system")).toBeUndefined();
    }
    expect(missed).toBeGreaterThan(30);
    // A real dispatch without one: no `nebula` key at all.
    const state = crewed();
    const plain = expeditionCandidates(state, "ship-1").map((c) => dispatchPastPropulsion(state, "ship-1", 1, c.id).expedition!).find((e) => !e.nebula);
    expect(plain).toBeDefined();
    expect("nebula" in plain!).toBe(false);
  });

  it("the fresh save's gas giant system (cand-1-2) holds one (the goldens' named move)", () => {
    const state = crewed();
    const c = expeditionCandidates(state, "ship-1").find((x) => x.id === "cand-1-2")!;
    const exp = dispatchPastPropulsion(state, "ship-1", 1, c.id).expedition!;
    expect(exp.nebula).toBeDefined();
    expect(systemTaskPreview(c.seed, exp.scanParams, c.region).nebula).toBe(exp.nebula!.kindId);
  });
});

describe("GG-4 previews equal the run", () => {
  it("task preview, task demand (its text) and the launch forecast name the nebula the dispatch stamps", () => {
    const { state, exp, candId } = plainNebula();
    const c = expeditionCandidates(state, "ship-1", exp.region!.tier).find((x) => x.id === candId)!;
    const preview = systemTaskPreview(c.seed, exp.scanParams, c.region);
    expect(preview.nebula).toBe(exp.nebula!.kindId);
    const demand = taskDemand(preview);
    expect(demand.nebulaSweep).toBe(1);
    expect(taskDemandText(demand)).toContain("1 nebula sweep, no squad needed");
    const view = expeditionLaunchView(state, "ship-1", c);
    expect(view.forecast?.nebula).toBe(exp.nebula!.kindId);
  });

  it("the demand text joins ship studies and the sweep", () => {
    const base = { bodies: 3, securityBodies: 1, tasks: 2, noSecurityTasks: 0, twoSecurityTasks: 0, twoScienceTasks: 0, maxSecurity: 1, maxScience: 1 };
    expect(taskDemandText({ ...base, shipStudies: 2, nebulaSweep: 1 })).toContain("2 ship studies and 1 nebula sweep, no squad needed");
    expect(taskDemandText({ ...base, shipStudies: 1 })).toContain("1 ship study, no squad needed");
    expect(taskDemandText(base)).not.toContain("no squad needed");
  });
});

describe("GG-4 the sweep leg", () => {
  it("starts once every body is scanned, lasts 2 hours, holds the ship, keeps the window open, and pays its reward", () => {
    const { exp } = plainNebula();
    const run = settled(exp);
    const legs = run.groundOps!.studyLegs!;
    const sweeps = legs.filter((l) => l.nebula === 1);
    expect(sweeps).toHaveLength(1);
    const sweep = sweeps[0];
    expect(sweep.bodyIndex).toBe(NEBULA_SWEEP_BODY_INDEX);
    expect(sweep.scanBodyIndex).toBeNull();
    expect(sweep.endsAt - sweep.startsAt).toBe(NEBULA_SWEEP_SECONDS);
    expect(sweep.done).toBe(true);
    expect(groundShipPosition(run, (sweep.startsAt + sweep.endsAt) / 2)).toEqual({ kind: "study", leg: sweep });
    // A shuttle docking during the sweep waits for its end.
    expect(studyPickupAt(run.groundOps!, sweep.startsAt + 10)).toBe(sweep.endsAt);
    const done = advanceExpedition(run, FINAL);
    expect(done.phase).toBe("complete");
    expect(done.groundOps!.endedAt!).toBeGreaterThanOrEqual(sweep.endsAt);
    const found = done.findings.filter((f) => f.id === `${done.id}-find-nebula`);
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual(rollNebulaReward(done, sweep.endsAt));
    expect(found[0].source).toBe("study");
    // No probe dives on a sweep.
    expect(studyDiveEvents(done).some((e) => e.bodyIndex === NEBULA_SWEEP_BODY_INDEX)).toBe(false);
  });

  it("follows the study of a giant that is the last body", () => {
    const { exp } = giantLastNebula();
    const run = settled(exp);
    const legs = run.groundOps!.studyLegs!;
    const giant = legs.find((l) => l.bodyIndex === exp.bodies.length - 1)!;
    const sweep = legs.find((l) => l.nebula === 1)!;
    expect(giant).toBeDefined();
    expect(sweep.startsAt).toBeGreaterThanOrEqual(giant.endsAt);
  });

  it("the run's progress counts the sweep at weight 1 (0 before, 1 once done)", () => {
    const { exp } = plainNebula();
    const run = settled(exp);
    const sweep = run.groundOps!.studyLegs!.find((l) => l.nebula === 1)!;
    // Read on the run as it stands at each instant (a finished leg reads whole).
    const read = (t: number) => {
      const live = advanceExpedition(exp, t);
      return { live, p: groundOpsProgress(live, t) };
    };
    const start = read(sweep.startsAt + 1);
    const mid = read((sweep.startsAt + sweep.endsAt) / 2);
    const end = read(sweep.endsAt + 1);
    expect(mid.p).toBeGreaterThan(start.p);
    expect(end.p).toBeGreaterThan(mid.p);
    // The sweep is one share at weight 1, half done at its midpoint: (sum + 0.5) / (total + 1) against sum / total.
    const t = (sweep.startsAt + sweep.endsAt) / 2;
    const without = groundOpsProgress(withoutNebula(mid.live), t);
    const total =
      mid.live.bodies.reduce((a, b) => a + b.activities.reduce((w, task) => w + difficultyWeight(task.difficulty), 0), 0) + mid.live.bodies.filter((b) => isStudyBody(mid.live, b)).length;
    expect(mid.p).toBeCloseTo((without * total + 0.5) / (total + 1), 9);
  });

  it("a run without the stamp (dispatched before GG-4) never sweeps", () => {
    const { exp } = plainNebula();
    const done = advanceExpedition(withoutNebula(exp), FINAL);
    expect((done.groundOps?.studyLegs ?? []).some((l) => l.nebula === 1)).toBe(false);
    expect(done.findings.some((f) => f.id.endsWith("-find-nebula"))).toBe(false);
    expect(sweepsNebula(withoutNebula(exp))).toBe(false);
  });

  it("one call == 997 s chunks == 1 s steps (around the sweep)", () => {
    const { exp } = plainNebula();
    const run = settled(exp);
    const sweep = run.groundOps!.studyLegs!.find((l) => l.nebula === 1)!;
    const end = Math.ceil(sweep.endsAt) + 50;
    const one = advanceExpedition(exp, end);
    let chunked = exp;
    for (let t = exp.phaseAnchorSeconds + 997; t < end; t += 997) chunked = advanceExpedition(chunked, t);
    expect(advanceExpedition(chunked, end)).toEqual(one);
    const from = Math.floor(sweep.startsAt) - 100;
    let stepped = advanceExpedition(exp, from);
    for (let t = from + 1; t <= from + 300; t += 1) stepped = advanceExpedition(stepped, t);
    expect(stepped).toEqual(advanceExpedition(exp, from + 300));
    // The sweep's end, stepped by the second.
    const near = Math.floor(sweep.endsAt) - 150;
    let late = advanceExpedition(exp, near);
    for (let t = near + 1; t <= near + 300; t += 1) late = advanceExpedition(late, t);
    expect(late).toEqual(advanceExpedition(exp, near + 300));
  });

  it("the claim appends the nebula's Survey Log readout when it rolled one", () => {
    // Search the fixture runs for a sweep that rolled a readout.
    for (let seed = 1; seed < 400; seed += 1) {
      const state = crewed(0x2b7c0d3 + seed * 131);
      for (const c of expeditionCandidates(state, "ship-1", 4)) {
        const res = dispatchPastPropulsion(state, "ship-1", 1, c.id);
        const exp = res.expedition;
        if (!exp?.nebula) continue;
        const reward = rollNebulaReward(exp, 0);
        if (!reward.survey) continue;
        const done = advanceExpedition(exp, FINAL);
        const claim = claimExpedition({ ...res.next, expeditions: [done] }, done.id);
        const entry = (claim.next.surveyLog ?? []).find((e) => e.kind === "nebula");
        expect(entry).toBeDefined();
        if (entry?.kind === "nebula") {
          expect(entry.kindId).toBe(exp.nebula.kindId);
          expect(entry.id).toBe(`${exp.id}-survey-nebula`);
          expect(entry.tier).toBe(exp.region!.tier);
        }
        return;
      }
    }
    throw new Error("no sweep with a readout in the fixture");
  });
});

describe("GG-4 the sweep's reward", () => {
  const synthetic = (kindId: NebulaKindId, seed: number, tier: RegionTier = 1) => ({
    id: "t",
    seed,
    systemName: "LB-0001",
    region: { version: 1 as const, tier, enemyTerritory: false, bearing: 0, distanceLy: 10 },
    nebula: { kindId },
  });

  it("over 2,000 sweeps per kind: canisters always in range, bands by the kind's odds, Radiant never; data 40%, readout 15%", () => {
    for (const k of NEBULA_KINDS) {
      const bands: Record<string, number> = { standard: 0, augmented: 0, stellar: 0, radiant: 0 };
      let canisters = 0;
      let data = 0;
      let survey = 0;
      const N = 2000;
      for (let i = 0; i < N; i += 1) {
        const f = rollNebulaReward(synthetic(k.id, Math.imul(i + 1, 0x85ebca6b) >>> 0), 0);
        let n = 0;
        for (const id of GAS_CANISTER_IDS) {
          const q = f.materials?.[id] ?? 0;
          n += q;
          bands[ITEMS[id].band!] += q;
        }
        expect(n).toBeGreaterThanOrEqual(NEBULA_CANISTERS_MIN);
        expect(n).toBeLessThanOrEqual(NEBULA_CANISTERS_MAX + 1);
        canisters += n;
        if (RESEARCH_FAMILIES.some((fam) => f.materials?.[RESEARCH_DATA_ITEM[fam]])) data += 1;
        if (f.survey) survey += 1;
        expect(f.materials?.ancientDataFragment).toBeUndefined();
      }
      expect(bands.radiant, k.id).toBe(0);
      for (const b of ITEM_BANDS) expect(Math.abs(bands[b] / canisters - k.bandOdds[b] / 100), `${k.id} ${b}`).toBeLessThan(0.02);
      expect(Math.abs(data / N - STUDY_RESEARCH_DATA_PERMILLE / 1000)).toBeLessThan(0.04);
      expect(Math.abs(survey / N - STUDY_SURVEY_READOUT_PERMILLE / 1000)).toBeLessThan(0.03);
    }
  });

  it("the tier haul scales the count (the forecast range reads the same scale)", () => {
    let low = 0;
    let high = 0;
    for (let i = 0; i < 300; i += 1) {
      const count = (tier: RegionTier) => GAS_CANISTER_IDS.reduce((a, id) => a + (rollNebulaReward(synthetic("molecularCloud", i * 31 + 7, tier), 0).materials?.[id] ?? 0), 0);
      low += count(1);
      high += count(7);
    }
    expect(high).toBeGreaterThan(low * 2);
    const [lo1, hi1] = nebulaCanisterRange(synthetic("molecularCloud", 1, 1));
    expect([lo1, hi1]).toEqual([NEBULA_CANISTERS_MIN, NEBULA_CANISTERS_MAX]);
    const [lo7, hi7] = nebulaCanisterRange(synthetic("molecularCloud", 1, 7));
    expect(lo7).toBeGreaterThan(lo1);
    expect(hi7).toBeGreaterThan(hi1);
  });

  it("is deterministic", () => {
    expect(rollNebulaReward(synthetic("supernovaRemnant", 99), 5)).toEqual(rollNebulaReward(synthetic("supernovaRemnant", 99), 5));
  });
});

describe("GG-4 x G2-5: a recalled system's nebula", () => {
  // A veteran Orion crew (gasGiantStudyResume.test.ts's fixture), Tier I, a system holding a nebula.
  function veteran(expeditionSeed: number): GameState {
    const s = crewed(expeditionSeed);
    return asExpeditionVeteran(installMissingCombatBaselines({ ...s, ships: s.ships.map((sh) => ({ ...sh, typeKey: "orion" as const })) }));
  }
  // The first launched run (over save seeds) holding a nebula whose window is still open `slack` seconds after the sweep.
  function launched(slack: number): { state: GameState; exp: Expedition; sweepStart: number; sweepEnd: number } {
    for (let seed = 1; seed < 600; seed += 1) {
      const s = veteran(seed);
      for (const c of expeditionCandidates(s, "ship-1", 1)) {
        const res = startExpedition(s, "ship-1", 1, c.id);
        if (!res.success || !res.expedition?.nebula) continue;
        const done = advanceExpedition(res.expedition, FINAL);
        const sweep = done.groundOps?.studyLegs?.find((l) => l.nebula === 1);
        if (!sweep || done.groundOps!.endedAt! < sweep.endsAt + slack) continue;
        return { state: res.next, exp: res.expedition, sweepStart: sweep.startsAt, sweepEnd: sweep.endsAt };
      }
    }
    throw new Error("no fixture nebula run");
  }
  const at = (state: GameState, t: number): GameState => ({ ...state, gameTimeSeconds: t });
  function recallAndClaim(state: GameState, exp: Expedition, t: number): GameState {
    const s1 = recallExpedition(at(state, t), exp.id);
    const home = advanceExpedition(s1.expeditions[0], FINAL);
    return claimExpedition({ ...s1, gameTimeSeconds: home.phaseAnchorSeconds, expeditions: [home] }, exp.id).next;
  }
  // Fly the held system again and finish it.
  function resumeAndFinish(s: GameState): Expedition {
    const held = heldSystems(s)[0];
    const res = startExpedition(s, "ship-1", 1, held.id);
    expect(res.success, res.reason).toBe(true);
    return advanceExpedition(res.expedition!, s.gameTimeSeconds + FINAL);
  }

  it("a recall during the sweep leaves a resumable system; the resumed run sweeps it and pays then, once", () => {
    const { state, exp, sweepStart, sweepEnd } = launched(0);
    const home = recallAndClaim(state, exp, (sweepStart + sweepEnd) / 2);
    const held = heldSystems(home);
    expect(held).toHaveLength(1);
    expect(held[0].kind).toBe("resume");
    expect(held[0].nebulaSwept).toBeUndefined();
    const again = resumeAndFinish(home);
    expect(again.nebula?.swept).toBeUndefined();
    expect(again.groundOps!.studyLegs!.filter((l) => l.nebula === 1)).toHaveLength(1);
    expect(again.findings.filter((f) => f.id.endsWith("-find-nebula"))).toHaveLength(1);
  });

  it("a sweep finished before the recall is not swept again on the resumed trip, and counts whole there", () => {
    const { state, exp, sweepEnd } = launched(900);
    const home = recallAndClaim(state, exp, sweepEnd + 300);
    const held = heldSystems(home);
    expect(held).toHaveLength(1);
    expect(held[0].nebulaSwept).toBe(true);
    const again = resumeAndFinish(home);
    expect(again.nebula?.swept).toBe(1);
    expect((again.groundOps?.studyLegs ?? []).some((l) => l.nebula === 1)).toBe(false);
    expect(again.findings.some((f) => f.id.endsWith("-find-nebula"))).toBe(false);
    expect(sweepsNebula(again)).toBe(false);
  });
});

