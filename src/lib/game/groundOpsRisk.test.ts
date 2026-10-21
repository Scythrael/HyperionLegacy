// Squads SQ-4 (docs/plans/2026-10-12-squads-and-subspace-telescope-design.md sections 4 and 5) on the engine: a
// risk-aware run (Expedition.risk + each body's risk grades, written at dispatch) stamps its tasks from the risk
// (fight points with a 0 floor, generated needs capped at the deployed squads, the difficulty grade, the ambush
// chance), places a hostile site only when the deployed squads can field it (user #3), lets flora slow the work,
// poison the fights and lift the Bloom, weights the completion by difficulty, raises the haul and relic find with
// risk (user #6), and meets an ambush on a crew with Security as a SURPRISE FIGHT (user, SQ-3 calls (c)). A flagged
// run dispatched before SQ-4 (no risk) keeps resolving byte-identically (goldens captured before the change).

import { describe, expect, it } from "vitest";
// SF-1: the claimed state hashes without the run counters (a claim writes them), absent before SF-1.
import { withoutRunCounts } from "./firstRunsGoldens.fixture";
import {
  freshState,
  type AwayMember,
  type BodyRiskGrades,
  type Expedition,
  type ExpeditionActivity,
  type ExpeditionBody,
  type ExpeditionPlanetType,
  type GameState,
  type GroundStepRecord,
  type GroundTeamKind,
  type RegionTier,
  type ShipGroundTeam,
} from "./model";
import { advanceExpedition, claimExpedition, expeditionCandidates, expeditionRiskPreview, startExpedition } from "./expedition";
import {
  RETURN_SECONDS,
  SURVEY_AMBUSH_CONDITIONS,
  SURVEY_AMBUSH_MAX_PER_TASK,
  groundOpsAssignIdle,
  groundOpsBodyScanned,
  groundOpsLogText,
  groundOpsProgress,
  groundTaskFindingPrefix,
  initGroundTasks,
} from "./groundOps";
import { FIGHT_POINTS_BY_POI, fightPointFractions, riskFightPointCount, taskFullHaul, taskWorkSeconds } from "./groundTasks";
import { resolveTaskFightOnSeed, withFloraToxins } from "./groundFight";
import { generateEncounter } from "./gambit";
import { groundTaskClearOdds, groundThreatOddsKey, remainingTaskFights } from "./groundThreat";
import { groundSiteLabel } from "./expeditionContent";
import { FLORA_POISON_PERMILLE_PER_GRADE, riskAmbushChance, riskRewardBonus } from "./riskFactors";
import { asPreCurveDispatch, asPreG2NamesDispatch, plainAwayMember, withSlottedAwayTeams, withoutEnemyRanks, withoutRisk } from "./awayTeamTestFixtures";

// ===== fixtures =====

const T0 = 100_000;
const FAR = T0 + 400_000;

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const member = (id: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({
  ...plainAwayMember(id, teamType, "ship-1"),
  ...over,
});
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const CREW: AwayMember[] = [
  ...SEC.map((id, k) => member(id, "security", { spec: k % 2 === 0 ? "offense" : "defense", rank: 3 })),
  ...SCI.map((id) => member(id, "science", { rank: 2 })),
];
const squad = (pool: string[]): (string | null)[] => [...pool.splice(0, 2), null];
const EMPTY_GROUND: ShipGroundTeam = { kind: "ground", security: [null, null, null], science: [null, null, null], helpOthers: false };

// A ship of the composition (General Freighter, 3 / 3 squads), members in id order; "one" = a single slotted Ground
// team and an empty pair (the migrated save's shape: one team deploys).
function compState(kinds: [GroundTeamKind, GroundTeamKind] | "one"): GameState {
  const base = freshState();
  const sec = [...SEC];
  const sci = [...SCI];
  const team = (kind: GroundTeamKind): ShipGroundTeam => {
    if (kind === "strike") return { kind, security: [...squad(sec), ...squad(sec)], science: [], helpOthers: false };
    if (kind === "survey") return { kind, security: [], science: [...squad(sci), ...squad(sci)], helpOthers: false };
    return { kind, security: squad(sec), science: squad(sci), helpOthers: false };
  };
  const teams = kinds === "one" ? [team("ground"), structuredClone(EMPTY_GROUND)] : kinds.map(team);
  return {
    ...base,
    gameTimeSeconds: T0 - 50_000,
    awayMembers: CREW.map((m) => ({ ...m })),
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

function dispatch(s: GameState): Expedition {
  const res = asPreCurveDispatch(asPreG2NamesDispatch(startExpedition(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id)));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return res.expedition;
}

const CALM: BodyRiskGrades = { combat: 0, fauna: 0, flora: 0, hazard: 0 };

interface RiskSetup {
  kinds: [GroundTeamKind, GroundTeamKind] | "one";
  pois: string[];
  risk: BodyRiskGrades;
  hazard?: number;
  planetType?: ExpeditionPlanetType;
  tier?: RegionTier;
  seed?: number;
  securityStrength?: number;
  scanning?: boolean;
  // Override a stamped field before the teams pick (e.g. a forced ambush chance); the stamping itself is real.
  after?: (e: Expedition) => void;
}

// A dispatched run of the composition turned into a risk-aware run whose window opened at T0 with body 0 (carrying
// `risk`) just scanned: its tasks stamped through the real path and planned by the default plan.
function riskRun(setup: RiskSetup): Expedition {
  // Field Kits FKR-1: the SQ-4 run as dispatched before enemy ranks, so its scenarios hold (a Deadly site's Boss is
  // groundOpsRanks.test.ts's business).
  const d = withoutEnemyRanks(dispatch(compState(setup.kinds)));
  const body: ExpeditionBody = {
    id: "body-1",
    planetType: setup.planetType ?? "terrestrial",
    scanTotal: 100,
    scanProgress: 100,
    hazard: setup.hazard ?? 0.1,
    scanned: true,
    discoveries: setup.pois.map((poiId, k) => ({ id: `${d.id}-body-1-disc-${k}`, kind: "landmark", poiId })),
    activities: setup.pois.map((poiId, k) => ({ id: `${d.id}-body-1-act-${k}`, bodyId: "body-1", poiId, done: false })),
    risk: { ...setup.risk },
  };
  const bodies: ExpeditionBody[] = [body];
  if (setup.scanning) {
    bodies.push({ id: "body-2", planetType: "terrestrial", scanTotal: 1e9, scanProgress: 0, hazard: 0.1, scanned: false, discoveries: [], activities: [], risk: { ...CALM } });
  }
  const exp: Expedition = structuredClone({
    ...d,
    seed: setup.seed ?? d.seed,
    ...(setup.securityStrength !== undefined ? { securityStrength: setup.securityStrength } : {}),
    phase: setup.scanning ? "scanning" : "activities",
    phaseAnchorSeconds: T0,
    bodies,
    scanStepCursor: Math.max(0, (d.encounterSteps ?? 1) - 1),
    groundOps: { ...d.groundOps!, startedAt: T0 },
    risk: { version: 1, tier: setup.tier ?? 1, enemyTerritory: false, system: { combat: setup.risk.combat, fauna: setup.risk.fauna, flora: setup.risk.flora } },
  });
  if (setup.after) {
    initGroundTasks(exp, 0);
    setup.after(exp);
    for (const team of exp.groundOps!.teams) team.stepStartedAt = T0;
  }
  groundOpsBodyScanned(exp, 0, T0);
  groundOpsAssignIdle(exp, T0);
  return exp;
}

const tasksOf = (e: Expedition): ExpeditionActivity[] => e.bodies[0].activities;
const historyOf = (e: Expedition, i: number): GroundStepRecord[] => e.groundOps!.history.filter((r) => r.teamIndex === i);

// ===== the gate: a flagged run dispatched before SQ-4 resolves exactly as stamped =====

describe("SQ-4 the gate: a flagged run without a risk profile resolves byte-identically (goldens captured before SQ-4)", () => {
  const m = (id: string, t: AwayMember["teamType"], over: Partial<AwayMember> = {}) => member(id, t, over);
  const CASES: Record<string, () => GameState> = {
    one: () =>
      withSlottedAwayTeams({
        ...freshState(),
        awayMembers: [m("member-1", "security", { rank: 3 }), m("member-2", "security", { rank: 2, traits: ["fieldMedic"] }), m("member-11", "science")],
        nextAwayMemberId: 100,
        expeditionSeed: 0x0a13bd4,
      }),
    two: () =>
      withSlottedAwayTeams(
        {
          ...freshState(),
          awayMembers: [m("member-1", "security", { rank: 3 }), m("member-2", "security"), m("member-3", "security"), m("member-4", "security"), m("member-11", "science"), m("member-12", "science")],
          nextAwayMemberId: 100,
          expeditionSeed: 0x1259124,
        },
        2,
      ),
    strikeSurvey: () => {
      const base = freshState();
      const teams: ShipGroundTeam[] = [
        { kind: "strike", security: ["member-1", "member-2", null, "member-3", "member-4", null], science: [], helpOthers: false },
        { kind: "survey", security: [], science: ["member-11", "member-12", null, "member-13", null, null], helpOthers: false },
      ];
      return {
        ...base,
        awayMembers: [
          m("member-1", "security", { rank: 3 }),
          m("member-2", "security", { rank: 3 }),
          m("member-3", "security", { rank: 3 }),
          m("member-4", "security", { rank: 3 }),
          m("member-11", "science"),
          m("member-12", "science"),
          m("member-13", "science"),
        ],
        nextAwayMemberId: 100,
        expeditionSeed: 0x0a13bd4,
        ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
      };
    },
  };
  // Captured from the code BEFORE SQ-4 (the same dispatches, which then carried no risk): five checkpoint hashes,
  // the phase at 2,000,000 s, and the claim's whole-state hash.
  const GOLDEN: Record<string, string[]> = {
    one: ["b5e78ca2", "f4e8f63", "abd0d346", "da70427b", "8c895b1b", "activities", "475677a0"],
    two: ["47be7059", "bc299cd3", "7b4b90d2", "36cce785", "f382e6f", "activities", "9287a767"],
    strikeSurvey: ["40e32963", "e1a668e9", "b51cf928", "441f98f9", "dab2c781", "activities", "658a12f1"],
  };
  for (const [name, build] of Object.entries(CASES)) {
    it(`${name}: checkpoints and the claim match the pre-SQ-4 capture`, { timeout: 120_000 }, () => {
      const s = build();
      const res = asPreCurveDispatch(asPreG2NamesDispatch(startExpedition(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id)));
      expect(res.success).toBe(true);
      expect(res.expedition!.risk).toBeDefined(); // a run dispatched today IS risk-aware
      const exp = withoutRisk(res.expedition!);
      const hashes = [5000, 20000, 60000, 150000, 400000].map((t) => fnv(JSON.stringify(advanceExpedition(exp, t))));
      const done = advanceExpedition(exp, 2_000_000);
      hashes.push(done.phase);
      // No task of the run carries a risk-aware stamp.
      for (const task of done.bodies.flatMap((b) => b.activities)) expect(task.difficulty).toBeUndefined();
      const claimed = claimExpedition({ ...res.next, expeditions: [done] }, done.id);
      hashes.push(fnv(JSON.stringify(withoutRunCounts(claimed.next))));
      expect(hashes).toEqual(GOLDEN[name]);
    });
  }
});

// ===== preview == run =====

describe("SQ-4 the risk profile: drawn at dispatch from the committed seed, so the preview never lies", () => {
  it("startExpedition stores exactly expeditionRiskPreview(seed): the profile and every body's grades", () => {
    for (let k = 0; k < 12; k += 1) {
      const s = { ...compState("one"), expeditionSeed: (0x51ed27 + k * 0x9e3779b) >>> 0 };
      for (const cand of expeditionCandidates(s, "ship-1")) {
        const res = asPreCurveDispatch(asPreG2NamesDispatch(startExpedition(s, "ship-1", 1, cand.id)));
        const exp = res.expedition!;
        const preview = expeditionRiskPreview(cand.seed);
        expect(exp.seed).toBe(cand.seed);
        expect(exp.risk).toEqual(preview.profile);
        expect(exp.bodies.map((b) => b.risk)).toEqual(preview.bodies);
        expect(exp.risk!.tier).toBe(1); // Tier I until G2
      }
    }
  });

  it("the preview is a pure, ship-independent read (stable across reads and compositions)", () => {
    const seed = 0x1234567;
    expect(expeditionRiskPreview(seed)).toEqual(expeditionRiskPreview(seed));
    const a = dispatch({ ...compState("one"), expeditionSeed: seed });
    const b = dispatch({ ...compState(["strike", "survey"]), expeditionSeed: seed });
    expect(a.risk).toEqual(b.risk);
    expect(a.bodies.map((x) => x.risk)).toEqual(b.bodies.map((x) => x.risk));
  });
});

// ===== stamping =====

describe("SQ-4 stamping a risk-aware body: fight points (floor 0), needs, difficulty, the ambush chance", () => {
  it("riskFightPointCount: table + combat mod + fauna mod at life sites + the hazard step, clamped to [0, 5]", () => {
    const r = (combat: number, fauna: number) => ({ combat, fauna }) as Pick<BodyRiskGrades, "combat" | "fauna">;
    expect(riskFightPointCount("mineralOutcrop", 0.1, r(0, 0))).toBe(0);
    expect(riskFightPointCount("mineralOutcrop", 0.1, r(2, 4))).toBe(FIGHT_POINTS_BY_POI.mineralOutcrop); // fauna: not a life site
    expect(riskFightPointCount("caveNetwork", 0.1, r(2, 0))).toBe(1); // 2 + 0 - 1
    expect(riskFightPointCount("caveNetwork", 0.1, r(2, 4))).toBe(4); // 2 + 0 + 2
    expect(riskFightPointCount("derelictOutpost", 0.65, r(4, 0))).toBe(5); // 4 + 2 + 1, clamped
    expect(riskFightPointCount("crashedShip", 0.65, r(1, 0))).toBe(3); // 3 - 1 + 1
    expect(riskFightPointCount("enemyColony", 0.1, r(0, 0))).toBe(4); // a hostile site's own count
    expect(riskFightPointCount("enemyFortification", 0.9, r(4, 4))).toBe(5);
  });

  it("a calm Tier I body is survey work: 0 fight points, needs { 0, 1 }, Simple; a Survey team takes it alone", () => {
    const e = riskRun({ kinds: ["strike", "survey"], pois: ["mineralOutcrop", "caveNetwork", "ancientRuins", "derelictOutpost"], risk: CALM });
    const [outcrop, cave, ruins, outpost] = tasksOf(e);
    for (const t of [outcrop, cave, ruins]) {
      expect(t).toMatchObject({ fightPoints: [], needs: { security: 0, science: 1 }, difficulty: 1, status: expect.any(String) });
      expect(t.ambushChance).toBeUndefined(); // combat and fauna None: no ambush chance
      expect(t.assignedTeamIds).toEqual([1]); // Survey alone
    }
    // The outpost keeps 2 fights (4 - 2): a { 1, 1 } task, Standard (2 + 0 + 1 + 0 = 3).
    expect(outpost).toMatchObject({ fightPoints: [1 / 3, 2 / 3], needs: { security: 1, science: 1 }, difficulty: 2 });
    expect(outpost.assignedTeamIds).toEqual([0, 1]);
    expect(e.groundOps!.log).toBeUndefined();
  });

  const DANGER: BodyRiskGrades = { combat: 4, fauna: 4, flora: 0, hazard: 3 };

  it("a dangerous Tier III body: fights up, 2 Security / 2 Science generated and kept as rolled, rated from them", () => {
    const e = riskRun({ kinds: ["ground", "ground"], pois: ["derelictOutpost", "subterraneanCivilization", "mineralOutcrop"], risk: DANGER, hazard: 0.65, tier: 3 });
    const [outpost, deep, outcrop] = tasksOf(e);
    expect(outpost).toMatchObject({ fightPoints: [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6], needs: { security: 2, science: 1 }, difficulty: 5 });
    expect(deep).toMatchObject({ needs: { security: 2, science: 2 }, difficulty: 5 }); // 5 + 2 + 3 + 2 = 12
    expect(outcrop).toMatchObject({ needs: { security: 2, science: 1 } }); // 1 + 2 + 1 = 4 fights
    // Ground + Ground covers { 2, 2 } only as a pair: every task is joint.
    for (const t of tasksOf(e)) expect(t.assignedTeamIds).toEqual([0, 1]);
  });

  it("SAFE TIERS ADAPT (user 2026-10-13): at Tiers I and II one deployed Ground team gets every task at { 1, 1 } at most; nothing is skipped", () => {
    for (const tier of [1, 2] as const) {
      const e = riskRun({ kinds: "one", pois: ["derelictOutpost", "subterraneanCivilization", "ancientRuins"], risk: DANGER, hazard: 0.65, tier });
      expect(e.groundOps!.teams.length).toBe(1);
      for (const t of tasksOf(e)) {
        expect(t.needs).toEqual({ security: 1, science: 1 });
        expect(["queued", "active"]).toContain(t.status);
        expect(t.assignedTeamIds).toEqual([0]);
        expect(t.difficulty).toBe(5); // the site's own (generated) demand, not the safe stamp
      }
      expect(e.groundOps!.log).toBeUndefined();
      expect(e.groundOps!.teams[0].queue.length).toBe(3);
    }
  });

  it("LATER SKIP: from Tier III a task the deployed squads cannot cover is skipped with its log line; the rest run and the window closes", () => {
    // One Ground team ({ 1, 1 } deployed) on a Tier III body: the outpost and the deep dig ask for 2 Security squads.
    // The bare outcrop asks { 1, 1 } and runs. Forced Tier III region (expeditionRegion is Tier I today).
    const risk: BodyRiskGrades = { combat: 2, fauna: 2, flora: 0, hazard: 0 };
    const e = riskRun({ kinds: "one", pois: ["derelictOutpost", "subterraneanCivilization", "mineralOutcrop"], risk, tier: 3 });
    const [outpost, deep, outcrop] = tasksOf(e);
    expect(outpost).toMatchObject({ needs: { security: 2, science: 1 }, status: "skipped" });
    expect(deep).toMatchObject({ needs: { security: 2, science: 2 }, status: "skipped" });
    expect(outpost.difficulty).toBeGreaterThanOrEqual(1);
    expect(outcrop.needs).toEqual({ security: 1, science: 1 });
    expect(outcrop.assignedTeamIds).toEqual([0]);
    const log = e.groundOps!.log!;
    expect(log.map((l) => l.taskId)).toEqual([outpost.id, deep.id]);
    expect(groundOpsLogText(e, log[0])).toBe("Skipped Derelict Outpost: needs 2 Security squads, 1 deployed");
    expect(groundOpsLogText(e, log[1])).toBe("Skipped Subterranean Civilization: needs 2 Security squads, 1 deployed; 2 Science squads, 1 deployed");
    expect(e.groundOps!.teams[0].queue).toEqual([outcrop.id]);
    // The run goes on: the skipped tasks are left unfinished and never hold the window open.
    const done = advanceExpedition(e, FAR);
    expect(tasksOf(done)[0].status).toBe("skipped");
    expect(tasksOf(done)[2].status).toBe("done");
    expect(done.groundOps!.endedAt).toBeDefined();
  });

  it("Tier III with the squads for it: the same tasks are planned (joint crews), none skipped", () => {
    const risk: BodyRiskGrades = { combat: 2, fauna: 2, flora: 0, hazard: 0 };
    const e = riskRun({ kinds: ["ground", "ground"], pois: ["derelictOutpost", "subterraneanCivilization", "mineralOutcrop"], risk, tier: 3 });
    expect(tasksOf(e).map((t) => t.status === "skipped")).toEqual([false, false, false]);
    expect(tasksOf(e)[0].assignedTeamIds).toEqual([0, 1]);
    expect(e.groundOps!.log).toBeUndefined();
  });

  it("a calm task on a risky body takes the body's ambush chance (the worse of combat and fauna)", () => {
    const risk: BodyRiskGrades = { combat: 0, fauna: 3, flora: 0, hazard: 0 };
    const e = riskRun({ kinds: ["strike", "survey"], pois: ["mineralOutcrop", "caveNetwork"], risk });
    const [outcrop, cave] = tasksOf(e);
    expect(outcrop).toMatchObject({ fightPoints: [], ambushChance: riskAmbushChance(risk) });
    expect(cave.fightPoints!.length).toBeGreaterThan(0); // a life site: fauna adds fights, so no ambush chance
    expect(cave.ambushChance).toBeUndefined();
  });
});

// ===== the threat read before stamping (review Minor 1) =====

describe("SQ-4 the threat read of an UNSTAMPED task follows the body's risk", () => {
  it("counts the risk-aware fight points, and the memo key tells combat / fauna grades apart", () => {
    const e = riskRun({ kinds: "one", pois: ["mineralOutcrop"], risk: CALM });
    const task = { id: "t", poiId: "derelictOutpost", fightCount: 0, pointsCleared: 0 };
    const calm = { hazard: 0.1, risk: { ...CALM } };
    const hot = { hazard: 0.1, risk: { ...CALM, combat: 4 as const } };
    expect(remainingTaskFights(task, calm)).toBe(riskFightPointCount("derelictOutpost", 0.1, calm.risk)); // 2
    expect(remainingTaskFights(task, hot)).toBe(5);
    expect(remainingTaskFights(task, { hazard: 0.1 })).toBe(FIGHT_POINTS_BY_POI.derelictOutpost); // no risk: GO-4
    const side = [{ securityIds: e.groundOps!.teams[0].securityIds, securityShare: 1 }];
    expect(groundThreatOddsKey(e, side, calm, task, 0, 8)).not.toBe(groundThreatOddsKey(e, side, hot, task, 0, 8));
    expect(groundThreatOddsKey(e, side, hot, task, 0, 8)).not.toBe(groundThreatOddsKey(e, side, { hazard: 0.1, risk: { ...CALM, fauna: 4 } }, task, 0, 8));
    // A hotter body never reads easier on the same samples.
    expect(groundTaskClearOdds(e, side, hot, task, 0, 8).wins).toBeLessThanOrEqual(groundTaskClearOdds(e, side, calm, task, 0, 8).wins);
  });
});

// ===== hostile sites =====

describe("SQ-4 hostile sites join a scanned body only when the deployed squads can field them (user #3)", () => {
  // A real dispatched run with body 0's risk placing an Enemy Colony there, advanced past body 0's scan.
  function colonyRun(kinds: [GroundTeamKind, GroundTeamKind] | "one"): Expedition {
    const d = structuredClone(dispatch({ ...compState(kinds), expeditionSeed: 0x0a13bd4 }));
    d.bodies[0].risk = { ...d.bodies[0].risk!, combat: 4, site: "enemyColony" };
    d.risk = { ...d.risk!, tier: 3 }; // a forced Tier III region (expeditionRegion is Tier I today)
    let t = d.phaseAnchorSeconds;
    let e = d;
    while (!e.bodies[0].scanned) e = advanceExpedition(d, (t += 300));
    return e;
  }

  it("Ground + Ground (2 Security, 2 Science deployed): the colony is the body's last task, { 2, 1 }, 4 fights, joint", () => {
    const e = colonyRun(["ground", "ground"]);
    const body = e.bodies[0];
    const colony = body.activities[body.activities.length - 1];
    expect(colony.poiId).toBe("enemyColony");
    expect(body.discoveries[body.discoveries.length - 1].poiId).toBe("enemyColony");
    expect(colony).toMatchObject({ needs: { security: 2, science: 1 }, fightPoints: fightPointFractions(4) });
    expect(colony.difficulty).toBeGreaterThanOrEqual(4);
    expect(colony.assignedTeamIds).toEqual([0, 1]);
    expect(groundSiteLabel("enemyColony")).toBe("Enemy Colony");
    // The drawn discoveries before it are the same as without the site.
    const plain = structuredClone(dispatch({ ...compState(["ground", "ground"]), expeditionSeed: 0x0a13bd4 }));
    let t = plain.phaseAnchorSeconds;
    let p = plain;
    while (!p.bodies[0].scanned) p = advanceExpedition(plain, (t += 300));
    expect(body.discoveries.slice(0, -1).map((x) => x.poiId)).toEqual(p.bodies[0].discoveries.map((x) => x.poiId));
  });

  it("one deployed Ground team (1 Security squad): no colony at all (never generated, so never even a skip)", () => {
    const e = colonyRun("one");
    expect(e.bodies[0].activities.some((a) => a.poiId === "enemyColony")).toBe(false);
    expect(e.bodies[0].discoveries.some((x) => x.poiId === "enemyColony")).toBe(false);
    // At the forced Tier III the body's OTHER risky tasks may be skipped for squads (LATER SKIP), never the colony.
    const named = (e.groundOps!.log ?? []).map((l) => e.bodies[0].activities.find((a) => a.id === l.taskId)?.poiId);
    expect(named).not.toContain("enemyColony");
  });
});

// ===== flora =====

describe("SQ-4 flora: slower work, poisoned fights, more Blooms", () => {
  it("work time: 5% longer per flora grade; a risk body with no flora reads exactly the no-risk time", () => {
    const e = riskRun({ kinds: "one", pois: ["mineralOutcrop"], risk: CALM });
    const team = { securityIds: e.groundOps!.teams[0].securityIds, scienceIds: e.groundOps!.teams[0].scienceIds, scienceShare: 1 };
    const body = { planetType: "terrestrial" as const, hazard: 0.4 };
    const base = taskWorkSeconds(e, [team], body);
    expect(taskWorkSeconds(e, [team], { ...body, risk: { ...CALM } })).toBe(base);
    const raw = taskWorkSeconds(e, [team], { ...body, risk: { ...CALM, flora: 4 } });
    expect(Math.abs(raw - base * 1.2)).toBeLessThanOrEqual(1);
    expect(raw).toBeGreaterThan(base);
  });

  it("withFloraToxins: every guard gains Poison on its attacks (a poisoner's chance rises; other afflictions stay); flora 0 is untouched", () => {
    const guard = generateEncounter(777, 0.4, "xenoFloraBloom"); // a caster (poison) and a swarm
    const same = withFloraToxins(guard.map((g) => ({ ...g })), 0);
    expect(same.map((g) => g.statusOnHit)).toEqual(guard.map((g) => g.statusOnHit));
    const toxic = withFloraToxins(guard.map((g) => ({ ...g })), 3);
    for (let i = 0; i < guard.length; i += 1) {
      const before = guard[i].statusOnHit;
      if (!before) expect(toxic[i].statusOnHit).toEqual({ id: "poison", permille: 3 * FLORA_POISON_PERMILLE_PER_GRADE });
      else if (before.id === "poison") expect(toxic[i].statusOnHit).toEqual({ id: "poison", permille: before.permille + 3 * FLORA_POISON_PERMILLE_PER_GRADE });
      else expect(toxic[i].statusOnHit).toEqual(before);
    }
  });

  it("a toxic-biosphere body's fights poison the squad; the same fights on a flora-free body never do (no poisoners there)", () => {
    const e = riskRun({ kinds: "one", pois: ["mineralOutcrop"], risk: CALM });
    const side = [{ securityIds: e.groundOps!.teams[0].securityIds, securityShare: 1 }];
    const task = { id: "t", poiId: "mineralOutcrop", fightCount: 0, pointsCleared: 0 };
    let calm = 0;
    let toxic = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const poisoned = (risk: BodyRiskGrades) =>
        Object.values(resolveTaskFightOnSeed(e, side, { hazard: 0.1, risk }, task, seed).memberConditions).some((c) => c.includes("poison"));
      if (poisoned({ ...CALM })) calm += 1;
      if (poisoned({ ...CALM, flora: 4 })) toxic += 1;
    }
    expect(calm).toBe(0);
    expect(toxic).toBeGreaterThan(0);
  });

  it("a High or Extreme flora body draws more Xeno-Flora Blooms from the SAME discovery draws", () => {
    let calm = 0;
    let lush = 0;
    for (let k = 0; k < 30; k += 1) {
      const d = dispatch({ ...compState("one"), expeditionSeed: (0x77e1 + k * 0x2545f49) >>> 0 });
      const scan = (flora: number) => {
        const x = structuredClone(d);
        x.bodies[0].risk = { ...x.bodies[0].risk!, flora: flora as BodyRiskGrades["flora"], site: undefined };
        delete x.bodies[0].risk.site;
        let t = x.phaseAnchorSeconds;
        let e = x;
        while (!e.bodies[0].scanned) e = advanceExpedition(x, (t += 600));
        return e.bodies[0].discoveries;
      };
      const a = scan(0);
      const b = scan(4);
      expect(b.length).toBe(a.length); // the same draws: only the picks move
      calm += a.filter((x) => x.poiId === "xenoFloraBloom").length;
      lush += b.filter((x) => x.poiId === "xenoFloraBloom").length;
    }
    expect(lush).toBeGreaterThan(calm);
  });
});

// ===== completion and rewards =====

describe("SQ-4 completion weights and the risk reward (user #6)", () => {
  it("groundOpsProgress weights each task by its difficulty (1 / 2 / 3 / 5 / 8); unrated tasks weigh evenly", () => {
    const e = riskRun({ kinds: "one", pois: ["mineralOutcrop", "mineralOutcrop"], risk: CALM });
    const x = structuredClone(e);
    const [a, b] = tasksOf(x);
    for (const team of x.groundOps!.teams) team.taskId = undefined;
    a.done = true;
    a.status = "done";
    a.difficulty = 1;
    b.status = "queued";
    b.progress = 0;
    b.difficulty = 5;
    expect(groundOpsProgress(x, T0)).toBeCloseTo(1 / 9, 12);
    delete a.difficulty;
    delete b.difficulty;
    expect(groundOpsProgress(x, T0)).toBe(0.5);
  });

  it("the haul: a rated task's offload pays its full haul scaled by its risk bonus on the same draws", () => {
    const e = riskRun({ kinds: "one", pois: ["mineralOutcrop"], risk: { combat: 4, fauna: 0, flora: 0, hazard: 3 }, hazard: 0.65 });
    const done = advanceExpedition(e, FAR);
    const task = tasksOf(done)[0];
    expect(task.status).toBe("done");
    const bonus = riskRewardBonus(task.difficulty);
    expect(bonus).toBeGreaterThan(0);
    const team = done.groundOps!.teams[0];
    const full = taskFullHaul(done, [{ securityIds: team.securityIds, scienceIds: team.scienceIds, scienceShare: 1 }], done.bodies[0], task.poiId, 0, bonus);
    const plain = taskFullHaul(done, [{ securityIds: team.securityIds, scienceIds: team.scienceIds, scienceShare: 1 }], done.bodies[0], task.poiId, 0);
    const paid = done.findings.filter((f) => f.id.startsWith(groundTaskFindingPrefix(done, task.id)));
    const credits = paid.reduce((sum, f) => sum + (f.credits ?? 0), 0);
    expect(credits).toBe(full.credits);
    expect(full.credits).toBeGreaterThan(plain.credits);
    expect(taskFullHaul(done, [], done.bodies[0], task.poiId, 0, 0)).toEqual(taskFullHaul(done, [], done.bodies[0], task.poiId, 0));
  });

  it("the relic: on the same draw, a Deadly task finds a relic wherever the unrated one does, and more often", () => {
    let plain = 0;
    let deadly = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const relicOf = (difficulty: number | undefined) => {
        const e = riskRun({
          kinds: "one",
          pois: ["ancientRuins"],
          risk: CALM,
          seed,
          after: (x) => {
            const t = tasksOf(x)[0];
            if (difficulty === undefined) delete t.difficulty;
            else t.difficulty = difficulty;
          },
        });
        const done = advanceExpedition(e, FAR);
        return done.findings.some((f) => f.relic);
      };
      const a = relicOf(undefined);
      const b = relicOf(5);
      if (a) expect(b, `seed ${seed}`).toBe(true);
      if (a) plain += 1;
      if (b) deadly += 1;
    }
    expect(deadly).toBeGreaterThan(plain);
  });
});

// ===== the surprise fight =====

describe("SQ-4 THE SURPRISE FIGHT (user, SQ-3 calls (c)): an ambush on a crew with Security is fought where it stands", () => {
  const ambushed = (over: Partial<RiskSetup> = {}) =>
    riskRun({
      kinds: "one",
      pois: ["mineralOutcrop"],
      risk: CALM,
      after: (x) => {
        tasksOf(x)[0].ambushChance = 1;
      },
      ...over,
    });

  it("win: the work goes on from the same spot, no fight point passes, no return in between", () => {
    const e = ambushed();
    const done = advanceExpedition(e, FAR);
    const lane = historyOf(done, 0);
    const cut = lane.filter((r) => r.step === "work" && r.ambushed);
    expect(cut.length).toBe(SURVEY_AMBUSH_MAX_PER_TASK);
    const first = cut[0];
    const fight = lane.find((r) => r.startedAt === first.endedAt)!;
    expect(fight).toMatchObject({ step: "fight", surprise: true, outcome: "win" });
    // The next work step starts where the ambush struck.
    const resumed = advanceExpedition(e, fight.endedAt);
    const team = resumed.groundOps!.teams[0];
    expect(team.step).toBe("work");
    expect(team.workFrom).toBe(tasksOf(resumed)[0].progress);
    expect(tasksOf(resumed)[0].pointsCleared).toBe(0);
    expect(tasksOf(done)[0]).toMatchObject({ status: "done", progress: 1, pointsCleared: 0, ambushes: SURVEY_AMBUSH_MAX_PER_TASK });
    expect(lane.filter((r) => r.step === "return").length).toBe(1); // only the trip home at 100%
  });

  it("loss: an ordinary loss, a wipe waits for the ship, the task is queued with its progress kept", () => {
    const e = ambushed({ securityStrength: 0, hazard: 0.9, risk: { ...CALM, hazard: 4 } });
    const at = (t: number) => advanceExpedition(e, t);
    const done = at(T0 + 3600);
    const lane = historyOf(done, 0);
    const fight = lane.find((r) => r.step === "fight" && r.surprise)!;
    expect(fight.outcome).toBe("loss");
    const after = at(fight.endedAt);
    const task = tasksOf(after)[0];
    expect(task.status).toBe("queued");
    expect(task.progress).toBeGreaterThan(0);
    expect(task.progress).toBeLessThan(1);
    expect(task.ambushes).toBe(1);
    expect(task.pointsCleared).toBe(0);
    expect(after.groundOps!.shipLegs.length).toBe(1); // the whole Security squad down: a wipe, a recovery leg
    expect(lane.find((r) => r.step === "return" && r.startedAt === fight.endedAt)).toMatchObject({ recovered: true });
  });
});

// ===== end to end: a Survey team clears a 0-fight task, ambush included (SQ-3 review) =====

describe("SQ-4 end to end: a Survey team clears a calm task alone, ambushed on the way", () => {
  it("stamped from the body's risk (0 fights, { 0, 1 }, the risk's ambush chance), retreats, comes back, finishes and pays", () => {
    const risk: BodyRiskGrades = { combat: 1, fauna: 3, flora: 0, hazard: 0 };
    let found: Expedition | null = null;
    for (let seed = 1; seed <= 400 && !found; seed += 1) {
      const e = riskRun({ kinds: ["strike", "survey"], pois: ["mineralOutcrop"], risk, seed });
      const done = advanceExpedition(e, FAR);
      if (historyOf(done, 1).some((r) => r.step === "work" && r.ambushed)) found = e;
    }
    expect(found).not.toBeNull();
    const e = found!;
    const stamped = tasksOf(e)[0];
    expect(stamped).toMatchObject({ fightPoints: [], needs: { security: 0, science: 1 }, ambushChance: riskAmbushChance(risk), assignedTeamIds: [1] });
    const done = advanceExpedition(e, FAR);
    const task = tasksOf(done)[0];
    expect(task).toMatchObject({ status: "done", done: true, progress: 1 });
    expect(task.ambushes).toBeGreaterThanOrEqual(1);
    expect(task.ambushes).toBeLessThanOrEqual(SURVEY_AMBUSH_MAX_PER_TASK);
    const lane = historyOf(done, 1);
    expect(lane.some((r) => r.step === "fight")).toBe(false); // Survey never fights
    const cut = lane.find((r) => r.step === "work" && r.ambushed)!;
    const back = advanceExpedition(e, cut.endedAt);
    expect(back.groundOps!.teams[1]).toMatchObject({ step: "return", stepEndsAt: cut.endedAt + RETURN_SECONDS });
    for (const id of back.groundOps!.teams[1].scienceIds) expect(back.groundOps!.teams[1].conditions[id]).toEqual([...SURVEY_AMBUSH_CONDITIONS]);
    // The Strike team never touched it; one finding paid at the completing offload.
    expect(historyOf(done, 0).some((r) => r.taskId === task.id)).toBe(false);
    expect(done.findings.filter((f) => f.id.startsWith(groundTaskFindingPrefix(done, task.id))).length).toBe(1);
    expect(done.groundOps!.shipLegs).toEqual([]);
  });
});

// ===== parity =====

describe("SQ-4 PARITY: one big advance == 997 s chunks == 1 s chunks", () => {
  it("a risky run with a surprise fight and a Survey retreat, over 2 hours", { timeout: 240_000 }, () => {
    // Combat Low keeps the outcrops calm (1 - 1 = 0 fights); Extreme fauna gives them the top ambush chance.
    const risk: BodyRiskGrades = { combat: 1, fauna: 4, flora: 3, hazard: 2 };
    const setup = (seed: number): RiskSetup => ({
      kinds: ["survey", "ground"],
      pois: ["mineralOutcrop", "mineralOutcrop", "mineralOutcrop", "mineralOutcrop", "caveNetwork", "crashedShip"],
      risk,
      hazard: 0.4,
      seed,
      scanning: true,
    });
    const END = T0 + 7200;
    let e: Expedition | null = null;
    for (let seed = 1; seed <= 400 && !e; seed += 1) {
      const x = riskRun(setup(seed));
      const big = advanceExpedition(x, END);
      const ops = big.groundOps!;
      const surprise = ops.history.some((r) => r.step === "fight" && r.surprise);
      const retreat = ops.history.some((r) => r.teamIndex === 0 && r.step === "work" && r.ambushed);
      if (surprise && retreat) e = x;
    }
    expect(e).not.toBeNull();
    const exp = e!;
    const frozen = structuredClone(exp);
    const big = advanceExpedition(exp, END);
    let chunked = exp;
    for (let t = 997; t < END; t += 997) chunked = advanceExpedition(chunked, t);
    chunked = advanceExpedition(chunked, END);
    expect(chunked).toEqual(big);
    let live = advanceExpedition(exp, T0);
    for (let t = T0 + 1; t <= END; t += 1) live = advanceExpedition(live, t);
    expect(live).toEqual(big);
    expect(exp).toEqual(frozen); // the input is never mutated
    // Risk shaped the stamps: Survey took calm tasks, difficulty is rated, flora slowed the dig.
    expect(tasksOf(big).every((t) => typeof t.difficulty === "number")).toBe(true);
    expect(tasksOf(big).some((t) => t.assignedTeamIds?.join(",") === "0")).toBe(true);
  });

  it("a REAL dispatched risk-aware run, whole run: big == 997 s chunks, every task rated", { timeout: 180_000 }, () => {
    const exp = dispatch({ ...compState(["ground", "ground"]), expeditionSeed: 0x0a13bd4 });
    expect(exp.risk).toBeDefined();
    const END = 250_000;
    let chunked = exp;
    for (let c = 997; c < END; c += 997) chunked = advanceExpedition(chunked, c);
    chunked = advanceExpedition(chunked, END);
    const big = advanceExpedition(exp, END);
    expect(chunked).toEqual(big);
    const stamped = big.bodies.flatMap((b) => b.activities).filter((t) => t.status !== undefined);
    expect(stamped.length).toBeGreaterThan(0);
    for (const t of stamped) expect(t.difficulty).toBeGreaterThanOrEqual(1);
  });
});
