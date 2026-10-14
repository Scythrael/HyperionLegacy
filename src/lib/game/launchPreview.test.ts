// Squads SQ-6 (docs/plans/2026-10-12-squads-and-subspace-telescope-design.md sections 6.3 to 6.6): the TASK PREVIEW
// on the candidate's own seed (it equals the run's stamped tasks, at today's Tier I and at a forced Tier IV), the
// candidate's detail gating (Per body: the demand, Recommendation: the recommendation, Forecast: the forecast; never
// more than the detail allows), the FORECAST against a real dispatch, "Set composition" through the recommendation,
// the BLIND LAUNCH COUNTER (user, SQ-5 call (b)), and the proof that previews change nothing about a run.

import { describe, expect, it } from "vitest";
import {
  SUBSPACE_TELESCOPE_FACILITY_KEY,
  freshState,
  type AwayMember,
  type Expedition,
  type GameState,
  type GroundTeamKind,
  type ShipGroundTeam,
} from "./model";
import {
  FORECAST_EXPEDITION_ID,
  advanceExpedition,
  compositionFightOdds,
  expeditionCandidates,
  expeditionRiskPreview,
  launchForecast,
  launchViewMemoSize,
  simulateLaunch,
  startExpedition,
  systemTaskPreview,
} from "./expedition";
import { generateRiskProfile, hostileSiteFieldable, type ExpeditionRegion } from "./riskFactors";
import { crewSquadsOf } from "./groundOps";
import { shipTeamKinds } from "./groundComposition";
import { applyComposition } from "./groundTeams";
import { THREAT_TIER_ORDER } from "./combat/threatAssessment";
import { TELESCOPE_DETAIL, blindLaunchCount } from "./telescope";
import { forecastTasksText, previewForHull, recommendLaunch, taskDemand, taskDemandText, type SystemTaskPreview } from "./launchRecommendation";
import { deserialize, migrate, serialize } from "./save";
import { plainAwayMember } from "./awayTeamTestFixtures";

const T0 = 100_000;

function atLevel(level: number, base: GameState): GameState {
  return { ...base, facilities: { ...base.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level } } };
}

// ship-1 (General Freighter, 3 / 3): Alpha and Bravo both Ground and fully slotted with rank-10 members (so runs
// finish), plus two Security members and one Science member in the reserve (so a type change can fill its new
// squad). `seedShift` moves the per-save expedition seed, so a test can sweep many systems.
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const RESERVE: [string, AwayMember["teamType"]][] = [
  ["member-7", "security"],
  ["member-8", "security"],
  ["member-17", "science"],
];
function crewedState(seedShift = 0): GameState {
  const base = freshState();
  const strong = (id: string, type: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, type, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  return {
    ...base,
    gameTimeSeconds: T0,
    expeditionSeed: (base.expeditionSeed + Math.imul(seedShift, 0x9e3779b9)) >>> 0,
    awayMembers: [...SEC.map((id) => strong(id, "security")), ...SCI.map((id) => strong(id, "science")), ...RESERVE.map(([id, t]) => strong(id, t))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

// The run's stamped tasks in the preview's shape (body order, then discovery order).
function stampedTasks(exp: Expedition): SystemTaskPreview["tasks"] {
  return exp.bodies.flatMap((b, bodyIndex) =>
    b.activities.map((t) => ({
      bodyIndex,
      poiId: t.poiId,
      hostile: t.poiId === "enemyColony" || t.poiId === "enemyFortification",
      fightPoints: t.fightPoints?.length ?? 0,
      needs: { ...t.needs! },
      difficulty: t.difficulty!,
    })),
  );
}

// Dispatch candidate 0, optionally on a forced region (the run's risk replaced before any body is scanned, the
// groundOpsRisk.test.ts posture), and advance past the scan.
function dispatchAndScan(state: GameState, region?: ExpeditionRegion): Expedition {
  const res = startExpedition(state, "ship-1", 1, "cand-0");
  expect(res.success, String(res.reason)).toBe(true);
  let exp = res.expedition!;
  if (region) {
    const forced = generateRiskProfile(exp.seed, region, exp.bodies);
    exp = { ...exp, risk: forced.profile, bodies: exp.bodies.map((b, i) => ({ ...b, risk: forced.bodies[i] })) };
  }
  const scanned = advanceExpedition(exp, T0 + 30_000);
  expect(scanned.bodies.every((b) => b.scanned)).toBe(true);
  return scanned;
}

describe("the task preview equals the run's stamped tasks (the forecast cannot lie)", () => {
  it("at today's Tier I, over many systems", () => {
    let tasks = 0;
    for (let k = 0; k < 16; k++) {
      const s = crewedState(k);
      const exp = dispatchAndScan(s);
      const preview = systemTaskPreview(exp.seed, exp.scanParams);
      expect(preview.tier).toBe(1);
      expect(preview.bodies).toEqual(expeditionRiskPreview(exp.seed).bodies);
      expect(stampedTasks(exp), `system ${k}`).toEqual(preview.tasks);
      for (const t of preview.tasks) expect(t.needs.security <= 1 && t.needs.science <= 1).toBe(true); // safe tiers adapt
      tasks += preview.tasks.length;
    }
    expect(tasks).toBeGreaterThan(30);
  });

  it("at a forced Tier IV in enemy territory: needs as rolled, hostile sites listed and revealed only where fielded", () => {
    const region: ExpeditionRegion = { tier: 4, enemyTerritory: true };
    let heavy = 0;
    let sites = 0;
    for (let k = 0; k < 24; k++) {
      const s = crewedState(k);
      const exp = dispatchAndScan(s, region);
      const preview = systemTaskPreview(exp.seed, exp.scanParams, region);
      const deployed = crewSquadsOf(exp.groundOps!.teams);
      const fielded = preview.tasks.filter((t) => !t.hostile || hostileSiteFieldable(t.poiId as "enemyColony", deployed));
      expect(stampedTasks(exp), `system ${k}`).toEqual(fielded);
      heavy += preview.tasks.filter((t) => t.needs.security >= 2 || t.needs.science >= 2).length;
      sites += preview.tasks.filter((t) => t.hostile).length;
    }
    expect(heavy, "Tier IV asks for 2 squads of a type somewhere").toBeGreaterThan(0);
    expect(sites, "enemy territory places a colony somewhere").toBeGreaterThan(0);
  });
});

describe("the candidate carries only what its detail shows", () => {
  const s = crewedState();
  const params = startExpedition(s, "ship-1", 1, "cand-0").expedition!.scanParams; // the ship's scan params

  it("Graded (Level 1): no demand, no recommendation, no forecast", () => {
    for (const c of expeditionCandidates(atLevel(1, s), "ship-1")) {
      expect(c.telescope.detail).toBe(TELESCOPE_DETAIL.graded);
      expect([c.telescope.demand, c.telescope.recommendation, c.telescope.forecast]).toEqual([null, null, null]);
    }
  });

  it("Per body (Level 3) adds the task demand of the system", () => {
    for (const c of expeditionCandidates(atLevel(3, s), "ship-1")) {
      const preview = previewForHull(systemTaskPreview(c.seed, params), "generalFreighter");
      expect(c.telescope.demand).toEqual(taskDemand(preview));
      expect(taskDemandText(c.telescope.demand!)).toMatch(/bod(y|ies)/);
      expect([c.telescope.recommendation, c.telescope.forecast]).toEqual([null, null]);
    }
  });

  it("Recommendation (Level 5) adds the odds-aware recommendation for this ship's composition", () => {
    const s5 = atLevel(5, s);
    for (const c of expeditionCandidates(s5, "ship-1")) {
      const preview = previewForHull(systemTaskPreview(c.seed, params), "generalFreighter");
      const oddsOf = (kinds: readonly GroundTeamKind[]) => compositionFightOdds(s5, "ship-1", c.seed, kinds, preview);
      expect(c.telescope.recommendation).toEqual(recommendLaunch(preview, "generalFreighter", ["ground", "ground"], oddsOf));
      expect(c.telescope.recommendation!.ranked.some((r) => r.fightOdds !== null)).toBe(true);
      expect(c.telescope.forecast).toBeNull();
    }
  });

  it("Forecast (Level 7) adds the forecast for the recommended composition", () => {
    for (const c of expeditionCandidates(atLevel(7, s), "ship-1")) {
      expect(c.telescope.forecast).toEqual(launchForecast(s, "ship-1", c.seed, c.telescope.recommendation!.kinds));
      expect(c.telescope.forecast!.label).toBe(c.telescope.recommendation!.label);
    }
  });

  it("a blind candidate carries none of it", () => {
    for (const c of expeditionCandidates(atLevel(0, s), "ship-1")) {
      expect(c.telescope.blind).toBe(true);
      expect([c.telescope.demand, c.telescope.recommendation, c.telescope.forecast]).toEqual([null, null, null]);
    }
  });
});

describe("the forecast (design 6.3 Forecast) against a real dispatch", () => {
  it("counts the tasks the run works per grade, what it leaves, and names the hardest fight and its crew", () => {
    let fights = 0;
    for (let k = 0; k < 10; k++) {
      const s = crewedState(k);
      const cand = expeditionCandidates(s, "ship-1")[0];
      const kinds = shipTeamKinds(s.ships[0]);
      const f = launchForecast(s, "ship-1", cand.seed, kinds)!;
      expect(f.teamsDeployed).toBe(2);
      const exp = dispatchAndScan(s);
      const all = exp.bodies.flatMap((b) => b.activities);
      const worked = all.filter((t) => t.status !== "skipped");
      expect(f.tasks).toBe(worked.length);
      expect(f.unfinished).toBe(all.length - worked.length);
      expect(f.byDifficulty).toEqual([1, 2, 3, 4, 5].map((g) => worked.filter((t) => t.difficulty === g).length));
      expect(forecastTasksText(f)).toMatch(/^\d+ tasks?: /);
      if (f.hardest) {
        fights += 1;
        const task = all.find((t) => t.poiId === f.hardest!.poiId && exp.bodies[f.hardest!.bodyIndex].activities.includes(t))!;
        expect(task.assignedTeamIds).toEqual(f.hardest.crew);
        expect(THREAT_TIER_ORDER).toContain(f.threat!.tier);
        expect(f.note).toBeNull();
      } else {
        expect(f.note).toBe("No fights expected");
      }
      expect(launchForecast(s, "ship-1", cand.seed, kinds)).toEqual(f); // deterministic
    }
    expect(fights).toBeGreaterThan(0);
  });

  it("forecasts the composition it is asked for (set as Set composition would set it), and never touches the state", () => {
    const s = crewedState();
    const before = JSON.stringify(s);
    const kinds: GroundTeamKind[] = ["ground", "survey"];
    const f = launchForecast(s, "ship-1", expeditionCandidates(s, "ship-1")[0].seed, kinds)!;
    expect(f.label).toBe("Survey + Ground");
    expect(f.kinds).toEqual(kinds);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("with no ground team ready it still counts the tasks, with no threat read", () => {
    const base = crewedState();
    const empty: GameState = { ...base, ships: base.ships.map((sh) => ({ ...sh, groundTeams: undefined })) }; // everyone in the reserve
    const f = launchForecast(empty, "ship-1", expeditionCandidates(empty, "ship-1")[0].seed, ["ground", "ground"])!;
    expect(f).toMatchObject({ teamsDeployed: 0, threat: null, hardest: null, note: "No ground team is ready to launch" });
    expect(f.tasks).toBeGreaterThan(0);
  });

  it("at a forced Tier IV in enemy territory the recommended composition is forecast", () => {
    const s = crewedState(3);
    const seed = expeditionCandidates(s, "ship-1")[0].seed;
    const region: ExpeditionRegion = { tier: 4, enemyTerritory: true };
    const preview = systemTaskPreview(seed, { scanRateMult: 1, coverageWidth: 1, landmarkOddsBias: 0, undergroundPoiOddsBias: 0 }, region);
    const rec = recommendLaunch(preview, "generalFreighter", shipTeamKinds(s.ships[0]))!;
    const f = launchForecast(s, "ship-1", seed, rec.kinds, region)!;
    expect(f.kinds).toEqual(rec.kinds);
    expect(f.tasks + f.unfinished).toBeGreaterThanOrEqual(preview.tasks.filter((t) => !t.hostile).length);
  });
});

describe("Set composition: the recommendation's one engine action", () => {
  it("applying the recommendation makes it the ship's current composition", () => {
    // Sweep systems until one recommends a change (most calm Tier I systems recommend Survey + Ground).
    for (let k = 0; k < 30; k++) {
      const s = atLevel(5, crewedState(k));
      const c = expeditionCandidates(s, "ship-1")[0];
      const rec = c.telescope.recommendation!;
      if (rec.isCurrent) continue;
      const next = applyComposition(s, "ship-1", rec.kinds);
      expect(next).not.toBe(s);
      expect([...shipTeamKinds(next.ships[0])].sort()).toEqual([...rec.kinds].sort());
      const again = expeditionCandidates(next, "ship-1")[0].telescope.recommendation!;
      expect(again.isCurrent).toBe(true);
      expect(again.headline).toBe(`Your ${rec.label} suits this system.`);
      return;
    }
    throw new Error("no system recommended a change");
  });
});

describe("the blind launch counter (user, SQ-5 call (b): start counting now)", () => {
  it("counts a dispatch beyond the telescope's range, and only that", () => {
    const s = crewedState();
    expect(blindLaunchCount(s)).toBe(0);
    const seen = startExpedition(atLevel(1, s), "ship-1", 1, "cand-0");
    expect(seen.success).toBe(true);
    expect("blindLaunches" in seen.next).toBe(false); // no key until the first blind launch
    const blind = startExpedition(atLevel(0, s), "ship-1", 1, "cand-0");
    expect(blind.next.blindLaunches).toBe(1);
    // A second blind launch (the first run claimed) counts on.
    const docked: GameState = { ...blind.next, expeditions: [] };
    const twice = startExpedition(docked, "ship-1", 1, "cand-1");
    expect(twice.next.blindLaunches).toBe(2);
    // An in-range launch leaves the count alone.
    const thenSeen = startExpedition(atLevel(1, { ...twice.next, expeditions: [] }), "ship-1", 1, "cand-0");
    expect(thenSeen.next.blindLaunches).toBe(2);
    // A refused dispatch counts nothing (and returns the SAME state).
    const s0 = atLevel(0, s);
    const refused = startExpedition(s0, "ship-1", 1, "cand-9");
    expect(refused).toMatchObject({ success: false, reason: "noSuchCandidate" });
    expect(refused.next).toBe(s0);
  });

  it("is optional and hardened: absent or corrupt reads 0, and it survives a save round trip", () => {
    for (const bad of [-2, 1.5, Number.NaN, "3" as unknown as number]) {
      const s = { ...crewedState(), blindLaunches: bad };
      expect(blindLaunchCount(s)).toBe(0);
      expect(startExpedition(atLevel(0, s), "ship-1", 1, "cand-0").next.blindLaunches).toBe(1);
    }
    const counted = { ...crewedState(), blindLaunches: 7 };
    const loaded = migrate(deserialize(serialize(counted, 0))!);
    expect(blindLaunchCount(loaded)).toBe(7);
    const plain = migrate(deserialize(serialize(crewedState(), 0))!);
    expect("blindLaunches" in plain).toBe(false);
    expect(blindLaunchCount(plain)).toBe(0);
  });
});

describe("display only: previews never change a run", () => {
  it("a dispatch after computing every preview (Forecast detail) equals one that computed none", () => {
    const s = atLevel(7, crewedState(5));
    const before = JSON.stringify(s);
    const direct = startExpedition(s, "ship-1", 1, "cand-1");
    for (let i = 0; i < 3; i++) {
      const cands = expeditionCandidates(s, "ship-1");
      expect(cands[1].telescope.forecast).not.toBeNull();
      systemTaskPreview(cands[1].seed, direct.expedition!.scanParams, { tier: 6, enemyTerritory: true });
    }
    expect(JSON.stringify(s)).toBe(before);
    const after = startExpedition(s, "ship-1", 1, "cand-1");
    expect(JSON.stringify(after.next)).toBe(JSON.stringify(direct.next));
    for (const t of [T0 + 30_000, T0 + 200_000]) {
      expect(JSON.stringify(advanceExpedition(after.expedition!, t))).toBe(JSON.stringify(advanceExpedition(direct.expedition!, t)));
    }
  });
});

describe("the SQ-6 follow-up: the simulated launch, the fight odds, the memo", () => {
  it("a simulated launch carries its own expedition id, never the one the real dispatch mints (review Minor 3)", () => {
    const s = crewedState(2);
    const sim = simulateLaunch(s, "ship-1", expeditionCandidates(s, "ship-1")[0].seed, ["ground", "ground"], { tier: 1, enemyTerritory: false })!;
    expect(sim.exp!.id).toBe(FORECAST_EXPEDITION_ID);
    expect(startExpedition(s, "ship-1", 1, "cand-0").expedition!.id).toBe(`expedition-${s.nextExpeditionId}`);
  });

  it("the fight odds are the weighted clear rate of the planned crews, and more Security reads better on a dangerous system", () => {
    // A weaker crew (rank 3) at a forced Tier IV in enemy territory, so the odds are not all certain.
    const region: ExpeditionRegion = { tier: 4, enemyTerritory: true };
    let better = 0;
    let read = 0;
    for (let k = 0; k < 12; k++) {
      const base = crewedState(k);
      const s: GameState = { ...base, awayMembers: base.awayMembers.map((m) => ({ ...m, rank: 3 as AwayMember["rank"] })) };
      const seed = expeditionCandidates(s, "ship-1")[0].seed;
      const preview = previewForHull(systemTaskPreview(seed, { scanRateMult: 1, coverageWidth: 1, landmarkOddsBias: 0, undergroundPoiOddsBias: 0 }, region), "generalFreighter");
      const gg = compositionFightOdds(s, "ship-1", seed, ["ground", "ground"], preview, region);
      const sg = compositionFightOdds(s, "ship-1", seed, ["ground", "strike"], preview, region);
      if (gg === null || sg === null) continue;
      read += 1;
      expect(gg).toBeGreaterThanOrEqual(0);
      expect(gg).toBeLessThanOrEqual(1);
      expect(compositionFightOdds(s, "ship-1", seed, ["ground", "strike"], preview, region)).toBe(sg); // deterministic
      if (sg > gg) better += 1;
    }
    expect(read).toBeGreaterThan(6);
    expect(better, "Strike + Ground clears more of the fights than Ground + Ground somewhere").toBeGreaterThan(0);
  });

  it("the launch view is memoized: an unrelated change hits, a change to the crew recomputes", () => {
    const s = atLevel(7, crewedState(9));
    const first = expeditionCandidates(s, "ship-1")[0].telescope;
    expect(first.forecast).not.toBeNull();
    // Time passes, credits move: the same objects come back (no forecast recomputed).
    const later: GameState = { ...s, gameTimeSeconds: s.gameTimeSeconds + 3600, credits: s.credits.add(500) };
    const again = expeditionCandidates(later, "ship-1")[0].telescope;
    expect(again.forecast).toBe(first.forecast);
    expect(again.recommendation).toBe(first.recommendation);
    // A composition change is related: a fresh view.
    const changed = applyComposition(s, "ship-1", ["ground", "strike"]);
    expect(expeditionCandidates(changed, "ship-1")[0].telescope.forecast).not.toBe(first.forecast);
    // A member's rank is related too.
    const ranked: GameState = { ...s, awayMembers: s.awayMembers.map((m) => (m.id === "member-1" ? { ...m, rank: 2 as AwayMember["rank"] } : m)) };
    expect(expeditionCandidates(ranked, "ship-1")[0].telescope.recommendation).not.toBe(first.recommendation);
    expect(launchViewMemoSize()).toBeLessThanOrEqual(32);
  });
});
