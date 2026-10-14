// Squads SQ-6 (docs/plans/2026-10-12-squads-and-subspace-telescope-design.md sections 6.3 and 6.5): the LAUNCH
// RECOMMENDATION on hand-built task previews (the design's worked examples: a calm Tier I system recommends
// Survey + Ground, a mixed Tier II system keeps Ground + Ground, a Tier IV system in enemy territory recommends
// Strike + Ground), the ranking order (coverage, solo share, Security balance, fewest changes, Ground + Ground),
// the unfinished-task lines, the detail 3 task demand and the detail gate (nothing is computed or shown below
// its level).

import { describe, expect, it } from "vitest";
import type { BodyRiskGrades, GroundTaskNeeds, GroundTeamKind, RegionTier } from "./model";
import { SAFE_NEEDS_MAX_TIER } from "./riskFactors";
import {
  compositionChanges,
  gateLaunchView,
  previewForHull,
  rankCompositions,
  recommendLaunch,
  scoreComposition,
  securityDemand,
  taskDemand,
  taskDemandText,
  unfinishedTasksUnder,
  type PreviewTask,
  type SystemTaskPreview,
} from "./launchRecommendation";

const body = (combat: number): BodyRiskGrades => ({ combat: combat as BodyRiskGrades["combat"], fauna: 0, flora: 0, hazard: 0 });

function task(bodyIndex: number, poiId: string, needs: GroundTaskNeeds, difficulty: number, fightPoints = needs.security * 2): PreviewTask {
  return { bodyIndex, poiId, hostile: poiId === "enemyColony" || poiId === "enemyFortification", fightPoints, needs, difficulty };
}

function preview(tier: RegionTier, bodies: BodyRiskGrades[], tasks: PreviewTask[], enemyTerritory = false): SystemTaskPreview {
  return { tier, enemyTerritory, bodies, tasks };
}

// The design's three worked examples.
const CALM_T1 = preview(1, [body(0), body(1)], [
  task(0, "mineralOutcrop", { security: 0, science: 1 }, 1, 0),
  task(0, "caveNetwork", { security: 1, science: 1 }, 2, 1),
  task(1, "ancientRuins", { security: 0, science: 1 }, 1, 0),
  task(1, "xenoFloraBloom", { security: 0, science: 1 }, 1, 0),
]);
const MIXED_T2 = preview(2, [body(1), body(2)], [
  task(0, "caveNetwork", { security: 1, science: 1 }, 2),
  task(0, "crashedShip", { security: 1, science: 1 }, 3),
  task(1, "mineralOutcrop", { security: 0, science: 1 }, 1, 0),
  task(1, "ancientRuins", { security: 1, science: 1 }, 2),
]);
const ENEMY_T4 = preview(
  4,
  [body(4), body(3), body(2)],
  [
    task(0, "derelictOutpost", { security: 2, science: 1 }, 4, 5),
    task(0, "enemyColony", { security: 2, science: 1 }, 4, 4),
    task(1, "crashedShip", { security: 2, science: 1 }, 3, 4),
    task(1, "mineralOutcrop", { security: 1, science: 1 }, 2, 1),
    task(2, "caveNetwork", { security: 1, science: 1 }, 2, 2),
  ],
  true,
);

const GG: GroundTeamKind[] = ["ground", "ground"];
// validCompositions order (team order never matters to a composition).
const SG: GroundTeamKind[] = ["ground", "strike"];
const VG: GroundTeamKind[] = ["ground", "survey"];
const SV: GroundTeamKind[] = ["strike", "survey"];

describe("the scores (design 6.5 steps 1 and 2)", () => {
  it("Security demand = the difficulty-weighted share of required squads that are Security", () => {
    // CALM_T1: weights 1, 2, 1, 1; Security 0, 2, 0, 0 of 1, 4, 1, 1 squad-weights.
    expect(securityDemand(CALM_T1)).toBeCloseTo(2 / 7, 10);
    // ENEMY_T4: weights 5, 5, 3, 2, 2.
    expect(securityDemand(ENEMY_T4)).toBeCloseTo(30 / 47, 10);
    expect(securityDemand(preview(1, [], []))).toBe(0.5);
  });

  it("coverage counts what some crew of the composition covers; solo share what ONE team covers alone", () => {
    const vg = scoreComposition(ENEMY_T4, VG, GG);
    expect(vg.coverage).toBeCloseTo(4 / 17, 10); // only the two { 1, 1 } tasks: one Security squad aboard
    expect(vg.unfinished.map((t) => t.poiId)).toEqual(["derelictOutpost", "enemyColony", "crashedShip"]);
    const gg = scoreComposition(ENEMY_T4, GG, GG);
    expect(gg.coverage).toBe(1); // { 2, 1 } as the pair
    expect(gg.solo).toBeCloseTo(4 / 17, 10);
    const sv = scoreComposition(CALM_T1, SV, GG);
    expect(sv.coverage).toBe(1);
    expect(sv.solo).toBeCloseTo(3 / 5, 10); // the cave { 1, 1 } needs the pair
    expect(sv.changes).toBe(2);
    expect(scoreComposition(CALM_T1, GG, GG)).toMatchObject({ coverage: 1, solo: 1, securityShare: 0.5, changes: 0 });
  });

  it("changes = the fewest squads changed over any matching of the teams", () => {
    expect(compositionChanges(GG, GG)).toBe(0);
    expect(compositionChanges(GG, SG)).toBe(1);
    expect(compositionChanges(GG, SV)).toBe(2);
    expect(compositionChanges(SV, VG)).toBe(1); // Strike -> Ground, Survey stays
    expect(compositionChanges(SG, VG)).toBe(2);
    expect(compositionChanges(["strike", "ground"], SG)).toBe(0); // team order never matters
  });
});

describe("the recommendation (design 6.5): the worked examples", () => {
  it("a calm Tier I system recommends Survey + Ground (mostly survey work)", () => {
    const rec = recommendLaunch(CALM_T1, "generalFreighter", GG)!;
    expect(rec.kinds).toEqual(VG);
    expect(rec.label).toBe("Survey + Ground");
    expect(rec.isCurrent).toBe(false);
    expect(rec.headline).toBe("Launch with Survey + Ground");
    expect(rec.reason).toBe("Mostly survey work: 3 of 4 tasks need no Security squad.");
    expect(rec.unfinished).toEqual([]);
    expect(rec.unfinishedText).toBeNull();
    expect(rec.stillUnfinishedText).toBeNull();
  });

  it("a mixed Tier II system keeps Ground + Ground", () => {
    const rec = recommendLaunch(MIXED_T2, "generalFreighter", GG)!;
    expect(rec.kinds).toEqual(GG);
    expect(rec.isCurrent).toBe(true);
    expect(rec.headline).toBe("Your Ground + Ground suits this system.");
    expect(rec.reason).toBe("Security and survey work in even measure on 2 bodies.");
  });

  it("a Tier IV system in enemy territory recommends Strike + Ground", () => {
    const rec = recommendLaunch(ENEMY_T4, "generalFreighter", GG)!;
    expect(rec.kinds).toEqual(SG);
    expect(rec.headline).toBe("Launch with Strike + Ground");
    expect(rec.reason).toBe("Enemy territory on 2 of 3 bodies; 3 tasks need 2 Security squads.");
    // From Survey + Ground the coverage decides, and the current composition's unfinished tasks are named.
    const fromVg = recommendLaunch(ENEMY_T4, "generalFreighter", VG)!;
    expect(fromVg.reason).toBe("Covers 3 tasks your Survey + Ground would leave unfinished.");
    expect(fromVg.unfinished.map((t) => t.text)).toEqual([
      "Derelict Outpost needs 2 Security squads",
      "Enemy Colony needs 2 Security squads",
      "Crashed Ship needs 2 Security squads",
    ]);
    expect(fromVg.unfinishedText).toBe(
      "Survey + Ground would leave 3 tasks unfinished: Derelict Outpost needs 2 Security squads; Enemy Colony needs 2 Security squads; Crashed Ship needs 2 Security squads.",
    );
  });
});

describe("the ranking order", () => {
  it("coverage first: a big Tier III dig needing 2 Science squads moves Strike + Ground to Ground + Ground", () => {
    const p = preview(3, [body(2), body(1)], [
      task(0, "subterraneanCivilization", { security: 1, science: 2 }, 3, 3),
      task(1, "crashedShip", { security: 2, science: 1 }, 3, 4),
      task(1, "mineralOutcrop", { security: 1, science: 1 }, 2, 1),
    ]);
    const rec = recommendLaunch(p, "generalFreighter", SG)!;
    expect(rec.kinds).toEqual(GG); // GG and SV cover both; GG wins on solo share
    expect(rec.reason).toBe("Covers 1 task your Strike + Ground would leave unfinished.");
    expect(rec.unfinishedText).toBe("Strike + Ground would leave 1 task unfinished: Subterranean Civilization needs 2 Science squads.");
  });

  it("solo share second: Strike + Survey loses a calm system to a composition whose teams work alone", () => {
    const rank = rankCompositions(MIXED_T2, "generalFreighter", SV).map((s) => s.label);
    expect(rank[0]).toBe("Ground + Ground");
    expect(rank[rank.length - 1]).toBe("Strike + Survey");
    const rec = recommendLaunch(MIXED_T2, "generalFreighter", SV)!;
    expect(rec.reason).toBe("One team can take 4 of 4 tasks alone (your Strike + Survey: 1).");
  });

  it("then the fewest changes from the current composition, then Ground + Ground", () => {
    // Demand 3/8: Ground + Ground (0.5) and Survey + Ground (0.25) tie on the balance gap.
    const p = preview(2, [body(1)], [task(0, "caveNetwork", { security: 1, science: 1 }, 3), task(0, "mineralOutcrop", { security: 0, science: 1 }, 2, 0)]);
    expect(securityDemand(p)).toBeCloseTo(3 / 8, 10);
    expect(recommendLaunch(p, "generalFreighter", SG)!.kinds).toEqual(GG); // 1 change vs 2
    expect(recommendLaunch(p, "generalFreighter", VG)!).toMatchObject({ kinds: VG, isCurrent: true });
    expect(recommendLaunch(p, "generalFreighter", SV)!.kinds).toEqual(VG); // 1 change vs 2
    expect(recommendLaunch(p, "generalFreighter", GG)!.kinds).toEqual(GG);
  });

  it("a system with no tasks keeps the current composition", () => {
    const rec = recommendLaunch(preview(1, [body(0)], []), "generalFreighter", VG)!;
    expect(rec).toMatchObject({ kinds: VG, isCurrent: true, headline: "Your Survey + Ground suits this system.", reason: "No ground tasks expected." });
  });

  it("names what NOTHING on the hull covers (a 4-squad hull tops out at 3 Security squads)", () => {
    const p = preview(6, [body(4)], [task(0, "enemyFortification", { security: 4, science: 0 }, 5, 5), task(0, "mineralOutcrop", { security: 1, science: 1 }, 2, 1)]);
    const rec = recommendLaunch(p, "generalFreighter", GG)!;
    expect(rec.stillUnfinished.map((t) => t.poiId)).toEqual(["enemyFortification"]);
    expect(rec.stillUnfinishedText).toBe("Nothing on this hull covers every task: Enemy Fortification needs 4 Security squads. It will be left unfinished.");
    expect(unfinishedTasksUnder(p, SG).map((t) => t.text)).toEqual(["Enemy Fortification needs 4 Security squads"]);
  });

  it("returns null for a hull that fields no ground teams", () => {
    expect(recommendLaunch(CALM_T1, "noSuchHull" as never, GG)).toBeNull();
  });
});

describe("the detail 3 task demand", () => {
  it("counts Security bodies and the squad-heavy tasks", () => {
    expect(taskDemand(ENEMY_T4)).toEqual({ bodies: 3, securityBodies: 3, tasks: 5, noSecurityTasks: 0, twoSecurityTasks: 3, twoScienceTasks: 0, maxSecurity: 2, maxScience: 1 });
    expect(taskDemandText(taskDemand(ENEMY_T4))).toBe("Security work on 3 of 3 bodies; 3 tasks need 2 Security squads");
    expect(taskDemandText(taskDemand(CALM_T1))).toBe("Security work on 1 of 2 bodies");
    const quiet = preview(1, [body(0)], [task(0, "mineralOutcrop", { security: 0, science: 1 }, 1, 0)]);
    expect(taskDemandText(taskDemand(quiet))).toBe("No Security work expected on 1 body");
    const heavy = preview(6, [body(4), body(0)], [task(0, "enemyFortification", { security: 4, science: 0 }, 5, 5), task(1, "ancientRuins", { security: 0, science: 2 }, 2, 0)]);
    expect(taskDemandText(taskDemand(heavy))).toBe("Security work on 1 of 2 bodies; 1 task needs 2 or more Security squads; 1 task needs 2 Science squads");
  });
});

describe("the detail gate (design 6.3): nothing is computed or shown below its level", () => {
  const calls = { preview: 0, recommend: 0, forecast: 0 };
  const view = (detail: number) =>
    gateLaunchView(detail, {
      preview: () => {
        calls.preview += 1;
        return ENEMY_T4;
      },
      recommend: (p) => {
        calls.recommend += 1;
        return recommendLaunch(p, "generalFreighter", GG);
      },
      forecast: () => {
        calls.forecast += 1;
        return null;
      },
    });

  it("Blind, Contact and Graded carry nothing and call nothing", () => {
    for (const d of [0, 1, 2]) expect(view(d)).toEqual({ demand: null, recommendation: null, forecast: null });
    expect(calls).toEqual({ preview: 0, recommend: 0, forecast: 0 });
  });

  it("Per body adds the demand only; Recommendation the recommendation; Forecast the forecast", () => {
    const v3 = view(3);
    expect(v3.demand).toEqual(taskDemand(ENEMY_T4));
    expect(v3.recommendation).toBeNull();
    expect(calls).toMatchObject({ recommend: 0, forecast: 0 });
    const v4 = view(4);
    expect(v4.recommendation?.label).toBe("Strike + Ground");
    expect(calls.forecast).toBe(0);
    view(5);
    expect(calls.forecast).toBe(1);
  });
});

describe("the odds, ONLY WHEN FIGHTS ARE RISKY (user, 2026-10-13), and only from Tier III", () => {
  // The mixed system, as if it lay in Tier III (the odds step's first tier).
  const MIXED_T3: SystemTaskPreview = { ...MIXED_T2, tier: 3 };

  // A reader keyed by the sorted kinds, counting its calls.
  function reader(table: Record<string, number | null>) {
    const calls: string[] = [];
    const oddsOf = (kinds: readonly GroundTeamKind[]) => {
      const k = [...kinds].sort().join("+");
      calls.push(k);
      return table[k] ?? null;
    };
    return { oddsOf, calls };
  }

  it("the winner at A Worthy Adversary or better stays, and only its odds are read", () => {
    const { oddsOf, calls } = reader({ "ground+ground": 0.62, "ground+strike": 1, "ground+survey": 1, "strike+survey": 1 });
    const rec = recommendLaunch(MIXED_T3, "generalFreighter", GG, oddsOf)!;
    expect(rec).toMatchObject({ kinds: GG, isCurrent: true, oddsDecided: false, riskyFightsText: null });
    expect(calls).toEqual(["ground+ground"]);
    expect(rec.ranked[0]).toMatchObject({ fightOdds: 0.62, oddsTier: "worthy", oddsName: "A Worthy Adversary" });
    expect(rec.ranked.slice(1).every((r) => r.fightOdds === null)).toBe(true);
  });

  it("a risky winner gives way to the covering mix with the best better band, and says so", () => {
    const { oddsOf, calls } = reader({ "ground+ground": 0.45, "ground+strike": 0.7, "ground+survey": 0.3, "strike+survey": 0.85 });
    const rec = recommendLaunch(MIXED_T3, "generalFreighter", GG, oddsOf)!;
    expect(rec.kinds).toEqual(SV); // Likely Victory beats A Worthy Adversary
    expect(rec.oddsDecided).toBe(true);
    expect(rec.headline).toBe("Launch with Strike + Survey");
    expect(rec.reason).toBe("Risky fights: your Ground + Ground reads It's Time to Toss the Dice; Strike + Survey reads Likely Victory.");
    expect(new Set(calls)).toEqual(new Set(["ground+ground", "ground+strike", "ground+survey", "strike+survey"]));
  });

  it("only mixes with the winner's coverage compete: a better-odds mix that leaves tasks is never picked", () => {
    const { oddsOf } = reader({ "ground+ground": 0.2, "ground+strike": 0.2, "ground+survey": 1, "strike+survey": 0.2 });
    const rec = recommendLaunch(ENEMY_T4, "generalFreighter", GG, oddsOf)!;
    expect(rec.label).not.toBe("Survey + Ground"); // it leaves the { 2, 1 } tasks
    expect(rec.oddsDecided).toBe(false);
    expect(rec.riskyFightsText).toBe("The fights read risky (Not Advised) and no mix on this hull reads better.");
  });

  it("Tiers I and II stay simple: the odds reader is never called there, however risky the fights", () => {
    for (const p of [CALM_T1, MIXED_T2]) {
      const { oddsOf, calls } = reader({ "ground+ground": 0, "ground+strike": 1, "ground+survey": 1, "strike+survey": 1 });
      const rec = recommendLaunch(p, "generalFreighter", GG, oddsOf)!;
      expect(calls).toEqual([]);
      expect(rec).toEqual(recommendLaunch(p, "generalFreighter", GG));
      expect(rec).toMatchObject({ oddsDecided: false, riskyFightsText: null });
    }
    expect(SAFE_NEEDS_MAX_TIER).toBe(2); // the gate reuses the safe tiers' boundary
  });

  it("unknown odds (null) leave the ranking as it is", () => {
    const { oddsOf } = reader({ "ground+ground": null, "ground+strike": 1, "ground+survey": 1, "strike+survey": 1 });
    expect(recommendLaunch(MIXED_T3, "generalFreighter", GG, oddsOf)!).toMatchObject({ kinds: GG, oddsDecided: false, riskyFightsText: null });
  });
});

describe("previewForHull (SQ-6 review Minor 1): a site no valid composition fields never appears in the hull's runs", () => {
  it("drops a fortification on a 4-squad hull and keeps a colony and every other task", () => {
    const p = preview(6, [body(4), body(4)], [
      task(0, "enemyFortification", { security: 4, science: 0 }, 5, 5),
      task(1, "enemyColony", { security: 2, science: 1 }, 4, 4),
      task(1, "clearHostiles", { security: 2, science: 0 }, 4, 4),
    ]);
    expect(previewForHull(p, "generalFreighter").tasks.map((t) => t.poiId)).toEqual(["enemyColony", "clearHostiles"]);
    expect(taskDemand(previewForHull(p, "generalFreighter")).twoSecurityTasks).toBe(2);
    expect(recommendLaunch(previewForHull(p, "generalFreighter"), "generalFreighter", GG)!.stillUnfinished).toEqual([]);
  });
});
